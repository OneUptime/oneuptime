import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import ServerSendingTopAlert, {
  getServerSendingAlert,
  SERVER_SENDING_ALERT_COPY,
  ServerSendingAlertKind,
} from "../../../UI/Components/ServerSending/ServerSendingTopAlert";
import ServerSendingStatusLoader from "../../../UI/Utils/ServerSending";
import API from "../../../UI/Utils/API/API";
import User from "../../../UI/Utils/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
  ServerSendingStatusAnswer,
} from "../../../Types/ServerSending/ServerSendingStatus";

/*
 * THE ONE BANNER THAT SAYS THIS SERVER CANNOT SEND (#6825).
 *
 * A master admin sees it at the top of the Dashboard and the Admin
 * Dashboard while email is not set up, or fails, or every global probe has
 * gone quiet - one at a time, email first - with what is not happening and
 * the link that fixes it. It draws nothing otherwise: when all works, for
 * anybody who is not a master admin, and when the answer cannot be read.
 * That is what keeps it an exception, as NoAlwaysOnInfoBannersGuard wants.
 */

function channel(
  name: ServerSendingChannel,
  state: ServerSendingState,
  overrides: Partial<ServerChannelStatus> = {},
): ServerChannelStatus {
  return {
    channel: name,
    state: state,
    hasWorked: state === ServerSendingState.Working,
    lastWorkedAt: null,
    failingSince: null,
    lastFailure: null,
    setUpProblem: state === ServerSendingState.NotSetUp ? "Not set." : null,
    ...overrides,
  };
}

function answer(data: {
  email: ServerSendingState;
  failingSince?: string | null;
  lastFailure?: string | null;
  probes?: { total: number; reporting: number } | null;
}): ServerSendingStatusAnswer {
  return {
    channels: [
      channel(ServerSendingChannel.Email, data.email, {
        failingSince: data.failingSince || null,
        lastFailure: data.lastFailure || null,
      }),
      channel(ServerSendingChannel.SMS, ServerSendingState.NotSetUp),
      channel(ServerSendingChannel.Call, ServerSendingState.NotSetUp),
      channel(ServerSendingChannel.Push, ServerSendingState.Untested),
    ],
    globalProbes: data.probes === undefined ? null : data.probes,
  };
}

const EMAIL_SETTINGS: Route = new Route("/admin/settings/smtp");
const PROBES: Route = new Route("/admin/settings/probes");

function draw(value: ServerSendingStatusAnswer | null): void {
  render(
    <ServerSendingTopAlert
      emailSettingsLink={EMAIL_SETTINGS}
      globalProbesLink={PROBES}
      answer={value}
    />,
  );
}

beforeEach(() => {
  ServerSendingStatusLoader.clear();
});

afterEach(() => {
  cleanup();
  ServerSendingStatusLoader.clear();
  jest.restoreAllMocks();
});

describe("what the banner says", () => {
  test.each([
    [ServerSendingState.Working, null],
    [ServerSendingState.Untested, null],
    [ServerSendingState.NotSetUp, ServerSendingAlertKind.EmailNotSetUp],
    [ServerSendingState.Failing, ServerSendingAlertKind.EmailFailing],
  ])(
    "email %p: %p",
    (state: ServerSendingState, expected: ServerSendingAlertKind | null) => {
      expect(
        getServerSendingAlert(answer({ email: state }))?.kind || null,
      ).toBe(expected);
    },
  );

  test("nothing is said without an answer", () => {
    expect(getServerSendingAlert(null)).toBeNull();
  });

  test("silent global probes are said once email works", () => {
    expect(
      getServerSendingAlert(
        answer({
          email: ServerSendingState.Working,
          probes: { total: 3, reporting: 0 },
        }),
      )?.kind,
    ).toBe(ServerSendingAlertKind.GlobalProbesSilent);

    expect(
      getServerSendingAlert(
        answer({
          email: ServerSendingState.Working,
          probes: { total: 3, reporting: 1 },
        }),
      ),
    ).toBeNull();
  });

  test("email comes first: one banner at a time", () => {
    expect(
      getServerSendingAlert(
        answer({
          email: ServerSendingState.NotSetUp,
          probes: { total: 3, reporting: 0 },
        }),
      )?.kind,
    ).toBe(ServerSendingAlertKind.EmailNotSetUp);
  });

  test("SMS and calls not set up say nothing: email is the channel every server needs", () => {
    expect(
      getServerSendingAlert(answer({ email: ServerSendingState.Working })),
    ).toBeNull();
  });
});

