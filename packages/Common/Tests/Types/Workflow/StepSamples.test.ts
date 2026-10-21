/*
 * What a workflow's steps held the last times they ran, cut down to what the
 * value picker suggests from: the fields inside each value, with a short
 * sample of each. The maintainer's ask was a picker that knows what is in a
 * webhook's body once it has received a request; these pin how a recorded
 * value becomes fields, which runs it is taken from, and that secrets never
 * become samples.
 */

import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  STEP_SAMPLE_MAX_DEPTH,
  STEP_SAMPLE_MAX_FIELDS,
  STEP_SAMPLE_PREVIEW_LENGTH,
  STEP_SAMPLE_REDACTED_VALUE,
  StepSample,
  StepSampleField,
  StepSampleKind,
  StepSampleRun,
  StepSampleValue,
  collectStepSamples,
  describeSampleValue,
  isAddressableSampleKey,
  isSensitiveSampleKey,
  parseStepSamplesResponse,
  sampleFieldReference,
  sampledComponentIds,
} from "../../../Types/Workflow/StepSamples";
import {
  TRUNCATED_VALUE_SUFFIX,
  WorkflowStepStatus,
  WorkflowStepTraceEntry,
} from "../../../Types/Workflow/StepTrace";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

const RAN_AT: string = "2026-10-01T12:00:00.000Z";

type DescribeFunction = (value: unknown) => StepSampleValue;

const describeValue: DescribeFunction = (value: unknown): StepSampleValue => {
  return describeSampleValue(value, { ranAt: RAN_AT });
};

type PathsFunction = (value: StepSampleValue) => Array<string>;

const paths: PathsFunction = (value: StepSampleValue): Array<string> => {
  return value.fields.map((field: StepSampleField) => {
    return field.path;
  });
};

type FieldFunction = (
  value: StepSampleValue,
  path: string,
) => StepSampleField | undefined;

const field: FieldFunction = (
  value: StepSampleValue,
  path: string,
): StepSampleField | undefined => {
  return value.fields.find((candidate: StepSampleField) => {
    return candidate.path === path;
  });
};

const ALERT_BODY: JSONObject = {
  environment: "production",
  incident: {
    title: "Database is down",
    severity: "critical",
    id: 4211,
    acknowledged: false,
    owner: null,
  },
  tags: ["db", "eu-west-1"],
  alerts: [
    { status: "firing", labels: { instance: "db-1" } },
    { status: "resolved", labels: { instance: "db-2" } },
  ],
};

describe("isSensitiveSampleKey", () => {
  test.each([
    "authorization",
    "Authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "apiKey",
    "ApiKey",
    "api_key",
    "apikey",
    "access_token",
    "accessToken",
    "refreshToken",
    "id_token",
    "client_secret",
    "clientSecret",
    "password",
    "user_password",
    "X-Hub-Signature-256",
    "x-auth-token",
    "sessionId",
    "session_id",
    "private_key",
    "privateKey",
    "secretKey",
    "AWS_SECRET_ACCESS_KEY",
    "x-csrf-token",
    "jwt",
    "passphrase",
    "credentials",
  ])("a value under %s is a credential", (key: string) => {
    expect(isSensitiveSampleKey(key)).toBe(true);
  });

  test.each([
    "author",
    "authorId",
    "author_association",
    "key",
    "keys",
    "keyboard",
    "monkey",
    "title",
    "environment",
    "content-type",
    "user-agent",
    "issue_key",
    "secretary",
    "tokenizer",
    "x-request-id",
    "host",
  ])("a value under %s is not", (key: string) => {
    expect(isSensitiveSampleKey(key)).toBe(false);
  });
});

describe("isAddressableSampleKey", () => {
  test.each([
    "title",
    "content-type",
    "incident_title",
    "incidentTitle",
    "X-Request-Id",
    "@timestamp",
    "$type",
    "2fa",
  ])("%s can be named in a reference", (key: string) => {
    expect(isAddressableSampleKey(key)).toBe(true);
  });

  test.each([
    "app.kubernetes.io/name",
    "a.b",
    "has space",
    "items[0]",
    "{x}",
    'say"hi"',
    "",
    "a/b",
  ])("%s cannot: the runtime could not follow it", (key: string) => {
    expect(isAddressableSampleKey(key)).toBe(false);
  });
});

