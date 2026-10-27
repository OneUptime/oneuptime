import Route from "Common/Types/API/Route";
import { DashboardPlaylistDashboard } from "Common/Types/Dashboard/DashboardPlaylist";
import ObjectID from "Common/Types/ObjectID";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  PlaylistListedDashboard,
  PlaylistReadableDashboard,
  getPlaylistListedDashboards,
} from "./PlaylistDashboards";
import { readPlaylistDashboards } from "./PlaylistRead";

/*
 * A playlist's dashboards on its page (issue #5235), in the order they are
 * shown: numbered, each a link to the dashboard. One the viewer cannot see -
 * deleted, or out of their reach - or one that is archived is listed as
 * such, so it is plain why the player skips it.
 */

export const PLAYLIST_DASHBOARD_LIST_TEST_ID: string =
  "playlist-dashboard-list";

export interface ComponentProps {
  dashboards: Array<DashboardPlaylistDashboard>;
  // For tests: the dashboards the viewer may read, instead of reading them.
  readDashboards?:
    | ((
        dashboards: Array<DashboardPlaylistDashboard>,
      ) => Promise<Array<PlaylistReadableDashboard>>)
    | undefined;
}

const PlaylistDashboardList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [readable, setReadable] = useState<Array<PlaylistReadableDashboard>>(
    [],
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const readDashboardsRef: React.MutableRefObject<
    (
      dashboards: Array<DashboardPlaylistDashboard>,
    ) => Promise<Array<PlaylistReadableDashboard>>
  > = useRef(props.readDashboards || readPlaylistDashboards);

  const dashboardsKey: string = JSON.stringify(props.dashboards);

  useEffect(() => {
    let isCurrent: boolean = true;

    setIsLoading(true);
    setError("");

    readDashboardsRef
      .current(props.dashboards)
      .then((result: Array<PlaylistReadableDashboard>) => {
        if (isCurrent) {
          setReadable(result);
          setIsLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyErrorMessage(caught as Error));
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [dashboardsKey]);

  if (props.dashboards.length === 0) {
    return (
      <p
        className="text-sm text-gray-500"
        data-testid={`${PLAYLIST_DASHBOARD_LIST_TEST_ID}-empty`}
      >
        {translator.translateText(
          "No dashboards yet. Edit the playlist to add them.",
        )}
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {error}
      </p>
    );
  }

  const listed: Array<PlaylistListedDashboard> = getPlaylistListedDashboards({
    dashboards: props.dashboards,
    readable: readable,
  });

  return (
    <ol
      className="space-y-1.5"
      data-testid={PLAYLIST_DASHBOARD_LIST_TEST_ID}
      aria-busy={isLoading ? true : undefined}
    >
      {listed.map(
        (item: PlaylistListedDashboard, index: number): ReactElement => {
          const isAvailable: boolean = item.name !== null;

          return (
            <li
              key={item.key}
              className="flex min-w-0 items-start gap-2.5 text-sm"
              data-testid={`${PLAYLIST_DASHBOARD_LIST_TEST_ID}-item`}
            >
              <span
                className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full bg-gray-100 text-xs font-medium tabular-nums text-gray-600"
                aria-hidden="true"
              >
                {translator.formatNumber(index + 1)}
              </span>
              <div className="min-w-0">
                {isLoading ? (
                  <span className="text-gray-400">
                    {translator.translateText("Loading...")}
                  </span>
                ) : isAvailable ? (
                  <Link
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.DASHBOARD_VIEW] as Route,
                      { modelId: new ObjectID(item.dashboardId) },
                    )}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    <IsolatedText text={item.name || ""} />
                  </Link>
                ) : (
                  <span className="text-gray-500">
                    {translator.translateText("Dashboard not available")}
                  </span>
                )}
                {!isLoading && !isAvailable ? (
                  <p className="text-xs text-gray-500">
                    {translator.translateText(
                      "Deleted, or you do not have access to it. The player skips it.",
                    )}
                  </p>
                ) : (
                  <></>
                )}
                {!isLoading && isAvailable && item.isArchived ? (
                  <p className="text-xs text-gray-500">
                    {translator.translateText(
                      "Archived. The player skips it until it is unarchived.",
                    )}
                  </p>
                ) : (
                  <></>
                )}
              </div>
            </li>
          );
        },
      )}
    </ol>
  );
};

export default PlaylistDashboardList;
