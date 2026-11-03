import {
  WATCHLISTS_TEST_IDS,
  WATCHLIST_FILTER_ADD,
  WATCHLIST_FILTER_FIELD,
  WATCHLIST_FILTER_FIELD_PLACEHOLDER,
  WATCHLIST_FILTER_IS_NOT_ON,
  WATCHLIST_FILTER_IS_ON,
  WATCHLIST_FILTER_LISTS_FAILED,
  WATCHLIST_FILTER_MATCH,
  WATCHLIST_FILTER_NO_LISTS,
  WATCHLIST_FILTER_OPEN_WATCHLISTS,
  WATCHLIST_FILTER_REMOVE,
  WATCHLIST_FILTER_WATCHLIST,
  WATCHLIST_FILTER_WATCHLIST_PLACEHOLDER,
} from "../../../SecurityEvents/Watchlists/WatchlistsCopy";
import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_WATCHLISTS_PER_PROJECT_MAX,
  getSecurityWatchlistNameKey,
} from "Common/Types/SecurityEvent/SecurityWatchlist";
import {
  SECURITY_WATCHLIST_FILTERS_MAX,
  SECURITY_WATCHLIST_FILTER_FIELDS,
  SecurityWatchlistFilter,
  getDefaultSecurityWatchlistFilterField,
} from "Common/Types/SecurityEvent/SecurityWatchlistFilter";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import Link from "Common/UI/Components/Link/Link";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The event field a filter reads a list in, as the event's panel names it
 * (Principal User, Target IP, Observables...): English keys, which the
 * dropdown says in the reader's language.
 */
export const WATCHLIST_FILTER_FIELD_LABELS: Readonly<Record<string, string>> = {
  principalUser: "Principal User",
  principalHost: "Principal Host",
  principalIp: "Principal IP",
  targetUser: "Target User",
  targetHost: "Target Host",
  targetIp: "Target IP",
  processName: "Process",
  observables: "Observables",
};

export function getWatchlistFilterFieldOptions(): Array<DropdownOption> {
  return SECURITY_WATCHLIST_FILTER_FIELDS.map(
    (field: string): DropdownOption => {
      return {
        value: field,
        label: WATCHLIST_FILTER_FIELD_LABELS[field] || field,
      };
    },
  );
}

// Whether a filter keeps the events on the list, or those off it.
export const WATCHLIST_FILTER_MATCH_ON: string = "on";
export const WATCHLIST_FILTER_MATCH_NOT_ON: string = "not-on";

export function getWatchlistFilterMatchOptions(): Array<DropdownOption> {
  return [
    { value: WATCHLIST_FILTER_MATCH_ON, label: WATCHLIST_FILTER_IS_ON },
    { value: WATCHLIST_FILTER_MATCH_NOT_ON, label: WATCHLIST_FILTER_IS_NOT_ON },
  ];
}

/*
 * The lists a filter can read: the project's, by name as rules write them
 * - never looked up as words - with a list a filter names that is gone
 * kept as an option of its own, so the filter still says what it reads.
 */
export function getWatchlistFilterListOptions(
  watchlists: ReadonlyArray<SecurityWatchlist>,
  filters: ReadonlyArray<SecurityWatchlistFilter>,
): Array<DropdownOption> {
  const options: Array<DropdownOption> = watchlists
    .filter((watchlist: SecurityWatchlist): boolean => {
      return Boolean(watchlist.name);
    })
    .map((watchlist: SecurityWatchlist): DropdownOption => {
      return {
        value: watchlist.name!,
        label: watchlist.name!,
        isUserContent: true,
      };
    });

  const known: Set<string> = new Set(
    options.map((option: DropdownOption): string => {
      return getSecurityWatchlistNameKey(option.value);
    }),
  );

  for (const filter of filters) {
    const key: string = getSecurityWatchlistNameKey(filter.watchlist);

    if (key && !known.has(key)) {
      known.add(key);
      options.push({
        value: filter.watchlist,
        label: filter.watchlist,
        isUserContent: true,
      });
    }
  }

  return options;
}

