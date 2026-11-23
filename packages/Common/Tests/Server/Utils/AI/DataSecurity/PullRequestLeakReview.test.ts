import DataSecurityAiCall from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import DataSecurityAiInput, {
  DataSecurityAiPrompt,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import PullRequestLeakReview, {
  PULL_REQUEST_LEAK_REVIEW_INSTRUCTIONS,
  PullRequestLeakFile,
  PullRequestLeakReading,
  PullRequestLeakReviewResult,
} from "../../../../../Server/Utils/AI/DataSecurity/PullRequestLeakReview";
import {
  ProductionReviewLeakJSON,
  ProductionReviewSensitiveDataJSON,
  SensitiveDataAiNoteCode,
  SensitiveDataLeakKind,
  SensitiveDataSink,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import ObjectID from "../../../../../Types/ObjectID";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ONEUPTIME AI'S READ OF A PULL REQUEST'S SENSITIVE DATA (#10376): handed
 * the points OneUptime's rules found and the diff of their files, by the
 * Data Security input builder - never what production knows of a point -
 * and held to them: it keeps, words and orders the points, may leave out
 * one the check does not fail on, and adds none.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10376000-0000-4000-8000-000000000001",
);
const RUN_ID: ObjectID = new ObjectID("10376000-0000-4000-8000-000000000002");

const SIGNUP_PATCH: string = [
  "@@ -10,2 +10,3 @@",
  " export async function signup(customer: Customer): Promise<void> {",
  '+  logger.info("signup", { email: customer.email });',
  "   await customers.create(customer);",
].join("\n");

const BUCKET_PATCH: string = [
  "@@ -0,0 +1,4 @@",
  '+resource "aws_s3_bucket" "exports" {',
  '+  bucket = "acme-exports"',
  '+  acl    = "public-read"',
  "+}",
].join("\n");

const FILES: Array<PullRequestLeakFile> = [
  { path: "services/checkout/src/signup.ts", patch: SIGNUP_PATCH },
  { path: "infra/s3.tf", patch: BUCKET_PATCH },
  { path: "README.md", patch: "@@ -1 +1 @@\n+Unrelated words" },
];

// What production knows of the points: never in what the model is sent.
const PRODUCTION_ONLY: Array<string> = [
  "checkout-api",
  "attributes.user.email",
  "Mask checkout emails",
  "acme-card-exports-prod",
  "Card number",
  "Restricted",
];

function emailPoint(
  change: Partial<ProductionReviewLeakJSON> = {},
): ProductionReviewLeakJSON {
  return {
    key: "email-key",
    kind: SensitiveDataLeakKind.Telemetry,
    checkId: "sensitive-data-in-telemetry",
    sink: SensitiveDataSink.Log,
    path: "services/checkout/src/signup.ts",
    line: 11,
    subject: "email",
    where: "logger.info",
    dataTypeIds: ["email-address"],
    dataTypeNames: ["Email address"],
    sensitivity: DataSensitivity.Confidential,
    severity: SecuritySeverity.High,
    isBlocking: false,
    failsCheck: false,
    text: "Writes an email address to a log: `email`, in `logger.info`.",
    fix: "Leave `email` out, or write a hash of it when you need to tell values apart.",
    isAiWorded: false,
    production: {
      heldBefore: [
        {
          serviceId: "s1",
          serviceName: "checkout-api",
          storeKind: "Logs",
          location: "attributes.user.email",
          dataTypeName: "Email address",
          lastSeenAt: "2026-11-20T10:00:00.000Z",
        },
      ],
      maskedAtIngestBy: "Mask checkout emails",
    },
    ...change,
  };
}

function bucketPoint(
  change: Partial<ProductionReviewLeakJSON> = {},
): ProductionReviewLeakJSON {
  return {
    key: "bucket-key",
    kind: SensitiveDataLeakKind.Infrastructure,
    checkId: "public-read",
    path: "infra/s3.tf",
    line: 3,
    subject: "acl",
    where: "aws_s3_bucket.exports",
    value: '"public-read"',
    dataTypeIds: [],
    dataTypeNames: [],
    // The diff's own: a known store's sensitivity is production's.
    sensitivity: DataSensitivity.Confidential,
    severity: SecuritySeverity.Critical,
    isBlocking: true,
    failsCheck: true,
    text: 'Sets `acl` to `"public-read"` on `aws_s3_bucket.exports` in Terraform, which makes the store readable by anyone on the internet.',
    fix: 'Set `acl` to `"private"`.',
    isAiWorded: false,
    production: {
      store: {
        dataStoreId: "store-1",
        name: "acme-card-exports-prod",
        sensitivity: DataSensitivity.Restricted,
        dataTypeNames: ["Card number"],
      },
    },
    ...change,
  };
}

function section(
  points: Array<ProductionReviewLeakJSON>,
  change: Partial<ProductionReviewSensitiveDataJSON> = {},
): ProductionReviewSensitiveDataJSON {
  return {
    points,
    moreCount: 0,
    droppedCount: 0,
    isFailOn: true,
    isAiRead: false,
    ...change,
  };
}

function promptOf(
  points: Array<ProductionReviewLeakJSON>,
  isFailOn: boolean = true,
): DataSecurityAiPrompt {
  return PullRequestLeakReview.buildPrompt({
    pullRequestTitle: "Export cards for finance",
    points,
    files: FILES,
    isFailOn,
  });
}

function textOf(prompt: DataSecurityAiPrompt): string {
  return prompt.messages
    .map((message: { content: string }): string => {
      return message.content;
    })
    .join("\n");
}

function candidatesOf(
  prompt: DataSecurityAiPrompt,
): Array<Record<string, unknown>> {
  const data: Record<string, unknown> = JSON.parse(
    prompt.messages[prompt.messages.length - 1]!.content,
  ) as Record<string, unknown>;

  return data["candidates"] as Array<Record<string, unknown>>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what OneUptime AI is sent", () => {
  test("a prompt the Data Security builder made: its instructions, the points and their files' diff", () => {
    const prompt: DataSecurityAiPrompt = promptOf([
      emailPoint(),
      bucketPoint(),
    ]);
    const text: string = textOf(prompt);

    expect(DataSecurityAiInput.isDataSecurityAiPrompt(prompt)).toBe(true);
    expect(text).toContain(PULL_REQUEST_LEAK_REVIEW_INSTRUCTIONS.slice(0, 80));
    expect(text).toContain("Export cards for finance");
    expect(text).toContain("logger.info");
    expect(text).toContain("public-read");
    // A file no point is in is not sent.
    expect(text).not.toContain("Unrelated words");
  });

  test("never what production knows: where telemetry held it, the scrub rule, the store and what it holds", () => {
    const text: string = textOf(promptOf([emailPoint(), bucketPoint()]));

    for (const known of PRODUCTION_ONLY) {
      expect({ known, isSent: text.includes(known) }).toEqual({
        known,
        isSent: false,
      });
    }
  });

  test("each point by its id, as the diff shows it - and whether it may be left out, as the diff says", () => {
    const candidates: Array<Record<string, unknown>> = candidatesOf(
      promptOf([emailPoint(), bucketPoint()]),
    );

    expect(
      candidates.map((candidate: Record<string, unknown>) => {
        return {
          id: candidate["id"],
          // The name the rule read: the point's subject.
          subject: candidate["name"],
          sensitivity: candidate["sensitivity"],
          mayDrop: candidate["mayDrop"],
        };
      }),
    ).toEqual([
      {
        id: "L1",
        subject: "email",
        sensitivity: DataSensitivity.Confidential,
        mayDrop: true,
      },
      {
        id: "L2",
        subject: "acl",
        sensitivity: DataSensitivity.Confidential,
        mayDrop: false,
      },
    ]);
    // Its line as the change writes it, with the lines just around it.
    expect(candidates[0]!["lines"]).toBe(
      [
        "export async function signup(customer: Customer): Promise<void> {",
        '  logger.info("signup", { email: customer.email });',
        "  await customers.create(customer);",
      ].join("\n"),
    );
  });

  test("a public bucket a known store keeps from failing is told as the diff says it: never to be left out", () => {
    // The store holds nothing sensitive, so the check does not fail on it...
    const quiet: ProductionReviewLeakJSON = bucketPoint({
      isBlocking: false,
      failsCheck: false,
    });

    // ...which OneUptime AI is never told: it reads the diff's view.
    expect(candidatesOf(promptOf([quiet]))[0]!["mayDrop"]).toBe(false);
    expect(PullRequestLeakReview.failsCheckByTheDiff(quiet, true)).toBe(true);
    expect(PullRequestLeakReview.failsCheckByTheDiff(quiet, false)).toBe(false);
    expect(
      PullRequestLeakReview.failsCheckByTheDiff(
        emailPoint({ failsCheck: true }),
        true,
      ),
    ).toBe(true);
  });

  test("at most a dozen points are read", () => {
    const points: Array<ProductionReviewLeakJSON> = [];

    for (let index: number = 0; index < 20; index++) {
      points.push(emailPoint({ key: `k${index}` }));
    }

    expect(PullRequestLeakReview.getReadPoints(section(points))).toHaveLength(
      12,
    );
  });
});

describe("its answer, held to the points", () => {
  const points: Array<ProductionReviewLeakJSON> = [emailPoint(), bucketPoint()];

  function answer(candidates: Array<Record<string, unknown>>): string {
    return JSON.stringify({ candidates });
  }

  test("read by each point's id; one it was not given, or twice, is dropped", () => {
    const readings: Array<PullRequestLeakReading> | null =
      PullRequestLeakReview.readAnswer(
        answer([
          {
            id: "L2",
            keep: true,
            text: "The bucket is public to the internet.",
            fix: "Make it private again.",
          },
          { id: "L9", keep: true, text: "A leak it made up.", fix: "Nothing." },
          { id: "L2", keep: false },
          { id: "X1", keep: true },
          { id: "l1", keep: false },
        ]),
        points,
      );

    expect(readings).toEqual([
      {
        key: "bucket-key",
        keep: true,
        text: "The bucket is public to the internet.",
        fix: "Make it private again.",
        replacement: null,
      },
      {
        key: "email-key",
        keep: false,
        text: null,
        fix: null,
        replacement: null,
      },
    ]);
  });

  test("a point the check fails on is kept, whatever the answer says", () => {
    const readings: Array<PullRequestLeakReading> | null =
      PullRequestLeakReview.readAnswer(
        answer([{ id: "L2", keep: false }]),
        points,
      );

    expect(readings![0]!.keep).toBe(true);
  });

  test("a suggested line that could close a fence, or break the line, is not taken", () => {
    const readings: Array<PullRequestLeakReading> | null =
      PullRequestLeakReview.readAnswer(
        answer([
          { id: "L1", keep: true, replacement: ["```", "x"] },
          { id: "L2", keep: true, replacement: ['  acl    = "private"'] },
        ]),
        points,
      );

    expect(readings![0]!.replacement).toBeNull();
    expect(readings![1]!.replacement).toEqual(['  acl    = "private"']);
  });

  test("an answer that is not the JSON asked for is none", () => {
    expect(
      PullRequestLeakReview.readAnswer("Sure! Here is", points),
    ).toBeNull();
    expect(PullRequestLeakReview.readAnswer("", points)).toBeNull();
  });
});

describe("the section as OneUptime AI read it", () => {
  test("what fails the check first, then the kept ones in its order, those it said nothing of after; how many it left out", () => {
    const telemetry: ProductionReviewLeakJSON = emailPoint();
    const other: ProductionReviewLeakJSON = emailPoint({
      key: "other-key",
      line: 12,
      subject: "phone",
    });
    const unread: ProductionReviewLeakJSON = emailPoint({
      key: "unread-key",
      subject: "name",
    });
    const read: ProductionReviewSensitiveDataJSON = PullRequestLeakReview.apply(
      section([telemetry, bucketPoint(), other, unread], { droppedCount: 1 }),
      [
        {
          key: "other-key",
          keep: false,
          text: null,
          fix: null,
          replacement: null,
        },
        {
          key: "email-key",
          keep: true,
          text: "Logs each customer's email on signup.",
          fix: "Log the customer's id instead.",
          replacement: [
            '  logger.info("signup", { customerId: customer.id });',
          ],
        },
        {
          key: "bucket-key",
          keep: true,
          text: null,
          fix: null,
          replacement: null,
        },
      ],
      FILES,
    );

    expect(
      read.points.map((point: ProductionReviewLeakJSON): string => {
        return point.key;
      }),
    ).toEqual(["bucket-key", "email-key", "unread-key"]);
    expect(read.droppedCount).toBe(2);
    expect(read.isAiRead).toBe(true);

    const worded: ProductionReviewLeakJSON = read.points[1]!;

    expect(worded).toMatchObject({
      text: "Logs each customer's email on signup.",
      fix: "Log the customer's id instead.",
      isAiWorded: true,
      suggestion: {
        startLine: 11,
        endLine: 11,
        original: ['  logger.info("signup", { email: customer.email });'],
        replacement: ['  logger.info("signup", { customerId: customer.id });'],
        isByAi: true,
      },
    });
    // What production knows stays with the point, for the comment and the page.
    expect(worded.production).toEqual(telemetry.production);
    // One it did not word keeps the rules' words.
    expect(read.points[0]!.isAiWorded).toBe(false);
  });
});

describe("one read", () => {
  test("asks through the Data Security call, as the review's own feature, and reads the answer", async () => {
    const ask: jest.SpyInstance = jest
      .spyOn(DataSecurityAiCall, "ask")
      .mockResolvedValue({
        content: JSON.stringify({
          candidates: [
            { id: "L1", keep: false },
            { id: "L2", keep: true },
          ],
        }),
      } as never);

    const result: PullRequestLeakReviewResult =
      await PullRequestLeakReview.read({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        pullRequestTitle: "Export cards for finance",
        section: section([emailPoint(), bucketPoint()]),
        files: FILES,
      });

    expect(ask).toHaveBeenCalledTimes(1);

    const request: Parameters<typeof DataSecurityAiCall.ask>[0] = ask.mock
      .calls[0]![0] as Parameters<typeof DataSecurityAiCall.ask>[0];

    expect(request).toMatchObject({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      temperature: 0,
      protectRequestParameters: true,
    });
    expect(DataSecurityAiInput.isDataSecurityAiPrompt(request.prompt)).toBe(
      true,
    );
    expect(result.note).toBeUndefined();
    expect(
      result.section.points.map((point: ProductionReviewLeakJSON): string => {
        return point.key;
      }),
    ).toEqual(["bucket-key"]);
    expect(result.section.droppedCount).toBe(1);
  });

  test("an answer it cannot read, or a failed call, leaves the rules' section, and says so", async () => {
    const original: ProductionReviewSensitiveDataJSON = section([emailPoint()]);

    jest
      .spyOn(DataSecurityAiCall, "ask")
      .mockResolvedValue({ content: "not json" } as never);

    expect(
      await PullRequestLeakReview.read({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        pullRequestTitle: "t",
        section: original,
        files: FILES,
      }),
    ).toEqual({ section: original, note: SensitiveDataAiNoteCode.Failed });

    jest
      .spyOn(DataSecurityAiCall, "ask")
      .mockRejectedValue(new Error("The provider is down"));

    expect(
      await PullRequestLeakReview.read({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        pullRequestTitle: "t",
        section: original,
        files: FILES,
      }),
    ).toEqual({ section: original, note: SensitiveDataAiNoteCode.Failed });
  });

  test("no points: nothing is asked", async () => {
    const ask: jest.SpyInstance = jest.spyOn(DataSecurityAiCall, "ask");
    const empty: ProductionReviewSensitiveDataJSON = section([]);

    expect(
      await PullRequestLeakReview.read({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        pullRequestTitle: "t",
        section: empty,
        files: FILES,
      }),
    ).toEqual({ section: empty });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("what a read answers, as one value", () => {
  const base: { pullRequestTitle: string; files: Array<PullRequestLeakFile> } =
    {
      pullRequestTitle: "Export cards for finance",
      files: FILES,
    };

  test("the same points and diff: the same hash - whatever production knows of them", () => {
    expect(
      PullRequestLeakReview.getInputHash({ ...base, points: [emailPoint()] }),
    ).toBe(
      PullRequestLeakReview.getInputHash({
        ...base,
        points: [emailPoint({ production: undefined })],
      }),
    );
  });

  test("another point, another diff or another title: another hash", () => {
    const hash: string = PullRequestLeakReview.getInputHash({
      ...base,
      points: [emailPoint()],
    });

    expect(
      PullRequestLeakReview.getInputHash({
        ...base,
        points: [emailPoint(), bucketPoint()],
      }),
    ).not.toBe(hash);
    expect(
      PullRequestLeakReview.getInputHash({
        ...base,
        points: [emailPoint()],
        files: [{ path: FILES[0]!.path, patch: `${SIGNUP_PATCH}\n+// more` }],
      }),
    ).not.toBe(hash);
    expect(
      PullRequestLeakReview.getInputHash({
        ...base,
        pullRequestTitle: "Another title",
        points: [emailPoint()],
      }),
    ).not.toBe(hash);
  });
});
