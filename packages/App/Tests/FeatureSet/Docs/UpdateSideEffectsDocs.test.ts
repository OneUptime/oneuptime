import Incident from "Common/Models/DatabaseModels/Incident";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs against what an update sets off.
 *
 * A severity change runs its side effects - the feed entry, the SLA
 * deadlines, the reminder rule and the severity-change metric - whichever
 * name it is written under, and writing back the severity a record holds
 * runs none of them. "Notify status page subscribers" is chosen when a record
 * is created: no project role may change it afterwards, and a write that a
 * workflow or a master admin still can make only stores it - it never sends
 * the 'created' message again, and turned off before that message has gone
 * out, the message is skipped. Markdown is not compiled, so these tests are
 * what notices when the pages and the server part ways.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

function read(relativePath: string): string {
  return fs
    .readFileSync(path.join(CONTENT_DIR, relativePath), "utf8")
    .replace(/\s+/g, " ");
}

function updateListOf(
  model: { getColumnAccessControlForAllColumns: () => unknown },
  column: string,
): unknown {
  return (
    model.getColumnAccessControlForAllColumns() as Record<
      string,
      { update?: unknown }
    >
  )[column]?.update;
}

describe("changing an incident's severity", () => {
  const page: string = read("incidents/states-and-severities.md");

  test("names every way a severity is changed, the ID column the API and Terraform write among them", () => {
    expect(page).toContain("**Changing an incident's severity**");
    expect(page).toContain("through the API or Terraform (`incidentSeverityId`)");
    expect(page).toContain("with a workflow or with the AI tools");
    expect(page).toContain("whichever way it is sent");

    // The ID column is one the API may update.
    expect(updateListOf(new Incident(), "incidentSeverityId")).not.toEqual([]);
  });

  test("names the four things a change does", () => {
    expect(page).toContain(
      "the incident feed gets an **Incident updated** entry that names the new severity",
    );
    expect(page).toContain("the incident's SLA deadlines are worked out again");
    expect(page).toContain("its reminder rule is matched again");
    expect(page).toContain("the incident metrics count one severity change");
  });

  test("says that saving the same severity again does none of them", () => {
    expect(page).toContain(
      "Saving the severity the incident already has does none of them",
    );
  });
});

describe("notify flags written after creation", () => {
  test("the incident API docs say writing the flag only stores it, and never resends", () => {
    const page: string = read("status-pages/one-status-page-per-audience.md");

    expect(page).toContain(
      "Writing `shouldStatusPageSubscribersBeNotifiedOnIncidentCreated` is not one of these.",
    );
    expect(page).toContain(
      "no project role can change it through the API afterwards",
    );
    expect(page).toContain("but that only stores the new value");
    expect(page).toContain("sends nothing again");
    expect(page).toContain(
      "turning it on later does not send the 'created' notification the incident was declared without",
    );

    expect(
      updateListOf(
        new Incident(),
        "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
      ),
    ).toEqual([]);
  });

  test("the subscriber docs say the same of announcements and scheduled maintenance", () => {
    const page: string = read("status-pages/subscribers.md");

    expect(page).toContain(
      "A workflow that writes it later only stores it: writing it back unchanged never sends the announcement again",
    );
    expect(page).toContain(
      "a workflow that writes **When the event is scheduled** later only stores it",
    );

    expect(
      updateListOf(
        new StatusPageAnnouncement(),
        "shouldStatusPageSubscribersBeNotified",
      ),
    ).toEqual([]);
    expect(
      updateListOf(
        new ScheduledMaintenance(),
        "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
      ),
    ).toEqual([]);
  });
});
