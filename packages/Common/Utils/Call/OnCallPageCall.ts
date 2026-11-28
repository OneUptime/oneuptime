import URL from "../../Types/API/URL";
import { ONEUPTIME_PRODUCT_NAME } from "../../Types/Branding/ProductBranding";
import {
  CallRequestMessage,
  GatherInput,
  Say,
} from "../../Types/Call/CallRequest";
import {
  OnCallPageAgainNotice,
  describeOnCallAcknowledgementTimeout,
  getOnCallPageAgainCallSentence,
} from "../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  OnCallObserverPageRecordKind,
  getOnCallObserverPageCallAnswered,
  getOnCallObserverPageCallPrompt,
  getOnCallObserverPageCallSentence,
  getOnCallObserverPageSpokenNotice,
} from "../../Types/OnCallDutyPolicy/OnCallObserverPage";
import {
  OnCallPageKind,
  getEnglishPageTranslator,
  getOnCallPageSmsWords,
  getOnCallPageStateName,
} from "../../Types/OnCallDutyPolicy/OnCallPageWords";
import { ON_CALL_PAGE_CALL_PASS_ON_DIGIT } from "../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  OnCallPersonPageNotice,
  getOnCallPersonPageCallMessage,
  getOnCallPersonPageCallSentence,
  getOnCallPersonPagePager,
} from "../../Types/OnCallDutyPolicy/OnCallPersonPage";
import {
  composedValue,
  DEFAULT_LANGUAGE,
  getBaseLanguage,
  translationKey,
  TemplateValue,
  Translator,
} from "../../Types/Translator";
import { StateListType } from "../StateOrder";
import { OnCallPageSmsKind, describeWhatHappened } from "../Sms/OnCallPageSms";
import { cutForSpeech } from "./CallSpeech";

/*
 * WHAT AN ON-CALL PAGE'S CALL SAYS (#10762).
 *
 * Somebody paged by a call picks up, often asleep, and needs to know three
 * things before anything else: who calls, how bad it is and which one, and
 * which key does what. So a call says them first, and the title after:
 *
 *   This is a call from Acme Production.
 *   A new Critical Incident has been created: I N C 42.
 *   Press 1 to acknowledge, or 2 to escalate.
 *   Checkout API is down for customers in Europe.
 *   (5 seconds, listening for a key)
 *   A new Critical Incident has been created: I N C 42.
 *   Checkout API is down for customers in Europe.
 *   Press 1 to acknowledge, or 2 to escalate.
 *   (10 seconds)
 *   You did not press a key, so this incident is not acknowledged. Good bye.
 *
 * A key pressed at any moment answers the call: it is all said inside the
 * call's <Gather> (Notification service, CallService), and 1 and 2 answer
 * exactly as they always have. Any other key is answered "That key does
 * nothing." and the prompt is said again, as often as the call asks when no
 * key is pressed (Utils/Call/CallKeypad, #10949).
 *
 *   - Who calls: the project, by its name, which the people it pages know -
 *     an installation's product name may be one they have never heard. A
 *     call with no project name names the product: OneUptime, or the name the
 *     installation goes by (ProductBrandingText).
 *   - How bad and which one: the severity with what happened, as a text
 *     message says it ("Critical Incident", not "Critical Incident
 *     incident" - describeWhatHappened), and the number, whose prefix is
 *     said letter by letter: "INC" read as written is "Incorporated"
 *     (Utils/Call/CallSpeech). A page again, a person's page and an
 *     observer's page say what they are first, then the record:
 *     "Alice Kim paged you about an incident: Critical Incident I N C 42."
 *   - The title, after the prompt, cut at a word boundary to about 100
 *     characters: a title of 500 characters kept the keys 30 seconds away.
 *   - The details and the prompt said again, after a pause: a person who
 *     missed them the first time hears them once more.
 *
 * IN THE LANGUAGE OF THE PERSON IT CALLS (#11066). A page's texts, emails
 * and pushes are written in the person's language (Types/UserLanguage), and
 * so is its call, with `translator` - OneUptime's own words, that is: what
 * the team wrote (a title, a project's name, a person's message) is said as
 * written, and OneUptime's default severities in the language, as a text
 * message says them (OnCallPageWords). Each sentence is whole for each kind
 * of record, so a language words "this incident" and "this alert" its own
 * way; every key goes into a sentence as its digit, so no language asks for
 * another key than the one that works. In another language the call says
 * what the page is, then the record on its own - each language puts its
 * words around the record its own way:
 *
 *   Dies ist ein Anruf von Acme Production.
 *   Ein neuer Vorfall wurde erstellt.
 *   Kritischer Vorfall I N C 42.
 *   Drücken Sie 1, um zu bestätigen, oder 2, um zu eskalieren.
 *
 * A call written in another language is spoken by a voice of that language,
 * and only by one (Types/Call/CallVoice): the Notification service speaks
 * the English call where the account that places it has none.
 *
 * Without a translator, or with English's, the call is English, word for
 * word as it always was.
 *
 * Pure, with no Node, browser or database APIs.
 */

