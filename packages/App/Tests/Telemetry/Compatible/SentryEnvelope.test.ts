import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import StackTraceParser, {
  StackFrame,
} from "Common/Server/Utils/Telemetry/StackTraceParser";
import {
  ExceptionGroupingBasis,
  ExceptionGroupingKey,
  getExceptionGroupingKey,
} from "Common/Server/Utils/Telemetry/ExceptionGrouping";
import SentryEnvelope, {
  MAX_ENVELOPE_ITEMS,
  MAX_EXCEPTIONS_PER_CHAIN,
  MAX_FRAMES_PER_EXCEPTION,
  MAX_LOG_RECORDS_PER_ENVELOPE,
  MAX_SPANS_PER_TRANSACTION,
  MAX_STACK_TRACE_BYTES,
  ParsedSentryEnvelope,
  SentryEnvelopeError,
  SentryTranslation,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/SentryEnvelope";

/*
 * Sentry SDK payloads as OTLP: envelopes (and the store endpoint's single
 * events) from sentry-python, @sentry/node, @sentry/browser, sentry-java,
 * sentry-dotnet, sentry-go, sentry-ruby and sentry-php. Error events become
 * one span with an "exception" event whose stack trace is written as the
 * platform writes one - checked here against StackTraceParser and grouping
 * v2, which read it at ingest - message events and log items become log
 * records, transactions and span items become spans.
 */

const NOW_MS: number = 1705400000000;
const NOW_NANO: string = "1705400000000000000";

interface FlatSpan {
  resource: Record<string, unknown>;
  span: JSONObject;
  attributes: Record<string, unknown>;
}

interface FlatLog {
  resource: Record<string, unknown>;
  record: JSONObject;
  attributes: Record<string, unknown>;
}

interface ItemSpec {
  header: JSONObject;
  payload: JSONObject | string | Buffer;
  // Writes the payload's byte length into the item header, as sentry-python does.
  length?: boolean;
}

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

const spansOf: (translation: SentryTranslation) => Array<FlatSpan> = (
  translation: SentryTranslation,
): Array<FlatSpan> => {
  const result: Array<FlatSpan> = [];

  for (const resourceSpan of (translation.traces?.["resourceSpans"] ||
    []) as Array<JSONObject>) {
    const resource: Record<string, unknown> = attributesOf(
      (resourceSpan["resource"] as JSONObject)["attributes"],
    );

    for (const scopeSpan of resourceSpan["scopeSpans"] as Array<JSONObject>) {
      expect((scopeSpan["scope"] as JSONObject)["name"]).toBe("sentry");

      for (const span of scopeSpan["spans"] as Array<JSONObject>) {
        result.push({
          resource: resource,
          span: span,
          attributes: attributesOf(span["attributes"]),
        });
      }
    }
  }

  return result;
};

const logsOf: (translation: SentryTranslation) => Array<FlatLog> = (
  translation: SentryTranslation,
): Array<FlatLog> => {
  const result: Array<FlatLog> = [];

  for (const resourceLog of (translation.logs?.["resourceLogs"] ||
    []) as Array<JSONObject>) {
    const resource: Record<string, unknown> = attributesOf(
      (resourceLog["resource"] as JSONObject)["attributes"],
    );

    for (const scopeLog of resourceLog["scopeLogs"] as Array<JSONObject>) {
      expect((scopeLog["scope"] as JSONObject)["name"]).toBe("sentry");

      for (const record of scopeLog["logRecords"] as Array<JSONObject>) {
        result.push({
          resource: resource,
          record: record,
          attributes: attributesOf(record["attributes"]),
        });
      }
    }
  }

  return result;
};

// The attributes of a span's one "exception" event.
const exceptionOf: (span: JSONObject) => Record<string, unknown> = (
  span: JSONObject,
): Record<string, unknown> => {
  const events: Array<JSONObject> = span["events"] as Array<JSONObject>;

  expect(events).toHaveLength(1);
  expect(events[0]!["name"]).toBe("exception");
  expect(events[0]!["timeUnixNano"]).toBe(span["startTimeUnixNano"]);

  return attributesOf(events[0]!["attributes"]);
};

const translateEvent: (
  event: JSONObject,
  options?: { serviceName?: string },
) => SentryTranslation = (
  event: JSONObject,
  options?: { serviceName?: string },
): SentryTranslation => {
  return SentryEnvelope.fromStoreEvent(event, { nowInMs: NOW_MS, ...options });
};

const translateEnvelope: (
  body: Buffer,
  options?: { serviceName?: string },
) => SentryTranslation = (
  body: Buffer,
  options?: { serviceName?: string },
): SentryTranslation => {
  return SentryEnvelope.fromEnvelope(SentryEnvelope.parseEnvelope(body), {
    nowInMs: NOW_MS,
    ...options,
  });
};

// The one span an error event became, and its exception.
const errorOf: (event: JSONObject) => {
  flat: FlatSpan;
  exception: Record<string, unknown>;
} = (
  event: JSONObject,
): { flat: FlatSpan; exception: Record<string, unknown> } => {
  const spans: Array<FlatSpan> = spansOf(translateEvent(event));

  expect(spans).toHaveLength(1);

  return { flat: spans[0]!, exception: exceptionOf(spans[0]!.span) };
};

const stackTraceOf: (event: JSONObject) => string = (
  event: JSONObject,
): string => {
  return errorOf(event).exception["exception.stacktrace"] as string;
};

const envelopeOf: (
  header: JSONObject | string,
  items: Array<ItemSpec>,
  options?: { trailingNewline?: boolean },
) => Buffer = (
  header: JSONObject | string,
  items: Array<ItemSpec>,
  options?: { trailingNewline?: boolean },
): Buffer => {
  const parts: Array<Buffer> = [
    Buffer.from(typeof header === "string" ? header : JSON.stringify(header)),
  ];

  for (const item of items) {
    const payload: Buffer = Buffer.isBuffer(item.payload)
      ? item.payload
      : Buffer.from(
          typeof item.payload === "string"
            ? item.payload
            : JSON.stringify(item.payload),
        );
    const itemHeader: JSONObject = item.length
      ? { ...item.header, length: payload.length }
      : item.header;

    parts.push(
      Buffer.from("\n"),
      Buffer.from(JSON.stringify(itemHeader)),
      Buffer.from("\n"),
      payload,
    );
  }

  if (options?.trailingNewline !== false) {
    parts.push(Buffer.from("\n"));
  }

  return Buffer.concat(parts);
};

const parseError: (body: Buffer | string) => SentryEnvelopeError = (
  body: Buffer | string,
): SentryEnvelopeError => {
  try {
    SentryEnvelope.parseEnvelope(
      typeof body === "string" ? Buffer.from(body) : body,
    );
  } catch (error) {
    expect(error).toBeInstanceOf(SentryEnvelopeError);
    return error as SentryEnvelopeError;
  }

  throw new Error("The envelope was not refused.");
};

/*
 * Where a value holds what JSON cannot carry back (NaN, an infinity, a
 * null or an undefined), by path.
 */
const unsafeValuesIn: (value: unknown, path?: string) => Array<string> = (
  value: unknown,
  path: string = "$",
): Array<string> => {
  if (value === null || value === undefined) {
    return [path];
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? [] : [path];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry: unknown, index: number): Array<string> => {
      return unsafeValuesIn(entry, `${path}[${index}]`);
    });
  }

  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).flatMap(
      (key: string): Array<string> => {
        return unsafeValuesIn(
          (value as Record<string, unknown>)[key],
          `${path}.${key}`,
        );
      },
    );
  }

  return [];
};

const expectJsonSafe: (translation: SentryTranslation) => void = (
  translation: SentryTranslation,
): void => {
  for (const payload of [translation.traces, translation.logs]) {
    if (payload === null) {
      continue;
    }

    expect(unsafeValuesIn(payload)).toEqual([]);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  }
};

const frameNames: (stackTrace: string) => Array<string> = (
  stackTrace: string,
): Array<string> => {
  return StackTraceParser.parse(stackTrace).frames.map(
    (frame: StackFrame): string => {
      return frame.functionName;
    },
  );
};

const deepFrames: (count: number) => Array<JSONObject> = (
  count: number,
): Array<JSONObject> => {
  const frames: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    frames.push({
      function: `step${index}`,
      filename: "/app/src/deep.js",
      abs_path: "/app/src/deep.js",
      lineno: index + 1,
      colno: 7,
    });
  }

  return frames;
};

/*
 * ---------------------------------------------------------------------------
 * Payloads, modelled on what each SDK sends.
 * ---------------------------------------------------------------------------
 */

const PYTHON_EVENT_ID: string = "9ec79c33ec9942ab8353589fcb2e04dc";
const PYTHON_TRACE_ID: string = "771a43a4192642f0b136d5159a501700";
const PYTHON_ACTIVE_SPAN_ID: string = "a0cfbde2bdff3adc";

// sentry-python (Django): an unhandled ZeroDivisionError in a view.
const PYTHON_ERROR_EVENT: JSONObject = {
  event_id: PYTHON_EVENT_ID,
  timestamp: "2024-01-15T10:30:00.123456Z",
  platform: "python",
  level: "error",
  server_name: "web-1",
  release: "checkout@1.4.2",
  environment: "production",
  transaction: "/api/checkout",
  transaction_info: { source: "route" },
  sdk: {
    name: "sentry.python.django",
    version: "2.19.2",
    packages: [{ name: "pypi:sentry-sdk", version: "2.19.2" }],
    integrations: ["django", "logging", "stdlib"],
  },
  contexts: {
    trace: {
      trace_id: PYTHON_TRACE_ID,
      span_id: PYTHON_ACTIVE_SPAN_ID,
      parent_span_id: "b9f6f3e2a1c0d4e5",
      op: "http.server",
      status: "ok",
      type: "trace",
    },
    runtime: {
      name: "CPython",
      version: "3.12.1",
      build: "3.12.1 (main, Dec 19 2023, 20:23:36) [GCC 12.2.0]",
    },
  },
  exception: {
    values: [
      {
        module: null,
        type: "ZeroDivisionError",
        value: "division by zero",
        mechanism: { type: "django", handled: false },
        stacktrace: {
          frames: [
            {
              filename: "django/core/handlers/exception.py",
              abs_path:
                "/usr/local/lib/python3.12/site-packages/django/core/handlers/exception.py",
              function: "inner",
              module: "django.core.handlers.exception",
              lineno: 55,
              pre_context: ["    def inner(request):", "        try:"],
              context_line: "            response = get_response(request)",
              post_context: ["        except Exception as exc:"],
              vars: { request: "<WSGIRequest: POST '/api/checkout'>" },
              in_app: false,
            },
            {
              filename: "shop/views.py",
              abs_path: "/srv/app/shop/views.py",
              function: "checkout",
              module: "shop.views",
              lineno: 42,
              pre_context: [
                "def checkout(request):",
                "    order = Order.objects.get(pk=request.POST['order'])",
              ],
              context_line: "    total = order.total / order.quantity",
              post_context: ["    return JsonResponse({'total': total})"],
              vars: { order: "<Order: 1001>" },
              in_app: true,
            },
          ],
        },
      },
    ],
  },
  user: {
    id: "42",
    email: "jane@example.com",
    username: "jane",
    ip_address: "203.0.113.7",
  },
  request: {
    url: "https://shop.example.com/api/checkout",
    query_string: "step=pay",
    method: "POST",
    headers: {
      Host: "shop.example.com",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
      "Content-Type": "application/json",
    },
    env: { SERVER_NAME: "web-1", SERVER_PORT: "8000" },
  },
  tags: { "payment.provider": "stripe" },
  extra: {
    "sys.argv": ["manage.py", "runserver"],
    order: { id: 1001, items: 3 },
  },
  breadcrumbs: {
    values: [
      {
        timestamp: "2024-01-15T10:29:59.000000Z",
        category: "query",
        message: "SELECT * FROM shop_order WHERE id = 1001",
      },
    ],
  },
  modules: { django: "5.0.1", "sentry-sdk": "2.19.2" },
  fingerprint: ["{{ default }}", "checkout"],
};

const PYTHON_TRACEBACK: string = [
  "Traceback (most recent call last):",
  '  File "/usr/local/lib/python3.12/site-packages/django/core/handlers/exception.py", line 55, in inner',
  "    response = get_response(request)",
  '  File "/srv/app/shop/views.py", line 42, in checkout',
  "    total = order.total / order.quantity",
  "ZeroDivisionError: division by zero",
].join("\n");

const PYTHON_ENVELOPE_HEADER: JSONObject = {
  event_id: PYTHON_EVENT_ID,
  sent_at: "2024-01-15T10:30:00.200000Z",
  dsn: "https://0123456789abcdef0123456789abcdef@oneuptime.example.com/1",
  sdk: { name: "sentry.python.django", version: "2.19.2" },
  trace: {
    trace_id: PYTHON_TRACE_ID,
    environment: "production",
    release: "checkout@1.4.2",
    public_key: "0123456789abcdef0123456789abcdef",
    transaction: "/api/checkout",
    sample_rate: "1.0",
    sampled: "true",
  },
};

// A log file attached to the event: text, then bytes that are not UTF-8 and newlines.
const LOG_FILE_ATTACHMENT: Buffer = Buffer.concat([
  Buffer.from(
    "2024-01-15 10:29:59 INFO starting checkout\n2024-01-15 10:30:00 ERROR boom\n",
  ),
  Buffer.from([0x00, 0xff, 0x0a, 0x0a, 0x7b, 0x7d, 0x0a]),
]);

const CLIENT_REPORT: JSONObject = {
  timestamp: 1705314600.5,
  discarded_events: [
    { reason: "sample_rate", category: "transaction", quantity: 2 },
  ],
};

