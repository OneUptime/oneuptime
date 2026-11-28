import ProductionReviewComposer, {
  fenceFor,
  getSensitiveDataPostingOf,
  LineSuggestionFormat,
  PRODUCTION_REVIEW_CHECK_TITLES,
  ProductionReviewCheckRunText,
  ProductionReviewCommentInput,
  suggestionDiff,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewComposer";
import { DataStoreExposure } from "../../../../../Types/DataSecurity/DataStorePosture";
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
  SensitiveDataColumn,
  SensitiveDataLeakKind,
  SensitiveDataPosting,
  SensitiveDataSink,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import { TelemetryLeakFixOwnerKind } from "../../../../../Types/DataSecurity/TelemetryLeakFix";
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

  /*
   * A web app's front end (#11395): a session identified by an email, and
   * where its RUM application's session replays already held one - said
   * on a private repository's comment alone, as every other place is.
   */
  describe("a front end's session identified by an email", () => {
    const sessionPoint: ProductionReviewLeakJSON = telemetryPoint({
      key: "5e5510aa0b1c2d3e",
      sink: SensitiveDataSink.Session,
      path: "web/src/session.js",
      line: 7,
      subject: "customer.email",
      where: "recorder.identify",
      text: "Identifies a recorded session by an email address: `customer.email`, in `recorder.identify`.",
      fix: "Identify the session by an opaque id, such as the user's id, never by `customer.email`.",
      suggestion: undefined,
      production: {
        heldBefore: [
          {
            serviceId: "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
            serviceName: "storefront-web",
            ownerKind: TelemetryLeakFixOwnerKind.RumApplication,
            storeKind: "Session Replays",
            location: "sessions.identifiedUserLabel",
            dataTypeName: "Email address",
            lastSeenAt: "2026-10-21T10:00:00.000Z",
          },
        ],
      },
    });

    test("on a private repository: what it does, its fix, and where the application's session replays held it", () => {
      const said: string = ProductionReviewComposer.compose(
        input(leakyReport([sessionPoint])),
      );

      expect(said).toContain("`web/src/session.js` line 7");
      expect(said).toContain(
        "Identifies a recorded session by an email address: `customer.email`, in `recorder.identify`.",
      );
      expect(said).toContain(
        "Fix: Identify the session by an opaque id, such as the user's id, never by `customer.email`.",
      );
      expect(said).toContain(
        "Production has held this before: **storefront-web**'s session replays held an email address at `sessions.identifiedUserLabel`",
      );
    });

    test("on a public repository: what the diff shows, never what the session replays held", () => {
      const said: string = ProductionReviewComposer.compose(
        input(leakyReport([sessionPoint]), {
          isPublicRepository: true,
          sensitiveDataPosting: SensitiveDataPosting.DiffOnly,
        }),
      );

      expect(said).toContain(
        "Identifies a recorded session by an email address",
      );
      expect(said).not.toContain("storefront-web");
      expect(said).not.toContain("sessions.identifiedUserLabel");
      expect(said).not.toContain("Production has held this before");
    });
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

/*
 * A SUGGESTED CHANGE ON ITS LINE, IN EACH HOST'S OWN WORDS (#10777): a
 * block its author can apply on GitHub, on GitLab (`suggestion:-0+0`, the
 * line the thread is on) and on Forgejo from 18 - and, on Gitea and an
 * older Forgejo, which apply none, the change as a diff to make by hand.
 */
describe("a suggested change, in each host's own syntax (#10777)", () => {
  test("GitLab's names the line the thread is on", () => {
    const suggestion: string = ProductionReviewComposer.composeSuggestion(
      telemetryPoint(),
      LineSuggestionFormat.GitLabSuggestion,
    );

    expect(suggestion).toContain("**Sensitive data** · Email address");
    expect(suggestion).toContain("Writes an email address to a log");
    expect(suggestion).toContain("Fix: Leave `email` out");
    expect(suggestion).toContain(
      '```suggestion:-0+0\n  logger.info("signup");\n```',
    );
    expect(suggestion).not.toContain("```suggestion\n");
  });

  test("GitHub's and Forgejo's: a suggestion block, the default", () => {
    expect(
      ProductionReviewComposer.composeSuggestion(
        telemetryPoint(),
        LineSuggestionFormat.Suggestion,
      ),
    ).toBe(ProductionReviewComposer.composeSuggestion(telemetryPoint()));
  });

  test("where the host applies none: the line as it is and as it would be, as a diff", () => {
    const suggestion: string = ProductionReviewComposer.composeSuggestion(
      telemetryPoint(),
      LineSuggestionFormat.Diff,
    );

    expect(suggestion).toContain(
      '```diff\n-   logger.info("signup", { email });\n+   logger.info("signup");\n```',
    );
    expect(suggestion).not.toContain("```suggestion");
    expect(suggestion).toContain("Fix: Leave `email` out");
  });

  test("a change that removes the line: an empty block, or only the line removed", () => {
    const removes: ProductionReviewLeakJSON = telemetryPoint({
      suggestion: {
        startLine: 11,
        endLine: 11,
        original: ['  logger.info("signup", { email });'],
        replacement: [],
        isByAi: true,
      },
    });

    expect(
      ProductionReviewComposer.composeSuggestion(
        removes,
        LineSuggestionFormat.GitLabSuggestion,
      ),
    ).toContain("```suggestion:-0+0\n```");
    expect(
      ProductionReviewComposer.composeSuggestion(
        removes,
        LineSuggestionFormat.Diff,
      ),
    ).toContain('```diff\n-   logger.info("signup", { email });\n```');
  });

  test("code that holds backticks gets a fence it cannot close, in GitLab's block too", () => {
    const suggestion: string = ProductionReviewComposer.composeSuggestion(
      telemetryPoint({
        suggestion: {
          startLine: 11,
          endLine: 11,
          original: ["const a = ```x``` + email;"],
          replacement: ["const a = ```x```;"],
          isByAi: false,
        },
      }),
      LineSuggestionFormat.GitLabSuggestion,
    );

    expect(suggestion).toContain(
      "````suggestion:-0+0\nconst a = ```x```;\n````",
    );
  });

  test("the review they are posted in says whether each can be committed", () => {
    expect(
      ProductionReviewComposer.composeSuggestionsBody(
        input(leakyReport()),
        1,
        LineSuggestionFormat.Suggestion,
      ),
    ).toBe(
      "**Sensitive data** · OneUptime's production review suggests 1 change on the lines below, each one you can commit.",
    );
    expect(
      ProductionReviewComposer.composeSuggestionsBody(
        input(leakyReport()),
        2,
        LineSuggestionFormat.Diff,
      ),
    ).toBe(
      "**Sensitive data** · OneUptime's production review suggests 2 changes on the lines below.",
    );
  });

  test.each([
    LineSuggestionFormat.Suggestion,
    LineSuggestionFormat.GitLabSuggestion,
    LineSuggestionFormat.Diff,
  ])(
    "%s names no store, no place of production and nothing production holds",
    (format: LineSuggestionFormat) => {
      const text: string = ProductionReviewComposer.getSuggestedPoints(
        leakyReport([telemetryPoint(), bucketPoint(), migrationPoint()]),
      )
        .map((point: ProductionReviewLeakJSON): string => {
          return ProductionReviewComposer.composeSuggestion(point, format);
        })
        .join("\n");

      for (const word of [...PRODUCTION_WORDS, ...TABLE_WORDS]) {
        expect({ word, isSaid: text.includes(word) }).toEqual({
          word,
          isSaid: false,
        });
      }
    },
  );
});

/*
 * WHAT DATA SECURITY KNOWS OF A MIGRATION'S TABLE (#10779): on a private
 * repository's comment, the store the table is in and what it holds, what
 * of the store the new column inherits, and the table's columns that
 * already hold the same data. Never on a public repository's comment, its
 * check or its suggestions, and never in a link-only comment.
 */

// What Data Security knows of the table: never on a public repository's comment.
const TABLE_WORDS: Array<string> = [
  "orders-db",
  "public.customers.ssn_last4",
  "The table",
  "Data Security found",
  "more store",
  "connections from the internet",
  "not encrypted at rest",
  "That store",
];

function migrationPoint(
  change: Partial<ProductionReviewLeakJSON> = {},
): ProductionReviewLeakJSON {
  return {
    key: "7e6d5c4b3a291807",
    kind: SensitiveDataLeakKind.Migration,
    checkId: "new-personal-data-column",
    column: SensitiveDataColumn.PersonalData,
    path: "db/migrations/20261124_add_customer_ssn.sql",
    line: 1,
    subject: "customer_ssn",
    where: "customers",
    dataTypeIds: ["us-ssn"],
    dataTypeNames: ["US Social Security number"],
    sensitivity: DataSensitivity.Restricted,
    severity: SecuritySeverity.High,
    isBlocking: false,
    failsCheck: false,
    text: "Adds the column `customer_ssn` to `customers`, whose name says it holds a US Social Security number.",
    fix: "Store it only if you must, encrypted or tokenized, and say in your record of processing what it is for.",
    isAiWorded: false,
    production: {
      store: {
        dataStoreId: "5d1c2b3a-0000-4000-8000-0000000000c1",
        name: "orders-db",
        sensitivity: DataSensitivity.Restricted,
        dataTypeNames: ["US Social Security number", "Email address"],
        exposure: DataStoreExposure.InternetReachable,
        isNotEncryptedAtRest: true,
      },
      table: {
        name: "public.customers",
        dataTypeNames: ["US Social Security number", "Email address"],
        sameData: [
          {
            location: "public.customers.ssn_last4",
            dataTypeName: "US Social Security number",
            lastSeenAt: "2026-10-20T10:00:00.000Z",
          },
        ],
        otherStoreCount: 1,
      },
    },
    ...change,
  };
}

describe("a migration's point on a private repository's comment (#10779)", () => {
  const comment: string = ProductionReviewComposer.compose(
    input(leakyReport([migrationPoint()])),
  );

  test("the store its table is in, and what that store holds", () => {
    expect(comment).toContain(
      "The table `public.customers` is in the store **orders-db**, which holds Restricted data: US Social Security number, Email address.",
    );
  });

  test("what of the store the new column inherits", () => {
    expect(comment).toContain(
      "That store accepts connections from the internet, and the new column would be in it.",
    );
    expect(comment).toContain(
      "That store is not encrypted at rest, so the new column would not be either.",
    );
  });

  test("the column that already holds the same data, and when it was found", () => {
    expect(comment).toContain(
      "Data Security found a US Social Security number in `public.customers.ssn_last4` 2 days ago: the new column copies what the table already holds.",
    );
  });

  test("how many more of the project's stores hold a table of this name", () => {
    expect(comment).toContain(
      "1 more store of the project holds a table of this name.",
    );
    expect(
      ProductionReviewComposer.compose(
        input(
          leakyReport([
            migrationPoint({
              production: {
                ...migrationPoint().production,
                table: {
                  ...migrationPoint().production!.table!,
                  otherStoreCount: 3,
                },
              },
            }),
          ]),
        ),
      ),
    ).toContain("3 more stores of the project hold a table of this name.");
  });

  test("each exposure in its own words", () => {
    for (const [exposure, words] of [
      [
        DataStoreExposure.Public,
        "Anyone on the internet can read that store, so they could read the new column too.",
      ],
      [
        DataStoreExposure.OtherAccounts,
        "Accounts outside yours can reach that store, so they could reach the new column too.",
      ],
    ] as Array<[DataStoreExposure, string]>) {
      expect(
        ProductionReviewComposer.compose(
          input(
            leakyReport([
              migrationPoint({
                production: {
                  ...migrationPoint().production,
                  store: {
                    ...migrationPoint().production!.store!,
                    exposure,
                  },
                },
              }),
            ]),
          ),
        ),
      ).toContain(words);
    }
  });

  test("a table holding other data than the new column's: what it holds, never as the same data", () => {
    const other: string = ProductionReviewComposer.compose(
      input(
        leakyReport([
          migrationPoint({
            production: {
              store: {
                dataStoreId: "5d1c2b3a-0000-4000-8000-0000000000c1",
                name: "orders-db",
                sensitivity: DataSensitivity.Confidential,
                dataTypeNames: [],
              },
              table: {
                name: "public.customers",
                dataTypeNames: ["Email address", "Phone number"],
                sameData: [],
                otherStoreCount: 0,
              },
            },
          }),
        ]),
      ),
    );

    expect(other).toContain(
      "The table `public.customers` is in the store **orders-db**, which holds Confidential data.",
    );
    expect(other).toContain(
      "Data Security found Email address, Phone number in its columns.",
    );
    expect(other).not.toContain("copies");
    expect(other).not.toContain("more store");
    expect(other).not.toContain("internet");
    expect(other).not.toContain("encrypted at rest");
  });

  test("an infrastructure point's store is still the store it is", () => {
    expect(
      ProductionReviewComposer.compose(input(leakyReport([bucketPoint()]))),
    ).toContain(
      "It is the store **acme-card-exports**, which holds Restricted data: Card number.",
    );
  });
});

describe("a migration's point on a public repository says only what the diff shows (#10779)", () => {
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
  ])(
    "%s names no store, no column of production and nothing the table holds",
    (
      _what: string,
      compose: (data: ProductionReviewCommentInput) => string,
    ) => {
      for (const isPublic of [true, null]) {
        const text: string = compose(
          input(leakyReport([migrationPoint()]), {
            isPublicRepository: isPublic,
            sensitiveDataPosting: ProductionReviewUtil.getSensitiveDataPosting({
              content: ProductionReviewPullRequestContent.ReviewEvenIfPublic,
              isPublic,
            }),
          }),
        );

        expect(text).toContain("Adds the column `customer_ssn` to `customers`");

        for (const word of TABLE_WORDS) {
          expect({ isPublic, word, isSaid: text.includes(word) }).toEqual({
            isPublic,
            word,
            isSaid: false,
          });
        }
      }
    },
  );

  test("a link-only comment shows none of it", () => {
    const comment: string = ProductionReviewComposer.compose(
      input(leakyReport([migrationPoint()]), {
        posting: ProductionReviewPosting.Link,
        isPublicRepository: false,
        sensitiveDataPosting: ProductionReviewUtil.getSensitiveDataPosting({
          content: ProductionReviewPullRequestContent.Link,
          isPublic: false,
        }),
      }),
    );

    for (const word of [...TABLE_WORDS, "customer_ssn"]) {
      expect({ word, isSaid: comment.includes(word) }).toEqual({
        word,
        isSaid: false,
      });
    }
  });
});
