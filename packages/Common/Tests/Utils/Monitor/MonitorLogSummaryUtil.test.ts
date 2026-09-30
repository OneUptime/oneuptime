import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import IncomingEmailMonitorRequest from "../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { redactForPersistence } from "../../../Server/Utils/Monitor/MonitorPayloadRedaction";
import IncomingEmailMonitorRequestUtil from "../../../Utils/Monitor/IncomingEmailMonitorRequestUtil";
import MonitorLogSummaryUtil, {
  IncomingEmailLogEntry,
  IncomingEmailLogEntryKind,
} from "../../../Utils/Monitor/MonitorLogSummaryUtil";
import { MonitorSummaryInfoProps } from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * The "View Summary" modal on a monitor's Monitoring Logs page.
 *
 * The page handed each row's logBody to every SummaryInfo slot except
 * incomingEmailMonitorRequest, and SummaryInfo answers a missing email with
 * "No summary available. Looks like no email has been received yet." So on
 * an Incoming Email monitor every row said that - including the row of the
 * email the reader was looking for, such as a sender's verification email
 * that had since been pushed off the Overview by a newer one.
 *
 * The modal now routes the body through MonitorSummarySnapshotUtil, the
 * table incidents and alerts already use. These tests pin that routing for
 * every monitor type, against bodies stored the way MonitorLogUtil writes
 * them: redactForPersistence(JSON.parse(JSON.stringify(dataToProcess))), so
 * ObjectIDs are {"_type": "ObjectID"} envelopes and dates are ISO strings.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_STEP_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const MONITORED_AT: Date = OneUptimeDate.fromString("2026-09-30T09:12:00.000Z");
const MONITOR_CREATED_AT: Date = OneUptimeDate.fromString(
  "2026-09-01T08:00:00.000Z",
);

const EVALUATION_SUMMARY: MonitorEvaluationSummary = {
  evaluatedAt: MONITORED_AT,
  criteriaResults: [
    {
      criteriaId: "criteria-1",
      criteriaName: "Email Body Has Error",
      filterCondition: FilterCondition.Any,
      met: false,
      message: "No filter matched.",
      filters: [],
    },
  ],
  events: [],
};

// What an Azure Monitor action group sends a new email recipient.
const VERIFICATION_EMAIL_BODY: string =
  "Use this one-time passcode to verify your email address: 482913\n" +
  "Or open https://userlinks.azns.microsofticm.com/verify?code=482913&tenant=contoso";

/*
 * Which SummaryInfo slot each monitor type's row has to land in. Written out
 * by hand, not derived from the helpers, so a type that moves between
 * families has to be moved here too.
 */
enum Slot {
  Probe = "Probe",
  Server = "Server",
  IncomingRequest = "IncomingRequest",
  IncomingEmail = "IncomingEmail",
  Telemetry = "Telemetry",
  None = "None",
}

