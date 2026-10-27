import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardPlaylist from "Common/Models/DatabaseModels/DashboardPlaylist";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DashboardPlaylistDashboard,
  readDashboardPlaylistDashboards,
  readDashboardPlaylistIntervalInSeconds,
} from "Common/Types/Dashboard/DashboardPlaylist";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  PlaylistReadableDashboard,
  getPlaylistDashboardIds,
  getPlaylistEntries,
} from "./PlaylistDashboards";
import { PlaylistRound } from "./PlaylistPlayerState";

/*
 * The playlist pages' and the player's reads (issue #5235), through the API
 * as the signed-in viewer: what the API answers is what they may see. A
 * dashboard of the playlist the viewer may not read is not in the answer,
 * and a deleted one neither, so neither is shown.
 */

/*
 * The playlist's dashboards the viewer may read, archived ones included
 * (the pages say they are archived; the player skips them). One read, for
 * all of them.
 */
export const readPlaylistDashboards: (
  dashboards: ReadonlyArray<DashboardPlaylistDashboard>,
) => Promise<Array<PlaylistReadableDashboard>> = async (
  dashboards: ReadonlyArray<DashboardPlaylistDashboard>,
): Promise<Array<PlaylistReadableDashboard>> => {
  const ids: Array<string> = getPlaylistDashboardIds(dashboards);

  if (ids.length === 0) {
    return [];
  }

  const result: ListResult<Dashboard> = await ModelAPI.getList<Dashboard>({
    modelType: Dashboard,
    query: {
      _id: new Includes(
        ids.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
      ),
    },
    select: {
      _id: true,
      name: true,
      isArchived: true,
    },
    limit: ids.length,
    skip: 0,
    sort: {
      name: SortOrder.Ascending,
    },
  });

  return result.data
    .filter((dashboard: Dashboard): boolean => {
      return Boolean(dashboard._id);
    })
    .map((dashboard: Dashboard): PlaylistReadableDashboard => {
      return {
        id: dashboard._id!.toString(),
        name: dashboard.name || "",
        isArchived: Boolean(dashboard.isArchived),
      };
    });
};

/*
 * The playlist as one round of the player: its name, its interval, and its
 * dashboards the viewer may read and that are not archived, in its order.
 * Null when the playlist is not found - deleted, or not the viewer's to
 * read.
 */
export const readPlaylistRound: (
  playlistId: ObjectID,
) => Promise<PlaylistRound | null> = async (
  playlistId: ObjectID,
): Promise<PlaylistRound | null> => {
  const playlist: DashboardPlaylist | null =
    await ModelAPI.getItem<DashboardPlaylist>({
      modelType: DashboardPlaylist,
      id: playlistId,
      select: {
        name: true,
        dashboards: true,
        intervalInSeconds: true,
      },
    });

  if (!playlist) {
    return null;
  }

  const dashboards: Array<DashboardPlaylistDashboard> =
    readDashboardPlaylistDashboards(playlist.dashboards);

  const readable: Array<PlaylistReadableDashboard> =
    await readPlaylistDashboards(dashboards);

  return {
    name: playlist.name || "",
    intervalInSeconds: readDashboardPlaylistIntervalInSeconds(
      playlist.intervalInSeconds,
    ),
    entries: getPlaylistEntries({
      dashboards: dashboards,
      readable: readable,
    }),
  };
};