// A filter with one of its parts changed: a new list on a row with no field yet sets the field its kind is usually in.
export function changeWatchlistFilter(data: {
  filter: SecurityWatchlistFilter;
  change: Partial<SecurityWatchlistFilter>;
  watchlists: ReadonlyArray<SecurityWatchlist>;
}): SecurityWatchlistFilter {
  const next: SecurityWatchlistFilter = { ...data.filter, ...data.change };

  if (data.change.watchlist !== undefined && !data.filter.field) {
    const watchlist: SecurityWatchlist | undefined = data.watchlists.find(
      (item: SecurityWatchlist): boolean => {
        return (
          getSecurityWatchlistNameKey(item.name) ===
          getSecurityWatchlistNameKey(data.change.watchlist)
        );
      },
    );

    next.field = getDefaultSecurityWatchlistFilterField(watchlist?.entityType);
  }

  return next;
}

export interface ComponentProps {
  value?: Array<SecurityWatchlistFilter> | undefined;
  onChange: (filters: Array<SecurityWatchlistFilter>) => void;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  error?: string | undefined;
}

/*
 * FILTER BY WATCHLISTS, in a Security Events monitor's form: rows of "this
 * field is - or is not - on this watchlist", each matched as a detection
 * rule's `expand` matches it (Types/SecurityEvent/SecurityWatchlistFilter).
 * A row's list is picked from the project's lists by name; picking one on a
 * row with no field yet sets the field a list of its kind is usually in.
 * A project with no list yet is sent to Watchlists to make one.
 *
 * A row reads as a sentence - Principal User, is on the list, vip_users -
 * so its three choices are changed by picking another, never emptied: the
 * row's own remove button, beside them at every width, takes it away.
 */
