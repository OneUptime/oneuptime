import DataStoreFeedService from "../../../../Server/Services/DataStoreFeedService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import UserService from "../../../../Server/Services/UserService";
import {
  DATA_STORE_COLUMNS_ON_THE_TIMELINE,
  describeDataStoreChanges,
  getDataStoreColumnTitle,
} from "../../../../Server/Utils/DataSecurity/DataStoreChangeFeed";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../../Models/DatabaseModels/DataStoreFeed";
import { Blue500, Gray500, Yellow500 } from "../../../../Types/BrandColors";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../../Types/DataSecurity/DataStoreEnvironment";
import ColumnAccessControl from "../../../../Types/Database/AccessControl/ColumnAccessControl";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A DATA STORE'S TIMELINE: what a person changed on it and to what, and
 * when discovery stopped seeing it or found it again.
 *
 * A store's settings decide what its checks find - Public By Design keeps
 * its public access from opening an issue, a Sensitivity Override sets how
 * severe every issue is - so the Timeline is where a reviewer reads who
 * changed them. These pin what it says, that a secret is never written
 * into it, and that every column a person may change is on it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const LINK: MarkdownText = mdText`[Data Store customer-exports](https://oneuptime.example/dashboard/p/data-security/stores/s)`;

let feedSpy: jest.SpyInstance;

