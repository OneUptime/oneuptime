import {
  EXTERNAL_MCP_SERVER_TEST_COPY,
  EXTERNAL_MCP_SERVER_TOOLS_COPY,
  getExternalMcpServerFailureHint,
} from "./ExternalMcpServerCopy";
import ExternalMcpServerToolList from "./ExternalMcpServerToolList";
import { testExternalMcpServer } from "./ExternalMcpServerTestApi";
import { ExternalMcpServerConnectionCheck } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import { EXTERNAL_MCP_SERVER_TRANSPORT_TITLES } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import { Indigo500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import Modal from "Common/UI/Components/Modal/Modal";
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
 * TEST CONNECTION, the dialog: OneUptime connects to a saved external MCP
 * server with its saved sign-in, reads its tools, and says what it found -
 * the server and how it talks, and each tool with whether it only reads.
 * Nothing is called on the server. Opened by a server's Test button, and
 * right after a server is added.
 *
 * Laid out as the LLM provider's test is (TestLlmProviderModal): while it
 * runs, what is happening; then one alert with a headline in the reader's
 * language and, for a failure, the server's own words and what to check.
 * "Test again" runs it again; every way out closes it, while it runs too,
 * and a late answer is then dropped.
 */

export interface ComponentProps {
  externalMcpServerId: string;
  onClose: () => void;
  // Called with every answer, so the page can show what was found.
  onTested?: ((check: ExternalMcpServerConnectionCheck) => void) | undefined;
}

const TestExternalMcpServerModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [check, setCheck] = useState<ExternalMcpServerConnectionCheck | null>(
    null,
  );

  // Which run's answer may still be shown: a new run or a close drops the last.
  const currentRun: React.MutableRefObject<number> = useRef<number>(0);

  const runTest: () => Promise<void> = useCallback(async (): Promise<void> => {
    currentRun.current = currentRun.current + 1;
    const run: number = currentRun.current;

    setCheck(null);

    const result: ExternalMcpServerConnectionCheck =
      await testExternalMcpServer(props.externalMcpServerId);

    if (run !== currentRun.current) {
      return;
    }

    setCheck(result);
    props.onTested?.(result);
  }, [props.externalMcpServerId]);

  useEffect(() => {
    runTest().catch(() => {
      // testExternalMcpServer answers every failure itself.
    });

    return () => {
      currentRun.current = currentRun.current + 1;
    };
  }, []);

  // The transport's own name (Streamable HTTP, SSE): a protocol, not a word.
  const transportTitle: string =
    check?.transport !== undefined
      ? EXTERNAL_MCP_SERVER_TRANSPORT_TITLES[check.transport]
      : "HTTP";

  return (
    <Modal
      title={EXTERNAL_MCP_SERVER_TEST_COPY.title}
      onClose={props.onClose}
      closeButtonText={EXTERNAL_MCP_SERVER_TEST_COPY.close}
      leftFooterElement={
        check ? (
          <Button
            title={EXTERNAL_MCP_SERVER_TEST_COPY.testAgain}
            buttonStyle={ButtonStyleType.NORMAL}
            icon={IconProp.Refresh}
            dataTestId="external-mcp-server-test-again"
            onClick={() => {
              runTest().catch(() => {
                // testExternalMcpServer answers every failure itself.
              });
            }}
          />
        ) : undefined
      }
    >
      <div
        data-testid="external-mcp-server-test"
        data-outcome={
          check ? (check.isConnected ? "connected" : "failed") : "testing"
        }
      >
        {!check ? (
          <div
            className="flex flex-col items-center gap-3 py-4 text-center"
            data-testid="external-mcp-server-test-running"
          >
            <Loader loaderType={LoaderType.Bar} color={Indigo500} size={160} />
            <p className="text-balance text-sm font-medium leading-6 text-gray-900">
              {translator.translateText(EXTERNAL_MCP_SERVER_TEST_COPY.testing)}
            </p>
          </div>
        ) : check.isConnected ? (
          <div className="flex flex-col gap-4">
            <Alert
              type={AlertType.SUCCESS}
              strongTitle={EXTERNAL_MCP_SERVER_TEST_COPY.connected}
              title={
                check.serverName
                  ? translator.translateTemplate(
                      EXTERNAL_MCP_SERVER_TEST_COPY.connectedTo,
                      {
                        server: check.serverName,
                        transport: transportTitle,
                      },
                    )
                  : translator.translateTemplate(
                      EXTERNAL_MCP_SERVER_TEST_COPY.connectedOver,
                      { transport: transportTitle },
                    )
              }
              dataTestId="external-mcp-server-test-result"
            />
            {check.tools.length === 0 ? (
              <p className="text-sm text-gray-500">
                {translator.translateText(
                  EXTERNAL_MCP_SERVER_TOOLS_COPY.noTools,
                )}
              </p>
            ) : (
              <div>
                <p className="text-sm text-gray-600">
                  {translator.translateText(
                    EXTERNAL_MCP_SERVER_TOOLS_COPY.description,
                  )}
                </p>
                <div className="mt-2 max-h-80 overflow-y-auto">
                  <ExternalMcpServerToolList tools={check.tools} />
                </div>
                {check.toolsLeftOut > 0 ? (
                  <p className="mt-2 text-xs text-gray-500">
                    {translator.translateText(
                      EXTERNAL_MCP_SERVER_TOOLS_COPY.leftOut,
                    )}
                  </p>
                ) : (
                  <></>
                )}
              </div>
            )}
          </div>
        ) : (
          <Alert
            type={AlertType.DANGER}
            strongTitle={EXTERNAL_MCP_SERVER_TEST_COPY.failed}
            title={`${check.message}\n${
              translator.translateText(
                getExternalMcpServerFailureHint(check.failureKind),
              ) || ""
            }`}
            dataTestId="external-mcp-server-test-result"
            textClassName="whitespace-pre-wrap"
          />
        )}
      </div>
    </Modal>
  );
};

export default TestExternalMcpServerModal;