// sentry-python writes every item's length.
const pythonEnvelope: () => Buffer = (): Buffer => {
  return envelopeOf(PYTHON_ENVELOPE_HEADER, [
    {
      header: { type: "event", content_type: "application/json" },
      payload: PYTHON_ERROR_EVENT,
      length: true,
    },
    {
      header: {
        type: "attachment",
        filename: "checkout.log",
        content_type: "text/plain",
        attachment_type: "event.attachment",
      },
      payload: LOG_FILE_ATTACHMENT,
      length: true,
    },
    { header: { type: "client_report" }, payload: CLIENT_REPORT, length: true },
  ]);
};

// @sentry/node: an unhandled rejection whose error has a cause.
const NODE_ERROR_EVENT: JSONObject = {
  exception: {
    values: [
      {
        type: "Error",
        value: "connect ECONNREFUSED 10.0.0.5:5432",
        stacktrace: {
          frames: [
            {
              filename: "node:internal/process/task_queues",
              module: "task_queues",
              function: "process.processTicksAndRejections",
              lineno: 95,
              colno: 5,
              in_app: false,
            },
            {
              filename: "/app/node_modules/pg-pool/index.js",
              module: "pg-pool",
              function: "?",
              lineno: 45,
              colno: 11,
              in_app: false,
            },
          ],
        },
        mechanism: {
          type: "chained",
          source: "cause",
          exception_id: 1,
          parent_id: 0,
        },
      },
      {
        type: "PaymentError",
        value: "Could not charge order 1001",
        stacktrace: {
          frames: [
            {
              filename: "/app/dist/server.js",
              module: "server",
              function: "Server.<anonymous>",
              lineno: 12,
              colno: 3,
              in_app: true,
            },
            {
              filename: "/app/dist/routes/checkout.js",
              module: "routes:checkout",
              function: "chargeOrder",
              lineno: 88,
              colno: 15,
              in_app: true,
              pre_context: ["  } catch (err) {"],
              context_line:
                "    throw new PaymentError(`Could not charge order ${order.id}`, { cause: err });",
              post_context: ["  }"],
            },
          ],
        },
        mechanism: {
          type: "onunhandledrejection",
          handled: false,
          exception_id: 0,
        },
      },
    ],
  },
  event_id: "7d3b5a1e0c2f4b8a9e6d1c3f5a7b9d2e",
  platform: "node",
  contexts: {
    trace: {
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      span_id: "00f067aa0ba902b7",
    },
    runtime: { name: "node", version: "v20.11.0" },
    app: { app_start_time: "2024-01-15T09:00:00.000Z", app_memory: 104857600 },
    os: { kernel_version: "6.5.0-1014-aws", name: "Linux", version: "6.5.0" },
    device: {
      boot_time: "2024-01-01T00:00:00.000Z",
      arch: "x64",
      memory_size: 8589934592,
      processor_count: 2,
    },
    culture: { locale: "en-US", timezone: "UTC" },
  },
  server_name: "api-7d9f",
  timestamp: 1705314600.123,
  environment: "production",
  release: "api@2.3.0",
  sdk: {
    integrations: ["Http", "Express", "LinkedErrors"],
    name: "sentry.javascript.node",
    version: "8.48.0",
    packages: [{ name: "npm:@sentry/node", version: "8.48.0" }],
  },
  level: "error",
  tags: { region: "eu-west-1" },
  breadcrumbs: [
    {
      timestamp: 1705314599.9,
      category: "http",
      data: { url: "https://api.stripe.com/v1/charges", status_code: 402 },
    },
  ],
};

const NODE_TRACE: string = [
  "PaymentError: Could not charge order 1001",
  "    at chargeOrder (/app/dist/routes/checkout.js:88:15)",
  "    at Server.<anonymous> (/app/dist/server.js:12:3)",
  "Caused by: Error: connect ECONNREFUSED 10.0.0.5:5432",
  "    at /app/node_modules/pg-pool/index.js:45:11",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
].join("\n");

const NODE_ENVELOPE_HEADER: JSONObject = {
  event_id: "7d3b5a1e0c2f4b8a9e6d1c3f5a7b9d2e",
  sent_at: "2024-01-15T10:30:00.200Z",
  sdk: { name: "sentry.javascript.node", version: "8.48.0" },
  trace: {
    environment: "production",
    release: "api@2.3.0",
    public_key: "0123456789abcdef0123456789abcdef",
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  },
};

