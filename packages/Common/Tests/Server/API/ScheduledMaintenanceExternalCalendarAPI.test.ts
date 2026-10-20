import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import ScheduledMaintenanceExternalCalendarAPI, {
  EXTERNAL_CALENDAR_NOT_FOUND_MESSAGE,
} from "../../../Server/API/ScheduledMaintenanceExternalCalendarAPI";
import ScheduledMaintenanceExternalCalendarService from "../../../Server/Services/ScheduledMaintenanceExternalCalendarService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ExternalCalendarRefresher, {
  EXTERNAL_CALENDAR_READ_TOO_SOON_MESSAGE,
} from "../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarRefresher";
import ScheduledMaintenanceExternalCalendar from "../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import { customDomainCaller } from "./CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * POST /scheduled-maintenance-external-calendar/:id/read-now - Read now on
 * Calendar Settings: for whoever may update the calendar (asked as an
 * update asks it), answering with what the read found, as the caller reads
 * the calendar. A malformed id is refused before the database sees it, and
 * a calendar the caller may not update is answered as missing.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const ROUTE: string = "/scheduled-maintenance-external-calendar/:id/read-now";

const PROJECT_ID: ObjectID = new ObjectID(
  "61000000-0000-4000-8000-000000000001",
);
const CALENDAR_ID: string = "61000000-0000-4000-8000-000000000002";

let props: DatabaseCommonInteractionProps;

async function call(id: string): Promise<{ thrown: unknown }> {
  const req: ExpressRequest = {
    body: {},
    headers: {},
    params: { id: id },
    query: {},
  } as unknown as ExpressRequest;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", ROUTE)
    .handlerFunction(req, {} as ExpressResponse, next as unknown as NextFunction);

  return { thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined };
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new ScheduledMaintenanceExternalCalendarAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  props = {
    ...customDomainCaller({
      permissions: [Permission.ScheduledMaintenanceMember],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };

  getJestSpyOn(CommonAPI, "getDatabaseCommonInteractionProps").mockImplementation(
    async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the route", () => {
  test("is a POST on the calendar's own path, behind the user middleware", () => {
    const route: { middlewares: Array<unknown> } = mockRouter.match(
      "post",
      ROUTE,
    );

    expect(route.middlewares).toContain(UserMiddleware.getUserMiddleware);
  });
});

describe("reading a calendar now", () => {
  test("reads it for someone who may update it, and answers with what the read found, read as the caller", async () => {
    const updatable: jest.SpyInstance = getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findOneUpdatableById",
    ).mockResolvedValue(new ScheduledMaintenanceExternalCalendar());

    const readNow: jest.SpyInstance = getJestSpyOn(
      ExternalCalendarRefresher,
      "readNow",
    ).mockResolvedValue({ read: true, error: null, eventCount: 24 });

    const status: ScheduledMaintenanceExternalCalendar =
      new ScheduledMaintenanceExternalCalendar();
    status._id = CALENDAR_ID;
    status.eventCount = 24;

    const findOne: jest.SpyInstance = getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findOneById",
    ).mockResolvedValue(status);

    const { thrown } = await call(CALENDAR_ID);

    expect(thrown).toBeUndefined();
    expect(updatable.mock.calls[0]![0]).toMatchObject({
      id: new ObjectID(CALENDAR_ID),
      props: props,
    });
    expect(readNow).toHaveBeenCalledWith(new ObjectID(CALENDAR_ID));

    // The answer is read with the caller's own props: never the link.
    const read: {
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = findOne.mock.calls[0]![0] as never;
    expect(read.props).toBe(props);
    expect(read.select["calendarUrl"]).toBeUndefined();
    expect(read.select).toMatchObject({
      lastReadAt: true,
      lastReadError: true,
      eventCount: true,
      hasMoreEvents: true,
    });

    expect(Response.sendEntityResponse).toHaveBeenCalledTimes(1);
    expect(
      (Response.sendEntityResponse as unknown as jest.Mock).mock.calls[0]![2],
    ).toBe(status);
  });

  test("a calendar the caller may not update, or that does not exist, is answered as missing and not read", async () => {
    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findOneUpdatableById",
    ).mockResolvedValue(null);

    const readNow: jest.SpyInstance = getJestSpyOn(
      ExternalCalendarRefresher,
      "readNow",
    );

    const { thrown } = await call(CALENDAR_ID);

    expect(thrown).toBeInstanceOf(NotFoundException);
    expect((thrown as Error).message).toBe(EXTERNAL_CALENDAR_NOT_FOUND_MESSAGE);
    expect(readNow).not.toHaveBeenCalled();
  });

  test("a caller refused the update is refused here too", async () => {
    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findOneUpdatableById",
    ).mockRejectedValue(new NotAuthorizedException("not yours"));

    const readNow: jest.SpyInstance = getJestSpyOn(
      ExternalCalendarRefresher,
      "readNow",
    );

    const { thrown } = await call(CALENDAR_ID);

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(readNow).not.toHaveBeenCalled();
  });

  test.each(["not-an-id", "1", "' OR 1=1 --"])(
    "a malformed id (%s) is refused before the database sees it",
    async (id: string) => {
      const updatable: jest.SpyInstance = getJestSpyOn(
        ScheduledMaintenanceExternalCalendarService,
        "findOneUpdatableById",
      );

      const { thrown } = await call(id);

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(updatable).not.toHaveBeenCalled();
    },
  );

  test("a read refused for being too soon says so", async () => {
    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findOneUpdatableById",
    ).mockResolvedValue(new ScheduledMaintenanceExternalCalendar());

    getJestSpyOn(ExternalCalendarRefresher, "readNow").mockRejectedValue(
      new BadDataException(EXTERNAL_CALENDAR_READ_TOO_SOON_MESSAGE),
    );

    const { thrown } = await call(CALENDAR_ID);

    expect((thrown as Error).message).toBe(
      EXTERNAL_CALENDAR_READ_TOO_SOON_MESSAGE,
    );
  });

  test("a caller with no project is refused", async () => {
    props = {} as DatabaseCommonInteractionProps;

    const updatable: jest.SpyInstance = getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findOneUpdatableById",
    );

    const { thrown } = await call(CALENDAR_ID);

    expect(thrown).toBeDefined();
    expect(updatable).not.toHaveBeenCalled();
  });
});