// The key that acknowledges a page, as the keypad route reads it.
export const ON_CALL_PAGE_CALL_ACKNOWLEDGE_DIGIT: string = "1";

/*
 * What a responder's call asks for: both keys, in one sentence, each key
 * its digit in every language.
 */
export const ON_CALL_PAGE_CALL_PROMPT_TEMPLATE: string = translationKey(
  "Press {{acknowledgeKey}} to acknowledge, or {{escalateKey}} to escalate.",
);

// The prompt in English: "Press 1 to acknowledge, or 2 to escalate."
export const ON_CALL_PAGE_CALL_PROMPT: string = `Press ${ON_CALL_PAGE_CALL_ACKNOWLEDGE_DIGIT} to acknowledge, or ${ON_CALL_PAGE_CALL_PASS_ON_DIGIT} to escalate.`;

// What an observer's call says when no key was pressed: there is nothing to acknowledge.
export const ON_CALL_OBSERVER_PAGE_CALL_NO_INPUT: string = translationKey(
  "You did not press a key, so this page is not marked as heard. Good bye.",
);

/*
 * What an observer's call says to a wrong key once it has asked again as
 * often as it may (Utils/Call/CallKeypad), before it ends.
 */
export const ON_CALL_OBSERVER_PAGE_CALL_WRONG_KEY: string = translationKey(
  "That key does nothing, so this page is not marked as heard. Good bye.",
);

// How long a call waits for a key once it has said everything twice.
export const ON_CALL_PAGE_CALL_TIMEOUT_IN_SECONDS: number = 10;

// Who the call is from, in every language.
const OPENING: string = translationKey("This is a call from {{project}}.");

// The kind of record a page is about, as the text message names it.
const SMS_KIND_OF_RECORD: Readonly<
  Record<OnCallObserverPageRecordKind, OnCallPageSmsKind>
> = {
  incident: OnCallPageSmsKind.Incident,
  alert: OnCallPageSmsKind.Alert,
  "incident episode": OnCallPageSmsKind.IncidentEpisode,
  "alert episode": OnCallPageSmsKind.AlertEpisode,
};

// The kind of record a page is about, as its other messages name it.
const PAGE_KIND_OF_RECORD: Readonly<
  Record<OnCallObserverPageRecordKind, OnCallPageKind>
> = {
  incident: OnCallPageKind.Incident,
  alert: OnCallPageKind.Alert,
  "incident episode": OnCallPageKind.IncidentEpisode,
  "alert episode": OnCallPageKind.AlertEpisode,
};

// The list a record's severity comes from: incidents' for an incident and its episodes.
const SEVERITY_LIST_OF_RECORD: Readonly<
  Record<
    OnCallObserverPageRecordKind,
    StateListType.IncidentSeverity | StateListType.AlertSeverity
  >
> = {
  incident: StateListType.IncidentSeverity,
  alert: StateListType.AlertSeverity,
  "incident episode": StateListType.IncidentSeverity,
  "alert episode": StateListType.AlertSeverity,
};

