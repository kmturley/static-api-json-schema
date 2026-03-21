export class BuildError extends Error {
  readonly code: string;
  readonly filePath?: string;
  readonly fieldPath?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly versionId?: string;
  readonly line?: number;

  constructor(
    message: string,
    options: {
      code?: string;
      filePath?: string;
      fieldPath?: string;
      resourceType?: string;
      resourceId?: string;
      versionId?: string;
      line?: number;
    } = {},
  ) {
    super(message);
    this.name = "BuildError";
    this.code = options.code ?? "BUILD_ERROR";
    this.filePath = options.filePath;
    this.fieldPath = options.fieldPath;
    this.resourceType = options.resourceType;
    this.resourceId = options.resourceId;
    this.versionId = options.versionId;
    this.line = options.line;
  }
}

export function formatError(error: unknown): string {
  if (!(error instanceof BuildError)) {
    return error instanceof Error ? error.message : String(error);
  }

  const details: string[] = [];

  if (error.filePath) {
    details.push(`file=${error.filePath}`);
  }
  if (error.fieldPath) {
    details.push(`field=${error.fieldPath}`);
  }
  if (error.resourceType) {
    details.push(`resourceType=${error.resourceType}`);
  }
  if (error.resourceId) {
    details.push(`resourceId=${error.resourceId}`);
  }
  if (error.versionId) {
    details.push(`versionId=${error.versionId}`);
  }
  if (typeof error.line === "number") {
    details.push(`line=${error.line}`);
  }

  return details.length > 0
    ? `${error.message} (${details.join(", ")})`
    : error.message;
}
