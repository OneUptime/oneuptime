import PromptText from "./PromptText";

/*
 * RECALL BY MEANING (issue #6798).
 *
 * OneUptime AI's memory used to recall a past incident only when it shared
 * a monitor or a label with the one being investigated. The same failure
 * seldom arrives that way: "Checkout returns 503s" on the checkout monitor
 * and "payments: too many connections to Postgres" on another are the same
 * exhausted connection pool, and shared nothing the old match could see.
 *
 * This matches records by what their words say happened. A text is read
 * into terms:
 *
 *   - concepts: the ways an outage is described, each a set of phrasings
 *     ("OOMKilled", "out of memory", "memory limit" are one concept; so are
 *     "503", "5xx" and "service unavailable"). Two records that name the
 *     same concept in different words share it, and a concept weighs more
 *     than a plain word;
 *   - words: what is left, lower case, with the stop words, numbers, ids,
 *     hashes, addresses and links taken out, and cut to a stem
 *     ("connections", "connected" and "connecting" are one word).
 *
 * Records are compared by the cosine of their weighted terms (TF-IDF over
 * the records being compared), so a term every record has says little and
 * a rare one says a lot. A comparison also says which terms the two share,
 * strongest first, so whoever reads the match - OneUptime AI, and the
 * people who read its report - can see why it was made.
 *
 * Why not embeddings and a vector store: every install would need a
 * Postgres extension, and the project's AI provider an embeddings API
 * that not every provider has. This runs anywhere, on the data OneUptime
 * already owns, and the same inputs always give the same answer.
 *
 * Pure: no Node or browser APIs. A text is held to MAX_TEXT_LENGTH after its
 * embedded files are left out (PromptText), so no pattern here ever reads
 * a screenshot's megabytes.
 */

// The most of one text that is read, after its embedded files are left out.
export const MAX_TEXT_LENGTH: number = 4_000;

/*
 * How much a match must have in common: a similarity of at least this, and a
 * concept or at least MIN_SHARED_WORDS words in common.
 */
export const MIN_MEANING_SIMILARITY: number = 0.2;
export const MIN_SHARED_WORDS: number = 2;

// The most shared terms a comparison names.
export const MAX_SHARED_TERMS: number = 4;

// A concept weighs this much more than a word.
const CONCEPT_WEIGHT: number = 2;

// What a concept term starts with, so it can never collide with a word.
const CONCEPT_PREFIX: string = "#";

// The shapes of a word the stemmer and the word filter tell apart.
const LATIN_WORD: RegExp = /^[a-z]+$/;
const LATIN_LETTERS_AND_DIGITS: RegExp = /^[a-z0-9]+$/;
const ONLY_DIGITS: RegExp = /^\p{N}+$/u;
const ANY_DIGIT: RegExp = /\p{N}/gu;
// The consonants a suffix doubles: "stopped" -> "stop", "running" -> "run".
const DOUBLED_CONSONANT: RegExp = /[bcdfgkmnprt]/;

export interface MeaningConcept {
  id: string;
  // How a reader names it, in a "why this matched" line.
  label: string;
  pattern: RegExp;
}

/*
 * The ways an outage is described, each one concept. Read from lower-case
 * text, word-bounded, with no nested quantifiers.
 */