/*
 * Every sentence a page's call says about one kind of record, each whole,
 * so a language words "this incident" and "this alert" its own way. The
 * English of the answers is the call's English, word for word; the leads
 * are what a call in another language says before its record
 * (getOnCallPageCallLeadInLanguage) - English says those its own way
 * (getOnCallPageCallHeadline).
 */
interface CallKindWords {
  // What the call says when no key was pressed, before it ends.
  noInput: string;
  // What it says to a wrong key once it may ask no more.
  wrongKey: string;
  // What it says once 1 is pressed.
  acknowledged: string;
  // A first page: what happened.
  created: string;
  // An observer's page, OneUptime's own.
  observer: string;
  // A person's page, by whom it was paged: the person, a team, a schedule.
  pagedYou: string;
  pagedTeam: string;
  pagedSchedule: string;
  // An on-call policy a person started by hand.
  startedPolicy: string;
  // The same three and the policy, paged as an observer.
  observerPagedYou: string;
  observerPagedTeam: string;
  observerPagedSchedule: string;
  observerStartedPolicy: string;
  // A page again, with the policy's timeout and without it.
  stillNotResolvedAfter: string;
  stillNotResolved: string;
}

const CALL_KIND_WORDS: Readonly<
  Record<OnCallObserverPageRecordKind, CallKindWords>
