import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DASHBOARD_PLAYLIST_MAX_DASHBOARDS,
  DashboardPlaylistDashboard,
  isSameDashboardId,
  readDashboardPlaylistDashboards,
} from "Common/Types/Dashboard/DashboardPlaylist";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  PlaylistListedDashboard,
  PlaylistReadableDashboard,
  addPlaylistDashboard,
  getPlaylistListedDashboards,
  movePlaylistDashboard,
  removePlaylistDashboard,
} from "./PlaylistDashboards";

/*
 * A playlist's dashboards, in the order they are shown (issue #5235): the
 * Dashboards field of the playlist's create and edit forms, bound to its
 * `dashboards` column (a CustomComponent field: one value, a list).
 *
 * The list on top, numbered, each with Move up, Move down and Remove; under
 * it a searchable picker of the project's dashboards that adds one at the
 * end. A dashboard the viewer cannot see - deleted, or out of their reach -
 * stays in the list, named as such, so saving the playlist never drops one
 * an editor with less access cannot see; it can still be removed.
 */

export const PLAYLIST_DASHBOARDS_FIELD_TEST_ID: string =
  "playlist-dashboards-field";

export interface ComponentProps {
  /*
   * The stored list. An untouched create form hands a CustomComponent "",
   * not a list (FormField), so it is read loosely.
   */
  initialValue?: Array<DashboardPlaylistDashboard> | string | undefined;
  onChange?: ((value: Array<DashboardPlaylistDashboard>) => void) | undefined;
  onBlur?: (() => void) | undefined;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  // For tests: the project's dashboards, instead of reading them.
  readDashboards?:
    | (() => Promise<Array<PlaylistReadableDashboard>>)
    | undefined;
}

// Every dashboard of the project the viewer may read, by name.
export const readProjectDashboards: () => Promise<
  Array<PlaylistReadableDashboard>
