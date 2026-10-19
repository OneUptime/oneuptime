import { connectionTestSettingsKey } from "./ConnectionTestModal";
import { SECURITY_EVENT_DESTINATION_TEST_ROUTE } from "./SecurityEventDestinationUtil";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
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
 * "Send a test event": one event, marked as a test, sent to the SIEM with
 * the settings as they are, so whoever sets a destination up sees it arrive
 * before anything real is sent (POST /security-event-destination/test). The
 * SIEM's refusal comes back as an answer, with what to fix, not as an error.
 */

export interface SecurityEventDestinationTestResult {
  isSuccessful: boolean;
  message: string;
}

export async function runSecurityEventDestinationTest(
  body: JSONObject,
): Promise<SecurityEventDestinationTestResult> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        SECURITY_EVENT_DESTINATION_TEST_ROUTE,
      ),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
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

export const SecurityEventDestinationTestResultBox: FunctionComponent<{
  result: SecurityEventDestinationTestResult;
}> = (props: { result: SecurityEventDestinationTestResult }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      role="status"
      data-testid="security-event-destination-test-result"
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
          (props.result.isSuccessful
            ? translator.translateText("The test event was sent.")
            : translator.translateText("The test event was not sent."))}
      </div>
    </div>
  );
};

/*
 * Inside the form: a button that sends a test with what the form holds the
 * moment it is pressed. A result is shown only while the form still holds
 * the values it was sent with - a green result next to a key pasted since
 * would say something it never checked.
 */
export const SecurityEventDestinationInlineTest: FunctionComponent<{
  buildBody: () => JSONObject;
  disabledReason?: string | undefined;
}> = (props: {
  buildBody: () => JSONObject;
  disabledReason?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isSending, setIsSending] = useState<boolean>(false);
  const [result, setResult] = useState<{
    key: string;
    value: SecurityEventDestinationTestResult;
  } | null>(null);
  const settingsKey: string = connectionTestSettingsKey(props.buildBody);

  const send: () => Promise<void> = async (): Promise<void> => {
    setIsSending(true);
    const key: string = settingsKey;

    try {
      setResult({
        key,
        value: await runSecurityEventDestinationTest(props.buildBody()),
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
    <div
      className="space-y-3"
      data-testid="security-event-destination-inline-test"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
        <Button
          title="Send a test event"
          icon={IconProp.PaperAirplane}
          buttonStyle={ButtonStyleType.NORMAL}
          isLoading={isSending}
          disabled={Boolean(props.disabledReason) || isSending}
          dataTestId="security-event-destination-send-test"
          onClick={() => {
            void send();
          }}
        />
        <p className="text-xs text-gray-500">
          {props.disabledReason
            ? translator.translateText(props.disabledReason)
            : translator.translateText(
                "Sends one event marked as a test. Nothing is saved.",
              )}
        </p>
      </div>
      {result && result.key === settingsKey ? (
        <SecurityEventDestinationTestResultBox result={result.value} />
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
export const SecurityEventDestinationTestModal: FunctionComponent<{
  destinationId: string;
  destinationName: string;
  onClose: () => void;
}> = (props: {
  destinationId: string;
  destinationName: string;
  onClose: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isSending, setIsSending] = useState<boolean>(true);
  const [result, setResult] =
    useState<SecurityEventDestinationTestResult | null>(null);
  const runCount: React.MutableRefObject<number> = useRef<number>(0);

  const send: () => Promise<void> = async (): Promise<void> => {
    const run: number = ++runCount.current;
    setIsSending(true);

    let value: SecurityEventDestinationTestResult;

    try {
      value = await runSecurityEventDestinationTest({
        destinationId: props.destinationId,
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
      title={translator.translateTemplate("Send a test event: {{name}}", {
        name: props.destinationName,
      })}
      description="One event marked as a test, sent with the saved settings. It shows in your SIEM within a few minutes."
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      closeButtonText="Close"
      submitButtonText="Send again"
      isLoading={isSending}
      onSubmit={() => {
        void send();
      }}
    >
      <div className="py-2" data-testid="security-event-destination-test-modal">
        {isSending || !result ? (
          <p className="text-sm text-gray-500" role="status">
            {translator.translateText("Sending a test event…")}
          </p>
        ) : (
          <SecurityEventDestinationTestResultBox result={result} />
        )}
      </div>
    </Modal>
  );
};
