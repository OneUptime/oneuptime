import DataObservabilityAPI from "../../../Server/API/DataObservabilityAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DataProductService from "../../../Server/Services/DataProductService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import TableHealthIngest from "../../../Server/Utils/DataObservability/TableHealthIngest";
import DataAlertFeedbackRecorder from "../../../Server/Utils/DataObservability/DataAlertFeedbackRecorder";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DataProduct from "../../../Models/DatabaseModels/DataProduct";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DATA_OBSERVABILITY_API_ROUTES } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";

/*
 * THREE DATA OBSERVABILITY SETTINGS THAT WERE NEVER RECORDED (issue #6276):
 * watching a data store's tables, the paths watched in a bucket, and a data
 * product's badge link reset. Each route writes round DatabaseService's
 * hooks (one hook-free statement), so its change reached no audit log entry
 * - though watching a store and its paths are settings a person edits, and
 * the same change made anywhere else is recorded. Each route now records
 * the change itself, with the caller's props and the row as it was read:
 * pinned here against what reaches AuditLogService. What the recorder makes
 * of the badge's token, a secret only OneUptime writes, is pinned in ee's
 * AuditLogWritesRoundTheHooks. `jest` is the global one.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const recordedRoutes: Array<{
  method: string;
  uri: string;
  handlers: Array<Handler>;
}> = [];

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      const record: (
        method: string,
      ) => (uri: string, ...handlers: Array<Handler>) => void = (
        method: string,
      ) => {
        return (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ method, uri, handlers });
        };
      };

      return {
        post: record("post"),
        get: record("get"),
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn(), sendErrorResponse: jest.fn() };
});
/*
 * Database drivers the table-health collectors load, which none of these
 * routes reaches: stand-ins, so the suite loads where a driver is not
 * installed.
 */
jest.mock(
  "oracledb",
  () => {
    return { __esModule: true, default: {} };
  },
  { virtual: true },
);
jest.mock(
  "mongodb",
  () => {
    return { __esModule: true, MongoClient: class {} };
  },
  { virtual: true },
);

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const STORE: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const PRODUCT: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

interface Recorded {
  model: unknown;
  before: DataStore & DataProduct;
  updatedFields: JSONObject;
  itemId: ObjectID;
  props: DatabaseCommonInteractionProps;
  includeColumns?: Array<string> | undefined;
}

let props: DatabaseCommonInteractionProps;
let recorded: Array<Recorded>;
let writes: Array<JSONObject>;
let store: DataStore;
let product: DataProduct;
let next: jest.Mock;
const res: ExpressResponse = {} as ExpressResponse;

function handler(uri: string): Handler {
  const found: { handlers: Array<Handler> } | undefined = recordedRoutes.find(
    (item: { method: string; uri: string }) => {
      return item.method === "post" && item.uri === uri;
    },
  );

  expect(found).toBeDefined();
  return found!.handlers.slice(-1)[0]!;
}

function request(params: JSONObject, body: JSONObject = {}): ExpressRequest {
  return { body, params } as unknown as ExpressRequest;
}

beforeAll(() => {
  new DataObservabilityAPI();
});

