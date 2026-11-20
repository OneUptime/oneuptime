import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import SentryEnvelope, {
  DEFAULT_PROFILE_SAMPLE_INTERVAL_NS,
  SentryTranslation,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/SentryEnvelope";

/*
 * The envelope items a Sentry SDK sends besides errors, transactions and
 * logs, built as the SDKs build them:
 *
 *   - cron check-ins (sentry_sdk/crons/api.py, @sentry/core captureCheckIn)
 *     become log records a Logs monitor can watch by the monitor's slug;
 *   - user feedback (@sentry/browser's feedback widget and captureFeedback,
 *     the older user_report of capture_user_feedback) becomes a log record
 *     of what the person wrote, linked to its trace and its error;
 *   - profiles (sentry_sdk/profiler/transaction_profiler.py, the sample
 *     format v1) and profile chunks (continuous_profiler.py, v2) become
 *     OTLP profiles in the shape OneUptime's profiles worker reads.
 *
 * Each is counted at its own signal's bytes.
 */

const NOW_MS: number = 1705400000000;
const NOW_NANO: string = "1705400000000000000";

const TRACE_ID: string = "771a43a4192642f0b136d5159a501700";
const ROOT_SPAN_ID: string = "a0cfbde2bdff3adc";
const TRANSACTION_EVENT_ID: string = "9ec79c33ec9942ab8353589fcb2e04dc";
const PROFILE_EVENT_ID: string = "3b2f5dd2f3374e2f8e0e0f2d6c8b1a77";

interface ItemSpec {
  header: JSONObject;
  payload: JSONObject | string;
}

const envelopeOf: (header: JSONObject, items: Array<ItemSpec>) => Buffer = (
  header: JSONObject,
  items: Array<ItemSpec>,
): Buffer => {
  const lines: Array<string> = [JSON.stringify(header)];

  for (const item of items) {
    const payload: string =
      typeof item.payload === "string"
        ? item.payload
        : JSON.stringify(item.payload);

    lines.push(
      JSON.stringify({ ...item.header, length: Buffer.byteLength(payload) }),
      payload,
    );
  }

  return Buffer.from(`${lines.join("\n")}\n`);
};

const translate: (
  header: JSONObject,
  items: Array<ItemSpec>,
  options?: { serviceName?: string },
) => SentryTranslation = (
  header: JSONObject,
  items: Array<ItemSpec>,
  options?: { serviceName?: string },
): SentryTranslation => {
  return SentryEnvelope.fromEnvelope(
    SentryEnvelope.parseEnvelope(envelopeOf(header, items)),
    { nowInMs: NOW_MS, ...options },
  );
};

const attributesOf: (value: unknown) => Record<string, unknown> = (
  value: unknown,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const attribute of (value || []) as Array<{
    key: string;
    value: Record<string, unknown>;
  }>) {
    result[attribute.key] = Object.values(attribute.value)[0];
  }

  return result;
};

interface FlatLog {
  resource: Record<string, unknown>;
  record: JSONObject;
  attributes: Record<string, unknown>;
}

const logsOf: (translation: SentryTranslation) => Array<FlatLog> = (
  translation: SentryTranslation,
): Array<FlatLog> => {
  const result: Array<FlatLog> = [];

  for (const resourceLog of (translation.logs?.["resourceLogs"] ||
    []) as Array<JSONObject>) {
    for (const scopeLog of resourceLog["scopeLogs"] as Array<JSONObject>) {
      for (const record of scopeLog["logRecords"] as Array<JSONObject>) {
        result.push({
          resource: attributesOf(
            (resourceLog["resource"] as JSONObject)["attributes"],
          ),
          record: record,
          attributes: attributesOf(record["attributes"]),
        });
      }
    }
  }

  return result;
};

interface FlatProfile {
  resource: Record<string, unknown>;
  scope: JSONObject;
  container: JSONObject;
  profile: JSONObject;
}

