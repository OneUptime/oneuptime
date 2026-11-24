import {
  DATA_STORE_FINDING_VERDICT_LIMITS,
  DATA_STORE_FINDING_VERDICT_VERSION,
  DATA_STORE_FINDING_VERDICTS,
  DataStoreFindingDecision,
  DataStoreFindingPrecedent,
  DataStoreFindingVerdict,
  DataStoreFindingVerdictRecord,
  FindingWrongMatchSign,
} from "../../../../Types/DataSecurity/DataStoreFindingVerdict";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import DataSecurityAiInput, {
  AiFindingToJudge,
  AiStoreRecord,
  DataSecurityAiPrompt,
} from "./DataSecurityAiInput";
import { getAnalysisLanguageName } from "./DataSecurityIssuePrompt";
import {
  readStrictAnswer,
  StrictAnswer,
  StrictList,
  StrictNullable,
  StrictObject,
  StrictOptional,
  StrictText,
  StrictValue,
} from "./StrictAnswer";

/*
 * WHAT ONEUPTIME AI IS ASKED ABOUT THE FINDINGS THAT WAIT FOR A PERSON, AND
 * HOW ITS ANSWER IS HELD TO WHAT IT WAS TOLD (#10372).
 *
 * The prompt is one JSON value of data under a system message that holds
 * every instruction (DataSecurityAiInput.buildJudgeFindingsPrompt): the
 * store, and each finding by a reference (F1, F2...) with its facts, its
 * signs of a wrong match and its precedent - the team's earlier decisions
 * on findings like it, each by a reference of its own (P1, P2...). Never a
 * value.
 *
 * The answer is read strictly (StrictAnswer): one verdict of the three per
 * finding, a reason, the precedent it rests on, and for Not sensitive the
 * reason a person could give. Then it is held to what it was told
 * (holdFindingVerdictToFacts), as plain code, never on OneUptime AI's
 * word:
 *
 *   - it cites only the precedent it was given for that finding, and only
 *     what agrees with it: Not sensitive cites marks of not sensitive,
 *     Confirm cites confirmations;
 *   - a Confirm or a Not sensitive with no reason is no verdict: Cannot
 *     tell;
 *   - the reason a person could give is drafted for Not sensitive only, and
 *     when OneUptime AI wrote none, the reason the team gave on a finding
 *     it cites stands in - the team's own words before OneUptime AI's.
 *
 * Whether a Confirm may be applied on its own is decided after, and more
 * strictly (canConfirmOnItsOwn): only on the team's own confirmation of a
 * finding like it, or a field whose name says it holds the type.
 */

// The most findings asked about in one call, and the most calls in one store's run.
export const MAX_FINDINGS_PER_VERDICT_REQUEST: number = 20;
export const MAX_VERDICT_REQUESTS_PER_RUN: number = 2;

// How the call asks: low, so the same facts get the same verdict.
export const FINDING_VERDICT_MAX_TOKENS: number = 4000;
export const FINDING_VERDICT_TEMPERATURE: number = 0;
export const FINDING_VERDICT_TIMEOUT_IN_MS: number = 90 * 1000;

// The prefix of a finding's reference in a request: F1, F2...
const FINDING_REFERENCE_PREFIX: string = "F";
// ...and of a precedent's within it: P1, P2...
const PRECEDENT_REFERENCE_PREFIX: string = "P";

const MAX_ANSWER_TEXT_LENGTH: number = 800;

export function getFindingReference(index: number): string {
  return `${FINDING_REFERENCE_PREFIX}${index + 1}`;
}

export function getPrecedentReference(index: number): string {
  return `${PRECEDENT_REFERENCE_PREFIX}${index + 1}`;
}

/*
 * What OneUptime AI is asked, in OneUptime's words: the three verdicts, how
 * to weigh the team's decisions and the signs, and how to write the reason
 * in the project's language.
 */