> = {
  incident: {
    noInput: translationKey(
      "You did not press a key, so this incident is not acknowledged. Good bye.",
    ),
    wrongKey: translationKey(
      "That key does nothing, so this incident is not acknowledged. Good bye.",
    ),
    acknowledged: translationKey(
      "You have acknowledged this incident. Good bye",
    ),
    created: translationKey("A new incident has been created."),
    observer: translationKey("You are paged as an observer about an incident."),
    pagedYou: translationKey("{{pager}} paged you about an incident."),
    pagedTeam: translationKey("{{pager}} paged {{team}} about an incident."),
    pagedSchedule: translationKey(
      "{{pager}} paged whoever is on call in {{schedule}} about an incident.",
    ),
    startedPolicy: translationKey(
      "{{pager}} started the on-call policy {{policy}} for an incident.",
    ),
    observerPagedYou: translationKey(
      "{{pager}} paged you about an incident, as an observer.",
    ),
    observerPagedTeam: translationKey(
      "{{pager}} paged {{team}} about an incident, as observers.",
    ),
    observerPagedSchedule: translationKey(
      "{{pager}} paged whoever is on call in {{schedule}} about an incident, as an observer.",
    ),
    observerStartedPolicy: translationKey(
      "{{pager}} started the on-call policy {{policy}} for an incident, as an observer.",
    ),
    stillNotResolvedAfter: translationKey(
      "An incident is still not resolved {{duration}} after it was acknowledged.",
    ),
    stillNotResolved: translationKey(
      "An incident is still not resolved after it was acknowledged.",
    ),
  },
  alert: {
    noInput: translationKey(
      "You did not press a key, so this alert is not acknowledged. Good bye.",
    ),
    wrongKey: translationKey(
      "That key does nothing, so this alert is not acknowledged. Good bye.",
    ),
    acknowledged: translationKey("You have acknowledged this alert. Good bye"),
    created: translationKey("A new alert has been created."),
    observer: translationKey("You are paged as an observer about an alert."),
    pagedYou: translationKey("{{pager}} paged you about an alert."),
    pagedTeam: translationKey("{{pager}} paged {{team}} about an alert."),
    pagedSchedule: translationKey(
      "{{pager}} paged whoever is on call in {{schedule}} about an alert.",
    ),
    startedPolicy: translationKey(
      "{{pager}} started the on-call policy {{policy}} for an alert.",
    ),
    observerPagedYou: translationKey(
      "{{pager}} paged you about an alert, as an observer.",
    ),
    observerPagedTeam: translationKey(
      "{{pager}} paged {{team}} about an alert, as observers.",
    ),
    observerPagedSchedule: translationKey(
      "{{pager}} paged whoever is on call in {{schedule}} about an alert, as an observer.",
    ),
    observerStartedPolicy: translationKey(
      "{{pager}} started the on-call policy {{policy}} for an alert, as an observer.",
    ),
    stillNotResolvedAfter: translationKey(
      "An alert is still not resolved {{duration}} after it was acknowledged.",
    ),
    stillNotResolved: translationKey(
      "An alert is still not resolved after it was acknowledged.",
    ),
  },
  "incident episode": {
    noInput: translationKey(
      "You did not press a key, so this incident episode is not acknowledged. Good bye.",
    ),
    wrongKey: translationKey(
      "That key does nothing, so this incident episode is not acknowledged. Good bye.",
    ),
    acknowledged: translationKey(
      "You have acknowledged this incident episode. Good bye",
    ),
    created: translationKey("A new incident episode has been created."),
    observer: translationKey(
      "You are paged as an observer about an incident episode.",
    ),
    pagedYou: translationKey("{{pager}} paged you about an incident episode."),
    pagedTeam: translationKey(
      "{{pager}} paged {{team}} about an incident episode.",
    ),
    pagedSchedule: translationKey(
      "{{pager}} paged whoever is on call in {{schedule}} about an incident episode.",
    ),
    startedPolicy: translationKey(
      "{{pager}} started the on-call policy {{policy}} for an incident episode.",
    ),
    observerPagedYou: translationKey(
      "{{pager}} paged you about an incident episode, as an observer.",
    ),
    observerPagedTeam: translationKey(
      "{{pager}} paged {{team}} about an incident episode, as observers.",
    ),
    observerPagedSchedule: translationKey(
      "{{pager}} paged whoever is on call in {{schedule}} about an incident episode, as an observer.",
    ),
    observerStartedPolicy: translationKey(
      "{{pager}} started the on-call policy {{policy}} for an incident episode, as an observer.",
    ),
    stillNotResolvedAfter: translationKey(
      "An incident episode is still not resolved {{duration}} after it was acknowledged.",
    ),
    stillNotResolved: translationKey(
      "An incident episode is still not resolved after it was acknowledged.",
    ),
  },
  "alert episode": {
    noInput: translationKey(
      "You did not press a key, so this alert episode is not acknowledged. Good bye.",
    ),
    wrongKey: translationKey(
      "That key does nothing, so this alert episode is not acknowledged. Good bye.",
    ),
    acknowledged: translationKey(
      "You have acknowledged this alert episode. Good bye",
    ),
    created: translationKey("A new alert episode has been created."),
    observer: translationKey(
      "You are paged as an observer about an alert episode.",
    ),
    pagedYou: translationKey("{{pager}} paged you about an alert episode."),
    pagedTeam: translationKey(
      "{{pager}} paged {{team}} about an alert episode.",
    ),
    pagedSchedule: translationKey(
      "{{pager}} paged whoever is on call in {{schedule}} about an alert episode.",
    ),
    startedPolicy: translationKey(
      "{{pager}} started the on-call policy {{policy}} for an alert episode.",
    ),
    observerPagedYou: translationKey(
      "{{pager}} paged you about an alert episode, as an observer.",
    ),
    observerPagedTeam: translationKey(
      "{{pager}} paged {{team}} about an alert episode, as observers.",
    ),
    observerPagedSchedule: translationKey(
      "{{pager}} paged whoever is on call in {{schedule}} about an alert episode, as an observer.",
    ),
    observerStartedPolicy: translationKey(
      "{{pager}} started the on-call policy {{policy}} for an alert episode, as an observer.",
    ),
    stillNotResolvedAfter: translationKey(
      "An alert episode is still not resolved {{duration}} after it was acknowledged.",
    ),
    stillNotResolved: translationKey(
      "An alert episode is still not resolved after it was acknowledged.",
    ),
  },
};

// What a page is about, as its call says it.
export interface OnCallPageCallRecord {
  noun: OnCallObserverPageRecordKind;
  // Its number with the project's prefix - "INC-42", "#42" - or none.
  number?: string | null | undefined;
  // Its severity's name, or none.
  severityName?: string | null | undefined;
  title?: string | null | undefined;
}

