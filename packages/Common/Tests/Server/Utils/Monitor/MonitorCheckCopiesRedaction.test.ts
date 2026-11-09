/*
 * EVERY COPY OF A CHECK A READER CAN SEE IS CUT BY THE SAME RULES.
 * https://github.com/OneUptime/oneuptime/issues/6341
 *
 * An incident's evaluation details were cut by MonitorEvidenceRedaction's
 * rules (#6339), while the monitor's own copies of the same check kept the
 * whole response with only credential-named fields masked. Everyone who
 * can read the monitor - Viewer included - can read each of these copies:
 *
 *   - a row of the monitor's logs (MonitorLog.logBody);
 *   - the log of a status change (MonitorStatusTimeline.statusChangeLog);
 *   - the check an incident or an alert keeps (createdStateLog);
 *   - a probe's latest check, as a reader gets it
 *     (MonitorProbe.lastMonitoringLog, MonitorProbeService.onFindSuccess);
 *   - a Test Monitor run's result (MonitorTest.monitorStepProbeResponse),
 *     which the probe ran with the monitor secrets filled in.
 *
 * Each rule runs here on each of them, with payloads shaped as the probes,
 * the agents and the senders send them: a JSON API, an HTML page, a plain
 * text error, headers, a script's run, a server's report, an incoming
 * request and an incoming email - and the monitor's Keep response content
 * switch on and off. A test's result keeps the content either way: seeing
 * the response is what a test is run for.
 *
 * The monitor's logs flush through MonitorLogUtil's own shutdown handler,
 * as in MonitorLogUtilRedaction.test.ts.
 */

const mockShutdown: { callback: (() => Promise<void> | void) | null } = {
  callback: null,
};

jest.mock("../../../../Server/Utils/GracefulShutdown", () => {
  return {
    __esModule: true,
    default: {
      registerHandler: (
        _name: string,
        _priority: number,
        callback: () => Promise<void> | void,
      ): void => {
        mockShutdown.callback = callback;
      },
    },
    ShutdownPriority: {
      HttpServer: 10,
      Workers: 20,
      Buffers: 30,
      DataStores: 40,
      Telemetry: 50,
    },
  };
});

jest.mock("../../../../Server/Services/MonitorLogService", () => {
  return {
    __esModule: true,
    default: {
      insertJsonRows: jest.fn(() => {
        return Promise.resolve();
      }),
    },
  };
});

jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(() => {
        return Promise.resolve({ monitorLogRetentionInDays: 7 });
      }),
    },
  };
});

import MonitorLogService from "../../../../Server/Services/MonitorLogService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorRecordEvidence from "../../../../Server/Utils/Monitor/MonitorRecordEvidence";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { OnFind } from "../../../../Server/Types/Database/Hooks";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const REDACTED: string = "[REDACTED]";

const PROJECT_ID: ObjectID = new ObjectID(
  "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a",
);
const PROBE_ID: ObjectID = new ObjectID("2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b");
const CURRENT_STATUS_ID: ObjectID = new ObjectID(
  "3f4a5b6c-7d8e-4f9a-8b1c-2d3e4f5a6b7c",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "4a5b6c7d-8e9f-4a0b-9c2d-3e4f5a6b7c8d",
);

const JWT: string =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

/*
 * The destination as the step was configured, monitor secrets by name, and
 * as the probe echoed it back, with the values it was handed.
 */
const CONFIGURED_DESTINATION: string =
  "https://monitor:{{monitorSecrets.Password}}@api.acme.example/v1/health?tenant={{monitorSecrets.Tenant}}";
const ECHOED_DESTINATION: string =
  "https://monitor:pw-9911@api.acme.example/v1/health?tenant=acme-prod-7781";
const SHOWN_DESTINATION: string = `https://monitor:${REDACTED}@api.acme.example/v1/health?tenant={{monitorSecrets.Tenant}}`;

// An API's answer: a user, a session, and texts that carry a token and an address.
const API_BODY: JSONObject = {
  data: {
    users: [
      {
        id: 7,
        name: "Jane Doe",
        email: "jane@acme.example",
        phone: "+1 555 0100",
        dateOfBirth: "1990-04-12",
        role: "admin",
        active: true,
      },
    ],
    session: { id: "sess_1", expiresIn: 3600 },
  },
  meta: {
    requestId: "req-7f3a",
    count: 1,
    upstream: `called with Authorization: Bearer ${JWT}`,
    note: "billing contact: billing@acme.example",
  },
};

