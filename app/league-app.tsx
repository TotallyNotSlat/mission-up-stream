"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Clock3, Crown, Fish, Gauge, LogOut, Medal, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Target, Trophy, Users, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast, Toaster } from "sonner";
import { fetchIsLeagueAdmin, fetchLeaguePlayers } from "./league-data";
import { supabase, usernameToAuthEmail } from "./supabase";

type Presence = "online" | "idle" | "offline";
type StatKey = "cash" | "fish" | "shinies" | "quests" | "xp";
type Player = { id:string; name:string; initials:string; bio:string; status:string; presence:Presence; cash:number; fish:number; shinies:number; quests:number; xp:number; medals:number; trophies:number; favorite:string; playtime:string };

const stats:{key:StatKey;label:string;short:string}[] = [
  {key:"fish",label:"Total fish caught",short:"fish"},{key:"cash",label:"Current cash",short:"cash"},{key:"xp",label:"Player XP",short:"XP"},{key:"shinies",label:"Shiny fish caught",short:"shinies"},{key:"quests",label:"Quests completed",short:"quests"},
];
const dots:Record<Presence,string>={online:"bg-emerald-400",idle:"bg-amber-400",offline:"bg-slate-500"};
const format=(n:number)=>new Intl.NumberFormat("en-US").format(n);

