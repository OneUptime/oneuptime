import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import { DestinationTransport } from "../../../../../Server/Utils/SecurityEvent/Destinations/BatchSender";
import { JSONObject } from "../../../../../Types/JSON";
import { SecurityEventRecord } from "../../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";

/*
 * A fake SIEM for the Splunk, Microsoft Sentinel and Elastic sender suites:
 * the transport the senders send through, answering as a test asks and
 * recording every request. An answer that is not 2xx is thrown the way
 * DataSourceHttpFetch throws it ("Data source responded with HTTP 400:
 * <body>"), so the senders read it exactly as they would in production.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface FakeReply {
  status: number;
  body?: unknown;
  // No answer at all: a refused connection.
  unreachable?: boolean | undefined;
}

export interface FakeSiem {
  transport: DestinationTransport;
  requests: Array<DataSourceHttpRequest>;
}

export function fakeSiem(
  reply: (request: DataSourceHttpRequest, index: number) => FakeReply = () => {
    return { status: 200, body: {} };
  },
): FakeSiem {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      const index: number = requests.length;

      requests.push(request);

      const answer: FakeReply = reply(request, index);

      if (answer.unreachable) {
        throw new Error("connect ECONNREFUSED 203.0.113.10:443");
      }

      const bodyText: string =
        answer.body === undefined
          ? ""
          : typeof answer.body === "string"
            ? answer.body
            : JSON.stringify(answer.body);

      if (answer.status < 200 || answer.status >= 300) {
        throw new Error(
          `Data source responded with HTTP ${answer.status}: ${bodyText.substring(0, 500)}`,
        );
      }

      let bodyJson: unknown = undefined;

      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        bodyJson = undefined;
      }

      return { statusCode: answer.status, bodyText, bodyJson, headers: {} };
    },
  };
}

// A request's body, as the lines it carries (Splunk's events, Elastic's bulk).
export function bodyLines(request: DataSourceHttpRequest): Array<JSONObject> {
  return String(request.body || "")
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim().length > 0;
    })
    .map((line: string): JSONObject => {
      return JSON.parse(line) as JSONObject;
    });
}

export const noSleep: (
  delayInMs: number,
) => Promise<void> = async (): Promise<void> => {
  return;
};

let sequence: number = 0;

export function securityRecord(
  overrides: Partial<SecurityEventRecord> = {},
): SecurityEventRecord {
  sequence++;

  return {
    id: `0193c0de-cccc-4aaa-8bbb-${String(sequence).padStart(12, "0")}`,
    time: new Date("2026-10-21T10:00:00.000Z"),
    createdAt: new Date("2026-10-21T10:00:05.000Z"),
    eventUid: `event-${sequence}`,
    categoryUid: 3,
    categoryName: "Identity & Access Management",
    classUid: 3002,
    className: "Authentication",
    activityName: "Logon",
    severityId: 3,
    severityName: "Medium",
    statusName: "Failure",
    message: `Failed sign-in ${sequence}`,
    vendorName: "Okta",
    productName: "Okta System Log",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: "alice@example.com",
    principalHost: "laptop-7",
    principalIp: "203.0.113.7",
    principalProcess: "",
    processName: "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser: "",
    targetHost: "app.example.com",
    targetIp: "198.51.100.20",
    targetPort: 443,
    targetResource: "",
    observables: ["alice@example.com", "203.0.113.7"],
    attributes: { "okta.outcome.reason": "INVALID_CREDENTIALS" },
    ...overrides,
  };
}

export function securityRecords(count: number): Array<SecurityEventRecord> {
  const records: Array<SecurityEventRecord> = [];

  for (let index: number = 0; index < count; index++) {
    records.push(securityRecord());
  }

  return records;
}
