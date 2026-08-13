import PageComponentProps from "../PageComponentProps";
import InventorySummaryCards from "../../Components/Inventory/InventorySummaryCards";
import InventoryBreakdown from "../../Components/Inventory/InventoryBreakdown";
import {
  InventorySummaryCounts,
  summarizeInventory,
} from "../../Components/Inventory/InventorySummaryTiles";
import {
  InventoryCategoryBreakdown,
  buildInventoryBreakdown,
} from "../../Components/Inventory/InventoryTypeCatalog";
import {
  InventoryLivenessBadge,
  InventoryTypeBadge,
} from "../../Components/Inventory/InventoryBadges";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import AppLink from "../../Components/AppLink/AppLink";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
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
 * One fetch feeds all three sections. The alternative — a count endpoint per
 * tile plus another for the breakdown — cannot express staleness (which is
 * derived per row from the source and `lastSeenAt`, see InventoryLiveness),
 * and would let the tiles and the breakdown be snapshots of different
 * instants. The read is bounded by LIMIT_PER_PROJECT and selects only the
 * four narrow columns the fold needs.
 */

const RECENTLY_ADDED_COUNT: number = 8;

const InventoryOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [counts, setCounts] = useState<InventorySummaryCounts | null>(null);
  const [breakdown, setBreakdown] = useState<Array<InventoryCategoryBreakdown>>(
    [],
  );
  const [recent, setRecent] = useState<Array<TelemetryEntity>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchSnapshot: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      const result: ListResult<TelemetryEntity> =
        await ModelAPI.getList<TelemetryEntity>({
          modelType: TelemetryEntity,
          query: { projectId },
          select: {
            _id: true,
            entityType: true,
            displayName: true,
            source: true,
            firstSeenAt: true,
            lastSeenAt: true,
          },
          sort: { firstSeenAt: SortOrder.Descending },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });

      const now: Date = new Date();

      const countsByType: Record<string, number> = {};

      for (const item of result.data) {
        const entityType: string = item.entityType || "";

        if (!entityType) {
          continue;
        }

        countsByType[entityType] = (countsByType[entityType] || 0) + 1;
      }

      setCounts(summarizeInventory(result.data, now));
      setBreakdown(buildInventoryBreakdown(countsByType));
      setRecent(result.data.slice(0, RECENTLY_ADDED_COUNT));
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
            {recent.map((item: TelemetryEntity): ReactElement => {
              return (
                <li
                  key={item._id?.toString()}
                  className="flex items-center justify-between gap-x-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <AppLink
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INVENTORY_VIEW] as Route,
                        { modelId: new ObjectID(item._id!.toString()) },
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
