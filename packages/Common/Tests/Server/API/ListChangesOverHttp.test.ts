jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ADD_TO_LIST_KEY,
  REMOVE_FROM_LIST_KEY,
} from "../../../Types/Database/ListChanges";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryListEntryWrite,
  InMemoryTable,
  StoredRow,
  useInMemoryListEntryWrites,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN UPDATE THAT ADDS OR TAKES OFF SINGLE ENTRIES OF A LIST, THROUGH THE
 * SERVER'S OWN ROUTES OVER HTTP (#10135).
 *
 * PUT /api/<path>/:id and POST /api/<path>/:id/update-item take
 * `addToList` and `removeFromList` beside `data` (Types/Database/
 * ListChanges): through Express's JSON body parser, BaseAPI, the
 * permission layer, DatabaseService and the error handler, into a table in
 * memory. The monitor's service holds every label a write names to the
 * project, as MonitorService does (ProjectReferencesService), against the
 * project's labels (stubProjectDirectory). Its labels are kept as its
 * junction table keeps them: only the entries a write names change
 * (useInMemoryListEntryWrites).
 *
 * The monitor carries the label its team set, and one a label rule added.
 * Each kind of caller - a person, an API key, OneUptime itself - adds and
 * takes off single labels, the rule's always staying; one added by a rule
 * at the same moment stays too, where a write of the whole list drops it;
 * and what such an update may not do is refused with what to send instead.
 * And the Dashboard's own request, sent by its own code (ModelAPI).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10135000-0000-4000-8000-000000000001",
);
const MONITOR_ID: string = "10135000-0000-4000-8000-0000000000a1";
const MISSING_MONITOR_ID: string = "10135000-0000-4000-8000-0000000000a9";

// The label the team gave the monitor, one a label rule added, and others.
const PRODUCTION: string = "10135000-0000-4000-8000-0000000000b1";
const RULED: string = "10135000-0000-4000-8000-0000000000b2";
const CRITICAL: string = "10135000-0000-4000-8000-0000000000b3";
const PAYMENTS: string = "10135000-0000-4000-8000-0000000000b4";
const RULED_JUST_NOW: string = "10135000-0000-4000-8000-0000000000b5";
const OTHER_PROJECTS: string = "10135000-0000-4000-8000-0000000000b9";

const OWNER: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

const API_KEY: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
    isApiKey: true,
  }),
  ...ON_HIGHEST_PLAN,
};

const VIEWER: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.Viewer],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

const ROOT: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

/*
 * A monitor's service without MonitorService's own hooks (its probes, its
 * steps, its status), holding the labels a write names to the project as
 * MonitorService does.
 */
class LabelledMonitorService extends ProjectReferencesService<Monitor> {
  public constructor() {
    super(Monitor);
  }
}

const monitorService: LabelledMonitorService = new LabelledMonitorService();

let server: DashboardRequestsOverHttp;
let monitors: InMemoryTable;
let entryWrites: Array<InMemoryListEntryWrite>;
let caller: DatabaseCommonInteractionProps;

function storedMonitor(): StoredRow {
  return {
    _id: MONITOR_ID,
    projectId: PROJECT_ID.toString(),
    name: "Checkout API",
    slug: "checkout-api",
    labels: [{ _id: PRODUCTION }, { _id: RULED }],
  };
}

