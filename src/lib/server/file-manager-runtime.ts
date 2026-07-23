import os from "node:os";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const COMMON_LOCATIONS = ["/", "/root", "/etc", "/var/www", "/opt"] as const;
const MAX_TEXT_BYTES = Number(process.env.WFILEMANAGER_MAX_TEXT_BYTES || 5 * 1024 * 1024);
const MAX_UPLOAD_BYTES = Number(process.env.WFILEMANAGER_MAX_UPLOAD_BYTES || 10 * 1024 * 1024 * 1024);

async function osRelease() {
  const result: Record<string, string> = {};
  try {
    const value = await readFile("/etc/os-release", "utf8");
    for (const line of value.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      result[match[1]] = match[2].trim().replace(/^(\"|')(.*)\1$/, "$2");
    }
  } catch {
    // The generic Node platform values below remain available.
  }
  return result;
}

async function locationStatus(path: string) {
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) return { path, exists: false, readable: false, writable: false, entries: null as number | null };
  const [readable, writable, entries] = await Promise.all([
    access(path, fsConstants.R_OK).then(() => true).catch(() => false),
    access(path, fsConstants.W_OK).then(() => true).catch(() => false),
    readdir(path).then((items) => items.length).catch(() => null),
  ]);
  return { path, exists: true, readable, writable, entries };
}

async function linuxLoginUsers() {
  try {
    const passwd = await readFile("/etc/passwd", "utf8");
    return passwd
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(":"))
      .filter((parts) => {
        const username = parts[0] || "";
        const uid = Number(parts[2]);
        const shell = parts[6] || "";
        const interactive = Boolean(shell) && !shell.endsWith("/nologin") && !shell.endsWith("/false");
        return interactive && (username === "root" || uid >= 1000);
      }).length;
  } catch {
    return 0;
  }
}

export async function fileManagerSummary() {
  const [release, locations, loginUsers] = await Promise.all([
    osRelease(),
    Promise.all(COMMON_LOCATIONS.map(locationStatus)),
    linuxLoginUsers(),
  ]);
  const root = locations.find((location) => location.path === "/") || null;
  const availableLocations = locations.filter((location) => location.exists && location.readable).length;
  const writableLocations = locations.filter((location) => location.exists && location.writable).length;

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    uptime: os.uptime(),
    node: process.version,
    loginUsers,
    root: {
      path: "/",
      entries: root?.entries ?? null,
      readable: root?.readable ?? false,
      writable: root?.writable ?? false,
    },
    locations,
    availableLocations,
    writableLocations,
    totalCommonLocations: COMMON_LOCATIONS.length,
    editorLimitBytes: MAX_TEXT_BYTES,
    uploadLimitBytes: MAX_UPLOAD_BYTES,
    protectedPseudoFilesystems: ["/proc", "/sys", "/dev", "/run"],
    os: {
      id: release.ID || os.platform(),
      name: release.NAME || os.platform(),
      versionId: release.VERSION_ID || os.release(),
      versionCodename: release.VERSION_CODENAME || "",
      prettyName: release.PRETTY_NAME || `${os.platform()} ${os.release()}`,
    },
    generatedAt: new Date().toISOString(),
  };
}
