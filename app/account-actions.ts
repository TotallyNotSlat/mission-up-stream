import { supabase } from "./supabase";

export type MyProfile = {
  id: string;
  username: string;
  bio: string;
  statusText: string;
  avatarPath: string | null;
  avatarUrl: string | null;
  mustChangePassword: boolean;
  activeTitleId: string | null;
  titleIds: string[];
  canManageTournaments: boolean;
};

export async function callAccountAction(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("league-account", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export async function fetchMyProfile(userId: string): Promise<MyProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,bio,status_text,avatar_path,must_change_password,active_title_id")
    .eq("id", userId)
    .single();
  if (error) throw new Error(error.message);
  let avatarUrl: string | null = null;
  if (data.avatar_path) {
    const { data: signed } = await supabase.storage.from("profile-images").createSignedUrl(data.avatar_path, 3600);
    avatarUrl = signed?.signedUrl ?? null;
  }
  const {data:assigned,error:titleError}=await supabase.from("player_titles").select("title_id,title_definitions!inner(can_manage_tournaments)").eq("player_id",userId);
  if(titleError)throw new Error(titleError.message);
  return {
    id: data.id,
    username: data.username,
    bio: data.bio ?? "",
    statusText: data.status_text ?? "",
    avatarPath: data.avatar_path,
    avatarUrl,
    mustChangePassword: Boolean(data.must_change_password),
    activeTitleId:data.active_title_id,
    titleIds:(assigned??[]).map(row=>row.title_id),
    canManageTournaments:(assigned??[]).some(row=>Boolean((row.title_definitions as unknown as {can_manage_tournaments:boolean}).can_manage_tournaments)),
  };
}

export async function uploadMyAvatar(userId: string, file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error("Profile pictures must be 5 MB or smaller.");
  if (!file.type.match(/^image\/(jpeg|png|webp|gif)$/)) throw new Error("Use a JPG, PNG, WebP, or GIF image.");
  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const path = `${userId}/avatar.${extension}`;
  const { error: uploadError } = await supabase.storage.from("profile-images").upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) throw new Error(uploadError.message);
  const { error: profileError } = await supabase.from("profiles").update({ avatar_path: path, updated_at: new Date().toISOString() }).eq("id", userId);
  if (profileError) throw new Error(profileError.message);
  return path;
}
