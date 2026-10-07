import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The Video Call step of a Slack or Microsoft Teams notification rule for
 * incidents and alerts: whether the rule starts a call for the event it
 * fires for, and where the call is held. What matters is what the step
 * offers (a Slack huddle only to a Slack rule, the project's connections to
 * both), what it hands back to the rule, and the warnings that keep a rule
 * from saving a call that cannot start.
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

import NotificationRuleVideoCallForm from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleVideoCallForm";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import ObjectID from "../../../Types/ObjectID";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import { SLACK_HUDDLE_VIDEO_CALL_SOURCE } from "../../../Types/Workspace/NotificationRules/VideoCallNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

const ZOOM_ID: string = "4a1f0d0e-2b7c-4f3a-9e8d-1c2b3a4d5e6f";
const TEAMS_ID: string = "5b2e1f1d-3c8d-4a4b-8f9e-2d3c4b5e6f7a";

function connectionOf(
  id: string,
  name: string,
  provider: VideoCallProvider,
): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection();
  connection.id = new ObjectID(id);
  connection.name = name;
  connection.provider = provider;
  return connection;
}

const ZOOM: VideoCallConnection = connectionOf(
  ZOOM_ID,
  "Zoom for incidents",
  VideoCallProvider.Zoom,
);
const TEAMS: VideoCallConnection = connectionOf(
  TEAMS_ID,
  "Teams bridge",
  VideoCallProvider.MicrosoftTeams,
);

function ruleOf(
  fields: Partial<IncidentNotificationRule>,
): IncidentNotificationRule {
  return {
    _type: "IncidentNotificationRule",
    shouldCreateNewChannel: false,
    shouldPostToExistingChannel: false,
    ...fields,
  } as IncidentNotificationRule;
}

function renderStep(data: {
  value?: IncidentNotificationRule | undefined;
  workspaceType?: WorkspaceType | undefined;
  eventType?: NotificationRuleEventType | undefined;
  connections?: Array<VideoCallConnection> | undefined;
  error?: string | undefined;
}): MockFunction {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <MemoryRouter>
      <NotificationRuleVideoCallForm
        value={data.value}
        onChange={(value: IncidentNotificationRule) => {
          onChange(value);
        }}
        workspaceType={data.workspaceType || WorkspaceType.Slack}
        eventType={data.eventType || NotificationRuleEventType.Incident}
        connections={data.connections || []}
        error={data.error}
      />
    </MemoryRouter>,
  );

  return onChange;
}

function sourceOptions(): Array<string> {
  return screen.queryAllByRole("radio").map((option: HTMLElement): string => {
    return option.getAttribute("data-testid") || "";
  });
}

function lastChange(onChange: MockFunction): IncidentNotificationRule {
  const calls: Array<Array<unknown>> = onChange.mock.calls;
  return calls[calls.length - 1]![0] as IncidentNotificationRule;
}

afterEach(() => {
  cleanup();
});