describe("sampleFieldReference", () => {
  test("a field inside a value follows its name", () => {
    expect(
      sampleFieldReference({
        componentId: "webhook-1",
        returnValueId: "request-body",
        path: "incident.title",
      }),
    ).toBe(
      "{{local.components.webhook-1.returnValues.request-body.incident.title}}",
    );
  });

  test("an item of a list is indexed on the value's own name", () => {
    expect(
      sampleFieldReference({
        componentId: "api-get-1",
        returnValueId: "response-body",
        path: "[0].name",
      }),
    ).toBe("{{local.components.api-get-1.returnValues.response-body[0].name}}");
  });

  test("no path is the value itself", () => {
    expect(
      sampleFieldReference({
        componentId: "webhook-1",
        returnValueId: "request-body",
        path: "",
      }),
    ).toBe("{{local.components.webhook-1.returnValues.request-body}}");
  });
});

describe("describeSampleValue", () => {
  test("lists every field of a nested body, each field before its own", () => {
    const value: StepSampleValue = describeValue(ALERT_BODY);

    expect(value.kind).toBe(StepSampleKind.Object);
    expect(value.preview).toBe("4 fields");
    expect(value.ranAt).toBe(RAN_AT);
    expect(paths(value)).toEqual([
      "alerts",
      "alerts[0]",
      "alerts[0].labels",
      "alerts[0].labels.instance",
      "alerts[0].status",
      "environment",
      "incident",
      "incident.acknowledged",
      "incident.id",
      "incident.owner",
      "incident.severity",
      "incident.title",
      "tags",
      "tags[0]",
    ]);
  });

  test("says what each field held, and what shape it is", () => {
    const value: StepSampleValue = describeValue(ALERT_BODY);

    // Text is quoted, so it reads as what was held, not as a description.
    expect(field(value, "environment")).toEqual({
      path: "environment",
      kind: StepSampleKind.Text,
      preview: '"production"',
    });
    expect(field(value, "incident")).toEqual({
      path: "incident",
      kind: StepSampleKind.Object,
      preview: "5 fields",
    });
    expect(field(value, "incident.id")?.kind).toBe(StepSampleKind.Number);
    expect(field(value, "incident.id")?.preview).toBe("4211");
    expect(field(value, "incident.acknowledged")?.kind).toBe(
      StepSampleKind.Boolean,
    );
    expect(field(value, "incident.acknowledged")?.preview).toBe("false");
    expect(field(value, "incident.owner")?.kind).toBe(StepSampleKind.Empty);
    expect(field(value, "incident.owner")?.preview).toBe("empty");
    expect(field(value, "tags")?.kind).toBe(StepSampleKind.List);
    expect(field(value, "tags")?.preview).toBe("2 items");
    expect(field(value, "tags[0]")?.preview).toBe('"db"');
  });

  test("reads a list by its first item, the one [0] reads", () => {
    const value: StepSampleValue = describeValue(ALERT_BODY);

    expect(field(value, "alerts[0].status")?.preview).toBe('"firing"');
    expect(field(value, "alerts[1].status")).toBeUndefined();
  });

  test("a body that is a list is read as [0] on the value's own name", () => {
    const value: StepSampleValue = describeValue([
      { name: "first" },
      { name: "second" },
    ]);

    expect(value.kind).toBe(StepSampleKind.List);
    expect(value.preview).toBe("2 items");
    expect(paths(value)).toEqual(["[0]", "[0].name"]);
    expect(field(value, "[0].name")?.preview).toBe('"first"');
  });

  test("a list inside a list is not indexed twice: the runtime reads one index per part", () => {
    const value: StepSampleValue = describeValue({
      matrix: [
        [1, 2],
        [3, 4],
      ],
    });

    expect(paths(value)).toEqual(["matrix", "matrix[0]"]);
    expect(field(value, "matrix[0]")?.kind).toBe(StepSampleKind.List);
  });

  test("keys with dashes are kept; keys a reference cannot name are left out", () => {
    const value: StepSampleValue = describeValue({
      "content-type": "application/json",
      "x-request-id": "abc",
      "app.kubernetes.io/name": "api",
      "has space": 1,
      "items[0]": 2,
    });

    expect(paths(value)).toEqual(["content-type", "x-request-id"]);
  });

  test("empty values say so in words", () => {
    const value: StepSampleValue = describeValue({
      emptyObject: {},
      emptyList: [],
      emptyText: "   ",
      nothing: null,
    });

    expect(field(value, "emptyObject")?.preview).toBe("no fields");
    expect(field(value, "emptyList")?.preview).toBe("empty list");
    expect(field(value, "emptyText")?.preview).toBe("empty text");
    expect(field(value, "nothing")?.preview).toBe("empty");
  });

  test("a long text is shortened to one line, within the preview length", () => {
    const long: string = `first line\n\n${"word ".repeat(80)}`;
    const value: StepSampleValue = describeValue({ message: long });
    const preview: string = field(value, "message")?.preview as string;

    expect(preview.length).toBeLessThanOrEqual(STEP_SAMPLE_PREVIEW_LENGTH);
    expect(preview.endsWith('…"')).toBe(true);
    expect(preview.startsWith('"first line word word')).toBe(true);
    expect(preview).not.toContain("\n");
  });

  test("a value under a secret's key is listed without what it held, and so is everything inside it", () => {
    const value: StepSampleValue = describeValue({
      authorization: "Bearer abc123",
      "x-api-key": "key-123",
      credentials: { username: "ada", nested: { pin: "1234" } },
      host: "example.com",
    });

    expect(field(value, "authorization")).toEqual({
      path: "authorization",
      kind: StepSampleKind.Text,
      isHidden: true,
    });
    expect(field(value, "x-api-key")?.isHidden).toBe(true);
    expect(field(value, "credentials.username")?.isHidden).toBe(true);
    expect(field(value, "credentials.nested.pin")?.isHidden).toBe(true);
    expect(field(value, "host")?.preview).toBe('"example.com"');

    const serialized: string = JSON.stringify(value);

    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("key-123");
    expect(serialized).not.toContain("ada");
    expect(serialized).not.toContain("1234");
  });

  test("what the run redacted stays hidden, rather than reading [REDACTED]", () => {
    const value: StepSampleValue = describeValue({
      note: STEP_SAMPLE_REDACTED_VALUE,
    });

    expect(field(value, "note")).toEqual({
      path: "note",
      kind: StepSampleKind.Text,
      isHidden: true,
    });
  });

  test("a whole value can be hidden, and a redacted one is", () => {
    expect(
      describeSampleValue("Bearer abc", { ranAt: RAN_AT, isHidden: true }),
    ).toEqual({
      kind: StepSampleKind.Text,
      fields: [],
      isHidden: true,
      ranAt: RAN_AT,
    });
    expect(describeValue(STEP_SAMPLE_REDACTED_VALUE).isHidden).toBe(true);
  });

  test("an ID or a date in a record reads as what it holds, not as an object", () => {
    const value: StepSampleValue = describeValue({
      _id: { _type: "ObjectID", value: "6f1c2d3e-0000-4000-8000-000000000001" },
      createdAt: { _type: "DateTime", value: "2026-10-01T11:58:00.000Z" },
      title: "Database is down",
    });

    expect(paths(value)).toEqual(["_id", "createdAt", "title"]);
    expect(field(value, "_id")?.kind).toBe(StepSampleKind.Text);
    expect(field(value, "_id")?.preview).toBe(
      '"6f1c2d3e-0000-4000-8000-000000000001"',
    );
    expect(field(value, "createdAt")?.preview).toBe(
      '"2026-10-01T11:58:00.000Z"',
    );
  });

  test("a class instance reads as its JSON, and a date as its time", () => {
    const value: StepSampleValue = describeValue({
      id: new ObjectID("6f1c2d3e-0000-4000-8000-000000000002"),
      at: new Date("2026-10-01T11:00:00.000Z"),
    });

    expect(field(value, "id")?.preview).toBe(
      '"6f1c2d3e-0000-4000-8000-000000000002"',
    );
    expect(field(value, "at")?.preview).toBe('"2026-10-01T11:00:00.000Z"');
  });

  test(`goes ${STEP_SAMPLE_MAX_DEPTH} keys deep, and says when there was more`, () => {
    let deep: JSONObject = { leaf: "bottom" };

    for (let level: number = 9; level >= 1; level--) {
      deep = { [`level${level}`]: deep };
    }

    const value: StepSampleValue = describeValue(deep);
    const deepest: number = Math.max(
      ...paths(value).map((path: string) => {
        return path.split(".").length;
      }),
    );

    expect(deepest).toBe(STEP_SAMPLE_MAX_DEPTH);
    expect(value.isPartial).toBe(true);
  });

  test(`lists at most ${STEP_SAMPLE_MAX_FIELDS} fields, nearest first, and says some are left out`, () => {
    const wide: JSONObject = {};

    for (let index: number = 0; index < 400; index++) {
      wide[`key${String(index).padStart(3, "0")}`] = { inner: index };
    }

    const value: StepSampleValue = describeValue(wide);

    expect(value.fields).toHaveLength(STEP_SAMPLE_MAX_FIELDS);
    expect(value.isPartial).toBe(true);
    // The top-level keys come first; their insides only as room allows.
    expect(
      value.fields.every((candidate: StepSampleField) => {
        return !candidate.path.includes(".");
      }),
    ).toBe(true);
  });

  test("a value that fits whole is not called partial", () => {
    expect(describeValue(ALERT_BODY).isPartial).toBeUndefined();
  });

  test("a cut-down copy is called partial", () => {
    expect(
      describeSampleValue({ a: 1 }, { ranAt: RAN_AT, isCutDownCopy: true })
        .isPartial,
    ).toBe(true);
  });

  test("an object the trace kept only as cut-off text is known to be one, with nothing listed", () => {
    const cutObject: string = `{"action":"opened","issue":{"title":"x"${TRUNCATED_VALUE_SUFFIX}`;
    const cutList: string = `[{"a":1},{"a":2${TRUNCATED_VALUE_SUFFIX}`;

    expect(describeValue(cutObject)).toEqual({
      kind: StepSampleKind.Object,
      fields: [],
      isCutShort: true,
      ranAt: RAN_AT,
    });
    expect(describeValue(cutList).kind).toBe(StepSampleKind.List);
    expect(describeValue(cutList).isCutShort).toBe(true);
  });

  test("text, a number and a switch are values with nothing inside", () => {
    expect(describeValue("plain body")).toEqual({
      kind: StepSampleKind.Text,
      preview: '"plain body"',
      fields: [],
      ranAt: RAN_AT,
    });
    expect(describeValue(200).preview).toBe("200");
    expect(describeValue(true).kind).toBe(StepSampleKind.Boolean);
  });
});

