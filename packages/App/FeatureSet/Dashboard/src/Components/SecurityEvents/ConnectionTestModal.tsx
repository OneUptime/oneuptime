import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { SecurityConnectorTestReport } from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { APP_API_URL } from "Common/UI/Config";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ConnectorTestReportView from "./ConnectorTestReportView";

export const CONNECTION_TEST_PROGRESS_MESSAGE: string =
  "Checking access, availability and OneUptime workers…";

/*
 * Posts a synchronous connection test and returns the report. Shared by the
 * connections table's row action, the diagnostics modal and the create/edit
 * form so every caller sends the same headers and handles a non-2xx answer
 * the same way (thrown, so the modal can show it as a friendly message).
 *
 * `route` is the API path under APP_API_URL, e.g.
 * "/security-event-connection/test"; `body` is either { connectionId } or
 * the unsaved settings the endpoint documents. Secrets travel in the body
 * over the API's TLS channel and are never placed in the URL.
 */
export async function runConnectionTestRequest(data: {
  route: string;
  body: JSONObject;
}): Promise<SecurityConnectorTestReport> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(data.route),
      headers: ModelAPI.getCommonHeaders(),
      data: data.body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const report: JSONObject = response.data;

  if (!report || !Array.isArray(report["checks"]) || !report["status"]) {
    throw new Error(
      "The server did not return a test report. Check the API logs and try again.",
    );
  }

  return report as unknown as SecurityConnectorTestReport;
}

/*
 * A short fingerprint of the settings a test is built from, for
 * InlineConnectionTest's settingsKey. Hashed rather than kept verbatim so
 * the pasted credentials in the body are not copied into component state;
 * two FNV-1a passes with different seeds keep accidental collisions out of
 * reach for form-sized input. A builder that throws (no provider chosen, no
 * key pasted) gets a key from its message, so fixing that input also
 * changes the key.
 */
export function connectionTestSettingsKey(build: () => JSONObject): string {
  let text: string;

  try {
    text = `body:${JSON.stringify(build())}`;
  } catch (err) {
    text = `error:${err instanceof Error ? err.message : String(err)}`;
  }

  const hash: (seed: number) => string = (seed: number): string => {
    let value: number = seed >>> 0;

    for (let index: number = 0; index < text.length; index++) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 0x01000193) >>> 0;
    }

    return value.toString(16).padStart(8, "0");
  };

  return `${hash(0x811c9dc5)}${hash(0x9747b28c)}`;
}

export const INLINE_TEST_SETTINGS_CHANGED_MESSAGE: string =
  "The settings changed after the last test. Test again to check the values the form holds now.";

export interface InlineConnectionTestProps {
  providerTitle: string;
  // Runs the test with whatever the form currently holds.
  runTest: () => Promise<SecurityConnectorTestReport>;
  /*
   * Fingerprint of the values runTest would send now (see
   * connectionTestSettingsKey). The last report or error is shown only
   * while the form still holds the values it was built from, so a green
   * report for a key the user has since replaced is never left on screen
   * next to the new value. Omit it to keep the report until the next run.
   */
  settingsKey?: string | undefined;
  buttonTitle?: string | undefined;
  description?: string | undefined;
  /*
   * Why the button cannot run yet (a missing credential, no provider
   * chosen). Shown instead of the button being silently inert.
   */
  disabledReason?: string | undefined;
}

/*
 * "Test these settings" inside a create/edit form: runs on demand rather
 * than on mount, and renders the same checklist inline so a wrong secret
 * or a missing role is found before anything is stored.
 */
export const InlineConnectionTest: FunctionComponent<
  InlineConnectionTestProps
