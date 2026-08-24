/*
 * https://github.com/OneUptime/oneuptime/issues/3360
 *
 * The fix for #3360 narrowed the read ACL on the three `Monitor` secret-key
 * columns, but `incomingEmailSecretKey` has a second, indirect way out.
 *
 * The key IS the monitor's inbound address:
 * `SendGridInboundProvider.generateMonitorEmailAddress` builds
 * `monitor-{secretKey}@{inboundDomain}`, and `extractSecretKeyFromEmail` parses
 * the key straight back out of it. So every stored copy of the RECIPIENT is a
 * stored copy of a live bearer credential -- `emailTo`, the `To:` header, and
 * the `Received:` / `Delivered-To:` headers a relay stamps on in transit. Those
 * land in `Monitor.incomingEmailMonitorRequest`, whose read ACL still lists
 * `Permission.Viewer`, and -- through `MonitorSummaryCapture` -- in
 * `Incident.monitorSummary` and `Alert.monitorSummary` as well.
 *
 * The property under test is the one the advisory turns on, stated as an
 * invariant rather than as a list of fields: nothing a read-only principal can
 * select ever contains a string matching the monitor's secret key. Asserting
 * only on `emailTo` would pass for an implementation that cleaned the obvious
 * field and left the headers carrying the same address, which is exactly the
 * shape of the original miss.
 *
 * The second half matters just as much: an Incoming Email monitor is evaluated
 * on this payload (`IncomingEmailCriteria` reads `emailTo` for the "Email to"
 * check), and mail that arrives through an alias carries a genuinely different
 * recipient. A redactor that flattened every address would break criteria and
 * destroy legitimate evidence, so these tests pin what must SURVIVE too.
 *
 * MonitorResource is mocked wholesale: it is an assertion target here, and
 * importing it for real drags in the isolated-vm sandbox the criteria
 * evaluator uses.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(() => {
        return Promise.resolve();
      }),
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getActiveProjectStatusQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import { processIncomingEmailFromQueue } from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import { processIncomingRequestFromQueue } from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import {
  IncomingEmailJobData,
  IncomingRequestIngestJobData,
  ProbeIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorService from "Common/Server/Services/MonitorService";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * A uuid, because that is what `ObjectID.generate()` mints for
 * `incomingEmailSecretKey` / `incomingRequestSecretKey`, and distinctive enough
 * that a substring search for it is meaningful.
 */
const EMAIL_SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const REQUEST_SECRET: string = "1d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee";

const MONITOR_ID: string = "8f14e45f-ceea-467a-9575-1b0d0d3e7a9c";
const PROJECT_ID: string = "3c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19";

const INBOUND_DOMAIN: string = "inbound.oneuptime.example";

// Exactly what `generateMonitorEmailAddress` returns for this monitor.
const MONITOR_ADDRESS: string = `monitor-${EMAIL_SECRET}@${INBOUND_DOMAIN}`;

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;

const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;

const updateColumns: jest.Mock =
  MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;

/*
 * The read-only roles. All three are on the read list of
 * `incomingEmailMonitorRequest` and `incomingMonitorRequest`, and none of them
 * can rotate a monitor key -- which is the whole reason the secret must not be
 * inside those columns' VALUES either.
 */
const READ_ONLY_PERMISSIONS: Array<Permission> = [
  Permission.Viewer,
  Permission.MonitorViewer,
  Permission.ReadProjectMonitor,
];

const accessControl: Dictionary<ColumnAccessControl> =
  new Monitor().getColumnAccessControlForAllColumns();

type ViewerReadableColumnsFunction = () => Array<string>;

/*
 * `SelectPermission.checkSelectPermission` reduced to the question that
 * matters: which columns does a project Viewer get to ask for? This is the set
 * the repro in the report selects from.
 */
const viewerReadableColumns: ViewerReadableColumnsFunction =
  (): Array<string> => {
    return Object.keys(accessControl).filter((column: string) => {
      return PermissionHelper.doesPermissionsIntersect(
        READ_ONLY_PERMISSIONS,
        accessControl[column]?.read || [],
      );
    });
  };