export const MEANING_CONCEPTS: ReadonlyArray<MeaningConcept> = [
  {
    id: "out-of-memory",
    label: "out of memory",
    pattern:
      /\b(oom|oomkill|oomkilled|oom[ -]killed|out[ -]of[ -]memory|outofmemory|outofmemoryerror|memory limit|memory exhausted|memory exhaustion|memory pressure)\b/,
  },
  {
    id: "high-cpu",
    label: "high CPU",
    pattern:
      /\b(high cpu|cpu (usage|load|spike|spikes|saturation|saturated|throttling|throttled|pressure|utili[sz]ation)|cpu is high|cpu at)\b/,
  },
  {
    id: "disk-full",
    label: "disk full",
    pattern:
      /\b(disk (full|space|usage|pressure)|no space left|out of disk|filesystem (full|usage)|volume (full|usage)|inodes?)\b/,
  },
  {
    id: "connection-exhaustion",
    label: "connection pool exhausted",
    pattern:
      /\b((connection|conn|db|database) pool|too many (connections|clients)|max ?connections|pool (exhausted|exhaustion|timeout|full)|connection limit|connections exhausted|connection slots)\b/,
  },
  {
    id: "connection-refused",
    label: "connection refused",
    pattern: /\b(connection refused|econnrefused|refused to connect)\b/,
  },
  {
    id: "connection-reset",
    label: "connection reset",
    pattern:
      /\b(econnreset|connection reset|reset by peer|broken pipe|epipe)\b/,
  },
  {
    id: "timeout",
    label: "timeout",
    pattern:
      /\b(timeout|timeouts|time out|timed out|deadline exceeded|etimedout|504s?)\b/,
  },
  {
    id: "slow",
    label: "slow responses",
    pattern:
      /\b(latency|slow|slowness|slower|slowly|p95|p99|response time|response times|sluggish|lagging)\b/,
  },
  {
    id: "server-errors",
    label: "server errors (5xx)",
    pattern:
      /\b(5\d\ds?|5xxs?|internal server error|server error|server errors|bad gateway|service unavailable)\b/,
  },
  {
    id: "not-found",
    label: "not found (404)",
    pattern: /\b(404s?|not found)\b/,
  },
  {
    id: "rate-limited",
    label: "rate limiting",
    pattern:
      /\b(429s?|rate[ -]?limit|rate[ -]?limited|rate[ -]?limiting|too many requests|quota exceeded|quota exhausted)\b/,
  },
  {
    id: "crash-loop",
    label: "crash or restart loop",
    pattern:
      /\b(crash ?loop|crashloopbackoff|crashloop|crashed|crashes|crashing|crash|restart loop|restarting|keeps restarting|restarted repeatedly|segfault|segmentation fault|panic|panicked|core dumped)\b/,
  },
  {
    id: "deploy",
    label: "deploy or release",
    pattern:
      /\b(deploy|deployed|deploying|deploys|deployment|deployments|release|released|releases|rollout|rollouts|rolled out|new version|upgrade|upgraded|upgrading)\b/,
  },
  {
    id: "rollback",
    label: "rollback",
    pattern:
      /\b(rollback|rollbacks|roll back|rolled back|rolling back|revert|reverted|reverting)\b/,
  },
  {
    id: "certificate",
    label: "TLS certificate",
    pattern: /\b(certificate|certificates|cert|certs|tls|ssl|x509|handshake)\b/,
  },
  {
    id: "dns",
    label: "DNS",
    pattern:
      /\b(dns|nxdomain|servfail|name resolution|could not resolve|unable to resolve|resolve host|no such host)\b/,
  },
  {
    id: "database",
    label: "database",
    pattern:
      /\b(database|databases|db|postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|sql|clickhouse|cassandra|dynamodb|elasticsearch|opensearch)\b/,
  },
  {
    id: "queue-backlog",
    label: "queue backlog",
    pattern:
      /\b(queue (depth|backlog|lag|size|growing|full)|consumer lag|backlog|dead[ -]?letter|dlq)\b/,
  },
  {
    id: "auth",
    label: "authentication or permissions",
    pattern:
      /\b(authentication|authorization|unauthorized|unauthorised|forbidden|401|403|login failure|login failures|invalid token|invalid credentials|expired token|permission denied|access denied)\b/,
  },
  {
    id: "network",
    label: "network",
    pattern:
      /\b(network|packet loss|no route to host|host unreachable|interface down|link down)\b/,
  },
  {
    id: "node-down",
    label: "host or node down",
    pattern:
      /\b(node (down|not ready|notready|failure|failed|unreachable)|host (down|unreachable)|instance (down|terminated|stopped|unhealthy)|server down|vm (down|stopped))\b/,
  },
  {
    id: "memory-growth",
    label: "memory growth or GC",
    pattern:
      /\b(memory leak|leak|leaks|leaking|heap usage|heap growth|heap size|gc pause|gc pressure|gc overhead|garbage collection)\b/,
  },
  {
    id: "configuration",
    label: "configuration",
    pattern:
      /\b(config|configs|configuration|configmap|misconfigured|misconfiguration|environment variable|environment variables|env var|env vars|feature flag|feature flags)\b/,
  },
  {
    id: "expiry",
    label: "expiry",
    pattern: /\b(expired|expiry|expires|expiration|expiring)\b/,
  },
  {
    id: "dependency",
    label: "a dependency",
    pattern:
      /\b(upstream|downstream|dependency|dependencies|third[ -]party|external api|external service)\b/,
  },
  {
    id: "capacity",
    label: "scaling or capacity",
    pattern:
      /\b(autoscale|autoscaler|autoscaling|scaled up|scaled down|scaling|replica|replicas|hpa|capacity)\b/,
  },
  {
    id: "outage",
    label: "outage",
    pattern:
      /\b(outage|is down|went down|offline|not responding|unresponsive)\b/,
  },
];

// Words that say nothing about what happened.
const STOP_WORDS: ReadonlySet<string> = new Set<string>([
  "a",
  "about",
  "after",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "due",
  "during",
  "each",
  "for",
  "from",
  "had",
  "has",
  "have",
  "here",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "may",
  "might",
  "more",
  "most",
  "no",
  "not",
  "of",
  "on",
  "only",
  "or",
  "our",
  "out",
  "over",
  "per",
  "should",
  "so",
  "some",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "under",
  "up",
  "very",
  "via",
  "was",
  "we",
  "were",
  "what",
  "when",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  // Every record is one of these: they tell two records apart by nothing.
  "alert",
  "alerts",
  "incident",
  "incidents",
  "monitor",
  "monitors",
  "issue",
  "issues",
  "problem",
  "problems",
  "detected",
  "triggered",
  "fired",
  "firing",
]);

