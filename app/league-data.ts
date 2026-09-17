import { supabase } from "./supabase";

export type LivePlayer = {
  id: string; name: string; initials: string; bio: string; status: string;
  presence: "online" | "idle" | "offline";
  cash: number; fish: number; shinies: number; quests: number; xp: number;
  medals: number; trophies: number; favorite: string; playtime: string; avatarUrl: string | null;
  joinedAt: string; lastLoginAt: string | null; activeTitleId: string | null; activeTitle: string | null; titleIds: string[];
};

export type LeagueTitle = { id:string; key:string; label:string; description:string; canManageTournaments:boolean; isSystem:boolean };
export type DailyChallenge = { date:string; categoryKey:string; label:string; scores:{playerId:string;score:number}[] };
export type HomeContent = { headline:string; copy:string };

const number = (value: unknown) => Number(value ?? 0);
const playtime = (seconds: unknown) => { const mins=Math.max(0,Math.floor(number(seconds)/60)); return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,"0")}m`; };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase() || "?";

export async function fetchLeaguePlayers(): Promise<LivePlayer[]> {
  type Profile={id:string;username:string;bio:string;status_text:string;presence:LivePlayer["presence"];avatar_path:string|null;created_at:string;last_login_at:string|null;active_title_id:string|null};
  type Stats={player_id:string;cash:number;xp:number;fish_caught:number;shiny_fish_caught:number;quests_completed:number;playtime_seconds:number};
  type Rewards={player_id:string;daily_medals:number;tournament_trophies:number};
  type Title={id:string;label:string}; type PlayerTitle={player_id:string;title_id:string};
  const [profilesResult,statsResult,rewardsResult,titlesResult,playerTitlesResult]=await Promise.all([
    supabase.from("profiles").select("id,username,bio,status_text,presence,avatar_path,created_at,last_login_at,active_title_id").order("username"),
    supabase.from("player_stats").select("player_id,cash,xp,fish_caught,shiny_fish_caught,quests_completed,playtime_seconds"),
    supabase.from("profile_rewards").select("player_id,daily_medals,tournament_trophies"),
    supabase.from("title_definitions").select("id,label"),
    supabase.from("player_titles").select("player_id,title_id"),
  ]);
  const error=profilesResult.error??statsResult.error??rewardsResult.error??titlesResult.error??playerTitlesResult.error;
  if(error) throw new Error(`League data request failed: ${error.message}`);
  const profiles=(profilesResult.data??[]) as Profile[];
  const stats=(statsResult.data??[]) as Stats[];
  const rewards=(rewardsResult.data??[]) as Rewards[];
  const titles=(titlesResult.data??[]) as Title[];const playerTitles=(playerTitlesResult.data??[]) as PlayerTitle[];
  const statsById=new Map(stats.map(row=>[row.player_id,row]));
  const rewardsById=new Map(rewards.map(row=>[row.player_id,row]));
  const titleById=new Map(titles.map(row=>[row.id,row.label]));
  const titleIdsByPlayer=new Map<string,string[]>();playerTitles.forEach(row=>titleIdsByPlayer.set(row.player_id,[...(titleIdsByPlayer.get(row.player_id)??[]),row.title_id]));
  return Promise.all(profiles.map(async profile=>{const stat=statsById.get(profile.id);const reward=rewardsById.get(profile.id);let avatarUrl:string|null=null;if(profile.avatar_path){const {data}=await supabase.storage.from("profile-images").createSignedUrl(profile.avatar_path,3600);avatarUrl=data?.signedUrl??null}return {
    id:profile.id,name:profile.username,initials:initials(profile.username),bio:profile.bio||"No bio yet.",status:profile.status_text||"No current status.",presence:profile.presence??"offline",
    cash:number(stat?.cash),fish:number(stat?.fish_caught),shinies:number(stat?.shiny_fish_caught),quests:number(stat?.quests_completed),xp:number(stat?.xp),
    medals:number(reward?.daily_medals),trophies:number(reward?.tournament_trophies),favorite:"Not set",playtime:playtime(stat?.playtime_seconds),avatarUrl,
    joinedAt:profile.created_at,lastLoginAt:profile.last_login_at,activeTitleId:profile.active_title_id,activeTitle:profile.active_title_id?titleById.get(profile.active_title_id)??null:null,titleIds:titleIdsByPlayer.get(profile.id)??[],
  }}));
}

export async function fetchLeagueTitles():Promise<LeagueTitle[]>{
  const {data,error}=await supabase.from("title_definitions").select("id,key,label,description,can_manage_tournaments,is_system").order("label");
  if(error)throw new Error(error.message);
  return (data??[]).map(row=>({id:row.id,key:row.key,label:row.label,description:row.description,canManageTournaments:Boolean(row.can_manage_tournaments),isSystem:Boolean(row.is_system)}));
}

export async function fetchHomeContent():Promise<HomeContent>{
  const {data,error}=await supabase.from("league_settings").select("home_headline,home_copy").eq("singleton",true).single();
  if(error)throw new Error(error.message);
  return {headline:data.home_headline,copy:data.home_copy};
}

function easternDateKey(){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const value=(type:string)=>parts.find(part=>part.type===type)?.value??"";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function fetchTodayDailyChallenge():Promise<DailyChallenge|null>{
  const date=easternDateKey();
  const {data:challenge,error:challengeError}=await supabase.from("daily_challenges").select("challenge_date,category_key").eq("challenge_date",date).maybeSingle();
  if(challengeError)throw new Error(challengeError.message);
  if(!challenge)return null;
  const [categoryResult,scoresResult]=await Promise.all([
    supabase.from("daily_categories").select("label").eq("key",challenge.category_key).maybeSingle(),
    supabase.from("daily_scores").select("player_id,score").eq("challenge_date",date).gt("score",0).order("score",{ascending:false}),
  ]);
  const error=categoryResult.error??scoresResult.error;
  if(error)throw new Error(error.message);
  return {date,categoryKey:challenge.category_key,label:categoryResult.data?.label??challenge.category_key,scores:(scoresResult.data??[]).map(row=>({playerId:row.player_id,score:Number(row.score??0)}))};
}

export async function fetchIsLeagueAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("league_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Admin access check failed: ${error.message}`);
  return Boolean(data);
}
