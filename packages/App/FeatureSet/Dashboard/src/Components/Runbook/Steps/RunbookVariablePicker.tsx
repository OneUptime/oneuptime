import Route from "Common/Types/API/Route";
import { RunbookVariableScope } from "Common/Types/Runbook/RunbookVariableReference";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  RunbookVariableChoice,
  RunbookVariableChoices,
  VariableUseProblem,
  findVariableChoice,
  getSecretVariableChoices,
  getVariableUseProblem,
} from "./RunbookVariableChoices";

/*
 * Picks the secret variable a step signs in with, or holds its kubeconfig
 * in - an SSH step's key or password and passphrase, a kubectl step's
 * kubeconfig. Secrets only: a key or a password in a plain value would be
 * readable by everyone who reads the project's variables. The step keeps
 * the reference ({{global.variables.NAME}}), never the value.
 *
 * It says, under the picker, what the server would fail the step for: a
 * variable that is not there any more, or one the step's Runner may not
 * use. With nothing to pick, it says where to add one - in a new tab, so the
 * steps being edited stay; the page reads the variables again when the
 * person comes back.
 */

export interface ComponentProps {
  // English, looked up when drawn.
  label: string;
  // The reference the step holds: "" for none.
  value: string;
  onChange: (value: string) => void;
  choices: RunbookVariableChoices;
  // The step's Runner, to say when it may not use the secret picked.
  runnerId: string;
  /*
   * A first choice that names no variable, with its label (English): a
   * kubectl step's "The Runner's own access". Left out, the picker has
   * none and starts empty.
   */
  noneLabel?: string | undefined;
  helperText: ReactNode;
  dataTestId: string;
}

const RunbookVariablePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const secrets: Array<RunbookVariableChoice> = getSecretVariableChoices(
    props.choices,
  );

  const thisRunbook: string =
    translator.translateText("this runbook") || "this runbook";

  const toOption: (choice: RunbookVariableChoice) => DropdownOption = (
    choice: RunbookVariableChoice,
  ): DropdownOption => {
    return {
      value: choice.reference,
      label:
        choice.scope === RunbookVariableScope.Local
          ? `${choice.name} · ${thisRunbook}`
          : choice.name,
      // A name someone gave it: drawn as typed, never translated.
      isUserContent: true,
    };
  };

  const noneOption: DropdownOption | undefined = props.noneLabel
    ? {
        value: "",
        // English: the dropdown looks it up.
        label: props.noneLabel,
      }
    : undefined;

  const options: Array<DropdownOption> = [
    ...(noneOption ? [noneOption] : []),
    ...secrets.map(toOption),
  ];

  const picked: RunbookVariableChoice | undefined = props.value
    ? findVariableChoice(props.choices, props.value)
    : undefined;

  /*
   * A step that names what is not offered - a variable deleted since, or a
   * plain value - shows what it names, so the reader sees what the step
   * would run with.
   */
  const unlistedOption: DropdownOption | undefined =
    props.value && !(picked && picked.isSecret)
      ? { value: props.value, label: props.value, isUserContent: true }
      : undefined;

  const selected: DropdownOption | undefined = props.value
    ? unlistedOption || (picked ? toOption(picked) : undefined)
    : noneOption;

  const problem: VariableUseProblem | null = getVariableUseProblem({
    choices: props.choices,
    reference: props.value,
    runnerId: props.runnerId,
  });

  const variablesLocation: ReactElement = (
    <Link
      to={RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUNBOOKS_VARIABLES] as Route,
      )}
      openInNewTab={true}
      className="font-semibold underline underline-offset-2 hover:decoration-2"
      dataTestId={`${props.dataTestId}-variables-link`}
    >
      {translator.translateText("Runbooks › Settings › Global Variables")}
    </Link>
  );

  const renderProblem: () => ReactNode = (): ReactNode => {
    if (problem === VariableUseProblem.Unknown) {
      return translator.translateTemplate(
        "This step names {{reference}}, which is not one of this project's variables any more, so it will fail when it runs. Pick another.",
        { reference: props.value },
      );
    }

    if (problem === VariableUseProblem.NotSecret) {
      return translator.translateTemplate(
        "{{name}} is not a secret, so the step will fail when it runs. Keep keys, passwords and kubeconfigs in secret variables.",
        { name: picked?.name || props.value },
      );
    }

    if (problem === VariableUseProblem.NotForRunner) {
      return (
        <TranslatedSentence
          template="The Runner picked above may not use {{name}}, so the step will fail when it runs. Add the Runner to the variable's Runners under {{location}}."
          values={{ name: picked?.name || props.value }}
          slots={{ location: variablesLocation }}
        />
      );
    }

    return null;
  };

  if (secrets.length === 0 && !props.value && !noneOption) {
    return (
      <div data-testid={props.dataTestId}>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">
          {translator.translateText(props.label)}
        </label>
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          data-testid={`${props.dataTestId}-nothing-to-pick`}
        >
          {props.choices.isReadable ? (
            <TranslatedSentence
              template="No secret variables yet. Add one under {{location}}, then pick it here."
              slots={{ location: variablesLocation }}
            />
          ) : (
            translator.translateText(
              "The project's variables could not be read: reading them takes Project Admin, Runbook Admin or Read Runbook Variable.",
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-testid={props.dataTestId}>
      <label className="block text-xs font-medium text-gray-700 mb-1.5">
        {translator.translateText(props.label)}
      </label>
      <Dropdown
        options={
          unlistedOption &&
          !options.find((option: DropdownOption) => {
            return option.value === unlistedOption.value;
          })
            ? [unlistedOption, ...options]
            : options
        }
        value={selected}
        placeholder="Pick a secret variable"
        isClearable={false}
        ariaLabel={props.label}
        dataTestId={`${props.dataTestId}-dropdown`}
        onChange={(value: DropdownValue | Array<DropdownValue> | null): void => {
          const reference: string =
            value === null || value === undefined
              ? ""
              : Array.isArray(value)
                ? String(value[0] ?? "")
                : String(value);
          props.onChange(reference);
        }}
      />
      {problem ? (
        <p
          className="text-xs text-amber-700 mt-1.5"
          data-testid={`${props.dataTestId}-problem`}
        >
          {renderProblem()}
        </p>
      ) : (
        <p className="text-xs text-gray-500 mt-1.5">{props.helperText}</p>
      )}
    </div>
  );
};

export default RunbookVariablePicker;
