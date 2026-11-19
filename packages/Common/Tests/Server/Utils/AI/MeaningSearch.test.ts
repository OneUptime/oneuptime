import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";
import MeaningSearch, {
  MAX_RESULT_FIELD_CHARS,
  MAX_SEARCH_CANDIDATES,
  MeaningSearchCandidate,
  MeaningSearchMatch,
} from "../../../../Server/Utils/AI/MeaningSearch";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import MeaningMatch, {
  MEANING_CONCEPTS,
  MeaningConcept,
} from "../../../../Utils/AI/MeaningMatch";

/*
 * SEARCH PAST RECORDS BY MEANING (#7673). OneUptime AI's search_incidents
 * matched one substring of the whole question: "too many connections" never
 * found the incident whose root cause said "connection pool exhausted". The
 * search now asks the database for the records that name what the question
 * names, in any of the words that say it (one Postgres regular expression,
 * built from MeaningMatch's own concept patterns), and ranks them by
 * meaning. Pinned here:
 *
 *   - the pattern the database reads: each concept's own pattern, with
 *     JavaScript's word boundary written as Postgres's, and each word by
 *     the start every form of it shares; nothing for a question that says
 *     nothing;
 *   - the concepts' patterns use nothing Postgres reads differently, so the
 *     database and MeaningMatch agree on a concept's phrasings;
 *   - the pattern, read as the database reads it, finds the paraphrases a
 *     substring missed, and leaves out what says something else;
 *   - the condition's SQL: every column, by the pattern and by the question
 *     as typed, each value one bound parameter;
 *   - the ranking: the closest first, only matches (or the question as
 *     typed), each with what it matched on.
 */

// A Raw condition's SQL for a column, with its parameters.
function sqlOf(
  condition: unknown,
  alias: string,
): {
  sql: string;
  parameters: Record<string, unknown>;
} {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  return {
    sql: operator.getSql!(alias),
    parameters: (operator.objectLiteralParameters || {}) as Record<
      string,
      unknown
    >,
  };
}

/*
 * The database pattern read as Postgres reads it (~*, without case), in
 * JavaScript: Postgres's word boundary \y is JavaScript's \b, and every
 * other construct the pattern uses reads the same in both (pinned below).
 */
function databaseFinds(question: string, text: string): boolean {
  const pattern: string | null = MeaningSearch.getDatabasePattern(
    MeaningMatch.getSearchTerms(question),
  );

  if (!pattern) {
    return false;
  }

  return new RegExp(pattern.split("\\y").join("\\b"), "i").test(text);
}

function candidate(
  id: string,
  text: string,
): MeaningSearchCandidate<{ id: string }> {
  return { record: { id }, text };
}

function ids(
  matches: Array<MeaningSearchMatch<{ id: string }>>,
): Array<string> {
  return matches.map((match: MeaningSearchMatch<{ id: string }>): string => {
    return match.record.id;
  });
}

describe("the pattern the database reads", () => {
  test("a concept is its own pattern, with Postgres's word boundary", () => {
    const pattern: string | null = MeaningSearch.getDatabasePattern(
      MeaningMatch.getSearchTerms("too many connections"),
    );
    const concept: MeaningConcept = MEANING_CONCEPTS.find(
      (each: MeaningConcept): boolean => {
        return each.id === "connection-exhaustion";
      },
    )!;

    expect(pattern).toBe(
      `(?:${concept.pattern.source.split("\\b").join("\\y")})`,
    );
    expect(pattern).not.toContain("\\b");
  });

  test("a word is matched from the start of a word, by the start its forms share", () => {
    expect(
      MeaningSearch.getDatabasePattern({
        concepts: [],
        wordStarts: ["quer", "fail"],
      }),
    ).toBe("\\yquer|\\yfail");
  });

  test("a word in another script is matched anywhere, as written", () => {
    expect(
      MeaningSearch.getDatabasePattern({
        concepts: [],
        wordStarts: ["数据库连接池耗尽"],
      }),
    ).toBe("数据库连接池耗尽");
  });

  test("anything but letters and digits in a word start is matched as itself", () => {
    expect(
      MeaningSearch.getDatabasePattern({
        concepts: [],
        wordStarts: ["a.b*c"],
      }),
    ).toBe("a\\.b\\*c");
  });

  test("a question that says nothing gives no pattern", () => {
    for (const question of ["", "the and of", "1234"]) {
      expect(
        MeaningSearch.getDatabasePattern(MeaningMatch.getSearchTerms(question)),
      ).toBeNull();
    }
  });

  test("every concept's pattern uses only what Postgres reads as JavaScript does", () => {
    for (const concept of MEANING_CONCEPTS) {
      const rest: string = concept.pattern.source
        .split("\\b")
        .join("")
        .split("\\d")
        .join("");

      // Letters, digits, spaces, groups, alternatives, optionals, classes.
      expect({ id: concept.id, rest }).toEqual({
        id: concept.id,
        rest: expect.stringMatching(/^[a-z0-9 ()|?[\]-]+$/),
      });
      expect(concept.pattern.flags).toBe("");
      expect(MeaningSearch.toPostgresPattern(concept)).not.toContain("\\b");
    }
  });
});

