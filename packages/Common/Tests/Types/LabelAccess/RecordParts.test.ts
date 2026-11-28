import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import RecordParts, {
  PARTS_NAMING_OTHER_LABELLED_RECORDS,
} from "../../../Types/LabelAccess/RecordParts";
import { describe, expect, test } from "@jest/globals";

/*
 * A RECORD'S PARTS, AS THE DASHBOARD TELLS THEM (#11435): a model with no
 * labels of its own read through a record, the record it names and by
 * which key, and whether its rows carry the record's labels alone. The
 * guard RecordPartsGuard (Tests/Server/Types/Database/Permissions) holds
 * the written-down list to the server's own reading of every model.
 */

describe("the record a part is read through", () => {
  test.each([
    [new MonitorOwnerUser(), "Monitor", "monitorId"],
    [new MonitorOwnerTeam(), "Monitor", "monitorId"],
    [new MonitorProbe(), "Monitor", "monitorId"],
    [new MonitorStatusTimeline(), "Monitor", "monitorId"],
    [new IncidentInternalNote(), "Incident", "incidentId"],
  ])("%s is read through its %s, by %s", (model: unknown, table: string, key: string) => {
    expect(RecordParts.getRecordOf(model as never)).toEqual({
      tableName: table,
      key: key,
      isList: false,
    });
    expect(RecordParts.isPartOf(model as never, table)).toBe(true);
    expect(RecordParts.isPartOf(model as never, "Alert")).toBe(false);
  });

  test("an announcement is read through a list of status pages", () => {
    expect(RecordParts.getRecordOf(new StatusPageAnnouncement())).toEqual({
      tableName: "StatusPage",
      key: "",
      isList: true,
    });
  });

  test("a record with labels of its own is no part, nor is a model read through nothing", () => {
    expect(RecordParts.getRecordOf(new Monitor())).toBeNull();
    expect(RecordParts.getRecordOf(new Incident())).toBeNull();
    expect(RecordParts.getRecordOf(new Label())).toBeNull();
    expect(RecordParts.getRecordOf(null)).toBeNull();
    expect(RecordParts.getRecordOf({ tableName: "Anything" })).toBeNull();
  });

  test("a team's members are no part of any record: a team reads them through no record", () => {
    expect(RecordParts.getRecordOf(new TeamMember())).toBeNull();
  });
});

describe("whether a part's rows carry the record's labels alone", () => {
  test.each([
    [new MonitorOwnerUser(), true],
    [new MonitorOwnerTeam(), true],
    [new MonitorStatusTimeline(), true],
    // A monitor's probe names its probe, which carries labels of its own.
    [new MonitorProbe(), false],
    // An announcement may be on several status pages.
    [new StatusPageAnnouncement(), false],
  ])("%s: %s", (model: unknown, expected: boolean) => {
    expect(RecordParts.namesOnlyItsRecord(model as never)).toBe(expected);
  });

  test("the list is written in alphabetical order, each part once", () => {
    expect([...PARTS_NAMING_OTHER_LABELLED_RECORDS]).toEqual(
      [...new Set(PARTS_NAMING_OTHER_LABELLED_RECORDS)].sort(),
    );
  });
});