type EntryFunction = (
  overrides: Partial<WorkflowStepTraceEntry>,
) => WorkflowStepTraceEntry;

const entry: EntryFunction = (
  overrides: Partial<WorkflowStepTraceEntry>,
): WorkflowStepTraceEntry => {
  return {
    componentId: "webhook-1",
    metadataId: "webhook",
    title: "Webhook",
    status: WorkflowStepStatus.Success,
    startedAt: "2026-10-01T12:00:00.000Z",
    completedAt: "2026-10-01T12:00:00.100Z",
    durationInMs: 100,
    argumentValues: {},
    returnValues: {},
    executedPort: "out",
    ...overrides,
  };
};

type RunFunction = (
  createdAt: string,
  steps: Array<WorkflowStepTraceEntry>,
) => StepSampleRun;

const run: RunFunction = (
  createdAt: string,
  steps: Array<WorkflowStepTraceEntry>,
): StepSampleRun => {
  return {
    createdAt: createdAt,
    stepTrace: { steps: steps } as unknown as JSONValue,
  };
};

type SampleOfFunction = (
  samples: Array<StepSample>,
  componentId: string,
) => StepSample | undefined;

const sampleOf: SampleOfFunction = (
  samples: Array<StepSample>,
  componentId: string,
): StepSample | undefined => {
  return samples.find((sample: StepSample) => {
    return sample.componentId === componentId;
  });
};

