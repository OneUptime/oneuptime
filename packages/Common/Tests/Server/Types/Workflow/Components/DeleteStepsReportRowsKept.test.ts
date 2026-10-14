import IncidentStateTimeline from "../../../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../../Models/DatabaseModels/MonitorStatusTimeline";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import IncidentStateTimelineService from "../../../../../Server/Services/IncidentStateTimelineService";
import MonitorStatusTimelineService from "../../../../../Server/Services/MonitorStatusTimelineService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import DeleteManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/DeleteManyBaseModel";
import DeleteOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/DeleteOneBaseModel";
import logger from "../../../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * A WORKFLOW'S DELETE STEP SAYS WHAT THE TABLE KEPT OF THE ROWS IT MATCHED.
 *
 * A delete by query of a state timeline leaves each record's current row,
 * and a monitor's last 90 days (DatabaseService.keepRowsOnDeleteByQuery), so
 * a Delete Many or Delete One step can delete fewer rows than its query
 * matched, or none. After the delete, the step's run log says how many
 * stayed and why - counted as the step reads, with the step's own query -
 * and nothing for a table that keeps none, a query by id, or a count that
 * fails: the delete has happened, and the step still takes Success.
 */

const RECORD_ID: string = "3a000000-0000-4000-8000-000000000001";

interface OptionsFixture {
  options: RunOptions;
  lines: Array<string>;
  projectId: ObjectID;
}

function makeOptions(): OptionsFixture {
  const lines: Array<string> = [];
  const projectId: ObjectID = ObjectID.generate();

  return {
    lines,
    projectId,
    options: {
      log: (item: unknown): void => {
        lines.push(String(item));
      },
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      workflowName: "Clean up",
      projectId: projectId,
      onError: (exception: Exception): Exception => {
        return exception;
      },
    },
  };
}

interface Counted {
  query: JSONObject;
  props: DatabaseCommonInteractionProps;
}