/*
 * What every copy keeps of it: its shape, its evidence, the fields named for
 * a credential or personal data masked - a container one masked whole - and
 * the token and the address in its texts.
 */
const API_BODY_KEPT: JSONObject = {
  data: {
    users: [
      {
        id: 7,
        name: "Jane Doe",
        email: REDACTED,
        phone: REDACTED,
        dateOfBirth: REDACTED,
        role: "admin",
        active: true,
      },
    ],
    session: REDACTED,
  },
  meta: {
    requestId: "req-7f3a",
    count: 1,
    upstream: `called with Authorization: ${REDACTED}`,
    note: `billing contact: ${REDACTED}`,
  },
};

const insertJsonRows: jest.Mock =
  MonitorLogService.insertJsonRows as unknown as jest.Mock;

function stepTo(destination: string): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.monitorDestination = URL.fromString(destination);
  return step;
}

function monitorOf(input: {
  step: MonitorStep;
  keepResponseContent?: boolean | undefined;
  monitorType?: MonitorType | undefined;
}): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [input.step],
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = input.monitorType || MonitorType.API;
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = CURRENT_STATUS_ID;

  if (input.keepResponseContent !== undefined) {
    monitor.keepResponseContent = input.keepResponseContent;
  }

  return monitor;
}

// An API or Website monitor's check, as a probe sends it.
function probeCheck(input: {
  step: MonitorStep;
  responseBody?: string | JSONObject | undefined;
  responseHeaders?: JSONObject | undefined;
  failureCause?: string | undefined;
}): JSONObject {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: input.step.id,
    probeId: PROBE_ID,
    isOnline: false,
    responseCode: 500,
    responseTimeInMs: 182,
    responseBody: input.responseBody ?? { status: "down" },
    responseHeaders: input.responseHeaders ?? {
      "content-type": "application/json",
    },
    monitorDestination: URL.fromString(ECHOED_DESTINATION),
    failureCause: input.failureCause ?? "",
    monitoredAt: new Date("2026-11-08T10:00:00.000Z"),
  } as unknown as JSONObject;
}

interface CopyInput {
  check: JSONObject;
  monitor: Monitor;
  step: MonitorStep;
}

interface CheckCopy {
  name: string;
  // Is it a probe's check only - no incoming request, email or server report?
  holdsProbeChecksOnly: boolean;
  // Is the check still being evaluated while the copy is made?
  copiesALiveCheck: boolean;
  // Does the monitor's Keep response content switch decide what it keeps?
  followsTheSwitch: boolean;
  copy: (input: CopyInput) => Promise<JSONObject>;
}

let createdTimelines: Array<MonitorStatusTimeline> = [];