> = async (): Promise<Array<PlaylistReadableDashboard>> => {
  const result: ListResult<Dashboard> = await ModelAPI.getList<Dashboard>({
    modelType: Dashboard,
    query: {},
    select: {
      _id: true,
      name: true,
      isArchived: true,
    },
    limit: LIMIT_PER_PROJECT,
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

const iconButtonClassName: string =
  "rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400";

const PlaylistDashboardsField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [dashboards, setDashboards] = useState<
    Array<DashboardPlaylistDashboard>
  >(() => {
    return readDashboardPlaylistDashboards(props.initialValue);
  });

  const [available, setAvailable] = useState<Array<PlaylistReadableDashboard>>(
    [],
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");

  // Bumped after each pick, so the picker opens empty again.
  const [pickerKey, setPickerKey] = useState<number>(0);

  const readDashboardsRef: React.MutableRefObject<
    () => Promise<Array<PlaylistReadableDashboard>>
  > = useRef<() => Promise<Array<PlaylistReadableDashboard>>>(
    props.readDashboards || readProjectDashboards,
  );

  /*
   * The form learns a CustomComponent's value only when it reports one, and
   * checks only what it has learnt: told once, as the field opens, so a
   * create form left as it is asks for a dashboard instead of saving none.
   */
  const hasReportedInitialValue: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    if (hasReportedInitialValue.current) {
      return;
    }

    hasReportedInitialValue.current = true;
    props.onChange?.(dashboards);
  }, []);

  /*
   * The edit form draws the field first and reads the playlist after: its
   * list arrives once the field is on screen. Taken when it differs from
   * what the field holds - never when it is the field's own last change
   * coming back.
   */
  useEffect(() => {
    if (!Array.isArray(props.initialValue)) {
      return;
    }

    const incoming: Array<DashboardPlaylistDashboard> =
      readDashboardPlaylistDashboards(props.initialValue);

    if (JSON.stringify(incoming) === JSON.stringify(dashboards)) {
      return;
    }

    setDashboards(incoming);
  }, [props.initialValue]);

  useEffect(() => {
    let isCurrent: boolean = true;

    readDashboardsRef
      .current()
      .then((result: Array<PlaylistReadableDashboard>) => {
        if (isCurrent) {
          setAvailable(result);
          setIsLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setLoadError(API.getFriendlyErrorMessage(error as Error));
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const update: (next: Array<DashboardPlaylistDashboard>) => void = (
    next: Array<DashboardPlaylistDashboard>,
  ): void => {
    setDashboards(next);
    props.onChange?.(next);
  };

  const listed: Array<PlaylistListedDashboard> = getPlaylistListedDashboards({
    dashboards: dashboards,
    readable: available,
  });

  // The dashboards that can be added: not archived, and not in the list yet.
  const pickable: Array<DropdownOption> = available
    .filter((dashboard: PlaylistReadableDashboard): boolean => {
      return (
        !dashboard.isArchived &&
        !dashboards.some((entry: DashboardPlaylistDashboard): boolean => {
          return isSameDashboardId(entry.dashboardId, dashboard.id);
        })
      );
    })
    .map((dashboard: PlaylistReadableDashboard): DropdownOption => {
      return {
        value: dashboard.id,
        label:
          dashboard.name ||
          translator.translateText("Untitled dashboard") ||
          "",
        isUserContent: true,
      };
    });

  const isFull: boolean =
    dashboards.length >= DASHBOARD_PLAYLIST_MAX_DASHBOARDS;

  const getName: (item: PlaylistListedDashboard) => string = (
    item: PlaylistListedDashboard,
  ): string => {
    if (item.name === null) {
      return translator.translateText("Dashboard not available") || "";
    }

    return item.name || translator.translateText("Untitled dashboard") || "";
  };

  const getPickerPlaceholder: () => string = (): string => {
    if (isLoading) {
      return translator.translateText("Loading dashboards...") || "";
    }

    if (isFull) {
      return (
        translator.translateTemplate(
          "A playlist shows at most {{count}} dashboards",
          { count: translator.formatNumber(DASHBOARD_PLAYLIST_MAX_DASHBOARDS) },
        ) || ""
      );
    }

    if (available.length === 0) {
      return (
        translator.translateText("This project has no dashboards yet") || ""
      );
    }

    if (pickable.length === 0) {
      return translator.translateText("Every dashboard is in the list") || "";
    }

    return translator.translateText("Add a dashboard...") || "";
  };

  return (
    <div
      className="space-y-2"
      data-testid={PLAYLIST_DASHBOARDS_FIELD_TEST_ID}
      onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
        // Touched once the focus leaves the field, not while it moves inside it.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          props.onBlur?.();
        }
      }}
    >
      {listed.length === 0 ? (
        <p
          className="rounded-lg border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-500"
          data-testid="playlist-dashboards-empty"
        >
          {translator.translateText(
            "No dashboards yet. Add the first one below.",
          )}
        </p>
      ) : (
        <ol
          className="divide-y divide-gray-100 rounded-lg border border-gray-200"
          aria-labelledby={props.ariaLabelledby}
          aria-describedby={props.ariaDescribedby}
          data-testid="playlist-dashboards-list"
        >
          {listed.map(
            (item: PlaylistListedDashboard, index: number): ReactElement => {
              const name: string = getName(item);

              return (
                <li
                  key={item.key}
                  className="flex items-center gap-3 px-3 py-2"
                  data-testid={`playlist-dashboard-${index}`}
                >
                  <span
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gray-100 text-xs font-medium tabular-nums text-gray-600"
                    aria-hidden="true"
                  >
                    {translator.formatNumber(index + 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm font-medium ${
                        item.name === null ? "text-gray-500" : "text-gray-900"
                      }`}
                    >
                      <IsolatedText text={name} />
                    </p>
                    {item.name === null ? (
                      <p className="text-xs text-gray-500">
                        {translator.translateText(
                          "Deleted, or you do not have access to it. The player skips it.",
                        )}
                      </p>
                    ) : (
                      <></>
                    )}
                    {item.name !== null && item.isArchived ? (
                      <p className="text-xs text-gray-500">
                        {translator.translateText(
                          "Archived. The player skips it until it is unarchived.",
                        )}
                      </p>
                    ) : (
                      <></>
                    )}
                  </div>
                  <div className="flex flex-none items-center">
                    <button
                      type="button"
                      className={iconButtonClassName}
                      aria-label={translator.translateTemplate(
                        "Move {{name}} up",
                        { name: name },
                      )}
                      title={translator.translateText("Move up")}
                      disabled={index === 0}
                      data-testid={`playlist-dashboard-move-up-${index}`}
                      onClick={() => {
                        update(
                          movePlaylistDashboard(dashboards, index, index - 1),
                        );
                      }}
                    >
                      <Icon icon={IconProp.ChevronUp} className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className={iconButtonClassName}
                      aria-label={translator.translateTemplate(
                        "Move {{name}} down",
                        { name: name },
                      )}
                      title={translator.translateText("Move down")}
                      disabled={index === listed.length - 1}
                      data-testid={`playlist-dashboard-move-down-${index}`}
                      onClick={() => {
                        update(
                          movePlaylistDashboard(dashboards, index, index + 1),
                        );
                      }}
                    >
                      <Icon icon={IconProp.ChevronDown} className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className={iconButtonClassName}
                      aria-label={translator.translateTemplate(
                        "Remove {{name}}",
                        { name: name },
                      )}
                      title={translator.translateText("Remove")}
                      data-testid={`playlist-dashboard-remove-${index}`}
                      onClick={() => {
                        update(removePlaylistDashboard(dashboards, index));
                      }}
                    >
                      <Icon icon={IconProp.Close} className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            },
          )}
        </ol>
      )}

      <Dropdown
        key={pickerKey}
        options={pickable}
        placeholder={getPickerPlaceholder()}
        ariaLabel={translator.translateText("Add a dashboard")}
        dataTestId="playlist-dashboards-picker"
        disabled={isLoading || isFull || pickable.length === 0}
        isClearable={false}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (typeof value !== "string" || isFull) {
            return;
          }

          update(addPlaylistDashboard(dashboards, value));
          setPickerKey((key: number) => {
            return key + 1;
          });
        }}
      />

      {loadError ? (
        <p className="text-sm text-red-600" role="alert">
          {loadError}
        </p>
      ) : (
        <></>
      )}

      {props.error ? (
        <p
          data-testid="error-message"
          className="text-sm text-red-400"
          role="alert"
        >
          {props.error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default PlaylistDashboardsField;
