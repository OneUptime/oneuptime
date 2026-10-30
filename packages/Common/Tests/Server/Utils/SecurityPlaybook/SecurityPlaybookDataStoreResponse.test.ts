import DataStore from "../../../../Models/DatabaseModels/DataStore";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import DataSecurityResponse from "../../../../Server/Utils/DataSecurity/DataSecurityResponse";
import SecurityPlaybookActions, {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import { getResponseActionOfStep } from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookDataStoreResponse";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { DataSecurityResponseAction } from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityPlaybookActionCategory,
  SecurityPlaybookActionType,
  actsOnSecurityEntities,
  doesActionNeedApprovalByDefault,
  getSecurityPlaybookAction,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStep,
  doesStepNeedApproval,
  parseSecurityPlaybookSteps,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Block public access to data stores, and Revoke data store sharing: a
 * playbook closes the exposure of the data stores a case is about, through
 * each store's cloud connection, as a person does from an issue's page
 * (DataSecurityResponse, stood in for here: its own suite runs it). A store
 * of a kind the step does not fit is left out, a store marked public by
 * design is left alone, and a store that could not be changed fails the
 * step, so nobody reads "done" while a bucket is still public.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "78787878-7878-4878-8878-787878787878",
);
const CASE_ID: ObjectID = new ObjectID("89898989-8989-4989-8989-898989898989");

const EXPORTS_KEY: string =
  "cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports";
const WEBSITE_KEY: string = "cloud:aws:AWS S3 Bucket:arn:aws:s3:::www";
const ORDERS_KEY: string =
  "cloud:aws:AWS RDS Instance:arn:aws:rds:eu-west-1:123456789012:db:orders";
const LOGS_KEY: string = "telemetry:5f0c2a4e:Logs";

function dataStore(data: {
  storeKey: string;
  name: string;
  kind: DataStoreKind;
  isPublicByDesign?: boolean;
}): DataStore {
  const model: DataStore = new DataStore();
  model._id = ObjectID.generate().toString();
  model.projectId = PROJECT_ID;
  model.storeKey = data.storeKey;
  model.name = data.name;
  model.kind = data.kind;
  model.isPublicByDesign = Boolean(data.isPublicByDesign);
  return model;
}

const EXPORTS: DataStore = dataStore({
  storeKey: EXPORTS_KEY,
  name: "customer-exports",
  kind: DataStoreKind.AwsS3Bucket,
});
const WEBSITE: DataStore = dataStore({
  storeKey: WEBSITE_KEY,
  name: "www",
  kind: DataStoreKind.AwsS3Bucket,
  isPublicByDesign: true,
});
const ORDERS: DataStore = dataStore({
  storeKey: ORDERS_KEY,
  name: "orders",
  kind: DataStoreKind.AwsRdsInstance,
});
const LOGS: DataStore = dataStore({
  storeKey: LOGS_KEY,
  name: "checkout logs",
  kind: DataStoreKind.TelemetryLogs,
});

function storeEntity(storeKey: string): SecurityEntity {
  return {
    type: SecurityEntityType.DataStore,
    value: `data-store:${storeKey}`,
  };
}

