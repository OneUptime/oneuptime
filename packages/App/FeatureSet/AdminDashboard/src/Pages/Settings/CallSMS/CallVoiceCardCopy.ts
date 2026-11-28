import { translationKey } from "Common/Types/Translator";

/*
 * The words of the Call Voice card on Settings > Call and SMS (#10948):
 * the voice the server's calls speak with (CallVoiceCard) - chosen here, or
 * set by GLOBAL_TWILIO_CALL_VOICE (#11064).
 *
 * Kept free of React, so App/Tests can read these exact strings.
 */

export const CALL_VOICE_CARD_TEST_ID: string = "call-voice-card";

// The card's body while the server says whether a variable sets the voice.
export const CALL_VOICE_CARD_LOADING_TEST_ID: string =
  "call-voice-card-loading";

// What is wrong with GLOBAL_TWILIO_CALL_VOICE, above the voice it leaves.
export const CALL_VOICE_CARD_PROBLEM_TEST_ID: string =
  "call-voice-card-problem";

export const CALL_VOICE_CARD_COPY: {
  title: string;
  description: string;
  button: string;
  fieldTitle: string;
  environmentDescription: string;
  environmentProblemTitle: string;
} = {
  title: translationKey("Call Voice"),
  description: translationKey(
    "The voice OneUptime's phone calls speak with when they go out through this server's Twilio account.",
  ),
  button: translationKey("Choose Voice"),
  fieldTitle: translationKey("Voice"),
  // Said in place of the description when GLOBAL_TWILIO_CALL_VOICE sets the voice.
  environmentDescription: translationKey(
    "Set by the GLOBAL_TWILIO_CALL_VOICE environment variable: twilio.callVoice in the Helm chart's values, or config.env with Docker Compose. To change the voice, change it there and restart OneUptime.",
  ),
  environmentProblemTitle: translationKey(
    "Calls speak with your Twilio account's default voice until this environment variable is fixed:",
  ),
};
