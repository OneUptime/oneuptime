import RunnerPicker from "../Runner/RunnerPicker";
import RunnerChoicesLoader, { RunnerChoices } from "../Runner/RunnerChoices";
import {
  GLOBAL_RUNNER_CHOICE_VALUE,
  REMEDIATION_OWN_RUNNER_HELPER_TEXT,
  RunnerPickerWork,
} from "../Runner/RunnerPickerModel";
import useRefreshRunnerChoicesOnFocus from "../Runner/useRefreshRunnerChoicesOnFocus";
import { AUTO_REMEDIATION_MORE_FIELDS_COPY } from "./AutoRemediationRuleCopy";
import AutoRemediationAction from "Common/Types/AutoRemediation/AutoRemediationAction";
import { getRuleRunnerId } from "Common/Types/AutoRemediation/AutoRemediationFix";
import ObjectID from "Common/Types/ObjectID";
import Skeleton from "Common/UI/Components/Skeleton/Skeleton";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The two custom fields of an auto remediation rule's More fields:
 *
 *   - AutoRemediationRunnerPicker: the Runner OneUptime AI runs the rule's
 *     commands of its own on (AutoRemediationRule.runnerId) - the one Runner
 *     picker (RunnerPicker) for a rule, drawn as a field of the form. Its
 *     first choice is no Runner: OneUptime AI fixes through the AI agent on
 *     the affected cluster or host. Picking a Runner is what lets OneUptime
 *     AI's commands run on it - a Runner has no switch for that any more.
 *   - RunbooksEveryTimeSwitch: "Run them every time", the one older choice
 *     kept, folded away: the rule starts every runbook it names for every
 *     match, without OneUptime AI deciding (remediationAction Runbooks).
 */

export const AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID: string =
  "auto-remediation-runner-picker";

export const AUTO_REMEDIATION_RUNNER_LOADING_TEST_ID: string =
  "auto-remediation-runner-loading";

export const AUTO_REMEDIATION_EVERY_TIME_TEST_ID: string =
  "auto-remediation-every-time";

// The choices of a rule's Runner picker, read now and when the tab is back.
export function useAutoRemediationRunnerChoices(): RunnerChoices | null {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const projectIdText: string = projectId?.toString() || "";
  const [choices, setChoices] = useState<RunnerChoices | null>(null);

  useEffect(() => {
    if (!projectIdText) {
      return;
    }

    let isMounted: boolean = true;

    RunnerChoicesLoader.loadForRemediation(new ObjectID(projectIdText))
      .then((loaded: RunnerChoices) => {
        if (isMounted) {
          setChoices(loaded);
        }
      })
      .catch(() => {
        // Nothing read: the rule's choice is still shown - none, or hidden.
        if (isMounted) {
          setChoices({
            projectRunners: [],
            globalRunners: [],
            projectUsesGlobalRunners: true,
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [projectIdText]);

  useRefreshRunnerChoicesOnFocus(
    projectId,
    setChoices,
    RunnerChoicesLoader.loadForRemediation,
  );

  return choices;
}

export interface AutoRemediationRunnerPickerProps {
  // The Runner the rule picks, as the form holds it; empty for none.
  value: unknown;
  // The Runner picked: its id, or null for none.
  onChange: (runnerId: string | null) => void;
  // The label the form drew for the field, read out with the menu.
  ariaLabelledby?: string | undefined;
}

export const AutoRemediationRunnerPicker: FunctionComponent<
  AutoRemediationRunnerPickerProps
> = (props: AutoRemediationRunnerPickerProps): ReactElement => {
  const translator: Translator = useTranslator();
  const choices: RunnerChoices | null = useAutoRemediationRunnerChoices();

  if (!choices) {
    // The menu's own height, so the fields below do not jump when it arrives.
    return (
      <Skeleton
        className="h-10 w-full rounded-md"
        dataTestId={AUTO_REMEDIATION_RUNNER_LOADING_TEST_ID}
      />
    );
  }

  return (
    <RunnerPicker
      work={RunnerPickerWork.AutoRemediation}
      isFormField={true}
      ariaLabelledby={props.ariaLabelledby}
      stepType=""
      value={getRuleRunnerId({ runnerId: props.value })}
      onChange={(runnerId: string): void => {
        props.onChange(
          runnerId === GLOBAL_RUNNER_CHOICE_VALUE ? null : runnerId,
        );
      }}
      choices={choices}
      ownRunnerHelperText={translator.translateText(
        REMEDIATION_OWN_RUNNER_HELPER_TEXT,
      )}
      dataTestId={AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID}
    />
  );
};

export interface RunbooksEveryTimeSwitchProps {
  // The rule's Fix With, as the form holds it.
  value: unknown;
  // The Fix With the switch leaves the rule with.
  onChange: (remediationAction: AutoRemediationAction) => void;
  error?: string | undefined;
}

/*
 * "Run them every time": on is a rule whose Fix With is Runbooks, off is a
 * OneUptime AI rule. The switch draws its own title and line, beside it, as
 * every switch in a form does.
 */
export const RunbooksEveryTimeSwitch: FunctionComponent<
  RunbooksEveryTimeSwitchProps
> = (props: RunbooksEveryTimeSwitchProps): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Toggle
      title={translator.translateText(
        AUTO_REMEDIATION_MORE_FIELDS_COPY.everyTimeTitle,
      )}
      description={translator.translateText(
        AUTO_REMEDIATION_MORE_FIELDS_COPY.everyTimeDescription,
      )}
      value={props.value === AutoRemediationAction.Runbooks}
      error={props.error}
      onChange={(isOn: boolean): void => {
        props.onChange(
          isOn
            ? AutoRemediationAction.Runbooks
            : AutoRemediationAction.OneUptimeAI,
        );
      }}
      dataTestId={AUTO_REMEDIATION_EVERY_TIME_TEST_ID}
    />
  );
};
