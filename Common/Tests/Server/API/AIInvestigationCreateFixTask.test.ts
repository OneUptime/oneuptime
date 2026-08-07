import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentService from "../../../Server/Services/IncidentService";
import FixFromIncidentTaskTrigger from "../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

describe("POST /ai-investigation/create-fix-task", () => {
  beforeAll(async () => {
    mockRouter.routes.length = 0;
    await import("../../../Server/API/AIInvestigationAPI");
  });

  beforeEach(() => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        userId: ObjectID.generate(),
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("requires investigationRunId before subject lookup or task creation", async () => {
    const findIncident: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "findOneById",
    );
    const createFixTask: jest.SpyInstance = jest.spyOn(
      FixFromIncidentTaskTrigger,
      "createFixTaskFromInvestigation",
    );
    const req: ExpressRequest = {
      body: {
        subjectType: "incident",
        subjectId: ObjectID.generate().toString(),
      },
      headers: {},
      params: {},
      query: {},
    } as unknown as ExpressRequest;
    const res: ExpressResponse = {} as ExpressResponse;
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await mockRouter
      .match("POST", "/ai-investigation/create-fix-task")
      .handlerFunction(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect((next as unknown as jest.Mock).mock.calls[0]![0].message).toMatch(
      /investigationRunId.*required/i,
    );
    expect(findIncident).not.toHaveBeenCalled();
    expect(createFixTask).not.toHaveBeenCalled();
  });
});
