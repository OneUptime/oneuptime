import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import Navigation from "Common/UI/Utils/Navigation";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { getRefreshButton } from "Common/UI/Components/Card/CardButtons/Refresh";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SessionReplayUsersTable from "../../../Components/SessionReplay/SessionReplayUsersTable";
import {
  buildHandedOffUserFilterLabel,
  buildTimeRangeSearch,
  buildUserFilterLabelStorageKey,
  buildUserSessionsListSearch,
  buildUsersPageUrl,
  HandedOffUserFilterLabel,
  readTimeRangeFromSearch,
  SessionReplayUserSessionsHandoff,
} from "../../../Components/SessionReplay/SessionReplayListFilters";

/*
 * The Users page: the session window rolled up by person, on its own route
 * beside the session list. It used to be a Sessions | Users toggle on the
 * list; a customer asked for two pages, and two pages is also what the
 * side menu, the breadcrumb and a bookmark can name.
 *
 * The page owns exactly one piece of state the list also has - the time
 * range - and mirrors it into the URL with the list's own keys, so a link
 * into either page opens the other on the same window. Everything else the
 * list carries (search, sort, filters, paging) has no meaning for the
 * rollup and is not read here.
 */

function writeStorage(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* Private mode or a full store: the list falls back to the digest chip. */
  }
}

const RumApplicationSessionReplayUsers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route is ":id/session-replay-users", so the model id is one segment
   * before the end. Same as Pages/Rum/View/SessionReplayAudit.tsx.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const rumApplicationId: string = modelId.toString();

  /*
   * Read once per mount: every later URL write comes from this page, so
   * re-reading the address bar would only echo our own state back.
   */
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    (): RangeStartAndEndDateTime => {
      return readTimeRangeFromSearch(window.location.search);
    },
  );
  const [reloadToken, setReloadToken] = useState<number>(0);

  /* The window is the page's whole URL state; defaults are written as absence. */
  useEffect((): void => {
    window.history.replaceState(
      window.history.state,
      "",
      buildUsersPageUrl(window.location.href, timeRange),
    );
  }, [timeRange]);

  const listRoute: Route = useMemo((): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY] as Route,
      { modelId: new ObjectID(rumApplicationId) },
    );
  }, [rumApplicationId]);

  /*
   * "Every session from this person", answered by the list. The digest or
   * visitor id goes in the query string; a readable label is parked in
   * sessionStorage for the list to swap in, because the label names the
   * customer's end user and a query string reaches proxy logs and history
   * (see FILTER_URL_KEYS). The time range rides along so the list opens on
   * the window the person was counted in.
   */
  const viewUserSessions: (handoff: SessionReplayUserSessionsHandoff) => void =
    useCallback(
      (handoff: SessionReplayUserSessionsHandoff): void => {
        const label: HandedOffUserFilterLabel | null =
          buildHandedOffUserFilterLabel(handoff);

        if (label) {
          writeStorage(
            buildUserFilterLabelStorageKey(rumApplicationId),
            JSON.stringify(label),
          );
        }

        Navigation.navigate(
          new Route(
            `${listRoute.toString()}${buildUserSessionsListSearch(
              handoff,
              timeRange,
            )}`,
          ),
        );
      },
      [rumApplicationId, listRoute, timeRange],
    );

  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "Sessions",
      icon: IconProp.Film,
      buttonStyle: ButtonStyleType.NORMAL,
      /* The list on this window and no filter; the default window as absence. */
      onClick: (): void => {
        Navigation.navigate(
          new Route(
            `${listRoute.toString()}${buildTimeRangeSearch(timeRange)}`,
          ),
        );
      },
    },
    {
      ...getRefreshButton(),
      tooltip: "Refresh users",
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: (): void => {
        setReloadToken((token: number): number => {
          return token + 1;
        });
      },
    },
  ];

  return (
    <Fragment>
      <Card
        title="Users"
        description="Everyone who recorded a session in this range, one row per person: identified users by the reference your page supplied, anonymous visitors by browser."
        buttons={cardButtons}
      >
        <div>
          <div
            className="mb-3 flex flex-wrap items-center gap-2"
            data-testid="session-users-toolbar"
          >
            <TelemetryTimeRangePicker
              value={timeRange}
              onChange={setTimeRange}
            />
          </div>

          <SessionReplayUsersTable
            rumApplicationId={rumApplicationId}
            timeRange={timeRange}
            reloadToken={reloadToken}
            onViewUserSessions={viewUserSessions}
          />
        </div>
      </Card>
    </Fragment>
  );
};

export default RumApplicationSessionReplayUsers;
