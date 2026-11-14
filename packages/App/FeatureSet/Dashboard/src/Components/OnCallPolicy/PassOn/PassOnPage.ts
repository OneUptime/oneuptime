import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ON_CALL_PAGE_PASS_ON_ESCALATE_TO_FIELD,
  ON_CALL_PAGE_PASS_ON_ROUTE,
  ON_CALL_PASS_ON_NO_BREAK_SPACE,
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnLevelChoice,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
  OnCallPassOnRule,
  findOnCallPassOnLevelChoice,
  getOnCallPassOnLevelChoices,
  getOnCallPassOnLevelCount,
  getOnCallPassOnLevelName,
  getOnCallPassOnPickedResult,
  getOnCallPassOnTimeOfDay,
  hasOnCallPassOnLevelChoice,
  isOnCallPassOnPagingStopped,
  isOnCallPassOnTimeToday,
  readOnCallPassOnResult,
} from "Common/Types/OnCallDutyPolicy/OnCallPagePassOn";
import { ON_CALL_PAGE_AGAIN_ACKNOWLEDGE_ROUTE } from "Common/Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  ComposedValue,
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { formatNameList } from "../../AiAccess/AiAccessModes";

/*
 * "CAN'T TAKE IT? ESCALATE" ON A RECORD'S PAGE.
 *
 * The person an on-call policy is paging about an incident, an alert or an
 * episode sees "Escalate" in the record's header, beside the state buttons
 * - nobody else does. It asks first, in the maintainer's words, saying what
 * escalating will do:
 *
 *   Escalate Incident?
 *   This will immediately page Platform leads (Level 2 of 3), without
 *     waiting.
 *   You will not be paged again for this incident.
 *   [Cancel] [Escalate]
 *
 * and then says what it did. What escalating a page means is in
 * Common/Types/OnCallDutyPolicy/OnCallPagePassOn (whose code keeps the
 * action's first name, "pass on"); the server does it (OnCallPagePassOnAPI).
 *
 * With two or more levels after the person's, the dialog asks which to
 * page first - "Escalate to", a radio for each, the next level picked - and
 * its sentence follows the pick: "This will immediately page DBA leads
 * (Level 3 of 3), without waiting. It skips Platform leads (Level 2 of
 * 3)." Leaving the next level picked sends nothing, and escalates exactly
 * as Escalate always has.
 *
 * React-free: the words, the requests and the answers, so they can be read
 * and tested on their own. The sentences are the Dashboard's translation
 * keys (src/Locales/README.md), each a whole sentence, and in English they
 * are word for word what the server says (getOnCallPassOnSentence).
 */

// English, for a sentence that has no translation yet (getPassOnKeptTogether).
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

export const PASS_ON_PAGE_TEXT: {
  button: string;
  alreadyAcknowledgedTitle: string;
  alreadyPassedOnTitle: string;
  nothingToPassOnTitle: string;
  notEscalatedTitle: string;
  failed: string;
  passedOnStatus: string;
  escalateTo: string;
} = {
  // The header's button, and the dialog's.
  button: translationKey("Escalate"),
  /*
   * The dialog's title when nothing was escalated, by why - the headings the
   * pages a message's links open use (UserOnCallLogTimelineAPI). Never the
   * button's own word: "Escalate" over a refusal reads as an instruction.
   */
  alreadyAcknowledgedTitle: translationKey("Already acknowledged"),
  alreadyPassedOnTitle: translationKey("Already escalated"),
  nothingToPassOnTitle: translationKey("Nothing to escalate"),
  // The level picked was not there to page any more (LevelNotAvailable).
  notEscalatedTitle: translationKey("Not escalated"),
  failed: translationKey("Could not escalate. Please try again."),
  /*
   * The status an escalated page has, on the run's Execution Timeline and in
   * a person's Notification Logs. It is stored as "Passed On"; their pills
   * and status filters draw it with this word (PassedOnStatus).
   */
  passedOnStatus: translationKey("Escalated"),
  /*
   * The radio group's label where the person picks the level to page, as
   * the Escalate page a message's link opens labels it.
   */
  escalateTo: translationKey("Escalate to"),
};

/*
 * What the dialog says that depends on what the record is: the question,
 * the title once it is done, and the line that the reader is not paged
 * again. Both kinds of episode are an "episode" on their pages.
 */
export interface PassOnRecordText {
  question: string;
  doneTitle: string;
  notPagedAgain: string;
}

