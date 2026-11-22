import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IncludesNoneOrNull from "../../../Types/BaseDatabase/IncludesNoneOrNull";
import { withSearch } from "../EntityDropdown/EntityDropdownQuery";
import { ENTITY_DROPDOWN_NOT_FOUND_LABEL } from "../EntityDropdown/EntityDropdownNotFound";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import RecordsById from "../../Utils/RecordsById";
import GlossaryTerm from "../../../Types/Docs/GlossaryTerm";
import DefinedTerm from "../Glossary/LazyDefinedTerm";
import { BILLING_ENABLED, getAllEnvVars } from "../../Config";
import { GetReactElementFunction } from "../../Types/FunctionTypes";
import API from "../../Utils/API/API";
import useTranslateValue from "../../Utils/Translation";
import {
  PluralTemplate,
  translatableTerm,
  translateNamedAction,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Toast, {
  CHANGES_SAVED,
  getItemCreatedTemplate,
  ITEM_DELETED,
  ITEM_REMOVED,
} from "../../Utils/Toast";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";

import Query from "../../../Types/BaseDatabase/Query";
import GroupBy from "../../../Types/BaseDatabase/GroupBy";
import Sort from "../../../Types/BaseDatabase/Sort";
import Select from "../../../Types/BaseDatabase/Select";
import { Logger } from "../../Utils/Logger";
import Navigation from "../../Utils/Navigation";
import { openDocumentationLink } from "../../Utils/DocsLinkEvents";
import TableFilterUrlState from "../../Utils/TableFilterUrlState";
import CreateFormAddress from "../../Utils/CreateFormAddress";
import TableViewUrlState, {
  TableViewUrlStateData,
} from "../../Utils/TableViewUrlState";
import buildQueryFromFilterData, {
  renameFilterDataKeys,
  sanitizeFilterData,
} from "./FilterDataToQuery";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
  PermissionGateOptions,
} from "../../Utils/PermissionGate";
import {
  usePrivateRecordGateOptions,
  withPrivateRecordGateOptions,
} from "../../Utils/PrivateRecordScope";
import { HeldPermissions } from "../../../Types/HeldPermissions";
import { isRecordNameAsWritten } from "../../../Utils/DefaultRecordNames";
import ProjectUtil from "../../Utils/Project";
import User from "../../Utils/User";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionContext,
} from "../ActionButton/ActionButtonSchema";
import { withRowActionContext } from "../ActionButton/RowActionContext";
import {
  BulkActionButtonSchema,
  BulkActionConfirmControls,
  BulkActionOnClickProps,
} from "../BulkUpdate/BulkUpdateForm";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "../BulkUpdate/BulkActionRunner";
import {
  BULK_SELECT_ALL_PAGE_SIZE,
  EveryMatch,
  MatchingPage,
  readEveryMatch,
} from "../BulkUpdate/BulkSelectAll";
import { ButtonSize, ButtonStyleType } from "../Button/Button";
import Card, {
  CardButtonSchema,
  ComponentProps as CardComponentProps,
} from "../Card/Card";
import { getRefreshButton } from "../Card/CardButtons/Refresh";
import Field from "../Detail/Field";
import ClassicFilterType, { EntityFilterSearch } from "../Filters/Types/Filter";
import FilterData from "../Filters/Types/FilterData";
import { FormProps, FormSummaryConfig } from "../Forms/BasicForm";
import {
  ModelField,
  ModelFormOnBeforeCreate,
  ModelFormOnBeforeUpdate,
} from "../Forms/ModelForm";
import { FormStep } from "../Forms/Types/FormStep";
import FormValues from "../Forms/Types/FormValues";
import List from "../List/List";
import { ListDetailProps } from "../List/ListRow";
import ConfirmModal from "../Modal/ConfirmModal";
import RecordIdModal from "../ObjectID/RecordIdModal";
import { getRecordIdText, hasRecordId } from "../ObjectID/RecordIdText";
import { getApiReferencePagePath } from "../../../Utils/ApiReferencePage";
import { ModalWidth } from "../Modal/Modal";
import HelpModal from "../Help/HelpModal";
import { HelpContent } from "../Help/HelpContent";
import DeleteConfirmationMessage from "../DeleteConfirmation/DeleteConfirmationMessage";
import {
  getDeleteConsequence,
  joinSentences,
} from "../DeleteConfirmation/DeleteConsequences";
import DeleteItemNames from "../DeleteConfirmation/DeleteItemNames";
import { getRecordDisplayName } from "../../Utils/ModelDisplayName";
import Icon from "../Icon/Icon";
import Filter from "../ModelFilter/Filter";
import { DropdownOption, DropdownOptionLabel } from "../Dropdown/Dropdown";
import Pill from "../Pill/Pill";
import Table from "../Table/Table";
import {
  RowClickEventLike,
  hasTextSelection,
  isNewTabClick,
  isRowOpeningClick,
} from "../Table/RowClick";
import TableEmptyState from "../Table/TableEmptyState";
import { hasFilterValues } from "../Table/TableEmptyStateBuilders";
import {
  TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME,
  TABLE_HEADER_FOLDED_BUTTONS_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME,
  TABLE_HEADER_OPEN_SEARCH_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLASS_NAME,
  TABLE_HEADER_SEARCH_KEY_HINT_CLASS_NAME,
  TABLE_HEADER_TOOLBAR_CLASS_NAME,
  TableHeaderButtonSplit,
  TableHeaderSearchSlot,
  TableHeaderToolbar,
  renderTableHeaderMainAndMore,
  renderTableHeaderMainButton,
  renderTableHeaderMoreMenu,
  splitTableHeaderButtons,
  useTableHeaderSearchShortcut,
} from "../Table/TableHeaderControls";
import { getCreateButtonPhoneVerb } from "./CreateButtonPhoneVerb";
import EmptyStateOptions from "./EmptyStateOptions";
import {
  ModelTableEmptyState,
  buildModelTableEmptyState,
  buildNoAccessState,
  isListEmptyWithNothingApplied,
} from "./ModelTableEmptyState";
import TableColumn from "../Table/Types/Column";
import FieldType from "../Types/FieldType";
import ModelTableColumn from "./Column";
import {
  RelationColumnSort,
  getColumnSortForRead,
  getColumnSortKey as getModelTableColumnSortKey,
  getRelationColumnSorts,
  isDrawnFromRecordId,
  withRelationColumnSortSelect,
} from "./ColumnSort";
import Columns from "./Columns";
import ColumnCustomizationModal, {
  AddableColumnsConfig,
  ColumnCustomizationProjectDefault,
  ColumnCustomizationSaveOptions,
} from "./ColumnCustomizationModal";
import {
  canChangeProjectDefaultColumns,
  readProjectDefaultColumns,
  saveProjectDefaultColumns,
} from "./ProjectDefaultColumns";
import {
  getAttributeColumns,
  getAttributeKeysFromColumnPreference,
  normalizeAttributeKeys,
} from "./AttributeColumns";
import {
  ColumnPreference,
  CustomizableColumn,
  applyColumnPreference,
  buildColumnPreference,
  fromJSON as columnPreferenceFromJSON,
  getCustomizableColumns,
  isEmptyColumnPreference,
  sanitizeColumnPreference,
  getColumnIds,
  toJSON as columnPreferenceToJSON,
} from "./ColumnPreference";
import { CustomFieldsColumnKey } from "./CustomFieldColumns";
import useCustomFieldColumns, {
  CustomFieldColumnsResult,
} from "./useCustomFieldColumns";
import { getExportKeysFromColumn } from "./ExportFromColumns";
import {
  LIVE_ROWS_ARRIVED_IN_MS,
  LiveRowsHeard,
  ROW_ARRIVED_ATTRIBUTE,
  getArrivedRowIds,
  isDialogOrMenuOpen,
  isLiveRowsHeld,
} from "./LiveRows";
import useLiveRows from "./UseLiveRows";
import {
  EMPTY_LIST_COUNT,
  ListCountState,
  getListCountUpTo,
  getListHasMore,
  getNextListCount,
} from "./ListCount";
import {
  getRelationSelectFromColumns,
  getSelectFromColumns,
} from "./SelectFromColumns";
import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AccessControlModel from "../../../Models/DatabaseModels/DatabaseBaseModel/AccessControlModel";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ListOrderSettings } from "../../../Types/Database/ListOrderColumn";
import { moveListItem } from "../../../Utils/ListOrder";
import Alert, { AlertType } from "../Alerts/Alert";
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
import ArchivedValuePicker from "../../Utils/ArchivedValuePicker";
import {
  SharedNameFacts,
  SharedNameMark,
  getSharedNameFacts,
  getSharedNameMarks,
  getSharedNameOptionKey,
  getSharedNameSelect,
} from "../../Utils/SharedNameOptions";
import {
  SharedNameDetail,
  SharedNamePill,
  SharedNameValueDetail,
} from "../Dropdown/SharedNameOptionLines";
import InlineLoadingLine from "../Loader/InlineLoadingLine";
import InlineSeparator from "../InlineSeparator/InlineSeparator";
import { refreshSideMenuCounts } from "../SideMenu/SideMenuCountRefresh";

/*
 * A row's Delete whose dialog first asks the server what the delete would
 * change (getDeleteConfirmation) opens at once if the answer is slow: after
 * this long it shows, saying it is checking, so the click is never left
 * without an answer. A quick answer opens the dialog with its words, as
 * before, with nothing flashing first.
 */
export const DELETE_CONFIRMATION_LOADING_DELAY_MS: number = 300;

/*
 * How a bulk action's progress list and a dragged row name a row: its kind,
 * then its name or id - "Monitor: API" - as one key, so the colon is the
 * reader's language's ("Monitor : API" in French). It was English's colon,
 * and a space before an id, written beside the kind (#8290).
 */
export const ROW_KIND_AND_NAME: string = translationKey(
  "{{label}}: {{identifier}}",
);

export const DELETE_CONFIRMATION_LOADING: string = translationKey(
  "Checking what deleting it would change…",
);

/*
 * How many rows a drag-ordered table shows at once unless told otherwise.
 * Rows can only be dragged within the page on screen, so it should hold the
 * whole list - these are settings lists of a handful of rows to a few dozen.
 */
export const MANUALLY_ORDERED_ITEMS_ON_PAGE: number = 50;

export const REORDER_OFF_WHILE_FILTERED: string =
  "Drag to reorder is off while a filter or search is on.";

export const REORDER_SAVING: string = "Saving the new order...";

export const REORDER_SAVED: string = "The new order is saved.";

export const REORDER_FAILED: string = "The new order could not be saved.";

export enum ShowAs {
  Table,
  List,
}

/*
 * "Select All" loads the whole filtered result set - up to LIMIT_PER_PROJECT
 * rows - with the same columns the table itself fetches, a page of
 * BULK_SELECT_ALL_PAGE_SIZE at a time (BulkSelectAll, which says why).
 */
export { BULK_SELECT_ALL_PAGE_SIZE };

/*
 * The row of a table's header controls - its search, saved views, main
 * button and ⋯ - and how it is laid out. They live in
 * Table/TableHeaderControls, which every table's header is drawn with (a
 * table a page builds on Common's Table too); these are their names here.
 */
export const MODEL_TABLE_HEADER_TOOLBAR_CLASS_NAME: string =
  TABLE_HEADER_TOOLBAR_CLASS_NAME;

// The search folded to its "Search... /" pill.
export const MODEL_TABLE_PHONE_SEARCH_CLASS_NAME: string =
  TABLE_HEADER_SEARCH_CLASS_NAME;

// The search opened.
export const MODEL_TABLE_EXPANDED_SEARCH_CLASS_NAME: string =
  TABLE_HEADER_OPEN_SEARCH_CLASS_NAME;

// The buttons beside an opened search, folded away to no width.
export const MODEL_TABLE_FOLDED_BUTTONS_CLASS_NAME: string =
  TABLE_HEADER_FOLDED_BUTTONS_CLASS_NAME;

/*
 * The frame of a table drawn without a card of its own (no cardProps),
 * padded as a card is - 20px on a phone, 24px from md up - since the
 * table's rows and footer reach through that padding to its edges.
 *
 * Its header band starts at the frame's top, where the frame's own border
 * already rules it off: the band's top rule is dropped there
 * (MODEL_TABLE_FRAME_BAND_TOP_CLASS_NAME), or the two hairlines drew a 2px
 * top edge no card has. When the table's filter chips are shown above the
 * band (the first element is not empty) the band keeps its rule under them.
 */
export const MODEL_TABLE_FRAME_BAND_TOP_CLASS_NAME: string =
  "[&>div:first-child:empty+[data-testid=table-scroll]_thead_th]:border-t-0";

export const MODEL_TABLE_FRAME_CLASS_NAME: string = [
  "overflow-clip rounded-xl border border-gray-200 bg-white px-5 pb-6 shadow-sm md:px-6",
  MODEL_TABLE_FRAME_BAND_TOP_CLASS_NAME,
].join(" ");

export interface SaveFilterProps {
  tableId: string;
}

export interface BaseTableCallbacks<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> {
  /*
   * Deletes a row; `miscDataProps` are the choices its confirmation held
   * (DeleteConfirmation.getMiscDataProps), sent beside its id.
   */
  deleteItem: (
    item: TBaseModel,
    miscDataProps?: JSONObject | undefined,
  ) => Promise<void>;
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
    // How far the count goes (ListCount.ts); unset, it is exact.
    countUpTo?: number | undefined;
  }) => Promise<ListResult<TBaseModel>>;
  toJSONArray: (data: Array<TBaseModel>) => Array<JSONObject>;
  updateById: (data: { id: ObjectID; data: JSONObject }) => Promise<void>;
  /*
   * Moves a row of a list people drag into order to the place of the row it
   * was dropped on (POST <path>/:id/move, Types/Database/MoveInList): the
   * rows between step aside. A write of the row's number would only put it
   * beside that row (issue #9609). ModelTable passes it; a table without it
   * cannot be dragged.
   */
  moveInList?:
    | ((data: { id: ObjectID; placeOfId: ObjectID }) => Promise<void>)
    | undefined;
  showCreateEditModal: (data: {
    modalType: ModalType;
    modelIdToEdit?: ObjectID | undefined;
    onBeforeCreate?: ModelFormOnBeforeCreate<TBaseModel> | undefined;
    onBeforeUpdate?: ModelFormOnBeforeUpdate<TBaseModel> | undefined;
    onSuccess?: ((item: TBaseModel) => void) | undefined;
    onClose?: (() => void) | undefined;
    /*
     * The rows the table shows, handed to a Create form: a colour it picks
     * for the new record is one none of them uses yet.
     */
    existingItems?: Array<TBaseModel> | undefined;
    // The Edit dialog's own title for the row it edits (editFormTitle).
    editFormTitle?: string | undefined;
  }) => ReactElement;
}

export enum ModalTableBulkDefaultActions {
  Delete = "Delete",
}

export interface BulkActionProps<T extends BaseModel | AnalyticsBaseModel> {
  /*
   * The table's own bulk actions. On a table whose rows are deleted from it
   * (`isDeleteable`), the default Delete joins them on its own; listing
   * ModalTableBulkDefaultActions.Delete only places it. On a table that is
   * not, there is no Delete to place.
   */
  buttons: Array<BulkActionButtonSchema<T> | ModalTableBulkDefaultActions>;
  matchBulkSelectedItemByField?: keyof T | undefined; // which field to use to match selected items. For exmaple this could be '_id'
  /**
   * Said after the bulk Delete's question in place of the table's
   * deleteConfirmationWarning, for a bulk Delete that needs other words than
   * the row's Delete - removing several links at once, say, or the rule a
   * row's own dialog spells out case by case. What the model's records take
   * with them (DeleteConsequences) is said before it either way.
   */
  deleteConfirmationWarning?: string | undefined;
  /**
   * The word the default bulk Delete uses instead of "Delete", for a table
   * whose rows are relationships rather than things - "Unlink" on a table of
   * links, say. When set, the menu item, the confirmation's title and its
   * sentence all use it ("Unlink 3 Alerts", "Are you sure you want to unlink
   * 3 alerts?"), and the sentence no longer claims the action cannot be
   * undone: removing a relationship is undone by adding it again. It is still
   * the table's delete action - it deletes the selected rows, is gated on the
   * model's delete permission, and stops a second Delete being added.
   */
  deleteVerb?: string | undefined;
  /* The menu icon to go with deleteVerb. Defaults to the trash can. */
  deleteIcon?: IconProp | undefined;
  /*
   * How many rows the bulk Delete deletes at once: one at a time unless the
   * table says otherwise. A delete's hooks can check a rule over the rows
   * that are left - a project keeps at least one owner, a list keeps its
   * last state - and two deletes run at once would each see the other's row
   * still there. A table whose deletes check nothing across rows (alerts,
   * incidents) passes BULK_ACTION_CONCURRENCY.
   */
  deleteConcurrency?: number | undefined;
  /*
   * Drawn in the bulk Delete's dialog after the names: what deleting the
   * selected rows would change, read when the dialog opens - what uses a
   * value the rows are, say (UseArchivableValues). It may hold the dialog's
   * Delete while it reads (BulkActionConfirmControls), as a row's Delete
   * waits for its own words.
   */
  deleteConfirmationDetails?:
    | ((
        items: Array<T>,
        controls: BulkActionConfirmControls,
      ) => ReactElement | undefined)
    | undefined;
  /*
   * Why one selected row is not deleted, when the list already knows the
   * server would refuse it - records still have a value, say - and its
   * dialog said so: it is not sent, and the result lists it as skipped
   * (BULK_SKIPPED_COUNT), with the reason. Only the bulk Delete asks: a
   * row's own Delete says why in its dialog.
   */
  getDeleteRefusal?: ((item: T) => string | undefined) | undefined;
  // Once a bulk Delete has run: a page that counts what is left reads again.
  onDeleteEnd?: (() => void) | undefined;
}

/**
 * What the per-row Delete confirmation says, when the table's own sentence
 * ("Are you sure you want to delete ...?") is not the whole story - removing a
 * team membership, say, where the row being deleted is not a thing but a
 * relationship, and deleting the last one takes the user out of the project.
 */
export interface DeleteConfirmation {
  title?: string | undefined;
  /*
   * The dialog's words in place of the table's own question ("Are you
   * sure you want to delete ...?" and what goes with it), which is said
   * when this is left out.
   */
  description?: string | ReactElement | undefined;
  /*
   * Drawn under the question, whichever it is: what still uses the row,
   * read before the dialog opens (a list's Used by, #7435).
   */
  details?: ReactElement | undefined;
  submitButtonText?: string | undefined;
  /*
   * A gentler way to the same end, offered in the dialog: "Archive instead"
   * beside Delete, for a value that records still use. It runs instead of
   * the delete, and the dialog closes once it is done.
   */
  alternative?: DeleteConfirmationAlternative | undefined;
  /*
   * The record cannot be deleted now - records still point at it and the
   * server would refuse - so the dialog says why and offers only the
   * alternative (as its one action) and Cancel.
   */
  isDeleteBlocked?: boolean | undefined;
  /*
   * What the delete sends beside the record's id, read as Delete is
   * pressed (ModelAPI.deleteItem's miscDataProps): a choice the dialog's
   * details hold - what the workflows that run as a deleted custom role
   * run as instead (#9767), for one.
   */
  getMiscDataProps?: (() => JSONObject | undefined) | undefined;
}

export interface DeleteConfirmationAlternative {
  // English, looked up when drawn: "Archive instead".
  title: string;
  onClick: () => Promise<void>;
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
  /*
   * The list's help (?): a title, a line under it and a markdown document
   * of a lead and "##" topics, opened in the help dialog (HelpModal) from
   * the card's header and from the empty list.
   */
  helpContent?: HelpContent | undefined;
  documentationLink?: Route | URL | undefined;
  videoLink?: Route | URL | undefined;
  showCreateForm?: undefined | boolean;
  columns: Columns<TBaseModel>;
  filters: Array<Filter<TBaseModel>>;
  listDetailOptions?: undefined | ListDetailProps;
  selectMoreFields?: Select<TBaseModel>;
  initialItemsOnPage?: number;
  /*
   * Whether this list's rows are deleted from it: Delete in each row's ⋯
   * menu and, on a table that offers bulk actions (or to a viewer who may
   * delete), Delete in Bulk Actions - the two always together. Off for a
   * list whose records are deleted somewhere else: another resource's page
   * listing its members, a list across projects, history, or a record whose
   * delete has its own flow.
   */
  isDeleteable: boolean;
  /*
   * A sentence of this list's own, said after the Delete question in the
   * row's dialog and in the bulk Delete's - a gentler way to the same end
   * ("archive it instead"), say. What the model's records take with them
   * (DeleteConsequences) is said before it without being asked for.
   */
  deleteConfirmationWarning?: string | undefined;
  isEditable?: boolean | undefined;
  isCreateable: boolean;
  /*
   * Why Create is locked for the reader although their permissions allow
   * it: a record this list makes reaches more than their permission does -
   * a global user override applies to every on-call policy, and a
   * permission limited to some policies does not reach them all. Create
   * stays on the card (and in the empty state), locked, with the reason on
   * hover, and showCreateForm opens nothing. Left out, Create is gated by
   * the reader's permissions alone.
   */
  createDisabledReason?: string | undefined;
  /*
   * The list a page is for opens its create form from the page's address,
   * "?create=1" (Utils/CreateFormAddress, #7035): Search's Create Status
   * Page, Create On-Call Policy and the rest. Only for someone its Create
   * is open to; reloading keeps the form open, and closing it takes the ask
   * off the address, so Back never opens it again. A page with more than
   * one list sets it on the one its Create belongs to. Left out, the
   * address opens nothing.
   */
  opensCreateFormFromAddress?: boolean | undefined;
  onCreateClick?: (() => void) | undefined;
  disablePagination?: undefined | boolean;
  formFields?: undefined | Array<ModelField<TBaseModel>>;
  formSteps?: undefined | Array<FormStep<TBaseModel>>;
  /*
   * The page's own words for an empty table. A sentence is split into the
   * empty state's title (its first sentence) and description (the rest);
   * an element replaces the whole empty state. See emptyState.
   */
  noItemsMessage?: undefined | string | ReactElement;
  /*
   * The table's own title, description or icon for its empty state, or
   * that an empty list is good news here (isAllClear). See
   * EmptyStateOptions: most tables need none of it.
   */
  emptyState?: EmptyStateOptions | undefined;
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
  onBeforeCreate?: ModelFormOnBeforeCreate<TBaseModel> | undefined;
  /*
   * Runs on the Edit form just before it saves, with the model, the misc
   * data the request carries (what it adds there is sent) and every value
   * the form holds - ModelForm's onBeforeUpdate. A custom field's option
   * renames ride along this way (#4564).
   */
  onBeforeUpdate?: ModelFormOnBeforeUpdate<TBaseModel> | undefined;
  // Runs after both create and edit; modalType identifies which form was saved.
  onCreateSuccess?:
    | ((item: TBaseModel, modalType?: ModalType) => Promise<TBaseModel>)
    | undefined;
  createVerb?: string;
  /*
   * The create dialog's own title and button, for a table whose noun would
   * misname what the button that opened the dialog adds: a custom role's
   * Permissions card adds a role or a single permission ("Add a Role to
   * Incident Responder", "Add Role"), not a "New Permission". English to
   * look up, or words already in the reader's language. Left out, the
   * dialog says "<verb> New <singular name>" as before.
   */
  createFormTitle?: string | undefined;
  /*
   * The Edit dialog's title for one row, where "Edit <singular name>" does
   * not say which row is open: Response Targets' rows are a project's case
   * priorities, and every one's dialog was "Edit Response Target" over a
   * blurred table - with two empty fields on a project that had set none,
   * nothing in it said which priority it was. English to look up, or words
   * already in the reader's language. Left out, the dialog says "Edit
   * <singular name>" as before.
   */
  editFormTitle?: ((item: TBaseModel) => string) | undefined;
  createFormSubmitButtonText?: string | undefined;
  showAs?: ShowAs | undefined;
  singularName?: string | undefined;
  pluralName?: string | undefined;
  /*
   * What one row is called wherever the table names it - its checkbox and
   * its ⋯ for a screen reader, the rows a bulk action lists before and after
   * it runs, the per-row Delete question - for a model with no name column
   * of its own. A monitor's status event has none: without this, a bulk
   * Delete listed the one it skipped by its id. Return "" to fall back to the
   * row's name column, as a table without the prop does.
   */
  getItemName?: ((item: TBaseModel) => string) | undefined;
  actionButtons?: Array<ActionButtonSchema<TBaseModel>> | undefined;
  deleteButtonText?: string | undefined;
  onCreateEditModalClose?: (() => void) | undefined;
  editButtonText?: string | undefined;
  viewButtonText?: string | undefined;
  refreshToggle?: string | undefined;
  /*
   * Whether the rows keep themselves current. A list of a table whose
   * changes the server announces (incidents, alerts, episodes, SLOs, ...)
   * reads its page again, quietly, whenever one of its records is created,
   * changed or deleted, so nobody has to press Refresh (LiveRows.ts). Leave
   * it unset; false keeps the rows as they were loaded, for a list where a
   * row moving would get in the way of what the page is for.
   */
  isLive?: boolean | undefined;
  /*
   * A list that reads several projects at once (fetchRequestOptions'
   * isMultiTenantRequest - Active Incidents lists every project the person
   * belongs to): the projects whose changes it hears, so a record changing
   * in any of them reads the page again, not only one in the open project.
   * Unset: the open project's (LiveRows.getLiveRowTenantIds).
   */
  liveProjectIds?: Array<ObjectID> | undefined;
  fetchRequestOptions?: RequestOptions | undefined;
  deleteRequestOptions?: RequestOptions | undefined;
  onItemDeleted?: ((item: TBaseModel) => void) | undefined;
  /*
   * A row created, edited or deleted from the list says so in the corner:
   * "Nightly Backup deleted", "Changes saved" (Toast, #9120). Leave it out
   * where the page says so itself, in its own words.
   */
  hideChangeToasts?: boolean | undefined;
  onBeforeEdit?: ((item: TBaseModel) => Promise<TBaseModel>) | undefined;
  /*
   * Rows the reader may not change, though their permissions let them change
   * others of the list - a rule other teams own - and why: the reason, or
   * undefined for a row they may change. Such a row keeps Edit in its menu,
   * locked, with the reason as its tooltip, and so does its row switch
   * (ModelTable's rowSwitch).
   */
  getEditDisabledReason?:
    | ((item: TBaseModel) => string | undefined)
    | undefined;
  /*
   * The record the Edit form fetched, before the form opens on it - for a
   * form with a field that is no column of the record (ModelForm's
   * onItemFetched).
   */
  onEditFormItemFetched?:
    | ((item: TBaseModel) => Promise<TBaseModel>)
    | undefined;
  onBeforeDelete?: ((item: TBaseModel) => Promise<TBaseModel>) | undefined;
  /*
   * Rows that can never be deleted - a project's built-in states, say - and
   * why: the reason, or undefined for a row that can be deleted. Such a row
   * keeps Delete in its menu, locked, with the reason as its tooltip, and a
   * bulk Delete that includes it skips it and lists it, with the reason,
   * among the rows it could not delete.
   */
  getDeleteDisabledReason?:
    | ((item: TBaseModel) => string | undefined)
    | undefined;
  /*
   * Supplies the per-row Delete confirmation's wording for the row that was
   * clicked. Runs after onBeforeDelete and before the dialog opens, so it may
   * fetch; if it throws, the dialog does not open and the row shows the error.
   */
  getDeleteConfirmation?:
    | ((item: TBaseModel) => Promise<DeleteConfirmation>)
    | undefined;
  onBeforeView?: ((item: TBaseModel) => Promise<TBaseModel>) | undefined;
  sortBy?: keyof TBaseModel | undefined;
  sortOrder?: SortOrder | undefined;
  dragDropIdField?: keyof TBaseModel | undefined;
  dragDropIndexField?: keyof TBaseModel | undefined;
  createEditModalWidth?: ModalWidth | undefined;
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

