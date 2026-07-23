import os from "node:os";
import { readFile } from "node:fs/promises";
import { storageSummary, type StorageCapacitySource } from "@/lib/server/storage-runtime";

async function readNumber(file: string) {
  try {
    const value = (await readFile(file, "utf8")).trim();
    if (!value || value === "max") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function memorySummary() {
  const hostTotal = os.totalmem();
  const hostFree = os.freemem();
  const candidates = [
    ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"],
    ["/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes"],
  ] as const;

  for (const [limitFile, usageFile] of candidates) {
    const [limit, usage] = await Promise.all([readNumber(limitFile), readNumber(usageFile)]);
    if (limit && usage !== null && limit < hostTotal && limit < Number.MAX_SAFE_INTEGER) {
      return { total: limit, free: Math.max(0, limit - usage) };
    }
  }

  return { total: hostTotal, free: hostFree };
}

export async function systemSummary() {
  let osRelease: Record<string, string> = {};
  try {
    const content = await readFile("/etc/os-release", "utf8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const raw = match[2].trim();
      osRelease[match[1]] = raw.replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {
    osRelease = {};
  }

  let loginUsers = 0;
  try {
    const passwd = await readFile("/etc/passwd", "utf8");
    loginUsers = passwd
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(":"))
      .filter((parts) => {
        const username = parts[0] || "";
        const uid = Number(parts[2]);
        const shell = parts[6] || "";
        const interactiveShell = Boolean(shell) && !shell.endsWith("/nologin") && !shell.endsWith("/false");
        return interactiveShell && (username === "root" || uid >= 1000);
      })
      .length;
  } catch {
    loginUsers = 0;
  }

  const [memory, storage] = await Promise.all([memorySummary(), storageSummary()]);
  const primary = storage.primary;
  const disk = primary ? {
    total: primary.total,
    used: primary.used,
    available: primary.available,
    percent: primary.percent,
    capacityReliable: primary.capacityReliable !== false,
    measurement: (primary.capacitySource || "filesystem") as StorageCapacitySource,
  } : null;

  return {
    loginUsers,
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    uptime: os.uptime(),
    memory,
    disk,
    node: process.version,
    os: {
      id: osRelease.ID || os.platform(),
      name: osRelease.NAME || os.platform(),
      versionId: osRelease.VERSION_ID || "",
      versionCodename: osRelease.VERSION_CODENAME || "",
      prettyName: osRelease.PRETTY_NAME || `${os.platform()} ${os.release()}`,
    },
  };
}
