/*
 * The root cause's Request Failed Details, as the engine writes them, read
 * by an incident's or alert's reader in their own language (#8001, #8004).
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import RequestFailedDetailsUtil from "../../../../Utils/RequestFailedDetailsUtil";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../../Types/Exception/EgressGuardException";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import MonitorRootCauseWording from "../../../../Utils/Monitor/MonitorRootCauseWording";
import {
  REQUEST_FAILURE_DESCRIPTIONS,
  RequestFailureDescription,
} from "../../../../Utils/Monitor/RequestFailureDescriptions";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import { describe, expect, jest, test } from "@jest/globals";

type EvaluatorPrivate = {
  buildRootCauseContext: (input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }) => Promise<MarkdownText | null>;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

const URL_CHECKED: string = "https://shop.example.com/health";

function codeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code: code });
}

// The Request Details and Request Failed Details the engine writes.
async function requestSections(error: unknown): Promise<string> {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = MonitorType.Website;

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.setMonitorDestination(URL.fromString(URL_CHECKED));

  const probeResponse: ProbeMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date("2026-11-15T09:15:00.000Z"),
    isOnline: false,
    isTimeout: false,
    requestFailedDetails:
      RequestFailedDetailsUtil.getRequestFailedDetails(error),
  };

  const context: MarkdownText | null = await Evaluator.buildRootCauseContext({
    dataToProcess: probeResponse,
    monitorStep: monitorStep,
    monitor: monitor,
  });

  return context!.toString();
}

// The engine's opening, then its sections.
async function rootCause(error: unknown): Promise<string> {
  return `${mdText`
**Created because the following criteria was met**:

**Criteria Name**: ${"Website is down"}
`.toString()}\n${await requestSections(error)}`;
}

const lineStarting: (text: string, start: string) => string = (
  text: string,
  start: string,
): string => {
  return (
    text.split("\n").find((line: string): boolean => {
      return line.startsWith(start);
    }) || ""
  );
};

const word: (
  stored: string,
  language: string,
  setsValuesApart?: boolean,
) => string = (
  stored: string,
  language: string,
  setsValuesApart: boolean = true,
): string => {
  return MonitorRootCauseWording.wordRootCause({
    rootCause: stored,
    translator: dashboardTranslator(language),
    setsValuesApart: setsValuesApart,
  });
};

const descriptionLabel: (language: string) => string = (
  language: string,
): string => {
  return `- ${readDashboardLocale(language)["Error Description"]}: `;
};

const REFUSED: Error = codeError(
  "ECONNREFUSED",
  "connect ECONNREFUSED 203.0.113.7:443",
);

describe("the root cause's Error Description, as the engine wrote it", () => {
  test.each([
    [
      "a refused connection",
      REFUSED,
      RequestFailureDescription.ConnectionRefused,
    ],
    [
      "a certificate that expired",
      new Error("certificate has expired"),
      RequestFailureDescription.CertificateExpired,
    ],
    [
      "a TLS handshake",
      new Error("TLS handshake failed"),
      RequestFailureDescription.TlsHandshakeFailed,
    ],
    [
      "a target the guard could not reach",
      new EgressGuardException(
        "Monitor target host shop.example.com could not be reached.",
        EgressFailureReason.Unreachable,
      ),
      RequestFailureDescription.TargetUnreachable,
    ],
  ] as Array<[string, unknown, RequestFailureDescription]>)(
    "%s reads in German and Persian",
    async (_name: string, error: unknown, id: RequestFailureDescription) => {
      const stored: string = await rootCause(error);
      const english: string = REQUEST_FAILURE_DESCRIPTIONS[id];

      expect(lineStarting(stored, "- Error Description: ")).toBe(
        mdText`- Error Description: ${english}`.toString(),
      );

      for (const language of ["de", "fa"]) {
        const worded: string = word(stored, language);

        expect(lineStarting(worded, descriptionLabel(language))).toBe(
          mdText`- ${readDashboardLocale(language)["Error Description"]!}: ${readDashboardLocale(language)[english]!}`.toString(),
        );
        expect(worded).not.toContain(english);
      }
    },
  );

  test("in German: an HTTP status as the server sent it", async () => {
    const worded: string = word(
      await rootCause(
        Object.assign(new Error("Request failed with status code 503"), {
          isAxiosError: true,
          response: { status: 503, data: {}, headers: {} },
          toJSON: (): Record<string, unknown> => {
            return {};
          },
        }),
      ),
      "de",
    );

    expect(lineStarting(worded, descriptionLabel("de"))).toBe(
      `${descriptionLabel("de")}Der Server hat mit HTTP-Status 503 geantwortet. Das deutet auf einen Fehler auf dem Server hin.`,
    );
  });

  test("in Persian: an invalid target's own message kept as written, set apart", async () => {
    const message: string = "Monitor target URL *is* not valid: [htp://x]";
    const stored: string = await rootCause(
      new EgressGuardException(message, EgressFailureReason.InvalidTarget),
    );
    const worded: string = word(stored, "fa");
    const line: string = lineStarting(worded, descriptionLabel("fa"));

    // Its Markdown escaped as the engine escaped it, inside the isolate.
    expect(line).toContain(isolated(mdText`${message}`.toString()));
    expect(line).not.toContain("The monitor's target");
    expect(withoutIsolateMarks(word(stored, "fa", false))).toBe(
      withoutIsolateMarks(worded),
    );
  });

  test("in English: the root cause as stored", async () => {
    const stored: string = await rootCause(REFUSED);

    expect(word(stored, "en")).toBe(stored);
  });

  test("an Error Description somebody edited stays as they wrote it", async () => {
    const stored: string = (await rootCause(REFUSED)).replace(
      "a firewall is blocking the connection.",
      "a firewall is blocking the connection. We changed the port.",
    );
    const line: string = lineStarting(
      word(stored, "de"),
      descriptionLabel("de"),
    );

    expect(line).toContain("We changed the port.");
    expect(line).toContain("Connection refused.");
  });

  test("an Error Description no probe writes stays as written", async () => {
    const stored: string = `${await rootCause(REFUSED)}`.replace(
      mdText`- Error Description: ${REQUEST_FAILURE_DESCRIPTIONS[RequestFailureDescription.ConnectionRefused]}`.toString(),
      "- Error Description: The QUIC handshake did not finish.",
    );

    expect(lineStarting(word(stored, "de"), descriptionLabel("de"))).toBe(
      `${descriptionLabel("de")}The QUIC handshake did not finish.`,
    );
  });
});

describe("on a Persian or Arabic page, each stored value set apart from its label", () => {
  test.each(["fa", "ar"])(
    "in %s: the criteria's name, the address, the code and the network's message",
    async (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const worded: string = word(await rootCause(REFUSED), language);

      expect(worded).toContain(
        `**${words["Criteria Name"]}**: ${isolated("Website is down")}`,
      );
      expect(worded).toContain(
        `- ${words["Destination"]}: ${isolated(URL_CHECKED)}`,
      );
      expect(worded).toContain(
        `- ${words["Error Code"]}: ${isolated("ECONNREFUSED")}`,
      );
      expect(lineStarting(worded, `- ${words["Raw Error Message"]}: `)).toBe(
        `- ${words["Raw Error Message"]}: ${isolated("connect ECONNREFUSED 203.0.113.7:443")}`,
      );
    },
  );

  test("what reads in the reader's language is not set apart", async () => {
    const words: Record<string, string> = readDashboardLocale("fa");
    const worded: string = word(await rootCause(REFUSED), "fa");

    expect(lineStarting(worded, `- ${words["Failed Phase"]}: `)).toBe(
      `- ${words["Failed Phase"]}: ${words["TCP Connection"]}`,
    );
    expect(lineStarting(worded, descriptionLabel("fa"))).not.toMatch(/[⁦-⁩]/);
  });

  test("in German, English values read the line's way and are left as they are", async () => {
    const worded: string = word(await rootCause(REFUSED), "de");

    expect(worded).toBe(withoutIsolateMarks(worded));
    expect(worded).toContain(
      `**${readDashboardLocale("de")["Criteria Name"]}**: Website is down`,
    );
  });

  test("not drawn on the page: no isolate's marks", async () => {
    const worded: string = word(await rootCause(REFUSED), "fa", false);

    expect(worded).toBe(withoutIsolateMarks(worded));
  });
});