describe("what the database finds for a question", () => {
  test.each([
    [
      "too many connections",
      "Root cause: the connection pool was exhausted on payments-db",
    ],
    ["too many connections", "PgBouncer: max connections reached"],
    ["503s on checkout", "Checkout: service unavailable"],
    ["checkout 503", "Bad gateway from the edge"],
    ["OOMKilled", "worker exceeded its memory limit and restarted"],
    ["disk full", "No space left on device /var/lib/postgresql"],
    ["billing queries failing", "The billing query failed at 02:00"],
    ["certificate expired", "TLS handshake failed: x509 unknown authority"],
    ["数据库连接池耗尽", "原因：数据库连接池耗尽"],
  ])("%s finds %s", (question: string, text: string) => {
    expect(databaseFinds(question, text)).toBe(true);
  });

  test.each([
    ["too many connections", "TLS certificate expired on the edge"],
    ["api errors", "Rapid growth of the orders table"],
    ["disk full", "Checkout latency is high"],
  ])("%s does not find %s", (question: string, text: string) => {
    expect(databaseFinds(question, text)).toBe(false);
  });
});

describe("the condition on a record's texts", () => {
  const COLUMNS: Array<string> = ["title", "rootCause"];

  test("every column is read by the pattern and by the question as typed, each one bound parameter", () => {
    const { sql, parameters } = sqlOf(
      MeaningSearch.getCondition({
        columns: COLUMNS,
        text: "Too many connections",
      }),
      "Incident.title",
    );
    const values: Array<unknown> = Object.values(parameters);

    expect(sql).toContain("CAST(Incident.title AS TEXT) ILIKE :");
    expect(sql).toContain("CAST(Incident.rootCause AS TEXT) ILIKE :");
    expect(sql).toContain("CAST(Incident.title AS TEXT) ~* :");
    expect(sql).toContain("CAST(Incident.rootCause AS TEXT) ~* :");
    expect(sql.split(" OR ")).toHaveLength(4);
    expect(values).toHaveLength(2);
    expect(values).toContain("%too many connections%");
    expect(values).toContain(
      MeaningSearch.getDatabasePattern(
        MeaningMatch.getSearchTerms("Too many connections"),
      ),
    );
    // Neither value is ever written into the SQL itself.
    expect(sql).not.toContain("connections");
  });

  test("a question with nothing to match by meaning is still looked for as typed", () => {
    const { sql, parameters } = sqlOf(
      MeaningSearch.getCondition({ columns: COLUMNS, text: "4521-7788" }),
      "Incident.title",
    );

    expect(sql).not.toContain("~*");
    expect(Object.values(parameters)).toEqual(["%4521-7788%"]);
  });

  test("% and _ in the question match only themselves", () => {
    const { parameters } = sqlOf(
      QueryHelper.multiSearchOrPattern(COLUMNS, {
        text: "100%_done",
        pattern: null,
      }),
      "Incident.title",
    );

    expect(Object.values(parameters)).toEqual(["%100\\%\\_done%"]);
  });

  test("no question and no pattern matches nothing", () => {
    expect(
      sqlOf(
        QueryHelper.multiSearchOrPattern(COLUMNS, { text: " ", pattern: null }),
        "Incident.title",
      ).sql,
    ).toBe("TRUE = FALSE");
    expect(
      sqlOf(
        QueryHelper.multiSearchOrPattern([], { text: "disk", pattern: "x" }),
        "Incident.title",
      ).sql,
    ).toBe("TRUE = FALSE");
  });
});

