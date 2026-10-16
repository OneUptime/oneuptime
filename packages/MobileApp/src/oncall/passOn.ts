import type { OnCallPassOnAnswer, OnCallPassOnPage } from "../api/onCallPassOn";

/*
 * The words of "Pass it on" on a detail screen: its button, the question it
 * asks first and the answer it gives after. The sentences about what passing
 * on does come from the server (api/onCallPassOn); this puts them together.
 *
 * The same words as the Dashboard, the email and the call: "Pass it on",
 * "You won't be paged about it again."
 */

export const PASS_ON_TEXT: Readonly<{
  button: string;
  confirmTitle: string;
  notPagedAgain: string;
  doneTitle: string;
  notDoneTitle: string;
  failed: string;
  passedOnStatus: string;
}> = {
  button: "Pass it on",
  confirmTitle: "Pass it on?",
  notPagedAgain: "You won't be paged about it again.",
  doneTitle: "You passed it on",
  notDoneTitle: "Nothing to pass on",
  failed: "Could not pass it on. Please try again.",
  // The page's status on the server, and the label My Pages shows for it.
  passedOnStatus: "Passed On",
};

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

// The question: what passing on will do, before anything is changed.
export function getPassOnQuestion(pages: OnCallPassOnPage[]): {
  title: string;
  message: string;
} {
  return {
    title: PASS_ON_TEXT.confirmTitle,
    message: [PASS_ON_TEXT.notPagedAgain, ...linesFor(pages)].join("\n\n"),
  };
}

// The answer: what passing on did - or why there was nothing to pass on.
export function getPassOnAnswer(answers: OnCallPassOnAnswer[]): {
  title: string;
  message: string;
  passedOn: boolean;
} {
  const passedOn: boolean = answers.some((answer: OnCallPassOnAnswer) => {
    return answer.passedOn;
  });

  const lines: string[] = linesFor(answers);

  return {
    title: passedOn ? PASS_ON_TEXT.doneTitle : PASS_ON_TEXT.notDoneTitle,
    message: (passedOn
      ? [...lines, PASS_ON_TEXT.notPagedAgain]
      : lines.length > 0
        ? lines
        : ["You are not being paged about this right now."]
    ).join("\n\n"),
    passedOn,
  };
}
