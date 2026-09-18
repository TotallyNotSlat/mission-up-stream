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
      const next=normalizeUsername(body.username),bio=String(body.bio??"").trim();
      if(bio.length>500)throw new Error("Bio must be 500 characters or fewer.");
      const {data:current,error:currentError}=await db.from("profiles").select("username_normalized").eq("id",caller.id).single();if(currentError)throw currentError;
      if(current.username_normalized!==next.normalized){
        const {data:collision}=await db.from("profiles").select("id").eq("username_normalized",next.normalized).neq("id",caller.id).maybeSingle();if(collision)throw new Error("That username is already in use.");
        const {error:authError}=await db.auth.admin.updateUserById(caller.id,{email:next.email,user_metadata:{...caller.user_metadata,username:next.username,username_normalized:next.normalized}});if(authError)throw authError;
      }
      const titleId=body.active_title_id?String(body.active_title_id):null;
      if(titleId){const {data}=await db.from("player_titles").select("title_id").eq("player_id",caller.id).eq("title_id",titleId).maybeSingle();if(!data)throw new Error("That title is not assigned to your account.");}
      const {error}=await db.from("profiles").update({username:next.username,username_normalized:next.normalized,bio,active_title_id:titleId,updated_at:new Date().toISOString()}).eq("id",caller.id);if(error)throw error;
      return json({ok:true,username:next.username});
    }

    if(action==="set_active_title"){
      const titleId=body.title_id?String(body.title_id):null;
      if(titleId){const {data}=await db.from("player_titles").select("title_id").eq("player_id",caller.id).eq("title_id",titleId).maybeSingle();if(!data)throw new Error("That title is not assigned to your account.");}
      const {error}=await db.from("profiles").update({active_title_id:titleId,updated_at:new Date().toISOString()}).eq("id",caller.id);if(error)throw error;
      return json({ok:true});
    }

    if(action==="update_my_status"){
      const statusText=String(body.status_text??"").trim();
      if(statusText.length>120)throw new Error("Status must be 120 characters or fewer.");
      const {error}=await db.from("profiles").update({status_text:statusText,updated_at:new Date().toISOString()}).eq("id",caller.id);if(error)throw error;
      return json({ok:true,status_text:statusText});
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

    if(action==="admin_create_title"){
      const label=String(body.label??"").trim(),description=String(body.description??"").trim();
      if(label.length<2||label.length>40)throw new Error("Title names must be 2–40 characters.");
      if(description.length>160)throw new Error("Title descriptions must be 160 characters or fewer.");
      const key=label.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
      if(!key)throw new Error("Use at least one letter or number in the title name.");
      if(["admin","tourney_holder"].includes(key))throw new Error("That title name is reserved.");
      const {data:created,error}=await db.from("title_definitions").insert({key,label,description,can_manage_tournaments:false,is_system:false}).select("id,key,label,description").single();if(error){if(error.code==="23505")throw new Error("That title already exists.");throw error;}
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:null,action:"title_created",after_data:created,reason:String(body.reason??"Cosmetic title created")});
      return json({ok:true,title:created});
    }

    if(action==="admin_delete_title"){
      const titleId=String(body.title_id??"");
      if(!titleId)throw new Error("Title ID is required.");
      const {data:title,error:titleError}=await db.from("title_definitions").select("id,key,label,is_system,can_manage_tournaments").eq("id",titleId).single();if(titleError)throw titleError;
      if(title.is_system||title.can_manage_tournaments||["admin","tourney_holder","fisherman","fisherwoman","fish"].includes(title.key))throw new Error("System, starter, and permission titles cannot be deleted.");
      const {count:assignmentCount}=await db.from("player_titles").select("title_id",{count:"exact",head:true}).eq("title_id",titleId);
      const {error:deleteError}=await db.from("title_definitions").delete().eq("id",titleId);if(deleteError)throw deleteError;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:null,action:"title_deleted",before_data:{...title,assignment_count:assignmentCount??0},reason:String(body.reason??"Cosmetic title removed from catalog")});
      return json({ok:true,label:title.label,removed_assignments:assignmentCount??0});
    }

    if(action==="admin_update_home"){
      const headline=String(body.home_headline??"").trim(),copy=String(body.home_copy??"").trim();
      if(headline.length<1||headline.length>100)throw new Error("The home headline must be 1–100 characters.");
      if(copy.length<1||copy.length>300)throw new Error("The home description must be 1–300 characters.");
      const {data:before}=await db.from("league_settings").select("home_headline,home_copy").eq("singleton",true).single();
      const {error}=await db.from("league_settings").update({home_headline:headline,home_copy:copy,updated_at:new Date().toISOString()}).eq("singleton",true);if(error)throw error;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:null,action:"home_content_updated",before_data:before,after_data:{home_headline:headline,home_copy:copy},reason:String(body.reason??"Home page content updated")});
      return json({ok:true,home_headline:headline,home_copy:copy});
    }

    if(action==="admin_publish_launcher"){
      const versionLabel=String(body.version_label??"").trim(),releaseNotes=String(body.release_notes??"").trim(),filePath=String(body.file_path??""),fileName=String(body.file_name??"").trim(),fileSize=Math.max(0,Math.trunc(Number(body.file_size??0)));
      if(versionLabel.length<1||versionLabel.length>40)throw new Error("The launcher version must be 1–40 characters.");
      if(releaseNotes.length>1000)throw new Error("Release notes must be 1,000 characters or fewer.");
      if(!/^releases\/[0-9a-f-]{36}\.zip$/i.test(filePath))throw new Error("The launcher package path is invalid.");
      if(!fileName.toLowerCase().endsWith(".zip"))throw new Error("The launcher package must be a ZIP file.");
      if(fileSize<1||fileSize>262144000)throw new Error("The launcher ZIP must be between 1 byte and 250 MB.");
      const objectName=filePath.slice("releases/".length);
      const {data:objects,error:listError}=await db.storage.from("launcher-releases").list("releases",{search:objectName,limit:10});if(listError)throw listError;
      if(!(objects??[]).some(file=>file.name===objectName))throw new Error("Upload the launcher ZIP before publishing its release details.");
      const next={version_label:versionLabel,file_path:filePath,file_name:fileName,release_notes:releaseNotes,file_size:fileSize,updated_by:caller.id};
      const {data:release,error}=await db.from("launcher_releases").insert(next).select("id,version_label,file_path,file_name,release_notes,file_size,created_at,updated_at").single();if(error)throw error;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:null,action:"launcher_release_published",after_data:release,reason:"Launcher ZIP published through Admin Tools"});
      return json({ok:true,release});
    }

    if(action==="admin_update_launcher_release"){
      const releaseId=String(body.release_id??""),versionLabel=String(body.version_label??"").trim(),releaseNotes=String(body.release_notes??"").trim();
      if(!releaseId)throw new Error("Release ID is required.");
      if(versionLabel.length<1||versionLabel.length>40)throw new Error("The launcher version must be 1–40 characters.");
      if(releaseNotes.length>1000)throw new Error("Release notes must be 1,000 characters or fewer.");
      const {data:before,error:beforeError}=await db.from("launcher_releases").select("*").eq("id",releaseId).single();if(beforeError)throw beforeError;
      const {data:release,error}=await db.from("launcher_releases").update({version_label:versionLabel,release_notes:releaseNotes,updated_by:caller.id,updated_at:new Date().toISOString()}).eq("id",releaseId).select("id,version_label,file_path,file_name,release_notes,file_size,created_at,updated_at").single();if(error)throw error;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:null,action:"launcher_release_updated",before_data:before,after_data:release,reason:"Launcher release post edited through Admin Tools"});
      return json({ok:true,release});
    }

    if(action==="admin_delete_launcher_release"){
      const releaseId=String(body.release_id??"");if(!releaseId)throw new Error("Release ID is required.");
      const {data:release,error:releaseError}=await db.from("launcher_releases").select("*").eq("id",releaseId).single();if(releaseError)throw releaseError;
      const {error:deleteError}=await db.from("launcher_releases").delete().eq("id",releaseId);if(deleteError)throw deleteError;
      const {error:storageError}=await db.storage.from("launcher-releases").remove([release.file_path]);if(storageError)throw storageError;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:null,action:"launcher_release_deleted",before_data:release,reason:"Launcher release deleted through Admin Tools"});
      return json({ok:true,id:releaseId});
    }

    const targetId=String(body.player_id??"");
    if(!targetId)throw new Error("Player ID is required.");

    if(action==="admin_reset_password"){
      const {error:authError}=await db.auth.admin.updateUserById(targetId,{password:"Fish420"});if(authError)throw authError;
      const {error}=await db.from("profiles").update({must_change_password:true,updated_at:new Date().toISOString()}).eq("id",targetId);if(error)throw error;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:targetId,action:"password_reset",after_data:{temporary_password:true},reason:String(body.reason??"Forgotten password reset")});
      return json({ok:true,temporary_password:"Fish420"});
    }

    if(action==="admin_wipe_player_data"){
      const reason=String(body.reason??"").trim();
      if(reason.length<3)throw new Error("Enter a reason of at least 3 characters.");
      const [{data:profile,error:profileError},{data:stats},{data:rewards}]=await Promise.all([
        db.from("profiles").select("username").eq("id",targetId).single(),
        db.from("player_stats").select("cash,xp,fish_caught,shiny_fish_caught,quests_completed,fish_sold,money_earned,money_spent,orbs_clicked,consumables_used,playtime_seconds").eq("player_id",targetId).maybeSingle(),
        db.from("profile_rewards").select("daily_medals,tournament_trophies").eq("player_id",targetId).maybeSingle(),
      ]);if(profileError)throw profileError;
      const {data:result,error:wipeError}=await db.rpc("wipe_player_competitive_data_internal",{p_player_id:targetId});if(wipeError)throw wipeError;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:targetId,action:"player_competitive_data_wiped",before_data:{username:profile.username,stats,rewards},after_data:{stats_reset:true,rewards_reset:true,...(result??{})},reason});
      return json({ok:true,username:profile.username,...(result??{})});
    }

    if(action==="admin_delete_user"){
      if(targetId===caller.id)throw new Error("You cannot delete your own account.");
      const {data:targetAdmin}=await db.from("league_admins").select("user_id").eq("user_id",targetId).maybeSingle();
      if(targetAdmin)throw new Error("Administrator accounts cannot be deleted here.");
      const {data:before,error:beforeError}=await db.from("profiles").select("username").eq("id",targetId).single();if(beforeError)throw beforeError;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:null,action:"account_deleted",before_data:{player_id:targetId,username:before.username},reason:String(body.reason??"Account deleted by administrator")});
      const {data:files}=await db.storage.from("profile-images").list(targetId);
      if(files?.length)await db.storage.from("profile-images").remove(files.map(file=>`${targetId}/${file.name}`));
      const {error:deleteError}=await db.auth.admin.deleteUser(targetId);if(deleteError)throw deleteError;
      return json({ok:true,username:before.username});
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
      const {data:before,error:beforeError}=await db.from("profiles").select("username,username_normalized,bio,status_text").eq("id",targetId).single();if(beforeError)throw beforeError;
      const {data:beforeReward}=await db.from("profile_rewards").select("daily_medals,tournament_trophies").eq("player_id",targetId).maybeSingle();
      const {data:collision}=await db.from("profiles").select("id").eq("username_normalized",next.normalized).neq("id",targetId).maybeSingle();if(collision)throw new Error("That username is already in use.");
      if(before.username_normalized!==next.normalized){const {data:targetUser,error:targetError}=await db.auth.admin.getUserById(targetId);if(targetError)throw targetError;const {error:authError}=await db.auth.admin.updateUserById(targetId,{email:next.email,user_metadata:{...targetUser.user.user_metadata,username:next.username,username_normalized:next.normalized}});if(authError)throw authError;}
      const {error:profileError}=await db.from("profiles").update({username:next.username,username_normalized:next.normalized,bio,status_text:statusText,updated_at:new Date().toISOString()}).eq("id",targetId);if(profileError)throw profileError;
      const {error:rewardError}=await db.from("profile_rewards").upsert({player_id:targetId,daily_medals:medals,tournament_trophies:trophies,updated_at:new Date().toISOString()});if(rewardError)throw rewardError;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:targetId,action:"profile_update",before_data:{...before,...(beforeReward??{})},after_data:{username:next.username,bio,status_text:statusText,daily_medals:medals,tournament_trophies:trophies},reason});
      return json({ok:true});
    }
    return json({error:"Unknown action."},400);
  }catch(error){return json({error:error instanceof Error?error.message:"Request failed."},400)}
});
