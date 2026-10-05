import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Create Alert and both Create Episode forms start the record in the
 * Initial State picked, as Declare Incident does, and the API, Terraform
 * and workflows take the same choice on create. The docs say so where a
 * reader looks for it: the API reference (English, and Persian, which keeps
 * it in step), the declare page that describes the Initial State field, and
 * the subscribers page that says what an incident episode announces.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

// The paragraphs of the section under `heading`, up to the next heading.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(heading);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.slice(start + heading.length);
  const end: number = rest.search(/\n#{2,3} /);

  return end === -1 ? rest : rest.slice(0, end);
}

const API_REFERENCE: string = "api-reference/api-reference";
const EN_HEADING: string = "### The state a new record starts in";
const FA_HEADING: string = "### وضعیتی که رکورد تازه در آن آغاز می‌شود";

describe("the API reference on the state a new record starts in", () => {
  test.each([
    ["en", EN_HEADING],
    ["fa", FA_HEADING],
  ])(
    "%s names the state column of each record, under the names the server reads",
    (language: string, heading: string) => {
      const text: string = section(read(language, API_REFERENCE), heading);

      for (const column of [
        "currentIncidentStateId",
        "currentAlertStateId",
        "isCreatedState",
        "current_incident_state_id",
        "current_alert_state_id",
        "**Initial State**",
      ]) {
        expect(text).toContain(column);
      }
    },
  );

  test("the columns it names are the records' own", () => {
    for (const model of [new Incident(), new IncidentEpisode()]) {
      expect(model.isTableColumn("currentIncidentStateId")).toBe(true);
      expect(model.isTableColumn("currentIncidentState")).toBe(true);
    }

    for (const model of [new Alert(), new AlertEpisode()]) {
      expect(model.isTableColumn("currentAlertStateId")).toBe(true);
      expect(model.isTableColumn("currentAlertState")).toBe(true);
    }

    expect(new IncidentState().isTableColumn("isCreatedState")).toBe(true);
  });

  test("English says a state left out is the created state and another project's is refused", () => {
    const text: string = section(read("en", API_REFERENCE), EN_HEADING);

    expect(text).toContain(
      "Leave it out and it starts in your project's created state",
    );
    expect(text).toContain(
      "A state of another project is refused like any other record.",
    );
  });

  test("Persian keeps the section beside the one on records named two ways, as English does", () => {
    for (const [language, heading] of [
      ["en", EN_HEADING],
      ["fa", FA_HEADING],
    ] as Array<[string, string]>) {
      const page: string = read(language, API_REFERENCE);
      const conflict: number = page.indexOf("Conflicting Monitor references");
      const state: number = page.indexOf(heading);
      const next: number = page.indexOf("\n### ", state + heading.length);

      expect(conflict).toBeGreaterThan(0);
      expect(state).toBeGreaterThan(conflict);
      // The API Reference link stays the last section.
      expect(next).toBeGreaterThan(state);
    }
  });
});

describe("the declare page on alerts and episodes", () => {
  const declaring: string = read("en", "incidents/declaring-incidents");

  test("says Create Alert and Create Episode start in the Initial State picked", () => {
    expect(declaring).toContain(
      "**Alerts and episodes start in the state you pick, too.**",
    );
    expect(declaring).toContain("**Create Alert**");
    expect(declaring).toContain("**Create Episode**");
    expect(declaring).toContain(
      "Left empty, the alert or episode starts in the project's created state.",
    );
  });

  test("links to the API reference section, which exists under that anchor", () => {
    const link: RegExpMatchArray | null = declaring.match(
      /\]\(\/docs\/api-reference\/api-reference#([^)]+)\)/,
    );

    expect(link).not.toBeNull();
    expect(link![1]).toBe(slugify(EN_HEADING.replace(/^#+\s*/, "")));
  });
});

describe("the subscribers page on an incident episode's first state", () => {
  test("says the created notification announces it, once", () => {
    const text: string = section(
      read("en", "status-pages/subscribers"),
      "### Incident episodes",
    );

    expect(text).toContain("An episode created in a later state");
    expect(text).toContain(
      "its first state is never sent again as a state change",
    );
  });
});
