import DataStore from "../../../../Models/DatabaseModels/DataStore";
import SecurityEntityCriticalityEntry from "../../../../Models/DatabaseModels/SecurityEntityCriticality";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import SecurityEntityCriticalityService from "../../../../Server/Services/SecurityEntityCriticalityService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../../Server/Types/Database/Hooks";
import ProjectReferenceCheck from "../../../../Server/Utils/Database/ProjectReferenceCheck";
import {
  DATA_SECURITY_CRITICALITY_DESCRIPTION,
  DataSecurityCriticalitySyncResult,
  getDataSecurityCriticalityDescription,
  getEffectiveStoreSensitivity,
  getWantedCriticalityEntries,
  readDataSecurityCriticalityEntry,
  syncProjectCriticality,
} from "../../../../Server/Utils/DataSecurity/DataSecurityCriticalitySync";
import logger from "../../../../Server/Utils/Logger";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SecurityEntityCriticality as Criticality } from "../../../../Types/SecurityCase/SecurityEntityRisk";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * How much a data store matters, from what it holds: Data Security keeps an
 * Entity Criticality entry for every Confidential store (High) and every
 * Restricted one (Extreme), through the list's own service, and takes its
 * entries back from the stores no longer sensitive. An entry a person
 * created or changed is theirs: it is never written over, and Data
 * Security's own entry for the same store steps aside.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PERSON_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const ORDERS: string = "cloud:aws:AWS S3 Bucket:arn:aws:s3:::orders";
const CARDS: string = "cloud:aws:AWS S3 Bucket:arn:aws:s3:::cards";
const LOGS: string = "telemetry:5f0c2a4e:Logs";
const WIKI: string = "manual:7a1d0b2c-0000-4000-8000-000000000001";

function store(
  storeKey: string,
  sensitivity: DataSensitivity,
  sensitivityOverride?: DataSensitivity,
): DataStore {
  const model: DataStore = new DataStore();
  model._id = ObjectID.generate().toString();
  model.projectId = PROJECT_ID;
  model.storeKey = storeKey;
  model.sensitivity = sensitivity;

  if (sensitivityOverride) {
    model.sensitivityOverride = sensitivityOverride;
  }

  return model;
}

function entry(data: {
  value: string;
  criticality: Criticality;
  description?: string | undefined;
  entityType?: SecurityEntityType | undefined;
  createdByUserId?: ObjectID | undefined;
}): SecurityEntityCriticalityEntry {
  const model: SecurityEntityCriticalityEntry =
    new SecurityEntityCriticalityEntry();
  model._id = ObjectID.generate().toString();
  model.projectId = PROJECT_ID;
  model.value = data.value;
  model.criticality = data.criticality;

  if (data.entityType) {
    model.entityType = data.entityType;
  }

  if (data.description !== undefined) {
    model.description = data.description;
  }

  if (data.createdByUserId) {
    model.createdByUserId = data.createdByUserId;
  }

  return model;
}

// An entry Data Security wrote for a store at this sensitivity.
function own(
  storeKey: string,
  sensitivity: DataSensitivity,
): SecurityEntityCriticalityEntry {
  return entry({
    value: `data-store:${storeKey}`,
    entityType: SecurityEntityType.DataStore,
    criticality:
      sensitivity === DataSensitivity.Restricted
        ? Criticality.Extreme
        : Criticality.High,
    description: getDataSecurityCriticalityDescription(sensitivity),
  });
}

type Spy = ReturnType<typeof getJestSpyOn>;

let stores: Array<DataStore>;
let entries: Array<SecurityEntityCriticalityEntry>;
let created: Array<SecurityEntityCriticalityEntry>;
let updated: Array<{ id: string; data: JSONObject }>;
let deleted: Array<string>;
let create: Spy;
let updateOneById: Spy;
let deleteOneById: Spy;