const EXPECTED_SLOT: Record<MonitorType, Slot> = {
  [MonitorType.Manual]: Slot.None,

  [MonitorType.Website]: Slot.Probe,
  [MonitorType.API]: Slot.Probe,
  [MonitorType.Ping]: Slot.Probe,
  [MonitorType.IP]: Slot.Probe,
  [MonitorType.Port]: Slot.Probe,
  [MonitorType.SSLCertificate]: Slot.Probe,
  [MonitorType.SyntheticMonitor]: Slot.Probe,
  [MonitorType.CustomJavaScriptCode]: Slot.Probe,
  [MonitorType.DNS]: Slot.Probe,
  [MonitorType.DNSSEC]: Slot.Probe,
  [MonitorType.Domain]: Slot.Probe,
  [MonitorType.SQLQuery]: Slot.Probe,
  [MonitorType.Database]: Slot.Probe,
  [MonitorType.ExternalStatusPage]: Slot.Probe,
  // Its polls and traps arrive as probe responses; SnmpMonitorView reads them.
  [MonitorType.NetworkDevice]: Slot.Probe,

  [MonitorType.Server]: Slot.Server,
  [MonitorType.IncomingRequest]: Slot.IncomingRequest,
  [MonitorType.IncomingEmail]: Slot.IncomingEmail,

  [MonitorType.Logs]: Slot.Telemetry,
  [MonitorType.SecurityEvents]: Slot.Telemetry,
  [MonitorType.Metrics]: Slot.Telemetry,
  [MonitorType.Traces]: Slot.Telemetry,
  [MonitorType.Exceptions]: Slot.Telemetry,
  [MonitorType.Profiles]: Slot.Telemetry,
  [MonitorType.Kubernetes]: Slot.Telemetry,
  [MonitorType.Docker]: Slot.Telemetry,
  [MonitorType.Host]: Slot.Telemetry,
  [MonitorType.Podman]: Slot.Telemetry,
  [MonitorType.DockerSwarm]: Slot.Telemetry,
  [MonitorType.Proxmox]: Slot.Telemetry,
  [MonitorType.VMware]: Slot.Telemetry,
  [MonitorType.Ceph]: Slot.Telemetry,
  [MonitorType.IoTDevice]: Slot.Telemetry,
};

const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(MonitorType);

// The body exactly as MonitorLogUtil.saveMonitorLog stores it.
function storeAsMonitorLog(dataToProcess: unknown): JSONObject {
  return redactForPersistence(
    JSON.parse(JSON.stringify(dataToProcess)),
  ) as JSONObject;
}

function probeCheck(overrides?: JSONObject): JSONObject {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: MONITOR_STEP_ID,
    probeId: PROBE_ID,
    isOnline: false,
    responseCode: 503,
    responseTimeInMs: 812,
    failureCause: "Service Unavailable",
    monitoredAt: MONITORED_AT,
    evaluationSummary: EVALUATION_SUMMARY,
    ...(overrides || {}),
  } as unknown as JSONObject;
}

function serverReport(overrides?: JSONObject): JSONObject {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    hostname: "orders-db-01",
    requestReceivedAt: MONITORED_AT,
    onlyCheckRequestReceivedAt: false,
    evaluationSummary: EVALUATION_SUMMARY,
    ...(overrides || {}),
  } as unknown as JSONObject;
}

function incomingRequest(overrides?: JSONObject): JSONObject {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    incomingRequestReceivedAt: MONITORED_AT,
    checkedAt: MONITORED_AT,
    requestMethod: "POST",
    requestHeaders: { "content-type": "application/json" },
    requestBody: { status: "ok" },
    evaluationSummary: EVALUATION_SUMMARY,
    ...(overrides || {}),
  } as unknown as JSONObject;
}

/*
 * An email as Telemetry's processIncomingEmailFromQueue evaluates it: the
 * recipient is already masked, because the monitor's address is a
 * credential.
 */
function receivedEmail(overrides?: JSONObject): JSONObject {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    emailFrom: "azure-noreply@microsoft.com",
    emailTo: "[REDACTED]@inbound.oneuptime.com",
    emailSubject: "Verify your email address for Azure Monitor",
    emailBody: VERIFICATION_EMAIL_BODY,
    emailBodyHtml:
      '<p>Your passcode is <b>482913</b>.</p><a href="https://userlinks.azns.microsofticm.com/verify?code=482913&amp;tenant=contoso">Verify</a>',
    emailHeaders: {
      From: "Microsoft Azure <azure-noreply@microsoft.com>",
      Subject: "Verify your email address for Azure Monitor",
      "Content-Type": "multipart/alternative",
    },
    emailReceivedAt: MONITORED_AT,
    checkedAt: MONITORED_AT,
    onlyCheckForIncomingEmailReceivedAt: false,
    evaluationSummary: EVALUATION_SUMMARY,
    ...(overrides || {}),
  } as unknown as JSONObject;
}

