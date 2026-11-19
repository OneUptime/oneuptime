import Log from "../../../../Models/AnalyticsModels/Log";
import IconProp from "../../../../Types/Icon/IconProp";
import Button, { ButtonSize, ButtonStyleType } from "../../Button/Button";
import ErrorMessage from "../../ErrorMessage/ErrorMessage";
import DetailListSkeleton from "../../Skeleton/DetailListSkeleton";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * ONE LOG LINE, OPENED BY ITS ID (#9620).
 *
 * A link to one line - a security event's "View log line", or anyone's
 * shared address - opens the logs explorer with that line above its list:
 * read by its id, with the reader's own permissions, and drawn in the
 * panel a row opens. The list under it shows what the link scoped it to
 * (the line's service, in the second around it). A line that is gone - past
 * its retention - and one in a service the reader's role cannot read are
 * said the same way, so the address never tells which.
 */

export interface LogsViewerOpenedLog {
  // The line, once read.
  log: Log | null;
  isLoading: boolean;
  // Read, and not there: gone, or not the reader's to read.
  isNotFound: boolean;
  // Why it could not be read, in the reader's words; "" when it was.
  error: string;
  onClose: () => void;
  onRetry: () => void;
}

export const OPENED_LOG_LINE_TEST_ID: string = "logs-viewer-opened-line";

export const OPENED_LOG_LINE_TITLE: string = translationKey("Log line");

export const OPENED_LOG_LINE_NOT_FOUND: string = translationKey(
  "This log line was not found. It may be past its retention, or in a service your role cannot read.",
);

export const OPENED_LOG_LINE_CLOSE: string = translationKey("Close Log Line");

export interface ComponentProps {
  opened: LogsViewerOpenedLog;
  // The line, in the panel a row of the list opens.
  renderLog: (log: Log) => ReactElement;
}

const OpenedLogLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { opened } = props;

  const closeButton: ReactElement = (
    <Button
      title={OPENED_LOG_LINE_CLOSE}
      icon={IconProp.Close}
      buttonStyle={ButtonStyleType.OUTLINE}
      buttonSize={ButtonSize.Small}
      onClick={opened.onClose}
      dataTestId="logs-viewer-opened-line-close"
    />
  );

  let body: ReactElement;

  if (opened.isLoading) {
    body = <DetailListSkeleton fields={4} />;
  } else if (opened.log) {
    body = props.renderLog(opened.log);
  } else if (opened.error) {
    body = (
      <div className="space-y-2">
        <ErrorMessage message={opened.error} onRefreshClick={opened.onRetry} />
        <div className="flex justify-end">{closeButton}</div>
      </div>
    );
  } else {
    body = (
      <div
        className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        data-testid="logs-viewer-opened-line-not-found"
      >
        <p className="text-sm text-gray-600">
          {translator.translateText(OPENED_LOG_LINE_NOT_FOUND)}
        </p>
        <div className="shrink-0">{closeButton}</div>
      </div>
    );
  }

  return (
    <section
      className="space-y-2 border-b border-gray-100 px-4 py-4"
      aria-label={translator.translateText(OPENED_LOG_LINE_TITLE)}
      data-testid={OPENED_LOG_LINE_TEST_ID}
    >
      <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(OPENED_LOG_LINE_TITLE)}
      </h3>
      {body}
    </section>
  );
};

export default OpenedLogLine;
