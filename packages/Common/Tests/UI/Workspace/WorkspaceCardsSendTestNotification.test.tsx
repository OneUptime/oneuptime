import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import * as React from "react";
import { JSONObject } from "../../../Types/JSON";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";

/*
 * Integration tests for the "Send Test" button as it is wired into the three
 * workspace cards on Project Settings > Workspace:
 *
 *   - Slack Channels             -> POST /slack/channels/test           { channelId }
 *   - Microsoft Teams Channels   -> POST /microsoft-teams/channels/test { teamId, channelId }
 *   - Microsoft Teams Chats      -> POST /microsoft-teams/chats/test    { chatId }
 *
 * The shared SendTestNotificationButton has its own unit tests. What can only
 * be caught here is the wiring each card does: which route a row posts to,
 * which ids go in the body (and that nothing else does), what the button is
 * called for a screen reader, that every row gets exactly one button, that a
 * row's result stays with that row, and the row layout each card owns (the
 * row may wrap and the name keeps a minimum width, so on a phone the Send
 * Test control drops onto its own line instead of squeezing the name out).
 *
 * It also covers what each card does around a send:
 *
 *   - While any test is in flight, the controls that reload the list are
 *     disabled: Refresh on every card, and the team dropdown on the Teams
 *     channels card. A reload unmounts the rows, and a row's result would be
 *     lost with it. They come back once every send has settled, whether it
 *     succeeded or failed.
 *   - On the Teams channels card, channel loads that finish out of order.
 *     Only the most recent load - for another team, or a second load of the
 *     same team - may fill the list, end the loading state or show an error.
 *
 * What these tests cannot see: the Teams channels card keys each row by team
 * AND channel id, and posts the team its list was loaded for (channelsTeamId)
 * rather than the dropdown's current team. Whenever rows are on screen those
 * two teams are the same, because every path that changes the selected team
 * also replaces the list with the loader (which unmounts every row). So the
 * tests would pass just as well with a key of the channel id alone, or with
 * the dropdown's team in the body. Both are defence in depth that nothing in
 * the DOM can observe; the posted teamId assertions below prove the wiring,
 * not that choice.
 *
 * Only the network edge is mocked. API.get answers by URL from per-test
 * fixtures and API.post records every call it is handed, so the assertions are
 * on exactly what would have gone over the wire. Everything else - Card,
 * Button, ConfirmModal, and the real react-select backed Dropdown - is the
 * production component.
 *
 * The team Dropdown is deliberately NOT stubbed. It can be driven in jsdom the
 * same way Tests/UI/Components/Dropdown.test.tsx drives it (ArrowDown on the
 * combobox opens the menu, clicking a role="option" selects it), and keeping it
 * real means the test also proves the card hands the Dropdown's onChange value
 * through to the teamId it posts.
 */

interface ApiRequestOptions {
  url: { toString: () => string };
  data?: JSONObject | undefined;
  headers?: JSONObject | undefined;
}

interface RecordedPost {
  url: string;
  data: JSONObject;
  headers: JSONObject;
}

type ApiGetHandler = (url: string) => Promise<unknown>;
type ApiPostHandler = (request: RecordedPost) => Promise<unknown>;

interface Fixtures {
  slackChannels: Array<JSONObject>;
  teams: Array<JSONObject>;
  channelsByTeam: { [teamId: string]: Array<JSONObject> };
  chats: Array<JSONObject>;
}

const COMMON_HEADERS: JSONObject = {
  tenantid: "project-send-test-notification",
};

const GENERIC_ERROR_MESSAGE: string = "Something went wrong.";

let fixtures: Fixtures = {
  slackChannels: [],
  teams: [],
  channelsByTeam: {},
  chats: [],
};

let getRequests: Array<string> = [];
let postRequests: Array<RecordedPost> = [];

async function answerGetFromFixtures(url: string): Promise<unknown> {
  const channelsMatch: RegExpMatchArray | null = url.match(
    /\/microsoft-teams\/channels\?teamId=([^&]*)$/,
  );

  if (channelsMatch) {
    const teamId: string = decodeURIComponent(channelsMatch[1] || "");
    return { data: { channels: fixtures.channelsByTeam[teamId] || [] } };
  }

  if (url.endsWith("/microsoft-teams/teams")) {
    return { data: { teams: fixtures.teams } };
  }

  if (url.endsWith("/microsoft-teams/chats")) {
    return { data: { chats: fixtures.chats } };
  }

  if (url.endsWith("/slack/channels")) {
    return { data: { channels: fixtures.slackChannels } };
  }

  throw new Error(`Unexpected GET in test: ${url}`);
}

async function answerPostWithSuccess(): Promise<unknown> {
  /*
   * A plain object is not an HTTPErrorResponse, so the button treats it as
   * the empty success response the routes send.
   */
  return { data: {} };
}

let apiGetHandler: ApiGetHandler = answerGetFromFixtures;
let apiPostHandler: ApiPostHandler = answerPostWithSuccess;

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (options: ApiRequestOptions): Promise<unknown> => {
        const url: string = options.url.toString();
        getRequests.push(url);
        return apiGetHandler(url);
      },
      post: (options: ApiRequestOptions): Promise<unknown> => {
        const request: RecordedPost = {
          url: options.url.toString(),
          /*
           * Snapshot the body as it was when the request went out. The card
           * builds it inline on each render, so holding the live reference
           * could hide a body that was wrong at send time.
           */
          data: JSON.parse(JSON.stringify(options.data || {})) as JSONObject,
          headers: { ...(options.headers || {}) },
        };
        postRequests.push(request);
        return apiPostHandler(request);
      },
      getFriendlyErrorMessage: (err: unknown): string => {
        /*
         * Error and HTTPErrorResponse both expose `message`; surface it so a
         * test can see its own error text reach the modal.
         */
        if (
          err &&
          typeof err === "object" &&
          typeof (err as { message?: unknown }).message === "string" &&
          (err as { message: string }).message
        ) {
          return (err as { message: string }).message;
        }

        return GENERIC_ERROR_MESSAGE;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): JSONObject => {
        return { ...COMMON_HEADERS };
      },
    },
  };
});

import SlackChannelsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slack/SlackChannelsCard";
import MicrosoftTeamsChannelsCard from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChannelsCard";
import MicrosoftTeamsChatsCard from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChatsCard";

const SEND_TEST_NAME: RegExp = /^Send test notification to /;

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

function createDeferred(): Deferred {
  const deferred: Partial<Deferred> = {};

  deferred.promise = new Promise<unknown>(
    (
      resolve: (value: unknown) => void,
      reject: (reason: unknown) => void,
    ): void => {
      deferred.resolve = resolve;
      deferred.reject = reject;
    },
  );

  return deferred as Deferred;
}

async function renderCard(element: React.ReactElement): Promise<void> {
  // Every card fetches its list on mount; settle that inside act.
  await act(async (): Promise<void> => {
    render(element);
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(element);
  });
}

function getRows(): Array<HTMLElement> {
  return within(screen.getByRole("list")).getAllByRole("listitem");
}

function getRow(name: string): HTMLElement {
  const row: HTMLElement | undefined = getRows().find(
    (listItem: HTMLElement) => {
      return within(listItem).queryByText(name) !== null;
    },
  );

  if (!row) {
    throw new Error(`No row named "${name}" is rendered.`);
  }

  return row;
}