// @sentry/browser: a TypeError in a minified bundle.
const BROWSER_ERROR_EVENT: JSONObject = {
  exception: {
    values: [
      {
        type: "TypeError",
        value: "Cannot read properties of undefined (reading 'price')",
        stacktrace: {
          frames: [
            {
              filename: "https://shop.example.com/static/js/vendor.4f2a9c1b.js",
              function: "HTMLButtonElement.r",
              in_app: true,
              lineno: 2,
              colno: 31207,
            },
            {
              filename: "https://shop.example.com/static/js/main.3f2a9c1b.js",
              function: "addToCart",
              in_app: true,
              lineno: 1,
              colno: 9033,
            },
          ],
        },
        mechanism: { type: "onerror", handled: false },
      },
    ],
  },
  level: "error",
  platform: "javascript",
  request: {
    url: "https://shop.example.com/cart?coupon=SPRING",
    headers: {
      Referer: "https://shop.example.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  },
  event_id: "e5c1a2b3d4f5061728394a5b6c7d8e9f",
  timestamp: 1705314600.5,
  environment: "production",
  release: "storefront@5.0.0",
  sdk: { name: "sentry.javascript.browser", version: "8.48.0" },
  user: { id: 7, ip_address: "{{auto}}" },
  contexts: {
    trace: {
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      span_id: "b7ad6b7169203331",
    },
    browser: { name: "Chrome", version: "120.0.0" },
    os: { name: "macOS", version: "10.15.7" },
    device: { model: "MacBookPro18,1", manufacturer: "Apple" },
  },
};

// sentry-java (Spring Boot): an uncaught exception caused by a JDBC failure.
const JAVA_ERROR_EVENT: JSONObject = {
  event_id: "c2f1d3b8e9a04b6f8d7e5c4b3a291807",
  timestamp: "2024-01-15T10:30:00.123Z",
  platform: "java",
  level: "error",
  release: "billing-service@3.1.0+build.77",
  environment: "staging",
  server_name: "billing-5f6c",
  sdk: { name: "sentry.java.spring-boot.jakarta", version: "7.14.0" },
  contexts: {
    runtime: { name: "OpenJDK Runtime Environment", version: "21.0.1+12-LTS" },
    os: { name: "Linux", version: "6.1.0" },
  },
  exception: {
    values: [
      {
        type: "PSQLException",
        value: "Connection to db:5432 refused.",
        module: "org.postgresql.util",
        thread_id: 31,
        stacktrace: {
          frames: [
            {
              filename: "Thread.java",
              function: "run",
              module: "java.lang.Thread",
              lineno: 1583,
              in_app: false,
            },
            {
              filename: "InvoiceController.java",
              function: "post",
              module: "com.acme.billing.InvoiceController",
              lineno: 17,
              in_app: true,
            },
            {
              filename: "InvoiceService.java",
              function: "issue",
              module: "com.acme.billing.InvoiceService",
              lineno: 42,
              in_app: true,
            },
            {
              filename: "Driver.java",
              function: "connect",
              module: "org.postgresql.Driver",
              lineno: 297,
              in_app: false,
            },
            {
              filename: "ConnectionFactoryImpl.java",
              function: "openConnectionImpl",
              module: "org.postgresql.core.v3.ConnectionFactoryImpl",
              lineno: 346,
              in_app: false,
            },
          ],
        },
        mechanism: { type: "chained", exception_id: 1, parent_id: 0 },
      },
      {
        type: "InvoiceException",
        value: "Could not issue invoice 2024-0042",
        module: "com.acme.billing",
        thread_id: 31,
        stacktrace: {
          frames: [
            {
              filename: "Thread.java",
              function: "run",
              module: "java.lang.Thread",
              lineno: 1583,
              in_app: false,
            },
            {
              filename: "InvoiceController.java",
              function: "post",
              module: "com.acme.billing.InvoiceController",
              lineno: 17,
              in_app: true,
            },
            {
              filename: "InvoiceService.java",
              function: "issue",
              module: "com.acme.billing.InvoiceService",
              lineno: 48,
              in_app: true,
            },
          ],
        },
        mechanism: {
          type: "UncaughtExceptionHandler",
          handled: false,
          exception_id: 0,
        },
      },
    ],
  },
  threads: {
    values: [
      { id: 31, name: "http-nio-8080-exec-1", crashed: true, current: true },
    ],
  },
};

const JAVA_TRACE: string = [
  "com.acme.billing.InvoiceException: Could not issue invoice 2024-0042",
  "\tat com.acme.billing.InvoiceService.issue(InvoiceService.java:48)",
  "\tat com.acme.billing.InvoiceController.post(InvoiceController.java:17)",
  "\tat java.lang.Thread.run(Thread.java:1583)",
  "Caused by: org.postgresql.util.PSQLException: Connection to db:5432 refused.",
  "\tat org.postgresql.core.v3.ConnectionFactoryImpl.openConnectionImpl(ConnectionFactoryImpl.java:346)",
  "\tat org.postgresql.Driver.connect(Driver.java:297)",
  "\tat com.acme.billing.InvoiceService.issue(InvoiceService.java:42)",
  "\t... 2 more",
].join("\n");

// sentry-dotnet (ASP.NET Core): an enhanced frame and an original one.
const DOTNET_ERROR_EVENT: JSONObject = {
  event_id: "3f1e2d3c4b5a69788796a5b4c3d2e1f0",
  timestamp: "2024-01-15T10:30:00.1234567Z",
  platform: "csharp",
  level: "fatal",
  release: "Shop.Web@1.0.0+abc123",
  sdk: { name: "sentry.dotnet.aspnetcore", version: "4.13.0" },
  exception: {
    values: [
      {
        type: "System.InvalidOperationException",
        value: "Sequence contains no elements",
        module:
          "System.Linq, Version=8.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a",
        thread_id: 12,
        stacktrace: {
          frames: [
            {
              function:
                "async Task<IActionResult> CartController.Checkout(int cartId)",
              module: "Shop.Web.Controllers.CartController",
              filename: "Controllers/CartController.cs",
              abs_path: "/src/Shop.Web/Controllers/CartController.cs",
              lineno: 31,
              colno: 13,
              in_app: true,
              package:
                "Shop.Web, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null",
              instruction_addr: "0x42",
            },
            {
              function: "First",
              module: "System.Linq.Enumerable",
              in_app: false,
              package:
                "System.Linq, Version=8.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a",
            },
          ],
        },
        mechanism: { type: "AppDomain.UnhandledException", handled: false },
      },
    ],
  },
};

const DOTNET_TRACE: string = [
  "System.InvalidOperationException: Sequence contains no elements",
  "   at System.Linq.Enumerable.First()",
  "   at async Task<IActionResult> CartController.Checkout(int cartId) in /src/Shop.Web/Controllers/CartController.cs:line 31",
].join("\n");

// sentry-go: a recovered panic, exceptions written as an array (sentry-go's form).
const GO_PANIC_EVENT: JSONObject = {
  event_id: "5a4b3c2d1e0f49382716a5b4c3d2e1f0",
  timestamp: "2024-01-15T10:30:00.123456789Z",
  platform: "go",
  level: "fatal",
  release: "shop-api@v1.8.0",
  server_name: "shop-api-0",
  sdk: { name: "sentry.go", version: "0.30.0" },
  contexts: {
    runtime: {
      name: "go",
      version: "go1.22.0",
      go_numroutines: 12,
      go_maxprocs: 4,
    },
    os: { name: "linux" },
    device: { arch: "amd64", num_cpu: 4 },
  },
  exception: [
    {
      type: "runtime.boundsError",
      value: "runtime error: index out of range [3] with length 3",
      stacktrace: {
        frames: [
          {
            function: "main",
            module: "main",
            abs_path: "/app/cmd/api/main.go",
            lineno: 25,
            in_app: true,
          },
          {
            function: "(*Server).handleCheckout",
            module: "github.com/acme/shop/internal/api",
            abs_path: "/app/internal/api/checkout.go",
            lineno: 88,
            in_app: true,
          },
        ],
      },
    },
  ],
};

const GO_TRACE: string = [
  "panic: runtime error: index out of range [3] with length 3",
  "",
  "goroutine 1 [running]:",
  "github.com/acme/shop/internal/api.(*Server).handleCheckout()",
  "\t/app/internal/api/checkout.go:88",
  "main.main()",
  "\t/app/cmd/api/main.go:25",
].join("\n");

// sentry-ruby (Rails): ActiveRecord::RecordNotFound, request headers as pairs.
const RUBY_ERROR_EVENT: JSONObject = {
  event_id: "6b5c4d3e2f1a40b9c8d7e6f5a4b3c2d1",
  timestamp: "2024-01-15T10:30:00Z",
  platform: "ruby",
  level: "error",
  release: "storefront-rails@2024.01.15",
  environment: "production",
  server_name: "web-2",
  transaction: "OrdersController#show",
  sdk: { name: "sentry.ruby.rails", version: "5.16.1" },
  exception: {
    values: [
      {
        type: "ActiveRecord::RecordNotFound",
        value: "Couldn't find Order with 'id'=1001",
        module: "ActiveRecord",
        thread_id: 5,
        stacktrace: {
          frames: [
            {
              project_root: "/app",
              abs_path: "/app/app/controllers/orders_controller.rb",
              function: "show",
              lineno: 12,
              in_app: true,
              filename: "app/controllers/orders_controller.rb",
              context_line: "    @order = Order.find(params[:id])\n",
            },
            {
              project_root: "/app",
              abs_path:
                "/usr/local/bundle/gems/activerecord-7.1.3/lib/active_record/core.rb",
              function: "find",
              lineno: 284,
              in_app: false,
              filename: "active_record/core.rb",
            },
          ],
        },
        mechanism: { type: "rails", handled: false },
      },
    ],
  },
  request: {
    url: "https://shop.example.com/orders/1001",
    method: "GET",
    headers: [
      ["Host", "shop.example.com"],
      ["User-Agent", "curl/8.4.0"],
    ],
  },
};

const RUBY_TRACE: string = [
  "ActiveRecord::RecordNotFound: Couldn't find Order with 'id'=1001",
  "\t/usr/local/bundle/gems/activerecord-7.1.3/lib/active_record/core.rb:284:in 'find'",
  "\t/app/app/controllers/orders_controller.rb:12:in 'show'",
].join("\n");

// sentry-php (Laravel): a handled exception, with an internal frame and the entry script.
const PHP_ERROR_EVENT: JSONObject = {
  event_id: "7c6d5e4f3a2b41c0d9e8f7a6b5c4d3e2",
  timestamp: 1705314600.25,
  platform: "php",
  level: "error",
  release: "shop-laravel@11.2.0",
  sdk: { name: "sentry.php.laravel", version: "4.10.1" },
  exception: {
    values: [
      {
        type: "App\\Exceptions\\PaymentDeclined",
        value: "Card declined",
        stacktrace: {
          frames: [
            {
              filename: "/public/index.php",
              abs_path: "/var/www/html/public/index.php",
              lineno: 51,
              in_app: true,
            },
            {
              function: "Illuminate\\Foundation\\Http\\Kernel::handle",
              raw_function: "Illuminate\\Foundation\\Http\\Kernel::handle",
              filename:
                "/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php",
              abs_path:
                "/var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php",
              lineno: 145,
              in_app: false,
            },
            {
              function: "array_map",
              filename: "[internal]",
              abs_path: null,
              lineno: 0,
              in_app: false,
            },
            {
              function: "App\\Http\\Controllers\\CheckoutController::store",
              filename: "/app/Http/Controllers/CheckoutController.php",
              abs_path:
                "/var/www/html/app/Http/Controllers/CheckoutController.php",
              lineno: 38,
              in_app: true,
              context_line:
                "        throw new PaymentDeclined('Card declined');",
            },
          ],
        },
        mechanism: { type: "generic", handled: true },
      },
    ],
  },
};

const PHP_TRACE: string = [
  "App\\Exceptions\\PaymentDeclined: Card declined",
  "#0 /var/www/html/app/Http/Controllers/CheckoutController.php(38): App\\Http\\Controllers\\CheckoutController::store()",
  "#1 [internal function]: array_map()",
  "#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(145): Illuminate\\Foundation\\Http\\Kernel::handle()",
  "#3 /var/www/html/public/index.php(51): {main}",
].join("\n");

// sentry-python's logging integration: a warning inside a request.
const PYTHON_LOG_MESSAGE_EVENT: JSONObject = {
  event_id: "8d7e6f5a4b3c42d1e0f9a8b7c6d5e4f3",
  timestamp: "2024-01-15T10:30:01.000000Z",
  platform: "python",
  level: "warning",
  logger: "shop.payments",
  logentry: {
    message: "Retrying charge for order %s (attempt %d)",
    params: ["1001", 2],
    formatted: "Retrying charge for order 1001 (attempt 2)",
  },
  server_name: "web-1",
  release: "checkout@1.4.2",
  environment: "production",
  sdk: { name: "sentry.python.django", version: "2.19.2" },
  contexts: {
    trace: { trace_id: PYTHON_TRACE_ID, span_id: PYTHON_ACTIVE_SPAN_ID },
  },
  extra: { order_id: 1001 },
};

const NODE_TRACE_ID: string = "0af7651916cd43dd8448eb211c80319c";
const NODE_ROOT_SPAN_ID: string = "a1b2c3d4e5f60718";

// @sentry/node: an HTTP server transaction with database, HTTP and queue spans.
const NODE_TRANSACTION: JSONObject = {
  contexts: {
    trace: {
      span_id: NODE_ROOT_SPAN_ID,
      trace_id: NODE_TRACE_ID,
      parent_span_id: "b7ad6b7169203331",
      data: {
        "sentry.origin": "auto.http.otel.http",
        "sentry.op": "http.server",
        "sentry.source": "route",
        "http.method": "POST",
        "http.response.status_code": 201,
        url: "/api/orders",
      },
      op: "http.server",
      status: "ok",
      origin: "auto.http.otel.http",
    },
    runtime: { name: "node", version: "v20.11.0" },
  },
  spans: [
    {
      span_id: "1111111111111111",
      trace_id: NODE_TRACE_ID,
      parent_span_id: NODE_ROOT_SPAN_ID,
      data: {
        "db.system": "postgresql",
        "db.name": "shop",
        "sentry.op": "db",
      },
      description: "INSERT INTO orders (customer_id, total) VALUES ($1, $2)",
      op: "db",
      start_timestamp: 1705314600.01,
      timestamp: 1705314600.05,
      status: "ok",
      origin: "auto.db.otel.postgres",
    },
    {
      span_id: "2222222222222222",
      parent_span_id: NODE_ROOT_SPAN_ID,
      data: {
        "http.response.status_code": 402,
        url: "https://api.stripe.com/v1/charges",
      },
      description: "POST https://api.stripe.com/v1/charges",
      op: "http.client",
      start_timestamp: 1705314600.06,
      timestamp: 1705314600.2,
      status: "invalid_argument",
      tags: { "payment.provider": "stripe" },
    },
    {
      span_id: "3333333333333333",
      trace_id: NODE_TRACE_ID,
      parent_span_id: NODE_ROOT_SPAN_ID,
      description: "publish order.created",
      op: "queue.publish",
      start_timestamp: 1705314600.21,
      timestamp: 1705314600.22,
    },
    {
      span_id: "4444444444444444",
      trace_id: NODE_TRACE_ID,
      op: "function",
      start_timestamp: "1705314600.23",
      timestamp: 1705314600.229,
    },
    {
      span_id: "not-a-span-id",
      trace_id: NODE_TRACE_ID,
      op: "db",
      start_timestamp: 1705314600.1,
      timestamp: 1705314600.2,
    },
    {
      span_id: "5555555555555555",
      trace_id: NODE_TRACE_ID,
      op: "db",
      description: "never finished",
      start_timestamp: 1705314600.1,
    },
  ],
  start_timestamp: 1705314600.0,
  timestamp: 1705314600.25,
  transaction: "POST /api/orders",
  type: "transaction",
  transaction_info: { source: "route" },
  platform: "node",
  event_id: "9f8e7d6c5b4a43f2e1d0c9b8a7f6e5d4",
  environment: "production",
  release: "api@2.3.0",
  server_name: "api-7d9f",
  sdk: { name: "sentry.javascript.node", version: "8.48.0" },
  measurements: {
    "memory.used": { value: 52428800, unit: "byte" },
    "time.queue": { value: 12.5, unit: "millisecond" },
  },
  request: {
    url: "https://api.example.com/api/orders",
    method: "POST",
    headers: { "user-agent": "okhttp/4.12.0" },
  },
  user: { id: "42" },
  tags: { region: "eu-west-1" },
};

// @sentry/node 9: a log item of three records.
const NODE_LOG_ITEM: JSONObject = {
  items: [
    {
      timestamp: 1705314600.5,
      trace_id: NODE_TRACE_ID,
      level: "info",
      body: "User 42 signed in",
      severity_number: 9,
      attributes: {
        "sentry.release": { value: "api@2.3.0", type: "string" },
        "sentry.environment": { value: "production", type: "string" },
        "sentry.sdk.name": { value: "sentry.javascript.node", type: "string" },
        "sentry.sdk.version": { value: "9.10.0", type: "string" },
        "server.address": { value: "api-7d9f", type: "string" },
        "sentry.message.template": {
          value: "User %s signed in",
          type: "string",
        },
        "sentry.message.parameter.0": { value: 42, type: "integer" },
        "sentry.trace.parent_span_id": {
          value: NODE_ROOT_SPAN_ID,
          type: "string",
        },
        "login.method": { value: "oauth", type: "string" },
        "login.mfa": { value: true, type: "boolean" },
        "login.duration_ms": { value: 12.5, type: "double" },
      },
    },
    {
      timestamp: 1705314601.75,
      level: "warn",
      body: "Slow query: 1840ms",
      attributes: {
        "sentry.release": { value: "api@2.3.0", type: "string" },
        "sentry.environment": { value: "production", type: "string" },
        "sentry.sdk.name": { value: "sentry.javascript.node", type: "string" },
        "sentry.sdk.version": { value: "9.10.0", type: "string" },
        "server.address": { value: "api-7d9f", type: "string" },
        "db.duration_ms": { value: "1840", type: "integer" },
      },
    },
    {
      timestamp: 1705314602,
      level: "fatal",
      severity_number: 99,
      body: "Out of memory",
    },
  ],
};

/*
 * ---------------------------------------------------------------------------
 * Tests.
 * ---------------------------------------------------------------------------
 */

describe("SentryEnvelope.parseEnvelope", () => {
  test("reads sentry-python's envelope: the event, a binary attachment holding newlines, and a client report", () => {
    const envelope: ParsedSentryEnvelope =
      SentryEnvelope.parseEnvelope(pythonEnvelope());

    expect(envelope.header).toEqual(PYTHON_ENVELOPE_HEADER);
    expect(envelope.droppedItemCount).toBe(0);
    expect(
      envelope.items.map((item: { header: JSONObject }) => {
        return item.header["type"];
      }),
    ).toEqual(["event", "attachment", "client_report"]);

    expect(JSON.parse(envelope.items[0]!.payload.toString("utf8"))).toEqual(
      PYTHON_ERROR_EVENT,
    );
    expect(envelope.items[1]!.payload.equals(LOG_FILE_ATTACHMENT)).toBe(true);
    expect(envelope.items[1]!.header["filename"]).toBe("checkout.log");
    expect(JSON.parse(envelope.items[2]!.payload.toString("utf8"))).toEqual(
      CLIENT_REPORT,
    );
  });

  test("reads items without a length, as @sentry/node writes them, with or without a final newline", () => {
    for (const trailingNewline of [true, false]) {
      const envelope: ParsedSentryEnvelope = SentryEnvelope.parseEnvelope(
        envelopeOf(
          NODE_ENVELOPE_HEADER,
          [
            { header: { type: "event" }, payload: NODE_ERROR_EVENT },
            {
              header: { type: "session" },
              payload: { sid: "4f2a", status: "ok", errors: 0 },
            },
          ],
          { trailingNewline: trailingNewline },
        ),
      );

      expect(envelope.items).toHaveLength(2);
      expect(JSON.parse(envelope.items[0]!.payload.toString())).toEqual(
        NODE_ERROR_EVENT,
      );
      expect(JSON.parse(envelope.items[1]!.payload.toString())).toEqual({
        sid: "4f2a",
        status: "ok",
        errors: 0,
      });
    }
  });

  test("reads empty payloads: a length of 0, mid-envelope or at its very end, and an empty line", () => {
    const envelope: ParsedSentryEnvelope = SentryEnvelope.parseEnvelope(
      Buffer.from(
        [
          "{}",
          '{"type":"attachment","length":0}',
          "",
          '{"type":"event"}',
          "",
          '{"type":"attachment","length":0}',
        ].join("\n"),
      ),
    );

    expect(
      envelope.items.map((item: { header: JSONObject; payload: Buffer }) => {
        return [item.header["type"], item.payload.length];
      }),
    ).toEqual([
      ["attachment", 0],
      ["event", 0],
      ["attachment", 0],
    ]);
  });

  test("reads an envelope with no items, and skips blank lines between items", () => {
    expect(SentryEnvelope.parseEnvelope(Buffer.from("{}"))).toEqual({
      header: {},
      items: [],
      droppedItemCount: 0,
    });
    expect(SentryEnvelope.parseEnvelope(Buffer.from("{}\n")).items).toEqual([]);

    const envelope: ParsedSentryEnvelope = SentryEnvelope.parseEnvelope(
      Buffer.from(
        '{"event_id":"9ec79c33ec9942ab8353589fcb2e04dc"}\n\n  \n{"type":"event"}\n{"message":"hello"}\n\n\n{"type":"session"}\n{}\n\n',
      ),
    );

    expect(envelope.items).toHaveLength(2);
    expect(envelope.items[0]!.payload.toString()).toBe('{"message":"hello"}');
  });

  test("reads CRLF line endings", () => {
    const envelope: ParsedSentryEnvelope = SentryEnvelope.parseEnvelope(
      Buffer.from(
        '{"event_id":"9ec79c33ec9942ab8353589fcb2e04dc"}\r\n{"type":"attachment","length":5}\r\nab\ncd\r\n{"type":"event"}\r\n{"message":"hello"}\r\n',
      ),
    );

    expect(envelope.items).toHaveLength(2);
    expect(envelope.items[0]!.payload.toString()).toBe("ab\ncd");
    expect(JSON.parse(envelope.items[1]!.payload.toString())).toEqual({
      message: "hello",
    });
  });

  test("refuses a body whose first line is not a JSON object", () => {
    for (const body of [
      "",
      "\n{}",
      "not json\n{}",
      "[1,2]\n",
      "null\n",
      '"envelope"\n',
    ]) {
      const error: SentryEnvelopeError = parseError(body);

      expect(error.statusCode).toBe(400);
      expect(error.name).toBe("SentryEnvelopeError");
      expect(error.message).toContain("envelope header");
    }
  });

  test("refuses an item header that is not a JSON object", () => {
    expect(parseError('{}\n{"type":"event"}\n{}\nnot a header\n').message).toBe(
      "The header of item 2 is not a JSON object.",
    );
    expect(parseError('{}\n["event"]\n{}\n').message).toBe(
      "The header of item 1 is not a JSON object.",
    );
  });

  test("refuses a length that runs past the end, or is not a whole number of bytes", () => {
    expect(
      parseError('{}\n{"type":"attachment","length":100}\nshort\n').message,
    ).toBe("Item 1 says it is 100 bytes long, past the end of the envelope.");
    expect(parseError('{}\n{"type":"attachment","length":1}').message).toBe(
      "Item 1 says it is 1 bytes long, past the end of the envelope.",
    );

    for (const length of ["-1", "1.5", '"abc"', "true", "{}"]) {
      expect(
        parseError(`{}\n{"type":"attachment","length":${length}}\nabc\n`)
          .message,
      ).toBe("The length of item 1 is not a whole number of bytes.");
    }
  });

  test("reads a length written as a string of digits", () => {
    const envelope: ParsedSentryEnvelope = SentryEnvelope.parseEnvelope(
      Buffer.from('{}\n{"type":"attachment","length":"3"}\nabc\n'),
    );

    expect(envelope.items[0]!.payload.toString()).toBe("abc");
  });

  test("keeps the first 100 items and counts the rest; a malformed item past them ends the envelope", () => {
    const items: Array<ItemSpec> = [];

    for (let index: number = 0; index < MAX_ENVELOPE_ITEMS + 5; index++) {
      items.push({
        header: { type: "client_report" },
        payload: { index: index },
        length: index % 2 === 0,
      });
    }

    const envelope: ParsedSentryEnvelope = SentryEnvelope.parseEnvelope(
      envelopeOf({}, items),
    );

    expect(MAX_ENVELOPE_ITEMS).toBe(100);
    expect(envelope.items).toHaveLength(100);
    expect(envelope.droppedItemCount).toBe(5);
    expect(JSON.parse(envelope.items[99]!.payload.toString())).toEqual({
      index: 99,
    });

    const malformedPastCap: Buffer = Buffer.concat([
      envelopeOf({}, items.slice(0, MAX_ENVELOPE_ITEMS + 2)),
      Buffer.from('not a header\n{"type":"event","length":999}\n'),
    ]);
    const capped: ParsedSentryEnvelope =
      SentryEnvelope.parseEnvelope(malformedPastCap);

    expect(capped.items).toHaveLength(100);
    expect(capped.droppedItemCount).toBe(2);
  });
});

describe("SentryEnvelope.fromEnvelope: error events", () => {
  test("makes sentry-python's error one span in the request's trace, with an exception event, and skips what is not telemetry", () => {
    const translation: SentryTranslation = translateEnvelope(pythonEnvelope());

    expect(translation.eventId).toBe(PYTHON_EVENT_ID);
    expect(translation.accepted).toEqual({
      errors: 1,
      messages: 0,
      transactions: 0,
      spans: 0,
      logs: 0,
    });
    expect(translation.ignoredItemTypes).toEqual([
      "attachment",
      "client_report",
    ]);
    expect(translation.malformedItemCount).toBe(0);
    expect(translation.logs).toBeNull();

    const spans: Array<FlatSpan> = spansOf(translation);

    expect(spans).toHaveLength(1);
    expect(spans[0]!.span).toMatchObject({
      traceId: PYTHON_TRACE_ID,
      spanId: "8353589fcb2e04dc",
      parentSpanId: PYTHON_ACTIVE_SPAN_ID,
      name: "/api/checkout",
      kind: 1,
      startTimeUnixNano: "1705314600123456000",
      endTimeUnixNano: "1705314600123456000",
      status: { code: 2, message: "ZeroDivisionError: division by zero" },
    });

    expect(exceptionOf(spans[0]!.span)).toEqual({
      "exception.type": "ZeroDivisionError",
      "exception.message": "division by zero",
      "exception.stacktrace": PYTHON_TRACEBACK,
      "exception.escaped": true,
      "sentry.mechanism.type": "django",
    });

    expectJsonSafe(translation);
  });

  test("keeps the event's user, request, contexts, tags, fingerprint and extra data, and leaves out breadcrumbs and modules", () => {
    const spans: Array<FlatSpan> = spansOf(translateEnvelope(pythonEnvelope()));

    expect(spans[0]!.attributes).toEqual({
      "sentry.event_id": PYTHON_EVENT_ID,
      "sentry.level": "error",
      "sentry.platform": "python",
      "user.id": "42",
      "user.email": "jane@example.com",
      "user.name": "jane",
      "client.address": "203.0.113.7",
      "url.full": "https://shop.example.com/api/checkout",
      "url.query": "step=pay",
      "http.request.method": "POST",
      "user_agent.original":
        "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
      "process.runtime.name": "CPython",
      "process.runtime.version": "3.12.1",
      "payment.provider": "stripe",
      "sentry.fingerprint": '["{{ default }}","checkout"]',
      "sentry.extra.sys.argv": '["manage.py","runserver"]',
      "sentry.extra.order.id": "1001",
      "sentry.extra.order.items": "3",
    });
  });

  test("names the service from the release, and describes the deployment, host and SDK on the resource", () => {
    const spans: Array<FlatSpan> = spansOf(translateEnvelope(pythonEnvelope()));
    const resource: JSONObject = (
      translateEnvelope(pythonEnvelope()).traces![
        "resourceSpans"
      ] as Array<JSONObject>
    )[0]!["resource"] as JSONObject;

    expect(resource["attributes"]).toEqual([
      { key: "service.name", value: { stringValue: "checkout" } },
      { key: "service.version", value: { stringValue: "checkout@1.4.2" } },
      {
        key: "deployment.environment.name",
        value: { stringValue: "production" },
      },
      { key: "host.name", value: { stringValue: "web-1" } },
      {
        key: "telemetry.sdk.name",
        value: { stringValue: "sentry.python.django" },
      },
      { key: "telemetry.sdk.version", value: { stringValue: "2.19.2" } },
      { key: "telemetry.sdk.language", value: { stringValue: "python" } },
    ]);
    expect(spans[0]!.resource["service.name"]).toBe("checkout");
  });

  test("writes Python's traceback so StackTraceParser reads its frames and grouping v2 groups by the app's own frame", () => {
    const stackTrace: string = stackTraceOf(PYTHON_ERROR_EVENT);

    expect(StackTraceParser.parse(stackTrace).frames).toEqual([
      {
        functionName: "inner",
        fileName:
          "/usr/local/lib/python3.12/site-packages/django/core/handlers/exception.py",
        lineNumber: 55,
        inApp: false,
      },
      {
        functionName: "checkout",
        fileName: "/srv/app/shop/views.py",
        lineNumber: 42,
        inApp: true,
      },
    ]);

    const key: ExceptionGroupingKey = getExceptionGroupingKey({
      exceptionType: "ZeroDivisionError",
      message: "division by zero",
      stackTrace: stackTrace,
    });

    expect(key).toEqual({
      basis: ExceptionGroupingBasis.InAppFrames,
      exceptionType: "ZeroDivisionError",
      parts: ["app/shop/views.py|checkout"],
    });

    // The next occurrence, after an edit moved the line: the same exception.
    const moved: JSONObject = JSON.parse(JSON.stringify(PYTHON_ERROR_EVENT));
    const frames: Array<JSONObject> = (
      (
        ((moved["exception"] as JSONObject)["values"] as Array<JSONObject>)[0]![
          "stacktrace"
        ] as JSONObject
      )["frames"] as Array<JSONObject>
    ).slice();
    frames[1]!["lineno"] = 47;

    expect(
      getExceptionGroupingKey({
        exceptionType: "ZeroDivisionError",
        message: "division by zero",
        stackTrace: stackTraceOf(moved),
      }),
    ).toEqual(key);
  });

  test("writes a Python chain oldest first, joined as Python joins an explicit cause and an implicit context", () => {
    const chained: (source: string) => JSONObject = (
      source: string,
    ): JSONObject => {
      return {
        event_id: PYTHON_EVENT_ID,
        platform: "python",
        exception: {
          values: [
            {
              type: "KeyError",
              value: "'sku-123'",
              module: null,
              mechanism: {
                type: "chained",
                handled: true,
                exception_id: 1,
                parent_id: 0,
                source: source,
              },
              stacktrace: {
                frames: [
                  {
                    filename: "shop/inventory.py",
                    abs_path: "/srv/app/shop/inventory.py",
                    function: "reserve",
                    module: "shop.inventory",
                    lineno: 17,
                    context_line: "    stock = STOCK[sku]",
                  },
                ],
              },
            },
            {
              type: "OutOfStock",
              value: "sku-123 is out of stock",
              module: "shop.errors",
              mechanism: { type: "generic", handled: true, exception_id: 0 },
              stacktrace: {
                frames: [
                  {
                    filename: "shop/inventory.py",
                    abs_path: "/srv/app/shop/inventory.py",
                    function: "reserve",
                    module: "shop.inventory",
                    lineno: 19,
                    context_line:
                      '    raise OutOfStock(f"{sku} is out of stock") from e',
                  },
                ],
              },
            },
          ],
        },
      };
    };

    const traceback: (sentence: string) => string = (
      sentence: string,
    ): string => {
      return [
        "Traceback (most recent call last):",
        '  File "/srv/app/shop/inventory.py", line 17, in reserve',
        "    stock = STOCK[sku]",
        "KeyError: 'sku-123'",
        "",
        sentence,
        "",
        "Traceback (most recent call last):",
        '  File "/srv/app/shop/inventory.py", line 19, in reserve',
        '    raise OutOfStock(f"{sku} is out of stock") from e',
        "shop.errors.OutOfStock: sku-123 is out of stock",
      ].join("\n");
    };

    const { flat, exception } = errorOf(chained("__cause__"));

    expect(exception["exception.stacktrace"]).toBe(
      traceback(
        "The above exception was the direct cause of the following exception:",
      ),
    );
    expect(exception["exception.type"]).toBe("shop.errors.OutOfStock");
    expect(exception["exception.escaped"]).toBe(false);
    expect(flat.span["status"]).toEqual({
      code: 2,
      message: "shop.errors.OutOfStock: sku-123 is out of stock",
    });

    expect(stackTraceOf(chained("__context__"))).toBe(
      traceback(
        "During handling of the above exception, another exception occurred:",
      ),
    );
    expect(frameNames(stackTraceOf(chained("__cause__")))).toEqual([
      "reserve",
      "reserve",
    ]);
  });

  test("does not qualify a Python type with builtins or __main__, as Python does not print them", () => {
    for (const module of ["__main__", "builtins"]) {
      expect(
        errorOf({
          platform: "python",
          exception: {
            values: [{ type: "ConfigError", value: "missing", module: module }],
          },
        }).exception["exception.type"],
      ).toBe("ConfigError");
    }
  });

  test("writes @sentry/node's error and its cause as V8 does, newest first, with Caused by", () => {
    const translation: SentryTranslation = translateEnvelope(
      envelopeOf(NODE_ENVELOPE_HEADER, [
        { header: { type: "event" }, payload: NODE_ERROR_EVENT },
      ]),
    );
    const spans: Array<FlatSpan> = spansOf(translation);

    expect(spans).toHaveLength(1);
    expect(spans[0]!.span).toMatchObject({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "9e6d1c3f5a7b9d2e",
      parentSpanId: "00f067aa0ba902b7",
      name: "PaymentError",
      startTimeUnixNano: "1705314600123000000",
      status: { code: 2, message: "PaymentError: Could not charge order 1001" },
    });

    expect(exceptionOf(spans[0]!.span)).toEqual({
      "exception.type": "PaymentError",
      "exception.message": "Could not charge order 1001",
      "exception.stacktrace": NODE_TRACE,
      "exception.escaped": true,
      "sentry.mechanism.type": "onunhandledrejection",
    });

    expect(spans[0]!.attributes).toMatchObject({
      "sentry.platform": "node",
      "os.name": "Linux",
      "os.version": "6.5.0",
      "process.runtime.name": "node",
      "process.runtime.version": "v20.11.0",
      region: "eu-west-1",
    });
    expect(spans[0]!.attributes).not.toHaveProperty("device.model");

    expect(spans[0]!.resource).toEqual({
      "service.name": "api",
      "service.version": "api@2.3.0",
      "deployment.environment.name": "production",
      "host.name": "api-7d9f",
      "telemetry.sdk.name": "sentry.javascript.node",
      "telemetry.sdk.version": "8.48.0",
      "telemetry.sdk.language": "nodejs",
    });
  });

  test("writes V8 frames StackTraceParser reads, library frames marked as such, grouped by the app's frames", () => {
    const frames: Array<StackFrame> = StackTraceParser.parse(NODE_TRACE).frames;

    expect(
      frames.map((frame: StackFrame) => {
        return [frame.functionName, frame.fileName, frame.inApp];
      }),
    ).toEqual([
      ["chargeOrder", "/app/dist/routes/checkout.js", true],
      ["Server.<anonymous>", "/app/dist/server.js", true],
      ["<anonymous>", "/app/node_modules/pg-pool/index.js", false],
      [
        "process.processTicksAndRejections",
        "node:internal/process/task_queues",
        false,
      ],
    ]);

    expect(
      getExceptionGroupingKey({
        exceptionType: "PaymentError",
        message: "Could not charge order 1001",
        stackTrace: NODE_TRACE,
      }),
    ).toMatchObject({
      basis: ExceptionGroupingBasis.InAppFrames,
      parts: [
        "dist/routes/checkout.js|chargeOrder",
        "app/dist/server.js|Server.<anonymous>",
      ],
    });
  });

  test("writes @sentry/browser's frames with their bundle URLs and columns, for source maps, and reads the browser's context", () => {
    const { flat, exception } = errorOf(BROWSER_ERROR_EVENT);

    expect(exception["exception.stacktrace"]).toBe(
      [
        "TypeError: Cannot read properties of undefined (reading 'price')",
        "    at addToCart (https://shop.example.com/static/js/main.3f2a9c1b.js:1:9033)",
        "    at HTMLButtonElement.r (https://shop.example.com/static/js/vendor.4f2a9c1b.js:2:31207)",
      ].join("\n"),
    );
    expect(
      StackTraceParser.parse(exception["exception.stacktrace"] as string)
        .frames[0],
    ).toEqual({
      functionName: "addToCart",
      fileName: "https://shop.example.com/static/js/main.3f2a9c1b.js",
      lineNumber: 1,
      columnNumber: 9033,
      inApp: true,
    });

    expect(flat.attributes).toMatchObject({
      "user.id": "7",
      "url.full": "https://shop.example.com/cart?coupon=SPRING",
      "user_agent.original":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "browser.name": "Chrome",
      "browser.version": "120.0.0",
      "os.name": "macOS",
      "os.version": "10.15.7",
      "device.model": "MacBookPro18,1",
      "device.manufacturer": "Apple",
    });
    // "{{auto}}" asks Sentry to fill the address in; it is not one.
    expect(flat.attributes).not.toHaveProperty("client.address");
    expect(flat.attributes).not.toHaveProperty("url.query");
    expect(flat.resource["telemetry.sdk.language"]).toBe("webjs");
    expect(flat.resource["service.name"]).toBe("storefront");
  });

  test("writes sentry-java's chain as Java does: qualified types, Caused by, and the frames a cause shares as ... N more", () => {
    const { flat, exception } = errorOf(JAVA_ERROR_EVENT);

    expect(exception["exception.stacktrace"]).toBe(JAVA_TRACE);
    expect(exception["exception.type"]).toBe(
      "com.acme.billing.InvoiceException",
    );
    expect(exception["exception.message"]).toBe(
      "Could not issue invoice 2024-0042",
    );
    expect(exception["exception.escaped"]).toBe(true);
    expect(flat.span["name"]).toBe("com.acme.billing.InvoiceException");
    expect(flat.span["startTimeUnixNano"]).toBe("1705314600123000000");
    expect(flat.resource).toMatchObject({
      "service.name": "billing-service",
      "service.version": "billing-service@3.1.0+build.77",
      "deployment.environment.name": "staging",
      "telemetry.sdk.language": "java",
    });
    // No trace context: the error is a trace of its own, named by its event ID.
    expect(flat.span["traceId"]).toBe("c2f1d3b8e9a04b6f8d7e5c4b3a291807");
    expect(flat.span).not.toHaveProperty("parentSpanId");

    const frames: Array<StackFrame> = StackTraceParser.parse(JAVA_TRACE).frames;

    expect(
      frames.map((frame: StackFrame) => {
        return [frame.functionName, frame.lineNumber, frame.inApp];
      }),
    ).toEqual([
      ["com.acme.billing.InvoiceService.issue", 48, true],
      ["com.acme.billing.InvoiceController.post", 17, true],
      ["java.lang.Thread.run", 1583, false],
      [
        "org.postgresql.core.v3.ConnectionFactoryImpl.openConnectionImpl",
        346,
        true,
      ],
      ["org.postgresql.Driver.connect", 297, true],
      ["com.acme.billing.InvoiceService.issue", 42, true],
    ]);
  });

  test("writes Java's native frames, frames without a source file and frames without a line as Java does", () => {
    const stackTrace: string = stackTraceOf({
      platform: "java",
      exception: {
        values: [
          {
            type: "IllegalStateException",
            value: "No route",
            module: "java.lang",
            stacktrace: {
              frames: [
                {
                  module: "java.lang.Thread",
                  function: "run",
                  filename: "Thread.java",
                  lineno: 1583,
                },
                {
                  module: "jdk.internal.reflect.DirectMethodHandleAccessor",
                  function: "invoke",
                  native: true,
                },
                { module: "com.acme.Router", function: "lambda$route$0" },
                {
                  module: "com.acme.Router",
                  function: "route",
                  filename: "Router.kt",
                },
              ],
            },
          },
        ],
      },
    });

    expect(stackTrace).toBe(
      [
        "java.lang.IllegalStateException: No route",
        "\tat com.acme.Router.route(Router.kt)",
        "\tat com.acme.Router.lambda$route$0(Unknown Source)",
        "\tat jdk.internal.reflect.DirectMethodHandleAccessor.invoke(Native Method)",
        "\tat java.lang.Thread.run(Thread.java:1583)",
      ].join("\n"),
    );
    expect(frameNames(stackTrace)).toEqual([
      "com.acme.Router.lambda$route$0",
      "jdk.internal.reflect.DirectMethodHandleAccessor.invoke",
      "java.lang.Thread.run",
    ]);
  });

  test("writes sentry-dotnet's error as .NET does, keeping its full type and not its assembly", () => {
    const { flat, exception } = errorOf(DOTNET_ERROR_EVENT);

    expect(exception["exception.stacktrace"]).toBe(DOTNET_TRACE);
    expect(exception["exception.type"]).toBe(
      "System.InvalidOperationException",
    );
    expect(flat.span["startTimeUnixNano"]).toBe("1705314600123456700");
    expect(flat.resource).toMatchObject({
      "service.name": "Shop.Web",
      "telemetry.sdk.language": "dotnet",
    });

    const frames: Array<StackFrame> =
      StackTraceParser.parse(DOTNET_TRACE).frames;

    expect(
      frames.map((frame: StackFrame) => {
        return [frame.functionName, frame.fileName, frame.lineNumber];
      }),
    ).toEqual([
      ["System.Linq.Enumerable.First()", "", 0],
      [
        "async Task<IActionResult> CartController.Checkout(int cartId)",
        "/src/Shop.Web/Controllers/CartController.cs",
        31,
      ],
    ]);
    expect(frames[0]!.inApp).toBe(false);
  });

  test("writes sentry-go's recovered panic as a goroutine dump, and reads its exceptions written as an array", () => {
    const { flat, exception } = errorOf(GO_PANIC_EVENT);

    expect(exception["exception.stacktrace"]).toBe(GO_TRACE);
    expect(exception["exception.type"]).toBe("runtime.boundsError");
    expect(flat.span["startTimeUnixNano"]).toBe("1705314600123456789");
    expect(flat.resource).toMatchObject({
      "service.name": "shop-api",
      "host.name": "shop-api-0",
      "telemetry.sdk.language": "go",
    });

    const frames: Array<StackFrame> = StackTraceParser.parse(GO_TRACE).frames;

    expect(
      frames.map((frame: StackFrame) => {
        return [frame.fileName, frame.lineNumber, frame.inApp];
      }),
    ).toEqual([
      ["/app/internal/api/checkout.go", 88, true],
      ["/app/cmd/api/main.go", 25, true],
    ]);
    expect(frames[1]!.functionName).toBe("main.main");
  });

  test("writes a Go error that was not a panic under its type, with the error it wraps as Caused by", () => {
    expect(
      stackTraceOf({
        platform: "go",
        level: "error",
        exception: [
          { type: "*errors.errorString", value: "card declined" },
          {
            type: "*fmt.wrapError",
            value: "charge order 1001: card declined",
            stacktrace: {
              frames: [
                {
                  function: "main",
                  module: "main",
                  abs_path: "/app/main.go",
                  lineno: 17,
                },
                {
                  function: "chargeOrder",
                  module: "main",
                  abs_path: "/app/main.go",
                  lineno: 42,
                },
              ],
            },
          },
        ],
      }),
    ).toBe(
      [
        "*fmt.wrapError: charge order 1001: card declined",
        "",
        "goroutine 1 [running]:",
        "main.chargeOrder()",
        "\t/app/main.go:42",
        "main.main()",
        "\t/app/main.go:17",
        "Caused by: *errors.errorString: card declined",
      ].join("\n"),
    );
  });

  test("writes sentry-ruby's error as backtrace lines StackTraceParser reads, without doubling the type's namespace", () => {
    const { flat, exception } = errorOf(RUBY_ERROR_EVENT);

    expect(exception["exception.stacktrace"]).toBe(RUBY_TRACE);
    expect(exception["exception.type"]).toBe("ActiveRecord::RecordNotFound");
    expect(flat.span["name"]).toBe("OrdersController#show");
    expect(flat.span["startTimeUnixNano"]).toBe("1705314600000000000");
    // Request headers written as [key, value] pairs.
    expect(flat.attributes["user_agent.original"]).toBe("curl/8.4.0");
    expect(flat.attributes["http.request.method"]).toBe("GET");

    expect(
      StackTraceParser.parse(RUBY_TRACE).frames.map((frame: StackFrame) => {
        return [
          frame.functionName,
          frame.fileName,
          frame.lineNumber,
          frame.inApp,
        ];
      }),
    ).toEqual([
      [
        "find",
        "/usr/local/bundle/gems/activerecord-7.1.3/lib/active_record/core.rb",
        284,
        false,
      ],
      ["show", "/app/app/controllers/orders_controller.rb", 12, true],
    ]);
  });

  test("writes sentry-php's error as PHP numbers its frames, with internal functions and the entry script", () => {
    const { exception } = errorOf(PHP_ERROR_EVENT);

    expect(exception["exception.stacktrace"]).toBe(PHP_TRACE);
    expect(exception["exception.type"]).toBe(
      "App\\Exceptions\\PaymentDeclined",
    );
    // A handled exception did not escape.
    expect(exception["exception.escaped"]).toBe(false);

    expect(
      StackTraceParser.parse(PHP_TRACE).frames.map((frame: StackFrame) => {
        return [frame.functionName, frame.lineNumber, frame.inApp];
      }),
    ).toEqual([
      ["App\\Http\\Controllers\\CheckoutController::store", 38, true],
      ["Illuminate\\Foundation\\Http\\Kernel::handle", 145, false],
      ["{main}", 51, true],
    ]);
  });

  test("writes an exception without a stack trace as its type and message", () => {
    for (const platform of [
      "python",
      "node",
      "java",
      "ruby",
      "php",
      "csharp",
    ]) {
      expect(
        stackTraceOf({
          platform: platform,
          exception: {
            values: [{ type: "Timeout", value: "Request timed out after 30s" }],
          },
        }),
      ).toBe("Timeout: Request timed out after 30s");
    }

    expect(
      stackTraceOf({ platform: "go", exception: [{ value: "boom" }] }),
    ).toBe("boom");
  });

  test("leaves out frames with neither a file nor a function, and writes Sentry's unknown function as none", () => {
    expect(
      stackTraceOf({
        platform: "javascript",
        exception: {
          values: [
            {
              type: "Error",
              value: "boom",
              stacktrace: {
                frames: [
                  { lineno: 3, colno: 9, in_app: false },
                  { function: "?", filename: "https://cdn.example.com/a.js" },
                  { function: "onClick" },
                ],
              },
            },
          ],
        },
      }),
    ).toBe(
      [
        "Error: boom",
        "    at onClick (<anonymous>)",
        "    at https://cdn.example.com/a.js",
      ].join("\n"),
    );
  });

  test("names the span after the transaction, else the type, else error, and takes the event's message alongside", () => {
    expect(
      errorOf({ exception: { values: [{ value: "untyped" }] } }).flat.span[
        "name"
      ],
    ).toBe("error");

    const { flat } = errorOf({
      platform: "python",
      logger: "shop.tasks",
      logentry: { formatted: "Charging order 1001 failed" },
      exception: { values: [{ type: "ValueError", value: "bad card" }] },
    });

    expect(flat.span["name"]).toBe("ValueError");
    expect(flat.attributes["sentry.message"]).toBe(
      "Charging order 1001 failed",
    );
    expect(flat.attributes["sentry.logger"]).toBe("shop.tasks");
  });

  test("reads the older exception forms: an array of exceptions, and a single exception", () => {
    expect(
      stackTraceOf({
        platform: "python",
        exception: [{ type: "KeyError", value: "'a'" }],
      }),
    ).toBe("KeyError: 'a'");
    expect(
      stackTraceOf({
        platform: "python",
        exception: { type: "KeyError", value: "'b'" },
      }),
    ).toBe("KeyError: 'b'");
    expect(
      stackTraceOf({
        platform: "python",
        "sentry.interfaces.Exception": {
          values: [{ type: "KeyError", value: "'c'" }],
        },
        "sentry.interfaces.User": { id: "u-1" },
        "sentry.interfaces.Http": {
          url: "https://legacy.example.com/",
          method: "GET",
        },
      }),
    ).toBe("KeyError: 'c'");

    const { flat } = errorOf({
      platform: "python",
      exception: [{ type: "KeyError", value: "'d'" }],
      "sentry.interfaces.User": { id: "u-1" },
      "sentry.interfaces.Http": { url: "https://legacy.example.com/" },
    });

    expect(flat.attributes["user.id"]).toBe("u-1");
    expect(flat.attributes["url.full"]).toBe("https://legacy.example.com/");
  });
});

describe("SentryEnvelope: limits", () => {
  test("keeps an exception's newest 250 frames, and says how many were left out", () => {
    const lines: Array<string> = stackTraceOf({
      platform: "node",
      exception: {
        values: [
          {
            type: "RangeError",
            value: "Maximum call stack size exceeded",
            stacktrace: { frames: deepFrames(300) },
          },
        ],
      },
    }).split("\n");

    expect(MAX_FRAMES_PER_EXCEPTION).toBe(250);
    expect(lines).toHaveLength(1 + 250 + 1);
    expect(lines[1]).toBe("    at step299 (/app/src/deep.js:300:7)");
    expect(lines[250]).toBe("    at step50 (/app/src/deep.js:51:7)");
    expect(lines[251]).toBe("    ... 50 more frames");

    const python: Array<string> = stackTraceOf({
      platform: "python",
      exception: {
        values: [
          {
            type: "RecursionError",
            value: "maximum recursion depth exceeded",
            stacktrace: { frames: deepFrames(300) },
          },
        ],
      },
    }).split("\n");

    expect(python.slice(0, 3)).toEqual([
      "Traceback (most recent call last):",
      "  [50 earlier frames not shown]",
      '  File "/app/src/deep.js", line 51, in step50',
    ]);
    expect(python[python.length - 2]).toBe(
      '  File "/app/src/deep.js", line 300, in step299',
    );
  });

  test("keeps the raised exception and its nearest causes, at most 10", () => {
    const values: Array<JSONObject> = [];

    for (let index: number = 0; index < 12; index++) {
      values.push({ type: `Error${index}`, value: `failure ${index}` });
    }

    const { exception } = errorOf({
      platform: "node",
      exception: { values: values },
    });
    const lines: Array<string> = (
      exception["exception.stacktrace"] as string
    ).split("\n");

    expect(MAX_EXCEPTIONS_PER_CHAIN).toBe(10);
    expect(exception["exception.type"]).toBe("Error11");
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe("Error11: failure 11");
    expect(lines[1]).toBe("Caused by: Error10: failure 10");
    expect(lines[9]).toBe("Caused by: Error2: failure 2");
  });

  test("keeps a stack trace within 64 KiB, cut at a line, while the message is kept whole", () => {
    const values: Array<JSONObject> = [];

    for (let index: number = 0; index < 10; index++) {
      values.push({
        type: `Error${index}`,
        value: `failure ${index}`,
        stacktrace: {
          frames: deepFrames(250).map((frame: JSONObject) => {
            return {
              ...frame,
              abs_path: `/app/src/services/payments/providers/stripe/handlers/${index}/deep.js`,
            };
          }),
        },
      });
    }

    const stackTrace: string = stackTraceOf({
      platform: "node",
      exception: { values: values },
    });
    const lines: Array<string> = stackTrace.split("\n");

    expect(MAX_STACK_TRACE_BYTES).toBe(64 * 1024);
    expect(Buffer.byteLength(stackTrace, "utf8")).toBeLessThanOrEqual(
      MAX_STACK_TRACE_BYTES,
    );
    expect(Buffer.byteLength(stackTrace, "utf8")).toBeGreaterThan(
      MAX_STACK_TRACE_BYTES - 200,
    );
    expect(lines[lines.length - 1]).toBe("...(truncated)");

    for (const line of lines.slice(0, -1)) {
      expect(line).toMatch(
        /^( {4}at step\d+ \(\/app\/src\/services\/payments\/providers\/stripe\/handlers\/\d\/deep\.js:\d+:7\)|Error9: failure 9|Caused by: Error\d: failure \d)$/,
      );
    }

    const message: string = "x".repeat(100 * 1024);
    const { exception } = errorOf({
      platform: "node",
      exception: { values: [{ type: "Error", value: message }] },
    });

    expect(exception["exception.message"]).toBe(message);
    expect(
      Buffer.byteLength(exception["exception.stacktrace"] as string),
    ).toBeLessThanOrEqual(MAX_STACK_TRACE_BYTES);
    expect(exception["exception.stacktrace"] as string).toMatch(
      /^Error: x+\n\.\.\.\(truncated\)$/,
    );
  });

  test("cuts a long line between characters, never inside one", () => {
    const stackTrace: string = stackTraceOf({
      platform: "python",
      exception: { values: [{ type: "ValueError", value: "é".repeat(40000) }] },
    });

    expect(Buffer.byteLength(stackTrace, "utf8")).toBeLessThanOrEqual(
      MAX_STACK_TRACE_BYTES,
    );
    expect(stackTrace).not.toContain("�");
    expect(stackTrace.endsWith("é\n...(truncated)")).toBe(true);
  });
});

describe("SentryEnvelope: IDs and times", () => {
  test("makes up an event ID for an event without one, and names its trace and span by it", () => {
    const translation: SentryTranslation = translateEvent({
      platform: "python",
      exception: { values: [{ type: "ValueError", value: "bad" }] },
    });
    const span: JSONObject = spansOf(translation)[0]!.span;

    expect(translation.eventId).toMatch(/^[0-9a-f]{32}$/);
    expect(span["traceId"]).toBe(translation.eventId);
    expect(span["spanId"]).toBe(translation.eventId!.slice(16));
    expect(span).not.toHaveProperty("parentSpanId");
    expect(spansOf(translation)[0]!.attributes["sentry.event_id"]).toBe(
      translation.eventId,
    );
  });

  test("reads an event ID written as a UUID, and drops trace context IDs that are not hex or are all zeros", () => {
    const translation: SentryTranslation = translateEvent({
      event_id: "9EC79C33-EC99-42AB-8353-589FCB2E04DC",
      exception: { values: [{ type: "Error", value: "x" }] },
      contexts: {
        trace: {
          trace_id: "00000000000000000000000000000000",
          span_id: "a0cfbde2bdff3adc",
        },
      },
    });

    expect(translation.eventId).toBe(PYTHON_EVENT_ID);
    expect(spansOf(translation)[0]!.span).toMatchObject({
      traceId: PYTHON_EVENT_ID,
      spanId: "8353589fcb2e04dc",
    });
    // The active span belongs to a trace that was not read: it is no parent here.
    expect(spansOf(translation)[0]!.span).not.toHaveProperty("parentSpanId");

    const noSpan: JSONObject = spansOf(
      translateEvent({
        event_id: PYTHON_EVENT_ID,
        exception: { values: [{ type: "Error", value: "x" }] },
        contexts: { trace: { trace_id: PYTHON_TRACE_ID, span_id: "xyz" } },
      }),
    )[0]!.span;

    expect(noSpan["traceId"]).toBe(PYTHON_TRACE_ID);
    expect(noSpan).not.toHaveProperty("parentSpanId");
  });

  test("answers with the envelope header's event ID, else the first event's", () => {
    const event: JSONObject = { ...PYTHON_ERROR_EVENT };

    expect(
      translateEnvelope(
        envelopeOf({ event_id: "11111111111111111111111111111111" }, [
          { header: { type: "event" }, payload: event },
        ]),
      ).eventId,
    ).toBe("11111111111111111111111111111111");

    for (const header of [{}, { event_id: "not-an-id" }]) {
      expect(
        translateEnvelope(
          envelopeOf(header, [{ header: { type: "event" }, payload: event }]),
        ).eventId,
      ).toBe(PYTHON_EVENT_ID);
    }

    const withoutOwnId: JSONObject = { ...PYTHON_ERROR_EVENT };
    delete withoutOwnId["event_id"];

    const translation: SentryTranslation = translateEnvelope(
      envelopeOf({ event_id: "22222222222222222222222222222222" }, [
        { header: { type: "event" }, payload: withoutOwnId },
      ]),
    );

    expect(spansOf(translation)[0]!.attributes["sentry.event_id"]).toBe(
      "22222222222222222222222222222222",
    );

    expect(
      translateEnvelope(
        envelopeOf({}, [{ header: { type: "log" }, payload: NODE_LOG_ITEM }]),
      ).eventId,
    ).toBeNull();
  });

  test("reads every form of a Sentry time to the nanosecond, and takes now for one that is not a time", () => {
    const startOf: (timestamp: unknown) => unknown = (
      timestamp: unknown,
    ): unknown => {
      return spansOf(
        translateEvent({
          timestamp: timestamp as JSONObject,
          exception: { values: [{ type: "Error", value: "x" }] },
        }),
      )[0]!.span["startTimeUnixNano"];
    };

    expect(startOf(1705314600.123)).toBe("1705314600123000000");
    expect(startOf(1705314600)).toBe("1705314600000000000");
    expect(startOf("1705314600.25")).toBe("1705314600250000000");
    expect(startOf("2024-01-15T10:30:00.123456Z")).toBe("1705314600123456000");
    expect(startOf("2024-01-15T10:30:00.123456789Z")).toBe(
      "1705314600123456789",
    );
    expect(startOf("2024-01-15T12:30:00.5+02:00")).toBe("1705314600500000000");
    expect(startOf("2024-01-15T12:30:00.5+0200")).toBe("1705314600500000000");
    expect(startOf("2024-01-15T10:30:00")).toBe("1705314600000000000");
    expect(startOf("2024-01-15 10:30:00z")).toBe("1705314600000000000");

    for (const notATime of [
      "yesterday",
      "2024-13-45T99:00:00Z",
      -1,
      0,
      "0",
      "",
      null,
      true,
      { seconds: 1 },
    ]) {
      expect(startOf(notATime)).toBe(NOW_NANO);
    }
  });

  test("never writes a NaN, an infinity or a null, whatever the times and values", () => {
    const body: Buffer = Buffer.from(
      [
        "{}",
        '{"type":"transaction"}',
        `{"type":"transaction","transaction":"GET /","event_id":"${PYTHON_EVENT_ID}","start_timestamp":1e400,"timestamp":-5,"contexts":{"trace":{"trace_id":"${PYTHON_TRACE_ID}","span_id":"a0cfbde2bdff3adc","data":{"big":1e400,"none":null}}},"measurements":{"lcp":{"value":1e400},"fcp":{"value":-1e400},"ttfb":{"value":null}},"spans":[{"span_id":"aaaaaaaaaaaaaaaa","start_timestamp":"NaN","timestamp":1705314600},{"span_id":"bbbbbbbbbbbbbbbb","start_timestamp":1705314600,"timestamp":1e400}]}`,
        '{"type":"log"}',
        '{"items":[{"timestamp":1e400,"level":"info","body":"x","severity_number":1e400,"attributes":{"big":{"value":1e400,"type":"double"},"n":{"value":1e400,"type":"integer"},"nothing":{"value":null,"type":"string"}}}]}',
        '{"type":"event"}',
        `{"event_id":"${PYTHON_EVENT_ID}","timestamp":0,"exception":{"values":[{"type":"E","value":1e400}]},"extra":{"ratio":1e400,"nothing":null},"user":{"id":1e400}}`,
        '{"type":"event"}',
        '{"timestamp":-1e400,"message":"hello","level":1e400,"tags":{"a":1e400,"b":null}}',
      ].join("\n"),
    );

    const translation: SentryTranslation = translateEnvelope(body);

    expectJsonSafe(translation);
    expect(translation.accepted).toEqual({
      errors: 1,
      messages: 1,
      transactions: 1,
      spans: 1,
      logs: 1,
    });

    const spans: Array<FlatSpan> = spansOf(translation);

    expect(spans[0]!.span["startTimeUnixNano"]).toBe(NOW_NANO);
    expect(spans[0]!.span["endTimeUnixNano"]).toBe(NOW_NANO);
    expect(spans[1]!.span["startTimeUnixNano"]).toBe(NOW_NANO);
    expect(logsOf(translation)[0]!.record["timeUnixNano"]).toBe(NOW_NANO);
    expect(logsOf(translation)[0]!.record["severityNumber"]).toBe(9);
  });
});

describe("SentryEnvelope: message events", () => {
  test("makes a logging integration's record a log record in its request's trace, at its level", () => {
    const translation: SentryTranslation = translateEvent(
      PYTHON_LOG_MESSAGE_EVENT,
    );
    const logs: Array<FlatLog> = logsOf(translation);

    expect(translation.traces).toBeNull();
    expect(translation.accepted.messages).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.record).toMatchObject({
      timeUnixNano: "1705314601000000000",
      observedTimeUnixNano: NOW_NANO,
      severityNumber: 13,
      severityText: "WARN",
      body: { stringValue: "Retrying charge for order 1001 (attempt 2)" },
      traceId: PYTHON_TRACE_ID,
      spanId: PYTHON_ACTIVE_SPAN_ID,
    });
    expect(logs[0]!.attributes).toEqual({
      "sentry.event_id": "8d7e6f5a4b3c42d1e0f9a8b7c6d5e4f3",
      "sentry.level": "warning",
      "sentry.platform": "python",
      "sentry.logger": "shop.payments",
      "sentry.extra.order_id": "1001",
    });
    expect(logs[0]!.resource["service.name"]).toBe("checkout");
    expectJsonSafe(translation);
  });

  test("reads a message as a string, as {formatted, message} or as its template, at Sentry's levels", () => {
    const recordOf: (event: JSONObject) => JSONObject = (
      event: JSONObject,
    ): JSONObject => {
      const logs: Array<FlatLog> = logsOf(translateEvent(event));
      expect(logs).toHaveLength(1);
      return logs[0]!.record;
    };

    expect(
      recordOf({ message: "Nightly export finished", level: "info" }),
    ).toMatchObject({
      severityNumber: 9,
      severityText: "INFO",
      body: { stringValue: "Nightly export finished" },
    });
    expect(
      recordOf({
        message: {
          formatted: "Invoice 2024-0042 sent",
          message: "Invoice {} sent",
          params: ["2024-0042"],
        },
        level: "debug",
      }),
    ).toMatchObject({
      severityNumber: 5,
      body: { stringValue: "Invoice 2024-0042 sent" },
    });
    expect(
      recordOf({ message: { message: "Invoice {} sent" }, level: "fatal" }),
    ).toMatchObject({
      severityNumber: 21,
      body: { stringValue: "Invoice {} sent" },
    });
    // Sentry's default level is error.
    expect(recordOf({ message: "no level" })).toMatchObject({
      severityNumber: 17,
      severityText: "ERROR",
    });
    expect(recordOf({ message: "odd level", level: "loud" })).toMatchObject({
      severityNumber: 0,
      severityText: "LOUD",
    });
    expect(
      recordOf({ "sentry.interfaces.Message": { message: "raven says hi" } }),
    ).toMatchObject({ body: { stringValue: "raven says hi" } });
  });

  test("makes an event with neither an exception nor a message a log record Sentry would title <unlabeled event>", () => {
    const logs: Array<FlatLog> = logsOf(
      translateEvent({
        event_id: PYTHON_EVENT_ID,
        level: "fatal",
        exception: { values: [{ mechanism: { type: "minidump" } }] },
      }),
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]!.record["body"]).toEqual({
      stringValue: "<unlabeled event>",
    });
    expect(logs[0]!.record).not.toHaveProperty("traceId");
  });

  test("puts an error and a message from the same process under one resource", () => {
    const translation: SentryTranslation = translateEnvelope(
      envelopeOf(PYTHON_ENVELOPE_HEADER, [
        { header: { type: "event" }, payload: PYTHON_ERROR_EVENT },
        { header: { type: "event" }, payload: PYTHON_LOG_MESSAGE_EVENT },
      ]),
    );

    expect(translation.accepted).toMatchObject({ errors: 1, messages: 1 });
    expect(
      (translation.traces!["resourceSpans"] as Array<JSONObject>)[0]![
        "resource"
      ],
    ).toEqual(
      (translation.logs!["resourceLogs"] as Array<JSONObject>)[0]!["resource"],
    );
  });
});

