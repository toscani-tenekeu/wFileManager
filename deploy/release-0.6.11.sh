#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="0.6.11"
WORKDIR="$(mktemp -d)"
REPO="$WORKDIR/wFileManager"
ENV_FILE="/etc/wfilemanager/wfilemanager.env"
SUPABASE_URL="https://igihzeyfgwhnuiflamvn.supabase.co"
BUCKET="releases.kmerhosting.com"
PREFIX="wfilemanager"
PUBLIC_BASE="$SUPABASE_URL/storage/v1/object/public/$BUCKET/$PREFIX"

cleanup() {
  unset SUPABASE_SERVICE_ROLE_KEY 2>/dev/null || true
  rm -rf -- "$WORKDIR"
}
trap cleanup EXIT

cd /root

echo "==> Cloning main"
git clone --depth 1 https://github.com/toscani-tenekeu/wFileManager.git "$REPO"
cd "$REPO"
git config user.name "toscani-tenekeu"
git config user.email "hello@toscani-tenekeu.com"

echo "==> Applying consolidated 0.6.11 changes"
python3 <<'PY'
from pathlib import Path
import json
import re

VERSION = "0.6.11"


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, value):
    Path(path).write_text(value, encoding="utf-8")


def replace_required(value, old, new, label):
    if old not in value:
        raise SystemExit(f"Unable to patch {label}")
    return value.replace(old, new, 1)