export function getFindingVerdictInstructions(language: string): string {
  const languageName: string = getAnalysisLanguageName(language);
  const maxLength: number =
    DATA_STORE_FINDING_VERDICT_LIMITS.maxReasonLength - 100;

  return [
    "You are OneUptime's data security analyst. OneUptime Data Security's scan found the findings below in one of the team's data stores, and each waits for a person to confirm it holds that kind of data, or to mark it not sensitive. The user message holds each finding's facts, each by a ref (F1, F2...), and the team's own earlier decisions on findings like it - its precedent, each by a ref (P1, P2...).",
    "",
    "For each finding, give one verdict:",
    '- "Confirm": the field really holds this kind of data, and a person should confirm it.',
    '- "NotSensitive": what the scan found there is not that kind of data - such as order numbers that happen to pass a card number\'s checksum, test values, or a field named for something else - and a person should mark it not sensitive.',
    '- "CannotTell": the facts and the precedent do not say.',
    "",
    "How to judge:",
    "- The team's own decisions are the strongest evidence. When precedent found by the same field name agrees, follow it, and say so. When the precedent disagrees with itself, answer \"CannotTell\" unless the finding's own facts settle it.",
    "- Precedent found by a name like it is weaker evidence than precedent found by the same field name.",
    "- signsOfAWrongMatch are signs the scan matched wrongly: most matches were well-known test values; the field's name points at another data type; an id field holds numbers that pass the Luhn check, which one in ten of any digits does.",
    "- A Low finding is one the scan was not sure of. A finding suggestedByOneUptimeAi was named only from its field's name and the shapes of its values.",
    '- Answer "NotSensitive" for a secret, a password, a key or a token only when precedent for the same field name marks it not sensitive.',
    "",
    `Write reason as one or two plain sentences of at most ${maxLength} characters, in ${languageName}: what the verdict rests on, in words a person reads in a list - such as "Your team marked order_number not sensitive on 4 stores, and it is named like an order number." No Markdown, and no refs in the text.`,
    "precedent lists the refs of that finding's precedent the verdict rests on, and only those that agree with it; [] when none does.",
    `draft: for "NotSensitive" only, the reason a person would give for marking it not sensitive, in one sentence in ${languageName}; otherwise null.`,
    "",
    "Answer with JSON only, no other text, in this form:",
    '{"findings":[{"ref":"F1","verdict":"NotSensitive","reason":"...","precedent":["P1","P2"],"draft":"..."}]}',
    "Answer for every finding, by its ref.",
  ].join("\n");
}

/*
 * The prompt: the store, and at most MAX_FINDINGS_PER_VERDICT_REQUEST
 * findings, each with its precedent, in the project's language.
 */
export function buildFindingVerdictPrompt(data: {
  store: AiStoreRecord;
  findings: ReadonlyArray<AiFindingToJudge>;
  language: string;
  dataTypeNamer?: DataTypeNamer | undefined;
}): DataSecurityAiPrompt {
  return DataSecurityAiInput.buildJudgeFindingsPrompt({
    instructions: getFindingVerdictInstructions(data.language),
    store: data.store,
    findings: data.findings.slice(0, MAX_FINDINGS_PER_VERDICT_REQUEST),
    dataTypeNamer: data.dataTypeNamer,
  });
}

type VerdictAnswerShape = StrictObject<{
  ref: StrictText;
  verdict: StrictText;
  reason: StrictOptional<StrictNullable<StrictText>>;
  precedent: StrictOptional<StrictNullable<StrictList<StrictText>>>;
  draft: StrictOptional<StrictNullable<StrictText>>;
}>;

export const FINDING_VERDICT_ANSWER: StrictObject<{
  findings: StrictList<VerdictAnswerShape>;
}> = StrictAnswer.object({
  findings: StrictAnswer.list(
    StrictAnswer.object({
      ref: StrictAnswer.text({ maxLength: 20, whenTooLong: "refuse" }),
      verdict: StrictAnswer.text({
        maxLength: 40,
        whenTooLong: "refuse",
        isOneLine: true,
        oneOf: DATA_STORE_FINDING_VERDICTS,
      }),
      reason: StrictAnswer.optional(
        StrictAnswer.nullable(
          StrictAnswer.text({
            maxLength: MAX_ANSWER_TEXT_LENGTH,
            isOneLine: true,
          }),
        ),
      ),
      precedent: StrictAnswer.optional(
        StrictAnswer.nullable(
          StrictAnswer.list(
            StrictAnswer.text({
              maxLength: 12,
              whenTooLong: "refuse",
              isOneLine: true,
            }),
            { maxItems: DATA_STORE_FINDING_VERDICT_LIMITS.maxPrecedent * 2 },
          ),
        ),
      ),
      draft: StrictAnswer.optional(
        StrictAnswer.nullable(
          StrictAnswer.text({
            maxLength: MAX_ANSWER_TEXT_LENGTH,
            isOneLine: true,
          }),
        ),
      ),
    }),
    // A model may answer a finding twice; past twice the findings asked, nothing is read.
    { maxItems: MAX_FINDINGS_PER_VERDICT_REQUEST * 2 },
  ),
});

// One finding's answer, as read: before it is held to its facts.
export interface FindingVerdictAnswer {
  verdict: DataStoreFindingVerdict;
  reason: string;
  precedentRefs: Array<string>;
  draft: string;
}

/*
 * The answer, by finding reference: only the references asked about, each
 * once. Null when the answer is not the JSON object asked for. Shared by
 * the run and the eval, so a score measures what ships.
 */
