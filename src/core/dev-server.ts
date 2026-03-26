import type { ProjectConfig } from "./types.js";

export const DEV_SERVER_ORIGIN = "http://localhost:3000";

const DEV_SERVER_CONTENT_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".pdf", "application/pdf"],
  [".wasm", "application/wasm"],
]);

export function withDevServerConfig(config: ProjectConfig): ProjectConfig {
  return {
    ...config,
    rootDomain: DEV_SERVER_ORIGIN,
  };
}

export function getDevServerPathCandidates(requestUrl: string | undefined): string[] {
  const url = new URL(requestUrl ?? "/", DEV_SERVER_ORIGIN);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/") {
    return ["/index.json"];
  }

  if (pathname.endsWith("/")) {
    return [`${pathname}index.json`, `${pathname}index.html`];
  }

  const lastSegment = pathname.split("/").pop() ?? "";
  if (lastSegment.includes(".")) {
    return [pathname];
  }

  return [pathname, `${pathname}/index.json`, `${pathname}/index.html`, `${pathname}.json`];
}

export function getDevServerContentType(filePath: string): string {
  const normalizedPath = filePath.toLowerCase();

  for (const [extension, contentType] of DEV_SERVER_CONTENT_TYPES) {
    if (normalizedPath.endsWith(extension)) {
      return contentType;
    }
  }

  return "application/octet-stream";
}
