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

const ProjectLabelVariableDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const variables: Array<DashboardVariable> = (props.variables || []).filter(
    (variable: DashboardVariable) => {
      return variable.type === DashboardVariableType.ProjectLabel;
    },
  );
  const selected: DashboardVariable | undefined = variables.find(
    (variable: DashboardVariable) => {
      return variable.id === props.value;
    },
  );
  const missing: boolean = Boolean(props.value && !selected);
  // A variable's name is drawn as it was written, never looked up.
  const options: Array<DropdownOption> = [
    ...(missing && props.value
      ? [
          getTranslatedDropdownOption(
            props.value,
            translator.translateText("Unavailable variable") ||
              "Unavailable variable",
          ),
        ]
      : []),
    ...variables.map((variable: DashboardVariable): DropdownOption => {
      return getNamedDropdownOption(
        variable.id,
        variable.label && variable.label !== variable.name
          ? `${variable.label} (${variable.name})`
          : variable.name,
      );
    }),
  ];
  return (
    <div>
      <Dropdown
        options={options}
        value={findDropdownOption(options, props.value)}
        // Cleared, the widget follows no label variable: "None".
        placeholder={translator.translateText("None")}
        isPlaceholderTranslated={true}
        ariaLabel={translator.translateText("Label Variable")}
        isAriaLabelTranslated={true}
        onChange={(next: DropdownValue | Array<DropdownValue> | null): void => {
          props.onChange(readPickedDropdownValue(next) || "");
        }}
      />
      {missing ? (
        <p role="alert" className="text-xs text-red-600 mt-1">
          {translator.translateText(
            "This label variable was removed or its source changed. Choose a Project Labels variable or clear the binding.",
          )}
        </p>
      ) : selected && !selected.labelOptions?.length ? (
        <p role="alert" className="text-xs text-red-600 mt-1">
          {translator.translateText(
            "Choose allowed labels for this variable in Dashboard Variables.",
          )}
        </p>
      ) : variables.length === 0 ? (
        <p className="text-xs text-gray-500 mt-1">
          {translator.translateText(
            "Add a Project Labels variable from the dashboard toolbar to use it here.",
          )}
        </p>
      ) : null}
    </div>
  );
};

export default ProjectLabelVariableDropdown;