function getSendTestButton(row: HTMLElement): HTMLElement {
  return within(row).getByRole("button", { name: SEND_TEST_NAME });
}

function querySendTestButtons(): Array<HTMLElement> {
  return screen.queryAllByRole("button", { name: SEND_TEST_NAME });
}

type RowResult = "sent" | "failed";

function getRowStatus(row: HTMLElement): HTMLElement {
  /*
   * Every row has exactly one live region, rendered even while idle: screen
   * readers often skip a live region that appears already filled, so only
   * its content changes when a result arrives.
   */
  return within(row).getByRole("status");
}

async function findRowResult(
  rowName: string,
  result: RowResult,
): Promise<HTMLElement> {
  const resultElement: HTMLElement = await within(getRow(rowName)).findByTestId(
    `send-test-notification-${result}`,
  );

  // The result has to be inside the live region to be announced.
  expect(getRowStatus(getRow(rowName))).toContainElement(resultElement);

  return resultElement;
}

function expectRowIsIdle(row: HTMLElement): void {
  expect(within(row).getAllByRole("status")).toHaveLength(1);
  expect(getRowStatus(row)).toBeEmptyDOMElement();
  expect(
    within(row).queryByTestId("send-test-notification-sent"),
  ).not.toBeInTheDocument();
  expect(
    within(row).queryByTestId("send-test-notification-failed"),
  ).not.toBeInTheDocument();
  expect(getSendTestButton(row)).toBeEnabled();
}

function expectEveryRowIsIdle(): void {
  for (const row of getRows()) {
    expectRowIsIdle(row);
  }
}

function expectRowWrapsOnNarrowScreens(rowName: string): void {
  const row: HTMLElement = getRow(rowName);

  /*
   * flex-wrap plus a floor on the name block is what lets the Send Test
   * control drop onto its own line on a phone. With min-w-0 the name was
   * squeezed to nothing instead.
   */
  expect(row).toHaveClass("flex", "flex-wrap", "items-center");

  const nameElement: HTMLElement = within(row).getByText(rowName);
  const nameBlock: HTMLElement | null = nameElement.parentElement;

  // Long names still ellipsize inside the floor.
  expect(nameElement).toHaveClass("truncate");
  expect(nameBlock).toHaveClass("min-w-[8rem]", "flex-1");
  expect(nameBlock).not.toHaveClass("min-w-0");

  /*
   * The control must be a direct flex item of the row: its ml-auto is what
   * keeps it right-aligned once it has wrapped.
   */
  const control: Element | null = row.lastElementChild;

  expect(control).not.toBeNull();
  expect(control!.contains(getSendTestButton(row))).toBe(true);
  expect(control).toHaveClass("ml-auto");
}

function expectExactlyOneSendTestButtonPerRow(): void {
  const rows: Array<HTMLElement> = getRows();

  expect(rows.length).toBeGreaterThan(0);

  for (const row of rows) {
    expect(
      within(row).getAllByRole("button", { name: SEND_TEST_NAME }),
    ).toHaveLength(1);
    expect(
      within(row).getAllByTestId("send-test-notification-button"),
    ).toHaveLength(1);
    expect(within(row).getAllByText("Send Test")).toHaveLength(1);
  }

  expect(querySendTestButtons()).toHaveLength(rows.length);
}

function expectButtonIsLastInRow(row: HTMLElement): void {
  const lastChild: Element | null = row.lastElementChild;

  expect(lastChild).not.toBeNull();
  expect(lastChild!.contains(getSendTestButton(row))).toBe(true);
}

async function selectTeam(teamName: string): Promise<void> {
  const combobox: HTMLElement = screen.getByRole("combobox");

  await act(async (): Promise<void> => {
    fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
  });

  const option: HTMLElement = await screen.findByRole("option", {
    name: teamName,
  });

  await click(option);
}

async function settlePendingWork(): Promise<void> {
  /*
   * A response that is correctly ignored changes nothing, so there is no DOM
   * change to wait for. Let every queued continuation run before asserting
   * that nothing happened.
   */
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
}

/*
 * Holds every Send Test POST open until the test settles it. The returned
 * array fills in click order.
 */
function holdEveryPost(): Array<Deferred> {
  const held: Array<Deferred> = [];

  apiPostHandler = (): Promise<unknown> => {
    const deferred: Deferred = createDeferred();
    held.push(deferred);
    return deferred.promise;
  };

  return held;
}

type GetListControlsFunction = () => Array<HTMLElement>;

interface SendLockCase {
  /*
   * The card's controls that reload its list. Looked up again on every call:
   * Button wraps a disabled button that has a tooltip in an extra span, so
   * the element can be replaced between renders.
   */
  getListControls: GetListControlsFunction;
  // Two rows of the loaded list.
  rowNames: [string, string];
}

function expectListControlsEnabled(
  getListControls: GetListControlsFunction,
  isEnabled: boolean,
): void {
  const controls: Array<HTMLElement> = getListControls();

  expect(controls.length).toBeGreaterThan(0);

  for (const control of controls) {
    if (isEnabled) {
      expect(control).toBeEnabled();
    } else {
      expect(control).toBeDisabled();
    }
  }
}

async function expectListControlsLockedUntilSendSucceeds(
  testCase: SendLockCase,
): Promise<void> {
  const held: Array<Deferred> = holdEveryPost();
  const rowName: string = testCase.rowNames[0];

  expectListControlsEnabled(testCase.getListControls, true);

  await click(getSendTestButton(getRow(rowName)));

  expect(held).toHaveLength(1);
  expectListControlsEnabled(testCase.getListControls, false);

  // Trying the locked controls anyway neither reloads nor opens anything.
  const getCountBeforeTrying: number = getRequests.length;

  for (const control of testCase.getListControls()) {
    await click(control);
    await act(async (): Promise<void> => {
      fireEvent.keyDown(control, { key: "ArrowDown", code: "ArrowDown" });
    });
  }

  expect(getRequests).toHaveLength(getCountBeforeTrying);
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  // Still the same list, with the send still in flight on its row.
  expect(getSendTestButton(getRow(rowName))).toBeDisabled();

  await act(async (): Promise<void> => {
    held[0]!.resolve({ data: {} });
  });

  await findRowResult(rowName, "sent");
  expectListControlsEnabled(testCase.getListControls, true);
}

async function expectListControlsLockedUntilSendFails(
  testCase: SendLockCase,
): Promise<void> {
  const held: Array<Deferred> = holdEveryPost();
  const rowName: string = testCase.rowNames[0];

  await click(getSendTestButton(getRow(rowName)));

  expect(held).toHaveLength(1);
  expectListControlsEnabled(testCase.getListControls, false);

  await act(async (): Promise<void> => {
    held[0]!.reject(new Error("not_in_channel"));
  });

  await findRowResult(rowName, "failed");

  /*
   * Unlocked as soon as the send settles, while the failure dialog is still
   * open - not only once the dialog is closed.
   */
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expectListControlsEnabled(testCase.getListControls, true);
}

