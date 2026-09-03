import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, useRef } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  value: string;
  onChange: (value: string) => void;
  /* How many resources survive the current query, and how many there are. */
  matchedCount: number;
  totalCount: number;
}

/*
 * "Which of these is mine?"
 *
 * On a page with a couple of hundred resources under nested groups that
 * question previously had no answer except opening every group and reading.
 * The field filters resources by name and description, and keeps a group when
 * the group's own name is what was typed - searching a region should not
 * require knowing the name of a service inside it.
 */
const ResourceSearchBox: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const inputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);

  const hasQuery: boolean = props.value.trim().length > 0;

  return (
    <div
      role="search"
      className="mt-5"
      data-testid="status-page-resource-search"
    >
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
        </span>
        <input
          ref={inputRef}
          type="search"
          value={props.value}
          /*
           * Both a visible-on-focus label and a placeholder would be noise on a
           * one-field form, so the accessible name comes from aria-label - and
           * the count below is wired up with aria-describedby rather than left
           * as decoration, so a screen reader hears how many of them are left.
           */
          aria-label={t("search.label", {
            defaultValue: "Search resources",
          })}
          aria-describedby="status-page-resource-search-count"
          placeholder={t("search.placeholder", {
            defaultValue: "Search resources",
          })}
          data-testid="status-page-resource-search-input"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            props.onChange(event.target.value);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            /*
             * Escape clears rather than blurs. Getting back to the whole page
             * is the thing a visitor wants, and on a filtered page a blurred
             * field with text still in it looks like the page is broken.
             */
            if (event.key === "Escape" && hasQuery) {
              event.preventDefault();
              props.onChange("");
            }
          }}
          className="block w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-10 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {hasQuery && (
          <button
            type="button"
            data-testid="status-page-resource-search-clear"
            aria-label={t("search.clear", { defaultValue: "Clear search" })}
            onClick={() => {
              props.onChange("");
              inputRef.current?.focus();
            }}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 transition-colors hover:text-gray-700 focus:outline-none focus-visible:text-gray-900"
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
          </button>
        )}
      </div>
      <div
        id="status-page-resource-search-count"
        /*
         * Polite rather than assertive: the count changes on every keystroke,
         * and an assertive region would interrupt the visitor's own typing.
         */
        aria-live="polite"
        className="mt-1.5 min-h-[1rem] px-1 text-xs text-gray-500"
        data-testid="status-page-resource-search-count"
      >
        {hasQuery
          ? t("search.resultCount", {
              matched: props.matchedCount,
              total: props.totalCount,
              defaultValue: "{{matched}} of {{total}} resources",
            })
          : ""}
      </div>
    </div>
  );
};

export default ResourceSearchBox;
