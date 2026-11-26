import { translationKey } from "Common/Types/Translator";

/*
 * The words of the Call Voice card on Settings > Call and SMS (#10948):
 * the voice the server's calls speak with (CallVoiceCard).
 *
 * Kept free of React, so App/Tests can read these exact strings.
 */

export const CALL_VOICE_CARD_TEST_ID: string = "call-voice-card";

export const CALL_VOICE_CARD_COPY: {
  title: string;
  description: string;
  button: string;
  fieldTitle: string;
} = {
  title: translationKey("Call Voice"),
  description: translationKey(
    "The voice OneUptime's phone calls speak with when they go out through this server's Twilio account.",
  ),
  button: translationKey("Choose Voice"),
  fieldTitle: translationKey("Voice"),
};
