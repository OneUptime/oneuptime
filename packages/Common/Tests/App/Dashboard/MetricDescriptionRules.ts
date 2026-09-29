import { expect } from "@jest/globals";

/*
 * The rules every metric explanation in the dashboard is held to - the text
 * a customer reads in the (i) tooltip beside a tile, chart or column title.
 * Shared by the per-resource tests and by MetricDescriptionsCatalog.test.ts,
 * which applies them to every module under
 * App/FeatureSet/Dashboard/src/Components/MetricDescriptions.
 *
 * Not a test file itself (no .test. in the name), so jest does not run it.
 */

export const MIN_DESCRIPTION_LENGTH: number = 25;
// A tooltip is 350px wide; past ~340 characters it stops being "small".
export const MAX_DESCRIPTION_LENGTH: number = 340;

/*
 * Words that give away a placeholder or an unfinished sentence rather than
 * an explanation.
 */
const PLACEHOLDER_PATTERN: RegExp = /\b(TODO|TBD|FIXME|lorem|ipsum|XXX)\b/i;
const DOUBLE_SPACE_PATTERN: RegExp = /\s{2,}/;
const SENTENCE_END_PATTERN: RegExp = /[.!?)"']$/;
// A sentence, or a percentile token such as "p95 means ...".
const SENTENCE_START_PATTERN: RegExp = /^(p\d{2}\b|[A-Z0-9"'(])/;
const LEAKED_VALUE_PATTERN: RegExp =
  /\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]/;

/*
 * A percentile named in the text has to be explained in the same text - the
 * whole point of the tooltip is that "p95" means nothing to most readers.
 */
const PERCENTILE_EXPLANATIONS: Array<{
  token: RegExp;
  explained: RegExp;
  name: string;
}> = [
  {
    token: /\bp50\b/i,
    explained: /(50%|half|median|typical)/i,
    name: "p50",
  },
  {
    token: /\bp75\b/i,
    explained: /(75%|75th)/,
    name: "p75",
  },
  {
    token: /\bp90\b/i,
    explained: /(90%|90th)/,
    name: "p90",
  },
  {
    token: /\bp95\b/i,
    explained: /(95%|95th)/,
    name: "p95",
  },
  {
    token: /\bp99\b/i,
    explained: /(99%|99th)/,
    name: "p99",
  },
];

export function metricDescriptionProblems(text: unknown): Array<string> {
  const problems: Array<string> = [];

  if (typeof text !== "string") {
    return [`is not a string (${typeof text})`];
  }

  if (text !== text.trim()) {
    problems.push("has leading or trailing whitespace");
  }

  if (text.length < MIN_DESCRIPTION_LENGTH) {
    problems.push(`is too short to explain anything (${text.length} chars)`);
  }

  if (text.length > MAX_DESCRIPTION_LENGTH) {
    problems.push(
      `is too long for a small tooltip (${text.length} > ${MAX_DESCRIPTION_LENGTH} chars)`,
    );
  }

  if (DOUBLE_SPACE_PATTERN.test(text)) {
    problems.push("contains a double space or a line break");
  }

  if (!SENTENCE_END_PATTERN.test(text.trim())) {
    problems.push("does not end like a sentence");
  }

  if (!SENTENCE_START_PATTERN.test(text.trim())) {
    problems.push("does not start like a sentence");
  }

  if (PLACEHOLDER_PATTERN.test(text)) {
    problems.push("contains placeholder text");
  }

  if (LEAKED_VALUE_PATTERN.test(text)) {
    problems.push("contains a leaked programming value");
  }

  for (const percentile of PERCENTILE_EXPLANATIONS) {
    if (percentile.token.test(text) && !percentile.explained.test(text)) {
      problems.push(`names ${percentile.name} without explaining it`);
    }
  }

  return problems;
}

export function expectReadableMetricDescription(
  text: unknown,
  context: string,
): void {
  expect({ context, problems: metricDescriptionProblems(text) }).toEqual({
    context,
    problems: [],
  });
}

/*
 * Every value of a description record passes the rules, and no two metrics
 * on one page borrow the same words.
 */
export function expectReadableDescriptionRecord(
  record: Record<string, unknown>,
  context: string,
): void {
  const entries: Array<[string, unknown]> = Object.entries(record);

  expect(entries.length).toBeGreaterThan(0);

  for (const [key, text] of entries) {
    expectReadableMetricDescription(text, `${context}.${key}`);
  }

  const seen: Map<string, string> = new Map<string, string>();
  const duplicates: Array<string> = [];

  for (const [key, text] of entries) {
    const previous: string | undefined = seen.get(String(text));

    if (previous) {
      duplicates.push(`${context}.${key} repeats ${context}.${previous}`);
    } else {
      seen.set(String(text), key);
    }
  }

  expect(duplicates).toEqual([]);
}

/*
 * A title that names a percentile gets a description that explains it -
 * the tile "p95 duration" cannot be explained by "How long requests took."
 */
export function expectTitleExplained(title: string, text: string): void {
  for (const percentile of PERCENTILE_EXPLANATIONS) {
    if (percentile.token.test(title)) {
      expect({ title, explains: percentile.explained.test(text) }).toEqual({
        title,
        explains: true,
      });
    }
  }
}
