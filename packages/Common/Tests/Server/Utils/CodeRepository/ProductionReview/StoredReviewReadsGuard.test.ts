import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY READ OF A STORED PRODUCTION REVIEW HOLDS IT TO ITS READER, OR SAYS
 * WHY IT NEEDS NOT (#9241).
 *
 * A pull request's production review is worked out once and kept on its
 * task's outcome (AIRun.taskOutcome.productionReview). An incident on it can
 * be made private afterwards - or be deleted - and a path that serves the
 * review as it was kept shows that incident's label, severity, state, the
 * changed code its root cause names and its link to every reader of the
 * repository's tasks, and counts it. The Code pages did, on a list's row and
 * on the review's page.
 *
 * So each server file that reads a task's outcome (the column, a select of
 * it, or the review in it) is listed here with what it is:
 *
 *   - it serves the review to a person, and holds it to them first: each
 *     `mustContain` is in its source (ProductionReviewReadFilter);
 *   - it reads the outcome for OneUptime's own work, and no person reads
 *     what it reads of the review;
 *   - it reads what a turn ended with, but never the review in it.
 *
 * A file that starts reading an outcome and is not listed fails "is
 * listed": list it with what it is - and, if it serves a person, have it
 * hold the review to them. A listed file that no longer reads one fails
 * too, so the list stays true.
 */

// packages/Common/Tests/Server/Utils/CodeRepository/ProductionReview -> the root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

type Classification =
  // Serves a stored review to a person, held to them: each snippet is in it.
  | { kind: "holdsTheReviewToItsReader"; mustContain: Array<string> }
  // The rule itself.
  | { kind: "isTheRule"; mustContain: Array<string> }
  // OneUptime's own work: no person reads what it reads of the review.
  | { kind: "oneUptimesOwn"; why: string }
  // Reads what a turn ended with, never the review in it.
  | { kind: "readsNoReview"; why: string };

const READERS: Record<string, Classification> = {
  "packages/Common/Server/Utils/AI/CodeTask/CodeTaskPresenter.ts": {
    kind: "holdsTheReviewToItsReader",
    mustContain: [
      // A list's rows: each review, held to the reader in one read.
      "CodeTaskPresenter.loadReviews({ projectId: data.projectId,",
      "await CodeTaskPresenter.keepReviewsForReader({ projectId: data.projectId, runs, props: data.props, });",
      // A task's page: every turn it reads, before anything is made of it.
      "await CodeTaskPresenter.keepReviewsForReader({ projectId: data.projectId, runs: [...turns, ...turnsNotShown, ...(linked ? [linked.turn] : [])],",
      "await ProductionReviewReadFilter.readReadableIncidentIds({",
      "ProductionReviewReadFilter.keepOutcome(",
      // A review's row says what AI last said: the review's own sentence, kept.
      "lastReply: review?.summary || taskOutcomes?.lastReply,",
    ],
  },
  "packages/Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewReadFilter.ts":
    {
      kind: "isTheRule",
      mustContain: [
        // The incidents asked of the incidents themselves, as the reader.
        "await IncidentService.findBy({",
        "props: data.props,",
        "ProductionReviewUtil.keepReadableIncidents(",
      ],
    },
  "packages/Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewRunner.ts":
    {
      kind: "oneUptimesOwn",
      why: "Works a review out and posts it: the last review's AI points are kept when the facts did not change, and the comment on the code host is OneUptime's to write, as the review was when it was posted.",
    },
  "packages/Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewQueue.ts":
    {
      kind: "oneUptimesOwn",
      why: "Writes a finished review onto its task's outcome, and asks a review again: never answers a person with what it holds.",
    },
  "packages/Common/Server/API/AIAgentTaskAPI.ts": {
    kind: "oneUptimesOwn",
    why: "The Runner's protocol: a turn's outcome as the Runner reports it, written onto the turn - a Runner writes no production review.",
  },
  "packages/Common/Server/Services/AIRunService.ts": {
    kind: "oneUptimesOwn",
    why: "The outcome a status change writes onto a run (attemptStatusTransition's set): written, never read for a person.",
  },
  "packages/Common/Server/Utils/AI/CodeTask/CodeTaskAgentBrief.ts": {
    kind: "readsNoReview",
    why: "What the AI is told of a task's earlier turns: their reply and the files they changed - never a review, and never for a person.",
  },
  "packages/Common/Server/Utils/AI/CodeTask/CodeTaskListRows.ts": {
    kind: "readsNoReview",
    why: "A list's rows, in SQL: each turn's changed files and its reply. A production review's reply is replaced by the review held to the reader (CodeTaskPresenter.summarize).",
  },
};