// The monitor's labels as its row holds them, sorted.
function labelsOfMonitor(): Array<string> {
  return ((monitors.get(MONITOR_ID)!["labels"] as Array<StoredRow>) || [])
    .map((label: StoredRow): string => {
      return String(label["_id"]).toLowerCase();
    })
    .sort();
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

const PATH: string = `/api/monitor/${MONITOR_ID}`;

// Every route that updates a record: PUT /:id, and POST /:id/update-item.
const UPDATE_ROUTES: Array<[string, string]> = [
  ["PUT", PATH],
  ["POST", `${PATH}/update-item`],
];

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<Monitor, DatabaseService<BaseModel>>(
      Monitor,
      monitorService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  // The project's labels: every one but OTHER_PROJECTS.
  stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      Label: [PRODUCTION, RULED, CRITICAL, PAYMENTS, RULED_JUST_NOW],
    },
  });
  caller = OWNER;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  monitors = useInMemoryTable(monitorService, [storedMonitor()]);
  entryWrites = useInMemoryListEntryWrites(monitorService, monitors);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a person, an API key and OneUptime itself add and take off single labels", () => {
  const CALLERS: Array<[string, DatabaseCommonInteractionProps]> = [
    ["a person", OWNER],
    ["an API key", API_KEY],
    ["OneUptime itself", ROOT],
  ];

  test.each(
    UPDATE_ROUTES.flatMap(
      ([method, path]: [string, string]): Array<
        [string, string, string, DatabaseCommonInteractionProps]
      > => {
        return CALLERS.map(
          ([who, props]: [string, DatabaseCommonInteractionProps]): [
            string,
            string,
            string,
            DatabaseCommonInteractionProps,
          ] => {
            return [method, path, who, props];
          },
        );
      },
    ),
  )(
    "%s %s by %s adds a label, and the rule's stays",
    async (
      method: string,
      path: string,
      _who: string,
      props: DatabaseCommonInteractionProps,
    ) => {
      caller = props;
      const sent: SentRequest = await server.request(method, path, {
        [ADD_TO_LIST_KEY]: { labels: [CRITICAL] },
      });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(labelsOfMonitor()).toEqual([PRODUCTION, RULED, CRITICAL].sort());
      // Only the label added is written: the list is never saved whole.
      expect(entryWrites).toEqual([
        {
          rowId: MONITOR_ID,
          writes: { labels: { add: [CRITICAL], remove: [] } },
        },
      ]);
      expect(monitors.repository.save).not.toHaveBeenCalled();
    },
  );

  test.each(
    UPDATE_ROUTES.flatMap(
      ([method, path]: [string, string]): Array<
        [string, string, string, DatabaseCommonInteractionProps]
      > => {
        return CALLERS.map(
          ([who, props]: [string, DatabaseCommonInteractionProps]): [
            string,
            string,
            string,
            DatabaseCommonInteractionProps,
          ] => {
            return [method, path, who, props];
          },
        );
      },
    ),
  )(
    "%s %s by %s takes a label off, and the rule's stays",
    async (
      method: string,
      path: string,
      _who: string,
      props: DatabaseCommonInteractionProps,
    ) => {
      caller = props;
      const sent: SentRequest = await server.request(method, path, {
        [REMOVE_FROM_LIST_KEY]: { labels: [PRODUCTION] },
      });

      expect(sent.status).toBe(200);
      expect(labelsOfMonitor()).toEqual([RULED]);
      expect(entryWrites).toEqual([
        {
          rowId: MONITOR_ID,
          writes: { labels: { add: [], remove: [PRODUCTION] } },
        },
      ]);
    },
  );

  test("adds and takes off at once, beside a change of another field, in one write", async () => {
    const sent: SentRequest = await server.request("PUT", PATH, {
      data: { name: "Checkout API (EU)" },
      [ADD_TO_LIST_KEY]: { labels: [CRITICAL, PAYMENTS] },
      [REMOVE_FROM_LIST_KEY]: { labels: [PRODUCTION] },
    });

    expect(sent.status).toBe(200);
    expect(monitors.get(MONITOR_ID)!["name"]).toBe("Checkout API (EU)");
    expect(labelsOfMonitor()).toEqual([RULED, CRITICAL, PAYMENTS].sort());
    expect(entryWrites).toHaveLength(1);
    expect(entryWrites[0]!.writes).toEqual({
      labels: { add: [CRITICAL, PAYMENTS], remove: [PRODUCTION] },
    });
    // The row's own column, in the same write.
    expect(monitors.updates).toEqual([
      {
        id: MONITOR_ID,
        set: expect.objectContaining({ name: "Checkout API (EU)" }),
      },
    ]);
    expect(monitors.updates[0]!.set).not.toHaveProperty("labels");
  });

  test("an entry the monitor has already, or does not have, changes nothing", async () => {
    const sent: SentRequest = await server.request("PUT", PATH, {
      [ADD_TO_LIST_KEY]: { labels: [PRODUCTION] },
      [REMOVE_FROM_LIST_KEY]: { labels: [PAYMENTS] },
    });

    expect(sent.status).toBe(200);
    expect(labelsOfMonitor()).toEqual([PRODUCTION, RULED].sort());
    expect(
      entryWrites.map((write: InMemoryListEntryWrite) => {
        return write.writes;
      }),
    ).toEqual([{ labels: { add: [], remove: [] } }]);
  });

  test("an entry is a label's ID or an object with its _id, in any case", async () => {
    const sent: SentRequest = await server.request("PUT", PATH, {
      [ADD_TO_LIST_KEY]: {
        labels: [{ _id: CRITICAL.toUpperCase() }, PAYMENTS],
      },
    });

    expect(sent.status).toBe(200);
    expect(labelsOfMonitor()).toEqual(
      [PRODUCTION, RULED, CRITICAL, PAYMENTS].sort(),
    );
  });
});

