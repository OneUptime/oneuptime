import PageComponentProps from "../PageComponentProps";
import InventorySummaryCards from "../../Components/Inventory/InventorySummaryCards";
import InventoryBreakdown from "../../Components/Inventory/InventoryBreakdown";
import { InventorySummaryCounts } from "../../Components/Inventory/InventorySummaryTiles";
import {
  InventoryCategoryBreakdown,
  buildInventoryBreakdown,
} from "../../Components/Inventory/InventoryTypeCatalog";
import {
  InventoryLivenessBadge,
  InventoryTypeBadge,
} from "../../Components/Inventory/InventoryBadges";
import {
  InventoryOverview as InventoryOverviewData,
  InventoryRecentItem,
  fetchInventoryOverview,
} from "../../Components/Inventory/InventoryOverviewApi";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import AppLink from "../../Components/AppLink/AppLink";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The Inventory landing page: how big the estate is, what it is made of, and
 * what showed up most recently.
 *
 * One request feeds all three sections, and it returns numbers rather than
 * rows. The tiles and the breakdown are counted in Postgres over the whole
 * estate, in one grouped statement, so they are views of one snapshot — see
 * App/FeatureSet/BaseAPI/API/InventoryOverview. Counting them here from a
 * list read was capped at ten thousand rows and silently wrong past it.
 */

const InventoryOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [counts, setCounts] = useState<InventorySummaryCounts | null>(null);
  const [breakdown, setBreakdown] = useState<Array<InventoryCategoryBreakdown>>(
    [],
  );
  const [recent, setRecent] = useState<Array<InventoryRecentItem>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchSnapshot: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      // Unarchived only, server-side, matching the list every tile drills into.
      const overview: InventoryOverviewData = await fetchInventoryOverview();

      setCounts(overview.counts);
      setBreakdown(buildInventoryBreakdown(overview.countsByType));
      setRecent(overview.recentlyAdded);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchSnapshot().catch(() => {
      // Handled in fetchSnapshot.
    });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const isEmptyEstate: boolean = !isLoading && (counts?.total || 0) === 0;

  if (isEmptyEstate) {
    return (
      <EmptyState
        id="inventory-overview-empty-state"
        icon={IconProp.Cube}
        showSolidBackground={true}
        title="Your inventory is empty"
        description="Send OpenTelemetry data or connect infrastructure and everything OneUptime finds shows up here automatically. You can also add something by hand for things that will never report on their own."
        footer={
          <Button
            title="Read the setup guide"
            icon={IconProp.Book}
            buttonStyle={ButtonStyleType.PRIMARY}
            onClick={() => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.INVENTORY_DOCUMENTATION] as Route,
                ),
              );
            }}
          />
        }
      />
    );
  }

  return (
    <Fragment>
      <InventorySummaryCards counts={counts} isLoading={isLoading} />

      <InventoryBreakdown breakdown={breakdown} isLoading={isLoading} />

      <Card
        title="Recently added"
        description="The newest things OneUptime has found or you have registered."
        buttons={[
          {
            title: "Explore topology",
            icon: IconProp.FlowDiagram,
            buttonStyle: ButtonStyleType.OUTLINE,
            onClick: () => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.TOPOLOGY] as Route,
                ),
              );
            },
          },
          {
            title: "View all items",
            icon: IconProp.List,
            buttonStyle: ButtonStyleType.OUTLINE,
            onClick: () => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.INVENTORY_ITEMS] as Route,
                ),
              );
            },
          },
        ]}
      >
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((index: number): ReactElement => {
              return (
                <div
                  key={index}
                  className="h-10 animate-pulse rounded bg-gray-100"
                ></div>
              );
            })}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recent.map((item: InventoryRecentItem): ReactElement => {
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-x-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <AppLink
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INVENTORY_VIEW] as Route,
                        { modelId: new ObjectID(item.id) },
                      )}
                      className="truncate text-sm font-medium text-gray-900 hover:text-indigo-700"
                    >
                      {item.displayName || "Unnamed"}
                    </AppLink>
                  </div>
                  <InventoryTypeBadge entityType={item.entityType} />
                  <InventoryLivenessBadge
                    source={item.source}
                    lastSeenAt={item.lastSeenAt}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Fragment>
  );
};

export default InventoryOverview;
