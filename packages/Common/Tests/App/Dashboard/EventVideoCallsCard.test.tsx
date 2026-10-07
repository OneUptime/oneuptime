import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The Video Call card on an incident's or alert's page, and the dialog that
 * starts a call from it. The card has one job during an incident - get a
 * responder into the call in one click - so the tests pin the Join link
 * (where it goes, that it opens a new tab and cannot reach back into the
 * page), who started the call, the earlier calls, removing a call, and
 * starting one: a new meeting with a connection, the Slack huddle, or a
 * link of one's own.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import EventVideoCallsCard from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/EventVideoCallsCard";
import {
  EventVideoCall,
  VideoCallEventKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/useEventVideoCalls";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import AlertVideoCall from "../../../Models/DatabaseModels/AlertVideoCall";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import User from "../../../Models/DatabaseModels/User";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const EVENT_ID: ObjectID = new ObjectID("9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b");
const ZOOM_CONNECTION_ID: string = "2f3e4d5c-6b7a-4891-8a7b-6c5d4e3f2a1b";
const ZOOM_URL: string = "https://example.zoom.us/j/81234567890?pwd=abc";
const HUDDLE_URL: string = "https://app.slack.com/huddle/T0123ABCD/C0456EFGH";

let allowed: Record<ModelAction, boolean>;
let createSpy: ReturnType<typeof jest.spyOn>;
let deleteSpy: ReturnType<typeof jest.spyOn>;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function incidentCall(data: {
  id?: string;
  provider: VideoCallProvider;
  joinUrl: string;
  title?: string;
  byRule?: boolean;
  byUser?: string;
  minutesAgo?: number;
}): IncidentVideoCall {
  const call: IncidentVideoCall = new IncidentVideoCall();
  call.id = new ObjectID(data.id || ObjectID.generate().toString());
  call.provider = data.provider;
  call.joinUrl = data.joinUrl;
  if (data.title) {
    call.title = data.title;
  }
  if (data.byRule) {
    call.workspaceNotificationRuleId = ObjectID.generate();
  }
  if (data.byUser) {
    const user: User = new User();
    user.name = new Name(data.byUser);
    call.createdByUser = user;
  }
  call.createdAt = minutesAgo(data.minutesAgo ?? 3);
  return call;
}

function renderCard(data: {
  kind?: VideoCallEventKind;
  calls?: Array<EventVideoCall>;
  hasLoaded?: boolean;
  error?: string;
  onChanged?: MockFunction;
  onRetry?: MockFunction;
}): { onChanged: MockFunction; onRetry: MockFunction } {
  const onChanged: MockFunction = data.onChanged || getJestMockFunction();
  const onRetry: MockFunction = data.onRetry || getJestMockFunction();

  render(
    <MemoryRouter>
      <EventVideoCallsCard
        kind={data.kind || VideoCallEventKind.Incident}
        eventId={EVENT_ID}
        calls={data.calls || []}
        hasLoaded={data.hasLoaded !== false}
        error={data.error}
        onChanged={() => {
          onChanged();
        }}
        onRetry={() => {
          onRetry();
        }}
      />
    </MemoryRouter>,
  );

  return { onChanged, onRetry };
}

function zoomConnection(): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection();
  connection.id = new ObjectID(ZOOM_CONNECTION_ID);
  connection.name = "Zoom for incidents";
  connection.provider = VideoCallProvider.Zoom;
  return connection;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${EVENT_ID.toString()}`);
  ConnectedWorkspaces.reset();

  allowed = {
    [ModelAction.Create]: true,
    [ModelAction.Read]: true,
    [ModelAction.Update]: true,
    [ModelAction.Delete]: true,
  } as Record<ModelAction, boolean>;

  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation(
      (_model: unknown, action: ModelAction): PermissionGateResult => {
        return allowed[action]
          ? { isAllowed: true }
          : {
              isAllowed: false,
              disabledReason: "You need permission to do this.",
            };
      },
    );

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<VideoCallConnection>> => {
      return { data: [zoomConnection()], count: 1, skip: 0, limit: 100 };
    });

  createSpy = jest
    .spyOn(ModelAPI, "create")
    .mockImplementation(async (): Promise<never> => {
      return { data: {} } as never;
    });

  deleteSpy = jest
    .spyOn(ModelAPI, "deleteItem")
    .mockImplementation(async (): Promise<void> => {
      return undefined;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ConnectedWorkspaces.reset();
});

describe("the card", () => {
  test("waits for the first answer without showing an empty card", () => {
    renderCard({ hasLoaded: false });

    expect(screen.queryByTestId("event-video-calls-empty")).toBeNull();
    expect(screen.queryAllByTestId("event-video-call")).toHaveLength(0);
  });

  test("shows why the calls could not be read, with a retry", () => {
    const { onRetry } = renderCard({ error: "The database is asleep" });

    expect(screen.getByText("The database is asleep")).toBeVisible();

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("without a call, offers to start one", () => {
    renderCard({});

    const empty: HTMLElement = screen.getByTestId("event-video-calls-empty");

    expect(within(empty).getByText("No call yet")).toBeVisible();
    expect(
      within(empty).getByText(
        "Start a dedicated call so the incident's responders can talk it through.",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("event-video-call-start")).toBeVisible();
  });

  test("without a call and without permission, offers nothing to press", () => {
    allowed[ModelAction.Create] = false;

    renderCard({ kind: VideoCallEventKind.Alert });

    expect(
      screen.getByText(
        "Start a dedicated call so the alert's responders can talk it through.",
      ),
    ).toBeVisible();
    expect(screen.queryByTestId("event-video-call-start")).toBeNull();
  });
});

describe("a call", () => {
  test("is one click away: Join opens it in a new tab that cannot reach back", () => {
    renderCard({
      calls: [
        incidentCall({
          provider: VideoCallProvider.Zoom,
          joinUrl: ZOOM_URL,
          title: "INC-42: Checkout is down",
          byRule: true,
        }),
      ],
    });

    const join: HTMLElement = screen.getByTestId("event-video-call-join");

    expect(join).toHaveTextContent("Join call");
    expect(join).toHaveAttribute("href", ZOOM_URL);
    expect(join).toHaveAttribute("target", "_blank");
    expect(join).toHaveAttribute("rel", "noopener noreferrer");

    const call: HTMLElement = screen.getByTestId("event-video-call");

    expect(within(call).getByText("Zoom meeting")).toBeVisible();
    expect(within(call).getByText("INC-42: Checkout is down")).toBeVisible();
    expect(
      within(call).getByText(/Started automatically by a workspace rule/),
    ).toBeVisible();
    expect(within(call).getByTestId("video-call-logo-Zoom")).toBeVisible();
    expect(
      within(call).getByRole("button", { name: /Copy link/ }),
    ).toBeVisible();
  });

  test("a huddle says Join huddle", () => {
    renderCard({
      calls: [
        incidentCall({
          provider: VideoCallProvider.SlackHuddle,
          joinUrl: HUDDLE_URL,
          byUser: "Ada Lovelace",
        }),
      ],
    });

    expect(screen.getByTestId("event-video-call-join")).toHaveTextContent(
      "Join huddle",
    );
    expect(screen.getByText(/Started by Ada Lovelace/)).toBeVisible();
  });

  test("a call started through the API says so", () => {
    renderCard({
      calls: [
        incidentCall({
          provider: VideoCallProvider.CustomLink,
          joinUrl: "https://bridge.example.com/room/7",
          title: "Payments bridge",
        }),
      ],
    });

    expect(screen.getByText("Payments bridge")).toBeVisible();
    expect(screen.getByText(/Started from the API/)).toBeVisible();
  });

  test("the newest call is the one to join; earlier calls are listed under it", () => {
    renderCard({
      calls: [
        incidentCall({
          provider: VideoCallProvider.Zoom,
          joinUrl: ZOOM_URL,
          minutesAgo: 1,
        }),
        incidentCall({
          provider: VideoCallProvider.SlackHuddle,
          joinUrl: HUDDLE_URL,
          minutesAgo: 9,
        }),
      ],
    });

    expect(screen.getAllByTestId("event-video-call")).toHaveLength(2);
    expect(screen.getByTestId("event-video-call-join")).toHaveAttribute(
      "href",
      ZOOM_URL,
    );
    expect(screen.getByText("Earlier calls")).toBeVisible();

    const earlier: HTMLElement = screen.getByTestId(
      "event-video-call-join-secondary",
    );

    expect(earlier).toHaveAttribute("href", HUDDLE_URL);
    expect(earlier).toHaveAttribute("target", "_blank");
    expect(earlier).toHaveTextContent("Join huddle");
  });
});

describe("removing a call", () => {
  test("asks first, says the meeting itself stays, then removes it", async () => {
    const callId: string = "3a4b5c6d-7e8f-4a9b-8c7d-6e5f4a3b2c1d";
    const { onChanged } = renderCard({
      calls: [
        incidentCall({
          id: callId,
          provider: VideoCallProvider.Zoom,
          joinUrl: ZOOM_URL,
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove this call" }));

    const dialog: HTMLElement = await screen.findByRole("dialog");

    expect(within(dialog).getByText("Remove this call?")).toBeVisible();
    expect(
      within(dialog).getByText(
        "“Zoom meeting” is removed from this incident's page. The meeting itself is not deleted, and anyone with the link can still join it.",
      ),
    ).toBeVisible();
    expect(deleteSpy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    expect(deleteSpy).toHaveBeenCalledTimes(1);

    const request: { modelType: unknown; id: ObjectID } = deleteSpy.mock
      .calls[0]![0] as never;

    expect(request.modelType).toBe(IncidentVideoCall);
    expect(request.id.toString()).toBe(callId);
  });

  test("is not offered without permission to remove calls", () => {
    allowed[ModelAction.Delete] = false;

    renderCard({
      calls: [
        incidentCall({ provider: VideoCallProvider.Zoom, joinUrl: ZOOM_URL }),
      ],
    });

    expect(
      screen.queryByRole("button", { name: "Remove this call" }),
    ).toBeNull();
    // Joining needs no permission beyond reading the incident.
    expect(screen.getByTestId("event-video-call-join")).toBeVisible();
  });
});

describe("starting a call", () => {
  async function openStartDialog(): Promise<HTMLElement> {
    fireEvent.click(screen.getByTestId("event-video-call-start"));

    const dialog: HTMLElement = await screen.findByRole("dialog");

    await within(dialog).findByTestId(
      `start-video-call-option-${ZOOM_CONNECTION_ID}`,
    );

    return dialog;
  }

  function submit(dialog: HTMLElement, name: string): void {
    fireEvent.click(within(dialog).getByRole("button", { name }));
  }

  test("offers the project's connections, the Slack huddle when Slack is connected, and a link of one's own", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, [WorkspaceType.Slack]);
    renderCard({});

    const dialog: HTMLElement = await openStartDialog();

    expect(
      within(dialog).getByText("Start a call for this incident"),
    ).toBeVisible();
    expect(
      within(dialog)
        .getAllByRole("radio")
        .map((option: HTMLElement): string => {
          return option.getAttribute("data-testid") || "";
        }),
    ).toEqual([
      `start-video-call-option-${ZOOM_CONNECTION_ID}`,
      "start-video-call-option-slack-huddle",
      "start-video-call-option-own-link",
    ]);
    expect(within(dialog).getByText("A new Zoom meeting")).toBeVisible();
  });

  test("leaves the huddle out when Slack is not connected", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, [
      WorkspaceType.MicrosoftTeams,
    ]);
    renderCard({});

    const dialog: HTMLElement = await openStartDialog();

    expect(
      within(dialog).queryByTestId("start-video-call-option-slack-huddle"),
    ).toBeNull();
  });

  test("asks where the call is held before starting one", async () => {
    renderCard({});

    const dialog: HTMLElement = await openStartDialog();
    submit(dialog, "Start call");

    expect(
      await within(dialog).findByText("Pick where the call is held."),
    ).toBeVisible();
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("starts a new meeting with the connection picked", async () => {
    const { onChanged } = renderCard({});

    const dialog: HTMLElement = await openStartDialog();

    fireEvent.click(
      within(dialog).getByTestId(
        `start-video-call-option-${ZOOM_CONNECTION_ID}`,
      ),
    );
    submit(dialog, "Start call");

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    const request: { model: IncidentVideoCall; modelType: unknown } = createSpy
      .mock.calls[0]![0] as never;

    expect(request.modelType).toBe(IncidentVideoCall);
    expect(request.model.incidentId?.toString()).toBe(EVENT_ID.toString());
    expect(request.model.videoCallConnectionId?.toString()).toBe(
      ZOOM_CONNECTION_ID,
    );
    // The server starts the meeting; the page never sends a link for it.
    expect(request.model.joinUrl).toBeUndefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("starts the huddle of the alert's Slack channel", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, [WorkspaceType.Slack]);
    renderCard({ kind: VideoCallEventKind.Alert });

    const dialog: HTMLElement = await openStartDialog();

    fireEvent.click(
      within(dialog).getByTestId("start-video-call-option-slack-huddle"),
    );
    submit(dialog, "Start call");

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    const request: { model: AlertVideoCall; modelType: unknown } = createSpy
      .mock.calls[0]![0] as never;

    expect(request.modelType).toBe(AlertVideoCall);
    expect(request.model.alertId?.toString()).toBe(EVENT_ID.toString());
    expect(request.model.provider).toBe(VideoCallProvider.SlackHuddle);
  });

  test("adds a link of one's own, with its title", async () => {
    renderCard({});

    const dialog: HTMLElement = await openStartDialog();

    fireEvent.click(
      within(dialog).getByTestId("start-video-call-option-own-link"),
    );
    submit(dialog, "Add call");

    expect(
      await within(dialog).findByText("Paste the meeting link."),
    ).toBeVisible();

    fireEvent.change(within(dialog).getByTestId("start-video-call-link"), {
      target: { value: "  https://meet.google.com/abc-defg-hij  " },
    });
    fireEvent.change(within(dialog).getByTestId("start-video-call-title"), {
      target: { value: "Payments war room" },
    });

    // The link's own brand shows as soon as it is pasted.
    expect(
      within(
        within(dialog).getByTestId("start-video-call-option-own-link"),
      ).getByTestId("video-call-logo-GoogleMeet"),
    ).toBeVisible();

    submit(dialog, "Add call");

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    const request: { model: IncidentVideoCall } = createSpy.mock
      .calls[0]![0] as never;

    expect(request.model.joinUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(request.model.title).toBe("Payments war room");
    expect(request.model.videoCallConnectionId).toBeUndefined();
  });

  test("shows the provider's reason when the meeting could not start, and stays open", async () => {
    createSpy.mockImplementation(async (): Promise<never> => {
      throw new Error("Zoom rejected the client secret.");
    });
    const { onChanged } = renderCard({});

    const dialog: HTMLElement = await openStartDialog();

    fireEvent.click(
      within(dialog).getByTestId(
        `start-video-call-option-${ZOOM_CONNECTION_ID}`,
      ),
    );
    submit(dialog, "Start call");

    expect(
      await within(dialog).findByText("Zoom rejected the client secret."),
    ).toBeVisible();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  test("without connections, a link of one's own is the choice, and the way to connect a provider is shown", async () => {
    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(
        async (): Promise<ListResult<VideoCallConnection>> => {
          return { data: [], count: 0, skip: 0, limit: 100 };
        },
      );
    renderCard({});

    fireEvent.click(screen.getByTestId("event-video-call-start"));

    const dialog: HTMLElement = await screen.findByRole("dialog");
    const ownLink: HTMLElement = await within(dialog).findByTestId(
      "start-video-call-option-own-link",
    );

    expect(ownLink).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByTestId("start-video-call-link")).toBeVisible();

    const connect: HTMLElement = within(dialog).getByRole("link", {
      name: "Connect a provider",
    });

    expect(connect.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/settings/video-calls`,
    );
  });
});
