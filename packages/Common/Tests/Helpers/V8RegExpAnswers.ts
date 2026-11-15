/*
 * V8'S OWN ANSWER ABOUT A WRITTEN PATTERN, WHERE V8 CAN GIVE ONE.
 *
 * The PromQL suites hold each label pattern to Prometheus' answer through
 * the linear-time matcher, and hold the JavaScript the pattern is written as
 * to V8's own RegExp too, so a pattern written wrong for JavaScript fails
 * twice. V8 has a bug with modifier groups (PatternFuzzing.ts, issue #8465):
 * in a jest process where LinearRegExpAgreesWithJavaScript.test.ts's random
 * patterns ran first, (?i:a|b) keeps its i for the first alternative only,
 * and does not match "B". Run alone, or in plain Node, V8 answers right.
 *
 * So V8 is asked about a source with a modifier group only where it reads
 * one right in this process; elsewhere its answer would be its bug's, and
 * the expected answer is given back for it. The matcher's own answer, held
 * to Prometheus', is checked either way.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// A modifier group, (?i:, (?-i:, (?i-s:, but not (?: alone.
const MODIFIER_GROUP: RegExp = /\(\?(?:[ims]+(?:-[ims]+)?|-[ims]+):/;

// Whether V8, in this process, reads a modifier group's flag in each alternative.
export const v8ReadsModifierGroups: () => boolean = (): boolean => {
  return new RegExp("(?i:a|b)").test("B") && new RegExp("x(?i:a|b)").test("xB");
};

// Whether V8 cannot be asked about this source in this process.
const v8CannotRead: (source: string) => boolean = (source: string): boolean => {
  return MODIFIER_GROUP.test(source) && !v8ReadsModifierGroups();
};

/*
 * V8's answer to whether the source matches the text; the expected answer
 * where V8 cannot read the source in this process.
 */
export const v8Tests: (data: {
  source: string;
  flags: string;
  text: string;
  expected: boolean;
}) => boolean = (data: {
  source: string;
  flags: string;
  text: string;
  expected: boolean;
}): boolean => {
  if (v8CannotRead(data.source)) {
    return data.expected;
  }

  return new RegExp(data.source, data.flags).test(data.text);
};

/*
 * What each group captured in V8's match, undefined for no match; the
 * expected captures where V8 cannot read the source in this process.
 */
export const v8Captures: (data: {
  source: string;
  flags: string;
  text: string;
  expected: Array<string | undefined> | undefined;
}) => Array<string | undefined> | undefined = (data: {
  source: string;
  flags: string;
  text: string;
  expected: Array<string | undefined> | undefined;
}): Array<string | undefined> | undefined => {
  if (v8CannotRead(data.source)) {
    return data.expected;
  }

  return new RegExp(data.source, data.flags).exec(data.text)?.slice(1);
};
