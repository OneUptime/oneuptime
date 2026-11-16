import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import DeviceDiagnostics from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnostics";
import {
  DIAGNOSTIC_POLL_INTERVAL_IN_MS,
  describePingResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsViewModel";
import { PROBE_MESSAGE_LINE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeMessageLine";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "../../../Models/DatabaseModels/NetworkDeviceDiagnostic";
import ObjectID from "../../../Types/ObjectID";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  PROBE_FAILURE_CAUSES,
  ProbeFailureCause,
  writeProbeFailureCause,
} from "../../../Utils/Monitor/ProbeFailureCauses";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A DEVICE DIAGNOSTIC'S PROBE MESSAGE, IN THE READER'S LANGUAGE (#8675).
 *
 * A network device's Ping and Traceroute buttons show what the probe found:
 * a ping's Reason and a traceroute's note. Both are the probe's failure
 * causes - "No ICMP echo reply from 10.0.0.1 (5 sent)", "This probe cannot
 * send IPv6 traffic (...)", "Traceroute could not run: ..." - OneUptime's
 * own sentences, which read English on every page. They are drawn through
 * the monitor summary's ProbeMessageLine now: in the reader's language,
 * every value kept as found, and any other message whole in a line of its
 * own direction. English reads exactly as stored.
 */

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

type Language = "en" | "de" | "es" | "ar" | "fa";

const LANGUAGES: Array<Language> = ["en", "de", "es", "ar", "fa"];

const RIGHT_TO_LEFT: ReadonlyArray<Language> = ["ar", "fa"];

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const DIAGNOSTIC_ID: string = "22222222-2222-4222-8222-222222222222";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";

const createMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getDeviceMock: MockFunction = getJestMockFunction();

interface GetItemRequest {
  modelType: unknown;
}

const fakeModelAPI: typeof ModelAPI = {
  create: createMock,
  getItem: (request: GetItemRequest) => {
    return request.modelType === NetworkDevice
      ? getDeviceMock(request)
      : getItemMock(request);
  },
} as unknown as typeof ModelAPI;

function row(
  overrides: Partial<NetworkDeviceDiagnostic> = {},
): NetworkDeviceDiagnostic {
  return Object.assign(
    new NetworkDeviceDiagnostic(),
    { _id: DIAGNOSTIC_ID, status: "Pending" },
    overrides,
  );
}

function device(): NetworkDevice {
  return Object.assign(new NetworkDevice(), {
    _id: DEVICE_ID,
    hostname: "10.0.0.1",
    probeId: new ObjectID(PROBE_ID),
  });
}

// What a ping that got no echo stores, and one the probe could not even send.
const NO_ECHO: string = writeProbeFailureCause(
  ProbeFailureCause.PingNoEchoReply,
  { host: "10.0.0.1", count: 5 },
);

const IPV6_DETAIL: string = "ping6: connect: Network is unreachable";

const CANNOT_SEND_IPV6: string = writeProbeFailureCause(
  ProbeFailureCause.ProbeCannotSendIPv6,
  { host: "2001:db8::1", detail: IPV6_DETAIL },
);

const TRACEROUTE_COULD_NOT_RUN: string = writeProbeFailureCause(
  ProbeFailureCause.TracerouteCouldNotRun,
  {
    clause: writeProbeFailureCause(ProbeFailureCause.ClauseCannotSendIPv6, {
      detail: "connect: Cannot assign requested address",
    }),
  },
);

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

beforeEach(() => {
  jest.useFakeTimers();
  createMock.mockReset();
  getItemMock.mockReset();
  getDeviceMock.mockReset();
  createMock.mockResolvedValue({ data: row() });
  getDeviceMock.mockResolvedValue(device());
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  await i18next.changeLanguage("en");
});

// Runs one diagnostic to its result, in `language`.
async function run(
  language: Language,
  button: "ping" | "traceroute",
  result: NetworkDeviceDiagnostic,
): Promise<HTMLElement> {
  getItemMock.mockResolvedValue(result);
  await i18next.changeLanguage(language);

  render(
    <DeviceDiagnostics
      networkDeviceId={new ObjectID(DEVICE_ID)}
      modelAPI={fakeModelAPI}
    />,
  );

  await act(async () => {});
  await act(async () => {
    fireEvent.click(screen.getByTestId(`network-device-diagnostic-${button}`));
  });
  await act(async () => {
    jest.advanceTimersByTime(DIAGNOSTIC_POLL_INTERVAL_IN_MS);
  });

  return screen.getByTestId("network-device-diagnostic-result");
}

// The reader's wording of a cause, its placeholders filled.
function wording(
  language: Language,
  cause: ProbeFailureCause,
  values: Record<string, string>,
): string {
  let text: string = readDashboardLocale(language)[
    PROBE_FAILURE_CAUSES[cause]
  ] as string;

  for (const name of Object.keys(values)) {
    text = text.split(`{{${name}}}`).join(values[name] as string);
  }

  return text;
}

function plain(text: string | null): string {
  return withoutIsolateMarks(text || "")
    .split(NO_BREAK_SPACE)
    .join(" ");
}

const NO_ECHO_PING: NetworkDeviceDiagnostic = row({
  status: "Completed",
  hostname: "10.0.0.1",
  pingResult: {
    isOnline: false,
    failureCause: NO_ECHO,
    pingResponse: {
      packetsSent: 5,
      packetsReceived: 0,
      packetLossPercent: 100,
      minRoundTripTimeInMs: undefined,
      maxRoundTripTimeInMs: undefined,
      avgRoundTripTimeInMs: undefined,
      jitterInMs: undefined,
    },
  },
} as Partial<NetworkDeviceDiagnostic>);

describe("the view model marks a ping's Reason as the probe's message", () => {
  test("a Reason row carries the probe's message as stored, for the drawer to word", () => {
    const summary: ReturnType<typeof describePingResult> = describePingResult(
      NO_ECHO_PING.pingResult!,
      "10.0.0.1",
    );
    const reason: { value: string; isProbeMessage?: boolean | undefined } =
      summary.rows.find((candidate: { label: string }): boolean => {
        return candidate.label === "Reason";
      })!;

    expect(reason.value).toBe(NO_ECHO);
    expect(reason.isProbeMessage).toBe(true);

    // The statistic rows are the drawer's own words, not a probe's message.
    for (const statistic of summary.rows.filter(
      (candidate: { label: string }): boolean => {
        return candidate.label !== "Reason";
      },
    )) {
      expect(statistic.isProbeMessage).toBeUndefined();
    }
  });
});

describe.each(LANGUAGES)(
  "a device's diagnostics, in %s",
  (language: Language) => {
    test("a ping's Reason: the probe's sentence in the reader's words, its host and count as found", async () => {
      const result: HTMLElement = await run(language, "ping", NO_ECHO_PING);
      const line: HTMLElement = within(result).getByTestId(
        PROBE_MESSAGE_LINE_TEST_ID,
      );

      if (language === "en") {
        expect(line.textContent).toBe(NO_ECHO);

        return;
      }

      expect(plain(line.textContent)).toBe(
        wording(language, ProbeFailureCause.PingNoEchoReply, {
          host: "10.0.0.1",
          count: language === "fa" ? "۵" : "5",
        }),
      );
      expect(line).not.toHaveAttribute("dir");

      if (RIGHT_TO_LEFT.includes(language)) {
        expect(line.textContent).toContain(isolated("10.0.0.1"));
      }
    });

    test("a ping the probe could not send: why, in the reader's words, the OS's own as written", async () => {
      const result: HTMLElement = await run(
        language,
        "ping",
        row({
          status: "Completed",
          hostname: "2001:db8::1",
          pingResult: { isOnline: false, failureCause: CANNOT_SEND_IPV6 },
        } as Partial<NetworkDeviceDiagnostic>),
      );
      const text: string = plain(
        within(result).getByTestId(PROBE_MESSAGE_LINE_TEST_ID).textContent,
      );

      if (language === "en") {
        expect(text).toBe(CANNOT_SEND_IPV6);

        return;
      }

      expect(text).toBe(
        wording(language, ProbeFailureCause.ProbeCannotSendIPv6, {
          host: "2001:db8::1",
          detail: IPV6_DETAIL,
        }),
      );
    });

    test("a traceroute's note: the probe's sentence in the reader's words", async () => {
      const result: HTMLElement = await run(
        language,
        "traceroute",
        row({
          status: "Completed",
          traceRouteResult: {
            timestamp: new Date("2026-11-15T10:00:00Z"),
            traceRoute: {
              destinationAddress: "2001:db8::1",
              destinationHostName: undefined,
              isComplete: false,
              totalHops: 0,
              failedHop: undefined,
              failureMessage: TRACEROUTE_COULD_NOT_RUN,
              hops: [],
            },
          },
        } as Partial<NetworkDeviceDiagnostic>),
      );
      const text: string = plain(
        within(result).getByTestId(PROBE_MESSAGE_LINE_TEST_ID).textContent,
      );

      expect(text).toContain("connect: Cannot assign requested address");

      if (language === "en") {
        expect(text).toBe(TRACEROUTE_COULD_NOT_RUN);

        return;
      }

      expect(text).not.toContain("Traceroute could not run");
      expect(text).not.toContain("cannot send IPv6 traffic");
    });

    test("a message no probe writes today: as written, in a line of its own direction", async () => {
      const newer: string = "ping: sendmsg: Operation not permitted";
      const result: HTMLElement = await run(
        language,
        "ping",
        row({
          status: "Completed",
          hostname: "10.0.0.1",
          pingResult: { isOnline: false, failureCause: newer },
        } as Partial<NetworkDeviceDiagnostic>),
      );
      const line: HTMLElement = within(result).getByTestId(
        PROBE_MESSAGE_LINE_TEST_ID,
      );

      expect(line.textContent).toBe(newer);
      expect(line.getAttribute("dir")).toBe(
        RIGHT_TO_LEFT.includes(language) ? "ltr" : null,
      );
    });
  },
);