/*
 * The worker's scheduled "has an email arrived lately?" check
 * (Workers/Jobs/IncomingEmailMonitor/CheckOnlineStatus). It spreads the
 * monitor's last email into its payload.
 */
function scheduledCheckAfterEmail(): JSONObject {
  return {
    ...receivedEmail(),
    emailReceivedAt: MONITORED_AT,
    checkedAt: OneUptimeDate.addRemoveMinutes(MONITORED_AT, 30),
    onlyCheckForIncomingEmailReceivedAt: true,
  } as unknown as JSONObject;
}

/*
 * The same check on a monitor that never received an email: nothing to
 * spread, empty fields, and the monitor's creation time standing in for the
 * receive time.
 */
function scheduledCheckWithoutEmail(): JSONObject {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    emailReceivedAt: MONITOR_CREATED_AT,
    onlyCheckForIncomingEmailReceivedAt: true,
    checkedAt: MONITORED_AT,
    emailFrom: "",
    emailTo: "",
    emailSubject: "",
    emailBody: "",
    evaluationSummary: EVALUATION_SUMMARY,
  } as unknown as JSONObject;
}

function telemetryResult(monitorType: MonitorType): JSONObject {
  const base: JSONObject = {
    projectId: PROJECT_ID as unknown as JSONObject,
    monitorId: MONITOR_ID as unknown as JSONObject,
    evaluationSummary: EVALUATION_SUMMARY as unknown as JSONObject,
  };

  if (monitorType === MonitorType.Logs) {
    return { ...base, logCount: 12 };
  }

  if (monitorType === MonitorType.Traces) {
    return { ...base, spanCount: 4 };
  }

  return {
    ...base,
    metricResult: [],
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
  };
}

function bodyFor(monitorType: MonitorType): JSONObject {
  switch (EXPECTED_SLOT[monitorType]) {
    case Slot.Probe:
      return probeCheck();
    case Slot.Server:
      return serverReport();
    case Slot.IncomingRequest:
      return incomingRequest();
    case Slot.IncomingEmail:
      return receivedEmail();
    case Slot.Telemetry:
      return telemetryResult(monitorType);
    default:
      return {};
  }
}

function summaryOf(data: {
  monitorType: MonitorType;
  logBody: JSONObject | null | undefined;
  monitoredAt?: Date | undefined;
  probeName?: string | undefined;
}): MonitorSummaryInfoProps {
  return MonitorLogSummaryUtil.toSummaryInfoProps(data);
}

function slotsOf(props: MonitorSummaryInfoProps): Array<Slot> {
  const slots: Array<Slot> = [];

  if (props.probeMonitorResponses) {
    slots.push(Slot.Probe);
  }

  if (props.serverMonitorResponse) {
    slots.push(Slot.Server);
  }

  if (props.incomingMonitorRequest) {
    slots.push(Slot.IncomingRequest);
  }

  if (props.incomingEmailMonitorRequest) {
    slots.push(Slot.IncomingEmail);
  }

  if (props.telemetryMonitorSummary) {
    slots.push(Slot.Telemetry);
  }

  return slots;
}