async function expectListControlsLockedUntilEverySendSettles(
  testCase: SendLockCase,
): Promise<void> {
  const held: Array<Deferred> = holdEveryPost();
  const firstRowName: string = testCase.rowNames[0];
  const secondRowName: string = testCase.rowNames[1];

  await click(getSendTestButton(getRow(firstRowName)));
  await click(getSendTestButton(getRow(secondRowName)));

  expect(held).toHaveLength(2);
  expect(postRequests).toHaveLength(2);
  expectListControlsEnabled(testCase.getListControls, false);

  /*
   * The later click settles first, so the lock has to be a count of sends in
   * flight rather than a flag that follows the most recent one.
   */
  await act(async (): Promise<void> => {
    held[1]!.resolve({ data: {} });
  });

  await findRowResult(secondRowName, "sent");
  expect(getSendTestButton(getRow(firstRowName))).toBeDisabled();
  expectListControlsEnabled(testCase.getListControls, false);

  await act(async (): Promise<void> => {
    held[0]!.reject(new Error("channel_not_found"));
  });

  await findRowResult(firstRowName, "failed");
  expectListControlsEnabled(testCase.getListControls, true);
}

beforeEach(() => {
  fixtures = {
    slackChannels: [],
    teams: [],
    channelsByTeam: {},
    chats: [],
  };
  getRequests = [];
  postRequests = [];
  apiGetHandler = answerGetFromFixtures;
  apiPostHandler = answerPostWithSuccess;
});