beforeEach(() => {
  feedSpy = jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataStoreService, "getDataStoreMarkdownLink")
    .mockResolvedValue(LINK);
  jest
    .spyOn(DataStoreService, "findOneById")
    .mockResolvedValue(storeInProject() as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(mdText`Ada Lovelace`);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function storeInProject(): DataStore {
  const store: DataStore = new DataStore(STORE_ID);
  store.projectId = PROJECT_ID;
  return store;
}

function lines(data: JSONObject): Array<string> {
  return describeDataStoreChanges(data).map((line: MarkdownText): string => {
    return line.toString();
  });
}

interface UpdateHook {
  onUpdateSuccess: (
    onUpdate: unknown,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<unknown>;
}

function update(data: JSONObject, props: JSONObject): Promise<unknown> {
  return (DataStoreService as unknown as UpdateHook).onUpdateSuccess(
    {
      updateBy: { query: { _id: STORE_ID }, data: data, props: props },
      carryForward: [],
    },
    [STORE_ID],
  );
}

describe("what a change says", () => {
  test("a choice from a list is written as chosen: the environment, the sensitivity, on or off", () => {
    expect(
      lines({
        environment: DataStoreEnvironment.Production,
        sensitivityOverride: DataSensitivity.Restricted,
        isPublicByDesign: true,
        isContentScanEnabled: false,
      }),
    ).toEqual([
      "**Environment**: Production",
      "**Sensitivity Override**: Restricted",
      "**Public By Design**: On",
      "**Scan Content**: Off",
    ]);
  });

  test("an override taken off goes by the store's scans again", () => {
    expect(lines({ sensitivityOverride: null })).toEqual([
      "**Sensitivity Override**: As its scans find",
    ]);
  });

  test("a secret is only named: the connection string never reaches the Timeline", () => {
    const written: Array<string> = lines({
      connectionString: "postgres://reader:hunter2@db.internal:5432/orders",
    });

    expect(written).toEqual(["**Connection String** changed"]);
    expect(written.join("\n")).not.toContain("hunter2");
  });

  test("text a person wrote is named, not repeated", () => {
    expect(
      lines({
        name: "orders **prod**",
        purpose: "Billing",
        scanExclusions: ["tmp/*"],
      }),
    ).toEqual([
      "**Name** changed",
      "**Scan Exclusions** changed",
      "**Purpose** changed",
    ]);
  });

  test("what OneUptime writes is not a change worth a line", () => {
    expect(
      lines({ riskScore: 80, lastSeenAt: new Date(), isArchived: true }),
    ).toEqual([]);
    expect(describeDataStoreChanges(undefined)).toEqual([]);
  });

  test("every column on the Timeline is a column of the store, named by its own title", () => {
    const store: DataStore = new DataStore();

    for (const entry of DATA_STORE_COLUMNS_ON_THE_TIMELINE) {
      expect(store.hasColumn(entry.column)).toBe(true);
      expect(getDataStoreColumnTitle(entry.column)).toBe(
        store.getTableColumnMetadata(entry.column).title,
      );
    }
  });

  test("every column a person may change is on the Timeline, under each of its names", () => {
    // Every record's own columns, which no person changes through the API.
    const RECORD_COLUMNS: Array<string> = [
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
    ];
    const access: Dictionary<ColumnAccessControl> =
      new DataStore().getColumnAccessControlForAllColumns();
    const changeable: Array<string> = Object.keys(access)
      .filter((column: string): boolean => {
        return (
          !RECORD_COLUMNS.includes(column) &&
          (access[column]?.update || []).length > 0
        );
      })
      .sort();

    expect(
      DATA_STORE_COLUMNS_ON_THE_TIMELINE.flatMap(
        (entry: { column: string; alsoNamed?: Array<string> | undefined }) => {
          return [entry.column, ...(entry.alsoNamed || [])];
        },
      ).sort(),
    ).toEqual(changeable);
  });

  test("a probe chosen under either name is one line", () => {
    const probeId: string = "44444444-4444-4444-8444-444444444444";

    expect(lines({ scanProbeId: probeId })).toEqual([
      "**Scan From Probe** changed",
    ]);
    expect(
      lines({ scanProbe: { _id: probeId }, scanProbeId: probeId }),
    ).toEqual(["**Scan From Probe** changed"]);
  });
});

describe("a person's change, on the store's Timeline", () => {
  test("says who changed what, in grey, as the store's Updated entry", async () => {
    await update(
      { isPublicByDesign: true, environment: DataStoreEnvironment.Staging },
      { userId: USER_ID, tenantId: PROJECT_ID },
    );

    expect(feedSpy).toHaveBeenCalledTimes(1);
    expect(feedSpy).toHaveBeenCalledWith({
      dataStoreId: STORE_ID,
      projectId: PROJECT_ID,
      dataStoreFeedEventType: DataStoreFeedEventType.DataStoreUpdated,
      displayColor: Gray500,
      feedInfoInMarkdown: `📝 ${LINK.toString()} was updated by **Ada Lovelace**.`,
      moreInformationInMarkdown:
        "**Environment**: Staging\n\n**Public By Design**: On",
      userId: USER_ID,
    });
  });

  test("an API key's change says no name", async () => {
    await update({ environment: DataStoreEnvironment.Test }, {});

    expect(feedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        feedInfoInMarkdown: `📝 ${LINK.toString()} was updated.`,
        userId: undefined,
      }),
    );
  });

  test("OneUptime's own writes are not recorded", async () => {
    await update(
      { environment: DataStoreEnvironment.Production },
      { isRoot: true },
    );

    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("an update of nothing a person sets writes nothing", async () => {
    await update({ riskScore: 12 }, { userId: USER_ID });

    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("a Timeline that cannot be written never fails the change", async () => {
    feedSpy.mockRejectedValue(new Error("feed table locked"));

    await expect(
      update({ isAiData: true }, { userId: USER_ID }),
    ).resolves.toBeDefined();
  });
});

describe("discovery, on the store's Timeline", () => {
  test.each([
    [
      "Cloud inventory",
      "is gone from its cloud account's inventory, so it was archived.",
    ],
    [
      "Database product",
      "is no longer a database server in Databases, so it was archived.",
    ],
    [
      "Service map",
      "is no longer seen in any service's traces, so it was archived.",
    ],
    [undefined, "is no longer listed by its source, so it was archived."],
  ])(
    "a store found through %s that is gone says so, in yellow, and that it comes back",
    async (discoveredFrom: string | undefined, sentence: string) => {
      await DataStoreService.writeArchivedFeed({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        discoveredFrom: discoveredFrom,
      });

      expect(feedSpy).toHaveBeenCalledWith({
        dataStoreId: STORE_ID,
        projectId: PROJECT_ID,
        dataStoreFeedEventType: DataStoreFeedEventType.DataStoreArchived,
        displayColor: Yellow500,
        feedInfoInMarkdown: `🗄️ ${LINK.toString()} ${sentence} Its history is kept, and it comes back on its own once it is found again.`,
      });
    },
  );

  test("a store found again says it is back", async () => {
    await DataStoreService.writeRestoredFeed({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
    });

    expect(feedSpy).toHaveBeenCalledWith({
      dataStoreId: STORE_ID,
      projectId: PROJECT_ID,
      dataStoreFeedEventType: DataStoreFeedEventType.DataStoreRestored,
      displayColor: Blue500,
      feedInfoInMarkdown: `♻️ ${LINK.toString()} was found again, so it is back among the data stores.`,
    });
  });
});
