import { CODE_TASK_LIMITS } from "../../../../Types/AI/CodeTask";
import {
  DataSecurityIssueGroupFacts,
  DataSecurityIssueGroupNameAnswer,
  DataSecurityIssueGroupNameFact,
  MAX_ISSUE_GROUP_NAME_LENGTH,
  describeIssueGroupCause,
} from "../../../../Types/DataSecurity/DataSecurityIssueGroup";
import DataSecurityAiInput, {
  AiGroupFixStore,
  DataSecurityAiCodeRequest,
  DataSecurityAiPrompt,
} from "./DataSecurityAiInput";
import { getAnalysisLanguageName } from "./DataSecurityIssuePrompt";
import {
  readStrictAnswer,
  StrictAnswer,
  StrictList,
  StrictObject,
  StrictText,
  StrictValue,
} from "./StrictAnswer";

/*
 * WHAT ONEUPTIME AI IS ASKED ABOUT A GROUP OF ISSUES ONE MISTAKE MADE
 * (#10370): ITS NAME, AND THE PULL REQUEST THAT FIXES ITS CAUSE ONCE.
 *
 * The facts decide a group; OneUptime AI only names it, in a phrase that
 * completes "40 issues, one cause: ...", from those facts alone - held to
 * them after (holdIssueGroupNameToFacts). The fix asks the coding agent to
 * change the module's default or the shared setting every store gets,
 * rather than forty resources, and to say which stores and issues it fixes.
 *
 * This file holds what each is asked, in OneUptime's own words; every fact
 * is the builder's (DataSecurityAiInput).
 */

/*
 * How the name is asked: one short JSON object, low temperature so the
 * same facts get the same name. The eval asks the same.
 */
export const DATA_SECURITY_ISSUE_GROUP_NAME_MAX_TOKENS: number = 300;
export const DATA_SECURITY_ISSUE_GROUP_NAME_TEMPERATURE: number = 0.2;

// The longest name the instructions ask for: room under what is kept.
const ASKED_NAME_LENGTH: number = MAX_ISSUE_GROUP_NAME_LENGTH - 40;

/*
 * What naming a group is asked, in OneUptime's words: what the name is
 * for, how to write it and in which language, and that it names its facts.
 */
export function getIssueGroupNamerInstructions(language: string): string {
  const languageName: string = getAnalysisLanguageName(language);

  return [
    "You are OneUptime's data security analyst. OneUptime Data Security grouped issues of one check whose stores share what made them, so the cause can be fixed once. The user message holds the facts the group rests on, each with an id: what made the stores (F1), what the check says is wrong (F2), and what the stores are.",
    `Name the group and its cause in one short phrase that completes the sentence "40 issues, one cause: ...", such as "the static-site module turns off access logs" or "buckets named *-exports-* leave Block Public Access off". Say what made the stores and what it does wrong, from the facts alone.`,
    `Write it in ${languageName}, in lower case where the language allows, as one plain phrase of at most ${ASKED_NAME_LENGTH} characters: no Markdown, no links, no quotes, no full stop and no fact ids in the text.`,
    "Name modules, stacks, tags, identities, patterns and repositories exactly as the facts write them, and copy numbers exactly. Never name one of the stores, and never invent a fact.",
    'Answer with JSON only, exactly: {"name": "...", "facts": ["F1", "F2"]} - facts lists the ids of the facts the name rests on, F1 among them.',
  ].join("\n");
}

// The group's name prompt: the instructions, and its facts as data.
export function buildIssueGroupNamePrompt(data: {
  facts: ReadonlyArray<DataSecurityIssueGroupNameFact>;
  language: string;
}): DataSecurityAiPrompt {
  return DataSecurityAiInput.buildNameIssueGroupPrompt({
    instructions: getIssueGroupNamerInstructions(data.language),
    facts: data.facts,
  });
}

/*
 * The name's answer, exactly as it is asked for: the name, and the ids of
 * the facts it rests on. Anything else is no answer (StrictAnswer).
 */
export const ISSUE_GROUP_NAME_ANSWER: StrictObject<{
  name: StrictText;
  facts: StrictList<StrictText>;
}> = StrictAnswer.object({
  name: StrictAnswer.text({
    maxLength: MAX_ISSUE_GROUP_NAME_LENGTH * 2,
    whenTooLong: "refuse",
    isOneLine: true,
  }),
  facts: StrictAnswer.list(
    StrictAnswer.text({
      maxLength: 12,
      whenTooLong: "refuse",
      isOneLine: true,
    }),
    { maxItems: 10 },
  ),
});

/*
 * OneUptime AI's answer as the naming reads it - before it is held to its
 * facts - or null: not one JSON object of the shape asked for. Shared with
 * the eval, so a score measures what ships.
 */
export function readIssueGroupNameAnswer(
  content: string | null | undefined,
): DataSecurityIssueGroupNameAnswer | null {
  const answer: StrictValue<typeof ISSUE_GROUP_NAME_ANSWER> | null =
    readStrictAnswer(content, ISSUE_GROUP_NAME_ANSWER);

  if (!answer) {
    return null;
  }

  return { name: answer.name, facts: answer.facts };
}

/*
 * What the group's fix asks the coding agent: one change, in the code that
 * declares every store of the group, that makes the check pass for each of
 * them - the module's default, a shared variable, the stack's template -
 * never forty resources edited one by one; and a pull request whose
 * description lists the stores and issues it fixes.
 */
export function getIssueGroupFixInstruction(
  facts: DataSecurityIssueGroupFacts,
): string {
  const cause: string = describeIssueGroupCause(facts);
  const where: string = facts.code
    ? `in the ${facts.code.codeKind} code that declares them${
        facts.code.paths.length > 0 ? ` (${facts.code.paths.join(", ")})` : ""
      }`
    : facts.managedAsCode
      ? `in the ${facts.managedAsCode} code that declares them: find it by the stores' names, tags and ids below`
      : "in the infrastructure code that declares them: find it by the stores' names, tags and ids below";

  return [
    `Fix the cause of these Data Security issues once. Every store below fails the same check, and they share one cause: ${cause}. Make one change ${where} that makes the check pass for every one of them.`,
    "Change what they all take: the module's default, a variable or setting the module or stack shares, or its template. Do not add or edit a resource for each store, and change nothing that does not fail this check. If the setting already comes from a variable the stores pass, set it where each environment of theirs sets it.",
    "If the stores are not all declared in the same place, fix the place that declares most of them and say which stores are left.",
    "Open one pull request. In its description, list the stores and issues it fixes, as the data below names them.",
  ].join("\n");
}

/*
 * The most a group's request holds: what Code takes in a request
 * (CodeTaskRuns.readMessage), so the request reads the same in Code as the
 * agent reads it.
 */
export const MAX_GROUP_FIX_REQUEST_LENGTH: number =
  CODE_TASK_LIMITS.maxMessageLength;

/*
 * The group's fix request: the instruction, then the group as data -
 * what its stores share, the check, and each store with its issue - held
 * to MAX_GROUP_FIX_REQUEST_LENGTH (DataSecurityAiInput.buildFixIssueGroupRequest).
 */
export function buildIssueGroupFixRequest(data: {
  facts: DataSecurityIssueGroupFacts;
  stores: ReadonlyArray<AiGroupFixStore>;
}): DataSecurityAiCodeRequest {
  return DataSecurityAiInput.buildFixIssueGroupRequest({
    instruction: getIssueGroupFixInstruction(data.facts),
    facts: data.facts,
    stores: data.stores,
    maxLength: MAX_GROUP_FIX_REQUEST_LENGTH,
  });
}
