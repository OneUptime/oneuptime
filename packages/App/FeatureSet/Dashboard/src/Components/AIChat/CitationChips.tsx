import { AIChatCitation } from "Common/Types/AI/AIChatTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import {
  navigateToCitationTarget,
  targetTypeToIcon,
} from "./CitationTargetNav";

export interface ComponentProps {
  citations: Array<AIChatCitation>;
}

/*
 * Server-minted citation chips. A chip with rowCount 0 is proof of absence —
 * the query ran and found nothing — and renders muted. Target-to-route and
 * target-to-icon mapping is shared with the widgets via CitationTargetNav.
 */
const CitationChips: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.citations || props.citations.length === 0) {
    return <></>;
  }

  const navigateToCitation: (citation: AIChatCitation) => void = (
    citation: AIChatCitation,
  ): void => {
    navigateToCitationTarget(citation.target);
  };

  return (
    <div>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
        Sources
      </div>
      <div className="flex flex-wrap gap-1.5">
        {props.citations.map((citation: AIChatCitation) => {
          const isEmpty: boolean = citation.rowCount === 0;
          const isNavigable: boolean = Boolean(citation.target);
          const icon: IconProp = citation.target
            ? targetTypeToIcon[citation.target.type]
            : IconProp.Search;

          return (
            <button
              key={citation.id}
              type="button"
              disabled={!isNavigable}
              title={
                isEmpty
                  ? `${citation.label} — checked, found nothing`
                  : citation.label
              }
              onClick={() => {
                navigateToCitation(citation);
              }}
              className={`group inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-2.5 text-xs transition-colors ${
                isEmpty
                  ? "border-gray-200 bg-gray-50 text-gray-400"
                  : "border-gray-200 bg-white text-gray-700"
              } ${
                isNavigable && !isEmpty
                  ? "cursor-pointer hover:border-gray-300 hover:bg-gray-50"
                  : isNavigable
                    ? "cursor-pointer hover:bg-gray-100"
                    : "cursor-default"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                  isEmpty
                    ? "bg-gray-200 text-gray-500"
                    : "bg-gray-900 text-white"
                }`}
              >
                {citation.id.replace("C", "")}
              </span>
              <Icon
                icon={icon}
                className="h-3 w-3 flex-shrink-0 text-gray-400"
              />
              <span className="truncate">{citation.label}</span>
              <span
                className={`rounded-full px-1.5 text-[10px] font-medium ${
                  isEmpty
                    ? "bg-gray-100 text-gray-400"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {isEmpty ? "0 rows" : `${citation.rowCount}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CitationChips;
