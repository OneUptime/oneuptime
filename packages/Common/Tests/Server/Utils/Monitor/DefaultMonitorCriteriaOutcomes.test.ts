/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SslMonitorResponse from "../../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import DomainMonitorResponse from "../../../../Types/Monitor/DomainMonitor/DomainMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * What a NEW monitor does on day one, decided by the real evaluator.
 *
 * The default criteria are only worth something if they read a real check
 * the way a person would: a health endpoint answering 204 is up, a site
 * answering 503 is down, a certificate with ten days left deserves a
 * heads-up but is not an outage. These tests seed a monitor step exactly as
 * the dashboard does (MonitorStep.getDefaultMonitorStep) and push probe
 * results through MonitorCriteriaEvaluator.processMonitorStep, which acts on
 * the FIRST criteria that matches - so the order the defaults come in is
 * under test too, not just their filters.
 *
 * The outcomes are named by what the matched criteria does, not by its
 * position:
 *   - "offline": sets the offline status and opens an incident,
 *   - "expires soon": raises an alert and leaves the status alone,
 *   - "online": sets the operational status and raises nothing,
 *   - "no criteria": nothing matched, so the monitor falls back to its
 *     default status.
 */

type Outcome = "offline" | "expires soon" | "online" | "no criteria";

const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();
const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();
const INCIDENT_SEVERITY_ID: ObjectID = ObjectID.generate();
const ALERT_SEVERITY_ID: ObjectID = ObjectID.generate();
const WARNING_ALERT_SEVERITY_ID: ObjectID = ObjectID.generate();

const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

function fromNow(ms: number): Date {
  return new Date(Date.now() + ms);
}

function defaultStepFor(monitorType: MonitorType): MonitorStep {
  return MonitorStep.getDefaultMonitorStep({
    monitorName: "Acme",
    monitorType: monitorType,
    onlineMonitorStatusId: ONLINE_STATUS_ID,
    offlineMonitorStatusId: OFFLINE_STATUS_ID,
    defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
    defaultAlertSeverityId: ALERT_SEVERITY_ID,
    warningAlertSeverityId: WARNING_ALERT_SEVERITY_ID,
  });
}

function criteriaOf(monitorStep: MonitorStep): Array<MonitorCriteriaInstance> {
  return (
    monitorStep.data?.monitorCriteria.data?.monitorCriteriaInstanceArray || []
  );
}

// What a criteria does when it matches, read off the criteria itself.
function outcomeOf(instance: MonitorCriteriaInstance): Outcome {
  const data: MonitorCriteriaInstance["data"] = instance.data!;

  if (
    data.createIncidents &&
    data.changeMonitorStatus &&
    data.monitorStatusId?.toString() === OFFLINE_STATUS_ID.toString()
  ) {
    return "offline";
  }

  if (data.createAlerts && !data.createIncidents && !data.changeMonitorStatus) {
    return "expires soon";
  }

  if (
    data.changeMonitorStatus &&
    !data.createIncidents &&
    !data.createAlerts &&
    data.monitorStatusId?.toString() === ONLINE_STATUS_ID.toString()
  ) {
    return "online";
  }

  throw new Error(`Criteria "${data.name}" does none of the expected things`);
}

function probeResponse(
  data: Partial<ProbeMonitorResponse>,
): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date(),
    ...data,
  };
}

interface Evaluation {
  outcome: Outcome;
  matched: MonitorCriteriaInstance | undefined;
  response: ProbeApiIngestResponse;
}

async function evaluate(
  monitorType: MonitorType,
  dataToProcess: ProbeMonitorResponse,
): Promise<Evaluation> {
  const monitorStep: MonitorStep = defaultStepFor(monitorType);

  const monitor: Monitor = new Monitor();
  monitor.id = dataToProcess.monitorId;
  monitor.projectId = dataToProcess.projectId;
  monitor.monitorType = monitorType;

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: dataToProcess,
      monitorStep: monitorStep,
      monitor: monitor,
      probeApiIngestResponse: {
        monitorId: dataToProcess.monitorId,
        rootCause: null,
      },
      evaluationSummary: {
        evaluatedAt: new Date(),
        criteriaResults: [],
        events: [],
      } as MonitorEvaluationSummary,
    });

  const matched: MonitorCriteriaInstance | undefined = criteriaOf(
    monitorStep,
  ).find((instance: MonitorCriteriaInstance) => {
    return instance.data?.id === response.criteriaMetId;
  });

  return {
    outcome: matched ? outcomeOf(matched) : "no criteria",
    matched: matched,
    response: response,
  };
}

