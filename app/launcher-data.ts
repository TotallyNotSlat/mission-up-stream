import { supabase } from "./supabase";
import { callAccountAction } from "./account-actions";

export const launcherBucket = "launcher-releases";
export const launcherObjectPath = "mission-up-stream-launcher.zip";

export type LauncherRelease = {
  versionLabel: string;
  filePath: string;
  fileName: string;
  releaseNotes: string;
  fileSize: number;
  updatedAt: string;
};

export async function fetchLauncherRelease(): Promise<LauncherRelease | null> {
  const { data, error } = await supabase
    .from("launcher_releases")
    .select("version_label,file_path,file_name,release_notes,file_size,updated_at")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    versionLabel: data.version_label,
    filePath: data.file_path,
    fileName: data.file_name,
    releaseNotes: data.release_notes ?? "",
    fileSize: Number(data.file_size ?? 0),
    updatedAt: data.updated_at,
  };
}

export async function createLauncherDownloadUrl(release: LauncherRelease): Promise<string> {
  const { data, error } = await supabase.storage.from(launcherBucket).createSignedUrl(release.filePath, 120, { download: release.fileName });
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function publishLauncherRelease(file: File, versionLabel: string, releaseNotes: string) {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Choose a ZIP file.");
  if (file.size < 1 || file.size > 250 * 1024 * 1024) throw new Error("The launcher ZIP must be smaller than 250 MB.");
  const { error: uploadError } = await supabase.storage.from(launcherBucket).upload(launcherObjectPath, file, {
    contentType: "application/zip",
    cacheControl: "3600",
    upsert: true,
  });
  if (uploadError) throw new Error(uploadError.message);
  await callAccountAction({
    action: "admin_publish_launcher",
    version_label: versionLabel,
    release_notes: releaseNotes,
    file_path: launcherObjectPath,
    file_name: file.name,
    file_size: file.size,
  });
}