export interface OnCallPageCallInput {
  record: OnCallPageCallRecord;
  // The project the page is from: who the call says it is from.
  projectName?: string | null | undefined;
  // A page again (OnCallAcknowledgementTimeout): still not resolved.
  pageAgain?: OnCallPageAgainNotice | undefined;
  // A page a person asked for (OnCallPersonPage): who paged, and why.
  personPage?: OnCallPersonPageNotice | undefined;
  // An observer's page (OnCallObserverPage): kept informed, nothing to escalate.
  isObserverPage?: boolean | undefined;
  // Where the key pressed goes (OnCallPageLinks.getCallResponseUrl).
  responseUrl: URL;
}

const valueOf: (value: string | null | undefined) => string = (
  value: string | null | undefined,
): string => {
  return typeof value === "string" ? value.trim() : "";
};

// How a sentence ends: a full stop, a question or exclamation mark, a cut's "…".
const SENTENCE_END: RegExp = /[.!?…]$/;

// A sentence ended once: "Acme Inc." stays as it is.
const asSentence: (text: string) => string = (text: string): string => {
  return SENTENCE_END.test(text) ? text : `${text}.`;
};

/*
 * A sentence whose value ended it already, ended once: "a call from Acme
 * Inc.." is "a call from Acme Inc.", as asSentence leaves it.
 */
const ENDED_TWICE: RegExp = /([.!?…])\.$/;

const endedOnce: (text: string) => string = (text: string): string => {
  return text.replace(ENDED_TWICE, "$1");
};

/*
 * How each language ends a sentence that OneUptime's words do not end: a
 * record said on its own. Chinese and Japanese with their full stop, Hindi
 * with its danda, every other language with a full stop.
 */
const SENTENCE_END_MARKS: Readonly<Record<string, string>> = {
  ja: "。",
  zh: "。",
  hi: "।",
};

// Whatever already ends a sentence, in any of OneUptime's languages.
const ANY_SENTENCE_END: RegExp = /[.!?…。！？।؟]$/u;

const asSentenceInLanguage: (text: string, language: string) => string = (
  text: string,
  language: string,
): string => {
  if (!text || ANY_SENTENCE_END.test(text)) {
    return text;
  }

  return `${text}${SENTENCE_END_MARKS[getBaseLanguage(language)] || "."}`;
};

// A fixed sentence in a translator's language, or as written without one.
const say: (translator: Translator, sentence: string) => string = (
  translator: Translator,
  sentence: string,
): string => {
  return translator.translateText(sentence) || sentence;
};

// Whether a translator writes English: the call then reads as it always has.
const isEnglish: (translator: Translator | undefined) => boolean = (
  translator: Translator | undefined,
): boolean => {
  return (
    !translator || getBaseLanguage(translator.language) === DEFAULT_LANGUAGE
  );
};

/*
 * Who the call is from: "This is a call from Acme Production." - the
 * project, or the product for a call with no project name (OneUptime, which
 * an installation that goes by its own name says instead) - in the call's
 * language.
 */
export function getOnCallPageCallOpening(
  projectName: string | null | undefined,
  translator: Translator = getEnglishPageTranslator(),
): string {
  return endedOnce(
    translator.translateTemplate(OPENING, {
      project: valueOf(projectName) || ONEUPTIME_PRODUCT_NAME,
    }),
  );
}

// What a responder's call asks for, in the call's language: the keys are 1 and 2 in every one.
export function getOnCallPageCallPrompt(
  translator: Translator = getEnglishPageTranslator(),
): string {
  return translator.translateTemplate(ON_CALL_PAGE_CALL_PROMPT_TEMPLATE, {
    acknowledgeKey: ON_CALL_PAGE_CALL_ACKNOWLEDGE_DIGIT,
    escalateKey: ON_CALL_PAGE_CALL_PASS_ON_DIGIT,
  });
}

/*
 * The severity and what happened: "Critical Incident", "High alert", or the
 * record's kind alone without a severity - "incident".
 */
