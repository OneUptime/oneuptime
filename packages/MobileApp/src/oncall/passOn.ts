import type {
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnPage,
} from "../api/onCallPassOn";

/*
 * The words of "Escalate" on a detail screen: its button, the question it
 * asks first and the answer it gives after. The sentences about what
 * escalating does come from the server (api/onCallPassOn); this puts them
 * together, in the order of the Dashboard's dialog:
 *
 *   Escalate Incident?
 *   This will immediately page Platform leads (Level 2 of 3), without
 *     waiting.
 *   You will not be paged again for this incident.
 *   [Cancel] [Escalate]
 *
 * The same words as the Dashboard, the email and the call. The action was
 * first called "Pass it on"; the server still stores an escalated page's
 * status as "Passed On", and My Pages shows it as "Escalated".
 */

export const PASS_ON_TEXT: Readonly<{
  button: string;
  notDoneTitle: string;
  failed: string;
  passedOnStatus: string;
  passedOnLabel: string;
}> = {
  button: "Escalate",
  notDoneTitle: "Nothing to escalate",
  failed: "Could not escalate. Please try again.",
  // The page's status on the server, kept from the action's first name...
  passedOnStatus: "Passed On",
  // ...and the label My Pages shows for it.
  passedOnLabel: "Escalated",
};

/*
 * What the question and the answer call the record, by its kind. Both kinds
 * of episode are an "episode", as on the Dashboard.
 */
export interface PassOnRecordText {
  question: string;
  doneTitle: string;
  notPagedAgain: string;
}

const EPISODE_TEXT: PassOnRecordText = {
  question: "Escalate Episode?",
  doneTitle: "Episode escalated",
  notPagedAgain: "You will not be paged again for this episode.",
};

export const PASS_ON_RECORD_TEXT: Readonly<
  Record<OnCallPageRecordType, PassOnRecordText>
> = {
  incident: {
    question: "Escalate Incident?",
    doneTitle: "Incident escalated",
    notPagedAgain: "You will not be paged again for this incident.",
  },
  alert: {
    question: "Escalate Alert?",
    doneTitle: "Alert escalated",
    notPagedAgain: "You will not be paged again for this alert.",
  },
  "incident-episode": EPISODE_TEXT,
  "alert-episode": EPISODE_TEXT,
};

export function getPassOnRecordText(
  recordType: OnCallPageRecordType,
): PassOnRecordText {
  return PASS_ON_RECORD_TEXT[recordType] ?? PASS_ON_RECORD_TEXT.incident;
}

/*
 * One line per page: with two policies paging the person about the same
 * record, each line says which policy it is about.
 */
function linesFor(
  items: Array<{ policyName: string; sentence: string }>,
): string[] {
  return items
    .filter((item: { sentence: string }) => {
      return item.sentence.length > 0;
    })
    .map((item: { policyName: string; sentence: string }) => {
      const policy: string = item.policyName.trim();

      return items.length > 1 && policy
        ? `${policy}: ${item.sentence}`
        : item.sentence;
    });
}

/*
 * The question: what escalating will do, before anything is changed, then
 * that the person is not paged again for the record.
 */
export function getPassOnQuestion(
  pages: OnCallPassOnPage[],
  recordType: OnCallPageRecordType,
): {
  title: string;
  message: string;
} {
  const text: PassOnRecordText = getPassOnRecordText(recordType);

  return {
    title: text.question,
    message: [...linesFor(pages), text.notPagedAgain].join("\n\n"),
  };
}

// The answer: what escalating did - or why there was nothing to escalate.
export function getPassOnAnswer(
  answers: OnCallPassOnAnswer[],
  recordType: OnCallPageRecordType,
): {
  title: string;
  message: string;
  passedOn: boolean;
} {
  const text: PassOnRecordText = getPassOnRecordText(recordType);
  const passedOn: boolean = answers.some((answer: OnCallPassOnAnswer) => {
    return answer.passedOn;
  });

  const lines: string[] = linesFor(answers);

  return {
    title: passedOn ? text.doneTitle : PASS_ON_TEXT.notDoneTitle,
    message: (passedOn
      ? [...lines, text.notPagedAgain]
      : lines.length > 0
        ? lines
        : ["You are not being paged about this right now."]
    ).join("\n\n"),
    passedOn,
  };
}