const EPISODE_TEXT: PassOnRecordText = {
  question: translationKey("Escalate Episode?"),
  doneTitle: translationKey("Episode escalated"),
  notPagedAgain: translationKey(
    "You will not be paged again for this episode.",
  ),
};

export const PASS_ON_RECORD_TEXT: Record<
  OnCallPageRecordType,
  PassOnRecordText
> = {
  [OnCallPageRecordType.Incident]: {
    question: translationKey("Escalate Incident?"),
    doneTitle: translationKey("Incident escalated"),
    notPagedAgain: translationKey(
      "You will not be paged again for this incident.",
    ),
  },
  [OnCallPageRecordType.Alert]: {
    question: translationKey("Escalate Alert?"),
    doneTitle: translationKey("Alert escalated"),
    notPagedAgain: translationKey(
      "You will not be paged again for this alert.",
    ),
  },
  [OnCallPageRecordType.IncidentEpisode]: EPISODE_TEXT,
  [OnCallPageRecordType.AlertEpisode]: EPISODE_TEXT,
};

// The words for a record, by its kind - an incident's for anything else.
export function getPassOnRecordText(
  recordType: OnCallPageRecordType,
): PassOnRecordText {
  return (
    PASS_ON_RECORD_TEXT[recordType] ||
    PASS_ON_RECORD_TEXT[OnCallPageRecordType.Incident]
  );
}

// The dialog's question: "Escalate Incident?".
export function getPassOnQuestionTitle(
  recordType: OnCallPageRecordType,
): string {
  return getPassOnRecordText(recordType).question;
}

// <api>/on-call-page/pass-on/<record type>/<record id>
export function getPassOnPageRoute(data: {
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
}): string {
  return `${ON_CALL_PAGE_PASS_ON_ROUTE}/${data.recordType}/${data.recordId.toString()}`;
}

// The open pages in a GET answer: each with what escalating it would do.
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
        /*
         * A page again, or a page that goes on until answered about a record
         * acknowledged already: acknowledged as the page it is
         * (PAGE_AGAIN_TEXT).
         */
        ...(item["isPageAgain"] === true ? { isPageAgain: true as const } : {}),
      };
    });
}

// The answers in a POST answer: one per page escalated, or why not.
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

/*
 * A PAGE AGAIN (OnCallAcknowledgementTimeout) ON A RECORD'S PAGE.
 *
 * The policy paged again because the record stayed acknowledged without
 * being resolved. The record was acknowledged all along, so its own
 * Acknowledge is not in its header; the person paged again gets an
 * "Acknowledge again" of their own there, beside Escalate, that answers
 * their page as its link, a call's 1 or a text would: their notifications
 * stop, and the policy counts its time again from now.
 *
 * A page a person asked for (OnCallPersonPage) and a policy a person started
 * by hand (OnCallPolicyStartedByHand) get the same once the record is
 * acknowledged: they go on until one of their people answers them, and the
 * record's own Acknowledge, the other way to answer them, is gone.
 *
 * "Again", because the header says the record is Acknowledged already: a
 * bare "Acknowledge" beside that read as a button that did nothing, or as
 * a mistake. If it cannot be acknowledged, a dialog says so, under a title
 * that says what went wrong rather than the button's words, and says what
 * that means for them: the page goes on.
 */
export const PAGE_AGAIN_TEXT: {
  button: string;
  failedTitle: string;
  failed: string;
} = {
  button: translationKey("Acknowledge again"),
  failedTitle: translationKey("Could not acknowledge"),
  failed: translationKey("You are still being paged. Please try again."),
};

// Whether any of the signed-in person's open pages is a page again.
export function hasPageAgain(pages: Array<OnCallOpenPage>): boolean {
  return pages.some((page: OnCallOpenPage): boolean => {
    return page.isPageAgain === true;
  });
}

// <api>/on-call-page/acknowledge/<record type>/<record id>
export function getPageAgainAcknowledgeRoute(data: {
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
}): string {
  return `${ON_CALL_PAGE_AGAIN_ACKNOWLEDGE_ROUTE}/${data.recordType}/${data.recordId.toString()}`;
}

/*
 * Acknowledges the signed-in person's pages again about the record, and
 * says how many. An answer that is not a success throws.
 */
