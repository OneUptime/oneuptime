import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * POST (or GET) /<value route>/:id/usage - what the dashboard's Archive and
 * Delete dialogs ask before they open: how many of the project's records use
 * a state, a severity, a monitor status, a label or an incident role, and
 * what deleting it would do to each (ArchivableValueUsage).
 *
 * It takes what archiving or deleting the value takes, answers only for a
 * value of the project asked about that the caller may read, counts as
 * OneUptime, and sends back counts only. The route is the real one
 * ArchivableValueAPI registers; the counting and the value read are
 * answered here.
 *
 * And POST /<value route>/usage, for a bulk Archive's or Delete's dialog:
 * the same for several values at once, named in the body - only the ones
 * the caller may read are counted.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import ArchivableValueAPI, {
  ARCHIVABLE_VALUES_USAGE_MAX_IDS,
  ARCHIVABLE_VALUE_USAGE_ROUTE,
} from "../../../Server/API/ArchivableValueAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DatabaseService from "../../../Server/Services/DatabaseService";
import LabelService, {
  Service as LabelServiceType,
} from "../../../Server/Services/LabelService";
import MonitorService from "../../../Server/Services/MonitorService";
import ArchivableValueUsage from "../../../Server/Utils/Database/ArchivableValueUsage";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import {
  ArchivableValueDeleteEffect,
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
  ArchivableValuesUsage,
  ArchivableValuesUsagePurpose,
} from "../../../Types/ArchivableValue/ArchivableValueUsage";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-a91c-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-a91c-4aaa-8bbb-000000000002");
const LABEL_ID: string = "0193c0de-a91c-4aaa-8bbb-0000000000a1";

const USAGE: Array<ArchivableValueUsageItem> = [
  {
    tableName: "Monitor",
    title: "Monitors",
    singularTitle: "Monitor",
    count: 4,
    isCountCapped: false,
    effect: ArchivableValueDeleteEffect.RemovedFromList,
    kind: ArchivableValueUsageKind.Records,
  },
];

/*
 * A signed-in person, as CommonAPI hands their request on: with their
 * project's plan, which billing checks a write permission against.
 */
function personWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    currentPlan: PlanType.Growth,
    isSubscriptionUnpaid: false,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  };
}

let caller: DatabaseCommonInteractionProps;
let countUses: ReturnType<typeof jest.spyOn>;
let findValue: ReturnType<typeof jest.spyOn>;
let foundValue: Label | null;

beforeEach(() => {
  mockRouter.routes.length = 0;
  caller = personWith([Permission.EditProjectLabel]);
  foundValue = new Label();
  foundValue._id = LABEL_ID;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    }) as never);

  findValue = jest
    .spyOn(LabelService, "findOneById")
    .mockImplementation((async (): Promise<Label | null> => {
      return foundValue;
    }) as never);

  jest
    .spyOn(PostgresAppInstance, "getDataSource")
    .mockReturnValue({ entityMetadatas: [] } as never);

  countUses = jest
    .spyOn(ArchivableValueUsage, "countUses")
    .mockResolvedValue(USAGE as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();
});

function labelsApi(): ArchivableValueAPI<Label, LabelServiceType> {
  return new ArchivableValueAPI<Label, LabelServiceType>(Label, LabelService);
}

async function askUsage(id: string = LABEL_ID): Promise<void> {
  labelsApi();

  const request: ExpressRequest = {
    params: { id },
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const response: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  } as unknown as ExpressResponse;

  let failure: unknown = null;

  const next: NextFunction = ((error: unknown): void => {
    failure = error;
  }) as NextFunction;

  await mockRouter
    .match("POST", `/label/:id${ARCHIVABLE_VALUE_USAGE_ROUTE}`)
    .handlerFunction(request, response, next);

  if (failure) {
    throw failure;
  }
}

describe("the usage route", () => {
  test("is POST and GET <route>/:id/usage, behind the signed-in check", () => {
    labelsApi();

    for (const method of ["POST", "GET"]) {
      expect(mockRouter.match(method, "/label/:id/usage").middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
      ]);
    }
  });

  test("is only for a value records pick from", () => {
    expect(() => {
      return new ArchivableValueAPI<Monitor, DatabaseService<BaseModel>>(
        Monitor,
        MonitorService as unknown as DatabaseService<BaseModel>,
      );
    }).toThrow("Monitor is not a value that can be archived.");
  });
});

