import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
import Exception from "Common/Types/Exception/Exception";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

export interface ComponentProps {
  // API route under APP_API_URL, e.g. "/slack/channels/test".
  route: string;
  // Identifies the destination, e.g. { channelId } or { teamId, channelId }.
  requestBody: JSONObject;
  // Shown in labels and messages, e.g. "#alerts" or "Alice, Bob".
  destinationName: string;
  // "Slack" or "Microsoft Teams".
  workspaceName: string;
  /*
   * Called with true when a send starts and with false when it settles,
   * exactly once each per send. The false call still arrives if this row has
   * been unmounted in the meantime, so a parent can count sends in flight and
   * hold back anything that would reload its list (and with it this row, and
   * the result it is waiting for).
   */
  onSendingChange?: ((isSending: boolean) => void) | undefined;
}

type SendTestStatus = "idle" | "sending" | "sent" | "failed";

const SendTestNotificationButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [status, setStatus] = useState<SendTestStatus>("idle");
  const [error, setError] = useState<string>("");
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);

  /*
   * The button is disabled while a send is in flight, but `disabled` only
   * lands on the next render. Two clicks inside the same frame would both see
   * status "idle" and post the test twice, so the in-flight flag lives in a
   * ref that is updated synchronously.
   */
  const isSendingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  const sendTestNotification: PromiseVoidFunction = async (): Promise<void> => {
    if (isSendingRef.current) {
      return;
    }

    isSendingRef.current = true;
    setStatus("sending");
    setError("");
    setShowErrorModal(false);

    try {
      /*
       * Inside the try so that the finally below reports the matching
       * "false" whatever happens from here on - the parent's count of sends
       * in flight must always come back down.
       */
      if (props.onSendingChange) {
        props.onSendingChange(true);
      }

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute(props.route),
          data: props.requestBody,
          /*
           * This is a custom route, so only getCommonHeaders() adds the
           * `tenantid` header the server needs to know which project the
           * test is being sent from.
           */
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setStatus("sent");
    } catch (err) {
      setError(
        API.getFriendlyErrorMessage(err as Exception) ||
          "Could not send the test notification. Please try again.",
      );
      setStatus("failed");
      setShowErrorModal(true);
    } finally {
      isSendingRef.current = false;

      if (props.onSendingChange) {
        props.onSendingChange(false);
      }
    }
  };

  type CloseErrorModalFunction = () => void;

  /*
   * Closing the dialog only dismisses it. The row keeps its "Failed" badge
   * (with the error as its tooltip) so the outcome is still visible once the
   * dialog is gone.
   */
  const closeErrorModal: CloseErrorModalFunction = (): void => {
    setShowErrorModal(false);
  };

  return (
    /*
     * ml-auto keeps the control against the right edge both beside the name
     * and when a narrow row wraps it onto a line of its own.
     */
    <div className="ml-auto flex flex-none items-center gap-2">
      {/*
       * Screen readers often ignore a live region that appears already
       * filled, so this one is always rendered - empty while idle or
       * sending - and only its content changes when a result arrives.
       */}
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center"
      >
        {status === "sent" && (
          <span
            title={`Test notification sent to ${props.destinationName}. Check ${props.workspaceName} to confirm it arrived.`}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"
            data-testid="send-test-notification-sent"
          >
            <Icon
              icon={IconProp.CheckCircle}
              size={SizeProp.Regular}
              className="h-4 w-4"
            />
            {/*
             * On a phone the control shares its line with the avatar and
             * the name, or sits on a line of its own under them. The icon
             * alone carries the result there so the control stays narrow;
             * the word stays available to screen readers.
             */}
            <span className="sr-only sm:not-sr-only">Sent</span>
          </span>
        )}

        {status === "failed" && (
          <span
            title={error}
            className="inline-flex items-center gap-1 text-xs font-medium text-red-700"
            data-testid="send-test-notification-failed"
          >
            <Icon
              icon={IconProp.Error}
              size={SizeProp.Regular}
              className="h-4 w-4"
            />
            <span className="sr-only sm:not-sr-only">Failed</span>
          </span>
        )}
      </span>

      {/*
       * Button is full width and text-base below md, and carries a left
       * margin above it, all meant for form footers. In a list row it has to
       * size to its label at the row's text size, and the container's gap
       * already spaces it.
       */}
      <Button
        title="Send Test"
        icon={IconProp.SendMessage}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        isLoading={status === "sending"}
        disabled={status === "sending"}
        ariaLabel={`Send test notification to ${props.destinationName}`}
        dataTestId="send-test-notification-button"
        className="!w-auto whitespace-nowrap !text-sm md:!ml-0"
        onClick={() => {
          sendTestNotification().catch((err: Exception) => {
            setError(API.getFriendlyErrorMessage(err));
            setStatus("failed");
            setShowErrorModal(true);
          });
        }}
      />

      {/*
       * No onClose: ConfirmModal renders a "Cancel" button whenever onClose
       * is set, and a dialog that only reports an outcome needs one way out,
       * not two. "Close" is it.
       */}
      {showErrorModal && (
        <ConfirmModal
          title="Test Notification Failed"
          description={`OneUptime could not send a test notification to ${props.destinationName} in ${props.workspaceName}.`}
          error={error}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={closeErrorModal}
        />
      )}
    </div>
  );
};

export default SendTestNotificationButton;
