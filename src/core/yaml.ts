import fs from "node:fs/promises";

import { parseAllDocuments, type ParsedNode } from "yaml";
import { z } from "zod";

import { BuildError } from "./errors.js";
import type { JsonObject } from "./types.js";

const MAX_YAML_BYTES = 1024 * 1024;

export async function loadYamlFile(filePath: string): Promise<JsonObject> {
  let content: string;

  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_YAML_BYTES) {
      throw new BuildError("Source YAML file exceeds 1 MB", {
        code: "YAML_TOO_LARGE",
        filePath,
      });
    }
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof BuildError) {
      throw error;
    }
    throw new BuildError("Source file is unreadable", {
      code: "UNREADABLE_FILE",
      filePath,
    });
  }

  const documents = parseAllDocuments(content, {
    uniqueKeys: true,
    merge: false,
  });

  if (documents.length !== 1) {
    throw new BuildError("Each YAML source file must contain exactly one YAML document", {
      code: "MULTI_DOCUMENT_YAML",
      filePath,
    });
  }

  const document = documents[0];
  if (!document) {
    throw new BuildError("Each YAML source file must contain exactly one YAML document", {
      code: "MULTI_DOCUMENT_YAML",
      filePath,
    });
  }
  const firstError = document.errors[0];
  if (firstError) {
    throw new BuildError(firstError.message, {
      code: "YAML_PARSE_ERROR",
      filePath,
      line: firstError.linePos?.[0]?.line,
    });
  }

  if (containsAlias(document.contents)) {
    throw new BuildError("YAML anchors and aliases are out of scope and must be rejected", {
      code: "YAML_ALIAS_NOT_SUPPORTED",
      filePath,
    });
  }

  const data = document.toJSON();
  const parsed = z.record(z.string(), z.unknown()).safeParse(data);
  if (!parsed.success) {
    throw new BuildError("YAML root must be a mapping object", {
      code: "INVALID_YAML_ROOT",
      filePath,
    });
  }

  return parsed.data as JsonObject;
}

function containsAlias(node: ParsedNode | null | undefined): boolean {
  if (!node) {
    return false;
  }

  if ((node as { type?: string }).type === "ALIAS") {
    return true;
  }

  const value = node as {
    items?: unknown[];
    key?: ParsedNode;
    value?: ParsedNode;
  };

  if (Array.isArray(value.items)) {
    return value.items.some((item) => containsAlias(item as ParsedNode));
  }

  if (value.key && containsAlias(value.key)) {
    return true;
  }

  if (value.value && containsAlias(value.value)) {
    return true;
  }

  return false;
}
