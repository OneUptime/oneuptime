import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Users, Teams & Permissions says, right after how a request is decided,
 * that every field of a record is read with the record's own read
 * permission, that secrets are narrower, and which permission reads each
 * telemetry signal - metrics included, which a custom role reads with Read
 * Telemetry Service Metrics. This reads every copy and holds the
 * permissions it names to their titles in the product: the dashboard shows
 * permission titles untranslated, so every language quotes them in English.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const PAGE: string = "permissions/index.md";

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

function readPage(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, PAGE), "utf8");
}

const NAMED_PERMISSIONS: Array<Permission> = [
  Permission.ReadTelemetryServiceLog,
  Permission.ReadTelemetryServiceTraces,
  Permission.ReadTelemetryServiceMetrics,
  Permission.ReadRumSessionReplay,
  Permission.ReadRumSessionReplayPayload,
];

const NUMBERED_STEP: RegExp = /^\d+\. /;

// The paragraph after the numbered steps of how a request is decided.
function paragraphAfterTheSteps(language: string): string {
  const lines: Array<string> = readPage(language).split("\n");
  let lastStep: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("6. ");
  });

  expect([language, lastStep >= 0]).toEqual([language, true]);

  // The steps after the sixth, one line each.
  while (NUMBERED_STEP.test(lines[lastStep + 1] || "")) {
    lastStep++;
  }

  expect([language, lines[lastStep + 1]]).toEqual([language, ""]);

  return lines[lastStep + 2] || "";
}

describe("Users, Teams & Permissions: what reading a record reads", () => {
  test("every docs language is checked", () => {
    expect(LANGUAGES.length).toBe(17);
    expect(LANGUAGES).toContain("en");
  });

  test.each(LANGUAGES)(
    "%s: the paragraph after the steps names each permission by its product title",
    (language: string) => {
      const paragraph: string = paragraphAfterTheSteps(language);

      for (const permission of NAMED_PERMISSIONS) {
        const title: string = PermissionHelper.getTitle(permission);

        expect([language, title, paragraph.includes(`**${title}**`)]).toEqual([
          language,
          title,
          true,
        ]);
      }
    },
  );

  test("the English page says a field is read with its record's own permission, and secrets by who may edit it", () => {
    const paragraph: string = paragraphAfterTheSteps("en");

    expect(paragraph).toContain(
      "Every field of a record is read with the record's own read permission: a permission for another kind of record never opens it.",
    );
    expect(paragraph).toContain(
      "Secrets are read only by people who may edit or administer the record they belong to",
    );
    expect(paragraph).toContain("server agent key");
    expect(paragraph).toContain("a workflow's webhook and incoming email keys");
    expect(paragraph).toContain(
      "**Read Telemetry Service Metrics** reads metrics",
    );
  });

  /*
   * The metric permission's own description is what the permission
   * reference page draws, and it says what the permission now does.
   */
  test("the metric permission reads metrics", () => {
    expect(
      PermissionHelper.getDescription(Permission.ReadTelemetryServiceMetrics),
    ).toContain("read Telemetry Service Metrics");
  });
});
