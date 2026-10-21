import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ON_CALL_PAGE_PASS_ON_ROUTE,
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
  OnCallPassOnRule,
  getOnCallPassOnTimeOfDay,
  isOnCallPassOnPagingStopped,
  isOnCallPassOnTimeToday,
  readOnCallPassOnResult,
} from "Common/Types/OnCallDutyPolicy/OnCallPagePassOn";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  composedValue,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { formatNameList } from "../../AiAccess/AiAccessModes";

/*
 * "CAN'T TAKE IT? PASS IT ON" ON A RECORD'S PAGE.
 *
 * The person an on-call policy is paging about an incident, an alert or an
 * episode sees "Pass it on" in the record's header, beside the state
 * buttons - nobody else does. It asks first, saying what passing on will do
 * ("Escalation rule 2 of 3 (Level 2) is paged right away, without
 * waiting." / "Bob Smith is still being paged."), and then says what it did.
 * What passing a page on means is in Common/Types/OnCallDutyPolicy/
 * OnCallPagePassOn; the server does it (OnCallPagePassOnAPI).
 *
 * React-free: the words, the requests and the answers, so they can be read
 * and tested on their own. The sentences are the Dashboard's translation
 * keys (src/Locales/README.md), each a whole sentence.
 */

export const PASS_ON_PAGE_TEXT: {
  button: string;
  dialogTitle: string;
  notPagedAgain: string;
  doneTitle: string;
  alreadyAcknowledgedTitle: string;
  alreadyPassedOnTitle: string;
  nothingToPassOnTitle: string;
  failed: string;
  passedOnStatus: string;
} = {
  button: translationKey("Pass it on"),
  dialogTitle: translationKey("Pass it on?"),
  notPagedAgain: translationKey("You won't be paged about it again."),
  doneTitle: translationKey("You passed it on"),
  /*
   * The dialog's title when nothing was passed on, by why - the headings the
   * pages a message's links open use (UserOnCallLogTimelineAPI).
   */
  alreadyAcknowledgedTitle: translationKey("Already acknowledged"),
  alreadyPassedOnTitle: translationKey("Already passed on"),
  nothingToPassOnTitle: translationKey("Nothing to pass on"),
  failed: translationKey("Could not pass it on. Please try again."),
  /*
   * The status a page passed on has, on the run's Execution Timeline and in
   * a person's Notification Logs: their pills look it up by this key.
   */
  passedOnStatus: translationKey("Passed On"),
};

// <api>/on-call-page/pass-on/<record type>/<record id>
export function getPassOnPageRoute(data: {
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
}): string {
  return `${ON_CALL_PAGE_PASS_ON_ROUTE}/${data.recordType}/${data.recordId.toString()}`;
}

// The open pages in a GET answer: each with what passing it on would do.
export function readOpenPages(json: unknown): Array<OnCallOpenPage> {
  const pages: unknown = (json as JSONObject | undefined)?.["pages"];

  if (!Array.isArray(pages)) {
    return [];
  }

  return pages
    .filter((page: unknown): boolean => {
      return Boolean(
        page &&
          typeof page === "object" &&
          (page as JSONObject)["preview"] &&
          typeof (page as JSONObject)["executionLogId"] === "string",
      );
    })
    .map((page: unknown): OnCallOpenPage => {
      const item: JSONObject = page as JSONObject;

      return {
        executionLogId: String(item["executionLogId"]),
        preview: readOnCallPassOnResult(
          item["preview"] as unknown as OnCallPassOnResult,
        ),
      };
    });
}

// The answers in a POST answer: one per page passed on, or why not.
export function readPassOnAnswers(json: unknown): Array<OnCallPassOnAnswer> {
  const answers: unknown = (json as JSONObject | undefined)?.["answers"];

  if (!Array.isArray(answers)) {
    return [];
  }

  return answers
    .filter((answer: unknown): boolean => {
      return Boolean(answer && typeof answer === "object");
    })
    .map((answer: unknown): OnCallPassOnAnswer => {
      const item: OnCallPassOnAnswer = answer as OnCallPassOnAnswer;

      return {
        ...item,
        passedOn: Boolean(item.passedOn),
        ...(item.result ? { result: readOnCallPassOnResult(item.result) } : {}),
      };
    });
}

