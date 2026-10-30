import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallStatus,
} from "Common/Types/AutoRemediation/ExternalMcpToolCallPlan";
import RemediationFixFact, {
  RemediationFixFactVisual,
} from "./RemediationFixFact";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A fix OneUptime AI made, or proposes, through the project's external MCP
 * servers (an AutoRemediationSuggestion of type McpToolCalls), on the AI
 * card's Remediation step: each change in the order it is made - the server
 * and the tool, what it is sent, and once it was sent, what the server
 * answered. Each change is a line with a rule beside it, as a command of a
 * plan is: the AI card is the only frame (block 43).
 *
 * Approving makes exactly these calls, in this order, under the approver's
 * name. Tools that only read are not here: they were part of working the
 * fix out, and are in the run's activity.
 *
 * Where each change stands is a dot and its words (RemediationFixFact), as
 * a command's facts are: the step's own status is the card's one pill.
 */

export const MCP_TOOL_CALL_STATUS_VISUAL: Record<
  ExternalMcpToolCallStatus,
  RemediationFixFactVisual
> = {
  [ExternalMcpToolCallStatus.Proposed]: {
    label: translationKey("Proposed"),
    dot: "bg-amber-500",
  },
  [ExternalMcpToolCallStatus.Running]: {
    label: translationKey("Running"),
    dot: "bg-blue-500",
  },
  [ExternalMcpToolCallStatus.Succeeded]: {
    label: translationKey("Done"),
    dot: "bg-emerald-500",
  },
  [ExternalMcpToolCallStatus.Failed]: {
    label: translationKey("Failed"),
    dot: "bg-rose-500",
    isAlarming: true,
  },
  [ExternalMcpToolCallStatus.Skipped]: {
    label: translationKey("Not sent"),
    dot: "bg-gray-400",
  },
};

export const MCP_TOOL_CALL_LIST_COPY: {
  madeWithoutAsking: string;
  showAnswer: string;
  hideAnswer: string;
  noArguments: string;
  noCalls: string;
  notShown: string;
} = {
  madeWithoutAsking: translationKey("Made without asking"),
  showAnswer: translationKey("Show the server's answer"),
  hideAnswer: translationKey("Hide the server's answer"),
  noArguments: translationKey("No arguments"),
  noCalls: translationKey("No changes to make."),
  // A stored fix that cannot be read (never written by OneUptime itself).
  notShown: translationKey("The changes of this fix could not be shown."),
};

// What a call is sent, as the reader sees it: its arguments, indented.
export function formatMcpToolCallArguments(call: ExternalMcpToolCall): string {
  if (!call.arguments || Object.keys(call.arguments).length === 0) {
    return "";
  }

  try {
    return JSON.stringify(call.arguments, null, 2);
  } catch {
    return "";
  }
}

export interface ComponentProps {
  plan: ExternalMcpToolCallPlan;
  // The suggestion's id: keeps each call's open answer apart from another's.
  suggestionId: string;
}

const McpToolCallList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [openAnswers, setOpenAnswers] = useState<Set<number>>(
    new Set<number>(),
  );

  if (props.plan.calls.length === 0) {
    return (
      <div className="mt-3 text-xs text-gray-500">
        {translator.translateText(MCP_TOOL_CALL_LIST_COPY.noCalls)}
      </div>
    );
  }

  return (
    <ol
      className="mt-3 flex flex-col gap-3"
      data-testid="remediation-mcp-tool-calls"
    >
      {props.plan.calls.map((call: ExternalMcpToolCall): ReactElement => {
        const visual: RemediationFixFactVisual =
          MCP_TOOL_CALL_STATUS_VISUAL[call.status] ||
          MCP_TOOL_CALL_STATUS_VISUAL[ExternalMcpToolCallStatus.Proposed];
        const argumentsText: string = formatMcpToolCallArguments(call);
        const isAnswerOpen: boolean = openAnswers.has(call.sequence);

        return (
          <li
            key={`${props.suggestionId}:mcp:${call.sequence}`}
            className="border-l-2 border-gray-200 pl-3"
            data-testid="remediation-mcp-tool-call"
            data-status={call.status}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-medium text-gray-500">
                  {call.sequence}.
                </span>
                {/* The server's name and the tool's are the server's own text. */}
                <span className="text-xs font-medium text-gray-900 [overflow-wrap:anywhere]">
                  {call.serverNameSnapshot}
                </span>
                <code
                  data-testid="remediation-mcp-tool-name"
                  className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 [overflow-wrap:anywhere]"
                >
                  {call.toolName}
                </code>
              </span>
              <RemediationFixFact
                visual={visual}
                testId="remediation-mcp-tool-call-status"
              />
              {call.wasMadeWithoutAsking ? (
                <span className="text-xs text-gray-500">
                  {translator.translateText(
                    MCP_TOOL_CALL_LIST_COPY.madeWithoutAsking,
                  )}
                </span>
              ) : (
                <></>
              )}
            </div>

            {argumentsText ? (
              <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800">
                {argumentsText}
              </pre>
            ) : (
              <div className="mt-2 text-xs text-gray-500">
                {translator.translateText(MCP_TOOL_CALL_LIST_COPY.noArguments)}
              </div>
            )}

            {call.errorMessage ? (
              <div
                dir="auto"
                className="mt-2 whitespace-pre-wrap text-xs text-rose-700 [overflow-wrap:anywhere]"
              >
                {call.errorMessage}
              </div>
            ) : (
              <></>
            )}

            {call.resultText ? (
              <div className="mt-2">
                <button
                  type="button"
                  aria-expanded={isAnswerOpen}
                  className="rounded text-xs font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  onClick={() => {
                    setOpenAnswers((previous: Set<number>): Set<number> => {
                      const next: Set<number> = new Set<number>(previous);

                      if (next.has(call.sequence)) {
                        next.delete(call.sequence);
                      } else {
                        next.add(call.sequence);
                      }

                      return next;
                    });
                  }}
                >
                  {translator.translateText(
                    isAnswerOpen
                      ? MCP_TOOL_CALL_LIST_COPY.hideAnswer
                      : MCP_TOOL_CALL_LIST_COPY.showAnswer,
                  )}
                </button>
                {isAnswerOpen ? (
                  <pre
                    dir="auto"
                    className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800 [overflow-wrap:anywhere]"
                  >
                    {call.resultText}
                  </pre>
                ) : (
                  <></>
                )}
              </div>
            ) : (
              <></>
            )}
          </li>
        );
      })}
    </ol>
  );
};

export default McpToolCallList;
