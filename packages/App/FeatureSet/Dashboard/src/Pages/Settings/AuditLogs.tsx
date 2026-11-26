import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../PageComponentProps";
import AuditLogsTable from "../../Components/AuditLogs/AuditLogsTable";
import {
  getRecordIdOfAuditLogsPage,
  RECORD_HISTORY_QUERY_PARAM,
} from "../../Components/AuditLogs/RecordHistoryPages";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import { RouteUtil } from "../../Utils/RouteMap";

/*
 * The project's audit log - and one record's history (#10290): a record
 * whose kind has no Audit Logs page of its own (a rule, an LLM provider, an
 * API key) links its line's History here, `?recordId=<its id>`, and the
 * page lists that record's changes and those of what it holds, the way a
 * resource's own Audit Logs page does, with the way back to every change.
 */
const SettingsAuditLogs: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const recordId: ObjectID | null = getRecordIdOfAuditLogsPage(
    Navigation.getQueryStringByName(RECORD_HISTORY_QUERY_PARAM),
  );

  if (!recordId) {
    return (
      <AuditLogsTable
        title="Audit Logs"
        description="Every change made to the resources in this project, and every time its members sign in or out."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p data-testid="audit-logs-one-record" className="text-sm text-gray-600">
        {translator.translateText("Only the changes to one record are shown.")}{" "}
        <Link
          to={RouteUtil.getPageRoute(PageMap.SETTINGS_AUDIT_LOGS)}
          dataTestId="audit-logs-show-every-change"
          className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
        >
          {translator.translateText("Show every change")}
        </Link>
      </p>
      <AuditLogsTable
        title="Record History"
        description="Who changed this record, what they changed and when."
        rootResourceId={recordId}
      />
    </div>
  );
};

export default SettingsAuditLogs;