describe("MonitorLogSummaryUtil.toSummaryInfoProps - every monitor type", () => {
  it("declares a slot for every MonitorType", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      expect(EXPECTED_SLOT[monitorType]).toBeDefined();
    }

    expect(Object.keys(EXPECTED_SLOT)).toHaveLength(ALL_MONITOR_TYPES.length);
  });

  it("agrees with MonitorTypeHelper about the probe and telemetry families", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      expect(MonitorTypeHelper.isTelemetryMonitor(monitorType)).toBe(
        EXPECTED_SLOT[monitorType] === Slot.Telemetry,
      );

      if (MonitorTypeHelper.isProbableMonitor(monitorType)) {
        expect(EXPECTED_SLOT[monitorType]).toBe(Slot.Probe);
      }
    }
  });

  it("puts each type's stored row in exactly the slot its summary view reads", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      if (monitorType === MonitorType.Manual) {
        continue;
      }

      const props: MonitorSummaryInfoProps = summaryOf({
        monitorType: monitorType,
        logBody: storeAsMonitorLog(bodyFor(monitorType)),
        monitoredAt: MONITORED_AT,
      });

      expect({ monitorType, slots: slotsOf(props) }).toEqual({
        monitorType,
        slots: [EXPECTED_SLOT[monitorType]],
      });
      expect(props.monitorType).toBe(monitorType);
    }
  });

  it("hands every type's criteria evaluation to the modal", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      if (monitorType === MonitorType.Manual) {
        continue;
      }

      const props: MonitorSummaryInfoProps = summaryOf({
        monitorType: monitorType,
        logBody: storeAsMonitorLog(bodyFor(monitorType)),
        monitoredAt: MONITORED_AT,
      });

      expect(props.evaluationSummary?.criteriaResults[0]?.criteriaName).toBe(
        "Email Body Has Error",
      );
    }
  });

  it("gives a manual monitor's row nothing but its type", () => {
    expect(
      summaryOf({
        monitorType: MonitorType.Manual,
        logBody: storeAsMonitorLog({ evaluationSummary: EVALUATION_SUMMARY }),
        monitoredAt: MONITORED_AT,
      }),
    ).toEqual({ monitorType: MonitorType.Manual });
  });
});

describe("MonitorLogSummaryUtil.toSummaryInfoProps - Incoming Email rows", () => {
  it("gives the modal the email a row recorded, which it used to drop", () => {
    const props: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.IncomingEmail,
      logBody: storeAsMonitorLog(receivedEmail()),
      monitoredAt: MONITORED_AT,
    });

    const email: IncomingEmailMonitorRequest =
      props.incomingEmailMonitorRequest!;

    expect(email).toBeDefined();
    expect(email.emailFrom).toBe("azure-noreply@microsoft.com");
    expect(email.emailSubject).toBe(
      "Verify your email address for Azure Monitor",
    );
    expect(email.emailBody).toBe(VERIFICATION_EMAIL_BODY);
    expect(email.emailBodyHtml).toContain(
      "https://userlinks.azns.microsofticm.com/verify?code=482913&amp;tenant=contoso",
    );
    expect(email.emailHeaders).toEqual({
      From: "Microsoft Azure <azure-noreply@microsoft.com>",
      Subject: "Verify your email address for Azure Monitor",
      "Content-Type": "multipart/alternative",
    });
    // Stored as an ISO string, and handed on as one: the views format both.
    expect(
      OneUptimeDate.fromString(email.emailReceivedAt as unknown as string),
    ).toEqual(MONITORED_AT);
  });

  it("shows when a row was evaluated, as incident summaries do", () => {
    const props: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.IncomingEmail,
      logBody: storeAsMonitorLog(scheduledCheckAfterEmail()),
      monitoredAt: MONITORED_AT,
    });

    expect(
      OneUptimeDate.fromString(
        props.incomingEmailMonitorHeartbeatCheckedAt as unknown as string,
      ),
    ).toEqual(OneUptimeDate.addRemoveMinutes(MONITORED_AT, 30));
  });

  it("keeps a scheduled check's copy of the last email", () => {
    const props: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.IncomingEmail,
      logBody: storeAsMonitorLog(scheduledCheckAfterEmail()),
      monitoredAt: MONITORED_AT,
    });

    expect(props.incomingEmailMonitorRequest?.emailSubject).toBe(
      "Verify your email address for Azure Monitor",
    );
    expect(
      IncomingEmailMonitorRequestUtil.hasEmail(
        props.incomingEmailMonitorRequest,
      ),
    ).toBe(true);
  });

  it("routes a check on a monitor that never received mail to the email view, which knows it is no email", () => {
    const props: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.IncomingEmail,
      logBody: storeAsMonitorLog(scheduledCheckWithoutEmail()),
      monitoredAt: MONITORED_AT,
    });

    /*
     * Routed rather than dropped: without a request SummaryInfo shows only
     * its "no email" message and hides the evaluation that explains why
     * the check marked the monitor offline.
     */
    expect(props.incomingEmailMonitorRequest).toBeDefined();
    expect(props.evaluationSummary).toBeDefined();
    expect(
      IncomingEmailMonitorRequestUtil.hasEmail(
        props.incomingEmailMonitorRequest,
      ),
    ).toBe(false);
  });

  it("does not show another type's payload as an email", () => {
    // A row written before the monitor's type was changed to Incoming Email.
    const props: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.IncomingEmail,
      logBody: storeAsMonitorLog(probeCheck()),
      monitoredAt: MONITORED_AT,
    });

    expect(props.incomingEmailMonitorRequest).toBeUndefined();
    expect(props.probeMonitorResponses).toBeUndefined();
    // The evaluation still explains the row.
    expect(props.evaluationSummary).toBeDefined();
  });
});

