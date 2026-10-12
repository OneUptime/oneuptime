import {
  REPOSITORY_DIRECTORY,
  importedNames,
  isTestCode,
} from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A CALL'S TOKENS ARE READ IN ONE PLACE.
 *
 * The token columns an AI call is stored with, its estimated cost, and the
 * numbers the trace viewer's LLM panel shows all come from
 * Common/Types/Telemetry/LlmTokenUsage. The key lists it reads are not
 * enough on their own: a convention's cached tokens are part of its input
 * count, Claude Code's traces beta counts them apart under its own bare
 * keys (read only on a span that names its model), and an input count
 * smaller than its cache counts left them out. Code that read the lists
 * directly would get the first case right and the others wrong - the way
 * Claude Code's spans used to arrive with no tokens and a cost of $0 - and
 * would show other numbers than the columns.
 *
 * So no product code but LlmTokenUsage imports the token key lists
 * (LlmConventions defines them). Tests and the docs' facts suites may.
 */

const TOKEN_KEY_LISTS: Array<string> = [
  "LlmInputTokenAttributeKeys",
  "LlmOutputTokenAttributeKeys",
  "LlmTotalTokenAttributeKeys",
  "LlmCacheReadTokenAttributeKeys",
  "LlmCacheWriteTokenAttributeKeys",
  "ClaudeCodeUsageAttributeKeys",
];

const THE_ONE_READER: string =
  "packages/Common/Types/Telemetry/LlmTokenUsage.ts";

const SCANNED_PACKAGES: Array<string> = ["packages/Common", "packages/App"];

const SKIPPED_FOLDERS: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
]);

const PRODUCT_CODE: RegExp = /\.(?:ts|tsx)$/;
const DECLARATION: RegExp = /\.d\.ts$/;

// Every TypeScript file of product code under a folder, from the repository's root.
function productFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_FOLDERS.has(entry.name)) {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...productFiles(fullPath));
      continue;
    }

    const relativePath: string = path
      .relative(REPOSITORY_DIRECTORY, fullPath)
      .split(path.sep)
      .join("/");

    if (
      entry.isFile() &&
      PRODUCT_CODE.test(entry.name) &&
      !DECLARATION.test(entry.name) &&
      !isTestCode(relativePath)
    ) {
      files.push(relativePath);
    }
  }

  return files;
}

// The token key lists a file imports.
function tokenListsImportedBy(relativePath: string): Array<string> {
  const text: string = fs.readFileSync(
    path.join(REPOSITORY_DIRECTORY, relativePath),
    "utf8",
  );

  if (
    !TOKEN_KEY_LISTS.some((name: string): boolean => {
      return text.includes(name);
    })
  ) {
    return [];
  }

  return importedNames(relativePath, text).filter((name: string): boolean => {
    return TOKEN_KEY_LISTS.includes(name);
  });
}

// Reading a few thousand files takes a moment on a runner.
const SCAN_TIMEOUT_IN_MS: number = 120000;

describe("a call's tokens are read in one place", () => {
  test(
    "no product code but LlmTokenUsage imports the token key lists",
    () => {
      const readers: Array<string> = SCANNED_PACKAGES.flatMap(
        (folder: string): Array<string> => {
          return productFiles(path.join(REPOSITORY_DIRECTORY, folder));
        },
      ).filter((relativePath: string): boolean => {
        return tokenListsImportedBy(relativePath).length > 0;
      });

      expect(readers).toEqual([THE_ONE_READER]);
    },
    SCAN_TIMEOUT_IN_MS,
  );

  test("the one reader imports every list, so a new one is read there too", () => {
    expect([...tokenListsImportedBy(THE_ONE_READER)].sort()).toEqual(
      [...TOKEN_KEY_LISTS].sort(),
    );
  });

  test("the ingest extractor and the span panel read tokens through it", () => {
    for (const reader of [
      "packages/Common/Server/Utils/Telemetry/LlmSpan.ts",
      "packages/App/FeatureSet/Dashboard/src/Utils/LlmSpanDisplay.ts",
    ]) {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, reader),
        "utf8",
      );

      expect({ reader, imports: importedNames(reader, text) }).toEqual({
        reader,
        imports: expect.arrayContaining(["LlmTokenUsageUtil"]),
      });
    }
  });
});
