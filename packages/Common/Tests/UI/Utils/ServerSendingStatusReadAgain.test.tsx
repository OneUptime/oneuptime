import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import ServerSendingTopAlert, {
  ServerSendingAlertKind,
} from "../../../UI/Components/ServerSending/ServerSendingTopAlert";
import ServerSendingStatusLoader, {
  useServerSendingStatus,
} from "../../../UI/Utils/ServerSending";
import { sendServerTest } from "../../../UI/Utils/ServerSetupChecklist";
import GlobalConfigUtil from "../../../UI/Utils/GlobalConfig";
import API from "../../../UI/Utils/API/API";
import User from "../../../UI/Utils/User";
import BaseAPI from "../../../Utils/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
  ServerSendingStatusAnswer,
} from "../../../Types/ServerSending/ServerSendingStatus";
import {
  ServerTestSendAnswer,
  ServerTestSendResult,
} from "../../../Types/ServerSetup/ServerTestSend";

/*
 * THE BANNER READS WHERE EMAIL STANDS AGAIN WHEN IT MAY HAVE CHANGED (#7459).
 *
 * "Email is not set up" (ServerSendingTopAlert) is mounted once, by the
 * Admin Dashboard's MasterPage, for the whole visit, and read the sending
 * status once, when it mounted. A test send cleared the kept answer
 * (ServerSendingStatusLoader.clear) and a save of the email settings did
 * not; either way nothing told the mounted banner, so a server whose email
 * was saved and whose test email arrived still said "Email is not set up"
 * until a reload.
 *
 * Pinned here:
 *   1. clear() tells every listener (onCleared), and forgets the public
 *      canSendEmail too (GlobalConfigUtil), so the next page that asks
 *      reads it again;
 *   2. every mounted useServerSendingStatus reads again on clear(), with
 *      one request for all of them, keeping what it drew until the new
 *      answer comes, and never drawing an answer older than the latest;
 *   3. the banner, mounted, goes away when the server's answer can send -
 *      after a clear(), and after a test send - and stays while it cannot;
 *   4. an unmounted reader, and anybody but a master admin, asks nothing.
 */

type FetchSpy = SpyInstance<
  (...args: Parameters<typeof API.fetch>) => ReturnType<typeof API.fetch>
>;

function channel(
  name: ServerSendingChannel,
  state: ServerSendingState,
): ServerChannelStatus {
  return {
    channel: name,
    state: state,
    hasWorked: state === ServerSendingState.Working,
    lastWorkedAt: null,
    failingSince:
      state === ServerSendingState.Failing ? "2026-11-14T09:00:00.000Z" : null,
    lastFailure:
      state === ServerSendingState.Failing ? "535 Authentication failed" : null,
    setUpProblem:
      state === ServerSendingState.NotSetUp
        ? "Nothing is set up under Settings > Emails yet."
        : null,
  };
}

function statusOf(email: ServerSendingState): ServerSendingStatusAnswer {
  return {
    channels: [
      channel(ServerSendingChannel.Email, email),
      channel(ServerSendingChannel.SMS, ServerSendingState.NotSetUp),
      channel(ServerSendingChannel.Call, ServerSendingState.NotSetUp),
      channel(ServerSendingChannel.Push, ServerSendingState.Untested),
    ],
    globalProbes: null,
  };
}

function ok(email: ServerSendingState): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    JSON.parse(JSON.stringify(statusOf(email))) as JSONObject,
    {},
  );
}

// A request that answers when the test says so.
interface Deferred {
  promise: Promise<unknown>;
  answer: (email: ServerSendingState) => void;
}

function deferred(): Deferred {
  let resolve: (value: unknown) => void = (): void => {};
  const promise: Promise<unknown> = new Promise(
    (done: (v: unknown) => void) => {
      resolve = done;
    },
  );

  return {
    promise: promise,
    answer: (email: ServerSendingState): void => {
      resolve(ok(email));
    },
  };
}

const EMAIL_SETTINGS: Route = new Route("/admin/settings/smtp");
const PROBES: Route = new Route("/admin/settings/probes");

function Banner(): ReactElement {
  return (
    <ServerSendingTopAlert
      emailSettingsLink={EMAIL_SETTINGS}
      globalProbesLink={PROBES}
    />
  );
}