describe("asking what uses a value", () => {
  test("answers the counts of the project's records, and nothing else", async () => {
    await askUsage();

    expect(countUses).toHaveBeenCalledTimes(1);

    const asked: {
      valueTable: string;
      valueId: ObjectID;
      projectId: ObjectID;
    } = countUses.mock.calls[0]![0] as {
      valueTable: string;
      valueId: ObjectID;
      projectId: ObjectID;
    };

    expect(asked.valueTable).toBe("Label");
    expect(asked.valueId.toString()).toBe(LABEL_ID);
    expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());

    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(
      (Response.sendJsonObjectResponse as jest.Mock).mock.calls[0]![2],
    ).toEqual({ usage: USAGE });
  });

  test("reads the value as the caller: it must be one they may read", async () => {
    await askUsage();

    const read: { props: DatabaseCommonInteractionProps } = findValue.mock
      .calls[0]![0] as { props: DatabaseCommonInteractionProps };

    expect(read.props).toBe(caller);
  });

  test("a value the caller can't read, or of another project, is not found", async () => {
    foundValue = null;

    await expect(askUsage()).rejects.toBeInstanceOf(NotFoundException);
    expect(countUses).not.toHaveBeenCalled();
  });

  test("someone who may delete the value, but not edit it, may ask too", async () => {
    caller = personWith([Permission.DeleteProjectLabel]);

    await askUsage();

    expect(countUses).toHaveBeenCalledTimes(1);
  });

  test("someone who may only read values is refused, and nothing is counted", async () => {
    caller = personWith([Permission.ReadProjectLabel]);

    await expect(askUsage()).rejects.toThrow();
    expect(countUses).not.toHaveBeenCalled();
    expect(findValue).not.toHaveBeenCalled();
  });

  test("an id that is not one is refused", async () => {
    await expect(askUsage("not-an-id")).rejects.toBeInstanceOf(
      BadDataException,
    );
    expect(countUses).not.toHaveBeenCalled();
  });

  test("a request that names no project is refused", async () => {
    caller = {
      ...personWith([Permission.EditProjectLabel]),
      tenantId: undefined,
    };

    await expect(askUsage()).rejects.toBeInstanceOf(BadDataException);
    expect(countUses).not.toHaveBeenCalled();
  });
});