# Version synchronization.
package_path = Path("package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
package["version"] = VERSION
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

for filename, pattern, replacement in [
    ("src/lib/demo/data.ts", r'wfmVersion: "[0-9]+\.[0-9]+\.[0-9]+"', f'wfmVersion: "{VERSION}"'),
    ("src/lib/server/local-runtime.ts", r'WFILEMANAGER_VERSION \|\| "[0-9]+\.[0-9]+\.[0-9]+"', f'WFILEMANAGER_VERSION || "{VERSION}"'),
]:
    content = read(filename)
    content, count = re.subn(pattern, replacement, content, count=1)
    if count != 1:
        raise SystemExit(f"Unable to update version in {filename}")
    write(filename, content)

# Remove the fake/demo server details from Setup while retaining SERVER_INFO for internal setup payloads.
setup_path = "src/routes/setup.tsx"
setup = read(setup_path)
setup, _ = re.subn(
    r'\s*<dl className="grid grid-cols-3 gap-y-1 text-xs">\s*'
    r'<dt className="text-muted-foreground">Hostname</dt>.*?'
    r'<dt className="text-muted-foreground">Operating system</dt>.*?'
    r'<dt className="text-muted-foreground">Kernel</dt>.*?'
    r'</dl>',
    "",
    setup,
    count=1,
    flags=re.DOTALL,
)
write(setup_path, setup)

# Remove every visible product logo. Keep favicon.svg only for the browser tab.
logo_pattern = re.compile(
    r'\s*<img\b[^>]*src=["\']/wfilemanager-logo\.png["\'][^>]*/>\s*',
    flags=re.DOTALL,
)
for file in Path("src").rglob("*.tsx"):
    content = file.read_text(encoding="utf-8")
    updated, count = logo_pattern.subn("\n", content)
    if count:
        updated = updated.replace('className="flex items-center gap-2"', 'className="flex items-center"')
        updated = updated.replace('className="inline-flex items-center gap-2"', 'className="inline-flex items-center"')
        file.write_text(updated, encoding="utf-8")

for file in Path("src").rglob("*"):
    if file.is_file() and file.suffix.lower() in {".ts", ".tsx", ".js", ".jsx", ".html", ".json"}:
        content = file.read_text(encoding="utf-8")
        if "/wfilemanager-logo.png" in content:
            file.write_text(content.replace("/wfilemanager-logo.png", "/favicon.svg"), encoding="utf-8")

Path("public/wfilemanager-logo.png").unlink(missing_ok=True)

# Add a real Linux login-user count to the system summary.
runtime_path = "src/lib/server/local-runtime.ts"
runtime = read(runtime_path)
if "loginUsers:" not in runtime:
    marker = "  return {\n    hostname: os.hostname(),"
    insertion = '''  let loginUsers = 0;
  try {
    const passwd = await readFile("/etc/passwd", "utf8");
    loginUsers = passwd
      .split("\\n")
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
  return {
    loginUsers,
    hostname: os.hostname(),'''
    runtime = replace_required(runtime, marker, insertion, "system login-user count")
write(runtime_path, runtime)

# Type the new system field in the browser API.
local_api_path = "src/lib/local-api.ts"
local_api = read(local_api_path)
if "loginUsers: number;" not in local_api:
    local_api = replace_required(
        local_api,
        "  system: () => get<{\n    hostname: string;",
        "  system: () => get<{\n    loginUsers: number;\n    hostname: string;",
        "local API loginUsers type",
    )
write(local_api_path, local_api)

# Replace Overview filesystem scanning with the real Linux user count.
overview_path = "src/routes/_app.index.tsx"
overview = read(overview_path)
overview = overview.replace("  Files,\n", "")
overview = overview.replace('import { storageAnalysisApi, type StorageAnalysis } from "@/lib/storage-analysis-api";\n', "")
overview = re.sub(r'\n  const \[analysis, setAnalysis\].*?;\n  const \[analysisError, setAnalysisError\].*?;', "", overview)
overview = overview.replace("  const load = async (refreshAnalysis = false) => {", "  const load = async () => {")
overview = overview.replace("    setAnalysisError(null);\n", "")
overview = replace_required(
    overview,
    '''      const [systemResult, trashResult, analysisResult] = await Promise.all([
        localApi.system(),
        localApi.trash.list().catch(() => ({ items: [], totalSize: 0 })),
        storageAnalysisApi.get(refreshAnalysis).catch((cause) => {
          setAnalysisError(cause instanceof Error ? cause.message : "Filesystem analysis is unavailable");
          return null;
        }),
      ]);
      setSystem(systemResult);
      setTrash({ items: trashResult.items.length, size: trashResult.totalSize });
      setAnalysis(analysisResult);''',
    '''      const [systemResult, trashResult] = await Promise.all([
        localApi.system(),
        localApi.trash.list().catch(() => ({ items: [], totalSize: 0 })),
      ]);
      setSystem(systemResult);
      setTrash({ items: trashResult.items.length, size: trashResult.totalSize });''',
    "Overview load",
)
overview = re.sub(r'\n  const filesystemItems = .*?;', "", overview)
overview = overview.replace("onClick={() => void load(true)}", "onClick={() => void load()}")
overview = replace_required(
    overview,
    '<Stat label="Filesystem items" value={analysis ? filesystemItems.toLocaleString() : "—"} sub={analysis ? `${analysis.totalFiles.toLocaleString()} files · ${analysis.totalDirectories.toLocaleString()} folders across /` : analysisError ? "Filesystem scan unavailable" : "Scanning the root filesystem"} icon={Files} />',
    '<Stat label="Server users" value={system ? system.loginUsers.toLocaleString() : "—"} sub={system ? "Linux accounts with login access" : "User information unavailable"} icon={Users} />',
    "Overview user card",
)
write(overview_path, overview)

# Simplify archive extraction to two selects and one Extract action.
explorer_path = "src/routes/_app.explorer.tsx"
explorer = read(explorer_path)
if 'const [extractMode, setExtractMode]' not in explorer:
    explorer = replace_required(
        explorer,
        '  const [extractConflictPolicy, setExtractConflictPolicy] = useState<ConflictPolicy>("rename");',
        '  const [extractConflictPolicy, setExtractConflictPolicy] = useState<ConflictPolicy>("rename");\n  const [extractMode, setExtractMode] = useState<ExtractionMode>("current");',
        "extract mode state",
    )
explorer = explorer.replace(
    '        setExtractConflictPolicy("rename");\n        setExtractPlan({ entry, inspection });',
    '        setExtractConflictPolicy("rename");\n        setExtractMode("current");\n        setExtractPlan({ entry, inspection });',
)

new_dialog = '''      <Dialog open={Boolean(extractPlan)} onOpenChange={(open) => !open && setExtractPlan(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Extract archive</DialogTitle>
            <DialogDescription>
              Choose the destination and how existing items should be handled.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {extractPlan?.inspection.multipleTopLevel && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-medium">Several first-level items will be extracted.</p>
                <p className="mt-1 text-muted-foreground">Using the current directory will place them directly beside the archive.</p>
              </div>
            )}

            {(extractPlan?.inspection.defaultConflicts.length || 0) > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-medium">Existing items were detected.</p>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{extractPlan?.inspection.defaultConflicts.join(", ")}</p>
              </div>
            )}

            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Destination</label>
              <select
                value={extractMode}
                onChange={(event) => setExtractMode(event.target.value as ExtractionMode)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="current">Current directory</option>
                <option value="folder">New folder</option>
                <option value="custom">Other destination</option>
              </select>
            </div>

            {extractMode === "folder" && (
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Folder name</label>
                <Input value={extractFolderName} onChange={(event) => setExtractFolderName(event.target.value)} className="font-mono" />
              </div>
            )}

            {extractMode === "custom" && (
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Destination path</label>
                <Input value={extractDestination} onChange={(event) => setExtractDestination(event.target.value)} className="font-mono" />
              </div>
            )}

            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Existing items</label>
              <select
                value={extractConflictPolicy}
                onChange={(event) => setExtractConflictPolicy(event.target.value as ConflictPolicy)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="rename">Keep both using (1), (2)…</option>
                <option value="overwrite">Replace existing items</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExtractPlan(null)}>Cancel</Button>
            <Button
              disabled={(extractMode === "folder" && !extractFolderName.trim()) || (extractMode === "custom" && !extractDestination.trim())}
              onClick={() => void confirmExtraction(extractMode)}
            >
              Extract
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>'''

explorer, count = re.subn(
    r'      <Dialog open=\{Boolean\(extractPlan\)\}.*?\n      </Dialog>',
    new_dialog,
    explorer,
    count=1,
    flags=re.DOTALL,
)
if count != 1:
    raise SystemExit("Unable to replace the archive extraction dialog")
write(explorer_path, explorer)

# Final source assertions.
assert "Filesystem items" not in read(overview_path)
assert "Server users" in read(overview_path)
assert "Extract here" not in read(explorer_path)
assert "Extract into new folder" not in read(explorer_path)
assert "Extract to destination" not in read(explorer_path)
assert "Hostname</dt>" not in read(setup_path)
assert not Path("public/wfilemanager-logo.png").exists()
for file in Path("src").rglob("*"):
    if file.is_file() and file.suffix.lower() in {".ts", ".tsx", ".js", ".jsx"}:
        assert "/wfilemanager-logo.png" not in file.read_text(encoding="utf-8")
PY

echo "==> Loading production build configuration"
test -f "$ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-${WFILEMANAGER_SUPABASE_URL:-}}"
export VITE_WFILEMANAGER_INSTANCE_KEY="${VITE_WFILEMANAGER_INSTANCE_KEY:-${WFILEMANAGER_INSTANCE_KEY:-}}"
test -n "$VITE_SUPABASE_URL"
test -n "$VITE_WFILEMANAGER_INSTANCE_KEY"
cp "$ENV_FILE" .env

echo "==> Testing 0.6.11"
bun install --frozen-lockfile
git diff --check
bun run typecheck
bun run build

test -f .output/server/index.mjs
test ! -e public/wfilemanager-logo.png
! grep -R --line-number --fixed-strings '/wfilemanager-logo.png' src
grep -q 'label="Server users"' src/routes/_app.index.tsx
! grep -q 'Filesystem items' src/routes/_app.index.tsx
! grep -q 'Extract here' src/routes/_app.explorer.tsx

bun -e '
import { systemSummary } from "./src/lib/server/local-runtime.ts";
const result = await systemSummary();
if (!Number.isInteger(result.loginUsers) || result.loginUsers < 1) {
  throw new Error(`Invalid login-user count: ${result.loginUsers}`);
}
console.log(`Linux login users: ${result.loginUsers}`);
'

echo "==> Committing source changes"
git add -A
git commit -m "Release 0.6.11 with simplified extraction and user overview"
SOURCE_COMMIT="$(git rev-parse HEAD)"
git push origin main

echo "==> Creating verified release assets"
mkdir -p release-assets
ARCHIVE="wfilemanager-$VERSION.tar.gz"
git archive --format=tar.gz --prefix="wfilemanager-$VERSION/" --output="release-assets/$ARCHIVE" "$SOURCE_COMMIT"

cp \
  deploy/install.sh \
  deploy/update.sh \
  deploy/wfilemanager.service \
  deploy/wfilemanager-updater@.service \
  deploy/migrate-existing-vps.sh \
  release-assets/

chmod 755 release-assets/install.sh release-assets/update.sh release-assets/migrate-existing-vps.sh

ARCHIVE_SHA="$(sha256sum "release-assets/$ARCHIVE" | awk '{print $1}')"
ARCHIVE_SIZE="$(stat -c '%s' "release-assets/$ARCHIVE")"
INSTALL_SHA="$(sha256sum release-assets/install.sh | awk '{print $1}')"
UPDATER_SHA="$(sha256sum release-assets/update.sh | awk '{print $1}')"
APP_SERVICE_SHA="$(sha256sum release-assets/wfilemanager.service | awk '{print $1}')"
UPDATER_SERVICE_SHA="$(sha256sum release-assets/wfilemanager-updater@.service | awk '{print $1}')"
MIGRATION_SHA="$(sha256sum release-assets/migrate-existing-vps.sh | awk '{print $1}')"
PUBLISHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

jq -n \
  --arg version "$VERSION" \
  --arg publishedAt "$PUBLISHED_AT" \
  --arg releaseUrl "$PUBLIC_BASE/$ARCHIVE" \
  --arg installUrl "$PUBLIC_BASE/install.sh" \
  --arg sha256 "$ARCHIVE_SHA" \
  --argjson size "$ARCHIVE_SIZE" \
  --arg installerSha256 "$INSTALL_SHA" \
  --arg updaterSha256 "$UPDATER_SHA" \
  --arg appServiceSha256 "$APP_SERVICE_SHA" \
  --arg updaterServiceSha256 "$UPDATER_SERVICE_SHA" \
  --arg migrationPatchSha256 "$MIGRATION_SHA" \
'{
  schema: 1,
  product: "wfilemanager",
  channel: "stable",
  version: $version,
  publishedAt: $publishedAt,
  minimumVersion: "0.6.0",
  releaseUrl: $releaseUrl,
  url: $releaseUrl,
  sha256: $sha256,
  size: $size,
  installUrl: $installUrl,
  canonicalBaseUrl: "https://releases.kmerhosting.com/wfilemanager",
  githubUrl: "https://github.com/toscani-tenekeu/wFileManager",
  compatibility: {
    operatingSystem: "Ubuntu >= 20.04 LTS",
    recommended: "Ubuntu 24.04 LTS",
    architectures: ["amd64", "arm64"]
  },
  notes: [
    "Simplifies archive extraction to one destination selector, one conflict selector and a single Extract action.",
    "Replaces filesystem item counts on Overview with the real number of Linux login users.",
    "Removes visible product logos and aligns the wFileManager name to the left.",
    "Removes demo hostname, operating system and kernel details from first-run setup."
  ],
  assets: {
    installer: $installUrl,
    installerSha256: $installerSha256,
    updater: "https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/update.sh",
    updaterSha256: $updaterSha256,
    appService: "https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/wfilemanager.service",
    appServiceSha256: $appServiceSha256,
    updaterService: "https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/wfilemanager-updater@.service",
    updaterServiceSha256: $updaterServiceSha256,
    migrationPatch: "https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/migrate-existing-vps.sh",
    migrationPatchSha256: $migrationPatchSha256
  }
}' > release-assets/stable.json