describe("a label a rule adds at the same moment", () => {
  // A label rule adds RULED_JUST_NOW right after the update read the monitor's labels.
  function aRuleAddsALabelAsTheUpdateRuns(): void {
    const findOneBy: typeof monitorService.findOneBy =
      monitorService.findOneBy.bind(monitorService);

    jest
      .spyOn(monitorService, "findOneBy")
      .mockImplementation(async (read: FindOneBy<Monitor>) => {
        const found: Monitor | null = await findOneBy(read);
        const row: StoredRow = monitors.get(MONITOR_ID)!;
        const labels: Array<StoredRow> = row["labels"] as Array<StoredRow>;

        if (
          !labels.some((label: StoredRow): boolean => {
            return label["_id"] === RULED_JUST_NOW;
          })
        ) {
          row["labels"] = [...labels, { _id: RULED_JUST_NOW }];
        }

        return found;
      });
  }

  test("stays when an update adds and takes off single labels", async () => {
    aRuleAddsALabelAsTheUpdateRuns();

    const sent: SentRequest = await server.request("PUT", PATH, {
      [ADD_TO_LIST_KEY]: { labels: [CRITICAL] },
      [REMOVE_FROM_LIST_KEY]: { labels: [PRODUCTION] },
    });

    expect(sent.status).toBe(200);
    expect(labelsOfMonitor()).toEqual([RULED, CRITICAL, RULED_JUST_NOW].sort());
  });

  test("is dropped by an update that sends the whole list, which is why the providers send single labels", async () => {
    aRuleAddsALabelAsTheUpdateRuns();

    const sent: SentRequest = await server.request("PUT", PATH, {
      data: {
        labels: [{ _id: RULED }, { _id: CRITICAL }],
      },
    });

    expect(sent.status).toBe(200);
    expect(labelsOfMonitor()).toEqual([RULED, CRITICAL].sort());
    expect(entryWrites).toEqual([]);
  });
});

