import StatusPageResourcePanel from "../../../Components/StatusPage/StatusPageResourcePanel";
import { getStatusPageResourceAdvancedFields } from "../../../Components/StatusPage/StatusPageResourceFormFields";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import Icon from "Common/UI/Components/Icon/Icon";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import ResourceGroupNavigator from "Common/UI/Components/StatusPage/ResourceGroupNavigator";
import API from "Common/UI/Utils/API/API";
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

/*
 * One level of children is open on arrival - enough to show that the hierarchy
 * nests, without unfolding a thousand-group status page into a wall of names.
 * Same as the Groups tab, so the same page looks the same on both.
 */
const AUTO_EXPAND_DEPTH: number = 1;

/*
 * Status Page > Resources: where monitors are attached to a status page and to
 * the group hierarchy built on the Groups tab.
 *
 * This tab used to be a tree of groups where opening one mounted a whole
 * ModelTable inside the row - its own card, title, description, create button,
 * overflow menu, checkbox column and pagination footer, nested one or two
 * frames deep inside the page's own card. Two groups open meant two of those
 * stacked on top of each other, and the answer to "what is in this group and
 * how do I add to it?" was buried in chrome that was mostly about being a
 * table.
 *
 * So it is an explorer now. The hierarchy is on the left, as somewhere to go;
 * one group's contents are on the right, as a list you can drag into order,
 * with one header naming the group and one row of buttons acting on it.
 *
 * The property that made the tree necessary in the first place survives, and is
 * stronger: exactly one group's resources are loaded at a time. Opening the tab
 * costs two requests whatever the hierarchy size - the groups, and one pass
 * over the resources to work out the counts the navigator shows - plus one for
 * whichever group is selected. Nothing about a fifteen hundred group status
 * page can make that number grow (issue #3042).
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

  const permissions: Array<Permission> = PermissionUtil.getAllPermissions();
  const resourceModel: StatusPageResource = new StatusPageResource();
  const isMasterAdmin: boolean = User.isMasterAdmin();

  /*
   * The list is hand rolled, so the permission checks ModelTable used to make
   * on the page's behalf have to be made here.
   */
  const canCreate: boolean =
    isMasterAdmin || resourceModel.hasCreatePermissions(permissions);
  const canEdit: boolean =
    isMasterAdmin || resourceModel.hasUpdatePermissions(permissions);
  const canDelete: boolean =
    isMasterAdmin || resourceModel.hasDeletePermissions(permissions);

  const fetchGroups: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
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
            name: true,
            _id: true,
            order: true,
            parentStatusPageGroupId: true,
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
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
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

  useEffect(() => {
    fetchGroups().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });

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

  const selectedGroupSubGroupCount: number = useMemo((): number => {
    if (!selection.statusPageGroupId) {
      return 0;
    }

    return StatusPageGroupTreeUtil.getChildGroups({
      statusPageGroupId: selection.statusPageGroupId,
      statusPageGroups: groups,
      index: groupIndex,
    }).length;
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
     * and read another's - which is the exact cost this tab exists to avoid.
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
        subGroupCount={selectedGroupSubGroupCount}
        onBreadcrumbClick={(statusPageGroupId: string) => {
          select({
            type: StatusPageResourceSelectionType.Group,
            statusPageGroupId: statusPageGroupId,
          });
        }}
        hasGroups={groups.length > 0}
        isMonitorGroupsFeatureEnabled={Boolean(
          props.currentProject?.isFeatureFlagMonitorGroupsEnabled,
        )}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
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
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <Input
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
         * Opening every group costs a re-render and nothing else - no group's
         * resources are read until it is selected - so the only reason to
         * withdraw the offer is that a navigator with hundreds of rows in it is
         * no longer a navigator.
         */}
        <div className="mb-2 flex items-center justify-end gap-2">
          {StatusPageResourceExplorerUtil.canExpandAll({
            groupCount: groups.length,
          }) ? (
            <button
              type="button"
              data-testid="status-page-resource-expand-all"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              onClick={() => {
                setExpandedGroupIds(
                  new Set<string>(
                    StatusPageResourceExplorerUtil.getAllGroupIds({
                      statusPageGroups: groups,
                      index: groupIndex,
                    }),
                  ),
                );
              }}
            >
              <Icon icon={IconProp.ChevronDown} className="h-3 w-3" />
              Expand all
            </button>
          ) : (
            <></>
          )}

          <button
            type="button"
            data-testid="status-page-resource-collapse-all"
            disabled={expandedGroupIds.size === 0}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              setExpandedGroupIds(new Set<string>());
            }}
          >
            <Icon icon={IconProp.ChevronRight} className="h-3 w-3" />
            Collapse all
          </button>
        </div>

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

  if (isLoading) {
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

  const cardButtons: Array<{
    title: string;
    buttonStyle: ButtonStyleType;
    icon: IconProp;
    onClick: () => void;
  }> = [
    {
      title: "Manage Groups",
      buttonStyle: ButtonStyleType.OUTLINE,
      icon: IconProp.Folder,
      onClick: () => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGE_VIEW_GROUPS] as Route,
            { modelId: modelId },
          ),
        );
      },
    },
  ];

  /*
   * A status page with no groups is the common, simple case: one flat list of
   * monitors. It gets exactly that, with no navigator beside it - a sidebar
   * holding a single entry is a choice nobody has to make.
   */
  if (groups.length === 0) {
    return (
      <Fragment>
        <Card
          title="Status Page Resources"
          description="The monitors visitors see on this status page, in the order they see them. Create groups to split a longer page into sections."
          buttons={cardButtons}
        >
          {getPanel()}
        </Card>
      </Fragment>
    );
  }

  return (
    <Fragment>
      <Card
        title="Status Page Resources"
        description="Pick a group on the left to see and edit the monitors in it. Drag a monitor to change the order visitors see."
        buttons={cardButtons}
      >
        <div className="lg:grid lg:grid-cols-[17rem_1fr] lg:gap-6">
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
    </Fragment>
  );
};

export default StatusPageResources;
