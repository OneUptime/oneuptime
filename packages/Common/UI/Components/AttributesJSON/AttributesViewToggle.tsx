import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import { AttributesView } from "./AttributesJSONPreferences";
import BracesGlyph from "./BracesGlyph";

export interface ComponentProps {
  value: AttributesView;
  onChange: (view: AttributesView) => void;
  // What the rows are, for the group's accessible name. Default: "attributes".
  subject?: string | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

interface ViewOption {
  view: AttributesView;
  label: string;
}

const OPTIONS: ReadonlyArray<ViewOption> = [
  { view: "list", label: "List" },
  { view: "json", label: "JSON" },
];

// List / JSON switch for an attribute section, sized to sit beside "Copy JSON".
const AttributesViewToggle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const subject: string = props.subject || "attributes";

  return (
    <div
      role="group"
      aria-label={`Show ${subject} as`}
      className={`inline-flex h-6 flex-none items-center rounded-md bg-gray-100 p-0.5 ring-1 ring-inset ring-gray-200 ${props.className || ""}`}
      data-testid={props.dataTestId}
    >
      {OPTIONS.map((option: ViewOption): ReactElement => {
        const isActive: boolean = option.view === props.value;

        return (
          <button
            key={option.view}
            type="button"
            aria-pressed={isActive}
            className={`inline-flex h-5 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isActive
                ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                : "text-gray-500 hover:text-gray-800"
            }`}
            onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              if (!isActive) {
                props.onChange(option.view);
              }
            }}
          >
            <span aria-hidden="true" className="flex items-center">
              {option.view === "list" ? (
                <Icon
                  icon={IconProp.List}
                  className={`h-3 w-3 ${isActive ? "text-indigo-500" : ""}`}
                />
              ) : (
                <BracesGlyph
                  className={`h-3 w-3 ${isActive ? "text-indigo-500" : ""}`}
                />
              )}
            </span>
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

export default AttributesViewToggle;
