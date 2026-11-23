import ProductionReviewComposer, {
  fenceFor,
  getSensitiveDataPostingOf,
  PRODUCTION_REVIEW_CHECK_TITLES,
  ProductionReviewCheckRunText,
  ProductionReviewCommentInput,
  suggestionDiff,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewComposer";
import GitHubCommandParser from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCommandParser";
import { GitHubCheckConclusion } from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCheckRuns";
import { GitHubCommandSurface } from "../../../../../Types/CodeRepository/GitHubCommand";
import {
  ProductionReviewPosting,
  ProductionReviewPullRequestContent,
  ProductionReviewReport,
  ProductionReviewSection,
  ProductionReviewUtil,
} from "../../../../../Types/CodeRepository/ProductionReview";
import {
  ProductionReviewLeakJSON,
  ProductionReviewSensitiveDataJSON,
  SensitiveDataLeakKind,
  SensitiveDataPosting,
  SensitiveDataSink,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import {
  emptyReport,
  fullReport,
  PROJECT_ID,
} from "./ProductionReviewFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SENSITIVE DATA SECTION OF A REVIEW'S COMMENT AND CHECK (#10376):
 * first in the comment, as it is what the author can fix before anything
 * merges; each point where it is, what it does and its fix, with the
 * change as a diff; what production knows of it only on a private
 * repository's comment; nothing of it in a link-only comment; and a check
 * that fails only when the repository asked it to, on a point the rules
 * say can fail it.
 */

const REVIEW_URL: string = `https://oneuptime.com/dashboard/${PROJECT_ID}/code/tasks/7c1d2e3f-0000-4000-8000-000000000001`;

// What production knows of the points: never in a public repository's comment.
const PRODUCTION_WORDS: Array<string> = [
  "checkout-api",
  "attributes.user.email",
  "Mask checkout emails",
  "acme-card-exports",
  "Card number",
  "Production has held this before",
];

function telemetryPoint(
  change: Partial<ProductionReviewLeakJSON> = {},
): ProductionReviewLeakJSON {
  return {
    key: "3f2a9c1b0d4e5f60",
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
    suggestion: {
      startLine: 11,
      endLine: 11,
      original: ['  logger.info("signup", { email });'],
      replacement: ['  logger.info("signup");'],
      isByAi: false,
    },
    production: {
      heldBefore: [
        {
          serviceId: "8b5b7f2e-2c3d-4c6a-9e1f-5a6b7c8d9e01",
          serviceName: "checkout-api",
          storeKind: "Logs",
          location: "attributes.user.email",
          dataTypeName: "Email address",
          lastSeenAt: "2026-10-21T10:00:00.000Z",
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
    key: "9a8b7c6d5e4f3a2b",
    kind: SensitiveDataLeakKind.Infrastructure,
    checkId: "public-read",
    path: "infra/s3.tf",
    line: 3,
    subject: "acl",
    where: "aws_s3_bucket.exports",
    value: '"public-read"',
    dataTypeIds: [],
    dataTypeNames: [],
    sensitivity: DataSensitivity.Confidential,
    severity: SecuritySeverity.Critical,
    isBlocking: true,
    failsCheck: true,
    text: 'Sets `acl` to `"public-read"` on `aws_s3_bucket.exports` in Terraform, which makes the store readable by anyone on the internet.',
    fix: 'Set `acl` to `"private"`, and serve what must be public through a CDN.',
    isAiWorded: false,
    suggestion: {
      startLine: 3,
      endLine: 3,
      original: ['  acl    = "public-read"'],
      replacement: ['  acl    = "private"'],
      isByAi: false,
    },
    production: {
      store: {
        dataStoreId: "5d1c2b3a-0000-4000-8000-0000000000b1",
        name: "acme-card-exports",
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
    isFailOn: points.some((point: ProductionReviewLeakJSON): boolean => {
      return point.failsCheck;
    }),
    isAiRead: false,
    ...change,
  };
}

function input(
  report: ProductionReviewReport,
  change: Partial<ProductionReviewCommentInput> = {},
): ProductionReviewCommentInput {
  return {
    report,
    posting: ProductionReviewPosting.Review,
    reviewUrl: REVIEW_URL,
    dashboardUrl: "https://oneuptime.com/dashboard",
    projectId: PROJECT_ID,
    productName: "OneUptime",
    reviewCommand: "@oneuptime production review",
    updatesOnPush: true,
    isPublicRepository: false,
    ...change,
  };
}

function leakyReport(
  points: Array<ProductionReviewLeakJSON> = [telemetryPoint(), bucketPoint()],
  change: Partial<ProductionReviewReport> = {},
): ProductionReviewReport {
  return emptyReport({ sensitiveData: section(points), ...change });
}

describe("on a private repository", () => {
  const comment: string = ProductionReviewComposer.compose(
    input(leakyReport()),
  );

  test("the section comes first, under the heading, and says what fails the check", () => {
    const heading: number = comment.indexOf("### ");
    const at: number = comment.indexOf("**Sensitive data**");

    expect(heading).toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThan(heading);
    expect(comment).toContain("**Sensitive data** · 1 leak fails this check");
  });

  test("each point: its line, what kind of data, whether it fails, what it does, its fix and the change", () => {
    expect(comment).toContain("`services/checkout/src/signup.ts` line 11");
    expect(comment).toContain("Email address");
    expect(comment).toContain("**fails the check**");
    expect(comment).toContain("Writes an email address to a log");
    expect(comment).toContain("Fix: Leave `email` out");
    expect(comment).toContain('-   logger.info("signup", { email });');
    expect(comment).toContain('+   logger.info("signup");');
    expect(comment).toContain("```diff");
  });

  test("what production knows makes each point sharper", () => {
    expect(comment).toContain(
      "Production has held this before: **checkout-api**'s logs held an email address at `attributes.user.email`",
    );
    expect(comment).toContain(
      "Masked at ingest by the scrub rule **Mask checkout emails**, but written by the code",
    );
    expect(comment).toContain(
      "It is the store **acme-card-exports**, which holds Restricted data: Card number.",
    );
  });

  test("the escape hatch is said where a point fails the check", () => {
    expect(comment).toContain("`oneuptime:not-sensitive`");
  });

  test("nothing in it is a command", () => {
    expect(
      GitHubCommandParser.parse({
        body: comment,
        appSlug: "oneuptime",
        surface: GitHubCommandSurface.PullRequest,
      }),
    ).toBeNull();
  });
});

describe("on a public repository: only what the diff shows", () => {
  test.each([
    [
      "the comment",
      (data: ProductionReviewCommentInput): string => {
        return ProductionReviewComposer.compose(data);
      },
    ],
    [
      "the check",
      (data: ProductionReviewCommentInput): string => {
        return ProductionReviewComposer.composeCheckRun(data).summary;
      },
    ],
    [
      "the suggestions",
      (data: ProductionReviewCommentInput): string => {
        return ProductionReviewComposer.getSuggestedPoints(data.report)
          .map((point: ProductionReviewLeakJSON): string => {
            return ProductionReviewComposer.composeSuggestion(point);
          })
          .join("\n");
      },
    ],
  ])(
    "%s names no store, no place of production and nothing production holds",
    (
      _what: string,
      compose: (data: ProductionReviewCommentInput) => string,
    ) => {
      const text: string = compose(
        input(leakyReport(), {
          isPublicRepository: true,
          sensitiveDataPosting: ProductionReviewUtil.getSensitiveDataPosting({
            content: undefined,
            isPublic: true,
          }),
        }),
      );

      for (const word of PRODUCTION_WORDS) {
        expect({ word, isSaid: text.includes(word) }).toEqual({
          word,
          isSaid: false,
        });
      }
    },
  );

  test("the points themselves are there: what the diff shows is the author's to fix", () => {
    const comment: string = ProductionReviewComposer.compose(
      input(leakyReport(), {
        isPublicRepository: true,
        sensitiveDataPosting: SensitiveDataPosting.DiffOnly,
      }),
    );

    expect(comment).toContain("**Sensitive data**");
    expect(comment).toContain("Writes an email address to a log");
    expect(comment).toContain("readable by anyone on the internet");
  });

  test("a public repository's review is the diff's alone, even when the review is posted whole", () => {
    expect(
      ProductionReviewUtil.getSensitiveDataPosting({
        content: undefined,
        isPublic: true,
      }),
    ).toBe(SensitiveDataPosting.DiffOnly);
    expect(
      ProductionReviewUtil.getSensitiveDataPosting({
        content: undefined,
        isPublic: null,
      }),
    ).toBe(SensitiveDataPosting.DiffOnly);
    expect(
      ProductionReviewUtil.getSensitiveDataPosting({
        content: undefined,
        isPublic: false,
      }),
    ).toBe(SensitiveDataPosting.Full);
    // The review even on a public repository: still never what production holds.
    expect(
      ProductionReviewUtil.getSensitiveDataPosting({
        content: ProductionReviewPullRequestContent.ReviewEvenIfPublic,
        isPublic: true,
      }),
    ).toBe(SensitiveDataPosting.DiffOnly);
    // Only a link: none of it, whatever the repository.
    expect(
      ProductionReviewUtil.getSensitiveDataPosting({
        content: ProductionReviewPullRequestContent.Link,
        isPublic: false,
      }),
    ).toBe(SensitiveDataPosting.None);
  });
});

describe("a link-only comment", () => {
  test("shows none of the section", () => {
    const comment: string = ProductionReviewComposer.compose(
      input(leakyReport(), {
        posting: ProductionReviewPosting.Link,
        isPublicRepository: true,
      }),
    );

    expect(comment).not.toContain("**Sensitive data**");
    expect(comment).not.toContain("logger.info");
    // Sensitive data is something worth a look, which the link says.
    expect(comment).toContain("found something worth a look");
  });

  test("the posting reads as none from a link, unless said otherwise", () => {
    expect(
      getSensitiveDataPostingOf({
        posting: ProductionReviewPosting.Link,
        isPublicRepository: false,
      }),
    ).toBe(SensitiveDataPosting.None);
    expect(
      getSensitiveDataPostingOf({
        posting: ProductionReviewPosting.Review,
        isPublicRepository: false,
      }),
    ).toBe(SensitiveDataPosting.Full);
    expect(
      getSensitiveDataPostingOf({
        posting: ProductionReviewPosting.Review,
        isPublicRepository: true,
      }),
    ).toBe(SensitiveDataPosting.DiffOnly);
  });
});

describe("what the check concludes", () => {
  test("failure, only on a point that fails it", () => {
    const outcome: Omit<ProductionReviewCheckRunText, "summary"> =
      ProductionReviewComposer.checkOutcome(leakyReport());

    expect(outcome).toEqual({
      conclusion: GitHubCheckConclusion.Failure,
      title: PRODUCTION_REVIEW_CHECK_TITLES.sensitiveDataFails,
    });
  });

  test("with the switch off, the same points leave it neutral", () => {
    const report: ProductionReviewReport = leakyReport([
      telemetryPoint(),
      bucketPoint({ failsCheck: false }),
    ]);

    expect(ProductionReviewComposer.checkOutcome(report)).toEqual({
      conclusion: GitHubCheckConclusion.Neutral,
      title: PRODUCTION_REVIEW_CHECK_TITLES.sensitiveData,
    });
  });

  test("sensitive data beside something in production: neutral, and its title says both", () => {
    const report: ProductionReviewReport = fullReport({
      sensitiveData: section([telemetryPoint()]),
    });

    expect(ProductionReviewComposer.checkOutcome(report)).toEqual({
      conclusion: GitHubCheckConclusion.Neutral,
      title: PRODUCTION_REVIEW_CHECK_TITLES.sensitiveDataAndProduction,
    });
  });

  test("nothing at all: success - but neutral while the section could not be read", () => {
    expect(
      ProductionReviewComposer.checkOutcome(emptyReport()).conclusion,
    ).toBe(GitHubCheckConclusion.Success);
    expect(
      ProductionReviewComposer.checkOutcome(
        emptyReport({
          unreadSections: [ProductionReviewSection.SensitiveData],
        }),
      ).conclusion,
    ).toBe(GitHubCheckConclusion.Neutral);
  });

  test("the run's summary sentence counts the points, and those that fail", () => {
    expect(ProductionReviewComposer.summarize(leakyReport())).toBe(
      "Sensitive data: 2 points, 1 of which fails the check.",
    );
    expect(
      ProductionReviewComposer.summarize(leakyReport([telemetryPoint()])),
    ).toBe("Sensitive data: 1 point to look at.");
  });
});

describe("a review with sensitive data and nothing from production", () => {
  test("is posted: the section, then production's nothing", () => {
    const report: ProductionReviewReport = leakyReport([telemetryPoint()]);

    expect(ProductionReviewUtil.hasSignal(report)).toBe(true);
    expect(ProductionReviewUtil.hasProductionSignal(report)).toBe(false);

    const comment: string = ProductionReviewComposer.compose(input(report));

    expect(comment).toContain("**Sensitive data**");
    expect(comment).not.toContain("What to watch");
  });
});

describe("the section's notes", () => {
  test("more than the comment lists, and those OneUptime AI read as no leak", () => {
    const points: Array<ProductionReviewLeakJSON> = [];

    for (let index: number = 0; index < 7; index++) {
      points.push(
        telemetryPoint({
          key: `k${index}`,
          line: 10 + index,
          production: undefined,
        }),
      );
    }

    const comment: string = ProductionReviewComposer.compose(
      input(
        emptyReport({
          sensitiveData: section(points, { moreCount: 3, droppedCount: 2 }),
        }),
      ),
    );

    expect(comment).toContain("And 5 more in OneUptime");
    expect(comment).toContain(
      "OneUptime AI read 2 more points the rules found as no leak, and left them out.",
    );
  });
});

describe("a suggested change", () => {
  test("as a GitHub suggestion: the line as it would be, under what it is and its fix", () => {
    const suggestion: string =
      ProductionReviewComposer.composeSuggestion(telemetryPoint());

    expect(suggestion).toContain("**Sensitive data** · Email address");
    expect(suggestion).toContain("Writes an email address to a log");
    expect(suggestion).toContain("Fix: Leave `email` out");
    expect(suggestion).toContain(
      '```suggestion\n  logger.info("signup");\n```',
    );
  });

  test("only a one-line change of a listed point goes on its line", () => {
    const report: ProductionReviewReport = leakyReport([
      telemetryPoint(),
      bucketPoint({
        suggestion: {
          startLine: 3,
          endLine: 4,
          original: ["a", "b"],
          replacement: ["c"],
          isByAi: true,
        },
      }),
      telemetryPoint({ key: "nosuggestion", suggestion: undefined }),
    ]);

    expect(
      ProductionReviewComposer.getSuggestedPoints(report).map(
        (point: ProductionReviewLeakJSON): string => {
          return point.key;
        },
      ),
    ).toEqual(["3f2a9c1b0d4e5f60"]);
  });

  test("code that holds backticks gets a fence it cannot close", () => {
    expect(fenceFor(["const a = `x`;"])).toBe("```");
    expect(fenceFor(["```", "x"])).toBe("````");
    expect(
      suggestionDiff(
        {
          startLine: 1,
          endLine: 1,
          original: ["```"],
          replacement: ["x"],
          isByAi: false,
        },
        "  ",
      ),
    ).toBe("  ````diff\n  - ```\n  + x\n  ````");
  });

  test("the suggestions' review says how many, in a line", () => {
    expect(
      ProductionReviewComposer.composeSuggestionsBody(input(leakyReport()), 2),
    ).toBe(
      "**Sensitive data** · OneUptime's production review suggests 2 changes on the lines below, each one you can commit.",
    );
  });
});

describe("words from a pull request are text", () => {
  test("a point's sentence cannot mention anyone or link anywhere", () => {
    const comment: string = ProductionReviewComposer.compose(
      input(
        leakyReport([
          telemetryPoint({
            text: "Writes `email` for @octocat, see https://evil.example/x",
            fix: "Ask @admin at www.evil.example",
            production: undefined,
          }),
        ]),
      ),
    );

    expect(comment).not.toMatch(/(^|[^`])@octocat/);
    expect(comment).not.toContain("https://evil.example");
    expect(comment).not.toContain("www.evil.example");
  });
});
