import API from "../../Utils/API/API";
import CardListSkeleton from "../Skeleton/CardListSkeleton";
import Query from "../../../Types/BaseDatabase/Query";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
  PermissionGateOptions,
} from "../../Utils/PermissionGate";
import { usePrivateRecordGateOptions } from "../../Utils/PrivateRecordScope";
import ModelAPI, {
  ListResult,
  RequestOptions,
} from "../../Utils/ModelAPI/ModelAPI";
import TableEmptyState, { TableEmptyStateKind } from "../Table/TableEmptyState";
import {
  EmptyMessageParts,
  splitEmptyMessage,
  toHeadline,
} from "../Table/EmptyTableMessage";
import { getLoadErrorStateProps } from "../Table/TableEmptyStateBuilders";
import useTranslateValue from "../../Utils/Translation";
import Input from "../Input/Input";
import { withSearchIn } from "../EntityDropdown/EntityDropdownQuery";
import StaticModelList from "../ModelList/StaticModelList";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import Select from "../../../Types/BaseDatabase/Select";

export const NO_ITEMS_FOUND: string = "No items found.";
export const NO_ITEMS_MATCH_YOUR_SEARCH: string = "No items match your search";

// A list searched on the server (searchesServer): how many rows it reads at a time.
export const MODEL_LIST_SERVER_SEARCH_LIMIT: number = 50;

// How long typing rests before the server is asked.
export const MODEL_LIST_SERVER_SEARCH_DELAY_MS: number = 250;

// Under a list searched on the server, while it holds more than it shows.
export const MODEL_LIST_SEARCH_TO_FIND_MORE: string = "Search to find more.";

export interface ComponentProps<TBaseModel extends BaseModel> {
  id: string;
  query?: Query<TBaseModel>;
  modelType: { new (): TBaseModel };
  titleField: string;
  isSearchEnabled?: boolean | undefined;
  /*
   * The list is searched on the server as the person types - by titleField
   * and descriptionField - rather than read whole and filtered here (#10764):
   * for a list too long to read, a project's dashboards. It reads
   * MODEL_LIST_SERVER_SEARCH_LIMIT rows at a time, by titleField unless
   * sortBy says otherwise, and says to search to find more while there are
   * more. Off unless set: the list is read whole, its first 10,000.
   */
  searchesServer?: boolean | undefined;
  descriptionField?: string | undefined;
  selectMultiple?: boolean | undefined;
  overrideFetchApiUrl?: URL | undefined;
  select: Select<TBaseModel>;
  fetchRequestOptions?: RequestOptions | undefined;
  customElement?: ((item: TBaseModel) => ReactElement) | undefined;
  noItemsMessage: string;
  /*
   * Render nothing, rather than noItemsMessage (or its "No items found."
   * fallback), when the list loads empty. For a caller that explains an empty
   * list itself, e.g. from onListLoaded. A search that matches nothing still
   * says so.
   */
  hideEmptyState?: boolean | undefined;
  headerField?: string | ((item: TBaseModel) => ReactElement) | undefined;
  onSelectChange?: ((list: Array<TBaseModel>) => void) | undefined;
  refreshToggle?: string | undefined;
  footer?: ReactElement | undefined;
  isDeleteable?: boolean | undefined;
  enableDragAndDrop?: boolean | undefined;
  dragDropIdField?: keyof TBaseModel | undefined;
  dragDropIndexField?: keyof TBaseModel | undefined;
  sortBy?: keyof TBaseModel | undefined;
  sortOrder?: SortOrder | undefined;
  onListLoaded?: ((list: Array<TBaseModel>) => void) | undefined;
  /*
   * The rows sit in the page as they are, without the list's own frame (its
   * padding, the space under it and a scroll box of its own): for a list
   * whose rows are the page's own choices - a sign-in page's providers -
   * which line up with what is around them, grow with the page, and read
   * as one list with a list beside them.
   */
  isUnframed?: boolean | undefined;
}

// The frame a list draws around its rows, unless it is unframed.
export const MODEL_LIST_FRAME_CLASS_NAME: string =
  "max-h-96 mb-5 overflow-y-auto p-2";

