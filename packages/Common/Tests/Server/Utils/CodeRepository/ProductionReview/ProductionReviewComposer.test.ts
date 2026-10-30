import ProductionReviewComposer, {
  MAX_LISTED_IN_COMMENT,
  PRODUCTION_REVIEW_CHECK_TITLES,
  ProductionReviewCheckRunText,
  ProductionReviewCommentInput,
  formatAge,
  formatCount,
  formatDuration,
  formatPercent,
  githubSafeAiText,
  githubSafeText,
  withoutTrailingSlashes,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewComposer";
import GitHubCommandParser from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCommandParser";
import { GitHubCommandSurface } from "../../../../../Types/CodeRepository/GitHubCommand";
import {
  PRODUCTION_REVIEW_COMMENT_MARKER,
  ProductionReviewExceptionJSON,
  ProductionReviewPosting,
  ProductionReviewReport,
  ProductionReviewWhere,
} from "../../../../../Types/CodeRepository/ProductionReview";
import {
  CHECKOUT_SERVICE_ID,
  EXCEPTION_ID,
  NAMED_INCIDENT_ID,
  OPEN_INCIDENT_ID,
  PROJECT_ID,
  REVIEWED_AT,
  emptyReport,
  fullReport,
} from "./ProductionReviewFixtures";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import { GitHubCheckConclusion } from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCheckRuns";

/*
 * The production review comment: one per pull request, edited in place, so
 * it must read well every time - what production says first, the facts
 * after - and say NOTHING of production where it may not: a link-only
 * comment on a public repository holds no fact at all. Every value from
 * outside OneUptime is text, never Markdown, a link or a mention: the last
 * blocks hold a hostile report to that, and run every comment through the
 * app's own command parser, which must find no command in it.
 */

const REVIEW_URL: string = `https://oneuptime.com/dashboard/${PROJECT_ID}/code/tasks/7c1d2e3f-0000-4000-8000-000000000001`;

function input(
  change: Partial<ProductionReviewCommentInput> = {},
): ProductionReviewCommentInput {
  return {
    report: fullReport(),
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

function parsesAsCommand(body: string): boolean {
  return (
    GitHubCommandParser.parse({
      body,
      appSlug: "oneuptime",
      surface: GitHubCommandSurface.PullRequest,
    }) !== null
  );
}

/*
 * A line with its code spans taken out: a run of backticks opens one and
 * the next run of the same length closes it. What is left is what GitHub
 * reads as Markdown.
 */
function withoutCodeSpans(line: string): string {
  let kept: string = "";
  let index: number = 0;

  while (index < line.length) {
    if (line[index] !== "`") {
      kept += line[index];
      index++;
      continue;
    }

    let run: number = 0;

    while (line[index + run] === "`") {
      run++;
    }

    const fence: string = "`".repeat(run);
    let close: number = line.indexOf(fence, index + run);

    while (close !== -1 && line[close + run] === "`") {
      close = line.indexOf(fence, close + run + 1);
    }

    if (close === -1) {
      kept += line.slice(index);
      break;
    }

    index = close + run;
  }

  return kept;
}

// The cells of a Markdown table row, split on the pipes no backslash escapes.
function cellsOf(row: string): number {
  let cells: number = 0;

  for (let index: number = 0; index < row.length; index++) {
    if (row[index] === "|" && row[index - 1] !== "\\") {
      cells++;
    }
  }

  return cells;
}

describe("ProductionReviewComposer.compose: the review", () => {
  const body: string = ProductionReviewComposer.compose(input());

  test("starts with the hidden marker, then names itself and the product", () => {
    expect(body.startsWith(`${PRODUCTION_REVIEW_COMMENT_MARKER}\n\n`)).toBe(
      true,
    );
    expect(body).toContain("### 🔭 Production review by OneUptime");
  });

  test("leads with the service the change runs in and how busy it is", () => {
    expect(body).toContain(
      "This pull request changes code that runs in production in **checkout-api** (12,431 spans in the last hour, p99 840 ms).",
    );
  });

  test("lists the exception thrown at the line it changes, linked into OneUptime, with its count and age", () => {
    expect(body).toContain(
      "**Exceptions thrown in the changed code** · last 7 days",
    );
    expect(body).toContain(
      `[\`TypeError\`](https://oneuptime.com/dashboard/${PROJECT_ID}/exceptions/${EXCEPTION_ID}) · new, unhandled`,
    );
    expect(body).toContain(
      "`src/billing/charge.ts:42` in `chargeCard()` · a line this changes",
    );
    expect(body).toContain("| 1,240 | 2 h ago |");
  });

  test("lists the operation that runs it, with spans, error rate, p95 and why, linked to its traces", () => {
    expect(body).toContain(
      "| Operation | Service | Spans | Errors | p95 | Why |",
    );
    expect(body).toContain(
      "| `GET /api/orders/:id` | [checkout-api](https://oneuptime.com/dashboard/",
    );
    expect(body).toContain(
      "| 3,200 | 0.4% | 840 ms | serves a route this changes |",
    );

    const link: string = body.split("[checkout-api](")[1]!.split(")")[0]!;
    const url: URL = new URL(link);

    expect(url.origin).toBe("https://oneuptime.com");
    expect(url.pathname).toBe(`/dashboard/${PROJECT_ID}/traces`);
    expect(url.searchParams.get("filters")).toBe(
      JSON.stringify([["primaryEntityId", CHECKOUT_SERVICE_ID]]),
    );
    expect(url.searchParams.get("start")).toBe("2026-10-22T09:00:00.000Z");
    expect(url.searchParams.get("end")).toBe(REVIEWED_AT);
  });

  test("says what the changed function takes of its service's CPU time", () => {
    // Named as the review's page in Code names the part.
    expect(body).toContain(
      "**Hot functions in the changed code** · profiles, last hour",
    );
    expect(body).toContain(
      "- `chargeCard()` in `src/billing/charge.ts` takes 12% of checkout-api's CPU time (4% in its own code), and this changes it.",
    );
  });

  test("names the open incident and the one whose root cause names the file, by number only", () => {
    expect(body).toContain(
      `[INC-45](https://oneuptime.com/dashboard/${PROJECT_ID}/incidents/${OPEN_INCIDENT_ID}) (Critical, Investigating, declared 3 h ago) is open on a service this changes.`,
    );
    expect(body).toContain(
      `[INC-31](https://oneuptime.com/dashboard/${PROJECT_ID}/incidents/${NAMED_INCIDENT_ID}) (Major, Resolved, declared 10 days ago): its root cause or postmortem names \`src/billing/charge.ts\`.`,
    );
    expect(body).toContain(
      "4 incidents were declared on these services in the last 30 days.",
    );
  });

  test("names the deploy OneUptime suspects, with its version and what got worse", () => {
    expect(body).toContain(
      "- checkout-api's deploy 2 h ago (`v1.4.2`) is a suspect: error rate rose from 0.2% to 2.1% after it.",
    );
  });

  test("ends with the commit it reviewed, that it is aggregate, the link, and that it follows the pull request", () => {
    expect(body).toContain(
      `<sub>Reviewed at \`0f1e2d3\` · Aggregates only: no log line, message or personal data. · [Open in OneUptime](${REVIEW_URL}) · Updated when the pull request changes.</sub>`,
    );
  });

  test("without an AI read, the facts are not folded", () => {
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("What to watch");
  });

  test("its tables keep their columns", () => {
    for (const line of body.split("\n")) {
      if (line.startsWith("| Exception")) {
        expect(cellsOf(line)).toBe(5);
      }

      if (line.startsWith("| Operation")) {
        expect(cellsOf(line)).toBe(7);
      }
    }
  });
});

describe("ProductionReviewComposer.compose: OneUptime AI's read on top", () => {
  const body: string = ProductionReviewComposer.compose(
    input({
      report: fullReport({
        points: [
          {
            text: "`chargeCard` threw `TypeError` 1,240 times at the line this edits; the null check should stop it.",
          },
          {
            text: "`GET /api/orders/:id` now makes one more query per request.",
          },
        ],
      }),
    }),
  );

  test("leads with what to watch, the names of code kept as code", () => {
    expect(body).toContain(
      "**What to watch**\n\n- `chargeCard` threw `TypeError` 1,240 times at the line this edits; the null check should stop it.\n- `GET /api/orders/:id` now makes one more query per request.",
    );
  });

  test("folds the facts it read from under it", () => {
    expect(body).toContain("<details><summary>What production shows</summary>");
    expect(body.indexOf("What to watch")).toBeLessThan(
      body.indexOf("<details>"),
    );
    expect(body.indexOf("**Exceptions thrown")).toBeGreaterThan(
      body.indexOf("<details>"),
    );
    expect(body.indexOf("</details>")).toBeGreaterThan(
      body.indexOf("**Recent deploys**"),
    );
  });
});

describe("ProductionReviewComposer.compose: a link only", () => {
  const publicBody: string = ProductionReviewComposer.compose(
    input({
      posting: ProductionReviewPosting.Link,
      isPublicRepository: true,
      report: fullReport({
        points: [{ text: "`chargeCard` threw 1,240 times." }],
      }),
    }),
  );

  test("says the repository is public and links to the review", () => {
    expect(publicBody).toContain(
      "OneUptime reviewed this pull request against production and found something worth a look in the code it changes.",
    );
    expect(publicBody).toContain(
      `This repository is public, so the review is in OneUptime, for members of the project: **[Open the production review](${REVIEW_URL})**.`,
    );
  });

  test("holds no fact of production: no service, exception, operation, number, incident, deploy or AI word", () => {
    for (const fact of [
      "checkout-api",
      "TypeError",
      "charge.ts",
      "chargeCard",
      "/api/orders",
      "1,240",
      "12,431",
      "840",
      "INC-45",
      "v1.4.2",
      "error rate",
      "What to watch",
      "Aggregates only",
    ]) {
      expect(publicBody).not.toContain(fact);
    }
  });

  test("a private repository that chose a link does not call itself public", () => {
    const body: string = ProductionReviewComposer.compose(
      input({
        posting: ProductionReviewPosting.Link,
        isPublicRepository: false,
      }),
    );

    expect(body).not.toContain("public");
    expect(body).toContain(
      `The review is in OneUptime, for members of the project: **[Open the production review](${REVIEW_URL})**.`,
    );
  });

  test("with nothing found, the link says so", () => {
    const body: string = ProductionReviewComposer.compose(
      input({
        posting: ProductionReviewPosting.Link,
        isPublicRepository: true,
        report: emptyReport(),
      }),
    );

    expect(body).toContain("found nothing that runs through its changes.");
  });
});

describe("ProductionReviewComposer.compose: nothing found", () => {
  test("nothing in production runs the change", () => {
    const body: string = ProductionReviewComposer.compose(
      input({ report: emptyReport() }),
    );

    expect(body).toContain(
      "Nothing in production runs through this pull request's changes: no exception thrown in them in the last 7 days, no traced operation or profiled function that runs them in the last hour, and no open incident or suspect deploy on their services.",
    );
    expect(body).not.toContain("**Exceptions");
  });

  test("a change to no code production runs", () => {
    expect(
      ProductionReviewComposer.compose(
        input({ report: emptyReport({ codeFileCount: 0 }) }),
      ),
    ).toContain(
      "This pull request changes no code production runs, so production has nothing to say about it.",
    );
  });

  test("a repository no service is known to run", () => {
    expect(
      ProductionReviewComposer.compose(
        input({
          report: emptyReport({
            services: [],
            noServicesReason: "NoServiceMapped",
          }),
        }),
      ),
    ).toContain(
      "Production has nothing to say about this pull request yet: no service OneUptime monitors is known to run this repository's code.",
    );
  });
});

describe("ProductionReviewComposer.compose: the footer", () => {
  test("a pull request OneUptime does not follow says how to ask again, as code", () => {
    const body: string = ProductionReviewComposer.compose(
      input({ updatesOnPush: false }),
    );

    expect(body).toContain(
      "Not updated on its own: ask again with `@oneuptime production review` after new commits.",
    );
    expect(parsesAsCommand(body)).toBe(false);
  });

  test("without the app's handle it still says to ask again", () => {
    expect(
      ProductionReviewComposer.compose(
        input({ updatesOnPush: false, reviewCommand: null }),
      ),
    ).toContain("Not updated on its own: ask again after new commits.");
  });

  /*
   * GitLab, Forgejo and Gitea: OneUptime reads no command there, so a
   * pull request it does not follow is asked again in OneUptime - the
   * footer links Review again, and names no command anyone could type.
   */
  test("where no command is read, it says to press Review again in OneUptime, linked", () => {
    const body: string = ProductionReviewComposer.compose(
      input({
        updatesOnPush: false,
        reviewCommand: null,
        asksAgainInProduct: true,
        pullRequestTerm: "merge request",
      }),
    );

    expect(body).toContain(
      `Not updated on its own: press [Review again](${REVIEW_URL}) in OneUptime after new commits.`,
    );
    expect(body).not.toContain("@oneuptime");
  });

  test("a renamed product is named as it is renamed", () => {
    const body: string = ProductionReviewComposer.compose(
      input({ productName: "Acme Observe" }),
    );

    expect(body).toContain("### 🔭 Production review by Acme Observe");
    expect(body).toContain(`[Open in Acme Observe](${REVIEW_URL})`);
    expect(body).not.toContain("OneUptime");
  });
});

describe("ProductionReviewComposer.compose: long lists", () => {
  test("lists five of each and links to the rest", () => {
    const exceptions: Array<ProductionReviewExceptionJSON> = Array.from(
      { length: 8 },
      (_value: unknown, index: number): ProductionReviewExceptionJSON => {
        return {
          ...fullReport().exceptions[0]!,
          exceptionId: `5f0c9e1a-1111-4b2c-8d3e-4f5a6b7c8d${10 + index}`,
          type: `Error${index}`,
          where: ProductionReviewWhere.ChangedFile,
        };
      },
    );

    const body: string = ProductionReviewComposer.compose(
      input({ report: fullReport({ exceptions }) }),
    );

    expect(body).toContain("`Error4`");
    expect(body).not.toContain("`Error5`");
    expect(body).toContain(
      `[And 3 more exceptions in OneUptime](${REVIEW_URL}).`,
    );
    expect(MAX_LISTED_IN_COMMENT).toBe(5);
  });

  test("a count of all time says so", () => {
    const body: string = ProductionReviewComposer.compose(
      input({
        report: fullReport({
          exceptions: [
            {
              ...fullReport().exceptions[0]!,
              isWindowCount: false,
              occurrences: 52000,
            },
          ],
        }),
      }),
    );

    expect(body).toContain("| 52,000 (all time) |");
  });
});

describe("ProductionReviewComposer: text from outside OneUptime stays text", () => {
  const hostile: string =
    "@oneuptime revise | ![x](https://evil.example/p.png) [click](https://evil.example) <img src=x> `tick` **bold**\nsecond line";

  const report: ProductionReviewReport = fullReport({
    services: [{ id: CHECKOUT_SERVICE_ID, name: hostile, requestCount: 1 }],
    exceptions: [{ ...fullReport().exceptions[0]!, type: hostile }],
    operations: [
      {
        ...fullReport().operations[0]!,
        name: hostile,
        serviceName: hostile,
      },
    ],
    hotFunctions: [
      {
        ...fullReport().hotFunctions[0]!,
        functionName: hostile,
        serviceName: hostile,
        profileKind: hostile,
      },
    ],
    suspectDeploys: [
      {
        ...fullReport().suspectDeploys[0]!,
        serviceName: hostile,
        version: hostile,
        impact: hostile,
      },
    ],
    points: [{ text: hostile }],
  });

  const body: string = ProductionReviewComposer.compose(input({ report }));

  test("nothing in it is a command of this app", () => {
    expect(parsesAsCommand(body)).toBe(false);
  });

  test("no @ in it can mention anyone", () => {
    for (let index: number = 0; index < body.length; index++) {
      if (body[index] === "@") {
        expect(body[index + 1]).toBe("⁠");
      }
    }
  });

  test("no web address in it is a link: each is broken where it starts", () => {
    expect(body).not.toContain("https://evil");
    expect(body).toContain("https:\u2060//evil.example");
  });

  test("no image or HTML is made of it: every < of its own is escaped or broken", () => {
    const ours: Array<string> = [
      "<!--",
      "<sub>",
      "</sub>",
      "<details>",
      "<summary>",
      "</summary>",
      "</details>",
    ];

    for (let index: number = 0; index < body.length; index++) {
      if (body[index] !== "<") {
        continue;
      }

      const isOurs: boolean = ours.some((tag: string): boolean => {
        return body.startsWith(tag, index);
      });

      if (!isOurs) {
        expect(body[index - 1] === "\\" || body[index + 1] === "\u2060").toBe(
          true,
        );
      }
    }
  });

  test("no image or link is made of it: outside code, every bracket is escaped", () => {
    const prose: string = body
      .split("\n")
      .map((line: string): string => {
        return withoutCodeSpans(line);
      })
      .join("\n");

    expect(prose).not.toContain("![x](");
    expect(prose).not.toContain("[click](");
    expect(prose).toContain("!\\[x\\]");
  });

  test("its line breaks never start a line of their own", () => {
    expect(body).not.toContain("\nsecond line");
  });

  test("a | in a table cell does not add a column", () => {
    for (const line of body.split("\n")) {
      if (line.startsWith("| [`")) {
        expect(cellsOf(line)).toBe(5);
      }

      if (line.startsWith("| `")) {
        expect(cellsOf(line)).toBe(7);
      }
    }
  });

  test("the comment stays far under GitHub's 65,536 characters with every value at its longest", () => {
    const long: string = "x".repeat(5000);
    const huge: string = ProductionReviewComposer.compose(
      input({
        report: fullReport({
          services: [{ id: CHECKOUT_SERVICE_ID, name: long }],
          exceptions: Array.from({ length: 8 }, () => {
            return {
              ...fullReport().exceptions[0]!,
              type: long,
              path: long,
              functionName: long,
            };
          }),
          points: Array.from({ length: 4 }, () => {
            return { text: long };
          }),
        }),
      }),
    );

    expect(huge.length).toBeLessThan(30000);
  });
});

describe("ProductionReviewComposer.summarize", () => {
  test("says what was found, counted", () => {
    expect(ProductionReviewComposer.summarize(fullReport())).toBe(
      "Production review: 1 exception, 1 operation, 1 hot function, 2 incidents and 1 suspect deploy in or around the changed code.",
    );
  });

  test("one kind alone", () => {
    expect(
      ProductionReviewComposer.summarize(
        emptyReport({ exceptions: fullReport().exceptions }),
      ),
    ).toBe("Production review: 1 exception in or around the changed code.");
  });

  test("nothing found", () => {
    expect(ProductionReviewComposer.summarize(emptyReport())).toBe(
      "Nothing in production runs through this pull request's changes.",
    );
  });
});

describe("formatting", () => {
  test("an address loses the slashes it ends with, in time in line with it", () => {
    expect(withoutTrailingSlashes("https://oneuptime.com/dashboard/")).toBe(
      "https://oneuptime.com/dashboard",
    );
    expect(withoutTrailingSlashes("https://oneuptime.com/dashboard///")).toBe(
      "https://oneuptime.com/dashboard",
    );
    expect(withoutTrailingSlashes("https://oneuptime.com/dashboard")).toBe(
      "https://oneuptime.com/dashboard",
    );
    expect(withoutTrailingSlashes("///")).toBe("");
    expect(withoutTrailingSlashes("")).toBe("");

    // The worst case of the pattern this replaced: slashes, then not one.
    const worst: string = `${"/".repeat(400000)}x/`;
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(withoutTrailingSlashes(worst)).toBe(`${"/".repeat(400000)}x`);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("counts", () => {
    expect(formatCount(1240)).toBe("1,240");
    expect(formatCount(0.4)).toBe("0");
    expect(formatCount(Number.NaN)).toBe("0");
  });

  test("durations", () => {
    expect(formatDuration(840.4)).toBe("840 ms");
    expect(formatDuration(1200)).toBe("1.2 s");
    expect(formatDuration(3000)).toBe("3 s");
    expect(formatDuration(150000)).toBe("2.5 min");
    expect(formatDuration(-1)).toBe("0 ms");
  });

  test("percents", () => {
    expect(formatPercent(0.04)).toBe("under 0.1%");
    expect(formatPercent(0.4)).toBe("0.4%");
    expect(formatPercent(4)).toBe("4%");
    expect(formatPercent(12.4)).toBe("12%");
    expect(formatPercent(0)).toBe("0%");
  });

  test("ages before the review", () => {
    const now: Date = new Date(REVIEWED_AT);

    expect(formatAge("2026-10-22T09:59:40.000Z", now)).toBe("just now");
    expect(formatAge("2026-10-22T09:15:00.000Z", now)).toBe("45 min ago");
    expect(formatAge("2026-10-22T07:00:00.000Z", now)).toBe("3 h ago");
    expect(formatAge("2026-10-21T09:00:00.000Z", now)).toBe("1 day ago");
    expect(formatAge("2026-10-12T10:00:00.000Z", now)).toBe("10 days ago");
    expect(formatAge(undefined, now)).toBe("");
    expect(formatAge("not a date", now)).toBe("");
  });

  test("githubSafeText makes one line, cuts by code point and breaks every @", () => {
    expect(githubSafeText("a\n  b\tc", 100)).toBe("a b c");
    expect(githubSafeText("@oneuptime help", 100)).toBe("@⁠oneuptime help");
    expect(githubSafeText("😀😀😀😀", 3)).toBe("😀😀…");
    expect(githubSafeText(null, 10)).toBe("");
  });

  test("githubSafeAiText breaks web addresses too", () => {
    expect(
      githubSafeAiText("see https://x.example and www.y.example", 200),
    ).toBe("see https:⁠//x.example and www⁠.y.example");
  });
});

/*
 * A GitLab merge request's review says merge request wherever the comment
 * names what it reviews - GitLab's own word - and nothing else changes.
 */
describe("ProductionReviewComposer: in the host's words", () => {
  test("a merge request's review says merge request, everywhere it names one", () => {
    const review: string = ProductionReviewComposer.compose(
      input({ pullRequestTerm: "merge request" }),
    );

    expect(review).toContain(
      "This merge request changes code that runs in production in **checkout-api**",
    );
    expect(review).toContain("Updated when the merge request changes.");
    expect(review).not.toContain("pull request");

    const link: string = ProductionReviewComposer.compose(
      input({
        pullRequestTerm: "merge request",
        posting: ProductionReviewPosting.Link,
        isPublicRepository: true,
      }),
    );

    expect(link).toContain(
      "OneUptime reviewed this merge request against production and found something worth a look in the code it changes.",
    );

    const nothing: string = ProductionReviewComposer.compose(
      input({
        pullRequestTerm: "merge request",
        report: emptyReport({ services: [], codeFileCount: 0 }),
      }),
    );

    expect(nothing).toContain(
      "This merge request changes no code production runs, so production has nothing to say about it.",
    );
    expect(
      ProductionReviewComposer.summarize(emptyReport(), "merge request"),
    ).toBe("Nothing in production runs through this merge request's changes.");
  });

  test("a pull request on any other host says pull request, as it always did", () => {
    expect(ProductionReviewComposer.compose(input())).toContain(
      "This pull request changes code that runs in production",
    );
  });
});

/*
 * A GitHub pull request's review is a check run too: success when
 * production has nothing to say, neutral when something is worth a look -
 * never a failure - and a summary that holds what the comment holds, the
 * link alone where the comment is a link.
 */
describe("ProductionReviewComposer.composeCheckRun", () => {
  test("something worth a look is neutral, its summary the review without the comment's marker or heading", () => {
    const check: ProductionReviewCheckRunText =
      ProductionReviewComposer.composeCheckRun(input());
    const comment: string = ProductionReviewComposer.compose(input());

    expect(check.conclusion).toBe(GitHubCheckConclusion.Neutral);
    expect(check.title).toBe(PRODUCTION_REVIEW_CHECK_TITLES.worthALook);
    expect(check.title).toBe("Something in production is worth a look");
    expect(check.summary).not.toContain(PRODUCTION_REVIEW_COMMENT_MARKER);
    /*
     * The check's name is its heading on GitHub ("OneUptime production
     * review"): the summary does not say it again.
     */
    expect(check.summary).not.toContain("### ");
    expect(check.summary).not.toContain("Production review by");
    expect(
      `${PRODUCTION_REVIEW_COMMENT_MARKER}\n\n### 🔭 Production review by OneUptime\n\n${check.summary}`,
    ).toBe(comment);
  });

  test("nothing to say is a success", () => {
    const check: ProductionReviewCheckRunText =
      ProductionReviewComposer.composeCheckRun(
        input({ report: emptyReport() }),
      );

    expect(check.conclusion).toBe(GitHubCheckConclusion.Success);
    expect(check.title).toBe(
      "Nothing in production runs through these changes",
    );
    expect(check.summary).toContain(
      "Nothing in production runs through this pull request's changes",
    );
  });

  test("a public repository's check holds no fact of production: the link alone", () => {
    const check: ProductionReviewCheckRunText =
      ProductionReviewComposer.composeCheckRun(
        input({
          posting: ProductionReviewPosting.Link,
          isPublicRepository: true,
        }),
      );

    expect(check.summary).toContain(
      `**[Open the production review](${REVIEW_URL})**`,
    );

    for (const fact of [
      "checkout-api",
      "TypeError",
      "chargeCard",
      "INC-45",
      "v1.4.2",
      "12,431",
    ]) {
      expect(check.summary).not.toContain(fact);
    }
  });

  test("its summary is no command of the app, and a renamed product is named as renamed", () => {
    const check: ProductionReviewCheckRunText =
      ProductionReviewComposer.composeCheckRun(
        input({ productName: "Acme Observe", updatesOnPush: false }),
      );

    expect(parsesAsCommand(check.summary)).toBe(false);
    expect(check.summary).toContain("Open in Acme Observe");
    expect(check.summary).not.toContain("OneUptime");
  });
});
