import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { LocalApiError, normalizeServerPath } from "@/lib/server/local-runtime";
import type { LocalUser } from "@/lib/server/local-auth-runtime";

export interface LocalPathRule {
  id?: string;
  path: string;
  accessMode: "allow" | "deny";
  recursive: boolean;
  source?: "user" | "role";
}

function normalizedRulePath(input: unknown) {
  const value = normalizeServerPath(typeof input === "string" ? input : "/");
  return value === "/" ? value : value.replace(/\/+$/, "");
}

function ruleMatches(target: string, rule: LocalPathRule) {
  const root = normalizedRulePath(rule.path);
  if (target === root) return true;
  return rule.recursive && (root === "/" || target.startsWith(`${root}${path.sep}`));
}

function decisionFor(user: LocalUser, targetInput: string) {
  if (user.isAdmin) return true;
  const target = normalizeServerPath(targetInput);
  const rules = Array.isArray(user.pathRules) ? user.pathRules : [];
  const matches = rules
    .filter((rule) => rule && ruleMatches(target, rule))
    .sort((left, right) => {
      const length = normalizedRulePath(right.path).length - normalizedRulePath(left.path).length;
      if (length) return length;
      const source = Number(right.source === "user") - Number(left.source === "user");
      if (source) return source;
      return Number(left.accessMode === "deny") - Number(right.accessMode === "deny");
    });
  return matches[0]?.accessMode === "allow";
}

function assertDecision(user: LocalUser, requested: string, canonical: string) {
  if (!decisionFor(user, requested) || !decisionFor(user, canonical)) {
    throw new LocalApiError(403, "Your account is not allowed to access this filesystem path");
  }
}

export async function assertExistingPathAllowed(user: LocalUser, inputPath: unknown) {
  const requested = normalizeServerPath(inputPath);
  const info = await lstat(requested).catch(() => null);
  if (!info) throw new LocalApiError(404, "The selected filesystem path does not exist");
  const canonical = await realpath(requested).catch(() => requested);
  assertDecision(user, requested, canonical);
  return canonical;
}

export async function assertDestinationPathAllowed(user: LocalUser, inputPath: unknown) {
  const requested = normalizeServerPath(inputPath);
  const parent = path.dirname(requested);
  const canonicalParent = await realpath(parent).catch(() => null);
  if (!canonicalParent) throw new LocalApiError(404, "The destination parent directory does not exist");
  const canonical = path.join(canonicalParent, path.basename(requested));
  assertDecision(user, requested, canonical);
  return canonical;
}

export async function assertDirectoryPathAllowed(user: LocalUser, inputPath: unknown) {
  const target = await assertExistingPathAllowed(user, inputPath);
  const info = await lstat(target);
  if (!info.isDirectory()) throw new LocalApiError(400, "The selected path is not a directory");
  return target;
}

export function assertKnownPathAllowed(user: LocalUser, inputPath: unknown) {
  const target = normalizeServerPath(inputPath);
  if (!decisionFor(user, target)) {
    throw new LocalApiError(403, "Your account is not allowed to access this filesystem path");
  }
  return target;
}
