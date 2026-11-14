import MeaningMatch, {
  MAX_SHARED_TERMS,
  MAX_TEXT_LENGTH,
  MEANING_CONCEPTS,
  MIN_MEANING_SIMILARITY,
  MeaningConcept,
  MeaningScore,
  MeaningTerms,
} from "../../../Utils/AI/MeaningMatch";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - recall by meaning (issue #6798), the matcher
 * OneUptime AI's memory uses to recall a past incident or alert that says
 * the same thing happened in other words:
 *
 *  - the phrasings of one outage are one concept: "503", "5xx" and
 *    "service unavailable"; "OOMKilled" and "memory limit";
 *  - what is left are stemmed words, with the stop words, numbers, ids,
 *    hashes, addresses and links that tell records apart by nothing taken
 *    out;
 *  - records that read alike score high, records about something else
 *    score nothing, and a match says which terms made it, strongest first;
 *  - one shared word is a coincidence, not a match;
 *  - the same inputs always give the same answer, and a screenshot's
 *    megabytes are never read.
 */

function terms(text: string): Array<string> {
  return Array.from(MeaningMatch.read(text).weights.keys()).sort();
}

describe("reading a text", () => {
  test("phrasings of one outage read as one concept", () => {
    for (const [first, second] of [
      ["Checkout returns 503", "checkout: service unavailable"],
      ["5xx on payments", "Internal Server Error on payments"],
      ["pod checkout-1 OOMKilled", "checkout exceeded its memory limit"],
      ["too many connections to postgres", "connection pool exhausted"],
      ["request timed out", "context deadline exceeded"],
      ["certificate expired", "TLS handshake failed: x509"],
      ["consumer lag on orders", "orders queue backlog"],
      // A status code said in the plural is still the status code.
      ["Checkout 503s", "checkout: service unavailable"],
      ["a burst of 429s", "rate limited by the provider"],
    ]) {
      const a: MeaningTerms = MeaningMatch.read(first);
      const b: MeaningTerms = MeaningMatch.read(second);
      const shared: Array<string> = Array.from(a.weights.keys()).filter(
        (term: string): boolean => {
          return term.startsWith("#") && b.weights.has(term);
        },
      );

      expect({ first, second, shared: shared.length > 0 }).toEqual({
        first,
        second,
        shared: true,
      });
    }
  });

  test("a concept names itself as a reader would, and is not also its words", () => {
    const read: MeaningTerms = MeaningMatch.read("too many connections");

    expect(Array.from(read.weights.keys())).toEqual(["#connection-exhaustion"]);
    expect(read.labels.get("#connection-exhaustion")).toBe(
      "connection pool exhausted",
    );
  });

  test("stop words, numbers, ids, hashes, addresses and links are left out", () => {
    expect(
      terms(
        "The alert on 10.0.0.12:8080 for pod checkout-7d9f8b6c4-x2k9p (0193c0de-ffff-4aaa-8bbb-000000000001) see https://example.com/runbook?id=42 commit 3f9a2b1c4d5e6f7a8b9c",
      ),
    ).toEqual(["checkout", "commit", "pod", "see"]);
  });

  test("words are cut to a stem, so their forms match", () => {
    expect(MeaningMatch.stem("connections")).toBe(
      MeaningMatch.stem("connected"),
    );
    expect(MeaningMatch.stem("connecting")).toBe(MeaningMatch.stem("connect"));
    expect(MeaningMatch.stem("deployments")).toBe("deploy");
    expect(MeaningMatch.stem("databases")).toBe(MeaningMatch.stem("database"));
    expect(MeaningMatch.stem("services")).toBe(MeaningMatch.stem("service"));
    expect(MeaningMatch.stem("failing")).toBe("fail");
    expect(MeaningMatch.stem("failed")).toBe("fail");
    expect(MeaningMatch.stem("failure")).toBe("fail");
    expect(MeaningMatch.stem("stopped")).toBe("stop");
    expect(MeaningMatch.stem("running")).toBe("run");
    expect(MeaningMatch.stem("dependencies")).toBe("dependency");
    // What has no suffix to take stays as it is.
    expect(MeaningMatch.stem("status")).toBe("status");
    expect(MeaningMatch.stem("api")).toBe("api");
  });

  test("words in other scripts are kept, whole", () => {
    expect(terms("データベース 接続 エラー")).toEqual([
      "エラー",
      "データベース",
      "接続",
    ]);
    expect(terms("ошибка подключения")).toEqual(["ошибка", "подключения"]);
  });

  test("an empty text, or one that says nothing, has no terms", () => {
    expect(MeaningMatch.read("").weights.size).toBe(0);
    expect(MeaningMatch.read(undefined).weights.size).toBe(0);
    expect(MeaningMatch.read(null).weights.size).toBe(0);
    expect(MeaningMatch.read("the alert is on 42").weights.size).toBe(0);
  });

  test("an embedded screenshot is left out, and a long text is read only so far", () => {
    const screenshot: string = `![shot](data:image/png;base64,${"iVBORw0KGgo".repeat(200_000)})`;
    const read: MeaningTerms = MeaningMatch.read(
      `${screenshot} the database ran out of connections`,
    );

    expect(read.weights.has("#database")).toBe(true);
    expect(
      Array.from(read.weights.keys()).some((term: string): boolean => {
        return term.toLowerCase().includes("ivbor");
      }),
    ).toBe(false);

    const beyond: MeaningTerms = MeaningMatch.read(
      `${"filler ".repeat(MAX_TEXT_LENGTH)} kubernetes`,
    );

    expect(beyond.weights.has("kubernet")).toBe(false);
  });

  test("every concept has its own id, a reader's label and a pattern read without the global flag", () => {
    const ids: Set<string> = new Set<string>();

    for (const concept of MEANING_CONCEPTS as Array<MeaningConcept>) {
      expect(concept.id).toMatch(/^[a-z-]+$/);
      expect(ids.has(concept.id)).toBe(false);
      ids.add(concept.id);
      expect(concept.label.length).toBeGreaterThan(2);
      expect(concept.pattern.flags).not.toContain("g");
    }
  });
});

describe("comparing texts", () => {
  test("the same failure in other words matches, and says why", () => {
    const score: MeaningScore = MeaningMatch.compare(
      "Checkout API returning 503 errors",
      "Checkout 5xx. Root cause: the database connection pool ran out after a deploy",
    );

    expect(MeaningMatch.isMatch(score)).toBe(true);
    expect(score.sharedTerms[0]).toBe("server errors (5xx)");
    expect(score.sharedTerms).toContain("checkout");
  });

  test("a record about something else scores nothing", () => {
    const score: MeaningScore = MeaningMatch.compare(
      "Checkout API returning 503 errors",
      "Disk full on db-4. Root cause: logs filled the volume",
    );

    expect(score.similarity).toBe(0);
    expect(score.sharedTerms).toEqual([]);
    expect(MeaningMatch.isMatch(score)).toBe(false);
  });

  test("one shared word is a coincidence, not a match", () => {
    const score: MeaningScore = MeaningMatch.compare(
      "Checkout fails",
      "Checkout pods crash-looping. Root cause: a bad config map",
    );

    expect(score.sharedWordCount).toBe(1);
    expect(score.sharedConceptCount).toBe(0);
    expect(MeaningMatch.isMatch(score)).toBe(false);
  });

  test("two shared words make a match once they are close enough", () => {
    const score: MeaningScore = MeaningMatch.compare(
      "payments gateway refused card authorisations",
      "payments gateway refused authorisations for card holders",
    );

    expect(score.sharedWordCount).toBeGreaterThanOrEqual(2);
    expect(score.similarity).toBeGreaterThanOrEqual(MIN_MEANING_SIMILARITY);
    expect(MeaningMatch.isMatch(score)).toBe(true);
  });

  test("identical texts are the closest there is", () => {
    const score: MeaningScore = MeaningMatch.compare(
      "Login latency is high",
      "Login latency is high",
    );

    expect(score.similarity).toBeCloseTo(1, 5);
  });

  test("a term every record has says less than a rare one", () => {
    const ranked: Array<MeaningScore> = MeaningMatch.rank({
      query: MeaningMatch.read("checkout database timeout"),
      documents: [
        MeaningMatch.read("checkout payments"),
        MeaningMatch.read("checkout orders"),
        MeaningMatch.read("checkout database timeout on orders"),
      ],
    });

    expect(ranked[2]!.similarity).toBeGreaterThan(ranked[0]!.similarity);
    expect(ranked[2]!.similarity).toBeGreaterThan(ranked[1]!.similarity);
    // "checkout" is in every record: it leads no match.
    expect(ranked[2]!.sharedTerms[0]).not.toBe("checkout");
  });

  test("a match names at most a few terms, each once", () => {
    const score: MeaningScore = MeaningMatch.compare(
      "checkout payments orders inventory shipping database timeout latency 503",
      "checkout payments orders inventory shipping database timeout latency 503",
    );

    expect(score.sharedTerms.length).toBe(MAX_SHARED_TERMS);
    expect(new Set(score.sharedTerms).size).toBe(score.sharedTerms.length);
  });

  test("ranks every document in the order given, and the same inputs give the same answer", () => {
    const documents: Array<string> = [
      "Disk full on db-4",
      "Checkout 503s after the deploy",
      "Out of memory on worker",
    ];
    const first: Array<MeaningScore> = MeaningMatch.rank({
      query: MeaningMatch.read("checkout service unavailable after release"),
      documents: documents.map((text: string): MeaningTerms => {
        return MeaningMatch.read(text);
      }),
    });
    const second: Array<MeaningScore> = MeaningMatch.rank({
      query: MeaningMatch.read("checkout service unavailable after release"),
      documents: documents.map((text: string): MeaningTerms => {
        return MeaningMatch.read(text);
      }),
    });

    expect(first).toHaveLength(3);
    expect(first).toEqual(second);
    expect(first[1]!.similarity).toBeGreaterThan(first[0]!.similarity);
    expect(first[1]!.similarity).toBeGreaterThan(first[2]!.similarity);
  });

  test("an empty query or document matches nothing", () => {
    expect(MeaningMatch.compare("", "Disk full").similarity).toBe(0);
    expect(MeaningMatch.compare("Disk full", "").similarity).toBe(0);
    expect(
      MeaningMatch.rank({ query: MeaningMatch.read("x"), documents: [] }),
    ).toEqual([]);
  });
});
