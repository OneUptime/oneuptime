import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardPlaylist from "Common/Models/DatabaseModels/DashboardPlaylist";
import Route from "Common/Types/API/Route";
import {
  readDashboardPlaylistDashboards,
  readDashboardPlaylistIntervalInSeconds,
} from "Common/Types/Dashboard/DashboardPlaylist";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { useAreTableColumnsFolded } from "Common/UI/Components/Table/TableCellContext";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import { getPlaylistSummary } from "../../../Components/Dashboard/Playlist/PlaylistDashboards";
import { getPlaylistFormFields } from "./PlaylistFormFields";

/*
 * Dashboards → Playlists (issue #5235): the project's playlists - each a
 * set of dashboards a screen shows one after another, each for the same
 * time. Play is each row's button; a row opens the playlist's page, where
 * it is changed and deleted.
 */

/*
 * A playlist's name in its row. Below lg, where the Dashboards column is
 * left out (hideBelowLargeScreen), what it plays goes under the name - on a
 * tablet's row beside the side menu and on a phone's card alike - so the
 * row says it once, and never under the Play buttons.
 */
export const PlaylistNameCell: FunctionComponent<{
  name: string;
  summary: string;
  hasDashboards: boolean;
}> = (props: {
  name: string;
  summary: string;
  hasDashboards: boolean;
}): ReactElement => {
  const isSummaryFolded: boolean = useAreTableColumnsFolded();

  if (!isSummaryFolded) {
    return <>{props.name}</>;
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-0.5">
      <span className="truncate">{props.name}</span>
      {/*
       * Wraps - in two even lines - rather than ending in "...": on a
       * tablet beside the side menu the name's cell is about 200px wide.
       */}
      <span
        className={`whitespace-normal text-balance text-sm font-normal ${
          props.hasDashboards ? "text-gray-600" : "text-gray-500"
        }`}
        data-testid="playlist-summary"
      >
        {props.summary}
      </span>
    </div>
  );
};

export function getPlaylistPlayRoute(playlistId: ObjectID): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DASHBOARD_PLAYLIST_PLAY] as Route,
    { modelId: playlistId },
  );
}

const Playlists: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();

  const hasDashboards: (item: DashboardPlaylist) => boolean = (
    item: DashboardPlaylist,
  ): boolean => {
    return readDashboardPlaylistDashboards(item.dashboards).length > 0;
  };

  // "3 dashboards, 1 minute each", in the reader's language.
  const getSummary: (item: DashboardPlaylist) => string = (
    item: DashboardPlaylist,
  ): string => {
    return getPlaylistSummary({
      translator: translator,
      dashboardCount: readDashboardPlaylistDashboards(item.dashboards).length,
      intervalInSeconds: readDashboardPlaylistIntervalInSeconds(
        item.intervalInSeconds,
      ),
    });
  };

  return (
    <ModelTable<DashboardPlaylist>
      modelType={DashboardPlaylist}
      id="dashboard-playlists-table"
      userPreferencesKey="dashboard-playlists-table"
      name="Dashboards > Playlists"
      singularName="Playlist"
      pluralName="Playlists"
      isDeleteable={true}
      isEditable={false}
      isCreateable={true}
      isViewable={true}
      cardProps={{
        title: "Playlists",
        description:
          "Dashboards shown one after another on a screen, such as a NOC wall, each for the time you choose.",
      }}
      noItemsMessage="No playlists yet. Create one to show your dashboards one after another on a screen."
      viewPageRoute={Navigation.getCurrentRoute()}
      showRefreshButton={true}
      searchableFields={["name"]}
      saveFilterProps={{
        tableId: "dashboard-playlists-table",
      }}
      formFields={getPlaylistFormFields({ language: translator.language })}
      actionButtons={[
        {
          title: "Play",
          icon: IconProp.Play,
          buttonStyleType: ButtonStyleType.NORMAL,
          placement: ActionButtonPlacement.Primary,
          onClick: (
            item: DashboardPlaylist,
            onCompleteAction: VoidFunction,
          ): void => {
            onCompleteAction();

            if (item._id) {
              Navigation.navigate(
                getPlaylistPlayRoute(new ObjectID(item._id.toString())),
              );
            }
          },
        },
      ]}
      filters={[
        {
          field: {
            name: true,
          },
          title: "Name",
          type: FieldType.Text,
        },
      ]}
      columns={[
        {
          field: {
            name: true,
          },
          title: "Name",
          type: FieldType.Element,
          // A phone's card is about the playlist: its name needs no label.
          hideTitleOnMobile: true,
          getExportValue: (item: DashboardPlaylist): string => {
            return item.name || "";
          },
          getElement: (item: DashboardPlaylist): ReactElement => {
            return (
              <PlaylistNameCell
                name={item.name || ""}
                summary={getSummary(item)}
                hasDashboards={hasDashboards(item)}
              />
            );
          },
        },
        /*
         * What the playlist plays, in one phrase: "3 dashboards, 1 minute
         * each" - one column rather than a count and a time side by side.
         * Below lg it folds under the name (PlaylistNameCell): beside the
         * side menu a tablet's card is too narrow for both, and the phrase
         * ran under the sticky Play buttons.
         */
        {
          field: {
            dashboards: true,
            intervalInSeconds: true,
          },
          title: "Dashboards",
          type: FieldType.Element,
          disableSort: true,
          hideBelowLargeScreen: true,
          getExportValue: (item: DashboardPlaylist): string => {
            return getSummary(item);
          },
          getElement: (item: DashboardPlaylist): ReactElement => {
            return (
              <span
                className={hasDashboards(item) ? undefined : "text-gray-500"}
                data-testid="playlist-summary"
              >
                {getSummary(item)}
              </span>
            );
          },
        },
      ]}
    />
  );
};

export default Playlists;
