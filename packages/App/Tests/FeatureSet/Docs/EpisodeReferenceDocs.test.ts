import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisodeMember from "Common/Models/DatabaseModels/AlertEpisodeMember";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import {
  getTerraformAttribute,
  getTerraformTypeName,
} from "Common/Utils/DeveloperDocs/TerraformSchema";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An incident's or alert's episode is read-only: it follows the episode's
 * members, and a create or update that sends it is refused for every caller
 * (EpisodeMembershipReference). The API reference says so, in English and
 * in Persian, which keeps it in step, and names what to use instead; the
 * upgrade notes say what changed. Markdown is not compiled, so these hold
 * the pages to the models they describe.
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

// The section under `heading`, up to the next heading.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(heading);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.slice(start + heading.length);
  const end: number = rest.search(/\n#{2,3} /);

  return end === -1 ? rest : rest.slice(0, end);
}

const API_REFERENCE: string = "api-reference/api-reference";
const EN_HEADING: string = "### The episode an incident or alert is in";
const FA_HEADING: string = "### اپیزودی که یک حادثه یا هشدار در آن است";

// What both pages name, in the words the server and the provider use.
const NAMED: Array<string> = [
  "`incidentEpisodeId`",
  "`alertEpisodeId`",
  "`incidentEpisode`",
  "`alertEpisode`",
  "`POST /api/incident-episode-member`",
  "`/api/alert-episode-member`",
  "`incidentId`",
  "`alertId`",
  "`incident_episode_id`",
  "`alert_episode_id`",
  "`oneuptime_incident_episode_member`",
  "`oneuptime_alert_episode_member`",
];

function writeLists(
  model: DatabaseBaseModel,
  column: string,
): { create: unknown; update: unknown } {
  const accessControl: ColumnAccessControl | undefined =
    model.getColumnAccessControlForAllColumns()[column];

  return {
    create: accessControl?.create,
    update: accessControl?.update,
  };
}

describe("the API reference on the episode an incident or alert is in", () => {
  test.each([
    ["en", EN_HEADING, "read-only"],
    ["fa", FA_HEADING, "فقط‌خواندنی"],
  ])(
    "%s says it is read-only and names the members to use instead",
    (language: string, heading: string, readOnly: string) => {
      const text: string = section(read(language, API_REFERENCE), heading);

      expect(text).toContain(readOnly);

      for (const name of NAMED) {
        expect({ language, name, named: text.includes(name) }).toEqual({
          language,
          name,
          named: true,
        });
      }
    },
  );

  test("nobody may write the columns it names read-only, under either name", () => {
    for (const [model, columns] of [
      [new Incident(), ["incidentEpisodeId", "incidentEpisode"]],
      [new Alert(), ["alertEpisodeId", "alertEpisode"]],
    ] as Array<[DatabaseBaseModel, Array<string>]>) {
      for (const column of columns) {
        expect({ column, ...writeLists(model, column) }).toEqual({
          column,
          create: [],
          update: [],
        });
      }
    }
  });

  test("the endpoints and Terraform names it gives are the real ones", () => {
    expect(new IncidentEpisodeMember().getCrudApiPath()?.toString()).toBe(
      "/incident-episode-member",
    );
    expect(new AlertEpisodeMember().getCrudApiPath()?.toString()).toBe(
      "/alert-episode-member",
    );

    expect(getTerraformTypeName(IncidentEpisodeMember)).toBe(
      "oneuptime_incident_episode_member",
    );
    expect(getTerraformTypeName(AlertEpisodeMember)).toBe(
      "oneuptime_alert_episode_member",
    );

    // Read, never set: no attribute a configuration could hold.
    expect(
      getTerraformAttribute(Incident, "incidentEpisodeId"),
    ).toBeUndefined();
    expect(getTerraformAttribute(Alert, "alertEpisodeId")).toBeUndefined();

    // The members it names are what a membership row is made of.
    for (const [model, columns] of [
      [new IncidentEpisodeMember(), ["incidentEpisodeId", "incidentId"]],
      [new AlertEpisodeMember(), ["alertEpisodeId", "alertId"]],
    ] as Array<[DatabaseBaseModel, Array<string>]>) {
      for (const column of columns) {
        expect(model.isTableColumn(column)).toBe(true);
      }
    }
  });
});

describe("the upgrade notes", () => {
  const page: string = read("en", "installation/upgrading");

  test("say what changed for 14, and link to the section under its anchor", () => {
    const changes: string = section(page, "### Other changes in 14");

    expect(changes).toContain(
      "**An incident's or alert's episode is set by the episode's members\n  only.**",
    );

    const link: string = `(/docs/api-reference/api-reference#${slugify(
      EN_HEADING.replace(/^#+\s*/, ""),
    )})`;

    expect(link).toBe(
      "(/docs/api-reference/api-reference#the-episode-an-incident-or-alert-is-in)",
    );
    expect(changes).toContain(link);
  });
});