const describeRecordKind: (record: OnCallPageCallRecord) => string = (
  record: OnCallPageCallRecord,
): string => {
  const severityName: string = valueOf(record.severityName);

  return severityName
    ? describeWhatHappened({
        kind: SMS_KIND_OF_RECORD[record.noun],
        severityName: severityName,
      })
    : record.noun;
};

/*
 * The record, after what a page again, a person's page or an observer's
 * page says it is: "Critical Incident INC-42", "Incident INC-42",
 * "Critical Incident" - or nothing, for a record with neither a severity nor
 * a number, which the sentence before it names already.
 */
export function getOnCallPageCallRecordLabel(
  record: OnCallPageCallRecord,
): string {
  const severityName: string = valueOf(record.severityName);
  const number: string = valueOf(record.number);

  if (!severityName && !number) {
    return "";
  }

  const kind: string = describeRecordKind(record);
  const label: string = severityName
    ? kind
    : kind.charAt(0).toUpperCase() + kind.slice(1);

  return number ? `${label} ${number}` : label;
}

/*
 * The record in another language, as a text message names it
 * (OnCallPageWords): "Kritischer Vorfall INC-42", "Warnung ALR-7 (Hoch)",
 * "Vorfall INC-42" - OneUptime's default severities in the language, a
 * project's own as written. Nothing for a record with neither a severity
 * nor a number: the lead before it names its kind.
 */
export function getOnCallPageCallRecordLabelInLanguage(
  record: OnCallPageCallRecord,
  translator: Translator,
): string {
  const severityName: string = valueOf(record.severityName);
  const number: string = valueOf(record.number);

  if (!severityName && !number) {
    return "";
  }

  return getOnCallPageSmsWords(translator).record({
    kind: PAGE_KIND_OF_RECORD[record.noun],
    number: number,
    severityName: severityName
      ? getOnCallPageStateName(
          translator,
          SEVERITY_LIST_OF_RECORD[record.noun],
          severityName,
        )
      : "",
  });
}

/*
 * What happened, how bad and which one - the call's headline: "A new
 * Critical Incident has been created: INC-42." for a first page, and for
 * any other what it is, then the record: "An incident is still not resolved
 * 30 minutes after it was acknowledged: Critical Incident INC-42.". English:
 * a call in another language says it as getOnCallPageCallLeadInLanguage.
 */
export function getOnCallPageCallHeadline(
  input: Omit<OnCallPageCallInput, "responseUrl">,
): string {
  const record: OnCallPageCallRecord = input.record;
  const number: string = valueOf(record.number);

  let lead: string | null = null;

  if (input.isObserverPage) {
    lead = getOnCallObserverPageCallSentence({
      recordNoun: record.noun,
      personPage: input.personPage,
    });
  } else if (input.pageAgain) {
    lead = getOnCallPageAgainCallSentence({
      recordNoun: record.noun,
      notice: input.pageAgain,
    });
  } else if (input.personPage) {
    lead = getOnCallPersonPageCallSentence({
      recordNoun: record.noun,
      notice: input.personPage,
    });
  }

  if (lead === null) {
    return asSentence(
      `A new ${describeRecordKind(record)} has been created${number ? `: ${number}` : ""}`,
    );
  }

  const label: string = getOnCallPageCallRecordLabel(record);

  return asSentence(label ? `${lead}: ${label}` : lead);
}

// The minutes a page again says, when it says a number of them.
const getPageAgainMinutes: (notice: OnCallPageAgainNotice) => number | null = (
  notice: OnCallPageAgainNotice,
): number | null => {
  const minutes: number = Number(notice.minutes || 0);

  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
};

/*
 * What a person's page - or an on-call policy a person started by hand -
 * says it is, in another language: who paged whom, or who started which
 * policy, about what kind of record. As an observer when it is one.
 */
