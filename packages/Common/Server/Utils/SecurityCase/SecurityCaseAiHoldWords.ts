import OneUptimeDate from "../../../Types/Date";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionStatus,
  SecurityCaseHandOffReason,
} from "../../../Types/SecurityCase/SecurityCaseAi";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import {
  SECURITY_CASE_AI_HOLD_ATTACK_WINDOW_IN_MINUTES,
  SecurityCaseAiHoldOutcome,
} from "../../../Types/SecurityCase/SecurityCaseAiHold";
import {
  SECURITY_CASE_AI_ACTION_TITLES,
  SECURITY_CASE_HAND_OFF_SENTENCES,
} from "../../../Types/SecurityCase/SecurityCaseAiWords";
import { createTranslator } from "../../../Types/Translator";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * WHAT PEOPLE AND CHANNELS ARE TOLD WHEN ONEUPTIME AI'S HOLD OF A CASE ENDS
 * (#10353), in the English every case notice and channel post is written in
 * (SecurityCaseNotifications):
 *
 *   - resolved, nobody alerted: one summary for the case's channels -
 *     "OneUptime AI contained SEC-12 in 1m 52s, so nobody was alerted.",
 *     then what was done: "Blocked 35.205.11.131 at Cloudflare for 24
 *     hours.", "Nothing reached the app: OneUptime saw every request turned
 *     away.";
 *   - people alerted: why now - "OneUptime AI responded first and is
 *     waiting for approval to contain the account k.morgan." - and what it
 *     already did: "Took the case. Blocked 35.205.11.131 for 24 hours."
 *
 * Built only from OneUptime's own records of the case: its log of what
 * OneUptime AI did (SecurityCaseAiAction, made from the Response Plan built
 * without the triage's report), its blocks, its step checks, its own
 * fields. Never from the triage's report, which is for the case's readers
 * alone, and channels are read by others (SubjectReadersOnlyGuard). The
 * case's values - an address, a user, a host - are placed as text: they
 * can be an attacker's own input.
 */

const ENGLISH: ReturnType<typeof createTranslator> = createTranslator(
  undefined,
  "en",
);

// One of OneUptime AI's actions on the case, as its log keeps it.
export interface SecurityCaseAiHoldAction {
  kind: SecurityCaseAiActionKind;
  status: SecurityCaseAiActionStatus;
  target?: string | undefined;
  verdict?: string | undefined;
}

// A block the case made, as the summary says it.
export interface SecurityCaseAiHoldBlock {
  value: string;
  createdAt?: Date | undefined;
  // Null: it stays until someone lifts it.
  expiresAt?: Date | null | undefined;
}

/*
 * What OneUptime AI waits for a person's approval to do, as the end of
 * "waiting for approval to ...". Values in {{braces}}, placed as text.
 */
const ASK_PHRASES: Readonly<Record<SecurityCaseAiActionKind, string>> = {
  [SecurityCaseAiActionKind.TakeCase]: "take the case",
  [SecurityCaseAiActionKind.SetPriority]: "raise the case's priority",
  [SecurityCaseAiActionKind.MarkStepDone]: "mark a step done",
  [SecurityCaseAiActionKind.MarkContained]: "move the case to Contained",
  [SecurityCaseAiActionKind.BlockAddress]: "block {{value}} for 24 hours",
  [SecurityCaseAiActionKind.ContainAccount]: "contain the account {{value}}",
  [SecurityCaseAiActionKind.ContainHost]: "contain the host {{value}}",
  [SecurityCaseAiActionKind.DeclareIncident]: "declare an incident",
  [SecurityCaseAiActionKind.RequestCodeFix]:
    "have Fix With AI open a pull request",
  [SecurityCaseAiActionKind.CloseCase]: "close the case as {{verdict}}",
  [SecurityCaseAiActionKind.LiftBlock]: "lift the case's blocks",
  [SecurityCaseAiActionKind.OfferRuleException]:
    "add an exception to the case's rule",
  [SecurityCaseAiActionKind.StepForPeople]: "do a step",
  [SecurityCaseAiActionKind.HandToPeople]: "hand the case over",
};

// The actions that are no step of OneUptime AI's own to report.
const NOT_REPORTED: ReadonlyArray<SecurityCaseAiActionKind> = [
  SecurityCaseAiActionKind.StepForPeople,
  SecurityCaseAiActionKind.HandToPeople,
];

function fill(template: string, action: SecurityCaseAiHoldAction): string {
  return ENGLISH.translateTemplate(template, {
    value: action.target || "",
    verdict: action.verdict || "",
  });
}

// "a, b and c".
export function joinWithAnd(items: ReadonlyArray<string>): string {
  if (items.length <= 1) {
    return items[0] || "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/*
 * What OneUptime AI already did on the case, each its log's title:
 * "Took the case", "Blocked 35.205.11.131 for 24 hours".
 */
export function describeAiHoldDone(
  actions: ReadonlyArray<SecurityCaseAiHoldAction>,
): Array<string> {
  return actions
    .filter((action: SecurityCaseAiHoldAction): boolean => {
      return (
        action.status === SecurityCaseAiActionStatus.Done &&
        !NOT_REPORTED.includes(action.kind)
      );
    })
    .map((action: SecurityCaseAiHoldAction): string => {
      return fill(SECURITY_CASE_AI_ACTION_TITLES[action.kind].done, action);
    });
}

/*
 * What OneUptime AI waits for a person's approval to do, as one phrase:
 * "block 35.205.11.131 for 24 hours and contain the account k.morgan".
 * Empty when it waits for nothing.
 */
export function describeAiHoldAsked(
  actions: ReadonlyArray<SecurityCaseAiHoldAction>,
): string {
  return joinWithAnd(
    actions
      .filter((action: SecurityCaseAiHoldAction): boolean => {
        return action.status === SecurityCaseAiActionStatus.Asked;
      })
      .map((action: SecurityCaseAiHoldAction): string => {
        return fill(ASK_PHRASES[action.kind], action);
      }),
  );
}

/*
 * How long something took, as the summary says it: "52s", "1m 52s",
 * "2h 5m".
 */
export function describeAiHoldDuration(ms: number): string {
  const seconds: number = Math.max(0, Math.round(ms / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes: number = Math.floor(seconds / 60);

  if (minutes < 60) {
    const rest: number = seconds % 60;
    return rest > 0 ? `${minutes}m${NO_BREAK_SPACE}${rest}s` : `${minutes}m`;
  }

  const hours: number = Math.floor(minutes / 60);
  const restMinutes: number = minutes % 60;

  return restMinutes > 0
    ? `${hours}h${NO_BREAK_SPACE}${restMinutes}m`
    : `${hours}h`;
}

// "24 hours", "1 hour", "30 minutes": how long a block lasts.
export function describeBlockLength(ms: number): string {
  const minutes: number = Math.max(1, Math.round(ms / 60000));

  if (minutes < 60) {
    return `${minutes}${NO_BREAK_SPACE}${minutes === 1 ? "minute" : "minutes"}`;
  }

  const hours: number = Math.round(minutes / 60);

  if (hours < 48) {
    return `${hours}${NO_BREAK_SPACE}${hours === 1 ? "hour" : "hours"}`;
  }

  const days: number = Math.round(hours / 24);

  return `${days}${NO_BREAK_SPACE}days`;
}

/*
 * "Blocked 35.205.11.131 at Cloudflare for 24 hours.": a block the case
 * made, where it is enforced, and for how long.
 */
export function describeAiHoldBlock(data: {
  block: SecurityCaseAiHoldBlock;
  destinations: ReadonlyArray<string>;
}): string {
  const at: string =
    data.destinations.length > 0 ? ` at ${joinWithAnd(data.destinations)}` : "";
  const length: string =
    data.block.expiresAt && data.block.createdAt
      ? ` for ${describeBlockLength(
          new Date(data.block.expiresAt).getTime() -
            new Date(data.block.createdAt).getTime(),
        )}`
      : data.block.expiresAt === null
        ? " until someone lifts it"
        : "";

  return `Blocked ${data.block.value}${at}${length}.`;
}

/*
 * Why people are alerted now, in a sentence or two - what a held case's
 * notice and channel post say first.
 */
export function describeAiHoldEnd(data: {
  outcome: SecurityCaseAiHoldOutcome;
  aiName: string;
  // OneUptime AI's own hand-off reason, for a hand-off.
  handOffReason?: SecurityCaseHandOffReason | null | undefined;
  // What it waits for a person's approval to do (describeAiHoldAsked).
  asked?: string | undefined;
  aiVerdict?: SecurityCaseAiVerdict | string | null | undefined;
  // How long the case was held, in minutes.
  heldMinutes?: number | undefined;
  priorityName?: string | undefined;
  // Who pressed Page now or took the case, as a line names them.
  personName?: string | undefined;
}): string {
  const ai: string = data.aiName;
  const person: string = data.personName || "Someone";

  switch (data.outcome) {
    case SecurityCaseAiHoldOutcome.NeedsApproval:
      return data.asked
        ? `${ai} responded first and is waiting for approval to ${data.asked}.`
        : `${ai} responded first and is waiting for a person to approve a step.`;
    case SecurityCaseAiHoldOutcome.HandedOff:
      return data.handOffReason
        ? `${ai} responded first, then handed the case to people. ${
            ENGLISH.translateText(
              SECURITY_CASE_HAND_OFF_SENTENCES[data.handOffReason],
            ) || SECURITY_CASE_HAND_OFF_SENTENCES[data.handOffReason]
          }`
        : `${ai} responded first, then handed the case to people.`;
    case SecurityCaseAiHoldOutcome.TimeRanOut:
      return data.heldMinutes
        ? `${ai} responded first but did not finish within ${data.heldMinutes}${NO_BREAK_SPACE}${
            data.heldMinutes === 1 ? "minute" : "minutes"
          }.`
        : `${ai} responded first but did not finish in time.`;
    case SecurityCaseAiHoldOutcome.NotStarted:
      return `${ai} could not start working the case.`;
    case SecurityCaseAiHoldOutcome.NotMalicious:
      return data.aiVerdict &&
        data.aiVerdict !== SecurityCaseAiVerdict.Inconclusive
        ? `${ai}'s triage read the case as ${data.aiVerdict}, and it works only cases it reads as Likely Malicious on its own, so a person decides.`
        : `${ai}'s triage could not tell whether the case is real, so a person decides.`;
    case SecurityCaseAiHoldOutcome.NotVerified:
      return "The case was marked Contained, but OneUptime could not check every step that contains it.";
    case SecurityCaseAiHoldOutcome.ActiveAttack:
      return `Several security cases opened within ${SECURITY_CASE_AI_HOLD_ATTACK_WINDOW_IN_MINUTES}${NO_BREAK_SPACE}minutes, which looks like an active attack.`;
    case SecurityCaseAiHoldOutcome.TurnedOff:
      return `Letting ${ai} respond first was turned off.`;
    case SecurityCaseAiHoldOutcome.PageNow:
      return `${person} pressed Page now.`;
    case SecurityCaseAiHoldOutcome.RoseInPriority:
      return data.priorityName
        ? `The case rose to ${data.priorityName}, which alerts people at once.`
        : "The case rose to a priority that alerts people at once.";
    case SecurityCaseAiHoldOutcome.TakenByPerson:
      return `${person} took the case while ${ai} was on it, so nobody else was alerted.`;
    case SecurityCaseAiHoldOutcome.Resolved:
      return `${ai} responded first, and nobody had to be alerted.`;
    default:
      return `${ai} is working the case before anyone is alerted.`;
  }
}

/*
 * The summary a held case's channels get instead of an alert, when it was
 * resolved with nobody alerted: what happened, how fast, and what was done.
 * Its first line is the headline; the rest are its facts, each a line.
 */
export function buildAiHoldResolvedLines(data: {
  aiName: string;
  caseNumber: string;
  // OneUptime AI took the case: it did the work, not a playbook alone.
  isWorkedByAi: boolean;
  isClosed: boolean;
  // How long from the case opening to it being contained, or closed.
  tookMs: number | null;
  blocks: ReadonlyArray<SecurityCaseAiHoldBlock>;
  destinations: ReadonlyArray<string>;
  actions: ReadonlyArray<SecurityCaseAiHoldAction>;
  // OneUptime saw every request from the case's address turned away.
  isNothingThrough: boolean;
}): { headline: string; facts: Array<string> } {
  const took: string =
    data.tookMs !== null ? ` in ${describeAiHoldDuration(data.tookMs)}` : "";
  const verb: string = data.isClosed ? "closed" : "contained";

  const headline: string = data.isWorkedByAi
    ? `${data.aiName} ${verb} ${data.caseNumber}${took}, so nobody was alerted.`
    : `${data.caseNumber} was ${verb}${took}, before anyone had to be alerted.`;

  const facts: Array<string> = data.blocks.map(
    (block: SecurityCaseAiHoldBlock): string => {
      return describeAiHoldBlock({
        block,
        destinations: data.destinations,
      });
    },
  );

  for (const action of data.actions) {
    if (
      action.status === SecurityCaseAiActionStatus.Done &&
      (action.kind === SecurityCaseAiActionKind.ContainAccount ||
        action.kind === SecurityCaseAiActionKind.ContainHost)
    ) {
      facts.push(
        `${fill(SECURITY_CASE_AI_ACTION_TITLES[action.kind].done, action)}.`,
      );
    }
  }

  if (data.isNothingThrough) {
    facts.push(
      "Nothing reached the app: OneUptime saw every request turned away.",
    );
  }

  return { headline, facts };
}

// The summary's lines, as the channel post's headline.
export function buildAiHoldResolvedMarkdown(
  lines: { headline: string; facts: Array<string> },
): MarkdownText {
  const headline: MarkdownText = mdText`✅ **${lines.headline}**`;

  if (lines.facts.length === 0) {
    return headline;
  }

  return FeedMarkdown.join(
    [headline, FeedMarkdown.bulletList(lines.facts)],
    "\n\n",
  );
}

/*
 * The headline a held case's post opens with when people are alerted:
 * the case is new, why now, and what OneUptime AI already did.
 */
export function buildAiHoldAlertMarkdown(data: {
  priorityName: string;
  reason: string;
  done: ReadonlyArray<string>;
}): MarkdownText {
  const headline: MarkdownText = mdText`🛡️ **New ${data.priorityName} security case.** ${data.reason}`;

  if (data.done.length === 0) {
    return headline;
  }

  return FeedMarkdown.join(
    [
      headline,
      mdText`Already done: ${FeedMarkdown.join(
        data.done.map((line: string): MarkdownText => {
          return mdText`${line}.`;
        }),
        " ",
      )}`,
    ],
    "\n\n",
  );
}

// "Took the case. Blocked 35.205.11.131 for 24 hours.": what was done, in a line.
export function describeAiHoldDoneLine(done: ReadonlyArray<string>): string {
  return done
    .map((line: string): string => {
      return `${line}.`;
    })
    .join(" ");
}

// When the hold time ran out, in minutes, for "did not finish within 10 minutes".
export function getHeldMinutes(data: {
  openedAt: Date | null | undefined;
  endedAt: Date | null | undefined;
}): number | undefined {
  if (!data.openedAt || !data.endedAt) {
    return undefined;
  }

  return Math.max(
    1,
    Math.round(
      OneUptimeDate.getDifferenceInMinutes(
        new Date(data.endedAt),
        new Date(data.openedAt),
      ),
    ),
  );
}