export async function acknowledgePagesAgain(data: {
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
}): Promise<number> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        getPageAgainAcknowledgeRoute(data),
      ),
      data: {},
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  const acknowledged: unknown = (response.jsonData as JSONObject | undefined)?.[
    "acknowledged"
  ];

  return typeof acknowledged === "number" && acknowledged > 0
    ? acknowledged
    : 0;
}

/*
 * Escalates the signed-in person's open pages about the record. `escalateTo`
 * is a later level picked for a page, by its run (getPassOnEscalateTo): a
 * page it does not name pages its next level, and with none picked the
 * request is the one Escalate always sent.
 */
export async function passOnPages(data: {
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
  escalateTo?: PassOnLevelPicks | undefined;
}): Promise<Array<OnCallPassOnAnswer>> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        getPassOnPageRoute(data),
      ),
      data:
        data.escalateTo && Object.keys(data.escalateTo).length > 0
          ? { [ON_CALL_PAGE_PASS_ON_ESCALATE_TO_FIELD]: data.escalateTo }
          : {},
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  return readPassOnAnswers(response.jsonData);
}

/*
 * A level of the policy as a sentence's value, in the sentence's language:
 * "Platform leads (Level 2 of 3)" - its name, then its place - or "Level 2
 * of 3" when it has no name of its own (no name, or the one its place gives
 * it: getOnCallPassOnLevelName). Null when the rule is not known.
 *
 * In every sentence the level is what the policy pages - the object of
 * "page" - so a language may word the level for that place (a case, an
 * article) in its own translation of these two keys.
 */
function levelValue(
  rule: OnCallPassOnRule | undefined,
  ruleCount: number,
): ComposedValue | null {
  if (!rule || !rule.order) {
    return null;
  }

  const name: string | undefined = getOnCallPassOnLevelName(rule);

  return composedValue((sentence: Translator): string => {
    return levelLabel(sentence, rule, ruleCount, name);
  });
}

// A level's label in the sentence's language, by the name it is given.
function levelLabel(
  sentence: Translator,
  rule: OnCallPassOnRule,
  ruleCount: number,
  name: string | undefined,
): string {
  const place: { order: string; count: string } = {
    order: sentence.formatNumber(rule.order),
    count: sentence.formatNumber(getOnCallPassOnLevelCount(rule, ruleCount)),
  };

  return name
    ? sentence.translateTemplate("{{name}} (Level {{order}} of {{count}})", {
        ...place,
        name: name,
      })
    : sentence.translateTemplate("Level {{order}} of {{count}}", place);
}

// Stands in for a level's name while its place is read out of its label.
const LEVEL_NAME_MARK: string = String.fromCharCode(0xe000);

/*
 * PICKING THE LEVEL TO PAGE.
 *
 * A page whose preview offers two or more levels (hasOnCallPassOnLevelChoice)
 * asks which: the dialog draws a radio for each, the next level picked.
 * `PassOnLevelPicks` is what the person picked, by the page's run: the
 * escalation rule of the level. A page with no pick pages its next level.
 */
export type PassOnLevelPicks = Record<string, string>;

// The levels a page asks the person to pick from; none when there is no choice.
export function getPassOnLevelChoices(
  page: OnCallOpenPage,
): Array<OnCallPassOnLevelChoice> {
  return hasOnCallPassOnLevelChoice(page.preview)
    ? getOnCallPassOnLevelChoices(page.preview)
    : [];
}

/*
 * The level picked for a page: the one the person picked, while the page
 * still offers it, and the next level otherwise.
 */
export function getPassOnPickedLevel(
  page: OnCallOpenPage,
  picks: PassOnLevelPicks,
): OnCallPassOnLevelChoice | undefined {
  const choices: Array<OnCallPassOnLevelChoice> = getPassOnLevelChoices(page);

  return (
    findOnCallPassOnLevelChoice(choices, picks[page.executionLogId]) ||
    choices[0]
  );
}

/*
 * What a page would do with the level picked: the level it pages, and the
 * levels it skips (getOnCallPassOnPickedResult).
 */
export function getPassOnPickedPreview(
  page: OnCallOpenPage,
  picks: PassOnLevelPicks,
): { result: OnCallPassOnResult; skipped: Array<OnCallPassOnRule> } {
  return getOnCallPassOnPickedResult(
    page.preview,
    getPassOnPickedLevel(page, picks)?.escalationRuleId,
  );
}

