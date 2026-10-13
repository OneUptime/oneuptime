import ProjectService from "../../../../Server/Services/ProjectService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../../Server/Utils/Express";
import BlockedProjectStatusPages, {
  STATUS_PAGE_ROUTE_PARAMS,
} from "../../../../Server/Utils/StatusPage/BlockedProjectStatusPages";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * The gate every public status page route passes before its own middleware:
 * a page of a project a master admin blocked is answered as a page that does
 * not exist - 404 "Status Page not found", noindex - and every other request
 * goes through to its route untouched. The data layer is stubbed; the gate on
 * a real Express app, in front of every route of the status page API, is
 * BlockedProjectPublicRoutes.test.ts.
 */

const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
  "b10c0000-0000-4000-8000-0000000000b1",
);
const LIVE_PROJECT_ID: ObjectID = new ObjectID(
  "b10c0000-0000-4000-8000-0000000000a1",
);
const BLOCKED_PAGE_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-000000000001",
);
const LIVE_PAGE_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-000000000002",
);
const BLOCKED_DOMAIN: string = "status.pirated-films.example";
const LIVE_DOMAIN: string = "status.acme.example";

type ParamHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
  value: unknown,
  name: string,
) => void;

type FakeResponse = {
  status: jest.Mock;
  send: jest.Mock;
  set: jest.Mock;
  headersSent: boolean;
};

type GateResult = {
  nextCalls: Array<Array<unknown>>;
  res: FakeResponse;
};

let handlers: Map<string, ParamHandler>;
let getProjectIdOfStatusPage: jest.SpyInstance;
let isProjectBlocked: jest.SpyInstance;
let resolveStatusPageIdOrNull: jest.SpyInstance;

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    status: jest.fn(),
    send: jest.fn(),
    set: jest.fn(),
    headersSent: false,
  };

  res.status.mockReturnValue(res);
  res.set.mockReturnValue(res);

  return res;
}

/*
 * Runs the gate for one parameter as Express does: the handler is called,
 * and the request either goes on (next) or is answered. The handler's work
 * is asynchronous, so the result is awaited by polling the two outcomes.
 */
async function runGate(
  paramName: string,
  value: unknown,
): Promise<GateResult> {
  const handler: ParamHandler | undefined = handlers.get(paramName);

  if (!handler) {
    throw new Error(`No gate registered for :${paramName}`);
  }

  const res: FakeResponse = fakeResponse();
  const next: jest.Mock = jest.fn();

  let settle!: () => void;
  const settled: Promise<void> = new Promise<void>((resolve: () => void) => {
    settle = resolve;
  });

  next.mockImplementation(() => {
    settle();
  });
  res.send.mockImplementation(() => {
    settle();
    return res;
  });

  handler(
    { params: { [paramName]: value } } as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
    next as unknown as NextFunction,
    value,
    paramName,
  );

  await settled;

  return {
    nextCalls: next.mock.calls as Array<Array<unknown>>,
    res,
  };
}

function expectTakenDown(result: GateResult): void {
  expect(result.nextCalls).toHaveLength(0);
  expect(result.res.status).toHaveBeenCalledWith(404);
  expect(result.res.set).toHaveBeenCalledWith(
    "X-Robots-Tag",
    "noindex, nofollow",
  );
  expect(result.res.send).toHaveBeenCalledTimes(1);
  expect(result.res.send).toHaveBeenCalledWith({
    message: "Status Page not found",
  });
}

function expectLetThrough(result: GateResult): void {
  expect(result.nextCalls).toEqual([[]]);
  expect(result.res.status).not.toHaveBeenCalled();
  expect(result.res.set).not.toHaveBeenCalled();
  expect(result.res.send).not.toHaveBeenCalled();
}

