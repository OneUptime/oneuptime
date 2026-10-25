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
  GLOBAL_RUNNER_STEP_TYPE_UNAVAILABLE_TEXT,
  GLOBAL_RUNNER_TURNED_OFF_UNAVAILABLE_TEXT,
  GlobalRunnerUnavailableReason,
  NEEDS_OWN_RUNNER_ADD_TEMPLATE,
  NEEDS_OWN_RUNNER_TEMPLATE,
  PICKED_GLOBAL_RUNNER_NEEDS_OWN_TEXT,
  PROJECT_DEFAULT_TAG,
  REMEDIATION_HIDDEN_RUNNER_HELPER_TEXT,
  REMEDIATION_ADD_RUNNER_TEMPLATE,
  REMEDIATION_GLOBAL_RUNNER_ADD_TEMPLATE,
  REMEDIATION_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  REMEDIATION_GLOBAL_RUNNER_PICK_TEXT,
  REMEDIATION_GLOBAL_RUNNER_TEXT,
  REMEDIATION_NO_RUNNER_PLACEHOLDER,
  RUNNER_NOT_CONNECTED_TEMPLATE,
  RuleRunnerLine,
  RunnerPickerModel,
  RunnerPickerOption,
  RunnerPickerOptionKind,
  RunnerPickerOutcome,
  RunnerPickerWork,
  STEP_NO_GLOBAL_RUNNER_HELPER_TEXT,
  buildRunnerPickerModel,
  getRuleRunnerLine,
  getWaitingProjectRunner,
  hasPickableOption,
  isGlobalRunnerChoiceWaiting,
} from "./RunnerPickerModel";