/*
 * What the POST says of the levels picked: only a later level than the
 * next, and only one the page still offers. Leaving the next level picked
 * sends nothing, so it escalates exactly as Escalate always has, whatever
 * the policy's levels have become meanwhile.
 */
export function getPassOnEscalateTo(
  pages: Array<OnCallOpenPage>,
  picks: PassOnLevelPicks,
): PassOnLevelPicks {
  const escalateTo: PassOnLevelPicks = {};

  for (const page of pages) {
    const choices: Array<OnCallPassOnLevelChoice> = getPassOnLevelChoices(page);
    const picked: OnCallPassOnLevelChoice | undefined =
      findOnCallPassOnLevelChoice(choices, picks[page.executionLogId]);

    if (picked && picked !== choices[0]) {
      escalateTo[page.executionLogId] = picked.escalationRuleId;
    }
  }

  return escalateTo;
}

/*
 * A level as a radio names it, in the reader's language: "Platform leads
 * (Level 2 of 3)", or "Level 3 of 3" for a level with no name of its own -
 * its place written with spaces no line breaks at, so a phone never breaks
 * it as "(Level 2 of" / "3)". The name keeps its own spaces.
 */
export function getPassOnLevelChoiceLabel(
  choice: OnCallPassOnRule,
  ruleCount: number,
  translator: Translator,
): string {
  const label: string = levelLabel(
    translator,
    choice,
    ruleCount,
    getOnCallPassOnLevelName(choice),
  );

  const places: Array<string> = levelLabel(
    translator,
    choice,
    ruleCount,
    getOnCallPassOnLevelName(choice) ? LEVEL_NAME_MARK : undefined,
  )
    .split(LEVEL_NAME_MARK)
    .map((piece: string): string => {
      return piece.trim();
    })
    .filter((piece: string): boolean => {
      return piece.length > 0;
    });

  return getPassOnLinePieces(label, places)
    .map((piece: PassOnLinePiece): string => {
      return piece.keepTogether
        ? piece.text.split(" ").join(ON_CALL_PASS_ON_NO_BREAK_SPACE)
        : piece.text;
    })
    .join("");
}

/*
 * The radio group's label: "Escalate to" - or, with two policies paging the
 * person about the record, "Payments: escalate to", so each group says
 * whose levels it offers.
 */
export function getPassOnLevelPickerLabel(
  page: OnCallOpenPage,
  pages: Array<OnCallOpenPage>,
  translator: Translator,
): string {
  const policy: string = page.preview.policyName.trim();

  if (pages.length > 1 && policy) {
    return translator.translateTemplate("{{policy}}: escalate to", {
      policy: policy,
    });
  }

  return (
    translator.translateText(PASS_ON_PAGE_TEXT.escalateTo) ||
    PASS_ON_PAGE_TEXT.escalateTo
  );
}

/*
 * "It skips Platform leads (Level 2 of 3)." - what a later level picked
 * passes over, said after what escalating does. Empty when it skips none.
 */
export function describePassOnSkippedLevels(
  skipped: Array<OnCallPassOnRule>,
  ruleCount: number,
  translator: Translator,
): string {
  const levels: Array<ComposedValue> = [];

  for (const rule of skipped) {
    const level: ComposedValue | null = levelValue(rule, ruleCount);

    if (level) {
      levels.push(level);
    }
  }

  if (levels.length === 0) {
    return "";
  }

  return translator.translateTemplate("It skips {{levels}}.", {
    levels: composedValue((sentence: Translator): string => {
      return formatNameList(
        levels.map((level: ComposedValue): string => {
          return level.compose(sentence);
        }),
        "and",
        sentence,
      );
    }),
  });
}

/*
 * What the dialog keeps on one line: each level's place - "(Level 2 of 3)"
 * after its name, "Level 2 of 3" on its own - and the time the policy
 * moves on, "6:40 PM GMT". A phone broke the maintainer's own example as
 * "Platform leads (Level 2 of" / "3), without waiting.", and a time as
 * "by 6:40" / "PM GMT". Never a level's name: somebody typed it, and a long
 * one breaks where it needs to.
 *
 * A place is worded in the reader's language, and in English too: a
 * sentence that has no translation yet is filled with English values. The
 * dialog draws each of them it finds in a line on one line
 * (getPassOnLinePieces); the line's text itself is unchanged. `now` is when
 * it is read, as describePassOnResult takes it.
 */
