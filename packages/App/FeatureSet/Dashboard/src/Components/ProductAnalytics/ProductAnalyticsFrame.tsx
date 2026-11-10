import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import { TimeRangePickerSize } from "Common/UI/Components/Date/TimeRangePickerDropdown";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import {
  TableHeaderToolbar,
  renderTableHeaderMoreMenu,
} from "Common/UI/Components/Table/TableHeaderControls";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
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

/*
 * Three tiles a row where the card is wide enough for three of 200px or
 * so, two where it has room for two, and one on a phone, where two would
 * break a tile's title in the middle of a word ("WIEDERKEHRENDE").
 */
export const PRODUCT_ANALYTICS_TILES_GRID_CLASS_NAME: string =
  "grid grid-cols-1 gap-4 [@container(min-width:24rem)]:grid-cols-2 [@container(min-width:40rem)]:grid-cols-3";

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
export const COUNTING_SINCE_SESSIONS: string = translationKey(
  "Counting started on {{date}}. Sessions recorded before then are not in these numbers.",
);

/* The same note on the Events, Funnels and Retention pages, which count events. */
export const COUNTING_SINCE_EVENTS: string = translationKey(
  "Counting started on {{date}}. Events sent before then are not in these numbers.",
);

export const ProductAnalyticsCountingSince: FunctionComponent<{
  dataStartedAt: number | null;
  startTime: Date;
  // The sentence, with {{date}}; part one's sessions sentence when left out.
  template?: string | undefined;
}> = (props: {
  dataStartedAt: number | null;
  startTime: Date;
  template?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (
    props.dataStartedAt === null ||
    props.dataStartedAt <= props.startTime.getTime()
  ) {
    return <></>;
  }

  /* A note on the numbers, set apart from the card's description above it. */
  return (
    <div
      className="flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600 ring-1 ring-inset ring-gray-200"
      data-testid="product-analytics-counting-since"
    >
      <Icon
        icon={IconProp.Info}
        className="mt-0.5 h-4 w-4 flex-none text-gray-400"
      />
      <p>
        {translator.translateTemplate(
          props.template || COUNTING_SINCE_SESSIONS,
          {
            date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              new Date(props.dataStartedAt),
              true,
            ),
          },
        )}
      </p>
    </div>
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
          <span>
            {translator.translateText("How to install Session Replay")}
          </span>
        </AppLink>
      }
    />
  );
};