// Draws the email channel's state as the hook returns it.
function EmailState(props: { testId: string }): ReactElement {
  const answer: ServerSendingStatusAnswer | null = useServerSendingStatus();
  const email: ServerChannelStatus | undefined = answer?.channels.find(
    (status: ServerChannelStatus): boolean => {
      return status.channel === ServerSendingChannel.Email;
    },
  );

  return <span data-testid={props.testId}>{email ? email.state : "none"}</span>;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function bannerKind(): string | null {
  const banner: HTMLElement | null = screen.queryByTestId(
    "server-sending-alert",
  );

  return banner ? banner.getAttribute("data-kind") : null;
}

let fetch: FetchSpy;

beforeEach(() => {
  ServerSendingStatusLoader.clear();
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
  fetch = jest.spyOn(API, "fetch") as FetchSpy;
});

afterEach(() => {
  cleanup();
  ServerSendingStatusLoader.clear();
  jest.restoreAllMocks();
});

describe("clear() tells whoever reads the sending status", () => {
  test("every listener, once per clear, until it stops listening", () => {
    const first: MockFunction = getJestMockFunction();
    const second: MockFunction = getJestMockFunction();

    const stopFirst: () => void = ServerSendingStatusLoader.onCleared(first);
    const stopSecond: () => void = ServerSendingStatusLoader.onCleared(second);

    ServerSendingStatusLoader.clear();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    stopFirst();
    ServerSendingStatusLoader.clear();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    stopSecond();
    ServerSendingStatusLoader.clear();

    expect(second).toHaveBeenCalledTimes(2);
  });

  test("a listener that throws costs the others nothing", () => {
    const after: MockFunction = getJestMockFunction();

    const stopThrowing: () => void = ServerSendingStatusLoader.onCleared(
      (): void => {
        throw new Error("This reader failed.");
      },
    );
    const stopAfter: () => void = ServerSendingStatusLoader.onCleared(after);

    expect(() => {
      ServerSendingStatusLoader.clear();
    }).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);

    stopThrowing();
    stopAfter();
  });

  test("a listener that stops another while it is told does not skip anyone", () => {
    const told: Array<string> = [];
    let stopSecond: () => void = (): void => {};

    const stopFirst: () => void = ServerSendingStatusLoader.onCleared(
      (): void => {
        told.push("first");
        stopSecond();
      },
    );
    stopSecond = ServerSendingStatusLoader.onCleared((): void => {
      told.push("second");
    });

    ServerSendingStatusLoader.clear();

    // Told from the list as it was when clear() was called.
    expect(told).toEqual(["first", "second"]);

    told.length = 0;
    ServerSendingStatusLoader.clear();

    expect(told).toEqual(["first"]);
    stopFirst();
  });

  test("the next load asks the server again", async () => {
    fetch.mockResolvedValue(ok(ServerSendingState.NotSetUp) as never);

    await ServerSendingStatusLoader.load();
    await ServerSendingStatusLoader.load();

    expect(fetch).toHaveBeenCalledTimes(1);

    ServerSendingStatusLoader.clear();
    await ServerSendingStatusLoader.load();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  /*
   * GET /global-config/vars' canSendEmail is kept for the page's life by
   * GlobalConfigUtil: the invite dialogs of the Admin Dashboard's Users and
   * Teams pages said the server cannot send email after it was set up,
   * until a reload.
   */
  test("the public canSendEmail is forgotten too: the next page that asks reads it again", async () => {
    const get: SpyInstance<
      (
        ...args: Parameters<typeof BaseAPI.get>
      ) => ReturnType<typeof BaseAPI.get>
    > = jest
      .spyOn(BaseAPI, "get")
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(200, { canSendEmail: false }, {}) as never,
      )
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(200, { canSendEmail: true }, {}) as never,
      );

    GlobalConfigUtil.clearCache();

    expect((await GlobalConfigUtil.fetchVars()).canSendEmail).toBe(false);
    expect((await GlobalConfigUtil.fetchVars()).canSendEmail).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);

    ServerSendingStatusLoader.clear();

    expect((await GlobalConfigUtil.fetchVars()).canSendEmail).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);

    GlobalConfigUtil.clearCache();
  });
});

