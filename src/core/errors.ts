export class BuildError extends Error {
  readonly code: string;
  readonly filePath?: string;
  readonly fieldPath?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly versionId?: string;
  readonly line?: number;
  readonly generatedPath?: string;
  readonly normalizedValue?: string;
  readonly originalValue?: string;
  readonly conflictingSource?: string;
  readonly referencePath?: string;

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
      generatedPath?: string;
      normalizedValue?: string;
      originalValue?: string;
      conflictingSource?: string;
      referencePath?: string;
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
    this.generatedPath = options.generatedPath;
    this.normalizedValue = options.normalizedValue;
    this.originalValue = options.originalValue;
    this.conflictingSource = options.conflictingSource;
    this.referencePath = options.referencePath;
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
  if (error.generatedPath) {
    details.push(`generatedPath=${error.generatedPath}`);
  }
  if (error.normalizedValue) {
    details.push(`normalizedValue=${error.normalizedValue}`);
  }
  if (error.originalValue) {
    details.push(`originalValue=${error.originalValue}`);
  }
  if (error.conflictingSource) {
    details.push(`conflictingSource=${error.conflictingSource}`);
  }
  if (error.referencePath) {
    details.push(`referencePath=${error.referencePath}`);
  }

  return details.length > 0
    ? `${error.message} (${details.join(", ")})`
    : error.message;
}