function Logo(){return <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-[14px] bg-cyan-300 text-slate-950"><Fish/></span><div><p className="font-display text-lg font-extrabold leading-none">Mission Up</p><p className="text-[11px] font-bold uppercase tracking-[.2em] text-cyan-300">Stream</p></div></div>}
function PlayerRow({p,rank,metric="fish",open}:{p:Player;rank:number;metric?:StatKey;open:()=>void}){return <button onClick={open} className="group grid w-full grid-cols-[34px_44px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition hover:border-slate-700 hover:bg-slate-800/70"><b className={rank<4?"text-amber-300":"text-slate-500"}>#{rank}</b><span className="relative grid size-11 place-items-center rounded-full bg-cyan-300/10 font-bold text-cyan-100">{p.initials}<i className={"absolute bottom-0 right-0 size-3 rounded-full border-2 border-slate-900 "+dots[p.presence]}/></span><span className="min-w-0"><strong className="block truncate group-hover:text-cyan-200">{p.name}</strong><small className="block truncate text-slate-500">{p.status}</small></span><span className="text-right"><strong className="block font-display">{format(p[metric])}</strong><small className="uppercase text-slate-500">{stats.find(s=>s.key===metric)?.short}</small></span></button>}
function Heading({eyebrow,title,copy}:{eyebrow:string;title:string;copy?:string}){return <div><p className="eyebrow">{eyebrow}</p><h1 className="page-title">{title}</h1>{copy&&<p className="mt-2 text-slate-400">{copy}</p>}</div>}

function LoginScreen(){
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    setError("");
    setBusy(true);
    try{
      const email=usernameToAuthEmail(username);
      const {error:authError}=await supabase.auth.signInWithPassword({email,password});
      if(authError) throw authError;
    }catch(reason){
      const message=reason instanceof Error?reason.message:"Could not sign in.";
      setError(message.toLowerCase().includes("invalid login credentials")?"The username or password is incorrect.":message);
    }finally{setBusy(false)}
  }
  return <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#07121d] px-4 text-slate-100"><div className="pond-glow pointer-events-none fixed inset-0"/><main className="pond-card relative z-10 w-full max-w-md p-7 sm:p-9"><div className="mb-8"><Logo/></div><p className="eyebrow">Members only</p><h1 className="mt-2 font-display text-3xl font-black">Sign in to the league</h1><p className="mt-2 text-sm leading-relaxed text-slate-400">Use the same Mission Up Stream username and password you registered through the launcher.</p><form onSubmit={submit} className="mt-7 space-y-5"><label className="field-label">Username<Input autoFocus autoComplete="username" required value={username} onChange={event=>setUsername(event.target.value)} className="mt-2 border-slate-700 bg-slate-900"/></label><label className="field-label">Password<Input type="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)} className="mt-2 border-slate-700 bg-slate-900"/></label>{error&&<p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}<Button type="submit" disabled={busy} className="w-full bg-cyan-300 font-bold text-slate-950 hover:bg-cyan-200">{busy?"Signing in…":"Log In"}</Button></form></main></div>
}

export default function LeagueApp(){
  const [authLoading,setAuthLoading]=useState(true);
  const [userId,setUserId]=useState<string|null>(null);
  const [isAdmin,setIsAdmin]=useState(false);
  const [section,setSection]=useState("home");
  const [metric,setMetric]=useState<StatKey>("fish");
  const [players,setPlayers]=useState<Player[]>([]);
  const [selected,setSelected]=useState<Player|null>(null);
  const [search,setSearch]=useState("");
  const [categories,setCategories]=useState([{key:"fish",label:"Fish caught",enabled:true},{key:"shinies",label:"Shiny fish caught",enabled:true},{key:"cash",label:"Cash earned",enabled:true},{key:"quests",label:"Quests completed",enabled:true},{key:"orbs",label:"Orbs clicked",enabled:true},{key:"sold",label:"Fish sold",enabled:false}]);
  const [day,setDay]=useState<Date|undefined>(new Date(2026,8,18));
  const [category,setCategory]=useState("quests");
  const [schedule,setSchedule]=useState([{date:"Sep 18",category:"Quests completed"},{date:"Sep 20",category:"Shiny fish caught"}]);
  const [editing,setEditing]=useState<Player|null>(null);
  const [form,setForm]=useState({name:"",bio:"",medals:0,trophies:0,reason:""});
  const ranking=useMemo(()=>[...players].sort((a,b)=>b[metric]-a[metric]),[players,metric]);
  const visible=players.filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));
  const dailyScores=players.slice().sort((a,b)=>b.fish-a.fish).slice(0,4).map(p=>({player:p.name,initials:p.initials,score:p.fish,state:p.presence}));
  const onlineCount=players.filter(p=>p.presence==="online").length;
  const idleCount=players.filter(p=>p.presence==="idle").length;
  const totalMedals=players.reduce((sum,p)=>sum+p.medals,0);
  const totalShinies=players.reduce((sum,p)=>sum+p.shinies,0);
  const nav=[["home","League home",Waves],["leaderboards","Leaderboards",Gauge],["daily","Daily challenge",Target],["tournaments","Tournaments",Trophy],["players","Players",Users],...(isAdmin?[["admin","Admin portal",Settings2] as const]:[])] as const;
  function edit(p:Player){setEditing(p);setForm({name:p.name,bio:p.bio,medals:p.medals,trophies:p.trophies,reason:""})}
  function save(){if(!editing||!form.reason.trim()){toast.error("Add a reason for this correction.");return}setPlayers(ps=>ps.map(p=>p.id===editing.id?{...p,name:form.name,bio:form.bio,medals:form.medals,trophies:form.trophies}:p));setEditing(null);toast.success("Profile updated and logged.")}
  function addSchedule(){const c=categories.find(x=>x.key===category);if(!day||!c)return;const label=day.toLocaleDateString("en-US",{month:"short",day:"numeric"});setSchedule(s=>[...s.filter(x=>x.date!==label),{date:label,category:c.label}]);toast.success("Daily challenge scheduled.")}
  function randomPreview(){const used=new Set(["Fish caught","Cash earned","Quests completed"]);const eligible=categories.filter(c=>c.enabled&&!used.has(c.label));const pick=eligible[Math.floor(Math.random()*Math.max(1,eligible.length))];toast.success(pick?"Next eligible draw: "+pick.label:"Enable another unused category first.")}
  useEffect(()=>{
    let active=true;
    void supabase.auth.getSession().then(({data})=>{if(active){const id=data.session?.user.id??null;setUserId(id);if(!id){setIsAdmin(false);setPlayers([]);setSection("home")}setAuthLoading(false)}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{if(active){const id=session?.user.id??null;setUserId(id);if(!id){setIsAdmin(false);setPlayers([]);setSection("home")}setAuthLoading(false)}});
    return()=>{active=false;subscription.unsubscribe()};
  },[]);
  useEffect(()=>{
    if(!userId)return;
    let active=true;
    void fetchIsLeagueAdmin(userId).then(value=>{if(active)setIsAdmin(value)}).catch(()=>{if(active)setIsAdmin(false)});
    return()=>{active=false};
  },[userId]);
  useEffect(()=>{
    if(!userId)return;
    let active=true;
    const refresh=()=>fetchLeaguePlayers().then(data=>{if(active)setPlayers(data)}).catch(error=>toast.error(error instanceof Error?error.message:"Could not refresh league data."));
    void refresh();
    const timer=window.setInterval(refresh,15000);
    return()=>{active=false;window.clearInterval(timer)};
  },[userId]);
  useEffect(()=>{
    const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options?:unknown)=>unknown}}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    void Promise.resolve(context.registerTool({
      name:"read_daily_challenge",
      title:"Read daily challenge",
      description:"Read today's Mission Up Stream challenge and current leader.",
      inputSchema:{type:"object",properties:{},additionalProperties:false},
      annotations:{readOnlyHint:true,untrustedContentHint:false},
      execute:()=>({challenge:"Fish caught today",source:"Live league data"}),
    },{signal:lifecycle.signal})).catch(()=>{});
    return()=>lifecycle.abort();
  },[]);

  if(authLoading)return <div className="grid min-h-screen place-items-center bg-[#07121d] text-cyan-200">Checking your session…</div>;
  if(!userId)return <><Toaster theme="dark" richColors position="bottom-right"/><LoginScreen/></>;

  return <div className="min-h-screen bg-[#07121d] text-slate-100"><Toaster theme="dark" richColors position="bottom-right"/><div className="pond-glow pointer-events-none fixed inset-0"/>
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#081522]/90 backdrop-blur-xl"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-3 md:px-7"><Logo/><div className="flex items-center gap-3"><span className="hidden items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-sm md:flex"><i className="size-2.5 rounded-full bg-emerald-400"/>{onlineCount} playing now</span>{isAdmin&&<Button size="sm" onClick={()=>setSection("admin")} className="bg-cyan-300 font-bold text-slate-950 hover:bg-cyan-200"><ShieldCheck/>Admin</Button>}<Button size="sm" variant="outline" onClick={()=>void supabase.auth.signOut()} className="border-slate-700 bg-slate-900"><LogOut/>Log out</Button></div></div></header>
    <div className="mx-auto grid max-w-[1500px] md:grid-cols-[220px_minmax(0,1fr)]"><aside className="border-b border-slate-800 bg-[#091725]/70 p-3 md:sticky md:top-[65px] md:h-[calc(100vh-65px)] md:border-b-0 md:border-r md:p-5"><nav className="flex gap-2 overflow-x-auto md:flex-col">{nav.map(([key,label,Icon])=><button key={key} onClick={()=>setSection(key)} className={"nav-pill "+(section===key?"nav-pill-active":"")}><Icon className="size-4"/>{label}{key==="daily"&&<i className="ml-auto hidden size-2 rounded-full bg-cyan-300 md:block"/>}</button>)}</nav><div className="absolute bottom-5 left-5 right-5 hidden rounded-2xl border border-cyan-300/15 bg-cyan-300/[.05] p-4 md:block"><p className="eyebrow">League clock</p><p className="mt-2 font-display text-xl font-extrabold">4h 12m</p><p className="text-xs text-slate-500">until today’s scores lock</p></div></aside>
      <main className="relative min-w-0 p-4 md:p-7 lg:p-9">
        {section==="home"&&<div className="space-y-7"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><Heading eyebrow={new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})} title="The stream is lively today." copy="Track the rivalry, chase today’s challenge, and inspect every suspiciously impressive catch."/><Button onClick={()=>setSection("daily")} variant="outline" className="border-slate-700 bg-slate-900">View today’s challenge <ChevronRight/></Button></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["League players",String(players.length),`${onlineCount} online · ${idleCount} idle`,Users],["Total fish caught",format(players.reduce((sum,p)=>sum+p.fish,0)),"Live player totals",Fish],["Shinies found",format(totalShinies),"Across all players",Sparkles],["Medals awarded",format(totalMedals),"Daily challenge wins",Medal]].map(([label,value,detail,Icon])=><div className="pond-card p-5" key={label as string}><div className="mb-5 flex justify-between"><span className="text-sm font-semibold text-slate-400">{label as string}</span><Icon className="size-5 text-cyan-300"/></div><p className="font-display text-3xl font-black">{value as string}</p><p className="text-sm text-slate-500">{detail as string}</p></div>)}</div><div className="grid gap-6 xl:grid-cols-[1.4fr_.8fr]"><section className="pond-card p-5 md:p-6"><p className="eyebrow">Live standings</p><h2 className="section-title">Top anglers</h2><div className="mt-4">{ranking.map((p,i)=><PlayerRow key={p.id} p={p} rank={i+1} open={()=>setSelected(p)}/>)}</div></section><section className="daily-card p-6"><div className="flex justify-between"><b className="rounded-full bg-cyan-300 px-3 py-1 text-xs uppercase text-slate-950">Today</b></div><Target className="mb-4 mt-10 size-10 text-cyan-200"/><p className="eyebrow">Daily challenge</p><h2 className="font-display text-3xl font-black">Fish caught today</h2><p className="mt-2 text-cyan-50/70">Daily scoring is recorded separately from lifetime totals.</p><div className="mt-8 rounded-2xl bg-slate-950/30 p-4"><p className="text-cyan-50/70">Open Daily Challenge for the current standings and medal eligibility rule.</p></div></section></div></div>}
        {section==="leaderboards"&&<div className="space-y-6"><Heading eyebrow="Hall of numbers" title="Leaderboards"/><Tabs value={metric} onValueChange={v=>setMetric(v as StatKey)}><TabsList variant="line" className="w-full justify-start overflow-x-auto border-b border-slate-800 pb-2">{stats.map(s=><TabsTrigger value={s.key} key={s.key} className="px-4">{s.label}</TabsTrigger>)}</TabsList><TabsContent value={metric}><div className="pond-card mt-5 p-5">{ranking.map((p,i)=><PlayerRow key={p.id} p={p} rank={i+1} metric={metric} open={()=>setSelected(p)}/>)}</div></TabsContent></Tabs></div>}
        {section==="daily"&&<div className="space-y-6"><Heading eyebrow="Automatic daily competition" title="Fish caught today" copy="Daily challenge scoring is maintained by the league database."/><div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]"><section className="pond-card p-5"><div className="mb-5 flex justify-between"><h2 className="section-title">Connected players</h2></div>{dailyScores.map((s,i)=><div key={s.player} className="mb-2 grid grid-cols-[32px_44px_1fr_auto] items-center gap-3 rounded-2xl bg-slate-800/45 p-3"><b className="text-amber-300">#{i+1}</b><span className="relative grid size-11 place-items-center rounded-full bg-cyan-300/10 font-bold">{s.initials}<i className={"absolute bottom-0 right-0 size-3 rounded-full border-2 border-slate-900 "+dots[s.state]}/></span><strong>{s.player}</strong><b className="font-display text-xl">{s.score}</b></div>)}</section><aside className="space-y-4"><div className="pond-card p-5"><p className="eyebrow">Fair-play rule</p><h3 className="mt-2 font-display text-xl font-extrabold">Two players must score.</h3><p className="mt-2 text-sm leading-relaxed text-slate-400">A medal is only awarded when at least two players record a score above zero. Solo days close without a winner.</p></div><div className="pond-card p-5"><p className="eyebrow">Recent winners</p><p className="mt-4 text-sm text-slate-500">Completed daily results will appear here as they are recorded.</p></div></aside></div></div>}
        {section==="tournaments"&&<div className="space-y-6"><Heading eyebrow="Scheduled events" title="Fishing tournaments"/><div className="grid gap-5 lg:grid-cols-2"><div className="tourney-card border-amber-300/25"><b className="rounded-full bg-amber-300 px-3 py-1 text-xs uppercase text-slate-950">Live</b><Trophy className="mt-10 size-10 text-amber-300"/><h2 className="mt-4 font-display text-3xl font-black">Autumn Shiny Sprint</h2><p className="mt-2 text-slate-400">Catch the most shiny fish before Sep 18 at 6:00 PM.</p></div><div className="tourney-card"><b className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs uppercase text-cyan-200">Upcoming</b><CalendarDays className="mt-10 size-10 text-cyan-300"/><h2 className="mt-4 font-display text-3xl font-black">Weekend Big Catch</h2><p className="mt-2 text-slate-400">Most total fish caught from Friday through Sunday.</p></div></div></div>}
        {section==="players"&&<div className="space-y-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><Heading eyebrow="League directory" title="Players"/><label className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500"/><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a player" className="border-slate-700 bg-slate-900 pl-9"/></label></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(p=><button key={p.id} onClick={()=>setSelected(p)} className="pond-card group p-5 text-left hover:border-cyan-300/35"><div className="flex justify-between"><span className="relative grid size-14 place-items-center rounded-full bg-cyan-300/10 font-display text-lg font-black">{p.initials}<i className={"absolute bottom-0 right-0 size-3.5 rounded-full border-2 border-slate-900 "+dots[p.presence]}/></span><ChevronRight className="text-slate-600"/></div><h2 className="mt-4 font-display text-xl font-extrabold">{p.name}</h2><p className="mt-1 min-h-10 text-sm text-slate-400">{p.status}</p><div className="mt-4 flex gap-4 border-t border-slate-800 pt-4 text-sm"><span><b className="block">{p.medals}</b><small className="text-slate-500">medals</small></span><span><b className="block">{p.trophies}</b><small className="text-slate-500">trophies</small></span><span><b className="block">{format(p.fish)}</b><small className="text-slate-500">fish</small></span></div></button>)}</div></div>}
        {section==="admin"&&isAdmin&&<div className="space-y-6"><Heading eyebrow="League control room" title="Admin portal" copy="Manage automatic dailies, calendar overrides, tournaments, and profile corrections."/><Tabs defaultValue="daily"><TabsList className="h-auto w-full justify-start overflow-x-auto rounded-2xl bg-slate-900 p-1.5"><TabsTrigger value="daily" className="px-4 py-2.5">Daily engine</TabsTrigger><TabsTrigger value="calendar" className="px-4 py-2.5">Calendar</TabsTrigger><TabsTrigger value="profiles" className="px-4 py-2.5">Profiles & rewards</TabsTrigger></TabsList>
          <TabsContent value="daily" className="mt-5"><div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]"><section className="pond-card p-5"><p className="eyebrow">Random selection pool</p><h2 className="section-title">Challenge categories</h2><div className="mt-5 space-y-3">{categories.map(c=><div key={c.key} className="flex items-center justify-between rounded-2xl bg-slate-800/50 p-4"><div><b className="block">{c.label}</b><small className="text-slate-500">Eligible for automatic selection</small></div><Switch checked={c.enabled} onCheckedChange={v=>setCategories(cs=>cs.map(x=>x.key===c.key?{...x,enabled:v}:x))}/></div>)}</div></section><aside className="space-y-5"><div className="pond-card p-5"><Sparkles className="text-cyan-300"/><h3 className="mt-3 font-bold">Weekly no-repeat</h3><p className="mt-2 text-sm text-slate-400">Random draws exclude categories already used since Monday. Calendar overrides count toward the same limit.</p><Button onClick={randomPreview} className="mt-5 w-full bg-cyan-300 font-bold text-slate-950">Preview next draw</Button></div><div className="pond-card p-5"><p className="eyebrow">Medal requirement</p><div className="mt-3 flex justify-between"><b>Minimum scoring players</b><strong className="rounded-xl bg-slate-800 px-4 py-2 text-xl">2</strong></div><p className="mt-3 text-sm text-slate-500">Zero scores do not count as participation.</p></div></aside></div></TabsContent>
          <TabsContent value="calendar" className="mt-5"><div className="grid gap-6 xl:grid-cols-[auto_1fr]"><section className="pond-card p-4"><Calendar mode="single" selected={day} onSelect={setDay}/></section><section className="pond-card p-5"><p className="eyebrow">Calendar override</p><h2 className="section-title">Schedule a category</h2><div className="mt-5 flex flex-col gap-3 sm:flex-row"><Select value={category} onValueChange={setCategory}><SelectTrigger className="w-full border-slate-700 bg-slate-900"><SelectValue/></SelectTrigger><SelectContent>{categories.map(c=><SelectItem value={c.key} key={c.key}>{c.label}</SelectItem>)}</SelectContent></Select><Button onClick={addSchedule} className="bg-cyan-300 font-bold text-slate-950"><Plus/>Add override</Button></div><div className="mt-7 space-y-3">{schedule.map(x=><div key={x.date} className="flex justify-between rounded-2xl bg-slate-800/50 p-4"><b>{x.date}</b><span className="text-cyan-200">{x.category}</span></div>)}</div></section></div></TabsContent>
          <TabsContent value="profiles" className="mt-5"><section className="pond-card p-5"><p className="eyebrow">Manual moderation</p><h2 className="section-title">Profiles & reward totals</h2><p className="mt-2 text-sm text-slate-500">Corrections require a reason and are recorded in the admin history.</p><div className="mt-4 divide-y divide-slate-800">{players.map(p=><div key={p.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"><span className="grid size-11 place-items-center rounded-full bg-cyan-300/10 font-bold">{p.initials}</span><span className="min-w-0 flex-1"><b className="block">{p.name}</b><small className="block truncate text-slate-500">{p.bio}</small></span><span className="text-sm text-slate-400">{p.medals} medals · {p.trophies} trophies</span><Button onClick={()=>edit(p)} variant="outline" size="sm" className="border-slate-700"><Pencil/>Edit</Button></div>)}</div></section></TabsContent>
        </Tabs></div>}
      </main>
    </div>
    <Sheet open={!!selected} onOpenChange={o=>!o&&setSelected(null)}><SheetContent className="w-full overflow-y-auto border-slate-800 bg-[#091725] sm:max-w-xl"><SheetHeader className="border-b border-slate-800 p-6"><SheetTitle className="sr-only">Player profile</SheetTitle><SheetDescription className="sr-only">Statistics and rewards</SheetDescription>{selected&&<div className="flex items-center gap-4"><span className="relative grid size-16 place-items-center rounded-full bg-cyan-300/10 text-xl font-black">{selected.initials}<i className={"absolute bottom-0 right-0 size-4 rounded-full border-2 border-slate-900 "+dots[selected.presence]}/></span><div><h2 className="font-display text-2xl font-black">{selected.name}</h2><p className="text-sm text-cyan-200">{selected.status}</p></div></div>}</SheetHeader>{selected&&<div className="space-y-7 p-6"><section><p className="eyebrow">Bio</p><p className="mt-2 text-slate-300">{selected.bio}</p></section><div className="grid grid-cols-2 gap-3"><div className="mini-stat"><Fish/><b>{format(selected.fish)}</b><span>Fish caught</span></div><div className="mini-stat"><Sparkles/><b>{selected.shinies}</b><span>Shinies</span></div><div className="mini-stat"><Target/><b>{selected.quests}</b><span>Quests</span></div><div className="mini-stat"><Clock3/><b>{selected.playtime}</b><span>Playtime</span></div></div><section><p className="eyebrow">Rewards</p><div className="mt-3 grid grid-cols-2 gap-3"><div className="reward-card text-amber-300"><Medal/><b>{selected.medals}</b><span>Daily Challenge Medals</span></div><div className="reward-card text-cyan-300"><Trophy/><b>{selected.trophies}</b><span>Tournament Trophies</span></div></div></section><section><p className="eyebrow">Tournament cabinet</p><div className="mt-3 space-y-3">{selected.trophies?Array.from({length:selected.trophies}).slice(0,3).map((_,i)=><div key={i} className="flex items-center gap-3 rounded-2xl bg-slate-800/55 p-4"><Crown className="text-amber-300"/><span><b className="block">{["Autumn Shiny Sprint","Weekend Big Catch","Cosmos Classic"][i]}</b><small className="text-slate-500">{["Sep 2026 · 1st place","Aug 2026 · 2nd place","Jul 2026 · 1st place"][i]}</small></span></div>):<p className="rounded-2xl border border-dashed border-slate-700 p-5 text-slate-500">No tournament trophies yet.</p>}</div></section></div>}</SheetContent></Sheet>
    <Dialog open={!!editing} onOpenChange={o=>!o&&setEditing(null)}><DialogContent className="border-slate-700 bg-[#0b1a29] text-slate-100"><DialogHeader><DialogTitle>Edit player profile</DialogTitle><DialogDescription className="text-slate-400">Correct profile content and reward totals. Every change requires an admin note.</DialogDescription></DialogHeader><div className="grid gap-4"><label className="field-label">Display name<Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label className="field-label">Bio<Textarea value={form.bio} onChange={e=>setForm({...form,bio:e.target.value})}/></label><div className="grid grid-cols-2 gap-4"><label className="field-label">Daily medals<Input type="number" min="0" value={form.medals} onChange={e=>setForm({...form,medals:Number(e.target.value)})}/></label><label className="field-label">Tournament trophies<Input type="number" min="0" value={form.trophies} onChange={e=>setForm({...form,trophies:Number(e.target.value)})}/></label></div><label className="field-label">Reason for change<Input value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder="Example: testing medal display"/></label></div><DialogFooter><Button variant="outline" onClick={()=>setEditing(null)}>Cancel</Button><Button onClick={save} className="bg-cyan-300 font-bold text-slate-950">Save correction</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