const SecurityEventsWatchlistFilters: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const filters: Array<SecurityWatchlistFilter> = props.value || [];

  const [watchlists, setWatchlists] = useState<Array<SecurityWatchlist>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      setIsLoading(false);
      return () => {};
    }

    ModelAPI.getList<SecurityWatchlist>({
      modelType: SecurityWatchlist,
      query: { projectId },
      select: {
        _id: true,
        name: true,
        entityType: true,
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: SECURITY_WATCHLISTS_PER_PROJECT_MAX,
    })
      .then((result: ListResult<SecurityWatchlist>) => {
        if (isCurrent) {
          setWatchlists(result.data);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setLoadError(true);
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const watchlistsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_WATCHLISTS] as Route,
  );

  const update: (filters: Array<SecurityWatchlistFilter>) => void = (
    next: Array<SecurityWatchlistFilter>,
  ): void => {
    props.onChange(next);
  };

  const listOptions: Array<DropdownOption> = getWatchlistFilterListOptions(
    watchlists,
    filters,
  );
  const fieldOptions: Array<DropdownOption> = getWatchlistFilterFieldOptions();
  const matchOptions: Array<DropdownOption> = getWatchlistFilterMatchOptions();

  const hasNoLists: boolean =
    !isLoading && !loadError && watchlists.length === 0;

  return (
    <div
      className="space-y-3"
      role="group"
      aria-labelledby={props.ariaLabelledby}
      aria-describedby={props.ariaDescribedby}
      data-testid={WATCHLISTS_TEST_IDS.monitorFilters}
    >
      {filters.map(
        (filter: SecurityWatchlistFilter, index: number): ReactElement => {
          const change: (part: Partial<SecurityWatchlistFilter>) => void = (
            part: Partial<SecurityWatchlistFilter>,
          ): void => {
            update(
              filters.map(
                (
                  item: SecurityWatchlistFilter,
                  itemIndex: number,
                ): SecurityWatchlistFilter => {
                  return itemIndex === index
                    ? changeWatchlistFilter({
                        filter: item,
                        change: part,
                        watchlists,
                      })
                    : item;
                },
              ),
            );
          };

          const findOption: (
            options: Array<DropdownOption>,
            value: string,
          ) => DropdownOption | undefined = (
            options: Array<DropdownOption>,
            value: string,
          ): DropdownOption | undefined => {
            return options.find((option: DropdownOption): boolean => {
              return (
                getSecurityWatchlistNameKey(String(option.value)) ===
                getSecurityWatchlistNameKey(value)
              );
            });
          };

          return (
            <div
              key={index}
              className="flex items-start gap-2 rounded-md border border-gray-200 p-3 md:items-center"
              data-testid={WATCHLISTS_TEST_IDS.monitorFilter}
            >
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-3">
                <Dropdown
                  options={fieldOptions}
                  value={fieldOptions.find(
                    (option: DropdownOption): boolean => {
                      return option.value === filter.field;
                    },
                  )}
                  placeholder={WATCHLIST_FILTER_FIELD_PLACEHOLDER}
                  ariaLabel={translator.translateText(WATCHLIST_FILTER_FIELD)}
                  isClearable={false}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    change({ field: value ? String(value) : "" });
                  }}
                  dataTestId={`${WATCHLISTS_TEST_IDS.monitorFilter}-field`}
                />
                <Dropdown
                  options={matchOptions}
                  value={
                    matchOptions[filter.isNotOnList ? 1 : 0] as DropdownOption
                  }
                  ariaLabel={translator.translateText(WATCHLIST_FILTER_MATCH)}
                  isClearable={false}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    change({
                      isNotOnList: value === WATCHLIST_FILTER_MATCH_NOT_ON,
                    });
                  }}
                  dataTestId={`${WATCHLISTS_TEST_IDS.monitorFilter}-match`}
                />
                <Dropdown
                  options={listOptions}
                  value={findOption(listOptions, filter.watchlist)}
                  placeholder={WATCHLIST_FILTER_WATCHLIST_PLACEHOLDER}
                  ariaLabel={translator.translateText(
                    WATCHLIST_FILTER_WATCHLIST,
                  )}
                  isClearable={false}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    change({ watchlist: value ? String(value) : "" });
                  }}
                  dataTestId={`${WATCHLISTS_TEST_IDS.monitorFilter}-watchlist`}
                />
              </div>
              <div className="flex flex-shrink-0">
                <Button
                  title={WATCHLIST_FILTER_REMOVE}
                  buttonStyle={ButtonStyleType.ICON}
                  icon={IconProp.Close}
                  ariaLabel={translator.translateText(WATCHLIST_FILTER_REMOVE)}
                  dataTestId={WATCHLISTS_TEST_IDS.monitorFilterRemove}
                  onClick={() => {
                    update(
                      filters.filter(
                        (_item: SecurityWatchlistFilter, itemIndex: number) => {
                          return itemIndex !== index;
                        },
                      ),
                    );
                  }}
                />
              </div>
            </div>
          );
        },
      )}

      {loadError ? (
        <p className="text-sm text-gray-500">
          {translator.translateText(WATCHLIST_FILTER_LISTS_FAILED)}
        </p>
      ) : (
        <></>
      )}

      {hasNoLists ? (
        <p className="text-sm text-gray-500">
          {translator.translateText(WATCHLIST_FILTER_NO_LISTS)}{" "}
          <Link
            to={watchlistsRoute}
            className="font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {translator.translateText(WATCHLIST_FILTER_OPEN_WATCHLISTS)}
          </Link>
        </p>
      ) : (
        <></>
      )}

      {!hasNoLists && filters.length < SECURITY_WATCHLIST_FILTERS_MAX ? (
        // Level with Filter by Attributes' Add: past md a NORMAL button keeps a dialog footer's margin.
        <div className="md:-ml-3">
          <Button
            title={WATCHLIST_FILTER_ADD}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            icon={IconProp.Add}
            dataTestId={WATCHLISTS_TEST_IDS.monitorFilterAdd}
            onClick={() => {
              update([
                ...filters,
                { field: "", watchlist: "", isNotOnList: false },
              ]);
            }}
          />
        </div>
      ) : (
        <></>
      )}

      {props.error ? <FieldError message={props.error} /> : <></>}
    </div>
  );
};

export default SecurityEventsWatchlistFilters;