  /**
   * Called with the query the rows are fetched with - the caller's `query`,
   * the column filters and the search box, merged exactly as the list request
   * merges them - on mount and whenever that set of matching rows changes.
   *
   * For a surface that summarizes the same rows the table lists (a volume
   * chart above it, say): reading the filters any other way would let the
   * summary and the list quietly disagree about what "these events" means.
   * Sort and page are not part of it; they re-order the same matching set.
   */
  onQueryChange?: ((query: Query<TBaseModel>) => void) | undefined;

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

  /**
   * Namespace for this table's filter/facet/view state in the URL query
   * string. Defaults to `saveFilterProps.tableId`, falling back to
   * `userPreferencesKey` — both of which are already unique per table, which
   * is what lets several tables share a page without clobbering each other.
   *
   * Only set this explicitly when the same table component is mounted more
   * than once on one route and the two instances must keep separate state.
   */
  urlStateKey?: string | undefined;

  /**
   * Filters this table used to key by another field, by the key it filters
   * by now ({ vendor: "manufacturer" }): a link or a bookmark made before
   * still filters by what it said, read under the new key (renameFilterDataKeys).
   */
  renamedFilterKeys?: Readonly<Record<string, string>> | undefined;

  /**
   * Opt out of mirroring this table's filters into the URL. Use for tables
   * inside modals/side-overs, or transient tables whose filters shouldn't
   * outlive the page.
   */
  disableUrlState?: boolean | undefined;

  /**
   * Hide the "Columns" control and always render the declared column set.
   *
   * Column customization is on by default for every table that renders
   * columns. Turn it off for tables whose layout is load-bearing — a
   * two-column key/value table, or one the surrounding page reads positions
   * out of.
   */
  disableColumnCustomization?: boolean | undefined;

  /**
   * The model holding this resource's custom field *definitions* — e.g.
   * `MonitorCustomField` for a table of monitors. Set it and every custom
   * field the project has defined becomes an optional column, off by default
   * and listed in the column picker.
   *
   * Only meaningful for resources with a `customFields` column of their own.
   */
  customFieldsModelType?: { new (): BaseModel } | undefined;

  /**
   * Let the viewer add a column for any key inside a Map(String, String)
   * column on the model — `attributes` on logs, spans and security events.
   *
   * Those keys are per-payload rather than per-schema, so they cannot ship as
   * columns and there can be hundreds of them. Instead the picker grows an
   * "add a column" search box fed by `fetchAttributeKeys`, and whatever the
   * viewer adds becomes an ordinary column: hideable, re-orderable, exported,
   * and remembered in the same stored layout as every other column.
   *
   * Requires `userPreferencesKey` and column customization to be on, since the
   * chosen keys are recovered from the stored layout.
   */
  attributeColumnsProps?:
    | {
        /*
         * The map column the generated columns read from. Must be a real
         * column on the model; anything else is ignored rather than throwing
         * the table away.
         */
        columnKey: string;
        /*
         * Every key the viewer may pick from. Called the first time the picker
         * opens rather than on mount — it is typically a wide scan, and a
         * table nobody customizes should not pay for it.
         */
        fetchAttributeKeys: () => Promise<Array<string>>;
        title?: string | undefined;
        description?: string | undefined;
        placeholder?: string | undefined;
        emptyMessage?: string | undefined;
      }
    | undefined;
}

/*
 * The header's buttons that read the list's rows - Filter, and the Columns
 * the rows are drawn with: left out of a list nobody may read
 * (isNoAccessShown).
 */
const LIST_READ_BUTTONS: WeakSet<CardButtonSchema | ReactElement> = new WeakSet<
  CardButtonSchema | ReactElement
>();

const ofListRead: (button: CardButtonSchema) => CardButtonSchema = (
  button: CardButtonSchema,
): CardButtonSchema => {
  LIST_READ_BUTTONS.add(button);
  return button;
};

export interface ComponentProps<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> extends BaseTableProps<TBaseModel> {
  callbacks: BaseTableCallbacks<TBaseModel>;
}

export enum ModalType {
  Create,
  Edit,
}

type GetDeleteLabelFunction = (
  singularName: string | undefined,
  modelSingularName: string | null | undefined,
) => string;

/*
 * What the Delete dialog calls a row when it cannot name it. A table may pass a
 * blank singularName to keep its create button down to a bare verb - the
 * user's Teams tab passes " " so its button reads "Invite" - and read verbatim
 * that turned the dialog into "Are you sure you want to delete this  ?". A
 * blank name is no name, so it falls through to the model's own.
 */
const getDeleteLabel: GetDeleteLabelFunction = (
  singularName: string | undefined,
  modelSingularName: string | null | undefined,
): string => {
  return singularName?.trim() || modelSingularName?.trim() || "Item";
};

/*
 * The create button for each verb a table uses, as a whole phrase a locale
 * can reorder ("{{itemName}} erstellen"). A verb not listed here goes through
 * the verb-and-noun template, which only reorders.
 */
const CREATE_BUTTON_TEMPLATES: Record<string, string> = {
  Add: translationKey("Add {{itemName}}"),
  Connect: translationKey("Connect {{itemName}}"),
  Create: translationKey("Create {{itemName}}"),
  Declare: translationKey("Declare {{itemName}}"),
  Invite: translationKey("Invite {{itemName}}"),
  Link: translationKey("Link {{itemName}}"),
};

/*
 * "<verb> <noun>" on a create button - the table header's, and the create
 * dialog's submit button. Translating the two words separately reads the
 * verb out of context - "Link" comes back as the noun in many languages, and
 * word order differs - so the whole phrase is looked up first ("Link Alert"),
 * then the verb's template with the locale's word for the noun in it. In
 * English all of them read the same.
 */
export const translateCreateAction: (
  translator: Translator,
  data: { verb?: string | undefined; itemName: string },
) => string = (
  translator: Translator,
  data: { verb?: string | undefined; itemName: string },
): string => {
  const verb: string = data.verb || "Create";
  const noun: string = data.itemName.trim();

  // A table that keeps its button down to the verb ("Invite").
  if (!noun) {
    return translator.translateText(verb) || verb;
  }

  return translateNamedAction(translator, {
    template: CREATE_BUTTON_TEMPLATES[verb] || "{{action}} {{itemName}}",
    itemName: noun,
    values: { action: translatableTerm(verb) },
  });
};

export const BULK_DELETE_TITLE: PluralTemplate = {
  one: "Delete {{count}} {{itemName}}",
  other: "Delete {{count}} {{itemsName}}",
};

export const BULK_DELETE_QUESTION: PluralTemplate = {
  one: "Are you sure you want to delete {{count}} {{itemName}}? This action cannot be undone.",
  other:
    "Are you sure you want to delete {{count}} {{itemsName}}? This action cannot be undone.",
};

/*
 * What a bulk Delete's result says about each row: deleted, or not - and
 * then, under it, which ones and why.
 */
export const BULK_DELETED_COUNT: PluralTemplate = {
  one: "{{count}} {{itemName}} deleted",
  other: "{{count}} {{itemsName}} deleted",
};

export const BULK_NOT_DELETED_COUNT: PluralTemplate = {
  one: "{{count}} {{itemName}} not deleted",
  other: "{{count}} {{itemsName}} not deleted",
};

/*
 * Rows a bulk Delete left out on purpose, as its dialog said it would
 * (getDeleteRefusal): "1 Incident Severity skipped", beside what was
 * deleted - its own gray list, so a row it was asked to skip never reads as
 * a delete that failed.
 */
export const BULK_SKIPPED_COUNT: PluralTemplate = {
  one: "{{count}} {{itemName}} skipped",
  other: "{{count}} {{itemsName}} skipped",
};

// A table that names its own verb ("Unlink") for the bulk action.
export const BULK_ACTION_TITLE: PluralTemplate = {
  one: "{{action}} {{count}} {{itemName}}",
  other: "{{action}} {{count}} {{itemsName}}",
};

export const BULK_ACTION_QUESTION: PluralTemplate = {
  one: "Are you sure you want to {{action}} {{count}} {{itemName}}?",
  other: "Are you sure you want to {{action}} {{count}} {{itemsName}}?",
};

export const SEARCH_MATCH_COUNT: PluralTemplate = {
  one: "{{count}} match",
  other: "{{count}} matches",
};

export const SEARCH_RESULT_COUNT: PluralTemplate = {
  one: "{{count}} result",
  other: "{{count}} results",
};

export const SEARCH_RESULT_COUNT_ON_PAGE: PluralTemplate = {
  one: "{{count}} result on this page",
  other: "{{count}} results on this page",
};

// No row just brought in by a live read: one set, so a list at rest never redraws for it.
const NO_ARRIVED_ROWS: ReadonlySet<string> = new Set<string>();

/*
 * The trailing `@<prefix>` mention in the search input. A mention is only
 * recognised when `@` is at the start of the value or follows whitespace,
 * and only when there is no whitespace after it — matches typical chat
 * mention semantics.
 */
export interface TableLabelMention {
  hasMention: boolean;
  prefix: string;
  atIndex: number;
}