describe("SlackChannelsCard Send Test", () => {
  const SLACK_CHANNELS: Array<JSONObject> = [
    { id: "C0ALERTS", name: "alerts" },
    { id: "C0ONCALL", name: "on-call" },
    { id: "C0RELEASES", name: "releases" },
  ];

  async function renderSlackCard(
    channels: Array<JSONObject> = SLACK_CHANNELS,
  ): Promise<void> {
    fixtures.slackChannels = channels;
    await renderCard(<SlackChannelsCard />);
  }

  async function waitForSlackChannels(count: number): Promise<void> {
    await screen.findByText(`Channels (${count})`);
  }

  test("the card description tells the user about Send Test and keeps the existing copy", async () => {
    await renderSlackCard();
    await waitForSlackChannels(3);

    const description: HTMLElement = screen.getByTestId("card-description");

    expect(description).toHaveTextContent(
      "Use Send Test to confirm OneUptime can post to a channel.",
    );
    expect(description).toHaveTextContent(
      "Channels OneUptime can see in your Slack workspace.",
    );
    expect(description).toHaveTextContent(
      "Use these names when a notification rule posts to an existing channel.",
    );
  });

  test("every channel row has exactly one Send Test button, placed last in the row", async () => {
    await renderSlackCard();
    await waitForSlackChannels(3);

    expect(getRows()).toHaveLength(3);
    expectExactlyOneSendTestButtonPerRow();

    for (const name of ["alerts", "on-call", "releases"]) {
      expectButtonIsLastInRow(getRow(name));
      expectRowIsIdle(getRow(name));
    }
  });

  test("the button's accessible name names the channel with a leading #", async () => {
    await renderSlackCard();
    await waitForSlackChannels(3);

    expect(getSendTestButton(getRow("alerts"))).toHaveAccessibleName(
      "Send test notification to #alerts",
    );
    expect(getSendTestButton(getRow("on-call"))).toHaveAccessibleName(
      "Send test notification to #on-call",
    );
    expect(getSendTestButton(getRow("releases"))).toHaveAccessibleName(
      "Send test notification to #releases",
    );
  });

  test("loading the card posts nothing: a test is only sent on click", async () => {
    await renderSlackCard();
    await waitForSlackChannels(3);

    expect(postRequests).toHaveLength(0);
    expect(
      getRequests.filter((url: string) => {
        return url.endsWith("/slack/channels");
      }),
    ).toHaveLength(1);
  });

  test("clicking Send Test posts only { channelId } to /slack/channels/test with the project headers", async () => {
    await renderSlackCard();
    await waitForSlackChannels(3);

    await click(getSendTestButton(getRow("on-call")));

    expect(postRequests).toHaveLength(1);
    expect(postRequests[0]!.url).toMatch(/\/slack\/channels\/test$/);
    expect(postRequests[0]!.data).toEqual({ channelId: "C0ONCALL" });
    expect(postRequests[0]!.headers).toEqual(COMMON_HEADERS);
  });

  test("each row posts its own channel id", async () => {
    await renderSlackCard();
    await waitForSlackChannels(3);

    await click(getSendTestButton(getRow("releases")));
    await click(getSendTestButton(getRow("alerts")));
    await click(getSendTestButton(getRow("on-call")));

    expect(
      postRequests.map((request: RecordedPost) => {
        return request.data;
      }),
    ).toEqual([
      { channelId: "C0RELEASES" },
      { channelId: "C0ALERTS" },
      { channelId: "C0ONCALL" },
    ]);

    for (const request of postRequests) {
      expect(request.url).toMatch(/\/slack\/channels\/test$/);
    }
  });

  test("a successful send marks only that row as Sent, with a tooltip naming the channel and Slack", async () => {
    await renderSlackCard();
    await waitForSlackChannels(3);

    await click(getSendTestButton(getRow("alerts")));

    const sent: HTMLElement = await findRowResult("alerts", "sent");

    expect(sent).toHaveTextContent("Sent");
    expect(sent).toHaveAttribute(
      "title",
      "Test notification sent to #alerts. Check Slack to confirm it arrived.",
    );
    expect(getSendTestButton(getRow("alerts"))).toBeEnabled();

    expectRowIsIdle(getRow("on-call"));
    expectRowIsIdle(getRow("releases"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("clicking one row does not change the other rows while the send is in flight", async () => {
    const deferred: Deferred = createDeferred();
    apiPostHandler = (): Promise<unknown> => {
      return deferred.promise;
    };

    await renderSlackCard();
    await waitForSlackChannels(3);

    await click(getSendTestButton(getRow("alerts")));

    // The click sends straight away: no confirmation dialog in between.
    expect(postRequests).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    expect(getSendTestButton(getRow("alerts"))).toBeDisabled();
    expectRowIsIdle(getRow("on-call"));
    expectRowIsIdle(getRow("releases"));

    await act(async (): Promise<void> => {
      deferred.resolve({ data: {} });
    });

    await waitFor(() => {
      expect(getRowStatus(getRow("alerts"))).toHaveTextContent("Sent");
    });
    expectRowIsIdle(getRow("on-call"));
    expectRowIsIdle(getRow("releases"));
  });

  test("a second click while the send is in flight does not post again", async () => {
    const deferred: Deferred = createDeferred();
    apiPostHandler = (): Promise<unknown> => {
      return deferred.promise;
    };

    await renderSlackCard();
    await waitForSlackChannels(3);

    const button: HTMLElement = getSendTestButton(getRow("alerts"));

    await click(button);
    await click(getSendTestButton(getRow("alerts")));

    expect(postRequests).toHaveLength(1);

    await act(async (): Promise<void> => {
      deferred.resolve({ data: {} });
    });

    await waitFor(() => {
      expect(getRowStatus(getRow("alerts"))).toHaveTextContent("Sent");
    });
    expect(postRequests).toHaveLength(1);
  });

  test("a failing send opens the failure modal with the server's error and marks the row Failed", async () => {
    const errorMessage: string =
      "Could not send the test notification to #alerts. not_in_channel";

    apiPostHandler = async (): Promise<unknown> => {
      throw new Error(errorMessage);
    };

    await renderSlackCard();
    await waitForSlackChannels(3);

    await click(getSendTestButton(getRow("alerts")));

    const dialog: HTMLElement = await screen.findByRole("dialog");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Test Notification Failed",
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      "OneUptime could not send a test notification to #alerts in Slack.",
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(errorMessage);

    const failed: HTMLElement = await findRowResult("alerts", "failed");
    expect(failed).toHaveTextContent("Failed");
    expect(failed).toHaveAttribute("title", errorMessage);

    expectRowIsIdle(getRow("on-call"));
    expectRowIsIdle(getRow("releases"));
  });

  test("closing the failure modal keeps the row's Failed badge and a retry that succeeds turns it into Sent", async () => {
    let shouldFail: boolean = true;

    apiPostHandler = async (): Promise<unknown> => {
      if (shouldFail) {
        throw new Error("channel_not_found");
      }

      return { data: {} };
    };

    await renderSlackCard();
    await waitForSlackChannels(3);

    await click(getSendTestButton(getRow("releases")));
    await screen.findByRole("dialog");

    await click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(getRowStatus(getRow("releases"))).toHaveTextContent("Failed");

    shouldFail = false;
    await click(getSendTestButton(getRow("releases")));

    await waitFor(() => {
      expect(getRowStatus(getRow("releases"))).toHaveTextContent("Sent");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(postRequests).toHaveLength(2);
    expect(postRequests[1]!.data).toEqual({ channelId: "C0RELEASES" });
  });

  test("channels the card drops for a missing id or name get no Send Test button", async () => {
    await renderSlackCard([
      { id: "C0ALERTS", name: "alerts" },
      { id: "", name: "no-id" },
      { id: "C0NONAME", name: "" },
    ]);
    await waitForSlackChannels(1);

    expect(getRows()).toHaveLength(1);
    expect(querySendTestButtons()).toHaveLength(1);
    expect(querySendTestButtons()[0]).toHaveAccessibleName(
      "Send test notification to #alerts",
    );
  });

  test("an empty channel list renders no Send Test buttons", async () => {
    await renderSlackCard([]);

    await screen.findByText("No channels found");

    expect(querySendTestButtons()).toHaveLength(0);
    expect(
      screen.queryByTestId("send-test-notification-button"),
    ).not.toBeInTheDocument();
  });

  test("a channel list that fails to load renders no Send Test buttons", async () => {
    apiGetHandler = async (): Promise<unknown> => {
      throw new Error("Slack is not connected.");
    };

    await renderSlackCard();

    await screen.findByText("Slack is not connected.");

    expect(querySendTestButtons()).toHaveLength(0);
  });

  test("Refresh Channels re-reads the list and never posts a test", async () => {
    await renderSlackCard();
    await waitForSlackChannels(3);

    await click(screen.getByRole("button", { name: /Refresh Channels/i }));
    await waitForSlackChannels(3);

    expect(
      getRequests.filter((url: string) => {
        return url.endsWith("/slack/channels");
      }),
    ).toHaveLength(2);
    expect(postRequests).toHaveLength(0);
    expectExactlyOneSendTestButtonPerRow();
  });

  test("channel rows can wrap on a narrow screen: the row is flex-wrap and the name keeps an 8rem floor", async () => {
    await renderSlackCard();
    await waitForSlackChannels(3);

    for (const name of ["alerts", "on-call", "releases"]) {
      expectRowWrapsOnNarrowScreens(name);
    }
  });

  describe("while a Send Test is in flight", () => {
    const slackSendLockCase: SendLockCase = {
      getListControls: (): Array<HTMLElement> => {
        return [screen.getByRole("button", { name: /Refresh Channels/i })];
      },
      rowNames: ["alerts", "releases"],
    };

    test("Refresh Channels is disabled, does not reload when clicked, and is re-enabled once the send succeeds", async () => {
      await renderSlackCard();
      await waitForSlackChannels(3);

      await expectListControlsLockedUntilSendSucceeds(slackSendLockCase);
    });

    test("Refresh Channels is re-enabled once the send fails", async () => {
      await renderSlackCard();
      await waitForSlackChannels(3);

      await expectListControlsLockedUntilSendFails(slackSendLockCase);
    });

    test("with two sends in flight, Refresh Channels stays disabled after the first settles and is re-enabled after the second", async () => {
      await renderSlackCard();
      await waitForSlackChannels(3);

      await expectListControlsLockedUntilEverySendSettles(slackSendLockCase);
    });
  });
});

describe("MicrosoftTeamsChannelsCard Send Test", () => {
  /*
   * Deliberately out of alphabetical order: the card sorts teams by name and
   * auto-selects the first, so "Alpha Team" (team-alpha) is the initial team
   * even though "Beta Team" comes first from the API.
   *
   * Both teams also return a channel with the SAME id ("General"). After a
   * team switch that row looks the same as before, so a stale result on it,
   * or a body that still names the old team, would be easy to miss. The row
   * starts idle because the loader unmounts the list during the reload; see
   * the header comment for what that means for the row key.
   */
  const TEAMS: Array<JSONObject> = [
    { id: "team-beta", name: "Beta Team" },
    { id: "team-alpha", name: "Alpha Team" },
  ];

  const CHANNELS_BY_TEAM: { [teamId: string]: Array<JSONObject> } = {
    "team-alpha": [
      { id: "19:shared@thread.tacv2", name: "General" },
      { id: "19:alpha-ops@thread.tacv2", name: "Alpha Ops" },
    ],
    "team-beta": [
      { id: "19:shared@thread.tacv2", name: "General" },
      { id: "19:beta-oncall@thread.tacv2", name: "Beta On-Call" },
      { id: "19:beta-releases@thread.tacv2", name: "Beta Releases" },
    ],
  };

  async function renderTeamsChannelsCard(options?: {
    teams?: Array<JSONObject>;
    channelsByTeam?: { [teamId: string]: Array<JSONObject> };
  }): Promise<void> {
    fixtures.teams = options?.teams || TEAMS;
    fixtures.channelsByTeam = options?.channelsByTeam || CHANNELS_BY_TEAM;
    await renderCard(<MicrosoftTeamsChannelsCard />);
  }

  async function waitForTeamsChannels(count: number): Promise<void> {
    await screen.findByText(`Channels (${count})`);
  }

  test("the card description tells the user about Send Test and keeps the existing copy", async () => {
    await renderTeamsChannelsCard();
    await waitForTeamsChannels(2);

    const description: HTMLElement = screen.getByTestId("card-description");

    expect(description).toHaveTextContent(
      "Use Send Test to confirm OneUptime can post to a channel.",
    );
    expect(description).toHaveTextContent(
      "Browse the channels OneUptime can see in your teams.",
    );
    expect(description).toHaveTextContent(
      "Use these names when a notification rule posts to an existing channel.",
    );
  });

  test("every channel row of the auto-selected team has exactly one Send Test button, placed last in the row", async () => {
    await renderTeamsChannelsCard();
    await waitForTeamsChannels(2);

    expect(getRows()).toHaveLength(2);
    expectExactlyOneSendTestButtonPerRow();

    for (const name of ["General", "Alpha Ops"]) {
      expectButtonIsLastInRow(getRow(name));
      expectRowIsIdle(getRow(name));
    }
  });

  test("the button's accessible name names the channel (without a Slack-style #)", async () => {
    await renderTeamsChannelsCard();
    await waitForTeamsChannels(2);

    expect(getSendTestButton(getRow("General"))).toHaveAccessibleName(
      "Send test notification to General",
    );
    expect(getSendTestButton(getRow("Alpha Ops"))).toHaveAccessibleName(
      "Send test notification to Alpha Ops",
    );
  });

  test("loading teams and channels posts nothing", async () => {
    await renderTeamsChannelsCard();
    await waitForTeamsChannels(2);

    expect(postRequests).toHaveLength(0);
  });

  test("clicking Send Test posts { teamId, channelId } for the selected team to /microsoft-teams/channels/test", async () => {
    await renderTeamsChannelsCard();
    await waitForTeamsChannels(2);

    await click(getSendTestButton(getRow("Alpha Ops")));

    expect(postRequests).toHaveLength(1);
    expect(postRequests[0]!.url).toMatch(/\/microsoft-teams\/channels\/test$/);
    expect(postRequests[0]!.data).toEqual({
      teamId: "team-alpha",
      channelId: "19:alpha-ops@thread.tacv2",
    });
    expect(postRequests[0]!.headers).toEqual(COMMON_HEADERS);
  });

  test("a successful send marks only that row as Sent, with a tooltip naming the channel and Microsoft Teams", async () => {
    await renderTeamsChannelsCard();
    await waitForTeamsChannels(2);

    await click(getSendTestButton(getRow("General")));

    const sent: HTMLElement = await findRowResult("General", "sent");

    expect(sent).toHaveTextContent("Sent");
    expect(sent).toHaveAttribute(
      "title",
      "Test notification sent to General. Check Microsoft Teams to confirm it arrived.",
    );
    expectRowIsIdle(getRow("Alpha Ops"));
  });

  test("after switching team the reloaded rows start idle and post the new teamId, including the channel id both teams share", async () => {
    await renderTeamsChannelsCard();
    await waitForTeamsChannels(2);

    await click(getSendTestButton(getRow("General")));

    await waitFor(() => {
      expect(getRowStatus(getRow("General"))).toHaveTextContent("Sent");
    });
    expect(postRequests[0]!.data).toEqual({
      teamId: "team-alpha",
      channelId: "19:shared@thread.tacv2",
    });

    await selectTeam("Beta Team");
    await waitForTeamsChannels(3);

    expect(
      getRequests.some((url: string) => {
        return url.endsWith("/microsoft-teams/channels?teamId=team-beta");
      }),
    ).toBe(true);

    /*
     * Same channel id, new team: the row starts idle. The loader replaced the
     * list while Beta's channels loaded, so every row was remounted.
     */
    expectRowIsIdle(getRow("General"));
    expect(
      screen.queryByTestId("send-test-notification-sent"),
    ).not.toBeInTheDocument();
    expectEveryRowIsIdle();
    expectExactlyOneSendTestButtonPerRow();

    await click(getSendTestButton(getRow("General")));
    await click(getSendTestButton(getRow("Beta On-Call")));

    expect(postRequests).toHaveLength(3);
    expect(postRequests[1]!.data).toEqual({
      teamId: "team-beta",
      channelId: "19:shared@thread.tacv2",
    });
    expect(postRequests[2]!.data).toEqual({
      teamId: "team-beta",
      channelId: "19:beta-oncall@thread.tacv2",
    });
    for (const request of postRequests) {
      expect(request.url).toMatch(/\/microsoft-teams\/channels\/test$/);
    }
  });

  test("switching back to the first team reloads its rows idle and posts the first team again", async () => {
    await renderTeamsChannelsCard();
    await waitForTeamsChannels(2);

    await click(getSendTestButton(getRow("Alpha Ops")));
    await waitFor(() => {
      expect(getRowStatus(getRow("Alpha Ops"))).toHaveTextContent("Sent");
    });

    await selectTeam("Beta Team");
    await waitForTeamsChannels(3);

    await click(getSendTestButton(getRow("Beta Releases")));
    await waitFor(() => {
      expect(getRowStatus(getRow("Beta Releases"))).toHaveTextContent("Sent");
    });

    await selectTeam("Alpha Team");
    await waitForTeamsChannels(2);

    expectRowIsIdle(getRow("Alpha Ops"));
    expectRowIsIdle(getRow("General"));
    expect(
      screen.queryByTestId("send-test-notification-sent"),
    ).not.toBeInTheDocument();

    await click(getSendTestButton(getRow("General")));

    expect(postRequests[postRequests.length - 1]!.data).toEqual({
      teamId: "team-alpha",
      channelId: "19:shared@thread.tacv2",
    });
  });

  test("clicking one row does not change the other rows while the send is in flight", async () => {
    const deferred: Deferred = createDeferred();
    apiPostHandler = (): Promise<unknown> => {
      return deferred.promise;
    };

    await renderTeamsChannelsCard();
    await waitForTeamsChannels(2);

    await click(getSendTestButton(getRow("Alpha Ops")));

    expect(getSendTestButton(getRow("Alpha Ops"))).toBeDisabled();
    expectRowIsIdle(getRow("General"));

    await act(async (): Promise<void> => {
      deferred.resolve({ data: {} });
    });

    await waitFor(() => {
      expect(getRowStatus(getRow("Alpha Ops"))).toHaveTextContent("Sent");
    });
    expectRowIsIdle(getRow("General"));
  });

  test("a failing send opens the failure modal naming the channel and Microsoft Teams with the server's error", async () => {
    const errorMessage: string =
      'Could not send the test notification to "General". The OneUptime app is not installed in this team.';

    apiPostHandler = async (): Promise<unknown> => {
      return new HTTPErrorResponse(400, { message: errorMessage }, {});
    };

    await renderTeamsChannelsCard();
    await waitForTeamsChannels(2);

    await click(getSendTestButton(getRow("General")));

    const dialog: HTMLElement = await screen.findByRole("dialog");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Test Notification Failed",
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      "OneUptime could not send a test notification to General in Microsoft Teams.",
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(errorMessage);

    expect(getRowStatus(getRow("General"))).toHaveTextContent("Failed");
    expectRowIsIdle(getRow("Alpha Ops"));

    // The dialog only reports an outcome, so "Close" is its one way out.
    expect(
      within(dialog).queryByTestId("close-button"),
    ).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);

    await click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(getRowStatus(getRow("General"))).toHaveTextContent("Failed");
  });

  test("no teams renders no Send Test buttons", async () => {
    await renderTeamsChannelsCard({ teams: [], channelsByTeam: {} });

    await screen.findByText("No teams found");

    expect(querySendTestButtons()).toHaveLength(0);
    expect(postRequests).toHaveLength(0);
  });

  test("a team with no channels renders no Send Test buttons", async () => {
    await renderTeamsChannelsCard({
      teams: [{ id: "team-empty", name: "Empty Team" }],
      channelsByTeam: { "team-empty": [] },
    });

    await screen.findByText("No channels found in this team.");

    expect(querySendTestButtons()).toHaveLength(0);
  });

  test("switching to a team with no channels removes every Send Test button", async () => {
    await renderTeamsChannelsCard({
      teams: TEAMS,
      channelsByTeam: {
        "team-alpha": CHANNELS_BY_TEAM["team-alpha"]!,
        "team-beta": [],
      },
    });
    await waitForTeamsChannels(2);

    expect(querySendTestButtons()).toHaveLength(2);

    await selectTeam("Beta Team");
    await screen.findByText("No channels found in this team.");

    expect(querySendTestButtons()).toHaveLength(0);
  });

  test("channel rows can wrap on a narrow screen: the row is flex-wrap and the name keeps an 8rem floor", async () => {
    await renderTeamsChannelsCard();
    await waitForTeamsChannels(2);

    for (const name of ["General", "Alpha Ops"]) {
      expectRowWrapsOnNarrowScreens(name);
    }
  });

  describe("while a Send Test is in flight", () => {
    /*
     * Picking another team reloads the list exactly like Refresh does, so the
     * team dropdown is locked along with it.
     */
    const teamsChannelsSendLockCase: SendLockCase = {
      getListControls: (): Array<HTMLElement> => {
        return [
          screen.getByRole("button", { name: /Refresh Channels/i }),
          /*
           * hidden: true because a disabled react-select hides its input
           * with visibility: hidden, which takes the combobox out of the
           * accessibility tree. It is still the element that carries the
           * disabled attribute and receives the keyboard.
           */
          screen.getByRole("combobox", { hidden: true }),
        ];
      },
      rowNames: ["Alpha Ops", "General"],
    };

    test("Refresh Channels and the team dropdown are disabled, do nothing when tried, and are re-enabled once the send succeeds", async () => {
      await renderTeamsChannelsCard();
      await waitForTeamsChannels(2);

      await expectListControlsLockedUntilSendSucceeds(
        teamsChannelsSendLockCase,
      );
    });

    test("Refresh Channels and the team dropdown are re-enabled once the send fails", async () => {
      await renderTeamsChannelsCard();
      await waitForTeamsChannels(2);

      await expectListControlsLockedUntilSendFails(teamsChannelsSendLockCase);
    });

    test("with two sends in flight, Refresh Channels and the team dropdown stay disabled after the first settles and are re-enabled after the second", async () => {
      await renderTeamsChannelsCard();
      await waitForTeamsChannels(2);

      await expectListControlsLockedUntilEverySendSettles(
        teamsChannelsSendLockCase,
      );
    });

    test("once the send has settled the team can be switched again, and the new team's rows post the new teamId", async () => {
      await renderTeamsChannelsCard();
      await waitForTeamsChannels(2);

      await expectListControlsLockedUntilSendSucceeds(
        teamsChannelsSendLockCase,
      );

      apiPostHandler = answerPostWithSuccess;

      await selectTeam("Beta Team");
      await waitForTeamsChannels(3);

      await click(getSendTestButton(getRow("Beta On-Call")));

      expect(postRequests[postRequests.length - 1]!.data).toEqual({
        teamId: "team-beta",
        channelId: "19:beta-oncall@thread.tacv2",
      });
    });
  });

  describe("channel loads that finish out of order", () => {
    /*
     * Three teams, so the test can pick Beta and then Gamma while Alpha's
     * list is showing, and hold both loads open. Beta and Gamma share the
     * "General" channel id, so only the teamId in the body tells a Gamma
     * "General" from a Beta one.
     */
    const RACE_TEAMS: Array<JSONObject> = [
      { id: "team-gamma", name: "Gamma Team" },
      { id: "team-beta", name: "Beta Team" },
      { id: "team-alpha", name: "Alpha Team" },
    ];

    const RACE_CHANNELS_BY_TEAM: { [teamId: string]: Array<JSONObject> } = {
      "team-alpha": CHANNELS_BY_TEAM["team-alpha"]!,
      "team-beta": CHANNELS_BY_TEAM["team-beta"]!,
      "team-gamma": [
        { id: "19:shared@thread.tacv2", name: "General" },
        { id: "19:gamma-deploys@thread.tacv2", name: "Gamma Deploys" },
      ],
    };

    const BETA_LOAD_ERROR: string = "Could not load the channels of Beta Team.";

    type HeldChannelLoads = { [teamId: string]: Deferred };

    /*
     * Holds the channel list GET of each given team open until the test
     * settles it. Every other GET is still answered from the fixtures.
     */
    function holdChannelLoads(teamIds: Array<string>): HeldChannelLoads {
      const held: HeldChannelLoads = {};

      for (const teamId of teamIds) {
        held[teamId] = createDeferred();
      }

      apiGetHandler = (url: string): Promise<unknown> => {
        for (const teamId of teamIds) {
          if (
            url.endsWith(
              `/microsoft-teams/channels?teamId=${encodeURIComponent(teamId)}`,
            )
          ) {
            return held[teamId]!.promise;
          }
        }

        return answerGetFromFixtures(url);
      };

      return held;
    }

    function channelsResponse(teamId: string): JSONObject {
      return { data: { channels: RACE_CHANNELS_BY_TEAM[teamId] || [] } };
    }

    /*
     * Renders on Alpha's channels, then picks Beta and then Gamma with both
     * loads held open.
     */
    async function pickBetaThenGammaWithLoadsHeld(): Promise<HeldChannelLoads> {
      await renderTeamsChannelsCard({
        teams: RACE_TEAMS,
        channelsByTeam: RACE_CHANNELS_BY_TEAM,
      });
      await waitForTeamsChannels(2);
      getRow("Alpha Ops");

      const held: HeldChannelLoads = holdChannelLoads([
        "team-beta",
        "team-gamma",
      ]);

      await selectTeam("Beta Team");
      await selectTeam("Gamma Team");

      const betaOrGammaChannelsUrl: RegExp =
        /\/microsoft-teams\/channels\?teamId=team-(beta|gamma)$/;

      expect(
        getRequests.filter((url: string) => {
          return betaOrGammaChannelsUrl.test(url);
        }),
      ).toEqual([
        expect.stringMatching(/teamId=team-beta$/),
        expect.stringMatching(/teamId=team-gamma$/),
      ]);

      // Both loads are still out, so no list is shown yet.
      expect(screen.queryByRole("list")).not.toBeInTheDocument();

      return held;
    }

    function expectGammaChannelsListed(): void {
      expect(screen.getByText("Channels (2)")).toBeInTheDocument();
      expect(getRows()).toHaveLength(2);
      getRow("General");
      getRow("Gamma Deploys");
      expect(screen.queryByText("Beta On-Call")).not.toBeInTheDocument();
      expect(screen.queryByText("Beta Releases")).not.toBeInTheDocument();
      expect(screen.queryByText("Alpha Ops")).not.toBeInTheDocument();
      // The dropdown still names the team the list belongs to.
      expect(screen.getByText("Gamma Team")).toBeInTheDocument();
    }

    test("the earlier team's late response is dropped: the list keeps the later team's channels and Send Test posts the later team", async () => {
      const held: HeldChannelLoads = await pickBetaThenGammaWithLoadsHeld();

      // Gamma, picked last, answers first.
      await act(async (): Promise<void> => {
        held["team-gamma"]!.resolve(channelsResponse("team-gamma"));
      });
      await screen.findByText("Gamma Deploys");
      expectGammaChannelsListed();

      // Beta's answer lands afterwards and must not replace Gamma's list.
      await act(async (): Promise<void> => {
        held["team-beta"]!.resolve(channelsResponse("team-beta"));
      });
      await settlePendingWork();

      expectGammaChannelsListed();
      expectEveryRowIsIdle();

      await click(getSendTestButton(getRow("General")));
      await click(getSendTestButton(getRow("Gamma Deploys")));

      expect(
        postRequests.map((request: RecordedPost) => {
          return request.data;
        }),
      ).toEqual([
        { teamId: "team-gamma", channelId: "19:shared@thread.tacv2" },
        { teamId: "team-gamma", channelId: "19:gamma-deploys@thread.tacv2" },
      ]);
    });

    test("the earlier team's load failing while the later team is still loading shows no error and keeps loading", async () => {
      const held: HeldChannelLoads = await pickBetaThenGammaWithLoadsHeld();

      await act(async (): Promise<void> => {
        held["team-beta"]!.reject(new Error(BETA_LOAD_ERROR));
      });
      await settlePendingWork();

      expect(screen.queryByText(BETA_LOAD_ERROR)).not.toBeInTheDocument();
      // An error would have replaced the whole card body, dropdown included.
      expect(screen.getByRole("combobox")).toBeInTheDocument();
      /*
       * Still loading Gamma. Had Beta's failure ended the loading state, the
       * list left over from Alpha would be showing under "Gamma Team".
       */
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.queryByText("Alpha Ops")).not.toBeInTheDocument();

      await act(async (): Promise<void> => {
        held["team-gamma"]!.resolve(channelsResponse("team-gamma"));
      });
      await screen.findByText("Gamma Deploys");

      expectGammaChannelsListed();
      expect(screen.queryByText(BETA_LOAD_ERROR)).not.toBeInTheDocument();

      await click(getSendTestButton(getRow("Gamma Deploys")));

      expect(postRequests).toHaveLength(1);
      expect(postRequests[0]!.data).toEqual({
        teamId: "team-gamma",
        channelId: "19:gamma-deploys@thread.tacv2",
      });
    });

    test("the earlier team's load failing after the later team's channels arrived shows no error and keeps the list", async () => {
      const held: HeldChannelLoads = await pickBetaThenGammaWithLoadsHeld();

      await act(async (): Promise<void> => {
        held["team-gamma"]!.resolve(channelsResponse("team-gamma"));
      });
      await screen.findByText("Gamma Deploys");

      // The API reports a failed request by returning an HTTPErrorResponse.
      await act(async (): Promise<void> => {
        held["team-beta"]!.resolve(
          new HTTPErrorResponse(500, { message: BETA_LOAD_ERROR }, {}),
        );
      });
      await settlePendingWork();

      expect(screen.queryByText(BETA_LOAD_ERROR)).not.toBeInTheDocument();
      expectGammaChannelsListed();

      await click(getSendTestButton(getRow("General")));

      expect(postRequests).toHaveLength(1);
      expect(postRequests[0]!.data).toEqual({
        teamId: "team-gamma",
        channelId: "19:shared@thread.tacv2",
      });
    });

    /*
     * Two loads of the SAME team: react-select fires onChange again when the
     * already-selected option is picked, so re-picking Beta while its list is
     * loading starts a second Beta load. A guard that compared team ids would
     * treat the first one as current too.
     */
    function holdEveryBetaLoad(): Array<Deferred> {
      const held: Array<Deferred> = [];

      apiGetHandler = (url: string): Promise<unknown> => {
        if (url.endsWith("/microsoft-teams/channels?teamId=team-beta")) {
          const deferred: Deferred = createDeferred();
          held.push(deferred);
          return deferred.promise;
        }

        return answerGetFromFixtures(url);
      };

      return held;
    }

    async function pickBetaTwiceWithLoadsHeld(): Promise<Array<Deferred>> {
      await renderTeamsChannelsCard({
        teams: RACE_TEAMS,
        channelsByTeam: RACE_CHANNELS_BY_TEAM,
      });
      await waitForTeamsChannels(2);
      getRow("Alpha Ops");

      const held: Array<Deferred> = holdEveryBetaLoad();

      await selectTeam("Beta Team");
      await selectTeam("Beta Team");

      expect(held).toHaveLength(2);
      expect(screen.queryByRole("list")).not.toBeInTheDocument();

      return held;
    }

    test("an older load of the same team answering first does not end the newer load's loading state", async () => {
      const held: Array<Deferred> = await pickBetaTwiceWithLoadsHeld();

      await act(async (): Promise<void> => {
        held[0]!.resolve(channelsResponse("team-beta"));
      });
      await settlePendingWork();

      // The second Beta load is still out, so its loader is still showing.
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.queryByText("Beta On-Call")).not.toBeInTheDocument();

      await act(async (): Promise<void> => {
        held[1]!.resolve(channelsResponse("team-beta"));
      });
      await screen.findByText("Beta On-Call");

      expectEveryRowIsIdle();
    });

    test("an older load of the same team failing after the newer one arrived shows no error and keeps the rows", async () => {
      const held: Array<Deferred> = await pickBetaTwiceWithLoadsHeld();

      await act(async (): Promise<void> => {
        held[1]!.resolve(channelsResponse("team-beta"));
      });
      await screen.findByText("Beta On-Call");

      await act(async (): Promise<void> => {
        held[0]!.reject(new Error(BETA_LOAD_ERROR));
      });
      await settlePendingWork();

      expect(screen.queryByText(BETA_LOAD_ERROR)).not.toBeInTheDocument();
      getRow("Beta On-Call");

      await click(getSendTestButton(getRow("Beta On-Call")));

      expect(postRequests).toHaveLength(1);
      expect(postRequests[0]!.data).toMatchObject({ teamId: "team-beta" });
    });
  });
});

describe("MicrosoftTeamsChatsCard Send Test", () => {
  const CHATS: Array<JSONObject> = [
    {
      id: "19:groupchat-war-room@thread.v2",
      name: "Incident War Room",
      chatType: "groupChat",
      addedAt: null,
    },
    {
      id: "19:personal-jane@unq.gbl.spaces",
      name: "Jane Doe",
      chatType: "personal",
      addedAt: null,
    },
  ];

  async function renderChatsCard(
    chats: Array<JSONObject> = CHATS,
  ): Promise<void> {
    fixtures.chats = chats;
    await renderCard(<MicrosoftTeamsChatsCard />);
  }

  async function waitForChats(count: number): Promise<void> {
    await screen.findByText(`Connected chats (${count})`);
  }

  test("the card description tells the user about Send Test for chats and keeps the existing copy", async () => {
    await renderChatsCard();
    await waitForChats(2);

    const description: HTMLElement = screen.getByTestId("card-description");

    expect(description).toHaveTextContent(
      "Use Send Test to confirm OneUptime can post to a chat.",
    );
    expect(description).toHaveTextContent(
      "Send notifications straight into group chats and one-on-one chats.",
    );
  });

  test("every chat row has exactly one Send Test button, after the chat-type badge and last in the row", async () => {
    await renderChatsCard();
    await waitForChats(2);

    expect(getRows()).toHaveLength(2);
    expectExactlyOneSendTestButtonPerRow();

    const cases: Array<[string, string]> = [
      ["Incident War Room", "Group chat"],
      ["Jane Doe", "1:1 chat"],
    ];

    for (const [name, badgeText] of cases) {
      const row: HTMLElement = getRow(name);
      const badge: HTMLElement = within(row).getByText(badgeText);

      expect(
        badge.compareDocumentPosition(getSendTestButton(row)) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expectButtonIsLastInRow(row);
      expectRowIsIdle(row);
    }
  });

  test("the button's accessible name names the chat", async () => {
    await renderChatsCard();
    await waitForChats(2);

    expect(getSendTestButton(getRow("Incident War Room"))).toHaveAccessibleName(
      "Send test notification to Incident War Room",
    );
    expect(getSendTestButton(getRow("Jane Doe"))).toHaveAccessibleName(
      "Send test notification to Jane Doe",
    );
  });

  test("loading the chats posts nothing", async () => {
    await renderChatsCard();
    await waitForChats(2);

    expect(postRequests).toHaveLength(0);
  });

  test("clicking Send Test posts only { chatId } to /microsoft-teams/chats/test", async () => {
    await renderChatsCard();
    await waitForChats(2);

    await click(getSendTestButton(getRow("Jane Doe")));

    expect(postRequests).toHaveLength(1);
    expect(postRequests[0]!.url).toMatch(/\/microsoft-teams\/chats\/test$/);
    // No teamId, no channelId: a chat is addressed by its id alone.
    expect(postRequests[0]!.data).toEqual({
      chatId: "19:personal-jane@unq.gbl.spaces",
    });
    expect(postRequests[0]!.headers).toEqual(COMMON_HEADERS);
  });

  test("each chat row posts its own chat id", async () => {
    await renderChatsCard();
    await waitForChats(2);

    await click(getSendTestButton(getRow("Incident War Room")));
    await click(getSendTestButton(getRow("Jane Doe")));

    expect(
      postRequests.map((request: RecordedPost) => {
        return request.data;
      }),
    ).toEqual([
      { chatId: "19:groupchat-war-room@thread.v2" },
      { chatId: "19:personal-jane@unq.gbl.spaces" },
    ]);
  });

  test("a successful send marks only that row as Sent", async () => {
    await renderChatsCard();
    await waitForChats(2);

    await click(getSendTestButton(getRow("Incident War Room")));

    const sent: HTMLElement = await findRowResult("Incident War Room", "sent");

    expect(sent).toHaveTextContent("Sent");
    expect(sent).toHaveAttribute(
      "title",
      "Test notification sent to Incident War Room. Check Microsoft Teams to confirm it arrived.",
    );
    expectRowIsIdle(getRow("Jane Doe"));
  });

  test("clicking one row does not change the other rows while the send is in flight", async () => {
    const deferred: Deferred = createDeferred();
    apiPostHandler = (): Promise<unknown> => {
      return deferred.promise;
    };

    await renderChatsCard();
    await waitForChats(2);

    await click(getSendTestButton(getRow("Jane Doe")));

    expect(getSendTestButton(getRow("Jane Doe"))).toBeDisabled();
    expectRowIsIdle(getRow("Incident War Room"));

    await act(async (): Promise<void> => {
      deferred.resolve({ data: {} });
    });

    await waitFor(() => {
      expect(getRowStatus(getRow("Jane Doe"))).toHaveTextContent("Sent");
    });
    expectRowIsIdle(getRow("Incident War Room"));
  });

  test("a failing send opens the failure modal naming the chat and Microsoft Teams with the server's error", async () => {
    const errorMessage: string =
      "This chat is no longer connected to OneUptime. Add the OneUptime app to the chat in Microsoft Teams, click Refresh Chats, and try again.";

    apiPostHandler = async (): Promise<unknown> => {
      throw new Error(errorMessage);
    };

    await renderChatsCard();
    await waitForChats(2);

    await click(getSendTestButton(getRow("Incident War Room")));

    const dialog: HTMLElement = await screen.findByRole("dialog");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Test Notification Failed",
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      "OneUptime could not send a test notification to Incident War Room in Microsoft Teams.",
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(errorMessage);

    expect(getRowStatus(getRow("Incident War Room"))).toHaveTextContent(
      "Failed",
    );
    expectRowIsIdle(getRow("Jane Doe"));

    // "Close" dismisses the dialog; the row keeps its result.
    await click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(getRowStatus(getRow("Incident War Room"))).toHaveTextContent(
      "Failed",
    );
  });

  test("a chat without a name still gets a Send Test button that posts its chat id", async () => {
    await renderChatsCard([
      {
        id: "19:unnamed-chat@thread.v2",
        name: "",
        chatType: "groupChat",
        addedAt: null,
      },
    ]);
    await waitForChats(1);

    const buttons: Array<HTMLElement> = querySendTestButtons();

    expect(buttons).toHaveLength(1);
    // The label must still name a destination rather than trail off.
    expect(buttons[0]).toHaveAccessibleName(
      "Send test notification to this chat",
    );

    await click(buttons[0]!);

    expect(postRequests).toHaveLength(1);
    expect(postRequests[0]!.data).toEqual({
      chatId: "19:unnamed-chat@thread.v2",
    });
  });

  test("chats the card drops for a missing id get no Send Test button", async () => {
    await renderChatsCard([
      ...CHATS,
      { id: "", name: "Ghost Chat", chatType: "groupChat", addedAt: null },
    ]);
    await waitForChats(2);

    expect(querySendTestButtons()).toHaveLength(2);
    expect(screen.queryByText("Ghost Chat")).not.toBeInTheDocument();
  });

  test("an empty chat list renders no Send Test buttons", async () => {
    await renderChatsCard([]);

    await screen.findByText("No chats connected yet");

    expect(querySendTestButtons()).toHaveLength(0);
    expect(
      screen.queryByTestId("send-test-notification-button"),
    ).not.toBeInTheDocument();
  });

  test("a chat list that fails to load renders no Send Test buttons", async () => {
    apiGetHandler = async (): Promise<unknown> => {
      throw new Error("Microsoft Teams is not connected.");
    };

    await renderChatsCard();

    await screen.findByText("Microsoft Teams is not connected.");

    expect(querySendTestButtons()).toHaveLength(0);
  });

  test("chat rows can wrap on a narrow screen: the row is flex-wrap and the name keeps an 8rem floor beside the badge", async () => {
    await renderChatsCard();
    await waitForChats(2);

    /*
     * This row is the tightest of the three cards: avatar, name, chat-type
     * badge and the Send Test control. It is where the name used to collapse
     * to nothing on a phone.
     */
    for (const name of ["Incident War Room", "Jane Doe"]) {
      expectRowWrapsOnNarrowScreens(name);
    }
  });

  describe("while a Send Test is in flight", () => {
    const chatsSendLockCase: SendLockCase = {
      getListControls: (): Array<HTMLElement> => {
        return [screen.getByRole("button", { name: /Refresh Chats/i })];
      },
      rowNames: ["Jane Doe", "Incident War Room"],
    };

    test("Refresh Chats is disabled, does not reload when clicked, and is re-enabled once the send succeeds", async () => {
      await renderChatsCard();
      await waitForChats(2);

      await expectListControlsLockedUntilSendSucceeds(chatsSendLockCase);
    });

    test("Refresh Chats is re-enabled once the send fails", async () => {
      await renderChatsCard();
      await waitForChats(2);

      await expectListControlsLockedUntilSendFails(chatsSendLockCase);
    });

    test("with two sends in flight, Refresh Chats stays disabled after the first settles and is re-enabled after the second", async () => {
      await renderChatsCard();
      await waitForChats(2);

      await expectListControlsLockedUntilEverySendSettles(chatsSendLockCase);
    });
  });
});
