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
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import React from "react";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          if (key === "Open in Slack") {
            return "In Slack öffnen";
          }

          return options?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

import EventStatusPanel, {
  ComponentProps,
  EventPanelAction,
  EventPanelMenuItem,
  EventStateItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import useRecordChannelLinks, {
  fetchChannelLinks,
  getOpenInChatActions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/useRecordChannelLinks";
import { CHANNEL_LINK_RECHECK_DELAYS_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/ChannelLinks";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "../../../Types/Workspace/WorkspaceChannelLink";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { StateListType } from "../../../Utils/StateOrder";

/*
 * Open in Slack / Open in Microsoft Teams in a record page's header - the
 * Datadog "Open Slack" button: the channel where the incident is being
 * worked, one click from its page. A workspace with one channel is a link
 * that opens it in a new tab; one with several is a menu of them; a record
 * with none shows nothing. The page asks the server for the links, looks
 * again while a new record's channel is still being created, and hides the
 * buttons when it cannot ask.
 */

const SLACK_URL: string =
  "https://slack.com/app_redirect?channel=C0456EFGH&team=T0123ABCD";
const SECOND_SLACK_URL: string =
  "https://slack.com/app_redirect?channel=C0999ZZZZ&team=T0123ABCD";
const TEAMS_URL: string =
  "https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Incident%2042?groupId=3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

const SLACK_LINK: WorkspaceChannelLink = {
  workspaceType: WorkspaceType.Slack,
  channelName: "incident-42-checkout",
  url: SLACK_URL,
};
const SECOND_SLACK_LINK: WorkspaceChannelLink = {
  workspaceType: WorkspaceType.Slack,
  channelName: "sre-war-room",
  url: SECOND_SLACK_URL,
};
const TEAMS_LINK: WorkspaceChannelLink = {
  workspaceType: WorkspaceType.MicrosoftTeams,
  channelName: "Incident 42",
  url: TEAMS_URL,
};

const RECORD_ID: ObjectID = new ObjectID(
  "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
);
const OTHER_RECORD_ID: ObjectID = new ObjectID(
  "1e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6c",
);

const STATES: Array<EventStateItem> = [
  { id: "created", name: "Created", color: new Color("#64748b") },
  { id: "investigating", name: "Investigating", color: new Color("#0ea5e9") },
  { id: "resolved", name: "Resolved", color: new Color("#10b981") },
];

const renderPanel: (
  secondaryActions: Array<EventPanelAction>,
  overrides?: Partial<ComponentProps>,
) => void = (
  secondaryActions: Array<EventPanelAction>,
  overrides?: Partial<ComponentProps>,
): void => {
  render(
    <EventStatusPanel
      stateList={StateListType.IncidentState}
      states={STATES}
      identifier="INC-42"
      currentStateId="created"
      actions={[
        {
          stateId: "resolved",
          label: "Resolve",
          icon: IconProp.CheckCircle,
          id: "incident-resolve-btn",
        } as ComponentProps["actions"][number],
      ]}
      onActionClick={(): void => {}}
      onStateSelect={(): void => {}}
      secondaryActions={secondaryActions}
      {...overrides}
    />,
  );
};

const getActionGroup: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("group", { name: "Event actions" });
};

let windowOpen: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  windowOpen = jest.spyOn(window, "open").mockImplementation(() => {
    return null;
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the buttons a record's links make", () => {
  test("no channel, no button", () => {
    expect(getOpenInChatActions([])).toEqual([]);
  });

  test("one Slack channel: a link straight to it, saying which channel", () => {
    const [action] = getOpenInChatActions([SLACK_LINK]);

    expect(action).toMatchObject({
      id: "open-in-slack",
      label: "Open in Slack",
      icon: IconProp.Slack,
      href: SLACK_URL,
      tooltip: "#incident-42-checkout",
    });
    expect(action!.menuItems).toBeUndefined();

    // Its click, for a host that renders it as a button: a new tab, no opener.
    action!.onClick();
    expect(windowOpen).toHaveBeenCalledWith(
      SLACK_URL,
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("one Teams channel: a link straight to it", () => {
    const [action] = getOpenInChatActions([TEAMS_LINK]);

    expect(action).toMatchObject({
      id: "open-in-microsoft-teams",
      label: "Open in Microsoft Teams",
      icon: IconProp.MicrosoftTeams,
      href: TEAMS_URL,
      tooltip: "Incident 42",
    });
  });

  test("Slack and Teams: one Open channel menu, each channel under its product's name and logo, Slack first", () => {
    const actions: Array<EventPanelAction> = getOpenInChatActions([
      TEAMS_LINK,
      SLACK_LINK,
      SECOND_SLACK_LINK,
    ]);

    // One button: two as wide as their products' names crowd out the title.
    expect(actions).toHaveLength(1);

    const [action] = actions;

    expect(action).toMatchObject({
      id: "open-channel",
      label: "Open channel",
      icon: IconProp.ChatBubbleLeftRight,
    });
    expect(action!.href).toBeUndefined();
    expect(
      action!.menuItems!.map((item: EventPanelMenuItem) => {
        return [item.label, item.icon];
      }),
    ).toEqual([
      ["Slack · #incident-42-checkout", IconProp.Slack],
      ["Slack · #sre-war-room", IconProp.Slack],
      ["Microsoft Teams · Incident 42", IconProp.MicrosoftTeams],
    ]);

    action!.onClick();
    expect(windowOpen).not.toHaveBeenCalled();

    action!.menuItems![2]!.onClick();
    expect(windowOpen).toHaveBeenCalledWith(
      TEAMS_URL,
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("two Slack channels: one Open in Slack listing both, each opening its own", () => {
    const [slack] = getOpenInChatActions([SLACK_LINK, SECOND_SLACK_LINK]);

    expect(slack!.href).toBeUndefined();
    expect(slack!.tooltip).toBeUndefined();
    expect(
      slack!.menuItems!.map((item: { label: string }) => {
        return item.label;
      }),
    ).toEqual(["#incident-42-checkout", "#sre-war-room"]);

    // The button itself goes nowhere: its menu does.
    slack!.onClick();
    expect(windowOpen).not.toHaveBeenCalled();

    slack!.menuItems![1]!.onClick();
    expect(windowOpen).toHaveBeenCalledWith(
      SECOND_SLACK_URL,
      "_blank",
      "noopener,noreferrer",
    );
  });
});

describe("in the header", () => {
  test("one channel is a link beside the state buttons, opening in a new tab without an opener", () => {
    renderPanel(getOpenInChatActions([SLACK_LINK]));

    const group: HTMLElement = getActionGroup();
    const link: HTMLElement = within(group).getByRole("link", {
      name: "In Slack öffnen",
    });

    expect(link).toHaveAttribute("href", SLACK_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("id", "open-in-slack");

    // After the state buttons, before More actions.
    const resolve: HTMLElement = within(group).getByRole("button", {
      name: "Resolve",
    });
    const more: HTMLElement = within(group).getByRole("button", {
      name: "More actions",
    });
    expect(
      resolve.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      link.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // A link, so the page's own click handler never runs instead of it.
    fireEvent.click(link);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  test("the link names its channel when pointed at", async () => {
    renderPanel(getOpenInChatActions([SLACK_LINK]));

    const link: HTMLElement = screen.getByRole("link", {
      name: "In Slack öffnen",
    });

    await act(async () => {
      fireEvent.mouseEnter(link);
      fireEvent.focus(link);
    });

    expect(
      await screen.findByText("#incident-42-checkout"),
    ).toBeInTheDocument();
  });

  test("several Slack channels: a menu button that lists them", () => {
    renderPanel(getOpenInChatActions([SLACK_LINK, SECOND_SLACK_LINK]));

    const group: HTMLElement = getActionGroup();
    const slackButton: HTMLElement = within(group).getByRole("button", {
      name: "In Slack öffnen",
    });

    expect(slackButton).toHaveAttribute("aria-haspopup", "menu");
    expect(slackButton).toHaveAttribute("data-testid", "open-in-slack");
    expect(
      within(group).queryByRole("link", { name: "In Slack öffnen" }),
    ).toBeNull();

    fireEvent.click(slackButton);

    const menu: HTMLElement = screen.getByRole("menu");
    const choices: Array<HTMLElement> = within(menu).getAllByRole("menuitem");

    expect(
      choices.map((choice: HTMLElement) => {
        return choice.textContent?.trim();
      }),
    ).toEqual(["#incident-42-checkout", "#sre-war-room"]);

    fireEvent.click(choices[1]!);

    expect(windowOpen).toHaveBeenCalledWith(
      SECOND_SLACK_URL,
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("channels in Slack and Teams: one Open channel button whose menu names each product", () => {
    renderPanel(
      getOpenInChatActions([SLACK_LINK, TEAMS_LINK, SECOND_SLACK_LINK]),
    );

    const group: HTMLElement = getActionGroup();

    expect(within(group).queryByRole("link")).toBeNull();
    expect(
      within(group).queryByRole("button", { name: "In Slack öffnen" }),
    ).toBeNull();

    const button: HTMLElement = within(group).getByRole("button", {
      name: "Open channel",
    });

    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("data-testid", "open-channel");

    fireEvent.click(button);

    const choices: Array<HTMLElement> = within(
      screen.getByRole("menu"),
    ).getAllByRole("menuitem");

    expect(
      choices.map((choice: HTMLElement) => {
        return choice.textContent?.trim();
      }),
    ).toEqual([
      "Slack · #incident-42-checkout",
      "Slack · #sre-war-room",
      "Microsoft Teams · Incident 42",
    ]);
    // Each item carries its product's logo.
    for (const choice of choices) {
      expect(choice.querySelector("svg")).not.toBeNull();
    }

    fireEvent.click(choices[2]!);

    expect(windowOpen).toHaveBeenCalledWith(
      TEAMS_URL,
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("a disabled header shows the button but does not open anything", () => {
    renderPanel(getOpenInChatActions([SLACK_LINK]), {
      isDisabled: true,
    });

    expect(screen.queryByRole("link")).toBeNull();

    const slack: HTMLElement = screen.getByRole("button", {
      name: "In Slack öffnen",
    });

    expect(slack).toBeDisabled();
    fireEvent.click(slack);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  test("a disabled header's Open channel does not open its menu", () => {
    renderPanel(getOpenInChatActions([SLACK_LINK, TEAMS_LINK]), {
      isDisabled: true,
    });

    const button: HTMLElement = screen.getByRole("button", {
      name: "Open channel",
    });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  test("a record without channels has no button at all", () => {
    renderPanel(getOpenInChatActions([]));

    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "In Slack öffnen" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open in Microsoft Teams" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Open channel" })).toBeNull();
  });
});

describe("asking the server", () => {
  let requests: Array<{ url: string; headers: unknown }>;
  let answer: (url: string) => HTTPResponse<JSONObject> | HTTPErrorResponse;

  beforeEach(() => {
    requests = [];
    answer = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(200, { links: [] }, {});
    };

    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ tenantid: "project-1" });

    jest.spyOn(API, "get").mockImplementation((async (args: {
      url: URL;
      headers: unknown;
    }) => {
      requests.push({ url: args.url.toString(), headers: args.headers });
      return answer(args.url.toString());
    }) as never);
  });

  const answerWith: (
    links: Array<WorkspaceChannelLink> | Array<unknown>,
  ) => void = (links: Array<WorkspaceChannelLink> | Array<unknown>): void => {
    answer = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        { links: links as unknown as JSONObject["links"] },
        {},
      );
    };
  };

  test("asks at the record's route, with the project", async () => {
    answerWith([SLACK_LINK]);

    const links: Array<WorkspaceChannelLink> = await fetchChannelLinks({
      recordType: WorkspaceChannelRecordType.IncidentEpisode,
      recordId: RECORD_ID,
    });

    expect(links).toEqual([SLACK_LINK]);
    expect(requests).toHaveLength(1);
    expect(
      new globalThis.URL(requests[0]!.url).pathname.endsWith(
        `/workspace-channel-link/incident-episode/${RECORD_ID.toString()}`,
      ),
    ).toBe(true);
    expect(requests[0]!.headers).toEqual({ tenantid: "project-1" });
  });

  test("keeps only links to Slack's and Microsoft's own hosts", async () => {
    answerWith([
      SLACK_LINK,
      {
        workspaceType: WorkspaceType.Slack,
        channelName: "phish",
        url: "https://slack.com.evil.example/app_redirect",
      },
      {
        workspaceType: WorkspaceType.Slack,
        channelName: "js",
        url: "javascript:alert(1)",
      },
    ]);

    expect(
      await fetchChannelLinks({
        recordType: WorkspaceChannelRecordType.Incident,
        recordId: RECORD_ID,
      }),
    ).toEqual([SLACK_LINK]);
  });

  test("an answer that is not a success is an error, not 'no channel'", async () => {
    answer = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(404, { message: "Not found" }, {});
    };

    await expect(
      fetchChannelLinks({
        recordType: WorkspaceChannelRecordType.Incident,
        recordId: RECORD_ID,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});

describe("the page's links", () => {
  let answers: Array<Array<WorkspaceChannelLink> | "fail">;
  let requestedUrls: Array<string>;

  beforeEach(() => {
    answers = [];
    requestedUrls = [];

    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

    jest.spyOn(API, "get").mockImplementation((async (args: { url: URL }) => {
      requestedUrls.push(args.url.toString());
      const next: Array<WorkspaceChannelLink> | "fail" = answers.length
        ? answers.shift()!
        : [];

      if (next === "fail") {
        return new HTTPErrorResponse(500, { message: "Server error" }, {});
      }

      return new HTTPResponse<JSONObject>(
        200,
        { links: next as unknown as JSONObject["links"] },
        {},
      );
    }) as never);
  });

  const flush: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test("are the record's links once they load, and none before", async () => {
    answers.push([SLACK_LINK, TEAMS_LINK]);

    const { result } = renderHook(() => {
      return useRecordChannelLinks({
        recordType: WorkspaceChannelRecordType.Incident,
        recordId: RECORD_ID,
      });
    });

    expect(result.current).toEqual([]);

    await flush();

    expect(result.current).toEqual([SLACK_LINK, TEAMS_LINK]);
    expect(requestedUrls).toHaveLength(1);
  });

  test("a failure hides the buttons rather than breaking the header", async () => {
    answers.push("fail");

    const { result } = renderHook(() => {
      return useRecordChannelLinks({
        recordType: WorkspaceChannelRecordType.Alert,
        recordId: RECORD_ID,
      });
    });

    await flush();

    expect(result.current).toEqual([]);
  });

  test("moving to another record never shows the last record's channels", async () => {
    answers.push([SLACK_LINK]);

    const { result, rerender } = renderHook(
      (props: { recordId: ObjectID }) => {
        return useRecordChannelLinks({
          recordType: WorkspaceChannelRecordType.Incident,
          recordId: props.recordId,
        });
      },
      { initialProps: { recordId: RECORD_ID } },
    );

    await flush();
    expect(result.current).toEqual([SLACK_LINK]);

    answers.push([TEAMS_LINK]);
    rerender({ recordId: OTHER_RECORD_ID });

    // Before the other record's answer: nothing, not the first record's link.
    expect(result.current).toEqual([]);

    await flush();
    expect(result.current).toEqual([TEAMS_LINK]);
    expect(requestedUrls[1]).toContain(OTHER_RECORD_ID.toString());
  });

  test("a new record looks again until its channel arrives, then stops", async () => {
    jest.useFakeTimers();
    answers.push([], [], [SLACK_LINK]);

    const { result } = renderHook(() => {
      return useRecordChannelLinks({
        recordType: WorkspaceChannelRecordType.Incident,
        recordId: RECORD_ID,
        recordStartedAt: new Date(Date.now() - 2000),
      });
    });

    await flush();
    expect(requestedUrls).toHaveLength(1);
    expect(result.current).toEqual([]);

    await act(async () => {
      jest.advanceTimersByTime(CHANNEL_LINK_RECHECK_DELAYS_MS[0]!);
    });
    await flush();
    expect(requestedUrls).toHaveLength(2);

    await act(async () => {
      jest.advanceTimersByTime(CHANNEL_LINK_RECHECK_DELAYS_MS[1]!);
    });
    await flush();
    expect(requestedUrls).toHaveLength(3);
    expect(result.current).toEqual([SLACK_LINK]);

    // It has its channel: no more asking.
    await act(async () => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });
    await flush();
    expect(requestedUrls).toHaveLength(3);
  });

  test("an older record without a channel is asked about once", async () => {
    jest.useFakeTimers();

    renderHook(() => {
      return useRecordChannelLinks({
        recordType: WorkspaceChannelRecordType.ScheduledMaintenance,
        recordId: RECORD_ID,
        recordStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });
    });

    await flush();

    await act(async () => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });
    await flush();

    expect(requestedUrls).toHaveLength(1);
  });

  test("a new record that never gets a channel stops asking after the last wait", async () => {
    jest.useFakeTimers();

    renderHook(() => {
      return useRecordChannelLinks({
        recordType: WorkspaceChannelRecordType.Incident,
        recordId: RECORD_ID,
        recordStartedAt: new Date(Date.now() - 1000),
      });
    });

    await flush();

    for (const delay of CHANNEL_LINK_RECHECK_DELAYS_MS) {
      await act(async () => {
        jest.advanceTimersByTime(delay);
      });
      await flush();
    }

    expect(requestedUrls).toHaveLength(
      1 + CHANNEL_LINK_RECHECK_DELAYS_MS.length,
    );

    await act(async () => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });
    await flush();

    expect(requestedUrls).toHaveLength(
      1 + CHANNEL_LINK_RECHECK_DELAYS_MS.length,
    );
  });

  test("leaving the page stops the asking", async () => {
    jest.useFakeTimers();

    const { unmount } = renderHook(() => {
      return useRecordChannelLinks({
        recordType: WorkspaceChannelRecordType.Incident,
        recordId: RECORD_ID,
        recordStartedAt: new Date(Date.now() - 1000),
      });
    });

    await flush();
    unmount();

    await act(async () => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(requestedUrls).toHaveLength(1);
  });
});
