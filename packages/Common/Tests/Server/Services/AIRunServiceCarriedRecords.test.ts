import AIRunService from "../../../Server/Services/AIRunService";
import ProjectService from "../../../Server/Services/ProjectService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import { CarriedRecordIds } from "../../../Types/AI/CarriedRecords";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskContextItem,
  CodeTaskContextType,
} from "../../../Types/AI/CodeTask";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT A TURN CARRIES, AND ITS TASK WITH IT (#9186).
 *
 * Every Code task turn AIRunService creates carries the incidents and
 * alerts its request's context names, beside those its caller named, and a
 * reply adds what it carries to its task before it is written - appended in
 * one UPDATE, never written over. CodeFixRunReadPostgres runs the append on
 * a migrated Postgres; this suite holds what the service writes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a0c1d2e-3f40-4a51-8b62-7c83d94ea5f6",
);
const TASK_ID: ObjectID = new ObjectID("6a0c1d2e-3f40-4a51-8b62-7c83d94ea5f7");
const INCIDENT_ID: string = "6a0c1d2e-3f40-4a51-8b62-7c83d94ea5f8";
const OTHER_INCIDENT_ID: string = "6a0c1d2e-3f40-4a51-8b62-7c83d94ea5f9";
const ALERT_ID: string = "6a0c1d2e-3f40-4a51-8b62-7c83d94ea5fa";
const EXCEPTION_ID: string = "6a0c1d2e-3f40-4a51-8b62-7c83d94ea5fb";

function item(
  type: CodeTaskContextType,
  recordId?: string | undefined,
): CodeTaskContextItem {
  return {
    type,
    label: `${type} ${recordId || ""}`.trim(),
    ...(recordId ? { recordId } : {}),
  };
}

// A turn of a Code task, asked with this context.
function turn(
  context: Array<CodeTaskContextItem>,
  codeTaskId?: ObjectID | undefined,
): AIRun {
  const run: AIRun = new AIRun();
  run.projectId = PROJECT_ID;
  run.runType = AIRunType.CodeFix;
  run.codeFixTaskType = CodeFixTaskType.CodeRequest;
  run.status = AIRunStatus.Queued;
  run.taskContext = { request: { message: "Fix it", context } };

  if (codeTaskId) {
    run.codeTaskId = codeTaskId;
  }

  return run;
}

async function beforeCreate(run: AIRun): Promise<AIRun> {
  const service: {
    onBeforeCreate: (createBy: CreateBy<AIRun>) => Promise<{
      createBy: CreateBy<AIRun>;
    }>;
  } = AIRunService as unknown as {
    onBeforeCreate: (createBy: CreateBy<AIRun>) => Promise<{
      createBy: CreateBy<AIRun>;
    }>;
  };

  return (await service.onBeforeCreate({ data: run, props: { isRoot: true } }))
    .createBy.data;
}

let added: Array<{ runId: ObjectID; records: CarriedRecordIds }>;
let task: AIRun | null;

beforeEach(() => {
  added = [];
  task = new AIRun();
  task._id = TASK_ID.toString();

  jest
    .spyOn(ProjectService, "incrementAndGetAIRunCounter")
    .mockResolvedValue(7);
  jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
    return task;
  });
  jest
    .spyOn(AIRunService, "addCarriedRecords")
    .mockImplementation(
      async (data: { runId: ObjectID; records: CarriedRecordIds }) => {
        added.push(data);
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a task's first turn", () => {
  test("carries every incident and alert its request's context names, and nothing else it names", async () => {
    const run: AIRun = await beforeCreate(
      turn([
        item(CodeTaskContextType.Incident, INCIDENT_ID),
        item(CodeTaskContextType.Note),
        item(CodeTaskContextType.Alert, ALERT_ID),
        item(CodeTaskContextType.Exception, EXCEPTION_ID),
        item(CodeTaskContextType.Incident, OTHER_INCIDENT_ID),
        // The same incident twice is carried once.
        item(CodeTaskContextType.Incident, INCIDENT_ID.toUpperCase()),
      ]),
    );

    expect(run.carriedIncidentIds).toEqual([INCIDENT_ID, OTHER_INCIDENT_ID]);
    expect(run.carriedAlertIds).toEqual([ALERT_ID]);
    // A first turn adds nothing to any other run.
    expect(added).toEqual([]);
    // And is numbered, as before.
    expect(run.taskNumber).toBe(7);
  });

  test("keeps what its caller said it carries: a postmortem action item's incident", async () => {
    const run: AIRun = turn([item(CodeTaskContextType.Note)]);
    run.carriedIncidentIds = [INCIDENT_ID];

    const created: AIRun = await beforeCreate(run);

    expect(created.carriedIncidentIds).toEqual([INCIDENT_ID]);
    expect(created.carriedAlertIds).toBeUndefined();
  });

  test("carries nothing when its context names no incident or alert: the lists stay empty", async () => {
    const run: AIRun = await beforeCreate(
      turn([
        item(CodeTaskContextType.File),
        item(CodeTaskContextType.Monitor, EXCEPTION_ID),
      ]),
    );

    expect(run.carriedIncidentIds).toBeUndefined();
    expect(run.carriedAlertIds).toBeUndefined();
  });

  test("an entry that is no id is carried as nothing, never as an entry the rule would have to read", async () => {
    const run: AIRun = await beforeCreate(
      turn([
        item(CodeTaskContextType.Incident, "not-an-id"),
        { type: CodeTaskContextType.Alert, label: "no id" },
      ]),
    );

    expect(run.carriedIncidentIds).toBeUndefined();
    expect(run.carriedAlertIds).toBeUndefined();
  });

  test("a run that is no Code task carries nothing", async () => {
    const chat: AIRun = new AIRun();
    chat.projectId = PROJECT_ID;
    chat.runType = AIRunType.Chat;

    const created: AIRun = await beforeCreate(chat);

    expect(created.carriedIncidentIds).toBeUndefined();
    expect(created.carriedAlertIds).toBeUndefined();
    expect(added).toEqual([]);
  });
});