describe("MonitorLogSummaryUtil.toSummaryInfoProps - other families", () => {
  it("passes the probe's name with a probe check", () => {
    const props: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.Website,
      logBody: storeAsMonitorLog(probeCheck()),
      monitoredAt: MONITORED_AT,
      probeName: "Frankfurt",
    });

    expect(props.probeName).toBe("Frankfurt");
    expect(props.probeMonitorResponses).toHaveLength(1);

    const check: ProbeMonitorResponse = props.probeMonitorResponses![0]!;

    expect(check.responseCode).toBe(503);
    expect(check.failureCause).toBe("Service Unavailable");
    // The envelope comes back as the ObjectID the probe sent.
    expect(check.monitorStepId.toString()).toBe(MONITOR_STEP_ID.toString());
  });

  it("keeps a synthetic check's screenshots, however large", () => {
    /*
     * The snapshot util sheds screenshots past 1 MB to bound what an
     * incident stores. A log row is already stored, so the modal keeps
     * them.
     */
    const screenshot: string = "A".repeat(1536 * 1024);

    const props: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.SyntheticMonitor,
      logBody: storeAsMonitorLog(
        probeCheck({
          syntheticMonitorResponse: [
            {
              browserType: "Chromium",
              screenSizeType: "Desktop",
              screenshots: { home: screenshot },
              logMessages: ["loaded"],
              executionTimeInMS: 2100,
            },
          ] as unknown as JSONObject,
        }),
      ),
      monitoredAt: MONITORED_AT,
    });

    const run: JSONObject = props.probeMonitorResponses![0]!
      .syntheticMonitorResponse![0] as unknown as JSONObject;

    expect((run["screenshots"] as JSONObject)["home"]).toBe(screenshot);
  });

  it("shows a server check, including the worker's scheduled one", () => {
    const report: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.Server,
      logBody: storeAsMonitorLog(serverReport()),
      monitoredAt: MONITORED_AT,
    });

    const scheduledCheck: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.Server,
      logBody: storeAsMonitorLog(
        serverReport({ onlyCheckRequestReceivedAt: true }),
      ),
      monitoredAt: MONITORED_AT,
    });

    expect(report.serverMonitorResponse?.hostname).toBe("orders-db-01");
    expect(scheduledCheck.serverMonitorResponse?.hostname).toBe("orders-db-01");
  });

  it("shows an incoming request with the time its row was evaluated", () => {
    const props: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.IncomingRequest,
      logBody: storeAsMonitorLog(
        incomingRequest({ onlyCheckForIncomingRequestReceivedAt: true }),
      ),
      monitoredAt: MONITORED_AT,
    });

    expect(props.incomingMonitorRequest?.requestMethod).toBe("POST");
    expect(
      OneUptimeDate.fromString(
        props.incomingRequestMonitorHeartbeatCheckedAt as unknown as string,
      ),
    ).toEqual(MONITORED_AT);
  });

  it("shows a telemetry evaluation at the row's time", () => {
    const props: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.Logs,
      logBody: storeAsMonitorLog(telemetryResult(MonitorType.Logs)),
      monitoredAt: MONITORED_AT,
    });

    expect(props.telemetryMonitorSummary).toEqual({
      lastCheckedAt: MONITORED_AT,
    });
  });

  it("leaves a telemetry row without a time blank rather than stamping it now", () => {
    const props: MonitorSummaryInfoProps = summaryOf({
      monitorType: MonitorType.Metrics,
      logBody: storeAsMonitorLog(telemetryResult(MonitorType.Metrics)),
    });

    expect(props.telemetryMonitorSummary).toBeUndefined();
    expect(props.evaluationSummary).toBeDefined();
  });
});

