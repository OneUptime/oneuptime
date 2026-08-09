import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import GroupHierarchy from "Common/UI/Components/StatusPage/GroupHierarchy";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import User from "Common/UI/Utils/User";
import Permission from "Common/Types/Permission";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupTreeUtil from "Common/Utils/StatusPage/GroupTree";
import StatusPageGroupHierarchyViewUtil, {
  StatusPageGroupHierarchyRow,
  StatusPageGroupHierarchySummary,
} from "Common/Utils/StatusPage/GroupHierarchyView";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ProjectUtil from "Common/UI/Utils/Project";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import AxisValuesInput from "../../../Components/StatusPage/AxisValuesInput";
import ImportGroupsFromCsvModal from "../../../Components/StatusPage/ImportGroupsFromCsvModal";

/*
 * Status Page > Groups.
 *
 * Groups nest, and everything the status page does with them - the rolled up
 * status, the rolled up uptime, what a visitor can collapse - follows the shape
 * of that nesting. This page used to be a flat ModelTable with a "Parent Group"
 * column, which could tell an operator that "Market 1001" sits under "Region
 * 1000" but never what the hierarchy they were building actually looked like:
 * the one question anybody has in front of a tree.
 *
 * So it draws the tree. The table's capabilities all survive - create, edit,
 * delete, reorder, CSV import, show ID - but they hang off rows in a hierarchy
 * rather than off rows in a list, and creating a sub group is now a thing you
 * do to a group rather than a parent you go and pick out of a dropdown.
 *
 * The shape of the tree, and every decision the rows are drawn from, lives in
 * StatusPageGroupHierarchyViewUtil so it can be tested without a renderer.
 */

/*
 * One level of children is open on arrival - enough to show that the hierarchy
 * nests without unfolding a thousand-group status page into an unreadable wall.
 */
const AUTO_EXPAND_DEPTH: number = 1;

enum GroupFormMode {
  Create = "Create",
  Edit = "Edit",
}