/*
 * The one Runner picker: which Runner runs a step (Runbooks -> a runbook ->
 * Steps, under the step's More fields), which Runner AI works in a code
 * repository on (Code -> a repository -> Settings), which Runner OneUptime
 * AI runs an auto remediation rule's commands on (the rule's More fields),
 * and anywhere else people pick a Runner.
 *
 * A step's first choice is what a step that picks no Runner runs on: the
 * project's default Runner when the project has one ("prod-runner ·
 * Project default · Connected"), and otherwise "Global Runner", the Runners
 * OneUptime runs for every project, wherever they can run the step
 * (RunnerPickerModel). The Global Runner stays in the list beside a project
 * default, and where it cannot run the step - a Bash, SSH or kubectl step -
 * it is drawn but cannot be picked, saying why. The project's own Runners
 * follow, each with how it is doing. When there is nothing to pick, one
 * plain sentence says what to do instead of an empty box.
 *
 * An AI rule's picker lists the project's own Runners - its default first,
 * tagged - and the Global Runner, which is what a rule that picks none shows
 * where the project uses global Runners and the server has one: on it,
 * OneUptime AI runs no Bash commands - a shell never runs on a host every
 * project shares - and the line under the picker says so, with the way to
 * have them run on a Runner of the project's own. Where there is no Global
 * Runner to show, a rule that picks none reads "No Runner", and a pick can
 * be cleared back to it; with no Runner to pick it stays drawn, empty, with
 * where one is added under it. Either way, a rule with no Runner of its own
 * is a rule that works, not one that is broken.
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
  /*
   * The line under the picker when one of the project's own Runners is
   * picked; nothing when the field's own line already says it.
   */
  ownRunnerHelperText?: ReactNode | undefined;
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
  const isForRemediation: boolean =
    props.work === RunnerPickerWork.AutoRemediation;
  const isForStep: boolean = !isForCodeRepository && !isForRemediation;
  // A pick the reader is not shown is one they may not see, not a broken one.
  const isPickOfTheProjectsOwn: boolean =
    isForCodeRepository || isForRemediation;

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
    /*
     * The Global Runner's label is the product's own words, so the box lays
     * it out the page's way: in Persian, "Runner سراسری · متصل" reads right
     * to left, as the menu draws it, not by its first, Latin, letter.
     */
    if (option.kind === RunnerPickerOptionKind.Global) {
      return {
        value: option.value,
        label: `${translator.translateText(GLOBAL_RUNNER_CHOICE_LABEL)} · ${getStatusText(option)}`,
        description: isForCodeRepository
          ? CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION
          : isForRemediation
            ? REMEDIATION_GLOBAL_RUNNER_CHOICE_DESCRIPTION
            : GLOBAL_RUNNER_CHOICE_DESCRIPTION,
        isInPageDirection: true,
      };
    }

    /*
     * The Global Runner where it cannot run the step: in the list, so
     * nobody wonders where it went, with why - and never picked.
     */
    if (option.kind === RunnerPickerOptionKind.GlobalUnavailable) {
      return {
        value: option.value,
        label:
          translator.translateText(GLOBAL_RUNNER_CHOICE_LABEL) ||
          GLOBAL_RUNNER_CHOICE_LABEL,
        description:
          option.unavailableReason ===
          GlobalRunnerUnavailableReason.ProjectTurnedOff
            ? GLOBAL_RUNNER_TURNED_OFF_UNAVAILABLE_TEXT
            : GLOBAL_RUNNER_STEP_TYPE_UNAVAILABLE_TEXT,
        isDisabled: true,
        isInPageDirection: true,
      };
    }

    /*
     * The project's default Runner, by its own name, tagged as the default:
     * a step's first choice while the project has one, and a rule's first.
     */
    if (option.kind === RunnerPickerOptionKind.ProjectDefault) {
      return {
        value: option.value,
        label: `${option.name} · ${translator.translateText(PROJECT_DEFAULT_TAG)} · ${getStatusText(option)}`,
        // The Runner's own name, drawn as named.
        isUserContent: true,
      };
    }

    /*
     * A repository or a rule can only pick one of its project's Runners, and
     * a Runner that is deleted leaves it with none, so a pick the picker
     * cannot name is one the reader may not see: said so, not as an id - in
     * the product's own words, laid out the page's way, as the Global
     * Runner's are ("Runnerی که به آن دسترسی ندارید" starts with a Latin
     * word too).
     */
    if (option.kind === RunnerPickerOptionKind.Unknown) {
      return {
        value: option.value,
        label: isPickOfTheProjectsOwn
          ? translator.translateText(CODE_HIDDEN_RUNNER_LABEL) ||
            CODE_HIDDEN_RUNNER_LABEL
          : translator.translateTemplate("Unknown Runner ({{id}})", {
              id: option.value,
            }),
        isInPageDirection: true,
      };
    }

    return {
      value: option.value,
      label: `${option.name} · ${getStatusText(option)}`,
    };
  };

  const options: Array<DropdownOption> = model.options.map(toDropdownOption);

  /*
   * Nothing in the list can be picked: one sentence says what to do
   * instead. Never for a rule, which works with no Runner: its picker stays,
   * empty, with where a Runner is added under it.
   */
  const hasNothingToPick: boolean =
    !isForRemediation && !hasPickableOption(model);

  const selectedOption: DropdownOption | undefined = model.selected
    ? toDropdownOption(model.selected)
    : undefined;

  /*
   * A rule may pick none. Where the Global Runner is listed, picking it is
   * how: it stands for none, as a step's first choice does, so there is
   * nothing to clear. Without it, clearing the pick is "No Runner".
   */
  const isRuleClearable: boolean =
    isForRemediation &&
    !model.options.some((option: RunnerPickerOption): boolean => {
      return option.kind === RunnerPickerOptionKind.Global;
    });

  /*
   * Where a Runner is added, as a link: in a new tab, so the steps being
   * edited here stay as they are. The page that shows the picker reads the
   * Runners again when the person comes back to it
   * (useRefreshRunnerChoicesOnFocus), so the one just added can be picked
   * without a reload. In an AI rule's quiet line it is underlined only, as
   * the links in the hints under the rule's other pickers are.
   */
  const runnersLocation: ReactElement = (
    <Link
      to={RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUNBOOKS_RUNNERS] as Route,
      )}
      openInNewTab={true}
      className={
        isForRemediation
          ? "underline"
          : "font-semibold underline underline-offset-2 hover:decoration-2"
      }
      dataTestId={`${dataTestId}-runners-link`}
    >
      {translator.translateText("Runbooks › Runners")}
    </Link>
  );

  const renderNothingToPick: () => ReactElement = (): ReactElement => {
    if (model.outcome === RunnerPickerOutcome.NeedsOwnRunner) {
      return (
        <TranslatedSentence
          template={NEEDS_OWN_RUNNER_ADD_TEMPLATE}
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

  /*
   * An AI rule's line (getRuleRunnerLine): on the Global Runner, that
   * OneUptime AI's Bash commands do not run there and the way to have them
   * run; on "No Runner" with nothing to pick, where a Runner is added; a
   * pick the reader may not see, said so. Nothing where the box and the
   * field's own line say it all.
   */
  const renderRuleHelperText: () => ReactNode = (): ReactNode => {
    const line: RuleRunnerLine = getRuleRunnerLine({
      model,
      projectRunnerCount: props.choices.projectRunners.length,
      areProjectRunnersUnread: props.choices.areProjectRunnersUnread,
    });

    switch (line) {
      case RuleRunnerLine.GlobalRunnerPickOwn:
        return translator.translateText(REMEDIATION_GLOBAL_RUNNER_PICK_TEXT);
      case RuleRunnerLine.GlobalRunnerAddOwn:
        return (
          <TranslatedSentence
            template={REMEDIATION_GLOBAL_RUNNER_ADD_TEMPLATE}
            slots={{
              location: runnersLocation,
            }}
          />
        );
      case RuleRunnerLine.GlobalRunner:
        return translator.translateText(REMEDIATION_GLOBAL_RUNNER_TEXT);
      case RuleRunnerLine.AddRunner:
        return (
          <TranslatedSentence
            template={REMEDIATION_ADD_RUNNER_TEMPLATE}
            slots={{
              location: runnersLocation,
            }}
          />
        );
      case RuleRunnerLine.HiddenRunner:
        return translator.translateText(REMEDIATION_HIDDEN_RUNNER_HELPER_TEXT);
      case RuleRunnerLine.None:
        return null;
      default: {
        const unhandled: never = line;
        return unhandled;
      }
    }
  };

  const renderHelperText: () => ReactNode = (): ReactNode => {
    if (isForRemediation) {
      return renderRuleHelperText();
    }

    /*
     * A step global Runners never run, with no Runner to run it: why the
     * Global Runner is not open to it, and the two ways on - pick one of
     * the project's own, or make one the project default.
     */
    if (isForStep && model.outcome === RunnerPickerOutcome.NeedsOwnRunner) {
      return (
        <span className="text-amber-700">
          {model.pickedGlobalRunner ? (
            translator.translateText(PICKED_GLOBAL_RUNNER_NEEDS_OWN_TEXT)
          ) : (
            <TranslatedSentence
              template={NEEDS_OWN_RUNNER_TEMPLATE}
              slots={{
                stepType: props.stepTypeName || props.stepType,
                location: runnersLocation,
              }}
            />
          )}
        </span>
      );
    }

    // A step that picked none on a server that runs no global Runner.
    if (isForStep && model.outcome === RunnerPickerOutcome.NoGlobalRunner) {
      return translator.translateText(STEP_NO_GLOBAL_RUNNER_HELPER_TEXT);
    }

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
     * global choice cannot be picked (a step's list draws it as not open to
     * it; a repository's leaves it out).
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

  /*
   * A form's lines are its descriptions' size; a step's are smaller. An AI
   * rule's line reads like the hints under the rule's other pickers - Code
   * Repositories, MCP Servers, LLM Provider - small and close under its
   * box, with a field's gap before the next field (mb-2 on the form's
   * gap-y-3).
   */
  const lineClassName: string =
    props.isFormField && !isForRemediation ? "text-sm" : "text-xs";

  const helpSpacingClassName: string = isForRemediation
    ? "mt-1.5 mb-2"
    : props.isFormField
      ? "mt-2"
      : "mt-1.5";

  const helperText: ReactNode = renderHelperText();

  /*
   * A step's own Runner - its pick, or the project's default - that is not
   * connected: said before the run fails on it.
   */
  const waitingRunner: RunnerPickerOption | undefined = isForStep
    ? getWaitingProjectRunner(model)
    : undefined;

  return (
    <div data-testid={dataTestId}>
      {props.isFormField ? (
        <></>
      ) : (
        <label className="block text-xs font-medium text-gray-700 mb-1.5">
          {translator.translateText("Runner")}
        </label>
      )}
      {hasNothingToPick ? (
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
            placeholder={
              isForRemediation
                ? REMEDIATION_NO_RUNNER_PLACEHOLDER
                : "Select a Runner"
            }
            // A rule may pick none: without a Global Runner, by clearing it.
            isClearable={isRuleClearable}
            disabled={isForRemediation && options.length === 0}
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
          {helperText ? (
            <p
              className={`${helpSpacingClassName} ${lineClassName} text-gray-500`}
              data-testid={`${dataTestId}-help`}
            >
              {helperText}
            </p>
          ) : (
            <></>
          )}
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
          {waitingRunner ? (
            <p
              className={`${lineClassName} text-amber-700 mt-1`}
              data-testid={`${dataTestId}-runner-waiting`}
            >
              {translator.translateTemplate(RUNNER_NOT_CONNECTED_TEMPLATE, {
                runner: waitingRunner.name,
              })}
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
