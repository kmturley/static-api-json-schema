import type { ProjectConfig } from "./types.js";

export const DEV_SERVER_ORIGIN = "http://localhost:3000";

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
