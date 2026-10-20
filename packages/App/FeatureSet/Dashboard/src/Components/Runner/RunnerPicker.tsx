import Route from "Common/Types/API/Route";
import { getRunnerLiveStatusLabel } from "Common/Types/Runner/RunnerLiveStatus";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslateValue, {
  UseTranslateValueResult,
} from "Common/UI/Utils/Translation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { RunnerChoices } from "./RunnerChoices";
import { GLOBAL_RUNNER_MAX_MINUTES } from "./GlobalRunnersCopy";
import {
  CODE_GLOBAL_RUNNERS_OFF_HELPER_TEXT,
  CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  CODE_GLOBAL_RUNNER_HELPER_TEXT,
  CODE_GLOBAL_RUNNER_NOT_CONNECTED_TEXT,
  CODE_HIDDEN_RUNNER_HELPER_TEXT,
  CODE_HIDDEN_RUNNER_LABEL,
  CODE_NO_GLOBAL_RUNNER_HELPER_TEXT,
  GLOBAL_RUNNERS_OFF_HELPER_TEXT,
  GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  GLOBAL_RUNNER_CHOICE_LABEL,
  GLOBAL_RUNNER_CHOICE_VALUE,
  GLOBAL_RUNNER_NOT_CONNECTED_TEXT,
  RunnerPickerModel,
  RunnerPickerOption,
  RunnerPickerOptionKind,
  RunnerPickerOutcome,
  RunnerPickerWork,
  buildRunnerPickerModel,
  isGlobalRunnerChoiceWaiting,
} from "./RunnerPickerModel";

/*
 * The one Runner picker: which Runner runs a step (Runbooks -> a runbook ->
 * Steps), which Runner AI works in a code repository on (Code -> a
 * repository -> Settings), and anywhere else people pick a Runner.
 *
 * The global choice - "Global Runner", the Runners OneUptime runs for every
 * project - comes first and is what a step that picked none shows, whenever
 * global Runners can run the step (RunnerPickerModel). The project's own
 * Runners follow, each with how it is doing. When there is nothing to pick,
 * one plain sentence says what to do instead of an empty box: a Bash, SSH or
 * Kubernetes step needs a Runner of the project's own.
 */

export interface ComponentProps {
  // What the Runner is picked for; a runbook step when left out.
  work?: RunnerPickerWork | undefined;
  /*
   * The step's type ("JavaScript", "Bash", "SSH", "Kubernetes"); left empty
   * for a code repository.
   */
  stepType: string;
  /*
   * What the step is called where a sentence names it ("kubectl" for a
   * Kubernetes step, whose stored type kept its old name). Left out, the
   * type.
   */
  stepTypeName?: string | undefined;
  // The Runner the step (or repository) picked, as stored: "" for none.
  value: string;
  onChange: (value: string) => void;
  choices: RunnerChoices;
  // The line under the picker when one of the project's own Runners is picked.
  ownRunnerHelperText: ReactNode;
  dataTestId?: string | undefined;
  /*
   * A field of a form (a code repository's settings): the form draws the
   * field's title and description above the picker, as it does for every
   * other field, so the picker draws no "Runner" label of its own and its
   * lines under the menu are the size of a form's. Left out, the picker is
   * the compact one of a runbook step, with its own small label.
   */
  isFormField?: boolean | undefined;
  // The id of the label the form drew for the field, read out with the menu.
  ariaLabelledby?: string | undefined;
}

export const RUNNER_PICKER_TEST_ID: string = "runner-picker";

const RunnerPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { translateString }: UseTranslateValueResult = useTranslateValue();

  const dataTestId: string = props.dataTestId || RUNNER_PICKER_TEST_ID;
  const isForCodeRepository: boolean =
    props.work === RunnerPickerWork.CodeRepository;

  const model: RunnerPickerModel = buildRunnerPickerModel({
    work: props.work,
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
        description: isForCodeRepository
          ? CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION
          : GLOBAL_RUNNER_CHOICE_DESCRIPTION,
      };
    }

    /*
     * A repository can only pick one of its project's Runners, and a Runner
     * that is deleted leaves it on Global Runner, so a pick the picker
     * cannot name is one the reader may not see: said so, not as an id.
     */
    if (option.kind === RunnerPickerOptionKind.Unknown) {
      return {
        value: option.value,
        label: isForCodeRepository
          ? translator.translateText(CODE_HIDDEN_RUNNER_LABEL) ||
            CODE_HIDDEN_RUNNER_LABEL
          : translator.translateTemplate("Unknown Runner ({{id}})", {
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

  /*
   * Where a Runner is added, as a link: in a new tab, so the steps being
   * edited here stay as they are. The page that shows the picker reads the
   * Runners again when the person comes back to it
   * (useRefreshRunnerChoicesOnFocus), so the one just added can be picked
   * without a reload.
   */
  const runnersLocation: ReactElement = (
    <Link
      to={RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUNBOOKS_RUNNERS] as Route,
      )}
      openInNewTab={true}
      className="font-semibold underline underline-offset-2 hover:decoration-2"
      dataTestId={`${dataTestId}-runners-link`}
    >
      {translator.translateText("Runbooks › Runners")}
    </Link>
  );

  const renderNothingToPick: () => ReactElement = (): ReactElement => {
    if (model.outcome === RunnerPickerOutcome.NeedsOwnRunner) {
      return (
        <TranslatedSentence
          template="{{stepType}} steps run on a Runner of your own, inside your network. Add one under {{location}}, then pick it here."
          slots={{
            stepType: props.stepTypeName || props.stepType,
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

    if (isForCodeRepository) {
      return (
        <TranslatedSentence
          template="Add a Runner under {{location}} for AI to work in this repository, then pick it here."
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
      if (isForCodeRepository) {
        return translator.translateText(CODE_GLOBAL_RUNNER_HELPER_TEXT);
      }

      return translator.translateTemplate(
        "Runs in a sandbox that reaches the internet only, for up to {{minutes}} minutes. To reach your network, pick one of your Runners.",
        { minutes: GLOBAL_RUNNER_MAX_MINUTES },
      );
    }

    /*
     * A step global Runners could run - or a repository - in a project that
     * turned them off, picks one of the project's own: said here, since the
     * global choice is not in the list.
     */
    if (model.outcome === RunnerPickerOutcome.GlobalRunnersOff) {
      return translator.translateText(
        isForCodeRepository
          ? CODE_GLOBAL_RUNNERS_OFF_HELPER_TEXT
          : GLOBAL_RUNNERS_OFF_HELPER_TEXT,
      );
    }

    /*
     * A repository's pick the reader may not see still works: nothing is
     * wrong with it, so it is said plainly, not as a warning.
     */
    if (model.outcome === RunnerPickerOutcome.UnknownRunner) {
      if (isForCodeRepository) {
        return translator.translateText(CODE_HIDDEN_RUNNER_HELPER_TEXT);
      }

      return (
        <span className="text-amber-700">
          {translator.translateText(
            "This step picked a Runner that is not one of this project's Runners any more, so it will fail when it runs. Pick another Runner.",
          )}
        </span>
      );
    }

    // A repository that picked none, on a server with no global Runner.
    if (
      isForCodeRepository &&
      model.outcome === RunnerPickerOutcome.NoGlobalRunner
    ) {
      return translator.translateText(CODE_NO_GLOBAL_RUNNER_HELPER_TEXT);
    }

    return props.ownRunnerHelperText;
  };

  // A form's lines are its descriptions' size; a step's are smaller.
  const lineClassName: string = props.isFormField ? "text-sm" : "text-xs";

  return (
    <div data-testid={dataTestId}>
      {props.isFormField ? (
        <></>
      ) : (
        <label className="block text-xs font-medium text-gray-700 mb-1.5">
          {translator.translateText("Runner")}
        </label>
      )}
      {options.length === 0 ? (
        <div
          className={`rounded-md border border-amber-200 bg-amber-50 px-3 py-2 ${lineClassName} text-amber-800`}
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
            ariaLabelledby={props.ariaLabelledby}
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
            className={`${lineClassName} text-gray-500 ${
              props.isFormField ? "mt-2" : "mt-1.5"
            }`}
            data-testid={`${dataTestId}-help`}
          >
            {renderHelperText()}
          </p>
          {isGlobalRunnerChoiceWaiting(model) ? (
            <p
              className={`${lineClassName} text-amber-700 mt-1`}
              data-testid={`${dataTestId}-global-waiting`}
            >
              {translator.translateText(
                isForCodeRepository
                  ? CODE_GLOBAL_RUNNER_NOT_CONNECTED_TEXT
                  : GLOBAL_RUNNER_NOT_CONNECTED_TEXT,
              )}
            </p>
          ) : (
            <></>
          )}
        </>
      )}
    </div>
  );
};

export default RunnerPicker;
