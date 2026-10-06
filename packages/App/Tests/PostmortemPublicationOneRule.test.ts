import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONE RULE FOR "THE STATUS PAGE SHOWS THE POSTMORTEM".
 *
 * Three places decide it: the status page, which shows the postmortem; the
 * incident service, which tells subscribers once, when an update publishes
 * it; and the send job, which skips one the status page would not show.
 * Each used to have its own check (the switch alone, the note's mere
 * presence on an update, the switch plus a trimmed note), so a save of an
 * unchanged postmortem re-sent it, and a postmortem switched on without a
 * note sent an empty one. They now all ask IncidentPostmortemPublication,
 * and this keeps them asking it.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relativePath), "utf8");
}

const STATUS_PAGE_DETAIL: string =
  "App/FeatureSet/StatusPage/src/Pages/Incidents/Detail.tsx";
const SEND_JOB: string =
  "App/FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers.ts";
const INCIDENT_SERVICE: string = "Common/Server/Services/IncidentService.ts";

describe("the postmortem's one publication rule", () => {
  test("the status page shows the postmortem by it", () => {
    const source: string = read(STATUS_PAGE_DETAIL);

    expect(source).toContain(
      'import IncidentPostmortemPublication from "Common/Types/StatusPage/IncidentPostmortemPublication";',
    );
    expect(source).toContain(
      "IncidentPostmortemPublication.isPublished(incident)",
    );
    // Its own copy of the check is gone.
    expect(source).not.toMatch(/postmortemNote\.trim\(\)\s*!==\s*""/);
  });

  test("the send job skips by it, and looks again after such a skip", () => {
    const source: string = read(SEND_JOB);

    expect(source).toContain(
      "if (!IncidentPostmortemPublication.isPublished(incident)) {",
    );
    expect(source).toContain(
      "await requeueIfPublishedSinceRead(incident.id!);",
    );
    expect(source).not.toContain("IncidentPostmortemPublication.hasNote(");
  });

  test("the incident service queues by it, never by the note's mere presence on an update", () => {
    const source: string = read(INCIDENT_SERVICE);

    expect(source).toContain(
      "IncidentPostmortemPublication.getNotificationAction(comparison)",
    );
    expect(source).toContain(
      "IncidentPostmortemPublication.isNoteChanged(comparison)",
    );
    expect(source).not.toMatch(
      /hasOwnProperty\.call\(\s*updatedIncidentData,\s*"postmortemNote"/,
    );
  });
});