type ContainsFunction = (value: unknown, secret: string) => boolean;

/*
 * The assertion that actually matters. Serializing the whole value means an
 * implementation that merely moved the secret one level down, or left it in a
 * header, still fails.
 */
const contains: ContainsFunction = (
  value: unknown,
  secret: string,
): boolean => {
  return JSON.stringify(value)?.includes(secret) ?? false;
};

type MonitorFixtureFunction = () => Monitor;

const monitorFixture: MonitorFixtureFunction = (): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.projectId = new ObjectID(PROJECT_ID);
  return monitor;
};

type EmailJobFunction = (
  overrides?: Partial<IncomingEmailJobData>,
) => ProbeIngestJobData;

/*
 * The shape `IncomingEmail.ts` enqueues: the provider's parsed email, verbatim.
 * `emailTo` is the recipient SendGrid reported and the headers are the ones the
 * relay chain stamped on -- three independent copies of the same address, which
 * is why redacting one field was never going to be enough.
 */
const emailJob: EmailJobFunction = (
  overrides?: Partial<IncomingEmailJobData>,
): ProbeIngestJobData => {
  return {
    jobType: "incoming-email",
    ingestionTimestamp: new Date("2026-08-23T10:00:00.000Z"),
    incomingEmail: {
      secretKey: EMAIL_SECRET,
      emailFrom: "alerts@acme.example",
      emailTo: MONITOR_ADDRESS,
      emailSubject: "Nightly backup completed",
      emailBody: "Backup finished in 42 minutes. 0 errors.",
      emailBodyHtml: "<p>Backup finished in 42 minutes. 0 errors.</p>",
      emailHeaders: {
        To: MONITOR_ADDRESS,
        From: "alerts@acme.example",
        Subject: "Nightly backup completed",
        "Delivered-To": MONITOR_ADDRESS,
        Received: `by mx.sendgrid.net with SMTP id xW9 for <${MONITOR_ADDRESS}>; Sun, 23 Aug 2026 10:00:00 +0000`,
        "Message-Id": "<20260823100000.1@acme.example>",
      },
      attachments: [
        { filename: "backup.log", contentType: "text/plain", size: 2048 },
      ],
      ...overrides,
    },
  } as ProbeIngestJobData;
};

type PersistedRequestFunction = () => JSONObject;

/*
 * What `updateColumnsByIdWithoutHooks` was asked to write into
 * `Monitor.incomingEmailMonitorRequest` -- i.e. the exact bytes a Viewer's
 * select would hand back.
 */
const persistedEmailRequest: PersistedRequestFunction = (): JSONObject => {
  expect(updateColumns).toHaveBeenCalledTimes(1);

  const input: JSONObject = (
    updateColumns.mock.calls as unknown as Array<Array<JSONObject>>
  )[0]![0] as JSONObject;

  return (input["data"] as JSONObject)[
    "incomingEmailMonitorRequest"
  ] as JSONObject;
};

type EvaluatedPayloadFunction = () => JSONObject;

/*
 * What reached `monitorResource` -- the object `MonitorSummaryCapture` snapshots
 * onto `Incident.monitorSummary` and `Alert.monitorSummary`, and that
 * `MonitorLogUtil` writes to `MonitorLog.logBody`.
 */
const evaluatedPayload: EvaluatedPayloadFunction = (): JSONObject => {
  expect(monitorResource).toHaveBeenCalledTimes(1);

  return (
    monitorResource.mock.calls as unknown as Array<Array<unknown>>
  )[0]![0] as JSONObject;
};

beforeEach(() => {
  monitorResource.mockClear();
  updateColumns.mockClear();
  findOneBy.mockReset();

  findOneBy.mockImplementation(() => {
    return Promise.resolve(monitorFixture());
  });
});