describe("SentryEnvelope: transactions", () => {
  test("makes a transaction its root span and a span per child, with OpenTelemetry's kinds and statuses", () => {
    const translation: SentryTranslation = translateEnvelope(
      envelopeOf(NODE_ENVELOPE_HEADER, [
        { header: { type: "transaction" }, payload: NODE_TRANSACTION },
      ]),
    );
    const spans: Array<FlatSpan> = spansOf(translation);

    expect(translation.eventId).toBe("7d3b5a1e0c2f4b8a9e6d1c3f5a7b9d2e");
    expect(translation.accepted).toEqual({
      errors: 0,
      messages: 0,
      transactions: 1,
      spans: 5,
      logs: 0,
    });
    expect(spans).toHaveLength(5);

    expect(spans[0]!.span).toMatchObject({
      traceId: NODE_TRACE_ID,
      spanId: NODE_ROOT_SPAN_ID,
      parentSpanId: "b7ad6b7169203331",
      name: "POST /api/orders",
      kind: 2,
      startTimeUnixNano: "1705314600000000000",
      endTimeUnixNano: "1705314600250000000",
      status: { code: 1 },
    });
    expect(spans[0]!.span).not.toHaveProperty("events");
    expect(spans[0]!.attributes).toEqual({
      "sentry.op": "http.server",
      "sentry.origin": "auto.http.otel.http",
      "sentry.source": "route",
      "http.method": "POST",
      "http.response.status_code": "201",
      url: "/api/orders",
      "sentry.measurement.memory.used": "52428800",
      "sentry.measurement.time.queue": 12.5,
      "sentry.event_id": "9f8e7d6c5b4a43f2e1d0c9b8a7f6e5d4",
      "sentry.platform": "node",
      "user.id": "42",
      "url.full": "https://api.example.com/api/orders",
      "http.request.method": "POST",
      "user_agent.original": "okhttp/4.12.0",
      "process.runtime.name": "node",
      "process.runtime.version": "v20.11.0",
      region: "eu-west-1",
    });

    expect(
      spans.slice(1).map((flat: FlatSpan) => {
        return [
          flat.span["spanId"],
          flat.span["parentSpanId"],
          flat.span["traceId"],
          flat.span["name"],
          flat.span["kind"],
          flat.span["status"],
        ];
      }),
    ).toEqual([
      [
        "1111111111111111",
        NODE_ROOT_SPAN_ID,
        NODE_TRACE_ID,
        "INSERT INTO orders (customer_id, total) VALUES ($1, $2)",
        3,
        { code: 1 },
      ],
      [
        "2222222222222222",
        NODE_ROOT_SPAN_ID,
        NODE_TRACE_ID,
        "POST https://api.stripe.com/v1/charges",
        3,
        { code: 2, message: "invalid_argument" },
      ],
      [
        "3333333333333333",
        NODE_ROOT_SPAN_ID,
        NODE_TRACE_ID,
        "publish order.created",
        4,
        { code: 0 },
      ],
      // No description: its op; no parent: under the root.
      [
        "4444444444444444",
        NODE_ROOT_SPAN_ID,
        NODE_TRACE_ID,
        "function",
        1,
        {
          code: 0,
        },
      ],
    ]);

    expect(spans[1]!.span).toMatchObject({
      startTimeUnixNano: "1705314600010000000",
      endTimeUnixNano: "1705314600050000000",
    });
    expect(spans[1]!.attributes).toEqual({
      "sentry.op": "db",
      "db.system": "postgresql",
      "db.name": "shop",
    });
    expect(spans[2]!.attributes).toEqual({
      "sentry.op": "http.client",
      "http.response.status_code": "402",
      url: "https://api.stripe.com/v1/charges",
      "payment.provider": "stripe",
    });
    // A child that ends before it starts ends when it starts.
    expect(spans[4]!.span).toMatchObject({
      startTimeUnixNano: "1705314600230000000",
      endTimeUnixNano: "1705314600230000000",
    });
    expect(spans[0]!.resource).toEqual({
      "service.name": "api",
      "service.version": "api@2.3.0",
      "deployment.environment.name": "production",
      "host.name": "api-7d9f",
      "telemetry.sdk.name": "sentry.javascript.node",
      "telemetry.sdk.version": "8.48.0",
      "telemetry.sdk.language": "nodejs",
    });
    expectJsonSafe(translation);
  });

  test("makes a queue task's transaction a consumer, and other roots by their op", () => {
    const kindOf: (op: string) => unknown = (op: string): unknown => {
      return spansOf(
        translateEvent({
          type: "transaction",
          transaction: "task",
          start_timestamp: 1705314600,
          timestamp: 1705314601,
          contexts: {
            trace: {
              trace_id: NODE_TRACE_ID,
              span_id: NODE_ROOT_SPAN_ID,
              op: op,
            },
          },
        }),
      )[0]!.span["kind"];
    };

    expect(kindOf("http.server")).toBe(2);
    expect(kindOf("grpc.server")).toBe(2);
    expect(kindOf("queue.task.celery")).toBe(5);
    expect(kindOf("queue.process")).toBe(5);
    expect(kindOf("queue.sidekiq")).toBe(5);
    expect(kindOf("queue.publish")).toBe(1);
    expect(kindOf("ui.load")).toBe(1);
    expect(kindOf("")).toBe(1);
  });

  test("gives a child span its kind by its op", () => {
    const children: Array<JSONObject> = [
      "http.client",
      "db",
      "db.sql.query",
      "cache.get",
      "grpc.client",
      "rpc",
      "queue.publish",
      "queue.submit.celery",
      "queue.process",
      "queue.receive",
      "http.server",
      "dbx",
      "ui.render",
    ].map((op: string, index: number): JSONObject => {
      return {
        span_id: (index + 1).toString(16).padStart(16, "0"),
        op: op,
        start_timestamp: 1705314600,
        timestamp: 1705314601,
      };
    });

    const kinds: Array<unknown> = spansOf(
      translateEvent({
        type: "transaction",
        start_timestamp: 1705314600,
        timestamp: 1705314601,
        contexts: {
          trace: { trace_id: NODE_TRACE_ID, span_id: NODE_ROOT_SPAN_ID },
        },
        spans: children,
      }),
    )
      .slice(1)
      .map((flat: FlatSpan) => {
        return flat.span["kind"];
      });

    expect(kinds).toEqual([3, 3, 3, 3, 3, 3, 4, 4, 5, 5, 1, 1, 1]);
  });

  test("keeps at most 1000 child spans a transaction", () => {
    const children: Array<JSONObject> = [];

    for (
      let index: number = 0;
      index < MAX_SPANS_PER_TRANSACTION + 50;
      index++
    ) {
      children.push({
        span_id: (index + 1).toString(16).padStart(16, "0"),
        op: "db",
        start_timestamp: 1705314600,
        timestamp: 1705314601,
      });
    }

    const translation: SentryTranslation = translateEvent({
      type: "transaction",
      start_timestamp: 1705314600,
      timestamp: 1705314601,
      contexts: {
        trace: { trace_id: NODE_TRACE_ID, span_id: NODE_ROOT_SPAN_ID },
      },
      spans: children,
    });

    expect(MAX_SPANS_PER_TRANSACTION).toBe(1000);
    expect(spansOf(translation)).toHaveLength(1001);
    expect(translation.accepted.spans).toBe(1001);
  });

  test("names a transaction without a trace context by its event ID, and maps Sentry's span statuses", () => {
    const span: JSONObject = spansOf(
      translateEvent({
        type: "transaction",
        event_id: PYTHON_EVENT_ID,
        transaction: "nightly-report",
        start_timestamp: "2024-01-15T10:30:00Z",
        timestamp: "2024-01-15T10:30:05.5Z",
      }),
    )[0]!.span;

    expect(span).toMatchObject({
      traceId: PYTHON_EVENT_ID,
      spanId: "8353589fcb2e04dc",
      name: "nightly-report",
      kind: 1,
      startTimeUnixNano: "1705314600000000000",
      endTimeUnixNano: "1705314605500000000",
      status: { code: 0 },
    });
    expect(span).not.toHaveProperty("parentSpanId");

    const statusOf: (status: string) => unknown = (status: string): unknown => {
      return spansOf(
        translateEvent({
          type: "transaction",
          transaction: "t",
          contexts: {
            trace: {
              trace_id: NODE_TRACE_ID,
              span_id: NODE_ROOT_SPAN_ID,
              status: status,
            },
          },
        }),
      )[0]!.span["status"];
    };

    expect(statusOf("ok")).toEqual({ code: 1 });
    expect(statusOf("OK")).toEqual({ code: 1 });
    expect(statusOf("internal_error")).toEqual({
      code: 2,
      message: "internal_error",
    });
    expect(statusOf("deadline_exceeded")).toEqual({
      code: 2,
      message: "deadline_exceeded",
    });
    expect(statusOf("unknown_error")).toEqual({
      code: 2,
      message: "unknown_error",
    });
  });

  test("reads a transaction sent as an event item, or to the store endpoint", () => {
    const viaEventItem: SentryTranslation = translateEnvelope(
      envelopeOf({}, [
        { header: { type: "event" }, payload: NODE_TRANSACTION },
      ]),
    );

    expect(viaEventItem.accepted.transactions).toBe(1);
    expect(spansOf(viaEventItem)).toHaveLength(5);

    const viaStore: SentryTranslation = translateEvent(NODE_TRANSACTION);

    expect(viaStore.accepted).toEqual({
      errors: 0,
      messages: 0,
      transactions: 1,
      spans: 5,
      logs: 0,
    });
    expect(viaStore.eventId).toBe("9f8e7d6c5b4a43f2e1d0c9b8a7f6e5d4");
  });
});

