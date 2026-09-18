import type {AuthChangeEvent,Session} from "@supabase/supabase-js";
import {supabase} from "./supabase";

type AuthLog={timestamp:string;operation:string;trigger:string;result:string;httpStatus:number;retry:number};
const storageKey="mission-up-stream-auth-diagnostics";
let signInFlight:ReturnType<typeof supabase.auth.signInWithPassword>|null=null;
let signInBlockedUntil=0;

export function logAuth(operation:string,trigger:string,result:string,httpStatus=0,retry=0){
  const entry:AuthLog={timestamp:new Date().toISOString(),operation,trigger,result,httpStatus,retry};
  console.info("[Mission Auth]",entry);
  try{const current=JSON.parse(localStorage.getItem(storageKey)??"[]") as AuthLog[];localStorage.setItem(storageKey,JSON.stringify([...current.slice(-199),entry]))}catch{}
}

function statusOf(error:unknown){return typeof error==="object"&&error!==null&&"status" in error?Number((error as {status?:number}).status??0):0}

export async function signInWithPasswordOnce(email:string,password:string,trigger="login_form"){
  if(Date.now()<signInBlockedUntil){logAuth("signInWithPassword",trigger,"blocked_by_cooldown",429,0);throw new Error("Sign-in is temporarily rate limited. Please wait a few minutes before trying again.")}
  if(signInFlight){logAuth("signInWithPassword",trigger,"deduplicated",0,0);return signInFlight}
  logAuth("signInWithPassword",trigger,"start",0,0);
  signInFlight=supabase.auth.signInWithPassword({email,password});
  try{const result=await signInFlight;const status=statusOf(result.error);if(status===429)signInBlockedUntil=Date.now()+300_000;logAuth("signInWithPassword",trigger,result.error?"failure":"success",status,0);return result}
  finally{signInFlight=null}
}

export async function getPersistedSession(trigger="app_mount"){
  logAuth("getSession",trigger,"start",0,0);
  const result=await supabase.auth.getSession();
  logAuth("getSession",trigger,result.error?"failure":"success",statusOf(result.error),0);
  return result;
}

export async function signOutOnce(trigger:string){
  logAuth("signOut",trigger,"start",0,0);
  const result=await supabase.auth.signOut();
  logAuth("signOut",trigger,result.error?"failure":"success",statusOf(result.error),0);
  return result;
}

export function logAuthState(event:AuthChangeEvent,session:Session|null){
  logAuth(event==="TOKEN_REFRESHED"?"refreshSession":"authStateChange","supabase_listener",session?event:`${event}:no_session`,0,0);
}

export function friendlyAuthError(error:unknown){
  const message=error instanceof Error?error.message:"Could not sign in.";
  const status=statusOf(error);
  if(status===429||/too many requests|rate limit/i.test(message))return "Sign-in is temporarily rate limited. Please wait a few minutes before trying again.";
  if(message.toLowerCase().includes("invalid login credentials"))return "The username or password is incorrect.";
  return message;
}
