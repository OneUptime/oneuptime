import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { GetRecordHistoryRoute } from "Common/UI/Components/Detail/RecordHistoryContext";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import {
  AUDIT_LOGS_REQUIRED_PLAN,
  isEnterpriseFeatureEligible,
} from "../../Enterprise/EnterpriseEligibility";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  getRecordHistoryPage,
  RECORD_HISTORY_QUERY_PARAM,
  RecordHistoryPage,
} from "./RecordHistoryPages";

/*
 * A RECORD'S HISTORY LINK, FOR ITS LINE (#10290): the Audit Logs page of the
 * record's own view, or the project's audit log showing the record alone
 * (RecordHistoryPages), where that page shows a history -
 * a project on a plan and an edition that keep audit logs, in a build with
 * their screens - and for a reader who may read the audit log: Project
 * Owner, Project Admin, Settings Admin, Read Audit Log. Anyone else gets no
 * link: the page would only refuse them, or offer an upgrade on every
 * record's line. The resource's Audit Logs entry in its menu still says what
 * the history is and how to get it.
 */
export const getAuditLogReaders: () => ReadonlyArray<Permission> =
  (): ReadonlyArray<Permission> => {
    return new AuditLog().accessControl?.read || [];
  };

const getRecordHistoryRoute: GetRecordHistoryRoute = (data: {
  modelType: { new (): BaseModel };
  modelId: ObjectID;
}): Route | null => {
  const history: RecordHistoryPage | null = getRecordHistoryPage(
    new data.modelType(),
  );
  const page: PageMap | undefined = history?.page;

  if (!history || !page || !RouteMap[page]) {
    return null;
  }

  if (
    !isEnterpriseFeatureEligible(AUDIT_LOGS_REQUIRED_PLAN) ||
    !getDashboardPlugins().AuditLogsTable
  ) {
    return null;
  }

  const readers: ReadonlyArray<Permission> = getAuditLogReaders();

  if (readers.length === 0 || !PermissionGate.holdsAnyOf(readers)) {
    return null;
  }

  if (!history.isOwnPage) {
    return RouteUtil.getPageRoute(page, {
      query: { [RECORD_HISTORY_QUERY_PARAM]: data.modelId.toString() },
    });
  }

  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: data.modelId,
  });
};

export default getRecordHistoryRoute;
