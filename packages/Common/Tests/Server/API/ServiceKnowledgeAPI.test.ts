import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import {
  SERVICE_KNOWLEDGE_API_PATH,
  readServiceIdParam,
} from "../../../Server/API/ServiceKnowledgeAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ServiceKnowledge from "../../../Server/Utils/AI/SRE/ServiceKnowledge";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { ServiceKnowledgeSummary } from "../../../Types/AI/ServiceKnowledgeSummary";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { isErrorSentence } from "../../../Types/Exception/ErrorMessageRule";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GET /service-knowledge/:serviceId (#7672): what OneUptime AI learned about
 * a service, for the card on its page. A signed-in member of the project
 * asks; it is read with their own permissions (ServiceKnowledge
 * .readSummaryForPerson, whose suite holds every read to them); the
 * service's id is checked before anything is read. It only reads, so it
 * registers no route the product switches decide (ProductCustomRoutesGuard).
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
    sendErrorResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const PROJECT: ObjectID = new ObjectID("76720000-0000-4000-8000-000000000001");
const SERVICE: ObjectID = new ObjectID("76720000-0000-4000-8000-000000000002");
const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("76720000-0000-4000-8000-0000000000a1"),
};

const SUMMARY: ServiceKnowledgeSummary = {
  serviceId: SERVICE.toString(),
  failures: [
    {
      count: 2,
      lastSeenAt: "2026-11-10T12:00:00.000Z",
      records: [
        {
          kind: "incident",
          id: "76720000-0000-4000-8000-000000000003",
          number: 42,
          title: "Checkout is down",
          happenedAt: "2026-11-10T12:00:00.000Z",
        },
      ],
      cause: "Connection pool exhausted",
      isConfirmedAnalysis: false,
      fix: null,
    },
  ],
};

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

const ROUTE: string = `${SERVICE_KNOWLEDGE_API_PATH}/:serviceId`;

async function call(params: JSONObject): Promise<{
  thrown: unknown;
  sent: unknown;
}> {
  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "GET",
    ROUTE,
  );

  let thrown: unknown = undefined;

  await (route.handlerFunction as RouterFunction)(
    {
      params,
      query: {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    ((err: unknown) => {
      thrown = err;
    }) as NextFunction,
  );

  return {
    thrown,
    sent: (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
      .calls[0]?.[2],
  };
}

let readSummary: jest.SpyInstance;

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
  (Response.setNoCacheHeaders as unknown as jest.Mock).mockClear();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(PROPS as never);
  jest
    .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
    .mockReturnValue(PROJECT as never);
  readSummary = jest
    .spyOn(ServiceKnowledge, "readSummaryForPerson")
    .mockResolvedValue(SUMMARY as never);
});

describe("GET /service-knowledge/:serviceId", () => {
  test("asks the signed-in member's middleware first", () => {
    expect(mockRouter.match("GET", ROUTE).middleware).toBe(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("hands back what was learned, read with the caller's own permissions in the project they were let into", async () => {
    const { thrown, sent } = await call({ serviceId: SERVICE.toString() });

    expect(thrown).toBeUndefined();
    expect(sent).toEqual(SUMMARY);
    expect(readSummary).toHaveBeenCalledWith({
      projectId: PROJECT,
      serviceId: SERVICE,
      props: PROPS,
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
  });

  test("a caller who is not a member of the project reads nothing", async () => {
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException(
          "You are not authorized to access this project's data.",
        );
      });

    const { thrown, sent } = await call({ serviceId: SERVICE.toString() });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(sent).toBeUndefined();
    expect(readSummary).not.toHaveBeenCalled();
  });

  test("a service the caller may not read is not found, and says so", async () => {
    readSummary.mockRejectedValue(
      new NotFoundException(
        "This service was not found, or you may not see it. Open it again from Services.",
      ) as never,
    );

    const { thrown, sent } = await call({ serviceId: SERVICE.toString() });

    expect(thrown).toBeInstanceOf(NotFoundException);
    expect(sent).toBeUndefined();
  });

  test.each([[""], ["not-an-id"], ["../../project"]])(
    "a service id that is not an id (%s) is refused before anything is read",
    async (serviceId: string) => {
      const { thrown } = await call({ serviceId });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(readSummary).not.toHaveBeenCalled();
    },
  );

  test("its refusal is a sentence that says what to do", () => {
    try {
      readServiceIdParam({ params: {} } as unknown as ExpressRequest);
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      expect(isErrorSentence((error as Error).message)).toBe(true);
    }
  });

  test("it only reads: no route of it writes", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(() => {
        return mockRouter.match(method, ROUTE);
      }).toThrow();
    }
  });
});
