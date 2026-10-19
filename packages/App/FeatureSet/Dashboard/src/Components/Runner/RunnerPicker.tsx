import { getRunnerLiveStatusLabel } from "Common/Types/Runner/RunnerLiveStatus";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslateValue, {
  UseTranslateValueResult,
} from "Common/UI/Utils/Translation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import { RunnerChoices } from "./RunnerChoices";
import { GLOBAL_RUNNER_MAX_MINUTES } from "./GlobalRunnersCopy";
import {
  GLOBAL_RUNNERS_OFF_HELPER_TEXT,
  GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  GLOBAL_RUNNER_CHOICE_LABEL,
  GLOBAL_RUNNER_CHOICE_VALUE,
  RunnerPickerModel,
  RunnerPickerOption,
  RunnerPickerOptionKind,
  RunnerPickerOutcome,
  buildRunnerPickerModel,
} from "./RunnerPickerModel";

/*
 * The one Runner picker: which Runner runs a step (Runbooks -> a runbook ->
 * Steps), and anywhere else people pick a Runner.
 *
 * The global choice - "Global Runner", the Runners OneUptime runs for every
 * project - comes first and is what a step that picked none shows, whenever
 * global Runners can run the step (RunnerPickerModel). The project's own
 * Runners follow, each with how it is doing. When there is nothing to pick,
 * one plain sentence says what to do instead of an empty box: a Bash, SSH or
 * Kubernetes step needs a Runner of the project's own.
 */

export interface ComponentProps {
  // The step's type ("JavaScript", "Bash", "SSH", "Kubernetes").
  stepType: string;
  // The Runner the step picked, as stored: "" for none.
  value: string;
  onChange: (value: string) => void;
  choices: RunnerChoices;
  // The line under the picker when one of the project's own Runners is picked.
  ownRunnerHelperText: ReactNode;
  dataTestId?: string | undefined;
}

export const RUNNER_PICKER_TEST_ID: string = "runner-picker";

const RunnerPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { translateString }: UseTranslateValueResult = useTranslateValue();

  const dataTestId: string = props.dataTestId || RUNNER_PICKER_TEST_ID;

  const model: RunnerPickerModel = buildRunnerPickerModel({
    stepType: props.stepType,
    currentRunnerId: props.value,
    projectRunners: props.choices.projectRunners,
    globalRunners: props.choices.globalRunners,
    projectUsesGlobalRunners: props.choices.projectUsesGlobalRunners,
  });

  /*
   * Dropdown translates a label as one whole string, so a composed "name ·
   * status" can never match a key: the parts are translated here, each on
   * its own, and then joined - the status words are the three the status
   * bubble uses, which every locale carries.
   */
  const getStatusText: (option: RunnerPickerOption) => string = (
    option: RunnerPickerOption,
  ): string => {
    if (!option.liveStatus) {
      return "";
    }

    const label: string = getRunnerLiveStatusLabel(option.liveStatus);

    return translateString(label) || label;
  };

  const toDropdownOption: (option: RunnerPickerOption) => DropdownOption = (
    option: RunnerPickerOption,
  ): DropdownOption => {
    if (option.kind === RunnerPickerOptionKind.Global) {
      return {
        value: GLOBAL_RUNNER_CHOICE_VALUE,
        label: `${translator.translateText(GLOBAL_RUNNER_CHOICE_LABEL)} · ${getStatusText(option)}`,
        description: GLOBAL_RUNNER_CHOICE_DESCRIPTION,
      };
    }

    if (option.kind === RunnerPickerOptionKind.Unknown) {
      return {
        value: option.value,
        label: translator.translateTemplate("Unknown Runner ({{id}})", {
          id: option.value,
        }),
      };
    }

    return {
      value: option.value,
      label: `${option.name} · ${getStatusText(option)}`,
    };
  };

  const options: Array<DropdownOption> = model.options.map(toDropdownOption);

  const selectedOption: DropdownOption | undefined = model.selected
    ? toDropdownOption(model.selected)
    : undefined;

  const runnersLocation: ReactElement = (
    <strong>{translator.translateText("Runbooks › Runners")}</strong>
  );

  const renderNothingToPick: () => ReactElement = (): ReactElement => {
    if (model.outcome === RunnerPickerOutcome.NeedsOwnRunner) {
      return (
        <TranslatedSentence
          template="{{stepType}} steps run on a Runner of your own, inside your network. Add one under {{location}}, then pick it here."
          slots={{
            stepType: props.stepType,
            location: runnersLocation,
          }}
        />
      );
    }

    if (model.outcome === RunnerPickerOutcome.GlobalRunnersOff) {
      return (
        <TranslatedSentence
          template="This project does not use global Runners. Add a Runner of your own under {{location}}, or turn global Runners on there."
          slots={{
            location: runnersLocation,
          }}
        />
      );
    }

    return (
      <TranslatedSentence
        template="Add a Runner under {{location}} to run this step, then pick it here."
        slots={{
          location: runnersLocation,
        }}
      />
    );
  };

  const renderHelperText: () => ReactNode = (): ReactNode => {
    if (model.outcome === RunnerPickerOutcome.GlobalRunner) {
      return translator.translateTemplate(
        "Runs on a global Runner, in a sandbox that can reach the internet but not your network, for {{minutes}} minutes at most. Pick one of your own Runners for anything on your network.",
        { minutes: GLOBAL_RUNNER_MAX_MINUTES },
      );
    }

    /*
     * A step global Runners could run, in a project that turned them off,
     * picks one of the project's own: said here, since the global choice is
     * not in the list.
     */
    if (model.outcome === RunnerPickerOutcome.GlobalRunnersOff) {
      return translator.translateText(GLOBAL_RUNNERS_OFF_HELPER_TEXT);
    }

    if (model.outcome === RunnerPickerOutcome.UnknownRunner) {
      return (
        <span className="text-amber-700">
          {translator.translateText(
            "This step picked a Runner that is not one of this project's Runners any more, so it will fail when it runs. Pick another Runner.",
          )}
        </span>
      );
    }

    return props.ownRunnerHelperText;
  };

  return (
    <div data-testid={dataTestId}>
      <label className="block text-xs font-medium text-gray-700 mb-1.5">
        {translator.translateText("Runner")}
      </label>
      {options.length === 0 ? (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          data-testid={`${dataTestId}-nothing-to-pick`}
        >
          {renderNothingToPick()}
        </div>
      ) : (
        <>
          <Dropdown
            options={options}
            value={selectedOption}
            placeholder="Select a Runner"
            isClearable={false}
            dataTestId={`${dataTestId}-dropdown`}
            ariaLabel="Runner"
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              const id: string =
                value === null || value === undefined
                  ? GLOBAL_RUNNER_CHOICE_VALUE
                  : Array.isArray(value)
                    ? String(value[0] ?? GLOBAL_RUNNER_CHOICE_VALUE)
                    : String(value);
              props.onChange(id);
            }}
          />
          <p
            className="text-xs text-gray-500 mt-1.5"
            data-testid={`${dataTestId}-help`}
          >
            {renderHelperText()}
          </p>
        </>
      )}
    </div>
  );
};

export default RunnerPicker;