// A read of a task's outcome: the column, a select of it, or the review in it.
const READS_AN_OUTCOME: RegExp = /\btaskOutcome\b/;

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        ![
          "node_modules",
          "Tests",
          "SchemaMigrations",
          "build",
          "dist",
        ].includes(entry.name)
      ) {
        found.push(...listSourceFiles(full));
      }

      continue;
    }

    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      found.push(full);
    }
  }

  return found;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function read(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

// The server's code: Common's, and every App feature set's own server code.
const SERVER_FILES: Array<string> = [
  ...listSourceFiles(path.join(REPOSITORY_ROOT, "packages/Common/Server")),
  ...listSourceFiles(path.join(REPOSITORY_ROOT, "packages/App/FeatureSet")),
]
  .map(relative)
  // The Dashboard draws what the server sent; it reads no stored outcome.
  .filter((file: string): boolean => {
    return !file.startsWith("packages/App/FeatureSet/Dashboard/");
  });

const OUTCOME_READERS: Array<string> = SERVER_FILES.filter(
  (file: string): boolean => {
    return READS_AN_OUTCOME.test(read(file));
  },
).sort();

function missing(file: string, classification: Classification): Array<string> {
  if (!("mustContain" in classification)) {
    return [];
  }

  // Read with every run of white space as one, as the code is formatted.
  const code: string = read(file).replace(/\s+/g, " ");

  return classification.mustContain.filter((snippet: string): boolean => {
    return !code.includes(snippet.replace(/\s+/g, " "));
  });
}

describe("server code that reads a task's outcome", () => {
  test("the sweep finds the Code pages' and the review's own", () => {
    expect(OUTCOME_READERS).toEqual(
      expect.arrayContaining([
        "packages/Common/Server/Utils/AI/CodeTask/CodeTaskPresenter.ts",
        "packages/Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewRunner.ts",
      ]),
    );
  });

  test.each(OUTCOME_READERS)("%s is listed with what it is", (file: string) => {
    expect({ file, isListed: Boolean(READERS[file]) }).toEqual({
      file,
      isListed: true,
    });
  });

  test("lists no file that reads none", () => {
    expect(
      Object.keys(READERS).filter((file: string): boolean => {
        return !OUTCOME_READERS.includes(file);
      }),
    ).toEqual([]);
  });

  test.each(Object.entries(READERS))(
    "%s holds what it is listed as",
    (file: string, classification: Classification) => {
      expect({ file, missing: missing(file, classification) }).toEqual({
        file,
        missing: [],
      });

      if ("why" in classification) {
        expect(classification.why.length).toBeGreaterThan(40);
      }
    },
  );

  /*
   * The review's page and a list's row are drawn from what the presenter
   * sends: a turn's outcome, and a summary of the review. Both are made
   * after the review is held to the reader - so no outcome is sent from a
   * read the rule did not see.
   */
  test("the presenter holds every review it reads before it sends one", () => {
    const code: string = read(
      "packages/Common/Server/Utils/AI/CodeTask/CodeTaskPresenter.ts",
    );

    // Every outcome read for a conversation goes through the rule first.
    const conversation: string = code.slice(
      code.indexOf("public static async getConversation("),
      code.indexOf("private static async findLinkedTurn("),
    );

    expect(conversation.indexOf("keepReviewsForReader(")).toBeGreaterThan(-1);
    expect(conversation.indexOf("keepReviewsForReader(")).toBeLessThan(
      conversation.indexOf("CodeTaskPresenter.getTurnFacts("),
    );
    expect(conversation.indexOf("keepReviewsForReader(")).toBeLessThan(
      conversation.indexOf("CodeTaskPresenter.toTurn("),
    );

    /*
     * A long task's earlier turns, read a page at a time (#7128), are
     * turns of the conversation: held to the rule before any is sent.
     */
    const earlier: string = code.slice(
      code.indexOf("public static async getEarlierTurns("),
      code.indexOf("private static async findLinkedTurn("),
    );

    expect(earlier.indexOf("keepReviewsForReader(")).toBeGreaterThan(-1);
    expect(earlier.indexOf("keepReviewsForReader(")).toBeLessThan(
      earlier.indexOf("CodeTaskPresenter.toTurn("),
    );

    /*
     * The outcome is selected in four places: the turns a conversation
     * shows and the ones it does not, its earlier turns read a page at a
     * time (each held above), and a list's reviews - each held to the
     * reader right where it is read.
     */
    expect(code.split("taskOutcome: true").length - 1).toBe(4);

    const listReviews: string = code.slice(
      code.indexOf("private static async loadReviews("),
      code.indexOf("public static async keepReviewsForReader("),
    );

    expect(listReviews).toContain(
      "select: { _id: true, taskOutcome: true, taskContext: true },",
    );
    expect(listReviews).toContain("CodeTaskPresenter.keepReviewsForReader(");
  });
});