export const parseTableLabelMention: (value: string) => TableLabelMention = (
  value: string,
): TableLabelMention => {
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

/*
 * How many label suggestions "@" draws, and how long it waits for the
 * typing to stop before it searches (#10646).
 */
export const TABLE_LABEL_SUGGESTIONS_SHOWN: number = 8;
const TABLE_LABEL_SEARCH_DEBOUNCE_MS: number = 250;

/*
 * The records an entity filter holds, by its values: what each value of
 * the filter's raw value names - "has any of", "has all of", "has none
 * of", "is", "is not" - never "is empty".
 */
export const getEntityFilterHeldValues: (rawValue: unknown) => Array<string> = (
  rawValue: unknown,
): Array<string> => {
  if (rawValue === undefined || rawValue === null) {
    return [];
  }

  const values: Array<unknown> =
    rawValue instanceof Includes ||
    rawValue instanceof IncludesAll ||
    rawValue instanceof IncludesNone ||
    rawValue instanceof IncludesNoneOrNull
      ? rawValue.values
      : Array.isArray(rawValue)
        ? rawValue
        : typeof rawValue === "string" || rawValue instanceof ObjectID
          ? [rawValue]
          : [];

  return values
    .map((value: unknown): string => {
      return value === undefined || value === null ? "" : value.toString();
    })
    .filter((value: string): boolean => {
      return value.trim() !== "";
    });
};

// The table whose records a filter lists, for the names they start with.
const getFilterTableName: (entityType: unknown) => string | null = (
  entityType: unknown,
): string | null => {
  if (
    typeof entityType !== "function" ||
    !(entityType.prototype instanceof BaseModel)
  ) {
    return null;
  }

  return new (entityType as DatabaseBaseModelType)().tableName;
};

/*
 * An entity filter's option: a record, named by whoever made it - a monitor,
 * a team, a label - so its name is drawn as written in the filter's menu and
 * its chip, as the record's row draws it (DropdownOption.isUserContent). It
 * was looked up: a monitor named "Network" read "Red" in a Spanish menu
 * (#7690). A default name of a state, a severity or a status of the
 * filter's own table is OneUptime's word, read in the reader's language as
 * its badge reads it; a name the project gave one is its own - the one rule
 * for them (Utils/DefaultRecordNames). An option the filter's own
 * fetchFilterDropdownOptions marked keeps its mark.
 */
const toRecordFilterOption: (
  option: DropdownOption,
  tableName: string | null,
) => DropdownOption = (
  option: DropdownOption,
  tableName: string | null,
): DropdownOption => {
  return {
    ...option,
    isUserContent:
      option.isUserContent ?? isRecordNameAsWritten(tableName, option.label),
  };
};

/*
 * What an entity filter reads of each record it offers or holds: its name
 * and value, its colour, whether it is archived (a filter lists archived
 * values too - the records that have one stay findable by it - and marks
 * them, so a reader can tell why a value is offered here and not in the
 * forms), what tells records of one name apart (a team's, a label's, an
 * on-call policy's or a schedule's description and when it was made:
 * SharedNameOptions, #10064) and the labels it is guarded by.
 */
const getEntityFilterSelect: (filter: Filter<any>) => Dictionary<unknown> = (
  filter: Filter<any>,
): Dictionary<unknown> => {
  const select: Dictionary<unknown> = {
    [filter.filterDropdownField!.label]: true,
    [filter.filterDropdownField!.value]: true,
  };

  if (!(filter.filterEntityType?.prototype instanceof BaseModel)) {
    return select;
  }

  const filterModel: BaseModel =
    new (filter.filterEntityType as DatabaseBaseModelType)();
  const colorColumnName: string | null = filterModel.getFirstColorColumn();
  const accessControlColumnName: string | null =
    filterModel.getAccessControlColumn();

  if (colorColumnName) {
    select[colorColumnName] = true;
  }

  if (
    ArchivedValuePicker.isArchivableValueModel(
      filter.filterEntityType as DatabaseBaseModelType,
    )
  ) {
    select["isArchived"] = true;
  }

  if (filter.filterDropdownField!.label === "name") {
    Object.assign(
      select,
      getSharedNameSelect(filter.filterEntityType as DatabaseBaseModelType),
    );
  }

  if (accessControlColumnName) {
    select[accessControlColumnName] = {
      _id: true,
      name: true,
      color: true,
    } as JSONObject;
  }

  return select;
};

// One record an entity filter offers or holds, as its option.
const toEntityFilterOption: (
  item: BaseModel | AnalyticsBaseModel,
  filter: Filter<any>,
) => DropdownOption = (
  item: BaseModel | AnalyticsBaseModel,
  filter: Filter<any>,
): DropdownOption => {
  const isDatabaseModel: boolean = Boolean(
    filter.filterEntityType?.prototype instanceof BaseModel,
  );
  const filterModel: BaseModel | null = isDatabaseModel
    ? new (filter.filterEntityType as DatabaseBaseModelType)()
    : null;
  const colorColumnName: string | null = filterModel
    ? filterModel.getFirstColorColumn()
    : null;
  const accessControlColumnName: string | null = filterModel
    ? filterModel.getAccessControlColumn()
    : null;

  const option: DropdownOption = toRecordFilterOption(
    {
      value: item.getColumnValue(filter.filterDropdownField!.value) as string,
      label: item.getColumnValue(filter.filterDropdownField!.label) as string,
    },
    getFilterTableName(filter.filterEntityType),
  );

  // The filter's dropdown draws the Archived tag beside it.
  if (
    isDatabaseModel &&
    ArchivedValuePicker.isArchivableValueModel(
      filter.filterEntityType as DatabaseBaseModelType,
    ) &&
    item.getColumnValue("isArchived") === true
  ) {
    option.isArchived = true;
  }

  const sharedName: DropdownOption["sharedName"] =
    isDatabaseModel && filter.filterDropdownField!.label === "name"
      ? getSharedNameFacts(item as unknown as BaseModel)
      : undefined;

  if (sharedName) {
    option.sharedName = sharedName;
  }

  if (colorColumnName) {
    const colorValue: Color | string | null = item.getColumnValue(
      colorColumnName,
    ) as Color | string | null;

    if (colorValue instanceof Color) {
      option.color = colorValue;
    } else if (typeof colorValue === "string" && colorValue.trim().length > 0) {
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

    const accessControlItems: Array<AccessControlModel> = Array.isArray(
      accessControlValue,
    )
      ? accessControlValue
      : accessControlValue
        ? [accessControlValue]
        : [];

    type SimplifiedDropdownLabel = {
      id?: string;
      name: string;
      color?: Color;
    };

    const dropdownLabels: Array<SimplifiedDropdownLabel> = accessControlItems
      .map((label: AccessControlModel | null) => {
        if (!label) {
          return null;
        }

        const labelNameRaw: string | null = label.getColumnValue("name") as
          | string
          | null;

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

  return option;
};

const BaseModelTable: <TBaseModel extends BaseModel | AnalyticsBaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel | AnalyticsBaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const { translateValue, translateString } = useTranslateValue();
  const translator: Translator = useTranslator();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  const [tableView, setTableView] = useState<TableView | null>(null);

  const matchBulkSelectedItemByField: keyof TBaseModel =
    props.bulkActions?.matchBulkSelectedItemByField || "_id";

  const model: TBaseModel = new props.modelType();

  /*
   * On a private incident, alert or episode's page, what the reader holds
   * on it: its changes are offered only when a team of theirs that owns it
   * may make them (PrivateRecordScope).
   */
  const privateRecordOptions: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(model);

  type GetItemLabelFunction = (item: unknown) => string;

  /*
   * Every per-row Delete in the product opened the same dialog: "Are you sure
   * you want to delete this monitor?" - a sentence equally true of the row that
   * was clicked and of the twenty either side of it. That is precisely the
   * moment a user wants to be told which one, and the one moment the dialog
   * would not say.
   *
   * The row is named by the model's own name column first (a template's
   * templateName, not the title of the incident it creates), then by whatever
   * name-like field the table selected. Only what is on the row is read: this
   * never guesses at a name it was not given.
   */
  const getItemLabel: GetItemLabelFunction = (item: unknown): string => {
    const givenName: string =
      item && props.getItemName
        ? props.getItemName(item as TBaseModel).trim()
        : "";

    return givenName || getRecordDisplayName(item, { model: model });
  };

  type SayItemChangedFunction = (template: string, item: unknown) => void;

  /*
   * A row created or deleted says so in the corner, by its name, or by its
   * kind where it has none: "Nightly Backup deleted", "Monitor created"
   * (#9120). The row was gone, or there, with nothing to say it was the one
   * the person meant.
   */
  const sayItemChanged: SayItemChangedFunction = (
    template: string,
    item: unknown,
  ): void => {
    if (props.hideChangeToasts) {
      return;
    }

    const name: string = getItemLabel(item);

    Toast.success(
      translator.translateTemplate(template, {
        itemName:
          name ||
          translatableTerm(
            getDeleteLabel(props.singularName, model.singularName),
          ),
      }),
    );
  };

  /*
   * What a Delete dialog says after its question, in the reader's language:
   * what this model's records take with them (DeleteConsequences - the same
   * sentence the record's own Delete page says), then the list's own
   * sentence. A table that names its own verb ("Unlink") removes
   * relationships, not the records they point at, so it says only its own.
   */
  type GetDeleteWarningFunction = (listWarning: string | undefined) => string;

  const getDeleteWarning: GetDeleteWarningFunction = (
    listWarning: string | undefined,
  ): string => {
    const sentences: Array<string> = [];

    if (!props.bulkActions?.deleteVerb?.trim()) {
      const consequence: string = getDeleteConsequence(
        model.tableName,
        translator,
      );

      if (consequence) {
        sentences.push(consequence);
      }
    }

    if (listWarning?.trim()) {
      sentences.push(tx(listWarning.trim()));
    }

    // Run together as the reader's script writes sentences.
    return joinSentences(sentences);
  };

  // The header's create button, "<verb> <noun>".
  const getCreateButtonTitle: () => string = (): string => {
    return translateCreateAction(translator, {
      verb: props.createVerb,
      itemName: props.singularName || model.singularName || "",
    });
  };

  /*
   * What it says on a phone: its verb alone, the card's title right above
   * naming the kind (CardButtonSchema.phoneTitle).
   */
  const getCreateButtonPhoneTitle: () => string | undefined = ():
    | string
    | undefined => {
    return getCreateButtonPhoneVerb({
      verb: props.createVerb,
      itemName: props.singularName || model.singularName || "",
    });
  };

  /*
   * How a create / update / delete affordance should be rendered for this
   * viewer. A user without the permission used to simply not see the button,
   * which reads as "this feature does not exist" - and on the flows that route
   * to a dedicated create page it did not even do that: the page opened, the
   * form submitted, and the API refused it with a validation error about a
   * field the user was never shown (issue #3306). The button now stays put and
   * says which permission is missing.
   *
   * `show: false` is reserved for the two cases where there is nothing honest
   * to say - the permission snapshot has not arrived yet, or the model has no
   * permissions declared for the operation at all.
   */
  interface ActionGate {
    show: boolean;
    disabled: boolean;
    tooltip: string | undefined;
  }

  type GetActionGateFunction = (action: ModelAction) => ActionGate;

  const getActionGate: GetActionGateFunction = (
    action: ModelAction,
  ): ActionGate => {
    /*
     * A table that calls its delete "Unlink" must not say the locked button
     * would delete the row's noun ("permission to delete this Alert"). Keyed
     * on deleteVerb alone: deleteButtonText is also set by tables such as
     * "Remove from Project", which keep the default "delete" sentence.
     */
    const result: PermissionGateResult = PermissionGate.check(
      model,
      action,
      withPrivateRecordGateOptions(
        {
          singularName: props.singularName || model.singularName || undefined,
          verb:
            action === ModelAction.Delete
              ? props.bulkActions?.deleteVerb?.trim() || undefined
              : undefined,
        },
        privateRecordOptions,
      ),
    );

    if (result.isAllowed) {
      return { show: true, disabled: false, tooltip: undefined };
    }

    if (result.disabledReason) {
      return { show: true, disabled: true, tooltip: result.disabledReason };
    }

    return { show: false, disabled: false, tooltip: undefined };
  };

  /*
   * Create's gate: the reader's permissions, and - where they allow it - the
   * list's own reason it is locked for them (createDisabledReason).
   */
  const getCreateGate: () => ActionGate = (): ActionGate => {
    const gate: ActionGate = getActionGate(ModelAction.Create);

    if (props.createDisabledReason && gate.show && !gate.disabled) {
      return {
        show: true,
        disabled: true,
        tooltip: props.createDisabledReason,
      };
    }

    return gate;
  };

  const [bulkSelectedItems, setBulkSelectedItems] = useState<Array<TBaseModel>>(
    [],
  );

  /*
   * "Select All" gets its own loading / error state instead of sharing
   * `isLoading` and `error` with fetchItems. They ran concurrently before, so
   * a page refresh landing mid-selection flipped the spinner off and cleared
   * the other's error - which is how a failed select-all could leave the user
   * with only the current page selected and nothing on screen to say so.
   */
  const [isBulkSelectAllLoading, setIsBulkSelectAllLoading] =
    useState<boolean>(false);
  const [bulkSelectionError, setBulkSelectionError] = useState<string>("");
  const [bulkSelectionTotalCount, setBulkSelectionTotalCount] =
    useState<number>(0);
  const [isBulkSelectionTruncated, setIsBulkSelectionTruncated] =
    useState<boolean>(false);

  /*
   * The paged select-all spans several round trips, so the user can clear the
   * selection or start another one while it is still running. Every run takes
   * a token and drops its results if a newer one has since started.
   */
  const bulkSelectAllToken: MutableRefObject<number> = React.useRef<number>(0);

  let showAs: ShowAs | undefined = props.showAs;

  if (!showAs) {
    showAs = ShowAs.Table;
  }

  const propsQueryRef: React.MutableRefObject<Query<TBaseModel>> = React.useRef(
    props.query || {},
  );

  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  /*
   * The ID Show ID is showing, as text - null while its dialog is closed. A
   * row's `_id` is a string on a database model but an ObjectID on an
   * analytics row (a span, an LLM call), so it is read with getRecordIdText
   * and never cast: the cast handed React an object (issue #4615).
   */
  const [viewId, setViewId] = useState<string | null>(null);
  const [tableColumns, setColumns] = useState<Array<TableColumn<TBaseModel>>>(
    [],
  );
  /*
   * Whether serializeToTableColumns has run yet. It runs in an effect, after
   * the first paint, so until then tableColumns is empty because nothing has
   * been built, not because every column was denied.
   */
  const [hasBuiltColumns, setHasBuiltColumns] = useState<boolean>(false);

  /*
   * ---------------------------------------------------------------------
   * Viewer-customizable columns
   * ---------------------------------------------------------------------
   *
   * The viewer's layout (which columns are on, and in what order) is a
   * personal, presentational preference, so it lives in localStorage next to
   * the page size rather than on the server: saved views are named, explicit,
   * plan-gated and need write permission, none of which should stand between
   * someone and hiding a column they don't care about. A saved view can still
   * carry a layout of its own, and when one is active it wins.
   *
   * Custom fields are appended to the declared columns as additional,
   * off-by-default columns; from here on they are ordinary columns.
   */
  const customFieldColumns: CustomFieldColumnsResult<TBaseModel> =
    useCustomFieldColumns<TBaseModel>({
      customFieldsModelType: props.customFieldsModelType,
    });

  const isColumnCustomizationEnabled: boolean = Boolean(
    !props.disableColumnCustomization && props.userPreferencesKey,
  );

  type ReadStoredColumnPreferenceFunction = () => ColumnPreference | null;

  const readStoredColumnPreference: ReadStoredColumnPreferenceFunction =
    (): ColumnPreference | null => {
      if (!props.userPreferencesKey) {
        return null;
      }

      return columnPreferenceFromJSON(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: props.userPreferencesKey,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      );
    };

  const [columnPreference, setColumnPreference] =
    useState<ColumnPreference | null>(readStoredColumnPreference);

  /*
   * The project's default columns for this list, which everyone who has
   * picked none of their own sees (ModelTable/ProjectDefaultColumns). Read
   * off the project the page holds as the table is first drawn: no read of
   * its own, and no columns that change once one lands.
   */
  const [projectDefaultPreference, setProjectDefaultPreference] =
    useState<ColumnPreference | null>(() => {
      return isColumnCustomizationEnabled
        ? readProjectDefaultColumns(props.userPreferencesKey)
        : null;
    });

  /*
   * The layout the list is drawn with: the viewer's own, else the
   * project's default for the list, else - nothing - the list's own
   * columns.
   */
  const layoutPreference: ColumnPreference | null =
    columnPreference || projectDefaultPreference;

  const [showColumnCustomizationModal, setShowColumnCustomizationModal] =
    useState<boolean>(false);

  // The project's default columns being saved or taken away, and why not.
  const [isSavingProjectDefault, setIsSavingProjectDefault] =
    useState<boolean>(false);
  const [projectDefaultError, setProjectDefaultError] = useState<string>("");

  /*
   * ---------------------------------------------------------------------
   * Attribute columns
   * ---------------------------------------------------------------------
   *
   * A column per viewer-chosen key inside the model's map column. There is no
   * second store for "which keys did they pick": a column exists precisely
   * when its id is in the stored layout, and the id encodes the key. That is
   * what makes "Reset to default" take them away, a saved TableView bring its
   * own, and the two halves of a layout impossible to desynchronize.
   *
   * Derived from the RAW preference, before sanitizing: sanitizing drops ids
   * that name no current column, and these are only current columns *because*
   * their ids are in there.
   */
  const attributeColumnKey: string | null = useMemo(() => {
    const columnKey: string | undefined =
      props.attributeColumnsProps?.columnKey;

    if (!columnKey || !isColumnCustomizationEnabled) {
      return null;
    }

    /*
     * A key that is not a column on the model would make getSelectFromColumns
     * throw and blank the whole table. A misconfigured prop should cost the
     * feature, not the page.
     */
    return model.hasColumn(columnKey) ? columnKey : null;
  }, [props.attributeColumnsProps?.columnKey, isColumnCustomizationEnabled]);

  const declaredColumns: Columns<TBaseModel> = useMemo(() => {
    if (customFieldColumns.columns.length === 0) {
      return props.columns || [];
    }

    return [...(props.columns || []), ...customFieldColumns.columns];
  }, [props.columns, customFieldColumns.columns]);

  const attributeColumns: Columns<TBaseModel> = useMemo(() => {
    if (!attributeColumnKey) {
      return [];
    }

    return getAttributeColumns<TBaseModel>({
      attributesColumnKey: attributeColumnKey,
      attributeKeys: getAttributeKeysFromColumnPreference({
        preference: layoutPreference,
        attributesColumnKey: attributeColumnKey,
        reservedColumnIds: getColumnIds<TBaseModel>(declaredColumns),
      }),
    });
  }, [attributeColumnKey, layoutPreference, declaredColumns]);

  const allColumns: Columns<TBaseModel> = useMemo(() => {
    if (attributeColumns.length === 0) {
      return declaredColumns;
    }

    return [...declaredColumns, ...attributeColumns];
  }, [declaredColumns, attributeColumns]);

  /*
   * Ids are derived over the *whole* declared set, so a column dropping out
   * for lack of permission can never renumber the ones that remain.
   */
  const allColumnIds: Array<string> = useMemo(() => {
    return getColumnIds<TBaseModel>(allColumns);
  }, [allColumns]);

  /*
   * How the list is sorted by each column that shows a related record - a
   * severity by its place in the project's list, a monitor by its name -
   * by the key its header sorts on (ColumnSort's getRelationColumnSort).
   * Over every declared column, as the select is: a sort restored from the
   * URL or a saved view may name a column the viewer has switched off.
   */
  const relationColumnSorts: Map<string, RelationColumnSort> = useMemo(() => {
    return getRelationColumnSorts<TBaseModel>(model, allColumns);
  }, [allColumns]);

  const effectiveColumnPreference: ColumnPreference | null = useMemo(() => {
    if (!isColumnCustomizationEnabled) {
      return null;
    }

    /*
     * A stored layout outlives the release that wrote it, so anything naming
     * a column this table no longer has is dropped before it is applied.
     */
    return sanitizeColumnPreference({
      preference: layoutPreference,
      knownColumnIds: allColumnIds,
    });
  }, [layoutPreference, allColumnIds, isColumnCustomizationEnabled]);

  // The viewer's own layout alone: what Reset to default takes away.
  const ownColumnPreference: ColumnPreference | null = useMemo(() => {
    if (!isColumnCustomizationEnabled) {
      return null;
    }

    return sanitizeColumnPreference({
      preference: columnPreference,
      knownColumnIds: allColumnIds,
    });
  }, [columnPreference, allColumnIds, isColumnCustomizationEnabled]);

  // The project's default for the list, as this list's columns read it.
  const projectDefaultColumnPreference: ColumnPreference | null =
    useMemo(() => {
      if (!isColumnCustomizationEnabled) {
        return null;
      }

      return sanitizeColumnPreference({
        preference: projectDefaultPreference,
        knownColumnIds: allColumnIds,
      });
    }, [projectDefaultPreference, allColumnIds, isColumnCustomizationEnabled]);

  type SaveColumnPreferenceFunction = (
    preference: ColumnPreference | null,
  ) => void;

  const saveColumnPreference: SaveColumnPreferenceFunction = (
    preference: ColumnPreference | null,
  ): void => {
    setColumnPreference(preference);

    if (!props.userPreferencesKey) {
      return;
    }

    const json: JSONObject | null = columnPreferenceToJSON(preference);

    if (!json) {
      UserPreferences.removeUserPreferenceByType({
        key: props.userPreferencesKey,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
      });
      return;
    }

    UserPreferences.saveUserPreferenceByTypeAsJSON({
      key: props.userPreferencesKey,
      userPreferenceType: UserPreferenceType.BaseModelTableColumns,
      value: json,
    });
  };

  /*
   * The pool of keys the picker offers. Fetched the first time the picker
   * opens, never on mount: it is a wide scan over the analytics table, and a
   * table nobody customizes should not pay for it on every page load.
   */
  const [attributeKeyPool, setAttributeKeyPool] = useState<{
    keys: Array<string>;
    isLoading: boolean;
    error: string;
    hasLoaded: boolean;
  }>({ keys: [], isLoading: false, error: "", hasLoaded: false });

  const [classicTableFilters, setClassicTableFilters] = useState<
    Array<ClassicFilterType<TBaseModel>>
  >([]);

  const [cardButtons, setCardButtons] = useState<
    Array<CardButtonSchema | ReactElement>
  >([]);

  /*
   * The table's own row actions - Show ID, View, Edit and Delete - built
   * with the columns. The list's own actions go before them.
   */
  const [builtInRowActions, setBuiltInRowActions] = useState<
    Array<ActionButtonSchema<TBaseModel>>
  >([]);

  /*
   * A row action that changed its row asks for the rows again
   * (RowActionContext.refresh): counted here, and read by the fetch below,
   * so the read goes out with the page, sort and filters of the moment. The
   * page's side-menu counts follow - an alert resolved from its row leaves
   * "Active Alerts" (SideMenuCountRefresh).
   */
  const [rowActionRefreshCount, setRowActionRefreshCount] = useState<number>(0);

  const rowActionContext: RowActionContext = useMemo(() => {
    return {
      refresh: (): void => {
        setRowActionRefreshCount((count: number): number => {
          return count + 1;
        });
        refreshSideMenuCounts();
      },
    };
  }, []);

  /*
   * Every row's actions: the list's own first - the everyday actions of its
   * kind, Acknowledge or Disable, head the ⋯ menu - then the table's: Show
   * ID, a utility every row carries, View, Edit and Delete. The list's are
   * read from the props on every render, so an action that depends on
   * something the page loaded later (the project's states, the viewer's
   * owners) is never the one the first render saw, and each is handed the
   * list's refresh as it runs.
   */
  const actionButtonSchema: Array<ActionButtonSchema<TBaseModel>> =
    useMemo(() => {
      return [
        ...withRowActionContext<TBaseModel>(
          props.actionButtons || [],
          rowActionContext,
        ),
        ...builtInRowActions,
      ];
    }, [builtInRowActions, props.actionButtons, rowActionContext]);

  useEffect(() => {
    // A locked Create opens nothing (createDisabledReason).
    if (props.showCreateForm && !props.createDisabledReason) {
      setShowModal(true);
      setModalType(ModalType.Create);
    }
  }, [props.showCreateForm]);

  /*
   * "?create=1" (opensCreateFormFromAddress, #7035): the list's create form
   * opens as its Create button opens it - its own dialog, or the page's
   * (onCreateClick) - for whoever the button is open to. Asked while the
   * permission snapshot is still on its way, it waits for it; refused, the
   * list shows with Create locked, as anyone sees it. Read on every render,
   * so a link to the list from the list itself opens the form too.
   */
  const isCreateFormAskedForByAddress: boolean =
    Boolean(props.opensCreateFormFromAddress && props.isCreateable) &&
    CreateFormAddress.isAskedFor();
  const addressCreateGate: ActionGate | null = isCreateFormAskedForByAddress
    ? getCreateGate()
    : null;
  const mayOpenCreateFormFromAddress: boolean = Boolean(
    addressCreateGate?.show && !addressCreateGate.disabled,
  );

  useEffect(() => {
    if (!mayOpenCreateFormFromAddress) {
      return;
    }

    if (props.onCreateClick) {
      props.onCreateClick();
      return;
    }

    setModalType(ModalType.Create);
    setShowModal(true);
  }, [mayOpenCreateFormFromAddress]);

  /*
   * The create form closed, cancelled or saved: the address no longer asks
   * for it, so Back to this list never opens it again (CreateFormAddress).
   */
  const takeCreateFormOffAddress: () => void = (): void => {
    if (props.opensCreateFormFromAddress) {
      CreateFormAddress.clear();
    }
  };

  useEffect(() => {
    if (props.onShowFormType) {
      props.onShowFormType(modalType);
    }
  }, [props.modelType]);

  /*
   * A list people put in order by dragging its rows (enableDragAndDrop with
   * the column that holds the order). Such a list is always shown in that
   * order - sorting it by another column would make "drag it above that
   * one" meaningless - and its order is never typed in: the server puts a
   * new row at the end and keeps the numbers (@ListOrderColumn).
   */
  const isManuallyOrdered: boolean = Boolean(
    props.enableDragAndDrop && props.dragDropIndexField,
  );

  /*
   * Which end of the numbers is the top: the model says so when it is a
   * @ListOrderColumn list (site assignment rules count down), else the
   * table's own sort order.
   */
  const getManualSortOrder: () => SortOrder = (): SortOrder => {
    const listOrder: ListOrderSettings | null =
      model instanceof BaseModel ? model.getListOrder() : null;

    if (listOrder && listOrder.column === props.dragDropIndexField) {
      return listOrder.sortOrder;
    }

    return props.sortOrder || SortOrder.Ascending;
  };

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

    return (
      props.initialItemsOnPage ||
      (isManuallyOrdered ? MANUALLY_ORDERED_ITEMS_ON_PAGE : 10)
    );
  };

  /*
   * ---------------------------------------------------------------------
   * URL-persisted view state
   * ---------------------------------------------------------------------
   *
   * The table mirrors its filters, facets, search, sort and page into the URL
   * query string so that (a) navigating into a row and pressing Back brings
   * the same filtered view back, and (b) the URL can be pasted to a teammate.
   *
   * The snapshot is read *once, synchronously, during the first render* and
   * fed to the `useState` initializers below. Restoring in an effect instead
   * would fire the first fetch against the unfiltered defaults and then throw
   * that response away — a visible flash of the wrong rows plus a wasted
   * request.
   */
  const urlStateKey: string | undefined = props.disableUrlState
    ? undefined
    : props.urlStateKey ||
      props.saveFilterProps?.tableId ||
      props.userPreferencesKey ||
      undefined;

  const initialUrlState: {
    filter: FilterData<TBaseModel> | null;
    view: TableViewUrlStateData;
  } = useMemo(() => {
    const restoredFilter: JSONObject | null = TableFilterUrlState.read(
      urlStateKey,
      "filter",
    );

    /*
     * Anything on the URL is user-editable, so keep only the fields this table
     * actually offers a filter for before it reaches the outgoing query - a
     * filter the table has since renamed read under its new key first.
     */
    const sanitized: FilterData<TBaseModel> | null = restoredFilter
      ? sanitizeFilterData<TBaseModel>({
          filterData: renameFilterDataKeys<TBaseModel>({
            filterData: restoredFilter as unknown as FilterData<TBaseModel>,
            renamedKeys: props.renamedFilterKeys,
          }),
          filters: props.filters,
        })
      : null;

    return {
      filter: sanitized && Object.keys(sanitized).length > 0 ? sanitized : null,
      view: TableViewUrlState.fromJSON(
        TableFilterUrlState.read(urlStateKey, "view"),
      ),
    };
  }, []);

  // Surfaces two tables on one page accidentally sharing a URL namespace.
  useEffect(() => {
    return TableFilterUrlState.claimKey(urlStateKey);
  }, [urlStateKey]);

  const [onBeforeFetchData, setOnBeforeFetchData] = useState<
    TBaseModel | undefined
  >(undefined);
  const [data, setData] = useState<Array<TBaseModel>>([]);
  const [query, setQuery] = useState<Query<TBaseModel>>(() => {
    return buildQueryFromFilterData<TBaseModel>({
      filterData: initialUrlState.filter || props.initialFilterData || {},
      filters: props.filters,
    });
  });
  const [currentPageNumber, setCurrentPageNumber] = useState<number>(
    initialUrlState.view.page || 1,
  );
  const [totalItemsCount, setTotalItemsCount] = useState<number>(0);
  /*
   * Analytics endpoints (Log/Span/Metric/...) skip COUNT(*) for
   * performance and instead return `hasMore`. When `hasMore` is
   * `undefined`, the endpoint emitted an exact `count` and the
   * pagination falls back to the count-based UI.
   */
  const [hasMore, setHasMore] = useState<boolean | undefined>(undefined);
  /*
   * The count stopped at its cap: totalItemsCount is the cap, read
   * "10,000+", and the list pages by previous and next (ListCount.ts). The
   * ref is what a read asks with, including a live read's closure.
   */
  const [isCountCapped, setIsCountCapped] = useState<boolean>(false);
  const listCountRef: MutableRefObject<ListCountState> =
    React.useRef<ListCountState>(EMPTY_LIST_COUNT);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /*
   * The last load found the list empty with nothing narrowing it - no
   * record, no search, filter or chip (isListEmptyWithNothingApplied). A
   * table whose emptyState asks for it (hideTopContentWhileEmpty: the
   * facet chips) then leaves its topContent out. False until a load says
   * so, so a list that has records never draws without its chips first.
   */
  const [isEmptyWithNothingApplied, setIsEmptyWithNothingApplied] =
    useState<boolean>(false);

  const [error, setError] = useState<string>("");
  const [tableFilterError, setTableFilterError] = useState<string>("");

  // A dropped row's new place is being saved.
  const [isReordering, setIsReordering] = useState<boolean>(false);
  // Why the last drop could not be saved - the rows went back.
  const [reorderError, setReorderError] = useState<string>("");
  // For screen readers: the last drop was saved.
  const [isReorderSaved, setIsReorderSaved] = useState<boolean>(false);

  /*
   * Auto-detect label support from the existing filters array. We look for
   * the filter whose `filterEntityType` class name is "Label" and reuse its
   * dropdown wiring (entity type, fetch query, label/value field names) so
   * search inherits whatever scoping the filter popup already had.
   *
   * Computed before the search state below because the `labels` slice of a
   * restored URL is only meaningful when this is non-null.
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

  /*
   * The label chips are a feature of the in-search Label filter, so a table
   * without one has to ignore the URL's `labels` slice entirely.
   *
   * Tables that have since moved Labels out to a facet chip (Monitors,
   * Network Devices) still receive `labels` from older shared/bookmarked
   * links. Seeding those ids anyway produced a chip the table could neither
   * name (`availableLabels` is only fetched when there *is* a config) nor
   * apply (`buildSearchQueryFragment` skips the constraint for the same
   * reason): a force-expanded search box with a raw-UUID pill sitting above a
   * completely unfiltered list, re-persisted on every write until the user
   * clicked its ×. Dropping it here also means the next view write omits the
   * key, so the URL heals itself.
   */
  const restoredLabelIds: Array<string> = labelFilterConfig
    ? initialUrlState.view.labels || []
    : [];

  const [searchText, setSearchText] = useState<string>(
    initialUrlState.view.search || "",
  );
  const [debouncedSearchText, setDebouncedSearchText] = useState<string>(
    initialUrlState.view.search || "",
  );
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState<boolean>(
    Boolean(initialUrlState.view.search || restoredLabelIds.length),
  );
  const searchInputRef: React.RefObject<HTMLInputElement> =
    React.useRef<HTMLInputElement>(null!);

  interface SearchLabelOption {
    id: string;
    name: string;
    color: string;
    // What tells it from another label of its name (#10314).
    sharedName?: SharedNameFacts | undefined;
    /*
     * A chip restored from a link whose label no record answers to any
     * more - deleted since, or out of the reader's reach (#10646): it
     * still narrows the list, reads "No longer available", and can be
     * taken out.
     */
    isNotFound?: boolean | undefined;
  }

  const [availableLabels, setAvailableLabels] = useState<
    Array<SearchLabelOption>
  >([]);
  /*
   * Restored label chips start as bare IDs — the id is all the query needs, so
   * rows are correct on the very first fetch. The human-readable name/colour
   * are filled in once they are read by their ids, below.
   */
  const [selectedLabels, setSelectedLabels] = useState<
    Array<SearchLabelOption>
  >(() => {
    return restoredLabelIds.map((id: string) => {
      return { id: id, name: id, color: "#94a3b8" };
    });
  });
  const [isLabelsLoading, setIsLabelsLoading] = useState<boolean>(false);
  const [labelDropdownIndex, setLabelDropdownIndex] = useState<number>(0);

  /*
   * The list's own reads, as a ModelAPI for the pickers it draws and the
   * reads by id it makes (#10646): every one goes through
   * callbacks.getList, so a list the Admin Dashboard draws reads as the
   * master admin, never the project the browser last opened. One object
   * for the list's life: a picker searches again when its API changes.
   */
  const callbacksRef: MutableRefObject<BaseTableCallbacks<TBaseModel>> =
    React.useRef<BaseTableCallbacks<TBaseModel>>(props.callbacks);
  callbacksRef.current = props.callbacks;
  const tableModelAPI: typeof ModelAPI = useMemo(() => {
    return {
      getList: (options: unknown): Promise<unknown> => {
        return callbacksRef.current.getList(options as never);
      },
    } as unknown as typeof ModelAPI;
  }, []);

  /*
   * Only the *ids* affect the query, so effects key off this instead of the
   * array itself. Without it, merely re-labelling a chip (which happens when
   * URL-restored chips get their display name hydrated) would look like a
   * filter change and trigger a refetch + a jump back to page 1.
   */
  const selectedLabelIds: Array<string> = useMemo(() => {
    return selectedLabels.map((l: SearchLabelOption) => {
      return l.id;
    });
  }, [selectedLabels]);

  const selectedLabelIdsKey: string = selectedLabelIds.join(",");

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
  useTableHeaderSearchShortcut(
    Boolean(props.searchableFields && props.searchableFields.length > 0),
    (): void => {
      setIsSearchExpanded(true);
      // Wait one frame so the input mounts/becomes visible before focusing.
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    },
  );

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
  }, [debouncedSearchText, selectedLabelIdsKey]);

  /*
   * Effects run on mount too, so without this guard the very first pass would
   * stomp a page number restored from the URL back to 1.
   */
  const isFirstRenderRef: MutableRefObject<boolean> = React.useRef(true);

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    // reset to first page whenever the active search term or labels change
    setCurrentPageNumber(1);
  }, [debouncedSearchText, selectedLabelIdsKey]);

  /*
   * `props.filters` is not frozen — a page can rebuild it after mount, and
   * that is exactly how a Labels filter leaves the popup for the facet bar.
   * Chips left over from a config that no longer exists are unnameable and
   * unappliable, so drop them here too rather than only at mount.
   */
  useEffect(() => {
    if (labelFilterConfig) {
      return;
    }

    setSelectedLabels((existing: Array<SearchLabelOption>) => {
      /*
       * Same array when there is nothing to clear, so this costs an idle table
       * no re-render.
       */
      return existing.length === 0 ? existing : [];
    });
  }, [labelFilterConfig]);

  /*
   * A label read for the search: its name, colour and what tells it from
   * another of its name.
   */
  const toSearchLabelOption: (item: unknown) => SearchLabelOption = (
    item: unknown,
  ): SearchLabelOption => {
    const raw: any = item;
    const colorAny: any = raw["color"];
    const colorHex: string =
      (colorAny &&
        (typeof colorAny === "string"
          ? colorAny
          : colorAny.value || (colorAny.toString && colorAny.toString()))) ||
      "#94a3b8";

    return {
      id: raw["_id"]?.toString() || "",
      name: (raw[labelFilterConfig?.labelField || "name"] as string) || "",
      color: colorHex,
      sharedName:
        labelFilterConfig?.labelField === "name"
          ? getSharedNameFacts(item as BaseModel)
          : undefined,
    } as SearchLabelOption;
  };

  const getSearchLabelSelect: () => any = (): any => {
    return {
      _id: true,
      [labelFilterConfig?.labelField || "name"]: true,
      color: true,
      // What tells two labels of one name apart (#10314).
      ...getSharedNameSelect(labelFilterConfig?.entityType),
    };
  };

  /*
   * The labels "@" suggests, searched on the server as the mention is typed
   * (#10646): the ones whose name holds what follows the "@", by name, as
   * many as the list shows past the ones already picked. It read the
   * first 200 by name once and filtered them here, so a label past them
   * was never suggested.
   */
  const labelMention: TableLabelMention = parseTableLabelMention(searchText);
  const labelMentionSearch: string | null =
    labelFilterConfig && isSearchExpanded && labelMention.hasMention
      ? labelMention.prefix.trim()
      : null;
  const selectedLabelCountRef: MutableRefObject<number> =
    React.useRef<number>(0);
  selectedLabelCountRef.current = selectedLabels.length;

  useEffect(() => {
    if (labelMentionSearch === null || !labelFilterConfig) {
      return;
    }

    let cancelled: boolean = false;
    setIsLabelsLoading(true);

    const timer: ReturnType<typeof setTimeout> = setTimeout(
      async () => {
        try {
          const result: ListResult<TBaseModel> =
            await callbacksRef.current.getList({
              modelType: labelFilterConfig.entityType,
              query: withSearch(
                labelFilterConfig.fetchQuery || {},
                labelFilterConfig.labelField,
                labelMentionSearch,
              ) as any,
              // The picked ones are left out of what is suggested.
              limit: Math.min(
                TABLE_LABEL_SUGGESTIONS_SHOWN + selectedLabelCountRef.current,
                50,
              ),
              skip: 0,
              select: getSearchLabelSelect(),
              sort: {
                [labelFilterConfig.labelField]: SortOrder.Ascending,
              } as any,
            });

          if (cancelled) {
            return;
          }

          setAvailableLabels(
            (result.data || [])
              .map((item: unknown) => {
                return toSearchLabelOption(item);
              })
              .filter((l: SearchLabelOption) => {
                return l.id && l.name;
              }),
          );
        } catch {
          // Silently fail — search still works without label suggestions.
        } finally {
          if (!cancelled) {
            setIsLabelsLoading(false);
          }
        }
      },
      labelMentionSearch === "" ? 0 : TABLE_LABEL_SEARCH_DEBOUNCE_MS,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [labelMentionSearch, labelFilterConfig]);

  /*
   * Chips restored from the URL only carry an id. They are read by their
   * ids (#10646) - never looked for among the first labels by name, where
   * one past them kept its raw id - so the chip reads "Production". One no
   * record answers to any more (deleted, or not visible to this user) still
   * narrows the list, which beats silently dropping a constraint from a
   * shared link, and reads "No longer available", to take out.
   */
  useEffect(() => {
    if (!labelFilterConfig || restoredLabelIds.length === 0) {
      return;
    }

    let cancelled: boolean = false;

    (async () => {
      try {
        const records: Array<BaseModel> = await RecordsById.read<BaseModel>({
          modelType: labelFilterConfig.entityType,
          ids: restoredLabelIds,
          select: getSearchLabelSelect(),
          modelAPI: tableModelAPI,
        });

        if (cancelled) {
          return;
        }

        const byId: Map<string, BaseModel> = RecordsById.byValue({
          records: records,
        });
        const restored: Set<string> = new Set<string>(
          RecordsById.getValuesToRead({ ids: restoredLabelIds }),
        );

        setSelectedLabels((current: Array<SearchLabelOption>) => {
          return current.map((selected: SearchLabelOption) => {
            const key: string = selected.id.toLowerCase();

            // A chip picked since, from a suggestion, is named already.
            if (!restored.has(key) || selected.name !== selected.id) {
              return selected;
            }

            const record: BaseModel | undefined = byId.get(key);

            if (!record) {
              return { ...selected, isNotFound: true };
            }

            return { ...toSearchLabelOption(record), id: selected.id };
          });
        });
      } catch {
        // Unread, the chips keep their ids: the filter still applies.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [labelFilterConfig]);

  /*
   * Labels named alike before names were held to one label each (#10314):
   * each suggestion wears its list's pill and what sets it apart, and a
   * picked one says it after its name, so two picked twins read as two.
   */
  const searchLabelMarks: Map<string, SharedNameMark> = useMemo(() => {
    /*
     * Among every label the search knows: the suggestions, and the chips -
     * a chip restored from a link is read by its id, not suggested
     * (#10646).
     */
    const known: Map<string, SearchLabelOption> = new Map<
      string,
      SearchLabelOption
    >();

    for (const label of [...availableLabels, ...selectedLabels]) {
      const before: SearchLabelOption | undefined = known.get(label.id);

      if (
        !label.isNotFound &&
        (!before || (!before.sharedName && label.sharedName))
      ) {
        known.set(label.id, label);
      }
    }

    return getSharedNameMarks(
      Array.from(known.values()).map((label: SearchLabelOption) => {
        return {
          value: label.id,
          label: label.name,
          sharedName: label.sharedName,
        };
      }),
      translator,
    );
  }, [availableLabels, selectedLabels, translator]);

  const [showModel, setShowModal] = useState<boolean>(false);
  const [showFilterModal, setShowFilterModal] = useState<boolean>(false);
  const [modalType, setModalType] = useState<ModalType>(ModalType.Create);
  const [sortBy, setSortBy] = useState<keyof TBaseModel | null>(
    (initialUrlState.view.sortBy as keyof TBaseModel | undefined) ||
      props.sortBy ||
      null,
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    initialUrlState.view.sortOrder || props.sortOrder || SortOrder.Ascending,
  );
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] =
    useState<boolean>(false);
  const [currentEditableItem, setCurrentEditableItem] =
    useState<TBaseModel | null>(null);
  const [currentDeleteableItem, setCurrentDeleteableItem] =
    useState<TBaseModel | null>(null);
  // The caller's wording for the open Delete dialog; null means the default.
  /*
   * The Delete dialog's alternative ("Archive instead") while it runs, and
   * why it failed: the dialog stays open on a failure, with the reason.
   */
  const [isDeleteAlternativeRunning, setIsDeleteAlternativeRunning] =
    useState<boolean>(false);
  const [deleteAlternativeError, setDeleteAlternativeError] =
    useState<string>("");

  type RunDeleteAlternativeFunction = (
    alternative: DeleteConfirmationAlternative,
  ) => Promise<void>;

  const runDeleteAlternative: RunDeleteAlternativeFunction = async (
    alternative: DeleteConfirmationAlternative,
  ): Promise<void> => {
    setDeleteAlternativeError("");
    setIsDeleteAlternativeRunning(true);

    try {
      await alternative.onClick();
      setShowDeleteConfirmModal(false);
      await fetchItems({ quiet: true });
    } catch (err) {
      setDeleteAlternativeError(API.getFriendlyMessage(err));
    } finally {
      setIsDeleteAlternativeRunning(false);
    }
  };

  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmation | null>(null);

  /*
   * The Delete dialog opened before its wording arrived
   * (DELETE_CONFIRMATION_LOADING_DELAY_MS), and which opening is the
   * current one: one the person closed while it was still being read never
   * opens again, or shows its error, when the answer comes.
   */
  const [isDeleteConfirmationLoading, setIsDeleteConfirmationLoading] =
    useState<boolean>(false);
  const deleteConfirmationRequest: MutableRefObject<number> =
    React.useRef<number>(0);

  const closeDeleteConfirmModal: () => void = (): void => {
    deleteConfirmationRequest.current += 1;
    setShowDeleteConfirmModal(false);
    setIsDeleteConfirmationLoading(false);
    setDeleteAlternativeError("");
  };

  /*
   * A page size that came in on the URL wins over the viewer's own stored
   * preference — a shared link should render the same slice of rows for
   * everyone who opens it.
   */
  const [itemsOnPage, setItemsOnPage] = useState<number>(
    initialUrlState.view.itemsOnPage || getItemsOnPage(),
  );

  /*
   * Page size is a personal preference (it already lives in localStorage), so
   * it is only put on the URL once it is explicitly part of *this* view —
   * either it arrived on the link, or the viewer changed it here. Otherwise
   * every table would carry a redundant `itemsOnPage` param.
   */
  const isItemsOnPageExplicitRef: MutableRefObject<boolean> = React.useRef(
    Boolean(initialUrlState.view.itemsOnPage),
  );

  /*
   * Counts the reads of the page, so a read the list made by itself (it
   * keeps itself current, useLiveRows) that answers after a read the reader
   * asked for - another page, a search - is dropped rather than put back
   * over the rows they asked for.
   */
  const fetchGenerationRef: MutableRefObject<number> = React.useRef(0);

  /*
   * The ids of the rows on the page, as last read: null until the first
   * read draws them.
   */
  const shownRowIdsRef: MutableRefObject<Array<string> | null> =
    React.useRef<Array<string> | null>(null);

  /*
   * The rows a live read just brought in (useLiveRows), tinted for a moment
   * (data-row-arrived, LiveRows.LIVE_ROWS_ARRIVED_IN_MS) so the eye finds the
   * new incident among the rows that moved down for it.
   */
  const [arrivedRowIds, setArrivedRowIds] =
    useState<ReadonlySet<string>>(NO_ARRIVED_ROWS);
  const arrivedTimerRef: MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const markArrivedRows: (ids: Array<string>) => void = (
    ids: Array<string>,
  ): void => {
    if (arrivedTimerRef.current !== null) {
      clearTimeout(arrivedTimerRef.current);
      arrivedTimerRef.current = null;
    }

    if (ids.length === 0) {
      setArrivedRowIds(NO_ARRIVED_ROWS);
      return;
    }

    setArrivedRowIds(new Set(ids));

    arrivedTimerRef.current = setTimeout((): void => {
      arrivedTimerRef.current = null;
      setArrivedRowIds(NO_ARRIVED_ROWS);
    }, LIVE_ROWS_ARRIVED_IN_MS);
  };

  useEffect(() => {
    return (): void => {
      if (arrivedTimerRef.current !== null) {
        clearTimeout(arrivedTimerRef.current);
        arrivedTimerRef.current = null;
      }
    };
  }, []);

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

      /*
       * This is how facet-bar selections reach the API, so narrowing the
       * result set has to send the user back to page 1 — exactly like the
       * column-filter path does in `onFilterChanged`. Without it, changing a
       * facet while on page 5 re-queries page 5 of a now-shorter list and
       * lands on an empty page (and, since the page number is mirrored into
       * the URL, shares that empty page too).
       *
       * When the page is already 1, `setCurrentPageNumber` is a no-op and the
       * explicit fetch below is what refreshes the list; when it isn't, the
       * state change re-runs the main fetch effect.
       */
      if (currentPageNumber !== 1) {
        setCurrentPageNumber(1);
        return;
      }

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
        // A row the column leaves off this item's card (showInListIf).
        showIf: column.showInListIf,
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
      /*
       * Deliberately the *unfiltered* column set. See getSelect() below.
       */
      return getRelationSelectFromColumns<TBaseModel>({
        columns: allColumns,
        model: model,
      });
    };

  type DeleteItemFunction = (
    item: TBaseModel,
    miscDataProps?: JSONObject | undefined,
  ) => Promise<void>;

  const deleteItem: DeleteItemFunction = async (
    item: TBaseModel,
    miscDataProps?: JSONObject | undefined,
  ) => {
    if (!item.id) {
      throw new BadDataException("item.id cannot be null");
    }

    setIsLoading(true);

    try {
      await props.callbacks.deleteItem(item, miscDataProps);

      // The record is gone from every count beside the list too.
      refreshSideMenuCounts();

      props.onItemDeleted?.(item);

      /*
       * A table with its own word for its delete (Remove, Unlink, Reject)
       * takes the row away without deleting what it points at.
       */
      const hasOwnDeleteWord: boolean = Boolean(
        props.bulkActions?.deleteVerb?.trim() ||
          (props.deleteButtonText?.trim() &&
            props.deleteButtonText.trim() !== "Delete"),
      );

      sayItemChanged(hasOwnDeleteWord ? ITEM_REMOVED : ITEM_DELETED, item);

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

    /*
     * The viewer's layout is applied to the *input* of this loop, never to
     * the finished array: the Actions column is appended below and has to
     * stay last, and it is generated rather than declared, so it is not the
     * viewer's to move or switch off.
     */
    const columnsToRender: Columns<TBaseModel> =
      applyColumnPreference<TBaseModel>({
        columns: allColumns,
        preference: effectiveColumnPreference,
      });

    const columnIdByColumn: Map<
      ModelTableColumn<TBaseModel>,
      string
    > = new Map();

    allColumns.forEach(
      (column: ModelTableColumn<TBaseModel>, index: number) => {
        columnIdByColumn.set(column, allColumnIds[index] as string);
      },
    );

    for (const column of columnsToRender) {
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

        const disableSort: boolean = Boolean(
          column.disableSort ||
            shouldDisableSort(column, key) ||
            isDrawnFromRecordId<TBaseModel>(column, key),
        );

        const relationSort: RelationColumnSort | undefined = columnKey
          ? relationColumnSorts.get(String(columnKey))
          : undefined;

        columns.push({
          ...column,
          id: columnIdByColumn.get(column),
          /*
           * Nor does a column that draws its own thing from the record's id
           * (Owners): it would sort by the id (isDrawnFromRecordId).
           */
          disableSort: disableSort,
          /*
           * A severity, a state or a status goes worst first on its first
           * click (ColumnSort's RelationColumnSort).
           */
          firstSortOrder: disableSort
            ? undefined
            : relationSort?.firstSortOrder,
          key: columnKey,
          /*
           * `key` is only the first declared field, so a cell composed from
           * several of them would export just that one. Hand the exporter
           * every field the column declares (and that we actually selected).
           */
          exportKeys: getExportKeysFromColumn<TBaseModel>({
            column: column,
            columnKey: columnKey ? String(columnKey) : null,
            hasPermissionToReadField: (field: string): boolean => {
              return hasPermissionToReadField(field as keyof TBaseModel);
            },
          }),
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
      if (hasPermissionToReadField(moreField as keyof TBaseModel)) {
        (selectFields as Dictionary<boolean>)[moreField] = true;
      } else {
        Logger.warn(
          "User does not have read permissions to read - " + moreField,
        );
      }
    }

    /*
     * The column has to exist for a locked Edit / Delete button to have
     * somewhere to live, so it follows what the table author asked for rather
     * than what this particular viewer is allowed to do. View is the exception
     * - a disabled "View X" on a row would confirm a record the viewer is not
     * allowed to know about - so it still disappears without read permission.
     */
    const showActionsColumn: boolean = Boolean(
      (props.isDeleteable && getActionGate(ModelAction.Delete).show) ||
        (props.isEditable && getActionGate(ModelAction.Update).show) ||
        isViewActionShown ||
        (props.actionButtons && props.actionButtons.length > 0) ||
        props.showViewIdButton,
    );

    if (showActionsColumn) {
      columns.push({
        title: tx("Actions"),
        type: FieldType.Actions,
      });
    }

    setActionSchema();
    setHeaderButtons();

    setColumns(columns);
    setHasBuiltColumns(true);
  };

  const getFilterDropdownItems: PromiseVoidFunction =
    async (): Promise<void> => {
      setTableFilterError("");
      setIsFilterFetchLoading(true);

      const filters: Array<Filter<TBaseModel>> = [...props.filters];
      // The filters that search the server, by their key.
      const entitySearchByKey: Map<string, EntityFilterSearch> = new Map<
        string,
        EntityFilterSearch
      >();

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

          const filterTableName: string | null = getFilterTableName(
            filter.filterEntityType,
          );

          if (filter.fetchFilterDropdownOptions) {
            // fetch filter dropdown options: records too, named as written.
            filter.filterDropdownOptions = (
              await filter.fetchFilterDropdownOptions()
            )?.map((option: DropdownOption): DropdownOption => {
              return toRecordFilterOption(option, filterTableName);
            });
            continue;
          }

          /*
           * A filter whose choices are records of the project's database
           * searches the server as it is typed in (#10646): its picker is
           * EntityDropdown, 50 by name, within the filter's own query, and
           * what it holds is named by its ids (heldFilterOptions below). It
           * read the first 10,000 records unsorted - the newest kept - so an
           * older one could not be picked, a filter restored from a link
           * that named one showed blank, and the Admin Dashboard's Project
           * filter listed every project on the instance.
           */
          if (filter.filterEntityType.prototype instanceof BaseModel) {
            filter.filterDropdownOptions = undefined;
            entitySearchByKey.set(key.toString(), {
              modelType: filter.filterEntityType as DatabaseBaseModelType,
              labelField: filter.filterDropdownField.label,
              valueField: filter.filterDropdownField.value,
              query: (filter.filterQuery || {}) as Record<string, unknown>,
              modelAPI: tableModelAPI,
              notFoundLabel: ENTITY_DROPDOWN_NOT_FOUND_LABEL,
            });
            continue;
          }

          const query: Query<TBaseModel> = filter.filterQuery || {};

          const listResult: ListResult<TBaseModel> =
            await props.callbacks.getList({
              modelType: filter.filterEntityType,
              query: query,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: getEntityFilterSelect(filter) as Select<TBaseModel>,
              sort: {},
            });

          filter.filterDropdownOptions = listResult.data.map(
            (item: TBaseModel): DropdownOption => {
              return toEntityFilterOption(item, filter);
            },
          );
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
              entitySearch: entitySearchByKey.get(key.toString()),
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

  type FetchAllBulkItemsFunction = () => Promise<boolean>;

  /*
   * Selects every row matching the table's current query, filters and search -
   * not just the rows on screen - and returns whether it succeeded.
   *
   * It fetches the SAME columns as fetchItems. It used to ask for
   * `select: { _id: true }`, which picked the right rows but stripped every
   * field off them, so "Export CSV" over a select-all wrote one blank line per
   * row and any bulk action that reads a field (or renders an item's name) saw
   * undefined. Routing the projection through getSelect() also keeps
   * `selectMoreFields` and per-field read permissions in play, which a
   * hand-rolled column list would silently drop.
   */
  const fetchAllBulkItems: FetchAllBulkItemsFunction =
    async (): Promise<boolean> => {
      const token: number = ++bulkSelectAllToken.current;

      setBulkSelectionError("");
      setIsBulkSelectionTruncated(false);
      setIsBulkSelectAllLoading(true);

      try {
        /*
         * An unsorted table is served in the API's default order, so the
         * selection has to ask for that order explicitly - once any sort is
         * sent, the server stops applying its default. Without this the rows
         * came back in random UUID order, which both scrambled the exported
         * CSV and, on a table past the selection ceiling, kept an arbitrary
         * slice of history instead of the newest rows the user was looking at.
         */
        const defaultSortColumn: string =
          (model as AnalyticsBaseModel).defaultSortColumn || "createdAt";

        /*
         * A relation column's order is its related field's, as on screen;
         * a sort the list cannot be read in is the list's own order there
         * too (getColumnSortForRead).
         */
        const columnSort: Sort<TBaseModel> = getColumnSortForRead<TBaseModel>({
          model: model,
          sortBy: sortBy as string | null,
          sortOrder: sortOrder,
          relationSorts: relationColumnSorts,
        });

        const bulkSort: Sort<TBaseModel> = (
          Object.keys(columnSort).length > 0
            ? columnSort
            : { [defaultSortColumn]: SortOrder.Descending }
        ) as Sort<TBaseModel>;

        /*
         * skip/limit paging is only stable over a total order. The field that
         * identifies a selected row (`_id` unless a table overrides it) is
         * appended as a tiebreaker so rows sharing a sort value - 1,200 labels
         * imported in one transaction all share a createdAt - cannot land on
         * two pages while another row is never returned at all.
         */
        if (
          (bulkSort as Dictionary<unknown>)[
            matchBulkSelectedItemByField as string
          ] === undefined
        ) {
          (bulkSort as Dictionary<SortOrder>)[
            matchBulkSelectedItemByField as string
          ] = SortOrder.Ascending;
        }

        /*
         * getSelect() throws on a misconfigured column, so it is built inside
         * the try: otherwise the button would be left spinning forever with an
         * unhandled rejection instead of a message.
         */
        const bulkSelect: Select<TBaseModel> =
          withRelationColumnSortSelect<TBaseModel>({
            select: {
              ...getSelect(),
              ...getRelationSelect(),
            },
            sortBy: sortBy as string | null,
            relationSorts: relationColumnSorts,
          });

        /*
         * Every ordered column has to be selected for the database to order by
         * it. `_id` always is; the default sort column usually is not, and a
         * table matching its selection on some field other than `_id` would
         * otherwise tick no row checkboxes at all.
         */
        for (const sortColumn of Object.keys(bulkSort)) {
          if (
            (bulkSelect as Dictionary<unknown>)[sortColumn] === undefined &&
            model.hasColumn(sortColumn)
          ) {
            (bulkSelect as Dictionary<boolean>)[sortColumn] = true;
          }
        }

        /*
         * Read a page at a time, up to the selection ceiling, each row once
         * (BulkSelectAll's readEveryMatch: the same read a telemetry list's
         * "Select all 4,213 exceptions" makes).
         */
        const everyMatch: EveryMatch<TBaseModel> | null =
          await readEveryMatch<TBaseModel>({
            readPage: async (page: {
              skip: number;
              limit: number;
            }): Promise<MatchingPage<TBaseModel>> => {
              const listResult: ListResult<TBaseModel> =
                await props.callbacks.getList({
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
                  limit: page.limit,
                  skip: page.skip,
                  select: bulkSelect,
                  sort: bulkSort,
                  requestOptions: props.fetchRequestOptions,
                });

              return {
                data: listResult.data,
                count: listResult.count,
                hasMore: listResult.hasMore,
              };
            },
            getItemId: (item: TBaseModel): string => {
              return item[matchBulkSelectedItemByField]?.toString() || "";
            },
            pageSize: BULK_SELECT_ALL_PAGE_SIZE,
            limit: LIMIT_PER_PROJECT,
            // A newer select-all, or a cleared selection, supersedes this run.
            isSuperseded: (): boolean => {
              return token !== bulkSelectAllToken.current;
            },
          });

        if (!everyMatch) {
          return false;
        }

        setBulkSelectionTotalCount(everyMatch.totalCount);
        setIsBulkSelectionTruncated(everyMatch.isTruncated);
        setBulkSelectedItems(everyMatch.items);

        return true;
      } catch (err) {
        if (token === bulkSelectAllToken.current) {
          /*
           * Leave the existing selection alone. A half-loaded selection that
           * claims to be everything is worse than a failed one, and the user
           * can retry because the Select All button stays on screen.
           */
          setBulkSelectionError(API.getFriendlyMessage(err));
        }

        return false;
      } finally {
        if (token === bulkSelectAllToken.current) {
          setIsBulkSelectAllLoading(false);
        }
      }
    };

  type ClearBulkSelectionStateFunction = () => void;

  const clearBulkSelectionState: ClearBulkSelectionStateFunction = (): void => {
    // Supersede any select-all still in flight so it cannot repopulate this.
    bulkSelectAllToken.current++;
    setIsBulkSelectAllLoading(false);
    setBulkSelectionError("");
    setIsBulkSelectionTruncated(false);
    setBulkSelectionTotalCount(0);
    setBulkSelectedItems((existingItems: Array<TBaseModel>) => {
      /*
       * Keep the same array when there is nothing to clear, so calling this on
       * every query change (below) costs an idle table no re-render.
       */
      return existingItems.length === 0 ? existingItems : [];
    });
  };

  /*
   * Everything that decides *which rows match* - the caller's query, the
   * column filters, the search term and the label chips. Serialised because
   * callers routinely pass `query` as a fresh object literal on every render,
   * and the label chips get their display names hydrated after mount without
   * the set of ids ever changing.
   *
   * Sort and page are deliberately left out: they re-order or re-window the
   * same matching set, so a selection made under them is still a selection of
   * rows that match. Selecting rows across pages is a real workflow, and a
   * truncated select-all keeps saying "selected N of M matching" after a
   * re-sort, which stays true.
   */
  const effectiveQueryKey: string = JSON.stringify({
    props: props.query || {},
    filter: query,
    search: debouncedSearchText.trim(),
    labels: selectedLabelIdsKey,
  });

  /*
   * A selection refers to the rows the *previous* query returned. Once the
   * query changes, the table underneath the bulk bar is a different result
   * set, so carrying the selection over leaves the bar claiming "6,000 Alerts
   * Selected" above a filtered-down list of 12 - with the Select All button
   * hidden, as though the selection matched what is on screen, and Delete
   * still wired to all 6,000 rows the user can no longer see.
   *
   * Dropping it here also bumps `bulkSelectAllToken`, so a filter change that
   * lands while a paged select-all is still running supersedes that run
   * instead of letting it finish and repopulate the selection against the old
   * query.
   */
  useEffect(() => {
    clearBulkSelectionState();
  }, [effectiveQueryKey]);

  type BuildEffectiveQueryFunction = () => Query<TBaseModel>;

  // The one merge the list request and `onQueryChange` both read.
  const buildEffectiveQuery: BuildEffectiveQueryFunction =
    (): Query<TBaseModel> => {
      return {
        ...props.query,
        ...query,
        ...buildSearchQueryFragment(),
      };
    };

  /*
   * Keyed on effectiveQueryKey rather than on the query object, which is a
   * fresh literal every render: a caller that stores what it is handed here
   * re-renders, and must not be handed the same query again for it.
   */
  useEffect(() => {
    props.onQueryChange?.(buildEffectiveQuery());
  }, [effectiveQueryKey]);

  type FetchItemsFunction = (options?: {
    /*
     * Refresh the rows without the loading state - after a drop, whose rows
     * are already on screen in their new order. Dimming them and blocking
     * clicks would make a finished move look like it was still going on.
     */
    quiet?: boolean | undefined;
    /*
     * When the page asked for has no rows left but earlier pages do - a bulk
     * Delete that took every row of the last page - go to the last page that
     * has rows, instead of an empty page under a "Showing 21-20 of 20".
     */
    stayInRange?: boolean | undefined;
    /*
     * A read nobody asked for: the list keeping itself current
     * (useLiveRows). Quiet, and a read that fails keeps the rows on
     * screen rather than putting an error where they were - the next change
     * reads again.
     */
    isBackground?: boolean | undefined;
    // A live read's: the records announced as created since the last one.
    createdIds?: Array<string> | undefined;
  }) => Promise<void>;

  const getFetchSort: () => Sort<TBaseModel> = (): Sort<TBaseModel> => {
    if (isManuallyOrdered) {
      /*
       * Always in the list's own order, ties broken the way the server
       * breaks them (Common/Utils/ListOrder), so the row a drop lands on is
       * the row the server moves it next to.
       */
      return {
        [props.dragDropIndexField as string]: getManualSortOrder(),
        createdAt: SortOrder.Ascending,
      } as Sort<TBaseModel>;
    }

    /*
     * A column that shows a related record is read by the related record's
     * field ({ incidentSeverity: { order: "ASC" } }), any other by itself.
     */
    return getColumnSortForRead<TBaseModel>({
      model: model,
      sortBy: sortBy as string | null,
      sortOrder: sortOrder,
      relationSorts: relationColumnSorts,
    });
  };

  /*
   * The read's select: every column's fields, and the related field the
   * list is ordered by when it is sorted by a relation column
   * (withRelationColumnSortSelect).
   */
  const getFetchSelect: () => Select<TBaseModel> = (): Select<TBaseModel> => {
    return withRelationColumnSortSelect<TBaseModel>({
      select: {
        ...getSelect(),
        ...getRelationSelect(),
      },
      sortBy: isManuallyOrdered ? null : (sortBy as string | null),
      relationSorts: relationColumnSorts,
    });
  };

  const fetchItems: FetchItemsFunction = async (options?: {
    quiet?: boolean | undefined;
    stayInRange?: boolean | undefined;
    isBackground?: boolean | undefined;
    createdIds?: Array<string> | undefined;
  }): Promise<void> => {
    const isBackground: boolean = Boolean(options?.isBackground);
    const isQuiet: boolean = Boolean(options?.quiet) || isBackground;

    fetchGenerationRef.current += 1;
    const generation: number = fetchGenerationRef.current;

    if (!isBackground) {
      setError("");
    }

    if (!isQuiet) {
      setIsLoading(true);
    }

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
        query: buildEffectiveQuery(),
        groupBy: {
          ...props.groupBy,
        },
        limit: itemsOnPage,
        skip: (currentPageNumber - 1) * itemsOnPage,
        select: getFetchSelect(),
        sort: getFetchSort(),
        requestOptions: props.fetchRequestOptions,
        // Counted no further than "10,000+" (ListCount.ts).
        countUpTo: getListCountUpTo({
          isManuallyOrdered: isManuallyOrdered,
          isLiveRead: isBackground,
          previous: listCountRef.current,
        }),
      });

      if (
        options?.stayInRange &&
        listResult.data.length === 0 &&
        listResult.count > 0 &&
        currentPageNumber > 1
      ) {
        /*
         * The page number's own effect fetches the last page with rows; the
         * empty one is never drawn.
         */
        setCurrentPageNumber(
          Math.max(
            1,
            Math.min(
              currentPageNumber - 1,
              Math.ceil(listResult.count / itemsOnPage),
            ),
          ),
        );

        if (!isQuiet) {
          setIsLoading(false);
        }

        return;
      }

      if (isBackground) {
        /*
         * The reader moved on while this read was out - another page, a
         * search, a filter: the read they asked for owns the rows.
         */
        if (generation !== fetchGenerationRef.current) {
          return;
        }

        // A list that could not be read before reads now: the error goes.
        setError("");
      }

      const listCount: ListCountState = getNextListCount({
        previous: listCountRef.current,
        result: listResult,
        isLiveRead: isBackground,
      });

      listCountRef.current = listCount;
      setTotalItemsCount(listCount.total);
      setIsCountCapped(listCount.isCapped);
      setHasMore(
        getListHasMore({ count: listCount, hasMore: listResult.hasMore }),
      );
      setData(listResult.data);

      /*
       * A live read tints the rows it brought in; a read the reader asked
       * for (another page, a search) draws the rows they asked for, none
       * of them new to them.
       */
      const readRowIds: Array<string> = listResult.data.map(
        (item: TBaseModel): string => {
          return getRecordIdText(item["_id"]);
        },
      );

      markArrivedRows(
        isBackground
          ? getArrivedRowIds(
              shownRowIdsRef.current,
              readRowIds,
              options?.createdIds || [],
            )
          : [],
      );
      shownRowIdsRef.current = readRowIds;

      setIsEmptyWithNothingApplied(
        isListEmptyWithNothingApplied({
          rowCount: listResult.data.length,
          totalCount: listResult.count || 0,
          hasMore: listResult.hasMore,
          pageNumber: currentPageNumber,
          isSearchActive: isSearchActive(),
          isFilterActive: hasFilterApplied(filterData),
          isPageFiltered: Boolean(props.emptyState?.isFiltered),
        }),
      );
      /*
       * Fire onFetchSuccess so consumers (e.g. the resource-owners hook)
       * can react to the loaded page. Previously the prop was declared
       * but never invoked, which broke per-row owner enrichment.
       */
      if (props.onFetchSuccess) {
        /*
         * The count the list shows: a live read of a capped list counts
         * only to its page's end, and keeps the cap it showed (ListCount).
         */
        props.onFetchSuccess(listResult.data, listCount.total);
      }
    } catch (err) {
      if (isBackground) {
        /*
         * The rows on screen stay: they were right a moment ago, and the
         * next change reads again.
         */
        Logger.error(API.getFriendlyMessage(err));
      } else {
        setError(API.getFriendlyMessage(err));
      }
    }

    if (!isQuiet) {
      setIsLoading(false);
    }
  };

  /*
   * Refresh, pressed: the rows are read again, and so is every count beside
   * the list - a count that disagreed with the list just refreshed under it
   * would say one of them is wrong.
   */
  const refreshFromRefreshButton: () => Promise<void> =
    async (): Promise<void> => {
      refreshSideMenuCounts();
      await fetchItems();
    };

  useEffect(() => {
    if (showFilterModal) {
      getFilterDropdownItems().catch((err: Error) => {
        setTableFilterError(API.getFriendlyMessage(err));
      });
    }
  }, [showFilterModal, props.filters]);

  /*
   * A table restored from the URL is already filtered, so its chips have to
   * render immediately — and entity/dropdown chips can only resolve their
   * labels from `filterDropdownOptions`, which are otherwise fetched lazily
   * when the filter popup opens. Without this, a shared link (or a Back
   * navigation) showed a filtered list with no visible indication of *why*,
   * and no "Clear Filters" button to escape it.
   */
  useEffect(() => {
    if (!initialUrlState.filter) {
      return;
    }

    /*
     * Callers use this to render their own "filters active" affordance. It is
     * otherwise only fired by the filter form, so a restored view would show a
     * clean banner over a filtered table.
     */
    props.onFilterApplied?.(true);

    getFilterDropdownItems().catch((err: Error) => {
      setTableFilterError(API.getFriendlyMessage(err));
    });
  }, []);

  type GetSelectFunction = () => Select<TBaseModel>;

  const getSelect: GetSelectFunction = (): Select<TBaseModel> => {
    /*
     * Every declared column, including the ones the viewer has switched off.
     *
     * Hiding must not narrow the request. A column's `getElement` is arbitrary
     * caller code that can read any field on the row — a "Status" cell that
     * also reads `currentMonitorStatus`, say — so dropping a hidden column's
     * fields from the select would silently blank a *different*, visible cell,
     * and there is no way to detect that statically. The sort field is
     * likewise independent of what is on screen. The cost is a few unused
     * fields on the wire.
     */
    const selectFields: Select<TBaseModel> = getSelectFromColumns<TBaseModel>({
      columns: allColumns,
      model: model,
      hasPermissionToReadField: (field: string): boolean => {
        return hasPermissionToReadField(field as keyof TBaseModel);
      },
    });

    /*
     * Custom field columns arrive asynchronously, but the table does not
     * refetch when its column set changes — so the JSON column that backs
     * every one of them is selected up front, off the synchronous prop, and
     * the values are there the moment the definitions land.
     */
    if (
      props.customFieldsModelType &&
      model.hasColumn(CustomFieldsColumnKey) &&
      hasPermissionToReadField(CustomFieldsColumnKey as keyof TBaseModel)
    ) {
      (selectFields as Dictionary<boolean>)[CustomFieldsColumnKey] = true;
    }

    /*
     * Same reasoning for the attribute map column: a column added from the
     * picker appears without a refetch, so the map it reads has to have been
     * on the wire since the first request or the new column renders blank
     * until something else happens to reload the page.
     */
    if (
      attributeColumnKey &&
      (hasPermissionToReadField(attributeColumnKey as keyof TBaseModel) ||
        User.isMasterAdmin())
    ) {
      (selectFields as Dictionary<boolean>)[attributeColumnKey] = true;
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
      /*
       * Only what the viewer may read, by the rule every select follows
       * (hasPermissionToReadField): the server refuses the whole list for
       * one column the caller may not read, so a field asked for here that
       * this viewer cannot read - a secret only owners and admins read
       * back - is left out rather than blanking the table.
       * serializeToTableColumns makes the same check for the cells. Until
       * the permission snapshot has landed, nothing tells a field the viewer
       * may not read from one they may (the check fails closed then), so
       * every field is asked for, as it always was, and the server decides.
       */
      if (
        model.hasColumn(moreField as string) &&
        PermissionGate.hasPermissionSnapshot({ held: heldPermissions }) &&
        !hasPermissionToReadField(moreField)
      ) {
        continue;
      }

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
          currentColumns={
            columnPreferenceToJSON(effectiveColumnPreference) || undefined
          }
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
              // a saved view pins its own page size, so it belongs on the URL
              isItemsOnPageExplicitRef.current = true;
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

              /*
               * A saved view carries the columns it was saved with. Views
               * created before this existed have none, which restores the
               * table's default layout rather than leaving the previous
               * view's columns in place.
               */
              if (isColumnCustomizationEnabled) {
                saveColumnPreference(
                  columnPreferenceFromJSON(
                    (tableView.columns as JSONObject | undefined) || null,
                  ),
                );
              }
            } else {
              setQuery({});
              /*
               * Also clear the filter chips. Leaving `filterData` behind kept
               * the chips on screen and the `-filter` param in the URL, so the
               * next visit re-applied the very filters the user just cleared.
               */
              setFilterData({});
              props.onFilterApplied?.(false);
              setSortBy(null);
              setSortOrder(SortOrder.Descending);
              setItemsOnPage(10);
              setCurrentPageNumber(1);

              if (props.onFacetStateRestored) {
                props.onFacetStateRestored(null);
              }

              /*
               * Columns are deliberately left alone here. Clearing a saved
               * view means "stop filtering like that", not "throw away the
               * column layout I built" - which the viewer may well have set
               * up long before this view existed.
               */
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
        className: "max-md:hidden md:flex",
        onClick: () => {
          openDocumentationLink(props.documentationLink!);
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
        className: "max-md:hidden md:flex",
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

    const createGate: ActionGate = getCreateGate();

    const showFilterButton: boolean = props.filters.length > 0;

    /*
     * Without create permission the button is shown locked rather than
     * removed, so the user can see the action exists and read why it is not
     * available to them.
     */
    if (props.isCreateable && createGate.show) {
      headerbuttons.push({
        title: getCreateButtonTitle(),
        phoneTitle: getCreateButtonPhoneTitle(),
        buttonStyle: ButtonStyleType.NORMAL,
        buttonSize: ButtonSize.Normal,
        className: "",
        disabled: createGate.disabled,
        tooltip: createGate.tooltip,
        onClick: () => {
          if (createGate.disabled) {
            return;
          }

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
        onClick: refreshFromRefreshButton,
        disabled: isFilterFetchLoading,
      });
    }

    if (showFilterButton) {
      headerbuttons.push(
        ofListRead({
          title: "",
          buttonStyle: ButtonStyleType.ICON,
          buttonSize: ButtonSize.Small,
          className: "",
          onClick: () => {
            /*
             * Just open the popup. This used to `setQuery({})` first, which
             * dropped the active filters (and refetched everything) the moment
             * the user opened the filter UI — while the chips and the URL still
             * advertised them. Filters now change only when the form applies
             * them.
             */
            setShowFilterModal(true);
          },
          disabled: isFilterFetchLoading,
          icon: IconProp.Filter,
        }),
      );
    }

    /*
     * Only worth offering once there is a choice to make. A single-column
     * table has nothing to hide and nothing to reorder.
     */
    if (isColumnCustomizationEnabled && allColumns.length > 1) {
      headerbuttons.push(
        ofListRead({
          title: "",
          buttonStyle: ButtonStyleType.ICON,
          buttonSize: ButtonSize.Small,
          className: "",
          onClick: () => {
            setShowColumnCustomizationModal(true);
          },
          icon: IconProp.TableCells,
        }),
      );
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
    selectedLabelIdsKey,
    props.refreshToggle,
    rowActionRefreshCount,
  ]);

  /*
   * The rows keep themselves current: a new incident, an alert a teammate
   * acknowledged, an episode that was resolved show up without Refresh,
   * while the reader is not in the middle of something (LiveRows.ts).
   */
  useLiveRows({
    modelType:
      model instanceof BaseModel
        ? (props.modelType as { new (): BaseModel })
        : null,
    tenantId: ProjectUtil.getCurrentProjectId(),
    // A list across projects hears each of them.
    tenantIds: props.liveProjectIds,
    isEnabled: props.isLive !== false,
    isHeld: (): boolean => {
      return isLiveRowsHeld({
        isLoading: isLoading,
        hasSelection: bulkSelectedItems.length > 0,
        isReordering: isReordering,
        isDialogOrMenuOpen: isDialogOrMenuOpen(),
        hasTextSelection: hasTextSelection(),
      });
    },
    refresh: (heard: LiveRowsHeard): Promise<void> => {
      return fetchItems({
        isBackground: true,
        createdIds: heard.createdIds,
      });
    },
    // The rows (Table's body), which a pointer on its way to one holds still.
    getRowsElement: (): Element | null => {
      return typeof document === "undefined"
        ? null
        : document.getElementById(`${props.id}-body`);
    },
  });

  type ShouldDisableSortFunction = (
    column: ModelTableColumn<TBaseModel>,
    columnName: keyof TBaseModel | null,
  ) => boolean;

  const shouldDisableSort: ShouldDisableSortFunction = (
    column: ModelTableColumn<TBaseModel>,
    columnName: keyof TBaseModel | null,
  ): boolean => {
    if (!columnName) {
      return true;
    }

    // A drag-ordered list is always shown in its own order.
    if (isManuallyOrdered) {
      return true;
    }

    if (!model.isEntityColumn(columnName as string)) {
      return false;
    }

    /*
     * A relation sorts where the list can be ordered by it: one related
     * record, by its place in its project's list or by the name the column
     * shows. Labels, monitors and other lists of records do not
     * (ColumnSort's getRelationColumnSort).
     */
    const sortKey: string | null =
      getModelTableColumnSortKey<TBaseModel>(column);

    return !sortKey || !relationColumnSorts.has(sortKey);
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

  /*
   * What the user holds, read once per draw: every field below is weighed
   * against it.
   */
  const heldPermissions: HeldPermissions = PermissionGate.getHeldPermissions();

  /*
   * Whether a field may be selected, by the one rule for that
   * (PermissionGate.canReadColumn): the columns every select may name, and
   * any other by the rule the server's column check follows - one of its
   * read permissions held, Public by everyone, no team block on any of
   * them. A master admin reads every field: secondary fields use this check
   * when building the request, so they need the same master-admin access as
   * the visible columns that render them.
   */
  const hasPermissionToReadField: HasPermissionToReadFieldFunction = (
    field: keyof TBaseModel,
  ): boolean => {
    if (!field) {
      return true;
    }

    return PermissionGate.canReadColumn(model, field as string, {
      held: heldPermissions,
    });
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

  /*
   * The viewer changed their layout, the project's custom field definitions
   * finally arrived, or an attribute column was added or removed.
   */
  useEffect(() => {
    serializeToTableColumns();
  }, [effectiveColumnPreference, customFieldColumns.columns, attributeColumns]);

  /*
   * The attribute key pool is only ever needed by the picker, so it is fetched
   * when the picker first opens and kept for the rest of the page's life.
   * A failure costs the "add a column" search box and nothing else — the
   * columns the viewer already added are rebuilt from their stored layout and
   * do not depend on this at all.
   */
  useEffect(() => {
    if (
      !showColumnCustomizationModal ||
      !attributeColumnKey ||
      !props.attributeColumnsProps ||
      attributeKeyPool.hasLoaded ||
      attributeKeyPool.isLoading
    ) {
      return;
    }

    const fetchAttributeKeys: () => Promise<Array<string>> =
      props.attributeColumnsProps.fetchAttributeKeys;

    let isCancelled: boolean = false;

    setAttributeKeyPool({
      keys: [],
      isLoading: true,
      error: "",
      hasLoaded: false,
    });

    fetchAttributeKeys()
      .then((keys: Array<string>) => {
        if (isCancelled) {
          return;
        }

        setAttributeKeyPool({
          keys: normalizeAttributeKeys(keys),
          isLoading: false,
          error: "",
          hasLoaded: true,
        });
      })
      .catch((err: Error) => {
        if (isCancelled) {
          return;
        }

        setAttributeKeyPool({
          keys: [],
          isLoading: false,
          error: API.getFriendlyMessage(err),
          /*
           * Not "loaded": closing and reopening the picker is the only retry
           * anyone would think to try, so let it be one.
           */
          hasLoaded: false,
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [showColumnCustomizationModal, attributeColumnKey]);

  /*
   * Whether a row can be opened: the table offers View and the reader may
   * read the record. The same test decides whether View is a row action.
   */
  const isViewActionShown: boolean = Boolean(
    props.isViewable && PermissionGate.check(model, ModelAction.Read).isAllowed,
  );

  type GetViewTargetFunction = (item: TBaseModel) => Promise<{
    route: Route | URL;
    baseModel: TBaseModel;
  }>;

  /*
   * Where a row's record is: the page's own route for it (onViewPage), or
   * the view route with the record's id. One place for View and for a click
   * on the row, so the two always open the same page.
   */
  const getViewTarget: GetViewTargetFunction = async (
    item: TBaseModel,
  ): Promise<{ route: Route | URL; baseModel: TBaseModel }> => {
    let baseModel: TBaseModel = item;
    if (!(item instanceof BaseModel) && !(item instanceof AnalyticsBaseModel)) {
      baseModel = props.callbacks.getModelFromJSON(item as JSONObject);
    }

    if (props.onBeforeView) {
      await props.onBeforeView(baseModel);
    }

    if (props.onViewPage) {
      return { route: await props.onViewPage(baseModel), baseModel };
    }

    if (!props.viewPageRoute) {
      throw new BadDataException("props.viewPageRoute not found");
    }

    const id: string = baseModel.id?.toString() || "";

    return {
      route: new Route(props.viewPageRoute.toString()).addRoute("/" + id),
      baseModel,
    };
  };

  /*
   * A row of a table whose rows open their records opens on a click
   * anywhere on it - not on a link, a button or a box inside it
   * (Table/RowClick) - as a list in Linear, GitHub or Stripe does. Its View
   * button stays: it says what the row does, and is the way in from the
   * keyboard. Cmd, Ctrl or Shift held, or the middle button, opens the
   * record in a new tab.
   */
  const isRowClickable: boolean =
    isViewActionShown && Boolean(props.onViewPage || props.viewPageRoute);

  type OnRowClickFunction = (
    item: TBaseModel,
    event: React.MouseEvent<HTMLElement>,
  ) => void;

  const onRowClick: OnRowClickFunction = (
    item: TBaseModel,
    event: React.MouseEvent<HTMLElement>,
  ): void => {
    const clickEvent: RowClickEventLike = event;

    if (!isRowOpeningClick(clickEvent)) {
      return;
    }

    const openInNewTab: boolean = isNewTabClick(clickEvent);

    getViewTarget(item)
      .then(
        ({
          route,
          baseModel,
        }: {
          route: Route | URL;
          baseModel: TBaseModel;
        }): void => {
          if (!openInNewTab) {
            props.onViewComplete?.(baseModel);
          }

          Navigation.navigate(route, { openInNewTab: openInNewTab });
        },
      )
      .catch((err: Error) => {
        setErrorModalText(API.getFriendlyMessage(err));
      });
  };

  type GetRowPropsFunction = (
    item: TBaseModel,
  ) => React.HTMLAttributes<HTMLElement>;

  const getClickableRowProps: GetRowPropsFunction | undefined = isRowClickable
    ? (item: TBaseModel): React.HTMLAttributes<HTMLElement> => {
        const rowProps: React.HTMLAttributes<HTMLElement> & {
          "data-row-opens-record": string;
        } = {
          "data-row-opens-record": "true",
          onClick: (event: React.MouseEvent<HTMLElement>): void => {
            onRowClick(item, event);
          },
          onAuxClick: (event: React.MouseEvent<HTMLElement>): void => {
            onRowClick(item, event);
          },
        };

        return rowProps;
      }
    : undefined;

  /*
   * A row's own attributes: what opens it on a click, and the mark of a row
   * a live read just brought in.
   */
  const getRowProps: GetRowPropsFunction | undefined =
    arrivedRowIds.size > 0
      ? (item: TBaseModel): React.HTMLAttributes<HTMLElement> => {
          const rowProps: React.HTMLAttributes<HTMLElement> =
            getClickableRowProps?.(item) || {};

          if (!arrivedRowIds.has(getRecordIdText(item["_id"]))) {
            return rowProps;
          }

          return {
            ...rowProps,
            [ROW_ARRIVED_ATTRIBUTE]: "true",
          } as React.HTMLAttributes<HTMLElement>;
        }
      : getClickableRowProps;

  const setActionSchema: VoidFunction = () => {
    const actionsSchema: Array<ActionButtonSchema<TBaseModel>> = [];

    if (props.showViewIdButton) {
      actionsSchema.push({
        title: tx("Show ID"),
        /*
         * An ID card: the icon "Show ID" wears in every menu, the status
         * page's resource lists too. Not the info circle it once had there -
         * beside "View Status Message" and "View Error", whose circle holds
         * a "!", the two could not be told apart.
         */
        icon: IconProp.Identification,
        buttonStyleType: ButtonStyleType.OUTLINE,
        hideOnMobile: true,
        // A utility every row carries - it belongs in the ⋯ menu, not on the row.
        placement: ActionButtonPlacement.MoreMenu,
        // Never offered on a row with no ID to show.
        isVisible: (item: TBaseModel): boolean => {
          return hasRecordId(item["_id"]);
        },
        onClick: async (
          item: TBaseModel,
          onCompleteAction: VoidFunction,
          onError: ErrorFunction,
        ) => {
          try {
            setViewId(getRecordIdText(item["_id"]));
            onCompleteAction();
          } catch (err) {
            onError(err as Error);
          }
        },
      });
    }

    if (isViewActionShown) {
      actionsSchema.push({
        title: props.viewButtonText
          ? tx(props.viewButtonText)
          : translateNamedAction(translator, {
              template: "View {{itemName}}",
              itemName: props.singularName || model.singularName || "",
            }),
        /*
         * Drawn when View is in the ⋯ menu - on a table that marks one of
         * its own actions Primary. On the row it is a label (RowActions).
         */
        icon: IconProp.Eye,
        buttonStyleType: ButtonStyleType.NORMAL,
        /*
         * Opening the record is what a row is for, so View is the row's one
         * button and Edit, Delete and the rest go in the ⋯ menu beside it.
         * Custom actions are listed ahead of View, so a table that wants one
         * of its own on the row can still mark it Primary.
         */
        placement: ActionButtonPlacement.Primary,
        /*
         * On the row, View alone: the row names the record, and the list
         * its kind (ActionButtonSchema's rowButtonTitle). A page's own
         * words for it are kept as they are.
         */
        rowButtonTitle: props.viewButtonText ? undefined : tx("View"),
        onClick: async (
          item: TBaseModel,
          onCompleteAction: VoidFunction,
          onError: ErrorFunction,
        ) => {
          try {
            const {
              route,
              baseModel,
            }: { route: Route | URL; baseModel: TBaseModel } =
              await getViewTarget(item);

            onCompleteAction();

            if (props.onViewComplete) {
              props.onViewComplete(baseModel);
            }

            return Navigation.navigate(route);
          } catch (err) {
            onError(err as Error);
          }
        },
      });
    }

    const updateGate: ActionGate = getActionGate(ModelAction.Update);

    if (props.isEditable && updateGate.show) {
      actionsSchema.push({
        title: tx(props.editButtonText || "Edit"),
        icon: IconProp.Edit,
        buttonStyleType: ButtonStyleType.OUTLINE,
        disabled: updateGate.disabled,
        tooltip: updateGate.tooltip,
        getDisabledReason: props.getEditDisabledReason,
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

    const deleteGate: ActionGate = getActionGate(ModelAction.Delete);

    /* The row action wears the same icon as the bulk one it stands for. */
    const rowDeleteIcon: IconProp =
      (props.bulkActions?.deleteVerb?.trim() &&
        props.bulkActions?.deleteIcon) ||
      IconProp.Trash;

    if (props.isDeleteable && deleteGate.show) {
      actionsSchema.push({
        title: tx(props.deleteButtonText || "Delete"),
        icon: rowDeleteIcon,
        buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
        disabled: deleteGate.disabled,
        tooltip: deleteGate.tooltip,
        getDisabledReason: props.getDeleteDisabledReason,
        onClick: async (
          item: TBaseModel,
          onCompleteAction: VoidFunction,
          onError: ErrorFunction,
        ) => {
          deleteConfirmationRequest.current += 1;
          const request: number = deleteConfirmationRequest.current;
          let loadingTimer: ReturnType<typeof setTimeout> | undefined =
            undefined;

          try {
            if (props.onBeforeDelete) {
              item = await props.onBeforeDelete(item);
            }

            let confirmation: DeleteConfirmation | null = null;

            if (props.getDeleteConfirmation) {
              const pending: Promise<DeleteConfirmation> =
                props.getDeleteConfirmation(item);
              const openingItem: TBaseModel = item;

              // Slow to answer: open now, saying it is checking.
              loadingTimer = setTimeout(() => {
                if (request !== deleteConfirmationRequest.current) {
                  return;
                }

                setDeleteConfirmation(null);
                setDeleteAlternativeError("");
                setCurrentDeleteableItem(openingItem);
                setIsDeleteConfirmationLoading(true);
                setShowDeleteConfirmModal(true);
              }, DELETE_CONFIRMATION_LOADING_DELAY_MS);

              confirmation = await pending;
              clearTimeout(loadingTimer);
            }

            // Closed while its wording was being read: it stays closed.
            if (request !== deleteConfirmationRequest.current) {
              onCompleteAction();
              return;
            }

            setDeleteConfirmation(confirmation);
            setIsDeleteConfirmationLoading(false);
            setShowDeleteConfirmModal(true);
            setCurrentDeleteableItem(item);
            onCompleteAction();
          } catch (err) {
            if (loadingTimer) {
              clearTimeout(loadingTimer);
            }

            if (request !== deleteConfirmationRequest.current) {
              onCompleteAction();
              return;
            }

            setIsDeleteConfirmationLoading(false);
            setShowDeleteConfirmModal(false);
            onError(err as Error);
          }
        },
      });
    }

    // The list's own go before these, read fresh on every render.
    setBuiltInRowActions(actionsSchema);
  };

  const [filterData, setFilterData] = useState<FilterData<TBaseModel>>(
    initialUrlState.filter || props.initialFilterData || {},
  );

  /*
   * WHAT THE LIST'S ENTITY FILTERS HOLD, NAMED BY THEIR IDS (#10646).
   *
   * A filter that searches the server (entitySearch) has no list of every
   * record to name its values from. What it holds - restored from a link
   * or a saved view, or just picked - is read by its values, within the
   * reader's reach, so its chip reads "Owner is Payments", never a raw id
   * or nothing at all. A value no record answers to any more reads "No
   * longer available": the filter still applies, as it was saved, until it
   * is taken out. By filter key, then by value (an id lower-cased).
   */
  const [heldFilterOptions, setHeldFilterOptions] = useState<
    Record<string, Record<string, DropdownOption>>
  >({});
  const heldFilterOptionsRef: MutableRefObject<
    Record<string, Record<string, DropdownOption>>
  > = React.useRef<Record<string, Record<string, DropdownOption>>>({});
  heldFilterOptionsRef.current = heldFilterOptions;

  useEffect(() => {
    type HeldRead = {
      key: string;
      filter: Filter<TBaseModel>;
      search: EntityFilterSearch;
      values: Array<string>;
    };

    const reads: Array<HeldRead> = [];

    for (const classic of classicTableFilters) {
      if (!classic.entitySearch) {
        continue;
      }

      const key: string = classic.key.toString();
      const filter: Filter<TBaseModel> | undefined = props.filters.find(
        (candidate: Filter<TBaseModel>): boolean => {
          return getFilterKey(candidate)?.toString() === key;
        },
      );

      if (!filter) {
        continue;
      }

      const known: Record<string, DropdownOption> =
        heldFilterOptionsRef.current[key] || {};
      const isIdColumn: boolean = classic.entitySearch.valueField === "_id";
      const values: Array<string> = getEntityFilterHeldValues(
        filterData[classic.key],
      ).filter((value: string): boolean => {
        return !known[isIdColumn ? value.toLowerCase() : value];
      });

      if (values.length > 0) {
        reads.push({
          key: key,
          filter: filter,
          search: classic.entitySearch,
          values: values,
        });
      }
    }

    if (reads.length === 0) {
      return;
    }

    let cancelled: boolean = false;

    (async () => {
      const named: Record<string, Record<string, DropdownOption>> = {};

      for (const read of reads) {
        const isIdColumn: boolean = read.search.valueField === "_id";

        try {
          const records: Array<BaseModel> = await RecordsById.read<BaseModel>({
            modelType: read.search.modelType,
            ids: read.values,
            column: read.search.valueField,
            select: getEntityFilterSelect(read.filter) as Select<BaseModel>,
            modelAPI: tableModelAPI,
          });
          const byValue: Map<string, BaseModel> = RecordsById.byValue({
            records: records,
            column: read.search.valueField,
          });
          const options: Record<string, DropdownOption> = {};

          for (const value of read.values) {
            const lookup: string = isIdColumn ? value.toLowerCase() : value;
            const record: BaseModel | undefined = byValue.get(lookup);

            options[lookup] = record
              ? // The value as the filter holds it, so its picker finds it.
                { ...toEntityFilterOption(record, read.filter), value: value }
              : {
                  value: value,
                  label: ENTITY_DROPDOWN_NOT_FOUND_LABEL,
                  isUserContent: false,
                  isNotFound: true,
                };
          }

          named[read.key] = options;
        } catch {
          // Unread, the values keep their ids: the filter still applies.
        }
      }

      if (cancelled || Object.keys(named).length === 0) {
        return;
      }

      setHeldFilterOptions(
        (
          current: Record<string, Record<string, DropdownOption>>,
        ): Record<string, Record<string, DropdownOption>> => {
          const next: Record<string, Record<string, DropdownOption>> = {
            ...current,
          };

          for (const [key, options] of Object.entries(named)) {
            next[key] = { ...(current[key] || {}), ...options };
          }

          return next;
        },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [filterData, classicTableFilters]);

  /*
   * The filters the list draws: a filter that searches the server offers
   * the records it holds, named (heldFilterOptions); every other filter
   * its own options, as before.
   */
  const shownClassicTableFilters: Array<ClassicFilterType<TBaseModel>> =
    useMemo(() => {
      return classicTableFilters.map(
        (
          classic: ClassicFilterType<TBaseModel>,
        ): ClassicFilterType<TBaseModel> => {
          if (!classic.entitySearch) {
            return classic;
          }

          return {
            ...classic,
            filterDropdownOptions: Object.values(
              heldFilterOptions[classic.key.toString()] || {},
            ),
          };
        },
      );
    }, [classicTableFilters, heldFilterOptions]);

  type OnFilterChangedFunction = (filterData: FilterData<TBaseModel>) => void;

  const onFilterChanged: OnFilterChangedFunction = (
    filterData: FilterData<TBaseModel>,
  ): void => {
    setFilterData(filterData);
    setCurrentPageNumber(1);

    setQuery(
      buildQueryFromFilterData<TBaseModel>({
        filterData: filterData,
        filters: props.filters,
      }),
    );
  };

  /*
   * Mirror the table's view into the URL so Back restores it and the link can
   * be handed to a teammate. Restoring happens in the `useState` initializers
   * above (synchronously, before the first fetch), so there is nothing to gate
   * here: the first write after mount already carries the restored values.
   *
   * `replaceState` is used under the hood, so dragging a filter around doesn't
   * flood the back stack.
   */
  useEffect(() => {
    TableFilterUrlState.writeMany(urlStateKey, {
      filter: filterData as unknown as JSONObject,
      view: TableViewUrlState.toJSON(
        {
          search: debouncedSearchText,
          labels: selectedLabelIds,
          sortBy: sortBy as string | undefined,
          sortOrder: sortOrder,
          page: currentPageNumber,
          itemsOnPage: isItemsOnPageExplicitRef.current
            ? itemsOnPage
            : undefined,
        },
        {
          sortBy: props.sortBy as string | undefined,
          sortOrder: props.sortOrder,
        },
      ),
    });
  }, [
    urlStateKey,
    filterData,
    debouncedSearchText,
    selectedLabelIdsKey,
    sortBy,
    sortOrder,
    currentPageNumber,
    itemsOnPage,
  ]);

  type GetDeleteBulkActionFunction = () => BulkActionButtonSchema<TBaseModel>;

  const getDeleteBulkAction: GetDeleteBulkActionFunction =
    (): BulkActionButtonSchema<TBaseModel> => {
      /*
       * A table that names its own verb ("Unlink") removes relationships, not
       * things, so its sentence drops "This action cannot be undone" - that
       * would say the opposite of the warning it usually appends.
       */
      const deleteVerb: string | undefined =
        props.bulkActions?.deleteVerb?.trim() || undefined;

      // The table's names for one and for several, translated with the sentence.
      type GetNounValuesFunction = (
        inSentence: boolean,
      ) => Record<string, ReturnType<typeof translatableTerm>>;

      const getNounValues: GetNounValuesFunction = (
        inSentence: boolean,
      ): Record<string, ReturnType<typeof translatableTerm>> => {
        return {
          itemName: translatableTerm(
            props.singularName || model.singularName || "item",
            { inSentence: inSentence },
          ),
          itemsName: translatableTerm(
            props.pluralName || model.pluralName || "items",
            { inSentence: inSentence },
          ),
        };
      };

      return {
        title: deleteVerb || "Delete",
        buttonStyleType: ButtonStyleType.DANGER,
        icon: (deleteVerb && props.bulkActions?.deleteIcon) || IconProp.Trash,
        confirmMessage: (items: Array<TBaseModel>) => {
          if (deleteVerb) {
            return translator.translatePlural(
              BULK_ACTION_QUESTION,
              items.length,
              {
                action: translatableTerm(deleteVerb, { inSentence: true }),
                ...getNounValues(true),
              },
            );
          }

          /*
           * The nouns as a sentence has them - "delete 2 status pages?" -
           * where the dialog's title keeps a title's capitals ("Delete 2
           * Status Pages"); the way the Unlink question above already reads.
           */
          return translator.translatePlural(
            BULK_DELETE_QUESTION,
            items.length,
            getNounValues(true),
          );
        },
        confirmTitle: (items: Array<TBaseModel>) => {
          if (deleteVerb) {
            return translator.translatePlural(BULK_ACTION_TITLE, items.length, {
              action: translatableTerm(deleteVerb),
              ...getNounValues(false),
            });
          }

          return translator.translatePlural(
            BULK_DELETE_TITLE,
            items.length,
            getNounValues(false),
          );
        },
        /*
         * "Are you sure you want to delete 12 monitors?" says how many, not
         * which. The rows were picked by hand, often across pages and after a
         * filter, and this is the last moment to notice one that should not be
         * there - so the first few are named under the count.
         *
         * Then, in a paragraph of its own, what goes with them (and the
         * list's own sentence): after the names it is about them, where in
         * the middle of the question it was one more sentence to read past.
         */
        confirmDetails: (
          items: Array<TBaseModel>,
          controls: BulkActionConfirmControls,
        ): ReactElement => {
          const warning: string = getDeleteWarning(
            props.bulkActions?.deleteConfirmationWarning ??
              props.deleteConfirmationWarning,
          );

          // What deleting them would change, when the list reads it.
          const details: ReactElement | undefined =
            props.bulkActions?.deleteConfirmationDetails?.(items, controls);

          return (
            <div className="space-y-3">
              <DeleteItemNames
                names={items.map((item: TBaseModel) => {
                  return getItemLabel(item);
                })}
                totalCount={items.length}
              />
              {warning ? (
                <p
                  data-testid="bulk-delete-consequence"
                  className="text-sm leading-6 text-gray-600"
                >
                  {warning}
                </p>
              ) : (
                <></>
              )}
              {details || <></>}
            </div>
          );
        },
        confirmButtonStyleType: ButtonStyleType.DANGER,
        /*
         * "2 Status Pages deleted, 1 Status Page not deleted". A table that
         * names its own verb keeps the general words.
         */
        resultLabels: deleteVerb
          ? undefined
          : {
              succeeded: BULK_DELETED_COUNT,
              failed: BULK_NOT_DELETED_COUNT,
              unchanged: BULK_SKIPPED_COUNT,
            },
        /*
         * Through the shared runner (runBulkAction): each row its own delete,
         * reported after a failure as well as after a success - deleting
         * hundreds of rows at once is exactly where partial failure is
         * expected - and stoppable part-way. One row at a time unless the
         * table says its deletes check nothing across rows
         * (deleteConcurrency).
         */
        onClick: async (actionProps: BulkActionOnClickProps<TBaseModel>) => {
          await runBulkAction<TBaseModel>({
            actionProps: actionProps,
            concurrency: props.bulkActions?.deleteConcurrency ?? 1,
            step: async (item: TBaseModel): Promise<BulkItemOutcome> => {
              /*
               * A row the table says can never be deleted is not sent to the
               * server at all: it is listed with the reason, like a row the
               * server refused.
               */
              const deleteDisabledReason: string | undefined =
                props.getDeleteDisabledReason
                  ? props.getDeleteDisabledReason(item)
                  : undefined;

              if (deleteDisabledReason) {
                throw new BadDataException(deleteDisabledReason);
              }

              /*
               * One the list knows the server would refuse, which its
               * dialog said it skips: not sent, and listed as skipped.
               */
              const deleteRefusal: string | undefined =
                props.bulkActions?.getDeleteRefusal?.(item);

              if (deleteRefusal) {
                return bulkItemUnchanged(deleteRefusal);
              }

              await props.callbacks.deleteItem(item);

              return BULK_ITEM_CHANGED;
            },
          });

          props.bulkActions?.onDeleteEnd?.();
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

  type HasFilterAppliedFunction = (
    dataToCheck: FilterData<TBaseModel>,
  ) => boolean;

  /*
   * Lifted out of the onFilterChanged callback below, which is where this test
   * used to live inline. Two definitions of "a filter is applied" in one
   * component is exactly the kind of thing that drifts apart - so it is the
   * plain Table's own test (hasFilterValues). It used to be truthiness, which
   * missed a yes/no filter set to "No" (false): the list was filtered, but
   * the table called itself unfiltered, offered "No X yet" and a Create
   * button under it, and let rows be dragged while some were hidden.
   */
  const hasFilterApplied: HasFilterAppliedFunction = (
    dataToCheck: FilterData<TBaseModel>,
  ): boolean => {
    return hasFilterValues(
      dataToCheck as unknown as { [key: string]: unknown } | undefined,
    );
  };

  type GetMirroredCreateButtonFunction = () => CardButtonSchema | undefined;

  /*
   * The way forward from an empty table: the "Create X" button the card's
   * header already shows - same handler, same permission gate, same label -
   * repeated in the empty state, where a new user is looking. It is drawn
   * the way the header's is, as a plain button: a filled indigo one in the
   * middle of an otherwise quiet card shouted, and made two buttons that do
   * the same thing look like different actions.
   *
   * A header button counts as "create" when it carries the Add icon and is
   * drawn NORMAL or PRIMARY - an OUTLINE Add is an import or a template
   * picker, not the way to make the first one.
   */
  const getMirroredCreateButton: GetMirroredCreateButtonFunction = ():
    | CardButtonSchema
    | undefined => {
    if (!props.cardProps) {
      return undefined;
    }

    return cardButtons.find(
      (button: CardButtonSchema | ReactElement): boolean => {
        if (React.isValidElement(button)) {
          return false;
        }

        const schema: CardButtonSchema = button as CardButtonSchema;

        return (
          schema.icon === IconProp.Add &&
          (schema.buttonStyle === ButtonStyleType.NORMAL ||
            schema.buttonStyle === ButtonStyleType.PRIMARY)
        );
      },
    ) as CardButtonSchema | undefined;
  };

  type GetEmptyStateFunction = () => ModelTableEmptyState;

  /*
   * What the table shows when a load comes back with no rows. An empty table
   * has quite different causes and used to have one grey sentence for all of
   * them: a typo in the search box looked exactly like an empty project, and
   * neither said what the list was for. buildModelTableEmptyState decides
   * between "nothing here yet", "nothing matches" and "all clear", and what
   * each offers.
   */
  const getEmptyState: GetEmptyStateFunction = (): ModelTableEmptyState => {
    const isSearchOn: boolean = isSearchActive();
    const isFilterOn: boolean = hasFilterApplied(filterData);
    const createCheck: PermissionGateResult = PermissionGate.check(
      model,
      ModelAction.Create,
      privateRecordOptions,
    );

    return buildModelTableEmptyState({
      pluralLabel: props.pluralName || model.pluralName || "items",
      options: props.emptyState,
      noItemsMessage:
        typeof props.noItemsMessage === "string"
          ? props.noItemsMessage
          : undefined,
      hasCustomElement: React.isValidElement(props.noItemsMessage),
      cardDescription: props.cardProps?.description,
      modelIcon: (model as { icon?: IconProp | null }).icon,
      isSearchActive: isSearchOn,
      isFilterActive: isFilterOn,
      onClearSearchAndFilters: (): void => {
        clearSearchAndFilters({ isFilterOn: isFilterOn });
      },
      createButton: getMirroredCreateButton(),
      isCreateDeniedByPermission:
        !createCheck.isAllowed && Boolean(createCheck.disabledReason),
      help: props.helpContent
        ? {
            title: props.helpContent.title,
            onClick: (): void => {
              setShowHelpModal(true);
            },
          }
        : undefined,
      onDocumentationClick: props.documentationLink
        ? (): void => {
            openDocumentationLink(props.documentationLink!);
          }
        : undefined,
      translate: tx,
      translator: translator,
    });
  };

  type ClearSearchAndFiltersFunction = (data: { isFilterOn: boolean }) => void;

  /*
   * The empty state's way out of a search or filter that hides every row:
   * the search box and its label chips are emptied at once (not after the
   * search debounce), and the filters go the way the filter form clears them.
   */
  const clearSearchAndFilters: ClearSearchAndFiltersFunction = (data: {
    isFilterOn: boolean;
  }): void => {
    setSearchText("");
    setDebouncedSearchText("");
    setSelectedLabels([]);
    setIsSearchExpanded(false);

    if (data.isFilterOn) {
      onFilterChanged({});
      setTableView(null);
      props.onFilterApplied?.(false);
    }
  };

  const emptyState: ModelTableEmptyState = getEmptyState();

  /*
   * A viewer's layout can never empty the columns out -
   * applyColumnPreference refuses to return nothing - so no column to
   * read, once they have been built, still means what it always did:
   * every column was denied by permission. The generated Actions column
   * does not count. It stays for a locked Edit or Delete, so a list with
   * row actions used to draw rows of nothing but a ⋯ - over the server's
   * refusal, which names every role and permission that may read the
   * list - and never "You don't have access to this list". Before the
   * columns are built, every table drew that for a frame, and for longer on
   * a page slow to run its effects, telling viewers who could read every
   * column, master admins included, that they had no access.
   *
   * Until the permission snapshot lands - the first paint after a fresh
   * login, a moment after a project switch - every column fails closed and
   * nothing is known about what the viewer may read, so the Actions column
   * still counts then: a list with row actions keeps drawing its rows' ⋯
   * and its own empty state, as it did before, rather than tell a viewer who
   * may read all of it that they have no access.
   */
  const hasPermissionSnapshot: boolean = PermissionGate.hasPermissionSnapshot({
    held: heldPermissions,
  });

  const isNoAccessShown: boolean =
    hasBuiltColumns &&
    allColumns.length > 0 &&
    !tableColumns.some((column: TableColumn<TBaseModel>): boolean => {
      return column.type !== FieldType.Actions || !hasPermissionSnapshot;
    });

  /*
   * What sits over the table - a page's filter chips - unless the list has
   * nothing at all and its emptyState says to leave them out then
   * (EmptyStateOptions.hideTopContentWhileEmpty): "Filter: Owner, Labels"
   * over "No archived hosts" offered to narrow a list with nothing in it.
   * A search, a filter or a chip in force keeps them, so they can be
   * cleared; so does a failed load, which says nothing about the list. A
   * viewer who may read none of it gets none of them either: chips under
   * "You don't have access to this list" offered to narrow what they
   * cannot see.
   */
  const topContent: ReactElement | undefined =
    isNoAccessShown ||
    (props.emptyState?.hideTopContentWhileEmpty &&
      isEmptyWithNothingApplied &&
      !error)
      ? undefined
      : props.topContent;

  /*
   * Drag-and-drop reordering, for both the table and the list layout.
   *
   * A drop moves the row on screen at once and saves it in the background:
   * the row is given the number of the row it was dropped on, and the server
   * gives it that place and moves the rows in the way one place along
   * (@ListOrderColumn). The list is then refreshed quietly to pick up their
   * new numbers. If the save fails, the rows go back where they were and say
   * why.
   *
   * While a filter or search narrows the list, dragging is off - the rows in
   * between are not on screen, so "drop it above this one" would mean
   * something the person cannot see. The grips stay, greyed out, and a line
   * above the list says why.
   */
  const isReorderBlockedByFilter: boolean =
    isManuallyOrdered && (isSearchActive() || hasFilterApplied(filterData));

  /*
   * Someone who may not edit the rows may not put them in another order
   * either: the server would refuse the drop, and the rows would jump back.
   * The grips stay where they are, greyed out, and say why - as the row's
   * Edit button does.
   */
  const reorderGate: ActionGate = getActionGate(ModelAction.Update);

  const isReorderDeniedByPermission: boolean =
    isManuallyOrdered && (!reorderGate.show || reorderGate.disabled);

  // A table with no way to move a row has nothing a drop could save.
  const cannotMoveRows: boolean =
    isManuallyOrdered && !props.callbacks.moveInList;

  const isDragDisabled: boolean =
    isReorderDeniedByPermission ||
    isReorderBlockedByFilter ||
    isReordering ||
    cannotMoveRows;

  const dragDisabledReason: string | undefined = isReorderDeniedByPermission
    ? reorderGate.tooltip
    : isReorderBlockedByFilter
      ? REORDER_OFF_WHILE_FILTERED
      : isReordering
        ? REORDER_SAVING
        : undefined;

  type OnRowDroppedFunction = (
    id: string,
    destinationIndex: number,
    sourceIndex: number,
  ) => Promise<void>;

  const onRowDropped: OnRowDroppedFunction = async (
    id: string,
    destinationIndex: number,
    sourceIndex: number,
  ): Promise<void> => {
    const orderField: keyof TBaseModel | undefined = props.dragDropIndexField;

    if (!orderField || isDragDisabled || destinationIndex === sourceIndex) {
      return;
    }

    const rowsBeforeDrop: Array<TBaseModel> = data;

    /*
     * The row it was dropped on, by its id: the server moves the dragged row
     * to that row's place, the rows between stepping aside, and numbers the
     * list again (POST <path>/:id/move). Named by id rather than by its
     * number, a drop lands where it was dropped in a list with gaps, rows
     * without a number or two rows at one number too (issue #9609).
     */
    const placeOfId: string | undefined =
      rowsBeforeDrop[destinationIndex]?._id?.toString();
    const moveInList:
      | ((data: { id: ObjectID; placeOfId: ObjectID }) => Promise<void>)
      | undefined = props.callbacks.moveInList;

    if (!placeOfId || !moveInList) {
      return;
    }

    setReorderError("");
    setIsReorderSaved(false);
    setData(moveListItem(rowsBeforeDrop, sourceIndex, destinationIndex));
    setIsReordering(true);

    try {
      await moveInList({
        id: new ObjectID(id),
        placeOfId: new ObjectID(placeOfId),
      });
    } catch (err) {
      setData(rowsBeforeDrop);
      setReorderError(API.getFriendlyMessage(err));
      setIsReordering(false);
      return;
    }

    setIsReordering(false);
    setIsReorderSaved(true);

    await fetchItems({ quiet: true });
  };

  type GetReorderMessagesFunction = () => ReactElement | null;

  const getReorderMessages: GetReorderMessagesFunction =
    (): ReactElement | null => {
      if (!isManuallyOrdered) {
        return null;
      }

      return (
        <>
          <span className="sr-only" role="status" aria-live="polite">
            {isReordering
              ? tx(REORDER_SAVING)
              : isReorderSaved
                ? tx(REORDER_SAVED)
                : ""}
          </span>
          {reorderError ? (
            <Alert
              type={AlertType.DANGER}
              strongTitle={REORDER_FAILED}
              title={reorderError}
              onClose={() => {
                setReorderError("");
              }}
              className="mb-4"
              dataTestId="reorder-error"
            />
          ) : null}
          {isReorderBlockedByFilter && data.length > 1 ? (
            <div
              className="mb-3 flex items-center gap-1.5 text-xs text-gray-500"
              data-testid="reorder-off-while-filtered"
            >
              <Icon icon={IconProp.GripVertical} className="h-4 w-4" />
              <span>{tx(REORDER_OFF_WHILE_FILTERED)}</span>
            </div>
          ) : null}
        </>
      );
    };

  // A reorderable list with its messages - saving, failed, paused - above it.
  const withReorderMessages: (element: ReactElement) => ReactElement = (
    element: ReactElement,
  ): ReactElement => {
    return (
      <>
        {getReorderMessages()}
        {element}
      </>
    );
  };

  const getTable: GetReactElementFunction = (): ReactElement => {
    return withReorderMessages(
      <Table
        onFilterChanged={(filterData: FilterData<TBaseModel>) => {
          onFilterChanged(filterData);
          setTableView(null);

          // check if there's anything in the filter data and update the isFilterApplied prop.
          if (props.onFilterApplied) {
            props.onFilterApplied(hasFilterApplied(filterData));
          }
        }}
        filterData={filterData}
        /*
         * A table outside a card is framed as a card is - one hairline,
         * rounded, white - with the padding the table's rows and footer
         * reach out to (-mx-5 md:-mx-6, -mb-6). It was a 2px border whose
         * footer ran 4px past its bottom edge. overflow-clip rounds the
         * header band's corners without making a scroll box, so the header
         * row can still stick to the page.
         */
        className={props.cardProps ? "" : MODEL_TABLE_FRAME_CLASS_NAME}
        onFilterRefreshClick={async () => {
          await getFilterDropdownItems();
        }}
        bulkActions={(() => {
          const bulkDeleteGate: ActionGate = getActionGate(ModelAction.Delete);

          /*
           * Whether to auto-add the default Delete still follows the model
           * check alone, exactly as it did before. Folding the master-admin
           * short circuit in here would grow a row-selection column onto every
           * table a master admin opens without project permissions - Table
           * derives those checkboxes from this array being non-empty - which is
           * a layout change nobody asked for. The gate above still decides
           * whether the action, once present, is locked and what it says.
           */
          const userCanDelete: boolean = PermissionGate.snapshotAllows(
            model,
            ModelAction.Delete,
            privateRecordOptions,
          );

          const sourceButtons: Array<
            BulkActionButtonSchema<TBaseModel> | ModalTableBulkDefaultActions
          > = [...(props.bulkActions?.buttons ?? [])];

          /*
           * Delete is in Bulk Actions exactly where it is in each row's ⋯
           * menu: on a table whose rows are deleted from it (`isDeleteable`).
           * It is added there on its own - a page that lists
           * ModalTableBulkDefaultActions.Delete only places it - for anyone
           * the model lets delete, so a table that exposes row selection also
           * exposes a way to delete the selected rows. The confirmation is
           * wired up via the schema's confirmMessage / confirmTitle below.
           *
           * It used to be added to every table whose viewer may delete the
           * model, whatever `isDeleteable` said. So a list that kept Delete
           * off its rows on purpose still deleted from Bulk Actions: a
           * monitor group's monitors (whose row action is Unassign), lists
           * across every project (whose deletes went to the wrong one), a
           * notification method whose own Delete first says which rules use
           * it - and history and logs grew a selection column for owners.
           * Now one switch decides both, and a list without Delete has none.
           *
           * Only auto-inject it when the table already offers bulk actions,
           * or for a viewer who may delete: Table derives the row checkboxes
           * from this array being non-empty, so injecting a locked Delete
           * into an otherwise empty array would grow a selection column that
           * does nothing.
           *
           * A page's own button counts as the delete action when it carries
           * the title the default one would have: "Delete", or the table's
           * deleteVerb.
           */
          const deleteActionTitles: Array<string> = ["Delete"];
          const bulkDeleteVerb: string | undefined =
            props.bulkActions?.deleteVerb?.trim() || undefined;

          if (bulkDeleteVerb) {
            deleteActionTitles.push(bulkDeleteVerb);
          }

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
                deleteActionTitles.includes(
                  (action as BulkActionButtonSchema<TBaseModel>).title,
                )
              ) {
                return true;
              }
              return false;
            },
          );

          /*
           * On a table that already offers bulk actions the gate decides on
           * its own, because there is no selection column left to grow: the
           * row checkboxes are already there. That covers the locked case, and
           * it also covers a master admin - allowed everything by the gate, but
           * holding no project permission for `userCanDelete` to find, so the
           * Delete they are entitled to used to be missing from a menu whose
           * every other action worked (issue #3559).
           */
          const canAutoInjectDelete: boolean =
            props.isDeleteable &&
            (userCanDelete ||
              (bulkDeleteGate.show && sourceButtons.length > 0));

          if (canAutoInjectDelete && !alreadyHasDeleteAction) {
            sourceButtons.push(ModalTableBulkDefaultActions.Delete);
          }

          const buttons: Array<BulkActionButtonSchema<TBaseModel>> =
            sourceButtons
              .map(
                (
                  action:
                    | BulkActionButtonSchema<TBaseModel>
                    | ModalTableBulkDefaultActions,
                ):
                  | BulkActionButtonSchema<TBaseModel>
                  | ModalTableBulkDefaultActions
                  | null => {
                  if (action !== ModalTableBulkDefaultActions.Delete) {
                    return action;
                  }

                  /*
                   * A table author who asked for the default Delete but whose
                   * viewer cannot delete used to leave the raw enum string in
                   * the array, which then reached BulkUpdateForm as if it were
                   * a button schema. Resolve it here, in every branch. A table
                   * whose rows are not deleted from it has no Delete to place.
                   */
                  if (!props.isDeleteable || !bulkDeleteGate.show) {
                    return null;
                  }

                  const deleteAction: BulkActionButtonSchema<TBaseModel> =
                    getDeleteBulkAction();

                  if (bulkDeleteGate.disabled) {
                    return {
                      ...deleteAction,
                      disabled: true,
                      tooltip: bulkDeleteGate.tooltip,
                    };
                  }

                  return deleteAction;
                },
              )
              .filter(
                (
                  action:
                    | BulkActionButtonSchema<TBaseModel>
                    | ModalTableBulkDefaultActions
                    | null,
                ): boolean => {
                  return action !== null;
                },
              ) as Array<BulkActionButtonSchema<TBaseModel>>;

          return {
            buttons,
            /*
             * A list whose rows are not deleted from it, and that has no bulk
             * actions of its own, used to get its row selection - and Export
             * CSV with it - from the Delete added for whoever may delete the
             * model. Delete is gone from such a list; the selection and
             * Export CSV stay for the people who had them (a monitor's logs
             * and the LLM calls word their export for it: getExportValue).
             */
            isCsvExportOnly:
              !props.isDeleteable && userCanDelete && buttons.length === 0,
          };
        })()}
        onBulkActionEnd={async () => {
          clearBulkSelectionState();
          // A bulk Delete can empty the page it was started on.
          await fetchItems({ stayInRange: true });
        }}
        onBulkActionStart={() => {}}
        bulkSelectedItems={bulkSelectedItems}
        onBulkSelectedItemAdded={(item: TBaseModel) => {
          // The user has moved on from the failed select-all.
          setBulkSelectionError("");
          setBulkSelectedItems([...bulkSelectedItems, item]);
        }}
        onBulkSelectedItemRemoved={(item: TBaseModel) => {
          setBulkSelectionError("");
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
          clearBulkSelectionState();
        }}
        onBulkSelectAllItems={async (): Promise<boolean> => {
          return await fetchAllBulkItems();
        }}
        bulkSelectionError={bulkSelectionError}
        isBulkSelectAllLoading={isBulkSelectAllLoading}
        isBulkSelectionTruncated={isBulkSelectionTruncated}
        bulkSelectionTotalCount={bulkSelectionTotalCount}
        matchBulkSelectedItemByField={matchBulkSelectedItemByField || "_id"}
        bulkItemToString={(item: TBaseModel) => {
          /*
           * The kind of row in the reader's language, like the rest of the
           * bulk dialog around it ("Monitor-Statusereignis: ..." in German).
           */
          const label: string = tx(
            props.singularName || item.singularName || "",
          );
          // Same deriver the delete confirmation uses, so the two cannot drift.
          const name: string = getItemLabel(item);
          // "Monitor: API", the kind and the name as one key (#8290).
          if (name) {
            return label
              ? translator.translateTemplate(ROW_KIND_AND_NAME, {
                  label,
                  identifier: name,
                })
              : name;
          }
          const id: string =
            item[matchBulkSelectedItemByField]?.toString() || "";
          return label
            ? translator.translateTemplate(ROW_KIND_AND_NAME, {
                label,
                identifier: id,
              })
            : id;
        }}
        filters={shownClassicTableFilters}
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
        isDragDisabled={isDragDisabled}
        dragDisabledReason={dragDisabledReason}
        totalItemsCount={totalItemsCount}
        hasMore={hasMore}
        isCountCapped={isCountCapped}
        data={data}
        id={props.id}
        columns={tableColumns}
        itemsOnPage={itemsOnPage}
        onDragDrop={onRowDropped}
        disablePagination={props.disablePagination || false}
        onNavigateToPage={async (
          pageNumber: number,
          newItemsOnPage: number,
        ) => {
          setCurrentPageNumber(pageNumber);

          if (newItemsOnPage !== itemsOnPage) {
            setTableView(null);
            isItemsOnPageExplicitRef.current = true;
          }

          setItemsOnPage(newItemsOnPage);
        }}
        noItemsMessage={
          React.isValidElement(props.noItemsMessage)
            ? props.noItemsMessage
            : undefined
        }
        emptyStateProps={emptyState.emptyStateProps}
        onRefreshClick={refreshFromRefreshButton}
        actionButtons={actionButtonSchema}
        getRowProps={getRowProps}
        /*
         * The widths a person gives this list's columns are remembered with
         * its column choices and page size, under the same key.
         */
        columnWidthsKey={props.userPreferencesKey}
      />,
    );
  };

  const getList: GetReactElementFunction = (): ReactElement => {
    return withReorderMessages(
      <List
        onFilterChanged={(filterData: FilterData<TBaseModel>) => {
          onFilterChanged(filterData);
        }}
        onFilterRefreshClick={async () => {
          await getFilterDropdownItems();
        }}
        filters={shownClassicTableFilters}
        filterData={filterData}
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
        onDragDrop={onRowDropped}
        isDragDisabled={isDragDisabled}
        dragDisabledReason={dragDisabledReason}
        itemToString={(item: TBaseModel): string => {
          const label: string = tx(
            props.singularName || item.singularName || "",
          );
          const name: string = getItemLabel(item);
          return name && label
            ? translator.translateTemplate(ROW_KIND_AND_NAME, {
                label,
                identifier: name,
              })
            : name || label;
        }}
        dragDropIdField={"_id"}
        dragDropIndexField={props.dragDropIndexField}
        isLoading={getTableLoadingState()}
        totalItemsCount={totalItemsCount}
        hasMore={hasMore}
        isCountCapped={isCountCapped}
        data={data}
        id={props.id}
        fields={fields}
        itemsOnPage={itemsOnPage}
        disablePagination={props.disablePagination || false}
        onNavigateToPage={async (
          pageNumber: number,
          newItemsOnPage: number,
        ) => {
          setCurrentPageNumber(pageNumber);

          if (newItemsOnPage !== itemsOnPage) {
            isItemsOnPageExplicitRef.current = true;
          }

          setItemsOnPage(newItemsOnPage);
        }}
        noItemsMessage={
          React.isValidElement(props.noItemsMessage)
            ? props.noItemsMessage
            : undefined
        }
        emptyStateProps={emptyState.emptyStateProps}
        onRefreshClick={refreshFromRefreshButton}
        actionButtons={actionButtonSchema}
      />,
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

    /*
     * The card's Glossary term (cardProps.titleGlossaryTerm) marks the
     * title's words here, beside its plan's badge: Card marks only a title
     * that is words alone.
     */
    const glossaryTerm: GlossaryTerm | undefined =
      props.cardProps?.titleGlossaryTerm;

    return (
      <span>
        {glossaryTerm && typeof renderedTitle === "string" ? (
          <DefinedTerm term={glossaryTerm}>{renderedTitle}</DefinedTerm>
        ) : (
          renderedTitle
        )}
        {showPlan && (
          <span
            style={{
              marginInlineStart: "5px",
            }}
          >
            <Pill
              text={translator.translateTemplate("{{planName}} Plan", {
                planName: planName,
              })}
              // Already in the reader's words: not looked up a second time.
              isUserContent={true}
              color={Yellow}
            />
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

  type MentionParseResult = TableLabelMention;

  const parseLabelMention: (value: string) => MentionParseResult =
    parseTableLabelMention;

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

    const pluralTerm: ReturnType<typeof translatableTerm> = translatableTerm(
      props.pluralName || model.pluralName || "items",
      { inSentence: true },
    );

    const hasLabelSupport: boolean = Boolean(labelFilterConfig);

    const defaultPlaceholder: string = hasLabelSupport
      ? translator.translateTemplate(
          "Search {{itemsName}}… (try @ for labels)",
          {
            itemsName: pluralTerm,
          },
        )
      : translator.translateTemplate(
          "Search {{itemsName}} by name, description…",
          { itemsName: pluralTerm },
        );
    const placeholder: string = props.searchPlaceholder
      ? tx(props.searchPlaceholder)
      : defaultPlaceholder;

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

    /*
     * The server's suggestions, without the labels picked already. The
     * search finds a name that holds what is typed; what it answered for
     * an earlier prefix, while the next one is on its way, is narrowed here
     * the same way.
     */
    const lowerPrefix: string = mention.prefix.trim().toLowerCase();
    const dropdownLabels: Array<SearchLabelOption> = availableLabels
      .filter((l: SearchLabelOption) => {
        return !selectedLabels.find((s: SearchLabelOption) => {
          return s.id === l.id;
        });
      })
      .filter((l: SearchLabelOption) => {
        return (
          lowerPrefix.length === 0 || l.name.toLowerCase().includes(lowerPrefix)
        );
      })
      .slice(0, TABLE_LABEL_SUGGESTIONS_SHOWN);

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
          {/*
           * As tall as the header's buttons: 38px at every width
           * (TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME). The pill folded
           * over it takes its height.
           */}
          <div
            className={`flex w-full items-center gap-2 rounded-md border bg-white px-3 ${TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME} transition-all duration-200 ${borderClass}`}
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
              {/*
               * Gated on label support as well as on the chips themselves: a
               * pill this table cannot name, apply or refill is never worth
               * drawing, whatever left it in state.
               */}
              {hasLabelSupport &&
                selectedLabels.map((label: SearchLabelOption) => {
                  /*
                   * A label no record answers to any more says so, in the
                   * reader's words, muted - never its raw id (#10646).
                   */
                  const chipName: string = label.isNotFound
                    ? tx(ENTITY_DROPDOWN_NOT_FOUND_LABEL)
                    : label.name;

                  return (
                    <span
                      key={label.id}
                      data-testid="table-search-label-chip"
                      data-not-found={label.isNotFound ? "true" : undefined}
                      className="inline-flex items-center gap-1 rounded-full bg-gray-50 py-0.5 pl-2 pr-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200 transition-all hover:bg-gray-100"
                      title={translator.translateTemplate("Label: {{name}}", {
                        name: chipName,
                      })}
                    >
                      {!label.isNotFound && (
                        <span
                          className="h-2 w-2 flex-none rounded-full"
                          style={{ backgroundColor: label.color }}
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={`max-w-[8rem] truncate ${
                          label.isNotFound
                            ? "font-normal italic text-gray-500"
                            : ""
                        }`}
                      >
                        {chipName}
                      </span>
                      {searchLabelMarks.get(
                        getSharedNameOptionKey(label.id),
                      ) ? (
                        <SharedNameValueDetail
                          mark={
                            searchLabelMarks.get(
                              getSharedNameOptionKey(label.id),
                            )!
                          }
                          className="max-w-[8rem] truncate text-xs font-normal text-gray-500"
                        />
                      ) : null}
                      <button
                        type="button"
                        onMouseDown={(
                          e: React.MouseEvent<HTMLButtonElement>,
                        ) => {
                          e.preventDefault();
                        }}
                        onClick={() => {
                          removeLabel(label.id);
                        }}
                        title={tx("Remove label")}
                        aria-label={translator.translateTemplate(
                          "Remove {{name}}",
                          { name: chipName },
                        )}
                        className="ml-0.5 flex-none rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                      >
                        <Icon icon={IconProp.Close} className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              <input
                data-unsaved-changes-ignore
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
                  selectedLabels.length === 0
                    ? placeholder
                    : tx("Refine search…")
                }
                spellCheck={false}
                autoComplete="off"
                tabIndex={expanded ? 0 : -1}
                className="min-w-[6rem] flex-1 bg-transparent text-sm leading-5 text-gray-900 placeholder-gray-400 outline-none"
              />
            </div>
            {isSearching && (
              <div className="flex-none text-gray-400" title={tx("Searching…")}>
                <Icon
                  icon={IconProp.Spinner}
                  className="h-4 w-4 animate-spin"
                />
              </div>
            )}
            {showMatchPill && totalItemsCount >= 0 && hasMore === undefined && (
              <span
                className="flex-none whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                title={translator.translatePlural(
                  SEARCH_RESULT_COUNT,
                  totalItemsCount,
                )}
              >
                {translator.translatePlural(
                  SEARCH_MATCH_COUNT,
                  totalItemsCount,
                )}
              </span>
            )}
            {showMatchPill && isCountCapped && (
              <span
                className="flex-none whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                title={translator.translatePlural(
                  SEARCH_RESULT_COUNT,
                  totalItemsCount,
                  {
                    count: `${translator.formatNumber(totalItemsCount)}+`,
                  },
                )}
              >
                {translator.translatePlural(
                  SEARCH_MATCH_COUNT,
                  totalItemsCount,
                  {
                    count: `${translator.formatNumber(totalItemsCount)}+`,
                  },
                )}
              </span>
            )}
            {showMatchPill &&
              hasMore !== undefined &&
              !isCountCapped &&
              data.length > 0 && (
                <span
                  className="flex-none whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                  title={translator.translatePlural(
                    SEARCH_RESULT_COUNT_ON_PAGE,
                    data.length,
                    {
                      count: `${translator.formatNumber(data.length)}${
                        hasMore ? "+" : ""
                      }`,
                    },
                  )}
                >
                  {translator.translatePlural(SEARCH_MATCH_COUNT, data.length, {
                    count: `${translator.formatNumber(data.length)}${
                      hasMore ? "+" : ""
                    }`,
                  })}
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
                title={tx("Clear search (Esc Esc)")}
                aria-label={tx("Clear search")}
                className={TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME}
              >
                <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd
                className={TABLE_HEADER_SEARCH_KEY_HINT_CLASS_NAME}
                title={tx("Press / to focus search")}
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
                  {tx(isLabelsLoading ? "Loading labels…" : "Filter by label")}
                </span>
                <span className="text-[10px] text-gray-400">
                  <TranslatedSentence
                    template="{{arrowKeys}} to navigate"
                    slots={{
                      arrowKeys: (
                        <>
                          <kbd className="font-mono">↑</kbd>
                          <kbd className="ml-0.5 font-mono">↓</kbd>
                        </>
                      ),
                    }}
                  />
                  <span className="mx-1.5">
                    <InlineSeparator markOnly />
                  </span>
                  <TranslatedSentence
                    template="{{enterKey}} to select"
                    slots={{
                      enterKey: <kbd className="font-mono">↵</kbd>,
                    }}
                  />
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {!isLabelsLoading && dropdownLabels.length === 0 && (
                  <div
                    className="px-3 py-3 text-sm text-gray-500"
                    data-testid="table-label-suggestions-empty"
                  >
                    {availableLabels.length === 0 && lowerPrefix.length === 0
                      ? tx("No labels available for this resource.")
                      : translator.translateTemplate(
                          'No labels matching "{{prefix}}"',
                          { prefix: mention.prefix },
                        )}
                  </div>
                )}
                {dropdownLabels.map((label: SearchLabelOption, idx: number) => {
                  const isActive: boolean = idx === labelDropdownIndex;
                  const sharedNameMark: SharedNameMark | undefined =
                    searchLabelMarks.get(getSharedNameOptionKey(label.id));
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
                      {sharedNameMark ? (
                        /*
                         * One of labels that share a name: the pill its
                         * list draws, and what sets it apart (#10314).
                         */
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{label.name}</span>
                            <SharedNamePill mark={sharedNameMark} />
                          </span>
                          <SharedNameDetail
                            mark={sharedNameMark}
                            className="block truncate text-xs text-gray-500"
                          />
                        </span>
                      ) : (
                        <span className="flex-1 truncate">{label.name}</span>
                      )}
                      {isActive && (
                        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
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
   * The main button beside the search and the ⋯ that holds the rest: the
   * same split every table's header makes (Table/TableHeaderControls).
   */
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
    // Nothing to search, and no view to save, in a list nobody may read.
    const hasSearch: boolean =
      Boolean(props.searchableFields && props.searchableFields.length > 0) &&
      !isNoAccessShown;

    /*
     * Saved views get their own first-class slot in the header — never
     * collapsed into the overflow ⋯ menu. Render fresh on every call so the
     * inner TableViewElement always sees the current query / sort / itemsOnPage.
     */
    const savedViewsElement: ReactElement | null =
      props.saveFilterProps && !isNoAccessShown
        ? getSaveFilterDropdown()
        : null;

    /*
     * Nothing to filter, and no columns to choose, in a list nobody may
     * read: its ⋯ offered Filter and Columns over "You don't have access to
     * this list". Refresh stays - a person granted access reads it again.
     */
    const headerButtons: Array<CardButtonSchema | ReactElement> =
      isNoAccessShown
        ? cardButtons.filter(
            (button: CardButtonSchema | ReactElement): boolean => {
              return !LIST_READ_BUTTONS.has(button);
            },
          )
        : cardButtons;

    if (headerButtons.length === 0 && !hasSearch) {
      return savedViewsElement ? [savedViewsElement] : headerButtons;
    }

    if (!hasSearch) {
      // Without search, just split into [Saved Views] [main] [⋯]; no special wrapping.
      const { main, rest }: TableHeaderButtonSplit =
        splitTableHeaderButtons(headerButtons);
      const composed: Array<ReactElement> = [];
      if (savedViewsElement) {
        composed.push(savedViewsElement);
      }
      if (main) {
        composed.push(renderTableHeaderMainButton(main));
      }
      const moreMenu: ReactElement | null = renderTableHeaderMoreMenu(rest);
      if (moreMenu) {
        composed.push(moreMenu);
      }
      return composed;
    }

    const trimmedActive: string = debouncedSearchText.trim();
    const isExpanded: boolean =
      isSearchExpanded || trimmedActive.length > 0 || selectedLabels.length > 0;

    const { main, rest }: TableHeaderButtonSplit =
      splitTableHeaderButtons(headerButtons);
    const moreMenu: ReactElement | null = renderTableHeaderMoreMenu(rest);

    /*
     * One row while it fits; in a narrow card (a phone, or beside a product's
     * side menu) the buttons wrap under the search, at the right edge,
     * instead of the row running off the card's left edge.
     *
     * On a phone the row takes the card's width, and the search the whole
     * of its line (MODEL_TABLE_PHONE_SEARCH_CLASS_NAME). It was a 176px
     * pill hung at the right edge, on a line of its own over the buttons.
     */
    const wrapped: ReactElement = (
      <TableHeaderToolbar
        key="model-table-header-actions"
        isSearchOpen={isExpanded}
        search={
          <TableHeaderSearchSlot
            isOpen={isExpanded}
            onOpen={() => {
              setIsSearchExpanded(true);
              requestAnimationFrame(() => {
                searchInputRef.current?.focus();
              });
            }}
          >
            {getSearchControl()}
          </TableHeaderSearchSlot>
        }
      >
        {savedViewsElement}
        {renderTableHeaderMainAndMore(main, moreMenu)}
      </TableHeaderToolbar>
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

  type IsPickableColumnFunction = (
    column: ModelTableColumn<TBaseModel>,
  ) => boolean;

  /*
   * A column the viewer cannot read is left out of the picker entirely.
   * Listing it would advertise a field they have no access to, and switching
   * it on would put that field in the select — which the API rejects for the
   * whole request, blanking the table.
   */
  const isPickableColumn: IsPickableColumnFunction = (
    column: ModelTableColumn<TBaseModel>,
  ): boolean => {
    if (column.isNotCustomizable) {
      return false;
    }

    return hasPermissionToReadColumn(column) || User.isMasterAdmin();
  };

  type GetPickerEntriesFunction = (
    preference: ColumnPreference | null,
    columns?: Columns<TBaseModel> | undefined,
  ) => Array<CustomizableColumn<TBaseModel>>;

  const getPickerEntries: GetPickerEntriesFunction = (
    preference: ColumnPreference | null,
    columns?: Columns<TBaseModel> | undefined,
  ): Array<CustomizableColumn<TBaseModel>> => {
    return getCustomizableColumns<TBaseModel>({
      columns: columns || allColumns,
      preference: preference,
    }).filter((entry: CustomizableColumn<TBaseModel>) => {
      return isPickableColumn(entry.column);
    });
  };

  type GetColumnSortKeyFunction = (
    column: ModelTableColumn<TBaseModel>,
  ) => string | null;

  // The key serializeToTableColumns gives the header to sort on.
  const getColumnSortKey: GetColumnSortKeyFunction = (
    column: ModelTableColumn<TBaseModel>,
  ): string | null => {
    return getModelTableColumnSortKey<TBaseModel>(column);
  };

  /*
   * Makes the columns the project's default for the list - or, with null,
   * takes the list's default away - then closes the picker. Whoever shows
   * columns to everyone sees what everyone sees: their own layout is let go
   * (isOwnLayoutLetGo). What the server refuses is said in the picker,
   * which stays open.
   */
  type SaveProjectDefaultFunction = (data: {
    preference: ColumnPreference | null;
    isOwnLayoutLetGo: boolean;
  }) => Promise<void>;

  const saveProjectDefault: SaveProjectDefaultFunction = async (data: {
    preference: ColumnPreference | null;
    isOwnLayoutLetGo: boolean;
  }): Promise<void> => {
    if (!props.userPreferencesKey) {
      return;
    }

    setIsSavingProjectDefault(true);
    setProjectDefaultError("");

    try {
      const stored: ColumnPreference | null = await saveProjectDefaultColumns({
        tableKey: props.userPreferencesKey,
        preference: data.preference,
      });

      setProjectDefaultPreference(stored);

      if (data.isOwnLayoutLetGo) {
        saveColumnPreference(null);
      }

      setShowColumnCustomizationModal(false);
    } catch (err) {
      setProjectDefaultError(API.getFriendlyMessage(err));
    } finally {
      setIsSavingProjectDefault(false);
    }
  };

  type OnColumnCustomizationSaveFunction = (
    entries: Array<CustomizableColumn<TBaseModel>>,
    options: ColumnCustomizationSaveOptions,
  ) => void;

  const onColumnCustomizationSave: OnColumnCustomizationSaveFunction = (
    entries: Array<CustomizableColumn<TBaseModel>>,
    options: ColumnCustomizationSaveOptions,
  ): void => {
    const preference: ColumnPreference =
      buildColumnPreference<TBaseModel>(entries);

    /*
     * If the layout the viewer just saved matches what they would see with
     * nothing of their own - the project's default for the list, or what
     * the table ships with - store nothing. Otherwise every table anyone ever
     * opened the picker on would be pinned to the column set of the release
     * (or the project's default) they opened it in, and columns added later
     * would arrive already stale.
     */
    /*
     * Over the DECLARED columns only. An attribute column exists because the
     * viewer added it, so the layout that has none of them is the default one
     * — otherwise adding a column and then removing it again would leave the
     * table pinned to a stored layout it no longer differs from.
     */
    const declaredPreference: ColumnPreference =
      buildColumnPreference<TBaseModel>(
        getPickerEntries(null, declaredColumns),
      );

    const isDeclaredLayout: boolean =
      JSON.stringify(preference) === JSON.stringify(declaredPreference);

    // The project's default as the picker would hand it back.
    const followedPreference: ColumnPreference = projectDefaultColumnPreference
      ? buildColumnPreference<TBaseModel>(
          getPickerEntries(projectDefaultColumnPreference),
        )
      : declaredPreference;

    const isBackToDefault: boolean =
      JSON.stringify(preference) === JSON.stringify(followedPreference);

    /*
     * Sorting by a column that is no longer on screen leaves the viewer with
     * an ordering they can neither see nor undo — there is no header left to
     * click. Fall back to the table's own default sort.
     */
    if (sortBy) {
      const hiddenIds: Set<string> = new Set(preference.hidden);

      const isSortedColumnHidden: boolean = entries.some(
        (entry: CustomizableColumn<TBaseModel>) => {
          return (
            hiddenIds.has(entry.id) &&
            getColumnSortKey(entry.column) === String(sortBy)
          );
        },
      );

      if (isSortedColumnHidden) {
        setSortBy((props.sortBy as keyof TBaseModel | undefined) || null);
        setSortOrder(props.sortOrder || SortOrder.Ascending);
        setCurrentPageNumber(1);
      }
    }

    /*
     * Everyone's: the project's default for the list. The list's own
     * columns made everyone's is no default at all - the list's default is
     * taken away, so a column the page adds later is shown as it ships.
     */
    if (options.isForEveryone) {
      void saveProjectDefault({
        preference: isDeclaredLayout ? null : preference,
        isOwnLayoutLetGo: true,
      });
      return;
    }

    saveColumnPreference(isBackToDefault ? null : preference);
    setShowColumnCustomizationModal(false);
  };

  /*
   * The pool the picker offers, as picker entries rather than model columns,
   * so the modal can stage one straight into its list. Every one starts
   * removable — the whole point is that the viewer can take it away again.
   */
  const addableAttributeColumns: Array<CustomizableColumn<TBaseModel>> =
    useMemo(() => {
      if (!attributeColumnKey || attributeKeyPool.keys.length === 0) {
        return [];
      }

      return getAttributeColumns<TBaseModel>({
        attributesColumnKey: attributeColumnKey,
        attributeKeys: attributeKeyPool.keys,
      }).map(
        (
          column: ModelTableColumn<TBaseModel>,
          index: number,
        ): CustomizableColumn<TBaseModel> => {
          return {
            id: column.id || `${attributeColumnKey}.${index}`,
            column: column,
            isVisible: true,
            isPinned: false,
            isRemovable: true,
          };
        },
      );
    }, [attributeColumnKey, attributeKeyPool.keys]);

  const getAddableColumnsConfig: () =>
    | AddableColumnsConfig<TBaseModel>
    | undefined = (): AddableColumnsConfig<TBaseModel> | undefined => {
    if (!attributeColumnKey || !props.attributeColumnsProps) {
      return undefined;
    }

    return {
      title: props.attributeColumnsProps.title || tx("Add Attribute Column"),
      description:
        props.attributeColumnsProps.description ||
        tx(
          "Attributes vary per event, so they are not listed above. Search for one to add it as a column.",
        ),
      placeholder: props.attributeColumnsProps.placeholder || "Search...",
      emptyMessage: props.attributeColumnsProps.emptyMessage,
      isLoading: attributeKeyPool.isLoading,
      errorMessage: attributeKeyPool.error,
      columns: addableAttributeColumns,
    };
  };

  const getColumnCustomizationModal: () => ReactElement | null =
    (): ReactElement | null => {
      if (!showColumnCustomizationModal || !isColumnCustomizationEnabled) {
        return null;
      }

      /*
       * The project's default columns for the list, where there is a
       * project (the Admin Dashboard has none): whether it keeps them,
       * whether the viewer sees them, and whether they may set them.
       */
      const projectDefault: ColumnCustomizationProjectDefault | undefined =
        props.userPreferencesKey && ProjectUtil.getCurrentProjectId()
          ? {
              hasDefault: !isEmptyColumnPreference(
                projectDefaultColumnPreference,
              ),
              isFollowed: isEmptyColumnPreference(ownColumnPreference),
              canChange: canChangeProjectDefaultColumns(),
              onRemove: (): void => {
                void saveProjectDefault({
                  preference: null,
                  isOwnLayoutLetGo: false,
                });
              },
            }
          : undefined;

      return (
        <ColumnCustomizationModal<TBaseModel>
          columns={getPickerEntries(effectiveColumnPreference)}
          addableColumns={getAddableColumnsConfig()}
          /*
           * Reset to default takes the viewer's own layout away: shown only
           * while they have one.
           */
          isDefaultLayout={isEmptyColumnPreference(ownColumnPreference)}
          title={tx("Customize Columns")}
          isTitleTranslated={true}
          onSave={onColumnCustomizationSave}
          projectDefault={projectDefault}
          isSaving={isSavingProjectDefault}
          error={projectDefaultError || undefined}
          onReset={() => {
            saveColumnPreference(null);
            setProjectDefaultError("");
            setShowColumnCustomizationModal(false);
          }}
          onClose={() => {
            setProjectDefaultError("");
            setShowColumnCustomizationModal(false);
          }}
        />
      );
    };

  const getCardComponent: GetReactElementFunction = (): ReactElement => {
    const headerButtons: Array<CardButtonSchema | ReactElement> =
      getHeaderButtonsWithSearch();

    // isNoAccessShown (above topContent) says when this is drawn.
    const getNoAccessState: GetReactElementFunction = (): ReactElement => {
      return (
        <div data-testid={`${props.id}-no-access`}>
          <TableEmptyState
            {...buildNoAccessState({
              // What reads a list of its kind: Read Probe, not 22 pickers'.
              neededPermissions: PermissionGate.getNeededPermissionsSentence(
                PermissionGate.getReadPermissionsOfItsKind(model),
                translator,
              ),
              translate: tx,
            })}
          />
        </div>
      );
    };

    /*
     * While the empty state is on screen and says what the list is for in
     * the card's own words, the card leaves its description out of the
     * header - the same sentence twice, a few lines apart, read as a bug.
     */
    const isEmptyStateShown: boolean =
      !getTableLoadingState() &&
      !error &&
      data.length === 0 &&
      tableColumns.length > 0 &&
      !isNoAccessShown;

    const cardDescription: CardComponentProps["description"] =
      isEmptyStateShown && emptyState.usesCardDescription
        ? undefined
        : props.cardProps?.description;

    if (showAs === ShowAs.Table || showAs === ShowAs.List) {
      return (
        <div>
          {props.cardProps && (
            <Card
              /*
               * A table's header holds a row of controls - search, saved
               * views, the main button, the ⋯ - so the title shares its line
               * with them and the description runs under both, across the
               * card, rather than being squeezed into a column beside them
               * (Card's "toolbar" header).
               */
              headerLayout="toolbar"
              {...props.cardProps}
              description={cardDescription}
              buttons={headerButtons}
              bodyClassName={
                showAs === ShowAs.List
                  ? "-ml-6 -mr-6 bg-gray-50 border-top"
                  : ""
              }
              title={getCardHeaderTitle(
                getCardTitle(props.cardProps.title || ""),
              )}
              /*
               * The title above is drawn with its plan's badge: its words,
               * for its place in a page's More settings.
               */
              titleText={
                props.cardProps.titleText ||
                (typeof props.cardProps.title === "string"
                  ? props.cardProps.title
                  : undefined)
              }
            >
              {isNoAccessShown ? getNoAccessState() : <></>}
              {topContent || <></>}
              {tableColumns.length > 0 &&
              !isNoAccessShown &&
              showAs === ShowAs.Table ? (
                getTable()
              ) : (
                <></>
              )}

              {tableColumns.length > 0 &&
              !isNoAccessShown &&
              showAs === ShowAs.List ? (
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
          !isNoAccessShown &&
          (showAs === ShowAs.Table || showAs === ShowAs.List) &&
          props.searchableFields &&
          props.searchableFields.length > 0 ? (
            <div className="mb-3 flex justify-end">{getSearchControl()}</div>
          ) : (
            <></>
          )}
          {!props.cardProps && topContent}
          {!props.cardProps && isNoAccessShown ? getNoAccessState() : <></>}
          {!props.cardProps && !isNoAccessShown && showAs === ShowAs.Table ? (
            getTable()
          ) : (
            <></>
          )}
          {!props.cardProps && !isNoAccessShown && showAs === ShowAs.List ? (
            getList()
          ) : (
            <></>
          )}
        </div>
      );
    }

    return <></>;
  };

  return (
    <>
      <div className="">{getCardComponent()}</div>

      {showModel ? (
        props.callbacks.showCreateEditModal({
          onClose: () => {
            setShowModal(false);

            if (modalType === ModalType.Create) {
              takeCreateFormOffAddress();
            }
          },
          modalType: modalType,
          editFormTitle:
            modalType === ModalType.Edit &&
            currentEditableItem &&
            props.editFormTitle
              ? props.editFormTitle(currentEditableItem) || undefined
              : undefined,
          onBeforeCreate: async (
            item: TBaseModel,
            miscDataProps: JSONObject,
            formValues: JSONObject,
          ) => {
            if (props.onBeforeCreate) {
              item = await props.onBeforeCreate(
                item,
                miscDataProps,
                formValues,
              );
            }

            return item;
          },
          onBeforeUpdate: props.onBeforeUpdate,
          onSuccess: async (item: TBaseModel): Promise<void> => {
            setShowModal(false);

            /*
             * Before anything opens the new record's page: Back from it
             * comes to the list, not to its create form.
             */
            if (modalType === ModalType.Create) {
              takeCreateFormOffAddress();
            }

            // Said as the dialog closes, before the list reads again.
            if (modalType === ModalType.Edit) {
              if (!props.hideChangeToasts) {
                Toast.success(
                  translator.translateText(CHANGES_SAVED) || CHANGES_SAVED,
                );
              }
            } else {
              sayItemChanged(getItemCreatedTemplate(props.createVerb), item);
            }

            setCurrentPageNumber(1);
            // Created or changed: the counts beside the list follow.
            refreshSideMenuCounts();
            await fetchItems();
            if (props.onCreateSuccess) {
              await props.onCreateSuccess(item, modalType);
            }

            return Promise.resolve();
          },
          /*
           * Gated on the modal type, not on currentEditableItem alone. The Edit
           * row action is the only thing that ever sets that state and nothing
           * clears it - not onClose above, not any of the three Create entry
           * points - so after one edit it stays populated for the life of the
           * table. Passing it into a Create handed ModelTable an id that made
           * its form filter treat the create form as an edit form, which
           * dropped every doNotShowWhenEditing field: on Runbook Secrets,
           * Monitor Secrets and the Security Events connectors, creating a
           * second row after editing one offered a form with no secret field
           * on it and failed at submit on a required column the user was never
           * shown.
           */
          modelIdToEdit:
            modalType === ModalType.Edit && currentEditableItem
              ? new ObjectID(getRecordIdText(currentEditableItem["_id"]))
              : undefined,
          existingItems: modalType === ModalType.Create ? data : undefined,
        })
      ) : (
        <></>
      )}

      {showDeleteConfirmModal && (
        <ConfirmModal
          isLoading={isDeleteAlternativeRunning}
          error={deleteAlternativeError || undefined}
          title={
            deleteConfirmation?.title
              ? translator.translateText(deleteConfirmation.title) ||
                deleteConfirmation.title
              : translateNamedAction(translator, {
                  template: "Delete {{itemName}}",
                  itemName: getDeleteLabel(
                    props.singularName,
                    model.singularName,
                  ),
                })
          }
          isTitleTranslated={true}
          description={
            isDeleteConfirmationLoading ? (
              <InlineLoadingLine
                text={DELETE_CONFIRMATION_LOADING}
                dataTestId="delete-confirmation-loading"
              />
            ) : (
              <>
                {deleteConfirmation?.description || (
                  <DeleteConfirmationMessage
                    kind="question"
                    name={getItemLabel(currentDeleteableItem)}
                    typeLabel={getDeleteLabel(
                      props.singularName,
                      model.singularName,
                    )}
                    /*
                     * What goes with it, as the bulk Delete and the record's
                     * own Delete page say it.
                     */
                    warning={getDeleteWarning(props.deleteConfirmationWarning)}
                  />
                )}
                {deleteConfirmation?.details ? (
                  <div
                    className="mt-3"
                    data-testid="delete-confirmation-details"
                  >
                    {deleteConfirmation.details}
                  </div>
                ) : (
                  <></>
                )}
              </>
            )
          }
          disableSubmitButton={isDeleteConfirmationLoading}
          /*
           * A delete that cannot go through, with nothing to offer instead,
           * is a notice: its one button closes it.
           */
          onClose={
            deleteConfirmation?.isDeleteBlocked &&
            !deleteConfirmation.alternative &&
            !isDeleteConfirmationLoading
              ? undefined
              : closeDeleteConfirmModal
          }
          submitButtonText={
            deleteConfirmation?.isDeleteBlocked
              ? deleteConfirmation.alternative?.title || "Close"
              : deleteConfirmation?.submitButtonText || "Delete"
          }
          onSubmit={async () => {
            // Nothing to do until it knows what the delete would change.
            if (isDeleteConfirmationLoading) {
              return;
            }

            if (deleteConfirmation?.isDeleteBlocked) {
              if (deleteConfirmation.alternative) {
                await runDeleteAlternative(deleteConfirmation.alternative);
              } else {
                closeDeleteConfirmModal();
              }

              return;
            }

            if (currentDeleteableItem && currentDeleteableItem["_id"]) {
              await deleteItem(
                currentDeleteableItem,
                deleteConfirmation?.getMiscDataProps?.(),
              );
              setShowDeleteConfirmModal(false);
            }
          }}
          submitButtonType={
            deleteConfirmation?.isDeleteBlocked
              ? deleteConfirmation.alternative
                ? ButtonStyleType.PRIMARY
                : ButtonStyleType.NORMAL
              : ButtonStyleType.DANGER
          }
          secondaryButton={
            !isDeleteConfirmationLoading &&
            deleteConfirmation?.alternative &&
            !deleteConfirmation.isDeleteBlocked
              ? {
                  title: deleteConfirmation.alternative.title,
                  dataTestId: "delete-confirmation-alternative",
                  disabled: isDeleteAlternativeRunning,
                  onClick: () => {
                    if (deleteConfirmation.alternative) {
                      void runDeleteAlternative(deleteConfirmation.alternative);
                    }
                  },
                }
              : undefined
          }
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

      {viewId !== null && (
        /*
         * The shared Show ID dialog: the ID on a row of its own with a copy
         * button, and "Go to API Docs" only where the API Reference has a
         * page for this model.
         */
        <RecordIdModal
          recordId={viewId}
          itemName={props.singularName || model.singularName || ""}
          apiReferencePagePath={getApiReferencePagePath(model, {
            isBillingEnabled: BILLING_ENABLED,
          })}
          onClose={() => {
            setViewId(null);
          }}
        />
      )}

      {showHelpModal && props.helpContent && (
        <HelpModal
          title={props.helpContent.title}
          description={props.helpContent.description}
          markdown={props.helpContent.markdown}
          documentationLink={props.documentationLink}
          onClose={() => {
            setShowHelpModal(false);
          }}
        />
      )}

      {getColumnCustomizationModal()}
    </>
  );
};

export default BaseModelTable;