describe("collectStepSamples", () => {
  test("takes each step's values from the newest run", () => {
    const samples: Array<StepSample> = collectStepSamples([
      run("2026-10-01T10:00:00.000Z", [
        entry({
          completedAt: "2026-10-01T10:00:00.100Z",
          returnValues: { "request-body": { environment: "staging" } },
        }),
      ]),
      run("2026-10-01T12:00:00.000Z", [
        entry({
          completedAt: "2026-10-01T12:00:00.100Z",
          returnValues: { "request-body": { environment: "production" } },
        }),
      ]),
    ]);

    const body: StepSampleValue | undefined = sampleOf(samples, "webhook-1")
      ?.returnValues["request-body"];

    expect(field(body as StepSampleValue, "environment")?.preview).toBe(
      '"production"',
    );
    expect(body?.ranAt).toBe("2026-10-01T12:00:00.100Z");
  });

  test("a value with fields beats newer text: a run started by hand does not hide a real request", () => {
    const samples: Array<StepSample> = collectStepSamples([
      run("2026-10-01T12:00:00.000Z", [
        entry({ returnValues: { "request-body": '{"typed": "by hand"}' } }),
      ]),
      run("2026-10-01T10:00:00.000Z", [
        entry({
          completedAt: "2026-10-01T10:00:00.100Z",
          returnValues: { "request-body": { incident: { title: "Real" } } },
        }),
      ]),
    ]);

    const body: StepSampleValue = sampleOf(samples, "webhook-1")!.returnValues[
      "request-body"
    ]!;

    expect(body.kind).toBe(StepSampleKind.Object);
    expect(field(body, "incident.title")?.preview).toBe('"Real"');
  });

  test("a step that worked beats a newer one that failed", () => {
    const samples: Array<StepSample> = collectStepSamples([
      run("2026-10-01T12:00:00.000Z", [
        entry({
          componentId: "api-get-1",
          status: WorkflowStepStatus.Error,
          executedPort: "error",
          returnValues: { "response-body": { message: "Not found" } },
        }),
      ]),
      run("2026-10-01T10:00:00.000Z", [
        entry({
          componentId: "api-get-1",
          returnValues: { "response-body": { user: { name: "Ada" } } },
        }),
      ]),
    ]);

    const body: StepSampleValue = sampleOf(samples, "api-get-1")!.returnValues[
      "response-body"
    ]!;

    expect(paths(body)).toEqual(["user", "user.name"]);
  });

  test("a failed step's values are still better than none", () => {
    const samples: Array<StepSample> = collectStepSamples([
      run("2026-10-01T12:00:00.000Z", [
        entry({
          componentId: "api-get-1",
          status: WorkflowStepStatus.Error,
          returnValues: { "response-body": { message: "Not found" } },
        }),
      ]),
    ]);

    expect(
      paths(sampleOf(samples, "api-get-1")!.returnValues["response-body"]!),
    ).toEqual(["message"]);
  });

  test("reads runs newest first whatever order they come in", () => {
    const older: StepSampleRun = run("2026-09-30T00:00:00.000Z", [
      entry({ returnValues: { "request-body": { v: "old" } } }),
    ]);
    const newer: StepSampleRun = run("2026-10-01T00:00:00.000Z", [
      entry({ returnValues: { "request-body": { v: "new" } } }),
    ]);

    for (const order of [
      [older, newer],
      [newer, older],
    ]) {
      const body: StepSampleValue = sampleOf(
        collectStepSamples(order),
        "webhook-1",
      )!.returnValues["request-body"]!;

      expect(field(body, "v")?.preview).toBe('"new"');
    }
  });

  test("only the steps asked about", () => {
    const samples: Array<StepSample> = collectStepSamples(
      [
        run("2026-10-01T12:00:00.000Z", [
          entry({ returnValues: { "request-body": { a: 1 } } }),
          entry({
            componentId: "api-get-1",
            returnValues: { "response-status": 200 },
          }),
        ]),
      ],
      { componentIds: ["api-get-1"] },
    );

    expect(
      samples.map((sample: StepSample) => {
        return sample.componentId;
      }),
    ).toEqual(["api-get-1"]);
  });

  test("a value too big to keep whole is read from the cut-down copy beside it", () => {
    const samples: Array<StepSample> = collectStepSamples([
      run("2026-10-01T12:00:00.000Z", [
        entry({
          returnValues: {
            "request-body": `{"action":"opened"${TRUNCATED_VALUE_SUFFIX}`,
            "request-headers": { host: "example.com" },
          },
          returnValueSamples: {
            "request-body": { action: "opened", issue: { title: "Bug" } },
          },
        }),
      ]),
    ]);

    const values: { [id: string]: StepSampleValue } = sampleOf(
      samples,
      "webhook-1",
    )!.returnValues;

    expect(paths(values["request-body"]!)).toEqual([
      "action",
      "issue",
      "issue.title",
    ]);
    expect(values["request-body"]!.isPartial).toBe(true);
    expect(values["request-headers"]!.isPartial).toBeUndefined();
  });

  test("a run from before cut-down copies were kept says its value was cut short", () => {
    const samples: Array<StepSample> = collectStepSamples([
      run("2026-10-01T12:00:00.000Z", [
        entry({
          returnValues: {
            "request-body": `{"action":"opened"${TRUNCATED_VALUE_SUFFIX}`,
          },
        }),
      ]),
    ]);

    expect(
      sampleOf(samples, "webhook-1")!.returnValues["request-body"]!.isCutShort,
    ).toBe(true);
  });

  test("a return value named like a secret is hidden whole", () => {
    const samples: Array<StepSample> = collectStepSamples([
      run("2026-10-01T12:00:00.000Z", [
        entry({
          componentId: "oauth-1",
          returnValues: { "access-token": "ya29.secret" },
        }),
      ]),
    ]);

    const token: StepSampleValue = sampleOf(samples, "oauth-1")!.returnValues[
      "access-token"
    ]!;

    expect(token.isHidden).toBe(true);
    expect(JSON.stringify(samples)).not.toContain("ya29");
  });

  test("falls back to the run's time when the step's is unreadable", () => {
    const samples: Array<StepSample> = collectStepSamples([
      run("2026-10-01T09:00:00.000Z", [
        entry({
          completedAt: "not a date",
          startedAt: "",
          returnValues: { "request-body": { a: 1 } },
        }),
      ]),
    ]);

    expect(
      sampleOf(samples, "webhook-1")!.returnValues["request-body"]!.ranAt,
    ).toBe("2026-10-01T09:00:00.000Z");
  });

  test("ignores anything that is not a trace or a step", () => {
    const samples: Array<StepSample> = collectStepSamples([
      { createdAt: "2026-10-01T12:00:00.000Z", stepTrace: null },
      { createdAt: "2026-10-01T12:00:00.000Z", stepTrace: "nonsense" },
      { stepTrace: { steps: "not a list" } },
      {
        stepTrace: {
          steps: [
            null,
            "text",
            { componentId: "", returnValues: { a: 1 } },
            { componentId: "x-1", returnValues: "not an object" },
            { componentId: "y-1" },
          ],
        },
      },
      null as unknown as StepSampleRun,
    ]);

    expect(samples).toEqual([]);
  });

  test("the result reads back the same after a trip through JSON", () => {
    const samples: Array<StepSample> = collectStepSamples([
      run("2026-10-01T12:00:00.000Z", [
        entry({
          returnValues: {
            "request-body": ALERT_BODY,
            "request-headers": { authorization: "Bearer x", host: "h" },
          },
        }),
      ]),
    ]);

    expect(
      parseStepSamplesResponse(JSON.parse(JSON.stringify({ samples }))),
    ).toEqual(samples);
  });
});