const CHECK_COPIES: Array<CheckCopy> = [
  {
    name: "a row of the monitor's logs (MonitorLog.logBody)",
    holdsProbeChecksOnly: false,
    copiesALiveCheck: true,
    followsTheSwitch: true,
    copy: async (input: CopyInput): Promise<JSONObject> => {
      insertJsonRows.mockClear();

      // As MonitorResource saves it.
      MonitorLogUtil.saveMonitorLog({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        dataToProcess: input.check as unknown as DataToProcess,
        keepResponseContent: MonitorRecordEvidence.keepsResponseContent(
          input.monitor,
        ),
        monitorStep: input.step,
      });

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      await mockShutdown.callback!();

      const calls: Array<Array<unknown>> = insertJsonRows.mock
        .calls as unknown as Array<Array<unknown>>;
      const rows: Array<JSONObject> = calls[
        calls.length - 1
      ]![0] as Array<JSONObject>;

      return rows[0]!["logBody"] as JSONObject;
    },
  },
  {
    name: "a status change's log (MonitorStatusTimeline.statusChangeLog)",
    holdsProbeChecksOnly: false,
    copiesALiveCheck: true,
    followsTheSwitch: true,
    copy: async (input: CopyInput): Promise<JSONObject> => {
      createdTimelines = [];

      const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      criteria.data!.name = "Is Offline";
      criteria.data!.monitorStatusId = OFFLINE_STATUS_ID;
      criteria.data!.changeMonitorStatus = true;

      await MonitorStatusTimelineUtil.updateMonitorStatusTimeline({
        criteriaInstance: criteria,
        monitor: input.monitor,
        dataToProcess: input.check as unknown as DataToProcess,
        monitorStep: input.step,
        rootCause: "Monitor is offline",
        props: {},
      });

      expect(createdTimelines).toHaveLength(1);

      return createdTimelines[0]!.statusChangeLog!;
    },
  },
  {
    name: "the check an incident or an alert keeps (createdStateLog)",
    holdsProbeChecksOnly: false,
    copiesALiveCheck: true,
    followsTheSwitch: true,
    copy: async (input: CopyInput): Promise<JSONObject> => {
      // As MonitorIncident and MonitorAlert keep it.
      return MonitorRecordEvidence.toStoredCheck({
        dataToProcess: input.check as unknown as DataToProcess,
        keepResponseContent: MonitorRecordEvidence.keepsResponseContent(
          input.monitor,
        ),
        monitorStep: MonitorRecordEvidence.findCheckStep({
          monitor: input.monitor,
          check: input.check as unknown as DataToProcess,
        }),
      });
    },
  },
  {
    name: "a probe's latest check, as a reader gets it (MonitorProbe.lastMonitoringLog)",
    holdsProbeChecksOnly: true,
    copiesALiveCheck: false,
    followsTheSwitch: true,
    copy: async (input: CopyInput): Promise<JSONObject> => {
      jest.spyOn(MonitorService, "findBy").mockResolvedValue([input.monitor]);

      const stepId: string = input.step.id.toString();

      // As Postgres hands the column back: the check as the probe sent it.
      const row: MonitorProbe = new MonitorProbe();
      row.id = ObjectID.generate();
      row.monitorId = MONITOR_ID;
      row.lastMonitoringLog = {
        [stepId]: JSON.parse(JSON.stringify(input.check)),
      } as unknown as MonitorStepProbeResponse;

      await (
        MonitorProbeService as unknown as {
          onFindSuccess: (
            onFind: OnFind<MonitorProbe>,
            items: Array<MonitorProbe>,
          ) => Promise<OnFind<MonitorProbe>>;
        }
      ).onFindSuccess(
        {
          findBy: {
            query: {},
            select: { lastMonitoringLog: true },
            limit: 10,
            skip: 0,
            props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
          },
          carryForward: null,
        },
        [row],
      );

      return (row.lastMonitoringLog as unknown as JSONObject)[
        stepId
      ] as JSONObject;
    },
  },
  {
    name: "a Test Monitor run's result (MonitorTest.monitorStepProbeResponse)",
    holdsProbeChecksOnly: true,
    copiesALiveCheck: false,
    followsTheSwitch: false,
    copy: async (input: CopyInput): Promise<JSONObject> => {
      // As the probe ingest job keeps it, by the steps the test was written with.
      return MonitorRecordEvidence.toStoredTestResult({
        probeResponse: input.check as unknown as ProbeMonitorResponse,
        monitorSteps: input.monitor.monitorSteps,
      });
    },
  },
];

const ALL_COPIES: Array<[string, CheckCopy]> = CHECK_COPIES.map(
  (copy: CheckCopy): [string, CheckCopy] => {
    return [copy.name, copy];
  },
);

const COPIES_THAT_FOLLOW_THE_SWITCH: Array<[string, CheckCopy]> =
  ALL_COPIES.filter(([, copy]: [string, CheckCopy]): boolean => {
    return copy.followsTheSwitch;
  });

const COPIES_OF_ANY_CHECK: Array<[string, CheckCopy]> = ALL_COPIES.filter(
  ([, copy]: [string, CheckCopy]): boolean => {
    return !copy.holdsProbeChecksOnly;
  },
);

const COPIES_OF_LIVE_CHECKS: Array<[string, CheckCopy]> = ALL_COPIES.filter(
  ([, copy]: [string, CheckCopy]): boolean => {
    return copy.copiesALiveCheck;
  },
);