beforeEach(() => {
  handlers = new Map<string, ParamHandler>();

  const router: ExpressRouter = {
    param: (name: string, handler: ParamHandler): void => {
      handlers.set(name, handler);
    },
  } as unknown as ExpressRouter;

  BlockedProjectStatusPages.guard(router);

  // Read as the database reads a uuid column: however the id is written.
  getProjectIdOfStatusPage = jest
    .spyOn(StatusPageService, "getProjectIdOfStatusPage")
    .mockImplementation(async (statusPageId: ObjectID) => {
      const id: string = statusPageId.toString().toLowerCase();

      if (id === BLOCKED_PAGE_ID.toString()) {
        return BLOCKED_PROJECT_ID;
      }

      if (id === LIVE_PAGE_ID.toString()) {
        return LIVE_PROJECT_ID;
      }

      return null;
    });

  isProjectBlocked = jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockImplementation(async (projectId: ObjectID) => {
      return projectId.toString() === BLOCKED_PROJECT_ID.toString();
    });

  resolveStatusPageIdOrNull = jest
    .spyOn(StatusPageService, "resolveStatusPageIdOrNull")
    .mockImplementation(async (statusPageIdOrDomain: string) => {
      if (statusPageIdOrDomain === BLOCKED_DOMAIN) {
        return BLOCKED_PAGE_ID;
      }

      if (statusPageIdOrDomain === LIVE_DOMAIN) {
        return LIVE_PAGE_ID;
      }

      return null;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("BlockedProjectStatusPages.guard", () => {
  test("stands in front of every route that names a page, by id or by domain", () => {
    expect(STATUS_PAGE_ROUTE_PARAMS).toEqual([
      "statusPageId",
      "statusPageIdOrDomain",
    ]);
    expect(Array.from(handlers.keys()).sort()).toEqual(
      ["statusPageId", "statusPageIdOrDomain"].sort(),
    );
  });

  describe.each(STATUS_PAGE_ROUTE_PARAMS.map((name: string) => [name]))(
    ":%s",
    (paramName: string) => {
      test("answers a page of a blocked project as a page that does not exist", async () => {
        expectTakenDown(await runGate(paramName, BLOCKED_PAGE_ID.toString()));
      });

      test("lets a page of a project that is not blocked through to its route", async () => {
        expectLetThrough(await runGate(paramName, LIVE_PAGE_ID.toString()));
      });

      test("reads the id however it is written", async () => {
        expectTakenDown(
          await runGate(paramName, BLOCKED_PAGE_ID.toString().toUpperCase()),
        );
      });

      test("answers a blocked project's custom domain as not found too", async () => {
        expectTakenDown(await runGate(paramName, BLOCKED_DOMAIN));
        expect(resolveStatusPageIdOrNull).toHaveBeenCalledWith(BLOCKED_DOMAIN);
      });

      test("lets a live custom domain through", async () => {
        expectLetThrough(await runGate(paramName, LIVE_DOMAIN));
      });

      test("lets a domain no page has through: its route answers it as it always has", async () => {
        expectLetThrough(await runGate(paramName, "unknown.example.com"));
        expect(getProjectIdOfStatusPage).not.toHaveBeenCalled();
        expect(isProjectBlocked).not.toHaveBeenCalled();
      });

      test("lets an id no page has through, without asking about any project", async () => {
        expectLetThrough(
          await runGate(paramName, ObjectID.generate().toString()),
        );
        expect(isProjectBlocked).not.toHaveBeenCalled();
      });

      test.each([
        ["a word that is neither an id nor a domain", "not-a-page"],
        ["an empty value", ""],
        ["a value that is not text", 42],
      ])(
        "lets %s through without a lookup",
        async (_label: string, value: unknown) => {
          expectLetThrough(await runGate(paramName, value));
          expect(resolveStatusPageIdOrNull).not.toHaveBeenCalled();
          expect(getProjectIdOfStatusPage).not.toHaveBeenCalled();
          expect(isProjectBlocked).not.toHaveBeenCalled();
        },
      );
    },
  );

  describe("fails open: a lookup that fails lets the request through to its route", () => {
    test("the page's project cannot be read", async () => {
      getProjectIdOfStatusPage.mockRejectedValue(
        new Error("database unavailable"),
      );

      expectLetThrough(
        await runGate("statusPageId", BLOCKED_PAGE_ID.toString()),
      );
    });

    test("whether the project is blocked cannot be read", async () => {
      isProjectBlocked.mockRejectedValue(new Error("database unavailable"));

      expectLetThrough(
        await runGate("statusPageIdOrDomain", BLOCKED_PAGE_ID.toString()),
      );
    });

    test("the custom domain cannot be resolved", async () => {
      resolveStatusPageIdOrNull.mockRejectedValue(
        new Error("database unavailable"),
      );

      expectLetThrough(await runGate("statusPageIdOrDomain", BLOCKED_DOMAIN));
    });
  });
});

describe("BlockedProjectStatusPages.isStatusPageOfBlockedProject", () => {
  test("is true for a page of a blocked project", async () => {
    await expect(
      BlockedProjectStatusPages.isStatusPageOfBlockedProject(BLOCKED_PAGE_ID),
    ).resolves.toBe(true);

    expect(getProjectIdOfStatusPage).toHaveBeenCalledWith(BLOCKED_PAGE_ID);
    expect(isProjectBlocked).toHaveBeenCalledWith(BLOCKED_PROJECT_ID);
  });

  test("is false for a page of a project that is not blocked", async () => {
    await expect(
      BlockedProjectStatusPages.isStatusPageOfBlockedProject(LIVE_PAGE_ID),
    ).resolves.toBe(false);
  });

  test("is false for a page that does not exist", async () => {
    await expect(
      BlockedProjectStatusPages.isStatusPageOfBlockedProject(
        ObjectID.generate(),
      ),
    ).resolves.toBe(false);

    expect(isProjectBlocked).not.toHaveBeenCalled();
  });

  test("is false - failing open - when it cannot be told", async () => {
    isProjectBlocked.mockRejectedValue(new Error("database unavailable"));

    await expect(
      BlockedProjectStatusPages.isStatusPageOfBlockedProject(BLOCKED_PAGE_ID),
    ).resolves.toBe(false);
  });
});