const getPersonPageLeadInLanguage: (data: {
  words: CallKindWords;
  notice: OnCallPersonPageNotice;
  isObserverPage: boolean;
  translator: Translator;
}) => string = (data: {
  words: CallKindWords;
  notice: OnCallPersonPageNotice;
  isObserverPage: boolean;
  translator: Translator;
}): string => {
  const words: CallKindWords = data.words;
  const pager: TemplateValue = getOnCallPersonPagePager(data.notice);
  const policyName: string = valueOf(data.notice.policyName);

  if (policyName) {
    return data.translator.translateTemplate(
      data.isObserverPage ? words.observerStartedPolicy : words.startedPolicy,
      { pager: pager, policy: policyName },
    );
  }

  const teamName: string = valueOf(data.notice.teamName);

  if (teamName) {
    return data.translator.translateTemplate(
      data.isObserverPage ? words.observerPagedTeam : words.pagedTeam,
      { pager: pager, team: teamName },
    );
  }

  const scheduleName: string = valueOf(data.notice.scheduleName);

  if (scheduleName) {
    return data.translator.translateTemplate(
      data.isObserverPage ? words.observerPagedSchedule : words.pagedSchedule,
      { pager: pager, schedule: scheduleName },
    );
  }

  return data.translator.translateTemplate(
    data.isObserverPage ? words.observerPagedYou : words.pagedYou,
    { pager: pager },
  );
};

/*
 * What a page is, in another language - the first sentence of its
 * headline, the record said after it on its own: "Ein neuer Vorfall wurde
 * erstellt.", "Alice Kim hat Sie wegen eines Vorfalls alarmiert.", "Ein
 * Vorfall ist 30 Minuten nach seiner Bestätigung noch immer nicht gelöst."
 */
export function getOnCallPageCallLeadInLanguage(
  input: Omit<OnCallPageCallInput, "responseUrl">,
  translator: Translator,
): string {
  const words: CallKindWords = CALL_KIND_WORDS[input.record.noun];

  if (input.isObserverPage) {
    return input.personPage
      ? getPersonPageLeadInLanguage({
          words: words,
          notice: input.personPage,
          isObserverPage: true,
          translator: translator,
        })
      : say(translator, words.observer);
  }

  if (input.pageAgain) {
    const minutes: number | null = getPageAgainMinutes(input.pageAgain);

    return minutes === null
      ? say(translator, words.stillNotResolved)
      : translator.translateTemplate(words.stillNotResolvedAfter, {
          duration: composedValue((sentence: Translator): string => {
            return describeOnCallAcknowledgementTimeout(minutes, sentence);
          }),
        });
  }

  if (input.personPage) {
    return getPersonPageLeadInLanguage({
      words: words,
      notice: input.personPage,
      isObserverPage: false,
      translator: translator,
    });
  }

  return say(translator, words.created);
}

// What a responder's call says when no key was pressed, before it ends.
export function getOnCallPageCallNoInputMessage(
  noun: OnCallObserverPageRecordKind,
  translator: Translator = getEnglishPageTranslator(),
): string {
  return say(translator, CALL_KIND_WORDS[noun].noInput);
}

/*
 * What a responder's call says to a wrong key once it has asked again as
 * often as it may (Utils/Call/CallKeypad), before it ends: the page is left
 * as it was. A keypad route of the release before, which asks nothing
 * again, says it to the first wrong key, as it reads it from the call.
 */
export function getOnCallPageCallWrongKeyMessage(
  noun: OnCallObserverPageRecordKind,
  translator: Translator = getEnglishPageTranslator(),
): string {
  return say(translator, CALL_KIND_WORDS[noun].wrongKey);
}

// What a responder's call says once 1 is pressed: as it always has.
export function getOnCallPageCallAcknowledgedMessage(
  noun: OnCallObserverPageRecordKind,
  translator: Translator = getEnglishPageTranslator(),
): string {
  return say(translator, CALL_KIND_WORDS[noun].acknowledged);
}

// What an observer's call says when no key was pressed, in the call's language.
export function getOnCallObserverPageCallNoInputMessage(
  translator: Translator = getEnglishPageTranslator(),
): string {
  return say(translator, ON_CALL_OBSERVER_PAGE_CALL_NO_INPUT);
}

// What an observer's call says to a wrong key once it may ask no more.
export function getOnCallObserverPageCallWrongKeyMessage(
  translator: Translator = getEnglishPageTranslator(),
): string {
  return say(translator, ON_CALL_OBSERVER_PAGE_CALL_WRONG_KEY);
}