beforeEach(() => {
  createdTimelines = [];

  jest
    .spyOn(MonitorStatusTimelineService, "findOneBy")
    .mockResolvedValue(null as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
    .mockResolvedValue(true as never);
  jest.spyOn(MonitorStatusTimelineService, "create").mockImplementation((async (
    createBy: unknown,
  ): Promise<MonitorStatusTimeline> => {
    const timeline: MonitorStatusTimeline = (
      createBy as { data: MonitorStatusTimeline }
    ).data;

    createdTimelines.push(timeline);
    return timeline;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ALL_COPIES)("%s", (_name: string, path: CheckCopy) => {
  test("headers keep their names; a credential's value is masked, any other is read for one", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const stored: JSONObject = await path.copy({
      check: probeCheck({
        step,
        responseHeaders: {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": ["sid=s%3Aabc; Path=/; HttpOnly", "theme=dark"],
          authorization: `Bearer ${JWT}`,
          "x-api-key": "live_9f8e7d",
          location:
            "https://jane:hunter2@login.acme.example/next?token=abc123&page=2",
          "x-debug": "upstream=db-1 password=hunter2",
          "x-owner": "jane@acme.example",
          "x-upstream": ["db-1 password=hunter2", "cache-2"],
          "x-request-id": "req-7f3a",
        },
      }),
      monitor: monitorOf({ step }),
      step,
    });

    expect(stored["responseHeaders"]).toEqual({
      "content-type": "application/json; charset=utf-8",
      "set-cookie": REDACTED,
      authorization: REDACTED,
      "x-api-key": REDACTED,
      location: `https://jane:${REDACTED}@login.acme.example/next?token=${REDACTED}&page=2`,
      "x-debug": `upstream=db-1 password=${REDACTED}`,
      "x-owner": REDACTED,
      "x-upstream": [`db-1 password=${REDACTED}`, "cache-2"],
      "x-request-id": "req-7f3a",
    });
  });

  test("a JSON body keeps its shape: fields named for a credential or personal data are masked, every text is read", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const stored: JSONObject = await path.copy({
      check: probeCheck({ step, responseBody: API_BODY }),
      monitor: monitorOf({ step }),
      step,
    });

    expect(stored["responseBody"]).toEqual(API_BODY_KEPT);
  });

  /*
   * An API monitor's probe keeps the response as JSON text (ApiMonitor:
   * JSON.stringify of what it parsed). The same body as text loses the same
   * values, where they sit in it, and keeps the rest as it was written.
   */
  test("a JSON body kept as text, as an API monitor's is, loses the same fields as a parsed one and keeps its layout", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const compact: JSONObject = await path.copy({
      check: probeCheck({ step, responseBody: JSON.stringify(API_BODY) }),
      monitor: monitorOf({ step }),
      step,
    });

    expect(compact["responseBody"]).toBe(JSON.stringify(API_BODY_KEPT));

    const indented: JSONObject = await path.copy({
      check: probeCheck({
        step,
        responseBody: JSON.stringify(API_BODY, null, 2),
      }),
      monitor: monitorOf({ step }),
      step,
    });

    expect(indented["responseBody"]).toBe(
      JSON.stringify(API_BODY_KEPT, null, 2),
    );
  });

  test("a token response kept as text: the token, its type and the address are masked, the expiry kept", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const stored: JSONObject = await path.copy({
      check: probeCheck({
        step,
        responseBody:
          '{"access_token":"ya29.a0Af","token_type":"Bearer","expires_in":3599,"user":{"email":"jane@acme.example"}}',
      }),
      monitor: monitorOf({ step }),
      step,
    });

    expect(stored["responseBody"]).toBe(
      `{"access_token":"${REDACTED}","token_type":"${REDACTED}","expires_in":3599,"user":{"email":"${REDACTED}"}}`,
    );
  });

  test("a list kept as text loses its named fields; a field named for a credential keeps its name whatever it holds", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const stored: JSONObject = await path.copy({
      check: probeCheck({
        step,
        responseBody:
          '[{"id":1,"phone":"+44 20 7946 0958","apiKey":null},{"id":2,"iban":"GB33BUKB20201555555555","pin":4921,"keys":["k1","k2"]}]',
      }),
      monitor: monitorOf({ step }),
      step,
    });

    expect(stored["responseBody"]).toBe(
      `[{"id":1,"phone":"${REDACTED}","apiKey":"${REDACTED}"},{"id":2,"iban":"${REDACTED}","pin":"${REDACTED}","keys":"${REDACTED}"}]`,
    );
  });

  /*
   * As an incident's excerpt reads it: a text that is not one whole JSON
   * value - a body cut short, a JSON string - has no fields to find, so it
   * is read by the text rules alone.
   */
  test("a JSON text cut short, or a text kept as a JSON string, is read by the text rules alone", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const cutShort: JSONObject = await path.copy({
      check: probeCheck({
        step,
        responseBody:
          '{"user":{"phone":"+1 555 0100","email":"jane@acme.example","token":"tok_live_9f8e"',
      }),
      monitor: monitorOf({ step }),
      step,
    });

    expect(cutShort["responseBody"]).toBe(
      `{"user":{"phone":"+1 555 0100","email":"${REDACTED}","token":"${REDACTED}"`,
    );

    const jsonString: JSONObject = await path.copy({
      check: probeCheck({
        step,
        responseBody: JSON.stringify(
          "Service unavailable. Contact ops@acme.example, phone +1 555 0100.",
        ),
      }),
      monitor: monitorOf({ step }),
      step,
    });

    expect(jsonString["responseBody"]).toBe(
      JSON.stringify(
        `Service unavailable. Contact ${REDACTED}, phone +1 555 0100.`,
      ),
    );
  });

  test("an HTML page keeps its markup; an address, a token and a card number in it are masked", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const stored: JSONObject = await path.copy({
      check: probeCheck({
        step,
        responseHeaders: { "content-type": "text/html" },
        responseBody: `<!doctype html><html><body><h1>Sign in</h1><a href="mailto:support@acme.example">Contact</a><script>window.__TOKEN__ = "${JWT}";</script><p>Card ending 4111 1111 1111 1111</p></body></html>`,
      }),
      monitor: monitorOf({ step, monitorType: MonitorType.Website }),
      step,
    });

    expect(stored["responseBody"]).toBe(
      `<!doctype html><html><body><h1>Sign in</h1><a href="mailto:${REDACTED}">Contact</a><script>window.__TOKEN__ = ${REDACTED};</script><p>Card ending ${REDACTED}</p></body></html>`,
    );
  });

  test("a plain-text body: a bearer token, a password and a private key are masked, the rest kept", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const stored: JSONObject = await path.copy({
      check: probeCheck({
        step,
        responseHeaders: { "content-type": "text/plain" },
        responseBody: `Error: upstream refused\nAuthorization: Bearer ${JWT}\npassword=hunter2\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----\nretry in 5s`,
      }),
      monitor: monitorOf({ step }),
      step,
    });

    expect(stored["responseBody"]).toBe(
      `Error: upstream refused\nAuthorization: ${REDACTED}\npassword=${REDACTED}\n${REDACTED}\nretry in 5s`,
    );
  });

  test("the destination is the one the step was configured with: monitor secrets by name, a password masked", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const stored: JSONObject = await path.copy({
      check: probeCheck({ step }),
      monitor: monitorOf({ step }),
      step,
    });

    expect(stored["monitorDestination"]).toBe(SHOWN_DESTINATION);

    const text: string = JSON.stringify(stored);

    expect(text).not.toContain("pw-9911");
    expect(text).not.toContain("acme-prod-7781");
  });

  test("a failure's account, and every other text the check carries, is read by the text rules", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const check: JSONObject = probeCheck({
      step,
      failureCause: "connect to ops@acme.example failed: password=hunter2",
    });
    check["requestFailedDetails"] = {
      failedPhase: "TLS",
      errorDescription: "certificate for jane@acme.example rejected",
    };

    const stored: JSONObject = await path.copy({
      check,
      monitor: monitorOf({ step }),
      step,
    });

    expect(stored["failureCause"]).toBe(
      `connect to ${REDACTED} failed: password=${REDACTED}`,
    );
    expect(stored["requestFailedDetails"]).toEqual({
      failedPhase: "TLS",
      errorDescription: `certificate for ${REDACTED} rejected`,
    });
  });

  test("with the switch on, the copy does not say content was left out", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const stored: JSONObject = await path.copy({
      check: probeCheck({ step }),
      monitor: monitorOf({ step, keepResponseContent: true }),
      step,
    });

    expect(stored["responseBody"]).toEqual({ status: "down" });
    expect(stored["isResponseContentOmitted"]).toBeUndefined();
  });

  test("what OneUptime wrote is kept as it is: ids, times, numbers", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const stored: JSONObject = await path.copy({
      check: probeCheck({ step }),
      monitor: monitorOf({ step }),
      step,
    });

    expect(stored["monitorId"]).toEqual({
      _type: "ObjectID",
      value: MONITOR_ID.toString(),
    });
    expect(stored["monitorStepId"]).toEqual({
      _type: "ObjectID",
      value: step.id.toString(),
    });
    expect(stored["monitoredAt"]).toBe("2026-11-08T10:00:00.000Z");
    expect(stored["responseCode"]).toBe(500);
  });

  test("a script's result is read as a JSON body is, its error and log lines as text; its screenshots are kept", async () => {
    const step: MonitorStep = stepTo("https://www.acme.example");
    const screenshot: string =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    const stored: JSONObject = await path.copy({
      check: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        monitorStepId: step.id,
        probeId: PROBE_ID,
        isOnline: false,
        customCodeMonitorResponse: {
          result: { ok: false, apiKey: "k-1", contact: "jane@acme.example" },
          scriptError: `Error: 401 for Bearer ${JWT}`,
          logMessages: ["token=abcdef123456", "checked 3 pages"],
          executionTimeInMS: 1200,
        },
        syntheticMonitorResponse: [
          {
            result: "signed in as jane@acme.example",
            screenshots: { home: screenshot },
            scriptError: "",
            logMessages: [],
            executionTimeInMS: 3400,
          },
        ],
        monitoredAt: new Date("2026-11-08T10:00:00.000Z"),
      } as unknown as JSONObject,
      monitor: monitorOf({ step, monitorType: MonitorType.SyntheticMonitor }),
      step,
    });

    expect(stored["customCodeMonitorResponse"]).toEqual({
      result: { ok: false, apiKey: REDACTED, contact: REDACTED },
      scriptError: `Error: 401 for Bearer ${REDACTED}`,
      logMessages: [`token=${REDACTED}`, "checked 3 pages"],
      executionTimeInMS: 1200,
    });
    expect(stored["syntheticMonitorResponse"]).toEqual([
      {
        result: `signed in as ${REDACTED}`,
        screenshots: { home: screenshot },
        scriptError: "",
        logMessages: [],
        executionTimeInMS: 3400,
      },
    ]);
  });
});