/*
 * The signed-in person's open pages about the record. An answer that is not
 * a success throws, so the page can tell "not paged" from "could not ask".
 */
export async function fetchOpenPages(data: {
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
}): Promise<Array<OnCallOpenPage>> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        getPassOnPageRoute(data),
      ),
      data: {},
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  return readOpenPages(response.jsonData);
}

// Passes the signed-in person's open pages about the record on.
export async function passOnPages(data: {
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
}): Promise<Array<OnCallPassOnAnswer>> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        getPassOnPageRoute(data),
      ),
      data: {},
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  return readPassOnAnswers(response.jsonData);
}

interface RuleValues {
  order: string;
  count: string;
  name: string;
}

// The rule's place and name, as a sentence's values: "2", "3", "Level 2".
function ruleValues(
  rule: OnCallPassOnRule | undefined,
  ruleCount: number,
  translator: Translator,
): RuleValues | null {
  if (!rule || !rule.order) {
    return null;
  }

  return {
    order: translator.formatNumber(rule.order),
    count: translator.formatNumber(Math.max(ruleCount, rule.order)),
    name: (rule.name || "").trim() || `#${rule.order}`,
  };
}

/*
 * "Ana, Bob and Carl", joined in the language of the sentence it goes into
 * (formatNameList).
 */
function names(list: Array<string>): ReturnType<typeof composedValue> {
  return composedValue((sentence: Translator): string => {
    return formatNameList(list, "and", sentence);
  });
}

/*
 * "6:40 PM GMT" - when the policy moves on, on the reader's own clock. A
 * rule's wait is minutes away, so on the same day the time says it, and a
 * date in front of it would only stand between the reader and the clock;
 * a time on another day keeps its date (getOnCallPassOnTime words the
 * server's sentences the same way).
 */
export function formatPassOnTime(at: Date, now?: Date | undefined): string {
  return isOnCallPassOnTimeToday({ at: at, now: now })
    ? getOnCallPassOnTimeOfDay({ at: at })
    : OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(at);
}

/*
 * What passing a page on would do, or did, in the reader's language: the
 * Dashboard's words for the server's sentences (getOnCallPassOnSentence).
 * `now` is when it is read, for whether a time needs its date.
 */
export function describePassOnResult(
  result: OnCallPassOnResult,
  translator: Translator,
  now?: Date | undefined,
): string {
  const rule: RuleValues | null = ruleValues(
    result.rule,
    result.ruleCount,
    translator,
  );

  switch (result.outcome) {
    case OnCallPassOnOutcome.NextRulePaged: {
      if (!rule) {
        return result.isPreview
          ? translator.translateTemplate(
              "The next escalation rule is paged right away, without waiting.",
            )
          : translator.translateTemplate(
              "The next escalation rule is being paged now.",
            );
      }

      if (result.isPreview) {
        return translator.translateTemplate(
          "Escalation rule {{order}} of {{count}} ({{name}}) is paged right away, without waiting.",
          { ...rule },
        );
      }

      return result.pagedNames.length > 0
        ? translator.translateTemplate(
            "Escalation rule {{order}} of {{count}} ({{name}}) is paging {{names}} now.",
            { ...rule, names: names(result.pagedNames) },
          )
        : translator.translateTemplate(
            "Escalation rule {{order}} of {{count}} ({{name}}) is next, and is being paged now.",
            { ...rule },
          );
    }
    case OnCallPassOnOutcome.PolicyStartedAgain:
      return result.isPreview
        ? translator.translateTemplate(
            "This is the policy's last escalation rule, so the policy starts again from escalation rule 1 right away.",
          )
        : translator.translateTemplate(
            "That was the policy's last escalation rule, so the policy started again from escalation rule 1.",
          );
    case OnCallPassOnOutcome.OthersStillPaged: {
      const still: string = translator.translatePlural(
        {
          one: "{{names}} is still being paged.",
          other: "{{names}} are still being paged.",
        },
        Math.max(result.stillPagedNames.length, 1),
        { names: names(result.stillPagedNames) },
      );

      const next: RuleValues | null = ruleValues(
        result.nextRule,
        result.ruleCount,
        translator,
      );

      if (result.isDirectPage || !result.nextStepAt) {
        return still;
      }

      const time: string = formatPassOnTime(result.nextStepAt, now);

      const then: string = next
        ? translator.translateTemplate(
            "If nobody acknowledges by {{time}}, escalation rule {{order}} of {{count}} ({{name}}) is next.",
            { ...next, time: time },
          )
        : translator.translateTemplate(
            "If nobody acknowledges by {{time}}, the policy moves on.",
            { time: time },
          );

      return `${still} ${then}`;
    }
    case OnCallPassOnOutcome.AlreadyEscalated:
      return rule
        ? translator.translateTemplate(
            "The policy has moved on already: escalation rule {{order}} of {{count}} ({{name}}) is paging now.",
            { ...rule },
          )
        : translator.translateTemplate(
            "The policy has moved on already: a later escalation rule is paging now.",
          );
    case OnCallPassOnOutcome.PagingStopped:
    default:
      if (result.isPreview) {
        return result.isDirectPage
          ? translator.translateTemplate(
              "Nobody else is being paged: paging stops, and somebody needs to take it.",
            )
          : translator.translateTemplate(
              "Nobody else is left to page: paging stops, and somebody needs to take it.",
            );
      }

      return translator.translateTemplate(
        "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
      );
  }
}

