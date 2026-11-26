import URL from "../../Types/API/URL";
import { ONEUPTIME_PRODUCT_NAME } from "../../Types/Branding/ProductBranding";
import {
  CallRequestMessage,
  GatherInput,
  Say,
} from "../../Types/Call/CallRequest";
import {
  OnCallPageAgainNotice,
  getOnCallPageAgainCallSentence,
} from "../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  ON_CALL_OBSERVER_PAGE_CALL_ANSWERED,
  OnCallObserverPageRecordKind,
  getOnCallObserverPageCallPrompt,
  getOnCallObserverPageCallSentence,
  getOnCallObserverPageSpokenNotice,
} from "../../Types/OnCallDutyPolicy/OnCallObserverPage";
import { ON_CALL_PAGE_CALL_PASS_ON_DIGIT } from "../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  OnCallPersonPageNotice,
  getOnCallPersonPageCallMessage,
  getOnCallPersonPageCallSentence,
} from "../../Types/OnCallDutyPolicy/OnCallPersonPage";
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
 * A call is in English, as every call is: the voice speaks English.
 *
 * Pure, with no Node, browser or database APIs.
 */

// The key that acknowledges a page, as the keypad route reads it.
export const ON_CALL_PAGE_CALL_ACKNOWLEDGE_DIGIT: string = "1";

// What a responder's call asks for: both keys, in one sentence.
export const ON_CALL_PAGE_CALL_PROMPT: string = `Press ${ON_CALL_PAGE_CALL_ACKNOWLEDGE_DIGIT} to acknowledge, or ${ON_CALL_PAGE_CALL_PASS_ON_DIGIT} to escalate.`;

// What an observer's call says when no key was pressed: there is nothing to acknowledge.
export const ON_CALL_OBSERVER_PAGE_CALL_NO_INPUT: string =
  "You did not press a key, so this page is not marked as heard. Good bye.";

/*
 * What an observer's call says to a wrong key once it has asked again as
 * often as it may (Utils/Call/CallKeypad), before it ends.
 */
export const ON_CALL_OBSERVER_PAGE_CALL_WRONG_KEY: string =
  "That key does nothing, so this page is not marked as heard. Good bye.";

// How long a call waits for a key once it has said everything twice.
export const ON_CALL_PAGE_CALL_TIMEOUT_IN_SECONDS: number = 10;

// The kind of record a page is about, as the text message names it.
const SMS_KIND_OF_RECORD: Readonly<
  Record<OnCallObserverPageRecordKind, OnCallPageSmsKind>
> = {
  incident: OnCallPageSmsKind.Incident,
  alert: OnCallPageSmsKind.Alert,
  "incident episode": OnCallPageSmsKind.IncidentEpisode,
  "alert episode": OnCallPageSmsKind.AlertEpisode,
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
 * Who the call is from: "This is a call from Acme Production." - the
 * project, or the product for a call with no project name (OneUptime, which
 * an installation that goes by its own name says instead).
 */
export function getOnCallPageCallOpening(
  projectName: string | null | undefined,
): string {
  return asSentence(
    `This is a call from ${valueOf(projectName) || ONEUPTIME_PRODUCT_NAME}`,
  );
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
 * What happened, how bad and which one - the call's headline: "A new
 * Critical Incident has been created: INC-42." for a first page, and for
 * any other what it is, then the record: "An incident is still not resolved
 * 30 minutes after it was acknowledged: Critical Incident INC-42.".
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

// What a responder's call says when no key was pressed, before it ends.
export function getOnCallPageCallNoInputMessage(
  noun: OnCallObserverPageRecordKind,
): string {
  return `You did not press a key, so this ${noun} is not acknowledged. Good bye.`;
}

/*
 * What a responder's call says to a wrong key once it has asked again as
 * often as it may (Utils/Call/CallKeypad), before it ends: the page is left
 * as it was. A keypad route of the release before, which asks nothing
 * again, says it to the first wrong key, as it reads it from the call.
 */
export function getOnCallPageCallWrongKeyMessage(
  noun: OnCallObserverPageRecordKind,
): string {
  return `That key does nothing, so this ${noun} is not acknowledged. Good bye.`;
}

// What a responder's call says once 1 is pressed: as it always has.
export function getOnCallPageCallAcknowledgedMessage(
  noun: OnCallObserverPageRecordKind,
): string {
  return `You have acknowledged this ${noun}. Good bye`;
}

/*
 * Everything an on-call page's call says, and its prompt for a key, as a
 * call request carries them. In this order, so a Notification service of
 * the release before - which says each sentence in order, then the prompt -
 * still says all of it: who calls; the headline, said again with the
 * prompt; an observer's notice; the title and a person's message, said
 * after the prompt the first time, and the title again with it.
 */
export function buildOnCallPageCallData(
  input: OnCallPageCallInput,
): CallRequestMessage["data"] {
  const record: OnCallPageCallRecord = input.record;
  const number: string = valueOf(record.number);
  const title: string = cutForSpeech(valueOf(record.title));
  const personMessage: string = input.personPage
    ? getOnCallPersonPageCallMessage(input.personPage)
    : "";

  const sentences: Array<Say> = [
    { sayMessage: getOnCallPageCallOpening(input.projectName) },
    {
      sayMessage: getOnCallPageCallHeadline(input),
      ...(number ? { recordNumber: number } : {}),
      repeated: true,
    },
  ];

  if (input.isObserverPage) {
    sentences.push({
      sayMessage: getOnCallObserverPageSpokenNotice(record.noun),
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
      ? getOnCallObserverPageCallPrompt(record.noun)
      : ON_CALL_PAGE_CALL_PROMPT,
    numDigits: 1,
    timeoutInSeconds: ON_CALL_PAGE_CALL_TIMEOUT_IN_SECONDS,
    noInputMessage: input.isObserverPage
      ? ON_CALL_OBSERVER_PAGE_CALL_NO_INPUT
      : getOnCallPageCallNoInputMessage(record.noun),
    onInputCallRequest: {
      [ON_CALL_PAGE_CALL_ACKNOWLEDGE_DIGIT]: {
        sayMessage: input.isObserverPage
          ? ON_CALL_OBSERVER_PAGE_CALL_ANSWERED
          : getOnCallPageCallAcknowledgedMessage(record.noun),
      },
      /*
       * A wrong key is asked again (Utils/Call/CallKeypad); this is what
       * the call says to one once it may ask no more.
       */
      default: {
        sayMessage: input.isObserverPage
          ? ON_CALL_OBSERVER_PAGE_CALL_WRONG_KEY
          : getOnCallPageCallWrongKeyMessage(record.noun),
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