describe("SentryEnvelope: log items", () => {
  test("makes each record of a log item a log record, its typed attributes kept and its origin on the resource", () => {
    const translation: SentryTranslation = translateEnvelope(
      envelopeOf(
        {
          sent_at: "2024-01-15T10:30:03.000Z",
          sdk: { name: "sentry.javascript.node", version: "9.10.0" },
        },
        [
          {
            header: {
              type: "log",
              item_count: 3,
              content_type: "application/vnd.sentry.items.log+json",
            },
            payload: NODE_LOG_ITEM,
          },
        ],
      ),
    );
    const logs: Array<FlatLog> = logsOf(translation);

    expect(translation.accepted.logs).toBe(3);
    expect(translation.traces).toBeNull();
    expect(logs).toHaveLength(3);

    expect(logs[0]!.record).toMatchObject({
      timeUnixNano: "1705314600500000000",
      observedTimeUnixNano: NOW_NANO,
      severityNumber: 9,
      severityText: "INFO",
      body: { stringValue: "User 42 signed in" },
      traceId: NODE_TRACE_ID,
      spanId: NODE_ROOT_SPAN_ID,
    });
    expect(logs[0]!.record["attributes"]).toEqual(
      expect.arrayContaining([
        { key: "login.method", value: { stringValue: "oauth" } },
        { key: "login.mfa", value: { boolValue: true } },
        { key: "login.duration_ms", value: { doubleValue: 12.5 } },
        { key: "sentry.message.parameter.0", value: { intValue: "42" } },
        { key: "sentry.release", value: { stringValue: "api@2.3.0" } },
      ]),
    );

    expect(logs[1]!.record).toMatchObject({
      timeUnixNano: "1705314601750000000",
      severityNumber: 13,
      severityText: "WARN",
      body: { stringValue: "Slow query: 1840ms" },
    });
    expect(logs[1]!.record).not.toHaveProperty("traceId");
    expect(logs[1]!.attributes["db.duration_ms"]).toBe("1840");

    // severity_number 99 is not OpenTelemetry's: the level decides.
    expect(logs[2]!.record).toMatchObject({
      severityNumber: 21,
      severityText: "FATAL",
    });

    expect(logs[0]!.resource).toEqual({
      "service.name": "api",
      "service.version": "api@2.3.0",
      "deployment.environment.name": "production",
      "host.name": "api-7d9f",
      "telemetry.sdk.name": "sentry.javascript.node",
      "telemetry.sdk.version": "9.10.0",
      "telemetry.sdk.language": "nodejs",
    });
    // A record that says nothing of its origin takes the envelope's SDK.
    expect(logs[2]!.resource).toEqual({
      "telemetry.sdk.name": "sentry.javascript.node",
      "telemetry.sdk.version": "9.10.0",
      "telemetry.sdk.language": "nodejs",
    });
    expectJsonSafe(translation);
  });

  test("reads severity_number when it is OpenTelemetry's, and types attributes as each type says", () => {
    const record: FlatLog = logsOf(
      translateEnvelope(
        envelopeOf({}, [
          {
            header: { type: "log" },
            payload: {
              items: [
                {
                  timestamp: 1705314600,
                  level: "custom",
                  severity_number: 14,
                  body: "typed",
                  attributes: {
                    big: { value: "9007199254740993", type: "integer" },
                    fraction: { value: 1.5, type: "integer" },
                    ratio: { value: "0.25", type: "double" },
                    flag: { value: "true", type: "boolean" },
                    count: { value: 3, type: "string" },
                    list: { value: [1, 2], type: "array" },
                    nested: { value: { a: 1 }, type: "object" },
                    bare: "plain",
                    nothing: { value: null, type: "string" },
                  },
                },
              ],
            },
          },
        ]),
      ),
    )[0]!;

    expect(record.record).toMatchObject({
      severityNumber: 14,
      severityText: "WARN",
    });
    expect(record.record["attributes"]).toEqual([
      { key: "big", value: { intValue: "9007199254740993" } },
      { key: "fraction", value: { doubleValue: 1.5 } },
      { key: "ratio", value: { doubleValue: 0.25 } },
      { key: "flag", value: { boolValue: true } },
      { key: "count", value: { stringValue: "3" } },
      { key: "list", value: { stringValue: "[1,2]" } },
      { key: "nested", value: { stringValue: '{"a":1}' } },
      { key: "bare", value: { stringValue: "plain" } },
    ]);
  });

  test("keeps at most 1000 log records an envelope, across its log items", () => {
    const item: (count: number) => JSONObject = (count: number): JSONObject => {
      const items: Array<JSONObject> = [];

      for (let index: number = 0; index < count; index++) {
        items.push({ timestamp: 1705314600, level: "info", body: `${index}` });
      }

      return { items: items };
    };

    const translation: SentryTranslation = translateEnvelope(
      envelopeOf({}, [
        { header: { type: "log" }, payload: item(600) },
        { header: { type: "log" }, payload: item(600) },
      ]),
    );

    expect(MAX_LOG_RECORDS_PER_ENVELOPE).toBe(1000);
    expect(translation.accepted.logs).toBe(1000);
    expect(logsOf(translation)).toHaveLength(1000);
  });

  test("takes the release and environment of the envelope's trace for records that do not name them", () => {
    const logs: Array<FlatLog> = logsOf(
      translateEnvelope(
        envelopeOf(
          {
            trace: {
              trace_id: NODE_TRACE_ID,
              release: "worker@1.0.0",
              environment: "staging",
            },
          },
          [
            {
              header: { type: "log" },
              payload: {
                items: [{ timestamp: 1705314600, level: "info", body: "a" }],
              },
            },
          ],
        ),
      ),
    );

    expect(logs[0]!.resource).toEqual({
      "service.name": "worker",
      "service.version": "worker@1.0.0",
      "deployment.environment.name": "staging",
    });
  });
});