(
  cd release-assets
  sha256sum \
    install.sh \
    migrate-existing-vps.sh \
    stable.json \
    update.sh \
    "$ARCHIVE" \
    wfilemanager-updater@.service \
    wfilemanager.service \
    > SHA256SUMS
  sha256sum -c SHA256SUMS
)

echo "==> Synchronizing release metadata on GitHub"
mkdir -p release
cp release-assets/stable.json release/stable.json
cp release-assets/SHA256SUMS release/SHA256SUMS
git add release/stable.json release/SHA256SUMS
git commit -m "Update stable release metadata for 0.6.11"
git push origin main

echo "==> Publishing stable 0.6.11"
read -rsp "Supabase service_role key: " SUPABASE_SERVICE_ROLE_KEY
echo
export SUPABASE_SERVICE_ROLE_KEY
test -n "$SUPABASE_SERVICE_ROLE_KEY"
bash deploy/publish-release.sh release-assets
unset SUPABASE_SERVICE_ROLE_KEY

REMOTE_MANIFEST="$(curl -fsSL "$PUBLIC_BASE/stable.json?ts=$(date +%s)")"
test "$(jq -r '.version' <<<"$REMOTE_MANIFEST")" = "$VERSION"
test "$(jq -r '.sha256' <<<"$REMOTE_MANIFEST")" = "$ARCHIVE_SHA"
test "$(jq -r '.size' <<<"$REMOTE_MANIFEST")" = "$ARCHIVE_SIZE"

echo "==> Installing stable 0.6.11"
if ! systemctl start wfilemanager-updater@install.service; then
  journalctl -u wfilemanager-updater@install.service -n 160 --no-pager
  exit 1
fi

CURRENT_RELEASE="$(readlink -f /opt/wfilemanager/current)"
INSTALLED_VERSION="$(jq -r '.version' "$CURRENT_RELEASE/package.json")"
test "$INSTALLED_VERSION" = "$VERSION"
systemctl is-active --quiet wfilemanager.service

for attempt in $(seq 1 40); do
  if curl -fsS --max-time 3 http://127.0.0.1:1973/ >/dev/null 2>&1; then
    echo
    echo "wFileManager $VERSION published and installed successfully."
    echo "Source commit: $SOURCE_COMMIT"
    echo "Installed release: $CURRENT_RELEASE"
    exit 0
  fi
  sleep 1
done

journalctl -u wfilemanager.service -n 120 --no-pager
exit 1
