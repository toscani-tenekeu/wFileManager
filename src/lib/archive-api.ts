import { wfilemanagerApi } from "./wfilemanager-api";

export type ArchiveFormat = "zip" | "tar.gz";
export type ExtractionMode = "current" | "folder";

export interface ArchiveInspection {
  path: string;
  format: ArchiveFormat;
  entries: number;
  topLevelEntries: string[];
  multipleTopLevel: boolean;
  suggestedFolder: string;
  destinationParent: string;
}

export interface ArchiveCreationResult {
  path: string;
  format: ArchiveFormat;
  skippedLinks: number;
}

export interface ArchiveExtractionResult {
  archive: string;
  format: ArchiveFormat;
  extractedTo: string;
  entries: number;
  topLevelEntries: string[];
  mode: ExtractionMode;
}

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Archive request failed (${response.status})`);
  return payload as T;
}

function headers(json = false): HeadersInit {
  const token = wfilemanagerApi.getToken();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const archiveApi = {
  inspect: (path: string) => {
    const query = new URLSearchParams({ action: "archive-inspect", path });
    return fetch(`/api/local?${query}`, { headers: headers(), cache: "no-store" }).then(parse<ArchiveInspection>);
  },
  create: (path: string, format: ArchiveFormat) => fetch("/api/local?action=archive-create", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ path, format }),
  }).then(parse<ArchiveCreationResult>),
  extract: (path: string, mode: ExtractionMode, folderName?: string) => fetch("/api/local?action=archive-extract", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ path, mode, folderName }),
  }).then(parse<ArchiveExtractionResult>),
};
