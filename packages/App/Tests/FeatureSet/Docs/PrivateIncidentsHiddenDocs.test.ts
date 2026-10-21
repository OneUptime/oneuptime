import { HidePrivateIncidentsFromStatusPages1799200000000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1799200000000-HidePrivateIncidentsFromStatusPages";
import StatusPageVisibility from "Common/Types/StatusPage/StatusPageVisibility";
import { coerceBooleanColumnsInJSON } from "Common/Types/Database/BooleanColumnValue";
import Incident from "Common/Models/DatabaseModels/Incident";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs against the rule that a private incident or episode is never
 * shown on a status page (StatusPageVisibility): visible, and not private.
 *
 * The English pages say what the product does - the two switches kept in
 * step on every write, the same for episodes, what an upgrade changes - and
 * Markdown is not compiled, so these tests are what notices when the pages
 * and the product part ways.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content/en",
);

function readDoc(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, page), "utf8");
}

// The text under a heading, up to the next heading of the same or a higher level.
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line === heading;
  });

  expect(start).toBeGreaterThan(-1);

  const level: number = heading.indexOf(" ");
  const rest: Array<string> = lines.slice(start + 1);
  const end: number = rest.findIndex((line: string): boolean => {
    const match: RegExpMatchArray | null = line.match(/^(#+) /);
    return Boolean(match) && match![1]!.length <= level;
  });

  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

const OFF_THE_STATUS_PAGE: string = section(
  readDoc("incidents/states-and-severities.md"),
  "## Keeping an incident off the status page",
);

describe("the docs on private incidents and status pages", () => {
  test("say a private incident is hidden from every status page and its subscribers", () => {
    expect(OFF_THE_STATUS_PAGE).toContain(
      "Turning on **Private Incident** hides the incident from every status page",
    );
    expect(OFF_THE_STATUS_PAGE).toContain(
      "Nothing about it reaches a status page subscriber either",
    );

    // As the rule has it.
    expect(
      StatusPageVisibility.isShown({
        isVisibleOnStatusPage: true,
        isPrivate: true,
      }),
    ).toBe(false);
  });

  test("say the two switches are kept in step, whoever writes them", () => {
    expect(OFF_THE_STATUS_PAGE).toContain(
      "Making an incident private switches **Visible on Status Page** off with it.",
    );
    expect(OFF_THE_STATUS_PAGE).toContain(
      "Turning **Visible on Status Page** on while the incident stays private leaves it off.",
    );

    for (const writer of [
      "the dashboard",
      "the API",
      "Terraform",
      "a workflow",
      "a monitor",
      "an incident template",
      "a privacy rule",
    ]) {
      expect(OFF_THE_STATUS_PAGE).toContain(writer);
    }

    // And as the rule writes them.
    const madePrivate: Record<string, unknown> = {
      isPrivate: true,
      isVisibleOnStatusPage: true,
    };
    StatusPageVisibility.normalizeWrite(madePrivate);
    expect(madePrivate["isVisibleOnStatusPage"]).toBe(false);

    /*
     * A switch sent as text is the boolean the database stores before any
     * hook reads it: DatabaseService turns every Boolean column of a write
     * into it first (Types/Database/BooleanColumnValue), then the incident's
     * hook keeps the two switches in step.
     */
    const asText: Record<string, unknown> = coerceBooleanColumnsInJSON(
      { isPrivate: "true" },
      new Incident(),
    );
    StatusPageVisibility.normalizeWrite(asText);
    expect(asText).toEqual({ isPrivate: true, isVisibleOnStatusPage: false });

    // The rule itself reads the text as the database stores it, too.
    const textOnly: Record<string, unknown> = { isPrivate: "yes" };
    StatusPageVisibility.normalizeWrite(textOnly);
    expect(textOnly["isVisibleOnStatusPage"]).toBe(false);
    expect(OFF_THE_STATUS_PAGE).toContain(
      'A value sent as text, such as `"true"`, counts the same as `true`.',
    );
  });

  test("say episodes follow the same rule, and the episode's switch is locked off while it is private", () => {
    expect(OFF_THE_STATUS_PAGE).toContain(
      "**Episodes follow the same rule.** A private incident episode is hidden from every status page",
    );
    expect(OFF_THE_STATUS_PAGE).toContain(
      "stays off while the episode is private",
    );
    expect(readDoc("status-pages/one-status-page-per-audience.md")).toContain(
      "A private incident reaches no page, so it never brings its episode onto one, and a private episode is shown on no page at all.",
    );
  });

  test("say what an upgrade changes: the switch off on private records, nothing sent", async () => {
    expect(OFF_THE_STATUS_PAGE).toContain(
      "have it switched off when you upgrade. Nothing is sent to anyone.",
    );

    const statements: Array<string> = [];

    await new HidePrivateIncidentsFromStatusPages1799200000000().up({
      query: async (sql: string): Promise<void> => {
        statements.push(sql);
      },
    } as never);

    // Incidents and episodes, the switch only.
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement).toContain(`SET "isVisibleOnStatusPage" = false`);
      expect(statement).toContain(`"isPrivate" IS TRUE`);
    }
  });

  test("the subscriber checks a public note clears name privacy with the switch", () => {
    expect(readDoc("incidents/notes-owners-and-feed.md")).toContain(
      "4. The incident's **Visible on Status Page** flag (`isVisibleOnStatusPage`) must be true, and the incident must not be private (`isPrivate`).",
    );
  });
});