describe("MonitorLogSummaryUtil.toSummaryInfoProps - bodies with nothing to show", () => {
  const EMPTY_BODIES: Array<{ name: string; body: unknown }> = [
    { name: "null", body: null },
    { name: "undefined", body: undefined },
    { name: "an array", body: [receivedEmail()] },
    { name: "a string", body: "not a log body" },
    { name: "an empty object", body: {} },
  ];

  for (const empty of EMPTY_BODIES) {
    it(`answers ${empty.name} with the monitor type alone`, () => {
      expect(
        summaryOf({
          monitorType: MonitorType.IncomingEmail,
          logBody: empty.body as JSONObject,
          monitoredAt: MONITORED_AT,
        }),
      ).toEqual({ monitorType: MonitorType.IncomingEmail });
    });
  }
});

describe("MonitorLogSummaryUtil.getProbeId", () => {
  it("reads the id out of a stored body's ObjectID envelope", () => {
    const stored: JSONObject = storeAsMonitorLog(probeCheck());

    // Pin the stored shape this exists for.
    expect(stored["probeId"]).toEqual({
      _type: "ObjectID",
      value: PROBE_ID.toString(),
    });
    expect(MonitorLogSummaryUtil.getProbeId(stored)).toBe(PROBE_ID.toString());
  });

  it("takes a plain string id as it is", () => {
    expect(
      MonitorLogSummaryUtil.getProbeId({ probeId: PROBE_ID.toString() }),
    ).toBe(PROBE_ID.toString());
  });

  it("takes an ObjectID from a body that was already deserialized", () => {
    expect(
      MonitorLogSummaryUtil.getProbeId({
        probeId: PROBE_ID as unknown as JSONObject,
      }),
    ).toBe(PROBE_ID.toString());
  });

  it("finds no probe on a row that has none", () => {
    const withoutProbe: Array<JSONObject | null | undefined> = [
      null,
      undefined,
      {},
      storeAsMonitorLog(receivedEmail()),
      { probeId: "" },
      { probeId: null },
      { probeId: 42 },
      { probeId: { _type: "ObjectID" } },
      { probeId: { _type: "ObjectID", value: 7 } },
    ];

    for (const body of withoutProbe) {
      expect(MonitorLogSummaryUtil.getProbeId(body)).toBeUndefined();
    }
  });
});

/*
 * The Email column of an Incoming Email monitor's Monitoring Logs. Without
 * it every row looked the same ("Criteria met: ..."), so finding the one
 * that holds a sender's verification email meant opening them one by one.
 */
