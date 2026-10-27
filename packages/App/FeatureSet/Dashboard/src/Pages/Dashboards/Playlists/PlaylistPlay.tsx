import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { useParams } from "react-router-dom";
import PlaylistPlayer from "../../../Components/Dashboard/Playlist/PlaylistPlayer";

/*
 * A playlist playing (issue #5235), at its own address - the one to open
 * on the screen that shows it, or to bookmark there. Over the whole window,
 * with no page around it: PlaylistPlayer draws above the Dashboard's header
 * and menus. Exit goes back to the playlist's page.
 */
const PlaylistPlay: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const playlistId: ObjectID = new ObjectID(id || "");

  return (
    <PlaylistPlayer
      playlistId={playlistId}
      onExit={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.DASHBOARD_PLAYLIST_VIEW] as Route,
            { modelId: playlistId },
          ),
        );
      }}
      onOpenPlaylist={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.DASHBOARD_PLAYLIST_VIEW] as Route,
            { modelId: playlistId },
          ),
        );
      }}
      onOpenPlaylists={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.DASHBOARD_PLAYLISTS] as Route,
          ),
        );
      }}
    />
  );
};

export default PlaylistPlay;
