import { wfilemanagerApi } from "./wfilemanager-api";

export interface FileTypeSummary {
  type: string;
  count: number;
  bytes: number;
}

export interface FileCategorySummary {
  category: string;
  count: number;
  bytes: number;
}

export interface HomeUsageSummary {
  username: string;
  uid: number;
  path: string;
  bytes: number;
}

export interface StorageAnalysis {
  generatedAt: string;
  root: string;
  totalFiles: number;
  totalDirectories: number;
  totalSymlinks: number;
  totalOther: number;
  totalItems: number;
  totalFileBytes: number;
  fileTypes: FileTypeSummary[];
  categories: FileCategorySummary[];
  homeUsage: HomeUsageSummary[];
}

async function parse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Storage analysis request failed (${response.status})`);
  return payload as StorageAnalysis;
}

export const storageAnalysisApi = {
  get: async (refresh = false) => {
    const token = wfilemanagerApi.getToken();
    const query = new URLSearchParams({ action: "storage-analysis" });
    if (refresh) query.set("refresh", "1");
    return parse(await fetch(`/api/local?${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    }));
  },
};
