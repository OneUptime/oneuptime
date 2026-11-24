import {
  CallVoice,
  getCallVoice,
  getCallVoiceCentsOfAPage,
} from "../../../Types/Call/CallVoice";
import IconProp from "../../../Types/Icon/IconProp";
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
import Icon from "../Icon/Icon";
import {
  CALL_VOICE_DEFAULT_LABEL,
  getCallVoiceDescription,
} from "./CallVoiceOptions";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * UNDER THE CALL VOICE PICKER: THE VOICE CHOSEN, AND A SHORT SAMPLE OF WHAT
 * IT SAYS (#10948).
 *
 * Which voice is chosen and how it sounds, the first lines a page's call
 * says - in English, as every call is, so they are never translated - what
 * the voice costs, and how to hear it: a test call, once it is saved. It
 * follows the picker as the person changes it.
 */

// Who a sample call is from, when the page knows no project.
export const CALL_VOICE_SAMPLE_PROJECT_NAME: string = "Acme Production";

export const CALL_VOICE_SAMPLE_LABEL: string = translationKey(
  "A page's call starts like this, always in English:",
);

// What a voice of the list costs, under its sample.
export const CALL_VOICE_COST_SENTENCE: string = translationKey(
  "Twilio charges extra for this voice: under 2 US cents for each page's call.",
);

// What the account's default voice costs, and what Twilio says of it.
export const CALL_VOICE_DEFAULT_COST_SENTENCE: string = translationKey(
  "Free. Twilio says its Basic voices are not meant for production.",
);

export const CALL_VOICE_HEAR_IT_SENTENCE: string = translationKey(
  "Save, then send a test call to hear it.",
);

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
        number: "INC-42",
        severityName: "Critical Incident",
      },
    }),
    ON_CALL_PAGE_CALL_PROMPT,
  ].join(" ");
}

export interface ComponentProps {
  // The voice picked, as the form holds it: a voice's value, or nothing.
  value: unknown;
  // Who the sample call is from: the project the config is for, if any.
  projectName?: string | undefined;
}

const CallVoiceSample: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const voice: CallVoice | null = getCallVoice(props.value);

  return (
    <div
      data-testid="call-voice-sample"
      className="mt-3 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
    >
      <Icon
        icon={IconProp.SpeakerWave}
        className="mt-0.5 h-5 w-5 flex-none text-gray-500"
      />
      <div className="min-w-0 space-y-2">
        <p
          data-testid="call-voice-sample-voice"
          className="text-sm font-medium text-gray-900"
        >
          {voice ? (
            <>
              <span>{voice.name}</span>
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
            &ldquo;{getCallVoiceSampleSentence(props.projectName)}&rdquo;
          </p>
        </div>
        <p
          data-testid="call-voice-sample-cost"
          className="text-sm text-gray-600"
        >
          {translator.translateText(
            voice && getCallVoiceCentsOfAPage(voice) > 0
              ? CALL_VOICE_COST_SENTENCE
              : CALL_VOICE_DEFAULT_COST_SENTENCE,
          )}
        </p>
        <p className="text-xs text-gray-600">
          {translator.translateText(CALL_VOICE_HEAR_IT_SENTENCE)}
        </p>
      </div>
    </div>
  );
};

export default CallVoiceSample;
