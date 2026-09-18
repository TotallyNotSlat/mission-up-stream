import { supabase } from "./supabase";

export type TournamentMetric="xp"|"fish_caught"|"shiny_fish_caught"|"quests_completed"|"fish_sold"|"money_earned"|"orbs_clicked"|"consumables_used";
export type TournamentEntry={playerId:string;state:"rsvp"|"competing"|"retired";score:number;joinedAt:string};
export type Tournament={id:string;name:string;description:string;metric:TournamentMetric;startsAt:string;endsAt:string;timezone:string;createdBy:string|null;entries:TournamentEntry[]};
export const tournamentMetrics:{key:TournamentMetric;label:string}[]=[
  {key:"fish_caught",label:"Total fish caught"},{key:"shiny_fish_caught",label:"Shiny fish caught"},{key:"quests_completed",label:"Quests completed"},{key:"xp",label:"Player XP"},{key:"fish_sold",label:"Fish sold"},{key:"money_earned",label:"Money earned"},{key:"orbs_clicked",label:"Orbs clicked"},{key:"consumables_used",label:"Consumables used"},
];

export async function fetchTournaments():Promise<Tournament[]>{
  const [tourneys,entries]=await Promise.all([
    supabase.from("tournaments").select("id,name,description,metric,starts_at,ends_at,timezone,created_by").order("starts_at"),
    supabase.from("tournament_entries").select("tournament_id,player_id,state,score_value,joined_at"),
  ]);
  const error=tourneys.error??entries.error;if(error)throw new Error(error.message);
  const byTournament=new Map<string,TournamentEntry[]>();(entries.data??[]).forEach(row=>byTournament.set(row.tournament_id,[...(byTournament.get(row.tournament_id)??[]),{playerId:row.player_id,state:row.state as TournamentEntry["state"],score:Number(row.score_value??0),joinedAt:row.joined_at}]));
  return (tourneys.data??[]).map(row=>({id:row.id,name:row.name,description:row.description??"",metric:row.metric as TournamentMetric,startsAt:row.starts_at,endsAt:row.ends_at,timezone:row.timezone,createdBy:row.created_by,entries:byTournament.get(row.id)??[]}));
}

export async function callTournamentAction(body:Record<string,unknown>){
  const {data,error}=await supabase.functions.invoke("league-tournaments",{body});if(error)throw new Error(error.message);if(data?.error)throw new Error(String(data.error));return data;
}
