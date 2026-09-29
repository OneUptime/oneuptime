import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import SSOAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import ObjectID from "../../../Types/ObjectID";

/*
 * The server answers a project-scoped request with 406 "SSO Authorization
 * Required" when the project requires SSO and this session has not signed in
 * through it. Every ModelAPI request sends the user to the project's SSO page
 * on that answer, before rethrowing, whatever BILLING_ENABLED is set to. With
 * billing disabled, this is what moves a user in an SSO-only project off
 * pages whose data comes through ModelAPI (the dashboard header's alert and
 * incident state lookups, the home page's lists and counts).
 */

const PROJECT_ID: string = "019acd20-1111-4111-8111-111111111111";
const SSO_PATH: string = `/dashboard/${PROJECT_ID}/sso`;

// Spies are held through the one property these tests read off them.
interface CallRecorder {
  mock: { calls: Array<Array<unknown>> };
}

let navigate: CallRecorder;

function navigatedTo(): Array<string> {
  return navigate.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
}

function respondWith(statusCode: number, message: string): void {
  jest
    .spyOn(API, "fetch")
    .mockResolvedValue(
      new HTTPErrorResponse(statusCode, { message: message }, {}) as never,
    );
}

async function thrownBy(request: Promise<unknown>): Promise<unknown> {
  try {
    await request;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the request to throw");
}

beforeEach(() => {
  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
  navigate = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation(() => {}) as unknown as CallRecorder;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ModelAPI on an SSO authorization answer", () => {
  test("getList sends the user to the project's SSO page, then rethrows", async () => {
    respondWith(406, new SSOAuthorizationException().message);

    const error: unknown = await thrownBy(
      ModelAPI.getList<IncidentState>({
        modelType: IncidentState,
        query: {},
        limit: 1,
        skip: 0,
        select: { _id: true },
        sort: {},
      }),
    );

    expect(navigatedTo()).toEqual([SSO_PATH]);
    expect(error).toBeInstanceOf(HTTPErrorResponse);
    expect(
      SSOAuthorizationException.isException(API.getFriendlyMessage(error)),
    ).toBe(true);
  });

  test("count does the same", async () => {
    respondWith(406, new SSOAuthorizationException().message);

    await thrownBy(
      ModelAPI.count<IncidentState>({
        modelType: IncidentState,
        query: {},
      }),
    );

    expect(navigatedTo()).toEqual([SSO_PATH]);
  });

  test("other failures do not redirect", async () => {
    respondWith(500, "Server error");

    await thrownBy(
      ModelAPI.count<IncidentState>({
        modelType: IncidentState,
        query: {},
      }),
    );

    expect(navigatedTo()).toEqual([]);
  });
});
