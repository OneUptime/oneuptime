import { DashboardClientUrl } from "../../EnvironmentConfig";
import { AlwaysAskPage } from "../../../Types/AI/AIAlwaysAskChanges";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "../../../Types/AI/AIChatTypes";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE DASHBOARD'S DATA SECURITY PAGES, BY ADDRESS (#10378).
 *
 * Where a person presses the button an action of Ask AI's stands in for: a
 * store, its findings or owners, an issue, Data Security → AI and the
 * settings of each kind of rule. The MCP server sends an agent here for an
 * action that asks in every mode, which it cannot ask about itself
 * (DataSecurityActionRunner), and Ask AI's cards open the same pages
 * (AIChatCitationTarget). The paths are the Dashboard's own
 * (Dashboard/src/Utils/RouteMap: DataSecurityRoutePath), held together by
 * a test.
 */

export const DATA_SECURITY_PAGE_PATHS: {
  store: string;
  storeFindings: string;
  storeOwners: string;
  storeSettings: string;
  issue: string;
  ai: string;
  dataTypes: string;
  residencyRules: string;
  ownerRules: string;
  labelRules: string;
} = {
  store: "/dashboard/:projectId/data-security/stores/:id",
  storeFindings: "/dashboard/:projectId/data-security/stores/:id/inside",
  storeOwners: "/dashboard/:projectId/data-security/stores/:id/owners",
  storeSettings: "/dashboard/:projectId/data-security/stores/:id/settings",
  issue: "/dashboard/:projectId/data-security/issues/:id",
  ai: "/dashboard/:projectId/data-security/ai",
  dataTypes: "/dashboard/:projectId/data-security/settings/data-types",
  residencyRules: "/dashboard/:projectId/data-security/settings/residency",
  ownerRules: "/dashboard/:projectId/data-security/settings/owner-rules",
  labelRules: "/dashboard/:projectId/data-security/settings/label-rules",
};

/*
 * Security Events' playbooks, where a containment step's approval is
 * turned off (Dashboard/src/Utils/RouteMap: SecurityEventsRoutePath): a
 * refusal of a playbook's write names them (#11177).
 */
export const SECURITY_PLAYBOOK_PAGE_PATHS: {
  playbooks: string;
  playbook: string;
} = {
  playbooks: "/dashboard/:projectId/security-events/playbooks",
  playbook: "/dashboard/:projectId/security-events/playbooks/:id",
};

/*
 * Project Settings > Labels, where a label is renamed or deleted
 * (Dashboard/src/Utils/RouteMap: SettingsRoutePath): a refusal of a write
 * that lets go of what a production label holds back names it (#11347).
 */
export const SETTINGS_PAGE_PATHS: {
  labels: string;
} = {
  labels: "/dashboard/:projectId/settings/labels",
};

/*
 * A page, as Ask AI's cards and chips open it: a Dashboard page by its
 * route template and its English title (AIChatCitationTargetType
 * .DashboardPage), which the chip names in the reader's language.
 */
export function getDataSecurityPageTarget(data: {
  path: string;
  title: string;
}): AIChatCitationTarget {
  return {
    type: AIChatCitationTargetType.DashboardPage,
    params: { path: data.path, title: data.title },
  };
}

/*
 * The address of the page a target opens, in this project: a store's or an
 * issue's page by its id, or a Dashboard page by its template. Null for a
 * target this does not know, or one whose id is not one.
 */
export function getDataSecurityPageUrl(data: {
  projectId: ObjectID;
  target: AIChatCitationTarget | undefined;
}): string | null {
  const target: AIChatCitationTarget | undefined = data.target;
  const params: { [key: string]: string } = target?.params || {};
  let path: string | null = null;

  switch (target?.type) {
    case AIChatCitationTargetType.DataStoreView:
      path = withId(DATA_SECURITY_PAGE_PATHS.store, params["dataStoreId"]);
      break;
    case AIChatCitationTargetType.DataSecurityIssueView:
      path = withId(
        DATA_SECURITY_PAGE_PATHS.issue,
        params["dataSecurityIssueId"],
      );
      break;
    case AIChatCitationTargetType.DashboardPage:
      path = params["path"] || null;
      break;
    default:
      path = null;
  }

  if (!path || !path.startsWith("/dashboard/:projectId/")) {
    return null;
  }

  const dashboard: string = DashboardClientUrl.toString().replace(/\/+$/, "");

  return `${dashboard}${path
    .replace(/^\/dashboard/, "")
    .replace(":projectId", data.projectId.toString())}`;
}

