import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);
  try{
    const authorization=req.headers.get("Authorization");
    if(!authorization?.startsWith("Bearer "))return json({error:"Please sign in."},401);
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await db.auth.getUser(authorization.slice(7));
    const caller=userData.user;
    if(userError||!caller)return json({error:"Your session is invalid or expired."},401);
    const body=await req.json();
    const action=String(body.action??"");

    if(action==="get_my_permissions"){
      const {data}=await db.from("league_admins").select("user_id").eq("user_id",caller.id).maybeSingle();
      return json({ok:true,is_admin:Boolean(data)});
    }

    if(action==="update_chat_color"){
      const color=String(body.color??"").toUpperCase();
      const palette=new Set(["#60DCFA","#34D399","#FBBF24","#F472B6","#A78BFA","#FB923C","#F87171","#E2E8F0"]);
      if(!palette.has(color))throw new Error("Choose a color from the launcher palette.");
      const {error}=await db.from("profiles").update({chat_name_color:color,updated_at:new Date().toISOString()}).eq("id",caller.id);if(error)throw error;
      return json({ok:true,color});
    }

    if(action==="admin_delete_chat_message"){
      const {data:admin}=await db.from("league_admins").select("user_id").eq("user_id",caller.id).maybeSingle();
      if(!admin)return json({error:"Administrator access is required."},403);
      const messageId=Number(body.message_id);
      if(!Number.isSafeInteger(messageId)||messageId<1)throw new Error("A valid chat message is required.");
      const {data:message,error:messageError}=await db.from("chat_messages").select("id,user_id,kind,body,created_at").eq("id",messageId).single();if(messageError)throw messageError;
      const {error}=await db.from("chat_messages").delete().eq("id",messageId);if(error)throw error;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:message.user_id,action:"chat_message_deleted",before_data:message,reason:"Chat message removed by administrator"});
      return json({ok:true,id:messageId});
    }

    return json({error:"Unknown action."},400);
  }catch(error){return json({error:error instanceof Error?error.message:"Request failed."},400)}
});
