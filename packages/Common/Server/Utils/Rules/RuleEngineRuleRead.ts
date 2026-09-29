import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import ObjectID from "../../../Types/ObjectID";
import logger, { LogAttributes } from "../Logger";

/*
 * The one thing that makes MAX_RULES_EVALUATED_PER_PROJECT a ceiling rather
 * than a cliff.
 *
 * A rule engine reads a project's enabled rules as `limit: <cap>, skip: 0`
 * and evaluates what comes back. There is no second page, so a project with
 * more rules than the cap has the remainder evaluated by nobody — and the
 * read cannot tell the difference between "that is all of them" and "that is
 * as many as I was allowed to ask for".
 *
 * That gap is the whole of OneUptime/oneuptime#3506. The cap was 100, a
 * project had 1,243 rules, and the 1,143 that never ran produced no log, no
 * error, no counter and no span attribute. It surfaced as a customer noticing
 * that most of a 1,000-monitor import had come out bare, a day later.
 *
 * Raising the cap to 10,000 moves that threshold somewhere projects are very
 * unlikely to reach, but it does not change the shape of the failure: at
 * 10,001 rules the oldest rule goes quiet exactly as before. So the read now
 * says so. Crossing the ceiling is an operator-visible error, not silence.
 *
 * Deliberately not an exception. A project that walks past the ceiling still
 * wants the 10,000 rules that did match to be applied; refusing to label
 * anything would turn a partial evaluation into no evaluation.
 */
export default function logIfRuleReadWasTruncated(data: {
  /** The rule model being read, e.g. "MonitorLabelRule". Names the config to go and look at. */
  ruleKind: string;
  projectId: ObjectID | undefined;
  /** How many rows the read returned. */
  rulesRead: number;
}): boolean {
  if (data.rulesRead < MAX_RULES_EVALUATED_PER_PROJECT) {
    return false;
  }

  logger.error(
    `${data.ruleKind}: this project has at least ${MAX_RULES_EVALUATED_PER_PROJECT} enabled rules, which is the most one evaluation reads. Rules beyond that are NOT being evaluated, and resources they would match will silently go without. Reduce or consolidate the project's ${data.ruleKind} rows.`,
    {
      projectId: data.projectId?.toString(),
    } as LogAttributes,
  );

  return true;
}
