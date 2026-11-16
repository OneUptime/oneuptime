import { AuditLogExportCopy } from "./AuditLogExportCopy";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  AuditLogExportEntriesLost,
  isAuditLogExportLosingEntries,
  readAuditLogExportEntriesLost,
} from "Common/Types/AuditLog/Export/AuditLogExportEntriesLost";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A FAILING EXPORT'S DEADLINE, IN ITS VIEW ERROR DIALOG (#7186).
 *
 * The entries a failing export has not sent wait in the audit log, and each
 * one is deleted once it passes the retention it was recorded with. The
 * people who can fix the export are emailed a day before that, but whoever
 * opened its page saw no deadline. Under the next try, one line says it:
 * from when the entries waiting start to be deleted, or - once that moment
 * has passed - that they are being deleted since then, read against the
 * moment the server read the date, as the email reads it against its try
 * (Common/Types/AuditLog/Export/AuditLogExportEntriesLost).
 *
 * The date is the server's (POST /audit-log-export/entries-lost-at, or the
 * instance's), asked when the dialog opens for an export that is failing
 * and on. Nothing waiting, a read that failed, or an answer without a date
 * says nothing: never a wrong date.
 */

export interface AuditLogExportEntriesLostRequest {
  route: string;
  // The page's model API: its headers say whose export it is (a project's, or none).
  modelAPI: typeof ModelAPI;
  exportId: string;
}

// When the export's waiting entries start to be deleted, or null when that cannot be said.
export async function readAuditLogExportEntriesLostAt(
  request: AuditLogExportEntriesLostRequest,
): Promise<AuditLogExportEntriesLost | null> {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromURL(APP_API_URL).addRoute(request.route),
        headers: request.modelAPI.getCommonHeaders(),
        data: { exportId: request.exportId },
      });

    if (response instanceof HTTPErrorResponse) {
      return null;
    }

    return readAuditLogExportEntriesLost(response.data);
  } catch {
    return null;
  }
}

export interface AuditLogExportEntriesLostSentence {
  // A key of the locales, with the date as {{time}}.
  template: string;
  // Whether entries are being deleted now.
  isLosingEntries: boolean;
}

// What the line says: a date still ahead, or one that has passed.
export function getAuditLogExportEntriesLostSentence(
  entriesLost: AuditLogExportEntriesLost,
): AuditLogExportEntriesLostSentence {
  const isLosingEntries: boolean = isAuditLogExportLosingEntries({
    entriesLostAt: entriesLost.entriesLostAt,
    now: entriesLost.readAt,
  });

  return {
    template: isLosingEntries
      ? AuditLogExportCopy.entriesLostSince
      : AuditLogExportCopy.entriesLostFrom,
    isLosingEntries,
  };
}

export const AuditLogExportEntriesLostLine: FunctionComponent<
  AuditLogExportEntriesLostRequest
> = (props: AuditLogExportEntriesLostRequest): ReactElement => {
  const translator: Translator = useTranslator();
  const [entriesLost, setEntriesLost] =
    useState<AuditLogExportEntriesLost | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    setEntriesLost(null);

    readAuditLogExportEntriesLostAt({
      route: props.route,
      modelAPI: props.modelAPI,
      exportId: props.exportId,
    })
      .then((answer: AuditLogExportEntriesLost | null): void => {
        if (isCurrent) {
          setEntriesLost(answer);
        }
      })
      .catch((): void => {
        // readAuditLogExportEntriesLostAt answers null rather than throw.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.route, props.exportId]);

  if (!entriesLost) {
    return <></>;
  }

  const sentence: AuditLogExportEntriesLostSentence =
    getAuditLogExportEntriesLostSentence(entriesLost);

  return (
    <p
      className={
        sentence.isLosingEntries
          ? "text-sm font-medium text-red-700"
          : "text-sm text-gray-500"
      }
      data-testid="audit-log-export-entries-lost"
      data-losing-entries={sentence.isLosingEntries ? "true" : "false"}
    >
      {translator.translateTemplate(sentence.template, {
        time: OneUptimeDate.getDateAsLocalFormattedString(
          entriesLost.entriesLostAt,
        ),
      })}
    </p>
  );
};
