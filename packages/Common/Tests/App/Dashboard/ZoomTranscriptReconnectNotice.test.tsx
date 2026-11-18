import "@testing-library/jest-dom";
import {
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
 * Project Settings > Workspace > Video Calls asks for a Zoom connection to be
 * reconnected when it was signed in before OneUptime's Zoom app could read
 * call transcripts (#9269): it cannot read them, and 90 days after the app's
 * update Zoom stops accepting its sign-in, so it stops starting calls. The
 * server names the connections (ZoomTranscriptReconnect) once its Zoom app
 * grants the transcript scopes; the page draws one notice with a Reconnect
 * button for each, and nothing otherwise.
 */

let permissionsForTest: Array<unknown> = [];
let zoomAppClientId: string | null = "zoom-client-id";

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actual,
    get ZoomAppClientId(): string | null {
      return zoomAppClientId;
    },
    GoogleMeetAppClientId: null,
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
import { ZOOM_TRANSCRIPT_RECONNECT_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallApi";
import { getZoomTranscriptReconnectCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/ZoomTranscriptReconnectNotice";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import VideoCallAuthMethod from "../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { createTranslator } from "../../../Types/Translator";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/settings/video-calls`;
const ZOOM_ID: string = "00000000-0000-4000-8000-00000000c001";
const ZOOM_2_ID: string = "00000000-0000-4000-8000-00000000c002";
const ZOOM_SIGN_IN_URL: string =
  "https://zoom.us/oauth/authorize?response_type=code&client_id=zoom-client-id&state=s";

let rows: Array<VideoCallConnection> = [];
// What the server names, as GET /video-call-connection/zoom-transcript-reconnect answers.
let toReconnect: JSONArray = [];
let isReconnectReadFailing: boolean = false;
let reconnectReads: number = 0;
let started: Array<string> = [];
let navigatedTo: Array<string> = [];

function signedInZoom(id: string, name: string): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection();
  connection._id = id;
  connection.name = name;
  connection.provider = VideoCallProvider.Zoom;
  connection.authMethod = VideoCallAuthMethod.OAuth;
  connection.connectedAccount = "incidents@acme.com";
  connection.config = {};
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

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  zoomAppClientId = "zoom-client-id";
  rows = [signedInZoom(ZOOM_ID, "Zoom")];
  toReconnect = [];
  isReconnectReadFailing = false;
  reconnectReads = 0;
  started = [];
  navigatedTo = [];
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
      data: rows,
      count: rows.length,
      skip: 0,
      limit: 10,
    } as ListResult<VideoCallConnection>;
  }) as never);

  jest.spyOn(ModelAPI, "count").mockImplementation((async () => {
    return rows.length;
  }) as never);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return null;
  }) as never);

  jest.spyOn(API, "get").mockImplementation((async (args: { url: URL }) => {
    const url: string = args.url.toString();

    if (url.includes(ZOOM_TRANSCRIPT_RECONNECT_ROUTE)) {
      reconnectReads++;

      if (isReconnectReadFailing) {
        throw new Error("OneUptime could not be reached.");
      }

      return new HTTPResponse<JSONObject>(
        200,
        { connections: toReconnect },
        {},
      );
    }

    started.push(url);

    return new HTTPResponse<JSONObject>(
      200,
      { authorizationUrl: ZOOM_SIGN_IN_URL },
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

describe("a Zoom connection signed in before transcripts, once the server's Zoom app grants them", () => {
  test("is asked to reconnect, with why: it cannot read transcripts, and in 90 days it stops starting calls", async () => {
    toReconnect = [
      { _id: ZOOM_ID, name: "Zoom", connectedAccount: "incidents@acme.com" },
    ];

    await renderPage();

    const notice: HTMLElement = await screen.findByTestId(
      "zoom-transcript-reconnect",
    );

    expect(
      within(notice).getByText("Reconnect Zoom to keep starting calls"),
    ).toBeVisible();

    const message: HTMLElement = within(notice).getByTestId(
      "zoom-transcript-reconnect-message",
    );

    expect(message).toHaveTextContent(
      "This Zoom connection was signed in before OneUptime could read call transcripts, so it cannot read them.",
    );
    expect(message).toHaveTextContent(
      "90 days after OneUptime's Zoom app was updated, Zoom stops accepting this connection's sign-in, and the connection stops starting calls.",
    );
    expect(message).toHaveTextContent(
      "Click Reconnect, then allow OneUptime to read recordings and transcripts when Zoom asks.",
    );
    // Named in the title and on the button, never "Zoom was signed in to Zoom".
    expect(message).not.toHaveTextContent("Zoom was signed in");
    expect(reconnectReads).toBe(1);
  });

  test("Reconnect signs that connection in again", async () => {
    toReconnect = [
      { _id: ZOOM_ID, name: "Zoom", connectedAccount: "incidents@acme.com" },
    ];

    await renderPage();

    const notice: HTMLElement = await screen.findByTestId(
      "zoom-transcript-reconnect",
    );

    fireEvent.click(
      within(notice).getByRole("button", { name: "Reconnect Zoom" }),
    );

    const modal: HTMLElement = screen.getByRole("dialog");
    expect(within(modal).getByText("Reconnect Zoom")).toBeVisible();
    expect(
      within(modal).getByText(/Signed in as incidents@acme.com/),
    ).toBeVisible();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Continue to Zoom" }),
    );

    await waitFor(() => {
      expect(navigatedTo).toEqual([ZOOM_SIGN_IN_URL]);
    });
    expect(started).toHaveLength(1);
    expect(started[0]).toContain("/video-call-oauth/zoom/authorize-url");
    expect(started[0]).toContain(`connectionId=${ZOOM_ID}`);
  });

  test("several are asked for together, each with its own Reconnect", async () => {
    rows = [signedInZoom(ZOOM_ID, "Zoom"), signedInZoom(ZOOM_2_ID, "Zoom 2")];
    toReconnect = [
      { _id: ZOOM_ID, name: "Zoom", connectedAccount: "incidents@acme.com" },
      { _id: ZOOM_2_ID, name: "Zoom 2", connectedAccount: "oncall@acme.com" },
    ];

    await renderPage();

    const notice: HTMLElement = await screen.findByTestId(
      "zoom-transcript-reconnect",
    );

    expect(
      within(notice).getByText(
        "Reconnect these Zoom connections to keep starting calls",
      ),
    ).toBeVisible();
    expect(
      within(notice).getByTestId("zoom-transcript-reconnect-message"),
    ).toHaveTextContent(
      "These Zoom connections were signed in before OneUptime could read call transcripts, so they cannot read them.",
    );
    expect(
      within(notice).getByRole("button", { name: "Reconnect Zoom" }),
    ).toBeEnabled();
    expect(
      within(notice).getByRole("button", { name: "Reconnect Zoom 2" }),
    ).toBeEnabled();
  });

  test("someone who may only read settings is told, but cannot reconnect", async () => {
    permissionsForTest = [Permission.SettingsViewer];
    toReconnect = [
      { _id: ZOOM_ID, name: "Zoom", connectedAccount: "incidents@acme.com" },
    ];

    await renderPage();

    const notice: HTMLElement = await screen.findByTestId(
      "zoom-transcript-reconnect",
    );

    expect(
      within(notice).getByRole("button", { name: "Reconnect Zoom" }),
    ).toBeDisabled();
  });
});

describe("nothing is asked", () => {
  test("when the server names no connection: before Zoom approves the update, for a Server-to-Server app, or one whose granted scope was never recorded", async () => {
    toReconnect = [];

    await renderPage();

    await waitFor(() => {
      expect(reconnectReads).toBe(1);
    });
    expect(screen.queryByTestId("zoom-transcript-reconnect")).toBeNull();
  });

  test("on a server that does not connect Zoom by signing in, where Reconnect is not offered", async () => {
    zoomAppClientId = null;
    toReconnect = [
      { _id: ZOOM_ID, name: "Zoom", connectedAccount: "incidents@acme.com" },
    ];

    await renderPage();
    await screen.findByText("Signed in as incidents@acme.com");

    expect(reconnectReads).toBe(0);
    expect(screen.queryByTestId("zoom-transcript-reconnect")).toBeNull();
  });

  test("when the server cannot be asked: the page works as before", async () => {
    isReconnectReadFailing = true;

    await renderPage();
    await screen.findByText("Signed in as incidents@acme.com");

    await waitFor(() => {
      expect(reconnectReads).toBe(1);
    });
    expect(screen.queryByTestId("zoom-transcript-reconnect")).toBeNull();
  });
});

describe("getZoomTranscriptReconnectCopy", () => {
  test("has no words for no connection", () => {
    expect(
      getZoomTranscriptReconnectCopy({
        connections: [],
        translator: createTranslator(undefined, "en"),
      }),
    ).toBeNull();
  });

  test("names a connection without a name as Zoom", () => {
    const unnamed: VideoCallConnection = signedInZoom(ZOOM_ID, "");

    expect(
      getZoomTranscriptReconnectCopy({
        connections: [unnamed],
        translator: createTranslator(undefined, "en"),
      })?.title,
    ).toBe("Reconnect Zoom to keep starting calls");
  });
});
