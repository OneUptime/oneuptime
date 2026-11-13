import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onCreateButtonClicked: () => void;
  // The row's own id, unique on the page (aria-activedescendant names it).
  id: string;
  // The arrow keys (or the pointer) are on this row.
  isActive?: boolean | undefined;
  // The row is drawn as the one the keyboard is on.
  showsActive?: boolean | undefined;
  onPointerOver?: (() => void) | undefined;
}

const CreateNewProjectButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <li
      className={`relative select-none py-2.5 px-3 mx-2 mt-2 cursor-pointer hover:bg-indigo-100 rounded-lg transition-colors duration-150 border border-indigo-200 ${
        props.isActive && props.showsActive ? "bg-indigo-100" : "bg-indigo-50"
      }`}
      id={props.id}
      role="option"
      aria-selected={Boolean(props.isActive)}
      onMouseMove={() => {
        props.onPointerOver?.();
      }}
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
          {translator.translateText("Create New Project")}
        </span>
      </div>
    </li>
  );
};

export default CreateNewProjectButton;
