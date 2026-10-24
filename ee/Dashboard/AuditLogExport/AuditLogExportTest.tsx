import { AuditLogExportCopy } from "./AuditLogExportCopy";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * "Send a test": one entry whose action is Test, delivered to the
 * destination with the settings as they are - a file written to a fixed
 * name in the bucket's folder, a request to the webhook, a syslog message -
 * so whoever sets an export up sees it arrive before anything real is sent
 * (POST /audit-log-export/test, or /audit-log-export/instance/test for the
 * instance's). The destination's refusal comes back as an answer with what
 * to fix, not as an error.
 */

export interface AuditLogExportTestResult {
  isSuccessful: boolean;
  message: string;
}

export interface AuditLogExportTestRequest {
  route: string;
  // The page's model API: its headers say whose export it is (a project's, or none).
  modelAPI: typeof ModelAPI;
  body: JSONObject;
}

export async function runAuditLogExportTest(
  request: AuditLogExportTestRequest,
): Promise<AuditLogExportTestResult> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(request.route),
      headers: request.modelAPI.getCommonHeaders(),
      data: request.body,
    });

  if (response instanceof HTTPErrorResponse) {
    return { isSuccessful: false, message: API.getFriendlyMessage(response) };
  }

  const data: JSONObject = response.data || {};

  return {
    isSuccessful: data["isSuccessful"] === true,
    message: typeof data["message"] === "string" ? data["message"] : "",
  };
}

/*
 * A key for the settings a result belongs to, without holding them: a hash
 * of the request body, so a credential never sits in component state.
 */
export function auditLogExportTestSettingsKey(build: () => JSONObject): string {
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

export const AuditLogExportTestResultBox: FunctionComponent<{
  result: AuditLogExportTestResult;
}> = (props: { result: AuditLogExportTestResult }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      role="status"
      data-testid="audit-log-export-test-result"
      data-successful={props.result.isSuccessful ? "true" : "false"}
      className={
        props.result.isSuccessful
          ? "flex items-start gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          : "flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
      }
    >
      <div className="mt-0.5 flex-shrink-0">
        <Icon
          icon={
            props.result.isSuccessful ? IconProp.CheckCircle : IconProp.Error
          }
          className="h-4 w-4"
        />
      </div>
      <div className="min-w-0 break-words">
        {props.result.message ||
          translator.translateText(
            props.result.isSuccessful
              ? AuditLogExportCopy.testSucceeded
              : AuditLogExportCopy.testFailed,
          )}
      </div>
    </div>
  );
};

/*
 * Inside the form: a button that sends a test with what the form holds the
 * moment it is pressed. A result is shown only while the form still holds
 * the values it was sent with - a green result next to a credential pasted
 * since would say something it never checked.
 */
export const AuditLogExportInlineTest: FunctionComponent<{
  route: string;
  modelAPI: typeof ModelAPI;
  buildBody: () => JSONObject;
  // A file destination writes a test file; a stream sends a test entry.
  writesFiles: boolean;
  disabledReason?: string | undefined;
}> = (props: {
  route: string;
  modelAPI: typeof ModelAPI;
  buildBody: () => JSONObject;
  writesFiles: boolean;
  disabledReason?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isSending, setIsSending] = useState<boolean>(false);
  const [result, setResult] = useState<{
    key: string;
    value: AuditLogExportTestResult;
  } | null>(null);
  const settingsKey: string = auditLogExportTestSettingsKey(props.buildBody);

  const send: () => Promise<void> = async (): Promise<void> => {
    setIsSending(true);
    const key: string = settingsKey;

    try {
      setResult({
        key,
        value: await runAuditLogExportTest({
          route: props.route,
          modelAPI: props.modelAPI,
          body: props.buildBody(),
        }),
      });
    } catch (err) {
      setResult({
        key,
        value: { isSuccessful: false, message: API.getFriendlyMessage(err) },
      });
    }

    setIsSending(false);
  };

  return (
    <div className="space-y-3" data-testid="audit-log-export-inline-test">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
        <Button
          title={
            props.writesFiles
              ? AuditLogExportCopy.testFilesButton
              : AuditLogExportCopy.testStreamButton
          }
          icon={IconProp.PaperAirplane}
          buttonStyle={ButtonStyleType.NORMAL}
          isLoading={isSending}
          disabled={Boolean(props.disabledReason) || isSending}
          dataTestId="audit-log-export-send-test"
          onClick={() => {
            void send();
          }}
        />
        <p className="text-xs text-gray-500">
          {translator.translateText(
            props.disabledReason ||
              (props.writesFiles
                ? AuditLogExportCopy.testFilesHint
                : AuditLogExportCopy.testStreamHint),
          )}
        </p>
      </div>
      {result && result.key === settingsKey ? (
        <AuditLogExportTestResultBox result={result.value} />
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * The row action: sends a test with the saved settings as soon as it opens,
 * and again on demand.
 */
export const AuditLogExportTestModal: FunctionComponent<{
  route: string;
  modelAPI: typeof ModelAPI;
  exportId: string;
  exportName: string;
  onClose: () => void;
}> = (props: {
  route: string;
  modelAPI: typeof ModelAPI;
  exportId: string;
  exportName: string;
  onClose: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isSending, setIsSending] = useState<boolean>(true);
  const [result, setResult] = useState<AuditLogExportTestResult | null>(null);
  const runCount: React.MutableRefObject<number> = useRef<number>(0);

  const send: () => Promise<void> = async (): Promise<void> => {
    const run: number = ++runCount.current;
    setIsSending(true);

    let value: AuditLogExportTestResult;

    try {
      value = await runAuditLogExportTest({
        route: props.route,
        modelAPI: props.modelAPI,
        body: { exportId: props.exportId },
      });
    } catch (err) {
      value = { isSuccessful: false, message: API.getFriendlyMessage(err) };
    }

    // A later run wins; a closed modal ignores its answer.
    if (run === runCount.current) {
      setResult(value);
      setIsSending(false);
    }
  };

  useEffect(() => {
    void send();

    return () => {
      runCount.current++;
    };
  }, []);

  return (
    <Modal
      title={translator.translateTemplate(AuditLogExportCopy.testModalTitle, {
        name: props.exportName,
      })}
      description={AuditLogExportCopy.testModalDescription}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      closeButtonText="Close"
      submitButtonText={AuditLogExportCopy.testAgainButton}
      isLoading={isSending}
      onSubmit={() => {
        void send();
      }}
    >
      <div className="py-2" data-testid="audit-log-export-test-modal">
        {isSending || !result ? (
          <p className="text-sm text-gray-500" role="status">
            {translator.translateText(AuditLogExportCopy.testSending)}
          </p>
        ) : (
          <AuditLogExportTestResultBox result={result} />
        )}
      </div>
    </Modal>
  );
};
