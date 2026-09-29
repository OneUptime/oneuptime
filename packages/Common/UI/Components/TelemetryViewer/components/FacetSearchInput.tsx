import React, { FunctionComponent, ReactElement, useRef } from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";

export interface FacetSearchInputProps {
  // Facet title; names the box ("Search Host") and fills the placeholder.
  title: string;
  value: string;
  onChange: (searchText: string) => void;
}

/*
 * A facet section's search box: leading magnifying glass, a clear button once
 * there is text, and Escape to clear. Shared by the Logs and Telemetry facet
 * sections so the two sidebars cannot drift apart.
 */
const FacetSearchInput: FunctionComponent<FacetSearchInputProps> = (
  props: FacetSearchInputProps,
): ReactElement => {
  const inputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);

  const hasText: boolean = props.value.length > 0;

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2">
        <Icon
          icon={IconProp.MagnifyingGlass}
          className="h-3 w-3 text-gray-400"
        />
      </div>
      <input
        ref={inputRef}
        type="text"
        /*
         * A placeholder disappears as soon as the user types, taking the
         * field's only description with it; the aria-label stays.
         */
        aria-label={`Search ${props.title}`}
        placeholder={`Search ${props.title.toLowerCase()}...`}
        value={props.value}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          props.onChange(event.target.value);
        }}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          /*
           * Escape clears a non-empty box and stops there. An empty box lets
           * the key through, so viewer-level Escape handling still works.
           */
          if (event.key === "Escape" && hasText) {
            event.preventDefault();
            event.stopPropagation();
            props.onChange("");
          }
        }}
        className={`w-full rounded border border-gray-200 bg-gray-50 py-1 pl-6 text-[11px] text-gray-700 placeholder-gray-400 outline-none transition-colors focus:border-indigo-300 focus:bg-white focus:ring-1 focus:ring-indigo-200 ${
          hasText ? "pr-6" : "pr-2"
        }`}
      />
      {hasText && (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          className="absolute inset-y-0 right-0 flex items-center rounded pr-1.5 pl-1 text-gray-400 transition-colors hover:text-gray-600"
          onClick={() => {
            props.onChange("");
            inputRef.current?.focus();
          }}
        >
          <Icon icon={IconProp.XMark} className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

export default FacetSearchInput;
