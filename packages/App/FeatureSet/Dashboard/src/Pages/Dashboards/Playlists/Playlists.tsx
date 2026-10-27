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
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import { formatPlaylistInterval } from "../../../Components/Dashboard/Playlist/PlaylistDashboards";
import { getPlaylistFormFields } from "./PlaylistFormFields";

/*
 * Dashboards → Playlists (issue #5235): the project's playlists - each a
 * set of dashboards a screen shows one after another, each for the same
 * time. Play is each row's button; a row opens the playlist's page, where
 * it is changed and deleted.
 */

export function getPlaylistPlayRoute(playlistId: ObjectID): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DASHBOARD_PLAYLIST_PLAY] as Route,
    { modelId: playlistId },
  );
}

const Playlists: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();

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
          "Dashboards shown one after another on a screen, such as a NOC wall. Pick them and how long each is shown, then press Play.",
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
          type: FieldType.Text,
        },
        {
          field: {
            dashboards: true,
          },
          title: "Dashboards",
          type: FieldType.Element,
          disableSort: true,
          getElement: (item: DashboardPlaylist): ReactElement => {
            const count: number = readDashboardPlaylistDashboards(
              item.dashboards,
            ).length;

            return (
              <span data-testid="playlist-dashboard-count">
                {translator.translatePlural(
                  {
                    one: "{{count}} dashboard",
                    other: "{{count}} dashboards",
                  },
                  count,
                )}
              </span>
            );
          },
        },
        {
          field: {
            intervalInSeconds: true,
          },
          title: "Show each dashboard for",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DashboardPlaylist): ReactElement => {
            return (
              <span data-testid="playlist-interval">
                {formatPlaylistInterval(
                  readDashboardPlaylistIntervalInSeconds(
                    item.intervalInSeconds,
                  ),
                  translator.language,
                )}
              </span>
            );
          },
        },
      ]}
    />
  );
};

export default Playlists;
