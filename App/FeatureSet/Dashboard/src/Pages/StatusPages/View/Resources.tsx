import AxisValuesInput from "../../../Components/StatusPage/AxisValuesInput";
import ImportGroupsFromCsvModal from "../../../Components/StatusPage/ImportGroupsFromCsvModal";
import StatusPageResourcePanel from "../../../Components/StatusPage/StatusPageResourcePanel";
import { getStatusPageResourceAdvancedFields } from "../../../Components/StatusPage/StatusPageResourceFormFields";
import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import ResourceGroupNavigator from "Common/UI/Components/StatusPage/ResourceGroupNavigator";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import User from "Common/UI/Utils/User";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageGroupHierarchyViewUtil from "Common/Utils/StatusPage/GroupHierarchyView";
import StatusPageGroupTreeUtil, {
  StatusPageGroupTreeIndex,
} from "Common/Utils/StatusPage/GroupTree";
import StatusPageResourceExplorerUtil, {
  StatusPageResourceBreadcrumbStep,
  StatusPageResourceCountIndex,
  StatusPageResourceNavigatorResult,
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

const FORM_STEPS: Array<FormStep<StatusPageResource>> = [
  {
    title: "Monitor Details",
    id: "monitor-details",
  },
  {
    title: "Advanced",
    id: "advanced",
  },
];

const GROUP_FORM_STEPS: Array<FormStep<StatusPageGroup>> = [
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
];

/*
 * One level of children is open on arrival - enough to show that the hierarchy
 * nests, without unfolding a thousand-group status page into a wall of names.
 */
const AUTO_EXPAND_DEPTH: number = 1;

enum GroupFormMode {
  Create = "Create",
  Edit = "Edit",
}

/*
 * Status Page > Resources: one screen for everything a status page shows.
 *
 * Two things used to be two pages. "Groups" drew the hierarchy and was where a
 * section was created, renamed, nested, reordered and deleted; "Resources" drew
 * the monitors inside a group and was where they were added and ordered. They
 * are halves of one job - build a section, then fill it - and splitting them
 * across two links made building a status page a loop of navigating between
 * them, with a "Manage Groups" button in the middle of it whose only purpose
 * was to leave.
 *
 * So there is one screen. The hierarchy is on the left, as somewhere to go and
 * as the thing being built: a row selects a group, its chevron opens the sub
 * groups, and the cluster that appears on it acts on the group. One group's
 * contents are on the right, as a list you can drag into order, under a header
 * that names the group and carries everything that acts on it.
 *
 * The property the explorer was built for survives, and now covers both jobs:
 * exactly one group's resources are loaded at a time. Opening the page costs
 * two requests whatever the hierarchy size - the groups, and one pass over the
 * resources for the counts the navigator shows - plus one for whichever group
 * is selected. Nothing about a fifteen hundred group status page can make that
 * number grow (issue #3042).
 */
const StatusPageResources: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const projectId: ObjectID = new ObjectID(props.currentProject?._id || "");

  const [groups, setGroups] = useState<Array<StatusPageGroup>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [countIndex, setCountIndex] = useState<StatusPageResourceCountIndex>(
    StatusPageResourceExplorerUtil.getEmptyResourceCountIndex(),
  );
  const [hasCountIndexLoaded, setHasCountIndexLoaded] =
    useState<boolean>(false);

  const [selection, setSelection] = useState<StatusPageResourceSelection>({
    type: StatusPageResourceSelectionType.Ungrouped,
    statusPageGroupId: null,
  });
  const [hasChosenInitialSelection, setHasChosenInitialSelection] =
    useState<boolean>(false);

  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    new Set<string>(),
  );
  const [hasAppliedDefaultExpansion, setHasAppliedDefaultExpansion] =
    useState<boolean>(false);

  const [searchText, setSearchText] = useState<string>("");
  const [navigatorRowLimit, setNavigatorRowLimit] = useState<number>(
    StatusPageResourceExplorerUtil.MaxNavigatorRows,
  );

  /*
   * Below lg the navigator and the pane cannot sit beside each other, so only
   * one of them is on screen and selecting a group moves between them.
   */
  const [isPaneOpenOnMobile, setIsPaneOpenOnMobile] = useState<boolean>(false);

  const [addMonitorGroup, setAddMonitorGroup] = useState<boolean>(false);

  /* Managing the hierarchy itself, which used to be a page of its own. */
  const [groupFormMode, setGroupFormMode] = useState<GroupFormMode | null>(
    null,
  );
  const [groupIdToEdit, setGroupIdToEdit] = useState<ObjectID | null>(null);
  const [parentGroupIdForCreate, setParentGroupIdForCreate] = useState<
    string | null
  >(null);

  const [groupToDelete, setGroupToDelete] = useState<StatusPageGroup | null>(
    null,
  );
  const [isDeletingGroup, setIsDeletingGroup] = useState<boolean>(false);
  const [deleteGroupError, setDeleteGroupError] = useState<string>("");

  const [groupToShowIdFor, setGroupToShowIdFor] =
    useState<StatusPageGroup | null>(null);

  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);

  /* The group whose reorder is in flight. See moveGroup. */
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [groupActionError, setGroupActionError] = useState<string>("");

  const permissions: Array<Permission> = PermissionUtil.getAllPermissions();
  const resourceModel: StatusPageResource = new StatusPageResource();
  const groupModel: StatusPageGroup = new StatusPageGroup();
  const isMasterAdmin: boolean = User.isMasterAdmin();

  /*
   * The list and the tree are hand rolled, so the permission checks ModelTable
   * used to make on the page's behalf have to be made here - and separately for
   * the two models, because a viewer may well be allowed to add a monitor to a
   * status page without being allowed to restructure it.
   */
  const canCreate: boolean =
    isMasterAdmin || resourceModel.hasCreatePermissions(permissions);
  const canEdit: boolean =
    isMasterAdmin || resourceModel.hasUpdatePermissions(permissions);
  const canDelete: boolean =
    isMasterAdmin || resourceModel.hasDeletePermissions(permissions);

  const canCreateGroup: boolean =
    isMasterAdmin || groupModel.hasCreatePermissions(permissions);
  const canEditGroup: boolean =
    isMasterAdmin || groupModel.hasUpdatePermissions(permissions);
  const canDeleteGroup: boolean =
    isMasterAdmin || groupModel.hasDeletePermissions(permissions);

  type FetchGroupsFunction = () => Promise<Array<StatusPageGroup>>;

  /*
   * Resolves with the hierarchy it read, not just with void. Anything that has
   * to act on the group list immediately after a write - revealing a group that
   * did not exist a moment ago, for instance - cannot use the `groups` state:
   * the callback doing it was created in an earlier render and closes over the
   * list from before the write.
   */
  const fetchGroups: FetchGroupsFunction = async (): Promise<
    Array<StatusPageGroup>
  > => {
    setError("");
    setGroupActionError("");
    setIsLoading(true);

    try {
      const listResult: ListResult<StatusPageGroup> =
        await ModelAPI.getList<StatusPageGroup>({
          modelType: StatusPageGroup,
          query: {
            statusPageId: modelId,
            projectId: projectId,
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
            showUptimePercent: true,
            viewMode: true,
            rowAxisLabel: true,
            columnAxisLabel: true,
            rowAxisValues: true,
            columnAxisValues: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          requestOptions: {},
        });

      setGroups(listResult.data);
      setIsLoading(false);

      return listResult.data;
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);

    return [];
  };

  /*
   * One request that reads every resource's group id and nothing else, so the
   * navigator can say how many resources sit in a group without opening it. A
   * count request per group would be the same stampede in a cheaper disguise,
   * and the server has no group-by endpoint to ask instead.
   *
   * It fails quietly: the counts are decoration, and losing them must not take
   * the page with it.
   */
  const fetchResourceCounts: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const listResult: ListResult<StatusPageResource> =
        await ModelAPI.getList<StatusPageResource>({
          modelType: StatusPageResource,
          query: {
            statusPageId: modelId,
            projectId: projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            statusPageGroupId: true,
          },
          sort: {},
          requestOptions: {},
        });

      setCountIndex(
        StatusPageResourceExplorerUtil.buildResourceCountIndex({
          statusPageResources: listResult.data,
          totalCount: listResult.count,
        }),
      );
    } catch {
      /* The explorer still works; it just works without the count badges. */
      setCountIndex(
        StatusPageResourceExplorerUtil.getEmptyResourceCountIndex(),
      );
    }

    setHasCountIndexLoaded(true);
  };

  const reloadGroups: VoidFunction = (): void => {
    fetchGroups().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  };

  useEffect(() => {
    reloadGroups();

    fetchResourceCounts().catch(() => {
      setCountIndex(
        StatusPageResourceExplorerUtil.getEmptyResourceCountIndex(),
      );
      setHasCountIndexLoaded(true);
    });
  }, []);

  const groupIndex: StatusPageGroupTreeIndex =
    useMemo((): StatusPageGroupTreeIndex => {
      return StatusPageGroupTreeUtil.buildIndex({ statusPageGroups: groups });
    }, [groups]);

  /*
   * Keyed on "have we done this yet" rather than on the group list, so the
   * default expansion is applied to the first page of data that arrives and
   * never again - a refetch must not re-collapse the branch the operator was
   * working in.
   */
  useEffect(() => {
    if (hasAppliedDefaultExpansion || groups.length === 0) {
      return;
    }

    setExpandedGroupIds(
      StatusPageGroupHierarchyViewUtil.getDefaultExpandedGroupIds({
        statusPageGroups: groups,
        maxAutoExpandDepth: AUTO_EXPAND_DEPTH,
      }),
    );
    setHasAppliedDefaultExpansion(true);
  }, [groups, hasAppliedDefaultExpansion]);

  /*
   * The pane has to open on something, and which something depends on numbers
   * that arrive after the first render - so it is chosen once, when both the
   * groups and the counts are in.
   *
   * Nothing below waits on anything else, but the pane waits on this: mounting
   * it on a placeholder selection and then moving it would read one group's
   * resources only to throw them away and read another's.
   */
  useEffect(() => {
    if (hasChosenInitialSelection || isLoading || !hasCountIndexLoaded) {
      return;
    }

    setSelection(
      StatusPageResourceExplorerUtil.getInitialSelection({
        statusPageGroups: groups,
        countIndex: countIndex,
      }),
    );
    setHasChosenInitialSelection(true);
  }, [isLoading, hasCountIndexLoaded, hasChosenInitialSelection]);

  const navigatorResult: StatusPageResourceNavigatorResult =
    useMemo((): StatusPageResourceNavigatorResult => {
      return StatusPageResourceExplorerUtil.getNavigatorRows({
        statusPageGroups: groups,
        countIndex: countIndex,
        expandedGroupIds: expandedGroupIds,
        searchText: searchText,
        maxRows: navigatorRowLimit,
        index: groupIndex,
      });
    }, [
      groups,
      countIndex,
      expandedGroupIds,
      searchText,
      navigatorRowLimit,
      groupIndex,
    ]);

  const selectedGroup: StatusPageGroup | undefined = useMemo(():
    | StatusPageGroup
    | undefined => {
    if (selection.type !== StatusPageResourceSelectionType.Group) {
      return undefined;
    }

    return groups.find((group: StatusPageGroup): boolean => {
      return group._id?.toString() === selection.statusPageGroupId;
    });
  }, [groups, selection]);

  const selectedGroupSubGroups: Array<StatusPageGroup> =
    useMemo((): Array<StatusPageGroup> => {
      if (!selection.statusPageGroupId) {
        return [];
      }

      return StatusPageGroupTreeUtil.getChildGroups({
        statusPageGroupId: selection.statusPageGroupId,
        statusPageGroups: groups,
        index: groupIndex,
      });
    }, [selection.statusPageGroupId, groups, groupIndex]);

  const breadcrumbSteps: Array<StatusPageResourceBreadcrumbStep> =
    useMemo((): Array<StatusPageResourceBreadcrumbStep> => {
      if (!selectedGroup) {
        return [];
      }

      return StatusPageResourceExplorerUtil.getBreadcrumbSteps({
        statusPageGroup: selectedGroup,
        statusPageGroups: groups,
        index: groupIndex,
      });
    }, [selectedGroup, groups, groupIndex]);

  type SelectFunction = (nextSelection: StatusPageResourceSelection) => void;

  const select: SelectFunction = (
    nextSelection: StatusPageResourceSelection,
  ): void => {
    setSelection(nextSelection);
    setHasChosenInitialSelection(true);
    setIsPaneOpenOnMobile(true);

    /*
     * A group reached from a breadcrumb, or created inside a collapsed branch,
     * has to be somewhere the navigator can show it - otherwise the pane and
     * the tree beside it disagree about where the operator is.
     */
    setExpandedGroupIds((current: Set<string>) => {
      const toReveal: Set<string> =
        StatusPageResourceExplorerUtil.getGroupIdsToReveal({
          statusPageGroups: groups,
          statusPageGroupId: nextSelection.statusPageGroupId,
          index: groupIndex,
        });

      if (toReveal.size === 0) {
        return current;
      }

      return new Set<string>([...current, ...toReveal]);
    });
  };

  type SelectGroupFunction = (statusPageGroupId: string) => void;

  const selectGroup: SelectGroupFunction = (
    statusPageGroupId: string,
  ): void => {
    select({
      type: StatusPageResourceSelectionType.Group,
      statusPageGroupId: statusPageGroupId,
    });
  };

  type ToggleGroupFunction = (statusPageGroupId: string) => void;

  const toggleGroup: ToggleGroupFunction = (
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

  type OnResourceCountLoadedFunction = (
    statusPageGroupId: string | null,
    count: number,
  ) => void;

  /*
   * The selected group reporting its own size, which is the only number that
   * can have changed while it was on screen.
   *
   * The alternative - re-reading every resource on the status page after every
   * create, delete and bulk add - is a megabyte or so of JSON per edit on a
   * page with ten thousand resources, and it races with itself if two edits
   * land close together.
   */
  const onResourceCountLoaded: OnResourceCountLoadedFunction = (
    statusPageGroupId: string | null,
    count: number,
  ): void => {
    setCountIndex((current: StatusPageResourceCountIndex) => {
      return StatusPageResourceExplorerUtil.withGroupResourceCount({
        countIndex: current,
        statusPageGroupId: statusPageGroupId,
        count: count,
      });
    });
  };

  /* ------------------------------------------------------------------ */
  /* Writing to the hierarchy                                            */
  /* ------------------------------------------------------------------ */

  type OpenCreateGroupFunction = (
    parentStatusPageGroupId: string | null,
  ) => void;

  const openCreateGroup: OpenCreateGroupFunction = (
    parentStatusPageGroupId: string | null,
  ): void => {
    setGroupActionError("");
    setParentGroupIdForCreate(parentStatusPageGroupId);
    setGroupIdToEdit(null);
    setGroupFormMode(GroupFormMode.Create);
  };

  type OpenEditGroupFunction = (statusPageGroup: StatusPageGroup) => void;

  const openEditGroup: OpenEditGroupFunction = (
    statusPageGroup: StatusPageGroup,
  ): void => {
    setGroupActionError("");
    setParentGroupIdForCreate(null);
    setGroupIdToEdit(new ObjectID(statusPageGroup._id?.toString() || ""));
    setGroupFormMode(GroupFormMode.Edit);
  };

  const closeGroupForm: VoidFunction = (): void => {
    setGroupFormMode(null);
    setGroupIdToEdit(null);
    setParentGroupIdForCreate(null);
  };

  type MoveGroupFunction = (
    statusPageGroup: StatusPageGroup,
    direction: "up" | "down",
  ) => Promise<void>;

  /*
   * Reordering writes the neighbouring sibling's `order` onto this group and
   * lets StatusPageGroupService renumber everything between the two - the only
   * write the service knows how to rebalance.
   */
  const moveGroup: MoveGroupFunction = async (
    statusPageGroup: StatusPageGroup,
    direction: "up" | "down",
  ): Promise<void> => {
    const statusPageGroupId: string = statusPageGroup._id?.toString() || "";

    const targetOrder: number | null =
      StatusPageGroupHierarchyViewUtil.getReorderTargetOrder({
        statusPageGroups: groups,
        statusPageGroupId: statusPageGroupId,
        direction: direction,
        index: groupIndex,
      });

    if (targetOrder === null) {
      return;
    }

    setBusyGroupId(statusPageGroupId);
    setGroupActionError("");

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
      setGroupActionError(API.getFriendlyMessage(err));
    }

    setBusyGroupId(null);
  };

  type RunMoveGroupFunction = (
    statusPageGroup: StatusPageGroup,
    direction: "up" | "down",
  ) => void;

  const runMoveGroup: RunMoveGroupFunction = (
    statusPageGroup: StatusPageGroup,
    direction: "up" | "down",
  ): void => {
    moveGroup(statusPageGroup, direction).catch((err: Error) => {
      setGroupActionError(API.getFriendlyMessage(err));
      setBusyGroupId(null);
    });
  };

  /*
   * Whether the selected group has a real sibling to swap places with, in
   * either direction. Asked of the hierarchy rather than of the rows on screen:
   * `order` is a property of the hierarchy, not of whatever the operator has
   * typed into the search box, so a move must always mean the same thing.
   */
  const canMoveSelectedGroup: { up: boolean; down: boolean } = useMemo((): {
    up: boolean;
    down: boolean;
  } => {
    if (!selection.statusPageGroupId) {
      return { up: false, down: false };
    }

    type CanMoveFunction = (direction: "up" | "down") => boolean;

    const canMove: CanMoveFunction = (direction: "up" | "down"): boolean => {
      return (
        StatusPageGroupHierarchyViewUtil.getReorderTargetOrder({
          statusPageGroups: groups,
          statusPageGroupId: selection.statusPageGroupId || "",
          direction: direction,
          index: groupIndex,
        }) !== null
      );
    };

    return { up: canMove("up"), down: canMove("down") };
  }, [selection.statusPageGroupId, groups, groupIndex]);

  const deleteGroup: PromiseVoidFunction = async (): Promise<void> => {
    if (!groupToDelete || !groupToDelete.id) {
      return;
    }

    setIsDeletingGroup(true);
    setDeleteGroupError("");

    /*
     * Worked out before the write, while the group is still in the hierarchy:
     * the cascade takes its sub groups with it, and a pane still pointed at one
     * of them would sit there fetching a group that no longer exists.
     */
    const removedGroupIds: Set<string> = new Set<string>([
      groupToDelete._id?.toString() || "",
      ...StatusPageGroupTreeUtil.getDescendantGroups({
        statusPageGroup: groupToDelete,
        statusPageGroups: groups,
        index: groupIndex,
      }).map((group: StatusPageGroup) => {
        return group._id?.toString() || "";
      }),
    ]);

    try {
      await ModelAPI.deleteItem<StatusPageGroup>({
        modelType: StatusPageGroup,
        id: groupToDelete.id,
      });

      setGroupToDelete(null);

      if (
        selection.statusPageGroupId &&
        removedGroupIds.has(selection.statusPageGroupId)
      ) {
        setSelection({
          type: StatusPageResourceSelectionType.Ungrouped,
          statusPageGroupId: null,
        });
      }

      /*
       * The counts are re-read rather than adjusted: deleting a group deletes
       * the resources in it and in every group under it, and the page has no
       * way of knowing how many that was.
       */
      await fetchGroups();
      await fetchResourceCounts();
    } catch (err) {
      setDeleteGroupError(API.getFriendlyMessage(err));
    }

    setIsDeletingGroup(false);
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
        statusPageGroups: groups,
        statusPageGroupId: groupIdToEdit?.toString(),
        index: groupIndex,
      }).map((group: StatusPageGroup) => {
        return {
          value: group._id?.toString() || "",
          /*
           * Two groups can easily be called "Region 1000" at different levels,
           * so an option is only unambiguous with its whole path on it.
           */
          label: StatusPageGroupHierarchyViewUtil.getGroupPathLabel({
            statusPageGroup: group,
            statusPageGroups: groups,
            index: groupIndex,
          }),
        };
      });
    };

  type GetDeleteDescriptionFunction = () => string;

  const getDeleteDescription: GetDeleteDescriptionFunction = (): string => {
    if (!groupToDelete) {
      return "";
    }

    const descendantCount: number = StatusPageGroupTreeUtil.getDescendantGroups(
      {
        statusPageGroup: groupToDelete,
        statusPageGroups: groups,
        index: groupIndex,
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

  /* ------------------------------------------------------------------ */
  /* The group form, which is the whole surface of a status page group.  */
  /* ------------------------------------------------------------------ */

  const getGroupFormFields: () => Array<
    ModelField<StatusPageGroup>
  > = (): Array<ModelField<StatusPageGroup>> => {
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

  /* ------------------------------------------------------------------ */
  /* The resource form, shared by every way of creating one.             */
  /* ------------------------------------------------------------------ */

  type GetFooterForMonitorFunction = () => ReactElement;

  const getFooterForMonitor: GetFooterForMonitorFunction = (): ReactElement => {
    if (!props.currentProject?.isFeatureFlagMonitorGroupsEnabled) {
      return <></>;
    }

    return (
      <Link
        onClick={() => {
          setAddMonitorGroup(!addMonitorGroup);
        }}
        className="mt-1 text-sm text-gray-500 underline"
      >
        <div>
          <p>
            {addMonitorGroup
              ? "Add a Monitor instead."
              : "Add a Monitor Group instead."}
          </p>
        </div>
      </Link>
    );
  };

  const formFields: Array<ModelField<StatusPageResource>> = useMemo((): Array<
    ModelField<StatusPageResource>
  > => {
    const resourceField: ModelField<StatusPageResource> = addMonitorGroup
      ? {
          field: {
            monitorGroup: true,
          },
          title: "Monitor Group",
          description:
            "Select monitor group that will be shown on the status page.",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownModal: {
            type: MonitorGroup,
            labelField: "name",
            valueField: "_id",
          },
          required: true,
          placeholder: "Select Monitor Group",
          stepId: "monitor-details",
          footerElement: getFooterForMonitor(),
        }
      : {
          field: {
            monitor: true,
          },
          title: "Monitor",
          description: "Select monitor that will be shown on the status page.",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownModal: {
            type: Monitor,
            labelField: "name",
            valueField: "_id",
          },
          required: true,
          placeholder: "Select Monitor",
          stepId: "monitor-details",
          footerElement: getFooterForMonitor(),
        };

    return [
      resourceField,
      {
        field: {
          displayName: true,
        },
        title: "Display Name",
        description:
          "This will be the name that will be shown on the status page",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: "Display Name",
        stepId: "monitor-details",
      },
      {
        field: {
          displayDescription: true,
        },
        title: "Description",
        fieldType: FormFieldSchemaType.Markdown,
        required: false,
        placeholder: "",
        stepId: "monitor-details",
        description: MarkdownUtil.getMarkdownCheatsheet(
          "Describe this resource here",
        ),
      },
      ...getStatusPageResourceAdvancedFields(),
    ];
  }, [
    addMonitorGroup,
    props.currentProject?.isFeatureFlagMonitorGroupsEnabled,
  ]);

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  type GetPanelFunction = (onBack?: VoidFunction | undefined) => ReactElement;

  const getPanel: GetPanelFunction = (
    onBack?: VoidFunction | undefined,
  ): ReactElement => {
    /*
     * The navigator is drawn as soon as the groups arrive; the pane waits until
     * the selection is settled. Mounting it on the placeholder selection and
     * then moving it would read one group's resources only to throw them away
     * and read another's - which is the exact cost this page exists to avoid.
     */
    if (!hasChosenInitialSelection) {
      return <ComponentLoader />;
    }

    const selectionKey: string =
      selection.type === StatusPageResourceSelectionType.Ungrouped
        ? "ungrouped"
        : selection.statusPageGroupId || "";

    return (
      <StatusPageResourcePanel
        /*
         * Remounted per selection on purpose. Every piece of state in the pane
         * - what is loading, which modal is open, what a failed write said - is
         * about one group, and carrying any of it across to the next group is
         * always wrong.
         */
        key={selectionKey}
        statusPageId={modelId}
        projectId={projectId}
        selection={selection}
        statusPageGroup={selectedGroup}
        breadcrumbSteps={breadcrumbSteps}
        subGroups={selectedGroupSubGroups}
        onSelectGroup={selectGroup}
        onBreadcrumbClick={selectGroup}
        hasGroups={groups.length > 0}
        isMonitorGroupsFeatureEnabled={Boolean(
          props.currentProject?.isFeatureFlagMonitorGroupsEnabled,
        )}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canCreateGroup={canCreateGroup}
        canEditGroup={canEditGroup}
        canDeleteGroup={canDeleteGroup}
        onCreateGroup={() => {
          openCreateGroup(null);
        }}
        onEditGroup={() => {
          if (selectedGroup) {
            openEditGroup(selectedGroup);
          }
        }}
        onAddSubGroup={() => {
          openCreateGroup(selection.statusPageGroupId);
        }}
        onDeleteGroup={() => {
          if (selectedGroup) {
            setDeleteGroupError("");
            setGroupToDelete(selectedGroup);
          }
        }}
        canMoveGroupUp={canMoveSelectedGroup.up}
        canMoveGroupDown={canMoveSelectedGroup.down}
        onMoveGroupUp={() => {
          if (selectedGroup) {
            runMoveGroup(selectedGroup, "up");
          }
        }}
        onMoveGroupDown={() => {
          if (selectedGroup) {
            runMoveGroup(selectedGroup, "down");
          }
        }}
        onShowGroupId={() => {
          if (selectedGroup) {
            setGroupToShowIdFor(selectedGroup);
          }
        }}
        baseFormFields={formFields}
        formSteps={FORM_STEPS}
        onResourceCountLoaded={onResourceCountLoaded}
        onBack={onBack}
      />
    );
  };

  type GetNavigatorFunction = () => ReactElement;

  const getNavigator: GetNavigatorFunction = (): ReactElement => {
    return (
      <Fragment>
        <div className="relative mb-3">
          <label
            htmlFor="status-page-resource-group-search-input"
            id="status-page-resource-group-search-label"
            className="sr-only"
          >
            Search groups by name
          </label>
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <Input
            id="status-page-resource-group-search-input"
            ariaLabelledby="status-page-resource-group-search-label"
            type={InputType.TEXT}
            placeholder="Search groups..."
            value={searchText}
            dataTestId="status-page-resource-group-search"
            outerDivClassName="relative w-full"
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onChange={(value: string) => {
              setSearchText(value);
              setNavigatorRowLimit(
                StatusPageResourceExplorerUtil.MaxNavigatorRows,
              );
            }}
          />
        </div>

        {/*
         * A refetch that failed while the hierarchy was already on screen, or a
         * reorder that the server refused. Neither is a reason to replace a
         * working page with an error - the tree below is still the last thing
         * the server agreed to.
         */}
        {groupActionError || error ? (
          <div className="mb-2">
            <ErrorMessage message={groupActionError || error} />
          </div>
        ) : (
          <></>
        )}

        <ResourceGroupNavigator
          rows={navigatorResult.rows}
          countIndex={countIndex}
          selection={selection}
          searchText={searchText}
          hiddenRowCount={
            navigatorResult.totalRowCount - navigatorResult.rows.length
          }
          onShowMore={() => {
            setNavigatorRowLimit(
              navigatorRowLimit +
                StatusPageResourceExplorerUtil.NavigatorRowsPerPage,
            );
          }}
          onSelect={select}
          onToggleExpand={toggleGroup}
          isCreateable={canCreateGroup}
          isEditable={canEditGroup}
          isDeleteable={canDeleteGroup}
          busyGroupId={busyGroupId}
          onCreateGroup={() => {
            openCreateGroup(null);
          }}
          onAddSubGroup={(statusPageGroup: StatusPageGroup) => {
            openCreateGroup(statusPageGroup._id?.toString() || null);
          }}
          onEditGroup={openEditGroup}
          onDeleteGroup={(statusPageGroup: StatusPageGroup) => {
            setDeleteGroupError("");
            setGroupToDelete(statusPageGroup);
          }}
          onMoveGroupUp={(statusPageGroup: StatusPageGroup) => {
            runMoveGroup(statusPageGroup, "up");
          }}
          onMoveGroupDown={(statusPageGroup: StatusPageGroup) => {
            runMoveGroup(statusPageGroup, "down");
          }}
          onShowGroupId={(statusPageGroup: StatusPageGroup) => {
            setGroupToShowIdFor(statusPageGroup);
          }}
        />

        <div
          className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500 tabular-nums"
          data-testid="status-page-resource-stats"
        >
          {groups.length.toLocaleString()}{" "}
          {groups.length === 1 ? "group" : "groups"}
          {countIndex.isComplete
            ? ` · ${countIndex.totalCount.toLocaleString()} ${
                countIndex.totalCount === 1 ? "resource" : "resources"
              }`
            : ""}
        </div>
      </Fragment>
    );
  };

  type GetCardButtonsFunction = () => Array<CardButtonSchema | ReactElement>;

  const getCardButtons: GetCardButtonsFunction = (): Array<
    CardButtonSchema | ReactElement
  > => {
    const buttons: Array<CardButtonSchema | ReactElement> = [];

    if (canCreateGroup) {
      buttons.push({
        title: "New Group",
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.FolderPlus,
        onClick: () => {
          openCreateGroup(null);
        },
      } as CardButtonSchema);
    }

    const menuItems: Array<ReactElement> = [];

    if (canCreateGroup) {
      menuItems.push(
        <MoreMenuItem
          key="import-from-csv"
          text="Import groups from CSV"
          icon={IconProp.Upload}
          onClick={() => {
            setIsImportModalOpen(true);
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
          reloadGroups();

          fetchResourceCounts().catch(() => {
            setCountIndex(
              StatusPageResourceExplorerUtil.getEmptyResourceCountIndex(),
            );
            setHasCountIndexLoaded(true);
          });
        }}
      />,
    );

    buttons.push(
      <MoreMenu
        key="status-page-resources-actions"
        menuIcon={IconProp.EllipsisHorizontal}
        text=""
        ariaLabel="More status page resource actions"
        /*
         * Three dots and nothing else. MoreMenu's default trigger is an
         * outlined button, which beside "New Group" reads as a second button
         * whose label failed to load.
         */
        elementToBeShownInsteadOfButton={
          <button
            type="button"
            aria-label="More status page resource actions"
            data-testid="status-page-resources-actions"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Icon icon={IconProp.EllipsisHorizontal} className="h-5 w-5" />
          </button>
        }
      >
        {menuItems}
      </MoreMenu>,
    );

    return buttons;
  };

  type GetModalsFunction = () => ReactElement;

  const getModals: GetModalsFunction = (): ReactElement => {
    return (
      <Fragment>
        {groupFormMode ? (
          <ModelFormModal<StatusPageGroup>
            modelType={StatusPageGroup}
            name={
              groupFormMode === GroupFormMode.Create
                ? "Status Page > Resources > Create New Status Page Group"
                : "Status Page > Resources > Edit Status Page Group"
            }
            title={
              groupFormMode === GroupFormMode.Create
                ? "Create New Status Page Group"
                : "Edit Status Page Group"
            }
            submitButtonText={
              groupFormMode === GroupFormMode.Create
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
              groupFormMode === GroupFormMode.Create && parentGroupIdForCreate
                ? {
                    parentStatusPageGroup: parentGroupIdForCreate,
                  }
                : undefined
            }
            onClose={closeGroupForm}
            onBeforeCreate={(
              item: StatusPageGroup,
            ): Promise<StatusPageGroup> => {
              if (!props.currentProject || !props.currentProject._id) {
                throw new BadDataException("Project ID cannot be null");
              }
              item.statusPageId = modelId;
              item.projectId = new ObjectID(props.currentProject._id);
              return Promise.resolve(item);
            }}
            onSuccess={(item: StatusPageGroup) => {
              const wasCreate: boolean = groupFormMode === GroupFormMode.Create;
              const writtenGroupId: string | null =
                item._id?.toString() || null;

              closeGroupForm();

              fetchGroups()
                .then((refreshedGroups: Array<StatusPageGroup>) => {
                  /*
                   * Revealed against the hierarchy that was just read, not
                   * against `groups` - this callback was created a render ago
                   * and closes over the list from before the write, which does
                   * not contain the group it is trying to reveal.
                   *
                   * The whole path down to it is opened, not only its parent: a
                   * group can be created under a parent that is itself inside a
                   * collapsed branch, and a group written, refetched and then
                   * not shown reads exactly like the create having failed.
                   */
                  if (writtenGroupId) {
                    setExpandedGroupIds((current: Set<string>) => {
                      const toReveal: Set<string> =
                        StatusPageResourceExplorerUtil.getGroupIdsToReveal({
                          statusPageGroups: refreshedGroups,
                          statusPageGroupId: writtenGroupId,
                        });

                      if (toReveal.size === 0) {
                        return current;
                      }

                      return new Set<string>([...current, ...toReveal]);
                    });
                  }

                  /*
                   * A group is created in order to put monitors in it, so the
                   * new one is what the pane opens on - the next thing the
                   * operator wants is already on screen.
                   */
                  if (wasCreate && writtenGroupId) {
                    setSelection({
                      type: StatusPageResourceSelectionType.Group,
                      statusPageGroupId: writtenGroupId,
                    });
                    setHasChosenInitialSelection(true);
                    setIsPaneOpenOnMobile(true);
                  }
                })
                .catch((err: Error) => {
                  setError(API.getFriendlyMessage(err));
                  setIsLoading(false);
                });
            }}
            formProps={{
              name: "create-StatusPageGroup-from",
              modelType: StatusPageGroup,
              id: "create-StatusPageGroup-from",
              fields: getGroupFormFields(),
              steps: GROUP_FORM_STEPS,
              formType:
                groupFormMode === GroupFormMode.Create
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
            isLoading={isDeletingGroup}
            error={deleteGroupError || undefined}
            onClose={() => {
              setGroupToDelete(null);
              setDeleteGroupError("");
            }}
            onSubmit={() => {
              deleteGroup().catch((err: Error) => {
                setDeleteGroupError(API.getFriendlyMessage(err));
                setIsDeletingGroup(false);
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

        {isImportModalOpen ? (
          <ImportGroupsFromCsvModal
            statusPageId={modelId}
            projectId={projectId}
            onClose={() => {
              setIsImportModalOpen(false);
            }}
            onImportComplete={() => {
              /*
               * Fires while the modal is still open on its results, so the tree
               * behind it is already current when the user closes it.
               */
              reloadGroups();
            }}
          />
        ) : (
          <></>
        )}
      </Fragment>
    );
  };

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    /*
     * Only the very first read, when there is nothing on screen to keep. Every
     * later refetch leaves the page standing - a loader in place of the card
     * would unmount the pane, which would then re-read the selected group's
     * resources for no reason at all.
     */
    if (isLoading && groups.length === 0) {
      return <ComponentLoader />;
    }

    /*
     * Only when there is nothing to fall back to. Once a hierarchy is on screen
     * a failed refetch is reported beside it rather than in place of it - see
     * the navigator's error slot.
     */
    if (error && groups.length === 0) {
      return <ErrorMessage message={error} onRefreshClick={reloadGroups} />;
    }

    /*
     * A status page with no groups is the common, simple case: one flat list of
     * monitors. It gets exactly that, with no navigator beside it - a sidebar
     * holding a single entry is a choice nobody has to make. Creating the first
     * group is still one click away, in the header and in the empty state.
     */
    if (groups.length === 0) {
      return (
        <Card
          title="Resources"
          description="The monitors visitors see on this status page, in the order they see them. Create a group to split a longer page into sections."
          buttons={getCardButtons()}
        >
          {getPanel()}
        </Card>
      );
    }

    return (
      <Card
        title="Resources"
        description="Everything visitors see on this status page. Pick a group on the left to edit what is in it; drag a monitor to change the order."
        buttons={getCardButtons()}
      >
        <div className="lg:grid lg:grid-cols-[18rem_1fr] lg:gap-6">
          <aside
            className={`${
              isPaneOpenOnMobile ? "hidden" : "block"
            } lg:block lg:border-r lg:border-gray-100 lg:pr-5`}
            data-testid="status-page-resource-navigator-pane"
          >
            {getNavigator()}
          </aside>

          <section
            className={`${
              isPaneOpenOnMobile ? "block" : "hidden"
            } lg:block lg:min-w-0`}
            data-testid="status-page-resource-detail-pane"
          >
            {getPanel(() => {
              setIsPaneOpenOnMobile(false);
            })}
          </section>
        </div>
      </Card>
    );
  };

  /*
   * The modals are rendered beside whatever the body turned out to be, never
   * inside a branch of it. A CSV import on a status page with no groups yet
   * refetches the hierarchy the moment it finishes, and an early return keyed
   * on "no groups and loading" would unmount the open modal - taking the
   * per-row results the operator had not read yet with it.
   */
  return (
    <Fragment>
      {getBody()}
      {getModals()}
    </Fragment>
  );
};

export default StatusPageResources;