export function getPassOnKeptTogether(
  results: Array<OnCallPassOnResult>,
  translator: Translator,
  now?: Date | undefined,
): Array<string> {
  const kept: Array<string> = [];

  const keep: (text: string) => void = (text: string): void => {
    const phrase: string = text.trim();

    if (phrase && !kept.includes(phrase)) {
      kept.push(phrase);
    }
  };

  for (const result of results) {
    for (const rule of [result.rule, result.nextRule]) {
      if (!rule || !rule.order) {
        continue;
      }

      const hasName: boolean = Boolean(getOnCallPassOnLevelName(rule));

      for (const sentence of [translator, ENGLISH]) {
        levelLabel(
          sentence,
          rule,
          result.ruleCount,
          hasName ? LEVEL_NAME_MARK : undefined,
        )
          .split(LEVEL_NAME_MARK)
          .forEach(keep);
      }
    }

    if (result.nextStepAt) {
      keep(formatPassOnTime(result.nextStepAt, now));
    }
  }

  return kept;
}

// A piece of a dialog line, and whether it must stay on one line.
export interface PassOnLinePiece {
  text: string;
  keepTogether: boolean;
}

/*
 * A line of the dialog in pieces: each phrase of `kept` in it (a level's
 * "(Level 2 of 3)", a time: getPassOnKeptTogether) a piece of its own that
 * stays on one line, the rest as it is. Joined, the pieces are the line.
 */
export function getPassOnLinePieces(
  text: string,
  kept: Array<string>,
): Array<PassOnLinePiece> {
  const pieces: Array<PassOnLinePiece> = [];
  let rest: string = text;

  while (rest.length > 0) {
    let at: number = -1;
    let found: string = "";

    // The first phrase in what is left; of two at the same spot, the longer.
    for (const phrase of kept) {
      const index: number = phrase ? rest.indexOf(phrase) : -1;

      if (
        index >= 0 &&
        (at < 0 || index < at || (index === at && phrase.length > found.length))
      ) {
        at = index;
        found = phrase;
      }
    }

    if (at < 0) {
      pieces.push({ text: rest, keepTogether: false });
      break;
    }

    if (at > 0) {
      pieces.push({ text: rest.slice(0, at), keepTogether: false });
    }

    pieces.push({ text: found, keepTogether: true });
    rest = rest.slice(at + found.length);
  }

  return pieces;
}

/*
 * "Ana, Bob and Carl", joined in the language of the sentence it goes into
 * (formatNameList).
 */
function names(list: Array<string>): ComposedValue {
  return composedValue((sentence: Translator): string => {
    return formatNameList(list, "and", sentence);
  });
}

/*
 * "6:40 PM GMT" - when the policy moves on, on the reader's own clock. A
 * level's wait is minutes away, so on the same day the time says it, and a
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
 * What escalating a page would do, or did, in the reader's language: the
 * Dashboard's words for the server's sentences (getOnCallPassOnSentence).
 * `now` is when it is read, for whether a time needs its date.
 */