// A template's :id, filled with an id that is one.
function withId(template: string, id: string | undefined): string | null {
  return id && ObjectID.isValidUUID(id) ? template.replace(":id", id) : null;
}

/*
 * The page a change that asks in every mode is made on (Types/AI/
 * AIAlwaysAskChanges' AlwaysAskPage), as the action's own card opens it:
 * the MCP server names it when it refuses a record's write that makes the
 * change (App/FeatureSet/MCP/Tools/AlwaysAskWrites). Null when the record
 * it needs - the issue, the finding's store - is not known.
 */
export function getAlwaysAskPageTarget(data: {
  page: AlwaysAskPage;
  recordId?: string | null | undefined;
  dataStoreId?: string | null | undefined;
}): AIChatCitationTarget | null {
  const storeId: string | null =
    data.dataStoreId && ObjectID.isValidUUID(data.dataStoreId)
      ? data.dataStoreId
      : null;

  switch (data.page) {
    case AlwaysAskPage.DataSecurityIssue:
      return data.recordId && ObjectID.isValidUUID(data.recordId)
        ? {
            type: AIChatCitationTargetType.DataSecurityIssueView,
            params: { dataSecurityIssueId: data.recordId },
          }
        : null;
    case AlwaysAskPage.DataStore:
      return storeId
        ? {
            type: AIChatCitationTargetType.DataStoreView,
            params: { dataStoreId: storeId },
          }
        : null;
    case AlwaysAskPage.DataStoreFindings:
      return storeId
        ? getDataSecurityPageTarget({
            path: DATA_SECURITY_PAGE_PATHS.storeFindings.replace(
              ":id",
              storeId,
            ),
            title: "Data Store",
          })
        : null;
    case AlwaysAskPage.DataStoreOwners:
      return storeId
        ? getDataSecurityPageTarget({
            path: DATA_SECURITY_PAGE_PATHS.storeOwners.replace(":id", storeId),
            title: "Owners",
          })
        : null;
    case AlwaysAskPage.DataStoreSettings:
      return storeId
        ? getDataSecurityPageTarget({
            path: DATA_SECURITY_PAGE_PATHS.storeSettings.replace(
              ":id",
              storeId,
            ),
            title: "Settings",
          })
        : null;
    case AlwaysAskPage.DataTypes:
      return getDataSecurityPageTarget({
        path: DATA_SECURITY_PAGE_PATHS.dataTypes,
        title: "Data Types",
      });
    case AlwaysAskPage.SecurityPlaybook:
      // A playbook's own page, or the playbooks for one not yet made.
      return getDataSecurityPageTarget({
        path:
          data.recordId && ObjectID.isValidUUID(data.recordId)
            ? SECURITY_PLAYBOOK_PAGE_PATHS.playbook.replace(
                ":id",
                data.recordId,
              )
            : SECURITY_PLAYBOOK_PAGE_PATHS.playbooks,
        title: "Playbooks",
      });
    case AlwaysAskPage.ResidencyRules:
      return getDataSecurityPageTarget({
        path: DATA_SECURITY_PAGE_PATHS.residencyRules,
        title: "Residency",
      });
    case AlwaysAskPage.OwnerRules:
      return getDataSecurityPageTarget({
        path: DATA_SECURITY_PAGE_PATHS.ownerRules,
        title: "Owner Rules",
      });
    case AlwaysAskPage.LabelRules:
      return getDataSecurityPageTarget({
        path: DATA_SECURITY_PAGE_PATHS.labelRules,
        title: "Label Rules",
      });
    case AlwaysAskPage.DataSecurityAi:
      return getDataSecurityPageTarget({
        path: DATA_SECURITY_PAGE_PATHS.ai,
        title: "AI",
      });
    case AlwaysAskPage.Labels:
      return getDataSecurityPageTarget({
        path: SETTINGS_PAGE_PATHS.labels,
        title: "Labels",
      });
    default:
      return null;
  }
}