describe.each(COPIES_THAT_FOLLOW_THE_SWITCH)(
  "%s",
  (_name: string, path: CheckCopy) => {
    test("a monitor that keeps no response content keeps no body and no headers, and the copy says so", async () => {
      const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

      const stored: JSONObject = await path.copy({
        check: probeCheck({
          step,
          responseBody: { status: "down", owner: "Jane Doe" },
          responseHeaders: { "content-type": "application/json" },
          failureCause: "upstream said password=hunter2",
        }),
        monitor: monitorOf({ step, keepResponseContent: false }),
        step,
      });

      expect(stored["responseBody"]).toBeUndefined();
      expect(stored["responseHeaders"]).toBeUndefined();
      expect(stored["isResponseContentOmitted"]).toBe(true);

      // Which filters matched still reads: the code, the time, the failure.
      expect(stored["responseCode"]).toBe(500);
      expect(stored["responseTimeInMs"]).toBe(182);
      expect(stored["isOnline"]).toBe(false);
      expect(stored["failureCause"]).toBe(`upstream said password=${REDACTED}`);
      expect(stored["monitorDestination"]).toBe(SHOWN_DESTINATION);
    });
  },
);

describe("a Test Monitor run's result", () => {
  /*
   * The person who runs a test reads the response to write the monitor's
   * filters. The switch is about what the monitor's logs, incidents and
   * alerts keep, and a test can be run before the monitor exists.
   */
  test("keeps the response, masked, whatever the monitor's switch says", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const stored: JSONObject = MonitorRecordEvidence.toStoredTestResult({
      probeResponse: probeCheck({
        step,
        responseBody: API_BODY,
        responseHeaders: {
          "content-type": "application/json",
          authorization: `Bearer ${JWT}`,
        },
      }) as unknown as ProbeMonitorResponse,
      monitorSteps: monitorOf({ step, keepResponseContent: false })
        .monitorSteps,
    });

    expect(stored["responseBody"]).toEqual(API_BODY_KEPT);
    expect(stored["responseHeaders"]).toEqual({
      "content-type": "application/json",
      authorization: REDACTED,
    });
    expect(stored["isResponseContentOmitted"]).toBeUndefined();
  });

  test("a step the test does not have shows the destination the probe echoed, its password and secret query values masked", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);
    const echoed: JSONObject = probeCheck({ step });
    echoed["monitorDestination"] = URL.fromString(
      "https://monitor:pw-9911@api.acme.example/v1/health?api_key=k-77&page=2",
    ) as unknown as JSONObject;

    const stored: JSONObject = MonitorRecordEvidence.toStoredTestResult({
      probeResponse: echoed as unknown as ProbeMonitorResponse,
      monitorSteps: undefined,
    });

    expect(stored["monitorDestination"]).toBe(
      `https://monitor:${REDACTED}@api.acme.example/v1/health?api_key=${REDACTED}&page=2`,
    );
    expect(JSON.stringify(stored)).not.toContain("pw-9911");
    expect(JSON.stringify(stored)).not.toContain("k-77");
  });

  test("is storable: a NUL in the body becomes U+FFFD, so Postgres takes the jsonb merge", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);

    const stored: JSONObject = MonitorRecordEvidence.toStoredTestResult({
      probeResponse: probeCheck({
        step,
        responseBody: "PK\u0003\u0004\u0000\u0000 owner jane@acme.example",
      }) as unknown as ProbeMonitorResponse,
      monitorSteps: monitorOf({ step }).monitorSteps,
    });

    expect(stored["responseBody"]).toBe(`PK\u0003\u0004�� owner ${REDACTED}`);
  });
});

