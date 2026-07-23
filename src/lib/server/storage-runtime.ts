import { execFile, spawn } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CACHE_MS = Math.max(30_000, Number(process.env.WFILEMANAGER_STORAGE_CACHE_MS || 60_000));
const GIB = 1024 ** 3;

export type StorageCapacitySource = "configured" | "quota" | "filesystem" | "server-usage";

export interface StorageMount {
  device: string;
  mountpoint: string;
  fstype: string;
  options: string;
  total: number;
  used: number;
  available: number;
  percent: number;
  inodesTotal: number;
  inodesUsed: number;
  inodesAvailable: number;
  inodePercent: number;
  readonly: boolean;
  health: "healthy" | "warning" | "critical" | "read-only";
  scope?: "server" | "filesystem";
  capacitySource?: StorageCapacitySource;
  capacityReliable?: boolean;
  inodesReliable?: boolean;
}

type ProjectQuota = {
  projectId: number;
  total: number;
  used: number;
  inodesTotal: number;
  inodesUsed: number;
};

type RawMount = {
  source?: string;
  target?: string;
  fstype?: string;
  options?: string;
  children?: RawMount[];
};

const IGNORED_FILESYSTEMS = new Set([
  "proc", "sysfs", "devtmpfs", "devpts", "cgroup", "cgroup2", "securityfs",
  "pstore", "debugfs", "tracefs", "configfs", "fusectl", "mqueue", "hugetlbfs",
  "rpc_pipefs", "autofs", "binfmt_misc", "efivarfs", "ramfs", "tmpfs",
  "squashfs", "overlay", "aufs", "nsfs", "fuse.lxcfs",
]);

let cached: { expiresAt: number; value: Awaited<ReturnType<typeof buildStorageSummary>> } | null = null;

function percent(used: number, total: number) {
  return total > 0 ? Math.min(100, Math.max(0, Math.round((used / total) * 100))) : 0;
}

function health(readonly: boolean, diskPercent: number, inodePercent: number): StorageMount["health"] {
  if (readonly) return "read-only";
  const highest = Math.max(diskPercent, inodePercent);
  return highest >= 90 ? "critical" : highest >= 80 ? "warning" : "healthy";
}

function positiveNumber(value: string | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function configuredCapacity() {
  const bytes = positiveNumber(process.env.WFILEMANAGER_STORAGE_CAPACITY_BYTES);
  if (bytes > 0) return bytes;
  const gib = positiveNumber(process.env.WFILEMANAGER_STORAGE_CAPACITY_GB);
  return gib > 0 ? gib * GIB : 0;
}

function flattenFindmnt(items: RawMount[], output: RawMount[] = []) {
  for (const item of items || []) {
    output.push(item);
    if (Array.isArray(item.children)) flattenFindmnt(item.children, output);
  }
  return output;
}

async function isContainerEnvironment() {
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

async function measuredRootUsage() {
  try {
    const { stdout } = await execFileAsync("du", ["-s", "-B1", "-x", "/"], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    });
    const value = Number(stdout.trim().split(/\s+/)[0]);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

async function measuredRootInodes() {
  return new Promise<number | null>((resolve) => {
    const child = spawn("find", ["/", "-xdev", "-printf", "."], {
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, LC_ALL: "C" },
    });
    let count = 0;
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    child.stdout.on("data", (chunk: Buffer) => { count += chunk.length; });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 || code === 1 ? count : null));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(null);
    }, 30_000);
    timer.unref();
  });
}