export function parseFindingVerdictResponse(data: {
  content: string | null | undefined;
  references: ReadonlySet<string>;
}): Map<string, FindingVerdictAnswer> | null {
  const answer: StrictValue<typeof FINDING_VERDICT_ANSWER> | null =
    readStrictAnswer(data.content, FINDING_VERDICT_ANSWER);

  if (!answer) {
    return null;
  }

  const answers: Map<string, FindingVerdictAnswer> = new Map();

  for (const finding of answer.findings) {
    if (!data.references.has(finding.ref) || answers.has(finding.ref)) {
      continue;
    }

    answers.set(finding.ref, {
      verdict: finding.verdict as DataStoreFindingVerdict,
      reason: finding.reason || "",
      precedentRefs: [...(finding.precedent || [])],
      draft: finding.draft || "",
    });
  }

  return answers;
}

// The decision a verdict's precedent must have made to agree with it.
function agreeingDecision(
  verdict: DataStoreFindingVerdict,
): DataStoreFindingDecision | null {
  if (verdict === DataStoreFindingVerdict.NotSensitive) {
    return DataStoreFindingDecision.NotSensitive;
  }

  if (verdict === DataStoreFindingVerdict.Confirm) {
    return DataStoreFindingDecision.Confirmed;
  }

  return null;
}

/*
 * One finding's answer, held to what OneUptime AI was told about it (see
 * the module comment): the precedent it was given, by its references in
 * order (P1 is the first), and its signs.
 */
export function holdFindingVerdictToFacts(data: {
  answer: FindingVerdictAnswer;
  precedent: ReadonlyArray<DataStoreFindingPrecedent>;
  signs: ReadonlyArray<FindingWrongMatchSign>;
  language: string;
  now: Date;
}): DataStoreFindingVerdictRecord {
  const limits: typeof DATA_STORE_FINDING_VERDICT_LIMITS =
    DATA_STORE_FINDING_VERDICT_LIMITS;
  const reason: string = data.answer.reason
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limits.maxReasonLength);
  let verdict: DataStoreFindingVerdict = data.answer.verdict;

  // A verdict that says nothing of why is none.
  if (verdict !== DataStoreFindingVerdict.CannotTell && !reason) {
    verdict = DataStoreFindingVerdict.CannotTell;
  }

  const agreeing: DataStoreFindingDecision | null = agreeingDecision(verdict);
  const cited: Array<DataStoreFindingPrecedent> = [];
  const seen: Set<string> = new Set();

  for (const ref of data.answer.precedentRefs) {
    const match: RegExpMatchArray | null = /^P(\d{1,2})$/.exec(ref.trim());
    const index: number = match ? Number(match[1]) - 1 : -1;
    const entry: DataStoreFindingPrecedent | undefined =
      index >= 0 ? data.precedent[index] : undefined;

    if (!entry || seen.has(entry.findingId)) {
      continue;
    }

    // Confirm and Not sensitive cite only what agrees; Cannot tell, what it weighed.
    if (agreeing && entry.decision !== agreeing) {
      continue;
    }

    seen.add(entry.findingId);
    cited.push(entry);
  }

  let draft: string = "";

  if (verdict === DataStoreFindingVerdict.NotSensitive) {
    const teamsOwn: DataStoreFindingPrecedent | undefined = cited.find(
      (entry: DataStoreFindingPrecedent): boolean => {
        return entry.reason.length > 0;
      },
    );

    draft = (
      data.answer.draft.replace(/\s+/g, " ").trim() ||
      teamsOwn?.reason ||
      reason
    ).slice(0, limits.maxReasonLength);
  }

  return {
    version: DATA_STORE_FINDING_VERDICT_VERSION,
    verdict,
    reason,
    draft,
    precedent: cited.slice(0, limits.maxPrecedent),
    signs: [...data.signs],
    language: data.language,
    writtenAt: data.now.toISOString(),
  };
}

/*
 * Whether OneUptime AI may confirm a finding on its own, where an AI rule
 * sets Judge to Without asking: only a Confirm that rests on the team's own
 * confirmation of a finding like it, or on a field whose name says it holds
 * the type. Anything else waits on the finding's row for a person.
 */
export function canConfirmOnItsOwn(data: {
  record: DataStoreFindingVerdictRecord;
  isNameHinted: boolean;
}): boolean {
  if (data.record.verdict !== DataStoreFindingVerdict.Confirm) {
    return false;
  }

  return (
    data.isNameHinted ||
    data.record.precedent.some((entry: DataStoreFindingPrecedent): boolean => {
      return entry.decision === DataStoreFindingDecision.Confirmed;
    })
  );
}
