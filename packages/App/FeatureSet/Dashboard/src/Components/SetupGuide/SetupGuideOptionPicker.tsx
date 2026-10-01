import React, { FunctionComponent, ReactElement, useId, useRef } from "react";
import {
  SetupGuideOption,
  SetupGuideOptionGroup,
  groupSetupGuideOptions,
} from "./SetupGuide";

/*
 * "Where is your cluster running?" — the choice at the top of a guide. Only
 * the chosen option's instructions are shown below it.
 *
 * A radio group: one option is always selected, Tab enters and leaves the
 * group on the selected option, and the arrow keys (plus Home / End) move
 * the selection, as a native radio group does.
 *
 * "cards" shows each option's description and suits a handful of options;
 * "pills" is a compact row for a long list of short names (database engines).
 */
export type SetupGuideOptionLayout = "cards" | "pills";

export interface ComponentProps {
  label: string;
  options: ReadonlyArray<SetupGuideOption>;
  selectedKey: string | undefined;
  onSelect: (key: string) => void;
  layout?: SetupGuideOptionLayout | undefined;
}

const SetupGuideOptionPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const labelId: string = `setup-guide-options-${useId()}`;
  const optionRefs: React.MutableRefObject<Map<string, HTMLButtonElement>> =
    useRef<Map<string, HTMLButtonElement>>(new Map());

  const layout: SetupGuideOptionLayout = props.layout || "cards";
  const groups: Array<SetupGuideOptionGroup> = groupSetupGuideOptions(
    props.options,
  );

  // Keyboard order is display order, which grouping can differ from.
  const orderedOptions: Array<SetupGuideOption> = groups.flatMap(
    (group: SetupGuideOptionGroup): Array<SetupGuideOption> => {
      return group.options;
    },
  );

  const selectAndFocus: (key: string) => void = (key: string): void => {
    props.onSelect(key);
    optionRefs.current.get(key)?.focus();
  };

  const onKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    key: string,
  ) => void = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    key: string,
  ): void => {
    const index: number = orderedOptions.findIndex(
      (option: SetupGuideOption): boolean => {
        return option.key === key;
      },
    );
    const last: number = orderedOptions.length - 1;
    let next: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = index >= last ? 0 : index + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = index <= 0 ? last : index - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    }

    if (next === null) {
      return;
    }

    event.preventDefault();
    selectAndFocus(orderedOptions[next]!.key);
  };

  const isTabStop: (key: string) => boolean = (key: string): boolean => {
    const hasSelection: boolean = orderedOptions.some(
      (option: SetupGuideOption): boolean => {
        return option.key === props.selectedKey;
      },
    );
    return hasSelection
      ? key === props.selectedKey
      : key === orderedOptions[0]?.key;
  };

  const renderOption: (option: SetupGuideOption) => ReactElement = (
    option: SetupGuideOption,
  ): ReactElement => {
    const isSelected: boolean = option.key === props.selectedKey;

    const commonProps: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      "data-testid": string;
    } = {
      type: "button",
      role: "radio",
      "aria-checked": isSelected,
      tabIndex: isTabStop(option.key) ? 0 : -1,
      onClick: () => {
        props.onSelect(option.key);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown(event, option.key);
      },
      "data-testid": `setup-guide-option-${option.key}`,
    };

    const setRef: (element: HTMLButtonElement | null) => void = (
      element: HTMLButtonElement | null,
    ): void => {
      if (element) {
        optionRefs.current.set(option.key, element);
      } else {
        optionRefs.current.delete(option.key);
      }
    };

    if (layout === "pills") {
      return (
        <button
          key={option.key}
          ref={setRef}
          {...commonProps}
          title={option.description}
          className={`px-3.5 py-1.5 text-sm font-medium rounded-lg border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
            isSelected
              ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
              : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50"
          }`}
        >
          {option.label}
        </button>
      );
    }

    return (
      <button
        key={option.key}
        ref={setRef}
        {...commonProps}
        className={`text-left px-4 py-3 rounded-lg border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
          isSelected
            ? "border-indigo-500 bg-indigo-50"
            : "border-gray-200 bg-white hover:border-gray-300"
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
              isSelected ? "border-indigo-600" : "border-gray-300"
            }`}
          >
            {isSelected && (
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={`text-sm font-semibold ${
                  isSelected ? "text-indigo-700" : "text-gray-900"
                }`}
              >
                {option.label}
              </span>
              {option.badge && (
                <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 ring-1 ring-inset ring-green-200">
                  {option.badge}
                </span>
              )}
            </span>
            {option.description && (
              <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">
                {option.description}
              </span>
            )}
          </span>
        </div>
      </button>
    );
  };

  const renderGroupOptions: (group: SetupGuideOptionGroup) => ReactElement = (
    group: SetupGuideOptionGroup,
  ): ReactElement => {
    if (layout === "pills") {
      return (
        <div className="flex flex-wrap gap-1.5">
          {group.options.map(renderOption)}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {group.options.map(renderOption)}
      </div>
    );
  };

  return (
    <div className="mb-6" data-testid="setup-guide-options">
      <div
        id={labelId}
        className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500"
      >
        {props.label}
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className="space-y-3">
        {groups.map((group: SetupGuideOptionGroup, index: number) => {
          return (
            <div key={group.label || `group-${index}`}>
              {group.label && (
                <div className="mb-1.5 text-xs font-semibold text-gray-700">
                  {group.label}
                </div>
              )}
              {renderGroupOptions(group)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SetupGuideOptionPicker;