// A word's stem, where its suffixes would not take it there.
const IRREGULAR_STEMS: ReadonlyMap<string, string> = new Map<string, string>([
  ["failure", "fail"],
  ["failures", "fail"],
  ["unavailable", "unavail"],
  ["availability", "avail"],
]);

export interface MeaningTerms {
  // Each term and its weight: how often it was said, a concept weighing more.
  weights: Map<string, number>;
  // Each term as a reader recognises it: a concept's label, a word as said.
  labels: Map<string, string>;
}

export interface MeaningScore {
  // 0 (nothing in common) to 1 (the same terms, in the same proportions).
  similarity: number;
  // The terms both texts have, strongest first, as a reader recognises them.
  sharedTerms: Array<string>;
  sharedConceptCount: number;
  sharedWordCount: number;
}

export default class MeaningMatch {
  /*
   * A text's terms. Empty for empty text, and for text with nothing in it
   * that says what happened.
   */
  public static read(text: string | null | undefined): MeaningTerms {
    const terms: MeaningTerms = {
      weights: new Map<string, number>(),
      labels: new Map<string, string>(),
    };

    if (!text) {
      return terms;
    }

    let cleaned: string = MeaningMatch.clean(text);

    for (const concept of MEANING_CONCEPTS) {
      const global: RegExp = new RegExp(concept.pattern.source, "g");
      const matches: RegExpMatchArray | null = cleaned.match(global);

      if (!matches || matches.length === 0) {
        continue;
      }

      const term: string = `${CONCEPT_PREFIX}${concept.id}`;
      MeaningMatch.add(terms, term, CONCEPT_WEIGHT * matches.length);
      terms.labels.set(term, concept.label);

      /*
       * What a concept said is the concept's, not words of its own: "too
       * many connections" is the exhausted pool, not also "many".
       */
      cleaned = cleaned.replace(global, " ");
    }

    for (const word of cleaned.split(/[^\p{L}\p{N}]+/u)) {
      if (!MeaningMatch.isMeaningfulWord(word)) {
        continue;
      }

      const stem: string = MeaningMatch.stem(word);

      MeaningMatch.add(terms, stem, 1);

      if (!terms.labels.has(stem)) {
        terms.labels.set(stem, word);
      }
    }

    return terms;
  }

  /*
   * How close each of `documents` is to `query`, in the order given. The
   * weight of a term is how often a text says it, scaled by how rare it is
   * across the query and the documents: compared together, so a term every
   * one of them has says little.
   */
  public static rank(data: {
    query: MeaningTerms;
    documents: Array<MeaningTerms>;
  }): Array<MeaningScore> {
    const all: Array<MeaningTerms> = [data.query, ...data.documents];
    const documentFrequency: Map<string, number> = new Map<string, number>();

    for (const terms of all) {
      for (const term of terms.weights.keys()) {
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
      }
    }

    const inverse: (term: string) => number = (term: string): number => {
      return (
        Math.log((all.length + 1) / ((documentFrequency.get(term) || 0) + 1)) +
        1
      );
    };

    const queryVector: Map<string, number> = MeaningMatch.vector(
      data.query,
      inverse,
    );
    const queryNorm: number = MeaningMatch.norm(queryVector);

    return data.documents.map((document: MeaningTerms): MeaningScore => {
      const documentVector: Map<string, number> = MeaningMatch.vector(
        document,
        inverse,
      );
      const documentNorm: number = MeaningMatch.norm(documentVector);

      const shared: Array<{ term: string; contribution: number }> = [];
      let dot: number = 0;

      for (const [term, weight] of queryVector) {
        const other: number | undefined = documentVector.get(term);

        if (other === undefined) {
          continue;
        }

        dot += weight * other;
        shared.push({ term, contribution: weight * other });
      }

      const similarity: number =
        queryNorm > 0 && documentNorm > 0
          ? Math.min(1, dot / (queryNorm * documentNorm))
          : 0;

      shared.sort(
        (
          a: { term: string; contribution: number },
          b: { term: string; contribution: number },
        ): number => {
          return b.contribution - a.contribution || (a.term < b.term ? -1 : 1);
        },
      );

      const sharedTerms: Array<string> = [];

      for (const { term } of shared) {
        const label: string =
          document.labels.get(term) || data.query.labels.get(term) || term;

        if (!sharedTerms.includes(label)) {
          sharedTerms.push(label);
        }

        if (sharedTerms.length >= MAX_SHARED_TERMS) {
          break;
        }
      }

      const sharedConceptCount: number = shared.filter(
        (item: { term: string }): boolean => {
          return item.term.startsWith(CONCEPT_PREFIX);
        },
      ).length;

      return {
        similarity,
        sharedTerms,
        sharedConceptCount,
        sharedWordCount: shared.length - sharedConceptCount,
      };
    });
  }

