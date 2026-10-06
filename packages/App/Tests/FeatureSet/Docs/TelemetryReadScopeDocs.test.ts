import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Users, Teams & Permissions says how far a telemetry permission reads -
 * All resources, Owned, Labels - and that a block with labels leaves the
 * telemetry of the resources carrying them out, wherever telemetry is read
 * (Common/Server/Utils/Telemetry/TelemetryReadScope). Step 6 of how a
 * request is decided says what a block with labels does to a record that
 * has no labels of its own. This pins the English sentences, that every
 * language has the section in the same place with as many points, and
 * that the session replay page says the same for recordings.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

function readPage(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

function headings(markdown: string): Array<string> {
  return markdown.split("\n").filter((line: string): boolean => {
    return line.startsWith("## ");
  });
}

// The lines of the section that follows the Labels section (the 8th heading).
function telemetrySection(markdown: string): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const headingLines: Array<number> = lines
    .map((line: string, index: number): number => {
      return line.startsWith("## ") ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });

  return lines.slice(headingLines[7]!, headingLines[8]!);
}

function bulletCount(section: Array<string>): number {
  return section.filter((line: string): boolean => {
    return line.startsWith("- **");
  }).length;
}

describe("Users, Teams & Permissions: whose telemetry a permission reads", () => {
  const english: string = readPage("en", "permissions/index.md");

  test("every docs language is checked", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test("the English section sits after Labels and says how far each scope reads", () => {
    const section: Array<string> = telemetrySection(english);

    expect(section[0]).toBe("## Telemetry");
    expect(headings(english)[6]).toBe("## Labels");
    expect(headings(english)[8]).toBe("## API keys");

    const text: string = section.join("\n");
    expect(text).toContain(
      "- **All resources** reads the telemetry of every resource in the project.",
    );
    expect(text).toContain(
      "- **Owned** reads the telemetry of the resources you or one of your teams own, and telemetry that names no resource.",
    );
    expect(text).toContain(
      "- **Labels** reads the telemetry of the resources carrying one of the permission's labels.",
    );
    expect(text).toContain(
      "A block with labels on a telemetry permission leaves out the telemetry of the resources carrying those labels, whatever else you hold.",
    );
    expect(text).toContain(
      "The list of metric names shows the metrics a service you may read reports, and the metrics no service reports",
    );
  });

  test("step 6 says what a block with labels does to a record with no labels of its own", () => {
    const stepSix: string | undefined = english
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("6. ");
      });

    expect(stepSix).toContain(
      "When a record has no labels of its own, such as an incident note or a status page announcement, a block with labels on reading it leaves it out if a record it belongs to carries one of those labels.",
    );
  });

  test.each(LANGUAGES)(
    "%s has the section in the same place, with as many points as English",
    (language: string) => {
      const guide: string = readPage(language, "permissions/index.md");

      expect([language, headings(guide).length]).toEqual([
        language,
        headings(english).length,
      ]);
      expect([language, bulletCount(telemetrySection(guide))]).toEqual([
        language,
        bulletCount(telemetrySection(english)),
      ]);
      // Translated, not copied.
      if (language !== "en") {
        expect(telemetrySection(guide)[0]).not.toBe("## API keys");
      }
    },
  );

  test("the session replay page says Owned and blocks with labels apply to recordings too", () => {
    const page: string = readPage("en", "telemetry/session-replay.md");

    expect(page).toContain(
      "A member whose grant is scoped to **Owned** reaches the applications they or one of their teams own, and a block with labels on one of these permissions takes the applications carrying those labels away, whatever else the member holds.",
    );
  });
});