describe("SentryEnvelope: span items", () => {
  test("makes a standalone span item a span, its origin from the envelope header", () => {
    const translation: SentryTranslation = translateEnvelope(
      envelopeOf(
        {
          sent_at: "2024-01-15T10:30:01.000Z",
          trace: {
            trace_id: NODE_TRACE_ID,
            environment: "production",
            release: "storefront@5.0.0",
            public_key: "0123456789abcdef0123456789abcdef",
          },
          sdk: { name: "sentry.javascript.browser", version: "8.48.0" },
        },
        [
          {
            header: { type: "span" },
            payload: {
              span_id: "6c87b1a2f2e3d4c5",
              trace_id: NODE_TRACE_ID,
              parent_span_id: "b7ad6b7169203331",
              start_timestamp: 1705314600.1,
              timestamp: 1705314600.3,
              op: "ui.interaction.click",
              description: "body > div#app > button.add-to-cart",
              data: {
                "sentry.op": "ui.interaction.click",
                "sentry.origin": "auto.http.browser.inp",
                "sentry.exclusive_time": 200,
                transaction: "/cart",
              },
              measurements: { inp: { value: 200, unit: "millisecond" } },
              segment_id: "6c87b1a2f2e3d4c5",
              is_segment: true,
              exclusive_time: 200,
            },
          },
        ],
      ),
    );
    const spans: Array<FlatSpan> = spansOf(translation);

    expect(translation.accepted.spans).toBe(1);
    expect(spans[0]!.span).toMatchObject({
      traceId: NODE_TRACE_ID,
      spanId: "6c87b1a2f2e3d4c5",
      parentSpanId: "b7ad6b7169203331",
      name: "body > div#app > button.add-to-cart",
      kind: 1,
      startTimeUnixNano: "1705314600100000000",
      endTimeUnixNano: "1705314600300000000",
      status: { code: 0 },
    });
    expect(spans[0]!.attributes).toEqual({
      "sentry.op": "ui.interaction.click",
      "sentry.origin": "auto.http.browser.inp",
      "sentry.exclusive_time": "200",
      transaction: "/cart",
    });
    expect(spans[0]!.resource).toEqual({
      "service.name": "storefront",
      "service.version": "storefront@5.0.0",
      "deployment.environment.name": "production",
      "telemetry.sdk.name": "sentry.javascript.browser",
      "telemetry.sdk.version": "8.48.0",
      "telemetry.sdk.language": "webjs",
    });
  });

  test("makes each span of a newer span item a span, its attributes typed as a log's", () => {
    const translation: SentryTranslation = translateEnvelope(
      envelopeOf({}, [
        {
          header: {
            type: "span",
            item_count: 2,
            content_type: "application/vnd.sentry.items.span.v2+json",
          },
          payload: {
            items: [
              {
                trace_id: NODE_TRACE_ID,
                span_id: NODE_ROOT_SPAN_ID,
                parent_span_id: null,
                name: "GET /users",
                status: "ok",
                is_segment: true,
                start_timestamp: 1705314600.0,
                end_timestamp: 1705314600.25,
                attributes: {
                  "sentry.op": { type: "string", value: "http.server" },
                  "sentry.release": { type: "string", value: "users@1.0.0" },
                  "sentry.sdk.name": { type: "string", value: "sentry.python" },
                  "sentry.sdk.version": { type: "string", value: "2.30.0" },
                  "http.response.status_code": { type: "integer", value: 200 },
                },
              },
              {
                trace_id: NODE_TRACE_ID,
                span_id: "1111111111111111",
                parent_span_id: NODE_ROOT_SPAN_ID,
                name: "SELECT users",
                status: "error",
                is_segment: false,
                start_timestamp: 1705314600.05,
                end_timestamp: 1705314600.2,
                attributes: {
                  "sentry.op": { type: "string", value: "db" },
                  "sentry.release": { type: "string", value: "users@1.0.0" },
                  "sentry.sdk.name": { type: "string", value: "sentry.python" },
                  "sentry.sdk.version": { type: "string", value: "2.30.0" },
                },
              },
              { trace_id: NODE_TRACE_ID, span_id: "bad", name: "skipped" },
            ],
          },
        },
      ]),
    );
    const spans: Array<FlatSpan> = spansOf(translation);

    expect(translation.accepted.spans).toBe(2);
    expect(spans[0]!.span).toMatchObject({
      spanId: NODE_ROOT_SPAN_ID,
      name: "GET /users",
      kind: 2,
      status: { code: 1 },
      endTimeUnixNano: "1705314600250000000",
    });
    expect(spans[0]!.span).not.toHaveProperty("parentSpanId");
    expect(spans[0]!.attributes["http.response.status_code"]).toBe("200");
    expect(spans[1]!.span).toMatchObject({
      parentSpanId: NODE_ROOT_SPAN_ID,
      kind: 3,
      status: { code: 2, message: "error" },
    });
    expect(spans[0]!.resource).toEqual({
      "service.name": "users",
      "service.version": "users@1.0.0",
      "telemetry.sdk.name": "sentry.python",
      "telemetry.sdk.version": "2.30.0",
      "telemetry.sdk.language": "python",
    });
  });
});