> = (props: InlineConnectionTestProps): ReactElement => {
  const [report, setReport] = useState<SecurityConnectorTestReport | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  // settingsKey captured when the shown report or error was requested.
  const [testedSettingsKey, setTestedSettingsKey] = useState<
    string | undefined
  >(undefined);
  const mounted: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const runTestRef: React.MutableRefObject<
    () => Promise<SecurityConnectorTestReport>
  > = useRef(props.runTest);
  runTestRef.current = props.runTest;
  const settingsKeyRef: React.MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(props.settingsKey);
  settingsKeyRef.current = props.settingsKey;

  useEffect(() => {
    mounted.current = true;
    return (): void => {
      mounted.current = false;
    };
  }, []);

  const run: () => Promise<void> = async (): Promise<void> => {
    setIsRunning(true);
    /*
     * A new run replaces the last outcome outright: a failed re-run must
     * not leave the previous green checklist next to its error.
     */
    setReport(null);
    setError(null);
    setTestedSettingsKey(settingsKeyRef.current);

    try {
      const result: SecurityConnectorTestReport = await runTestRef.current();

      if (mounted.current) {
        setReport(result);
      }
    } catch (err) {
      if (mounted.current) {
        setError(API.getFriendlyErrorMessage(err as Error));
      }
    } finally {
      if (mounted.current) {
        setIsRunning(false);
      }
    }
  };

  const settingsChanged: boolean =
    props.settingsKey !== undefined &&
    (report !== null || error !== null) &&
    testedSettingsKey !== props.settingsKey;

  return (
    <div
      className="space-y-3 rounded-md border border-dashed border-gray-300 p-3"
      data-testid="test-these-settings"
    >
      <p className="text-sm text-gray-600">
        {props.description ||
          `Check access to ${props.providerTitle}, what it has available to import, and whether OneUptime's workers are running — before saving. Nothing is stored or imported.`}
      </p>
      <Button
        title={props.buttonTitle || "Test these settings"}
        buttonStyle={ButtonStyleType.OUTLINE}
        disabled={Boolean(props.disabledReason) || isRunning}
        isLoading={isRunning}
        tooltip={props.disabledReason}
        onClick={(): void => {
          void run();
        }}
      />
      {props.disabledReason && (
        <p className="text-sm text-gray-500">{props.disabledReason}</p>
      )}
      {isRunning && (
        <p role="status" aria-live="polite" className="text-sm text-gray-600">
          {CONNECTION_TEST_PROGRESS_MESSAGE}
        </p>
      )}
      {settingsChanged && !isRunning && (
        <p role="status" className="text-sm text-gray-600">
          {INLINE_TEST_SETTINGS_CHANGED_MESSAGE}
        </p>
      )}
      {error && !isRunning && !settingsChanged && (
        <ErrorMessage message={error} />
      )}
      {report && !isRunning && !settingsChanged && (
        <ConnectorTestReportView
          report={report}
          providerTitle={props.providerTitle}
          onRunAgain={(): void => {
            void run();
          }}
          isRunningAgain={isRunning}
        />
      )}
    </div>
  );
};

export interface ComponentProps {
  title: string;
  description?: string | undefined;
  providerTitle?: string | undefined;
  runTest: () => Promise<SecurityConnectorTestReport>;
  onClose: () => void;
}

/*
 * Runs the supplied test as soon as it opens and renders the checklist.
 * The test is synchronous on the server (no worker involved), so the
 * progress state is a real wait on the source rather than a queue.
 */
const ConnectionTestModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [report, setReport] = useState<SecurityConnectorTestReport | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const mounted: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const requestSequence: React.MutableRefObject<number> = useRef<number>(0);
  const runTestRef: React.MutableRefObject<
    () => Promise<SecurityConnectorTestReport>
  > = useRef(props.runTest);
  runTestRef.current = props.runTest;

  const run: () => Promise<void> = async (): Promise<void> => {
    const sequence: number = ++requestSequence.current;
    setIsRunning(true);
    /*
     * Clear the previous outcome when a run starts, so a failed "Run again"
     * shows only its error and never the earlier checklist beside it.
     */
    setReport(null);
    setError(null);

    try {
      const result: SecurityConnectorTestReport = await runTestRef.current();

      if (!mounted.current || sequence !== requestSequence.current) {
        return;
      }

      setReport(result);
    } catch (err) {
      if (!mounted.current || sequence !== requestSequence.current) {
        return;
      }

      setError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      if (mounted.current && sequence === requestSequence.current) {
        setIsRunning(false);
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    void run();

    return (): void => {
      mounted.current = false;
      requestSequence.current++;
    };
  }, []);

  return (
    <Modal
      title={props.title}
      description={
        props.description ||
        "Checks the source, what it has to import, and whether OneUptime's workers and scheduler are running. Nothing is imported."
      }
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Close"
      leftFooterElement={
        <Button
          title="Run again"
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.Refresh}
          disabled={isRunning}
          isLoading={isRunning}
          onClick={(): void => {
            void run();
          }}
        />
      }
    >
      <div className="space-y-4">
        {isRunning && (
          <p role="status" aria-live="polite" className="text-sm text-gray-600">
            {CONNECTION_TEST_PROGRESS_MESSAGE}
          </p>
        )}
        {error && !isRunning && <ErrorMessage message={error} />}
        {report && !isRunning && (
          <ConnectorTestReportView
            report={report}
            providerTitle={props.providerTitle}
          />
        )}
      </div>
    </Modal>
  );
};

export default ConnectionTestModal;