const profilesOf: (translation: SentryTranslation) => Array<FlatProfile> = (
  translation: SentryTranslation,
): Array<FlatProfile> => {
  const result: Array<FlatProfile> = [];

  for (const resourceProfile of (translation.profiles?.["resourceProfiles"] ||
    []) as Array<JSONObject>) {
    for (const scopeProfile of resourceProfile[
      "scopeProfiles"
    ] as Array<JSONObject>) {
      for (const container of scopeProfile["profiles"] as Array<JSONObject>) {
        result.push({
          resource: attributesOf(
            (resourceProfile["resource"] as JSONObject)["attributes"],
          ),
          scope: scopeProfile["scope"] as JSONObject,
          container: container,
          profile: container["profile"] as JSONObject,
        });
      }
    }
  }

  return result;
};

/*
 * A profile's samples read back as the profiles worker reads them: each
 * sample's stack as "function@file:line" frames from the leaf, its thread,
 * whether it links to a trace, and its values.
 */
interface ReadSample {
  frames: Array<string>;
  thread: Record<string, string>;
  link: JSONObject | null;
  values: Array<string>;
  time: string;
}

const samplesOf: (profile: JSONObject) => Array<ReadSample> = (
  profile: JSONObject,
): Array<ReadSample> => {
  const strings: Array<string> = profile["stringTable"] as Array<string>;
  const functions: Array<JSONObject> = profile[
    "functionTable"
  ] as Array<JSONObject>;
  const locations: Array<JSONObject> = profile[
    "locationTable"
  ] as Array<JSONObject>;
  const stacks: Array<JSONObject> = profile["stackTable"] as Array<JSONObject>;
  const attributes: Array<JSONObject> = profile[
    "attributeTable"
  ] as Array<JSONObject>;
  const links: Array<JSONObject> = profile["linkTable"] as Array<JSONObject>;

  return (profile["sample"] as Array<JSONObject>).map(
    (sample: JSONObject): ReadSample => {
      const stack: JSONObject = stacks[sample["stackIndex"] as number]!;
      const frames: Array<string> = (
        stack["locationIndices"] as Array<number>
      ).map((index: number): string => {
        const line: JSONObject = (
          locations[index]!["line"] as Array<JSONObject>
        )[0]!;
        const fn: JSONObject = functions[line["functionIndex"] as number]!;
        const file: string = strings[fn["filename"] as number]!;
        const lineNumber: number = line["line"] as number;

        return `${strings[fn["name"] as number]}@${file}${lineNumber ? `:${lineNumber}` : ""}`;
      });
      const thread: Record<string, string> = {};

      for (const index of (sample["attributeIndices"] as Array<number>) || []) {
        thread[attributes[index]!["key"] as string] = (
          attributes[index]!["value"] as JSONObject
        )["stringValue"] as string;
      }

      return {
        frames: frames,
        thread: thread,
        link:
          sample["linkIndex"] !== undefined
            ? links[sample["linkIndex"] as number]!
            : null,
        values: sample["value"] as Array<string>,
        time: (sample["timestampsUnixNano"] as Array<string>)[0]!,
      };
    },
  );
};

// What sentry-python sends with a check-in (sentry_sdk/crons/api.py).
const pythonCheckIn: (overrides?: JSONObject) => JSONObject = (
  overrides?: JSONObject,
): JSONObject => {
  return {
    type: "check_in",
    monitor_slug: "nightly-backup",
    check_in_id: "6e1d8c2a4f5b4f7f9a3c2b1d0e9f8a7b",
    status: "ok",
    duration: 12.5,
    environment: "production",
    release: "backup-worker@2.3.0",
    monitor_config: {
      schedule: { type: "crontab", value: "0 2 * * *" },
      checkin_margin: 5,
      max_runtime: 30,
      timezone: "Europe/Berlin",
    },
    contexts: { trace: { trace_id: TRACE_ID, span_id: ROOT_SPAN_ID } },
    ...overrides,
  };
};

const PYTHON_HEADER: JSONObject = {
  sent_at: "2024-01-16T10:13:20.000000Z",
  sdk: { name: "sentry.python", version: "2.19.2" },
};

