import { ProjectDefaultRunnerRefusal } from "Common/Types/Runner/ProjectDefaultRunner";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { PROJECT_DEFAULT_TAG } from "./RunnerPickerModel";

/*
 * THE PROJECT'S DEFAULT RUNNER, as the Runners pages say it.
 *
 * A project makes one of its own Runners its default as it makes one Twilio
 * config its default (Components/CallSMS/TwilioConfigDefaultCopy): a
 * runbook step that picks no Runner of its own then runs on it, in place of
 * the Global Runner (Common/Types/Runner/RunnerChoice, the default order).
 * The maintainer: "by default select the global runner unless I have custom
 * runner set to default runner for the project ... just like we set twilio
 * credentials as default for the project".
 *
 * It is set in two places, saying the same things:
 *
 *   - Runbooks -> Runners: a "Project default" pill beside the default's
 *     name, and "Set as Project Default" / "Stop Using as Project Default"
 *     in each Runner's ⋯ menu;
 *   - a Runner's own page: a Project Default card whose one switch saves
 *     the moment it is flipped.
 *
 * Both ask first, saying what moves: making a Runner the default moves
 * every step that picks no Runner onto it - the JavaScript steps on the
 * Global Runner among them - and the AI work of every code repository that
 * picks none (Common/Types/Runner/CodeRepositoryRunner), and stopping moves
 * them back. No Runner is the default until someone makes it so: a Runner
 * that never connected is never picked by default.
 *
 * Kept free of React, so App/Tests can read these exact strings. Every
 * sentence is wrapped in translationKey() so npm run i18n:extract finds it;
 * the pages translate them where they draw them ({{runner}}: a Runner's
 * name, {{current}}: the Runner that is the default now).
 */

export const ProjectDefaultRunnerCopy: {
  // The pill beside the default's name: the tag the picker's first choice carries.
  pillText: string;
  // The ⋯ menu's two actions.
  setDefaultTitle: string;
  stopDefaultTitle: string;
  // Asked before a Runner is made the default.
  makeDefaultConfirmTitle: string;
  makeDefaultConfirmDescription: string;
  // ... when another Runner is the default now.
  replaceDefaultConfirmDescription: string;
  makeDefaultConfirmButton: string;
  /*
   * After it, for a Runner that is not connected: the steps that move onto
   * it fail until it is - said before it is made the default, not after.
   */
  makeDefaultNotConnectedWarning: string;
  // Asked before the default is cleared.
  stopDefaultConfirmTitle: string;
  stopDefaultConfirmDescription: string;
  stopDefaultConfirmButton: string;
  /*
   * After the Custom Runners card's description, while none of them is the
   * default: that one can be made the default, where, and what it does.
   */
  customCardSentence: string;
  // The card of the one switch on a Runner's own page.
  switchCardTitle: string;
  switchCardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  /*
   * The switch's line while it is off and another Runner is the default
   * ({{runner}}): where the steps that pick no Runner run now.
   */
  switchOffDescriptionWithDefault: string;
} = {
  pillText: PROJECT_DEFAULT_TAG,
  setDefaultTitle: translationKey("Set as Project Default"),
  stopDefaultTitle: translationKey("Stop Using as Project Default"),
  makeDefaultConfirmTitle: translationKey(
    "Make {{runner}} the project default?",
  ),
  makeDefaultConfirmDescription: translationKey(
    "Runbook steps and code repositories that pick no Runner will run on it, including those on the Global Runner now.",
  ),
  replaceDefaultConfirmDescription: translationKey(
    "Runbook steps and code repositories that pick no Runner will run on it instead of {{current}}.",
  ),
  makeDefaultConfirmButton: translationKey("Make Project Default"),
  makeDefaultNotConnectedWarning: translationKey(
    "{{runner}} is not connected right now, so the steps that run on it fail until it is.",
  ),
  stopDefaultConfirmTitle: translationKey(
    "Stop using {{runner}} as the project default?",
  ),
  stopDefaultConfirmDescription: translationKey(
    "JavaScript steps and code repositories that pick no Runner will run on the Global Runner. Other steps will need a Runner picked.",
  ),
  stopDefaultConfirmButton: translationKey("Stop Using as Default"),
  customCardSentence: translationKey(
    "Make one the project default from its ⋯ menu, and the steps and code repositories that pick no Runner run on it.",
  ),
  switchCardTitle: translationKey("Project Default"),
  switchCardDescription: translationKey(
    "The project's default Runner runs the runbook steps and the code repositories that pick no Runner of their own, in place of the Global Runner.",
  ),
  switchTitle: translationKey("Use as the project default"),
  switchOnDescription: translationKey(
    "Runbook steps and code repositories that pick no Runner run on this Runner.",
  ),
  switchOffDescription: translationKey(
    "Runbook steps and code repositories that pick no Runner run on the project's default Runner, or on the Global Runner when there is none.",
  ),
  switchOffDescriptionWithDefault: translationKey(
    "Runbook steps and code repositories that pick no Runner run on {{runner}}, the project default.",
  ),
};

/*
 * The warning, in the dialog that makes a Runner the default, that the
 * Runner is not connected (makeDefaultNotConnectedWarning): drawn apart
 * from what moves, so it is not read as one more sentence of it.
 */
export const PROJECT_DEFAULT_NOT_CONNECTED_WARNING_TEST_ID: string =
  "project-default-not-connected-warning";

/*
 * Why a Runner cannot be the project default, where the Dashboard offers to
 * make it one - the server's rule (ProjectDefaultRunner) in the reader's
 * words. A global Runner is never offered there: no project's page lists it
 * as one of its own.
 */
export const PROJECT_DEFAULT_REFUSAL_TEXT: Record<
  ProjectDefaultRunnerRefusal,
  string
> = {
  [ProjectDefaultRunnerRefusal.GlobalRunner]: translationKey(
    "A global Runner belongs to no project, so it cannot be a project's default Runner.",
  ),
  [ProjectDefaultRunnerRefusal.KubernetesAgentRunner]: translationKey(
    "An in-cluster Runner runs kubectl for its own cluster only, so it cannot be the project default.",
  ),
  [ProjectDefaultRunnerRefusal.DoesNotRunRunbooks]: translationKey(
    "This Runner does not run runbooks. Turn on Runs Runbooks for it first.",
  ),
};

/*
 * What the dialog that makes a Runner the default says under its title:
 * that the steps move from the Global Runner, or from the Runner that is
 * the default now (`currentDefaultName`).
 */
export function getMakeDefaultConfirmDescription(
  currentDefaultName: string | undefined,
): { template: string; current?: string | undefined } {
  if (currentDefaultName) {
    return {
      template: ProjectDefaultRunnerCopy.replaceDefaultConfirmDescription,
      current: currentDefaultName,
    };
  }

  return { template: ProjectDefaultRunnerCopy.makeDefaultConfirmDescription };
}

export default ProjectDefaultRunnerCopy;
