import GridResourceEditor from "../../../Components/StatusPage/GridResourceEditor";
import ResourceGroupRow from "../../../Components/StatusPage/ResourceGroupRow";
import StatusPageResourceListPanel from "../../../Components/StatusPage/StatusPageResourceListPanel";
import { getStatusPageResourceAdvancedFields } from "../../../Components/StatusPage/StatusPageResourceFormFields";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
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
import StatusPageResourceEditorTreeUtil, {
  StatusPageGroupSearchMatch,
  StatusPageGroupSearchResult,
  StatusPageResourceCountIndex,
  StatusPageResourceEditorNode,
} from "Common/Utils/StatusPage/ResourceEditorTree";
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
 * The Resources tab: where monitors are attached to a status page, and to the
 * group hierarchy the operator built on the Groups tab.
 *
 * It used to render one resource table per group, eagerly. A ModelTable fetches
 * the moment it mounts, so a status page with fifteen hundred groups opened
 * fifteen hundred tables and fired fifteen hundred list requests at once - a
 * gigabyte of browser memory and then a network error (issue #3042).
 *
 * So the tab is a tree now, and the tree is closed. A closed group renders one
 * row and nothing else: not its resources, not its sub groups, no request.
 *
 * Loading the tab costs three requests whatever the hierarchy size: the groups,
 * one pass over the resources to work out the counts each row shows, and the
 * Uncategorized bucket, which is the one section that opens by default. After
 * that it is one request per group the operator actually opens - and those
 * groups keep the counts up to date themselves as they are edited, so nothing
 * ever re-reads the whole status page again.
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
    StatusPageResourceEditorTreeUtil.getEmptyResourceCountIndex(),
  );

  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    new Set<string>(),
  );
  /*
   * Search results are a different view of the same groups, so they get their
   * own expansion state. Sharing one set would mean that typing a character
   * unmounts every open group and immediately remounts whichever of them
   * matched - a burst of one list request per open group, per keystroke.
   */
  const [expandedSearchGroupIds, setExpandedSearchGroupIds] = useState<
    Set<string>
  >(new Set<string>());
  const [isUngroupedExpanded, setIsUngroupedExpanded] = useState<boolean>(true);
  /*
   * How many sibling rows each level of the tree is currently drawing, keyed by
   * the parent group's id ("" for the top level). See getTreeNodes.
   */
  const [visibleRowCountByLevel, setVisibleRowCountByLevel] = useState<
    Record<string, number>
  >({});
  const [searchText, setSearchText] = useState<string>("");
  const [addMonitorGroup, setAddMonitorGroup] = useState<boolean>(false);

  const permissions: Array<Permission> | null =
    PermissionUtil.getAllPermissions();
  const canCreateStatusPageResource: boolean = Boolean(
    User.isMasterAdmin() ||
      (permissions &&
        new StatusPageResource().hasCreatePermissions(permissions)),
  );

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
   * tree can say "40 resources" on a row without opening it. A count request
   * per group would be the same stampede in a cheaper disguise, and the server
   * has no group-by endpoint to ask instead.
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
        StatusPageResourceEditorTreeUtil.buildResourceCountIndex({
          statusPageResources: listResult.data,
          totalCount: listResult.count,
        }),
      );
    } catch {
      // The tree still renders; it just renders without the count badges.
      setCountIndex(
        StatusPageResourceEditorTreeUtil.getEmptyResourceCountIndex(),
      );
    }
  };

  useEffect(() => {
    fetchGroups().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  useEffect(() => {
    fetchResourceCounts().catch(() => {
      setCountIndex(
        StatusPageResourceEditorTreeUtil.getEmptyResourceCountIndex(),
      );
    });
  }, []);

  type OnGroupResourceCountLoadedFunction = (
    statusPageGroupId: string | null,
    count: number,
  ) => void;

  /*
   * An open group reporting its own size, which is the only number that can
   * have changed while it was open.
   *
   * The alternative - re-reading every resource on the status page after every
   * create, delete and bulk delete - is a megabyte or so of JSON per edit on a
   * page with ten thousand resources, and it races with itself if two edits
   * land close together.
   */
  const onGroupResourceCountLoaded: OnGroupResourceCountLoadedFunction = (
    statusPageGroupId: string | null,
    count: number,
  ): void => {
    setCountIndex((current: StatusPageResourceCountIndex) => {
      return StatusPageResourceEditorTreeUtil.withGroupResourceCount({
        countIndex: current,
        statusPageGroupId: statusPageGroupId,
        count: count,
      });
    });
  };

  const groupIndex: StatusPageGroupTreeIndex =
    useMemo((): StatusPageGroupTreeIndex => {
      return StatusPageGroupTreeUtil.buildIndex({ statusPageGroups: groups });
    }, [groups]);

  const tree: Array<StatusPageResourceEditorNode> =
    useMemo((): Array<StatusPageResourceEditorNode> => {
      return StatusPageResourceEditorTreeUtil.buildTree({
        statusPageGroups: groups,
        countIndex: countIndex,
        index: groupIndex,
      });
    }, [groups, countIndex, groupIndex]);

  const searchResult: StatusPageGroupSearchResult =
    useMemo((): StatusPageGroupSearchResult => {
      return StatusPageResourceEditorTreeUtil.searchGroups({
        statusPageGroups: groups,
        searchText: searchText,
        index: groupIndex,
      });
    }, [groups, searchText, groupIndex]);

  const isSearching: boolean = searchText.trim().length > 0;

  /* Which set a row reads and writes depends on which view it is drawn in. */
  const openGroupIds: Set<string> = isSearching
    ? expandedSearchGroupIds
    : expandedGroupIds;

  type ToggleGroupFunction = (groupId: string) => void;

  const toggleGroup: ToggleGroupFunction = (groupId: string): void => {
    const setOpenGroupIds: React.Dispatch<React.SetStateAction<Set<string>>> =
      isSearching ? setExpandedSearchGroupIds : setExpandedGroupIds;

    setOpenGroupIds((current: Set<string>) => {
      const next: Set<string> = new Set<string>(current);

      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      return next;
    });
  };

  /* ------------------------------------------------------------------ */
  /* The resource form, shared by every panel on the page.               */
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

  type GetGroupPanelFunction = (
    statusPageGroup: StatusPageGroup,
  ) => ReactElement;

  const getGroupPanel: GetGroupPanelFunction = (
    statusPageGroup: StatusPageGroup,
  ): ReactElement => {
    const groupId: ObjectID | null = statusPageGroup.id;

    if (!groupId) {
      return <></>;
    }

    const groupIdString: string = groupId.toString();

    if (statusPageGroup.viewMode === StatusPageGroupViewMode.Grid) {
      return (
        <GridResourceEditor
          group={statusPageGroup}
          statusPageId={modelId}
          projectId={projectId}
          canCreateStatusPageResource={canCreateStatusPageResource}
          baseFormFields={formFields}
          formSteps={FORM_STEPS}
          onResourceCountLoaded={(count: number) => {
            onGroupResourceCountLoaded(groupIdString, count);
          }}
        />
      );
    }

    return (
      <StatusPageResourceListPanel
        statusPageId={modelId}
        projectId={projectId}
        statusPageGroupId={groupId}
        panelKey={groupIdString}
        title={statusPageGroup.name || "Untitled group"}
        description={getGroupDescription(statusPageGroup)}
        canCreateStatusPageResource={canCreateStatusPageResource}
        isMonitorGroupsFeatureEnabled={Boolean(
          props.currentProject?.isFeatureFlagMonitorGroupsEnabled,
        )}
        formFields={formFields}
        formSteps={FORM_STEPS}
        onResourceCountLoaded={(count: number) => {
          onGroupResourceCountLoaded(groupIdString, count);
        }}
      />
    );
  };

  type GetGroupDescriptionFunction = (
    statusPageGroup: StatusPageGroup,
  ) => string;

  /*
   * A nested group's panel says where it sits, because the row above it only
   * shows the leaf name and "Unit 0152" is not a unique thing to be looking at.
   */
  const getGroupDescription: GetGroupDescriptionFunction = (
    statusPageGroup: StatusPageGroup,
  ): string => {
    const path: string = StatusPageGroupHierarchyViewUtil.getGroupPathLabel({
      statusPageGroup: statusPageGroup,
      statusPageGroups: groups,
      index: groupIndex,
    });

    return path === statusPageGroup.name ? "" : path;
  };

  interface GroupRowData {
    statusPageGroup: StatusPageGroup;
    depth: number;
    path?: string | undefined;
    /*
     * How many resources the row reports. In the tree this is the whole
     * subtree; in a flat search result it is the group's own.
     */
    resourceCount: number;
    subGroupCount: number;
    childrenElement?: ReactElement | undefined;
  }

  type GetGroupRowFunction = (data: GroupRowData) => ReactElement;

  const getGroupRow: GetGroupRowFunction = (
    data: GroupRowData,
  ): ReactElement => {
    const groupId: string = data.statusPageGroup._id?.toString() || "";
    const isExpanded: boolean = openGroupIds.has(groupId);

    /*
     * The rolled up number, not the group's own: a group that holds nothing
     * itself but has a hundred resources nested under it is not empty, and
     * closing it hides all hundred.
     */
    const resourceCountLabel: string | null =
      StatusPageResourceEditorTreeUtil.getResourceCountLabel({
        count: data.resourceCount,
        countIndex: countIndex,
      });

    return (
      <ResourceGroupRow
        key={groupId}
        depth={data.depth}
        name={data.statusPageGroup.name || "Untitled group"}
        path={data.path}
        viewMode={data.statusPageGroup.viewMode}
        resourceCountLabel={resourceCountLabel}
        subGroupCountLabel={StatusPageResourceEditorTreeUtil.getSubGroupCountLabel(
          {
            subGroupCount: data.subGroupCount,
          },
        )}
        isExpanded={isExpanded}
        onToggle={() => {
          toggleGroup(groupId);
        }}
      >
        <>
          {getGroupPanel(data.statusPageGroup)}
          {data.childrenElement || <></>}
        </>
      </ResourceGroupRow>
    );
  };

  type GetTreeNodesFunction = (
    nodes: Array<StatusPageResourceEditorNode>,
    levelKey: string,
  ) => ReactElement;

  const getTreeNodes: GetTreeNodesFunction = (
    nodes: Array<StatusPageResourceEditorNode>,
    levelKey: string,
  ): ReactElement => {
    /*
     * Closing a group hides its sub groups as well as its resources, so the
     * tree normally only ever has a handful of rows on screen. One shape gets
     * past that: a status page whose groups are all at the top level, where
     * "closed" hides nothing. Every level therefore draws a page of siblings at
     * a time.
     */
    const visibleCount: number =
      visibleRowCountByLevel[levelKey] ||
      StatusPageResourceEditorTreeUtil.RowsPerLevelPage;

    const visibleNodes: Array<StatusPageResourceEditorNode> = nodes.slice(
      0,
      visibleCount,
    );

    const remainingCount: number = nodes.length - visibleNodes.length;

    return (
      <>
        {visibleNodes.map((node: StatusPageResourceEditorNode) => {
          const groupId: string = node.group._id?.toString() || "";
          const isExpanded: boolean = openGroupIds.has(groupId);

          return getGroupRow({
            statusPageGroup: node.group,
            depth: node.depth,
            resourceCount: node.subtreeResourceCount,
            subGroupCount: node.subGroupCount,
            /*
             * Sub groups are rendered by their parent's open body, so a closed
             * group costs one row no matter how much hangs off it. This is what
             * keeps a fifteen hundred group page to a handful of rows.
             */
            childrenElement:
              isExpanded && node.children.length > 0
                ? getTreeNodes(node.children, groupId)
                : undefined,
          });
        })}

        {remainingCount > 0 ? (
          <div
            className="bg-gray-50 px-4 py-2.5 text-center"
            data-testid="status-page-resource-group-show-more"
          >
            <Button
              title={`Show ${Math.min(
                remainingCount,
                StatusPageResourceEditorTreeUtil.RowsPerLevelPage,
              ).toLocaleString()} more of ${remainingCount.toLocaleString()}`}
              icon={IconProp.ChevronDown}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                setVisibleRowCountByLevel((current: Record<string, number>) => {
                  return {
                    ...current,
                    [levelKey]:
                      visibleCount +
                      StatusPageResourceEditorTreeUtil.RowsPerLevelPage,
                  };
                });
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </>
    );
  };

  type GetSearchResultsFunction = () => ReactElement;

  const getSearchResults: GetSearchResultsFunction = (): ReactElement => {
    if (searchResult.matches.length === 0) {
      return (
        <div
          className="px-4 py-10 text-center text-sm text-gray-500"
          role="status"
          data-testid="status-page-resource-group-search-empty"
        >
          No groups match &quot;{searchText}&quot;.
        </div>
      );
    }

    return (
      <>
        <div className="sr-only" role="status">
          {searchResult.totalMatchCount.toLocaleString()}{" "}
          {searchResult.totalMatchCount === 1 ? "group" : "groups"} match &quot;
          {searchText}&quot;.
        </div>
        {searchResult.matches.map((match: StatusPageGroupSearchMatch) => {
          const ownCount: number =
            StatusPageResourceEditorTreeUtil.getOwnResourceCount({
              statusPageGroup: match.group,
              countIndex: countIndex,
            });

          /*
           * A search result is drawn flat, out of its place in the tree, so it
           * reports what the group itself holds rather than what its subtree
           * holds - the subtree is not on the screen next to it to compare
           * against.
           */
          /*
           * No sub group badge here. The flat result list does not render a
           * match's children, and the badge is the same one the tree uses to
           * mean "open this to see them" - it would be promising something
           * this view cannot deliver.
           */
          return getGroupRow({
            statusPageGroup: match.group,
            depth: 0,
            path: match.path,
            resourceCount: ownCount,
            subGroupCount: 0,
          });
        })}
        {searchResult.isTruncated ? (
          <div
            className="bg-amber-50 px-4 py-2.5 text-center text-xs text-amber-800"
            data-testid="status-page-resource-group-search-truncated"
          >
            Showing the first {searchResult.matches.length} of{" "}
            {searchResult.totalMatchCount.toLocaleString()} matching groups.
            Narrow your search to see the rest.
          </div>
        ) : (
          <></>
        )}
      </>
    );
  };

  type GetToolbarFunction = () => ReactElement;

  const getToolbar: GetToolbarFunction = (): ReactElement => {
    const canExpandAll: boolean = StatusPageResourceEditorTreeUtil.canExpandAll(
      {
        groupCount: groups.length,
      },
    );

    return (
      <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-80">
          {/* Placeholders are not accessible names, and this input has no visible label. */}
          <label
            htmlFor="status-page-resource-group-search"
            className="sr-only"
            id="status-page-resource-group-search-label"
          >
            Search groups by name
          </label>
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
            <Icon icon={IconProp.Search} className="h-4 w-4" />
          </span>
          <Input
            id="status-page-resource-group-search"
            ariaLabelledby="status-page-resource-group-search-label"
            value={searchText}
            placeholder="Search groups by name..."
            dataTestId="status-page-resource-group-search"
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onChange={(value: string) => {
              setSearchText(value);
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className="mr-1 text-xs text-gray-500 tabular-nums"
            data-testid="status-page-resource-stats"
          >
            {groups.length.toLocaleString()}{" "}
            {groups.length === 1 ? "group" : "groups"}
            {countIndex.isComplete
              ? ` · ${countIndex.totalCount.toLocaleString()} ${
                  countIndex.totalCount === 1 ? "resource" : "resources"
                }`
              : ""}
          </span>

          {canExpandAll ? (
            <Button
              title="Expand All"
              icon={IconProp.ChevronDown}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.OUTLINE}
              dataTestId="expand-all-groups"
              onClick={() => {
                setIsUngroupedExpanded(true);
                setExpandedGroupIds(
                  new Set<string>(
                    StatusPageResourceEditorTreeUtil.getGroupIdsInTreeOrder(
                      tree,
                    ),
                  ),
                );
              }}
            />
          ) : (
            <></>
          )}

          {/*
           * Both buttons cover the Uncategorized section too. It is one more
           * open section holding one more mounted table, and a "Collapse All"
           * that leaves it open - or sits disabled while it is the only thing
           * open - is not telling the truth about what it does.
           */}
          <Button
            title="Collapse All"
            icon={IconProp.ChevronRight}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            disabled={expandedGroupIds.size === 0 && !isUngroupedExpanded}
            dataTestId="collapse-all-groups"
            onClick={() => {
              setIsUngroupedExpanded(false);
              setExpandedGroupIds(new Set<string>());
            }}
          />
        </div>
      </div>
    );
  };

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  /*
   * A status page with no groups at all is the common, simple case - one flat
   * list of monitors. It gets exactly that, with none of the tree chrome.
   */
  if (groups.length === 0) {
    return (
      <Fragment>
        <StatusPageResourceListPanel
          statusPageId={modelId}
          projectId={projectId}
          panelKey="ungrouped"
          title="Status Page Resources"
          description="Monitors and monitor groups that will be shown on this status page. Create groups on the Groups tab to organise them."
          canCreateStatusPageResource={canCreateStatusPageResource}
          isMonitorGroupsFeatureEnabled={Boolean(
            props.currentProject?.isFeatureFlagMonitorGroupsEnabled,
          )}
          formFields={formFields}
          formSteps={FORM_STEPS}
          onResourceCountLoaded={(count: number) => {
            onGroupResourceCountLoaded(null, count);
          }}
          testId="ungrouped-status-page-resource-panel"
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <Card
        title="Status Page Resources"
        description="Groups are closed until you open one, so a large status page stays fast. Open a group to see and add the monitors inside it."
        buttons={[
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
        ]}
      >
        <>
          {getToolbar()}

          <div
            className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200"
            data-testid="status-page-resource-tree"
          >
            {isSearching ? (
              getSearchResults()
            ) : (
              <>
                <ResourceGroupRow
                  depth={0}
                  name="Uncategorized"
                  resourceCountLabel={StatusPageResourceEditorTreeUtil.getResourceCountLabel(
                    {
                      count: countIndex.ungroupedCount,
                      countIndex: countIndex,
                    },
                  )}
                  isExpanded={isUngroupedExpanded}
                  testId="uncategorized-status-page-resource-row"
                  onToggle={() => {
                    setIsUngroupedExpanded(!isUngroupedExpanded);
                  }}
                >
                  <StatusPageResourceListPanel
                    statusPageId={modelId}
                    projectId={projectId}
                    panelKey="ungrouped"
                    title="Uncategorized Resources"
                    description="Monitors on this status page that are not in any group."
                    canCreateStatusPageResource={canCreateStatusPageResource}
                    isMonitorGroupsFeatureEnabled={Boolean(
                      props.currentProject?.isFeatureFlagMonitorGroupsEnabled,
                    )}
                    formFields={formFields}
                    formSteps={FORM_STEPS}
                    onResourceCountLoaded={(count: number) => {
                      onGroupResourceCountLoaded(null, count);
                    }}
                    testId="ungrouped-status-page-resource-panel"
                  />
                </ResourceGroupRow>

                {getTreeNodes(tree, "")}
              </>
            )}
          </div>
        </>
      </Card>
    </Fragment>
  );
};

export default StatusPageResources;