describe("as drawn", () => {
  test("email not set up: what is not sent, and Set up email", () => {
    draw(answer({ email: ServerSendingState.NotSetUp }));

    const banner: HTMLElement = screen.getByTestId("server-sending-alert");

    expect(banner).toHaveAttribute(
      "data-kind",
      ServerSendingAlertKind.EmailNotSetUp,
    );
    expect(banner).toHaveTextContent(
      SERVER_SENDING_ALERT_COPY.emailNotSetUpTitle,
    );
    expect(banner).toHaveTextContent(
      SERVER_SENDING_ALERT_COPY.emailNotSetUpDescription,
    );

    const action: HTMLElement = screen.getByTestId(
      "server-sending-alert-action",
    );

    expect(action).toHaveTextContent(SERVER_SENDING_ALERT_COPY.setUpEmail);
    expect(action.getAttribute("href")).toContain("/admin/settings/smtp");
  });

  test("email failing: since when, what the mail server said, and Check email settings", () => {
    draw(
      answer({
        email: ServerSendingState.Failing,
        failingSince: "2026-11-11T09:00:00.000Z",
        lastFailure: "535 5.7.8 Authentication failed",
      }),
    );

    const banner: HTMLElement = screen.getByTestId("server-sending-alert");

    expect(banner).toHaveTextContent(
      SERVER_SENDING_ALERT_COPY.emailFailingTitle,
    );
    expect(banner).toHaveTextContent("535 5.7.8 Authentication failed");
    expect(banner).toHaveTextContent("2026");
    expect(screen.getByTestId("server-sending-alert-action")).toHaveTextContent(
      SERVER_SENDING_ALERT_COPY.checkEmailSettings,
    );
  });

  test("email failing with no reason kept still says since when", () => {
    draw(
      answer({
        email: ServerSendingState.Failing,
        failingSince: "2026-11-11T09:00:00.000Z",
      }),
    );

    const banner: HTMLElement = screen.getByTestId("server-sending-alert");

    expect(banner).not.toHaveTextContent("The mail server said");
    expect(banner).toHaveTextContent("invitations and incident emails");
  });

  test("global probes silent: See global probes", () => {
    draw(
      answer({
        email: ServerSendingState.Working,
        probes: { total: 2, reporting: 0 },
      }),
    );

    expect(screen.getByTestId("server-sending-alert")).toHaveTextContent(
      SERVER_SENDING_ALERT_COPY.probesSilentTitle,
    );
    expect(
      screen.getByTestId("server-sending-alert-action").getAttribute("href"),
    ).toContain("/admin/settings/probes");
  });

  test("a link into another app opens where it is asked to", () => {
    render(
      <ServerSendingTopAlert
        emailSettingsLink={URL.fromString(
          "https://oneuptime.example.com/admin/settings/smtp",
        )}
        globalProbesLink={PROBES}
        openLinksInNewTab={true}
        answer={answer({ email: ServerSendingState.NotSetUp })}
      />,
    );

    const action: HTMLElement = screen.getByTestId(
      "server-sending-alert-action",
    );

    expect(action.getAttribute("href")).toBe(
      "https://oneuptime.example.com/admin/settings/smtp",
    );
    expect(action.getAttribute("target")).toBe("_blank");
  });

  test.each([
    ["all works", answer({ email: ServerSendingState.Working })],
    ["nothing sent yet", answer({ email: ServerSendingState.Untested })],
    ["no answer", null],
  ])(
    "draws nothing when %s",
    (_name: string, value: ServerSendingStatusAnswer | null) => {
      draw(value);

      expect(screen.queryByTestId("server-sending-alert")).toBeNull();
    },
  );
});

describe("who it is read for", () => {
  test("anybody but a master admin: nothing is asked, nothing drawn", async () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
    const fetch: jest.SpyInstance = jest.spyOn(API, "fetch");

    await act(async () => {
      render(
        <ServerSendingTopAlert
          emailSettingsLink={EMAIL_SETTINGS}
          globalProbesLink={PROBES}
        />,
      );
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("server-sending-alert")).toBeNull();
  });

  test("a master admin: GET /global-config/sending-status, once, and its answer drawn", async () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    const fetch: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          JSON.parse(
            JSON.stringify(answer({ email: ServerSendingState.NotSetUp })),
          ) as JSONObject,
          {},
        ) as never,
      );

    await act(async () => {
      render(
        <>
          <ServerSendingTopAlert
            emailSettingsLink={EMAIL_SETTINGS}
            globalProbesLink={PROBES}
          />
          <ServerSendingTopAlert
            emailSettingsLink={EMAIL_SETTINGS}
            globalProbesLink={PROBES}
          />
        </>,
      );
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    const url: URL = (fetch.mock.calls[0]![0] as { url: URL }).url;

    expect(url.toString()).toMatch(/\/global-config\/sending-status$/);
    expect(screen.getAllByTestId("server-sending-alert")).toHaveLength(2);
  });

  test("an answer that is refused draws nothing, and is asked again next time", async () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    const fetch: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValue(
        new HTTPErrorResponse(403, { message: "Forbidden" }, {}) as never,
      );

    await act(async () => {
      render(
        <ServerSendingTopAlert
          emailSettingsLink={EMAIL_SETTINGS}
          globalProbesLink={PROBES}
        />,
      );
    });

    expect(screen.queryByTestId("server-sending-alert")).toBeNull();

    await act(async () => {
      await ServerSendingStatusLoader.load();
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
