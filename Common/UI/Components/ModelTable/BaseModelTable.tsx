import Includes from "../../../Types/BaseDatabase/Includes";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import { API_DOCS_URL, BILLING_ENABLED, getAllEnvVars } from "../../Config";
import { GetReactElementFunction } from "../../Types/FunctionTypes";
import SelectEntityField from "../../Types/SelectEntityField";
import API from "../../Utils/API/API";
import useTranslateValue from "../../Utils/Translation";

import Query from "../../../Types/BaseDatabase/Query";
import GroupBy from "../../../Types/BaseDatabase/GroupBy";
import Sort from "../../../Types/BaseDatabase/Sort";
import Select from "../../../Types/BaseDatabase/Select";
import { Logger } from "../../Utils/Logger";
import Navigation from "../../Utils/Navigation";
import TableFilterUrlState from "../../Utils/TableFilterUrlState";
import PermissionUtil from "../../Utils/Permission";
import ProjectUtil from "../../Utils/Project";
import User from "../../Utils/User";
import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "../BulkUpdate/BulkUpdateForm";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import Card, {
  CardButtonSchema,
  ComponentProps as CardComponentProps,
} from "../Card/Card";
import { getRefreshButton } from "../Card/CardButtons/Refresh";
import Field from "../Detail/Field";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import ClassicFilterType from "../Filters/Types/Filter";
import FilterData from "../Filters/Types/FilterData";
import { FormProps, FormSummaryConfig } from "../Forms/BasicForm";
import { ModelField } from "../Forms/ModelForm";
import { FormStep } from "../Forms/Types/FormStep";
import FormValues from "../Forms/Types/FormValues";
import List from "../List/List";
import { ListDetailProps } from "../List/ListRow";
import ConfirmModal from "../Modal/ConfirmModal";
import Modal, { ModalWidth } from "../Modal/Modal";
import MarkdownViewer from "../Markdown.tsx/MarkdownViewer";
import Icon from "../Icon/Icon";
import Filter from "../ModelFilter/Filter";
import { DropdownOption, DropdownOptionLabel } from "../Dropdown/Dropdown";
import OrderedStatesList from "../OrderedStatesList/OrderedStatesList";
import Pill from "../Pill/Pill";
import Table from "../Table/Table";
import TableColumn from "../Table/Types/Column";
import FieldType from "../Types/FieldType";
import ModelTableColumn from "./Column";
import Columns from "./Columns";
import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AccessControlModel from "../../../Models/DatabaseModels/DatabaseBaseModel/AccessControlModel";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Search from "../../../Types/BaseDatabase/Search";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import { Yellow } from "../../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Color from "../../../Types/Color";
import {
  ErrorFunction,
  PromiseVoidFunction,
  VoidFunction,
} from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../Types/Permission";
import Typeof from "../../../Types/Typeof";
import React, {
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import TableViewElement from "./TableView";
import TableView from "../../../Models/DatabaseModels/TableView";
import UserPreferences, {
  UserPreferenceType,
} from "../../../Utils/UserPreferences";
import RequestOptions from "../../Utils/API/RequestOptions";
import ListResult from "../../../Types/BaseDatabase/ListResult";

export enum ShowAs {
  Table,
  List,
  OrderedStatesList,
}

export interface SaveFilterProps {
  tableId: string;
}

export interface BaseTableCallbacks<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> {
  deleteItem: (item: TBaseModel) => Promise<void>;
  getModelFromJSON: (item: JSONObject) => TBaseModel;
  getJSONFromModel: (item: TBaseModel) => JSONObject;
  addSlugToSelect: (select: Select<TBaseModel>) => Select<TBaseModel>;
  getList: (data: {
    modelType: DatabaseBaseModelType | AnalyticsBaseModelType;
    query: Query<TBaseModel>;
    groupBy?: GroupBy<TBaseModel> | undefined;
    limit: number;
    skip: number;
    sort: Sort<TBaseModel>;
    select: Select<TBaseModel>;
    requestOptions?: RequestOptions | undefined;
  }) => Promise<ListResult<TBaseModel>>;
  toJSONArray: (data: Array<TBaseModel>) => Array<JSONObject>;
  updateById: (data: { id: ObjectID; data: JSONObject }) => Promise<void>;
  showCreateEditModal: (data: {
    modalType: ModalType;
    modelIdToEdit?: ObjectID | undefined;
    onBeforeCreate?:
      | ((item: TBaseModel, miscDataProps: JSONObject) => Promise<TBaseModel>)
      | undefined;
    onSuccess?: ((item: TBaseModel) => void) | undefined;
    onClose?: (() => void) | undefined;
  }) => ReactElement;
}

export enum ModalTableBulkDefaultActions {
  Delete = "Delete",
}

export interface BulkActionProps<T extends BaseModel | AnalyticsBaseModel> {
  buttons: Array<BulkActionButtonSchema<T> | ModalTableBulkDefaultActions>;
  matchBulkSelectedItemByField?: keyof T | undefined; // which field to use to match selected items. For exmaple this could be '_id'
}

export interface BaseTableProps<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> {
  modelType: { new (): TBaseModel };
  id: string;
  onFetchInit?: undefined | ((pageNumber: number, itemsOnPage: number) => void);
  onFetchSuccess?:
    | undefined
    | ((data: Array<TBaseModel>, totalCount: number) => void);
  cardProps?: CardComponentProps | undefined;
  /**
   * Optional content rendered inside the card body, above the table rows.
   * Useful for in-table filter chips, alerts, etc.
   */
  topContent?: ReactElement | undefined;
  helpContent?:
    | {
        title: string;
        description?: string | undefined;
        markdown: string;
      }
    | undefined;
  documentationLink?: Route | URL | undefined;
  videoLink?: Route | URL | undefined;
  showCreateForm?: undefined | boolean;
  columns: Columns<TBaseModel>;
  filters: Array<Filter<TBaseModel>>;
  listDetailOptions?: undefined | ListDetailProps;
  selectMoreFields?: Select<TBaseModel>;
  initialItemsOnPage?: number;
  isDeleteable: boolean;
  isEditable?: boolean | undefined;
  isCreateable: boolean;
  onCreateClick?: (() => void) | undefined;
  disablePagination?: undefined | boolean;
  formFields?: undefined | Array<ModelField<TBaseModel>>;
  formSteps?: undefined | Array<FormStep<TBaseModel>>;
  noItemsMessage?: undefined | string | ReactElement;
  showRefreshButton?: undefined | boolean;
  isViewable?: undefined | boolean;
  showViewIdButton?: undefined | boolean;
  enableDragAndDrop?: boolean | undefined;
  viewPageRoute?: undefined | Route;
  onViewPage?: (item: TBaseModel) => Promise<Route | URL>;
  query?: Query<TBaseModel>;
  groupBy?: GroupBy<TBaseModel> | undefined;
  onBeforeFetch?: (() => Promise<TBaseModel>) | undefined;
  createInitialValues?: FormValues<TBaseModel> | undefined;
  onBeforeCreate?:
    | ((item: TBaseModel, miscDataProps: JSONObject) => Promise<TBaseModel>)
    | undefined;
  onCreateSuccess?: ((item: TBaseModel) => Promise<TBaseModel>) | undefined;
  createVerb?: string;
  showAs?: ShowAs | undefined;
  singularName?: string | undefined;
  pluralName?: string | undefined;
  actionButtons?: Array<ActionButtonSchema<TBaseModel>> | undefined;
  deleteButtonText?: string | undefined;
  onCreateEditModalClose?: (() => void) | undefined;
  editButtonText?: string | undefined;
  viewButtonText?: string | undefined;
  refreshToggle?: string | undefined;
  fetchRequestOptions?: RequestOptions | undefined;
  deleteRequestOptions?: RequestOptions | undefined;
  onItemDeleted?: ((item: TBaseModel) => void) | undefined;
  onBeforeEdit?: ((item: TBaseModel) => Promise<TBaseModel>) | undefined;
  onBeforeDelete?: ((item: TBaseModel) => Promise<TBaseModel>) | undefined;
  onBeforeView?: ((item: TBaseModel) => Promise<TBaseModel>) | undefined;
  sortBy?: keyof TBaseModel | undefined;
  sortOrder?: SortOrder | undefined;
  dragDropIdField?: keyof TBaseModel | undefined;
  dragDropIndexField?: keyof TBaseModel | undefined;
  createEditModalWidth?: ModalWidth | undefined;
  orderedStatesListProps?: {
    titleField: keyof TBaseModel;
    descriptionField?: keyof TBaseModel | undefined;
    orderField: keyof TBaseModel;
    shouldAddItemInTheEnd?: boolean;
    shouldAddItemInTheBeginning?: boolean;
  };
  onViewComplete?: ((item: TBaseModel) => void) | undefined;
  createEditFromRef?:
    | undefined
    | MutableRefObject<FormProps<FormValues<TBaseModel>>>;
  name: string;

  // bulk actions
  bulkActions?: BulkActionProps<TBaseModel> | undefined;

  onShowFormType?: (formType: ModalType) => void;

  initialFilterData?: FilterData<TBaseModel> | undefined;

  saveFilterProps?: SaveFilterProps | undefined;

  /**
   * Extra serializable state to persist alongside the saved view (e.g. facet
   * selections from a parent hook). Stored on `TableView.facets`. The shape
   * is opaque to ModelTable.
   */
  currentFacetState?: JSONObject | undefined;
  /**
   * Called when a saved view is loaded so the parent can restore its facet
   * state. `null` means "no saved facet data" (e.g. the user reset to the
   * default empty view).
   */
  onFacetStateRestored?: ((state: JSONObject | null) => void) | undefined;

  onFilterApplied?: ((isFilterApplied: boolean) => void) | undefined;

  formSummary?: FormSummaryConfig | undefined;

  onAdvancedFiltersToggle?:
    | undefined
    | ((showAdvancedFilters: boolean) => void);

  /*
   * Fields to include in the inline search box above the table. When set, a
   * search input renders in the card header and an ILIKE OR runs across all
   * listed fields. Leave undefined to hide the search box entirely.
   */
  searchableFields?: Array<keyof TBaseModel> | undefined;

  searchPlaceholder?: string | undefined;

  /*
   * this key is used to save table user preferences in local storage.
   * If you provide this key, the table will save the user preferences in local storage.
   * If you do not provide this key, the table will not save the user preferences in local storage.
   */
  userPreferencesKey: string;
}

export interface ComponentProps<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> extends BaseTableProps<TBaseModel> {
  callbacks: BaseTableCallbacks<TBaseModel>;
}

export enum ModalType {
  Create,
  Edit,
}

const BaseModelTable: <TBaseModel extends BaseModel | AnalyticsBaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel | AnalyticsBaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const { translateValue, translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };
  const [tableView, setTableView] = useState<TableView | null>(null);

  const matchBulkSelectedItemByField: keyof TBaseModel =
    props.bulkActions?.matchBulkSelectedItemByField || "_id";

  const model: TBaseModel = new props.modelType();

  const [bulkSelectedItems, setBulkSelectedItems] = useState<Array<TBaseModel>>(
    [],
  );

  let showAs: ShowAs | undefined = props.showAs;

  if (!showAs) {
    showAs = ShowAs.Table;
  }

  const propsQueryRef: React.MutableRefObject<Query<TBaseModel>> = React.useRef(
    props.query || {},
  );

  const [showViewIdModal, setShowViewIdModal] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [tableColumns, setColumns] = useState<Array<TableColumn<TBaseModel>>>(
    [],
  );

  const [classicTableFilters, setClassicTableFilters] = useState<
    Array<ClassicFilterType<TBaseModel>>
  >([]);

  const [cardButtons, setCardButtons] = useState<
    Array<CardButtonSchema | ReactElement>
  >([]);

  const [actionButtonSchema, setActionButtonSchema] = useState<
    Array<ActionButtonSchema<TBaseModel>>
  >([]);

  useEffect(() => {
    if (props.showCreateForm) {
      setShowModal(true);
      setModalType(ModalType.Create);
    }
  }, [props.showCreateForm]);

  useEffect(() => {
    if (props.onShowFormType) {
      props.onShowFormType(modalType);
    }
  }, [props.modelType]);

  const getItemsOnPage: () => number = (): number => {
    if (props.userPreferencesKey) {
      const itemsOnPage: number | null =
        UserPreferences.getUserPreferenceByTypeAsNumber({
          userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
          key: props.userPreferencesKey,
        });
      if (itemsOnPage) {
        return itemsOnPage;
      }
    }

    return props.initialItemsOnPage || 10;
  };

  const [orderedStatesListNewItemOrder, setOrderedStatesListNewItemOrder] =
    useState<number | null>(null);

  const [onBeforeFetchData, setOnBeforeFetchData] = useState<
    TBaseModel | undefined
  >(undefined);
  const [data, setData] = useState<Array<TBaseModel>>([]);
  const [query, setQuery] = useState<Query<TBaseModel>>({});
  const [currentPageNumber, setCurrentPageNumber] = useState<number>(1);
  const [totalItemsCount, setTotalItemsCount] = useState<number>(0);
  /*
   * Analytics endpoints (Log/Span/Metric/...) skip COUNT(*) for
   * performance and instead return `hasMore`. When `hasMore` is
   * `undefined`, the endpoint emitted an exact `count` and the
   * pagination falls back to the count-based UI.
   */
  const [hasMore, setHasMore] = useState<boolean | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [error, setError] = useState<string>("");
  const [tableFilterError, setTableFilterError] = useState<string>("");

  const [searchText, setSearchText] = useState<string>("");
  const [debouncedSearchText, setDebouncedSearchText] = useState<string>("");
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState<boolean>(false);
  const searchInputRef: React.RefObject<HTMLInputElement> =
    React.useRef<HTMLInputElement>(null!);

  interface SearchLabelOption {
    id: string;
    name: string;
    color: string;
  }

  const [availableLabels, setAvailableLabels] = useState<
    Array<SearchLabelOption>
  >([]);
  const [selectedLabels, setSelectedLabels] = useState<
    Array<SearchLabelOption>
  >([]);
  const [isLabelsLoading, setIsLabelsLoading] = useState<boolean>(false);
  const [labelsFetched, setLabelsFetched] = useState<boolean>(false);
  const [labelDropdownIndex, setLabelDropdownIndex] = useState<number>(0);

  useEffect(() => {
    const handle: ReturnType<typeof setTimeout> = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => {
      clearTimeout(handle);
    };
  }, [searchText]);

  /*
   * "/" focuses the search input — same affordance as GitHub / Linear.
   * Skip while the user is typing in another input/textarea or has a modal open.
   */
  useEffect(() => {
    if (!props.searchableFields || props.searchableFields.length === 0) {
      return undefined;
    }
    const handleKey: (e: KeyboardEvent) => void = (e: KeyboardEvent): void => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const target: HTMLElement | null = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setIsSearchExpanded(true);
      // Wait one frame so the input mounts/becomes visible before focusing.
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
    };
  }, [props.searchableFields]);

  /*
   * Keep the search expanded whenever there is an active search term — so
   * results stay visible alongside the box. Collapsing only happens when the
   * user blurs an empty input.
   */
  useEffect(() => {
    if (
      (debouncedSearchText.trim().length > 0 || selectedLabels.length > 0) &&
      !isSearchExpanded
    ) {
      setIsSearchExpanded(true);
    }
  }, [debouncedSearchText, selectedLabels]);

  useEffect(() => {
    // reset to first page whenever the active search term or labels change
    setCurrentPageNumber(1);
  }, [debouncedSearchText, selectedLabels]);

  /*
   * Auto-detect label support from the existing filters array. We look for
   * the filter whose `filterEntityType` class name is "Label" and reuse its
   * dropdown wiring (entity type, fetch query, label/value field names) so
   * search inherits whatever scoping the filter popup already had.
   */
  type LabelFilterConfig = {
    fieldKey: string;
    entityType: any;
    fetchQuery: any;
    labelField: string;
  };

  const labelFilterConfig: LabelFilterConfig | null = useMemo(() => {
    const filter: Filter<TBaseModel> | undefined = props.filters.find(
      (f: Filter<TBaseModel>) => {
        return (
          f.filterEntityType &&
          (f.filterEntityType as any).name === "Label" &&
          f.field &&
          f.filterDropdownField
        );
      },
    );
    if (!filter || !filter.field || !filter.filterDropdownField) {
      return null;
    }
    const fieldKey: string | undefined = Object.keys(filter.field)[0];
    if (!fieldKey) {
      return null;
    }
    return {
      fieldKey,
      entityType: filter.filterEntityType,
      fetchQuery: filter.filterQuery || {},
      labelField: filter.filterDropdownField.label,
    };
  }, [props.filters]);

  // Fetch labels on first search expansion if this resource supports them.
  useEffect(() => {
    if (!isSearchExpanded || !labelFilterConfig || labelsFetched) {
      return;
    }
    let cancelled: boolean = false;
    setIsLabelsLoading(true);
    (async () => {
      try {
        const result: ListResult<TBaseModel> = await props.callbacks.getList({
          modelType: labelFilterConfig.entityType,
          query: labelFilterConfig.fetchQuery,
          limit: 200,
          skip: 0,
          select: {
            _id: true,
            [labelFilterConfig.labelField]: true,
            color: true,
          } as any,
          sort: { [labelFilterConfig.labelField]: SortOrder.Ascending } as any,
        });
        if (cancelled) {
          return;
        }
        const mapped: Array<SearchLabelOption> = (result.data || [])
          .map((item: any) => {
            const raw: any = item;
            const colorAny: any = raw["color"];
            const colorHex: string =
              (colorAny &&
                (typeof colorAny === "string"
                  ? colorAny
                  : colorAny.value ||
                    (colorAny.toString && colorAny.toString()))) ||
              "#94a3b8";
            return {
              id: raw["_id"]?.toString() || "",
              name: (raw[labelFilterConfig.labelField] as string) || "",
              color: colorHex,
            } as SearchLabelOption;
          })
          .filter((l: SearchLabelOption) => {
            return l.id && l.name;
          });
        setAvailableLabels(mapped);
        setLabelsFetched(true);
      } catch {
        // Silently fail — search still works without label suggestions.
      } finally {
        if (!cancelled) {
          setIsLabelsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSearchExpanded, labelFilterConfig, labelsFetched]);

  const [showModel, setShowModal] = useState<boolean>(false);
  const [showFilterModal, setShowFilterModal] = useState<boolean>(false);
  const [modalType, setModalType] = useState<ModalType>(ModalType.Create);
  const [sortBy, setSortBy] = useState<keyof TBaseModel | null>(
    props.sortBy || null,
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    props.sortOrder || SortOrder.Ascending,
  );
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] =
    useState<boolean>(false);
  const [currentEditableItem, setCurrentEditableItem] =
    useState<TBaseModel | null>(null);
  const [currentDeleteableItem, setCurrentDeleteableItem] =
    useState<TBaseModel | null>(null);

  const [itemsOnPage, setItemsOnPage] = useState<number>(getItemsOnPage());

  useEffect(() => {
    // update items on page in localstorage.
    if (itemsOnPage && props.userPreferencesKey) {
      UserPreferences.saveUserPreferenceByTypeAsNumber({
        userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        key: props.userPreferencesKey,
        value: itemsOnPage,
      });
    }
  }, [itemsOnPage]);

  const [fields, setFields] = useState<Array<Field<TBaseModel>>>([]);

  const [isFilterFetchLoading, setIsFilterFetchLoading] = useState(false);

  const [errorModalText, setErrorModalText] = useState<string>("");

  useEffect(() => {
    const currentQuery: Query<TBaseModel> = propsQueryRef.current;
    const newQuery: Query<TBaseModel> = props.query || {};

    // only update if the query has changed.
    if (JSON.stringify(currentQuery) !== JSON.stringify(newQuery)) {
      propsQueryRef.current = newQuery;
      fetchItems().catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      });
    }
  }, [props.query]);

  useEffect(() => {
    if (!showModel) {
      props.onCreateEditModalClose?.();
    }
  }, [showModel]);

  useEffect(() => {
    const detailFields: Array<Field<TBaseModel>> = [];
    for (const column of tableColumns) {
      if (!column.key) {
        // if its an action column, ignore.
        continue;
      }

      detailFields.push({
        title: column.title,
        description: column.description || "",
        key: column.key as keyof TBaseModel,
        fieldType: column.type,
        colSpan: column.colSpan,
        contentClassName: column.contentClassName,
        alignItem: column.alignItem,
        hideOnMobile: column.hideOnMobile, // Propagate hideOnMobile property
        getElement: column.getElement
          ? (item: TBaseModel): ReactElement => {
              return column.getElement!(item, onBeforeFetchData);
            }
          : undefined,
      });

      setFields(detailFields);
    }
  }, [tableColumns]);

  type GetRelationSelectFunction = () => Select<TBaseModel>;

  const getRelationSelect: GetRelationSelectFunction =
    (): Select<TBaseModel> => {
      const relationSelect: Select<TBaseModel> = {};

      for (const column of props.columns || []) {
        const key: string | null = column.field
          ? (Object.keys(column.field)[0] as string)
          : null;

        if (key && model.isFileColumn(key)) {
          (relationSelect as JSONObject)[key] = {
            file: true,
            _id: true,
            fileType: true,
            name: true,
          };
        } else if (key && model.isEntityColumn(key)) {
          if (!(relationSelect as JSONObject)[key]) {
            (relationSelect as JSONObject)[key] = {};
          }

          (relationSelect as JSONObject)[key] = {
            ...((relationSelect as JSONObject)[key] as JSONObject),
            ...(column.field as any)[key],
          };
        }
      }

      return relationSelect;
    };

  type DeleteItemFunction = (item: TBaseModel) => Promise<void>;

  const deleteItem: DeleteItemFunction = async (item: TBaseModel) => {
    if (!item.id) {
      throw new BadDataException("item.id cannot be null");
    }

    setIsLoading(true);

    try {
      await props.callbacks.deleteItem(item);

      props.onItemDeleted?.(item);

      if (data.length === 1 && currentPageNumber > 1) {
        setCurrentPageNumber(currentPageNumber - 1);
      }
      await fetchItems();
    } catch (err) {
      setErrorModalText(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const serializeToTableColumns: VoidFunction = (): void => {
    // Convert ModelColumns to TableColumns.

    const columns: Array<TableColumn<TBaseModel>> = [];

    let selectFields: Select<TBaseModel> = {
      _id: true,
    };

    selectFields = props.callbacks.addSlugToSelect(selectFields);

    const userPermissions: Array<Permission> = getUserPermissions();

    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const column of props.columns || []) {
      const hasPermission: boolean =
        hasPermissionToReadColumn(column) || User.isMasterAdmin();
      const key: keyof TBaseModel | null = getColumnKey(column);

      if (hasPermission) {
        let tooltipText: ((item: TBaseModel) => string) | undefined = undefined;

        if (column.tooltipText) {
          tooltipText = (item: TBaseModel): string => {
            if (
              item instanceof BaseModel ||
              item instanceof AnalyticsBaseModel
            ) {
              return column.tooltipText!(item);
            }

            return column.tooltipText!(
              props.callbacks.getModelFromJSON(item as JSONObject),
            );
          };
        }

        // get filter options if they were already loaded

        const columnKey: keyof TBaseModel | null = column.selectedProperty
          ? (((key as string) +
              "." +
              column.selectedProperty) as keyof TBaseModel)
          : key;

        columns.push({
          ...column,
          disableSort: column.disableSort || shouldDisableSort(key),
          key: columnKey,
          tooltipText,
          getElement: column.getElement,
        });

        if (key) {
          selectFields[key] = true;
        }
      }
    }

    const selectMoreFields: Array<string> = props.selectMoreFields
      ? Object.keys(props.selectMoreFields)
      : [];

    for (const moreField of selectMoreFields) {
      let hasPermissionToSelectField: boolean = true;
      let fieldPermissions: Array<Permission> = [];
      fieldPermissions = accessControl[moreField as string]?.read || [];

      if (
        accessControl[moreField]?.read &&
        !PermissionHelper.doesPermissionsIntersect(
          userPermissions,
          fieldPermissions,
        )
      ) {
        hasPermissionToSelectField = false;
      }

      if (hasPermissionToSelectField) {
        (selectFields as Dictionary<boolean>)[moreField] = true;
      } else {
        Logger.warn(
          "User does not have read permissions to read - " + moreField,
        );
      }
    }

    const permissions: Array<Permission> | null =
      PermissionUtil.getAllPermissions();

    let showActionsColumn: boolean = Boolean(
      (permissions &&
        ((props.isDeleteable && model.hasDeletePermissions(permissions)) ||
          (props.isEditable && model.hasUpdatePermissions(permissions)) ||
          (props.isViewable && model.hasReadPermissions(permissions)))) ||
        (props.actionButtons && props.actionButtons.length > 0) ||
        props.showViewIdButton,
    );

    if (User.isMasterAdmin()) {
      if (
        (props.actionButtons && props.actionButtons.length > 0) ||
        props.showViewIdButton ||
        props.isDeleteable ||
        props.isEditable ||
        props.isViewable
      ) {
        showActionsColumn = true;
      }
    }

    if (showActionsColumn) {
      columns.push({
        title: tx("Actions"),
        type: FieldType.Actions,
      });
    }

    setActionSchema();
    setHeaderButtons();

    setColumns(columns);
  };

  const getFilterDropdownItems: PromiseVoidFunction =
    async (): Promise<void> => {
      setTableFilterError("");
      setIsFilterFetchLoading(true);

      const filters: Array<Filter<TBaseModel>> = [...props.filters];

      try {
        for (const filter of filters) {
          const key: keyof TBaseModel | null = getFilterKey(filter);

          if (!key) {
            continue;
          }

          if (!filter.filterEntityType) {
            continue;
          }

          if (!filter.filterDropdownField) {
            Logger.warn(
              `Cannot filter on ${key.toString()} because filter.dropdownField is not set.`,
            );
            continue;
          }

          const hasPermission: boolean = hasPermissionToReadFilter(filter);

          if (!hasPermission) {
            continue;
          }

          if (filter.fetchFilterDropdownOptions) {
            // fetch filter dropdown options.
            filter.filterDropdownOptions =
              await filter.fetchFilterDropdownOptions();
            continue;
          }

          const query: Query<TBaseModel> = filter.filterQuery || {};

          let colorColumnName: string | null = null;
          let accessControlColumnName: string | null = null;

          if (
            filter.filterEntityType &&
            filter.filterEntityType.prototype instanceof BaseModel
          ) {
            const filterModel: BaseModel =
              new (filter.filterEntityType as DatabaseBaseModelType)();
            colorColumnName = filterModel.getFirstColorColumn();
            accessControlColumnName = filterModel.getAccessControlColumn();
          }

          const select: Select<TBaseModel> = {
            [filter.filterDropdownField.label]: true,
            [filter.filterDropdownField.value]: true,
          } as Select<TBaseModel>;

          if (colorColumnName) {
            (select as Dictionary<boolean>)[colorColumnName] = true;
          }

          if (accessControlColumnName) {
            (select as Dictionary<JSONObject>)[accessControlColumnName] = {
              _id: true,
              name: true,
              color: true,
            } as JSONObject;
          }

          const listResult: ListResult<TBaseModel> =
            await props.callbacks.getList({
              modelType: filter.filterEntityType,
              query: query,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: select,
              sort: {},
            });

          filter.filterDropdownOptions = [];

          for (const item of listResult.data) {
            const option: DropdownOption = {
              value: item.getColumnValue(
                filter.filterDropdownField.value,
              ) as string,
              label: item.getColumnValue(
                filter.filterDropdownField.label,
              ) as string,
            };

            if (colorColumnName) {
              const colorValue: Color | string | null = item.getColumnValue(
                colorColumnName,
              ) as Color | string | null;

              if (colorValue instanceof Color) {
                option.color = colorValue;
              } else if (
                typeof colorValue === "string" &&
                colorValue.trim().length > 0
              ) {
                try {
                  option.color = new Color(colorValue);
                } catch {
                  // ignore invalid colors
                }
              }
            }

            if (accessControlColumnName) {
              const accessControlValue:
                | AccessControlModel
                | Array<AccessControlModel>
                | null =
                (item.getColumnValue(accessControlColumnName) as
                  | AccessControlModel
                  | Array<AccessControlModel>
                  | null) || null;

              const accessControlItems: Array<AccessControlModel> =
                Array.isArray(accessControlValue)
                  ? accessControlValue
                  : accessControlValue
                    ? [accessControlValue]
                    : [];

              type SimplifiedDropdownLabel = {
                id?: string;
                name: string;
                color?: Color;
              };

              const dropdownLabels: Array<SimplifiedDropdownLabel> =
                accessControlItems
                  .map((label: AccessControlModel | null) => {
                    if (!label) {
                      return null;
                    }

                    const labelNameRaw: string | null = label.getColumnValue(
                      "name",
                    ) as string | null;

                    if (!labelNameRaw) {
                      return null;
                    }

                    const labelName: string = labelNameRaw.toString().trim();

                    if (!labelName) {
                      return null;
                    }

                    const labelColorValue: Color | null = label.getColumnValue(
                      "color",
                    ) as Color | null;

                    const normalizedLabel: SimplifiedDropdownLabel = {
                      name: labelName,
                    };

                    const labelId: ObjectID | null = label.id;

                    if (labelId) {
                      normalizedLabel.id = labelId.toString();
                    }

                    if (labelColorValue) {
                      normalizedLabel.color = labelColorValue;
                    }

                    return normalizedLabel;
                  })
                  .filter(
                    (
                      label: SimplifiedDropdownLabel | null,
                    ): label is SimplifiedDropdownLabel => {
                      return label !== null;
                    },
                  );

              if (dropdownLabels.length > 0) {
                option.labels = dropdownLabels as Array<DropdownOptionLabel>;
              }
            }

            filter.filterDropdownOptions.push(option);
          }
        }

        const classicFilters: Array<ClassicFilterType<TBaseModel>> = filters
          .map((filter: Filter<TBaseModel>) => {
            const key: keyof TBaseModel | null = getFilterKey(filter);

            if (!key) {
              return null;
            }

            return {
              title: filter.title,
              filterDropdownOptions: filter.filterDropdownOptions,
              key: key,
              type: filter.type,
              jsonKeys: filter.jsonKeys,
              isAdvancedFilter: filter.isAdvancedFilter,
            };
          })
          .filter((filter: ClassicFilterType<TBaseModel> | null) => {
            return filter !== null;
          }) as Array<ClassicFilterType<TBaseModel>>;

        setClassicTableFilters(classicFilters);

        setHeaderButtons();
      } catch (err) {
        setTableFilterError(API.getFriendlyMessage(err));
      }

      setIsFilterFetchLoading(false);
    };

  type BuildSearchQueryFragmentFunction = () => Query<TBaseModel>;

  const buildSearchQueryFragment: BuildSearchQueryFragmentFunction =
    (): Query<TBaseModel> => {
      const fragment: Query<TBaseModel> = {};
      /*
       * Strip the trailing @<prefix> mention before searching — that token
       * is a label-autocomplete trigger, not part of the user's free-text
       * query.
       */
      const stripTrailingMention: (v: string) => string = (
        v: string,
      ): string => {
        const atIndex: number = v.lastIndexOf("@");
        if (atIndex < 0) {
          return v;
        }
        if (atIndex > 0) {
          const prev: string = v[atIndex - 1] || "";
          if (prev !== " " && prev !== "\t") {
            return v;
          }
        }
        const after: string = v.substring(atIndex + 1);
        if (
          after.includes(" ") ||
          after.includes("\t") ||
          after.includes("\n")
        ) {
          return v;
        }
        return v.substring(0, atIndex).trimEnd();
      };

      const effectiveSearch: string =
        stripTrailingMention(debouncedSearchText).trim();
      if (
        effectiveSearch.length > 0 &&
        props.searchableFields &&
        props.searchableFields.length > 0
      ) {
        (fragment as any)._multiFieldSearch = new MultiSearch({
          fields: props.searchableFields.map((f: keyof TBaseModel) => {
            return f as string;
          }),
          value: effectiveSearch,
        });
      }
      if (labelFilterConfig && selectedLabels.length > 0) {
        (fragment as any)[labelFilterConfig.fieldKey] = new Includes(
          selectedLabels.map((l: SearchLabelOption) => {
            return l.id;
          }),
        );
      }
      return fragment;
    };

  const fetchAllBulkItems: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const listResult: ListResult<TBaseModel> = await props.callbacks.getList({
        modelType: props.modelType as
          | DatabaseBaseModelType
          | AnalyticsBaseModelType,
        query: {
          ...props.query,
          ...query,
          ...buildSearchQueryFragment(),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
        },
        sort: {},
        requestOptions: props.fetchRequestOptions,
      });

      setBulkSelectedItems(listResult.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    if (props.onFetchInit) {
      props.onFetchInit(currentPageNumber, itemsOnPage);
    }

    if (props.onBeforeFetch) {
      const model: TBaseModel = await props.onBeforeFetch();
      setOnBeforeFetchData(model);
    }

    try {
      const listResult: ListResult<TBaseModel> = await props.callbacks.getList({
        modelType: props.modelType as
          | DatabaseBaseModelType
          | AnalyticsBaseModelType,
        query: {
          ...props.query,
          ...query,
          ...buildSearchQueryFragment(),
        },
        groupBy: {
          ...props.groupBy,
        },
        limit: itemsOnPage,
        skip: (currentPageNumber - 1) * itemsOnPage,
        select: {
          ...getSelect(),
          ...getRelationSelect(),
        },
        sort: sortBy
          ? {
              [sortBy as any]: sortOrder,
            }
          : {},
        requestOptions: props.fetchRequestOptions,
      });

      setTotalItemsCount(listResult.count);
      setHasMore(listResult.hasMore);
      setData(listResult.data);
      /*
       * Fire onFetchSuccess so consumers (e.g. the resource-owners hook)
       * can react to the loaded page. Previously the prop was declared
       * but never invoked, which broke per-row owner enrichment.
       */
      if (props.onFetchSuccess) {
        props.onFetchSuccess(listResult.data, listResult.count);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (showFilterModal) {
      getFilterDropdownItems().catch((err: Error) => {
        setTableFilterError(API.getFriendlyMessage(err));
      });
    }
  }, [showFilterModal, props.filters]);

  type GetSelectFunction = () => Select<TBaseModel>;

  const getSelect: GetSelectFunction = (): Select<TBaseModel> => {
    const selectFields: Select<TBaseModel> = {
      _id: true,
    };

    for (const column of props.columns || []) {
      const key: string | null = column.field
        ? (Object.keys(column.field)[0] as string)
        : null;

      if (key) {
        if (model.hasColumn(key)) {
          (selectFields as Dictionary<boolean>)[key] = true;
        } else {
          throw new BadDataException(
            `${key} column not found on ${model.singularName}`,
          );
        }
      }
    }

    const selectMoreFields: Array<keyof TBaseModel> = props.selectMoreFields
      ? (Object.keys(props.selectMoreFields) as Array<keyof TBaseModel>)
      : [];

    if (props.dragDropIndexField) {
      selectMoreFields.push(props.dragDropIndexField);
    }

    if (
      props.dragDropIdField &&
      !Object.keys(selectFields).includes(props.dragDropIdField as string) &&
      !selectMoreFields.includes(props.dragDropIdField)
    ) {
      selectMoreFields.push(props.dragDropIdField);
    }

    for (const moreField of selectMoreFields) {
      if (
        model.hasColumn(moreField as string) &&
        model.isEntityColumn(moreField as string)
      ) {
        (selectFields as Dictionary<boolean>)[moreField as string] = (
          props.selectMoreFields as any
        )[moreField];
      } else if (model.hasColumn(moreField as string)) {
        (selectFields as Dictionary<boolean>)[moreField as string] = true;
      } else {
        throw new BadDataException(
          `${moreField as string} column not found on ${model.singularName}`,
        );
      }
    }

    return selectFields;
  };

  const getSaveFilterDropdown: GetReactElementFunction = (): ReactElement => {
    if (!props.saveFilterProps) {
      return <></>;
    }

    if (props.saveFilterProps && props.saveFilterProps.tableId) {
      return (
        <TableViewElement
          tableId={props.saveFilterProps.tableId}
          tableView={tableView}
          currentQuery={query}
          currentSortBy={sortBy}
          currentItemsOnPage={itemsOnPage}
          currentSortOrder={sortOrder}
          currentFacetState={props.currentFacetState}
          onViewChange={async (tableView: TableView | null) => {
            setTableView(tableView);

            if (tableView) {
              const sortBy: string | undefined = Object.keys(
                tableView.sort || {},
              )[0];
              let sortOrder: SortOrder = SortOrder.Descending;

              if (sortBy && tableView.sort) {
                sortOrder =
                  ((tableView.sort as any)[sortBy as any] as any) ||
                  SortOrder.Descending;
              }

              // then set query, sort and items on the page
              setQuery(tableView.query || {});
              setFilterData(tableView.query || {});
              setItemsOnPage(tableView.itemsOnPage || 10);
              setSortBy((sortBy as keyof TBaseModel) || null);
              setSortOrder(sortOrder);
              setCurrentPageNumber(1);

              if (classicTableFilters.length === 0) {
                await getFilterDropdownItems();
              }

              if (props.onFacetStateRestored) {
                props.onFacetStateRestored(
                  (tableView.facets as JSONObject | undefined) || null,
                );
              }
            } else {
              setQuery({});
              setSortBy(null);
              setSortOrder(SortOrder.Descending);
              setItemsOnPage(10);
              setCurrentPageNumber(1);

              if (props.onFacetStateRestored) {
                props.onFacetStateRestored(null);
              }
            }
          }}
        />
      );
    }

    return <></>;
  };

  const setHeaderButtons: VoidFunction = (): void => {
    // add header buttons.
    let headerbuttons: Array<CardButtonSchema | ReactElement> = [];

    // Add documentation link button first if provided
    if (props.documentationLink) {
      headerbuttons.push({
        title: tx("View Documentation"),
        icon: IconProp.Book,
        buttonStyle: ButtonStyleType.HOVER_PRIMARY_OUTLINE,
        buttonSize: ButtonSize.Small,
        className: "hidden md:flex",
        onClick: () => {
          Navigation.navigate(props.documentationLink!, {
            openInNewTab: true,
          });
        },
      });
    }

    // Add help content button if provided
    if (props.helpContent) {
      headerbuttons.push({
        title: "",
        icon: IconProp.Help,
        buttonStyle: ButtonStyleType.ICON,
        buttonSize: ButtonSize.Small,
        className: "",
        onClick: () => {
          setShowHelpModal(true);
        },
      });
    }

    // Add video link button if provided
    if (props.videoLink) {
      headerbuttons.push({
        title: tx("Watch Demo"),
        icon: IconProp.Play,
        buttonStyle: ButtonStyleType.HOVER_PRIMARY_OUTLINE,
        buttonSize: ButtonSize.Small,
        className: "hidden md:flex",
        onClick: () => {
          Navigation.navigate(props.videoLink!, {
            openInNewTab: true,
          });
        },
      });
    }

    if (props.cardProps?.buttons && props.cardProps?.buttons.length > 0) {
      headerbuttons = [...headerbuttons, ...props.cardProps.buttons];
    }

    const permissions: Array<Permission> | null =
      PermissionUtil.getAllPermissions();

    let hasPermissionToCreate: boolean = false;

    if (permissions) {
      hasPermissionToCreate =
        model.hasCreatePermissions(permissions) || User.isMasterAdmin();
    }

    const showFilterButton: boolean = props.filters.length > 0;

    // because ordered list add button is inside the table and not on the card header.
    if (
      props.isCreateable &&
      hasPermissionToCreate &&
      showAs !== ShowAs.OrderedStatesList
    ) {
      headerbuttons.push({
        title: `${tx(props.createVerb || "Create")} ${tx(
          props.singularName || model.singularName || "",
        )}`,
        buttonStyle: ButtonStyleType.NORMAL,
        buttonSize: ButtonSize.Normal,
        className: "",
        onClick: () => {
          if (props.onCreateClick) {
            props.onCreateClick();
            return;
          }
          setModalType(ModalType.Create);
          setShowModal(true);
        },
        icon: IconProp.Add,
      });
    }

    if (props.showRefreshButton) {
      headerbuttons.push({
        ...getRefreshButton(),
        buttonSize: ButtonSize.Small,
        className: "",
        onClick: async () => {
          await fetchItems();
        },
        disabled: isFilterFetchLoading,
      });
    }

    if (showFilterButton) {
      headerbuttons.push({
        title: "",
        buttonStyle: ButtonStyleType.ICON,
        buttonSize: ButtonSize.Small,
        className: "",
        onClick: () => {
          setQuery({});
          setShowFilterModal(true);
        },
        disabled: isFilterFetchLoading,
        icon: IconProp.Filter,
      });
    }

    setCardButtons(headerbuttons);
  };

  useEffect(() => {
    fetchItems().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [
    currentPageNumber,
    sortBy,
    sortOrder,
    itemsOnPage,
    query,
    debouncedSearchText,
    selectedLabels,
    props.refreshToggle,
  ]);

  type ShouldDisableSortFunction = (
    columnName: keyof TBaseModel | null,
  ) => boolean;

  const shouldDisableSort: ShouldDisableSortFunction = (
    columnName: keyof TBaseModel | null,
  ): boolean => {
    if (!columnName) {
      return true;
    }

    return model.isEntityColumn(columnName as string);
  };

  type GetColumnKeyFunction = (
    column: ModelTableColumn<TBaseModel>,
  ) => keyof TBaseModel | null;

  const getColumnKey: GetColumnKeyFunction = (
    column: ModelTableColumn<TBaseModel>,
  ): keyof TBaseModel | null => {
    const key: keyof TBaseModel | null = column.field
      ? (Object.keys(column.field)[0] as keyof TBaseModel)
      : null;

    return key;
  };

  type GetFilterKeyFunction = (
    filter: Filter<TBaseModel>,
  ) => keyof TBaseModel | null;

  const getFilterKey: GetFilterKeyFunction = (
    filter: Filter<TBaseModel>,
  ): keyof TBaseModel | null => {
    const key: keyof TBaseModel | null = filter.field
      ? (Object.keys(filter.field)[0] as keyof TBaseModel)
      : null;

    return key;
  };

  type HasPermissionToReadColumnFunction = (
    column: ModelTableColumn<TBaseModel>,
  ) => boolean;

  const hasPermissionToReadColumn: HasPermissionToReadColumnFunction = (
    column: ModelTableColumn<TBaseModel>,
  ): boolean => {
    const key: keyof TBaseModel | null = getColumnKey(column);

    if (!key) {
      return true;
    }

    return hasPermissionToReadField(key);
  };

  type HasPermissionToReadFilterColumn = (
    filter: Filter<TBaseModel>,
  ) => boolean;

  const hasPermissionToReadFilter: HasPermissionToReadFilterColumn = (
    filter: Filter<TBaseModel>,
  ): boolean => {
    const key: keyof TBaseModel | null = getFilterKey(filter);

    if (!key) {
      return true;
    }

    return hasPermissionToReadField(key);
  };

  type HasPermissionToReadFieldFunction = (field: keyof TBaseModel) => boolean;

  const hasPermissionToReadField: HasPermissionToReadFieldFunction = (
    field: keyof TBaseModel,
  ): boolean => {
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    const userPermissions: Array<Permission> = getUserPermissions();

    const key: keyof TBaseModel = field;
    // check permissions.
    let hasPermission: boolean = false;

    if (!key) {
      hasPermission = true;
    }

    if (key) {
      hasPermission = true;
      let fieldPermissions: Array<Permission> = [];
      fieldPermissions = accessControl[key as string]?.read || [];

      if (
        accessControl[key]?.read &&
        !PermissionHelper.doesPermissionsIntersect(
          userPermissions,
          fieldPermissions,
        )
      ) {
        hasPermission = false;
      }
    }

    return hasPermission;
  };

  type GetUserPermissionsFunction = () => Array<Permission>;

  const getUserPermissions: GetUserPermissionsFunction =
    (): Array<Permission> => {
      let userPermissions: Array<Permission> =
        PermissionUtil.getGlobalPermissions()?.globalPermissions || [];
      if (
        PermissionUtil.getProjectPermissions() &&
        PermissionUtil.getProjectPermissions()?.permissions &&
        PermissionUtil.getProjectPermissions()!.permissions.length > 0
      ) {
        userPermissions = userPermissions.concat(
          PermissionUtil.getProjectPermissions()!.permissions.map(
            (i: UserPermission) => {
              return i.permission;
            },
          ),
        );
      }

      userPermissions.push(Permission.Public);

      return userPermissions;
    };

  useEffect(() => {
    serializeToTableColumns();
  }, []);

  useEffect(() => {
    serializeToTableColumns();
  }, [data]);

  /*
   * Re-serialize whenever the parent passes a new `columns` reference. The
   * column array carries `getElement` closures that capture parent state
   * (e.g. an owners map populated asynchronously). Without this, the cell
   * renders are frozen at first paint and never see updated state — which
   * is what made the Owners column stick on "Loading…" forever.
   */
  useEffect(() => {
    serializeToTableColumns();
  }, [props.columns]);

  const setActionSchema: VoidFunction = () => {
    const permissions: Array<Permission> = PermissionUtil.getAllPermissions();

    const actionsSchema: Array<ActionButtonSchema<TBaseModel>> = [];

    if (props.showViewIdButton) {
      actionsSchema.push({
        title: tx("Show ID"),
        buttonStyleType: ButtonStyleType.OUTLINE,
        hideOnMobile: true,
        onClick: async (
          item: TBaseModel,
          onCompleteAction: VoidFunction,
          onError: ErrorFunction,
        ) => {
          try {
            setViewId(item["_id"] as string);
            setShowViewIdModal(true);
            onCompleteAction();
          } catch (err) {
            onError(err as Error);
          }
        },
      });
    }

    // add actions buttons from props.
    if (props.actionButtons) {
      for (const moreSchema of props.actionButtons) {
        actionsSchema.push(moreSchema);
      }
    }

    if (permissions) {
      if (
        props.isViewable &&
        (model.hasReadPermissions(permissions) || User.isMasterAdmin())
      ) {
        actionsSchema.push({
          title: props.viewButtonText
            ? tx(props.viewButtonText)
            : `${tx("View")} ${tx(props.singularName || model.singularName || "")}`,
          buttonStyleType: ButtonStyleType.NORMAL,
          onClick: async (
            item: TBaseModel,
            onCompleteAction: VoidFunction,
            onError: ErrorFunction,
          ) => {
            try {
              let baseModel: TBaseModel = item;
              if (
                !(item instanceof BaseModel) &&
                !(item instanceof AnalyticsBaseModel)
              ) {
                baseModel = props.callbacks.getModelFromJSON(
                  item as JSONObject,
                );
              }

              if (props.onBeforeView) {
                item = await props.onBeforeView(baseModel);
              }

              if (props.onViewPage) {
                const route: Route | URL = await props.onViewPage(baseModel);

                onCompleteAction();

                if (props.onViewComplete) {
                  props.onViewComplete(baseModel);
                }

                return Navigation.navigate(route);
              }

              if (!props.viewPageRoute) {
                throw new BadDataException("props.viewPageRoute not found");
              }

              onCompleteAction();
              if (props.onViewComplete) {
                props.onViewComplete(baseModel);
              }

              const id: string = baseModel.id?.toString() || "";

              return Navigation.navigate(
                new Route(props.viewPageRoute.toString()).addRoute("/" + id),
              );
            } catch (err) {
              onError(err as Error);
            }
          },
        });
      }

      if (
        props.isEditable &&
        (model.hasUpdatePermissions(permissions) || User.isMasterAdmin())
      ) {
        actionsSchema.push({
          title: tx(props.editButtonText || "Edit"),
          buttonStyleType: ButtonStyleType.OUTLINE,
          onClick: async (
            item: TBaseModel,
            onCompleteAction: VoidFunction,
            onError: ErrorFunction,
          ) => {
            try {
              if (props.onBeforeEdit) {
                item = await props.onBeforeEdit(item);
              }

              setModalType(ModalType.Edit);
              setShowModal(true);
              setCurrentEditableItem(item);

              onCompleteAction();
            } catch (err) {
              onError(err as Error);
            }
          },
        });
      }

      if (
        props.isDeleteable &&
        (model.hasDeletePermissions(permissions) || User.isMasterAdmin())
      ) {
        actionsSchema.push({
          title: tx(props.deleteButtonText || "Delete"),
          icon: IconProp.Trash,
          buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
          onClick: async (
            item: TBaseModel,
            onCompleteAction: VoidFunction,
            onError: ErrorFunction,
          ) => {
            try {
              if (props.onBeforeDelete) {
                item = await props.onBeforeDelete(item);
              }

              setShowDeleteConfirmModal(true);
              setCurrentDeleteableItem(item);
              onCompleteAction();
            } catch (err) {
              onError(err as Error);
            }
          },
        });
      }
    }

    setActionButtonSchema(actionsSchema);
  };

  const [filterData, setFilterData] = useState<FilterData<TBaseModel>>(
    props.initialFilterData || {},
  );

  type OnFilterChangedFunction = (filterData: FilterData<TBaseModel>) => void;

  const onFilterChanged: OnFilterChangedFunction = (
    filterData: FilterData<TBaseModel>,
  ): void => {
    const newQuery: Query<TBaseModel> = {};

    setFilterData(filterData);
    setCurrentPageNumber(1);

    for (const key in filterData) {
      if (filterData[key] && typeof filterData[key] === Typeof.String) {
        newQuery[key as keyof TBaseModel] = (filterData[key] || "").toString();
      }

      if (typeof filterData[key] === Typeof.Boolean) {
        newQuery[key as keyof TBaseModel] = Boolean(filterData[key]);
      }

      if (typeof filterData[key] === Typeof.Number) {
        newQuery[key as keyof TBaseModel] = filterData[key];
      }

      if (filterData[key] instanceof Date) {
        newQuery[key as keyof TBaseModel] = filterData[key];
      }

      if (filterData[key] instanceof Search) {
        newQuery[key as keyof TBaseModel] = filterData[key];
      }

      if (filterData[key] instanceof InBetween) {
        newQuery[key as keyof TBaseModel] = filterData[key];
      }

      if (
        props.filters.find((f: Filter<TBaseModel>) => {
          return f.field && f.field[key];
        })?.type === FieldType.JSON &&
        typeof filterData[key] === Typeof.Object
      ) {
        newQuery[key as keyof TBaseModel] = filterData[key];
      }

      if (Array.isArray(filterData[key])) {
        newQuery[key as keyof TBaseModel] = new Includes(
          filterData[key] as Array<string>,
        );
      }

      /*
       * Pass any QueryOperator instance (IncludesAll, IncludesNone, StartsWith,
       * EndsWith, NotContains, EqualTo, NotEqual, GreaterThan, LessThan,
       * InBetween, IsNull, NotNull, ...) through to the query as-is.
       */
      if (filterData[key] instanceof QueryOperator) {
        newQuery[key as keyof TBaseModel] = filterData[key];
      }
    }

    setQuery({ ...newQuery });
  };

  /*
   * URL persistence for classic (column) filters, keyed by the table's
   * `saveFilterProps.tableId`. Mirrors the facet persistence in
   * `useResourceOwners` so filters survive navigating to a detail page and
   * back, and so a filtered view is shareable. `hasRestoredUrlFilters` is
   * state (not a ref) so the persist effect only runs after the restore has
   * been applied — never clobbering the snapshot with the empty default.
   */
  const [hasRestoredUrlFilters, setHasRestoredUrlFilters] =
    useState<boolean>(false);

  useEffect(() => {
    const restored: JSONObject | null = TableFilterUrlState.read(
      props.saveFilterProps?.tableId,
      "filter",
    );
    if (restored) {
      /*
       * Re-run through onFilterChanged so the derived query is rebuilt and the
       * first fetch uses the restored filters.
       */
      onFilterChanged(restored as unknown as FilterData<TBaseModel>);
    }
    setHasRestoredUrlFilters(true);
  }, []);

  useEffect(() => {
    if (!hasRestoredUrlFilters) {
      return;
    }
    TableFilterUrlState.write(
      props.saveFilterProps?.tableId,
      "filter",
      filterData as unknown as JSONObject,
    );
  }, [hasRestoredUrlFilters, filterData]);

  type GetDeleteBulkActionFunction = () => BulkActionButtonSchema<TBaseModel>;

  const getDeleteBulkAction: GetDeleteBulkActionFunction =
    (): BulkActionButtonSchema<TBaseModel> => {
      return {
        title: "Delete",
        buttonStyleType: ButtonStyleType.DANGER,
        icon: IconProp.Trash,
        confirmMessage: (items: Array<TBaseModel>) => {
          const itemLabel: string =
            items.length === 1
              ? props.singularName || model.singularName || "item"
              : props.pluralName || model.pluralName || "items";
          return `Are you sure you want to delete ${items.length} ${itemLabel}? This action cannot be undone.`;
        },
        confirmTitle: (items: Array<TBaseModel>) => {
          const itemLabel: string =
            items.length === 1
              ? props.singularName || model.singularName || "item"
              : props.pluralName || model.pluralName || "items";
          return `Delete ${items.length} ${itemLabel}`;
        },
        confirmButtonStyleType: ButtonStyleType.DANGER,
        onClick: async ({
          items,
          onProgressInfo,
          onBulkActionStart,
          onBulkActionEnd,
        }: BulkActionOnClickProps<TBaseModel>) => {
          onBulkActionStart();

          const inProgressItems: Array<TBaseModel> = [...items];
          const successItems: Array<TBaseModel> = [];
          const failedItems: Array<BulkActionFailed<TBaseModel>> = [];

          for (let i: number = 0; i < items.length; i++) {
            try {
              const item: TBaseModel = items[i]!;
              // remove items from inProgressItems
              inProgressItems.splice(inProgressItems.indexOf(item), 1);

              await props.callbacks.deleteItem(item);
              successItems.push(item);

              onProgressInfo({
                inProgressItems: inProgressItems,
                successItems: successItems,
                failed: failedItems,
                totalItems: items,
              });
            } catch (err) {
              failedItems.push({
                item: items[i]!,
                failedMessage: API.getFriendlyMessage(err),
              });
            }
          }

          onBulkActionEnd();
        },
      };
    };

  /*
   * When the load is driven by the search box, suppress the table-level
   * loading state so existing rows stay visible and the only spinner is
   * the one in the search bar. Sort / pagination / refresh loads still
   * show the table loader because there is no other indicator for those.
   */
  type ShouldSuppressTableLoadingFunction = () => boolean;
  const isSearchActive: ShouldSuppressTableLoadingFunction = (): boolean => {
    return debouncedSearchText.trim().length > 0 || selectedLabels.length > 0;
  };

  const getTableLoadingState: () => boolean = (): boolean => {
    return isSearchActive() ? false : isLoading;
  };

  const getTable: GetReactElementFunction = (): ReactElement => {
    return (
      <Table
        onFilterChanged={(filterData: FilterData<TBaseModel>) => {
          onFilterChanged(filterData);
          setTableView(null);

          // check if there's anything in the filter data and update the isFilterApplied prop.
          let isFilterApplied: boolean = false;

          for (const key in filterData) {
            if (filterData[key]) {
              isFilterApplied = true;
              break;
            }
          }

          if (props.onFilterApplied) {
            props.onFilterApplied(isFilterApplied);
          }
        }}
        filterData={filterData}
        className={
          props.cardProps
            ? ""
            : "rounded-lg border-2 border-gray-200 p-6 pt-0 pb-5"
        }
        tableContainerClassName={
          props.cardProps ? "" : "overflow-hidden rounded"
        }
        onFilterRefreshClick={async () => {
          await getFilterDropdownItems();
        }}
        bulkActions={(() => {
          const permissions: Array<Permission> =
            PermissionUtil.getAllPermissions();
          const userCanDelete: boolean =
            model.hasDeletePermissions(permissions);

          const sourceButtons: Array<
            BulkActionButtonSchema<TBaseModel> | ModalTableBulkDefaultActions
          > = [...(props.bulkActions?.buttons ?? [])];

          /*
           * Auto-include the default Delete bulk action whenever the user has
           * model-level delete permission, so every table that exposes row
           * selection also exposes a way to delete the selected rows. This is
           * intentionally decoupled from `isDeleteable` — that flag governs the
           * per-row Delete button in the Actions column, not bulk operations.
           * The confirmation modal is wired up via the schema's confirmMessage
           * / confirmTitle below. Skip if the table author already added it.
           */
          const alreadyHasDeleteAction: boolean = sourceButtons.some(
            (
              action:
                | BulkActionButtonSchema<TBaseModel>
                | ModalTableBulkDefaultActions,
            ) => {
              if (action === ModalTableBulkDefaultActions.Delete) {
                return true;
              }
              if (
                typeof action === "object" &&
                action !== null &&
                "title" in action &&
                (action as BulkActionButtonSchema<TBaseModel>).title ===
                  "Delete"
              ) {
                return true;
              }
              return false;
            },
          );
          if (userCanDelete && !alreadyHasDeleteAction) {
            sourceButtons.push(ModalTableBulkDefaultActions.Delete);
          }

          return {
            buttons: sourceButtons.map(
              (
                action:
                  | BulkActionButtonSchema<TBaseModel>
                  | ModalTableBulkDefaultActions,
              ) => {
                if (
                  action === ModalTableBulkDefaultActions.Delete &&
                  userCanDelete
                ) {
                  return getDeleteBulkAction();
                }
                return action;
              },
            ) as Array<BulkActionButtonSchema<TBaseModel>>,
          };
        })()}
        onBulkActionEnd={async () => {
          setBulkSelectedItems([]);
          await fetchItems();
        }}
        onBulkActionStart={() => {}}
        bulkSelectedItems={bulkSelectedItems}
        onBulkSelectedItemAdded={(item: TBaseModel) => {
          setBulkSelectedItems([...bulkSelectedItems, item]);
        }}
        onBulkSelectedItemRemoved={(item: TBaseModel) => {
          setBulkSelectedItems(
            bulkSelectedItems.filter((i: TBaseModel) => {
              return (
                i[matchBulkSelectedItemByField]?.toString() !==
                item[matchBulkSelectedItemByField]?.toString()
              );
            }),
          );
        }}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onBulkSelectItemsOnCurrentPage={() => {
          const items: TBaseModel[] = [...bulkSelectedItems, ...data];

          // remove duplicates

          const uniqueItems: TBaseModel[] = items.filter(
            (item: TBaseModel, index: number, self: Array<TBaseModel>) => {
              return (
                index ===
                self.findIndex((t: TBaseModel) => {
                  return (
                    t[matchBulkSelectedItemByField]?.toString() ===
                    item[matchBulkSelectedItemByField]?.toString()
                  );
                })
              );
            },
          );

          setBulkSelectedItems(uniqueItems);
        }}
        onBulkClearAllItems={() => {
          setBulkSelectedItems([]);
        }}
        onBulkSelectAllItems={async () => {
          await fetchAllBulkItems();
        }}
        matchBulkSelectedItemByField={matchBulkSelectedItemByField || "_id"}
        bulkItemToString={(item: TBaseModel) => {
          const label: string = props.singularName || item.singularName || "";
          const name: string =
            (item as unknown as Record<string, unknown>)["name"]?.toString() ||
            "";
          if (name) {
            return label ? `${label}: ${name}` : name;
          }
          const id: string =
            item[matchBulkSelectedItemByField]?.toString() || "";
          return label ? `${label} ${id}` : id;
        }}
        filters={classicTableFilters}
        filterError={tableFilterError}
        isFilterLoading={isFilterFetchLoading}
        showFilterModal={showFilterModal}
        onFilterModalClose={() => {
          setShowFilterModal(false);
        }}
        onFilterModalOpen={() => {
          setShowFilterModal(true);
        }}
        onAdvancedFiltersToggle={props.onAdvancedFiltersToggle}
        onSortChanged={(
          sortBy: keyof TBaseModel | null,
          sortOrder: SortOrder,
        ) => {
          setSortBy(sortBy);
          setSortOrder(sortOrder);
          setTableView(null);
        }}
        singularLabel={props.singularName || model.singularName || "Item"}
        pluralLabel={props.pluralName || model.pluralName || "Items"}
        error={error}
        currentPageNumber={currentPageNumber}
        isLoading={getTableLoadingState()}
        enableDragAndDrop={props.enableDragAndDrop}
        dragDropIdField={"_id"}
        dragDropIndexField={props.dragDropIndexField}
        totalItemsCount={totalItemsCount}
        hasMore={hasMore}
        data={data}
        id={props.id}
        columns={tableColumns}
        itemsOnPage={itemsOnPage}
        onDragDrop={async (id: string, newOrder: number) => {
          if (!props.dragDropIndexField) {
            return;
          }

          setIsLoading(true);

          await props.callbacks.updateById({
            id: new ObjectID(id),
            data: {
              [props.dragDropIndexField]: newOrder,
            },
          });

          await fetchItems();
        }}
        disablePagination={props.disablePagination || false}
        onNavigateToPage={async (
          pageNumber: number,
          newItemsOnPage: number,
        ) => {
          setCurrentPageNumber(pageNumber);

          if (newItemsOnPage !== itemsOnPage) {
            setTableView(null);
          }

          setItemsOnPage(newItemsOnPage);
        }}
        noItemsMessage={props.noItemsMessage || ""}
        onRefreshClick={async () => {
          await fetchItems();
        }}
        actionButtons={actionButtonSchema}
      />
    );
  };

  const getOrderedStatesList: GetReactElementFunction = (): ReactElement => {
    if (!props.orderedStatesListProps) {
      throw new BadDataException(
        "props.orderedStatesListProps required when showAs === ShowAs.OrderedStatesList",
      );
    }

    let getTitleElement:
      | ((
          item: TBaseModel,
          onBeforeFetchData?: TBaseModel | undefined,
        ) => ReactElement)
      | undefined = undefined;

    let getDescriptionElement:
      | ((item: TBaseModel) => ReactElement)
      | undefined = undefined;

    for (const column of props.columns) {
      const key: string | undefined = Object.keys(
        column.field as SelectEntityField<TBaseModel>,
      )[0];

      if (key === props.orderedStatesListProps.titleField) {
        getTitleElement = column.getElement;
      }

      if (key === props.orderedStatesListProps.descriptionField) {
        getDescriptionElement = column.getElement;
      }
    }

    return (
      <OrderedStatesList<TBaseModel>
        error={error}
        isLoading={isLoading}
        data={data}
        id={props.id}
        titleField={props.orderedStatesListProps?.titleField}
        descriptionField={props.orderedStatesListProps?.descriptionField}
        orderField={props.orderedStatesListProps?.orderField}
        shouldAddItemInTheBeginning={
          props.orderedStatesListProps.shouldAddItemInTheBeginning
        }
        shouldAddItemInTheEnd={
          props.orderedStatesListProps.shouldAddItemInTheEnd
        }
        noItemsMessage={props.noItemsMessage || ""}
        onRefreshClick={async () => {
          await fetchItems();
        }}
        onCreateNewItem={
          props.isCreateable
            ? (order: number) => {
                setOrderedStatesListNewItemOrder(order);
                setModalType(ModalType.Create);
                setShowModal(true);
              }
            : undefined
        }
        singularLabel={props.singularName || model.singularName || "Item"}
        actionButtons={actionButtonSchema}
        getTitleElement={getTitleElement}
        getDescriptionElement={getDescriptionElement}
      />
    );
  };

  const getList: GetReactElementFunction = (): ReactElement => {
    return (
      <List
        onFilterChanged={(filterData: FilterData<TBaseModel>) => {
          onFilterChanged(filterData);
        }}
        onFilterRefreshClick={async () => {
          await getFilterDropdownItems();
        }}
        filters={classicTableFilters}
        filterError={tableFilterError}
        isFilterLoading={isFilterFetchLoading}
        showFilterModal={showFilterModal}
        onFilterModalClose={() => {
          setShowFilterModal(false);
        }}
        onFilterModalOpen={() => {
          setShowFilterModal(true);
        }}
        onAdvancedFiltersToggle={props.onAdvancedFiltersToggle}
        singularLabel={props.singularName || model.singularName || "Item"}
        pluralLabel={props.pluralName || model.pluralName || "Items"}
        error={error}
        currentPageNumber={currentPageNumber}
        listDetailOptions={props.listDetailOptions}
        enableDragAndDrop={props.enableDragAndDrop}
        onDragDrop={async (id: string, newOrder: number) => {
          if (!props.dragDropIndexField) {
            return;
          }

          setIsLoading(true);

          await props.callbacks.updateById({
            id: new ObjectID(id),
            data: {
              [props.dragDropIndexField]: newOrder,
            },
          });

          await fetchItems();
        }}
        dragDropIdField={"_id"}
        dragDropIndexField={props.dragDropIndexField}
        isLoading={getTableLoadingState()}
        totalItemsCount={totalItemsCount}
        hasMore={hasMore}
        data={data}
        id={props.id}
        fields={fields}
        itemsOnPage={itemsOnPage}
        disablePagination={props.disablePagination || false}
        onNavigateToPage={async (pageNumber: number, itemsOnPage: number) => {
          setCurrentPageNumber(pageNumber);
          setItemsOnPage(itemsOnPage);
        }}
        noItemsMessage={props.noItemsMessage || ""}
        onRefreshClick={async () => {
          await fetchItems();
        }}
        actionButtons={actionButtonSchema}
      />
    );
  };

  type GetCardTitleFunction = (title: ReactElement | string) => ReactElement;

  const getCardTitle: GetCardTitleFunction = (
    title: ReactElement | string,
  ): ReactElement => {
    const renderedTitle: ReactElement | string =
      typeof title === "string"
        ? (translateValue(title) as ReactElement | string | undefined) ?? title
        : title;
    const plan: PlanType | null = ProjectUtil.getCurrentPlan();

    let showPlan: boolean = Boolean(
      BILLING_ENABLED &&
        plan &&
        new props.modelType().getReadBillingPlan() &&
        !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
          new props.modelType().getReadBillingPlan()!,
          plan,
          getAllEnvVars(),
        ),
    );

    let planName: string = new props.modelType().getReadBillingPlan()!;

    if (props.isCreateable && !showPlan) {
      // if createable then read create billing permissions.
      showPlan = Boolean(
        BILLING_ENABLED &&
          plan &&
          new props.modelType().getCreateBillingPlan() &&
          !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
            new props.modelType().getCreateBillingPlan()!,
            plan,
            getAllEnvVars(),
          ),
      );

      planName = new props.modelType().getCreateBillingPlan()!;
    }

    return (
      <span>
        {renderedTitle}
        {showPlan && (
          <span
            style={{
              marginLeft: "5px",
            }}
          >
            <Pill text={`${planName} Plan`} color={Yellow} />
          </span>
        )}
      </span>
    );
  };

  type CollapseSearchFunction = () => void;

  const collapseSearch: CollapseSearchFunction = (): void => {
    setSearchText("");
    setSelectedLabels([]);
    setIsSearchExpanded(false);
  };

  /*
   * Find the trailing `@<prefix>` mention in the input. A mention is only
   * recognised when `@` is at the start of the value or follows whitespace,
   * and only when there is no whitespace after it — matches typical chat
   * mention semantics.
   */
  type MentionParseResult = {
    hasMention: boolean;
    prefix: string;
    atIndex: number;
  };

  const parseLabelMention: (value: string) => MentionParseResult = (
    value: string,
  ): MentionParseResult => {
    const atIndex: number = value.lastIndexOf("@");
    if (atIndex < 0) {
      return { hasMention: false, prefix: "", atIndex: -1 };
    }
    if (atIndex > 0) {
      const prev: string = value[atIndex - 1] || "";
      if (prev !== " " && prev !== "\t") {
        return { hasMention: false, prefix: "", atIndex: -1 };
      }
    }
    const after: string = value.substring(atIndex + 1);
    if (after.includes(" ") || after.includes("\t") || after.includes("\n")) {
      return { hasMention: false, prefix: "", atIndex: -1 };
    }
    return { hasMention: true, prefix: after, atIndex };
  };

  type AddLabelFunction = (label: SearchLabelOption) => void;

  const addLabel: AddLabelFunction = (label: SearchLabelOption): void => {
    setSelectedLabels((prev: Array<SearchLabelOption>) => {
      if (
        prev.find((l: SearchLabelOption) => {
          return l.id === label.id;
        })
      ) {
        return prev;
      }
      return [...prev, label];
    });
    // Strip the `@<prefix>` token from the input.
    const mention: MentionParseResult = parseLabelMention(searchText);
    if (mention.hasMention) {
      const before: string = searchText.substring(0, mention.atIndex);
      setSearchText(before.replace(/\s+$/, ""));
    }
    setLabelDropdownIndex(0);
  };

  type RemoveLabelFunction = (labelId: string) => void;

  const removeLabel: RemoveLabelFunction = (labelId: string): void => {
    setSelectedLabels((prev: Array<SearchLabelOption>) => {
      return prev.filter((l: SearchLabelOption) => {
        return l.id !== labelId;
      });
    });
  };

  const getSearchControl: GetReactElementFunction = (): ReactElement => {
    if (!props.searchableFields || props.searchableFields.length === 0) {
      return <></>;
    }

    const pluralLabel: string = (
      props.pluralName ||
      model.pluralName ||
      "items"
    ).toLowerCase();

    const hasLabelSupport: boolean = Boolean(labelFilterConfig);

    const defaultPlaceholder: string = hasLabelSupport
      ? `Search ${pluralLabel}… (try @ for labels)`
      : `Search ${pluralLabel} by name, description…`;
    const placeholder: string = props.searchPlaceholder || defaultPlaceholder;

    /*
     * Effective search = input minus the trailing @<prefix> mention. The pill
     * + result-count UI should reflect this so typing "@bug" doesn't claim
     * "0 matches" before the user has actually committed the label.
     */
    const stripTrailingMentionForUi: (v: string) => string = (
      v: string,
    ): string => {
      const m: MentionParseResult = parseLabelMention(v);
      return m.hasMention ? v.substring(0, m.atIndex).trimEnd() : v;
    };

    const trimmedSearch: string = stripTrailingMentionForUi(searchText).trim();
    const trimmedActive: string =
      stripTrailingMentionForUi(debouncedSearchText).trim();
    const hasActiveSearch: boolean = trimmedActive.length > 0;
    const hasSelectedLabels: boolean = selectedLabels.length > 0;
    /*
     * "isSearching" covers both phases — typing-in-flight (before the
     * debounce fires) AND the actual API request that follows. The table
     * loader is suppressed during the latter, so this spinner is the only
     * loading indicator the user sees during a search-driven fetch.
     */
    const isTypingInFlight: boolean =
      trimmedSearch.length > 0 && trimmedSearch !== trimmedActive;
    const isSearching: boolean =
      isTypingInFlight || (isLoading && (hasActiveSearch || hasSelectedLabels));
    const showMatchPill: boolean =
      !isSearching && (hasActiveSearch || hasSelectedLabels);

    const expanded: boolean =
      isSearchExpanded || hasActiveSearch || hasSelectedLabels;

    const mention: MentionParseResult = parseLabelMention(searchText);
    const showLabelDropdown: boolean =
      hasLabelSupport && isSearchFocused && mention.hasMention;

    const lowerPrefix: string = mention.prefix.toLowerCase();
    const dropdownLabels: Array<SearchLabelOption> = availableLabels
      .filter((l: SearchLabelOption) => {
        return !selectedLabels.find((s: SearchLabelOption) => {
          return s.id === l.id;
        });
      })
      .filter((l: SearchLabelOption) => {
        return (
          lowerPrefix.length === 0 ||
          l.name.toLowerCase().startsWith(lowerPrefix)
        );
      })
      .slice(0, 8);

    const borderClass: string = isSearchFocused
      ? "border-gray-400 ring-4 ring-gray-100 shadow-sm"
      : hasActiveSearch || hasSelectedLabels
        ? "border-gray-300 shadow-sm"
        : "border-gray-200 shadow-sm";

    const iconColorClass: string =
      isSearchFocused || hasActiveSearch || hasSelectedLabels
        ? "text-gray-700"
        : "text-gray-400";

    type SelectDropdownItemAtIndexFunction = (idx: number) => void;
    const selectDropdownItemAt: SelectDropdownItemAtIndexFunction = (
      idx: number,
    ): void => {
      const item: SearchLabelOption | undefined = dropdownLabels[idx];
      if (item) {
        addLabel(item);
      }
    };

    return (
      <div className="relative flex w-full items-center">
        {/* Expanded input + dropdown — sized to the full title slot */}
        <div className="relative flex w-full flex-col gap-1">
          <div
            className={`flex w-full items-center gap-2 rounded-md border bg-white px-3 py-2 transition-all duration-200 ${borderClass}`}
            onClick={() => {
              searchInputRef.current?.focus();
            }}
            role="presentation"
          >
            <Icon
              icon={IconProp.Search}
              className={`h-4 w-4 flex-none transition-colors duration-200 ${iconColorClass}`}
            />
            {/* Pills + input wrap row */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {selectedLabels.map((label: SearchLabelOption) => {
                return (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-50 py-0.5 pl-2 pr-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200 transition-all hover:bg-gray-100"
                    title={`Label: ${label.name}`}
                  >
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ backgroundColor: label.color }}
                      aria-hidden="true"
                    />
                    <span className="max-w-[8rem] truncate">{label.name}</span>
                    <button
                      type="button"
                      onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
                        e.preventDefault();
                      }}
                      onClick={() => {
                        removeLabel(label.id);
                      }}
                      title="Remove label"
                      aria-label={`Remove ${label.name}`}
                      className="ml-0.5 flex-none rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                    >
                      <Icon icon={IconProp.Close} className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              <input
                ref={searchInputRef}
                type="text"
                value={searchText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setSearchText(e.target.value);
                  setLabelDropdownIndex(0);
                }}
                onFocus={() => {
                  setIsSearchFocused(true);
                }}
                onBlur={() => {
                  setIsSearchFocused(false);
                  /*
                   * Collapse only when the user blurs with nothing active —
                   * no text and no selected labels.
                   */
                  if (
                    searchText.trim().length === 0 &&
                    selectedLabels.length === 0
                  ) {
                    setIsSearchExpanded(false);
                  }
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (showLabelDropdown && dropdownLabels.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setLabelDropdownIndex((i: number) => {
                        return Math.min(i + 1, dropdownLabels.length - 1);
                      });
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setLabelDropdownIndex((i: number) => {
                        return Math.max(i - 1, 0);
                      });
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      selectDropdownItemAt(labelDropdownIndex);
                      return;
                    }
                  }
                  if (e.key === "Backspace" && searchText.length === 0) {
                    // Pop last label when backspacing on empty input.
                    if (selectedLabels.length > 0) {
                      const last: SearchLabelOption | undefined =
                        selectedLabels[selectedLabels.length - 1];
                      if (last) {
                        removeLabel(last.id);
                      }
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    if (showLabelDropdown) {
                      // Just cancel the @ mention parse — clear @ prefix.
                      const m: MentionParseResult =
                        parseLabelMention(searchText);
                      if (m.hasMention) {
                        setSearchText(
                          searchText
                            .substring(0, m.atIndex)
                            .replace(/\s+$/, ""),
                        );
                      }
                      return;
                    }
                    if (searchText) {
                      setSearchText("");
                    } else if (selectedLabels.length > 0) {
                      setSelectedLabels([]);
                    } else {
                      collapseSearch();
                      searchInputRef.current?.blur();
                    }
                  }
                }}
                placeholder={
                  selectedLabels.length === 0 ? placeholder : "Refine search…"
                }
                spellCheck={false}
                autoComplete="off"
                tabIndex={expanded ? 0 : -1}
                className="min-w-[6rem] flex-1 bg-transparent text-sm leading-5 text-gray-900 placeholder-gray-400 outline-none"
              />
            </div>
            {isSearching && (
              <div className="flex-none text-gray-400" title="Searching…">
                <Icon
                  icon={IconProp.Spinner}
                  className="h-4 w-4 animate-spin"
                />
              </div>
            )}
            {showMatchPill && totalItemsCount >= 0 && hasMore === undefined && (
              <span
                className="flex-none whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                title={`${totalItemsCount} ${totalItemsCount === 1 ? "result" : "results"}`}
              >
                {totalItemsCount} {totalItemsCount === 1 ? "match" : "matches"}
              </span>
            )}
            {showMatchPill && hasMore !== undefined && data.length > 0 && (
              <span
                className="flex-none whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                title={`${data.length}${hasMore ? "+" : ""} ${
                  data.length === 1 ? "result" : "results"
                } on this page`}
              >
                {data.length}
                {hasMore ? "+" : ""} {data.length === 1 ? "match" : "matches"}
              </span>
            )}
            {searchText.length > 0 || selectedLabels.length > 0 ? (
              <button
                type="button"
                onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
                  e.preventDefault();
                }}
                onClick={() => {
                  collapseSearch();
                }}
                title="Clear search (Esc Esc)"
                aria-label="Clear search"
                className="flex-none rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd
                className="hidden flex-none select-none items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-gray-500 sm:inline-flex"
                title="Press / to focus search"
              >
                /
              </kbd>
            )}
          </div>

          {/* Label suggestion dropdown */}
          {showLabelDropdown && (
            <div
              className="absolute left-0 right-0 top-full z-20 mt-1.5 origin-top overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 transition-all duration-150 animate-in fade-in slide-in-from-top-1"
              onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
                // Prevent input blur on dropdown clicks.
                e.preventDefault();
              }}
            >
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  {isLabelsLoading ? "Loading labels…" : "Filter by label"}
                </span>
                <span className="text-[10px] text-gray-400">
                  <kbd className="font-mono">↑</kbd>
                  <kbd className="ml-0.5 font-mono">↓</kbd>
                  <span className="ml-1">to navigate</span>
                  <span className="mx-1.5">·</span>
                  <kbd className="font-mono">↵</kbd>
                  <span className="ml-1">to select</span>
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {!isLabelsLoading && dropdownLabels.length === 0 && (
                  <div className="px-3 py-3 text-sm text-gray-500">
                    {availableLabels.length === 0
                      ? "No labels available for this resource."
                      : `No labels matching "${mention.prefix}"`}
                  </div>
                )}
                {dropdownLabels.map((label: SearchLabelOption, idx: number) => {
                  const isActive: boolean = idx === labelDropdownIndex;
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onMouseEnter={() => {
                        setLabelDropdownIndex(idx);
                      }}
                      onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
                        e.preventDefault();
                      }}
                      onClick={() => {
                        addLabel(label);
                        searchInputRef.current?.focus();
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                        isActive
                          ? "bg-gray-100 text-gray-900"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 flex-none rounded-full ring-1 ring-inset ring-black/5"
                        style={{ backgroundColor: label.color }}
                        aria-hidden="true"
                      />
                      <span className="flex-1 truncate">{label.name}</span>
                      {isActive && (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                          ↵
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  type GetHeaderButtonsFunction = () => Array<CardButtonSchema | ReactElement>;

  /*
   * Returns the buttons array passed to Card. When search support is enabled
   * we add a standalone search-trigger icon to the end of the row. We do
   * NOT collapse the other buttons here — the expanded search bar lives in
   * the title slot (see getExpandedSearchTitle), so existing buttons like
   * Refresh / Filter / Create remain accessible while searching.
   */
  /*
   * The "primary" button is the one with NORMAL style and the Add icon — the
   * Create button that BaseModelTable injects automatically. We surface it
   * alongside the search bar and hide everything else behind a kebab menu.
   * If the page has no such button we fall back to the first NORMAL- or
   * PRIMARY-styled one. PRIMARY is treated as a main candidate because it
   * explicitly marks a primary action (e.g. "Run Runbook") — hiding it in
   * the overflow menu defeats the purpose of the style.
   */
  type FindMainButtonResult = {
    main: CardButtonSchema | null;
    rest: Array<CardButtonSchema | ReactElement>;
  };

  const splitButtonsForHeader: (
    buttons: Array<CardButtonSchema | ReactElement>,
  ) => FindMainButtonResult = (
    buttons: Array<CardButtonSchema | ReactElement>,
  ): FindMainButtonResult => {
    let mainIndex: number = -1;
    for (let i: number = 0; i < buttons.length; i++) {
      const b: CardButtonSchema | ReactElement = buttons[i]!;
      if (React.isValidElement(b)) {
        continue;
      }
      const c: CardButtonSchema = b as CardButtonSchema;
      if (c.buttonStyle === ButtonStyleType.NORMAL && c.icon === IconProp.Add) {
        mainIndex = i;
        break;
      }
    }
    if (mainIndex < 0) {
      for (let i: number = 0; i < buttons.length; i++) {
        const b: CardButtonSchema | ReactElement = buttons[i]!;
        if (React.isValidElement(b)) {
          continue;
        }
        const style: ButtonStyleType | undefined = (b as CardButtonSchema)
          .buttonStyle;
        if (
          style === ButtonStyleType.NORMAL ||
          style === ButtonStyleType.PRIMARY
        ) {
          mainIndex = i;
          break;
        }
      }
    }
    if (mainIndex < 0) {
      return { main: null, rest: buttons };
    }
    const main: CardButtonSchema = buttons[mainIndex] as CardButtonSchema;
    const rest: Array<CardButtonSchema | ReactElement> = [
      ...buttons.slice(0, mainIndex),
      ...buttons.slice(mainIndex + 1),
    ];
    return { main, rest };
  };

  const renderMainButton: (b: CardButtonSchema) => ReactElement = (
    b: CardButtonSchema,
  ): ReactElement => {
    return (
      <Button
        key="model-table-main-action"
        title={b.title}
        buttonStyle={b.buttonStyle}
        buttonSize={b.buttonSize}
        className={b.className}
        onClick={() => {
          b.onClick?.();
        }}
        disabled={b.disabled}
        icon={b.icon}
        shortcutKey={b.shortcutKey}
        dataTestId="card-button"
        isLoading={b.isLoading}
      />
    );
  };

  /*
   * Icon-only card buttons (Refresh, Filter, …) have empty titles, so derive
   * a label from the icon for the More menu.
   */
  // Fallback labels for icon-only buttons (Refresh, Filter, ...) in the More menu.
  const labelForIconButton: (icon: IconProp | undefined) => string = (
    icon: IconProp | undefined,
  ): string => {
    switch (icon) {
      case IconProp.Refresh:
        return "Refresh";
      case IconProp.Filter:
        return "Filter";
      case IconProp.Add:
        return "Add";
      case IconProp.Help:
        return "Help";
      case IconProp.Book:
        return "Documentation";
      case IconProp.Play:
        return "Watch Demo";
      case IconProp.Search:
        return "Search";
      default:
        return "Action";
    }
  };

  const renderMoreMenu: (
    items: Array<CardButtonSchema | ReactElement>,
  ) => ReactElement | null = (
    items: Array<CardButtonSchema | ReactElement>,
  ): ReactElement | null => {
    if (items.length === 0) {
      return null;
    }
    const children: Array<ReactElement> = items.map(
      (item: CardButtonSchema | ReactElement, idx: number) => {
        if (React.isValidElement(item)) {
          return (
            <div key={`more-${idx}`} className="px-2 py-1">
              {item}
            </div>
          );
        }
        const b: CardButtonSchema = item as CardButtonSchema;
        const label: string = b.title || labelForIconButton(b.icon);
        return (
          <MoreMenuItem
            key={`more-${idx}`}
            text={label}
            icon={b.icon}
            onClick={() => {
              if (!b.disabled) {
                b.onClick?.();
              }
            }}
            className={b.disabled ? "opacity-40 pointer-events-none" : ""}
          />
        );
      },
    );

    return (
      <MoreMenu
        key="model-table-more-menu"
        menuIcon={IconProp.EllipsisHorizontal}
        text=""
      >
        {children}
      </MoreMenu>
    );
  };

  /*
   * Builds the right-hand side of the card header. All slots — search
   * trigger/bar, saved views, main button, more menu — stay mounted at all
   * times. State transitions are purely CSS so the inputs keep their focus,
   * the dropdown keeps its open state, and there's no mount/unmount flicker.
   *
   * Layout when collapsed:  [🔍 trigger] [Saved Views] [main] [⋯]
   * Layout when expanded:   [🔍 ━━━ wide search bar ━━━]
   * Saved views + main button + more menu fade and collapse-to-zero-width
   * when the search expands, freeing horizontal space for the bar.
   */
  const getHeaderButtonsWithSearch: GetHeaderButtonsFunction = (): Array<
    CardButtonSchema | ReactElement
  > => {
    const hasSearch: boolean = Boolean(
      props.searchableFields && props.searchableFields.length > 0,
    );

    /*
     * Saved views get their own first-class slot in the header — never
     * collapsed into the overflow ⋯ menu. Render fresh on every call so the
     * inner TableViewElement always sees the current query / sort / itemsOnPage.
     */
    const savedViewsElement: ReactElement | null = props.saveFilterProps
      ? getSaveFilterDropdown()
      : null;

    if (cardButtons.length === 0 && !hasSearch) {
      return savedViewsElement ? [savedViewsElement] : cardButtons;
    }

    if (!hasSearch) {
      // Without search, just split into [Saved Views] [main] [⋯]; no special wrapping.
      const { main, rest }: FindMainButtonResult =
        splitButtonsForHeader(cardButtons);
      const composed: Array<ReactElement> = [];
      if (savedViewsElement) {
        composed.push(savedViewsElement);
      }
      if (main) {
        composed.push(renderMainButton(main));
      }
      const moreMenu: ReactElement | null = renderMoreMenu(rest);
      if (moreMenu) {
        composed.push(moreMenu);
      }
      return composed;
    }

    const trimmedActive: string = debouncedSearchText.trim();
    const isExpanded: boolean =
      isSearchExpanded || trimmedActive.length > 0 || selectedLabels.length > 0;

    const { main, rest }: FindMainButtonResult =
      splitButtonsForHeader(cardButtons);
    const moreMenu: ReactElement | null = renderMoreMenu(rest);

    const wrapped: ReactElement = (
      <div key="model-table-header-actions" className="flex items-center gap-3">
        {/*
         * Search slot — a compact pill showing "Search …    /" by default,
         * grown into the full search bar when expanded. Always advertising
         * itself (rather than starting as a tiny icon) reads as a more
         * polished search affordance, in line with Stripe / Linear / GitHub.
         */}
        <div
          className={`relative shrink-0 transition-[width] duration-300 ease-out ${
            isExpanded ? "w-[22rem] sm:w-[26rem] lg:w-[32rem]" : "w-44 sm:w-56"
          }`}
        >
          {/* Trigger (collapsed state) */}
          <button
            type="button"
            onClick={() => {
              setIsSearchExpanded(true);
              requestAnimationFrame(() => {
                searchInputRef.current?.focus();
              });
            }}
            title="Search (/)"
            aria-label="Open search"
            tabIndex={isExpanded ? -1 : 0}
            className={`absolute inset-0 inline-flex items-center gap-2 rounded-md border bg-white px-3 text-sm shadow-sm transition-all duration-200 ease-out ${
              isExpanded
                ? "pointer-events-none border-gray-200 opacity-0"
                : "border-gray-200 opacity-100 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <Icon
              icon={IconProp.Search}
              className="h-4 w-4 flex-none text-gray-400"
            />
            <span className="flex-1 truncate text-left text-gray-400">
              Search…
            </span>
            <kbd className="hidden flex-none select-none items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-gray-500 sm:inline-flex">
              /
            </kbd>
          </button>

          {/* Expanded search bar */}
          <div
            className={`transition-opacity duration-200 ease-out ${
              isExpanded
                ? "opacity-100 delay-150"
                : "pointer-events-none opacity-0"
            }`}
          >
            {getSearchControl()}
          </div>
        </div>

        {/*
         * Buttons that collapse when the bar expands. We avoid
         * `overflow-hidden` here — the MoreMenu dropdown is an absolutely
         * positioned child of one of these buttons and would otherwise get
         * clipped by an `overflow-hidden` ancestor, leaving the user with
         * an apparent "no menu appears" bug when they click ⋯. The wrapper
         * is hidden via opacity + pointer-events instead, and its width
         * collapses by setting both `max-width` and `gap` to 0 so the
         * search slot to the left can grow into the freed space.
         */}
        <div
          className={`flex items-center transition-all duration-300 ease-out [&_button]:md:ml-0 ${
            isExpanded
              ? "max-w-0 -ml-3 gap-0 opacity-0 pointer-events-none"
              : "max-w-[600px] gap-3 opacity-100"
          }`}
          aria-hidden={isExpanded}
        >
          {savedViewsElement}
          {main && renderMainButton(main)}
          {moreMenu}
        </div>
      </div>
    );

    return [wrapped];
  };

  /*
   * Title slot stays unchanged — the search bar lives in the buttons row.
   * The wrapping function is kept for symmetry / future styling but is a
   * pass-through today.
   */
  type GetCardHeaderTitleFunction = (
    originalTitle: ReactElement,
  ) => ReactElement;

  const getCardHeaderTitle: GetCardHeaderTitleFunction = (
    originalTitle: ReactElement,
  ): ReactElement => {
    return originalTitle;
  };

  const getCardComponent: GetReactElementFunction = (): ReactElement => {
    const headerButtons: Array<CardButtonSchema | ReactElement> =
      getHeaderButtonsWithSearch();

    if (showAs === ShowAs.Table || showAs === ShowAs.List) {
      return (
        <div>
          {props.cardProps && (
            <Card
              {...props.cardProps}
              buttons={headerButtons}
              bodyClassName={
                showAs === ShowAs.List
                  ? "-ml-6 -mr-6 bg-gray-50 border-top"
                  : ""
              }
              title={getCardHeaderTitle(
                getCardTitle(props.cardProps.title || ""),
              )}
            >
              {tableColumns.length === 0 && props.columns.length > 0 ? (
                <ErrorMessage
                  message={`You are not authorized to view this table. You need any one of these permissions: ${PermissionHelper.getPermissionTitles(
                    model.getReadPermissions(),
                  ).join(", ")}`}
                />
              ) : (
                <></>
              )}
              {props.topContent || <></>}
              {tableColumns.length > 0 && showAs === ShowAs.Table ? (
                getTable()
              ) : (
                <></>
              )}

              {tableColumns.length > 0 && showAs === ShowAs.List ? (
                getList()
              ) : (
                <></>
              )}
            </Card>
          )}

          {/*
           * For card-less tables we expose the search beside the table header
           * via a thin right-aligned row.
           */}
          {!props.cardProps &&
          (showAs === ShowAs.Table || showAs === ShowAs.List) &&
          props.searchableFields &&
          props.searchableFields.length > 0 ? (
            <div className="mb-3 flex justify-end">{getSearchControl()}</div>
          ) : (
            <></>
          )}
          {!props.cardProps && props.topContent}
          {!props.cardProps && showAs === ShowAs.Table ? getTable() : <></>}
          {!props.cardProps && showAs === ShowAs.List ? getList() : <></>}
        </div>
      );
    }

    return (
      <div>
        {props.cardProps && (
          <Card
            {...props.cardProps}
            buttons={headerButtons}
            title={getCardTitle(props.cardProps.title || "")}
          >
            {getOrderedStatesList()}
          </Card>
        )}

        {!props.cardProps && getOrderedStatesList()}
      </div>
    );
  };

  return (
    <>
      <div className="">{getCardComponent()}</div>

      {showModel ? (
        props.callbacks.showCreateEditModal({
          onClose: () => {
            setShowModal(false);
          },
          modalType: modalType,
          onBeforeCreate: async (
            item: TBaseModel,
            miscDataProps: JSONObject,
          ) => {
            if (
              showAs === ShowAs.OrderedStatesList &&
              props.orderedStatesListProps?.orderField &&
              orderedStatesListNewItemOrder
            ) {
              item.setColumnValue(
                props.orderedStatesListProps.orderField as string,
                orderedStatesListNewItemOrder,
              );
            }

            if (props.onBeforeCreate) {
              item = await props.onBeforeCreate(item, miscDataProps);
            }

            return item;
          },
          onSuccess: async (item: TBaseModel): Promise<void> => {
            setShowModal(false);
            setCurrentPageNumber(1);
            await fetchItems();
            if (props.onCreateSuccess) {
              await props.onCreateSuccess(item);
            }

            return Promise.resolve();
          },
          modelIdToEdit: currentEditableItem
            ? new ObjectID(currentEditableItem["_id"] as string)
            : undefined,
        })
      ) : (
        <></>
      )}

      {showDeleteConfirmModal && (
        <ConfirmModal
          title={`Delete ${props.singularName || model.singularName}`}
          description={`Are you sure you want to delete this ${(
            props.singularName ||
            model.singularName ||
            "item"
          )?.toLowerCase()}?`}
          onClose={() => {
            setShowDeleteConfirmModal(false);
          }}
          submitButtonText={"Delete"}
          onSubmit={async () => {
            if (currentDeleteableItem && currentDeleteableItem["_id"]) {
              await deleteItem(currentDeleteableItem);
              setShowDeleteConfirmModal(false);
            }
          }}
          submitButtonType={ButtonStyleType.DANGER}
        />
      )}

      {errorModalText && (
        <ConfirmModal
          title={`Error`}
          description={`${errorModalText}`}
          submitButtonText={"Close"}
          onSubmit={() => {
            setErrorModalText("");
          }}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      )}

      {showViewIdModal && (
        <ConfirmModal
          title={`${props.singularName || model.singularName || ""} ID`}
          description={
            <div>
              <span>
                ID of this {props.singularName || model.singularName || ""}:{" "}
                {viewId}
              </span>
              <br />
              <br />

              <span>
                You can use this ID to interact with{" "}
                {props.singularName || model.singularName || ""} via the
                OneUptime API. Click the button below to go to API Reference.
              </span>
            </div>
          }
          onClose={() => {
            setShowViewIdModal(false);
          }}
          submitButtonText={"Go to API Docs"}
          onSubmit={() => {
            setShowViewIdModal(false);
            Navigation.navigate(
              URL.fromString(API_DOCS_URL.toString()).addRoute(
                "/" + model.getAPIDocumentationPath(),
              ),
              { openInNewTab: true },
            );
          }}
          submitButtonType={ButtonStyleType.NORMAL}
          closeButtonType={ButtonStyleType.OUTLINE}
        />
      )}

      {showHelpModal && props.helpContent && (
        <Modal
          title={props.helpContent.title}
          description={props.helpContent.description}
          onClose={() => {
            setShowHelpModal(false);
          }}
          modalWidth={ModalWidth.Large}
          submitButtonText="Close"
          onSubmit={() => {
            setShowHelpModal(false);
          }}
        >
          <div className="p-2">
            <MarkdownViewer text={props.helpContent.markdown} />
          </div>
        </Modal>
      )}
    </>
  );
};

export default BaseModelTable;
