import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ytwfioxletcobzwiqdls.supabase.co";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_E3Dc83ue1idv888GncbwNA_vUXuBsLC";
const authLogKey="mission-up-stream-auth-diagnostics";

function recordAuthHttp(entry:Record<string,unknown>){
  console.info("[Mission Auth HTTP]",entry);
  try{const current=JSON.parse(localStorage.getItem(authLogKey)??"[]") as Record<string,unknown>[];localStorage.setItem(authLogKey,JSON.stringify([...current.slice(-199),entry]))}catch{}
}

function authOperation(input:RequestInfo|URL){
  const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
  if(!url.includes("/auth/v1/"))return null;
  if(url.includes("grant_type=password"))return "signInWithPassword";
  if(url.includes("grant_type=refresh_token"))return "refreshSession";
  if(url.includes("/signup"))return "signUp";
  if(url.includes("/logout"))return "signOut";
  if(url.includes("/user"))return "getUser";
  return "authRequest";
}

async function diagnosticFetch(input:RequestInfo|URL,init?:RequestInit){
  const operation=authOperation(input),timestamp=new Date().toISOString();
  if(operation)recordAuthHttp({timestamp,operation,trigger:"supabase-js",result:"start",retry:0});
  try{const response=await fetch(input,init);if(operation)recordAuthHttp({timestamp:new Date().toISOString(),operation,trigger:"supabase-js",result:response.ok?"success":"failure",httpStatus:response.status,retry:0});return response}
  catch(error){if(operation)recordAuthHttp({timestamp:new Date().toISOString(),operation,trigger:"supabase-js",result:"network_failure",httpStatus:0,retry:0});throw error}
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  global:{fetch:diagnosticFetch},
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export function usernameToAuthEmail(username: string) {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(normalized)) {
    throw new Error("Username must be 3–24 characters using letters, numbers, or underscores.");
  }
  return `${normalized}@players.cornerpond.app`;
}