describe("a reply", () => {
  test("carries what its own context names, and adds it to its task before it is written", async () => {
    const run: AIRun = await beforeCreate(
      turn(
        [
          item(CodeTaskContextType.Alert, ALERT_ID),
          item(CodeTaskContextType.Incident, INCIDENT_ID),
        ],
        TASK_ID,
      ),
    );

    expect(run.carriedIncidentIds).toEqual([INCIDENT_ID]);
    expect(run.carriedAlertIds).toEqual([ALERT_ID]);
    expect(added).toEqual([
      {
        runId: TASK_ID,
        records: { incidentIds: [INCIDENT_ID], alertIds: [ALERT_ID] },
      },
    ]);
    // A reply is a turn of a numbered task: it takes no number.
    expect(run.taskNumber).toBeUndefined();
  });

  test("adds only what its task does not carry already", async () => {
    task!.carriedIncidentIds = [INCIDENT_ID];

    await beforeCreate(
      turn(
        [
          item(CodeTaskContextType.Incident, INCIDENT_ID),
          item(CodeTaskContextType.Incident, OTHER_INCIDENT_ID),
        ],
        TASK_ID,
      ),
    );

    expect(added).toEqual([
      {
        runId: TASK_ID,
        records: { incidentIds: [OTHER_INCIDENT_ID], alertIds: [] },
      },
    ]);
  });

  test("a reply carrying nothing changes nothing of its task", async () => {
    await beforeCreate(turn([item(CodeTaskContextType.Note)], TASK_ID));

    expect(added).toEqual([]);
  });

  test("a reply whose task the database cannot find adds to no other run", async () => {
    task = null;

    const run: AIRun = await beforeCreate(
      turn([item(CodeTaskContextType.Incident, INCIDENT_ID)], TASK_ID),
    );

    expect(run.carriedIncidentIds).toEqual([INCIDENT_ID]);
    expect(added).toEqual([]);
  });

  test("a task that cannot be told what its reply carries does not get the reply: the reply is refused", async () => {
    jest
      .spyOn(AIRunService, "addCarriedRecords")
      .mockRejectedValue(new Error("Postgres is down"));

    await expect(
      beforeCreate(
        turn([item(CodeTaskContextType.Incident, INCIDENT_ID)], TASK_ID),
      ),
    ).rejects.toThrow("Postgres is down");
  });
});

describe("adding to what a run carries", () => {
  // The UPDATE the service builds, as it builds it.
  function capture(): {
    set: Record<string, unknown>;
    where: Array<unknown>;
    parameters: Record<string, unknown>;
    executed: number;
  } {
    const captured: {
      set: Record<string, unknown>;
      where: Array<unknown>;
      parameters: Record<string, unknown>;
      executed: number;
    } = { set: {}, where: [], parameters: {}, executed: 0 };

    const builder: Record<string, unknown> = {};

    Object.assign(builder, {
      update: () => {
        return builder;
      },
      set: (set: Record<string, unknown>) => {
        captured.set = set;
        return builder;
      },
      where: (...where: Array<unknown>) => {
        captured.where = where;
        return builder;
      },
      setParameters: (parameters: Record<string, unknown>) => {
        captured.parameters = parameters;
        return builder;
      },
      execute: async () => {
        captured.executed++;
        return { affected: 1 };
      },
    });

    jest.spyOn(AIRunService, "getRepository").mockReturnValue({
      createQueryBuilder: () => {
        return builder;
      },
    } as never);

    return captured;
  }

  test("appends to each list in one statement, never writing it over", async () => {
    jest.mocked(AIRunService.addCarriedRecords).mockRestore();
    const captured: ReturnType<typeof capture> = capture();

    await AIRunService.addCarriedRecords({
      runId: TASK_ID,
      records: { incidentIds: [INCIDENT_ID], alertIds: [ALERT_ID] },
    });

    expect(captured.executed).toBe(1);
    expect(Object.keys(captured.set).sort()).toEqual([
      "carriedAlertIds",
      "carriedIncidentIds",
    ]);
    expect((captured.set["carriedIncidentIds"] as () => string)()).toBe(
      `COALESCE("carriedIncidentIds", CAST('[]' AS jsonb)) || CAST(:carriedIncidentIds AS jsonb)`,
    );
    expect((captured.set["carriedAlertIds"] as () => string)()).toBe(
      `COALESCE("carriedAlertIds", CAST('[]' AS jsonb)) || CAST(:carriedAlertIds AS jsonb)`,
    );
    expect(captured.parameters).toEqual({
      carriedIncidentIds: JSON.stringify([INCIDENT_ID]),
      carriedAlertIds: JSON.stringify([ALERT_ID]),
    });
    expect(captured.where).toEqual(['"_id" = :id', { id: TASK_ID.toString() }]);
  });

  test("touches only the list it adds to, and nothing for nothing", async () => {
    jest.mocked(AIRunService.addCarriedRecords).mockRestore();
    const captured: ReturnType<typeof capture> = capture();

    await AIRunService.addCarriedRecords({
      runId: TASK_ID,
      records: { incidentIds: [], alertIds: [ALERT_ID] },
    });

    expect(Object.keys(captured.set)).toEqual(["carriedAlertIds"]);

    await AIRunService.addCarriedRecords({
      runId: TASK_ID,
      records: { incidentIds: [], alertIds: [] },
    });

    expect(captured.executed).toBe(1);
  });
});
