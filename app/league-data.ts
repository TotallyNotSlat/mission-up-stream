import { supabase } from "./supabase";

export type LivePlayer = {
  id: string; name: string; initials: string; bio: string; status: string;
  presence: "online" | "idle" | "offline";
  cash: number; fish: number; shinies: number; quests: number; xp: number;
  medals: number; trophies: number; favorite: string; playtime: string; avatarUrl: string | null;
};

const number = (value: unknown) => Number(value ?? 0);
const playtime = (seconds: unknown) => { const mins=Math.max(0,Math.floor(number(seconds)/60)); return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,"0")}m`; };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase() || "?";

export async function fetchLeaguePlayers(): Promise<LivePlayer[]> {
  type Profile={id:string;username:string;bio:string;status_text:string;presence:LivePlayer["presence"];avatar_path:string|null};
  type Stats={player_id:string;cash:number;xp:number;fish_caught:number;shiny_fish_caught:number;quests_completed:number;playtime_seconds:number};
  type Rewards={player_id:string;daily_medals:number;tournament_trophies:number};
  const [profilesResult,statsResult,rewardsResult]=await Promise.all([
    supabase.from("profiles").select("id,username,bio,status_text,presence,avatar_path").order("username"),
    supabase.from("player_stats").select("player_id,cash,xp,fish_caught,shiny_fish_caught,quests_completed,playtime_seconds"),
    supabase.from("profile_rewards").select("player_id,daily_medals,tournament_trophies"),
  ]);
  const error=profilesResult.error??statsResult.error??rewardsResult.error;
  if(error) throw new Error(`League data request failed: ${error.message}`);
  const profiles=(profilesResult.data??[]) as Profile[];
  const stats=(statsResult.data??[]) as Stats[];
  const rewards=(rewardsResult.data??[]) as Rewards[];
  const statsById=new Map(stats.map(row=>[row.player_id,row]));
  const rewardsById=new Map(rewards.map(row=>[row.player_id,row]));
  return Promise.all(profiles.map(async profile=>{const stat=statsById.get(profile.id);const reward=rewardsById.get(profile.id);let avatarUrl:string|null=null;if(profile.avatar_path){const {data}=await supabase.storage.from("profile-images").createSignedUrl(profile.avatar_path,3600);avatarUrl=data?.signedUrl??null}return {
    id:profile.id,name:profile.username,initials:initials(profile.username),bio:profile.bio||"No bio yet.",status:profile.status_text||"No current status.",presence:profile.presence??"offline",
    cash:number(stat?.cash),fish:number(stat?.fish_caught),shinies:number(stat?.shiny_fish_caught),quests:number(stat?.quests_completed),xp:number(stat?.xp),
    medals:number(reward?.daily_medals),trophies:number(reward?.tournament_trophies),favorite:"Not set",playtime:playtime(stat?.playtime_seconds),avatarUrl,
  }}));
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