describe("the banner, mounted, follows where email stands", () => {
  test("cleared with an answer that can send, the banner goes, with no reload", async () => {
    fetch.mockResolvedValueOnce(ok(ServerSendingState.NotSetUp) as never);

    await act(async () => {
      render(<Banner />);
    });
    await settle();

    expect(bannerKind()).toBe(ServerSendingAlertKind.EmailNotSetUp);

    // Saved and tested: the server can send now.
    fetch.mockResolvedValueOnce(ok(ServerSendingState.Working) as never);

    await act(async () => {
      ServerSendingStatusLoader.clear();
    });
    await settle();

    expect(bannerKind()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    [ServerSendingState.Working, null],
    [ServerSendingState.Untested, null],
    [ServerSendingState.NotSetUp, ServerSendingAlertKind.EmailNotSetUp],
    [ServerSendingState.Failing, ServerSendingAlertKind.EmailFailing],
  ])(
    "email %p after the clear: the banner says %p",
    async (state: ServerSendingState, expected: string | null) => {
      fetch.mockResolvedValueOnce(ok(ServerSendingState.NotSetUp) as never);

      await act(async () => {
        render(<Banner />);
      });
      await settle();

      fetch.mockResolvedValueOnce(ok(state) as never);

      await act(async () => {
        ServerSendingStatusLoader.clear();
      });
      await settle();

      expect(bannerKind()).toBe(expected);
    },
  );

  test("a server whose email works and then stops: the banner comes back on the next clear", async () => {
    fetch
      .mockResolvedValueOnce(ok(ServerSendingState.Working) as never)
      .mockResolvedValueOnce(ok(ServerSendingState.Failing) as never);

    await act(async () => {
      render(<Banner />);
    });
    await settle();

    expect(bannerKind()).toBeNull();

    await act(async () => {
      ServerSendingStatusLoader.clear();
    });
    await settle();

    expect(bannerKind()).toBe(ServerSendingAlertKind.EmailFailing);
  });

  test("after a test send, the banner reads again by itself", async () => {
    fetch
      .mockResolvedValueOnce(ok(ServerSendingState.NotSetUp) as never)
      .mockResolvedValue(ok(ServerSendingState.Working) as never);

    const accepted: ServerTestSendAnswer = {
      channel: ServerSendingChannel.Email,
      result: ServerTestSendResult.Accepted,
      to: "ada@example.com",
      sentThrough: "smtp.example.com",
      message: null,
    };

    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          accepted as unknown as JSONObject,
          {},
        ) as never,
      );

    await act(async () => {
      render(<Banner />);
    });
    await settle();

    expect(bannerKind()).toBe(ServerSendingAlertKind.EmailNotSetUp);

    await act(async () => {
      await sendServerTest({
        channel: ServerSendingChannel.Email,
        to: "ada@example.com",
      });
    });
    await settle();

    expect(bannerKind()).toBeNull();
  });

  test("it keeps what it says until the new answer comes: no flicker", async () => {
    fetch.mockResolvedValueOnce(ok(ServerSendingState.NotSetUp) as never);

    await act(async () => {
      render(<Banner />);
    });
    await settle();

    const later: Deferred = deferred();

    fetch.mockReturnValueOnce(later.promise as never);

    await act(async () => {
      ServerSendingStatusLoader.clear();
    });
    await settle();

    // Still the answer it had, while the new one is on its way.
    expect(bannerKind()).toBe(ServerSendingAlertKind.EmailNotSetUp);

    await act(async () => {
      later.answer(ServerSendingState.Untested);
    });
    await settle();

    expect(bannerKind()).toBeNull();
  });

  test("an answer that was on its way when the settings changed never replaces the newer one", async () => {
    const first: Deferred = deferred();
    const second: Deferred = deferred();

    fetch
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);

    await act(async () => {
      render(<Banner />);
    });

    // Saved before the first answer came.
    await act(async () => {
      ServerSendingStatusLoader.clear();
    });

    await act(async () => {
      second.answer(ServerSendingState.Working);
    });
    await settle();

    expect(bannerKind()).toBeNull();

    // The answer from before the save comes last: it is not drawn.
    await act(async () => {
      first.answer(ServerSendingState.NotSetUp);
    });
    await settle();

    expect(bannerKind()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a read again that fails draws nothing, as a first read that fails does", async () => {
    fetch
      .mockResolvedValueOnce(ok(ServerSendingState.NotSetUp) as never)
      .mockResolvedValueOnce(
        new HTTPErrorResponse(500, { message: "Server error." }, {}) as never,
      );

    await act(async () => {
      render(<Banner />);
    });
    await settle();

    expect(bannerKind()).toBe(ServerSendingAlertKind.EmailNotSetUp);

    await act(async () => {
      ServerSendingStatusLoader.clear();
    });
    await settle();

    expect(bannerKind()).toBeNull();
  });
});

describe("who reads again", () => {
  test("every mounted reader, with one request for all of them", async () => {
    fetch.mockResolvedValueOnce(ok(ServerSendingState.NotSetUp) as never);

    await act(async () => {
      render(
        <>
          <Banner />
          <EmailState testId="first" />
          <EmailState testId="second" />
        </>,
      );
    });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("first")).toHaveTextContent(
      ServerSendingState.NotSetUp,
    );

    fetch.mockResolvedValueOnce(ok(ServerSendingState.Untested) as never);

    await act(async () => {
      ServerSendingStatusLoader.clear();
    });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("first")).toHaveTextContent(
      ServerSendingState.Untested,
    );
    expect(screen.getByTestId("second")).toHaveTextContent(
      ServerSendingState.Untested,
    );
    expect(bannerKind()).toBeNull();
  });

  test("a reader no longer drawn asks nothing", async () => {
    fetch.mockResolvedValue(ok(ServerSendingState.NotSetUp) as never);

    let unmount: () => void = (): void => {};

    await act(async () => {
      unmount = render(<Banner />).unmount;
    });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      ServerSendingStatusLoader.clear();
    });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("anybody but a master admin: a clear asks nothing, and nothing is drawn", async () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);

    await act(async () => {
      render(
        <>
          <Banner />
          <EmailState testId="reader" />
        </>,
      );
    });
    await settle();

    await act(async () => {
      ServerSendingStatusLoader.clear();
    });
    await settle();

    expect(fetch).not.toHaveBeenCalled();
    expect(bannerKind()).toBeNull();
    expect(screen.getByTestId("reader")).toHaveTextContent("none");
  });
});