beforeEach(() => {
  // The project's plan, which a step's props carry on a server with billing.
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Delete Many", () => {
  test("logs how many monitor status events stayed, and why, after what it deleted", async () => {
    const deletes: Array<{
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }> = [];
    const counts: Array<Counted> = [];

    jest
      .spyOn(MonitorStatusTimelineService, "deleteBy")
      .mockImplementation((async (deleteBy: {
        query: JSONObject;
        props: DatabaseCommonInteractionProps;
      }): Promise<number> => {
        deletes.push(deleteBy);
        return 12;
      }) as never);
    jest
      .spyOn(MonitorStatusTimelineService, "countRowsKeptOnDeleteByQuery")
      .mockImplementation((async (data: Counted): Promise<number> => {
        counts.push(data);
        return 3;
      }) as never);

    const fixture: OptionsFixture = makeOptions();
    const result: RunReturnType =
      await new DeleteManyBaseModel<MonitorStatusTimeline>(
        MonitorStatusTimelineService,
      ).run({ query: { monitorId: RECORD_ID }, limit: 100 }, fixture.options);

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["items-deleted"]).toBe(12);

    expect(fixture.lines).toEqual([
      "Deleted 12 Monitor Status Event(s).",
      "Kept 3 Monitor Status Events: a delete by query leaves each monitor's current status, and every status event that covers part of the last 90 days, so status pages never show a monitor gray. To delete one specific Monitor Status Event, query it by its ID.",
    ]);

    // Counted with the step's own query and as the step acts.
    expect(counts.length).toBe(1);
    expect(counts[0]!.query["monitorId"]).toBe(RECORD_ID);
    expect(counts[0]!.query["projectId"]).toEqual(fixture.projectId);
    expect(counts[0]!.props).toBe(deletes[0]!.props);
  });

  test("logs nothing more when everything matched could go", async () => {
    jest
      .spyOn(MonitorStatusTimelineService, "deleteBy")
      .mockResolvedValue(4 as never);
    jest
      .spyOn(MonitorStatusTimelineService, "countRowsKeptOnDeleteByQuery")
      .mockResolvedValue(0 as never);

    const fixture: OptionsFixture = makeOptions();
    await new DeleteManyBaseModel<MonitorStatusTimeline>(
      MonitorStatusTimelineService,
    ).run({ query: { monitorId: RECORD_ID } }, fixture.options);

    expect(fixture.lines).toEqual(["Deleted 4 Monitor Status Event(s)."]);
  });

  test("a count that fails is left out of the run's log, and the step still succeeds", async () => {
    jest
      .spyOn(MonitorStatusTimelineService, "deleteBy")
      .mockResolvedValue(4 as never);
    jest
      .spyOn(MonitorStatusTimelineService, "countRowsKeptOnDeleteByQuery")
      .mockRejectedValue(new Error("connection reset") as never);
    const errors: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    const fixture: OptionsFixture = makeOptions();
    const result: RunReturnType =
      await new DeleteManyBaseModel<MonitorStatusTimeline>(
        MonitorStatusTimelineService,
      ).run({ query: { monitorId: RECORD_ID } }, fixture.options);

    expect(result.executePort?.id).toBe("success");
    expect(fixture.lines).toEqual(["Deleted 4 Monitor Status Event(s)."]);
    expect(errors).toHaveBeenCalled();
  });

  test("words an incident timeline's kept rows its own way", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "deleteBy")
      .mockResolvedValue(0 as never);
    jest
      .spyOn(IncidentStateTimelineService, "countRowsKeptOnDeleteByQuery")
      .mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    await new DeleteManyBaseModel<IncidentStateTimeline>(
      IncidentStateTimelineService,
    ).run({ query: { incidentId: RECORD_ID } }, fixture.options);

    expect(fixture.lines).toEqual([
      "Deleted 0 Incident State Timeline(s).",
      "Kept 1 Incident State Timeline: a delete by query leaves each incident's current state, so status pages always show it. To delete one specific Incident State Timeline, query it by its ID.",
    ]);
  });

  test("asks nothing of a table that keeps no rows from a delete", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    jest.spyOn(service, "deleteBy").mockResolvedValue(2 as never);
    const count: jest.SpyInstance = jest.spyOn(
      service,
      "countRowsKeptOnDeleteByQuery",
    );

    const fixture: OptionsFixture = makeOptions();
    await new DeleteManyBaseModel<Monitor>(service).run(
      { query: { name: "Old" } },
      fixture.options,
    );

    expect(count).not.toHaveBeenCalled();
    expect(fixture.lines).toEqual(["Deleted 2 Monitor(s)."]);
  });
});

describe("Delete One", () => {
  test("by a query: says what stayed, as Delete Many does", async () => {
    jest
      .spyOn(MonitorStatusTimelineService, "deleteOneBy")
      .mockResolvedValue(0 as never);
    jest
      .spyOn(MonitorStatusTimelineService, "countRowsKeptOnDeleteByQuery")
      .mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const result: RunReturnType =
      await new DeleteOneBaseModel<MonitorStatusTimeline>(
        MonitorStatusTimelineService,
      ).run({ query: { monitorId: RECORD_ID } }, fixture.options);

    expect(result.returnValues["items-deleted"]).toBe(0);
    expect(fixture.lines).toEqual([
      "Deleted 0 Monitor Status Event(s).",
      "Kept 1 Monitor Status Event: a delete by query leaves each monitor's current status, and every status event that covers part of the last 90 days, so status pages never show a monitor gray. To delete one specific Monitor Status Event, query it by its ID.",
    ]);
  });

  test("by its id: the table's rule for one row judged it, and nothing more is said", async () => {
    jest
      .spyOn(MonitorStatusTimelineService, "deleteOneBy")
      .mockResolvedValue(1 as never);

    // The real count: it answers nothing for a query by id, without reading.
    const countBy: jest.SpyInstance = jest.spyOn(
      MonitorStatusTimelineService,
      "countBy",
    );

    const fixture: OptionsFixture = makeOptions();
    await new DeleteOneBaseModel<MonitorStatusTimeline>(
      MonitorStatusTimelineService,
    ).run({ query: { id: RECORD_ID } }, fixture.options);

    expect(countBy).not.toHaveBeenCalled();
    expect(fixture.lines).toEqual(["Deleted 1 Monitor Status Event(s)."]);
  });
});