beforeEach(() => {
  stores = [];
  entries = [];
  created = [];
  updated = [];
  deleted = [];

  getJestSpyOn(DataStoreService, "findBy").mockImplementation((async () => {
    return stores;
  }) as never);
  getJestSpyOn(SecurityEntityCriticalityService, "findBy").mockImplementation(
    (async () => {
      return entries;
    }) as never,
  );
  create = getJestSpyOn(
    SecurityEntityCriticalityService,
    "create",
  ).mockImplementation((async (args: {
    data: SecurityEntityCriticalityEntry;
  }) => {
    created.push(args.data);
    return args.data;
  }) as never);
  updateOneById = getJestSpyOn(
    SecurityEntityCriticalityService,
    "updateOneById",
  ).mockImplementation((async (args: { id: ObjectID; data: JSONObject }) => {
    updated.push({ id: args.id.toString(), data: args.data });
  }) as never);
  deleteOneById = getJestSpyOn(
    SecurityEntityCriticalityService,
    "deleteOneById",
  ).mockImplementation((async (args: { id: ObjectID }) => {
    deleted.push(args.id.toString());
    return 1;
  }) as never);
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the entries sensitive stores call for", () => {
  test("Confidential is High, Restricted Extreme; Internal and Public none", () => {
    const wanted: ReturnType<typeof getWantedCriticalityEntries> =
      getWantedCriticalityEntries([
        store(ORDERS, DataSensitivity.Confidential),
        store(CARDS, DataSensitivity.Restricted),
        store(LOGS, DataSensitivity.Internal),
        store(WIKI, DataSensitivity.Public),
      ]);

    expect(Array.from(wanted.values())).toEqual([
      {
        value: `data-store:${ORDERS}`,
        sensitivity: DataSensitivity.Confidential,
        criticality: Criticality.High,
      },
      {
        value: `data-store:${CARDS}`,
        sensitivity: DataSensitivity.Restricted,
        criticality: Criticality.Extreme,
      },
    ]);
  });

  test("a person's override is the store's sensitivity", () => {
    expect(
      getEffectiveStoreSensitivity(
        store(WIKI, DataSensitivity.Public, DataSensitivity.Restricted),
      ),
    ).toBe(DataSensitivity.Restricted);
    expect(
      getEffectiveStoreSensitivity(
        store(CARDS, DataSensitivity.Restricted, DataSensitivity.Internal),
      ),
    ).toBe(DataSensitivity.Internal);
  });

  test("a key the list could not hold as written - too long, or a pattern - gets none", () => {
    const wanted: ReturnType<typeof getWantedCriticalityEntries> =
      getWantedCriticalityEntries([
        store(`cloud:aws:${"x".repeat(495)}`, DataSensitivity.Restricted),
        store("manual:orders-*", DataSensitivity.Restricted),
      ]);

    expect(wanted.size).toBe(0);
  });
});

describe("which entries are Data Security's own", () => {
  test("its description, the criticality that sensitivity sets, a data store, and nobody's", () => {
    expect(
      readDataSecurityCriticalityEntry(
        own(ORDERS, DataSensitivity.Confidential),
      ),
    ).toBe(DataSensitivity.Confidential);
    expect(
      readDataSecurityCriticalityEntry(own(CARDS, DataSensitivity.Restricted)),
    ).toBe(DataSensitivity.Restricted);
    expect(
      getDataSecurityCriticalityDescription(DataSensitivity.Restricted),
    ).toBe(`${DATA_SECURITY_CRITICALITY_DESCRIPTION}: Restricted.`);
  });

  test("a person's entry, or one a person changed, is not", () => {
    const created: SecurityEntityCriticalityEntry = own(
      ORDERS,
      DataSensitivity.Confidential,
    );
    created.createdByUserId = PERSON_ID;

    const reweighed: SecurityEntityCriticalityEntry = own(
      ORDERS,
      DataSensitivity.Confidential,
    );
    reweighed.criticality = Criticality.Low;

    const redescribed: SecurityEntityCriticalityEntry = own(
      ORDERS,
      DataSensitivity.Confidential,
    );
    redescribed.description = "The quarterly exports. Matters a lot.";

    const retyped: SecurityEntityCriticalityEntry = own(
      ORDERS,
      DataSensitivity.Confidential,
    );
    delete (retyped as unknown as JSONObject)["entityType"];

    for (const changed of [created, reweighed, redescribed, retyped]) {
      expect(readDataSecurityCriticalityEntry(changed)).toBeNull();
    }
  });
});