const StatusPageGroups: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [statusPageGroups, setStatusPageGroups] = useState<
    Array<StatusPageGroup>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Which groups are open. Held here rather than in the tree so that a refetch
   * - after a create, a move, an import - does not throw away what the operator
   * had unfolded.
   */
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    new Set<string>(),
  );
  const [hasAppliedDefaultExpansion, setHasAppliedDefaultExpansion] =
    useState<boolean>(false);

  const [searchText, setSearchText] = useState<string>("");

  const [showImportModal, setShowImportModal] = useState<boolean>(false);

  const [formMode, setFormMode] = useState<GroupFormMode | null>(null);
  const [groupIdToEdit, setGroupIdToEdit] = useState<ObjectID | null>(null);
  const [parentGroupIdForCreate, setParentGroupIdForCreate] = useState<
    string | null
  >(null);

  const [groupToDelete, setGroupToDelete] = useState<StatusPageGroup | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  const [groupToShowIdFor, setGroupToShowIdFor] =
    useState<StatusPageGroup | null>(null);

  /* The row whose reorder is in flight. See GroupHierarchy's busyGroupId. */
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>("");

  const permissions: Array<Permission> = PermissionUtil.getAllPermissions();
  const model: StatusPageGroup = new StatusPageGroup();

  const isMasterAdmin: boolean = User.isMasterAdmin();
  const canCreate: boolean =
    model.hasCreatePermissions(permissions) || isMasterAdmin;
  const canEdit: boolean =
    model.hasUpdatePermissions(permissions) || isMasterAdmin;
  const canDelete: boolean =
    model.hasDeletePermissions(permissions) || isMasterAdmin;

  const fetchGroups: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const listResult: ListResult<StatusPageGroup> =
        await ModelAPI.getList<StatusPageGroup>({
          modelType: StatusPageGroup,
          query: {
            statusPageId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            description: true,
            order: true,
            parentStatusPageGroupId: true,
            isExpandedByDefault: true,
            showCurrentStatus: true,
            showUptimePercent: true,
            viewMode: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          requestOptions: {},
        });

      setStatusPageGroups(listResult.data);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchGroups().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  /*
   * Keyed on "have we done this yet" rather than on the group list, so the
   * default expansion is applied to the first page of data that arrives and
   * never again - a refetch after a create must not re-collapse the branch the
   * operator was working in.
   */
  useEffect(() => {
    if (hasAppliedDefaultExpansion || statusPageGroups.length === 0) {
      return;
    }

    setExpandedGroupIds(
      StatusPageGroupHierarchyViewUtil.getDefaultExpandedGroupIds({
        statusPageGroups: statusPageGroups,
        maxAutoExpandDepth: AUTO_EXPAND_DEPTH,
      }),
    );
    setHasAppliedDefaultExpansion(true);
  }, [statusPageGroups, hasAppliedDefaultExpansion]);

  const rows: Array<StatusPageGroupHierarchyRow> =
    StatusPageGroupHierarchyViewUtil.getRows({
      statusPageGroups: statusPageGroups,
      expandedGroupIds: expandedGroupIds,
      searchText: searchText,
    });

  const summary: StatusPageGroupHierarchySummary =
    StatusPageGroupHierarchyViewUtil.getSummary({
      statusPageGroups: statusPageGroups,
    });

  /*
   * Whether "Expand All" still has anything to open. A status page with no
   * nesting at all, or one that is already fully unfolded, would otherwise
   * offer a button that does nothing when clicked.
   */
  const canExpandMore: boolean = Array.from(
    StatusPageGroupHierarchyViewUtil.getExpandableGroupIds({
      statusPageGroups: statusPageGroups,
    }),
  ).some((statusPageGroupId: string) => {
    return !expandedGroupIds.has(statusPageGroupId);
  });

  type ToggleExpandFunction = (statusPageGroupId: string) => void;

  const toggleExpand: ToggleExpandFunction = (
    statusPageGroupId: string,
  ): void => {
    setExpandedGroupIds((current: Set<string>) => {
      const next: Set<string> = new Set<string>(current);

      if (next.has(statusPageGroupId)) {
        next.delete(statusPageGroupId);
      } else {
        next.add(statusPageGroupId);
      }

      return next;
    });
  };

  const expandAll: VoidFunction = (): void => {
    setExpandedGroupIds(
      StatusPageGroupHierarchyViewUtil.getExpandableGroupIds({
        statusPageGroups: statusPageGroups,
      }),
    );
  };

  const collapseAll: VoidFunction = (): void => {
    setExpandedGroupIds(new Set<string>());
  };

  type MoveGroupFunction = (
    statusPageGroup: StatusPageGroup,
    direction: "up" | "down",
  ) => Promise<void>;

  /*
   * Reordering writes the neighbouring sibling's `order` onto this group and
   * lets StatusPageGroupService renumber everything between the two - the same
   * write the table's drag and drop used to make, and the only one the service
   * knows how to rebalance.
   */
  const moveGroup: MoveGroupFunction = async (
    statusPageGroup: StatusPageGroup,
    direction: "up" | "down",
  ): Promise<void> => {
    const statusPageGroupId: string = statusPageGroup._id?.toString() || "";

    const targetOrder: number | null =
      StatusPageGroupHierarchyViewUtil.getReorderTargetOrder({
        statusPageGroups: statusPageGroups,
        statusPageGroupId: statusPageGroupId,
        direction: direction,
      });

    if (targetOrder === null) {
      return;
    }

    setBusyGroupId(statusPageGroupId);
    setActionError("");

    try {
      await ModelAPI.updateById<StatusPageGroup>({
        modelType: StatusPageGroup,
        id: new ObjectID(statusPageGroupId),
        data: {
          order: targetOrder,
        },
      });

      await fetchGroups();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setBusyGroupId(null);
  };

  const deleteGroup: PromiseVoidFunction = async (): Promise<void> => {
    if (!groupToDelete || !groupToDelete.id) {
      return;
    }

    setIsDeleting(true);
    setDeleteError("");

    try {
      await ModelAPI.deleteItem<StatusPageGroup>({
        modelType: StatusPageGroup,
        id: groupToDelete.id,
      });

      setGroupToDelete(null);
      await fetchGroups();
    } catch (err) {
      setDeleteError(API.getFriendlyMessage(err));
    }

    setIsDeleting(false);
  };

  /*
   * The parent picker only offers groups the API would actually accept: not the
   * group itself, not one of its own sub groups, and not a group so deep that
   * the subtree being moved would not fit under it. StatusPageGroupService
   * still enforces all three - it is the only thing that sees the tree at write
   * time - so this is about not offering a choice that is already known to fail.
   */
  const getParentGroupOptions: () => Array<DropdownOption> =
    (): Array<DropdownOption> => {
      return StatusPageGroupHierarchyViewUtil.getParentGroupCandidates({
        statusPageGroups: statusPageGroups,
        statusPageGroupId: groupIdToEdit?.toString(),
      }).map((group: StatusPageGroup) => {
        return {
          value: group._id?.toString() || "",
          /*
           * Two groups can easily be called "Region 1000" at different levels,
           * so an option is only unambiguous with its whole path on it.
           */
          label: StatusPageGroupHierarchyViewUtil.getGroupPathLabel({
            statusPageGroup: group,
            statusPageGroups: statusPageGroups,
          }),
        };
      });
    };

  const getFormFields: () => Array<ModelField<StatusPageGroup>> = (): Array<
    ModelField<StatusPageGroup>
  > => {
    return [
      {
        field: {
          name: true,
        },
        title: "Group Name",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: "Resource Group Name",
        stepId: "group-details",
      },
      {
        field: {
          description: true,
        },
        title: "Group Description",
        fieldType: FormFieldSchemaType.Markdown,
        required: false,
        stepId: "group-details",
        description: MarkdownUtil.getMarkdownCheatsheet(
          "Describe the status page group here",
        ),
      },
      {
        field: {
          parentStatusPageGroup: true,
        },
        title: "Parent Group",
        description:
          "Nest this group inside another group on your status page (for example Corporate Units › Region › Market). Leave empty to keep it at the top level. Every level shows the rolled up status and uptime of everything beneath it.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: getParentGroupOptions(),
        required: false,
        placeholder: "No parent group (top level)",
        stepId: "group-details",
      },
      {
        field: {
          isExpandedByDefault: true,
        },
        title: "Expand on Status Page by Default",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        stepId: "group-details",
      },
      {
        field: {
          viewMode: true,
        },
        title: "View Mode",
        description:
          "How resources in this group are laid out on the public status page. 'List' is the classic vertical list. 'Grid' renders resources as a matrix using row and column axes.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
          StatusPageGroupViewMode,
        ),
        required: false,
        defaultValue: StatusPageGroupViewMode.List,
        stepId: "layout",
      },
      {
        field: {
          rowAxisLabel: true,
        },
        title: "Row Axis Label",
        description:
          "Heading shown on the row axis (e.g. 'Service', 'Tenant'). Use any dimension that makes sense for your status page.",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        placeholder: "Service",
        showIf: (item: FormValues<StatusPageGroup>): boolean => {
          return item.viewMode === StatusPageGroupViewMode.Grid;
        },
        stepId: "layout",
      },
      {
        field: {
          rowAxisValues: true,
        },
        title: "Row Axis Values",
        description:
          "One label per row, in the order you want them displayed. Each resource in this group is then assigned to one of these rows.",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: false,
        showIf: (item: FormValues<StatusPageGroup>): boolean => {
          return item.viewMode === StatusPageGroupViewMode.Grid;
        },
        stepId: "layout",
        getCustomElement: (
          _values: FormValues<StatusPageGroup>,
          fieldProps: CustomElementProps,
        ): ReactElement => {
          return (
            <AxisValuesInput
              initialValue={fieldProps.initialValue}
              onChange={fieldProps.onChange}
              onBlur={fieldProps.onBlur}
              placeholder="e.g. Auth"
              addButtonLabel="Add Row"
              error={fieldProps.error}
            />
          );
        },
      },
      {
        field: {
          columnAxisLabel: true,
        },
        title: "Column Axis Label",
        description:
          "Heading shown on the column axis (e.g. 'Region', 'Environment'). Use any dimension that makes sense for your status page.",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        placeholder: "Region",
        showIf: (item: FormValues<StatusPageGroup>): boolean => {
          return item.viewMode === StatusPageGroupViewMode.Grid;
        },
        stepId: "layout",
      },
      {
        field: {
          columnAxisValues: true,
        },
        title: "Column Axis Values",
        description:
          "One label per column, in the order you want them displayed. Each resource in this group is then assigned to one of these columns.",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: false,
        showIf: (item: FormValues<StatusPageGroup>): boolean => {
          return item.viewMode === StatusPageGroupViewMode.Grid;
        },
        stepId: "layout",
        getCustomElement: (
          _values: FormValues<StatusPageGroup>,
          fieldProps: CustomElementProps,
        ): ReactElement => {
          return (
            <AxisValuesInput
              initialValue={fieldProps.initialValue}
              onChange={fieldProps.onChange}
              onBlur={fieldProps.onBlur}
              placeholder="e.g. US-East"
              addButtonLabel="Add Column"
              error={fieldProps.error}
            />
          );
        },
      },
      {
        field: {
          showCurrentStatus: true,
        },
        title: "Show Current Group Status",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        defaultValue: true,
        description:
          "Current Status will be shown beside this group on your status page.",
        stepId: "advanced",
      },
      {
        field: {
          showUptimePercent: true,
        },
        title: "Show Uptime %",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        defaultValue: false,
        description:
          "Show uptime percentage beside this group on your status page. The number of days is configured in Status Page Settings.",
        stepId: "advanced",
      },
      {
        field: {
          uptimePercentPrecision: true,
        },
        stepId: "advanced",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions:
          DropdownUtil.getDropdownOptionsFromEnum(UptimePrecision),
        showIf: (item: FormValues<StatusPageGroup>): boolean => {
          return Boolean(item.showUptimePercent);
        },
        title: "Select Uptime Precision",
        defaultValue: UptimePrecision.ONE_DECIMAL,
        required: true,
      },
    ];
  };

  const closeForm: VoidFunction = (): void => {
    setFormMode(null);
    setGroupIdToEdit(null);
    setParentGroupIdForCreate(null);
  };

  type GetSummaryLabelFunction = () => string;

  const getSummaryLabel: GetSummaryLabelFunction = (): string => {
    const parts: Array<string> = [
      `${summary.totalCount} group${summary.totalCount === 1 ? "" : "s"}`,
      `${summary.topLevelCount} top level`,
    ];

    if (summary.levelCount > 1) {
      parts.push(`${summary.levelCount} levels deep`);
    }

    return parts.join(" · ");
  };

  type GetHeaderButtonsFunction = () => Array<CardButtonSchema | ReactElement>;

  const getHeaderButtons: GetHeaderButtonsFunction = (): Array<
    CardButtonSchema | ReactElement
  > => {
    const menuItems: Array<ReactElement> = [];

    if (canCreate) {
      menuItems.push(
        <MoreMenuItem
          key="import-from-csv"
          text="Import from CSV"
          icon={IconProp.Upload}
          onClick={() => {
            setShowImportModal(true);
          }}
        />,
      );
    }

    menuItems.push(
      <MoreMenuItem
        key="refresh"
        text="Refresh"
        icon={IconProp.Refresh}
        onClick={() => {
          fetchGroups().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
            setIsLoading(false);
          });
        }}
      />,
    );

    /*
     * The search decides what the card is showing, so it belongs with the
     * card's own controls rather than floating above the tree - the same slot
     * a ModelTable puts its search in.
     */
    const searchElement: ReactElement = (
      <div
        key="status-page-groups-search-slot"
        className="relative w-full sm:w-52 lg:w-64"
      >
        {/* Placeholders are not accessible names, and this input has no visible label. */}
        <label
          htmlFor="status-page-groups-search-input"
          id="status-page-groups-search-label"
          className="sr-only"
        >
          Search groups by name
        </label>
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
          <Icon icon={IconProp.Search} className="h-4 w-4" />
        </span>
        <Input
          id="status-page-groups-search-input"
          ariaLabelledby="status-page-groups-search-label"
          type={InputType.TEXT}
          placeholder="Search groups..."
          value={searchText}
          dataTestId="status-page-groups-search"
          outerDivClassName="relative w-full"
          className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          onChange={(value: string) => {
            setSearchText(value);
          }}
        />
      </div>
    );

    const buttons: Array<CardButtonSchema | ReactElement> = [];

    /* Nothing to search on a status page that has no groups yet. */
    if (statusPageGroups.length > 0) {
      buttons.push(searchElement);
    }

    if (canCreate) {
      buttons.push({
        title: "Create Group",
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Add,
        onClick: () => {
          setParentGroupIdForCreate(null);
          setGroupIdToEdit(null);
          setFormMode(GroupFormMode.Create);
        },
      } as CardButtonSchema);
    }

    /*
     * MoreMenu's own trigger, rather than one styled by hand: the overflow menu
     * on every other card in the product is this button, and a bordered pill
     * with a circled-ellipsis glyph was the one thing in this header that
     * belonged to no other page.
     */
    buttons.push(
      <MoreMenu
        key="status-page-groups-actions"
        menuIcon={IconProp.EllipsisHorizontal}
        text=""
        ariaLabel="More group actions"
        dataTestId="status-page-groups-actions"
      >
        {menuItems}
      </MoreMenu>,
    );

    return buttons;
  };

  type GetDeleteDescriptionFunction = () => string;

  const getDeleteDescription: GetDeleteDescriptionFunction = (): string => {
    if (!groupToDelete) {
      return "";
    }

    const descendantCount: number = StatusPageGroupTreeUtil.getDescendantGroups(
      {
        statusPageGroup: groupToDelete,
        statusPageGroups: statusPageGroups,
      },
    ).length;

    const subGroupSentence: string =
      descendantCount > 0
        ? ` This also deletes the ${descendantCount} group${
            descendantCount === 1 ? "" : "s"
          } nested inside it.`
        : "";

    return `Are you sure you want to delete "${
      groupToDelete.name || "this group"
    }"?${subGroupSentence} The resources in ${
      descendantCount > 0 ? "these groups" : "this group"
    } and any monitor rules that add monitors to ${
      descendantCount > 0 ? "them" : "it"
    } are deleted with ${descendantCount > 0 ? "them" : "it"}. This cannot be undone.`;
  };

  type RenderBodyFunction = () => ReactElement;

  const renderBody: RenderBodyFunction = (): ReactElement => {
    if (isLoading && statusPageGroups.length === 0) {
      return <ComponentLoader />;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            fetchGroups().catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
              setIsLoading(false);
            });
          }}
        />
      );
    }

    if (statusPageGroups.length === 0) {
      /*
       * EmptyState ships 13rem of vertical padding for a full page placeholder;
       * inside this card that reads as a hole.
       */
      return (
        <div className="-my-32">
          <EmptyState
            id="status-page-groups-empty"
            icon={IconProp.Folder}
            title="No groups yet"
            description="Groups are how a status page is organised - and they nest, so a large page can read as Corporate Units › Region › Market. Create your first group to get started."
          />
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className="text-xs text-gray-500 tabular-nums"
            data-testid="status-page-groups-summary"
          >
            {getSummaryLabel()}
          </span>

          {/*
           * ButtonStyleType.NORMAL carries an md:ml-3 of its own, which fights
           * this row's gap. Scoping the override to the container is how
           * BaseModelTable settles the same argument in its header.
           */}
          <div className="flex flex-wrap items-center gap-2 [&_button]:md:ml-0">
            <Button
              title="Expand All"
              icon={IconProp.ChevronDown}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.NORMAL}
              disabled={!canExpandMore}
              dataTestId="status-page-groups-expand-all"
              onClick={expandAll}
            />
            <Button
              title="Collapse All"
              icon={IconProp.ChevronRight}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.NORMAL}
              disabled={expandedGroupIds.size === 0}
              dataTestId="status-page-groups-collapse-all"
              onClick={collapseAll}
            />
          </div>
        </div>

        {actionError ? <ErrorMessage message={actionError} /> : <></>}

        {rows.length === 0 ? (
          <div className="-my-32">
            <EmptyState
              id="status-page-groups-no-search-match"
              icon={IconProp.Search}
              title="No groups match your search"
              description={
                <span className="mx-auto block max-w-md">
                  {`Nothing on this status page matches “${searchText}”. Clear the search to see the whole hierarchy again.`}
                </span>
              }
            />
          </div>
        ) : (
          /*
           * An inset panel, the way every comparable card in the product frames
           * its rows. Deliberately not overflow-hidden: a row's overflow menu is
           * absolutely positioned inside this box and would be clipped by it.
           */
          <div
            className="rounded-xl border border-gray-200 bg-white p-2"
            data-testid="status-page-groups-tree"
          >
            <GroupHierarchy
              rows={rows}
              busyGroupId={busyGroupId}
              isCreateable={canCreate}
              isEditable={canEdit}
              isDeleteable={canDelete}
              onToggleExpand={toggleExpand}
              onAddSubGroup={(statusPageGroup: StatusPageGroup) => {
                setParentGroupIdForCreate(
                  statusPageGroup._id?.toString() || null,
                );
                setGroupIdToEdit(null);
                setFormMode(GroupFormMode.Create);
              }}
              onEdit={(statusPageGroup: StatusPageGroup) => {
                setParentGroupIdForCreate(null);
                setGroupIdToEdit(
                  new ObjectID(statusPageGroup._id?.toString() || ""),
                );
                setFormMode(GroupFormMode.Edit);
              }}
              onDelete={(statusPageGroup: StatusPageGroup) => {
                setDeleteError("");
                setGroupToDelete(statusPageGroup);
              }}
              onMoveUp={(statusPageGroup: StatusPageGroup) => {
                moveGroup(statusPageGroup, "up").catch((err: Error) => {
                  setActionError(API.getFriendlyMessage(err));
                  setBusyGroupId(null);
                });
              }}
              onMoveDown={(statusPageGroup: StatusPageGroup) => {
                moveGroup(statusPageGroup, "down").catch((err: Error) => {
                  setActionError(API.getFriendlyMessage(err));
                  setBusyGroupId(null);
                });
              }}
              onShowId={(statusPageGroup: StatusPageGroup) => {
                setGroupToShowIdFor(statusPageGroup);
              }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <Fragment>
      <Card
        title="Resource Groups"
        description="Here are different groups for your status page resources. Groups can be nested inside other groups, and each level shows the rolled up status and uptime of everything beneath it. Deleting a group also deletes its sub groups, the resources in them, and any monitor rules that add monitors to them."
        buttons={getHeaderButtons()}
      >
        {renderBody()}
      </Card>

      {formMode ? (
        <ModelFormModal<StatusPageGroup>
          modelType={StatusPageGroup}
          name={
            formMode === GroupFormMode.Create
              ? "Status Page > Groups > Create New Status Page Group"
              : "Status Page > Groups > Edit Status Page Group"
          }
          title={
            formMode === GroupFormMode.Create
              ? "Create New Status Page Group"
              : "Edit Status Page Group"
          }
          submitButtonText={
            formMode === GroupFormMode.Create
              ? "Create Status Page Group"
              : "Save Changes"
          }
          modelIdToEdit={groupIdToEdit || undefined}
          /*
           * "Add a sub group" is the whole point of a hierarchy view: the
           * parent is the group the operator clicked, not something they have
           * to go and find again in a dropdown of every group on the page.
           */
          initialValues={
            formMode === GroupFormMode.Create && parentGroupIdForCreate
              ? {
                  parentStatusPageGroup: parentGroupIdForCreate,
                }
              : undefined
          }
          onClose={closeForm}
          onBeforeCreate={(item: StatusPageGroup): Promise<StatusPageGroup> => {
            if (!props.currentProject || !props.currentProject._id) {
              throw new BadDataException("Project ID cannot be null");
            }
            item.statusPageId = modelId;
            item.projectId = new ObjectID(props.currentProject._id);
            return Promise.resolve(item);
          }}
          onSuccess={(item: StatusPageGroup) => {
            /*
             * A sub group created under a collapsed parent would otherwise be
             * written, refetched and then not shown - which reads exactly like
             * the create having failed.
             */
            const parentId: string | null =
              item.parentStatusPageGroupId?.toString() ||
              parentGroupIdForCreate;

            if (parentId) {
              setExpandedGroupIds((current: Set<string>) => {
                return new Set<string>([...current, parentId]);
              });
            }

            closeForm();

            fetchGroups().catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
              setIsLoading(false);
            });
          }}
          formProps={{
            name: "create-StatusPageGroup-from",
            modelType: StatusPageGroup,
            id: "create-StatusPageGroup-from",
            fields: getFormFields(),
            steps: [
              {
                title: "Group Details",
                id: "group-details",
              },
              {
                title: "Layout",
                id: "layout",
              },
              {
                title: "Advanced",
                id: "advanced",
              },
            ],
            formType:
              formMode === GroupFormMode.Create
                ? FormType.Create
                : FormType.Update,
          }}
        />
      ) : (
        <></>
      )}

      {groupToDelete ? (
        <ConfirmModal
          title={`Delete ${groupToDelete.name || "Group"}`}
          description={getDeleteDescription()}
          submitButtonText="Delete"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isDeleting}
          error={deleteError || undefined}
          onClose={() => {
            setGroupToDelete(null);
            setDeleteError("");
          }}
          onSubmit={() => {
            deleteGroup().catch((err: Error) => {
              setDeleteError(API.getFriendlyMessage(err));
              setIsDeleting(false);
            });
          }}
        />
      ) : (
        <></>
      )}

      {groupToShowIdFor ? (
        <ConfirmModal
          title={`${groupToShowIdFor.name || "Group"} ID`}
          description={`Status Page Group ID: ${
            groupToShowIdFor._id?.toString() || ""
          }`}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setGroupToShowIdFor(null);
          }}
        />
      ) : (
        <></>
      )}

      {showImportModal && (
        <ImportGroupsFromCsvModal
          statusPageId={modelId}
          projectId={ProjectUtil.getCurrentProjectId()!}
          onClose={() => {
            setShowImportModal(false);
          }}
          onImportComplete={() => {
            /*
             * Fires while the modal is still open on its results, so the tree
             * behind it is already current when the user closes it.
             */
            fetchGroups().catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
              setIsLoading(false);
            });
          }}
        />
      )}
    </Fragment>
  );
};

export default StatusPageGroups;
