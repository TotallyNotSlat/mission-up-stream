import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const MAX_FILE_BYTES=1024*1024;
const MAX_SAVES=15;
const MAX_LOCKED=5;
const MIN_DELETABLE_REMAINDER=5;

const fromBase64=(value:string)=>{
  const binary=atob(value);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
};
const toBase64=(bytes:Uint8Array)=>{
  let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
};
const sha256=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(v=>v.toString(16).padStart(2,"0")).join("");
const numberField=(text:string,name:string)=>{
  const match=text.match(new RegExp(`&"${name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}":\\s*(-?[0-9]+(?:\\.[0-9]+)?)`,`m`));
  return match?Math.trunc(Number(match[1])):0;
};
const parseSave=(bytes:Uint8Array)=>{
  if(bytes.length<100||bytes.length>MAX_FILE_BYTES)throw new Error("The selected file is not a valid Cornerpond save.");
  const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
  for(const marker of ['&"player_xp"','&"money"','&"fish_caught"','"hash"'])if(!text.includes(marker))throw new Error("The selected file is not a valid Cornerpond save.");
  return {player_xp:Math.max(0,numberField(text,"player_xp")),current_cash:numberField(text,"money"),total_fish:Math.max(0,numberField(text,"fish_caught")),player_level:null};
};
const sortRows=(rows:any[])=>[...rows].sort((a,b)=>Number(a.is_locked)-Number(b.is_locked)||Date.parse(b.uploaded_at)-Date.parse(a.uploaded_at));
const presentRows=(rows:any[])=>sortRows(rows).map((row,index)=>({...row,effective_nickname:row.custom_nickname||`Save ${index+1}`}));

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);
  try{
    const authorization=req.headers.get("Authorization");
    if(!authorization?.startsWith("Bearer "))return json({error:"Please sign in."},401);
    const url=Deno.env.get("SUPABASE_URL")!;
    const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await db.auth.getUser(authorization.slice(7));
    const caller=userData.user;
    if(userError||!caller)return json({error:"Your session is invalid or expired."},401);
    const body=await req.json();
    const action=String(body.action??"");
    const {data:adminRow}=await db.from("league_admins").select("user_id").eq("user_id",caller.id).maybeSingle();
    const isAdmin=Boolean(adminRow);
    const requestedPlayer=String(body.player_id??"");
    const playerId=requestedPlayer||caller.id;
    if(playerId!==caller.id&&!isAdmin)return json({error:"Administrator access is required."},403);
    const {data:profile,error:profileError}=await db.from("profiles").select("id,username").eq("id",playerId).single();
    if(profileError||!profile)throw new Error("Player profile was not found.");

    if(action==="list"){
      const {data,error}=await db.from("cloud_saves").select("id,player_id,file_sha256,file_size,player_xp,player_level,current_cash,total_fish,custom_nickname,notes,is_locked,source,uploaded_at,updated_at").eq("player_id",playerId).order("uploaded_at",{ascending:false});
      if(error)throw error;
      return json({ok:true,player:{id:profile.id,username:profile.username},saves:presentRows(data??[]),limits:{maximum:MAX_SAVES,maximum_locked:MAX_LOCKED,minimum_after_delete:MIN_DELETABLE_REMAINDER}});
    }

    if(action==="upload"){
      const encoded=String(body.file_base64??"");
      if(!encoded)throw new Error("Choose a Cornerpond game.dat file first.");
      const bytes=fromBase64(encoded);
      const metadata=parseSave(bytes);
      const digest=await sha256(bytes);
      const {data:existing,error:listError}=await db.from("cloud_saves").select("id,player_id,storage_path,file_sha256,file_size,player_xp,player_level,current_cash,total_fish,custom_nickname,notes,is_locked,source,uploaded_at,updated_at").eq("player_id",playerId).order("uploaded_at",{ascending:false});
      if(listError)throw listError;
      const newest=(existing??[])[0];
      if(newest?.file_sha256===digest)return json({ok:true,duplicate:true,message:"The local save matches the newest cloud save.",saves:presentRows(existing??[])});

      const id=crypto.randomUUID();
      const storagePath=`${playerId}/${id}.dat`;
      const source=isAdmin&&playerId!==caller.id?"admin":String(body.source??"manual")==="automatic"?"automatic":"manual";
      const {error:uploadError}=await db.storage.from("cloud-saves").upload(storagePath,bytes,{contentType:"application/octet-stream",upsert:false});
      if(uploadError)throw uploadError;
      const row={id,player_id:playerId,storage_path:storagePath,file_sha256:digest,file_size:bytes.length,...metadata,custom_nickname:null,notes:"",is_locked:false,source,uploaded_by:caller.id};
      const {error:insertError}=await db.from("cloud_saves").insert(row);
      if(insertError){await db.storage.from("cloud-saves").remove([storagePath]);throw insertError;}

      const {data:all,error:allError}=await db.from("cloud_saves").select("*").eq("player_id",playerId).order("uploaded_at",{ascending:false});
      if(allError)throw allError;
      const overflow=Math.max(0,(all??[]).length-MAX_SAVES);
      if(overflow){
        const victims=(all??[]).filter(row=>!row.is_locked).sort((a,b)=>Date.parse(a.uploaded_at)-Date.parse(b.uploaded_at)).slice(0,overflow);
        if(victims.length<overflow)throw new Error("The cloud-save limit could not be enforced because too many saves are locked.");
        const {error:removeError}=await db.storage.from("cloud-saves").remove(victims.map(row=>row.storage_path));if(removeError)throw removeError;
        const {error:deleteError}=await db.from("cloud_saves").delete().in("id",victims.map(row=>row.id));if(deleteError)throw deleteError;
      }
      const {data:finalRows,error:finalError}=await db.from("cloud_saves").select("id,player_id,file_sha256,file_size,player_xp,player_level,current_cash,total_fish,custom_nickname,notes,is_locked,source,uploaded_at,updated_at").eq("player_id",playerId).order("uploaded_at",{ascending:false});if(finalError)throw finalError;
      return json({ok:true,duplicate:false,save_id:id,saves:presentRows(finalRows??[])});
    }

    const saveId=String(body.save_id??"");
    if(!saveId)throw new Error("Save ID is required.");
    const {data:save,error:saveError}=await db.from("cloud_saves").select("*").eq("id",saveId).eq("player_id",playerId).single();
    if(saveError||!save)throw new Error("Cloud save was not found.");

    if(action==="download"){
      const {data,error}=await db.storage.from("cloud-saves").download(save.storage_path);if(error)throw error;
      const bytes=new Uint8Array(await data.arrayBuffer());
      return json({ok:true,file_name:`${save.custom_nickname||"Cornerpond cloud save"}.dat`,file_base64:toBase64(bytes),save:presentRows([save])[0]});
    }

    if(action==="update"){
      const nickname=String(body.custom_nickname??"").trim();
      const notes=String(body.notes??"").trim();
      const locked=Boolean(body.is_locked);
      if(nickname.length>60)throw new Error("Save nicknames must be 60 characters or fewer.");
      if(notes.length>500)throw new Error("Save notes must be 500 characters or fewer.");
      if(locked&&!save.is_locked){
        const {count,error}=await db.from("cloud_saves").select("id",{count:"exact",head:true}).eq("player_id",playerId).eq("is_locked",true);if(error)throw error;
        if((count??0)>=MAX_LOCKED)throw new Error("You can lock at most five cloud saves.");
      }
      const {error}=await db.from("cloud_saves").update({custom_nickname:nickname||null,notes,is_locked:locked,updated_at:new Date().toISOString()}).eq("id",saveId);if(error)throw error;
      return json({ok:true});
    }

    if(action==="delete"){
      if(save.is_locked)throw new Error("Unlock this cloud save before deleting it.");
      const {count,error:countError}=await db.from("cloud_saves").select("id",{count:"exact",head:true}).eq("player_id",playerId);if(countError)throw countError;
      if((count??0)<=MIN_DELETABLE_REMAINDER)throw new Error("At least five cloud saves must remain available.");
      const {error:removeError}=await db.storage.from("cloud-saves").remove([save.storage_path]);if(removeError)throw removeError;
      const {error:deleteError}=await db.from("cloud_saves").delete().eq("id",saveId);if(deleteError)throw deleteError;
      return json({ok:true});
    }
    return json({error:"Unknown action."},400);
  }catch(error){return json({error:error instanceof Error?error.message:"Request failed."},400)}
});