describe("syncProjectCriticality", () => {
  test("adds an entry for every sensitive store, through the list's own service", async () => {
    stores = [
      store(ORDERS, DataSensitivity.Confidential),
      store(CARDS, DataSensitivity.Restricted),
      store(LOGS, DataSensitivity.Internal),
      store(WIKI, DataSensitivity.Public, DataSensitivity.Confidential),
    ];

    const result: DataSecurityCriticalitySyncResult =
      await syncProjectCriticality(PROJECT_ID);

    expect(result).toEqual({
      created: 3,
      updated: 0,
      removed: 0,
      leftToPeople: 0,
      failed: 0,
    });
    expect(
      created.map((model: SecurityEntityCriticalityEntry) => {
        return {
          projectId: model.projectId?.toString(),
          value: model.value,
          entityType: model.entityType,
          criticality: model.criticality,
          description: model.description,
        };
      }),
    ).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        value: `data-store:${ORDERS}`,
        entityType: SecurityEntityType.DataStore,
        criticality: Criticality.High,
        description: `${DATA_SECURITY_CRITICALITY_DESCRIPTION}: Confidential.`,
      },
      {
        projectId: PROJECT_ID.toString(),
        value: `data-store:${CARDS}`,
        entityType: SecurityEntityType.DataStore,
        criticality: Criticality.Extreme,
        description: `${DATA_SECURITY_CRITICALITY_DESCRIPTION}: Restricted.`,
      },
      {
        projectId: PROJECT_ID.toString(),
        value: `data-store:${WIKI}`,
        entityType: SecurityEntityType.DataStore,
        criticality: Criticality.High,
        description: `${DATA_SECURITY_CRITICALITY_DESCRIPTION}: Confidential.`,
      },
    ]);
    // As OneUptime, never as a person.
    expect(create.mock.calls[0]![0]).toMatchObject({ props: { isRoot: true } });
  });

  test("an entry it adds passes the list's own checks", async () => {
    stores = [store(CARDS, DataSensitivity.Restricted)];
    await syncProjectCriticality(PROJECT_ID);

    getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
      undefined as never,
    );

    const checked: OnCreate<SecurityEntityCriticalityEntry> = await (
      SecurityEntityCriticalityService as unknown as {
        onBeforeCreate: (
          createBy: CreateBy<SecurityEntityCriticalityEntry>,
        ) => Promise<OnCreate<SecurityEntityCriticalityEntry>>;
      }
    ).onBeforeCreate({ data: created[0]!, props: { isRoot: true } });

    expect(checked.createBy.data.entityType).toBe(SecurityEntityType.DataStore);
    expect(checked.createBy.data.value).toBe(`data-store:${CARDS}`);
    expect(checked.createBy.data.criticality).toBe(Criticality.Extreme);
  });

  test("leaves its own entry alone while the store is as sensitive, and follows it when it changes", async () => {
    const kept: SecurityEntityCriticalityEntry = own(
      ORDERS,
      DataSensitivity.Confidential,
    );
    const raised: SecurityEntityCriticalityEntry = own(
      CARDS,
      DataSensitivity.Confidential,
    );

    stores = [
      store(ORDERS, DataSensitivity.Confidential),
      store(CARDS, DataSensitivity.Restricted),
    ];
    entries = [kept, raised];

    const result: DataSecurityCriticalitySyncResult =
      await syncProjectCriticality(PROJECT_ID);

    expect(result).toMatchObject({ created: 0, updated: 1, removed: 0 });
    expect(updated).toEqual([
      {
        id: raised.id!.toString(),
        data: {
          criticality: Criticality.Extreme,
          description: `${DATA_SECURITY_CRITICALITY_DESCRIPTION}: Restricted.`,
        },
      },
    ]);
    expect(updateOneById.mock.calls[0]![0]).toMatchObject({
      props: { isRoot: true },
    });
    expect(created).toEqual([]);
  });

  test("takes back its own entries of stores no longer sensitive, archived or gone", async () => {
    const lowered: SecurityEntityCriticalityEntry = own(
      ORDERS,
      DataSensitivity.Confidential,
    );
    const gone: SecurityEntityCriticalityEntry = own(
      "cloud:aws:AWS S3 Bucket:arn:aws:s3:::deleted",
      DataSensitivity.Restricted,
    );

    // Archived stores are not read at all: theirs go with the gone ones.
    stores = [store(ORDERS, DataSensitivity.Internal)];
    entries = [lowered, gone];

    const result: DataSecurityCriticalitySyncResult =
      await syncProjectCriticality(PROJECT_ID);

    expect(result).toMatchObject({ created: 0, updated: 0, removed: 2 });
    expect(deleted.sort()).toEqual(
      [lowered.id!.toString(), gone.id!.toString()].sort(),
    );
    expect(deleteOneById.mock.calls[0]![0]).toMatchObject({
      props: { isRoot: true },
    });
    expect(
      (DataStoreService.findBy as unknown as Spy).mock.calls[0]![0],
    ).toMatchObject({ query: { projectId: PROJECT_ID, isArchived: false } });
  });

  test("never writes over an entry a person created or changed, and never adds one beside it", async () => {
    // A person said how much the orders bucket matters.
    const persons: SecurityEntityCriticalityEntry = entry({
      value: `DATA-STORE:${ORDERS}`,
      entityType: SecurityEntityType.DataStore,
      criticality: Criticality.Low,
      description: "A copy; the real one is elsewhere.",
      createdByUserId: PERSON_ID,
    });
    // A person turned Data Security's own card entry down to High.
    const changed: SecurityEntityCriticalityEntry = own(
      CARDS,
      DataSensitivity.Restricted,
    );
    changed.criticality = Criticality.High;
    // A person's entry for any kind of entity, naming the wiki.
    const anyKind: SecurityEntityCriticalityEntry = entry({
      value: `data-store:${WIKI}`,
      criticality: Criticality.Low,
    });

    stores = [
      store(ORDERS, DataSensitivity.Restricted),
      store(CARDS, DataSensitivity.Restricted),
      store(WIKI, DataSensitivity.Confidential),
    ];
    entries = [persons, changed, anyKind];

    const result: DataSecurityCriticalitySyncResult =
      await syncProjectCriticality(PROJECT_ID);

    expect(result).toEqual({
      created: 0,
      updated: 0,
      removed: 0,
      leftToPeople: 3,
      failed: 0,
    });
    expect(created).toEqual([]);
    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
  });

  test("steps aside when a person lists a store it already has an entry for", async () => {
    const ours: SecurityEntityCriticalityEntry = own(
      ORDERS,
      DataSensitivity.Restricted,
    );
    const persons: SecurityEntityCriticalityEntry = entry({
      value: `data-store:${ORDERS}`,
      entityType: SecurityEntityType.DataStore,
      criticality: Criticality.High,
      createdByUserId: PERSON_ID,
    });

    stores = [store(ORDERS, DataSensitivity.Restricted)];
    entries = [ours, persons];

    const result: DataSecurityCriticalitySyncResult =
      await syncProjectCriticality(PROJECT_ID);

    expect(deleted).toEqual([ours.id!.toString()]);
    expect(result).toMatchObject({ removed: 1, leftToPeople: 1, created: 0 });
  });

  test("a person's pattern or an entry for another kind does not stop a store's own entry", async () => {
    stores = [store(ORDERS, DataSensitivity.Confidential)];
    entries = [
      entry({ value: "data-store:*", criticality: Criticality.Low }),
      entry({
        value: `data-store:${ORDERS}`,
        entityType: SecurityEntityType.Host,
        criticality: Criticality.Low,
        createdByUserId: PERSON_ID,
      }),
    ];

    await syncProjectCriticality(PROJECT_ID);

    expect(
      created.map((model: SecurityEntityCriticalityEntry) => {
        return model.value;
      }),
    ).toEqual([`data-store:${ORDERS}`]);
  });

  test("a write the list refuses is counted and logged, and the rest go on", async () => {
    stores = [
      store(ORDERS, DataSensitivity.Confidential),
      store(CARDS, DataSensitivity.Restricted),
    ];
    create.mockImplementationOnce((async () => {
      throw new BadDataException(
        `"data-store:${ORDERS}" is already in the list.`,
      );
    }) as never);

    const result: DataSecurityCriticalitySyncResult =
      await syncProjectCriticality(PROJECT_ID);

    expect(result).toMatchObject({ created: 1, failed: 1 });
    expect(logger.error).toHaveBeenCalled();
  });

  test("never throws when the list cannot be read", async () => {
    getJestSpyOn(SecurityEntityCriticalityService, "findBy").mockRejectedValue(
      new Error("database is down") as never,
    );
    stores = [store(ORDERS, DataSensitivity.Confidential)];

    const result: DataSecurityCriticalitySyncResult =
      await syncProjectCriticality(PROJECT_ID);

    expect(result).toEqual({
      created: 0,
      updated: 0,
      removed: 0,
      leftToPeople: 0,
      failed: 1,
    });
    expect(created).toEqual([]);
  });
});