async function projectQuota(): Promise<ProjectQuota | null> {
  const script = String.raw`
import ctypes
import fcntl
import json
import os
import struct

FS_IOC_FSGETXATTR = 0x801C581F
Q_GETQUOTA = 0x800007
PRJQUOTA = 2
SYS_QUOTACTL_FD = 443

class DQBlk(ctypes.Structure):
    _fields_ = [
        ("dqb_bhardlimit", ctypes.c_uint64),
        ("dqb_bsoftlimit", ctypes.c_uint64),
        ("dqb_curspace", ctypes.c_uint64),
        ("dqb_ihardlimit", ctypes.c_uint64),
        ("dqb_isoftlimit", ctypes.c_uint64),
        ("dqb_curinodes", ctypes.c_uint64),
        ("dqb_btime", ctypes.c_uint64),
        ("dqb_itime", ctypes.c_uint64),
        ("dqb_valid", ctypes.c_uint32),
    ]

fd = os.open("/", os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
try:
    attrs = bytearray(28)
    fcntl.ioctl(fd, FS_IOC_FSGETXATTR, attrs, True)
    project_id = struct.unpack_from("=I", attrs, 12)[0]
    if project_id <= 0:
        raise SystemExit(2)

    quota = DQBlk()
    command = ((Q_GETQUOTA << 8) | PRJQUOTA) & 0xFFFFFFFF
    libc = ctypes.CDLL(None, use_errno=True)
    quotactl_fd = getattr(libc, "quotactl_fd", None)
    if quotactl_fd is not None:
        quotactl_fd.argtypes = [ctypes.c_int, ctypes.c_uint, ctypes.c_int, ctypes.c_void_p]
        quotactl_fd.restype = ctypes.c_int
        result = quotactl_fd(fd, command, project_id, ctypes.byref(quota))
    else:
        libc.syscall.restype = ctypes.c_long
        result = libc.syscall(
            ctypes.c_long(SYS_QUOTACTL_FD),
            ctypes.c_int(fd),
            ctypes.c_uint(command),
            ctypes.c_int(project_id),
            ctypes.byref(quota),
        )
    if result != 0:
        raise SystemExit(3)

    block_limit = quota.dqb_bhardlimit or quota.dqb_bsoftlimit
    inode_limit = quota.dqb_ihardlimit or quota.dqb_isoftlimit
    if block_limit <= 0:
        raise SystemExit(4)

    print(json.dumps({
        "projectId": project_id,
        "total": int(block_limit) * 1024,
        "used": int(quota.dqb_curspace),
        "inodesTotal": int(inode_limit),
        "inodesUsed": int(quota.dqb_curinodes),
    }))
finally:
    os.close(fd)
`;

  try {
    const { stdout } = await execFileAsync("python3", ["-c", script], {
      timeout: 5000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    });
    const value = JSON.parse(stdout) as Partial<ProjectQuota>;
    if (!Number.isFinite(value.total) || Number(value.total) <= 0) return null;
    return {
      projectId: Number(value.projectId) || 0,
      total: Number(value.total),
      used: Math.max(0, Number(value.used) || 0),
      inodesTotal: Math.max(0, Number(value.inodesTotal) || 0),
      inodesUsed: Math.max(0, Number(value.inodesUsed) || 0),
    };
  } catch {
    return null;
  }
}

async function baseMetrics(mountpoint: string) {
  const info = await statfs(mountpoint);
  const blockSize = Number(info.bsize || 0);
  const total = Math.max(0, Number(info.blocks || 0) * blockSize);
  const available = Math.max(0, Number(info.bavail || 0) * blockSize);
  const free = Math.max(0, Number(info.bfree || 0) * blockSize);
  const used = Math.max(0, total - free);
  const inodesTotal = Math.max(0, Number(info.files || 0));
  const inodesAvailable = Math.max(0, Number(info.ffree || 0));
  const inodesUsed = Math.max(0, inodesTotal - inodesAvailable);
  return { total, used, available, inodesTotal, inodesUsed, inodesAvailable };
}