describe("turning the call on and off", () => {
  test("starts off, asking only whether to start a call", () => {
    renderStep({ connections: [ZOOM] });

    const toggle: HTMLElement = screen.getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("Start a video call for the incident"),
    ).toBeVisible();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  test("on, with the huddle as the only place, picks the huddle", () => {
    const onChange: MockFunction = renderStep({
      value: ruleOf({ shouldCreateNewChannel: true }),
      workspaceType: WorkspaceType.Slack,
      connections: [],
    });

    fireEvent.click(screen.getByRole("switch"));

    expect(lastChange(onChange)).toMatchObject({
      shouldStartVideoCall: true,
      videoCallSource: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
      // The rest of the rule is kept.
      shouldCreateNewChannel: true,
    });
  });

  test("on, with a choice to make, picks nothing for the person", () => {
    const onChange: MockFunction = renderStep({
      workspaceType: WorkspaceType.Slack,
      connections: [ZOOM, TEAMS],
    });

    fireEvent.click(screen.getByRole("switch"));

    expect(lastChange(onChange).shouldStartVideoCall).toBe(true);
    expect(lastChange(onChange).videoCallSource).toBeUndefined();
  });

  test("off again keeps the choice, so turning it back on restores it", () => {
    const onChange: MockFunction = renderStep({
      value: ruleOf({ shouldStartVideoCall: true, videoCallSource: ZOOM_ID }),
      connections: [ZOOM, TEAMS],
    });

    fireEvent.click(screen.getByRole("switch"));

    expect(lastChange(onChange)).toMatchObject({
      shouldStartVideoCall: false,
      videoCallSource: ZOOM_ID,
    });
  });

  test("speaks of alerts in an alert rule", () => {
    renderStep({ eventType: NotificationRuleEventType.Alert });

    expect(screen.getByText("Start a video call for the alert")).toBeVisible();
  });
});

describe("where the call is held", () => {
  test("a Slack rule offers its channel's huddle first, then the project's connections", () => {
    renderStep({
      value: ruleOf({ shouldStartVideoCall: true }),
      workspaceType: WorkspaceType.Slack,
      connections: [ZOOM, TEAMS],
    });

    expect(sourceOptions()).toEqual([
      `notification-rule-video-call-source-${SLACK_HUDDLE_VIDEO_CALL_SOURCE}`,
      `notification-rule-video-call-source-${ZOOM_ID}`,
      `notification-rule-video-call-source-${TEAMS_ID}`,
    ]);

    const zoom: HTMLElement = screen.getByTestId(
      `notification-rule-video-call-source-${ZOOM_ID}`,
    );

    expect(within(zoom).getByText("Zoom for incidents")).toBeVisible();
    expect(
      within(zoom).getByText("A new Zoom meeting for every incident."),
    ).toBeVisible();
  });

  test("a Microsoft Teams rule never offers a Slack huddle", () => {
    renderStep({
      value: ruleOf({ shouldStartVideoCall: true }),
      workspaceType: WorkspaceType.MicrosoftTeams,
      connections: [ZOOM, TEAMS],
    });

    expect(sourceOptions()).toEqual([
      `notification-rule-video-call-source-${ZOOM_ID}`,
      `notification-rule-video-call-source-${TEAMS_ID}`,
    ]);
    expect(screen.queryByText("Slack huddle")).toBeNull();
  });

  test("picking a place hands its id to the rule", () => {
    const onChange: MockFunction = renderStep({
      value: ruleOf({ shouldStartVideoCall: true }),
      connections: [ZOOM, TEAMS],
    });

    fireEvent.click(
      screen.getByTestId(`notification-rule-video-call-source-${TEAMS_ID}`),
    );

    expect(lastChange(onChange)).toMatchObject({
      shouldStartVideoCall: true,
      videoCallSource: TEAMS_ID,
    });
  });

  test("marks the place the rule holds its call", () => {
    renderStep({
      value: ruleOf({ shouldStartVideoCall: true, videoCallSource: ZOOM_ID }),
      connections: [ZOOM, TEAMS],
    });

    expect(
      screen.getByTestId(`notification-rule-video-call-source-${ZOOM_ID}`),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId(`notification-rule-video-call-source-${TEAMS_ID}`),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("a standing link says every event shares its room", () => {
    const link: VideoCallConnection = connectionOf(
      "6c3f2a2e-4d9e-4b5c-9a0f-3e4d5c6f7a8b",
      "War room",
      VideoCallProvider.CustomLink,
    );
    link.config = { joinUrl: "https://example.zoom.us/j/1" };

    renderStep({
      value: ruleOf({ shouldStartVideoCall: true }),
      connections: [link],
    });

    expect(
      screen.getByText("A standing link: every event shares this room."),
    ).toBeVisible();
    // The link's own brand, not a generic link icon.
    expect(screen.getByTestId("video-call-logo-Zoom")).toBeVisible();
  });
});

describe("when there is nothing to pick", () => {
  test("a Microsoft Teams rule without connections is sent to connect one", () => {
    goTo(
      `/dashboard/${PROJECT_ID}/incidents/workspace-connection-microsoft-teams`,
    );

    renderStep({
      value: ruleOf({ shouldStartVideoCall: true }),
      workspaceType: WorkspaceType.MicrosoftTeams,
      connections: [],
    });

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(
      screen.getByText(
        "Connect Zoom, Google Meet or Microsoft Teams first: a Microsoft Teams rule starts its calls with one of the project's video call connections.",
      ),
    ).toBeVisible();

    const link: HTMLElement = screen.getByRole("link", {
      name: /Connect a provider/,
    });

    expect(link.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/settings/video-calls`,
    );
  });

  test("a Slack rule without connections can still hold a huddle, and hears about the rest", () => {
    renderStep({
      value: ruleOf({ shouldStartVideoCall: true }),
      workspaceType: WorkspaceType.Slack,
      connections: [],
    });

    expect(sourceOptions()).toEqual([
      `notification-rule-video-call-source-${SLACK_HUDDLE_VIDEO_CALL_SOURCE}`,
    ]);
    expect(
      screen.getByText(
        "Connect Zoom, Google Meet or Microsoft Teams to start a meeting there instead of a huddle.",
      ),
    ).toBeVisible();
  });
});

describe("warnings", () => {
  test("a rule whose connection was deleted is told to pick another", () => {
    renderStep({
      value: ruleOf({
        shouldStartVideoCall: true,
        videoCallSource: "7d4a3b3f-5e0f-4c6d-8b1a-4f5e6d7a8b9c",
      }),
      connections: [ZOOM],
    });

    expect(
      screen.getByText(
        "The connection this rule used was deleted. Pick another one.",
      ),
    ).toBeVisible();
  });

  test("a huddle needs a channel: a rule that posts to none is told where to add one", () => {
    renderStep({
      value: ruleOf({
        shouldStartVideoCall: true,
        videoCallSource: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
      }),
      workspaceType: WorkspaceType.Slack,
    });

    expect(
      screen.getByText(
        "A huddle is held in a Slack channel. Turn on Create Slack Channel or Post to Existing Slack Channel on the Destination step.",
      ),
    ).toBeVisible();
  });

  test.each([
    [{ shouldCreateNewChannel: true }],
    [{ shouldPostToExistingChannel: true }],
  ])(
    "a huddle in a rule that posts to a channel (%j) needs no warning",
    (destination: Partial<IncidentNotificationRule>) => {
      renderStep({
        value: ruleOf({
          ...destination,
          shouldStartVideoCall: true,
          videoCallSource: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
        }),
        workspaceType: WorkspaceType.Slack,
      });

      expect(
        screen.queryByText(/A huddle is held in a Slack channel/),
      ).toBeNull();
    },
  );

  test("shows the form's own error for the step", () => {
    renderStep({
      value: ruleOf({ shouldStartVideoCall: true }),
      connections: [ZOOM],
      error:
        "Pick where this rule's video call is held, or turn the video call off.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Pick where this rule's video call is held, or turn the video call off.",
    );
  });

  test("says one call per event, and that a failure never holds the event up", () => {
    renderStep({
      value: ruleOf({ shouldStartVideoCall: true }),
      connections: [ZOOM],
    });

    expect(
      screen.getByText(
        /Rules that pick the same connection share one call per incident\./,
      ),
    ).toBeVisible();
    expect(screen.getByText(/never holds up the incident/)).toBeVisible();
  });
});