  /*
   * Whether a comparison is a match worth naming: close enough, and sharing
   * a concept or more than one word - one shared word ("checkout") is a
   * coincidence, not a recurrence.
   */
  public static isMatch(score: MeaningScore): boolean {
    return (
      score.similarity >= MIN_MEANING_SIMILARITY &&
      (score.sharedConceptCount > 0 ||
        score.sharedWordCount >= MIN_SHARED_WORDS)
    );
  }

  /*
   * One comparison: how close `document` is to `query`, with the two of
   * them as the whole collection.
   */
  public static compare(
    query: string | null | undefined,
    document: string | null | undefined,
  ): MeaningScore {
    return MeaningMatch.rank({
      query: MeaningMatch.read(query),
      documents: [MeaningMatch.read(document)],
    })[0]!;
  }

  // A word's stem: "connections", "connected", "connecting" -> "connect".
  public static stem(word: string): string {
    const irregular: string | undefined = IRREGULAR_STEMS.get(word);

    if (irregular) {
      return irregular;
    }

    // Only Latin words have the suffixes below.
    if (!LATIN_WORD.test(word) || word.length <= 3) {
      return word;
    }

    let stem: string = word;

    if (stem.endsWith("ies") && stem.length > 4) {
      stem = `${stem.slice(0, -3)}y`;
    } else if (
      stem.endsWith("s") &&
      !stem.endsWith("ss") &&
      !stem.endsWith("us") &&
      !stem.endsWith("is")
    ) {
      stem = stem.slice(0, -1);
    }

    for (const suffix of ["ing", "ed"]) {
      if (stem.endsWith(suffix) && stem.length - suffix.length >= 3) {
        stem = MeaningMatch.undouble(stem.slice(0, -suffix.length));
        break;
      }
    }

    for (const suffix of ["ion", "ment", "ness", "ly"]) {
      if (stem.endsWith(suffix) && stem.length - suffix.length >= 4) {
        stem = stem.slice(0, -suffix.length);
        break;
      }
    }

    if (stem.endsWith("e") && stem.length > 4) {
      stem = stem.slice(0, -1);
    }

    return stem;
  }

  /*
   * The text a pattern reads: embedded files left out and held to a length,
   * lower case, with links, ids, addresses and hashes taken out.
   */
  private static clean(text: string): string {
    return PromptText.field(text, { maxLength: MAX_TEXT_LENGTH })
      .toLowerCase()
      .replace(/\b(https?|wss?|ftp):\/\/\S+/g, " ")
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
        " ",
      )
      .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, " ")
      .replace(/\b[0-9a-f]{12,}\b/g, " ")
      .replace(/[_./:\\-]+/g, " ");
  }

  private static isMeaningfulWord(word: string): boolean {
    if (!word || STOP_WORDS.has(word)) {
      return false;
    }

    // A number, or what only a machine reads: "7d9f8b6c4", "x2k9p".
    if (ONLY_DIGITS.test(word)) {
      return false;
    }

    const digits: number = (word.match(ANY_DIGIT) || []).length;

    if (digits > 0 && (digits >= 2 || word.length > 5)) {
      return false;
    }

    // A Latin word of one or two letters says little; a CJK one may say a lot.
    if (LATIN_LETTERS_AND_DIGITS.test(word)) {
      return word.length >= 3;
    }

    return word.length >= 2;
  }

  // "stopp" -> "stop", "runn" -> "run"; "fall", "pass" and "buzz" stay.
  private static undouble(stem: string): string {
    const last: string = stem.charAt(stem.length - 1);

    if (
      stem.length >= 4 &&
      last === stem.charAt(stem.length - 2) &&
      DOUBLED_CONSONANT.test(last)
    ) {
      return stem.slice(0, -1);
    }

    return stem;
  }

  private static add(terms: MeaningTerms, term: string, weight: number): void {
    terms.weights.set(term, (terms.weights.get(term) || 0) + weight);
  }

  private static vector(
    terms: MeaningTerms,
    inverse: (term: string) => number,
  ): Map<string, number> {
    const vector: Map<string, number> = new Map<string, number>();

    for (const [term, weight] of terms.weights) {
      // Saying a word ten times does not make it ten times as telling.
      vector.set(term, (1 + Math.log(weight)) * inverse(term));
    }

    return vector;
  }

  private static norm(vector: Map<string, number>): number {
    let sum: number = 0;

    for (const value of vector.values()) {
      sum += value * value;
    }

    return Math.sqrt(sum);
  }
}