function context(
  action: SecurityPlaybookActionType,
  entities: Array<SecurityEntity>,
): PlaybookStepContext {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.caseNumberWithPrefix = "SEC-12";
  securityCase.title = "A sensitive bucket was made public";
  securityCase.entities = entities as unknown as JSONArray;

  return {
    projectId: PROJECT_ID,
    runId: ObjectID.generate(),
    playbookName: "Lock it down",
    stepNumber: 2,
    securityCase,
    step: {
      id: "s2",
      action,
      config: {},
      requiresApproval: false,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  };
}

type Spy = ReturnType<typeof getJestSpyOn>;

let runSpy: Spy;
let failFor: Set<string>;
let unchangedFor: Set<string>;

beforeEach(() => {
  failFor = new Set();
  unchangedFor = new Set();

  getJestSpyOn(DataStoreService, "findBy").mockImplementation((async (args: {
    query: { storeKey?: Includes; _id?: Includes };
  }) => {
    const wanted: Array<string> = (
      (args.query.storeKey || args.query._id)?.values || []
    ).map((value: unknown): string => {
      return String(value);
    });

    return [EXPORTS, WEBSITE, ORDERS, LOGS].filter(
      (store: DataStore): boolean => {
        return args.query.storeKey
          ? wanted.includes(store.storeKey!)
          : wanted.includes(store.id!.toString());
      },
    );
  }) as never);
  runSpy = getJestSpyOn(DataSecurityResponse, "run").mockImplementation(
    (async (data: { dataStoreId: ObjectID }) => {
      const store: DataStore | undefined = [EXPORTS, WEBSITE, ORDERS].find(
        (candidate: DataStore): boolean => {
          return candidate.id!.toString() === data.dataStoreId.toString();
        },
      );

      if (failFor.has(store!.name!)) {
        throw new BadDataException(
          'Turn on "Data security response" on the store\'s cloud connection and run its updated setup command: it grants the narrow write role this needs.',
        );
      }

      return unchangedFor.has(store!.name!)
        ? { changed: false, summary: `${store!.name} was already closed.` }
        : { changed: true, summary: `${store!.name} is closed now.` };
    }) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function run(step: PlaybookStepContext): Promise<PlaybookStepOutcome> {
  return await SecurityPlaybookActions.execute(step);
}

describe("the two steps", () => {
  test.each([
    [
      SecurityPlaybookActionType.BlockDataStorePublicAccess,
      "Block public access to data stores",
    ],
    [
      SecurityPlaybookActionType.RevokeDataStoreSharing,
      "Revoke data store sharing",
    ],
  ])(
    "%s is a Contain step that starts needing approval, which whoever adds it may turn off",
    (action: SecurityPlaybookActionType, title: string) => {
      const definition: ReturnType<typeof getSecurityPlaybookAction> =
        getSecurityPlaybookAction(action);

      expect(definition).toMatchObject({
        title,
        category: SecurityPlaybookActionCategory.Contain,
        // They change a cloud's settings; they cut no person or host off.
        isDisruptive: false,
        needsApprovalByDefault: true,
      });
      expect(doesActionNeedApprovalByDefault(definition)).toBe(true);
      // Not acted on through a security connection, user by user.
      expect(actsOnSecurityEntities(definition)).toBe(false);

      // The step editor starts a new one with Needs Approval on; it stays as saved.
      const [kept, off]: Array<SecurityPlaybookStep> =
        parseSecurityPlaybookSteps([
          { action, config: {}, requiresApproval: true },
          { action, config: { ignored: "x" }, requiresApproval: false },
        ]);

      expect(kept!.config).toEqual({});
      expect(doesStepNeedApproval(kept!)).toBe(true);
      expect(off!.config).toEqual({});
      expect(doesStepNeedApproval(off!)).toBe(false);
    },
  );

  test("each runs its own response action", () => {
    expect(
      getResponseActionOfStep(
        SecurityPlaybookActionType.BlockDataStorePublicAccess,
      ),
    ).toBe(DataSecurityResponseAction.BlockPublicAccess);
    expect(
      getResponseActionOfStep(
        SecurityPlaybookActionType.RevokeDataStoreSharing,
      ),
    ).toBe(DataSecurityResponseAction.RevokeSharing);
    expect(
      getResponseActionOfStep(SecurityPlaybookActionType.EmailPeople),
    ).toBeUndefined();
  });
});

describe("Block public access to data stores", () => {
  test("blocks each bucket the case is about, as OneUptime, and says which", async () => {
    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.BlockDataStorePublicAccess, [
        storeEntity(EXPORTS_KEY),
        { type: SecurityEntityType.User, value: "alice" },
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Block public access: done for **customer-exports**.",
    );
    expect(outcome.detailsInMarkdown?.toString()).toBe(
      "- **customer-exports**: customer-exports is closed now.",
    );
    expect(outcome.feedEventType).toBe(
      SecurityCaseFeedEventType.ResponseAction,
    );
    // No person runs it: a playbook acts as OneUptime, never naming an issue.
    expect(runSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dataStoreId: EXPORTS.id,
      action: DataSecurityResponseAction.BlockPublicAccess,
    });
  });

  test("a bucket marked public by design is left alone, and the step says so", async () => {
    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.BlockDataStorePublicAccess, [
        storeEntity(EXPORTS_KEY),
        storeEntity(WEBSITE_KEY),
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "- **www**: left alone, it is marked public by design.",
    );
  });

  test("a case whose only bucket is public by design skips the step", async () => {
    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.BlockDataStorePublicAccess, [
        storeEntity(WEBSITE_KEY),
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toBe(
      "Block public access: every data store of the case it fits is marked public by design, and was left alone.",
    );
    expect(runSpy).not.toHaveBeenCalled();
  });

  test("stores the step does not fit - a database, telemetry - are left out", async () => {
    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.BlockDataStorePublicAccess, [
        storeEntity(ORDERS_KEY),
        storeEntity(LOGS_KEY),
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toBe(
      "No data store of the case is a bucket or a storage account whose public access can be blocked.",
    );
    expect(runSpy).not.toHaveBeenCalled();
  });

  test("a bucket already closed is no failure: nothing to change", async () => {
    unchangedFor.add("customer-exports");

    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.BlockDataStorePublicAccess, [
        storeEntity(EXPORTS_KEY),
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.detailsInMarkdown?.toString()).toBe(
      "- **customer-exports**: nothing to change. customer-exports was already closed.",
    );
  });

  test("a bucket that could not be changed fails the step, naming it and why", async () => {
    failFor.add("customer-exports");

    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.BlockDataStorePublicAccess, [
        storeEntity(EXPORTS_KEY),
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.summary.toString()).toBe(
      "Block public access: no data store of the case could be changed.",
    );
    expect(outcome.error).toContain(
      'customer-exports: Turn on "Data security response"',
    );
  });

  test("one closed and one that could not be: done for the one, and still a failure", async () => {
    const second: DataStore = dataStore({
      storeKey: "cloud:gcp:bucket:backups",
      name: "backups",
      kind: DataStoreKind.GcpStorageBucket,
    });

    getJestSpyOn(DataStoreService, "findBy").mockResolvedValue([
      EXPORTS,
      second,
    ] as never);
    runSpy.mockImplementation((async (data: { dataStoreId: ObjectID }) => {
      if (data.dataStoreId.toString() === second.id!.toString()) {
        throw new BadDataException(
          "The store's cloud connection is gone or turned off.",
        );
      }

      return { changed: true, summary: "Closed." };
    }) as never);

    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.BlockDataStorePublicAccess, [
        storeEntity(EXPORTS_KEY),
        storeEntity("cloud:gcp:bucket:backups"),
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.summary.toString()).toBe(
      "Block public access: done for **customer-exports**; 1 could not be changed.",
    );
    expect(outcome.error).toBe(
      "backups: The store's cloud connection is gone or turned off.",
    );
  });

  test("a store's name is placed as text, never as Markdown", async () => {
    const odd: DataStore = dataStore({
      storeKey: "cloud:aws:odd",
      name: "exports**[click](https://evil.example)",
      kind: DataStoreKind.AwsS3Bucket,
    });

    getJestSpyOn(DataStoreService, "findBy").mockResolvedValue([odd] as never);
    runSpy.mockResolvedValue({ changed: true, summary: "Closed." } as never);

    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.BlockDataStorePublicAccess, [
        storeEntity("cloud:aws:odd"),
      ]),
    );

    expect(outcome.summary.toString()).not.toContain("[click](");
  });
});

describe("Revoke data store sharing", () => {
  test("revokes the sharing of each database the case is about, and leaves buckets to the other step", async () => {
    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.RevokeDataStoreSharing, [
        storeEntity(ORDERS_KEY),
        storeEntity(EXPORTS_KEY),
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Revoke sharing: done for **orders**.",
    );
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dataStoreId: ORDERS.id,
      action: DataSecurityResponseAction.RevokeSharing,
    });
  });

  test("a database marked public by design still has its sharing revoked: public by design is about public access", async () => {
    const publicDb: DataStore = dataStore({
      storeKey: "cloud:aws:db:public",
      name: "open-data",
      kind: DataStoreKind.AwsRdsInstance,
      isPublicByDesign: true,
    });

    getJestSpyOn(DataStoreService, "findBy").mockResolvedValue([
      publicDb,
    ] as never);
    runSpy.mockResolvedValue({ changed: true, summary: "Closed." } as never);

    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.RevokeDataStoreSharing, [
        storeEntity("cloud:aws:db:public"),
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  test("a case with no store of its kind skips the step", async () => {
    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.RevokeDataStoreSharing, [
        storeEntity(EXPORTS_KEY),
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toBe(
      "No data store of the case is a database or a snapshot whose sharing can be revoked.",
    );
  });
});

describe("a case about no data store", () => {
  test.each([
    SecurityPlaybookActionType.BlockDataStorePublicAccess,
    SecurityPlaybookActionType.RevokeDataStoreSharing,
  ])(
    "skips %s, and changes nothing",
    async (action: SecurityPlaybookActionType) => {
      const outcome: PlaybookStepOutcome = await run(
        context(action, [
          { type: SecurityEntityType.User, value: "alice" },
          { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
        ]),
      );

      expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
      expect(outcome.summary.toString()).toBe("The case names no data store.");
      expect(runSpy).not.toHaveBeenCalled();
    },
  );

  test("whose stores are gone from Data Security skips the step too", async () => {
    getJestSpyOn(DataStoreService, "findBy").mockResolvedValue([] as never);

    const outcome: PlaybookStepOutcome = await run(
      context(SecurityPlaybookActionType.BlockDataStorePublicAccess, [
        storeEntity("cloud:aws:gone"),
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(runSpy).not.toHaveBeenCalled();
  });
});