describe("Sentry cron check-ins", () => {
  test("a check-in is a log record of its monitor, its status its level, its schedule as attributes", () => {
    const translation: SentryTranslation = translate(PYTHON_HEADER, [
      { header: { type: "check_in" }, payload: pythonCheckIn() },
    ]);
    const [log] = logsOf(translation) as [FlatLog];

    expect(translation.accepted.checkIns).toBe(1);
    expect(log.record["body"]).toEqual({
      stringValue: "Check-in nightly-backup: ok",
    });
    expect(log.record["severityNumber"]).toBe(9);
    expect(log.record["severityText"]).toBe("INFO");
    expect(log.record["timeUnixNano"]).toBe(NOW_NANO);
    expect(log.record["traceId"]).toBe(TRACE_ID);
    expect(log.record["spanId"]).toBeUndefined();
    expect(log.attributes).toEqual({
      "sentry.monitor.slug": "nightly-backup",
      "sentry.check_in.status": "ok",
      "sentry.check_in.id": "6e1d8c2a4f5b4f7f9a3c2b1d0e9f8a7b",
      "sentry.check_in.duration": 12.5,
      "sentry.monitor.schedule": "0 2 * * *",
      "sentry.monitor.schedule.type": "crontab",
      "sentry.monitor.checkin_margin": "5",
      "sentry.monitor.max_runtime": "30",
      "sentry.monitor.timezone": "Europe/Berlin",
    });
    expect(log.resource).toMatchObject({
      "service.name": "backup-worker",
      "service.version": "backup-worker@2.3.0",
      "deployment.environment.name": "production",
      "telemetry.sdk.name": "sentry.python",
      "telemetry.sdk.language": "python",
    });
  });

  test("a failed, timed-out or missed check-in is ERROR; a started one is INFO", () => {
    for (const [status, severity] of [
      ["error", 17],
      ["timeout", 17],
      ["missed", 17],
      ["in_progress", 9],
    ] as const) {
      const [log] = logsOf(
        translate(PYTHON_HEADER, [
          {
            header: { type: "check_in" },
            payload: pythonCheckIn({ status: status, duration: null }),
          },
        ]),
      ) as [FlatLog];

      expect(log.record["severityNumber"]).toBe(severity);
      expect(log.record["body"]).toEqual({
        stringValue: `Check-in nightly-backup: ${status}`,
      });
      expect(log.attributes["sentry.check_in.duration"]).toBeUndefined();
    }
  });

  test("an interval schedule, as @sentry/node's withMonitor writes it", () => {
    const [log] = logsOf(
      translate(
        { sdk: { name: "sentry.javascript.node", version: "8.47.0" } },
        [
          {
            header: { type: "check_in" },
            payload: {
              check_in_id: "0b9c0dc5c7c24fc2a16a4a0e5d2f8c11",
              monitor_slug: "invoice-sync",
              status: "in_progress",
              release: "billing@1.0.0",
              monitor_config: {
                schedule: { type: "interval", value: 2, unit: "hour" },
              },
            },
          },
        ],
      ),
    ) as [FlatLog];

    expect(log.attributes["sentry.monitor.schedule"]).toBe("2 hour");
    expect(log.attributes["sentry.monitor.schedule.type"]).toBe("interval");
    expect(log.resource["telemetry.sdk.language"]).toBe("nodejs");
  });

  test("a check-in naming no monitor is malformed", () => {
    const translation: SentryTranslation = translate(PYTHON_HEADER, [
      {
        header: { type: "check_in" },
        payload: pythonCheckIn({ monitor_slug: "" }),
      },
    ]);

    expect(translation.logs).toBeNull();
    expect(translation.malformedItemCount).toBe(1);
    expect(translation.ingestBytes.logs).toBe(0);
  });

  test("the x-oneuptime-service-name header names the service", () => {
    const [log] = logsOf(
      translate(
        PYTHON_HEADER,
        [{ header: { type: "check_in" }, payload: pythonCheckIn() }],
        { serviceName: "crons" },
      ),
    ) as [FlatLog];

    expect(log.resource["service.name"]).toBe("crons");
  });
});

