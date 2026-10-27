import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardPlaylist from "Common/Models/DatabaseModels/DashboardPlaylist";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  readDashboardPlaylistDashboards,
  readDashboardPlaylistIntervalInSeconds,
} from "Common/Types/Dashboard/DashboardPlaylist";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import PlaylistDashboardList from "../../../Components/Dashboard/Playlist/PlaylistDashboardList";
import { formatPlaylistInterval } from "../../../Components/Dashboard/Playlist/PlaylistDashboards";
import { getPlaylistFormFields } from "./PlaylistFormFields";
import { getPlaylistPlayRoute } from "./Playlists";

/*
 * A playlist's page (issue #5235): Play first, then what it plays - its
 * dashboards in order and how long each is shown - with Edit Playlist, the
 * player's own address to open on a screen, and Delete.
 */

// The player's full address, to open on the screen that shows the playlist.
export function getPlaylistPlayerLink(playlistId: ObjectID): string {
  const route: Route = getPlaylistPlayRoute(playlistId);

  if (typeof window === "undefined") {
    return route.toString();
  }

  return URL.fromString(window.location.origin)
    .addRoute(route.toString())
    .toString();
}

const PlaylistView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  // The playlist's own interval, which its Edit dialog offers among the choices.
  const [intervalInSeconds, setIntervalInSeconds] = useState<number | null>(
    null,
  );

  return (
    <Fragment>
      <CardModelDetail<DashboardPlaylist>
        name="Dashboards > Playlists > Playlist"
        cardProps={{
          title: "Playlist",
          description:
            "Its dashboards are shown one after another, each for the same time. Press Play on the screen that shows them.",
          buttons: [
            {
              title: "Play",
              icon: IconProp.Play,
              buttonStyle: ButtonStyleType.PRIMARY,
              onClick: () => {
                Navigation.navigate(getPlaylistPlayRoute(modelId));
              },
            },
          ],
        }}
        isEditable={true}
        editButtonText="Edit Playlist"
        editModalTitle="Edit Playlist"
        formFields={getPlaylistFormFields({
          language: translator.language,
          currentIntervalInSeconds: intervalInSeconds,
        })}
        modelDetailProps={{
          modelType: DashboardPlaylist,
          id: "model-detail-dashboard-playlist",
          modelId: modelId,
          showDetailsInNumberOfColumns: 2,
          onItemLoaded: (item: DashboardPlaylist) => {
            setIntervalInSeconds(
              readDashboardPlaylistIntervalInSeconds(item.intervalInSeconds),
            );
          },
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                intervalInSeconds: true,
              },
              title: "Show each dashboard for",
              fieldType: FieldType.Element,
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
            {
              field: {
                dashboards: true,
              },
              title: "Dashboards",
              fieldType: FieldType.Element,
              getElement: (item: DashboardPlaylist): ReactElement => {
                return (
                  <PlaylistDashboardList
                    dashboards={readDashboardPlaylistDashboards(
                      item.dashboards,
                    )}
                  />
                );
              },
            },
            {
              field: {
                _id: true,
              },
              title: "Player link",
              description: "Open it on the screen that shows the playlist.",
              fieldType: FieldType.Element,
              getElement: (): ReactElement => {
                const link: string = getPlaylistPlayerLink(modelId);

                return (
                  <div className="flex min-w-0 items-center gap-2">
                    <code
                      className="min-w-0 truncate text-xs text-gray-600"
                      dir="ltr"
                      title={link}
                      data-testid="playlist-player-link"
                    >
                      {link}
                    </code>
                    <CopyTextButton textToBeCopied={link} />
                  </div>
                );
              },
            },
          ],
        }}
      />

      <ModelDelete
        modelType={DashboardPlaylist}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_PLAYLISTS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default PlaylistView;