// Why a page could not be passed on, in the reader's language.
export function describePassOnRefusal(
  answer: OnCallPassOnAnswer,
  translator: Translator,
): string {
  switch (answer.refusal) {
    case OnCallPassOnRefusal.RecordAcknowledged:
      return (answer.acknowledgedByName || "").trim()
        ? translator.translateTemplate(
            "{{name}} acknowledged it already, so there is nothing to pass on.",
            { name: (answer.acknowledgedByName || "").trim() },
          )
        : translator.translateTemplate(
            "Somebody acknowledged it already, so there is nothing to pass on.",
          );
    case OnCallPassOnRefusal.AlreadyPassedOn:
      return translator.translateTemplate("You passed this page on already.");
    case OnCallPassOnRefusal.PageOver:
      return translator.translateTemplate(
        "This page is over: the on-call policy has stopped paging.",
      );
    case OnCallPassOnRefusal.NotPaged:
    case OnCallPassOnRefusal.InvalidLink:
    default:
      return translator.translateTemplate(
        "You are not being paged about this right now.",
      );
  }
}

/*
 * One sentence per page: with two policies paging the person about the same
 * record, each is named before what passing it on does there.
 */
function perPage<T>(
  items: Array<T>,
  describe: (item: T) => string,
  policyOf: (item: T) => string,
  translator: Translator,
): Array<string> {
  if (items.length <= 1) {
    return items.map(describe);
  }

  return items.map((item: T): string => {
    const policy: string = policyOf(item).trim();

    return policy
      ? translator.translateTemplate("{{policy}}: {{sentence}}", {
          policy: policy,
          sentence: describe(item),
        })
      : describe(item);
  });
}

// What the dialog says before passing on: the person's own pages about it.
export function describePassOnPreview(
  pages: Array<OnCallOpenPage>,
  translator: Translator,
): Array<string> {
  return perPage(
    pages,
    (page: OnCallOpenPage): string => {
      return describePassOnResult(page.preview, translator);
    },
    (page: OnCallOpenPage): string => {
      return page.preview.policyName;
    },
    translator,
  );
}

// What the dialog says once it has passed them on - or why it could not.
export function describePassOnAnswers(
  answers: Array<OnCallPassOnAnswer>,
  translator: Translator,
): Array<string> {
  return perPage(
    answers,
    (answer: OnCallPassOnAnswer): string => {
      return answer.passedOn && answer.result
        ? describePassOnResult(answer.result, translator)
        : describePassOnRefusal(answer, translator);
    },
    (answer: OnCallPassOnAnswer): string => {
      return answer.result?.policyName || "";
    },
    translator,
  );
}

// Whether any of the answers passed a page on.
export function isAnyPassedOn(answers: Array<OnCallPassOnAnswer>): boolean {
  return answers.some((answer: OnCallPassOnAnswer): boolean => {
    return answer.passedOn;
  });
}