describe("MonitorLogSummaryUtil.getIncomingEmailLogEntry", () => {
  it("names the email a row evaluated by its subject and sender", () => {
    expect(
      MonitorLogSummaryUtil.getIncomingEmailLogEntry(
        storeAsMonitorLog(receivedEmail()),
      ),
    ).toEqual({
      kind: IncomingEmailLogEntryKind.Email,
      subject: "Verify your email address for Azure Monitor",
      from: "azure-noreply@microsoft.com",
    });
  });

  it("calls a scheduled check a check, not the email it copied", () => {
    /*
     * The check's payload carries the last email's subject and sender, so
     * read naively every one of these rows - one every 30 seconds while a
     * criteria checks Email Received - would look like that email again.
     */
    const stored: JSONObject = storeAsMonitorLog(scheduledCheckAfterEmail());

    expect(stored["emailSubject"]).toBe(
      "Verify your email address for Azure Monitor",
    );
    expect(MonitorLogSummaryUtil.getIncomingEmailLogEntry(stored)).toEqual({
      kind: IncomingEmailLogEntryKind.ScheduledCheck,
      subject: "",
      from: "",
    });
  });

  it("calls a check on a monitor that never received mail a check", () => {
    expect(
      MonitorLogSummaryUtil.getIncomingEmailLogEntry(
        storeAsMonitorLog(scheduledCheckWithoutEmail()),
      )?.kind,
    ).toBe(IncomingEmailLogEntryKind.ScheduledCheck);
  });

  it("keeps an email with no subject or sender an email", () => {
    const entry: IncomingEmailLogEntry | null =
      MonitorLogSummaryUtil.getIncomingEmailLogEntry(
        storeAsMonitorLog(
          receivedEmail({ emailSubject: "   ", emailFrom: "" } as JSONObject),
        ),
      );

    expect(entry).toEqual({
      kind: IncomingEmailLogEntryKind.Email,
      subject: "",
      from: "",
    });
  });

  it("trims the subject and sender it shows", () => {
    expect(
      MonitorLogSummaryUtil.getIncomingEmailLogEntry(
        storeAsMonitorLog(
          receivedEmail({
            emailSubject: "  Fired: CPU above 90%  ",
            emailFrom: " alerts-noreply@mail.windowsazure.com ",
          } as JSONObject),
        ),
      ),
    ).toEqual({
      kind: IncomingEmailLogEntryKind.Email,
      subject: "Fired: CPU above 90%",
      from: "alerts-noreply@mail.windowsazure.com",
    });
  });

  it("treats only a true flag as a scheduled check", () => {
    // Emails are stored with the flag false; older rows may not have it.
    const withoutFlag: JSONObject = storeAsMonitorLog(receivedEmail());
    delete withoutFlag["onlyCheckForIncomingEmailReceivedAt"];

    for (const body of [
      withoutFlag,
      storeAsMonitorLog(
        receivedEmail({
          onlyCheckForIncomingEmailReceivedAt: "true",
        } as unknown as JSONObject),
      ),
    ]) {
      expect(MonitorLogSummaryUtil.getIncomingEmailLogEntry(body)?.kind).toBe(
        IncomingEmailLogEntryKind.Email,
      );
    }
  });

  it("finds no email in a row that has none", () => {
    const withoutEmail: Array<JSONObject | null | undefined> = [
      null,
      undefined,
      {},
      [] as unknown as JSONObject,
      "an email" as unknown as JSONObject,
      // Written before the monitor's type was changed to Incoming Email.
      storeAsMonitorLog(probeCheck()),
      storeAsMonitorLog(serverReport()),
      storeAsMonitorLog({ ...receivedEmail(), emailReceivedAt: null }),
    ];

    for (const body of withoutEmail) {
      expect(MonitorLogSummaryUtil.getIncomingEmailLogEntry(body)).toBeNull();
    }
  });

  it("ignores a subject or sender that is not text", () => {
    expect(
      MonitorLogSummaryUtil.getIncomingEmailLogEntry(
        storeAsMonitorLog(
          receivedEmail({
            emailSubject: { text: "nested" },
            emailFrom: 42,
          } as unknown as JSONObject),
        ),
      ),
    ).toEqual({
      kind: IncomingEmailLogEntryKind.Email,
      subject: "",
      from: "",
    });
  });
});
