import {
  EXTERNAL_MCP_SERVER_TEST_COPY,
  EXTERNAL_MCP_SERVER_TOOLS_COPY,
  EXTERNAL_MCP_SERVER_TOOLS_SHOWN,
  EXTERNAL_MCP_SERVER_TOOL_COUNT,
  ExternalMcpServerStatusKind,
  getExternalMcpServerStatus,
  readStoredExternalMcpServerTools,
} from "./ExternalMcpServerCopy";
import ExternalMcpServerStatus from "./ExternalMcpServerStatus";
import ExternalMcpServerToolList from "./ExternalMcpServerToolList";
import { getExternalMcpServerTestGate } from "./ExternalMcpServerTestApi";
import TestExternalMcpServerModal from "./TestExternalMcpServerModal";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import { EXTERNAL_MCP_SERVER_TRANSPORT_TITLES } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import { ExternalMcpServerTool } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
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
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isTesting, setIsTesting] = useState<boolean>(false);

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
        const item: ExternalMcpServer | null = await ModelAPI.getItem({
          modelType: ExternalMcpServer,
          id: props.serverId,
          select: SERVER_SELECT,
        });

        if (read !== currentRead.current) {
          return;
        }

        setServer(item);
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

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
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
          <ExternalMcpServerToolList
            tools={stored.tools}
            shownCount={EXTERNAL_MCP_SERVER_TOOLS_SHOWN}
          />
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
    </>
  );
};

export default ExternalMcpServerToolsCard;
