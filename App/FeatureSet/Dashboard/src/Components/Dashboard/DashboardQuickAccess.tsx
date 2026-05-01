/**
 * Quick-access strip rendered above the dashboards list — shows pinned
 * favorites and recently visited dashboards. Reads from localStorage so
 * there's no extra server round-trip; falls back gracefully when storage
 * is unavailable (incognito, private mode).
 */
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import DashboardLocalPreferences, {
  RecentEntry,
} from "Common/Utils/Dashboard/DashboardLocalPreferences";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

interface FavoriteEntry {
  id: string;
  name: string;
  description?: string | undefined;
}

const DashboardQuickAccess: FunctionComponent = (): ReactElement | null => {
  const [favorites, setFavorites] = useState<Array<FavoriteEntry>>([]);
  const [recent, setRecent] = useState<Array<RecentEntry>>([]);

  useEffect(() => {
    setRecent(DashboardLocalPreferences.getRecent());
    const ids: Array<string> = DashboardLocalPreferences.getFavorites();
    if (ids.length === 0) {
      setFavorites([]);
      return;
    }
    const fetchFavorites: PromiseVoidFunction = async (): Promise<void> => {
      try {
        const objectIds: Array<ObjectID> = ids.map((id: string) => {
          return new ObjectID(id);
        });
        const result: ListResult<Dashboard> = await ModelAPI.getList<Dashboard>(
          {
            modelType: Dashboard,
            query: { _id: new Includes(objectIds) } as Query<Dashboard>,
            limit: ids.length,
            skip: 0,
            select: { _id: true, name: true, description: true } as never,
            sort: { name: 1 } as never,
            requestOptions: {},
          },
        );
        setFavorites(
          result.data.map((d: Dashboard): FavoriteEntry => {
            return {
              id: d._id?.toString() || "",
              name: d.name || "(unnamed)",
              description: d.description,
            };
          }),
        );
      } catch {
        /*
         * Non-fatal — just don't show the favorites strip if the fetch
         * fails. A favorited dashboard that's been deleted will silently
         * disappear; that's the right behavior.
         */
        setFavorites([]);
      }
    };
    fetchFavorites().catch(() => {
      setFavorites([]);
    });
  }, []);

  if (favorites.length === 0 && recent.length === 0) {
    return null;
  }

  const navigateTo: (id: string) => void = (id: string): void => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[PageMap.DASHBOARD_VIEW] as Route, {
        modelId: new ObjectID(id),
      }),
    );
  };

  return (
    <div className="mb-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
      {favorites.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-200/60 p-3 shadow-sm">
          <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <Icon icon={IconProp.Star} className="w-3.5 h-3.5 text-amber-500" />
            <span>Favorites</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {favorites.map((f: FavoriteEntry) => {
              return (
                <button
                  type="button"
                  key={f.id}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-200/60 hover:bg-amber-50 hover:border-amber-200 transition-colors cursor-pointer"
                  onClick={() => {
                    navigateTo(f.id);
                  }}
                  title={f.description || f.name}
                >
                  <Icon
                    icon={IconProp.Star}
                    className="w-3 h-3 text-amber-500"
                  />
                  <span className="text-xs text-gray-700 truncate max-w-[14rem]">
                    {f.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-200/60 p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <Icon
                icon={IconProp.Clock}
                className="w-3.5 h-3.5 text-indigo-500"
              />
              <span>Recently Viewed</span>
            </div>
            <button
              type="button"
              className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-wider"
              onClick={() => {
                DashboardLocalPreferences.clearRecent();
                setRecent([]);
              }}
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((r: RecentEntry) => {
              return (
                <button
                  type="button"
                  key={r.id}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-200/60 hover:bg-indigo-50 hover:border-indigo-200 transition-colors cursor-pointer"
                  onClick={() => {
                    navigateTo(r.id);
                  }}
                  title={r.name}
                >
                  <Icon
                    icon={IconProp.Clock}
                    className="w-3 h-3 text-indigo-400"
                  />
                  <span className="text-xs text-gray-700 truncate max-w-[14rem]">
                    {r.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardQuickAccess;
