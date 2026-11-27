import {
  EXTERNAL_MCP_SERVER_TEST_COPY,
  EXTERNAL_MCP_SERVER_TOOLS_COPY,
  EXTERNAL_MCP_SERVER_TOOLS_SHOWN,
  EXTERNAL_MCP_SERVER_TOOL_COUNT,
  EXTERNAL_MCP_TOOL_MARK_COPY,
  EXTERNAL_MCP_TOOL_MARK_HINT,
  ExternalMcpServerStatusKind,
  getExternalMcpServerStatus,
  readStoredExternalMcpServerTools,
} from "./ExternalMcpServerCopy";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import ExternalMcpServerStatus from "./ExternalMcpServerStatus";
import ExternalMcpServerToolList, {
  ExternalMcpToolMarkActions,
} from "./ExternalMcpServerToolList";
import { getExternalMcpServerTestGate } from "./ExternalMcpServerTestApi";
import {
  ExternalMcpToolRow,
  countExternalMcpToolsServerMarksAsChange,
  countExternalMcpToolsToMark,
  getExternalMcpToolMarkGate,
  getExternalMcpToolRows,
  readExternalMcpToolMarks,
  removeExternalMcpToolMark,
} from "./ExternalMcpToolMarks";
import MarkExternalMcpToolModal from "./MarkExternalMcpToolModal";
import TestExternalMcpServerModal from "./TestExternalMcpServerModal";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpToolReadOnlyMark from "Common/Models/DatabaseModels/ExternalMcpToolReadOnlyMark";
import Toast from "Common/UI/Utils/Toast";
import { EXTERNAL_MCP_SERVER_TRANSPORT_TITLES } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import { ExternalMcpServerTool } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * A server's Tools card, on its page: how the server is doing - connected,
 * can't connect (and what it said), not checked yet - and the tools it
 * offers, each with whether it only reads, as OneUptime last read them.
 * "Test connection" connects again and reads them anew; the card shows what
 * the test found once it closes.
 *
 * For a Project Owner or Admin, each tool its server says nothing about
 * can be marked read-only, one at a time, through a dialog that says what
 * that means first; a marked one shows who marked it and when, and can
 * have its mark taken away (issue #11081). Over the list, a line says how
 * many tools could be marked - or, when the server marks all the others as
 * changes, that none can.
 */

export interface ComponentProps {
  serverId: ObjectID;
}

const SERVER_SELECT: {
  isEnabled: true;
  lastError: true;
  lastConnectedAt: true;
  lastCheckedAt: true;
  tools: true;
  transport: true;
  serverName: true;
  serverVersion: true;
} = {
  isEnabled: true,
  lastError: true,
  lastConnectedAt: true,
  lastCheckedAt: true,
  tools: true,
  transport: true,
  serverName: true,
  serverVersion: true,
};

const ExternalMcpServerToolsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [server, setServer] = useState<ExternalMcpServer | null>(null);
  const [marks, setMarks] = useState<Array<ExternalMcpToolReadOnlyMark>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isTesting, setIsTesting] = useState<boolean>(false);
  // The tool the mark dialog is open for.
  const [toolToMark, setToolToMark] = useState<ExternalMcpServerTool | null>(
    null,
  );
  // The tool whose mark is being taken away.
  const [removingToolName, setRemovingToolName] = useState<string | undefined>(
    undefined,
  );

  // Only the latest read may land: a test can finish while one is running.
  const currentRead: React.MutableRefObject<number> = useRef<number>(0);

  const load: (isQuiet: boolean) => Promise<void> = useCallback(
    async (isQuiet: boolean): Promise<void> => {
      currentRead.current = currentRead.current + 1;
      const read: number = currentRead.current;

      if (!isQuiet) {
        setIsLoading(true);
      }

      try {
        const [item, serverMarks]: [
          ExternalMcpServer | null,
          Array<ExternalMcpToolReadOnlyMark>,
        ] = await Promise.all([
          ModelAPI.getItem({
            modelType: ExternalMcpServer,
            id: props.serverId,
            select: SERVER_SELECT,
          }),
          readExternalMcpToolMarks(props.serverId),
        ]);

        if (read !== currentRead.current) {
          return;
        }

        setServer(item);
        setMarks(serverMarks);
        setError("");
      } catch (err) {
        if (read !== currentRead.current) {
          return;
        }

        // A quiet read that fails leaves the card as it was.
        if (!isQuiet) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (read === currentRead.current) {
        setIsLoading(false);
      }
    },
    [props.serverId.toString()],
  );

  useEffect(() => {
    load(false).catch(() => {
      // load answers every failure itself.
    });

    return () => {
      currentRead.current = currentRead.current + 1;
    };
  }, [props.serverId.toString()]);

  /*
   * Test is for whoever may change the server, as the server asks it.
   * Anyone else who may read it sees Test locked, its tooltip saying who
   * may; before the permission snapshot has landed it is not offered.
   */
  const testGate: PermissionGateResult = getExternalMcpServerTestGate();

  const buttons: Array<CardButtonSchema> =
    testGate.isAllowed || testGate.disabledReason
      ? [
          {
            title: EXTERNAL_MCP_SERVER_TEST_COPY.title,
            icon: IconProp.Play,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: !testGate.isAllowed,
            tooltip: testGate.isAllowed ? undefined : testGate.disabledReason,
            onClick: () => {
              if (testGate.isAllowed) {
                setIsTesting(true);
              }
            },
          },
        ]
      : [];

  /*
   * Marking a tool read-only, and taking a mark away, are for whoever may
   * create marks - a Project Owner or Admin, as the server asks it. Anyone
   * else sees each tool's status and who marked it, and no buttons: a
   * locked button on every row of a 200-tool list says nothing new.
   */
  const markGate: PermissionGateResult = getExternalMcpToolMarkGate();

  const removeMark: (row: ExternalMcpToolRow) => void = (
    row: ExternalMcpToolRow,
  ): void => {
    const markId: ObjectID | undefined = row.mark?.id || undefined;

    if (!markId) {
      return;
    }

    setRemovingToolName(row.tool.name);

    removeExternalMcpToolMark(markId)
      .then(async () => {
        Toast.success(
          translator.translateTemplate(
            EXTERNAL_MCP_TOOL_MARK_COPY.removedToast,
            { tool: row.tool.name },
          ),
        );
        await load(true);
      })
      .catch((err: unknown) => {
        Toast.error(
          `${translator.translateText(EXTERNAL_MCP_TOOL_MARK_COPY.removeFailed)} ${API.getFriendlyMessage(err)}`,
        );
      })
      .finally(() => {
        setRemovingToolName(undefined);
      });
  };

  const markActions: ExternalMcpToolMarkActions | undefined = markGate.isAllowed
    ? {
        onMark: (tool: ExternalMcpServerTool): void => {
          setToolToMark(tool);
        },
        onRemoveMark: removeMark,
        busyToolName: removingToolName,
      }
    : undefined;

  // Over the list, for whoever may mark: what can be marked, or why nothing can.
  const getMarkHint: (
    rows: Array<ExternalMcpToolRow>,
  ) => ReactElement | null = (
    rows: Array<ExternalMcpToolRow>,
  ): ReactElement | null => {
    if (!markActions) {
      return null;
    }

    const toMark: number = countExternalMcpToolsToMark(rows);

    if (toMark > 0) {
      return (
        <p
          className="text-sm text-gray-600"
          data-testid="external-mcp-server-tool-mark-hint"
        >
          {translator.translatePlural(EXTERNAL_MCP_TOOL_MARK_HINT, toMark)}
        </p>
      );
    }

    if (countExternalMcpToolsServerMarksAsChange(rows) > 0) {
      return (
        <p
          className="text-sm text-gray-600"
          data-testid="external-mcp-server-tool-mark-none"
        >
          {translator.translateText(
            EXTERNAL_MCP_TOOL_MARK_COPY.serverMarksChange,
          )}
        </p>
      );
    }

    return null;
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <TableSkeleton rows={4} columns={2} />;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            load(false).catch(() => {
              // load answers every failure itself.
            });
          }}
        />
      );
    }

    if (!server) {
      return <></>;
    }

    const status: ExternalMcpServerStatusKind =
      getExternalMcpServerStatus(server);
    const stored: {
      tools: Array<ExternalMcpServerTool>;
      changingTools: number;
      isRead: boolean;
    } = readStoredExternalMcpServerTools(server.tools);

    const facts: Array<string> = [];

    if (stored.isRead) {
      facts.push(
        translator.translatePlural(
          EXTERNAL_MCP_SERVER_TOOL_COUNT,
          stored.tools.length,
        ),
      );
    }

    if (server.transport) {
      facts.push(EXTERNAL_MCP_SERVER_TRANSPORT_TITLES[server.transport]);
    }

    // The server's own name for itself, as it said when it connected.
    if (server.serverName) {
      facts.push(
        [server.serverName, server.serverVersion].filter(Boolean).join(" "),
      );
    }

    if (server.lastCheckedAt) {
      facts.push(
        translator.translateTemplate("Checked {{time}}", {
          time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            server.lastCheckedAt,
          ),
        }),
      );
    }

    return (
      <div
        className="flex flex-col gap-4"
        data-testid="external-mcp-server-tools-card"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ExternalMcpServerStatus server={server} />
          {facts.length > 0 ? (
            <span className="text-xs text-gray-500 [overflow-wrap:anywhere]">
              {facts.join(" · ")}
            </span>
          ) : (
            <></>
          )}
        </div>

        {status === ExternalMcpServerStatusKind.CannotConnect &&
        server.lastError ? (
          <Alert
            type={AlertType.DANGER}
            strongTitle={EXTERNAL_MCP_SERVER_TEST_COPY.failed}
            title={server.lastError}
            textClassName="whitespace-pre-wrap [overflow-wrap:anywhere]"
            dataTestId="external-mcp-server-last-error"
          />
        ) : (
          <></>
        )}

        {!stored.isRead ? (
          <p className="text-sm text-gray-500">
            {translator.translateText(
              EXTERNAL_MCP_SERVER_TOOLS_COPY.notReadYet,
            )}
          </p>
        ) : stored.tools.length === 0 ? (
          <p className="text-sm text-gray-500">
            {translator.translateText(EXTERNAL_MCP_SERVER_TOOLS_COPY.noTools)}
          </p>
        ) : (
          <>
            {getMarkHint(
              getExternalMcpToolRows({ tools: stored.tools, marks }),
            ) || <></>}
            <ExternalMcpServerToolList
              tools={stored.tools}
              shownCount={EXTERNAL_MCP_SERVER_TOOLS_SHOWN}
              marks={marks}
              markActions={markActions}
            />
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <Card
        title={EXTERNAL_MCP_SERVER_TOOLS_COPY.title}
        description={EXTERNAL_MCP_SERVER_TOOLS_COPY.description}
        buttons={buttons}
      >
        {getBody()}
      </Card>

      {isTesting ? (
        <TestExternalMcpServerModal
          externalMcpServerId={props.serverId.toString()}
          marks={marks}
          onTested={() => {
            // The test kept what it found on the server: show it.
            load(true).catch(() => {
              // load answers every failure itself.
            });
          }}
          onClose={() => {
            setIsTesting(false);
          }}
        />
      ) : (
        <></>
      )}

      {toolToMark ? (
        <MarkExternalMcpToolModal
          externalMcpServerId={props.serverId}
          tool={toolToMark}
          onClose={() => {
            setToolToMark(null);
          }}
          onMarked={() => {
            setToolToMark(null);
            load(true).catch(() => {
              // load answers every failure itself.
            });
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ExternalMcpServerToolsCard;
