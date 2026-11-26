import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The voice a project's Twilio config's calls speak with (#10948), on
 * Project Settings > Notifications > Notification Channels > Twilio Config,
 * under More fields of the Twilio step, for a config that makes calls.
 *
 * Empty - as every config was before voices could be chosen - calls speak
 * with the voice the Twilio account uses by default. The picker's options,
 * its empty choice and the sample under it are the Admin Dashboard's too
 * (Common/UI/Components/CallVoice).
 *
 * Kept free of React, so App/Tests can read these exact strings.
 */
export const TwilioConfigVoiceCopy: {
  fieldTitle: string;
  fieldDescription: string;
} = {
  fieldTitle: translationKey("Call Voice"),
  fieldDescription: translationKey(
    "The voice calls through this account speak with.",
  ),
};

export default TwilioConfigVoiceCopy;
