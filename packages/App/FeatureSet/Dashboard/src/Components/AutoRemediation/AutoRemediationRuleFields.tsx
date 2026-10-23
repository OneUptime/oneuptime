import RunnerPicker from "../Runner/RunnerPicker";
import RunnerChoicesLoader, { RunnerChoices } from "../Runner/RunnerChoices";
import {
  GLOBAL_RUNNER_CHOICE_VALUE,
  RunnerPickerWork,
} from "../Runner/RunnerPickerModel";
import useRefreshRunnerChoicesOnFocus from "../Runner/useRefreshRunnerChoicesOnFocus";
import {
  AUTO_REMEDIATION_MORE_FIELDS_COPY,
  AUTO_REMEDIATION_OLDER_RULE_COPY,
} from "./AutoRemediationRuleCopy";
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
  useRef,
  useState,
} from "react";
import { focusWhenDrawn } from "../AISettings/FocusWhenDrawn";

/*
 * The two custom fields of an auto remediation rule's More fields:
 *
 *   - AutoRemediationRunnerPicker: the Runner OneUptime AI runs the rule's
 *     Bash commands on (AutoRemediationRule.runnerId) - the one Runner
 *     picker (RunnerPicker) for a rule, drawn as a field of the form. It
 *     lists the project's own Runners, the default first; a rule that picks
 *     none reads "No Runner". The AI agent on the affected cluster or host is
 *     not one of its choices - commands there go through it whatever the
 *     rule picks, which the field's line says. Picking a Runner is what lets
 *     OneUptime AI's commands run on it - a Runner has no switch for that.
 *   - RunbooksEveryTimeSwitch: "Run them every time", the one older choice
 *     kept, folded away: the rule starts every runbook it names for every
 *     match, without OneUptime AI deciding (remediationAction Runbooks).
 *
 * And, at the top of the Fix step of a rule saved before rules were
 * simplified, OlderAutoRemediationRuleNote: what the rule still does, and
 * "Fix like a new rule".
 */

export const AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID: string =
  "auto-remediation-runner-picker";

export const AUTO_REMEDIATION_RUNNER_LOADING_TEST_ID: string =
  "auto-remediation-runner-loading";

export const AUTO_REMEDIATION_EVERY_TIME_TEST_ID: string =
  "auto-remediation-every-time";

export const AUTO_REMEDIATION_OLDER_RULE_TEST_ID: string =
  "auto-remediation-older-rule";

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
            areProjectRunnersUnread: true,
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
  const choices: RunnerChoices | null = useAutoRemediationRunnerChoices();

  if (!choices) {
    /*
     * The menu's own place and height, so the fields below do not jump
     * when it arrives.
     */
    return (
      <Skeleton
        className="mt-2 mb-1 h-10 w-full rounded-lg"
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

export interface OlderAutoRemediationRuleNoteProps {
  // What the rule does, as AUTO_REMEDIATION_OLDER_RULE_COPY says it.
  text: string;
  onFixLikeANewRule: () => void;
  /*
   * Where keyboard focus goes once the note is gone (FocusWhenDrawn): the
   * question it stood over. Left out, focus stays where the browser puts it.
   */
  focusAfterSelectors?: Array<string> | undefined;
}

/*
 * A rule saved before rules were simplified still has OneUptime AI do only
 * what it did then - compose commands on its Runners, or pick one of its
 * runbooks and ask first - so its Fix step says so where the question it
 * does not answer would be, and offers to make it fix like a new rule. The
 * rule changes only when the dialog is saved.
 */
export const OlderAutoRemediationRuleNote: FunctionComponent<
  OlderAutoRemediationRuleNoteProps
> = (props: OlderAutoRemediationRuleNoteProps): ReactElement => {
  const translator: Translator = useTranslator();
  const noteRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={noteRef}
      className="flex flex-col items-start gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={AUTO_REMEDIATION_OLDER_RULE_TEST_ID}
    >
      <p className="text-sm text-gray-700">
        {translator.translateText(props.text)}
      </p>
      <button
        type="button"
        onClick={(): void => {
          if (props.focusAfterSelectors) {
            focusWhenDrawn({
              from: noteRef.current,
              selectors: props.focusAfterSelectors,
            });
          }

          props.onFixLikeANewRule();
        }}
        className="flex-none rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        data-testid={`${AUTO_REMEDIATION_OLDER_RULE_TEST_ID}-fix-like-new`}
      >
        {translator.translateText(
          AUTO_REMEDIATION_OLDER_RULE_COPY.fixLikeANewRule,
        )}
      </button>
    </div>
  );
};