describe("SentryEnvelope: services and resources", () => {
  test("lets the x-oneuptime-service-name header name the service, else a service.name or service tag, else the release", () => {
    expect(
      errorOf({
        ...PYTHON_ERROR_EVENT,
        tags: { "service.name": "from-tag" },
      }).flat.resource["service.name"],
    ).toBe("from-tag");

    const fromPairs: Array<FlatSpan> = spansOf(
      translateEvent({
        ...PYTHON_ERROR_EVENT,
        tags: [
          ["service", "billing"],
          ["shard", 3],
          ["", "no key"],
          ["empty", ""],
          ["broken"],
        ],
      }),
    );

    expect(fromPairs[0]!.resource["service.name"]).toBe("billing");
    expect(fromPairs[0]!.attributes).toMatchObject({
      service: "billing",
      shard: "3",
    });
    expect(fromPairs[0]!.attributes).not.toHaveProperty("empty");

    expect(
      spansOf(
        translateEvent(
          { ...PYTHON_ERROR_EVENT, tags: { service: "billing" } },
          { serviceName: "pinned-by-header" },
        ),
      )[0]!.resource["service.name"],
    ).toBe("pinned-by-header");
  });

  test("reads the service from a name@version release, scoped package names included, and names none from a bare version", () => {
    const serviceOf: (release: string) => unknown = (
      release: string,
    ): unknown => {
      return errorOf({
        release: release,
        exception: { values: [{ type: "Error", value: "x" }] },
      }).flat.resource["service.name"];
    };

    expect(serviceOf("checkout@1.4.2")).toBe("checkout");
    expect(serviceOf("@acme/web@2.0.0")).toBe("@acme/web");
    expect(serviceOf("com.acme.app@1.0.0+42")).toBe("com.acme.app");
    expect(serviceOf("4f2a9c1b8d7e")).toBeUndefined();
    expect(serviceOf("@acme")).toBeUndefined();
    expect(serviceOf("checkout@")).toBeUndefined();

    const resource: Record<string, unknown> = errorOf({
      release: "4f2a9c1b8d7e",
      exception: { values: [{ type: "Error", value: "x" }] },
    }).flat.resource;

    expect(resource).toEqual({ "service.version": "4f2a9c1b8d7e" });
  });

  test("groups telemetry into one resource per distinct origin", () => {
    const event: (release: string) => JSONObject = (
      release: string,
    ): JSONObject => {
      return {
        platform: "python",
        release: release,
        exception: { values: [{ type: "Error", value: "x" }] },
      };
    };

    const translation: SentryTranslation = translateEnvelope(
      envelopeOf({}, [
        { header: { type: "event" }, payload: event("a@1") },
        { header: { type: "event" }, payload: event("b@1") },
        { header: { type: "event" }, payload: event("a@1") },
      ]),
    );
    const resourceSpans: Array<JSONObject> = translation.traces![
      "resourceSpans"
    ] as Array<JSONObject>;

    expect(resourceSpans).toHaveLength(2);
    expect(
      resourceSpans.map((resourceSpan: JSONObject) => {
        return (
          (resourceSpan["scopeSpans"] as Array<JSONObject>)[0]![
            "spans"
          ] as Array<JSONObject>
        ).length;
      }),
    ).toEqual([2, 1]);
  });

  test("names the language as OpenTelemetry does, from the platform, else the SDK", () => {
    const languageOf: (event: JSONObject) => unknown = (
      event: JSONObject,
    ): unknown => {
      return errorOf({
        ...event,
        exception: { values: [{ type: "Error", value: "x" }] },
      }).flat.resource["telemetry.sdk.language"];
    };

    expect(languageOf({ platform: "csharp" })).toBe("dotnet");
    expect(languageOf({ platform: "cocoa" })).toBe("swift");
    expect(languageOf({ platform: "elixir" })).toBe("erlang");
    expect(languageOf({ platform: "dart" })).toBe("dart");
    expect(languageOf({ sdk: { name: "sentry.java.android" } })).toBe("java");
    expect(
      languageOf({ sdk: { name: "sentry.javascript.react-native" } }),
    ).toBeUndefined();
    expect(languageOf({ sdk: { name: "sentry.javascript.nextjs" } })).toBe(
      undefined,
    );
    expect(languageOf({ platform: "other" })).toBeUndefined();
  });
});

