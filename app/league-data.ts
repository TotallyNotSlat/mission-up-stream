export type LivePlayer = {
  id: string; name: string; initials: string; bio: string; status: string;
  presence: "online" | "idle" | "offline";
  cash: number; fish: number; shinies: number; quests: number; xp: number;
  medals: number; trophies: number; favorite: string; playtime: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ytwfioxletcobzwiqdls.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_E3Dc83ue1idv888GncbwNA_vUXuBsLC";

async function table<T>(path: string): Promise<T[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY }, cache: "no-store",
  });
  if (!response.ok) throw new Error(`League data request failed (${response.status}).`);
  return response.json() as Promise<T[]>;
}

const number = (value: unknown) => Number(value ?? 0);
const playtime = (seconds: unknown) => { const mins=Math.max(0,Math.floor(number(seconds)/60)); return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,"0")}m`; };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase() || "?";

export async function fetchLeaguePlayers(): Promise<LivePlayer[]> {
  type Profile={id:string;username:string;bio:string;status_text:string;presence:LivePlayer["presence"]};
  type Stats={player_id:string;cash:number;xp:number;fish_caught:number;shiny_fish_caught:number;quests_completed:number;playtime_seconds:number};
  type Rewards={player_id:string;daily_medals:number;tournament_trophies:number};
  const [profiles,stats,rewards]=await Promise.all([
    table<Profile>("profiles?select=id,username,bio,status_text,presence&order=username.asc"),
    table<Stats>("player_stats?select=player_id,cash,xp,fish_caught,shiny_fish_caught,quests_completed,playtime_seconds"),
    table<Rewards>("profile_rewards?select=player_id,daily_medals,tournament_trophies"),
  ]);
  const statsById=new Map(stats.map(row=>[row.player_id,row]));
  const rewardsById=new Map(rewards.map(row=>[row.player_id,row]));
  return profiles.map(profile=>{const stat=statsById.get(profile.id);const reward=rewardsById.get(profile.id);return {
    id:profile.id,name:profile.username,initials:initials(profile.username),bio:profile.bio||"No bio yet.",status:profile.status_text||"No current status.",presence:profile.presence??"offline",
    cash:number(stat?.cash),fish:number(stat?.fish_caught),shinies:number(stat?.shiny_fish_caught),quests:number(stat?.quests_completed),xp:number(stat?.xp),
    medals:number(reward?.daily_medals),trophies:number(reward?.tournament_trophies),favorite:"Not set",playtime:playtime(stat?.playtime_seconds),
  }});
}
