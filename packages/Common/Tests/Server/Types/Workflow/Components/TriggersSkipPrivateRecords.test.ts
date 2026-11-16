import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import OnTriggerBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import WorkflowListeners from "../../../../../Server/Utils/Workflow/WorkflowListeners";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WORKFLOW_PRIVATE_RECORDS_SENTENCE,
  getWorkflowPrivateRecordRefusal,
} from "../../../../../Types/Workflow/WorkflowPrivateRecords";
import API from "../../../../../Utils/API";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A WORKFLOW DOES NOT START ON A PRIVATE RECORD, NOR ON ANYTHING OF ONE
 * (#8914).
 *
 * A workflow's steps act as a Project Admin, but are never lent a Project
 * Admin's sight of private incidents, alerts and episodes: whoever builds a
 * workflow decides where what its steps read goes. So:
 *
 *   - DatabaseService.onTriggerWorkflow posts no event for a private
 *     incident, nor for a note of one - what an On Update event hands the
 *     run is what the update wrote - and asks only when a workflow listens;
 *   - DatabaseService.isAboutPrivateRecord says which records those are: a
 *     private record itself, a part of one, read as OneUptime with deleted
 *     rows (an On Delete event's record is gone), nothing for a table that
 *     has nothing to do with private records;
 *   - the trigger step refuses a run started on such a record (Run Workflow,
 *     or a record made private while its event waited) before reading or
 *     handing on any of it, in the words of a record it does not find.
 *
 * No database: the services' reads are answered by the test.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b810-9dad-41d1-80b4-00c04fd4b200",
);
const RECORD_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4b201";
const INCIDENT_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4b202";

class IncidentReads extends DatabaseService<Incident> {
  public constructor() {
    super(Incident);
  }
}

class NoteReads extends DatabaseService<IncidentInternalNote> {
  public constructor() {
    super(IncidentInternalNote);
  }
}

class MonitorReads extends DatabaseService<Monitor> {
  public constructor() {
    super(Monitor);
  }
}

type AnyService = DatabaseService<BaseModel>;

function options(log: Array<string>): RunOptions {
  return {
    log: ((message: unknown): void => {
      log.push(String(message));
    }) as unknown as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    workflowName: "Post incidents to the status channel",
    projectId: PROJECT_ID,
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as unknown as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DatabaseService.onTriggerWorkflow", () => {
  let posted: number = 0;
  let isListening: boolean = true;

  beforeEach(() => {
    posted = 0;
    isListening = true;

    jest.spyOn(API, "post").mockImplementation((async () => {
      posted++;
      return {};
    }) as never);

    jest
      .spyOn(WorkflowListeners, "isAnyListening")
      .mockImplementation(async () => {
        return isListening;
      });
  });

  test.each([
    ["an incident", IncidentReads],
    ["a note of an incident", NoteReads],
  ] as Array<[string, { new (): AnyService }]>)(
    "posts no event for %s that is private or part of a private record",
    async (_name: string, Service: { new (): AnyService }) => {
      const service: AnyService = new Service();
      const isAbout: jest.SpiedFunction<AnyService["isAboutPrivateRecord"]> =
        jest.spyOn(service, "isAboutPrivateRecord").mockResolvedValue(true);

      for (const type of ["on-create", "on-update", "on-delete"] as const) {
        await service.onTriggerWorkflow(
          new ObjectID(RECORD_ID),
          PROJECT_ID,
          type,
        );
      }

      expect(posted).toBe(0);
      expect(isAbout).toHaveBeenCalledTimes(3);
      expect(isAbout.mock.calls[0]![0].toString()).toBe(RECORD_ID);
    },
  );

  test("posts the event for a record that is not private, as before", async () => {
    const service: AnyService = new IncidentReads() as unknown as AnyService;
    jest.spyOn(service, "isAboutPrivateRecord").mockResolvedValue(false);

    await service.onTriggerWorkflow(
      new ObjectID(RECORD_ID),
      PROJECT_ID,
      "on-update",
    );

    expect(posted).toBe(1);
  });

  test("asks nothing of the record when no workflow listens", async () => {
    isListening = false;

    const service: AnyService = new IncidentReads() as unknown as AnyService;
    const isAbout: jest.SpiedFunction<AnyService["isAboutPrivateRecord"]> = jest
      .spyOn(service, "isAboutPrivateRecord")
      .mockResolvedValue(true);

    await service.onTriggerWorkflow(
      new ObjectID(RECORD_ID),
      PROJECT_ID,
      "on-create",
    );

    expect(isAbout).not.toHaveBeenCalled();
    expect(posted).toBe(0);
  });
});

describe("DatabaseService.isAboutPrivateRecord", () => {
  // What each read asked: the service's own row, then the private records it names.
  let ownReads: Array<{ query: JSONObject; select: JSONObject }> = [];
  let parentReads: Array<{ query: JSONObject; props: JSONObject }> = [];
  let privateIncidents: Array<string> = [];

  function useRows(service: AnyService, rows: Array<BaseModel>): void {
    getJestSpyOn(service, "_findBy").mockImplementation((async (
      findBy: { query: JSONObject; select: JSONObject; props: JSONObject },
      withDeleted: boolean,
    ) => {
      // Read as OneUptime, deleted rows included: an On Delete event's record is gone.
      expect(findBy.props["isRoot"]).toBe(true);
      expect(withDeleted).toBe(true);
      ownReads.push({ query: findBy.query, select: findBy.select });
      return rows;
    }) as never);
  }

  beforeEach(() => {
    ownReads = [];
    parentReads = [];
    privateIncidents = [];

    getJestSpyOn(DatabaseService, "getParentReader").mockImplementation(
      ((modelType: { new (): BaseModel }) => {
        expect(modelType).toBe(Incident);

        return {
          findBy: async (findBy: {
            query: JSONObject;
            props: JSONObject;
          }): Promise<Array<{ _id: string }>> => {
            parentReads.push({ query: findBy.query, props: findBy.props });

            const id: string = String(findBy.query["_id"]);

            return findBy.query["isPrivate"] === true &&
              privateIncidents.includes(id)
              ? [{ _id: id }]
              : [];
          },
        };
      }) as never,
    );
  });

  test("a private incident is one", async () => {
    const service: AnyService = new IncidentReads() as unknown as AnyService;
    const row: Incident = new Incident();
    row._id = RECORD_ID;
    row.isPrivate = true;
    useRows(service, [row]);

    await expect(
      service.isAboutPrivateRecord(new ObjectID(RECORD_ID)),
    ).resolves.toBe(true);

    expect(ownReads).toHaveLength(1);
    expect(ownReads[0]!.query["_id"]).toBe(RECORD_ID);
    expect(ownReads[0]!.select["isPrivate"]).toBe(true);
  });

  test("an incident that is not private is not one", async () => {
    const service: AnyService = new IncidentReads() as unknown as AnyService;
    const row: Incident = new Incident();
    row._id = RECORD_ID;
    row.isPrivate = false;
    useRows(service, [row]);

    await expect(
      service.isAboutPrivateRecord(new ObjectID(RECORD_ID)),
    ).resolves.toBe(false);
  });

  test("a note of a private incident is one", async () => {
    privateIncidents = [INCIDENT_ID];

    const service: AnyService = new NoteReads() as unknown as AnyService;
    const row: IncidentInternalNote = new IncidentInternalNote();
    row._id = RECORD_ID;
    row.incidentId = new ObjectID(INCIDENT_ID);
    useRows(service, [row]);

    await expect(
      service.isAboutPrivateRecord(new ObjectID(RECORD_ID)),
    ).resolves.toBe(true);

    expect(ownReads[0]!.select["incidentId"]).toBe(true);
    expect(parentReads).toHaveLength(1);
    expect(parentReads[0]!.query["_id"]).toBe(INCIDENT_ID);
    expect(parentReads[0]!.props["isRoot"]).toBe(true);
  });

  test("a note of an incident that is not private is not one", async () => {
    const service: AnyService = new NoteReads() as unknown as AnyService;
    const row: IncidentInternalNote = new IncidentInternalNote();
    row._id = RECORD_ID;
    row.incidentId = new ObjectID(INCIDENT_ID);
    useRows(service, [row]);

    await expect(
      service.isAboutPrivateRecord(new ObjectID(RECORD_ID)),
    ).resolves.toBe(false);
    expect(parentReads).toHaveLength(1);
  });

  test("a record no longer there hands on nothing but its id, and is let through", async () => {
    const service: AnyService = new IncidentReads() as unknown as AnyService;
    useRows(service, []);

    await expect(
      service.isAboutPrivateRecord(new ObjectID(RECORD_ID)),
    ).resolves.toBe(false);
  });

  test("a table that has nothing to do with private records reads nothing", async () => {
    const service: AnyService = new MonitorReads() as unknown as AnyService;
    useRows(service, []);

    expect(service.getPrivateRecordColumns()).toEqual([]);
    await expect(
      service.isAboutPrivateRecord(new ObjectID(RECORD_ID)),
    ).resolves.toBe(false);
    expect(ownReads).toHaveLength(0);
    expect(parentReads).toHaveLength(0);
  });
});

describe("the trigger step", () => {
  beforeEach(() => {
    // The project's plan, which a step's props carry (WorkflowPrincipal).
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Enterprise,
      isSubscriptionUnpaid: false,
    });
  });

  test.each([
    ["an incident", IncidentReads, "incident"],
    ["a note of an incident", NoteReads, "incident internal note"],
  ] as Array<[string, { new (): AnyService }, string]>)(
    "refuses a run on %s that is private, before reading or handing on any of it",
    async (_name: string, Service: { new (): AnyService }, noun: string) => {
      const service: AnyService = new Service();
      jest.spyOn(service, "isAboutPrivateRecord").mockResolvedValue(true);
      const findOneById: jest.SpiedFunction<AnyService["findOneById"]> = jest
        .spyOn(service, "findOneById")
        .mockResolvedValue(null);

      const trigger: OnTriggerBaseModel<BaseModel> =
        new OnTriggerBaseModel<BaseModel>(service, "on-update");
      const log: Array<string> = [];

      let thrown: unknown = null;

      try {
        await trigger.run(
          {
            data: {
              _id: RECORD_ID,
              miscData: { title: "Card data exposed in checkout logs" },
            },
            select: { title: true },
          },
          options(log),
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toBe(
        getWorkflowPrivateRecordRefusal(service.getModel().singularName!),
      );
      expect((thrown as Error).message).toContain(
        WORKFLOW_PRIVATE_RECORDS_SENTENCE,
      );
      expect((thrown as Error).message.toLowerCase()).toContain(noun);
      expect(log).toEqual([(thrown as Error).message]);
      // Nothing of the update's values is handed on, nor read.
      expect((thrown as Error).message).not.toContain("Card data");
      expect(findOneById).not.toHaveBeenCalled();
    },
  );

  test("a run started with the id alone is refused as well", async () => {
    const service: AnyService = new IncidentReads() as unknown as AnyService;
    jest.spyOn(service, "isAboutPrivateRecord").mockResolvedValue(true);

    const trigger: OnTriggerBaseModel<BaseModel> =
      new OnTriggerBaseModel<BaseModel>(service, "on-create");

    await expect(trigger.run({ _id: RECORD_ID }, options([]))).rejects.toThrow(
      WORKFLOW_PRIVATE_RECORDS_SENTENCE,
    );
  });

  test("runs on an incident that is not private, as before", async () => {
    const service: AnyService = new IncidentReads() as unknown as AnyService;
    jest.spyOn(service, "isAboutPrivateRecord").mockResolvedValue(false);

    const found: Incident = new Incident();
    found._id = RECORD_ID;
    found.title = "Checkout is slow";
    jest.spyOn(service, "findOneById").mockResolvedValue(found);

    const trigger: OnTriggerBaseModel<BaseModel> =
      new OnTriggerBaseModel<BaseModel>(service, "on-update");

    const result: RunReturnType = await trigger.run(
      { data: { _id: RECORD_ID }, select: { title: true } },
      options([]),
    );

    expect(result.executePort?.id).toBe("success");
    expect((result.returnValues["model"] as JSONObject)["title"]).toBe(
      "Checkout is slow",
    );
  });

  test("a record of a kind that can be private it does not find is told in the same words", async () => {
    const service: AnyService = new IncidentReads() as unknown as AnyService;
    jest.spyOn(service, "isAboutPrivateRecord").mockResolvedValue(false);
    jest.spyOn(service, "findOneById").mockResolvedValue(null);

    const trigger: OnTriggerBaseModel<BaseModel> =
      new OnTriggerBaseModel<BaseModel>(service, "on-update");

    await expect(
      trigger.run(
        { data: { _id: RECORD_ID }, select: { title: true } },
        options([]),
      ),
    ).rejects.toThrow(getWorkflowPrivateRecordRefusal("Incident"));
  });

  test("a record of another kind it does not find is told as before", async () => {
    const service: AnyService = new MonitorReads() as unknown as AnyService;
    jest.spyOn(service, "findOneById").mockResolvedValue(null);

    const trigger: OnTriggerBaseModel<BaseModel> =
      new OnTriggerBaseModel<BaseModel>(service, "on-update");

    await expect(
      trigger.run(
        { data: { _id: RECORD_ID }, select: { name: true } },
        options([]),
      ),
    ).rejects.toThrow("Model not found with id " + RECORD_ID);
  });
});