describe.each(COPIES_OF_ANY_CHECK)("%s", (_name: string, path: CheckCopy) => {
  // A GitHub webhook, as an Incoming Request monitor receives it.
  function webhook(step: MonitorStep): JSONObject {
    return {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      requestHeaders: {
        "content-type": "application/json",
        "user-agent": "GitHub-Hookshot/7a1b2c3",
        "x-hub-signature-256": "sha256=0f1e2d3c",
        authorization: "Bearer ghs_abcdefghijklmnopqrstuvwxyz0123456789",
      },
      requestBody: {
        action: "opened",
        sender: { login: "jane", email: "jane@acme.example" },
        installation: { id: 42, token: "ghs_live" },
      },
      requestMethod: "POST",
      incomingRequestReceivedAt: new Date("2026-11-08T10:00:00.000Z"),
      checkedAt: new Date("2026-11-08T10:00:00.000Z"),
      onlyCheckForIncomingRequestReceivedAt: false,
      monitorStepId: step.id,
    } as unknown as JSONObject;
  }

  test("an incoming request's headers and body are cut as a response's are", async () => {
    const step: MonitorStep = new MonitorStep();

    const stored: JSONObject = await path.copy({
      check: webhook(step),
      monitor: monitorOf({ step, monitorType: MonitorType.IncomingRequest }),
      step,
    });

    expect(stored["requestHeaders"]).toEqual({
      "content-type": "application/json",
      "user-agent": "GitHub-Hookshot/7a1b2c3",
      "x-hub-signature-256": REDACTED,
      authorization: REDACTED,
    });
    expect(stored["requestBody"]).toEqual({
      action: "opened",
      sender: { login: "jane", email: REDACTED },
      installation: { id: 42, token: REDACTED },
    });
    expect(stored["requestMethod"]).toBe("POST");
  });

  test("a monitor that keeps no request content keeps no body and no headers of the request", async () => {
    const step: MonitorStep = new MonitorStep();

    const stored: JSONObject = await path.copy({
      check: webhook(step),
      monitor: monitorOf({
        step,
        monitorType: MonitorType.IncomingRequest,
        keepResponseContent: false,
      }),
      step,
    });

    expect(stored["requestHeaders"]).toBeUndefined();
    expect(stored["requestBody"]).toBeUndefined();
    expect(stored["isResponseContentOmitted"]).toBe(true);
    expect(stored["requestMethod"]).toBe("POST");
    expect(stored["incomingRequestReceivedAt"]).toBe(
      "2026-11-08T10:00:00.000Z",
    );
  });

  test("a server's report: a process's command line is read for credentials, the metrics kept", async () => {
    const step: MonitorStep = new MonitorStep();

    const stored: JSONObject = await path.copy({
      check: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        hostname: "web-01.internal",
        requestReceivedAt: new Date("2026-11-08T10:00:00.000Z"),
        onlyCheckRequestReceivedAt: false,
        basicInfrastructureMetrics: {
          cpuMetrics: { percentUsed: 12.5, cores: 8 },
          memoryMetrics: { total: 16777216, percentUsed: 75 },
        },
        processes: [
          {
            pid: 4242,
            name: "java",
            command:
              "java -jar app.jar --spring.datasource.password=hunter2 --server.port=8080",
          },
          {
            pid: 4343,
            name: "node",
            command:
              "/usr/bin/node /srv/app/index.js --token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
          },
        ],
      } as unknown as JSONObject,
      monitor: monitorOf({ step, monitorType: MonitorType.Server }),
      step,
    });

    expect(stored["hostname"]).toBe("web-01.internal");
    expect(stored["basicInfrastructureMetrics"]).toEqual({
      cpuMetrics: { percentUsed: 12.5, cores: 8 },
      memoryMetrics: { total: 16777216, percentUsed: 75 },
    });
    expect(stored["processes"]).toEqual([
      {
        pid: 4242,
        name: "java",
        command: `java -jar app.jar --spring.datasource.password=${REDACTED} --server.port=8080`,
      },
      {
        pid: 4343,
        name: "node",
        command: `/usr/bin/node /srv/app/index.js --token ${REDACTED}`,
      },
    ]);
  });

  /*
   * Incoming Email monitors are to get evidence and a content switch of
   * their own: https://github.com/OneUptime/oneuptime/issues/6343
   */
  test("an incoming email is kept as it came", async () => {
    const step: MonitorStep = new MonitorStep();
    const email: JSONObject = {
      emailFrom: "jane@acme.example",
      emailTo: "monitor-abc@inbound.oneuptime.example",
      emailSubject: "Backup failed",
      emailBody: "Contact jane@acme.example, password=hunter2",
      emailHeaders: { "reply-to": "jane@acme.example" },
    };

    const stored: JSONObject = await path.copy({
      check: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        ...email,
        emailReceivedAt: new Date("2026-11-08T10:00:00.000Z"),
        checkedAt: new Date("2026-11-08T10:00:00.000Z"),
      } as unknown as JSONObject,
      monitor: monitorOf({ step, monitorType: MonitorType.IncomingEmail }),
      step,
    });

    for (const field of Object.keys(email)) {
      expect(stored[field]).toEqual(email[field]);
    }
  });
});

describe.each(COPIES_OF_LIVE_CHECKS)("%s", (_name: string, path: CheckCopy) => {
  test("never changes the check it was handed: the evaluator is still reading it", async () => {
    const step: MonitorStep = stepTo(CONFIGURED_DESTINATION);
    const check: JSONObject = probeCheck({
      step,
      responseBody: { email: "jane@acme.example" },
      responseHeaders: { authorization: "Bearer xyz" },
      failureCause: "password=hunter2",
    });

    await path.copy({
      check,
      monitor: monitorOf({ step, keepResponseContent: false }),
      step,
    });

    expect(check["responseBody"]).toEqual({ email: "jane@acme.example" });
    expect(check["responseHeaders"]).toEqual({ authorization: "Bearer xyz" });
    expect(check["failureCause"]).toBe("password=hunter2");
    expect(String(check["monitorDestination"])).toBe(ECHOED_DESTINATION);
    expect(check["isResponseContentOmitted"]).toBeUndefined();
  });
});
