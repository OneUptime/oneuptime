import React, { FunctionComponent, ReactElement, useState, useMemo } from "react";
import { FacetValue } from "../types";
import FacetValueRow from "./FacetValueRow";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";

export interface FacetSectionProps {
  title: string;
  values: Array<FacetValue>;
  initialVisibleCount?: number;
  onIncludeValue: (key: string, value: string) => void;
  onExcludeValue: (key: string, value: string) => void;
  facetKey: string;
  valueDisplayMap?: Record<string, string> | undefined;
  valueColorMap?: Record<string, string> | undefined;
  activeValues?: Set<string> | undefined;
}

const DEFAULT_VISIBLE_COUNT: number = 5;
const SEARCH_THRESHOLD: number = 6;

const FacetSection: FunctionComponent<FacetSectionProps> = (
  props: FacetSectionProps,
): ReactElement => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showAll, setShowAll] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>("");

  const showSearch: boolean = props.values.length >= SEARCH_THRESHOLD;

  const filteredValues: Array<FacetValue> = useMemo(() => {
    if (!searchText.trim()) {
      return props.values;
    }
    const query: string = searchText.toLowerCase().trim();
    return props.values.filter((facet: FacetValue) => {
      const displayName: string =
        props.valueDisplayMap?.[facet.value] ?? facet.value;
      return displayName.toLowerCase().includes(query);
    });
  }, [props.values, props.valueDisplayMap, searchText]);

  const visibleCount: number =
    props.initialVisibleCount ?? DEFAULT_VISIBLE_COUNT;

  const displayedValues: Array<FacetValue> = searchText.trim()
    ? filteredValues
    : showAll
      ? filteredValues
      : filteredValues.slice(0, visibleCount);

  const hasMore: boolean = !searchText.trim() && filteredValues.length > visibleCount;

  const maxCount: number =
    props.values.length > 0
      ? Math.max(
          ...props.values.map((v: FacetValue) => {
            return v.count;
          }),
        )
      : 0;

  const activeCount: number = props.activeValues ? props.activeValues.size : 0;

  return (
    <div className="border-b border-gray-100 py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between px-2 py-1 text-left"
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {props.title}
          </span>
          {activeCount > 0 && (
            <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-600">
              {activeCount}
            </span>
          )}
        </div>
        <Icon
          icon={isExpanded ? IconProp.ChevronDown : IconProp.ChevronRight}
          className="h-3 w-3 text-gray-400"
        />
      </button>

      {isExpanded && (
        <div className="mt-1 px-1">
          {showSearch && (
            <div className="mb-1 px-1">
              <input
                type="text"
                placeholder={`Search ${props.title.toLowerCase()}...`}
                value={searchText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setSearchText(e.target.value);
                }}
                className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-700 placeholder-gray-400 outline-none focus:border-indigo-300 focus:bg-white focus:ring-1 focus:ring-indigo-200"
              />
            </div>
          )}

          {displayedValues.map((facet: FacetValue) => {
            return (
              <FacetValueRow
                key={facet.value}
                value={facet.value}
                displayValue={props.valueDisplayMap?.[facet.value]}
                count={facet.count}
                maxCount={maxCount}
                color={props.valueColorMap?.[facet.value]}
                isActive={props.activeValues?.has(facet.value) || false}
                onInclude={(value: string) => {
                  props.onIncludeValue(props.facetKey, value);
                }}
                onExclude={(value: string) => {
                  props.onExcludeValue(props.facetKey, value);
                }}
              />
            );
          })}

          {displayedValues.length === 0 && (
            <p className="px-1 py-2 text-[11px] text-gray-400">
              {searchText.trim() ? "No matches found" : "No values found"}
            </p>
          )}

          {hasMore && (
            <button
              type="button"
              className="mt-1 px-1 text-[11px] font-medium text-indigo-500 hover:text-indigo-600"
              onClick={() => {
                setShowAll(!showAll);
              }}
            >
              {showAll
                ? "Show less"
                : `+${props.values.length - visibleCount} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default FacetSection;