function httpResponse(data: {
  statusCode?: number | undefined;
  isOnline?: boolean | undefined;
  isTimeout?: boolean | undefined;
}): ProbeMonitorResponse {
  return probeResponse({
    isOnline: data.isOnline ?? true,
    isTimeout: data.isTimeout ?? false,
    responseCode: data.statusCode,
    responseTimeInMs: 120,
    responseBody: "ok",
    responseHeaders: {},
  });
}

function sslResponse(data: {
  isOnline?: boolean | undefined;
  sslResponse?: SslMonitorResponse | undefined;
}): ProbeMonitorResponse {
  return probeResponse({
    isOnline: data.isOnline ?? true,
    responseTimeInMs: 80,
    sslResponse: data.sslResponse,
  });
}

function validCertificateExpiringIn(ms: number): SslMonitorResponse {
  return {
    isValidCertificate: true,
    isSelfSigned: false,
    commonName: "acme.example.com",
    createdAt: fromNow(-60 * DAY_IN_MS),
    expiresAt: fromNow(ms),
  };
}

function domainResponse(data: {
  isOnline?: boolean | undefined;
  expiresDate?: Date | undefined;
}): ProbeMonitorResponse {
  const domain: DomainMonitorResponse = {
    isOnline: data.isOnline ?? true,
    responseTimeInMs: 200,
    failureCause: data.isOnline === false ? "TLD is not supported." : "",
    domainName: "acme.example",
    registrar: "Example Registrar",
    expiresDate: data.expiresDate?.toISOString(),
  };

  return probeResponse({
    isOnline: data.isOnline ?? true,
    responseTimeInMs: 200,
    domainResponse: domain,
  });
}

const HTTP_MONITOR_TYPES: Array<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
];