describe("SentryEnvelope: what is skipped", () => {
  test("names each skipped item type once, in order, and counts payloads that are not JSON objects", () => {
    const translation: SentryTranslation = translateEnvelope(
      envelopeOf({}, [
        { header: { type: "session" }, payload: { sid: "1" } },
        { header: { type: "sessions" }, payload: { aggregates: [] } },
        { header: { type: "session" }, payload: { sid: "2" } },
        { header: { type: "profile" }, payload: { version: "1" } },
        { header: { type: "profile_chunk" }, payload: { version: "2" } },
        { header: { type: "replay_event" }, payload: { replay_id: "r" } },
        {
          header: { type: "replay_recording" },
          payload: Buffer.from([0x78, 0x9c, 0x0a, 0x01]),
          length: true,
        },
        { header: { type: "check_in" }, payload: { status: "ok" } },
        { header: { type: "statsd" }, payload: "a:1|c" },
        { header: { type: "user_report" }, payload: { comments: "hm" } },
        { header: { type: "feedback" }, payload: { contexts: {} } },
        { header: { type: "otel_log" }, payload: { body: "x" } },
        { header: {}, payload: { anything: true } },
        { header: { type: "event" }, payload: "not json" },
        { header: { type: "event" }, payload: "[1,2,3]" },
        { header: { type: "transaction" }, payload: "", length: true },
        { header: { type: "log" }, payload: "null" },
        { header: { type: "span" }, payload: { span_id: "no-trace" } },
      ]),
    );

    expect(translation.ignoredItemTypes).toEqual([
      "session",
      "sessions",
      "profile",
      "profile_chunk",
      "replay_event",
      "replay_recording",
      "check_in",
      "statsd",
      "user_report",
      "feedback",
      "otel_log",
      "unknown",
    ]);
    expect(translation.malformedItemCount).toBe(5);
    expect(translation.traces).toBeNull();
    expect(translation.logs).toBeNull();
    expect(translation.eventId).toBeNull();
    expect(translation.accepted).toEqual({
      errors: 0,
      messages: 0,
      transactions: 0,
      spans: 0,
      logs: 0,
    });
  });

  test("answers a store body that is not an event with nothing", () => {
    const translation: SentryTranslation = SentryEnvelope.fromStoreEvent(
      [1, 2] as unknown as JSONObject,
      { nowInMs: NOW_MS },
    );

    expect(translation.traces).toBeNull();
    expect(translation.logs).toBeNull();
    expect(translation.eventId).toBeNull();
  });
});
