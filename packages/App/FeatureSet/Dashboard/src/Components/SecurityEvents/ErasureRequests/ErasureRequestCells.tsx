import {
  ERASED_AT,
  ERASING_LINE,
  ERASURE_STATUS_LABELS,
  ERASURE_STATUS_TONES,
  FAILED_LINE,
  FINAL_CHECK_LINE,
  FINAL_CHECK_STARTED_LINE,
  FINAL_CHECK_STARTS_LINE,
  NOTHING_NAMED_THEM,
  NOT_STARTED,
  QUEUED_LINE,
  READING_FINDINGS_LINE,
  READING_FINDINGS_STARTED_LINE,
  REQUESTED_AT,
  REQUESTED_AT_BY,
  RETRYING_LINE,
  RETRYING_WITHOUT_REASON_LINE,
  STARTING_LINE,
  UNNAMED_REQUEST,
  getErasureChanges,
  getErasureStatus,
} from "./ErasureRequestCopy";
import SecurityUserErasureRequest from "Common/Models/DatabaseModels/SecurityUserErasureRequest";
import OneUptimeDate from "Common/Types/Date";
import { SecurityUserErasureRequestStatus } from "Common/Types/SecurityEvent/SecurityUserErasure";
import {
  SecurityUserErasureProgressLine,
  SecurityUserErasureStage,
} from "Common/Types/SecurityEvent/SecurityUserErasureProgressLine";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The cells of Security Events > Erasure Requests (#10908): which request
 * a row is, where it stands, what it changed, and the tokens the vault
 * refuses for it. What each says is chosen in ErasureRequestCopy
 * (React-free); here it is put into the reader's words.
 */

export const ERASURE_REQUEST_TEST_IDS: {
  request: string;
  status: string;
  statusLine: string;
  changes: string;
  tokens: string;
} = {
  request: "security-erasure-request",
  status: "security-erasure-request-status",
  statusLine: "security-erasure-request-status-line",
  changes: "security-erasure-request-changes",
  tokens: "security-erasure-request-tokens",
};

// Who asked, as the row says it: their name, else their email address.
function readRequester(request: SecurityUserErasureRequest): string {
  return (
    request.requestedByUser?.name?.toString() ||
    request.requestedByUser?.email?.toString() ||
    ""
  );
}

// The request: the team's own reference for it, and who filed it, when.
export const ErasureRequestCell: FunctionComponent<{
  request: SecurityUserErasureRequest;
}> = (props: { request: SecurityUserErasureRequest }): ReactElement => {
  const translator: Translator = useTranslator();
  const reference: string = (props.request.reference || "").trim();
  const requester: string = readRequester(props.request);
  const time: string = props.request.requestedAt
    ? OneUptimeDate.fromNow(props.request.requestedAt)
    : "";

  return (
    <div data-testid={ERASURE_REQUEST_TEST_IDS.request} className="min-w-0">
      <span className="block text-sm font-medium text-gray-900">
        {reference ? (
          <IsolatedText text={reference} />
        ) : (
          translator.translateText(UNNAMED_REQUEST)
        )}
      </span>
      {time ? (
        <span
          className="block text-xs text-gray-500"
          title={
            props.request.requestedAt
              ? OneUptimeDate.getDateAsLocalFormattedString(
                  props.request.requestedAt,
                )
              : undefined
          }
        >
          {requester
            ? translator.translateTemplate(REQUESTED_AT_BY, {
                time,
                name: requester,
              })
            : translator.translateTemplate(REQUESTED_AT, { time })}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * The soonest a time the request waits for is said to be: the worker runs
 * every minute, so a time that has passed, or is about to, is the next run's.
 */
const NEXT_RUN_IN_MS: number = 60 * 1000;

function fromNowAtTheEarliest(time: string, now: Date): string {
  return OneUptimeDate.fromNow(
    new Date(
      Math.max(new Date(time).getTime(), now.getTime() + NEXT_RUN_IN_MS),
    ),
    now,
  );
}

/*
 * How far an Erasing request has got (#11232), from the line the server
 * worked out of it: null when there is none to say, and the page says it
 * is waiting for the last of it to be applied.
 */
export function writeErasingLine(
  translator: Translator,
  progress: SecurityUserErasureProgressLine | undefined,
  now: Date,
): string | null {
  if (
    !progress ||
    progress.status !== SecurityUserErasureRequestStatus.InProgress
  ) {
    return null;
  }

  const pass: string = translator.formatNumber(progress.pass || 1);
  const date: string | null = progress.readUpTo
    ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(progress.readUpTo)
    : null;

  switch (progress.stage) {
    case SecurityUserErasureStage.Starting:
      return translator.translateText(STARTING_LINE) || STARTING_LINE;
    case SecurityUserErasureStage.Applying:
      return translator.translateText(ERASING_LINE) || ERASING_LINE;
    case SecurityUserErasureStage.ReadingFindings:
      return date
        ? translator.translateTemplate(READING_FINDINGS_LINE, { pass, date })
        : translator.translateTemplate(READING_FINDINGS_STARTED_LINE, {
            pass,
          });
    case SecurityUserErasureStage.FinalCheck:
      return date
        ? translator.translateTemplate(FINAL_CHECK_LINE, { date })
        : translator.translateText(FINAL_CHECK_STARTED_LINE) ||
            FINAL_CHECK_STARTED_LINE;
    case SecurityUserErasureStage.WaitingForFinalCheck:
      return progress.finalCheckAt
        ? translator.translateTemplate(FINAL_CHECK_STARTS_LINE, {
            time: fromNowAtTheEarliest(progress.finalCheckAt, now),
          })
        : null;
    case SecurityUserErasureStage.Retrying: {
      const time: string = fromNowAtTheEarliest(
        progress.retryAt || now.toISOString(),
        now,
      );

      return progress.failureReason
        ? translator.translateTemplate(RETRYING_LINE, {
            reason: progress.failureReason,
            time,
          })
        : translator.translateTemplate(RETRYING_WITHOUT_REASON_LINE, { time });
    }
    default:
      return null;
  }
}

/*
 * The line under a request's state: when it starts, how far it has got (the
 * server's line for it, #11232), when it was done, why it failed.
 */
export function writeErasureStatusLine(
  translator: Translator,
  request: SecurityUserErasureRequest,
  progress?: SecurityUserErasureProgressLine | undefined,
  now: Date = OneUptimeDate.getCurrentDate(),
): string {
  switch (getErasureStatus(request)) {
    case SecurityUserErasureRequestStatus.InProgress:
      return (
        writeErasingLine(translator, progress, now) ||
        translator.translateText(ERASING_LINE) ||
        ERASING_LINE
      );
    case SecurityUserErasureRequestStatus.Completed:
      return request.completedAt
        ? translator.translateTemplate(ERASED_AT, {
            time: OneUptimeDate.fromNow(request.completedAt),
          })
        : "";
    case SecurityUserErasureRequestStatus.Failed:
      return translator.translateTemplate(FAILED_LINE, {
        reason: (request.failureReason || "").trim(),
      });
    default:
      return translator.translateText(QUEUED_LINE) || QUEUED_LINE;
  }
}

/*
 * Where a request stands: its state, and the line that says what that
 * means - for one Erasing, how far it has got (#11232).
 */
export const ErasureStatusCell: FunctionComponent<{
  request: SecurityUserErasureRequest;
  progress?: SecurityUserErasureProgressLine | undefined;
}> = (props: {
  request: SecurityUserErasureRequest;
  progress?: SecurityUserErasureProgressLine | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const status: SecurityUserErasureRequestStatus = getErasureStatus(
    props.request,
  );
  const line: string = writeErasureStatusLine(
    translator,
    props.request,
    props.progress,
  );

  return (
    <div className="min-w-0 space-y-1">
      <span data-testid={ERASURE_REQUEST_TEST_IDS.status}>
        <Pill
          text={ERASURE_STATUS_LABELS[status]}
          tone={ERASURE_STATUS_TONES[status]}
          isPulsing={status === SecurityUserErasureRequestStatus.InProgress}
        />
      </span>
      {line ? (
        <span
          data-testid={ERASURE_REQUEST_TEST_IDS.statusLine}
          className={`block text-xs ${
            status === SecurityUserErasureRequestStatus.Failed
              ? "text-red-700"
              : "text-gray-500"
          }`}
        >
          {line}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

// What a request changed: one line for each kind of record it took the person out of.
export const ErasureChangesCell: FunctionComponent<{
  request: SecurityUserErasureRequest;
}> = (props: { request: SecurityUserErasureRequest }): ReactElement => {
  const translator: Translator = useTranslator();
  const status: SecurityUserErasureRequestStatus = getErasureStatus(
    props.request,
  );
  const changes: Array<{ template: PluralTemplate; count: number }> =
    getErasureChanges(props.request);

  if (status === SecurityUserErasureRequestStatus.Pending) {
    return (
      <span
        data-testid={ERASURE_REQUEST_TEST_IDS.changes}
        className="text-sm text-gray-500"
      >
        {translator.translateText(NOT_STARTED)}
      </span>
    );
  }

  if (changes.length === 0) {
    return status === SecurityUserErasureRequestStatus.Completed ? (
      <span
        data-testid={ERASURE_REQUEST_TEST_IDS.changes}
        className="text-sm text-gray-600"
      >
        {translator.translateText(NOTHING_NAMED_THEM)}
      </span>
    ) : (
      <TableEmptyValue />
    );
  }

  return (
    <ul
      data-testid={ERASURE_REQUEST_TEST_IDS.changes}
      className="space-y-0.5 text-sm text-gray-700"
    >
      {changes.map(
        (change: { template: PluralTemplate; count: number }): ReactElement => {
          return (
            <li key={change.template.other}>
              {translator.translatePlural(change.template, change.count)}
            </li>
          );
        },
      )}
    </ul>
  );
};

/*
 * The tokens the vault refuses for the request: what the logs and traces
 * hold in the person's place, so a reader can search for them.
 */
export const ErasureTokensCell: FunctionComponent<{
  request: SecurityUserErasureRequest;
}> = (props: { request: SecurityUserErasureRequest }): ReactElement => {
  const tokens: Array<string> = Array.isArray(props.request.tokens)
    ? props.request.tokens.filter((token: unknown): token is string => {
        return typeof token === "string" && token.length > 0;
      })
    : [];

  if (tokens.length === 0) {
    return <TableEmptyValue />;
  }

  return (
    <span
      data-testid={ERASURE_REQUEST_TEST_IDS.tokens}
      className="flex flex-col gap-0.5"
    >
      {tokens.map((token: string): ReactElement => {
        return (
          <code
            key={token}
            className="w-fit break-all rounded bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700"
          >
            <IsolatedText text={token} />
          </code>
        );
      })}
    </span>
  );
};