beforeEach(() => {
  props = { userId: USER, userType: UserType.User, tenantId: PROJECT };
  recorded = [];
  writes = [];
  next = jest.fn();

  store = new DataStore(STORE);
  store.projectId = PROJECT;
  store.name = "warehouse-exports";
  store.kind = DataStoreKind.AwsS3Bucket;
  store.isTableHealthEnabled = false;

  product = new DataProduct(PRODUCT);
  product.projectId = PROJECT;
  product.name = "Revenue";
  product.badgeToken = "badge-old";

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });
  jest
    .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
    .mockReturnValue(PROJECT);
  jest
    .spyOn(CommonAPI, "assertPermittedInProject")
    .mockImplementation(() => {});

  jest.spyOn(DataStoreService, "findOneBy").mockImplementation((async () => {
    const copy: DataStore = new DataStore();
    Object.assign(copy, store);
    return copy;
  }) as never);
  jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { data: JSONObject }) => {
      writes.push(data.data);
    }) as never);
  jest.spyOn(DataProductService, "findOneBy").mockImplementation((async () => {
    const copy: DataProduct = new DataProduct();
    Object.assign(copy, product);
    return copy;
  }) as never);
  jest
    .spyOn(DataProductService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { data: JSONObject }) => {
      writes.push(data.data);
    }) as never);
  jest
    .spyOn(TableHealthIngest, "recordSnapshot")
    .mockResolvedValue(undefined as never);
  jest.spyOn(AuditLogService, "recordUpdate").mockImplementation((async (
    data: Recorded,
  ) => {
    recorded.push(data);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("watching a data store's tables", () => {
  const watch: () => Handler = (): Handler => {
    return handler(DATA_OBSERVABILITY_API_ROUTES.storeWatch(":id"));
  };

  test("turned on: by the caller, Watch Table Health off to on, once it is written", async () => {
    await watch()(
      request({ id: STORE.toString() }, { isWatched: true }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(recorded).toHaveLength(1);

    const entry: Recorded = recorded[0]!;

    expect(entry.model).toBeInstanceOf(DataStore);
    expect(entry.before.isTableHealthEnabled).toBe(false);
    // Named after the store.
    expect(entry.before.name).toBe("warehouse-exports");
    expect(entry.updatedFields).toEqual({ isTableHealthEnabled: true });
    expect(entry.itemId.toString()).toBe(STORE.toString());
    expect(entry.props).toBe(props);
    // A setting a person edits: no column has to be let in.
    expect(entry.includeColumns).toBeUndefined();
  });

  test("turned off: on to off; when it is collected next is never recorded", async () => {
    store.isTableHealthEnabled = true;

    for (const isWatched of [false, true]) {
      await watch()(
        request({ id: STORE.toString() }, { isWatched }),
        res,
        next,
      );
    }

    expect(
      recorded.map((entry: Recorded): JSONObject => {
        return entry.updatedFields;
      }),
    ).toEqual([
      { isTableHealthEnabled: false },
      { isTableHealthEnabled: true },
    ]);
    expect(writes[1]!["nextTableHealthCollectionAt"]).toBeInstanceOf(Date);
  });

  test("a store that is not found records nothing", async () => {
    (DataStoreService.findOneBy as unknown as jest.Mock).mockResolvedValue(
      null,
    );

    await watch()(
      request({ id: STORE.toString() }, { isWatched: true }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(recorded).toHaveLength(0);
  });
});

describe("the paths watched in a bucket", () => {
  const save: () => Handler = (): Handler => {
    return handler(DATA_OBSERVABILITY_API_ROUTES.storagePathsSave(":id"));
  };

  test("paths set: the paths, and watching turned on with them", async () => {
    await save()(
      request(
        { id: STORE.toString() },
        // One per line, however they were pasted.
        { watchedPaths: "/exports/daily\n  exports/hourly \n" },
      ),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.updatedFields).toEqual({
      watchedPaths: "exports/daily\nexports/hourly",
      isTableHealthEnabled: true,
    });
    expect(recorded[0]!.before.watchedPaths ?? null).toBeNull();
    expect(recorded[0]!.props).toBe(props);
  });

  test("every path taken out: the paths, gone", async () => {
    store.watchedPaths = "exports/daily";
    store.isTableHealthEnabled = true;

    await save()(
      request({ id: STORE.toString() }, { watchedPaths: "" }),
      res,
      next,
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.before.watchedPaths).toBe("exports/daily");
    expect(recorded[0]!.updatedFields).toEqual({ watchedPaths: null });
  });
});

describe("a data product's badge link reset", () => {
  test("the token, as a column only OneUptime writes that the entry may name", async () => {
    await handler(DATA_OBSERVABILITY_API_ROUTES.dataProductBadgeReset(":id"))(
      request({ id: PRODUCT.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();

    const answered: JSONObject = (
      Response.sendJsonObjectResponse as unknown as jest.Mock
    ).mock.calls[0]![2] as JSONObject;

    expect(recorded).toHaveLength(1);

    const entry: Recorded = recorded[0]!;

    expect(entry.model).toBeInstanceOf(DataProduct);
    expect(entry.before.name).toBe("Revenue");
    expect(entry.before.badgeToken).toBe("badge-old");
    expect(entry.updatedFields).toEqual({
      badgeToken: answered["badgeToken"],
    });
    expect(entry.includeColumns).toEqual(["badgeToken"]);
    expect(entry.props).toBe(props);
  });
});

/*
 * Feedback that resolves a data alert (issue #6300's family): the
 * resolution is the person's, so the route hands their props to the
 * recorder, which resolves the alert on their behalf
 * (DataAlertFeedbackRecorder.test.ts).
 */
describe("feedback on a data alert", () => {
  test("hands the caller's props, and who they are, to the feedback it records", async () => {
    const record: jest.SpyInstance = jest
      .spyOn(DataAlertFeedbackRecorder, "record")
      .mockResolvedValue(undefined);

    await handler(DATA_OBSERVABILITY_API_ROUTES.alertFeedback(":id"))(
      request(
        { id: "55555555-5555-4555-8555-555555555555" },
        { feedback: "Not an Issue" },
      ),
      res,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(1);

    const call: Record<string, unknown> = record.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(call["props"]).toBe(props);
    expect(call["userId"]).toBe(USER);
    expect(call["feedback"]).toBe("Not an Issue");
  });
});
