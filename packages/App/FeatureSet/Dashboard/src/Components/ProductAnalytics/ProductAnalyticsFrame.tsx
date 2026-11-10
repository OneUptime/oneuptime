import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import { TimeRangePickerSize } from "Common/UI/Components/Date/TimeRangePickerDropdown";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import {
  TableHeaderToolbar,
  renderTableHeaderMoreMenu,
} from "Common/UI/Components/Table/TableHeaderControls";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import {
  ResourceOverviewTile,
  ResourceOverviewTileCard,
} from "../TelemetryResource/ResourceOverview";

/*
 * The pieces both product analytics pages are built of (issue #6444): the
 * header's range and refresh, the tiles, the line that says when counting
 * started, and what the page says before there is anything to count.
 */

export const PRODUCT_ANALYTICS_TILES_FRAME_CLASS_NAME: string =
  "[container-type:inline-size]";

/* Two tiles a row, three where the card is wide enough for three of 200px or so. */
export const PRODUCT_ANALYTICS_TILES_GRID_CLASS_NAME: string =
  "grid grid-cols-2 gap-4 [@container(min-width:40rem)]:grid-cols-3";

export function ProductAnalyticsTiles(props: {
  tiles: Array<ResourceOverviewTile>;
  dataTestId: string;
}): ReactElement {
  return (
    <div className={PRODUCT_ANALYTICS_TILES_FRAME_CLASS_NAME}>
      <div
        className={PRODUCT_ANALYTICS_TILES_GRID_CLASS_NAME}
        data-testid={props.dataTestId}
      >
        {props.tiles.map((tile: ResourceOverviewTile): ReactElement => {
          return <ResourceOverviewTileCard key={tile.title} {...tile} />;
        })}
      </div>
    </div>
  );
}

export function ProductAnalyticsToolbar(props: {
  timeRange: RangeStartAndEndDateTime;
  onTimeRangeChange: (range: RangeStartAndEndDateTime) => void;
  onRefresh: () => void;
  dataTestId: string;
}): ReactElement {
  return (
    <TableHeaderToolbar
      key={`${props.dataTestId}-header`}
      dataTestId={props.dataTestId}
    >
      <TelemetryTimeRangePicker
        value={props.timeRange}
        onChange={props.onTimeRangeChange}
        size={TimeRangePickerSize.Header}
      />
      {renderTableHeaderMoreMenu([], {
        dataTestId: `${props.dataTestId}-more`,
        sections: [
          <MoreMenuItem
            key="refresh"
            text="Refresh"
            icon={IconProp.Refresh}
            dataTestId={`${props.dataTestId}-refresh`}
            onClick={props.onRefresh}
          />,
        ],
      })}
    </TableHeaderToolbar>
  );
}

/*
 * Counting starts with the first session recorded once an installation
 * runs a version with product analytics: nothing recorded before then is
 * in the tables. Said when the range reaches back past that, so a month
 * that is half empty reads as new rather than as a month nobody came.
 */
export const ProductAnalyticsCountingSince: FunctionComponent<{
  dataStartedAt: number | null;
  startTime: Date;
}> = (props: {
  dataStartedAt: number | null;
  startTime: Date;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (
    props.dataStartedAt === null ||
    props.dataStartedAt <= props.startTime.getTime()
  ) {
    return <></>;
  }

  return (
    <p
      className="text-sm text-gray-500"
      data-testid="product-analytics-counting-since"
    >
      {translator.translateTemplate(
        "Counting started on {{date}}. Sessions recorded before then are not in these numbers.",
        {
          date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            new Date(props.dataStartedAt),
            true,
          ),
        },
      )}
    </p>
  );
};

/* Before any session is counted: where the numbers will come from. */
export const ProductAnalyticsNothingYet: FunctionComponent<{
  rumApplicationId: ObjectID;
}> = (props: { rumApplicationId: ObjectID }): ReactElement => {
  const translator: Translator = useTranslator();
  const docsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[
      PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_DOCUMENTATION
    ] as Route,
    { modelId: props.rumApplicationId },
  );

  return (
    <EmptyState
      id="product-analytics-nothing-yet"
      icon={IconProp.PresentationChartLine}
      title="No sessions counted yet"
      paddingClassName="py-16"
      description={
        <span>
          {translator.translateText(
            "Product analytics counts the sessions Session Replay records. Once this application records sessions, its users and sessions show here.",
          )}
        </span>
      }
      footer={
        <AppLink
          to={docsRoute}
          className="text-sm font-medium text-indigo-700 hover:underline"
        >
          {translator.translateText("How to install Session Replay")}
        </AppLink>
      }
    />
  );
};
