import { describe, expect, test } from "@jest/globals";
import PrivateRecordParts, {
  ALSO_PART_OF,
  PRIVATE_RECORD_TABLES,
  PrivateRecordPartModel,
} from "../../../Types/PrivateRecord/PrivateRecordParts";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeRoleMember from "../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import Log from "../../../Models/AnalyticsModels/Log";

/*
 * THE KINDS OF RECORD THAT CAN BE PRIVATE, AND WHAT IS A PART OF ONE, as the
 * dashboard reads them to decide which of a page's gates ask with what the
 * reader holds on its private record (PrivateRecordScope). The server's
 * rule reads the same list and the same metadata (PrivateRecordParts.test
 * under Tests/Server holds the two to each other for every model).
 */

describe("PRIVATE_RECORD_TABLES", () => {
  test("are the incident, the alert and the two kinds of episode", () => {
    expect([...PRIVATE_RECORD_TABLES]).toEqual([
      "Incident",
      "Alert",
      "IncidentEpisode",
      "AlertEpisode",
    ]);
  });

  test("a scheduled maintenance event is never private", () => {
    expect(
      PrivateRecordParts.isPrivateRecordTable(
        new ScheduledMaintenance().tableName,
      ),
    ).toBe(false);
  });

  test.each([undefined, null, "", "Monitor", "incident"])(
    "%p is no table of a private kind",
    (tableName: string | null | undefined) => {
      expect(PrivateRecordParts.isPrivateRecordTable(tableName)).toBe(false);
    },
  );
});

describe("PrivateRecordParts.getKindsOf", () => {
  test.each([
    ["an incident", ["Incident"], new Incident()],
    ["an alert", ["Alert"], new Alert()],
    ["an incident episode", ["IncidentEpisode"], new IncidentEpisode()],
    ["an alert episode", ["AlertEpisode"], new AlertEpisode()],
    ["an incident's state change", ["Incident"], new IncidentStateTimeline()],
    ["an incident's private note", ["Incident"], new IncidentInternalNote()],
    ["an incident's owner team", ["Incident"], new IncidentOwnerTeam()],
    ["an incident's role", ["Incident"], new IncidentMember()],
    ["an alert's private note", ["Alert"], new AlertInternalNote()],
    [
      "an incident episode's role",
      ["IncidentEpisode"],
      new IncidentEpisodeRoleMember(),
    ],
    // Read through the incident, and as much a part of the alert it links.
    [
      "an incident's link to an alert",
      ["Incident", "Alert"],
      new IncidentAlert(),
    ],
    [
      "an incident episode's member row",
      ["Incident", "IncidentEpisode"],
      new IncidentEpisodeMember(),
    ],
    [
      "an alert episode's member row",
      ["Alert", "AlertEpisode"],
      new AlertEpisodeMember(),
    ],
  ])(
    "%s is a part of %j",
    (_name: string, kinds: Array<string>, model: PrivateRecordPartModel) => {
      expect(PrivateRecordParts.getKindsOf(model)).toEqual(kinds);

      for (const kind of kinds) {
        expect(PrivateRecordParts.isPartOf(model, kind)).toBe(true);
      }
    },
  );

  test.each([
    ["a monitor", new Monitor()],
    ["a monitor's status change", new MonitorStatusTimeline()],
    ["a scheduled maintenance event", new ScheduledMaintenance()],
    [
      "a scheduled maintenance event's state change",
      new ScheduledMaintenanceStateTimeline(),
    ],
    ["a log line, an analytics model", new Log()],
  ])(
    "%s is a part of no private record",
    (_name: string, model: PrivateRecordPartModel) => {
      expect(PrivateRecordParts.getKindsOf(model)).toEqual([]);

      for (const kind of PRIVATE_RECORD_TABLES) {
        expect(PrivateRecordParts.isPartOf(model, kind)).toBe(false);
      }
    },
  );

  test("an incident's part is no part of an alert, nor an alert's of an incident", () => {
    expect(
      PrivateRecordParts.isPartOf(new IncidentInternalNote(), "Alert"),
    ).toBe(false);
    expect(
      PrivateRecordParts.isPartOf(new AlertInternalNote(), "Incident"),
    ).toBe(false);
    // An episode's member row is a part of its episode and its member only.
    expect(
      PrivateRecordParts.isPartOf(new IncidentEpisodeMember(), "Alert"),
    ).toBe(false);
  });

  test("a model with no metadata to read is a part of nothing - only a private kind is itself", () => {
    expect(PrivateRecordParts.getKindsOf({})).toEqual([]);
    expect(PrivateRecordParts.getKindsOf({ tableName: "Widget" })).toEqual([]);
    expect(
      PrivateRecordParts.getKindsOf({
        tableName: "Widget",
        canAccessIfCanReadOn: "incident",
      }),
    ).toEqual([]);
    expect(PrivateRecordParts.getKindsOf({ tableName: "Incident" })).toEqual([
      "Incident",
    ]);
  });

  test("a model of ALSO_PART_OF whose columns are not listed is a part of the record it is read through", () => {
    const incidentAlert: IncidentAlert = new IncidentAlert();

    expect(
      PrivateRecordParts.getKindsOf({
        tableName: incidentAlert.tableName,
        canAccessIfCanReadOn: incidentAlert.canAccessIfCanReadOn,
        getTableColumnMetadata: (column: string): unknown => {
          return incidentAlert.getTableColumnMetadata(column);
        },
      }),
    ).toEqual(["Incident"]);
  });

  test("ALSO_PART_OF names the keys of the second record of each part that has one", () => {
    expect(ALSO_PART_OF).toEqual({
      AlertEpisodeMember: ["alertEpisodeId"],
      IncidentEpisodeMember: ["incidentEpisodeId"],
      IncidentAlert: ["alertId"],
    });
  });
});