describe("asking about several values at once", () => {
  const OTHER_ID: string = "0193c0de-a91c-4aaa-8bbb-0000000000a2";
  const UNKNOWN_ID: string = "0193c0de-a91c-4aaa-8bbb-0000000000a3";

  const ANSWER: ArchivableValuesUsage = {
    usage: USAGE,
    refusedValueIds: [],
    refusedUsage: [],
  };

  let countValuesUsage: ReturnType<typeof jest.spyOn>;
  let findValues: ReturnType<typeof jest.spyOn>;
  let foundValues: Array<Label>;

  beforeEach(() => {
    foundValues = [LABEL_ID, OTHER_ID].map((id: string): Label => {
      const label: Label = new Label();
      label._id = id;
      return label;
    });

    findValues = jest
      .spyOn(LabelService, "findBy")
      .mockImplementation((async (): Promise<Array<Label>> => {
        return foundValues;
      }) as never);

    countValuesUsage = jest
      .spyOn(ArchivableValueUsage, "countValuesUsage")
      .mockResolvedValue(ANSWER as never);
  });

  async function askValuesUsage(body: unknown): Promise<void> {
    labelsApi();

    const request: ExpressRequest = {
      params: {},
      body: body,
      headers: {},
    } as unknown as ExpressRequest;

    const response: ExpressResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    } as unknown as ExpressResponse;

    let failure: unknown = null;

    const next: NextFunction = ((error: unknown): void => {
      failure = error;
    }) as NextFunction;

    await mockRouter
      .match("POST", `/label${ARCHIVABLE_VALUE_USAGE_ROUTE}`)
      .handlerFunction(request, response, next);

    if (failure) {
      throw failure;
    }
  }

  test("is POST <route>/usage, behind the signed-in check, and no GET", () => {
    labelsApi();

    expect(mockRouter.match("POST", "/label/usage").middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
    expect(() => {
      return mockRouter.match("GET", "/label/usage");
    }).toThrow();
  });

  test("counts the values the caller may read, in the project asked about, for a Delete", async () => {
    await askValuesUsage({
      ids: [LABEL_ID, OTHER_ID.toUpperCase(), UNKNOWN_ID],
      purpose: ArchivableValuesUsagePurpose.Delete,
    });

    // The values are read as the caller.
    const read: {
      props: DatabaseCommonInteractionProps;
      limit: number;
    } = findValues.mock.calls[0]![0] as {
      props: DatabaseCommonInteractionProps;
      limit: number;
    };

    expect(read.props).toBe(caller);
    expect(read.limit).toBe(3);

    expect(countValuesUsage).toHaveBeenCalledTimes(1);

    const asked: {
      valueTable: string;
      valueIds: Array<string>;
      projectId: ObjectID;
      purpose: ArchivableValuesUsagePurpose;
    } = countValuesUsage.mock.calls[0]![0] as {
      valueTable: string;
      valueIds: Array<string>;
      projectId: ObjectID;
      purpose: ArchivableValuesUsagePurpose;
    };

    expect(asked.valueTable).toBe("Label");
    // Only the ones found: the unknown id is not counted.
    expect(asked.valueIds).toEqual([LABEL_ID, OTHER_ID]);
    expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(asked.purpose).toBe(ArchivableValuesUsagePurpose.Delete);

    expect(
      (Response.sendJsonObjectResponse as jest.Mock).mock.calls[0]![2],
    ).toEqual({ usage: USAGE, refusedValueIds: [], refusedUsage: [] });
  });

  test("anything but a Delete asks what keeps using them: an Archive", async () => {
    for (const purpose of [undefined, "Archive", "Everything"]) {
      countValuesUsage.mockClear();

      await askValuesUsage({ ids: [LABEL_ID], purpose: purpose });

      expect(
        (
          countValuesUsage.mock.calls[0]![0] as {
            purpose: ArchivableValuesUsagePurpose;
          }
        ).purpose,
      ).toBe(ArchivableValuesUsagePurpose.Archive);
    }
  });

  test("none the caller may read, or of another project: not found", async () => {
    foundValues = [];

    await expect(askValuesUsage({ ids: [LABEL_ID] })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(countValuesUsage).not.toHaveBeenCalled();
  });

  test("a body that names no values, or ids that are not ids, is refused", async () => {
    for (const body of [
      {},
      { ids: [] },
      { ids: LABEL_ID },
      { ids: [3] },
      { ids: [LABEL_ID, "not-an-id"] },
      null,
    ]) {
      await expect(askValuesUsage(body)).rejects.toBeInstanceOf(
        BadDataException,
      );
    }

    expect(findValues).not.toHaveBeenCalled();
    expect(countValuesUsage).not.toHaveBeenCalled();
  });

  test("more values than a bulk selection holds are refused", async () => {
    const ids: Array<string> = [];

    for (let index: number = 0; index <= ARCHIVABLE_VALUES_USAGE_MAX_IDS; index++) {
      ids.push(ObjectID.generate().toString());
    }

    await expect(askValuesUsage({ ids: ids })).rejects.toBeInstanceOf(
      BadDataException,
    );
    expect(countValuesUsage).not.toHaveBeenCalled();
  });

  test("someone who may only read values is refused, and nothing is read", async () => {
    caller = personWith([Permission.ReadProjectLabel]);

    await expect(askValuesUsage({ ids: [LABEL_ID] })).rejects.toThrow();
    expect(findValues).not.toHaveBeenCalled();
    expect(countValuesUsage).not.toHaveBeenCalled();
  });

  test("someone who may delete the values may ask, and a request with no project is refused", async () => {
    caller = personWith([Permission.DeleteProjectLabel]);

    await askValuesUsage({ ids: [LABEL_ID] });
    expect(countValuesUsage).toHaveBeenCalledTimes(1);

    caller = {
      ...personWith([Permission.EditProjectLabel]),
      tenantId: undefined,
    };

    await expect(askValuesUsage({ ids: [LABEL_ID] })).rejects.toBeInstanceOf(
      BadDataException,
    );
  });
});
