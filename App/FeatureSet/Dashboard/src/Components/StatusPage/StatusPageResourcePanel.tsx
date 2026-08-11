import MonitorElement from "../Monitor/Monitor";
import MonitorGroupElement from "../MonitorGroup/MonitorGroupElement";
import BulkAddStatusPageMonitorsModal from "./BulkAddStatusPageMonitorsModal";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import ResourceGrid from "Common/UI/Components/StatusPage/ResourceGrid";
import ResourceList from "Common/UI/Components/StatusPage/ResourceList";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageResourceExplorerUtil, {
  StatusPageResourceBreadcrumbStep,
  StatusPageResourceSelection,
  StatusPageResourceSelectionType,
} from "Common/Utils/StatusPage/ResourceExplorer";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  statusPageId: ObjectID;
  projectId: ObjectID;

  /* Which group's resources this pane is showing. */
  selection: StatusPageResourceSelection;
  /* Undefined for the ungrouped bucket. */
  statusPageGroup?: StatusPageGroup | undefined;
  /* Where that group sits, root first. Empty for a top level group. */
  breadcrumbSteps: Array<StatusPageResourceBreadcrumbStep>;
  onBreadcrumbClick: (statusPageGroupId: string) => void;
  /*
   * The groups sitting directly inside the selected one. The pane lists a
   * group's own resources and not its sub groups', so these are what stop the
   * list from reading as everything the group contains - and they are drawn as
   * a way down into each of them, because "which of my sub groups still needs
   * monitors" is the next question after "what is in this one".
   */
  subGroups: Array<StatusPageGroup>;
  onSelectGroup: (statusPageGroupId: string) => void;

  hasGroups: boolean;
  isMonitorGroupsFeatureEnabled: boolean;

  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;

  /*
   * Managing the group itself, which used to live on a page of its own. The
   * pane names exactly one group, so it is also the obvious place to act on it.
   */
  canCreateGroup: boolean;
  canEditGroup: boolean;
  canDeleteGroup: boolean;
  onCreateGroup: () => void;
  onEditGroup: () => void;
  onAddSubGroup: () => void;
  onDeleteGroup: () => void;
  /*
   * Whether the selected group has a sibling to swap places with. The tree's
   * own row actions are revealed by hover, and a touch screen has no hover - so
   * this pane has to carry everything a group can be told to do, not only the
   * things that were convenient to put here.
   */
  canMoveGroupUp: boolean;
  canMoveGroupDown: boolean;
  onMoveGroupUp: () => void;
  onMoveGroupDown: () => void;
  onShowGroupId: () => void;

  /* The resource form, minus anything a grid group adds to it. */
  baseFormFields: Array<ModelField<StatusPageResource>>;
  formSteps: Array<FormStep<StatusPageResource>>;

  /*
   * How many resources this selection turned out to hold, reported on every
   * fetch - which covers creating, deleting, bulk adding and refreshing,
   * because every one of those ends in a refetch.
   *
   * This is why the page never re-reads every resource on the status page after
   * a change: the group that changed reports its own new number, and that is
   * the only number that changed.
   */
  onResourceCountLoaded: (
    statusPageGroupId: string | null,
    count: number,
  ) => void;

  /* Shown on small screens, where the navigator and the pane cannot share. */
  onBack?: (() => void) | undefined;
}

/*
 * An overflow trigger is three dots and nothing else - no border, no fill, no
 * shadow. A bordered pill beside a primary button reads as a second button
 * whose label failed to load; the dots read as "there is more here", which is
 * what they are for. The square is only there to give the glyph a hit target
 * and somewhere for the hover and focus states to land.
 */
const MENU_TRIGGER_CLASS_NAME: string =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

/*
 * The right hand side of the Resources explorer: everything in one group, and
 * every way to change it.
 *
 * One header, one toolbar, one list. The old tab put a whole ModelTable - card,
 * title, description, create button, overflow menu, checkbox column, pagination
 * footer - inside a row of a tree of groups, which meant an operator opening
 * three groups was looking at three competing frames, each announcing itself
 * again. Here the group is named once, at the top, and everything below it is
 * the group's contents.
 */
const StatusPageResourcePanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const statusPageGroupId: ObjectID | null = props.selection.statusPageGroupId
    ? new ObjectID(props.selection.statusPageGroupId)
    : null;

  const selectionKey: string =
    props.selection.type === StatusPageResourceSelectionType.Ungrouped
      ? "ungrouped"
      : props.selection.statusPageGroupId || "";

  const isGrid: boolean =
    props.statusPageGroup?.viewMode === StatusPageGroupViewMode.Grid;

  /*
   * The ungrouped bucket is a real place on a status page but not a group, so
   * nothing that acts on a group is offered while it is what the pane is
   * showing.
   */
  const isGroupSelected: boolean =
    props.selection.type === StatusPageResourceSelectionType.Group &&
    Boolean(props.statusPageGroup);

  const [statusPageResources, setStatusPageResources] = useState<
    Array<StatusPageResource>
  >([]);
  /*
   * What the server said the group holds, which is not always how many rows
   * came back - the request is capped, and a group past the cap has to say so
   * rather than quietly show a prefix of itself.
   */
  const [totalResourceCount, setTotalResourceCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [searchText, setSearchText] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState<number>(
    StatusPageResourceExplorerUtil.ResourceRowsPerPage,
  );

  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [createCell, setCreateCell] = useState<{
    rowValue: string | null;
    columnValue: string | null;
  }>({ rowValue: null, columnValue: null });

  const [resourceIdToEdit, setResourceIdToEdit] = useState<ObjectID | null>(
    null,
  );
  const [resourceToDelete, setResourceToDelete] =
    useState<StatusPageResource | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");
  const [resourceToShowIdFor, setResourceToShowIdFor] =
    useState<StatusPageResource | null>(null);

  const [isBulkAddModalOpen, setIsBulkAddModalOpen] = useState<boolean>(false);

  /* The row whose reorder is in flight. See onReorder. */
  const [busyResourceId, setBusyResourceId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>("");

  const rowValues: Array<string> = useMemo((): Array<string> => {
    return StatusPageResourceExplorerUtil.parseAxisValues(
      props.statusPageGroup?.rowAxisValues,
    );
  }, [props.statusPageGroup?.rowAxisValues]);

  const columnValues: Array<string> = useMemo((): Array<string> => {
    return StatusPageResourceExplorerUtil.parseAxisValues(
      props.statusPageGroup?.columnAxisValues,
    );
  }, [props.statusPageGroup?.columnAxisValues]);

  const rowLabel: string = props.statusPageGroup?.rowAxisLabel || "Row";
  const columnLabel: string =
    props.statusPageGroup?.columnAxisLabel || "Column";

  /*
   * A grid group with no axes has nowhere to put a resource: the public page
   * drops anything whose axis values are not among the group's own, so
   * creating one here would write a monitor that visitors never see. The
   * offer is withdrawn until the axes exist.
   */
  const canAddToSelection: boolean =
    props.canCreate &&
    (!isGrid || (rowValues.length > 0 && columnValues.length > 0));

  const fetchResources: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      /*
       * `null` is a legal value here - it is what selects the resources that
       * belong to no group at all, and the server turns it into `IS NULL`. The
       * query type only admits the column's own type, so the null has to be
       * asserted through it.
       */
      const groupIdForQuery: ObjectID = statusPageGroupId!;

      const listResult: ListResult<StatusPageResource> =
        await ModelAPI.getList<StatusPageResource>({
          modelType: StatusPageResource,
          query: {
            statusPageId: props.statusPageId,
            projectId: props.projectId,
            statusPageGroupId: groupIdForQuery,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            displayName: true,
            order: true,
            rowAxisValue: true,
            columnAxisValue: true,
            monitor: {
              _id: true,
              name: true,
              projectId: true,
            },
            monitorGroup: {
              _id: true,
              name: true,
              projectId: true,
            },
          },
          sort: {
            order: SortOrder.Ascending,
          },
          requestOptions: {},
        });

      setStatusPageResources(listResult.data);
      setTotalResourceCount(listResult.count);
      props.onResourceCountLoaded(
        props.selection.statusPageGroupId,
        listResult.count,
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const reload: VoidFunction = (): void => {
    fetchResources().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  };

  /*
   * One fetch per selection, and only for the selection. A hierarchy of any
   * size costs exactly this - which is the whole reason the tab is an explorer
   * rather than a tree of tables that each fetched on mount (issue #3042).
   */
  useEffect(() => {
    setSearchText("");
    setVisibleCount(StatusPageResourceExplorerUtil.ResourceRowsPerPage);
    setActionError("");
    reload();
  }, [selectionKey]);

  const filteredResources: Array<StatusPageResource> =
    useMemo((): Array<StatusPageResource> => {
      return StatusPageResourceExplorerUtil.filterResources({
        statusPageResources: statusPageResources,
        searchText: searchText,
      });
    }, [statusPageResources, searchText]);

  const isFiltering: boolean = searchText.trim().length > 0;

  /* ------------------------------------------------------------------ */
  /* Writes                                                              */
  /* ------------------------------------------------------------------ */

  type OnReorderFunction = (fromIndex: number, toIndex: number) => void;

  /*
   * A drag (or a "move up") writes the order of whichever resource is standing
   * in the destination, and the server renumbers the rest of the group around
   * it. The list is re-drawn in its new order straight away so the row stays
   * where it was dropped, and the refetch afterwards is what makes that
   * optimism true or takes it back.
   */
  const onReorder: OnReorderFunction = (
    fromIndex: number,
    toIndex: number,
  ): void => {
    const moved: StatusPageResource | undefined =
      statusPageResources[fromIndex];

    const targetOrder: number | null =
      StatusPageResourceExplorerUtil.getReorderTargetOrder({
        statusPageResources: statusPageResources,
        fromIndex: fromIndex,
        toIndex: toIndex,
      });

    if (!moved || !moved.id || targetOrder === null) {
      return;
    }

    const previousResources: Array<StatusPageResource> = statusPageResources;

    setStatusPageResources(
      StatusPageResourceExplorerUtil.getResourcesInNewOrder({
        statusPageResources: statusPageResources,
        fromIndex: fromIndex,
        toIndex: toIndex,
      }),
    );
    setBusyResourceId(moved.id.toString());
    setActionError("");

    ModelAPI.updateById<StatusPageResource>({
      modelType: StatusPageResource,
      id: moved.id,
      data: {
        order: targetOrder,
      },
    })
      .then(() => {
        setBusyResourceId(null);
        reload();
      })
      .catch((err: Error) => {
        setStatusPageResources(previousResources);
        setBusyResourceId(null);
        setActionError(API.getFriendlyMessage(err));
      });
  };

  const deleteResource: PromiseVoidFunction = async (): Promise<void> => {
    if (!resourceToDelete || !resourceToDelete.id) {
      return;
    }

    setIsDeleting(true);
    setDeleteError("");

    try {
      await ModelAPI.deleteItem<StatusPageResource>({
        modelType: StatusPageResource,
        id: resourceToDelete.id,
      });

      setResourceToDelete(null);
      await fetchResources();
    } catch (err) {
      setDeleteError(API.getFriendlyMessage(err));
    }

    setIsDeleting(false);
  };

  type OnBeforeCreateFunction = (
    item: StatusPageResource,
  ) => Promise<StatusPageResource>;

  const onBeforeCreate: OnBeforeCreateFunction = (
    item: StatusPageResource,
  ): Promise<StatusPageResource> => {
    if (!props.projectId) {
      throw new BadDataException("Project ID cannot be null");
    }

    item.statusPageId = props.statusPageId;
    item.projectId = props.projectId;

    if (statusPageGroupId) {
      item.statusPageGroupId = statusPageGroupId;
    }

    return Promise.resolve(item);
  };

  /* ------------------------------------------------------------------ */
  /* The form                                                            */
  /* ------------------------------------------------------------------ */

  /*
   * A grid group's resources need a cell to live in, so its form asks for one.
   * Everything else about the form is the same wherever it is opened from.
   */
  const formFields: Array<ModelField<StatusPageResource>> = useMemo((): Array<
    ModelField<StatusPageResource>
  > => {
    if (!isGrid) {
      return props.baseFormFields;
    }

    type ToOptionsFunction = (
      values: Array<string>,
    ) => Array<{ label: string; value: string }>;

    const toOptions: ToOptionsFunction = (
      values: Array<string>,
    ): Array<{ label: string; value: string }> => {
      return values.map((value: string) => {
        return { label: value, value: value };
      });
    };

    return [
      ...props.baseFormFields,
      {
        field: {
          rowAxisValue: true,
        },
        title: `${rowLabel} (Row)`,
        description: "Row this resource belongs to in the grid.",
        fieldType:
          rowValues.length > 0
            ? FormFieldSchemaType.Dropdown
            : FormFieldSchemaType.Text,
        dropdownOptions:
          rowValues.length > 0 ? toOptions(rowValues) : undefined,
        required: true,
        placeholder:
          rowValues.length > 0
            ? `Select ${rowLabel.toLowerCase()}`
            : "Define rows on the group first",
        stepId: "monitor-details",
      },
      {
        field: {
          columnAxisValue: true,
        },
        title: `${columnLabel} (Column)`,
        description: "Column this resource belongs to in the grid.",
        fieldType:
          columnValues.length > 0
            ? FormFieldSchemaType.Dropdown
            : FormFieldSchemaType.Text,
        dropdownOptions:
          columnValues.length > 0 ? toOptions(columnValues) : undefined,
        required: true,
        placeholder:
          columnValues.length > 0
            ? `Select ${columnLabel.toLowerCase()}`
            : "Define columns on the group first",
        stepId: "monitor-details",
      },
    ];
  }, [
    props.baseFormFields,
    isGrid,
    rowValues,
    columnValues,
    rowLabel,
    columnLabel,
  ]);

  const initialValuesForCreate: FormValues<StatusPageResource> =
    useMemo((): FormValues<StatusPageResource> => {
      const values: FormValues<StatusPageResource> =
        {} as FormValues<StatusPageResource>;

      if (createCell.rowValue) {
        (values as Record<string, unknown>)["rowAxisValue"] =
          createCell.rowValue;
      }

      if (createCell.columnValue) {
        (values as Record<string, unknown>)["columnAxisValue"] =
          createCell.columnValue;
      }

      return values;
    }, [createCell.rowValue, createCell.columnValue]);

  type OpenCreateFunction = (
    rowValue: string | null,
    columnValue: string | null,
  ) => void;

  const openCreate: OpenCreateFunction = (
    rowValue: string | null,
    columnValue: string | null,
  ): void => {
    setCreateCell({ rowValue: rowValue, columnValue: columnValue });
    setIsCreateModalOpen(true);
  };

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  const title: string =
    props.selection.type === StatusPageResourceSelectionType.Ungrouped
      ? props.hasGroups
        ? "Top of page"
        : "All resources"
      : props.statusPageGroup?.name || "Untitled group";

  const titleIcon: IconProp =
    props.selection.type === StatusPageResourceSelectionType.Ungrouped
      ? IconProp.List
      : isGrid
        ? IconProp.Grid
        : IconProp.Folder;

  type GetResourceElementFunction = (
    statusPageResource: StatusPageResource,
  ) => ReactElement;

  const getResourceElement: GetResourceElementFunction = (
    statusPageResource: StatusPageResource,
  ): ReactElement => {
    if (statusPageResource.monitor) {
      return (
        <MonitorElement
          monitor={statusPageResource.monitor}
          showIcon={props.isMonitorGroupsFeatureEnabled}
        />
      );
    }

    if (statusPageResource.monitorGroup) {
      return (
        <MonitorGroupElement
          monitorGroup={statusPageResource.monitorGroup}
          showIcon={props.isMonitorGroupsFeatureEnabled}
        />
      );
    }

    /*
     * A resource whose monitor was deleted still has to be identifiable - its
     * display name is the only handle left on it, and this row exists to be
     * acted on.
     */
    return (
      <span className="text-gray-500">
        {statusPageResource.displayName || "Unknown resource"}
      </span>
    );
  };

  type GetChipsFunction = () => ReactElement;

  /*
   * The handful of group settings that change what a visitor sees. They live on
   * the group form, three steps deep, and an operator looking at a group has no
   * other way of knowing that this one is published collapsed or with an uptime
   * figure beside it.
   */
  const getChips: GetChipsFunction = (): ReactElement => {
    if (!isGroupSelected) {
      return <></>;
    }

    const chips: Array<ReactElement> = [];

    if (isGrid) {
      chips.push(
        <span
          key="grid"
          className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600"
          data-testid="status-page-resource-panel-grid-badge"
        >
          Grid
        </span>,
      );
    }

    if (props.statusPageGroup?.isExpandedByDefault === false) {
      chips.push(
        <span
          key="collapsed-by-default"
          className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500"
          title="This group starts collapsed on the public status page."
          data-testid="status-page-resource-panel-collapsed-by-default"
        >
          Collapsed by default
        </span>,
      );
    }

    if (props.statusPageGroup?.showUptimePercent) {
      chips.push(
        <span
          key="uptime"
          className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500"
          title="Uptime percent is shown beside this group on the public status page."
          data-testid="status-page-resource-panel-uptime"
        >
          Uptime %
        </span>,
      );
    }

    if (chips.length === 0) {
      return <></>;
    }

    return <Fragment>{chips}</Fragment>;
  };

  type GetMoreMenuItemsFunction = () => Array<ReactElement>;

  /*
   * Everything that acts on the group this pane is showing, plus the refresh.
   * Groups used to be edited on a page of their own; the pane names exactly one
   * group, so this menu is where that page's per-group actions landed.
   */
  const getMoreMenuItems: GetMoreMenuItemsFunction =
    (): Array<ReactElement> => {
      const items: Array<ReactElement> = [];

      /*
       * Adding one monitor is the thing an operator does over and over, so it
       * keeps the button. Adding a screenful at once is a setup move made a
       * handful of times per status page, and a second button beside the first
       * spent a permanent slot in the header on it.
       */
      if (canAddToSelection) {
        items.push(
          <MoreMenuItem
            key="bulk-add"
            text="Add multiple monitors"
            icon={IconProp.Add}
            onClick={() => {
              setIsBulkAddModalOpen(true);
            }}
          />,
        );
      }

      if (isGroupSelected && props.canEditGroup) {
        items.push(
          <MoreMenuItem
            key="edit-group"
            text="Edit this group"
            icon={IconProp.Edit}
            onClick={props.onEditGroup}
          />,
        );
      }

      if (props.canCreateGroup) {
        items.push(
          isGroupSelected ? (
            <MoreMenuItem
              key="add-sub-group"
              text="Add a sub group"
              icon={IconProp.FolderPlus}
              onClick={props.onAddSubGroup}
            />
          ) : (
            <MoreMenuItem
              key="create-group"
              text="Create a group"
              icon={IconProp.FolderPlus}
              onClick={props.onCreateGroup}
            />
          ),
        );
      }

      /*
       * The tree's own row actions are revealed by hover, and a touch screen
       * has no hover - so everything a group can be told to do has to be here
       * too, not only the things that were convenient to put here.
       */
      if (isGroupSelected && props.canEditGroup) {
        items.push(
          <MoreMenuItem
            key="move-group-up"
            text="Move group up"
            icon={IconProp.ArrowUp}
            isDisabled={!props.canMoveGroupUp}
            onClick={props.onMoveGroupUp}
          />,
          <MoreMenuItem
            key="move-group-down"
            text="Move group down"
            icon={IconProp.ArrowDown}
            isDisabled={!props.canMoveGroupDown}
            onClick={props.onMoveGroupDown}
          />,
        );
      }

      if (isGroupSelected) {
        items.push(
          <MoreMenuItem
            key="show-group-id"
            text="Show group ID"
            icon={IconProp.Info}
            onClick={props.onShowGroupId}
          />,
        );
      }

      items.push(
        <MoreMenuItem
          key="refresh"
          text="Refresh"
          icon={IconProp.Refresh}
          onClick={reload}
        />,
      );

      if (isGroupSelected && props.canDeleteGroup) {
        items.push(
          <MoreMenuItem
            key="delete-group"
            text="Delete this group"
            icon={IconProp.Trash}
            className="text-red-600 enabled:hover:bg-red-50 enabled:hover:text-red-700"
            iconClassName="text-red-400 group-hover:text-red-500"
            onClick={props.onDeleteGroup}
          />,
        );
      }

      return items;
    };

  type GetHeaderFunction = () => ReactElement;

  const getHeader: GetHeaderFunction = (): ReactElement => {
    /*
     * What the pane holds, then where the rest of the group's monitors are.
     * A selected group shows its own resources only - the ones in its sub
     * groups are edited by selecting those - so a group with sub groups has to
     * say so, or its list looks like the whole of it.
     */
    const subtitleParts: Array<string> = [];

    if (!isLoading) {
      subtitleParts.push(
        StatusPageResourceExplorerUtil.getResourceCountLabel({
          count: totalResourceCount,
        }),
      );
    }

    const subGroupCountLabel: string | null =
      StatusPageResourceExplorerUtil.getSubGroupCountLabel({
        subGroupCount: props.subGroups.length,
      });

    if (subGroupCountLabel) {
      subtitleParts.push(subGroupCountLabel);
    }

    if (
      props.selection.type === StatusPageResourceSelectionType.Ungrouped &&
      props.hasGroups
    ) {
      subtitleParts.push("visitors see these first, above every group");
    }

    return (
      <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {props.onBack ? (
            <button
              type="button"
              className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 lg:hidden"
              data-testid="status-page-resource-panel-back"
              onClick={props.onBack}
            >
              <Icon icon={IconProp.ChevronLeft} className="h-3.5 w-3.5" />
              All groups
            </button>
          ) : (
            <></>
          )}

          <div className="flex min-w-0 items-start gap-3">
            {/*
             * Which kind of place this is, in a glyph: the ungrouped bucket, a
             * plain group, or one laid out as a grid. It is the same icon the
             * navigator draws beside the row that was clicked, so the two
             * halves of the screen visibly agree about where the operator is.
             */}
            <span
              className="mt-0.5 hidden h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 sm:flex"
              aria-hidden="true"
            >
              <Icon icon={titleIcon} className="h-5 w-5" />
            </span>

            <div className="min-w-0">
              {/*
               * Where the group sits, above its name and indented to line up
               * with it - a path reads as a path when it is over the thing it
               * leads to, not out in the margin beside its icon.
               */}
              {props.breadcrumbSteps.length > 0 ? (
                <nav
                  className="mb-0.5 flex min-w-0 flex-wrap items-center gap-1 text-xs text-gray-400"
                  aria-label="Group path"
                  data-testid="status-page-resource-panel-breadcrumb"
                >
                  {props.breadcrumbSteps.map(
                    (step: StatusPageResourceBreadcrumbStep, index: number) => {
                      return (
                        <Fragment key={step.id}>
                          {index > 0 ? (
                            <span aria-hidden="true">›</span>
                          ) : (
                            <></>
                          )}
                          <button
                            type="button"
                            className="max-w-[12rem] truncate rounded hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                            data-testid="status-page-resource-panel-breadcrumb-step"
                            onClick={() => {
                              props.onBreadcrumbClick(step.id);
                            }}
                          >
                            {step.name}
                          </button>
                        </Fragment>
                      );
                    },
                  )}
                  <span aria-hidden="true">›</span>
                </nav>
              ) : (
                <></>
              )}

              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2
                  className="truncate text-lg font-semibold text-gray-900"
                  data-testid="status-page-resource-panel-title"
                  title={title}
                >
                  {title}
                </h2>

                {getChips()}
              </div>

              <p
                className="mt-1 text-sm text-gray-500"
                data-testid="status-page-resource-panel-subtitle"
              >
                {subtitleParts.join(" · ")}
              </p>

              {isGroupSelected && props.statusPageGroup?.description ? (
                <p
                  className="mt-1 max-w-2xl text-sm text-gray-500"
                  data-testid="status-page-resource-panel-description"
                >
                  {props.statusPageGroup.description}
                </p>
              ) : (
                <></>
              )}
            </div>
          </div>
        </div>

        {/*
         * The buttons are the modal-footer variety - full width until md, so a
         * dialog stacks them - and this is a toolbar, where two of them stacked
         * across the pane is not a toolbar at all.
         */}
        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 [&_button]:w-auto [&_button]:md:ml-0">
          {/*
           * Editing the group is the second thing anybody does to it, after
           * putting monitors in it - everything a visitor sees about a group
           * other than its monitors is behind this one button. It used to be a
           * line in the overflow menu, beside "Delete this group"; it is still
           * there, for the same reason every other group action is, but it does
           * not have to be found to be used.
           */}
          {isGroupSelected && props.canEditGroup ? (
            <Button
              title="Edit Group"
              icon={IconProp.Edit}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.NORMAL}
              dataTestId="status-page-resource-panel-edit-group"
              onClick={props.onEditGroup}
            />
          ) : (
            <></>
          )}

          {canAddToSelection ? (
            <Fragment>
              <Button
                title="Add Monitor"
                icon={IconProp.Add}
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.PRIMARY}
                dataTestId="status-page-resource-panel-add"
                onClick={() => {
                  openCreate(null, null);
                }}
              />
            </Fragment>
          ) : (
            <></>
          )}

          <MoreMenu
            text="More actions"
            menuIcon={IconProp.EllipsisHorizontal}
            ariaLabel="More actions"
            elementToBeShownInsteadOfButton={
              <button
                type="button"
                aria-label="More actions"
                data-testid="status-page-resource-panel-more"
                className={MENU_TRIGGER_CLASS_NAME}
              >
                <Icon icon={IconProp.EllipsisHorizontal} className="h-5 w-5" />
              </button>
            }
          >
            {getMoreMenuItems()}
          </MoreMenu>
        </div>
      </div>
    );
  };

  type GetSubGroupsFunction = () => ReactElement;

  /*
   * A way down into each sub group without going back to the navigator, and -
   * more importantly - a visible answer to "where are the rest of this group's
   * monitors?" for anyone who reads the list below as the whole of it.
   */
  const getSubGroups: GetSubGroupsFunction = (): ReactElement => {
    if (props.subGroups.length === 0) {
      return <></>;
    }

    return (
      <div
        className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5"
        data-testid="status-page-resource-panel-sub-groups"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Sub groups
        </p>
        <div className="flex flex-wrap gap-1.5">
          {props.subGroups.map((subGroup: StatusPageGroup) => {
            const subGroupId: string = subGroup._id?.toString() || "";

            return (
              <button
                key={subGroupId}
                type="button"
                data-testid="status-page-resource-panel-sub-group"
                className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                onClick={() => {
                  props.onSelectGroup(subGroupId);
                }}
              >
                <Icon
                  icon={
                    subGroup.viewMode === StatusPageGroupViewMode.Grid
                      ? IconProp.Grid
                      : IconProp.Folder
                  }
                  className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                />
                <span className="truncate">
                  {subGroup.name || "Untitled group"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  type GetGridSetupNoticeFunction = () => ReactElement;

  /*
   * A grid group with no axes has nowhere to put a resource, so the add button
   * is withdrawn - which on its own reads as a broken page. This says why, and
   * hands over the one control that fixes it.
   */
  const getGridSetupNotice: GetGridSetupNoticeFunction = (): ReactElement => {
    if (!isGrid || (rowValues.length > 0 && columnValues.length > 0)) {
      return <></>;
    }

    return (
      <div
        className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
        data-testid="status-page-resource-panel-grid-setup"
      >
        <p className="text-xs font-medium text-amber-900">
          This group is laid out as a grid, but it has no{" "}
          {rowValues.length === 0 && columnValues.length === 0
            ? "rows or columns"
            : rowValues.length === 0
              ? "rows"
              : "columns"}{" "}
          yet.
        </p>
        <p className="mt-0.5 text-xs text-amber-800">
          Monitors are placed in a cell of the grid, so there is nowhere to put
          one until the axes exist.
        </p>

        {props.canEditGroup ? (
          <div className="mt-2 [&_button]:md:ml-0">
            <Button
              title="Set up the grid"
              icon={IconProp.Settings}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.NORMAL}
              dataTestId="status-page-resource-panel-grid-setup-edit"
              onClick={props.onEditGroup}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  type GetSearchFunction = () => ReactElement;

  const getSearch: GetSearchFunction = (): ReactElement => {
    if (statusPageResources.length === 0) {
      return <></>;
    }

    return (
      <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <Input
            type={InputType.TEXT}
            placeholder={`Search in ${title}...`}
            value={searchText}
            dataTestId="status-page-resource-panel-search"
            outerDivClassName="relative w-full"
            className="block w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onChange={(value: string) => {
              setSearchText(value);
            }}
          />
        </div>

        {isFiltering ? (
          <span
            className="text-xs text-gray-500 tabular-nums"
            role="status"
            data-testid="status-page-resource-panel-filter-count"
          >
            {filteredResources.length.toLocaleString()} of{" "}
            {statusPageResources.length.toLocaleString()} shown
            {/*
             * Said only where it is true. A filtered list's neighbours are not
             * the real neighbours, so the reorder is withheld rather than
             * allowed to write the wrong order.
             */}
            {props.canEdit && !isGrid
              ? " · drag to reorder is off while filtering"
              : ""}
          </span>
        ) : (
          <>
            {/*
             * The order is the order visitors see, and a grip on a row is not
             * much of a sentence. Said once, beside the list, and only where a
             * drag would actually do something.
             */}
            {props.canEdit && !isGrid && filteredResources.length > 1 ? (
              <span
                className="hidden text-xs text-gray-400 sm:inline"
                data-testid="status-page-resource-panel-reorder-hint"
              >
                Drag a row to change the order visitors see
              </span>
            ) : (
              <></>
            )}
          </>
        )}
      </div>
    );
  };

  type GetEmptyStateFunction = () => ReactElement;

  /*
   * Written out rather than handed to EmptyState, which pads itself by 13rem
   * top and bottom for a page it owns the whole of. Inside a pane it left a
   * hole the height of a screen, and the page had been pulling it back with
   * negative margins deeper than the padding it was cancelling.
   */
  const getEmptyState: GetEmptyStateFunction = (): ReactElement => {
    const isNoMatch: boolean = isFiltering;

    return (
      <div
        id={
          isNoMatch
            ? "status-page-resources-no-match"
            : "status-page-resources-empty"
        }
        className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center"
        data-testid="status-page-resource-panel-empty"
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-400 shadow-sm">
          <Icon
            icon={isNoMatch ? IconProp.Search : IconProp.Add}
            className="h-6 w-6"
          />
        </span>

        <h3 className="mt-4 text-sm font-semibold text-gray-900">
          {isNoMatch
            ? "No resources match your search"
            : "No monitors here yet"}
        </h3>

        <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
          {isNoMatch
            ? `Nothing in ${title} matches “${searchText}”.`
            : canAddToSelection
              ? `Add a monitor to ${title} and visitors will see its status here.`
              : `Nothing has been added to ${title} yet.`}
        </p>

        {isNoMatch ? (
          <></>
        ) : (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 [&_button]:md:ml-0">
            {canAddToSelection ? (
              <Button
                title="Add Monitor"
                icon={IconProp.Add}
                buttonStyle={ButtonStyleType.PRIMARY}
                dataTestId="status-page-resource-panel-empty-add"
                onClick={() => {
                  openCreate(null, null);
                }}
              />
            ) : (
              <></>
            )}

            {/*
             * Adding a screenful at once is a setup move, and an empty group is
             * exactly when it is worth making: it is otherwise only reachable
             * from the overflow menu.
             */}
            {canAddToSelection ? (
              <Button
                title="Add Multiple"
                icon={IconProp.List}
                buttonStyle={ButtonStyleType.NORMAL}
                dataTestId="status-page-resource-panel-empty-bulk-add"
                onClick={() => {
                  setIsBulkAddModalOpen(true);
                }}
              />
            ) : (
              <></>
            )}

            {/*
             * Only where a group is the obvious next thing: a status page
             * with nothing on it yet. Offering it beside every empty group
             * would be suggesting more structure to somebody who has not
             * filled the structure they have.
             */}
            {props.canCreateGroup && !props.hasGroups ? (
              <Button
                title="Create a Group"
                icon={IconProp.FolderPlus}
                buttonStyle={ButtonStyleType.NORMAL}
                dataTestId="status-page-resource-panel-empty-create-group"
                onClick={props.onCreateGroup}
              />
            ) : (
              <></>
            )}
          </div>
        )}
      </div>
    );
  };

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage message={error} onRefreshClick={reload} />;
    }

    if (isGrid) {
      return (
        <ResourceGrid
          rowLabel={rowLabel}
          columnLabel={columnLabel}
          rowValues={rowValues}
          columnValues={columnValues}
          statusPageResources={filteredResources}
          getResourceElement={getResourceElement}
          isCreateable={canAddToSelection}
          isEditable={props.canEdit}
          isDeleteable={props.canDelete}
          onAddToCell={openCreate}
          onEdit={(statusPageResource: StatusPageResource) => {
            setResourceIdToEdit(statusPageResource.id || null);
          }}
          onDelete={(statusPageResource: StatusPageResource) => {
            setDeleteError("");
            setResourceToDelete(statusPageResource);
          }}
        />
      );
    }

    return (
      <ResourceList
        statusPageResources={filteredResources}
        listKey={selectionKey}
        getResourceElement={getResourceElement}
        isEditable={props.canEdit}
        isDeleteable={props.canDelete}
        isReorderable={props.canEdit && !isFiltering}
        busyResourceId={busyResourceId}
        visibleCount={visibleCount}
        onShowMore={() => {
          setVisibleCount(
            visibleCount + StatusPageResourceExplorerUtil.ResourceRowsPerPage,
          );
        }}
        onEdit={(statusPageResource: StatusPageResource) => {
          setResourceIdToEdit(statusPageResource.id || null);
        }}
        onDelete={(statusPageResource: StatusPageResource) => {
          setDeleteError("");
          setResourceToDelete(statusPageResource);
        }}
        onShowId={(statusPageResource: StatusPageResource) => {
          setResourceToShowIdFor(statusPageResource);
        }}
        onReorder={onReorder}
        emptyState={getEmptyState()}
      />
    );
  };

  return (
    <div data-testid="status-page-resource-panel" data-selection={selectionKey}>
      {getHeader()}
      {getGridSetupNotice()}
      {getSubGroups()}
      {getSearch()}
      {actionError ? <ErrorMessage message={actionError} /> : <></>}

      {/*
       * A group holding more resources than one request returns. Saying so is
       * the difference between a list that is short and a list that is lying:
       * the rows below are the first of them, and reordering across the ones
       * that are missing is not something this screen can do.
       */}
      {!isLoading && totalResourceCount > statusPageResources.length ? (
        <div
          className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          data-testid="status-page-resource-panel-truncated"
        >
          Showing the first {statusPageResources.length.toLocaleString()} of{" "}
          {totalResourceCount.toLocaleString()} resources in this group.
        </div>
      ) : (
        <></>
      )}

      {getBody()}

      {isCreateModalOpen ? (
        <ModelFormModal<StatusPageResource>
          modelType={StatusPageResource}
          name="Status Page > Resources"
          title={`Add a monitor to ${title}`}
          description="Pick the monitor visitors will see the status of here."
          modalWidth={ModalWidth.Medium}
          submitButtonText="Add Monitor"
          initialValues={initialValuesForCreate}
          onBeforeCreate={onBeforeCreate}
          formProps={{
            modelType: StatusPageResource,
            id: `create-status-page-resource-${selectionKey}`,
            fields: formFields,
            steps: props.formSteps,
            formType: FormType.Create,
          }}
          onClose={() => {
            setIsCreateModalOpen(false);
          }}
          onSuccess={() => {
            setIsCreateModalOpen(false);
            reload();
          }}
        />
      ) : (
        <></>
      )}

      {resourceIdToEdit ? (
        <ModelFormModal<StatusPageResource>
          modelType={StatusPageResource}
          name="Status Page > Resources"
          title="Edit resource"
          description="Update how this resource shows up on the status page."
          modalWidth={ModalWidth.Medium}
          modelIdToEdit={resourceIdToEdit}
          formProps={{
            modelType: StatusPageResource,
            id: `edit-status-page-resource-${selectionKey}`,
            fields: formFields,
            steps: props.formSteps,
            formType: FormType.Update,
          }}
          onClose={() => {
            setResourceIdToEdit(null);
          }}
          onSuccess={() => {
            setResourceIdToEdit(null);
            reload();
          }}
        />
      ) : (
        <></>
      )}

      {resourceToDelete ? (
        <ConfirmModal
          title="Remove resource from status page"
          description={`Are you sure you want to remove "${StatusPageResourceExplorerUtil.getResourceName(
            resourceToDelete,
          )}" from this status page? The monitor itself is not deleted.`}
          submitButtonText="Remove"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isDeleting}
          error={deleteError || undefined}
          onClose={() => {
            setResourceToDelete(null);
            setDeleteError("");
          }}
          onSubmit={() => {
            deleteResource().catch((err: Error) => {
              setDeleteError(API.getFriendlyMessage(err));
              setIsDeleting(false);
            });
          }}
        />
      ) : (
        <></>
      )}

      {resourceToShowIdFor ? (
        <ConfirmModal
          title={`${StatusPageResourceExplorerUtil.getResourceName(
            resourceToShowIdFor,
          )} ID`}
          description={`Status Page Resource ID: ${
            resourceToShowIdFor._id?.toString() || ""
          }`}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setResourceToShowIdFor(null);
          }}
        />
      ) : (
        <></>
      )}

      {isBulkAddModalOpen ? (
        <BulkAddStatusPageMonitorsModal
          projectId={props.projectId}
          statusPageId={props.statusPageId}
          statusPageGroupId={statusPageGroupId || undefined}
          gridPlacement={
            isGrid
              ? {
                  rowLabel: rowLabel,
                  rowValues: rowValues,
                  columnLabel: columnLabel,
                  columnValues: columnValues,
                }
              : undefined
          }
          onClose={() => {
            setIsBulkAddModalOpen(false);
          }}
          onComplete={() => {
            reload();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default StatusPageResourcePanel;
