import ComponentProps from "../Pages/PageComponentProps";
import InventoryLayout from "../Pages/Inventory/Layout";
import InventoryItemViewLayout from "../Pages/Inventory/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, InventoryRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import InventoryOverview from "../Pages/Inventory/Overview";
import InventoryItems from "../Pages/Inventory/Items";
import InventoryDocumentation from "../Pages/Inventory/Documentation";
import InventoryItemOverview from "../Pages/Inventory/View/Index";
import InventoryItemRelationships from "../Pages/Inventory/View/Relationships";
import InventoryItemTelemetry from "../Pages/Inventory/View/Telemetry";
import InventoryItemSettings from "../Pages/Inventory/View/Settings";
import InventoryItemDelete from "../Pages/Inventory/View/Delete";

const InventoryRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<InventoryLayout {...props} />}>
        {/*
         * The bare product route lands on the Overview, so a link to
         * /inventory is never a blank page.
         */}
        <PageRoute
          index
          element={
            <InventoryOverview
              {...props}
              pageRoute={RouteMap[PageMap.INVENTORY] as Route}
            />
          }
        />
        <PageRoute
          path={InventoryRoutePath[PageMap.INVENTORY] || ""}
          element={
            <InventoryOverview
              {...props}
              pageRoute={RouteMap[PageMap.INVENTORY] as Route}
            />
          }
        />
        <PageRoute
          path={InventoryRoutePath[PageMap.INVENTORY_ITEMS] || ""}
          element={
            <InventoryItems
              {...props}
              pageRoute={RouteMap[PageMap.INVENTORY_ITEMS] as Route}
            />
          }
        />
        <PageRoute
          path={InventoryRoutePath[PageMap.INVENTORY_DOCUMENTATION] || ""}
          element={
            <InventoryDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.INVENTORY_DOCUMENTATION] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={InventoryRoutePath[PageMap.INVENTORY_VIEW] || ""}
        element={<InventoryItemViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <InventoryItemOverview
              {...props}
              pageRoute={RouteMap[PageMap.INVENTORY_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.INVENTORY_VIEW_RELATIONSHIPS,
          )}
          element={
            <InventoryItemRelationships
              {...props}
              pageRoute={
                RouteMap[PageMap.INVENTORY_VIEW_RELATIONSHIPS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INVENTORY_VIEW_TELEMETRY)}
          element={
            <InventoryItemTelemetry
              {...props}
              pageRoute={RouteMap[PageMap.INVENTORY_VIEW_TELEMETRY] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INVENTORY_VIEW_SETTINGS)}
          element={
            <InventoryItemSettings
              {...props}
              pageRoute={RouteMap[PageMap.INVENTORY_VIEW_SETTINGS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.INVENTORY_VIEW_DELETE)}
          element={
            <InventoryItemDelete
              {...props}
              pageRoute={RouteMap[PageMap.INVENTORY_VIEW_DELETE] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default InventoryRoutes;
