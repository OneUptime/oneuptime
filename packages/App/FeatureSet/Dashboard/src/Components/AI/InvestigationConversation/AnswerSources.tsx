import { navigateToCitationTarget } from "../../AIChat/CitationTargetNav";
import { AIChatCitation } from "Common/Types/AI/AIChatTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  citations: Array<AIChatCitation>;
}

/*
 * How many rows a cited query returned. Zero is a finding, not a failure:
 * the query ran and found nothing, which is how an answer proves an absence.
 */
export function describeSourceRows(rowCount: number): string {
  if (!Number.isFinite(rowCount) || rowCount <= 0) {
    return "no rows";
  }

  return `${rowCount.toLocaleString("en-US")} ${rowCount === 1 ? "row" : "rows"}`;
}

const ID_CLASS_NAME: string =
  "inline-flex h-[18px] min-w-[1.5rem] flex-shrink-0 items-center justify-center rounded px-1 text-[11px] font-semibold tabular-nums bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200";

/*
 * What an answer in the AI Investigation card's conversation read, one line
 * per server-minted citation: the same C# mark its text carries, what was
 * queried and how much came back. A source with a page of its own (logs,
 * traces, a monitor) opens it; one without (a kubectl command) is a plain
 * line, never a button that does nothing.
 *
 * The Ask AI panel draws its sources as bordered pills (AIChat/CitationChips).
 * Here they sit in a card that draws no boxes inside itself, under an answer
 * that already carries the marks, so they are a quiet list.
 */
const AnswerSources: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.citations || props.citations.length === 0) {
    return <></>;
  }

  return (
    <div data-testid="investigation-conversation-sources">
      <h4 className="text-xs font-medium text-gray-500">Sources</h4>
      <ul role="list" className="mt-1">
        {props.citations.map((citation: AIChatCitation): ReactElement => {
          const isEmpty: boolean = !(citation.rowCount > 0);
          const title: string = isEmpty
            ? `${citation.label} — checked, found nothing`
            : citation.label;
          const line: ReactElement = (
            <>
              <span className={ID_CLASS_NAME}>{citation.id}</span>
              <span className="min-w-0 break-words">
                {citation.label}
                <span className="text-gray-400">
                  {" "}
                  · {describeSourceRows(citation.rowCount)}
                </span>
              </span>
            </>
          );

          return (
            <li key={citation.id} data-citation-id={citation.id}>
              {citation.target ? (
                /*
                 * The hover wash reaches a little past the text on both
                 * sides, like the card's other clickable rows.
                 */
                <button
                  type="button"
                  title={title}
                  onClick={() => {
                    navigateToCitationTarget(citation.target);
                  }}
                  className="group -mx-1.5 flex w-[calc(100%+0.75rem)] items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-xs leading-5 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  {line}
                  {/* A div, not a span: Icon renders its own div. */}
                  <div className="flex h-5 flex-shrink-0 items-center self-start">
                    <Icon
                      icon={IconProp.ExternalLink}
                      className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-600"
                    />
                  </div>
                </button>
              ) : (
                <div
                  title={title}
                  className="flex items-baseline gap-2 py-1 text-xs leading-5 text-gray-600"
                >
                  {line}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default AnswerSources;
