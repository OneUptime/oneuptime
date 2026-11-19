import IconProp from "Common/Types/Icon/IconProp";
import {
  SubscriberNotificationPreviewRequest,
  SubscriberNotificationPreviewResult,
  SubscriberNotificationPreviewStatusPage,
  SubscriberNotificationSendTestResult,
} from "Common/Types/StatusPage/SubscriberNotificationPreview";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getTranslatedDropdownOption,
  readPickedDropdownValue,
} from "Common/UI/Components/Dropdown/DropdownChoices";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import EmailPreviewFrame from "../StatusPage/EmailPreviewFrame";
import SubscriberNotificationPreviewCopy, {
  formatPreviewText,
} from "../StatusPage/SubscriberNotificationPreviewCopy";
import { TranslateFunction } from "./SubscriberAudienceText";
import {
  fetchSubscriberNotificationPreview,
  sendSubscriberNotificationTest,
} from "./SubscriberNotificationPreviewApi";
import {
  describeHiddenPages,
  describeNoteShownLater,
  describeNothingSent,
  describePreviewStatusPage,
  describeTemplateChoice,
} from "./SubscriberNotificationPreviewText";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

/*
 * 'Preview notification': the email each status page's subscribers would get,
 * before anything is sent - rendered by the server from the same template,
 * settings and code path the notification is sent with (see
 * Common/Types/StatusPage/SubscriberNotificationPreview).
 *
 * The request is taken as the dialog opens: what is previewed is the draft
 * at that moment. The email is shown in a sandboxed frame (EmailPreviewFrame)
 * with, per page, which template is used and why, and the "up to" counts;
 * 'Send test to me' mails the shown page's email to the signed-in user's own
 * address. Only counts and the caller's own address are ever shown.
 *
 * The dialog is portalled to the body: it opens from inside forms (Declare
 * Incident, the note composer), and nothing in it may submit them. React
 * still bubbles its events to those forms' handlers, which ignore the ones
 * from outside their own element.
 */

export interface ComponentProps {
  request: SubscriberNotificationPreviewRequest;
  onClose: () => void;
  dataTestId?: string | undefined;
}

interface PreviewState {
  isLoading: boolean;
  error: string;
  result: SubscriberNotificationPreviewResult | null;
}

interface SendTestState {
  isSending: boolean;
  sentTo: string;
  error: string;
}

const EMPTY_SEND_TEST_STATE: SendTestState = {
  isSending: false,
  sentTo: "",
  error: "",
};

const SubscriberNotificationPreviewModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translate: TranslateFunction = (text: string): string => {
    return translateString(text) || text;
  };

  const dataTestId: string =
    props.dataTestId || "subscriber-notification-preview";
  const pageSelectId: string = useId();

  // The draft as it was when the dialog opened.
  const [request] = useState<SubscriberNotificationPreviewRequest>(
    props.request,
  );
  const [preview, setPreview] = useState<PreviewState>({
    isLoading: true,
    error: "",
    result: null,
  });
  const [selectedStatusPageId, setSelectedStatusPageId] = useState<string>("");
  const [sendTest, setSendTest] = useState<SendTestState>(
    EMPTY_SEND_TEST_STATE,
  );
  /*
   * Which test send the answer shown is for. Picking another page starts
   * over, and an answer for a test sent before that is dropped: it would
   * say "sent" (or why not) under a page that was never sent.
   */
  const sendTestGeneration: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    let isCancelled: boolean = false;

    fetchSubscriberNotificationPreview(request)
      .then((result: SubscriberNotificationPreviewResult) => {
        if (isCancelled) {
          return;
        }

        setPreview({ isLoading: false, error: "", result: result });
        setSelectedStatusPageId(result.statusPages[0]?.statusPageId || "");
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          setPreview({
            isLoading: false,
            error: API.getFriendlyMessage(err),
            result: null,
          });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const result: SubscriberNotificationPreviewResult | null = preview.result;

  const selectedStatusPage: SubscriberNotificationPreviewStatusPage | null =
    result?.statusPages.find(
      (statusPage: SubscriberNotificationPreviewStatusPage): boolean => {
        return statusPage.statusPageId === selectedStatusPageId;
      },
    ) ||
    result?.statusPages[0] ||
    null;

  const onSendTest: () => void = (): void => {
    if (!selectedStatusPage || sendTest.isSending) {
      return;
    }

    setSendTest({ isSending: true, sentTo: "", error: "" });

    const generation: number = sendTestGeneration.current;

    sendSubscriberNotificationTest(request, selectedStatusPage.statusPageId)
      .then((sent: SubscriberNotificationSendTestResult) => {
        if (generation !== sendTestGeneration.current) {
          return;
        }

        setSendTest({ isSending: false, sentTo: sent.sentTo, error: "" });
      })
      .catch((err: unknown) => {
        if (generation !== sendTestGeneration.current) {
          return;
        }

        setSendTest({
          isSending: false,
          sentTo: "",
          error: API.getFriendlyMessage(err),
        });
      });
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (preview.isLoading) {
      return (
        <div
          role="status"
          aria-busy="true"
          data-testid={`${dataTestId}-loading`}
          className="flex items-center gap-2 py-10 text-sm text-gray-600"
        >
          <Icon icon={IconProp.Spinner} className="h-4 w-4 animate-spin" />
          <span>{translate(SubscriberNotificationPreviewCopy.loading)}</span>
        </div>
      );
    }

    if (preview.error || !result) {
      return (
        <div
          role="alert"
          data-testid={`${dataTestId}-error`}
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
        >
          <p className="font-medium">
            {translate(SubscriberNotificationPreviewCopy.loadError)}
          </p>
          {preview.error ? (
            <p className="mt-0.5">
              <ErrorInSentence message={preview.error} showWhereToLook={true} />
            </p>
          ) : null}
        </div>
      );
    }

    if (result.nothingSentReason) {
      /*
       * Why, and - for a public note on an incident no status page shows -
       * that the note is still posted, and shows on a page that starts
       * showing the incident (#9684). The event is the one asked about.
       */
      const noteShownLater: string | null = describeNoteShownLater(
        result.nothingSentReason,
        request.event,
        translate,
      );

      return (
        <div
          role="status"
          data-testid={`${dataTestId}-nothing-sent`}
          data-reason={result.nothingSentReason}
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
        >
          <div className="flex items-start gap-2 font-medium">
            <Icon icon={IconProp.Info} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {translate(SubscriberNotificationPreviewCopy.nothingWillBeSent)}
            </span>
          </div>
          <p
            className="mt-1 pl-6"
            data-testid={`${dataTestId}-nothing-sent-reason`}
          >
            {describeNothingSent(
              result.nothingSentReason,
              request.event,
              translate,
            )}
          </p>
          {noteShownLater ? (
            <p
              className="mt-1 pl-6"
              data-testid={`${dataTestId}-nothing-sent-note-later`}
            >
              {noteShownLater}
            </p>
          ) : (
            <></>
          )}
        </div>
      );
    }

    const hiddenPagesText: string | null = describeHiddenPages(
      result.audience.hiddenStatusPageCount,
      translate,
    );

    return (
      <div className="space-y-4" data-testid={`${dataTestId}-body`}>
        {selectedStatusPage ? (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                {result.statusPages.length > 1 ? (
                  <>
                    <label
                      htmlFor={pageSelectId}
                      className="block text-xs font-medium text-gray-700"
                    >
                      {translate(
                        SubscriberNotificationPreviewCopy.statusPageSelectLabel,
                      )}
                    </label>
                    <div
                      className="mt-1"
                      data-testid={`${dataTestId}-page-select`}
                    >
                      <Dropdown
                        inputId={pageSelectId}
                        className="relative w-full overflow-visible"
                        /*
                         * A page's name and how many it reaches, put
                         * together in the reader's language.
                         */
                        options={result.statusPages.map(
                          (
                            statusPage: SubscriberNotificationPreviewStatusPage,
                          ): DropdownOption => {
                            return getTranslatedDropdownOption(
                              statusPage.statusPageId,
                              describePreviewStatusPage(statusPage, translate),
                            );
                          },
                        )}
                        value={getTranslatedDropdownOption(
                          selectedStatusPage.statusPageId,
                          describePreviewStatusPage(
                            selectedStatusPage,
                            translate,
                          ),
                        )}
                        /*
                         * Kept on the page being sent until the test has
                         * answered, so its answer is shown under that page.
                         */
                        disabled={sendTest.isSending}
                        // The preview always shows one page.
                        isClearable={false}
                        onChange={(
                          next: DropdownValue | Array<DropdownValue> | null,
                        ): void => {
                          const picked: string | null =
                            readPickedDropdownValue(next);

                          if (
                            picked === null ||
                            picked === selectedStatusPage.statusPageId
                          ) {
                            return;
                          }

                          sendTestGeneration.current += 1;
                          setSelectedStatusPageId(picked);
                          setSendTest(EMPTY_SEND_TEST_STATE);
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <p
                    className="text-sm font-medium text-gray-900"
                    data-testid={`${dataTestId}-page-name`}
                  >
                    {describePreviewStatusPage(selectedStatusPage, translate)}
                  </p>
                )}
              </div>
              <div className="shrink-0">
                <Button
                  title={SubscriberNotificationPreviewCopy.sendTestButton}
                  icon={IconProp.Email}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  isLoading={sendTest.isSending}
                  disabled={sendTest.isSending}
                  onClick={onSendTest}
                  dataTestId={`${dataTestId}-send-test`}
                />
              </div>
            </div>

            <p
              className="text-xs text-gray-500"
              data-testid={`${dataTestId}-send-test-description`}
            >
              {translate(SubscriberNotificationPreviewCopy.sendTestDescription)}
            </p>

            {sendTest.sentTo ? (
              <p
                role="status"
                data-testid={`${dataTestId}-send-test-sent`}
                className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
              >
                {formatPreviewText(
                  translate(SubscriberNotificationPreviewCopy.sendTestSent),
                  { email: sendTest.sentTo },
                )}
              </p>
            ) : null}

            {sendTest.error ? (
              <div
                role="alert"
                data-testid={`${dataTestId}-send-test-error`}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                <p className="font-medium">
                  {translate(SubscriberNotificationPreviewCopy.sendTestError)}
                </p>
                <p className="mt-0.5">
                  <ErrorInSentence
                    message={sendTest.error}
                    showWhereToLook={true}
                  />
                </p>
              </div>
            ) : null}

            <div
              className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
              data-testid={`${dataTestId}-template-choice`}
              data-reason={selectedStatusPage.templateChoice.reason}
            >
              <Icon
                icon={IconProp.Info}
                className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
              />
              <span>
                {describeTemplateChoice(
                  selectedStatusPage.templateChoice,
                  translate,
                )}
              </span>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-500">
                {translate(SubscriberNotificationPreviewCopy.subjectLabel)}
              </p>
              <p
                className="mt-0.5 break-words text-sm font-semibold text-gray-900"
                data-testid={`${dataTestId}-subject`}
              >
                {selectedStatusPage.subject}
              </p>
            </div>

            <EmailPreviewFrame
              /*
               * A new frame per page: assigning a new srcDoc to the same
               * frame keeps the old page's scroll position.
               */
              key={selectedStatusPage.statusPageId}
              html={selectedStatusPage.html}
              title={translate(
                SubscriberNotificationPreviewCopy.emailFrameTitle,
              )}
              dataTestId={`${dataTestId}-frame`}
            />

            <p className="text-xs text-gray-500">
              {translate(
                SubscriberNotificationPreviewCopy.sampleUnsubscribeLinkNote,
              )}
            </p>
          </>
        ) : (
          <></>
        )}

        {hiddenPagesText ? (
          <p
            className="text-xs text-gray-500"
            data-testid={`${dataTestId}-hidden-pages`}
          >
            {hiddenPagesText}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  /*
   * Keys are left to propagate. The dialog's Escape and its Tab focus trap
   * are listened for on the document (Modal), and a portalled event still
   * reaches it: stopping propagation here stopped the native event at the
   * body, so Escape did not close the dialog and Tab walked out of it. The
   * forms this opens from ignore keys from outside their own element - the
   * note composer posts on Cmd+Enter and closes on Escape (NoteComposer).
   */
  const modal: ReactElement = (
    <div data-testid={dataTestId}>
      <Modal
        title={SubscriberNotificationPreviewCopy.dialogTitle}
        description={SubscriberNotificationPreviewCopy.dialogDescription}
        modalWidth={ModalWidth.Large}
        onClose={props.onClose}
        closeButtonText="Close"
      >
        {getBody()}
      </Modal>
    </div>
  );

  return typeof document !== "undefined" && document.body
    ? createPortal(modal, document.body)
    : modal;
};

export default SubscriberNotificationPreviewModal;
