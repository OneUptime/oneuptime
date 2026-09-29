import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onCreateButtonClicked: () => void;
}

const CreateNewProjectButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <li
      className="relative select-none py-2.5 px-3 mx-2 mt-2 cursor-pointer bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors duration-150 border border-indigo-200"
      id="listbox-option-0"
      role="option"
      onClick={() => {
        props.onCreateButtonClicked();
      }}
    >
      <div className="flex items-center gap-3">
        <Icon
          icon={IconProp.Add}
          className="h-5 w-5 flex-shrink-0 text-indigo-500"
        />
        <span className="text-sm font-medium text-indigo-600">
          Create New Project
        </span>
      </div>
    </li>
  );
};

export default CreateNewProjectButton;
