import os from "node:os";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DISK_CACHE_MS = 60_000;

type DiskSummary = {
  total: number;
  used: number;
  available: number;
  percent: number;
  capacityReliable: boolean;
  measurement: "configured" | "filesystem" | "server-usage";
};

let diskCache: { expiresAt: number; value: DiskSummary | null } | null = null;

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

async function capacityMayBelongToAnotherSystem() {
  try {
    await execFileAsync("systemd-detect-virt", ["--container", "--quiet"], { timeout: 3000 });
    return true;
  } catch {
    try {
      const cgroup = await readFile("/proc/1/cgroup", "utf8");
      return /(docker|containerd|kubepods|machine\.slice|libpod|lxc)/i.test(cgroup);
    } catch {
      return false;
    }
  }
}

async function measuredServerUsage() {
  try {
    const { stdout } = await execFileAsync("du", ["-s", "-B1", "-x", "/"], {
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    const used = Number(stdout.trim().split(/\s+/)[0]);
    return Number.isFinite(used) && used >= 0 ? used : null;
  } catch {
    return null;
  }
}

async function filesystemCapacity() {
  try {
    const { stdout } = await execFileAsync("df", ["-P", "-B1", "/"], { timeout: 5000 });
    const line = stdout.trim().split("\n").at(-1)?.trim().split(/\s+/);
    if (!line || line.length < 5) return null;
    const total = Number(line[1]);
    const used = Number(line[2]);
    const available = Number(line[3]);
    if (![total, used, available].every(Number.isFinite) || total <= 0) return null;
    return { total, used, available, percent: Math.min(100, Math.max(0, Math.round((used / total) * 100))) };
  } catch {
    return null;
  }
}

async function diskSummary(): Promise<DiskSummary | null> {
  if (diskCache && diskCache.expiresAt > Date.now()) return diskCache.value;

  const configuredCapacity = Number(process.env.WFILEMANAGER_STORAGE_CAPACITY_BYTES || 0);
  const sharedCapacity = await capacityMayBelongToAnotherSystem();
  let value: DiskSummary | null = null;

  if (Number.isFinite(configuredCapacity) && configuredCapacity > 0) {
    const used = await measuredServerUsage();
    if (used !== null) {
      const normalizedUsed = Math.min(used, configuredCapacity);
      value = {
        total: configuredCapacity,
        used: normalizedUsed,
        available: Math.max(0, configuredCapacity - normalizedUsed),
        percent: Math.min(100, Math.max(0, Math.round((normalizedUsed / configuredCapacity) * 100))),
        capacityReliable: true,
        measurement: "configured",
      };
    }
  } else if (!sharedCapacity) {
    const filesystem = await filesystemCapacity();
    if (filesystem) value = { ...filesystem, capacityReliable: true, measurement: "filesystem" };
  } else {
    const used = await measuredServerUsage();
    if (used !== null) {
      value = {
        total: 0,
        used,
        available: 0,
        percent: 0,
        capacityReliable: false,
        measurement: "server-usage",
      };
    }
  }

  diskCache = { value, expiresAt: Date.now() + DISK_CACHE_MS };
  return value;
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

  const [memory, disk] = await Promise.all([memorySummary(), diskSummary()]);

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