describe("sampledComponentIds", () => {
  test("the steps that worked and returned something", () => {
    const ids: Set<string> = sampledComponentIds([
      run("2026-10-01T12:00:00.000Z", [
        entry({ returnValues: { "request-body": {} } }),
        entry({
          componentId: "api-get-1",
          status: WorkflowStepStatus.Error,
          returnValues: { "response-body": {} },
        }),
        entry({ componentId: "log-1", returnValues: {} }),
      ]),
    ]);

    expect(Array.from(ids)).toEqual(["webhook-1"]);
  });
});

describe("parseStepSamplesResponse", () => {
  test("anything that is not a response is no samples", () => {
    expect(parseStepSamplesResponse(null)).toEqual([]);
    expect(parseStepSamplesResponse("<html>")).toEqual([]);
    expect(parseStepSamplesResponse([])).toEqual([]);
    expect(parseStepSamplesResponse({ samples: "nope" })).toEqual([]);
  });

  test("drops what it cannot read and keeps the rest", () => {
    const parsed: Array<StepSample> = parseStepSamplesResponse({
      samples: [
        null,
        { componentId: 5, returnValues: {} },
        { componentId: "no-values" },
        {
          componentId: "webhook-1",
          returnValues: {
            "request-body": {
              kind: "Object",
              preview: "1 field",
              ranAt: RAN_AT,
              fields: [
                { path: "title", kind: "Text", preview: "Hi" },
                { path: "", kind: "Text" },
                { path: "x", kind: "NotAKind" },
                { path: "secret", kind: "Text", isHidden: true, preview: "x" },
              ],
            },
            "request-headers": { kind: "Unknown", fields: [] },
            "request-params": "nope",
          },
        },
      ],
    });

    expect(parsed).toEqual([
      {
        componentId: "webhook-1",
        returnValues: {
          "request-body": {
            kind: StepSampleKind.Object,
            preview: "1 field",
            ranAt: RAN_AT,
            fields: [
              { path: "title", kind: StepSampleKind.Text, preview: "Hi" },
              { path: "secret", kind: StepSampleKind.Text, isHidden: true },
            ],
          },
        },
      },
    ]);
  });
});