export function describePassOnResult(
  result: OnCallPassOnResult,
  translator: Translator,
  now?: Date | undefined,
): string {
  const level: ComposedValue | null = levelValue(result.rule, result.ruleCount);

  switch (result.outcome) {
    case OnCallPassOnOutcome.NextRulePaged: {
      if (result.isPreview) {
        return level
          ? translator.translateTemplate(
              "This will immediately page {{level}}, without waiting.",
              { level: level },
            )
          : translator.translateTemplate(
              "This will immediately page the next level, without waiting.",
            );
      }

      if (!level) {
        return translator.translateTemplate(
          "The policy is now paging the next level.",
        );
      }

      return result.pagedNames.length > 0
        ? translator.translateTemplate(
            "The policy is now paging {{level}}: {{names}}.",
            { level: level, names: names(result.pagedNames) },
          )
        : translator.translateTemplate("The policy is now paging {{level}}.", {
            level: level,
          });
    }
    case OnCallPassOnOutcome.PolicyStartedAgain: {
      if (result.isPreview) {
        return level
          ? translator.translateTemplate(
              "There is no level after yours, so this will immediately page {{level}} again, without waiting.",
              { level: level },
            )
          : translator.translateTemplate(
              "There is no level after yours, so this will immediately page the first level again, without waiting.",
            );
      }

      return level
        ? translator.translateTemplate(
            "There was no level after yours, so the policy started over and is paging {{level}} again.",
            { level: level },
          )
        : translator.translateTemplate(
            "There was no level after yours, so the policy started over and is paging the first level again.",
          );
    }
    case OnCallPassOnOutcome.OthersStillPaged: {
      const still: string = translator.translatePlural(
        {
          one: "{{names}} is still being paged.",
          other: "{{names}} are still being paged.",
        },
        Math.max(result.stillPagedNames.length, 1),
        { names: names(result.stillPagedNames) },
      );

      if (result.isDirectPage || !result.nextStepAt) {
        return still;
      }

      const next: ComposedValue | null = levelValue(
        result.nextRule,
        result.ruleCount,
      );
      const time: string = formatPassOnTime(result.nextStepAt, now);

      const then: string = next
        ? translator.translateTemplate(
            "If nobody acknowledges by {{time}}, the policy pages {{level}} next.",
            { level: next, time: time },
          )
        : translator.translateTemplate(
            "If nobody acknowledges by {{time}}, the policy moves on.",
            { time: time },
          );

      return `${still} ${then}`;
    }
    case OnCallPassOnOutcome.AlreadyEscalated:
      return level
        ? translator.translateTemplate(
            "The policy has moved on already and is paging {{level}} now.",
            { level: level },
          )
        : translator.translateTemplate(
            "The policy has moved on already and is paging a later level now.",
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

// Why a page could not be escalated, in the reader's language.
export function describePassOnRefusal(
  answer: OnCallPassOnAnswer,
  translator: Translator,
): string {
  switch (answer.refusal) {
    case OnCallPassOnRefusal.RecordAcknowledged:
      return (answer.acknowledgedByName || "").trim()
        ? translator.translateTemplate(
            "{{name}} acknowledged it already, so there is nothing to escalate.",
            { name: (answer.acknowledgedByName || "").trim() },
          )
        : translator.translateTemplate(
            "Somebody acknowledged it already, so there is nothing to escalate.",
          );
    case OnCallPassOnRefusal.AlreadyPassedOn:
      return translator.translateTemplate(
        "You escalated it already, so you will not be paged again for it.",
      );
    case OnCallPassOnRefusal.PageOver:
      return translator.translateTemplate(
        "This page is over: the on-call policy has stopped paging.",
      );
    // The level picked was not there to page: nothing changed.
    case OnCallPassOnRefusal.LevelNotAvailable:
      return translator.translateTemplate(
        "The policy's levels have changed, so nothing was escalated. Escalate again to pick a level.",
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
 * record, each is named before what escalating does there.
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

/*
 * What the dialog says before escalating: the person's own pages about it,
 * each with the level picked for it (`picks`; the next level without one),
 * and what that level skips.
 *
 * Beside a second policy's page, a sentence names its policy - "Payments:
 * This will immediately page ..." - unless the page asks which level to
 * page: its sentence is drawn right under its own levels, whose label names
 * the policy already ("Payments: escalate to").
 */
export function describePassOnPreview(
  pages: Array<OnCallOpenPage>,
  translator: Translator,
  picks: PassOnLevelPicks = {},
): Array<string> {
  return perPage(
    pages,
    (page: OnCallOpenPage): string => {
      const picked: {
        result: OnCallPassOnResult;
        skipped: Array<OnCallPassOnRule>;
      } = getPassOnPickedPreview(page, picks);
      const skips: string = describePassOnSkippedLevels(
        picked.skipped,
        picked.result.ruleCount,
        translator,
      );
      const sentence: string = describePassOnResult(picked.result, translator);

      return skips ? `${sentence} ${skips}` : sentence;
    },
    (page: OnCallOpenPage): string => {
      return getPassOnLevelChoices(page).length > 0
        ? ""
        : page.preview.policyName;
    },
    translator,
  );
}

/*
 * What the dialog keeps on one line before escalating: the places of the
 * levels each page names with the level picked - the one it pages, and the
 * ones it skips - and the time it moves on (getPassOnKeptTogether).
 */
export function getPassOnQuestionKeptTogether(
  pages: Array<OnCallOpenPage>,
  picks: PassOnLevelPicks,
  translator: Translator,
): Array<string> {
  const results: Array<OnCallPassOnResult> = [];

  for (const page of pages) {
    const picked: {
      result: OnCallPassOnResult;
      skipped: Array<OnCallPassOnRule>;
    } = getPassOnPickedPreview(page, picks);

    results.push(picked.result);

    for (const rule of picked.skipped) {
      results.push({ ...picked.result, rule: rule, nextStepAt: undefined });
    }
  }

  return getPassOnKeptTogether(results, translator);
}

// What the dialog says once it has escalated them - or why it could not.
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

// What escalating did, for each page it escalated.
export function getPassedOnResults(
  answers: Array<OnCallPassOnAnswer>,
): Array<OnCallPassOnResult> {
  const results: Array<OnCallPassOnResult> = [];

  for (const answer of answers) {
    if (answer.passedOn && answer.result) {
      results.push(answer.result);
    }
  }

  return results;
}

// Whether any of the answers escalated a page.
export function isAnyPassedOn(answers: Array<OnCallPassOnAnswer>): boolean {
  return answers.some((answer: OnCallPassOnAnswer): boolean => {
    return answer.passedOn;
  });
}

/*
 * Whether somebody took the record while the dialog asked: an answer
 * refused because it is acknowledged or resolved now ("Already
 * acknowledged"). The page shows it as it was when it was read - its
 * header still offers Acknowledge - so it reads it again.
 */
export function isRecordTakenMeanwhile(
  answers: Array<OnCallPassOnAnswer>,
): boolean {
  return answers.some((answer: OnCallPassOnAnswer): boolean => {
    return answer.refusal === OnCallPassOnRefusal.RecordAcknowledged;
  });
}

/*
 * A line of the dialog: a sentence, or - when escalating leaves nobody being
 * paged (isOnCallPassOnPagingStopped) - a warning, drawn apart and first.
 * Nobody is on the record then, and the person reading may decide to take
 * it after all.
 *
 * Before escalating, a page's own sentence says which page it is about (its
 * run, executionLogId): a page that asks which level to page draws its
 * levels right above it, so each pick sits over what it does.
 */
export interface PassOnDialogLine {
  text: string;
  isWarning: boolean;
  executionLogId?: string | undefined;
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

// "You will not be paged again for this incident."
function notPagedAgain(
  translator: Translator,
  recordType: OnCallPageRecordType,
): PassOnDialogLine {
  const text: string = getPassOnRecordText(recordType).notPagedAgain;

  return {
    text: translator.translateText(text) || text,
    isWarning: false,
  };
}

/*
 * What the dialog says before escalating, in the maintainer's order: what
 * escalating does on each of the person's pages, then that they are not
 * paged again for the record.
 */
export function getPassOnQuestionLines(
  pages: Array<OnCallOpenPage>,
  translator: Translator,
  recordType: OnCallPageRecordType,
  picks: PassOnLevelPicks = {},
): Array<PassOnDialogLine> {
  const sentences: Array<string> = describePassOnPreview(
    pages,
    translator,
    picks,
  );

  return warningsFirst([
    ...sentences.map((text: string, index: number): PassOnDialogLine => {
      const page: OnCallOpenPage | undefined = pages[index];

      return {
        text: text,
        isWarning: Boolean(page && isOnCallPassOnPagingStopped(page.preview)),
        ...(page ? { executionLogId: page.executionLogId } : {}),
      };
    }),
    notPagedAgain(translator, recordType),
  ]);
}

/*
 * What the dialog says once it has escalated them: what came of each page -
 * or why there was nothing to escalate - and, when it escalated any, that
 * the person is not paged again for the record.
 */
export function getPassOnAnswerLines(
  answers: Array<OnCallPassOnAnswer>,
  translator: Translator,
  recordType: OnCallPageRecordType,
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
    lines.push(notPagedAgain(translator, recordType));
  }

  return warningsFirst(lines);
}

/*
 * The dialog's title once it has asked the server: "Incident escalated", or,
 * when nothing was escalated, why in a few words - "Already acknowledged",
 * "Already escalated", "Nothing to escalate" - with the sentence under it
 * saying the rest.
 */
export function getPassOnAnswerTitle(
  answers: Array<OnCallPassOnAnswer>,
  recordType: OnCallPageRecordType,
): string {
  if (isAnyPassedOn(answers)) {
    return getPassOnRecordText(recordType).doneTitle;
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

  if (everyOne(OnCallPassOnRefusal.LevelNotAvailable)) {
    return PASS_ON_PAGE_TEXT.notEscalatedTitle;
  }

  return PASS_ON_PAGE_TEXT.nothingToPassOnTitle;
}