describe("Sentry user feedback", () => {
  // What @sentry/browser sends from its feedback widget (captureFeedback).
  const widgetFeedback: JSONObject = {
    type: "feedback",
    event_id: "1f2e3d4c5b6a49788796a5b4c3d2e1f0",
    timestamp: 1705399990.5,
    platform: "javascript",
    level: "info",
    release: "shop-web@4.1.0",
    environment: "production",
    sdk: { name: "sentry.javascript.react", version: "8.47.0" },
    contexts: {
      feedback: {
        message: "The checkout button does nothing.",
        contact_email: "jane@example.com",
        name: "Jane",
        url: "https://shop.example.com/checkout",
        source: "widget",
        associated_event_id: "aa11bb22cc33dd44ee55ff6677889900",
        replay_id: "4d3c2b1a09f84e7d6c5b4a3928170615",
      },
      trace: { trace_id: TRACE_ID, span_id: ROOT_SPAN_ID },
    },
    tags: { page: "checkout" },
    user: { id: "u-42" },
  };

  test("widget feedback is a log record of what the person wrote, in its trace, naming the error it is about", () => {
    const translation: SentryTranslation = translate(
      {
        event_id: "1f2e3d4c5b6a49788796a5b4c3d2e1f0",
        sdk: widgetFeedback["sdk"],
      },
      [{ header: { type: "feedback" }, payload: widgetFeedback }],
    );
    const [log] = logsOf(translation) as [FlatLog];

    expect(translation.accepted.feedback).toBe(1);
    expect(translation.eventId).toBe("1f2e3d4c5b6a49788796a5b4c3d2e1f0");
    expect(log.record["body"]).toEqual({
      stringValue: "The checkout button does nothing.",
    });
    expect(log.record["severityNumber"]).toBe(9);
    expect(log.record["timeUnixNano"]).toBe("1705399990500000000");
    expect(log.record["traceId"]).toBe(TRACE_ID);
    expect(log.record["spanId"]).toBe(ROOT_SPAN_ID);
    expect(log.attributes).toMatchObject({
      "sentry.feedback.name": "Jane",
      "sentry.feedback.contact_email": "jane@example.com",
      "sentry.feedback.associated_event_id": "aa11bb22cc33dd44ee55ff6677889900",
      "sentry.feedback.url": "https://shop.example.com/checkout",
      "sentry.feedback.source": "widget",
      "sentry.feedback.replay_id": "4d3c2b1a09f84e7d6c5b4a3928170615",
      "sentry.event_id": "1f2e3d4c5b6a49788796a5b4c3d2e1f0",
      "user.id": "u-42",
      page: "checkout",
    });
    expect(log.resource).toMatchObject({
      "service.name": "shop-web",
      "telemetry.sdk.language": "webjs",
    });
  });

  test("sentry-python's user_report is a log record of its comments, naming the error it is about", () => {
    const translation: SentryTranslation = translate(
      {
        event_id: "aa11bb22cc33dd44ee55ff6677889900",
        sdk: { name: "sentry.python", version: "2.19.2" },
        trace: { release: "checkout@1.4.2", environment: "staging" },
      },
      [
        {
          header: { type: "user_report" },
          payload: {
            event_id: "aa11bb22cc33dd44ee55ff6677889900",
            name: "Jane",
            email: "jane@example.com",
            comments: "It crashed when I paid.",
          },
        },
      ],
    );
    const [log] = logsOf(translation) as [FlatLog];

    expect(log.record["body"]).toEqual({
      stringValue: "It crashed when I paid.",
    });
    expect(log.attributes).toEqual({
      "sentry.feedback.name": "Jane",
      "sentry.feedback.contact_email": "jane@example.com",
      "sentry.feedback.associated_event_id": "aa11bb22cc33dd44ee55ff6677889900",
    });
    expect(log.resource).toMatchObject({
      "service.name": "checkout",
      "deployment.environment.name": "staging",
    });
  });

  test("feedback with no message is malformed", () => {
    const translation: SentryTranslation = translate({}, [
      {
        header: { type: "feedback" },
        payload: { ...widgetFeedback, contexts: { feedback: { name: "x" } } },
      },
      { header: { type: "user_report" }, payload: { comments: "" } },
    ]);

    expect(translation.logs).toBeNull();
    expect(translation.malformedItemCount).toBe(2);
  });
});

