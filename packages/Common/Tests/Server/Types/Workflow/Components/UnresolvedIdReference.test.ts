import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateManyBaseModel";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import DeleteManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/DeleteManyBaseModel";
import DeleteOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/DeleteOneBaseModel";
import FindManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindManyBaseModel";
import FindOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindOneBaseModel";
import UpdateManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateManyBaseModel";
import UpdateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import {
  UnresolvedIdReference,
  describeUnresolvedIdReference,
  findUnresolvedIdReference,
} from "../../../../../Server/Types/Workflow/Components/BaseModel/UnresolvedIdReference";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import QueryUtil from "../../../../../Server/Types/Database/QueryUtil";
import VMAPI from "../../../../../Server/Utils/VM/VMAPI";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * Production Postgres logged, a few times a day:
 *
 *   invalid input syntax for type uuid: "{{local.components.monitor-find-o...
 *
 * A workflow's Find One Monitor step found no monitor, so the next step's
 * reference to its model had nothing to resolve to; the run left the
 * reference in that step's Query as written (VMAPI skips what it cannot
 * resolve), and the step sent it to Postgres as an incident state's id. The
 * step failed with a database error that named neither the reference nor
 * the argument it was in.
 *
 * Every database step now reads the IDs in its Query and in the records it
 * writes first, and stops on one still written as a reference, in words that
 * say which and why - before anything is read or written.
 */

const STATE_ID: string = "dfadda01-fdf6-4cdd-921d-73edcfd71124";
const MONITOR_ID: string = "09dc4d63-2fc3-4757-a509-5f688ae38ffd";
const STEP_REFERENCE: string =
  "{{local.components.monitor-find-one-1.returnValues.model.currentMonitorStatusId}}";
const VARIABLE_REFERENCE: string = "{{local.variables.stateId}}";

const incident: BaseModel = new Incident();

describe("findUnresolvedIdReference", () => {
  test.each([
    [
      "an ID column",
      { currentIncidentStateId: STEP_REFERENCE },
      "currentIncidentStateId",
      STEP_REFERENCE,
    ],
    [
      "an ID column, inside other text",
      { currentIncidentStateId: `state-${VARIABLE_REFERENCE}` },
      "currentIncidentStateId",
      VARIABLE_REFERENCE,
    ],
    ["_id", { _id: VARIABLE_REFERENCE }, "_id", VARIABLE_REFERENCE],
    [
      '"id", which is _id',
      { id: VARIABLE_REFERENCE },
      "_id",
      VARIABLE_REFERENCE,
    ],
    [
      "a serialized ObjectID",
      { currentIncidentStateId: { _type: "ObjectID", value: STEP_REFERENCE } },
      "currentIncidentStateId",
      STEP_REFERENCE,
    ],
    [
      "an operator's list",
      {
        currentIncidentStateId: {
          _type: "Includes",
          value: [STATE_ID, VARIABLE_REFERENCE],
        },
      },
      "currentIncidentStateId",
      VARIABLE_REFERENCE,
    ],
    [
      "a list",
      { incidentSeverityId: [STATE_ID, STEP_REFERENCE] },
      "incidentSeverityId",
      STEP_REFERENCE,
    ],
    [
      "an ID given for a relation",
      { currentIncidentState: STEP_REFERENCE },
      "currentIncidentState",
      STEP_REFERENCE,
    ],
    [
      "a related record's _id",
      { monitors: [{ _id: MONITOR_ID }, { _id: STEP_REFERENCE }] },
      "monitors",
      STEP_REFERENCE,
    ],
    [
      'a related record\'s "id"',
      { currentIncidentState: { id: VARIABLE_REFERENCE } },
      "currentIncidentState",
      VARIABLE_REFERENCE,
    ],
    [
      "an operator on a relation",
      { monitors: { _type: "Includes", value: [VARIABLE_REFERENCE] } },
      "monitors",
      VARIABLE_REFERENCE,
    ],
  ])(
    "finds a reference in %s",
    (
      _name: string,
      json: JSONObject,
      columnName: string,
      reference: string,
    ) => {
      expect(findUnresolvedIdReference(json, incident)).toEqual({
        columnName: columnName,
        reference: reference,
      });
    },
  );

  /*
   * A reference left in a title or a name is text the step can still run
   * with; the warning RunWorkflow writes is all it gets, as before.
   */
  test.each([
    ["resolved IDs", { _id: STATE_ID, currentIncidentStateId: STATE_ID }],
    ["a text column", { title: STEP_REFERENCE }],
    [
      "a related record's text column",
      { currentIncidentState: { name: STEP_REFERENCE } },
    ],
    ["a column the model does not have", { notAColumn: STEP_REFERENCE }],
    ["no value", { currentIncidentStateId: null }],
    ["braces that never close", { currentIncidentStateId: "{{local.x" }],
    // A text match reads the ID as text, never as a uuid.
    [
      "a text match on an ID",
      { _id: { _type: "Search", value: STEP_REFERENCE } },
    ],
    [
      "a text match on a related record's ID",
      {
        currentIncidentState: {
          _id: { _type: "StartsWith", value: VARIABLE_REFERENCE },
        },
      },
    ],
  ])("finds none in %s", (_name: string, json: JSONObject) => {
    expect(findUnresolvedIdReference(json, incident)).toBeNull();
  });

  // What a reference resolves to can be megabytes; it is read in one pass.
  test("reads a megabyte-long ID in one pass", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(
          findUnresolvedIdReference(
            { currentIncidentStateId: `${"{".repeat(4 * 1024 * 1024)}x` },
            incident,
          ),
        ).toBeNull();
      },
      limitInMs: 1000,
    });
    expect(timed.inMs).toBeLessThan(1000);
  });
});