/*
 * The sentences of the headline: English's one sentence - "A new Critical
 * Incident has been created: INC-42." - or, in another language, what the
 * page is and then the record on its own. Each is said again with the
 * prompt; the one that names the record's number carries it, so its prefix
 * is spelled.
 */
const getHeadlineSentences: (
  input: OnCallPageCallInput,
  translator: Translator,
) => Array<Say> = (
  input: OnCallPageCallInput,
  translator: Translator,
): Array<Say> => {
  const number: string = valueOf(input.record.number);

  if (isEnglish(translator)) {
    return [
      {
        sayMessage: getOnCallPageCallHeadline(input),
        ...(number ? { recordNumber: number } : {}),
        repeated: true,
      },
    ];
  }

  const sentences: Array<Say> = [
    {
      sayMessage: getOnCallPageCallLeadInLanguage(input, translator),
      repeated: true,
    },
  ];

  const label: string = getOnCallPageCallRecordLabelInLanguage(
    input.record,
    translator,
  );

  if (label) {
    sentences.push({
      sayMessage: asSentenceInLanguage(label, translator.language),
      ...(number ? { recordNumber: number } : {}),
      repeated: true,
    });
  }

  return sentences;
};

/*
 * Everything an on-call page's call says, and its prompt for a key, as a
 * call request carries them - in `translator`'s language, English without
 * one. In this order, so a Notification service of the release before -
 * which says each sentence in order, then the prompt - still says all of
 * it: who calls; the headline, said again with the prompt; an observer's
 * notice; the title and a person's message, said after the prompt the
 * first time, and the title again with it.
 */
export function buildOnCallPageCallData(
  input: OnCallPageCallInput,
  translator: Translator = getEnglishPageTranslator(),
): CallRequestMessage["data"] {
  const record: OnCallPageCallRecord = input.record;
  const title: string = cutForSpeech(valueOf(record.title));
  const personMessage: string = input.personPage
    ? getOnCallPersonPageCallMessage(input.personPage, translator)
    : "";

  const sentences: Array<Say> = [
    { sayMessage: getOnCallPageCallOpening(input.projectName, translator) },
    ...getHeadlineSentences(input, translator),
  ];

  if (input.isObserverPage) {
    sentences.push({
      sayMessage: getOnCallObserverPageSpokenNotice(record.noun, translator),
    });
  }

  if (title) {
    sentences.push({ sayMessage: title, afterPrompt: true, repeated: true });
  }

  if (personMessage) {
    sentences.push({ sayMessage: personMessage, afterPrompt: true });
  }

  const prompt: GatherInput = {
    introMessage: input.isObserverPage
      ? getOnCallObserverPageCallPrompt(record.noun, translator)
      : getOnCallPageCallPrompt(translator),
    numDigits: 1,
    timeoutInSeconds: ON_CALL_PAGE_CALL_TIMEOUT_IN_SECONDS,
    noInputMessage: input.isObserverPage
      ? getOnCallObserverPageCallNoInputMessage(translator)
      : getOnCallPageCallNoInputMessage(record.noun, translator),
    onInputCallRequest: {
      [ON_CALL_PAGE_CALL_ACKNOWLEDGE_DIGIT]: {
        sayMessage: input.isObserverPage
          ? getOnCallObserverPageCallAnswered(translator)
          : getOnCallPageCallAcknowledgedMessage(record.noun, translator),
      },
      /*
       * A wrong key is asked again (Utils/Call/CallKeypad); this is what
       * the call says to one once it may ask no more.
       */
      default: {
        sayMessage: input.isObserverPage
          ? getOnCallObserverPageCallWrongKeyMessage(translator)
          : getOnCallPageCallWrongKeyMessage(record.noun, translator),
      },
    },
    /*
     * The call adds its own token, naming this notification
     * (OnCallKeypadToken): a key pressed answers this page only.
     */
    responseUrl: input.responseUrl,
  };

  return [...sentences, prompt];
}
