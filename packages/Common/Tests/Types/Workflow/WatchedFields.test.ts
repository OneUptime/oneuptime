/*
 * The columns an On Update trigger's Fields to watch hears a change to
 * (Types/Workflow/WatchedFields). An update is reported by the columns it
 * changed, and a relation to one record by the column holding its ID - so a
 * workflow watching "Current Incident State", as the old list let anyone
 * pick, hears a state change through currentIncidentStateId. It used to hear
 * nothing, ever.
 */

import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { getWatchedColumns } from "../../../Types/Workflow/WatchedFields";
import { describe, expect, test } from "@jest/globals";

describe("the columns Fields to watch hears", () => {
  test("a record's own field, by its name", () => {
    expect(
      getWatchedColumns({ listenOn: { title: true }, model: new Incident() }),
    ).toEqual(["title"]);
  });

  test("a relation to one record, by its name and by the column holding its ID", () => {
    expect(
      getWatchedColumns({
        listenOn: { currentIncidentState: { name: true } },
        model: new Incident(),
      }),
    ).toEqual(["currentIncidentState", "currentIncidentStateId"]);
    expect(
      getWatchedColumns({
        listenOn: { currentMonitorStatus: true },
        model: new Monitor(),
      }),
    ).toEqual(["currentMonitorStatus", "currentMonitorStatusId"]);
  });

  test("a relation to many records, by its name, which is how an update names it", () => {
    expect(
      getWatchedColumns({ listenOn: { labels: true }, model: new Incident() }),
    ).toEqual(["labels"]);
  });

  test("each column once, whatever the keys hold, in their order", () => {
    expect(
      getWatchedColumns({
        listenOn: {
          currentIncidentStateId: true,
          currentIncidentState: false,
          title: "anything",
        },
        model: new Incident(),
      }),
    ).toEqual(["currentIncidentStateId", "currentIncidentState", "title"]);
  });

  test("a key that is no column is heard as written, as it always was", () => {
    expect(
      getWatchedColumns({
        listenOn: { nonsense: true },
        model: new Incident(),
      }),
    ).toEqual(["nonsense"]);
  });

  test("nothing watched hears nothing", () => {
    expect(getWatchedColumns({ listenOn: {}, model: new Incident() })).toEqual(
      [],
    );
  });
});