describe("What a new monitor does with the criteria it starts with", () => {
  describe.each(HTTP_MONITOR_TYPES)(
    "%s monitor",
    (monitorType: MonitorType) => {
      test.each([
        200, 201, 202, 203, 204, 205, 206, 226, 299, 300, 301, 302, 303, 304,
        307, 308, 399,
      ])(
        "an answer with status %s counts as online",
        async (statusCode: number) => {
          const evaluation: Evaluation = await evaluate(
            monitorType,
            httpResponse({ statusCode: statusCode }),
          );

          expect(evaluation.outcome).toBe("online");
        },
      );

      test.each([
        400, 401, 403, 404, 405, 408, 409, 410, 422, 429, 499, 500, 501, 502,
        503, 504, 599,
      ])(
        "an answer with error status %s takes it offline and opens an incident",
        async (statusCode: number) => {
          const evaluation: Evaluation = await evaluate(
            monitorType,
            httpResponse({ statusCode: statusCode }),
          );

          expect(evaluation.outcome).toBe("offline");
          expect(evaluation.matched?.data?.createIncidents).toBe(true);
          expect(evaluation.response.rootCause).toContain(String(statusCode));
        },
      );

      /*
       * The online and offline criteria are exact complements, so a status
       * code below 200 cannot slip between them and leave the monitor on its
       * default status.
       */
      test.each([100, 101, 199])(
        "an informational status %s is not mistaken for a healthy answer",
        async (statusCode: number) => {
          const evaluation: Evaluation = await evaluate(
            monitorType,
            httpResponse({ statusCode: statusCode }),
          );

          expect(evaluation.outcome).toBe("offline");
        },
      );

      test("an endpoint that does not answer at all is offline", async () => {
        const evaluation: Evaluation = await evaluate(
          monitorType,
          httpResponse({ isOnline: false, statusCode: undefined }),
        );

        expect(evaluation.outcome).toBe("offline");
      });

      test("a request that timed out is offline", async () => {
        const evaluation: Evaluation = await evaluate(
          monitorType,
          httpResponse({
            isOnline: false,
            isTimeout: true,
            statusCode: undefined,
          }),
        );

        expect(evaluation.outcome).toBe("offline");
      });

      /*
       * The regression this change exists for. The defaults used to say
       * "online = status Equal To 200, offline = status Not Equal To 200", so
       * a health check answering 201 or 204, or a redirect watched with "Do
       * not follow redirects" on, opened a Critical incident the moment the
       * monitor was created.
       */
      test.each([201, 204, 301, 302])(
        "a %s no longer opens an incident on a brand new monitor",
        async (statusCode: number) => {
          const evaluation: Evaluation = await evaluate(
            monitorType,
            httpResponse({ statusCode: statusCode }),
          );

          expect(evaluation.outcome).not.toBe("offline");
          expect(evaluation.matched?.data?.createIncidents).toBe(false);
        },
      );
    },
  );

  describe("SSL Certificate monitor", () => {
    test.each([
      ["a year", 365 * DAY_IN_MS],
      ["90 days", 90 * DAY_IN_MS],
      ["15 days", 15 * DAY_IN_MS + HOUR_IN_MS],
    ])(
      "a valid certificate with %s left is online",
      async (_label: string, ms: number) => {
        const evaluation: Evaluation = await evaluate(
          MonitorType.SSLCertificate,
          sslResponse({ sslResponse: validCertificateExpiringIn(ms) }),
        );

        expect(evaluation.outcome).toBe("online");
      },
    );

    test.each([
      ["14 days", 14 * DAY_IN_MS + HOUR_IN_MS],
      ["13 days", 13 * DAY_IN_MS + HOUR_IN_MS],
      ["a week", 7 * DAY_IN_MS],
      ["a day", DAY_IN_MS + HOUR_IN_MS],
      ["two hours", 2 * HOUR_IN_MS],
    ])(
      "a valid certificate with %s left raises an 'expires soon' alert",
      async (_label: string, ms: number) => {
        const evaluation: Evaluation = await evaluate(
          MonitorType.SSLCertificate,
          sslResponse({ sslResponse: validCertificateExpiringIn(ms) }),
        );

        expect(evaluation.outcome).toBe("expires soon");
      },
    );

    test("the 'expires soon' warning is an alert at the warning severity, never an incident, and leaves the status alone", async () => {
      const evaluation: Evaluation = await evaluate(
        MonitorType.SSLCertificate,
        sslResponse({
          sslResponse: validCertificateExpiringIn(10 * DAY_IN_MS),
        }),
      );

      const matched: MonitorCriteriaInstance = evaluation.matched!;

      expect(matched.data?.name).toBe("Check if Acme certificate expires soon");
      expect(matched.data?.createAlerts).toBe(true);
      expect(matched.data?.createIncidents).toBe(false);
      expect(matched.data?.incidents).toEqual([]);
      expect(matched.data?.changeMonitorStatus).toBe(false);
      expect(matched.data?.monitorStatusId).toBeUndefined();
      expect(matched.data?.alerts).toHaveLength(1);
      expect(matched.data?.alerts[0]?.title).toBe(
        "Acme certificate expires soon",
      );
      expect(matched.data?.alerts[0]?.alertSeverityId?.toString()).toBe(
        WARNING_ALERT_SEVERITY_ID.toString(),
      );
      // The renewal resolves it: the online criteria matches next time.
      expect(matched.data?.alerts[0]?.autoResolveAlert).toBe(true);

      // The person reading the alert sees how close the expiry is.
      expect(evaluation.response.rootCause).toContain(
        "Check if Acme certificate expires soon",
      );
    });

    test("an expired certificate is offline, not merely 'expires soon'", async () => {
      const evaluation: Evaluation = await evaluate(
        MonitorType.SSLCertificate,
        sslResponse({
          sslResponse: {
            isValidCertificate: false,
            certificateValidationErrorCode: "CERT_HAS_EXPIRED",
            certificateValidationError: "certificate has expired",
            isSelfSigned: false,
            expiresAt: fromNow(-DAY_IN_MS),
          },
        }),
      );

      expect(evaluation.outcome).toBe("offline");
      expect(evaluation.matched?.data?.incidents[0]?.title).toBe(
        "Acme certificate is not valid",
      );
    });

    test.each([
      [
        "a self-signed certificate",
        {
          isValidCertificate: false,
          certificateValidationErrorCode: "DEPTH_ZERO_SELF_SIGNED_CERT",
          isSelfSigned: true,
          expiresAt: fromNow(200 * DAY_IN_MS),
        },
      ],
      [
        "a certificate for another host name",
        {
          isValidCertificate: false,
          certificateValidationErrorCode: "ERR_TLS_CERT_ALTNAME_INVALID",
          certificateValidationError:
            "Hostname/IP does not match certificate's altnames",
          isSelfSigned: false,
          expiresAt: fromNow(200 * DAY_IN_MS),
        },
      ],
      [
        "an untrusted certificate that also expires soon",
        {
          isValidCertificate: false,
          certificateValidationErrorCode: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          isSelfSigned: false,
          expiresAt: fromNow(5 * DAY_IN_MS),
        },
      ],
    ])("%s is offline", async (_label: string, ssl: SslMonitorResponse) => {
      const evaluation: Evaluation = await evaluate(
        MonitorType.SSLCertificate,
        sslResponse({ sslResponse: ssl }),
      );

      expect(evaluation.outcome).toBe("offline");
    });

    test("an endpoint that does not answer is offline", async () => {
      const evaluation: Evaluation = await evaluate(
        MonitorType.SSLCertificate,
        sslResponse({ isOnline: false, sslResponse: undefined }),
      );

      expect(evaluation.outcome).toBe("offline");
    });

    /*
     * Probe results written before the probe recorded isValidCertificate
     * are judged on the old heuristic (not self-signed, not expired). The
     * warning has to read them the same way.
     */
    test.each([
      ["has ten days left", 10 * DAY_IN_MS, "expires soon"],
      ["has a hundred days left", 100 * DAY_IN_MS, "online"],
      ["expired yesterday", -DAY_IN_MS, "offline"],
    ])(
      "a result from an older probe for a certificate that %s reads as %s",
      async (_label: string, ms: number, expected: string) => {
        const evaluation: Evaluation = await evaluate(
          MonitorType.SSLCertificate,
          sslResponse({
            sslResponse: {
              isSelfSigned: false,
              expiresAt: fromNow(ms),
            },
          }),
        );

        expect(evaluation.outcome).toBe(expected);
      },
    );
  });

  describe("Domain monitor", () => {
    test.each([
      ["a year", 365 * DAY_IN_MS],
      ["31 days", 31 * DAY_IN_MS],
    ])(
      "a registration with %s left is online",
      async (_label: string, ms: number) => {
        const evaluation: Evaluation = await evaluate(
          MonitorType.Domain,
          domainResponse({ expiresDate: fromNow(ms) }),
        );

        expect(evaluation.outcome).toBe("online");
      },
    );

    test.each([
      ["30 days", 30 * DAY_IN_MS - HOUR_IN_MS],
      ["two weeks", 14 * DAY_IN_MS],
      ["a day", DAY_IN_MS],
      ["an hour", HOUR_IN_MS],
    ])(
      "a registration with %s left raises an 'expires soon' alert",
      async (_label: string, ms: number) => {
        const evaluation: Evaluation = await evaluate(
          MonitorType.Domain,
          domainResponse({ expiresDate: fromNow(ms) }),
        );

        expect(evaluation.outcome).toBe("expires soon");
        expect(evaluation.matched?.data?.name).toBe(
          "Check if Acme domain expires soon",
        );
        expect(evaluation.matched?.data?.alerts[0]?.title).toBe(
          "Acme domain expires soon",
        );
        expect(
          evaluation.matched?.data?.alerts[0]?.alertSeverityId?.toString(),
        ).toBe(WARNING_ALERT_SEVERITY_ID.toString());
        expect(evaluation.matched?.data?.changeMonitorStatus).toBe(false);
        expect(evaluation.matched?.data?.createIncidents).toBe(false);
      },
    );

    test("an expired registration is offline and opens an incident", async () => {
      const evaluation: Evaluation = await evaluate(
        MonitorType.Domain,
        domainResponse({ expiresDate: fromNow(-DAY_IN_MS) }),
      );

      expect(evaluation.outcome).toBe("offline");
    });

    test("a registration that cannot be read is offline", async () => {
      const evaluation: Evaluation = await evaluate(
        MonitorType.Domain,
        domainResponse({ isOnline: false, expiresDate: undefined }),
      );

      expect(evaluation.outcome).toBe("offline");
    });

    /*
     * Some registries publish no expiry date. Nothing can be said about
     * when such a domain expires, so the warning must not guess - it stays
     * quiet, as the online criteria does, and the monitor keeps its default
     * status.
     */
    test("a registration with no published expiry date raises no warning", async () => {
      const evaluation: Evaluation = await evaluate(
        MonitorType.Domain,
        domainResponse({ expiresDate: undefined }),
      );

      expect(evaluation.outcome).toBe("no criteria");
    });
  });

  describe("monitor types without an expiry warning are unchanged by it", () => {
    test.each([MonitorType.Ping, MonitorType.Port, MonitorType.IP])(
      "%s keeps just its offline and online criteria",
      (monitorType: MonitorType) => {
        expect(
          criteriaOf(defaultStepFor(monitorType)).map(
            (instance: MonitorCriteriaInstance) => {
              return outcomeOf(instance);
            },
          ),
        ).toEqual(["offline", "online"]);
      },
    );
  });
});
