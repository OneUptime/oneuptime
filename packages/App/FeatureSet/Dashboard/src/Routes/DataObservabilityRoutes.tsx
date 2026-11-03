import ComponentProps from "../Pages/PageComponentProps";
import DataObservabilityLayout from "../Pages/DataObservability/Layout";
import TableViewLayout from "../Pages/DataObservability/TableView/Layout";
import StoreViewLayout from "../Pages/DataObservability/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, {
  DataObservabilityRoutePath,
  RouteUtil,
} from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import DataObservabilityOverviewPage from "../Pages/DataObservability/Overview";
import DataObservabilityTablesPage from "../Pages/DataObservability/Tables";
import DataObservabilityDroppedTablesPage from "../Pages/DataObservability/DroppedTables";
import DataObservabilityUnusedTablesPage from "../Pages/DataObservability/UnusedTables";
import DataObservabilityStoresPage from "../Pages/DataObservability/Stores";
import StoreOverviewPage from "../Pages/DataObservability/View/Overview";
import StoreTablesPage from "../Pages/DataObservability/View/Tables";
import StoreRecommendationsPage from "../Pages/DataObservability/View/Recommendations";
import DataObservabilitySchemaChangesPage from "../Pages/DataObservability/SchemaChanges";
import DataObservabilityDocumentationPage from "../Pages/DataObservability/Documentation";
import TableOverviewPage from "../Pages/DataObservability/TableView/Overview";
import TableColumnsPage from "../Pages/DataObservability/TableView/Columns";
import TableMetricsPage from "../Pages/DataObservability/TableView/Metrics";
import TableTimelinePage from "../Pages/DataObservability/TableView/Timeline";
import TableServicesPage from "../Pages/DataObservability/TableView/Services";
import TableChecksPage from "../Pages/DataObservability/TableView/Checks";
import TableLineagePage from "../Pages/DataObservability/TableView/Lineage";
import DataObservabilityPipelinesPage from "../Pages/DataObservability/Pipelines";
import PipelineViewLayout from "../Pages/DataPipeline/View/Layout";
import PipelineOverviewPage from "../Pages/DataPipeline/View/Overview";
import DataPipelineRecommendationsPage from "../Pages/DataPipeline/View/Recommendations";
import DataObservabilityDataProductsPage from "../Pages/DataObservability/DataProducts";
import DataProductViewLayout from "../Pages/DataProduct/View/Layout";
import DataProductOverviewPage from "../Pages/DataProduct/View/Overview";
import DataProductSettingsPage from "../Pages/DataProduct/View/Settings";
import DataProductDeletePage from "../Pages/DataProduct/View/Delete";
import DataObservabilityChecksPage from "../Pages/DataObservability/Checks";
import TableSettingsPage from "../Pages/DataObservability/TableView/Settings";
import TableDeletePage from "../Pages/DataObservability/TableView/Delete";

/*
 * Every page under the product's side menu renders inside its layout, the
 * product's own address opening its Overview. A table is worked on pages of
 * its own, under its own layout and side menu: its Overview at the table's
 * address, and each of its other pages one level under it.
 * "tables/dropped" is a word, so it wins over a table's "tables/:id". A
 * database is worked on pages of its own in the same way, at "stores/:id".
 */
const DataObservabilityRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const page: (
    key: PageMap,
    element: (pageRoute: Route) => ReactElement,
  ) => ReactElement = (
    key: PageMap,
    element: (pageRoute: Route) => ReactElement,
  ): ReactElement => {
    return (
      <PageRoute
        key={key}
        path={DataObservabilityRoutePath[key] || ""}
        element={element(RouteMap[key] as Route)}
      />
    );
  };

  return (
    <Routes>
      <PageRoute path="/" element={<DataObservabilityLayout {...props} />}>
        <PageRoute
          index
          element={
            <DataObservabilityOverviewPage
              {...props}
              pageRoute={RouteMap[PageMap.DATA_OBSERVABILITY] as Route}
            />
          }
        />
        {page(PageMap.DATA_OBSERVABILITY_OVERVIEW, (pageRoute: Route) => {
          return (
            <DataObservabilityOverviewPage {...props} pageRoute={pageRoute} />
          );
        })}
        {page(PageMap.DATA_OBSERVABILITY_TABLES, (pageRoute: Route) => {
          return (
            <DataObservabilityTablesPage {...props} pageRoute={pageRoute} />
          );
        })}
        {page(PageMap.DATA_OBSERVABILITY_TABLES_DROPPED, (pageRoute: Route) => {
          return (
            <DataObservabilityDroppedTablesPage
              {...props}
              pageRoute={pageRoute}
            />
          );
        })}
        {page(PageMap.DATA_OBSERVABILITY_TABLES_UNUSED, (pageRoute: Route) => {
          return (
            <DataObservabilityUnusedTablesPage
              {...props}
              pageRoute={pageRoute}
            />
          );
        })}
        {page(PageMap.DATA_OBSERVABILITY_STORES, (pageRoute: Route) => {
          return (
            <DataObservabilityStoresPage {...props} pageRoute={pageRoute} />
          );
        })}
        {page(PageMap.DATA_OBSERVABILITY_PIPELINES, (pageRoute: Route) => {
          return (
            <DataObservabilityPipelinesPage {...props} pageRoute={pageRoute} />
          );
        })}
        {page(PageMap.DATA_OBSERVABILITY_DATA_PRODUCTS, (pageRoute: Route) => {
          return (
            <DataObservabilityDataProductsPage
              {...props}
              pageRoute={pageRoute}
            />
          );
        })}
        {page(PageMap.DATA_OBSERVABILITY_CHECKS, (pageRoute: Route) => {
          return (
            <DataObservabilityChecksPage {...props} pageRoute={pageRoute} />
          );
        })}
        {page(PageMap.DATA_OBSERVABILITY_SCHEMA_CHANGES, (pageRoute: Route) => {
          return (
            <DataObservabilitySchemaChangesPage
              {...props}
              pageRoute={pageRoute}
            />
          );
        })}
        {page(PageMap.DATA_OBSERVABILITY_DOCUMENTATION, (pageRoute: Route) => {
          return (
            <DataObservabilityDocumentationPage
              {...props}
              pageRoute={pageRoute}
            />
          );
        })}
      </PageRoute>

      <PageRoute
        path={
          DataObservabilityRoutePath[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] ||
          ""
        }
        element={<TableViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <TableOverviewPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_TABLE_VIEW_COLUMNS,
          )}
          element={
            <TableColumnsPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW_COLUMNS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_TABLE_VIEW_METRICS,
          )}
          element={
            <TableMetricsPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW_METRICS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_TABLE_VIEW_TIMELINE,
          )}
          element={
            <TableTimelinePage
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DATA_OBSERVABILITY_TABLE_VIEW_TIMELINE
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_TABLE_VIEW_LINEAGE,
          )}
          element={
            <TableLineagePage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW_LINEAGE] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS,
          )}
          element={
            <TableChecksPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_TABLE_VIEW_SERVICES,
          )}
          element={
            <TableServicesPage
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DATA_OBSERVABILITY_TABLE_VIEW_SERVICES
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_TABLE_VIEW_SETTINGS,
          )}
          element={
            <TableSettingsPage
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DATA_OBSERVABILITY_TABLE_VIEW_SETTINGS
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_TABLE_VIEW_DELETE,
          )}
          element={
            <TableDeletePage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW_DELETE] as Route
              }
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={
          DataObservabilityRoutePath[
            PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW
          ] || ""
        }
        element={<PipelineViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <PipelineOverviewPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW_RECOMMENDATIONS,
          )}
          element={
            <DataPipelineRecommendationsPage
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW_RECOMMENDATIONS
                ] as Route
              }
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={
          DataObservabilityRoutePath[
            PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW
          ] || ""
        }
        element={<DataProductViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <DataProductOverviewPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_SETTINGS,
          )}
          element={
            <DataProductSettingsPage
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_SETTINGS
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_DELETE,
          )}
          element={
            <DataProductDeletePage
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_DELETE
                ] as Route
              }
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={
          DataObservabilityRoutePath[PageMap.DATA_OBSERVABILITY_STORE_VIEW] ||
          ""
        }
        element={<StoreViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <StoreOverviewPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_OBSERVABILITY_STORE_VIEW] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_STORE_VIEW_TABLES,
          )}
          element={
            <StoreTablesPage
              {...props}
              pageRoute={
                RouteMap[PageMap.DATA_OBSERVABILITY_STORE_VIEW_TABLES] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS,
          )}
          element={
            <StoreRecommendationsPage
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS
                ] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default DataObservabilityRoutes;
