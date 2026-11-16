import Incident from "../../../../Models/DatabaseModels/Incident";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ServerSetColumns from "../../../../Server/Utils/Database/ServerSetColumns";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MARK ONEUPTIME'S OWN CODE PUTS ON A RECORD IT CREATES AS A PERSON
 * (ServerSetColumns): the server-set columns it filled in, whose values are
 * OneUptime's on that record and not the person's. The mark is the record
 * object itself: nothing that is not that object carries it.
 */
describe("ServerSetColumns", () => {
  test("set writes the values into the record and marks their columns", () => {
    const row: MonitorStatusTimeline = new MonitorStatusTimeline();
    const statusChangeLog: JSONObject = { reason: "declared" };

    ServerSetColumns.set(row, {
      isOwnerNotified: true,
      statusChangeLog: statusChangeLog,
    });

    expect(row.isOwnerNotified).toBe(true);
    expect(row.statusChangeLog).toBe(statusChangeLog);
    expect(ServerSetColumns.isMarked(row, "isOwnerNotified")).toBe(true);
    expect(ServerSetColumns.isMarked(row, "statusChangeLog")).toBe(true);
    expect(ServerSetColumns.getMarked(row)).toEqual([
      "isOwnerNotified",
      "statusChangeLog",
    ]);
  });

  test("a value left undefined is neither written nor marked", () => {
    const row: MonitorStatusTimeline = new MonitorStatusTimeline();

    ServerSetColumns.set(row, {
      isOwnerNotified: false,
      statusChangeLog: undefined,
    });

    expect(row.isOwnerNotified).toBe(false);
    expect(row.statusChangeLog).toBeUndefined();
    expect(ServerSetColumns.isMarked(row, "isOwnerNotified")).toBe(true);
    expect(ServerSetColumns.isMarked(row, "statusChangeLog")).toBe(false);
  });

  test("false and null are values: they are written and marked", () => {
    const row: Incident = new Incident();

    ServerSetColumns.set(row, {
      isOwnerNotifiedOfResourceCreation: false,
      createdStateLog: null,
    });

    expect(ServerSetColumns.getMarked(row)).toEqual([
      "isOwnerNotifiedOfResourceCreation",
      "createdStateLog",
    ]);
  });

  test("a mark is on the record it was made on, and on no copy of it", () => {
    const row: MonitorStatusTimeline = new MonitorStatusTimeline();
    ServerSetColumns.set(row, { isOwnerNotified: true });

    const sameValues: MonitorStatusTimeline = new MonitorStatusTimeline();
    sameValues.isOwnerNotified = true;

    const spread: Record<string, unknown> = {
      ...(row as unknown as Record<string, unknown>),
    };

    const fromJson: MonitorStatusTimeline = BaseModel.fromJSON(
      BaseModel.toJSON(row, MonitorStatusTimeline),
      MonitorStatusTimeline,
    ) as MonitorStatusTimeline;

    expect(ServerSetColumns.isMarked(sameValues, "isOwnerNotified")).toBe(
      false,
    );
    expect(ServerSetColumns.isMarked(spread, "isOwnerNotified")).toBe(false);
    expect(fromJson.isOwnerNotified).toBe(true);
    expect(ServerSetColumns.isMarked(fromJson, "isOwnerNotified")).toBe(false);
  });

  test("marks add up, each column once", () => {
    const row: MonitorStatusTimeline = new MonitorStatusTimeline();

    ServerSetColumns.mark(row, ["isOwnerNotified"]);
    ServerSetColumns.mark(row, ["statusChangeLog", "isOwnerNotified"]);

    expect(ServerSetColumns.getMarked(row)).toEqual([
      "isOwnerNotified",
      "statusChangeLog",
    ]);
  });

  test("an unmarked record, or something that is no record, has no marks", () => {
    expect(ServerSetColumns.getMarked(new MonitorStatusTimeline())).toEqual(
      [],
    );

    for (const notARecord of [undefined, null, "isOwnerNotified", 1, true]) {
      expect(ServerSetColumns.isMarked(notARecord, "isOwnerNotified")).toBe(
        false,
      );
      expect(ServerSetColumns.getMarked(notARecord)).toEqual([]);
    }
  });

  test("marking no columns leaves the record unmarked", () => {
    const row: MonitorStatusTimeline = new MonitorStatusTimeline();

    ServerSetColumns.mark(row, []);
    ServerSetColumns.set(row, {});

    expect(ServerSetColumns.getMarked(row)).toEqual([]);
  });
});