describe("what such an update may not do is refused, and nothing is written", () => {
  async function refused(
    body: JSONObject,
    props: DatabaseCommonInteractionProps = OWNER,
  ): Promise<{ status: number; refusal: string }> {
    caller = props;
    const sent: SentRequest = await server.request("PUT", PATH, body);

    expect(labelsOfMonitor()).toEqual([PRODUCTION, RULED].sort());
    expect(entryWrites).toEqual([]);
    expect(monitors.updates).toEqual([]);

    return { status: sent.status, refusal: refusalOf(sent) };
  }

  test("a label of another project", async () => {
    const answer: { status: number; refusal: string } = await refused({
      [ADD_TO_LIST_KEY]: { labels: [OTHER_PROJECTS] },
    });

    expect(answer.status).toBe(400);
    expect(answer.refusal).toContain(OTHER_PROJECTS);
  });

  test("a field that is not a list of related records", async () => {
    expect(await refused({ [ADD_TO_LIST_KEY]: { name: [CRITICAL] } })).toEqual({
      status: 400,
      refusal: expect.stringContaining(
        "Monitor has no list of related records called name.",
      ),
    });
  });

  test("an entry that is not a record's ID", async () => {
    expect(
      await refused({ [ADD_TO_LIST_KEY]: { labels: ["production"] } }),
    ).toEqual({
      status: 400,
      refusal:
        'addToList.labels has an entry that is not the ID of a record: "production". Send the record\'s ID, or an object with its _id.',
    });
  });

  test("the same label added and taken off", async () => {
    expect(
      await refused({
        [ADD_TO_LIST_KEY]: { labels: [CRITICAL] },
        [REMOVE_FROM_LIST_KEY]: { labels: [CRITICAL] },
      }),
    ).toEqual({
      status: 400,
      refusal: `${CRITICAL} is both added to labels and taken off it. Send it in addToList or in removeFromList, not both.`,
    });
  });

  test("a list sent whole in data and changed entry by entry at once", async () => {
    expect(
      await refused({
        data: { labels: [{ _id: CRITICAL }] },
        [ADD_TO_LIST_KEY]: { labels: [PAYMENTS] },
      }),
    ).toEqual({
      status: 400,
      refusal:
        "labels is both in data and in addToList or removeFromList. Send the whole list in data, or the entries to add and take off in addToList and removeFromList.",
    });
  });

  test("entries that are not a list, and lists that are not an object", async () => {
    expect(await refused({ [ADD_TO_LIST_KEY]: { labels: CRITICAL } })).toEqual({
      status: 400,
      refusal:
        'addToList.labels lists the IDs of the records to add, such as ["<id>"]. Send a list.',
    });

    expect(await refused({ [REMOVE_FROM_LIST_KEY]: [CRITICAL] })).toEqual({
      status: 400,
      refusal:
        'removeFromList lists the entries of each list by its field, such as { "labels": ["<label id>"] }. Send an object.',
    });
  });

  test("by someone who may only read monitors", async () => {
    const answer: { status: number; refusal: string } = await refused(
      { [ADD_TO_LIST_KEY]: { labels: [CRITICAL] } },
      VIEWER,
    );

    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(answer.status).toBeLessThan(500);
  });

  test("an update with nothing in it, still", async () => {
    expect(await refused({ [ADD_TO_LIST_KEY]: {} })).toEqual({
      status: 400,
      refusal:
        'Invalid request body. The update payload should be an object of the form { "data": { ...fields to update... } }.',
    });
  });
});

describe("a monitor the caller cannot reach", () => {
  test("is answered as missing, and nothing is written", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/monitor/${MISSING_MONITOR_ID}`,
      { [ADD_TO_LIST_KEY]: { labels: [CRITICAL] } },
    );

    expect(sent.status).toBe(404);
    expect(entryWrites).toEqual([]);
    expect(labelsOfMonitor()).toEqual([PRODUCTION, RULED].sort());
  });
});

describe("the Dashboard's own request", () => {
  test("ModelAPI.updateById sends the entries beside the data, and the server writes only them", async () => {
    await ModelAPI.updateById({
      modelType: Monitor,
      id: new ObjectID(MONITOR_ID),
      data: {},
      listChanges: {
        labels: { add: [CRITICAL], remove: [PRODUCTION] },
      },
    });

    const sent: Array<SentRequest> = server.sentTo("PUT", PATH);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({
      data: {},
      [ADD_TO_LIST_KEY]: { labels: [CRITICAL] },
      [REMOVE_FROM_LIST_KEY]: { labels: [PRODUCTION] },
    });
    expect(sent[0]!.status).toBe(200);
    expect(labelsOfMonitor()).toEqual([RULED, CRITICAL].sort());
  });

  test("an update the server refuses reaches the Dashboard with the server's words", async () => {
    let message: string = "";

    try {
      await ModelAPI.updateById({
        modelType: Monitor,
        id: new ObjectID(MONITOR_ID),
        data: {},
        listChanges: {
          labels: { add: [OTHER_PROJECTS], remove: [] },
        },
      });
    } catch (err) {
      message = String((err as { message?: string }).message || err);
    }

    expect(message).toContain(OTHER_PROJECTS);
    expect(labelsOfMonitor()).toEqual([PRODUCTION, RULED].sort());
  });
});
