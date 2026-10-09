import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

configure({ asyncUtilTimeout: 15000 });

/*
 * The one-click Connect on Project Settings > Video Calls, for a server that
 * has its own Zoom and Google apps but no Microsoft one (MICROSOFT_TEAMS_
 * MEETINGS_APP_CLIENT_ID unset).
 *
 * Connect on Zoom or Google Meet goes to the provider's sign-in, with a way
 * to use the project's own app instead; Microsoft Teams still opens its
 * connection form. A connection made by signing in shows who it signed in
 * as, reconnects with one click and edits without credentials. And the page
 * a sign-in comes back to says what happened, with a test meeting one click
 * away.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    ZoomAppClientId: "zoom-client-id",
    GoogleMeetAppClientId: "google-client-id.apps.googleusercontent.com",
    MicrosoftTeamsMeetingsAppClientId: null,
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          permissions: permissionsForTest.map((permission: unknown) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        };
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

import VideoCallsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/VideoCalls";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import VideoCallAuthMethod from "../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/settings/video-calls`;
const MEET_ID: string = "00000000-0000-4000-8000-00000000b001";
const ZOOM_SIGN_IN_URL: string =
  "https://zoom.us/oauth/authorize?response_type=code&client_id=zoom-client-id&state=s";

let connections: Array<VideoCallConnection> = [];
let updated: Array<{ id: string; data: JSONObject }> = [];
let started: Array<string> = [];
let navigatedTo: Array<string> = [];
let testRequests: Array<JSONObject> = [];

function signedInMeet(): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection();
  connection._id = MEET_ID;
  connection.name = "Incident Meet";
  connection.provider = VideoCallProvider.GoogleMeet;
  connection.authMethod = VideoCallAuthMethod.OAuth;
  connection.connectedAccount = "incidents@acme.com";
  connection.config = { accessType: "TRUSTED" };
  return connection;
}

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[PAGE_PATH]}>
      <VideoCallsPage
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await screen.findByText("Providers");
}

function tile(provider: string): HTMLElement {
  return screen.getByTestId(`video-call-provider-${provider}`);
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function rowOf(name: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .getAllByRole("row")
    .find((candidate: HTMLElement) => {
      return within(candidate).queryByText(name, { exact: true }) !== null;
    });

  expect(row).toBeDefined();

  return row!;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });
  });
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  connections = [];
  updated = [];
  started = [];
  navigatedTo = [];
  testRequests = [];
  PermissionGate.clearPermissionPropsCache();
  goTo(PAGE_PATH);
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  ConnectedWorkspaces.reset();
  ConnectedWorkspaces.setConnected(PROJECT_ID, [WorkspaceType.Slack]);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: { new (): BaseModel };
  }) => {
    if (args.modelType !== VideoCallConnection) {
      return { data: [], count: 0, skip: 0, limit: 10 };
    }

    return {
      data: connections,
      count: connections.length,
      skip: 0,
      limit: 10,
    } as ListResult<VideoCallConnection>;
  }) as never);

  jest.spyOn(ModelAPI, "count").mockImplementation((async () => {
    return connections.length;
  }) as never);

  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (args: {
    id: { toString: () => string };
    data: JSONObject;
  }) => {
    updated.push({ id: args.id.toString(), data: args.data });
    return undefined as never;
  }) as never);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return signedInMeet();
  }) as never);

  jest.spyOn(API, "get").mockImplementation((async (args: { url: URL }) => {
    started.push(args.url.toString());
    return new HTTPResponse<JSONObject>(
      200,
      { authorizationUrl: ZOOM_SIGN_IN_URL },
      {},
    );
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (args: {
    data: JSONObject;
  }) => {
    testRequests.push(args.data);
    return new HTTPResponse<JSONObject>(
      200,
      {
        provider: VideoCallProvider.GoogleMeet,
        joinUrl: "https://meet.google.com/abc-defg-hij",
      },
      {},
    );
  }) as never);

  jest.spyOn(Navigation, "navigate").mockImplementation(((to: URL) => {
    navigatedTo.push(to.toString());
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ConnectedWorkspaces.reset();
});

describe("connecting by signing in", () => {
  test("Connect on Zoom offers the sign-in, says which account to use, and goes to Zoom", async () => {
    await renderPage();

    fireEvent.click(
      within(tile(VideoCallProvider.Zoom)).getByRole("button", {
        name: /Connect/,
      }),
    );

    const modal: HTMLElement = dialog();
    expect(within(modal).getByText("Connect Zoom")).toBeVisible();
    expect(
      within(modal).getByText(
        /ideally a shared account such as incidents@example.com/,
      ),
    ).toBeVisible();
    // No credential to type in.
    expect(within(modal).queryByLabelText(/Client secret/)).toBeNull();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Continue to Zoom" }),
    );

    await waitFor(() => {
      expect(navigatedTo).toEqual([ZOOM_SIGN_IN_URL]);
    });
    expect(started).toHaveLength(1);
    expect(started[0]).toContain("/video-call-oauth/zoom/authorize-url");
    expect(started[0]).not.toContain("connectionId");
  });

  test("a tile with one-click Connect links to how it works, not to an app's setup", async () => {
    await renderPage();

    expect(
      within(tile(VideoCallProvider.Zoom))
        .getByRole("link", { name: /How it works/ })
        .getAttribute("href"),
    ).toContain("/workspace-connections/video-calls#connect-in-one-click");
    expect(
      within(tile(VideoCallProvider.MicrosoftTeams)).getByRole("link", {
        name: /Setup guide/,
      }),
    ).toBeVisible();
  });

  test("the project's own app is one click away", async () => {
    await renderPage();

    fireEvent.click(
      within(tile(VideoCallProvider.Zoom)).getByRole("button", {
        name: /Connect/,
      }),
    );
    fireEvent.click(screen.getByTestId("video-call-use-own-app-Zoom"));

    expect(await screen.findByTestId("video-call-setup-guide")).toBeVisible();
    expect(within(dialog()).getByText("Set up Zoom")).toBeVisible();
  });

  test("a provider whose app this server does not have opens its connection form", async () => {
    await renderPage();

    fireEvent.click(
      within(tile(VideoCallProvider.MicrosoftTeams)).getByRole("button", {
        name: /Connect/,
      }),
    );

    expect(await screen.findByTestId("video-call-setup-guide")).toBeVisible();
    expect(screen.queryByTestId("video-call-oauth-connect")).toBeNull();
  });

  test("a sign-in that cannot start says why, in the dialog", async () => {
    (API.get as jest.Mock).mockImplementation((async () => {
      throw new Error(
        "Connecting Zoom by signing in is not set up on this OneUptime server.",
      );
    }) as never);

    await renderPage();

    fireEvent.click(
      within(tile(VideoCallProvider.Zoom)).getByRole("button", {
        name: /Connect/,
      }),
    );
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Continue to Zoom" }),
    );

    expect(
      await within(dialog()).findByText(
        /is not set up on this OneUptime server/,
      ),
    ).toBeVisible();
    expect(navigatedTo).toEqual([]);
  });
});

describe("a connection made by signing in", () => {
  test("says who it is signed in as, and reconnects that connection", async () => {
    connections = [signedInMeet()];
    await renderPage();
    await screen.findByText("Signed in as incidents@acme.com");

    const row: HTMLElement = rowOf("Incident Meet");
    expect(
      within(row).getByText("Signed in as incidents@acme.com"),
    ).toBeVisible();

    fireEvent.click(within(row).getByTestId("row-actions-more-button"));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Reconnect",
      }),
    );

    const modal: HTMLElement = dialog();
    expect(within(modal).getByText("Reconnect Incident Meet")).toBeVisible();
    expect(
      within(modal).getByText(/Signed in as incidents@acme.com/),
    ).toBeVisible();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Continue to Google" }),
    );

    await waitFor(() => {
      expect(started).toHaveLength(1);
    });
    expect(started[0]).toContain("/video-call-oauth/google-meet/authorize-url");
    expect(started[0]).toContain(`connectionId=${MEET_ID}`);
  });

  test("edits without credentials: only its name and who can join", async () => {
    connections = [signedInMeet()];
    await renderPage();
    await screen.findByText("Signed in as incidents@acme.com");

    const row: HTMLElement = rowOf("Incident Meet");
    fireEvent.click(within(row).getByTestId("row-actions-more-button"));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Edit" }),
    );

    const modal: HTMLElement = await screen.findByRole("dialog");
    expect(
      within(modal).getByTestId("video-call-signed-in-as"),
    ).toHaveTextContent("Signed in as incidents@acme.com");
    expect(
      within(modal).queryByLabelText(/Service account JSON key/),
    ).toBeNull();
    expect(within(modal).queryByLabelText(/Create meetings as/)).toBeNull();
    expect(within(modal).getByText("Who can join")).toBeVisible();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => {
      expect(updated).toHaveLength(1);
    });
    expect(updated[0]!.data["config"]).toEqual({ accessType: "TRUSTED" });
    expect(updated[0]!.data["secrets"]).toBeUndefined();
  });
});

describe("coming back from the sign-in", () => {
  test("names the connection made and starts a test meeting with it", async () => {
    goTo(`${PAGE_PATH}?provider=google-meet&connected=${MEET_ID}`);
    connections = [signedInMeet()];

    await renderPage();

    const notice: HTMLElement = await screen.findByTestId(
      "video-call-connected",
    );
    expect(within(notice).getByText("Google Meet is connected")).toBeVisible();
    expect(notice).toHaveTextContent(
      "Every meeting is created as incidents@acme.com",
    );
    // Taken off the address, so a reload does not say it again.
    expect(window.location.search).toBe("");

    fireEvent.click(within(notice).getByTestId("video-call-connected-test"));

    await waitFor(() => {
      expect(testRequests).toEqual([{ connectionId: MEET_ID }]);
    });
    await settle();
  });

  test("says why a sign-in was not saved, in the provider's words of OneUptime's", async () => {
    goTo(
      `${PAGE_PATH}?provider=google-meet&error=video-call-permission-not-granted`,
    );

    await renderPage();

    const notice: HTMLElement = await screen.findByTestId(
      "video-call-connect-error",
    );
    expect(notice).toHaveTextContent("Google Meet was not connected");
    expect(notice).toHaveTextContent(
      "OneUptime was not allowed to create meetings",
    );
    expect(window.location.search).toBe("");
  });

  test("never shows text the address chose", async () => {
    goTo(`${PAGE_PATH}?provider=zoom&error=${encodeURIComponent("<b>hi</b>")}`);

    await renderPage();

    const notice: HTMLElement = await screen.findByTestId(
      "video-call-connect-error",
    );
    expect(notice).toHaveTextContent("Zoom was not connected");
    expect(notice).toHaveTextContent(
      "OneUptime could not finish connecting. Please try again.",
    );
    expect(notice).not.toHaveTextContent("hi");
  });
});
