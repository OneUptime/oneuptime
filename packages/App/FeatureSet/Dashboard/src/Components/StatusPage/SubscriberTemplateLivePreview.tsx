import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import SubscriberNotificationTemplatePreview, {
  SubscriberNotificationTemplatePreviewResult,
} from "Common/Types/StatusPage/SubscriberNotificationTemplatePreview";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import EmailPreviewFrame from "./EmailPreviewFrame";
import SubscriberNotificationPreviewCopy, {
  formatPreviewText,
} from "./SubscriberNotificationPreviewCopy";

/*
 * The subscriber notification template being written, filled in with sample
 * values as it is typed - by the compiler the subscriber jobs fill it with
 * (SubscriberNotificationTemplatePreview). An email template's body shows in
 * a sandboxed frame (EmailPreviewFrame): the template is HTML, and a preview
 * must not run it. Every other channel shows the text it would send.
 */

export interface ComponentProps {
  eventType: StatusPageSubscriberNotificationEventType | undefined;
  notificationMethod: StatusPageSubscriberNotificationMethod | undefined;
  templateBody: string | null | undefined;
  emailSubject?: string | null | undefined;
  dataTestId?: string | undefined;
}

const SubscriberTemplateLivePreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const dataTestId: string = props.dataTestId || "subscriber-template-preview";

  const preview: SubscriberNotificationTemplatePreviewResult = useMemo(() => {
    return SubscriberNotificationTemplatePreview.render({
      eventType: props.eventType,
      notificationMethod: props.notificationMethod,
      templateBody: props.templateBody,
      emailSubject: props.emailSubject,
    });
  }, [
    props.eventType,
    props.notificationMethod,
    props.templateBody,
    props.emailSubject,
  ]);

  const getContent: () => ReactElement = (): ReactElement => {
    if (!props.eventType) {
      return (
        <p
          className="text-sm text-gray-500"
          data-testid={`${dataTestId}-empty`}
        >
          {tx(SubscriberNotificationPreviewCopy.livePreviewPickEventType)}
        </p>
      );
    }

    if (!preview.isAvailable) {
      return (
        <p
          className="text-sm text-gray-500"
          data-testid={`${dataTestId}-unavailable`}
        >
          {tx(SubscriberNotificationPreviewCopy.livePreviewReportUnavailable)}
        </p>
      );
    }

    if (!props.templateBody || props.templateBody.trim().length === 0) {
      return (
        <p
          className="text-sm text-gray-500"
          data-testid={`${dataTestId}-empty`}
        >
          {tx(SubscriberNotificationPreviewCopy.livePreviewEmptyTemplate)}
        </p>
      );
    }

    return (
      <div className="space-y-3">
        {preview.isHtml ? (
          <div>
            <p className="text-xs font-medium text-gray-500">
              {tx(SubscriberNotificationPreviewCopy.subjectLabel)}
            </p>
            <p
              className="mt-0.5 break-words text-sm font-semibold text-gray-900"
              data-testid={`${dataTestId}-subject`}
            >
              {preview.subject ||
                tx(SubscriberNotificationPreviewCopy.livePreviewNoSubject)}
            </p>
          </div>
        ) : (
          <></>
        )}

        {preview.isHtml ? (
          <EmailPreviewFrame
            html={preview.body}
            title={tx(SubscriberNotificationPreviewCopy.emailFrameTitle)}
            heightInPx={420}
            dataTestId={`${dataTestId}-frame`}
          />
        ) : (
          <pre
            className="whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-white p-3 font-sans text-sm text-gray-900"
            data-testid={`${dataTestId}-text`}
          >
            {preview.body}
          </pre>
        )}

        {preview.unknownPlaceholders.length > 0 ? (
          <p
            className="text-xs text-amber-800"
            data-testid={`${dataTestId}-unknown-placeholders`}
          >
            {formatPreviewText(
              tx(
                SubscriberNotificationPreviewCopy.livePreviewUnknownPlaceholders,
              ),
              {
                names: preview.unknownPlaceholders
                  .map((name: string): string => {
                    return `{{${name}}}`;
                  })
                  .join(", "),
              },
            )}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div
      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
      data-testid={dataTestId}
    >
      <div className="mb-3">
        <p className="text-sm font-semibold text-gray-900">
          {tx(SubscriberNotificationPreviewCopy.livePreviewTitle)}
        </p>
        <p className="text-xs text-gray-500">
          {tx(SubscriberNotificationPreviewCopy.livePreviewDescription)}
        </p>
      </div>
      {getContent()}
    </div>
  );
};

export default SubscriberTemplateLivePreview;
