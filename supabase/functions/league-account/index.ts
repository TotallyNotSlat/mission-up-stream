import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const normalizeUsername=(value:unknown)=>{const username=String(value??"").trim();const normalized=username.toLowerCase();if(!/^[a-z0-9_]{3,24}$/.test(normalized))throw new Error("Username must be 3–24 characters using letters, numbers, or underscores.");return{username,normalized,email:`${normalized}@players.cornerpond.app`}};

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
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

    if(action==="change_password"){
      const password=String(body.password??"");
      if(password.length<8)throw new Error("Your new password must be at least 8 characters.");
      if(password==="Fish420")throw new Error("Choose a password other than the temporary password.");
      const {error}=await db.auth.admin.updateUserById(caller.id,{password});if(error)throw error;
      const {error:profileError}=await db.from("profiles").update({must_change_password:false,updated_at:new Date().toISOString()}).eq("id",caller.id);if(profileError)throw profileError;
      return json({ok:true});
    }

    if(action==="update_my_profile"){
      const next=normalizeUsername(body.username),bio=String(body.bio??"").trim(),statusText=String(body.status_text??"").trim();
      if(bio.length>500)throw new Error("Bio must be 500 characters or fewer.");
      if(statusText.length>120)throw new Error("Status must be 120 characters or fewer.");
      const {data:collision}=await db.from("profiles").select("id").eq("username_normalized",next.normalized).neq("id",caller.id).maybeSingle();if(collision)throw new Error("That username is already in use.");
      const {error:authError}=await db.auth.admin.updateUserById(caller.id,{email:next.email,user_metadata:{...caller.user_metadata,username:next.username,username_normalized:next.normalized}});if(authError)throw authError;
      const {error}=await db.from("profiles").update({username:next.username,username_normalized:next.normalized,bio,status_text:statusText,updated_at:new Date().toISOString()}).eq("id",caller.id);if(error)throw error;
      return json({ok:true,username:next.username});
    }

    if(action==="set_active_title"){
      const titleId=body.title_id?String(body.title_id):null;
      if(titleId){const {data}=await db.from("player_titles").select("title_id").eq("player_id",caller.id).eq("title_id",titleId).maybeSingle();if(!data)throw new Error("That title is not assigned to your account.");}
      const {error}=await db.from("profiles").update({active_title_id:titleId,updated_at:new Date().toISOString()}).eq("id",caller.id);if(error)throw error;
      return json({ok:true});
    }

    const {data:adminRow}=await db.from("league_admins").select("user_id").eq("user_id",caller.id).maybeSingle();
    if(!adminRow)return json({error:"Administrator access is required."},403);

    if(action==="admin_create_user"){
      const next=normalizeUsername(body.username);
      const {data:collision}=await db.from("profiles").select("id").eq("username_normalized",next.normalized).maybeSingle();if(collision)throw new Error("That username is already in use.");
      const {data:created,error:createError}=await db.auth.admin.createUser({email:next.email,password:"Fish420",email_confirm:true,user_metadata:{username:next.username,username_normalized:next.normalized}});if(createError)throw createError;
      const userId=created.user.id;
      const {error:profileError}=await db.from("profiles").insert({id:userId,username:next.username,username_normalized:next.normalized,must_change_password:true});
      if(profileError){await db.auth.admin.deleteUser(userId);throw profileError;}
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:userId,action:"account_created",after_data:{username:next.username},reason:String(body.reason??"Player invited by administrator")});
      return json({ok:true,player_id:userId,username:next.username,temporary_password:"Fish420"});
    }

    const targetId=String(body.player_id??"");
    if(!targetId)throw new Error("Player ID is required.");

    if(action==="admin_reset_password"){
      const {error:authError}=await db.auth.admin.updateUserById(targetId,{password:"Fish420"});if(authError)throw authError;
      const {error}=await db.from("profiles").update({must_change_password:true,updated_at:new Date().toISOString()}).eq("id",targetId);if(error)throw error;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:targetId,action:"password_reset",after_data:{temporary_password:true},reason:String(body.reason??"Forgotten password reset")});
      return json({ok:true,temporary_password:"Fish420"});
    }

    if(action==="admin_set_titles"){
      const requested=Array.isArray(body.title_ids)?body.title_ids.map(String):[];
      const {data:definitions,error:defError}=await db.from("title_definitions").select("id,key");if(defError)throw defError;
      const allowed=new Set((definitions??[]).map(row=>row.id));if(requested.some(id=>!allowed.has(id)))throw new Error("One or more titles are invalid.");
      const starters=(definitions??[]).filter(row=>["fisherman","fisherwoman","fish"].includes(row.key)).map(row=>row.id);
      const finalIds=[...new Set([...requested,...starters])];
      const adminTitle=(definitions??[]).find(row=>row.key==="admin");
      const grantsAdmin=Boolean(adminTitle&&finalIds.includes(adminTitle.id));
      if(targetId===caller.id&&!grantsAdmin)throw new Error("You cannot remove your own administrator access.");
      const {data:before}=await db.from("player_titles").select("title_id").eq("player_id",targetId);
      const {error:deleteError}=await db.from("player_titles").delete().eq("player_id",targetId);if(deleteError)throw deleteError;
      if(finalIds.length){const {error:insertError}=await db.from("player_titles").insert(finalIds.map(title_id=>({player_id:targetId,title_id,assigned_by:caller.id,source:starters.includes(title_id)?"starter":"admin"})));if(insertError)throw insertError;}
      if(grantsAdmin){const {error}=await db.from("league_admins").upsert({user_id:targetId});if(error)throw error;}else{const {error}=await db.from("league_admins").delete().eq("user_id",targetId);if(error)throw error;}
      const {data:profile}=await db.from("profiles").select("active_title_id").eq("id",targetId).single();
      if(profile?.active_title_id&&!finalIds.includes(profile.active_title_id))await db.from("profiles").update({active_title_id:null}).eq("id",targetId);
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:targetId,action:"titles_updated",before_data:{title_ids:(before??[]).map(row=>row.title_id)},after_data:{title_ids:finalIds},reason:String(body.reason??"Title assignment updated")});
      return json({ok:true,title_ids:finalIds});
    }

    if(action==="admin_update_profile"){
      const next=normalizeUsername(body.username),bio=String(body.bio??"").trim(),statusText=String(body.status_text??"").trim();
      const medals=Math.max(0,Math.trunc(Number(body.daily_medals??0))),trophies=Math.max(0,Math.trunc(Number(body.tournament_trophies??0))),reason=String(body.reason??"").trim();
      if(reason.length<3)throw new Error("Enter a reason of at least 3 characters.");if(bio.length>500)throw new Error("Bio must be 500 characters or fewer.");if(statusText.length>120)throw new Error("Status must be 120 characters or fewer.");
      const {data:before,error:beforeError}=await db.from("profiles").select("username,bio,status_text").eq("id",targetId).single();if(beforeError)throw beforeError;
      const {data:beforeReward}=await db.from("profile_rewards").select("daily_medals,tournament_trophies").eq("player_id",targetId).maybeSingle();
      const {data:collision}=await db.from("profiles").select("id").eq("username_normalized",next.normalized).neq("id",targetId).maybeSingle();if(collision)throw new Error("That username is already in use.");
      const {data:targetUser,error:targetError}=await db.auth.admin.getUserById(targetId);if(targetError)throw targetError;
      const {error:authError}=await db.auth.admin.updateUserById(targetId,{email:next.email,user_metadata:{...targetUser.user.user_metadata,username:next.username,username_normalized:next.normalized}});if(authError)throw authError;
      const {error:profileError}=await db.from("profiles").update({username:next.username,username_normalized:next.normalized,bio,status_text:statusText,updated_at:new Date().toISOString()}).eq("id",targetId);if(profileError)throw profileError;
      const {error:rewardError}=await db.from("profile_rewards").upsert({player_id:targetId,daily_medals:medals,tournament_trophies:trophies,updated_at:new Date().toISOString()});if(rewardError)throw rewardError;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:targetId,action:"profile_update",before_data:{...before,...(beforeReward??{})},after_data:{username:next.username,bio,status_text:statusText,daily_medals:medals,tournament_trophies:trophies},reason});
      return json({ok:true});
    }
    return json({error:"Unknown action."},400);
  }catch(error){return json({error:error instanceof Error?error.message:"Request failed."},400)}
});