describe("Incoming Email ingest - the monitor's address is its secret", () => {
  it("keeps the secret out of every column a Viewer may select", async () => {
    /*
     * The repro from the report, expressed as the invariant rather than as one
     * field: build the monitor a Viewer's `get-list` would return, populated
     * with what ingest actually persisted, and assert no readable column
     * carries the key.
     */
    await processIncomingEmailFromQueue(emailJob());

    const monitor: Monitor = monitorFixture();
    (monitor as unknown as JSONObject)["incomingEmailMonitorRequest"] =
      persistedEmailRequest();

    const readable: Array<string> = viewerReadableColumns();

    /*
     * Guard the guard: if this column ever stops being Viewer-readable the
     * test would otherwise silently assert nothing.
     */
    expect(readable).toContain("incomingEmailMonitorRequest");

    for (const column of readable) {
      expect(
        contains((monitor as unknown as JSONObject)[column], EMAIL_SECRET),
      ).toBe(false);
    }
  });

  it("redacts the secret in the recipient, the To: header and the relay chain", async () => {
    await processIncomingEmailFromQueue(emailJob());

    const persisted: JSONObject = persistedEmailRequest();
    const headers: JSONObject = persisted["emailHeaders"] as JSONObject;

    expect(persisted["emailTo"]).not.toContain(EMAIL_SECRET);
    expect(headers["To"]).not.toContain(EMAIL_SECRET);
    expect(headers["Delivered-To"]).not.toContain(EMAIL_SECRET);
    expect(headers["Received"]).not.toContain(EMAIL_SECRET);
  });

  it("keeps the secret out of the incident and alert summary source", async () => {
    /*
     * `Monitor.incomingEmailMonitorRequest` is not the only sink. Narrowing
     * that one column's ACL would have left this path -- gated on incident and
     * alert permissions, not monitor ones -- wide open, which is why the strip
     * happens at the ingest boundary instead.
     */
    await processIncomingEmailFromQueue(emailJob());

    expect(contains(evaluatedPayload(), EMAIL_SECRET)).toBe(false);
  });

  it("still authenticates with the secret from the address", async () => {
    // Redacting the payload must not break the lookup that finds the monitor.
    await processIncomingEmailFromQueue(emailJob());

    const query: JSONObject = (
      (
        findOneBy.mock.calls as unknown as Array<Array<JSONObject>>
      )[0]![0] as JSONObject
    )["query"] as JSONObject;

    expect((query["incomingEmailSecretKey"] as ObjectID).toString()).toBe(
      EMAIL_SECRET,
    );
  });

  it("leaves the rest of the address readable so the evidence still reads", async () => {
    /*
     * Masking only the secret, not the whole value: an operator looking at the
     * monitor still sees that the mail arrived at this monitor's inbound
     * domain.
     */
    await processIncomingEmailFromQueue(emailJob());

    const persisted: JSONObject = persistedEmailRequest();

    expect(persisted["emailTo"]).toContain(INBOUND_DOMAIN);
    expect(persisted["emailTo"]).toContain("monitor-");
  });

  it("preserves a genuine recipient that is not the monitor's own address", async () => {
    /*
     * Mail forwarded from an alias carries the ALIAS in To:, and
     * `IncomingEmailCriteria` evaluates that string for the "Email to" check.
     * Only the monitor's own key may be masked; a blanket sweep of the
     * recipient would silently break every such criteria filter.
     */
    await processIncomingEmailFromQueue(
      emailJob({
        emailTo: "oncall@acme.example",
        emailHeaders: {
          To: "oncall@acme.example",
          "Delivered-To": MONITOR_ADDRESS,
        },
      }),
    );

    const persisted: JSONObject = persistedEmailRequest();
    const headers: JSONObject = persisted["emailHeaders"] as JSONObject;

    expect(persisted["emailTo"]).toBe("oncall@acme.example");
    expect(headers["Delivered-To"]).not.toContain(EMAIL_SECRET);
  });

  it("redacts an address a relay rewrote to a different case", async () => {
    /*
     * `extractEmailAddress` lowercases what it parses, but relay headers keep
     * whatever case the sender used, and a uuid is hex -- so a case-sensitive
     * sweep would miss the copy that matters.
     */
    await processIncomingEmailFromQueue(
      emailJob({
        emailHeaders: {
          To: `MONITOR-${EMAIL_SECRET.toUpperCase()}@${INBOUND_DOMAIN}`,
        },
      }),
    );

    expect(contains(persistedEmailRequest(), EMAIL_SECRET.toUpperCase())).toBe(
      false,
    );
  });

  it("forwards every observation the email carried", async () => {
    // A redactor that eats the evidence is a redactor somebody will turn off.
    await processIncomingEmailFromQueue(emailJob());

    const persisted: JSONObject = persistedEmailRequest();

    expect(persisted["emailFrom"]).toBe("alerts@acme.example");
    expect(persisted["emailSubject"]).toBe("Nightly backup completed");
    expect(persisted["emailBody"]).toBe(
      "Backup finished in 42 minutes. 0 errors.",
    );
    expect(persisted["attachments"]).toEqual([
      { filename: "backup.log", contentType: "text/plain", size: 2048 },
    ]);
  });

  it("still stamps the identity fields the pipeline depends on", async () => {
    /*
     * These are assigned around the strip. If redaction ever replaced the
     * object wholesale, or ran over it again afterwards, `monitorId` would
     * arrive as a plain string and the evaluation would be scoped to nothing.
     */
    await processIncomingEmailFromQueue(emailJob());

    const payload: JSONObject = evaluatedPayload();

    expect((payload["monitorId"] as ObjectID).toString()).toBe(MONITOR_ID);
    expect((payload["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect(payload["emailReceivedAt"] instanceof Date).toBe(true);
  });
});

describe("Incoming Request ingest - the same invariant", () => {
  /*
   * `incomingRequestSecretKey` travels in the URL path, and only the method,
   * headers and body are captured -- so unlike the email address it is not
   * systematically echoed into what gets stored. It is still reachable: an
   * ingress that reflects the request target puts the path into a header, and a
   * sender may repeat its own key in the body. Both would land in
   * `Monitor.incomingMonitorRequest`, which is Viewer-readable too.
   */
  type RequestJobFunction = (
    overrides?: Partial<IncomingRequestIngestJobData>,
  ) => IncomingRequestIngestJobData;

  const requestJob: RequestJobFunction = (
    overrides?: Partial<IncomingRequestIngestJobData>,
  ): IncomingRequestIngestJobData => {
    return {
      secretKey: REQUEST_SECRET,
      requestHeaders: {
        "content-type": "application/json",
        "user-agent": "acme-cron/1.4",
      },
      requestBody: { status: "ok", durationMs: 1200 },
      requestMethod: "POST",
      ...overrides,
    } as IncomingRequestIngestJobData;
  };

  it("keeps a reflected request target out of the stored headers", async () => {
    await processIncomingRequestFromQueue(
      requestJob({
        requestHeaders: {
          "content-type": "application/json",
          "x-original-uri": `/incoming-request/${REQUEST_SECRET}`,
        },
      }),
    );

    expect(contains(evaluatedPayload(), REQUEST_SECRET)).toBe(false);
  });

  it("keeps a self-quoted key out of the stored body", async () => {
    await processIncomingRequestFromQueue(
      requestJob({
        requestBody: {
          status: "ok",
          calledUrl: `/heartbeat/${REQUEST_SECRET}`,
        },
      }),
    );

    expect(contains(evaluatedPayload(), REQUEST_SECRET)).toBe(false);
  });

  it("forwards an ordinary heartbeat untouched", async () => {
    await processIncomingRequestFromQueue(requestJob());

    const payload: JSONObject = evaluatedPayload();

    expect(payload["requestBody"]).toEqual({ status: "ok", durationMs: 1200 });
    expect(payload["requestHeaders"]).toEqual({
      "content-type": "application/json",
      "user-agent": "acme-cron/1.4",
    });
  });
});
