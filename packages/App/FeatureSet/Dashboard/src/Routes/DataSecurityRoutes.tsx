import ComponentProps from "../Pages/PageComponentProps";
import DataSecurityLayout from "../Pages/DataSecurity/Layout";
import DataStoreViewLayout from "../Pages/DataSecurity/StoreView/Layout";
import DataSecurityIssueViewLayout from "../Pages/DataSecurity/IssueView/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { DataSecurityRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import DataSecurityOverviewPage from "../Pages/DataSecurity/Overview";
import DataSecurityDataStoresPage from "../Pages/DataSecurity/DataStores";
import DataSecurityArchivedStoresPage from "../Pages/DataSecurity/ArchivedStores";
import DataSecurityIssuesPage from "../Pages/DataSecurity/Issues";
import DataSecuritySensitiveDataPage from "../Pages/DataSecurity/SensitiveData";
import DataSecurityTelemetryPage from "../Pages/DataSecurity/Telemetry";
import DataSecurityDataFlowsPage from "../Pages/DataSecurity/DataFlows";
import DataSecurityAccessPage from "../Pages/DataSecurity/Access";
import DataSecurityCompliancePage from "../Pages/DataSecurity/Compliance";
import DataSecurityScansPage from "../Pages/DataSecurity/Scans";
import DataSecurityDocumentationPage from "../Pages/DataSecurity/Documentation";
import DataSecurityDataTypesPage from "../Pages/DataSecurity/Settings/DataTypes";
import DataSecurityChecksPage from "../Pages/DataSecurity/Settings/Checks";
import DataSecurityResidencyPage from "../Pages/DataSecurity/Settings/Residency";
import DataSecurityScanningPage from "../Pages/DataSecurity/Settings/Scanning";
import DataSecurityOwnerRulesPage from "../Pages/DataSecurity/Settings/OwnerRules";
import DataSecurityLabelRulesPage from "../Pages/DataSecurity/Settings/LabelRules";
import DataStoreOverviewPage from "../Pages/DataSecurity/StoreView/Overview";
import DataStoreInsidePage from "../Pages/DataSecurity/StoreView/Inside";
import DataStoreAccessPage from "../Pages/DataSecurity/StoreView/Access";
import DataStoreIssuesPage from "../Pages/DataSecurity/StoreView/Issues";
import DataStoreFlowsPage from "../Pages/DataSecurity/StoreView/Flows";
import DataStoreScansPage from "../Pages/DataSecurity/StoreView/Scans";
import DataStoreOwnersPage from "../Pages/DataSecurity/StoreView/Owners";
import DataStoreSettingsPage from "../Pages/DataSecurity/StoreView/Settings";
import DataStoreDeletePage from "../Pages/DataSecurity/StoreView/Delete";
import DataSecurityIssueOverviewPage from "../Pages/DataSecurity/IssueView/Overview";
import DataSecurityIssueTimelinePage from "../Pages/DataSecurity/IssueView/Timeline";
import DataSecurityIssueDeletePage from "../Pages/DataSecurity/IssueView/Delete";

/*
 * Every page under the product's side menu renders inside its layout, the
 * product's own address opening its Overview. A data store is worked on
 * pages of its own, under its own layout and side menu (Pages/DataSecurity/
 * StoreView): its Overview at the store's address, and each of its other
 * pages one level under it. An issue is the same (Pages/DataSecurity/
 * IssueView). "stores/archived" is a word, so it wins over a store's
 * "stores/:id".
 */
const DataSecurityRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<DataSecurityLayout {...props} />}>
        <PageRoute
          index
          element={
            <DataSecurityOverviewPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY] as Route}
            />
          }
        />
        <PageRoute
          path={DataSecurityRoutePath[PageMap.DATA_SECURITY_OVERVIEW] || ""}
          element={
            <DataSecurityOverviewPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY_OVERVIEW] as Route}
            />
          }
        />
        <PageRoute
          path={DataSecurityRoutePath[PageMap.DATA_SECURITY_STORES] || ""}
          element={
            <DataSecurityDataStoresPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY_STORES] as Route}
            />
          }
        />
        <PageRoute
          path={
            DataSecurityRoutePath[PageMap.DATA_SECURITY_STORES_ARCHIVED] || ""
          }
          element={
            <DataSecurityArchivedStoresPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_STORES_ARCHIVED] as Route
              }
            />
          }
        />
        <PageRoute
          path={DataSecurityRoutePath[PageMap.DATA_SECURITY_ISSUES] || ""}
          element={
            <DataSecurityIssuesPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY_ISSUES] as Route}
            />
          }
        />
        <PageRoute
          path={
            DataSecurityRoutePath[PageMap.DATA_SECURITY_SENSITIVE_DATA] || ""
          }
          element={
            <DataSecuritySensitiveDataPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_SENSITIVE_DATA] as Route
              }
            />
          }
        />
        <PageRoute
          path={DataSecurityRoutePath[PageMap.DATA_SECURITY_TELEMETRY] || ""}
          element={
            <DataSecurityTelemetryPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY_TELEMETRY] as Route}
            />
          }
        />
        <PageRoute
          path={DataSecurityRoutePath[PageMap.DATA_SECURITY_FLOWS] || ""}
          element={
            <DataSecurityDataFlowsPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY_FLOWS] as Route}
            />
          }
        />
        <PageRoute
          path={DataSecurityRoutePath[PageMap.DATA_SECURITY_ACCESS] || ""}
          element={
            <DataSecurityAccessPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY_ACCESS] as Route}
            />
          }
        />
        <PageRoute
          path={DataSecurityRoutePath[PageMap.DATA_SECURITY_COMPLIANCE] || ""}
          element={
            <DataSecurityCompliancePage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY_COMPLIANCE] as Route}
            />
          }
        />
        <PageRoute
          path={DataSecurityRoutePath[PageMap.DATA_SECURITY_SCANS] || ""}
          element={
            <DataSecurityScansPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY_SCANS] as Route}
            />
          }
        />
        <PageRoute
          path={
            DataSecurityRoutePath[PageMap.DATA_SECURITY_SETTINGS_DATA_TYPES] ||
            ""
          }
          element={
            <DataSecurityDataTypesPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_SETTINGS_DATA_TYPES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            DataSecurityRoutePath[PageMap.DATA_SECURITY_SETTINGS_CHECKS] || ""
          }
          element={
            <DataSecurityChecksPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_SETTINGS_CHECKS] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            DataSecurityRoutePath[PageMap.DATA_SECURITY_SETTINGS_RESIDENCY] ||
            ""
          }
          element={
            <DataSecurityResidencyPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_SETTINGS_RESIDENCY] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            DataSecurityRoutePath[PageMap.DATA_SECURITY_SETTINGS_SCANNING] || ""
          }
          element={
            <DataSecurityScanningPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_SETTINGS_SCANNING] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            DataSecurityRoutePath[PageMap.DATA_SECURITY_SETTINGS_OWNER_RULES] ||
            ""
          }
          element={
            <DataSecurityOwnerRulesPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            DataSecurityRoutePath[PageMap.DATA_SECURITY_SETTINGS_LABEL_RULES] ||
            ""
          }
          element={
            <DataSecurityLabelRulesPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            DataSecurityRoutePath[PageMap.DATA_SECURITY_DOCUMENTATION] || ""
          }
          element={
            <DataSecurityDocumentationPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY_DOCUMENTATION] as Route}
            />
          }
        />
      </PageRoute>

      {/* One data store's pages, under its own side menu. */}
      <PageRoute
        path={DataSecurityRoutePath[PageMap.DATA_SECURITY_STORE_VIEW] || ""}
        element={<DataStoreViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <DataStoreOverviewPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY_STORE_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_SECURITY_STORE_VIEW_INSIDE,
          )}
          element={
            <DataStoreInsidePage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_INSIDE] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_SECURITY_STORE_VIEW_ACCESS,
          )}
          element={
            <DataStoreAccessPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_ACCESS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_SECURITY_STORE_VIEW_ISSUES,
          )}
          element={
            <DataStoreIssuesPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_ISSUES] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_SECURITY_STORE_VIEW_FLOWS,
          )}
          element={
            <DataStoreFlowsPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_FLOWS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_SECURITY_STORE_VIEW_SCANS,
          )}
          element={
            <DataStoreScansPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_SCANS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_SECURITY_STORE_VIEW_OWNERS,
          )}
          element={
            <DataStoreOwnersPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_OWNERS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_SECURITY_STORE_VIEW_SETTINGS,
          )}
          element={
            <DataStoreSettingsPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_SETTINGS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_SECURITY_STORE_VIEW_DELETE,
          )}
          element={
            <DataStoreDeletePage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_DELETE] as Route
              }
            />
          }
        />
      </PageRoute>

      {/* One issue's pages, under its own side menu. */}
      <PageRoute
        path={DataSecurityRoutePath[PageMap.DATA_SECURITY_ISSUE_VIEW] || ""}
        element={<DataSecurityIssueViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <DataSecurityIssueOverviewPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_SECURITY_ISSUE_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_SECURITY_ISSUE_VIEW_TIMELINE,
          )}
          element={
            <DataSecurityIssueTimelinePage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_ISSUE_VIEW_TIMELINE] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_SECURITY_ISSUE_VIEW_DELETE,
          )}
          element={
            <DataSecurityIssueDeletePage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_SECURITY_ISSUE_VIEW_DELETE] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default DataSecurityRoutes;
