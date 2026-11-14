import EventName from "../../Utils/EventName";
import FeedbackWhereItGoes from "./FeedbackWhereItGoes";
import { getFeedbackGitHubIssueUrl } from "./FeedbackPage";
import IconProp from "Common/Types/Icon/IconProp";
import {
  GENERAL_FEEDBACK_TOPIC,
  PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH,
  ProductFeedbackKind,
  toFeedbackTopic,
} from "Common/Types/ProductFeedback/ProductFeedback";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import { BILLING_ENABLED } from "Common/UI/Config";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ProductFeedback from "Common/UI/Utils/ProductFeedback";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * "GIVE FEEDBACK", FROM ANY PAGE (issue #6832).
 *
 * Help's Give feedback (the header's menu and the phone's), Search
 * (Cmd/Ctrl+K) and the first-week check-in open this: one box, "What were
 * you trying to do, and what happened?". It is sent with the page the
 * person is on - as a route with no ids - and the product version, and the
 * dialog says so before anything is sent. Nothing else goes with it.
 *
 * It goes to this server's admins (Admin Dashboard > Feedback); on
 * OneUptime Cloud they are the OneUptime team. On a self-hosted server,
 * once it is sent, the person may also tell OneUptime on GitHub: a
 * pre-filled issue they read there before sending it, or not.
 *
 * Mounted once in App.tsx, beside How OneUptime works, and opened with a
 * window event (openGiveFeedback), so an opener needs nothing but its name.
 */

export enum GiveFeedbackOpenedFrom {
  Help = "help",
  PhoneMenu = "phone_menu",
  CommandPalette = "command_palette",
  CheckIn = "check_in",
}

export const GIVE_FEEDBACK_DIALOG_TEST_ID: string = "give-feedback-dialog";
export const GIVE_FEEDBACK_DETAILS_TEST_ID: string = "give-feedback-details";
export const GIVE_FEEDBACK_ATTACHED_TEST_ID: string = "give-feedback-attached";
export const GIVE_FEEDBACK_SENT_TEST_ID: string = "give-feedback-sent";
export const GIVE_FEEDBACK_GITHUB_TEST_ID: string = "give-feedback-github";

// Opens the dialog, from anywhere in the dashboard.
export const openGiveFeedback: (from: GiveFeedbackOpenedFrom) => void = (
  from: GiveFeedbackOpenedFrom,
): void => {
  GlobalEvents.dispatchEvent(EventName.GIVE_FEEDBACK_OPEN, { from: from });
};

const GiveFeedbackDialog: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = useId();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [from, setFrom] = useState<string>(GENERAL_FEEDBACK_TOPIC);
  const [details, setDetails] = useState<string>("");
  const [sentDetails, setSentDetails] = useState<string | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // The page and version, read when the dialog opens: what is sent with it.
  const [page, setPage] = useState<string>("/");

  useEffect(() => {
    const open: (event: CustomEvent) => void = (event: CustomEvent): void => {
      const openedFrom: unknown = (event.detail as { from?: unknown } | null)
        ?.from;

      setFrom(
        typeof openedFrom === "string"
          ? toFeedbackTopic(openedFrom)
          : GENERAL_FEEDBACK_TOPIC,
      );
      setPage(ProductFeedback.getPage());
      setDetails("");
      setSentDetails(null);
      setError("");
      setIsOpen(true);
    };

    GlobalEvents.addEventListener(EventName.GIVE_FEEDBACK_OPEN, open);

    return () => {
      GlobalEvents.removeEventListener(EventName.GIVE_FEEDBACK_OPEN, open);
    };
  }, []);

  if (!isOpen) {
    return <></>;
  }

  const close: () => void = (): void => {
    setIsOpen(false);
  };

  const version: string = ProductFeedback.getVersion();

  if (sentDetails !== null) {
    return (
      <Modal
        title="Thanks for Your Feedback"
        modalWidth={ModalWidth.Medium}
        onClose={close}
        closeButtonText="Close"
      >
        <div className="space-y-3" data-testid={GIVE_FEEDBACK_SENT_TEST_ID}>
          <p className="text-sm text-gray-700">
            {BILLING_ENABLED
              ? translator.translateText(
                  "The OneUptime team reads every answer. It helps decide what to make simpler next.",
                )
              : translator.translateText(
                  "This server's admins can read it in the Admin Dashboard, under Feedback.",
                )}
          </p>
          {!BILLING_ENABLED ? (
            <a
              href={getFeedbackGitHubIssueUrl({
                details: sentDetails,
                page: page,
                version: version,
              })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
              data-testid={GIVE_FEEDBACK_GITHUB_TEST_ID}
            >
              {translator.translateText("Also tell OneUptime on GitHub")}
              <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
            </a>
          ) : (
            <></>
          )}
        </div>
      </Modal>
    );
  }

  const send: () => Promise<void> = async (): Promise<void> => {
    if (!details.trim()) {
      setError(
        translator.translateText(
          "Write what you were trying to do and what happened, then send it.",
        ) || "",
      );
      return;
    }

    setIsSending(true);
    setError("");

    const answerId: string | null = await ProductFeedback.submit({
      kind: ProductFeedbackKind.General,
      topic: from,
      details: details,
    });

    setIsSending(false);

    if (answerId === null) {
      setError(
        translator.translateText(
          "Your feedback could not be sent. Check your connection, then try again.",
        ) || "",
      );
      return;
    }

    setSentDetails(details.trim());
  };

  return (
    <Modal
      title="Give Feedback"
      description="Tell us where OneUptime was hard to use or understand."
      modalWidth={ModalWidth.Medium}
      onClose={close}
      onSubmit={() => {
        void send();
      }}
      submitButtonText="Send Feedback"
      isLoading={isSending}
      error={error || undefined}
    >
      <div className="space-y-3" data-testid={GIVE_FEEDBACK_DIALOG_TEST_ID}>
        <label id={labelId} className="block text-sm font-medium text-gray-700">
          {translator.translateText(
            "What were you trying to do, and what happened?",
          )}
        </label>
        <TextArea
          value={details}
          onChange={(value: string) => {
            setDetails(value.slice(0, PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH));
          }}
          ariaLabelledby={labelId}
          autoFocus={true}
          rows={5}
          dataTestId={GIVE_FEEDBACK_DETAILS_TEST_ID}
        />
        <p
          className="text-xs text-gray-500"
          data-testid={GIVE_FEEDBACK_ATTACHED_TEST_ID}
        >
          {translator.translateTemplate(
            "Sent with it: the page you are on ({{page}}) and the OneUptime version ({{version}}).",
            {
              page: page,
              version: version || "-",
            },
          )}
        </p>
        <FeedbackWhereItGoes />
      </div>
    </Modal>
  );
};

export default GiveFeedbackDialog;
