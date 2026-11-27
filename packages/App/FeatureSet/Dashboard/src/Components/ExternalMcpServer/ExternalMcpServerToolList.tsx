import {
  EXTERNAL_MCP_SERVER_SHOW_ALL_TOOLS,
  EXTERNAL_MCP_SERVER_TOOL_BADGES,
  EXTERNAL_MCP_TOOL_MARK_COPY,
  getExternalMcpToolMarkRefusalSentence,
} from "./ExternalMcpServerCopy";
import {
  ExternalMcpToolRow,
  getExternalMcpToolRows,
} from "./ExternalMcpToolMarks";
import ExternalMcpToolReadOnlyMark from "Common/Models/DatabaseModels/ExternalMcpToolReadOnlyMark";
import { ExternalMcpServerTool } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import {
  ExternalMcpToolReadOnlyStatus,
  isExternalMcpToolReadOnly,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpToolReadOnlyMark";
import OneUptimeDate from "Common/Types/Date";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The tools an external MCP server offers: each one's name, what it does,
 * and whether it only reads - the one thing that decides what OneUptime AI
 * may do with it (investigations and answers in Slack and Microsoft Teams
 * use only the tools that read). A tool reads only by its server's word,
 * or by a Project Admin's mark while the tool is as it was when marked
 * (issue #11081): under such a tool, who marked it and when, or that the
 * server has changed it since. The names and descriptions are the server's
 * own text, drawn as given, never looked up for a translation.
 *
 * With `markActions`, for whoever may mark: Mark as Read-Only on a tool
 * its server says nothing about, Mark Again on one whose mark no longer
 * holds, Remove Mark on a marked one, and why a tool can never be marked.
 * One tool at a time: there is nothing that marks several.
 *
 * A server may offer up to 200 tools. With `shownCount`, the list shows
 * that many and a "Show all N tools" button opens the rest - a server's
 * page stays a page, not a 200-row list.
 */

export interface ExternalMcpToolMarkActions {
  // Opens the dialog that marks this tool (it says what marking means first).
  onMark: (tool: ExternalMcpServerTool) => void;
  // Takes the tool's mark away at once: OneUptime AI asks about it again.
  onRemoveMark: (row: ExternalMcpToolRow) => void;
  // The tool whose mark is being taken away now.
  busyToolName?: string | undefined;
}

export interface ComponentProps {
  tools: Array<ExternalMcpServerTool>;
  // Show this many until "Show all" is pressed; every tool when left out.
  shownCount?: number | undefined;
  // The server's read-only marks: each tool's status reads them.
  marks?: Array<ExternalMcpToolReadOnlyMark> | undefined;
  // For whoever may mark tools; left out, the list only shows.
  markActions?: ExternalMcpToolMarkActions | undefined;
}

// Who marked a tool and when, as the line under it says them.
function getMarkValues(mark: ExternalMcpToolReadOnlyMark | undefined): {
  name: string;
  date: string;
} {
  const name: string =
    mark?.createdByUser?.name?.toString() ||
    mark?.createdByUser?.email?.toString() ||
    "";

  return {
    name,
    date: mark?.createdAt
      ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(mark.createdAt)
      : "",
  };
}

const ExternalMcpServerToolList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isShowingAll, setIsShowingAll] = useState<boolean>(false);

  const rows: Array<ExternalMcpToolRow> = getExternalMcpToolRows({
    tools: props.tools,
    marks: props.marks,
  });

  const isFolding: boolean =
    props.shownCount !== undefined && rows.length > props.shownCount;

  const shownRows: Array<ExternalMcpToolRow> =
    isFolding && !isShowingAll ? rows.slice(0, props.shownCount) : rows;

  // The line under a tool that says how its mark stands, or why it has none.
  const getStatusLine: (row: ExternalMcpToolRow) => ReactElement | null = (
    row: ExternalMcpToolRow,
  ): ReactElement | null => {
    const values: { name: string; date: string } = getMarkValues(row.mark);

    if (row.status === ExternalMcpToolReadOnlyStatus.MarkedReadOnly) {
      return (
        <p
          className="mt-1 text-xs text-gray-600"
          data-testid="external-mcp-server-tool-mark"
        >
          {translator.translateTemplate(
            values.name
              ? EXTERNAL_MCP_TOOL_MARK_COPY.markedBy
              : EXTERNAL_MCP_TOOL_MARK_COPY.markedByNobody,
            values,
          )}
        </p>
      );
    }

    if (row.status === ExternalMcpToolReadOnlyStatus.MarkLapsed) {
      return (
        <p
          className="mt-1 text-xs text-amber-700"
          data-testid="external-mcp-server-tool-mark-lapsed"
        >
          {translator.translateTemplate(
            values.name
              ? EXTERNAL_MCP_TOOL_MARK_COPY.lapsedBy
              : EXTERNAL_MCP_TOOL_MARK_COPY.lapsedByNobody,
            values,
          )}
        </p>
      );
    }

    // Why it cannot be marked: for whoever would mark it.
    if (
      props.markActions &&
      row.status === ExternalMcpToolReadOnlyStatus.CannotBeMarked &&
      row.tool.markRefusal
    ) {
      const sentence: { template: string; values: Record<string, string> } =
        getExternalMcpToolMarkRefusalSentence(row.tool.markRefusal);

      return (
        <p
          className="mt-1 text-xs text-gray-500 [overflow-wrap:anywhere]"
          data-testid="external-mcp-server-tool-mark-refused"
        >
          {translator.translateTemplate(sentence.template, sentence.values)}
        </p>
      );
    }

    return null;
  };

  // The buttons beside a tool's pill, for whoever may mark.
  const getActions: (row: ExternalMcpToolRow) => Array<ReactElement> = (
    row: ExternalMcpToolRow,
  ): Array<ReactElement> => {
    const actions: ExternalMcpToolMarkActions | undefined = props.markActions;

    if (!actions) {
      return [];
    }

    const buttons: Array<ReactElement> = [];
    const isBusy: boolean = actions.busyToolName === row.tool.name;

    if (row.canBeMarked) {
      buttons.push(
        <Button
          key="mark"
          title={
            row.status === ExternalMcpToolReadOnlyStatus.MarkLapsed
              ? EXTERNAL_MCP_TOOL_MARK_COPY.markAgainButton
              : EXTERNAL_MCP_TOOL_MARK_COPY.markButton
          }
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          disabled={isBusy}
          dataTestId="external-mcp-server-tool-mark-button"
          onClick={() => {
            actions.onMark(row.tool);
          }}
        />,
      );
    }

    // A mark that holds or lapsed can be taken away; one OneUptime ignores too.
    if (row.mark) {
      buttons.push(
        <Button
          key="remove"
          title={EXTERNAL_MCP_TOOL_MARK_COPY.removeButton}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          buttonSize={ButtonSize.Small}
          isLoading={isBusy}
          disabled={isBusy}
          dataTestId="external-mcp-server-tool-remove-mark-button"
          onClick={() => {
            actions.onRemoveMark(row);
          }}
        />,
      );
    }

    return buttons;
  };

  return (
    <div>
      <ul
        className="divide-y divide-gray-100"
        data-testid="external-mcp-server-tools"
      >
        {shownRows.map((row: ExternalMcpToolRow): ReactElement => {
          const tool: ExternalMcpServerTool = row.tool;
          const readsOnly: boolean = isExternalMcpToolReadOnly(row.status);
          const actions: Array<ReactElement> = getActions(row);

          return (
            <li
              key={tool.name}
              className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:gap-3"
              data-testid="external-mcp-server-tool"
              data-reads-only={readsOnly ? "true" : "false"}
              data-status={row.status}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="break-all font-mono text-xs font-medium text-gray-900">
                    {tool.name}
                  </span>
                  {tool.title && tool.title !== tool.name ? (
                    <span className="text-xs text-gray-500">{tool.title}</span>
                  ) : (
                    <></>
                  )}
                </div>
                {tool.description ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-600 [overflow-wrap:anywhere]">
                    {tool.description}
                  </p>
                ) : (
                  <></>
                )}
                {getStatusLine(row) || <></>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Pill
                  text={
                    readsOnly
                      ? EXTERNAL_MCP_SERVER_TOOL_BADGES.readsOnly
                      : EXTERNAL_MCP_SERVER_TOOL_BADGES.mayChange
                  }
                  tone={readsOnly ? PillTone.Success : PillTone.Warning}
                  className="w-fit shrink-0"
                />
                {actions}
              </div>
            </li>
          );
        })}
      </ul>
      {isFolding ? (
        <button
          type="button"
          className="mt-2 rounded-sm text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-expanded={isShowingAll}
          data-testid="external-mcp-server-tools-show-all"
          onClick={() => {
            setIsShowingAll(!isShowingAll);
          }}
        >
          {isShowingAll
            ? translator.translateText("Show fewer")
            : translator.translatePlural(
                EXTERNAL_MCP_SERVER_SHOW_ALL_TOOLS,
                rows.length,
              )}
        </button>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ExternalMcpServerToolList;
