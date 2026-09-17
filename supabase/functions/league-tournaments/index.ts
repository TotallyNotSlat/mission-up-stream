import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const metrics=new Set(["xp","fish_caught","shiny_fish_caught","quests_completed","fish_sold","money_earned","orbs_clicked","consumables_used"]);
const statValue=(row:Record<string,unknown>|null,metric:string)=>Math.max(0,Math.trunc(Number(row?.[metric]??0)));

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);
  try{
    const authorization=req.headers.get("Authorization");
    if(!authorization?.startsWith("Bearer "))return json({error:"Please sign in."},401);
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await db.auth.getUser(authorization.slice(7));
    const caller=userData.user;if(userError||!caller)return json({error:"Your session is invalid or expired."},401);
    const body=await req.json(),action=String(body.action??"");

    const requireTournamentManager=async()=>{
      const [{data:adminRow},{data:titleRow}]=await Promise.all([
        db.from("league_admins").select("user_id").eq("user_id",caller.id).maybeSingle(),
        db.from("player_titles").select("title_definitions!inner(can_manage_tournaments)").eq("player_id",caller.id).eq("title_definitions.can_manage_tournaments",true).limit(1).maybeSingle(),
      ]);
      if(!adminRow&&!titleRow)throw new Error("Tournament Tools access is required.");
    };

    const parseTournamentInput=()=>{
      const name=String(body.name??"").trim(),description=String(body.description??"").trim(),metric=String(body.metric??""),startsAt=new Date(String(body.starts_at??"")),endsAt=new Date(String(body.ends_at??""));
      if(name.length<3||name.length>80)throw new Error("Tournament name must be 3–80 characters.");
      if(description.length>500)throw new Error("Description must be 500 characters or fewer.");
      if(!metrics.has(metric))throw new Error("Choose a valid tournament metric.");
      if(Number.isNaN(startsAt.valueOf())||Number.isNaN(endsAt.valueOf())||endsAt<=startsAt)throw new Error("The tournament end must be after its start.");
      return {name,description,metric,starts_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),timezone:String(body.timezone??"America/New_York")};
    };

    if(action==="schedule_tournament"){
      await requireTournamentManager();
      const input=parseTournamentInput();
      const {data,error}=await db.from("tournaments").insert({...input,status:"scheduled",created_by:caller.id}).select("id").single();if(error)throw error;
      return json({ok:true,tournament_id:data.id});
    }

    if(action==="update_tournament"){
      await requireTournamentManager();
      const tournamentId=String(body.tournament_id??"");if(!tournamentId)throw new Error("Tournament ID is required.");
      const {data:before,error:beforeError}=await db.from("tournaments").select("id,name,description,metric,starts_at,ends_at,timezone").eq("id",tournamentId).single();if(beforeError)throw beforeError;
      const input=parseTournamentInput();
      const {count:activeEntries,error:entryError}=await db.from("tournament_entries").select("player_id",{count:"exact",head:true}).eq("tournament_id",tournamentId).in("state",["competing","retired"]);if(entryError)throw entryError;
      if((activeEntries??0)>0&&(input.metric!==before.metric||input.starts_at!==new Date(before.starts_at).toISOString()))throw new Error("The metric and start time cannot change after a player has begun competing.");
      const {error}=await db.from("tournaments").update(input).eq("id",tournamentId);if(error)throw error;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:null,action:"tournament_updated",before_data:before,after_data:{id:tournamentId,...input},reason:"Tournament edited through Tournament Tools"});
      return json({ok:true,tournament_id:tournamentId});
    }

    if(action==="delete_tournament"){
      await requireTournamentManager();
      const tournamentId=String(body.tournament_id??"");if(!tournamentId)throw new Error("Tournament ID is required.");
      const {data:before,error:beforeError}=await db.from("tournaments").select("id,name,description,metric,starts_at,ends_at,timezone").eq("id",tournamentId).single();if(beforeError)throw beforeError;
      const [{count:entryCount},{count:awardCount}]=await Promise.all([
        db.from("tournament_entries").select("player_id",{count:"exact",head:true}).eq("tournament_id",tournamentId),
        db.from("trophies").select("id",{count:"exact",head:true}).eq("tournament_id",tournamentId),
      ]);
      const {error}=await db.from("tournaments").delete().eq("id",tournamentId);if(error)throw error;
      await db.from("admin_audit").insert({admin_user_id:caller.id,player_id:null,action:"tournament_deleted",before_data:{...before,entry_count:entryCount??0,award_count:awardCount??0},reason:"Tournament deleted through Tournament Tools"});
      return json({ok:true,tournament_id:tournamentId,name:before.name});
    }

    const tournamentId=String(body.tournament_id??"");if(!tournamentId)throw new Error("Tournament ID is required.");
    const {data:tournament,error:tournamentError}=await db.from("tournaments").select("id,metric,starts_at,ends_at").eq("id",tournamentId).single();if(tournamentError)throw tournamentError;
    const now=new Date(),startsAt=new Date(tournament.starts_at),endsAt=new Date(tournament.ends_at);
    const {data:entry}=await db.from("tournament_entries").select("state,baseline_value").eq("tournament_id",tournamentId).eq("player_id",caller.id).maybeSingle();

    if(action==="rsvp"){
      if(now>=startsAt)throw new Error("RSVPs close when the tournament begins.");
      if(entry?.state==="retired")throw new Error("Retired players cannot rejoin this tournament.");
      const {error}=await db.from("tournament_entries").upsert({tournament_id:tournamentId,player_id:caller.id,state:"rsvp",baseline_value:null,score_value:0,retired_at:null,updated_at:now.toISOString()});if(error)throw error;
      return json({ok:true,state:"rsvp"});
    }
    if(action==="withdraw"){
      if(now>=startsAt)throw new Error("Use Retire after the tournament begins.");
      if(entry?.state!=="rsvp")throw new Error("You do not have an active RSVP.");
      const {error}=await db.from("tournament_entries").delete().eq("tournament_id",tournamentId).eq("player_id",caller.id);if(error)throw error;
      return json({ok:true,state:null});
    }
    if(action==="compete"){
      if(now<startsAt||now>=endsAt)throw new Error("You can compete only while the tournament is live.");
      if(entry?.state==="retired")throw new Error("Retired players cannot rejoin this tournament.");
      const {data:stats,error:statsError}=await db.from("player_stats").select("xp,fish_caught,shiny_fish_caught,quests_completed,fish_sold,money_earned,orbs_clicked,consumables_used").eq("player_id",caller.id).single();if(statsError)throw statsError;
      const baseline=statValue(stats,tournament.metric);
      const {error}=await db.from("tournament_entries").upsert({tournament_id:tournamentId,player_id:caller.id,state:"competing",baseline_value:baseline,score_value:0,joined_at:now.toISOString(),retired_at:null,updated_at:now.toISOString()});if(error)throw error;
      return json({ok:true,state:"competing"});
    }
    if(action==="retire"){
      if(now<startsAt||now>=endsAt)throw new Error("Retirement is available only while the tournament is live.");
      if(entry?.state!=="competing")throw new Error("Only competing players can retire.");
      const {data:stats,error:statsError}=await db.from("player_stats").select("xp,fish_caught,shiny_fish_caught,quests_completed,fish_sold,money_earned,orbs_clicked,consumables_used").eq("player_id",caller.id).single();if(statsError)throw statsError;
      const score=Math.max(statValue(stats,tournament.metric)-Number(entry.baseline_value??0),0);
      const {error}=await db.from("tournament_entries").update({state:"retired",score_value:score,retired_at:now.toISOString(),updated_at:now.toISOString()}).eq("tournament_id",tournamentId).eq("player_id",caller.id);if(error)throw error;
      return json({ok:true,state:"retired",score});
    }
    return json({error:"Unknown action."},400);
  }catch(error){return json({error:error instanceof Error?error.message:"Request failed."},400)}
});
