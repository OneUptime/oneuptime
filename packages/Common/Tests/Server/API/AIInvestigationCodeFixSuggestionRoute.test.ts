import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import FixFromIncidentTaskTrigger from "../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  AutomaticCodeFixBlocker,
  InvestigationCodeFixSuggestion,
  investigationCodeFixSuggestionToJSON,
} from "../../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /ai-investigation/code-fix-suggestion (Common/Server/API/
 * AIInvestigationAPI): what the Remediation step of an incident's or
 * alert's AI card says about the fix in the code its investigation
 * recommends (block 43). Pinned here: a signed-in reader, scoped to the
 * project they asked in; the record read as them inside it before anything
 * else; the suggestion decided in that project for that record; and its
 * JSON exactly as the step reads it.
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
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
    },
  };
});

const ROUTE: string = "/ai-investigation/code-fix-suggestion";
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const INCIDENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ALERT_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const SUGGESTION: InvestigationCodeFixSuggestion = {
  offer: SuggestionOffer.Act,
  fixOutcome: null,
  blocker: null,
  aiRunId: null,
  isAutomatic: false,
  automaticBlocker: AutomaticCodeFixBlocker.FixOff,
};

const sendJsonMock: jest.Mock =
  Response.sendJsonObjectResponse as unknown as jest.Mock;

function viewerProps(): DatabaseCommonInteractionProps {
  return { userId: USER_ID, tenantId: PROJECT_ID, isMultiTenantRequest: true };
}

function recordIn<T extends Incident | Alert>(
  model: { new (): T },
  id: ObjectID,
  projectId: ObjectID,
): T {
  const record: T = new model();
  record.id = id;
  record.projectId = projectId;
  return record;
}

interface Spies {
  readIncident: jest.SpyInstance;
  readAlert: jest.SpyInstance;
  suggestion: jest.SpyInstance;
}

function install(data?: {
  props?: DatabaseCommonInteractionProps;
  incident?: Incident | null;
  alert?: Alert | null;
}): Spies {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(data?.props || viewerProps());

  return {
    readIncident: jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(
        (data && Object.prototype.hasOwnProperty.call(data, "incident")
          ? data.incident
          : recordIn(Incident, INCIDENT_ID, PROJECT_ID)) as never,
      ),
    readAlert: jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(
        (data && Object.prototype.hasOwnProperty.call(data, "alert")
          ? data.alert
          : recordIn(Alert, ALERT_ID, PROJECT_ID)) as never,
      ),
    suggestion: jest
      .spyOn(FixFromIncidentTaskTrigger, "getSuggestionForSubject")
      .mockResolvedValue(SUGGESTION as never),
  };
}

async function call(body: JSONObject): Promise<{
  error: unknown;
  json: JSONObject | undefined;
}> {
  const next: jest.Mock = jest.fn();

  await mockRouter.match("POST", ROUTE).handlerFunction(
    {
      body,
      headers: {},
      params: {},
      query: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as NextFunction,
  );

  return {
    error: next.mock.calls[0]?.[0],
    json: sendJsonMock.mock.calls[0]?.[2] as JSONObject | undefined,
  };
}

beforeAll(async () => {
  mockRouter.routes.length = 0;
  await import("../../../Server/API/AIInvestigationAPI");
});

beforeEach(() => {
  sendJsonMock.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /ai-investigation/code-fix-suggestion", () => {
  test("is a signed-in route", () => {
    expect(mockRouter.match("POST", ROUTE).middleware).toBe(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("answers an incident's suggestion, decided in the project the reader asked in", async () => {
    const spies: Spies = install();

    const { error, json } = await call({
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(error).toBeUndefined();
    expect(json).toEqual(investigationCodeFixSuggestionToJSON(SUGGESTION));
    expect(spies.suggestion).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });
  });

  test("an alert's, as an alert", async () => {
    const spies: Spies = install();

    await call({ subjectType: "alert", subjectId: ALERT_ID.toString() });

    expect(spies.suggestion).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
    });
    expect(spies.readIncident).not.toHaveBeenCalled();
  });

  test("the record is read as the reader, pinned to the project they asked in", async () => {
    const spies: Spies = install();

    await call({ subjectType: "incident", subjectId: INCIDENT_ID.toString() });

    const props: DatabaseCommonInteractionProps = (
      spies.readIncident.mock.calls[0]![0] as {
        props: DatabaseCommonInteractionProps;
      }
    ).props;
    expect(props.userId).toBe(USER_ID);
    expect(props.isRoot).toBeUndefined();
    expect(props.isMultiTenantRequest).toBe(false);
  });

  test.each([
    ["no subject type", { subjectId: INCIDENT_ID.toString() }],
    [
      "a kind of record it does not know",
      { subjectType: "episode", subjectId: INCIDENT_ID.toString() },
    ],
    ["no id", { subjectType: "incident" }],
    ["an id that is not one", { subjectType: "incident", subjectId: "inc-1" }],
  ] as Array<[string, JSONObject]>)(
    "refuses %s before reading anything",
    async (_case: string, body: JSONObject) => {
      const spies: Spies = install();

      const { error } = await call(body);

      expect(error).toBeInstanceOf(BadDataException);
      expect(spies.readIncident).not.toHaveBeenCalled();
      expect(spies.suggestion).not.toHaveBeenCalled();
    },
  );

  test("a request scoped to no project is refused", async () => {
    const spies: Spies = install({ props: { userId: USER_ID } });

    const { error } = await call({
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(spies.suggestion).not.toHaveBeenCalled();
  });

  test.each([
    ["the reader may not read", null],
    ["of another project", recordIn(Incident, INCIDENT_ID, OTHER_PROJECT_ID)],
  ])(
    "an incident %s is never asked about",
    async (_case: string, incident: Incident | null) => {
      const spies: Spies = install({ incident });

      const { error } = await call({
        subjectType: "incident",
        subjectId: INCIDENT_ID.toString(),
      });

      expect(error).toBeDefined();
      expect(spies.suggestion).not.toHaveBeenCalled();
      expect(sendJsonMock).not.toHaveBeenCalled();
    },
  );
});
