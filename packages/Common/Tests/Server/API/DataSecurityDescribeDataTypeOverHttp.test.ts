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

import CommonAPI from "../../../Server/API/CommonAPI";
import DataSecurityCustomDataTypeAPI from "../../../Server/API/DataSecurityCustomDataTypeAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AIService, {
  AILogRequest,
} from "../../../Server/Services/AIService";
import DataSecurityCustomDataTypeService from "../../../Server/Services/DataSecurityCustomDataTypeService";
import { DESCRIBE_EXAMPLES_NOT_SHAPES_MESSAGE } from "../../../Server/Utils/AI/DataSecurity/DataTypeFromSentence";
import DataSecurityRunner from "../../../Server/Utils/DataSecurity/DataSecurityRunner";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import { DESCRIBE_DATA_TYPE_ROUTE } from "../../../Types/DataSecurity/DataTypeDescribe";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { valueShape } from "../../../Utils/DataSecurity/UnplacedFields";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
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
import type { SpyInstance } from "jest-mock";

/*
 * DESCRIBE IT, THROUGH THE SERVER'S OWN ROUTE (#10371).
 *
 * On Settings > Data Types, a Security Member writes "our employee IDs
 * look like EMP-123456, sometimes without the dash" and three examples,
 * and presses Fill In With AI. The browser sends the sentence and the
 * examples' shapes; the route answers the form's values, and saves
 * nothing. Express, the route's checks and the drafting run as the App
 * runs them; only the model, the AI switch and the project's own types
 * are stood in for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10371000-0000-4000-8000-0000000000d1",
);
const SENTENCE: string =
  "Our employee IDs look like EMP-123456, sometimes without the dash.";
const EXAMPLES: Array<string> = ["EMP-204518", "EMP-990011", "EMP331120"];

const DRAFT: JSONObject = {
  name: "Employee ID",
  description: "A company employee ID, such as EMP-999999.",
  category: DataCategory.ContactAndIdentity,
  sensitivity: DataSensitivity.Confidential,
  pattern: "\\bEMP-?\\d{6}\\b",
  ignoreCase: false,
  keywords: ["employee"],
  nameHints: ["employee id"],
  validator: "None",
};

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let execute: SpyInstance<typeof AIService.executeWithLogging>;
let create: SpyInstance<typeof DataSecurityCustomDataTypeService.create>;

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function describeIt(body: unknown): Promise<SentRequest> {
  return server.request("POST", `/api${DESCRIBE_DATA_TYPE_ROUTE}`, body);
}

function messageOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer as JSONObject | null) || {};

  return String(answer["error"] || answer["message"] || "");
}

beforeAll(async () => {
  // The session guards, as a signed-in member passes them.
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);

  server = new DashboardRequestsOverHttp();
  await server.start([new DataSecurityCustomDataTypeAPI().getRouter()]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  caller = callerWith([Permission.SecurityMember]);

  everyServerProductIsOn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  jest
    .spyOn(AIService, "assertProjectAIEnabled")
    .mockResolvedValue(undefined as never);
  execute = jest
    .spyOn(AIService, "executeWithLogging")
    .mockImplementation((async () => {
      return {
        content: JSON.stringify({ dataType: DRAFT, reason: "As described." }),
      };
    }) as never);
  jest
    .spyOn(DataSecurityRunner, "getScanSetup")
    .mockImplementation((async () => {
      return { setting: {}, options: {}, customTypes: new Map() };
    }) as never);
  create = jest
    .spyOn(DataSecurityCustomDataTypeService, "create")
    .mockImplementation((async () => {
      throw new Error("Describe It saves nothing.");
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  // The session guards stay for every test.
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
});

describe("Fill In With AI on the data type form", () => {
  test("answers the form's values from the sentence and the examples' shapes, and saves nothing", async () => {
    const sent: SentRequest = await describeIt({
      sentence: SENTENCE,
      exampleShapes: EXAMPLES.map(valueShape),
    });

    expect(sent.status).toBe(200);
    expect(sent.answer).toEqual({
      dataType: expect.objectContaining({
        name: "Employee ID",
        pattern: "\\bEMP-?\\d{6}\\b",
        category: DataCategory.ContactAndIdentity,
        sensitivity: DataSensitivity.Confidential,
        isEnabled: true,
      }),
      reason: "As described.",
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();

    // The model was told the shapes; no example went to it.
    const request: AILogRequest = execute.mock.calls[0]![0] as AILogRequest;
    const everything: string = JSON.stringify(request.messages);

    expect(everything).toContain("AAA-999999");

    for (const example of EXAMPLES) {
      expect(everything).not.toContain(example);
    }

    expect(request.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(request.userId?.toString()).toBe(caller.userId!.toString());
  });

  test("an example sent as itself is refused, and the model is never asked", async () => {
    const sent: SentRequest = await describeIt({
      sentence: SENTENCE,
      exampleShapes: EXAMPLES,
    });

    expect(sent.status).toBe(400);
    expect(messageOf(sent)).toBe(DESCRIBE_EXAMPLES_NOT_SHAPES_MESSAGE);
    expect(execute).not.toHaveBeenCalled();
  });

  test("takes a role that can create data types", async () => {
    caller = callerWith([Permission.SecurityViewer]);

    const sent: SentRequest = await describeIt({
      sentence: SENTENCE,
      exampleShapes: [],
    });

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expect(sent.status).toBeLessThan(500);
    expect(messageOf(sent)).toBe(
      "Describing a data type takes a role that can create data types.",
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
