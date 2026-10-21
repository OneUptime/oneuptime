import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import SlackActionType from "../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackAuthAction from "../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackIncidentActions from "../../../Server/Utils/Workspace/Slack/Actions/Incident";
import {
  httpRequest,
  ProbeResponse,
  RunningApp,
  startApp,
} from "./WorkspaceOAuthTestHelpers";

/*
 * The Join call button an incident's or alert's video call is posted with
 * is a link button: Slack opens the meeting in the person's browser on its
 * own. Slack still reports the click to the interactivity endpoint and
 * shows a warning on the button unless it is acknowledged, so the route
 * answers it with an empty 200 - and hands it to no incident, alert or
 * maintenance handler, which would answer "Invalid request".
 */

jest.mock("../../../Server/Middleware/SlackAuthorization", () => {
  return {
    __esModule: true,
    default: {
      // The signature check has its own tests; these drive what follows it.
      isAuthorizedSlackRequest: (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ): void => {
        next();
      },
    },
  };
});

jest.mock("../../../Server/Utils/Workspace/Slack/Actions/Auth", () => {
  return {
    __esModule: true,
    default: { isAuthorized: jest.fn() },
  };
});

jest.mock("../../../Server/Utils/Workspace/Slack/Actions/Incident", () => {
  return {
    __esModule: true,
    default: {
      isIncidentAction: jest.fn(() => {
        return false;
      }),
      handleIncidentAction: jest.fn(),
    },
  };
});

const ROUTE: string = "/api/slack/interactive";

describe("POST /slack/interactive with a Join call click", () => {
  let app: RunningApp;

  const isAuthorized: jest.Mock =
    SlackAuthAction.isAuthorized as unknown as jest.Mock;

  // Loading the API pulls in a large module graph; give it its own budget.
  beforeAll(async () => {
    const SlackAPI: any = (await import("../../../Server/API/SlackAPI"))
      .default;

    app = await startApp([new SlackAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("is acknowledged with an empty 200", async () => {
    isAuthorized.mockResolvedValue({
      isAuthorized: true,
      projectId: ObjectID.generate(),
      actions: [{ actionType: SlackActionType.JoinVideoCall, actionValue: "" }],
    });

    const response: ProbeResponse = await httpRequest({
      port: app.port,
      method: "POST",
      path: ROUTE,
      body: { payload: "{}" },
    });

    expect(response.status).toBe(200);
    // The harness reads an empty body as null.
    expect(response.body).toBe(null);
    expect(SlackIncidentActions.isIncidentAction).not.toHaveBeenCalled();
    expect(SlackIncidentActions.handleIncidentAction).not.toHaveBeenCalled();
  });

  test("an action nobody handles is still refused", async () => {
    isAuthorized.mockResolvedValue({
      isAuthorized: true,
      projectId: ObjectID.generate(),
      actions: [{ actionType: "SomethingElse", actionValue: "" }],
    });

    const response: ProbeResponse = await httpRequest({
      port: app.port,
      method: "POST",
      path: ROUTE,
      body: { payload: "{}" },
    });

    expect(response.status).toBe(400);
  });
});