describe("describeUnresolvedIdReference", () => {
  const describeFor: (reference: string) => string = (
    reference: string,
  ): string => {
    return describeUnresolvedIdReference({
      unresolved: {
        columnName: "currentIncidentStateId",
        reference: reference,
      } as UnresolvedIdReference,
      argumentName: "Query",
    });
  };

  test("names the reference, the argument, the column and the step it points at", () => {
    expect(describeFor(STEP_REFERENCE)).toBe(
      `The step stopped before reading or writing anything: ${STEP_REFERENCE} in "Query" did not resolve, so "currentIncidentStateId" has no ID. Step "monitor-find-one-1" has not run, or did not return this value - a Find One that finds no record returns no model. Check the step id and the return value name, or handle the empty result before this step.`,
    );
  });

  /*
   * The run window shows it under the step's Error output, the first thing
   * read about the step: what happened comes first, whatever the reference.
   */
  test.each([
    STEP_REFERENCE,
    VARIABLE_REFERENCE,
    "{{global.variables.stateId}}",
    "{{local.componets.monitor-find-one-1}}",
    `{{${"x".repeat(100000)}}}`,
  ])(
    "says first that the step stopped and changed nothing: %#",
    (reference: string) => {
      expect(describeFor(reference)).toMatch(
        /^The step stopped before reading or writing anything: \{\{/,
      );
    },
  );

  test("names the variable a variable reference points at", () => {
    expect(describeFor(VARIABLE_REFERENCE)).toContain(
      'Check that the variable "stateId" exists.',
    );
    expect(describeFor("{{global.variables.stateId}}")).toContain(
      'Check that the variable "stateId" exists.',
    );
  });

  test("says why a reference cannot resolve at all", () => {
    expect(describeFor("{{local.componets.monitor-find-one-1}}")).toContain(
      'It is not a reference this workflow can resolve: "local.componets" is not valid',
    );
  });

  test("names the record in a list", () => {
    expect(
      describeUnresolvedIdReference({
        unresolved: { columnName: "monitorId", reference: VARIABLE_REFERENCE },
        argumentName: "JSON Array",
        itemNumber: 2,
      }),
    ).toContain(
      `${VARIABLE_REFERENCE} in "JSON Array" (item 2) did not resolve`,
    );
  });

  test("cuts a long reference short", () => {
    const message: string = describeFor(`{{${"x".repeat(100000)}}}`);

    expect(message.length).toBeLessThan(1000);
    expect(message).toContain("…");
  });
});

/*
 * The steps themselves: each stops on its error port with the message, and
 * calls nothing on the service.
 */
interface OptionsFixture {
  options: RunOptions;
  log: jest.Mock;
  onError: jest.Mock;
}

function makeOptions(): OptionsFixture {
  const log: jest.Mock = jest.fn();
  const onError: jest.Mock = jest.fn((exception: Exception): Exception => {
    return exception;
  });

  return {
    log,
    onError,
    options: {
      log: log as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: onError as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    },
  };
}

function loggedLines(log: jest.Mock): string {
  return log.mock.calls
    .flat()
    .map((line: unknown): string => {
      return String(line);
    })
    .join("\n");
}

const SERVICE_METHODS: Array<string> = [
  "findBy",
  "findOneBy",
  "create",
  "updateOneBy",
  "updateBy",
  "deleteOneBy",
  "deleteBy",
];

// Every method a step may call on the service, each failing the test if called.
function spyOnEveryMethod(service: DatabaseService<any>): Array<jest.Mock> {
  return SERVICE_METHODS.map((method: string): jest.Mock => {
    return jest
      .spyOn(service, method as never)
      .mockRejectedValue(
        new Error(`${method} should not have been called`) as never,
      ) as unknown as jest.Mock;
  });
}

beforeEach(() => {
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a database step whose ID did not resolve", () => {
  type StepCase = [
    string,
    (service: DatabaseService<any>) => {
      run: (args: JSONObject, options: RunOptions) => Promise<RunReturnType>;
    },
    { new (): BaseModel },
    JSONObject,
    string,
  ];

  const STEPS: Array<StepCase> = [
    [
      "Find Many Incident, by its Query",
      (service: DatabaseService<any>) => {
        return new FindManyBaseModel<Incident>(service);
      },
      Incident,
      {
        query: { currentIncidentStateId: STEP_REFERENCE },
        select: { _id: true },
        limit: 25,
      },
      `${STEP_REFERENCE} in "Query" did not resolve, so "currentIncidentStateId" has no ID`,
    ],
    [
      "Find One Incident, by its Query",
      (service: DatabaseService<any>) => {
        return new FindOneBaseModel<Incident>(service);
      },
      Incident,
      {
        query: { currentIncidentState: VARIABLE_REFERENCE },
        select: { _id: true },
      },
      `${VARIABLE_REFERENCE} in "Query" did not resolve, so "currentIncidentState" has no ID`,
    ],
    [
      "Delete One Monitor, by its Query",
      (service: DatabaseService<any>) => {
        return new DeleteOneBaseModel<Monitor>(service);
      },
      Monitor,
      { query: { _id: STEP_REFERENCE } },
      `in "Query" did not resolve, so "_id" has no ID`,
    ],
    [
      "Delete Many Monitor, by its Query",
      (service: DatabaseService<any>) => {
        return new DeleteManyBaseModel<Monitor>(service);
      },
      Monitor,
      { query: { currentMonitorStatusId: STEP_REFERENCE } },
      `so "currentMonitorStatusId" has no ID`,
    ],
    [
      "Update One Monitor, by its Query",
      (service: DatabaseService<any>) => {
        return new UpdateOneBaseModel<Monitor>(service);
      },
      Monitor,
      { query: { id: STEP_REFERENCE }, data: { isEnabled: true } },
      `in "Query" did not resolve, so "_id" has no ID`,
    ],
    [
      "Update One Monitor, by the record it writes",
      (service: DatabaseService<any>) => {
        return new UpdateOneBaseModel<Monitor>(service);
      },
      Monitor,
      {
        query: { _id: MONITOR_ID },
        data: { currentMonitorStatusId: STEP_REFERENCE },
      },
      `in "Data (JSON Object)" did not resolve, so "currentMonitorStatusId" has no ID`,
    ],
    [
      "Update Many Monitor, by the record it writes",
      (service: DatabaseService<any>) => {
        return new UpdateManyBaseModel<Monitor>(service);
      },
      Monitor,
      {
        query: { _id: MONITOR_ID },
        data: { currentMonitorStatusId: VARIABLE_REFERENCE },
      },
      `in "Data (JSON Object)" did not resolve, so`,
    ],
    [
      "Create One Incident, by the record it writes",
      (service: DatabaseService<any>) => {
        return new CreateOneBaseModel<Incident>(service);
      },
      Incident,
      {
        json: {
          title: "Database is down",
          monitors: [{ _id: STEP_REFERENCE }],
        },
      },
      `in "JSON Object" did not resolve, so "monitors" has no ID`,
    ],
    [
      "Create Many Incident, by its second record",
      (service: DatabaseService<any>) => {
        return new CreateManyBaseModel<Incident>(service);
      },
      Incident,
      {
        "json-array": [
          { title: "First", currentIncidentStateId: STATE_ID },
          { title: "Second", currentIncidentStateId: STEP_REFERENCE },
        ],
      },
      `in "JSON Array" (item 2) did not resolve, so`,
    ],
  ];

  test.each(STEPS)(
    "%s: stops on the error port and calls nothing",
    async (
      _name: string,
      make: (service: DatabaseService<any>) => {
        run: (args: JSONObject, options: RunOptions) => Promise<RunReturnType>;
      },
      modelType: { new (): BaseModel },
      args: JSONObject,
      expectedMessage: string,
    ) => {
      const service: DatabaseService<any> = new DatabaseService<any>(modelType);
      const calls: Array<jest.Mock> = spyOnEveryMethod(service);
      const fixture: OptionsFixture = makeOptions();

      const result: RunReturnType = await make(service).run(
        args,
        fixture.options,
      );

      expect(result.executePort?.id).toBe("error");
      expect(loggedLines(fixture.log)).toContain(expectedMessage);

      /*
       * And again as the reason the step took its Error output, which the
       * run window's Steps view shows under it: the message, whole.
       */
      expect(result.executePortReason).toContain(expectedMessage);
      expect(result.executePortReason).toMatch(
        /^The step stopped before reading or writing anything: /,
      );
      expect(loggedLines(fixture.log)).toContain(
        result.executePortReason as string,
      );

      for (const call of calls) {
        expect(call).not.toHaveBeenCalled();
      }

      // The error port is taken, as for any failed step; the run goes on.
      expect(fixture.onError).not.toHaveBeenCalled();
    },
  );

  // A reference left in a title is still only the run's warning.
  test("still runs a step whose unresolved reference is in a text column", async () => {
    const service: DatabaseService<Incident> = new DatabaseService<Incident>(
      Incident,
    );
    const findBy: jest.Mock = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([] as never) as unknown as jest.Mock;
    const fixture: OptionsFixture = makeOptions();

    const result: RunReturnType = await new FindManyBaseModel<Incident>(
      service,
    ).run(
      { query: { title: STEP_REFERENCE }, select: { _id: true } },
      fixture.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(findBy).toHaveBeenCalledTimes(1);
  });
});

/*
 * The chain a run takes, from the reference to the step: what VMAPI makes of
 * a Query whose reference names a step that found nothing, or a step that
 * found something.
 */
describe("a Query a run filled in from an earlier Find One Monitor", () => {
  const STATUS_REFERENCE: string =
    "{{local.components.monitor-find-one-1.returnValues.model.currentMonitorStatusId}}";

  // As the step builder writes a reference: in quotes.
  const QUOTED_QUERY: JSONObject = { currentIncidentStateId: STATUS_REFERENCE };

  const fillIn: (
    query: JSONObject | string,
    model: JSONObject | null,
  ) => JSONObject = (
    query: JSONObject | string,
    model: JSONObject | null,
  ): JSONObject => {
    const storageMap: JSONObject = {
      local: {
        variables: {},
        components: {
          "monitor-find-one-1": { returnValues: { model: model } },
        },
      },
      global: { variables: {} },
    };

    // As RunWorkflow.getComponentArguments fills in a Query argument.
    const filledIn: JSONObject | string = VMAPI.replaceValueInPlace(
      storageMap,
      query as string,
      true,
    ) as unknown as JSONObject | string;

    return typeof filledIn === "string"
      ? (JSON.parse(filledIn) as JSONObject)
      : filledIn;
  };

  const foundMonitor: () => JSONObject = (): JSONObject => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    monitor.currentMonitorStatusId = new ObjectID(STATE_ID);

    const status: MonitorStatus = new MonitorStatus();
    status._id = STATE_ID;
    status.name = "Operational";
    monitor.currentMonitorStatus = status;

    return BaseModel.toJSON(monitor, Monitor);
  };

  /*
   * The step's read, as far as TypeORM: the query every read hands it is
   * QueryUtil.serializeQuery's (through the permission check). Returns what
   * the read was given and what it would have sent.
   */
  const readAsTheServiceDoes: (service: DatabaseService<Incident>) => {
    serialized: Array<Record<string, unknown>>;
  } = (
    service: DatabaseService<Incident>,
  ): { serialized: Array<Record<string, unknown>> } => {
    const serialized: Array<Record<string, unknown>> = [];

    jest.spyOn(service, "findBy").mockImplementation((async (findBy: {
      query: JSONObject;
    }): Promise<Array<Incident>> => {
      serialized.push(
        QueryUtil.serializeQuery(Incident, {
          ...findBy.query,
        } as any) as Record<string, unknown>,
      );
      return [];
    }) as never);

    return { serialized };
  };

  test("stops the step when the Find One found no monitor", async () => {
    const query: JSONObject = fillIn(QUOTED_QUERY, null);

    // Left as written: this is what reached Postgres before.
    expect(query["currentIncidentStateId"]).toBe(STATUS_REFERENCE);

    const service: DatabaseService<Incident> = new DatabaseService<Incident>(
      Incident,
    );
    const calls: Array<jest.Mock> = spyOnEveryMethod(service);
    const fixture: OptionsFixture = makeOptions();

    const result: RunReturnType = await new FindManyBaseModel<Incident>(
      service,
    ).run({ query: query, select: { _id: true } }, fixture.options);

    expect(result.executePort?.id).toBe("error");
    expect(loggedLines(fixture.log)).toContain(
      'Step "monitor-find-one-1" has not run, or did not return this value',
    );

    for (const call of calls) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  /*
   * In quotes, the id the Find One returned - {"_type": "ObjectID", ...},
   * as a record's JSON holds an id - is written into the string as its JSON
   * text, and Postgres was asked for the uuid "{\n  "_type": "ObjectID"...".
   * The read takes it for the id it holds.
   */
  test("looks the incidents up by the id the Find One returned, quoted as the builder writes it", async () => {
    const query: JSONObject = fillIn(QUOTED_QUERY, foundMonitor());

    expect(typeof query["currentIncidentStateId"]).toBe("string");
    expect(query["currentIncidentStateId"]).toContain('"_type": "ObjectID"');

    const service: DatabaseService<Incident> = new DatabaseService<Incident>(
      Incident,
    );
    const read: { serialized: Array<Record<string, unknown>> } =
      readAsTheServiceDoes(service);

    const result: RunReturnType = await new FindManyBaseModel<Incident>(
      service,
    ).run({ query: query, select: { _id: true } }, makeOptions().options);

    expect(result.executePort?.id).toBe("success");
    expect(read.serialized[0]?.["currentIncidentStateId"]).toBe(STATE_ID);
  });

  test("looks the incidents up by the id the Find One returned, written without quotes", async () => {
    const query: JSONObject = fillIn(
      `{"currentIncidentStateId": ${STATUS_REFERENCE}}`,
      foundMonitor(),
    );

    expect(query["currentIncidentStateId"]).toEqual({
      _type: "ObjectID",
      value: STATE_ID,
    });

    const service: DatabaseService<Incident> = new DatabaseService<Incident>(
      Incident,
    );
    const read: { serialized: Array<Record<string, unknown>> } =
      readAsTheServiceDoes(service);

    const result: RunReturnType = await new FindManyBaseModel<Incident>(
      service,
    ).run({ query: query, select: { _id: true } }, makeOptions().options);

    expect(result.executePort?.id).toBe("success");
    expect(read.serialized).toHaveLength(1);
  });

  /*
   * Without quotes, a reference to the monitor's status itself - a record,
   * not its id - puts the record in the Query. No reference is left
   * unresolved, so the step runs, and the read refuses the record with a 400
   * naming the column where it used to ask Postgres for "[object Object]".
   */
  test("takes the error port, naming the column, when the reference is to a record", async () => {
    const query: JSONObject = fillIn(
      '{"currentIncidentStateId": {{local.components.monitor-find-one-1.returnValues.model.currentMonitorStatus}}}',
      foundMonitor(),
    );

    expect(query["currentIncidentStateId"]).toMatchObject({ _id: STATE_ID });

    const service: DatabaseService<Incident> = new DatabaseService<Incident>(
      Incident,
    );
    readAsTheServiceDoes(service);
    const fixture: OptionsFixture = makeOptions();

    const result: RunReturnType = await new FindManyBaseModel<Incident>(
      service,
    ).run({ query: query, select: { _id: true } }, fixture.options);

    expect(result.executePort?.id).toBe("error");
    expect(loggedLines(fixture.log)).toContain(
      'Invalid ID for "currentIncidentStateId" in the query: the object {"_id":"dfadda01',
    );
  });
});
