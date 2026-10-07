import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Permission from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs say about a scheduled maintenance event's Change Monitor
 * Status to, against the product: who may change it (the columns' update
 * lists), until when (the event's start), and the exact words a reader
 * meets once the event has started - the Edit's read-only line, and the
 * API's refusal (read from their sources rather than imported: App tests
 * never import a React module, nor the server's services).
 *
 * The other languages' subscriber pages do not carry this paragraph yet;
 * they fall back to the English one.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const EDIT_FIELDS_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceAffectedResourcesFormFields.tsx",
);

const SERVICE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Services/ScheduledMaintenanceService.ts",
);

function readPage(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

// The API's refusal, as the service words it.
function refusalMessage(): string {
  const source: string = fs.readFileSync(SERVICE_FILE, "utf8");
  const message: string | undefined = source.match(
    /export const MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE: string =\s*"([^"]+)";/,
  )?.[1];

  expect(message).toBeDefined();

  return message!;
}

// The Edit's read-only line, as the started field describes itself.
function readOnlyLine(): string {
  const source: string = fs
    .readFileSync(EDIT_FIELDS_FILE, "utf8")
    .replace(/\s+/g, " ");
  const started: number = source.indexOf("if (hasEventStarted) {");

  expect(started).toBeGreaterThan(-1);

  const line: string | undefined = source
    .slice(started)
    .match(/description: "([^"]+)",/)?.[1];

  expect(line).toBeDefined();

  return line!;
}

function updateListOf(column: string): Array<Permission> {
  const access: ColumnAccessControl | null =
    new ScheduledMaintenance().getColumnAccessControlFor(column);

  return [...(access?.update || [])].sort();
}

describe("the subscribers page, on an event's Change Monitor Status to", () => {
  const page: string = readPage("en", "status-pages/subscribers");

  test("the words a reader meets after the start are the product's own", () => {
    expect(readOnlyLine()).toBe(
      "The event has started, so this can no longer be changed.",
    );
    expect(page).toContain(`"${readOnlyLine()}"`);
    expect(page).toContain(`"${refusalMessage()}"`);
  });

  test("says it can be changed until the event starts, by whoever can edit the event", () => {
    expect(page).toContain(
      "Anyone who can edit the event can change its monitor status until the event starts.",
    );

    // Whoever can edit the event: the status takes the event's update list.
    const editors: Array<Permission> = [
      ...new ScheduledMaintenance().getUpdatePermissions(),
    ].sort();

    expect(updateListOf("changeMonitorStatusTo")).toEqual(editors);
    expect(updateListOf("changeMonitorStatusToId")).toEqual(editors);
  });

  test("says the Edit asks it under the monitors, once there is one", () => {
    expect(page).toContain(
      "The **Edit** button on its **Affected Resources** card asks the same way as the form: **Monitors**, then **Change Monitor Status to** once there is a monitor, then **Other Affected Resources**",
    );
  });

  test("says the monitors take the status held when the event starts, however it starts", () => {
    expect(page).toContain(
      "its monitors change to the status it holds at that moment, and so do monitors added while it runs.",
    );
    for (const how of [
      "at its start time",
      "by hand",
      "Slack or Microsoft Teams",
      "through the API",
    ]) {
      expect(`${how}: ${page.includes(how)}`).toBe(`${how}: true`);
    }
  });

  test("no longer says the status is fixed when the event is created", () => {
    expect(page).not.toContain(
      "the monitor status is set when the event is created",
    );
  });

  test("keeps the template's own wording", () => {
    expect(page).toContain(
      "anyone who can edit the template can change it there.",
    );
  });
});

describe("the Terraform examples, on an event's change_monitor_status_to_id", () => {
  const page: string = readPage("en", "terraform/examples");

  test("say it changes in place until the event starts, and quote the refusal after", () => {
    expect(page).toContain(
      "Terraform changes `change_monitor_status_to_id` in place until the event starts.",
    );
    expect(page).toContain(`"${refusalMessage()}"`);
  });

  test("say when the monitors take it", () => {
    expect(page).toContain(
      "the monitors change to it when the event starts, and back to operational when it ends.",
    );
  });
});