async function scopedRootMetrics(base: Awaited<ReturnType<typeof baseMetrics>>) {
  const container = await isContainerEnvironment();
  const configuredTotal = configuredCapacity();
  const configuredInodes = positiveNumber(process.env.WFILEMANAGER_STORAGE_INODES);
  const [measuredUsage, quota] = await Promise.all([measuredRootUsage(), projectQuota()]);

  if (configuredTotal > 0) {
    const used = Math.min(configuredTotal, measuredUsage ?? base.used);
    const measuredInodes = configuredInodes > 0 ? await measuredRootInodes() : null;
    const inodesUsed = configuredInodes > 0 ? Math.min(configuredInodes, measuredInodes ?? 0) : 0;
    return {
      total: configuredTotal,
      used,
      available: Math.max(0, configuredTotal - used),
      inodesTotal: configuredInodes,
      inodesUsed,
      inodesAvailable: configuredInodes > 0 ? Math.max(0, configuredInodes - inodesUsed) : 0,
      capacitySource: "configured" as const,
      capacityReliable: true,
      inodesReliable: configuredInodes > 0,
    };
  }

  if (quota) {
    const used = Math.min(quota.total, quota.used);
    const inodesTotal = quota.inodesTotal;
    const inodesUsed = inodesTotal > 0 ? Math.min(inodesTotal, quota.inodesUsed) : quota.inodesUsed;
    return {
      total: quota.total,
      used,
      available: Math.max(0, quota.total - used),
      inodesTotal,
      inodesUsed,
      inodesAvailable: inodesTotal > 0 ? Math.max(0, inodesTotal - inodesUsed) : 0,
      capacitySource: "quota" as const,
      capacityReliable: true,
      inodesReliable: inodesTotal > 0,
    };
  }

  const difference = measuredUsage === null ? Number.POSITIVE_INFINITY : Math.abs(base.used - measuredUsage);
  const tolerance = measuredUsage === null ? 0 : Math.max(512 * 1024 ** 2, measuredUsage * 0.35);
  const filesystemIsServerScoped = !container || difference <= tolerance;

  if (filesystemIsServerScoped) {
    return {
      ...base,
      capacitySource: "filesystem" as const,
      capacityReliable: true,
      inodesReliable: base.inodesTotal > 0,
    };
  }

  const measuredInodes = await measuredRootInodes();
  return {
    total: 0,
    used: measuredUsage ?? 0,
    available: 0,
    inodesTotal: 0,
    inodesUsed: measuredInodes ?? 0,
    inodesAvailable: 0,
    capacitySource: "server-usage" as const,
    capacityReliable: false,
    inodesReliable: false,
  };
}

async function buildStorageSummary() {
  const { stdout } = await execFileAsync(
    "findmnt",
    ["--json", "--output", "SOURCE,TARGET,FSTYPE,OPTIONS"],
    { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as { filesystems?: RawMount[] };
  const items = flattenFindmnt(parsed.filesystems || []).sort((left, right) => {
    const leftRoot = String(left.target || "") === "/" ? 0 : 1;
    const rightRoot = String(right.target || "") === "/" ? 0 : 1;
    return leftRoot - rightRoot;
  });
  const seenDevices = new Set<string>();
  const mounts: StorageMount[] = [];

  for (const item of items) {
    const mountpoint = String(item.target || "");
    const fstype = String(item.fstype || "unknown");
    const rawDevice = String(item.source || "unknown");
    const device = rawDevice.replace(/\[.*$/, "");
    const options = String(item.options || "");

    if (!mountpoint || IGNORED_FILESYSTEMS.has(fstype)) continue;
    if ((mountpoint.startsWith("/proc") || mountpoint.startsWith("/sys") || mountpoint.startsWith("/dev")) && mountpoint !== "/") continue;
    if (["none", "tmpfs", "overlay", "proc", "sysfs"].includes(device)) continue;
    if (mountpoint.startsWith("/var/lib/docker/") || mountpoint.startsWith("/snap/")) continue;
    if (seenDevices.has(device)) continue;
    seenDevices.add(device);

    try {
      const base = await baseMetrics(mountpoint);
      const root = mountpoint === "/";
      const metrics = root ? await scopedRootMetrics(base) : {
        ...base,
        capacitySource: "filesystem" as const,
        capacityReliable: true,
        inodesReliable: base.inodesTotal > 0,
      };
      const diskPercent = percent(metrics.used, metrics.total);
      const inodePercent = percent(metrics.inodesUsed, metrics.inodesTotal);
      const readonly = options.split(",").includes("ro");
      mounts.push({
        device,
        mountpoint,
        fstype,
        options,
        ...metrics,
        percent: diskPercent,
        inodePercent,
        readonly,
        health: health(readonly, diskPercent, inodePercent),
        scope: root ? "server" : "filesystem",
      });
    } catch {
      // Ignore transient or inaccessible mount points.
    }
  }

  mounts.sort((left, right) => left.mountpoint === "/" ? -1 : right.mountpoint === "/" ? 1 : left.mountpoint.localeCompare(right.mountpoint));
  const primary = mounts.find((mount) => mount.mountpoint === "/") || mounts[0] || null;
  return { mounts, primary, volumeCount: mounts.length, generatedAt: new Date().toISOString() };
}

export async function storageSummary() {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await buildStorageSummary();
  cached = { value, expiresAt: Date.now() + CACHE_MS };
  return value;
}
