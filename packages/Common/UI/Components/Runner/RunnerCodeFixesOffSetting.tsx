import { RUNNER_CODE_FIXES_OFF_SETTING } from "../../../Types/Runner/RunnerCodeFixes";
import BreakableCode from "../Workflow/BreakableCode";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The setting that turns a Runner's AI code fixes off
 * (ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false), drawn inside the sentence that
 * says a Runner takes none - Code's notice, a repository's Runner card and
 * picker, a Runner's own page, the Admin Dashboard's Global Runners - as
 * code, in the sentence's own colour on a tint of the amber those sentences
 * are written in.
 *
 * It breaks only after its underscores (BreakableCode): one word of 40
 * letters, it is wider than a phone's notice, and left to the browser it
 * broke at whatever letter filled the line ("..._CODE_FIXES=fals" / "e",
 * "..._CODE_FIX" / "ES=false"). Here a phone wraps it as
 * "ONEUPTIME_RUNNER_ENABLE_CODE_" / "FIXES=false", and copying it still
 * gives the setting as written: a <wbr> adds no character.
 */

export const RUNNER_CODE_FIXES_OFF_SETTING_TEST_ID: string =
  "runner-code-fixes-off-setting";

/*
 * Each line a wrapped setting takes keeps its own padding and rounded ends;
 * the tint is one the dark theme redraws (Theme.css), so it reads on a dark
 * notice too.
 */
export const RUNNER_CODE_FIXES_OFF_SETTING_CLASS_NAME: string =
  "rounded bg-amber-100 px-1 text-[0.92em] box-decoration-clone";

const RunnerCodeFixesOffSetting: FunctionComponent = (): ReactElement => {
  return (
    <BreakableCode
      text={RUNNER_CODE_FIXES_OFF_SETTING}
      breakAfter="_"
      className={RUNNER_CODE_FIXES_OFF_SETTING_CLASS_NAME}
      dataTestId={RUNNER_CODE_FIXES_OFF_SETTING_TEST_ID}
    />
  );
};

export default RunnerCodeFixesOffSetting;
