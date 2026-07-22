import { wfilemanagerApi } from "./wfilemanager-api";

export type ArchiveFormat = "zip" | "tar.gz";
export type ExtractionMode = "current" | "folder" | "custom";
export type ConflictPolicy = "error" | "rename" | "overwrite";

export interface ArchiveTopLevelItem {
  name: string;
  kind: "file" | "directory";
}

export interface ArchiveInspection {
  path: string;
  format: ArchiveFormat;
  entries: number;
  topLevelEntries: string[];
  topLevelItems: ArchiveTopLevelItem[];
  multipleTopLevel: boolean;
  suggestedFolder: string;
  destinationParent: string;
  defaultConflicts: string[];
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
  renamedTopLevel: Record<string, string>;
  conflicts: string[];
  mode: ExtractionMode;
  conflictPolicy: ConflictPolicy;
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
  extract: (path: string, options: {
    mode: ExtractionMode;
    folderName?: string;
    destination?: string;
    conflictPolicy?: ConflictPolicy;
  }) => fetch("/api/local?action=archive-extract", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ path, ...options }),
  }).then(parse<ArchiveExtractionResult>),
};
