import {
  EXTERNAL_MCP_SERVER_SHOW_ALL_TOOLS,
  EXTERNAL_MCP_SERVER_TOOL_BADGES,
} from "./ExternalMcpServerCopy";
import { ExternalMcpServerTool } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The tools an external MCP server offers: each one's name, what it does,
 * and whether it only reads - the one thing that decides what OneUptime AI
 * may do with it (investigations use only the tools that read). The names
 * and descriptions are the server's own text, drawn as given, never looked
 * up for a translation.
 *
 * A server may offer up to 200 tools. With `shownCount`, the list shows
 * that many and a "Show all N tools" button opens the rest - a server's
 * page stays a page, not a 200-row list.
 */

export interface ComponentProps {
  tools: Array<ExternalMcpServerTool>;
  // Show this many until "Show all" is pressed; every tool when left out.
  shownCount?: number | undefined;
}

const ExternalMcpServerToolList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isShowingAll, setIsShowingAll] = useState<boolean>(false);

  const isFolding: boolean =
    props.shownCount !== undefined && props.tools.length > props.shownCount;

  const shownTools: Array<ExternalMcpServerTool> =
    isFolding && !isShowingAll
      ? props.tools.slice(0, props.shownCount)
      : props.tools;

  return (
    <div>
      <ul
        className="divide-y divide-gray-100"
        data-testid="external-mcp-server-tools"
      >
        {shownTools.map((tool: ExternalMcpServerTool): ReactElement => {
          return (
            <li
              key={tool.name}
              className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:gap-3"
              data-testid="external-mcp-server-tool"
              data-reads-only={tool.readsOnly ? "true" : "false"}
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
              </div>
              <span
                className={`inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  tool.readsOnly
                    ? "bg-green-50 text-green-700 ring-green-200"
                    : "bg-amber-50 text-amber-800 ring-amber-200"
                }`}
              >
                {translator.translateText(
                  tool.readsOnly
                    ? EXTERNAL_MCP_SERVER_TOOL_BADGES.readsOnly
                    : EXTERNAL_MCP_SERVER_TOOL_BADGES.mayChange,
                )}
              </span>
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
                props.tools.length,
              )}
        </button>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ExternalMcpServerToolList;
