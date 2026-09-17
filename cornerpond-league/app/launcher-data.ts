import { supabase } from "./supabase";
import { callAccountAction } from "./account-actions";

export const launcherBucket = "launcher-releases";

export type LauncherRelease = {
  id: string;
  versionLabel: string;
  filePath: string;
  fileName: string;
  releaseNotes: string;
  fileSize: number;
  updatedAt: string;
  createdAt: string;
};

export async function fetchLauncherReleases(): Promise<LauncherRelease[]> {
  const { data, error } = await supabase
    .from("launcher_releases")
    .select("id,version_label,file_path,file_name,release_notes,file_size,updated_at,created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    versionLabel: row.version_label,
    filePath: row.file_path,
    fileName: row.file_name,
    releaseNotes: row.release_notes ?? "",
    fileSize: Number(row.file_size ?? 0),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  }));
}

export async function createLauncherDownloadUrl(release: LauncherRelease): Promise<string> {
  const { data, error } = await supabase.storage.from(launcherBucket).createSignedUrl(release.filePath, 120, { download: release.fileName });
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function publishLauncherRelease(file: File, versionLabel: string, releaseNotes: string) {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Choose a ZIP file.");
  if (file.size < 1 || file.size > 250 * 1024 * 1024) throw new Error("The launcher ZIP must be smaller than 250 MB.");
  const filePath = `releases/${crypto.randomUUID()}.zip`;
  const { error: uploadError } = await supabase.storage.from(launcherBucket).upload(filePath, file, {
    contentType: "application/zip",
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);
  await callAccountAction({
    action: "admin_publish_launcher",
    version_label: versionLabel,
    release_notes: releaseNotes,
    file_path: filePath,
    file_name: file.name,
    file_size: file.size,
  });
}

export async function updateLauncherRelease(releaseId: string, versionLabel: string, releaseNotes: string) {
  await callAccountAction({ action: "admin_update_launcher_release", release_id: releaseId, version_label: versionLabel, release_notes: releaseNotes });
}

export async function deleteLauncherRelease(releaseId: string) {
  await callAccountAction({ action: "admin_delete_launcher_release", release_id: releaseId });
}
