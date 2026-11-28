import {
  CallVoice,
  CallVoiceGender,
  SpokenCallVoice,
  getCallVoice,
  getCallVoiceCentsOfAPage,
  getCallVoiceForLanguage,
} from "../../../Types/Call/CallVoice";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  DashboardLanguage,
  SUPPORTED_DASHBOARD_LANGUAGES,
} from "../../../Types/Dashboard/DashboardLanguage";
import IconProp from "../../../Types/Icon/IconProp";
import {
  getReadingDirection,
  setApartInSentence,
} from "../../../Types/ReadingDirection";
import {
  Translator,
  getInlineSeparator,
  translationKey,
} from "../../../Types/Translator";
import {
  ON_CALL_PAGE_CALL_PROMPT,
  getOnCallPageCallHeadline,
  getOnCallPageCallOpening,
} from "../../../Utils/Call/OnCallPageCall";
import useTranslator from "../../Utils/UseTranslator";
import Button, { ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import {
  CALL_VOICE_DEFAULT_LABEL,
  getCallVoiceDescription,
  joinCallVoiceFacts,
} from "./CallVoiceOptions";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * UNDER THE CALL VOICE PICKER: THE VOICE CHOSEN, A SHORT SAMPLE OF WHAT IT
 * SAYS, THE LANGUAGES IT SPEAKS, WHAT IT COSTS AND HOW TO HEAR IT (#10948,
 * #11066).
 *
 * Which voice is chosen and how it sounds; the first lines a page's call
 * says in English, the voice's own language - written by the call's own
 * builder, so never translated; that a call to a person who reads another
 * language speaks it, in that language's voice of the same kind - and,
 * folded away, which voice that is for each language, Persian's English
 * among them; what the voices cost; and how to hear one: a test call,
 * once it is saved. With no voice chosen, it says calls are in English,
 * and what choosing a voice brings. It follows the picker as the person
 * changes it.
 */

// Who a sample call is from, when the page knows no project.
export const CALL_VOICE_SAMPLE_PROJECT_NAME: string = "Acme Production";

export const CALL_VOICE_SAMPLE_LABEL: string = translationKey(
  "A page's call in English starts like this:",
);

/*
 * What a call in another language does (#11066), by the kind of voice
 * chosen: each language speaks with its own voice of that kind.
 */
export const CALL_VOICE_LANGUAGES_SENTENCES: Readonly<
  Record<CallVoiceGender, string>
> = {
  [CallVoiceGender.Female]: translationKey(
    "Calls to people who read OneUptime in another language speak it, in a woman's voice of that language.",
  ),
  [CallVoiceGender.Male]: translationKey(
    "Calls to people who read OneUptime in another language speak it, in a man's voice of that language.",
  ),
};

// What a call says with no voice chosen: English, whoever it calls.
export const CALL_VOICE_DEFAULT_LANGUAGES_SENTENCE: string = translationKey(
  "Calls are in English: your Twilio account's default voice speaks no other language. Choose a voice to call people in the language they read OneUptime in.",
);

// The fold that names each language's voice, as it opens and as it closes.
export const CALL_VOICE_SHOW_LANGUAGES: string = translationKey(
  "Show each language's voice",
);

export const CALL_VOICE_HIDE_LANGUAGES: string = translationKey(
  "Hide each language's voice",
);

// A language no provider has a voice for (Persian): its calls are English.
export const CALL_VOICE_NO_LANGUAGE_VOICE: string = translationKey(
  "In English: no voice speaks it",
);

// What the voices cost, under the sample: the most a page's call costs, in any language.
export const CALL_VOICE_COST_SENTENCE: string = translationKey(
  "Twilio charges extra for these voices: under {{cents}} US cents for each page's call, in any language.",
);

// What the account's default voice costs, and what Twilio says of it.
export const CALL_VOICE_DEFAULT_COST_SENTENCE: string = translationKey(
  "Free. Twilio says its Basic voices are not meant for production.",
);

export const CALL_VOICE_HEAR_IT_SENTENCE: string = translationKey(
  "Save, then send a test call to hear it.",
);

// For a voice calls already speak with, which nothing here saves (GLOBAL_TWILIO_CALL_VOICE, #11064).
export const CALL_VOICE_HEAR_IT_NOW_SENTENCE: string = translationKey(
  "Send a test call to hear it.",
);

// The record the sample call is about.
export const CALL_VOICE_SAMPLE_RECORD_NUMBER: string = "INC-42";

export const CALL_VOICE_LANGUAGES_TEST_ID: string = "call-voice-languages";

/*
 * The first lines of a page's call, as the call says them: who calls, what
 * happened and its number, and the keys (Utils/Call/OnCallPageCall).
 */
export function getCallVoiceSampleSentence(projectName?: string): string {
  return [
    getOnCallPageCallOpening(projectName || CALL_VOICE_SAMPLE_PROJECT_NAME),
    getOnCallPageCallHeadline({
      record: {
        noun: "incident",
        number: CALL_VOICE_SAMPLE_RECORD_NUMBER,
        severityName: "Critical Incident",
      },
    }),
    ON_CALL_PAGE_CALL_PROMPT,
  ].join(" ");
}

// A language OneUptime writes in besides English, and the voice its calls speak with.
export interface CallVoiceOfLanguage {
  language: DashboardLanguage;
  // None: no provider has a voice for it, and its calls are in English.
  voice: SpokenCallVoice | null;
}

/*
 * Every language OneUptime writes in besides English, in the order its
 * language picker lists them, with the voice a call to a person who reads
 * it speaks with when `chosen` is the account's voice (getCallVoiceForLanguage).
 */
export function getCallVoicesOfLanguages(
  chosen: CallVoice,
): Array<CallVoiceOfLanguage> {
  return SUPPORTED_DASHBOARD_LANGUAGES.filter(
    (language: DashboardLanguage): boolean => {
      return language.code !== DEFAULT_DASHBOARD_LANGUAGE;
    },
  ).map((language: DashboardLanguage): CallVoiceOfLanguage => {
    return {
      language: language,
      voice: getCallVoiceForLanguage(chosen, language.code),
    };
  });
}

/*
 * The sample sentence with its record number kept on one line: a line may
 * otherwise break after the number's hyphen, "INC-" and "42". The number is
 * the headline's, after the opening - the last one, should a project's name
 * hold the same characters.
 */
const SampleSentence: FunctionComponent<{ sentence: string }> = (props: {
  sentence: string;
}): ReactElement => {
  const numberAt: number = props.sentence.lastIndexOf(
    CALL_VOICE_SAMPLE_RECORD_NUMBER,
  );

  if (numberAt < 0) {
    return <>{props.sentence}</>;
  }

  return (
    <>
      {props.sentence.slice(0, numberAt)}
      <span className="whitespace-nowrap">
        {CALL_VOICE_SAMPLE_RECORD_NUMBER}
      </span>
      {props.sentence.slice(numberAt + CALL_VOICE_SAMPLE_RECORD_NUMBER.length)}
    </>
  );
};

/*
 * Each language's voice: the language by its own name, as a language
 * picker names it, then the voice by its name and its maker - or, for a
 * language no provider has a voice for, that its calls are in English.
 */
const LanguageVoices: FunctionComponent<{
  chosen: CallVoice;
  translator: Translator;
}> = (props: { chosen: CallVoice; translator: Translator }): ReactElement => {
  return (
    <ul
      data-testid={`${CALL_VOICE_LANGUAGES_TEST_ID}-list`}
      className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2"
    >
      {getCallVoicesOfLanguages(props.chosen).map(
        (each: CallVoiceOfLanguage): ReactElement => {
          return (
            <li
              key={each.language.code}
              data-testid={`${CALL_VOICE_LANGUAGES_TEST_ID}-${each.language.code}`}
              className="flex min-w-0 items-baseline justify-between gap-3"
            >
              <span
                lang={each.language.code}
                dir={getReadingDirection(each.language.code)}
                className="text-gray-900"
              >
                {each.language.nativeName}
              </span>
              <span className="text-end text-gray-600">
                {each.voice
                  ? joinCallVoiceFacts(
                      [each.voice.name, each.voice.provider],
                      props.translator.language,
                    )
                  : props.translator.translateText(
                      CALL_VOICE_NO_LANGUAGE_VOICE,
                    )}
              </span>
            </li>
          );
        },
      )}
    </ul>
  );
};

export interface ComponentProps {
  // The voice picked, as the form holds it: a voice's value, or nothing.
  value: unknown;
  // Who the sample call is from: the project the config is for, if any.
  projectName?: string | undefined;
  /*
   * The voice calls speak with already, not one to save: an environment
   * variable sets it (#11064), so a test call says it as it is.
   */
  isInEffect?: boolean | undefined;
}

const CallVoiceSample: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const voice: CallVoice | null = getCallVoice(props.value);
  const [areLanguagesShown, setAreLanguagesShown] = useState<boolean>(false);

  return (
    <div
      data-testid="call-voice-sample"
      className="mt-3 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
    >
      <Icon
        icon={IconProp.SpeakerWave}
        className="mt-0.5 h-5 w-5 flex-none text-gray-500"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p
          data-testid="call-voice-sample-voice"
          className="text-sm font-medium text-gray-900"
        >
          {voice ? (
            <>
              <span>
                {setApartInSentence(
                  voice.name,
                  getReadingDirection(translator.language),
                )}
              </span>
              <span className="font-normal text-gray-600">
                {getInlineSeparator(translator.language)}
                {getCallVoiceDescription(voice, translator)}
              </span>
            </>
          ) : (
            translator.translateText(CALL_VOICE_DEFAULT_LABEL)
          )}
        </p>
        <div>
          <p className="text-xs font-medium text-gray-600">
            {translator.translateText(CALL_VOICE_SAMPLE_LABEL)}
          </p>
          <p
            data-testid="call-voice-sample-sentence"
            lang="en"
            dir="ltr"
            className="mt-1 text-sm italic text-gray-700"
          >
            &ldquo;
            <SampleSentence
              sentence={getCallVoiceSampleSentence(props.projectName)}
            />
            &rdquo;
          </p>
        </div>
        <div data-testid={CALL_VOICE_LANGUAGES_TEST_ID}>
          <p className="text-sm text-gray-600">
            {translator.translateText(
              voice
                ? CALL_VOICE_LANGUAGES_SENTENCES[voice.gender]
                : CALL_VOICE_DEFAULT_LANGUAGES_SENTENCE,
            )}
          </p>
          {voice ? (
            <>
              <Button
                className="-ms-3"
                dataTestId={`${CALL_VOICE_LANGUAGES_TEST_ID}-toggle`}
                buttonStyle={ButtonStyleType.SECONDARY_LINK}
                title={translator.translateText(
                  areLanguagesShown
                    ? CALL_VOICE_HIDE_LANGUAGES
                    : CALL_VOICE_SHOW_LANGUAGES,
                )}
                isTitleTranslated={true}
                ariaExpanded={areLanguagesShown}
                onClick={() => {
                  setAreLanguagesShown(!areLanguagesShown);
                }}
              />
              {areLanguagesShown ? (
                <LanguageVoices chosen={voice} translator={translator} />
              ) : (
                <></>
              )}
            </>
          ) : (
            <></>
          )}
        </div>
        <p
          data-testid="call-voice-sample-cost"
          className="text-sm text-gray-600"
        >
          {voice && getCallVoiceCentsOfAPage(voice) > 0
            ? translator.translateTemplate(CALL_VOICE_COST_SENTENCE, {
                cents: translator.formatNumber(getCallVoiceCentsOfAPage(voice)),
              })
            : translator.translateText(CALL_VOICE_DEFAULT_COST_SENTENCE)}
        </p>
        <p
          data-testid="call-voice-sample-hear-it"
          className="text-xs text-gray-600"
        >
          {translator.translateText(
            props.isInEffect
              ? CALL_VOICE_HEAR_IT_NOW_SENTENCE
              : CALL_VOICE_HEAR_IT_SENTENCE,
          )}
        </p>
      </div>
    </div>
  );
};

export default CallVoiceSample;