// sentry-python's transaction (sentry_sdk/tracing.py) and its profile, in one envelope.
const pythonTransaction: JSONObject = {
  type: "transaction",
  event_id: TRANSACTION_EVENT_ID,
  transaction: "GET /users",
  start_timestamp: 1705400000.0,
  timestamp: 1705400000.05,
  platform: "python",
  release: "checkout@1.4.2",
  environment: "production",
  contexts: {
    trace: { trace_id: TRACE_ID, span_id: ROOT_SPAN_ID, op: "http.server" },
  },
  spans: [],
};

const MAIN_THREAD: string = "140324567890";
const WORKER_THREAD: string = "140324500000";

const pythonProfile: (overrides?: JSONObject) => JSONObject = (
  overrides?: JSONObject,
): JSONObject => {
  return {
    environment: "production",
    event_id: PROFILE_EVENT_ID,
    platform: "python",
    release: "checkout@1.4.2",
    timestamp: "2024-01-16T10:13:20.000000Z",
    version: "1",
    device: { architecture: "x86_64" },
    os: { name: "Linux", version: "6.5.0" },
    runtime: { name: "CPython", version: "3.11.4" },
    transactions: [
      {
        id: TRANSACTION_EVENT_ID,
        name: "GET /users",
        relative_start_ns: "0",
        relative_end_ns: "50000000",
        trace_id: TRACE_ID,
        active_thread_id: MAIN_THREAD,
      },
    ],
    profile: {
      frames: [
        {
          abs_path: "/app/app/db.py",
          module: "app.db",
          filename: "app/db.py",
          function: "Database.query",
          lineno: 42,
          in_app: true,
        },
        {
          abs_path: "/app/app/views.py",
          module: "app.views",
          filename: "app/views.py",
          function: "list_users",
          lineno: 12,
          in_app: true,
        },
        {
          abs_path: "/usr/lib/python3.11/threading.py",
          module: "threading",
          filename: "threading.py",
          function: "Thread.run",
          lineno: 975,
          in_app: false,
        },
      ],
      // Each stack from its leaf, as extract_stack walks f_back.
      stacks: [[0, 1], [1], [2]],
      samples: [
        { elapsed_since_start_ns: "0", thread_id: MAIN_THREAD, stack_id: 0 },
        { elapsed_since_start_ns: "0", thread_id: WORKER_THREAD, stack_id: 2 },
        {
          elapsed_since_start_ns: "9900990",
          thread_id: MAIN_THREAD,
          stack_id: 0,
        },
        {
          elapsed_since_start_ns: "9900990",
          thread_id: WORKER_THREAD,
          stack_id: 2,
        },
        {
          elapsed_since_start_ns: "19801980",
          thread_id: MAIN_THREAD,
          stack_id: 1,
        },
        // A stack that is not there: left out.
        {
          elapsed_since_start_ns: "29702970",
          thread_id: MAIN_THREAD,
          stack_id: 9,
        },
      ],
      thread_metadata: {
        [MAIN_THREAD]: { name: "MainThread" },
        [WORKER_THREAD]: { name: "ThreadPoolExecutor-0_0" },
      },
    },
    ...overrides,
  };
};

