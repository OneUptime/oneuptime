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
 * Project Settings > Video Calls, rendered for real - the provider gallery,
 * the connections table (a real ModelTable), and the connection form with
 * its setup guide and test meeting - with only the API, the permissions and
 * the signed-in user stubbed.
 *
 * What is pinned is what an administrator setting this up sees: every way a
 * call can be held side by side (the Slack huddle that needs nothing, and
 * the providers connected once), a provider's own setup guide before its
 * fields, a real test meeting before anything is saved, credentials that
 * are written and never read back, and a table that says which connection
 * is working and why one is not.
 */

let permissionsForTest: Array<unknown> = [];

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
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import { VideoCallProviderCatalog } from "../../../Types/VideoCall/VideoCallProviderCatalog";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/settings/video-calls`;
const ZOOM_ID: string = "00000000-0000-4000-8000-00000000a001";
const TEAMS_ID: string = "00000000-0000-4000-8000-00000000a002";
const ZOOM_URL: string = "https://example.zoom.us/j/81234567890";
const TEAMS_ERROR: string =
  "Microsoft Teams has no application access policy that lets this app create meetings for the organizer.";

let connections: Array<VideoCallConnection> = [];
let created: Array<VideoCallConnection> = [];
let updated: Array<{ id: string; data: JSONObject }> = [];
let testRequests: Array<JSONObject> = [];

function zoomConnection(): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection();
  connection._id = ZOOM_ID;
  connection.name = "Zoom for incidents";
  connection.provider = VideoCallProvider.Zoom;
  connection.config = {
    accountId: "acct-1",
    clientId: "client-1",
    hostEmail: "incidents@example.com",
  };
  connection.lastCallStartedAt = new Date(Date.now() - 5 * 60 * 1000);
  return connection;
}

function failingTeamsConnection(): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection();
  connection._id = TEAMS_ID;
  connection.name = "Teams bridge";
  connection.provider = VideoCallProvider.MicrosoftTeams;
  connection.config = {};
  connection.lastError = TEAMS_ERROR;
  connection.lastErrorAt = new Date(Date.now() - 60 * 1000);
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

function rowOf(name: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .getAllByRole("row")
    .find((candidate: HTMLElement) => {
      return within(candidate).queryByText(name, { exact: true }) !== null;
    });

  expect(row).toBeDefined();

  return row!;
}

/*
 * A row shows one action as its button - View error when its last call
 * failed, Test otherwise - and folds the rest into a menu beside it, which
 * is portalled to the body.
 */
function openRowMenu(row: HTMLElement): HTMLElement {
  fireEvent.click(within(row).getByTestId("row-actions-more-button"));
  return screen.getByRole("menu");
}

function rowMenuItem(row: HTMLElement, title: string): HTMLElement {
  return within(openRowMenu(row)).getByRole("menuitem", { name: title });
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function fieldOf(label: string): HTMLInputElement {
  return within(dialog()).getByLabelText(
    new RegExp(`^${label}`),
  ) as HTMLInputElement;
}

function type(label: string, value: string): void {
  fireEvent.change(fieldOf(label), { target: { value } });
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
  created = [];
  updated = [];
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

  jest.spyOn(ModelAPI, "create").mockImplementation((async (args: {
    model: VideoCallConnection;
  }) => {
    created.push(args.model);
    return { data: args.model } as never;
  }) as never);

  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (args: {
    id: { toString: () => string };
    data: JSONObject;
  }) => {
    updated.push({ id: args.id.toString(), data: args.data });
    return undefined as never;
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (args: {
    data: JSONObject;
  }) => {
    testRequests.push(args.data);
    return new HTTPResponse<JSONObject>(
      200,
      { provider: VideoCallProvider.Zoom, joinUrl: ZOOM_URL },
      {},
    );
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ConnectedWorkspaces.reset();
});

describe("the page", () => {
  test("says how it works, in three steps", async () => {
    await renderPage();

    for (const step of [
      "Connect a provider",
      "Turn it on in a rule",
      "Responders join in one click",
    ]) {
      expect(screen.getAllByText(step).length).toBeGreaterThan(0);
    }

    const rules: HTMLElement = screen.getByRole("link", {
      name: /Incident notification rules/,
    });

    expect(rules.getAttribute("href")).toContain(
      `/dashboard/${PROJECT_ID}/incidents/`,
    );
  });

  test("shows every way a call can be held, side by side", async () => {
    await renderPage();

    expect(
      within(screen.getByTestId("video-call-provider-gallery"))
        .getAllByTestId(/^video-call-provider-[A-Za-z]+$/)
        .map((element: HTMLElement): string => {
          return element.getAttribute("data-testid") || "";
        }),
    ).toEqual([
      "video-call-provider-SlackHuddle",
      ...VideoCallProviderCatalog.map((definition: { provider: string }) => {
        return `video-call-provider-${definition.provider}`;
      }),
    ]);

    for (const definition of VideoCallProviderCatalog) {
      const providerTile: HTMLElement = tile(definition.provider);

      expect(
        within(providerTile).getByTestId(
          `video-call-logo-${definition.provider}`,
        ),
      ).toBeVisible();
      expect(
        within(providerTile).getByRole("button", { name: /Connect/ }),
      ).toBeEnabled();
      expect(
        within(providerTile)
          .getByRole("link", { name: /Setup guide/ })
          .getAttribute("href"),
      ).toContain(definition.docsPath.replace(/^\/docs/, ""));
    }
  });

  test("the Slack huddle needs nothing but Slack, and says whether Slack is connected", async () => {
    await renderPage();

    const huddle: HTMLElement = tile(VideoCallProvider.SlackHuddle);

    expect(within(huddle).getByText("Built in")).toBeVisible();
    expect(within(huddle).getByText("Slack huddle")).toBeVisible();
    expect(within(huddle).getByText(/Slack is connected/)).toBeVisible();
    expect(
      within(huddle).queryByRole("button", { name: /Connect$/ }),
    ).toBeNull();
  });

  test("counts each provider's connections, and offers another", async () => {
    connections = [zoomConnection()];

    await renderPage();
    await screen.findByText("Zoom for incidents");

    await waitFor(() => {
      expect(
        within(tile(VideoCallProvider.Zoom)).getByTestId(
          "video-call-provider-count-Zoom",
        ),
      ).toHaveTextContent("1 connected");
    });
    expect(
      within(tile(VideoCallProvider.Zoom)).getByRole("button", {
        name: /Add another/,
      }),
    ).toBeVisible();
    expect(
      within(tile(VideoCallProvider.GoogleMeet)).queryByTestId(
        "video-call-provider-count-GoogleMeet",
      ),
    ).toBeNull();
  });
});

describe("the connections table", () => {
  test("says which connection works and which one failed", async () => {
    connections = [zoomConnection(), failingTeamsConnection()];

    await renderPage();
    await screen.findByText("Teams bridge");

    const zoom: HTMLElement = rowOf("Zoom for incidents");
    const teams: HTMLElement = rowOf("Teams bridge");

    expect(within(zoom).getByText("Working")).toBeVisible();
    expect(within(teams).getByText("Last call failed")).toBeVisible();
    expect(
      within(teams).getByTestId("video-call-logo-MicrosoftTeams"),
    ).toBeVisible();

    // Only a connection that failed has an error to look at.
    expect(
      within(zoom).queryByRole("button", { name: "View error" }),
    ).toBeNull();
    expect(within(zoom).getByRole("button", { name: "Test" })).toBeVisible();
    expect(
      within(openRowMenu(zoom))
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return (item.textContent || "").trim();
        }),
    ).toEqual(["Edit", "Delete"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    fireEvent.click(within(teams).getByRole("button", { name: "View error" }));

    const errorDialog: HTMLElement = await screen.findByRole("dialog");

    expect(within(errorDialog).getByText("Last error")).toBeVisible();
    expect(within(errorDialog).getByText(TEAMS_ERROR)).toBeVisible();
    expect(
      within(errorDialog).getByRole("button", { name: /Copy error/ }),
    ).toBeVisible();
  });

  test("Test starts a real meeting with the saved connection, by its id", async () => {
    connections = [zoomConnection()];

    await renderPage();
    await screen.findByText("Zoom for incidents");

    fireEvent.click(
      within(rowOf("Zoom for incidents")).getByRole("button", {
        name: "Test",
      }),
    );

    const testDialog: HTMLElement = await screen.findByRole("dialog");
    const passed: HTMLElement = await within(testDialog).findByTestId(
      "video-call-test-passed",
    );

    expect(
      within(passed).getByRole("link", { name: ZOOM_URL }),
    ).toHaveAttribute("href", ZOOM_URL);
    expect(testRequests).toEqual([{ connectionId: ZOOM_ID }]);
  });

  test("says what to do when there is no connection yet", async () => {
    await renderPage();

    expect(
      await screen.findByText(/No video call connections yet/),
    ).toBeVisible();
    expect(
      screen.getByText(/Pick a provider above to connect one/),
    ).toBeVisible();
  });
});

describe("connecting a provider", () => {
  async function openConnect(provider: VideoCallProvider): Promise<void> {
    fireEvent.click(
      within(tile(provider)).getByRole("button", { name: /Connect/ }),
    );

    await within(await screen.findByRole("dialog")).findByTestId(
      "video-call-setup-guide",
    );
  }

  async function next(): Promise<void> {
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    await within(dialog()).findByTestId("video-call-test-panel");
    await settle();
  }

  test("opens on the provider's own setup guide", async () => {
    await renderPage();
    await openConnect(VideoCallProvider.Zoom);

    const guide: HTMLElement = within(dialog()).getByTestId(
      "video-call-setup-guide",
    );

    expect(within(dialog()).getByText("Connect Zoom")).toBeVisible();
    expect(within(guide).getByText("Set up Zoom")).toBeVisible();
    expect(within(guide).getAllByRole("listitem")).toHaveLength(
      VideoCallProviderCatalog[0]!.setupSteps.length,
    );
    expect(
      within(guide).getByText(
        /Use a service account rather than a person's account/,
      ),
    ).toBeVisible();
  });

  test("tests the unsaved settings with a real meeting, then saves them", async () => {
    await renderPage();
    await openConnect(VideoCallProvider.Zoom);
    await next();

    const testButton: HTMLElement = within(dialog()).getByTestId(
      "video-call-test-button",
    );

    // Nothing to test with yet.
    expect(testButton).toBeDisabled();

    type("Account ID", " acct-9 ");
    type("Client ID", "client-9");
    type("Meeting host", "incidents@example.com");
    type("Client secret", "s3cret");

    await waitFor(() => {
      expect(
        within(dialog()).getByTestId("video-call-test-button"),
      ).toBeEnabled();
    });

    fireEvent.click(within(dialog()).getByTestId("video-call-test-button"));

    await within(dialog()).findByTestId("video-call-test-passed");

    expect(testRequests).toEqual([
      {
        provider: VideoCallProvider.Zoom,
        config: {
          accountId: "acct-9",
          clientId: "client-9",
          hostEmail: "incidents@example.com",
        },
        secrets: { clientSecret: "s3cret" },
      },
    ]);

    fireEvent.click(within(dialog()).getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(created).toHaveLength(1);
    });

    const connection: VideoCallConnection = created[0]!;

    expect(connection.provider).toBe(VideoCallProvider.Zoom);
    expect(connection.name).toBe("Zoom");
    expect(connection.config).toEqual({
      accountId: "acct-9",
      clientId: "client-9",
      hostEmail: "incidents@example.com",
    });
    expect(JSON.parse(connection.secrets as string)).toEqual({
      clientSecret: "s3cret",
    });
    expect(connection.projectId?.toString()).toBe(PROJECT_ID);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  test("a standing meeting link needs only its link", async () => {
    await renderPage();
    await openConnect(VideoCallProvider.CustomLink);

    expect(within(dialog()).getByText("Add a meeting link")).toBeVisible();

    await next();

    type("Meeting link", "https://bridge.example.com/room/7");

    fireEvent.click(within(dialog()).getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(created).toHaveLength(1);
    });

    expect(created[0]!.provider).toBe(VideoCallProvider.CustomLink);
    expect(created[0]!.config).toEqual({
      joinUrl: "https://bridge.example.com/room/7",
    });
    expect(JSON.parse(created[0]!.secrets as string)).toEqual({});
  });
});

describe("editing a connection", () => {
  async function openEdit(): Promise<void> {
    connections = [zoomConnection()];

    await renderPage();
    await screen.findByText("Zoom for incidents");

    fireEvent.click(rowMenuItem(rowOf("Zoom for incidents"), "Edit"));

    await within(await screen.findByRole("dialog")).findByTestId(
      "video-call-test-panel",
    );
    await settle();
  }

  test("opens on its fields, filled in, with the secret left blank", async () => {
    await openEdit();

    expect(within(dialog()).getByText("Edit Zoom for incidents")).toBeVisible();
    expect(within(dialog()).queryByTestId("video-call-setup-guide")).toBeNull();
    expect(fieldOf("Account ID").value).toBe("acct-1");
    expect(fieldOf("Meeting host").value).toBe("incidents@example.com");
    expect(fieldOf("Client secret").value).toBe("");
    expect(fieldOf("Client secret").getAttribute("placeholder")).toBe(
      "Unchanged",
    );
    // A stored secret fills the gaps, so the test can run straight away.
    expect(
      within(dialog()).getByTestId("video-call-test-button"),
    ).toBeEnabled();
  });

  test("saving with the secret blank keeps the stored one", async () => {
    await openEdit();

    type("Meeting host", "oncall@example.com");

    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => {
      expect(updated).toHaveLength(1);
    });

    expect(updated[0]!.id).toBe(ZOOM_ID);
    expect(updated[0]!.data["config"]).toEqual({
      accountId: "acct-1",
      clientId: "client-1",
      hostEmail: "oncall@example.com",
    });
    expect(updated[0]!.data["secrets"]).toBeUndefined();
  });

  test("a new secret replaces the stored one", async () => {
    await openEdit();

    type("Client secret", "rotated-secret");

    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => {
      expect(updated).toHaveLength(1);
    });

    expect(JSON.parse(updated[0]!.data["secrets"] as string)).toEqual({
      clientSecret: "rotated-secret",
    });
  });
});

describe("who may connect providers", () => {
  test("someone who may only read settings sees every provider, but cannot connect one", async () => {
    permissionsForTest = [Permission.SettingsViewer];
    connections = [zoomConnection()];

    await renderPage();
    await screen.findByText("Zoom for incidents");

    for (const definition of VideoCallProviderCatalog) {
      expect(
        within(tile(definition.provider)).getByRole("button", {
          name: /Connect|Add another/,
        }),
      ).toBeDisabled();
    }

    // Testing and editing a connection are locked for them too.
    expect(
      within(rowOf("Zoom for incidents")).getByRole("button", {
        name: "Test",
      }),
    ).toBeDisabled();
    expect(rowMenuItem(rowOf("Zoom for incidents"), "Edit")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
