import React, { FunctionComponent, ReactElement } from "react";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  findDropdownOption,
  getNamedDropdownOption,
  getTranslatedDropdownOption,
  readPickedDropdownValue,
} from "Common/UI/Components/Dropdown/DropdownChoices";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  variables?: Array<DashboardVariable> | undefined;
  value?: string | undefined;
  onChange: (value: string) => void;
}

/*
 * Picks one of the dashboard's Telemetry Attribute variables for a widget
 * that follows that variable's toolbar selection — the SLO widget's "Follow
 * SLO Variable".
 *
 * Only Telemetry Attribute variables are offered because they are the only
 * kind whose selection the public dashboard route resolves from stored
 * config; a Custom List variable would work in the app and silently show
 * nothing to an anonymous viewer. Mirrors ProjectLabelVariableDropdown: the
 * shared Dropdown, cleared to "None" to drop the binding, and an inline
 * explanation when the stored binding points at a variable that is gone.
 */
const TelemetryAttributeVariableDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const variables: Array<DashboardVariable> = (props.variables || []).filter(
    (variable: DashboardVariable): boolean => {
      return variable.type === DashboardVariableType.TelemetryAttribute;
    },
  );

  const selected: DashboardVariable | undefined = variables.find(
    (variable: DashboardVariable): boolean => {
      return variable.id === props.value;
    },
  );

  const isMissing: boolean = Boolean(props.value && !selected);

  type GetOptionLabelFunction = (variable: DashboardVariable) => string;

  // The key is part of the label: two "SLO" variables on different keys are otherwise indistinguishable.
  const getOptionLabel: GetOptionLabelFunction = (
    variable: DashboardVariable,
  ): string => {
    const name: string = variable.label || variable.name;

    return variable.attributeKey ? `${name} (${variable.attributeKey})` : name;
  };

  // A variable's name is drawn as it was written, never looked up.
  const options: Array<DropdownOption> = [
    ...(isMissing && props.value
      ? [
          getTranslatedDropdownOption(
            props.value,
            translator.translateText("Unavailable variable") ||
              "Unavailable variable",
          ),
        ]
      : []),
    ...variables.map((variable: DashboardVariable): DropdownOption => {
      return getNamedDropdownOption(variable.id, getOptionLabel(variable));
    }),
  ];

  return (
    <div>
      <Dropdown
        options={options}
        value={findDropdownOption(options, props.value)}
        // Cleared, the widget follows no variable: "None".
        placeholder={translator.translateText("None")}
        isPlaceholderTranslated={true}
        ariaLabel={translator.translateText("Follow Variable")}
        isAriaLabelTranslated={true}
        onChange={(next: DropdownValue | Array<DropdownValue> | null): void => {
          props.onChange(readPickedDropdownValue(next) || "");
        }}
      />
      {isMissing ? (
        <p role="alert" className="text-xs text-red-600 mt-1">
          {translator.translateText(
            "This variable was removed or is no longer a Telemetry Attribute variable. Choose another variable or clear the binding.",
          )}
        </p>
      ) : selected && selected.isMultiSelect ? (
        <p className="text-xs text-gray-500 mt-1">
          {translator.translateText(
            "This variable allows several picks. The widget shows an SLO only while exactly one is picked.",
          )}
        </p>
      ) : variables.length === 0 ? (
        <p className="text-xs text-gray-500 mt-1">
          {translator.translateText(
            "Add a Telemetry Attribute variable from the dashboard toolbar to use it here.",
          )}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TelemetryAttributeVariableDropdown;