/*
 * A line of the dialog: a sentence, or - when passing on leaves nobody being
 * paged (isOnCallPassOnPagingStopped) - a warning, drawn apart and first.
 * Nobody is on the record then, and the person reading may decide to take
 * it after all.
 */
export interface PassOnDialogLine {
  text: string;
  isWarning: boolean;
}

// Warnings first, the rest in their order.
function warningsFirst(
  lines: Array<PassOnDialogLine>,
): Array<PassOnDialogLine> {
  return [
    ...lines.filter((line: PassOnDialogLine): boolean => {
      return line.isWarning;
    }),
    ...lines.filter((line: PassOnDialogLine): boolean => {
      return !line.isWarning;
    }),
  ];
}

function notPagedAgain(translator: Translator): PassOnDialogLine {
  return {
    text:
      translator.translateText(PASS_ON_PAGE_TEXT.notPagedAgain) ||
      PASS_ON_PAGE_TEXT.notPagedAgain,
    isWarning: false,
  };
}

/*
 * What the dialog says before passing on: that the person is not paged
 * about it again, then what passing on does on each of their pages.
 */
export function getPassOnQuestionLines(
  pages: Array<OnCallOpenPage>,
  translator: Translator,
): Array<PassOnDialogLine> {
  const sentences: Array<string> = describePassOnPreview(pages, translator);

  return warningsFirst([
    notPagedAgain(translator),
    ...sentences.map((text: string, index: number): PassOnDialogLine => {
      const page: OnCallOpenPage | undefined = pages[index];

      return {
        text: text,
        isWarning: Boolean(page && isOnCallPassOnPagingStopped(page.preview)),
      };
    }),
  ]);
}

/*
 * What the dialog says once it has passed them on: what came of each page -
 * or why there was nothing to pass on - and, when it passed any on, that the
 * person is not paged about it again.
 */
export function getPassOnAnswerLines(
  answers: Array<OnCallPassOnAnswer>,
  translator: Translator,
): Array<PassOnDialogLine> {
  const sentences: Array<string> = describePassOnAnswers(answers, translator);

  const lines: Array<PassOnDialogLine> = sentences.map(
    (text: string, index: number): PassOnDialogLine => {
      const answer: OnCallPassOnAnswer | undefined = answers[index];

      return {
        text: text,
        isWarning: Boolean(
          answer?.passedOn &&
            answer.result &&
            isOnCallPassOnPagingStopped(answer.result),
        ),
      };
    },
  );

  if (isAnyPassedOn(answers)) {
    lines.push(notPagedAgain(translator));
  }

  return warningsFirst(lines);
}

/*
 * The dialog's title once it has asked the server: "You passed it on", or,
 * when nothing was passed on, why in a few words - "Already acknowledged",
 * "Already passed on", "Nothing to pass on" - with the sentence under it
 * saying the rest.
 */
export function getPassOnAnswerTitle(
  answers: Array<OnCallPassOnAnswer>,
): string {
  if (isAnyPassedOn(answers)) {
    return PASS_ON_PAGE_TEXT.doneTitle;
  }

  const refusals: Array<OnCallPassOnRefusal | undefined> = answers.map(
    (answer: OnCallPassOnAnswer): OnCallPassOnRefusal | undefined => {
      return answer.refusal;
    },
  );

  const everyOne: (refusal: OnCallPassOnRefusal) => boolean = (
    refusal: OnCallPassOnRefusal,
  ): boolean => {
    return (
      refusals.length > 0 &&
      refusals.every((each: OnCallPassOnRefusal | undefined): boolean => {
        return each === refusal;
      })
    );
  };

  if (everyOne(OnCallPassOnRefusal.RecordAcknowledged)) {
    return PASS_ON_PAGE_TEXT.alreadyAcknowledgedTitle;
  }

  if (everyOne(OnCallPassOnRefusal.AlreadyPassedOn)) {
    return PASS_ON_PAGE_TEXT.alreadyPassedOnTitle;
  }

  return PASS_ON_PAGE_TEXT.nothingToPassOnTitle;
}