describe("ranking the candidates", () => {
  test("the closest first, what says something else left out, each with what it matched on", () => {
    const matches: Array<MeaningSearchMatch<{ id: string }>> =
      MeaningSearch.rank({
        text: "too many connections to postgres",
        limit: 5,
        candidates: [
          candidate("certificate", "TLS certificate expired on the edge"),
          candidate(
            "pool",
            "Checkout down\nconnection pool exhausted on the postgres primary",
          ),
          candidate("database", "Postgres replica lag"),
        ],
      });

    expect(ids(matches)[0]).toBe("pool");
    expect(ids(matches)).not.toContain("certificate");
    expect(matches[0]!.score.sharedTerms).toContain(
      "connection pool exhausted",
    );
    expect(
      MeaningSearch.describeMatch({
        match: matches[0]!,
        text: "too many connections to postgres",
      }),
    ).toContain("connection pool exhausted");
  });

  test("a record that holds the question as typed is kept, though it reads alike in nothing else", () => {
    const matches: Array<MeaningSearchMatch<{ id: string }>> =
      MeaningSearch.rank({
        text: "INC-4521",
        limit: 5,
        candidates: [
          {
            record: { id: "typed" },
            text: "Checkout down",
            wholeText: "Checkout down\nSee INC-4521 for the timeline",
          },
          candidate("other", "Checkout down"),
        ],
      });

    expect(ids(matches)).toEqual(["typed"]);
    expect(matches[0]!.isLiteralMatch).toBe(true);
    expect(
      MeaningSearch.describeMatch({ match: matches[0]!, text: "INC-4521" }),
    ).toBe('the text "INC-4521"');
  });

  test("at most `limit`, the newest first among equals", () => {
    const matches: Array<MeaningSearchMatch<{ id: string }>> =
      MeaningSearch.rank({
        text: "disk full",
        limit: 2,
        candidates: [
          candidate("newest", "disk full on db-1"),
          candidate("middle", "disk full on db-1"),
          candidate("oldest", "disk full on db-1"),
        ],
      });

    expect(ids(matches)).toEqual(["newest", "middle"]);
  });

  test("no candidates, no matches", () => {
    expect(
      MeaningSearch.rank({ text: "disk full", limit: 5, candidates: [] }),
    ).toEqual([]);
  });
});

describe("what a record says, for a ranking", () => {
  test("its title first, then its texts in order, each held to its share, embedded files left out", () => {
    const screenshot: string = `data:image/png;base64,${"A".repeat(50_000)}`;
    const text: string = MeaningSearch.documentText({
      title: "Checkout down",
      texts: [
        "connection pool exhausted",
        null,
        `${"word ".repeat(1000)}`,
        `Screenshot ${screenshot}`,
      ],
    });

    expect(text.startsWith("Checkout down\nconnection pool exhausted")).toBe(
      true,
    );
    expect(text).not.toContain("AAAAAAAAAA");
    expect(text.length).toBeLessThan(4_000);
  });

  test("a result field is held to MAX_RESULT_FIELD_CHARS, and an empty one is left out", () => {
    expect(
      MeaningSearch.resultField("x".repeat(5_000))!.length,
    ).toBeLessThanOrEqual(MAX_RESULT_FIELD_CHARS + 60);
    expect(MeaningSearch.resultField("   ")).toBeUndefined();
    expect(MeaningSearch.resultField(undefined)).toBeUndefined();
  });

  test("a search reads at most about a hundred candidates", () => {
    expect(MAX_SEARCH_CANDIDATES).toBe(100);
  });
});
