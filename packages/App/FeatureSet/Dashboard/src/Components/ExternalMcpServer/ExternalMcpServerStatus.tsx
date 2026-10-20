import {
  EXTERNAL_MCP_SERVER_STATUS_TITLES,
  EXTERNAL_MCP_SERVER_TOOL_COUNT,
  ExternalMcpServerStatusKind,
  getExternalMcpServerStatus,
  readStoredExternalMcpServerTools,
} from "./ExternalMcpServerCopy";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import { Gray500, Green, Red } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import Pill from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * How an external MCP server is doing, in the list and on its page: one
 * pill (Connected, Can't connect, Not checked yet, Off) and, once its tools
 * were read, how many it offers. A server that cannot connect shows why on
 * hover; its page shows it in full.
 */

const STATUS_COLORS: Record<ExternalMcpServerStatusKind, Color> = {
  [ExternalMcpServerStatusKind.Connected]: Green,
  [ExternalMcpServerStatusKind.CannotConnect]: Red,
  [ExternalMcpServerStatusKind.NotChecked]: Gray500,
  [ExternalMcpServerStatusKind.Off]: Gray500,
};

export interface ComponentProps {
  server: ExternalMcpServer;
  // Under the pill, how many tools the server offers.
  showToolCount?: boolean | undefined;
}

const ExternalMcpServerStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const status: ExternalMcpServerStatusKind = getExternalMcpServerStatus(
    props.server,
  );
  const stored: { tools: Array<unknown>; isRead: boolean } =
    readStoredExternalMcpServerTools(props.server.tools);

  return (
    <div
      className="flex flex-col items-start gap-1"
      data-testid="external-mcp-server-status"
      data-status={status}
    >
      <Pill
        color={STATUS_COLORS[status]}
        text={EXTERNAL_MCP_SERVER_STATUS_TITLES[status]}
        tooltip={
          status === ExternalMcpServerStatusKind.CannotConnect
            ? props.server.lastError || undefined
            : undefined
        }
      />
      {props.showToolCount && stored.isRead ? (
        <span className="text-xs text-gray-500">
          {translator.translatePlural(
            EXTERNAL_MCP_SERVER_TOOL_COUNT,
            stored.tools.length,
          )}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ExternalMcpServerStatus;
