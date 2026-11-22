import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import {
  DASHBOARD_PLAYLIST_MAX_DASHBOARDS,
  DashboardPlaylistDashboard,
  isSameDashboardId,
  readDashboardPlaylistDashboards,
} from "Common/Types/Dashboard/DashboardPlaylist";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { DropdownChange } from "Common/UI/Components/Dropdown/DropdownChange";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
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
  getAddablePlaylistDashboardsQuery,
  getNothingToAddText,
  getPlaylistDashboardIds,
  getPlaylistListedDashboards,
  movePlaylistDashboard,
  removePlaylistDashboard,
} from "./PlaylistDashboards";
import { readPlaylistDashboards } from "./PlaylistRead";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

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
  /*
   * For tests: the list's dashboards as the viewer may read them, instead
   * of readPlaylistDashboards, and the API the picker searches and counts
   * the dashboards it could add with.
   */
  readDashboards?:
    | ((
        dashboards: ReadonlyArray<DashboardPlaylistDashboard>,
      ) => Promise<Array<PlaylistReadableDashboard>>)
    | undefined;
  modelAPI?: typeof ModelAPI | undefined;
}

/*
 * A row's Move up, Move down and Remove. Grey-500 at rest: an icon that is
 * the only sign of a control needs 3:1 against the white row (WCAG 1.4.11),
 * which grey-400 is not. One that can't be pressed (the first row's Move
 * up) looks locked as every button does - faded, with no hover colour at
 * all, rather than a disabled:hover: one the dark theme has no rule for.
 */
function getIconButtonClassName(isDisabled: boolean): string {
  return `rounded-md p-1.5 text-gray-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${getHandDrawnButtonStateClassName(
    {
      isLocked: isDisabled,
      hoverClassName: "hover:bg-gray-100 hover:text-gray-700",
    },
  )}`;
}

const PlaylistDashboardsField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [dashboards, setDashboards] = useState<
    Array<DashboardPlaylistDashboard>
  >(() => {
    return readDashboardPlaylistDashboards(props.initialValue);
  });

  // The list's dashboards as the viewer may read them, by their ids.
  const [readable, setReadable] = useState<Array<PlaylistReadableDashboard>>(
    [],
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  /*
   * How many dashboards could still be added (getAddablePlaylistDashboardsQuery),
   * counted on the server as the list changes: none says why in the picker.
   * Null until counted, or when the count fails (the picker stays open).
   */
  const [addableCount, setAddableCount] = useState<number | null>(null);

  // Bumped after each pick, so the picker opens empty again.
  const [pickerKey, setPickerKey] = useState<number>(0);

  const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

  const readDashboardsRef: React.MutableRefObject<
    (
      dashboards: ReadonlyArray<DashboardPlaylistDashboard>,
    ) => Promise<Array<PlaylistReadableDashboard>>
  > = useRef<
    (
      dashboards: ReadonlyArray<DashboardPlaylistDashboard>,
    ) => Promise<Array<PlaylistReadableDashboard>>
  >(props.readDashboards || readPlaylistDashboards);

  // Which dashboards the list holds, once each: what is read and counted again.
  const listedIdsKey: string = getPlaylistDashboardIds(dashboards)
    .map((id: string): string => {
      return id.toLowerCase();
    })
    .sort()
    .join(",");

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

  /*
   * The list's dashboards, named by their ids as the viewer may read them -
   * deleted or out of their reach, one is named as such - read again when
   * the list holds another dashboard.
   */
  useEffect(() => {
    let isCurrent: boolean = true;

    readDashboardsRef
      .current(dashboards)
      .then((result: Array<PlaylistReadableDashboard>) => {
        if (isCurrent) {
          setReadable(result);
          setLoadError("");
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
  }, [listedIdsKey]);

  // How many could still be added, as the list stands.
  useEffect(() => {
    let isCurrent: boolean = true;

    modelAPI
      .count<Dashboard>({
        modelType: Dashboard,
        query: getAddablePlaylistDashboardsQuery(dashboards),
      })
      .then((count: number) => {
        if (isCurrent) {
          setAddableCount(count);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setAddableCount(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [listedIdsKey]);

  const update: (next: Array<DashboardPlaylistDashboard>) => void = (
    next: Array<DashboardPlaylistDashboard>,
  ): void => {
    setDashboards(next);
    props.onChange?.(next);
  };

  const listed: Array<PlaylistListedDashboard> = getPlaylistListedDashboards({
    dashboards: dashboards,
    readable: readable,
  });

  const isFull: boolean =
    dashboards.length >= DASHBOARD_PLAYLIST_MAX_DASHBOARDS;

  // Nothing left to add: the project has no dashboard, or each is listed.
  const hasNothingToAdd: boolean = addableCount === 0;

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

    if (hasNothingToAdd) {
      return translator.translateText(getNothingToAddText(dashboards)) || "";
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
                      className={getIconButtonClassName(index === 0)}
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
                      className={getIconButtonClassName(
                        index === listed.length - 1,
                      )}
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
                      className={getIconButtonClassName(false)}
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

      {/*
       * The picker is where a missing dashboard is put right, so it is the
       * control the form's error marks, and it says the error under itself
       * as every other field of the form does.
       */}
      {/*
       * Searched on the server as the editor types, 50 by name, within the
       * dashboards that can be added (#10580): every one of the project's,
       * however many it has.
       */}
      <EntityDropdown
        key={pickerKey}
        modelType={Dashboard}
        modelAPI={modelAPI}
        labelField="name"
        valueField="_id"
        query={getAddablePlaylistDashboardsQuery(dashboards)}
        emptyListText={getNothingToAddText(dashboards)}
        placeholder={getPickerPlaceholder()}
        // Worded here, a count among them: drawn as given.
        isPlaceholderTranslated={true}
        ariaLabel={translator.translateText("Add a dashboard") || ""}
        dataTestId="playlist-dashboards-picker"
        disabled={isFull || hasNothingToAdd}
        error={props.error || undefined}
        isClearable={false}
        onChange={(
          value: DropdownValue | Array<DropdownValue> | null,
          change: DropdownChange,
        ) => {
          if (typeof value !== "string" || isFull) {
            return;
          }

          /*
           * Named from the pick at once, before the list's dashboards are
           * read again: the search's answer is what the viewer may read.
           */
          const picked: DropdownOption | undefined =
            change?.selectedOptions.find((option: DropdownOption): boolean => {
              return isSameDashboardId(String(option.value), value);
            });

          if (picked) {
            setReadable(
              (
                current: Array<PlaylistReadableDashboard>,
              ): Array<PlaylistReadableDashboard> => {
                return [
                  ...current,
                  { id: value, name: picked.label, isArchived: false },
                ];
              },
            );
          }

          update(addPlaylistDashboard(dashboards, value));
          setPickerKey((key: number) => {
            return key + 1;
          });
        }}
      />

      {loadError ? (
        <p className="text-sm text-red-600" role="alert">
          <ErrorInSentence message={loadError} showWhereToLook={true} />
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default PlaylistDashboardsField;
