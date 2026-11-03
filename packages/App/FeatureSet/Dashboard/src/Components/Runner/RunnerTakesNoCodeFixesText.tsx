import { CODE_RUNNER_TAKES_NO_CODE_FIXES_TEXT } from "./RunnerPickerModel";
import RunnerCodeFixesOffSetting from "Common/UI/Components/Runner/RunnerCodeFixesOffSetting";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a project's Runner whose host turned AI code fixes off is told
 * wherever a code repository's Runner is drawn - its settings card, its
 * picker, and the Code Repositories on the Runner's own page: "This Runner
 * takes no AI code fixes: <setting> is set on its host. Remove that setting
 * and restart the Runner, or pick another Runner.", in the reader's
 * language, the setting drawn as code (RunnerCodeFixesOffSetting). The
 * element around it gives the colour and the place.
 */
const RunnerTakesNoCodeFixesText: FunctionComponent = (): ReactElement => {
  return (
    <TranslatedSentence
      template={CODE_RUNNER_TAKES_NO_CODE_FIXES_TEXT}
      slots={{ setting: <RunnerCodeFixesOffSetting /> }}
    />
  );
};

export default RunnerTakesNoCodeFixesText;
