import path from "node:path";

import { BuildError } from "./errors.js";

export const RESOURCE_SEGMENT_PATTERN = /^[a-z0-9-]+$/;
export const VERSION_SEGMENT_PATTERN = /^[a-z0-9.-]+$/;
export const RESERVED_SEGMENTS = new Set(["search", "versions", "latest", "docs", "assets"]);

export function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function normalizeRootDomain(value: string): string {
  return stripTrailingSlash(value);
}

export function toSearchSlug(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (normalized.length === 0) {
    throw new BuildError("Search value normalizes to an empty path segment", {
      code: "INVALID_SEARCH_VALUE",
    });
  }

  return normalized;
}

export function assertSafeResourceSegment(value: string, label: string, filePath: string): void {
  if (!RESOURCE_SEGMENT_PATTERN.test(value)) {
    throw new BuildError(`${label} must contain only lowercase ASCII letters, digits, and hyphens`, {
      code: "INVALID_PATH_SEGMENT",
      filePath,
      originalValue: value,
    });
  }
  if (RESERVED_SEGMENTS.has(value)) {
    throw new BuildError(`${label} collides with a reserved generated path segment`, {
      code: "RESERVED_PATH_SEGMENT",
      filePath,
      originalValue: value,
      normalizedValue: value,
    });
  }
}

export function assertSafeVersionSegment(value: string, filePath: string): void {
  if (!VERSION_SEGMENT_PATTERN.test(value)) {
    throw new BuildError("Version identifier must contain only lowercase ASCII letters, digits, periods, and hyphens", {
      code: "INVALID_VERSION_SEGMENT",
      filePath,
      originalValue: value,
    });
  }
  if (RESERVED_SEGMENTS.has(value)) {
    throw new BuildError("Version identifier collides with a reserved generated path segment", {
      code: "RESERVED_PATH_SEGMENT",
      filePath,
      originalValue: value,
      normalizedValue: value,
    });
  }
}

export function assertSemver(value: string, filePath: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/i.test(value)) {
    throw new BuildError("Version identifier must follow semantic versioning", {
      code: "INVALID_SEMVER",
      filePath,
    });
  }
}

export function compareSemverDesc(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);

  for (let index = 0; index < 3; index += 1) {
    const diff = (pb.core[index] ?? 0) - (pa.core[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  if (pa.prerelease.length === 0 && pb.prerelease.length > 0) {
    return -1;
  }
  if (pa.prerelease.length > 0 && pb.prerelease.length === 0) {
    return 1;
  }

  const max = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let index = 0; index < max; index += 1) {
    const av = pa.prerelease[index];
    const bv = pb.prerelease[index];

    if (av === undefined) {
      return -1;
    }
    if (bv === undefined) {
      return 1;
    }

    const aNum = /^\d+$/.test(av) ? Number(av) : undefined;
    const bNum = /^\d+$/.test(bv) ? Number(bv) : undefined;

    if (aNum !== undefined && bNum !== undefined) {
      if (aNum !== bNum) {
        return bNum - aNum;
      }
      continue;
    }

    if (aNum !== undefined) {
      return -1;
    }
    if (bNum !== undefined) {
      return 1;
    }

    if (av !== bv) {
      return bv.localeCompare(av);
    }
  }

  return 0;
}

function parseSemver(value: string): {
  core: [number, number, number];
  prerelease: string[];
} {
  const match = value.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z-]+(?:\.[0-9a-z-]+)*))?(?:\+([0-9a-z-]+(?:\.[0-9a-z-]+)*))?$/i,
  );
  if (!match) {
    throw new Error(`Invalid semver: ${value}`);
  }

  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

export function ensureInsideRoot(rootPath: string, targetPath: string, filePath: string, fieldPath?: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new BuildError("Path escapes the resources root", {
      code: "PATH_ESCAPE",
      filePath,
      fieldPath,
    });
  }

  return resolvedTarget;
}

export function toRegularCharacterSort(values: string[]): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function pathToPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function maybeString(value: unknown): value is string {
  return typeof value === "string";
}