describe("Sentry profiles", () => {
  test("a transaction's profile is an OTLP profile: each thread's stacks, counted and timed, linked to the transaction", () => {
    const translation: SentryTranslation = translate(PYTHON_HEADER, [
      // The profile comes after its transaction, as sentry-python sends them.
      { header: { type: "transaction" }, payload: pythonTransaction },
      { header: { type: "profile" }, payload: pythonProfile() },
    ]);
    const [flat] = profilesOf(translation) as [FlatProfile];

    expect(translation.accepted.profiles).toBe(1);
    expect(translation.accepted.transactions).toBe(1);
    expect(flat.scope).toEqual({ name: "sentry" });
    expect(flat.resource).toMatchObject({
      "service.name": "checkout",
      "service.version": "checkout@1.4.2",
      "deployment.environment.name": "production",
      "telemetry.sdk.language": "python",
    });

    expect(flat.container["profileId"]).toBe(PROFILE_EVENT_ID);
    expect(flat.container["originalPayloadFormat"]).toBe("sentry.profile");
    expect(flat.container["startTimeUnixNano"]).toBe(NOW_NANO);
    // The last sample read, plus one interval.
    expect(flat.container["endTimeUnixNano"]).toBe(
      (BigInt(NOW_NANO) + BigInt(19801980) + BigInt(9900990)).toString(),
    );
    expect(attributesOf(flat.container["attributes"])).toEqual({
      "sentry.transaction.name": "GET /users",
      "sentry.transaction.id": TRANSACTION_EVENT_ID,
      "sentry.platform": "python",
    });

    // 101 Hz, read from the samples' times.
    expect(flat.profile["period"]).toBe("9900990");
    const strings: Array<string> = flat.profile["stringTable"] as Array<string>;
    const sampleTypes: Array<JSONObject> = flat.profile[
      "sampleType"
    ] as Array<JSONObject>;

    expect(
      sampleTypes.map((sampleType: JSONObject) => {
        return [
          strings[sampleType["type"] as number],
          strings[sampleType["unit"] as number],
        ];
      }),
    ).toEqual([
      ["samples", "count"],
      ["wall", "nanoseconds"],
    ]);

    const samples: Array<ReadSample> = samplesOf(flat.profile);
    const link: JSONObject = { traceId: TRACE_ID, spanId: ROOT_SPAN_ID };

    expect(samples).toEqual([
      {
        frames: ["Database.query@app/db.py:42", "list_users@app/views.py:12"],
        thread: { "thread.id": MAIN_THREAD, "thread.name": "MainThread" },
        link: link,
        values: ["2", "19801980"],
        time: NOW_NANO,
      },
      {
        frames: ["Thread.run@threading.py:975"],
        thread: {
          "thread.id": WORKER_THREAD,
          "thread.name": "ThreadPoolExecutor-0_0",
        },
        // Not the transaction's thread.
        link: null,
        values: ["2", "19801980"],
        time: NOW_NANO,
      },
      {
        frames: ["list_users@app/views.py:12"],
        thread: { "thread.id": MAIN_THREAD, "thread.name": "MainThread" },
        link: link,
        values: ["1", "9900990"],
        time: (BigInt(NOW_NANO) + BigInt(19801980)).toString(),
      },
    ]);
  });

  test("a profile's frames carry OpenTelemetry's frame type for the platform", () => {
    const [flat] = profilesOf(
      translate(PYTHON_HEADER, [
        { header: { type: "profile" }, payload: pythonProfile() },
      ]),
    ) as [FlatProfile];
    const attributeTable: Array<JSONObject> = flat.profile[
      "attributeTable"
    ] as Array<JSONObject>;

    for (const location of flat.profile["locationTable"] as Array<JSONObject>) {
      const [index] = location["attributeIndices"] as [number];

      expect(attributeTable[index]).toEqual({
        key: "profile.frame.type",
        value: { stringValue: "cpython" },
      });
    }
  });

  test("a profile whose transaction is not in its envelope links to its trace alone", () => {
    const [flat] = profilesOf(
      translate(PYTHON_HEADER, [
        { header: { type: "profile" }, payload: pythonProfile() },
      ]),
    ) as [FlatProfile];

    expect(samplesOf(flat.profile)[0]!.link).toEqual({
      traceId: TRACE_ID,
      spanId: "",
    });
  });

  test("a profile item before its transaction still finds it: profiles are read last", () => {
    const [flat] = profilesOf(
      translate(PYTHON_HEADER, [
        { header: { type: "profile" }, payload: pythonProfile() },
        { header: { type: "transaction" }, payload: pythonTransaction },
      ]),
    ) as [FlatProfile];

    expect(samplesOf(flat.profile)[0]!.link).toEqual({
      traceId: TRACE_ID,
      spanId: ROOT_SPAN_ID,
    });
  });

  test("a continuous profiling chunk: samples at their own times, the SDK its client_sdk, no link", () => {
    const chunk: JSONObject = {
      chunk_id: "5a4b3c2d1e0f4a5b9c8d7e6f5a4b3c2d",
      profiler_id: "0f1e2d3c4b5a49687f6e5d4c3b2a1908",
      client_sdk: { name: "sentry.python", version: "2.19.2" },
      platform: "python",
      release: "checkout@1.4.2",
      environment: "production",
      version: "2",
      profile: {
        frames: [{ function: "handle", filename: "app/server.py", lineno: 7 }],
        stacks: [[0]],
        samples: [
          { timestamp: 1705400000.0, thread_id: "1", stack_id: 0 },
          { timestamp: 1705400000.01, thread_id: "1", stack_id: 0 },
          { timestamp: 1705400000.02, thread_id: "1", stack_id: 0 },
        ],
        thread_metadata: { "1": { name: "MainThread" } },
      },
    };
    const [flat] = profilesOf(
      translate({}, [{ header: { type: "profile_chunk" }, payload: chunk }]),
    ) as [FlatProfile];

    expect(flat.container["profileId"]).toBe(
      "5a4b3c2d1e0f4a5b9c8d7e6f5a4b3c2d",
    );
    expect(flat.container["originalPayloadFormat"]).toBe(
      "sentry.profile_chunk",
    );
    expect(attributesOf(flat.container["attributes"])).toEqual({
      "sentry.profiler_id": "0f1e2d3c4b5a49687f6e5d4c3b2a1908",
      "sentry.platform": "python",
    });
    expect(flat.resource).toMatchObject({
      "service.name": "checkout",
      "telemetry.sdk.name": "sentry.python",
      "telemetry.sdk.version": "2.19.2",
    });
    expect(flat.profile["period"]).toBe("10000000");
    expect(flat.container["startTimeUnixNano"]).toBe("1705400000000000000");
    expect(samplesOf(flat.profile)).toEqual([
      {
        frames: ["handle@app/server.py:7"],
        thread: { "thread.id": "1", "thread.name": "MainThread" },
        link: null,
        values: ["3", "30000000"],
        time: "1705400000000000000",
      },
    ]);
  });

  test("a profile of one sample a thread is taken at Sentry's usual interval", () => {
    const [flat] = profilesOf(
      translate(PYTHON_HEADER, [
        {
          header: { type: "profile" },
          payload: pythonProfile({
            profile: {
              frames: [{ function: "main", filename: "main.py", lineno: 1 }],
              stacks: [[0]],
              samples: [
                { elapsed_since_start_ns: "0", thread_id: "1", stack_id: 0 },
              ],
              thread_metadata: {},
            },
          }),
        },
      ]),
    ) as [FlatProfile];

    expect(flat.profile["period"]).toBe(
      String(DEFAULT_PROFILE_SAMPLE_INTERVAL_NS),
    );
    expect(samplesOf(flat.profile)[0]!.thread).toEqual({ "thread.id": "1" });
  });

  test("an Android profile (a trace file, not samples) is skipped, and counted nowhere", () => {
    const translation: SentryTranslation = translate(PYTHON_HEADER, [
      {
        header: { type: "profile" },
        payload: {
          platform: "android",
          version: "1",
          sampled_profile: "U0xPVyBUUkFDRQ==",
          transactions: [],
        },
      },
    ]);

    expect(translation.profiles).toBeNull();
    expect(translation.ignoredItemTypes).toEqual(["profile"]);
    expect(translation.ingestBytes.profiles).toBe(0);
  });

  test("each signal is counted at the items it came from: the profile at its own bytes", () => {
    const transaction: string = JSON.stringify(pythonTransaction);
    const profile: string = JSON.stringify(pythonProfile());
    const checkIn: string = JSON.stringify(pythonCheckIn());
    const translation: SentryTranslation = translate(PYTHON_HEADER, [
      { header: { type: "transaction" }, payload: transaction },
      { header: { type: "profile" }, payload: profile },
      { header: { type: "check_in" }, payload: checkIn },
      { header: { type: "attachment" }, payload: "x".repeat(5000) },
    ]);

    expect(translation.ingestBytes).toEqual({
      traces: Buffer.byteLength(transaction),
      logs: Buffer.byteLength(checkIn),
      profiles: Buffer.byteLength(profile),
    });
  });
});