const ModelList: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  /*
   * The row Delete button used to appear for anybody the caller marked the
   * list deleteable for, permission or not. It now stays visible but locked
   * when the viewer cannot delete the model.
   */
  /*
   * On a private incident, alert or episode's page, what the reader holds
   * on it: its changes are offered only when a team of theirs that owns it
   * may make them (PrivateRecordScope).
   */
  const privateRecordOptions: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(new props.modelType());

  const deleteGate: PermissionGateResult = PermissionGate.check(
    new props.modelType(),
    ModelAction.Delete,
    privateRecordOptions,
  );

  const { translateString } = useTranslateValue();
  const translate: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  const [selectedList, setSelectedList] = useState<Array<TBaseModel>>([]);
  const [modelList, setModalList] = useState<Array<TBaseModel>>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchedList, setSearchedList] = useState<Array<TBaseModel>>([]);
  const [searchText, setSearchText] = useState<string>("");
  /*
   * A list searched on the server (searchesServer): how many rows match
   * what is typed, and whether a search is on its way - the search box stays
   * while it is, so the person keeps typing.
   */
  const [matchingCount, setMatchingCount] = useState<number>(0);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const searchTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    props.onSelectChange?.(selectedList);
  }, [selectedList]);

  /*
   * Bumped by every fetch (and on unmount). A response only lands if no newer
   * fetch has started since, so a slow earlier request - e.g. one still in
   * flight when refreshToggle flips - can never overwrite a newer list.
   */
  const fetchGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    return () => {
      fetchGenerationRef.current++;

      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  // Also runs on mount, so this is the initial fetch too.
  useEffect(() => {
    fetchItems().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [props.refreshToggle]);

  useEffect(() => {
    if (!props.isSearchEnabled) {
      setSearchedList([...modelList]);
    }
  }, [props.isSearchEnabled, modelList]);

  /*
   * `search`: what a list searched on the server (searchesServer) reads the
   * rows for - drawn as a search on its way, not as the list loading, so
   * the search box stays.
   */
  const fetchItems: (search?: string | undefined) => Promise<void> = async (
    search?: string | undefined,
  ): Promise<void> => {
    fetchGenerationRef.current++;
    const generation: number = fetchGenerationRef.current;
    const isSearch: boolean = search !== undefined;

    type IsStaleFunction = () => boolean;

    const isStale: IsStaleFunction = (): boolean => {
      return generation !== fetchGenerationRef.current;
    };

    setError("");

    if (isSearch) {
      setIsSearching(true);
    } else {
      setIsLoading(true);
    }

    try {
      const select: Select<TBaseModel> = {
        ...props.select,
      };

      if (
        props.dragDropIdField &&
        !Object.keys(select).includes(props.dragDropIdField as string)
      ) {
        select[props.dragDropIdField] = true;
      }

      if (
        props.dragDropIndexField &&
        !Object.keys(select).includes(props.dragDropIndexField as string)
      ) {
        select[props.dragDropIndexField] = true;
      }

      let listResult: ListResult<TBaseModel> = {
        data: [],
        count: 0,
        skip: 0,
        limit: 0,
      };

      if (props.overrideFetchApiUrl) {
        const result: HTTPResponse<JSONArray> = (await API.post({
          url: props.overrideFetchApiUrl,
          data: {},
          headers: {},
        })) as HTTPResponse<JSONArray>;

        listResult = {
          data: BaseModel.fromJSONArray(
            result.data as JSONArray,
            props.modelType,
          ),
          count: (result.data as JSONArray).length as number,
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        };
      } else if (props.searchesServer) {
        // A page of the rows whose title or description holds the search.
        listResult = await ModelAPI.getList<TBaseModel>({
          modelType: props.modelType,
          query: withSearchIn(
            { ...props.query },
            [props.titleField, props.descriptionField].filter(
              (field: string | undefined): field is string => {
                return Boolean(field);
              },
            ),
            search || searchText,
          ) as Query<TBaseModel>,
          limit: MODEL_LIST_SERVER_SEARCH_LIMIT,
          skip: 0,
          select: select,
          sort: props.sortBy
            ? {
                [props.sortBy as any]: props.sortOrder,
              }
            : ({ [props.titleField]: SortOrder.Ascending } as any),
          requestOptions: props.fetchRequestOptions,
        });
      } else {
        listResult = await ModelAPI.getList<TBaseModel>({
          modelType: props.modelType,
          query: {
            ...props.query,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: select,
          sort: props.sortBy
            ? {
                [props.sortBy as any]: props.sortOrder,
              }
            : {},

          requestOptions: props.fetchRequestOptions,
        });
      }

      if (isStale()) {
        return;
      }

      props.onListLoaded?.(listResult.data);
      setModalList(listResult.data);
      setMatchingCount(listResult.count);
    } catch (err) {
      if (isStale()) {
        return;
      }

      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
    setIsSearching(false);
  };

  /*
   * A list searched on the server reads the rows for what is typed, once
   * typing rests (searchesServer). Cleared, at once.
   */
  const isFirstSearchRef: React.MutableRefObject<boolean> =
    useRef<boolean>(true);

  useEffect(() => {
    if (!props.searchesServer) {
      return;
    }

    // The list's own first read reads it for nothing typed.
    if (isFirstSearchRef.current) {
      isFirstSearchRef.current = false;
      return;
    }

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    const search: string = searchText.trim();

    searchTimerRef.current = setTimeout(
      () => {
        fetchItems(search).catch((err: Error) => {
          setError(API.getFriendlyMessage(err));
        });
      },
      search ? MODEL_LIST_SERVER_SEARCH_DELAY_MS : 0,
    );
  }, [searchText]);

  useEffect(() => {
    // Searched on the server: the rows read are the search's already.
    if (!searchText || props.searchesServer) {
      setSearchedList([...modelList]);
    } else {
      // search

      setSearchedList(
        [...modelList].filter((model: TBaseModel): boolean => {
          const includedInSearch: boolean = (
            model.getValue(props.titleField) as string
          )
            .toLowerCase()
            .includes(searchText);

          if (!includedInSearch && props.descriptionField) {
            return (model.getValue(props.descriptionField) as string)
              .toLowerCase()
              .includes(searchText);
          }

          return includedInSearch;
        }),
      );
    }
  }, [modelList, searchText]);

  type DeleteItemFunction = (item: TBaseModel) => Promise<void>;

  const deleteItem: DeleteItemFunction = async (item: TBaseModel) => {
    if (!item.id) {
      throw new BadDataException("item.id cannot be null");
    }

    setIsLoading(true);

    try {
      await ModelAPI.deleteItem<TBaseModel>({
        modelType: props.modelType,
        id: item.id,
      });

      // fetchItems clears the loader itself - unless a newer fetch owns it.
      await fetchItems();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  /*
   * The list's empty state, in the same shape as a table's (smaller - this
   * list sits in a dialog or a card): a search that matched nothing, or the
   * caller's message split into a title and a description.
   */
  const getEmptyState: () => ReactElement = (): ReactElement => {
    if (searchText) {
      return (
        <TableEmptyState
          kind={TableEmptyStateKind.Filtered}
          title={toHeadline(translate(NO_ITEMS_MATCH_YOUR_SEARCH))}
          isCompact={true}
          dataTestId={`${props.id}-no-items`}
        />
      );
    }

    const parts: EmptyMessageParts = splitEmptyMessage(
      translate(props.noItemsMessage || NO_ITEMS_FOUND),
    );

    return (
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        icon={new props.modelType().icon || undefined}
        title={parts.title}
        description={parts.description}
        isCompact={true}
        dataTestId={`${props.id}-no-items`}
      />
    );
  };

  return (
    <div>
      <div>
        {!isLoading && !error && props.isSearchEnabled && (
          <div className="p-2">
            <Input
              isSearchOrFilter={true}
              placeholder="Search..."
              value={props.searchesServer ? searchText : undefined}
              onChange={(value: string) => {
                setSearchText(value);
              }}
            />
          </div>
        )}
      </div>
      <div
        className={props.isUnframed ? undefined : MODEL_LIST_FRAME_CLASS_NAME}
        data-testid={`${props.id}-rows`}
      >
        {error ? (
          <TableEmptyState
            {...getLoadErrorStateProps({
              pluralLabel: new props.modelType().pluralName || "items",
              error: error,
              onRetry: () => {
                fetchItems().catch((err: Error) => {
                  setError(API.getFriendlyMessage(err));
                });
              },
              translate: translate,
            })}
            isCompact={true}
            dataTestId={`${props.id}-load-error`}
          />
        ) : (
          <></>
        )}
        {isLoading || isSearching ? (
          <CardListSkeleton count={3} lines={1} />
        ) : (
          <></>
        )}

        {!isLoading &&
        !isSearching &&
        !error &&
        searchedList.length === 0 &&
        (Boolean(searchText) || !props.hideEmptyState) ? (
          getEmptyState()
        ) : (
          <></>
        )}

        {!error && !isLoading && !isSearching && (
          <StaticModelList<TBaseModel>
            enableDragAndDrop={props.enableDragAndDrop}
            dragDropIdField={props.dragDropIdField}
            dragDropIndexField={props.dragDropIndexField}
            list={searchedList}
            headerField={props.headerField}
            descriptionField={props.descriptionField}
            dragAndDropScope={`${props.id}-dnd`}
            customElement={props.customElement}
            onDragDrop={async (
              id: string,
              destinationIndex: number,
              sourceIndex: number,
            ) => {
              /*
               * The dragged row takes the place of the row it was dropped
               * on, named by its id: the server moves it there, the rows
               * between stepping aside (POST <path>/:id/move). A write of
               * its number would only put it beside that row (issue
               * #9609).
               */
              const placeOfId: string | undefined =
                searchedList[destinationIndex]?._id?.toString();

              if (
                !props.dragDropIndexField ||
                !placeOfId ||
                sourceIndex === destinationIndex
              ) {
                return;
              }

              setIsLoading(true);

              // Why the server refused, said once the list is read again.
              let moveError: string = "";

              try {
                await ModelAPI.moveInList({
                  modelType: props.modelType,
                  id: new ObjectID(id),
                  placeOfId: new ObjectID(placeOfId),
                });
              } catch (err) {
                moveError = API.getFriendlyMessage(err);
              }

              await fetchItems();

              if (moveError) {
                setError(moveError);
              }
            }}
            titleField={props.titleField}
            onDelete={
              props.isDeleteable && deleteGate.isAllowed
                ? async (item: TBaseModel) => {
                    await deleteItem(item);
                  }
                : props.isDeleteable && deleteGate.disabledReason
                  ? () => {
                      // Locked - the tooltip below explains why.
                    }
                  : undefined
            }
            deleteDisabledReason={deleteGate.disabledReason}
            selectedItems={selectedList}
            onClick={(model: TBaseModel) => {
              if (props.selectMultiple) {
                // if added to the list, then remove or add to list
                const isSelected: boolean =
                  selectedList.filter((selectedItem: TBaseModel) => {
                    return (
                      selectedItem._id?.toString() === model._id?.toString()
                    );
                  }).length > 0;
                if (isSelected) {
                  // remove the item.
                  setSelectedList(
                    selectedList.filter((i: TBaseModel) => {
                      return i._id?.toString() !== model._id?.toString();
                    }),
                  );
                } else {
                  setSelectedList([...selectedList, { ...model }]);
                }
              } else {
                setSelectedList([{ ...model }]);
              }
            }}
          />
        )}
        {/*
         * Searched on the server, with more rows than it shows: the rest are
         * found by searching.
         */}
        {props.searchesServer &&
        !error &&
        !isLoading &&
        !isSearching &&
        matchingCount > modelList.length ? (
          <p
            className="px-2 pt-2 text-xs text-gray-500"
            data-testid={`${props.id}-search-to-find-more`}
          >
            {translate(MODEL_LIST_SEARCH_TO_FIND_MORE)}
          </p>
        ) : (
          <></>
        )}
        {props.footer}
      </div>
    </div>
  );
};

export default ModelList;
