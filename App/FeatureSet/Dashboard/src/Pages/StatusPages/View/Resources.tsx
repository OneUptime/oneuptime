import MonitorElement from "../../../Components/Monitor/Monitor";
import MonitorGroupElement from "../../../Components/MonitorGroup/MonitorGroupElement";
import BulkAddStatusPageMonitorsModal from "../../../Components/StatusPage/BulkAddStatusPageMonitorsModal";
import GridResourceEditor from "../../../Components/StatusPage/GridResourceEditor";
import { getStatusPageResourceAdvancedFields } from "../../../Components/StatusPage/StatusPageResourceFormFields";
import PageComponentProps from "../../PageComponentProps";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Columns from "Common/UI/Components/ModelTable/Column";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Pagination from "Common/UI/Components/Pagination/Pagination";
import FieldType from "Common/UI/Components/Types/FieldType";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import User from "Common/UI/Utils/User";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import {
  STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
  StatusPageGroupSection,
  StatusPageGroupSectionPage,
  buildStatusPageGroupSections,
  filterStatusPageGroupSections,
  getStatusPageGroupSectionPage,
  isStatusPageGroupSectionExpanded,
  shouldExpandStatusPageGroupSectionsByDefault,
} from "../../../Utils/StatusPageGroupSections";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import Link from "Common/UI/Components/Link/Link";
import ProjectUtil from "Common/UI/Utils/Project";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import IconProp from "Common/Types/Icon/IconProp";

interface BulkAddTarget {
  statusPageGroupId: ObjectID | null;
}

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [groups, setGroups] = useState<Array<StatusPageGroup>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [addMonitorGroup, setAddMonitorGroup] = useState<boolean>(false);
  const [bulkAddTarget, setBulkAddTarget] = useState<BulkAddTarget | null>(
    null,
  );
  const [bulkAddRefreshCounter, setBulkAddRefreshCounter] = useState<number>(0);

  /*
   * Which slice of the groups is on screen, and which of those sections the
   * user has opened or closed by hand. Everything about why the page is
   * windowed at all is in Utils/StatusPageGroupSections - the short version is
   * that each open section is a resource table, and each resource table is two
   * requests, so a status page with a thousand groups cannot render them all.
   */
  const [groupSearchText, setGroupSearchText] = useState<string>("");
  const [groupSectionPageNumber, setGroupSectionPageNumber] =
    useState<number>(1);
  const [expandedGroupIdOverrides, setExpandedGroupIdOverrides] = useState<
    Record<string, boolean>
  >({});

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
            projectId: props.currentProject!.id!,
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

  useEffect(() => {
    fetchGroups().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const getFooterForMonitor: GetReactElementFunction = (): ReactElement => {
    if (props.currentProject?.isFeatureFlagMonitorGroupsEnabled) {
      if (!addMonitorGroup) {
        return (
          <Link
            onClick={() => {
              setAddMonitorGroup(true);
            }}
            className="mt-1 text-sm text-gray-500 underline"
          >
            <div>
              <p> Add a Monitor Group instead. </p>
            </div>
          </Link>
        );
      }
      return (
        <Link
          onClick={() => {
            setAddMonitorGroup(false);
          }}
          className="mt-1 text-sm text-gray-500 underline"
        >
          <div>
            <p> Add a Monitor instead. </p>
          </div>
        </Link>
      );
    }

    return <></>;
  };

  let formFields: Array<ModelField<StatusPageResource>> = [
    {
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
    },
  ];

  if (addMonitorGroup) {
    formFields = [
      {
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
      },
    ];
  }

  formFields = formFields.concat([
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
  ]);

  /*
   * Every group, in the order the status page renders them (a parent directly
   * above the groups nested under it) and labelled with its full path, because
   * two groups at different levels can easily share a name. One tree walk does
   * both for all of them.
   */
  const allGroupSections: Array<StatusPageGroupSection> = useMemo(() => {
    return buildStatusPageGroupSections({ statusPageGroups: groups });
  }, [groups]);

  const isGroupSectionExpandedByDefault: boolean =
    shouldExpandStatusPageGroupSectionsByDefault({
      totalSectionCount: allGroupSections.length,
      pageSize: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
    });

  const matchingGroupSections: Array<StatusPageGroupSection> = useMemo(() => {
    return filterStatusPageGroupSections({
      sections: allGroupSections,
      searchText: groupSearchText,
    });
  }, [allGroupSections, groupSearchText]);

  const groupSectionPage: StatusPageGroupSectionPage =
    getStatusPageGroupSectionPage({
      sections: matchingGroupSections,
      pageNumber: groupSectionPageNumber,
      pageSize: STATUS_PAGE_GROUP_SECTIONS_PER_PAGE,
    });

  type SetGroupSectionExpandedFunction = (
    groupId: string,
    isExpanded: boolean,
  ) => void;

  const setGroupSectionExpanded: SetGroupSectionExpandedFunction = (
    groupId: string,
    isExpanded: boolean,
  ): void => {
    setExpandedGroupIdOverrides((overrides: Record<string, boolean>) => {
      return { ...overrides, [groupId]: isExpanded };
    });
  };

  type GetResourceTableCardButtonsFunction = (
    section: StatusPageGroupSection | null,
  ) => Array<CardButtonSchema>;

  const getResourceTableCardButtons: GetResourceTableCardButtonsFunction = (
    section: StatusPageGroupSection | null,
  ): Array<CardButtonSchema> => {
    const buttons: Array<CardButtonSchema> = [];

    if (canCreateStatusPageResource) {
      buttons.push({
        title: "Add Multiple Monitors",
        buttonStyle: ButtonStyleType.OUTLINE,
        icon: IconProp.Add,
        onClick: () => {
          setBulkAddTarget({
            statusPageGroupId: section?.group.id || null,
          });
        },
      });
    }

    /*
     * Only group sections collapse. The ungrouped table is the one table this
     * page always shows, and there is nothing above it to collapse into.
     */
    if (section) {
      buttons.push({
        title: "Hide",
        buttonStyle: ButtonStyleType.OUTLINE,
        icon: IconProp.ChevronUp,
        onClick: () => {
          setGroupSectionExpanded(section.groupId, false);
        },
      });
    }

    return buttons;
  };

  type GetModelTableFunction = (
    section: StatusPageGroupSection | null,
  ) => ReactElement;

  const getModelTable: GetModelTableFunction = (
    section: StatusPageGroupSection | null,
  ): ReactElement => {
    const statusPageGroup: StatusPageGroup | null = section?.group || null;
    const statusPageGroupId: ObjectID | null = statusPageGroup?.id || null;
    const statusPageGroupName: string | null = section?.pathLabel || null;

    const tableColumns: Array<Columns<StatusPageResource>> = [
      {
        field: {
          monitor: {
            name: true,
            _id: true,
            projectId: true,
          },
        },
        title: props.currentProject?.isFeatureFlagMonitorGroupsEnabled
          ? "Resource"
          : "Monitor",
        type: FieldType.Entity,

        getElement: (item: StatusPageResource): ReactElement => {
          if (item["monitor"]) {
            return (
              <MonitorElement
                monitor={item["monitor"]}
                showIcon={
                  props.currentProject?.isFeatureFlagMonitorGroupsEnabled ||
                  false
                }
              />
            );
          }

          if (item["monitorGroup"]) {
            return (
              <MonitorGroupElement
                monitorGroup={item["monitorGroup"]}
                showIcon={
                  props.currentProject?.isFeatureFlagMonitorGroupsEnabled ||
                  false
                }
              />
            );
          }

          return <></>;
        },
      },
      {
        field: {
          displayName: true,
        },
        title: "Display Name",
        type: FieldType.Text,
      },
    ];

    const tableFilters: Array<Filter<StatusPageResource>> = [
      {
        field: {
          monitor: {
            name: true,
          },
        },
        title: "Monitor",
        type: FieldType.Entity,
        filterEntityType: Monitor,
        filterQuery: {
          projectId: ProjectUtil.getCurrentProjectId()!,
        },
        filterDropdownField: {
          label: "name",
          value: "_id",
        },
      },
      {
        field: {
          displayName: true,
        },
        title: "Display Name",
        type: FieldType.Text,
      },
    ];

    return (
      <ModelTable<StatusPageResource>
        modelType={StatusPageResource}
        id={`status-page-group-${statusPageGroupId?.toString() || ""}`}
        userPreferencesKey="status-page-resource-table"
        saveFilterProps={{
          tableId: `status-page-resources-table-${statusPageGroupId?.toString() || "ungrouped"}`,
        }}
        isDeleteable={true}
        name="Status Page > Resources"
        sortBy="order"
        showViewIdButton={true}
        sortOrder={SortOrder.Ascending}
        isCreateable={true}
        isViewable={false}
        isEditable={true}
        query={{
          statusPageId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
          statusPageGroupId: statusPageGroupId!,
        }}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        onBeforeCreate={(
          item: StatusPageResource,
        ): Promise<StatusPageResource> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.statusPageId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);

          if (statusPageGroupId) {
            item.statusPageGroupId = statusPageGroupId;
          }

          return Promise.resolve(item);
        }}
        cardProps={{
          title: `${
            statusPageGroupName
              ? statusPageGroupName + " - "
              : groups.length > 0
                ? "Uncategorized - "
                : ""
          }Status Page Resources`,
          description: "Resources that will be shown on the page",
          buttons: getResourceTableCardButtons(section),
        }}
        noItemsMessage={
          "No status page resources created for this status page."
        }
        formSteps={[
          {
            title: "Monitor Details",
            id: "monitor-details",
          },
          {
            title: "Advanced",
            id: "advanced",
          },
        ]}
        formFields={formFields}
        showRefreshButton={true}
        refreshToggle={`bulk-add-${bulkAddRefreshCounter}`}
        viewPageRoute={Navigation.getCurrentRoute()}
        selectMoreFields={{
          monitorGroup: {
            name: true,
            _id: true,
            projectId: true,
          },
        }}
        filters={tableFilters}
        columns={tableColumns}
      />
    );
  };

  type GetGroupSectionFunction = (
    section: StatusPageGroupSection,
  ) => ReactElement;

  /*
   * A closed section. This is the whole point of the windowing: it renders a
   * header and nothing else, so the group's resource table - and the list and
   * count requests that table fires the instant it mounts - does not exist
   * until someone asks for it.
   */
  const getCollapsedGroupSection: GetGroupSectionFunction = (
    section: StatusPageGroupSection,
  ): ReactElement => {
    const expand: () => void = (): void => {
      setGroupSectionExpanded(section.groupId, true);
    };

    /*
     * The whole row is clickable for convenience, but the button inside it is
     * the real control - it is what a keyboard reaches and what a screen
     * reader announces, so the row itself stays a plain div rather than
     * nesting one control inside another.
     */
    return (
      <div
        className="mb-5 bg-white border border-gray-200 rounded-xl shadow-sm px-5 md:px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
        onClick={expand}
      >
        <div className="flex items-center min-w-0">
          <Icon
            icon={IconProp.ChevronRight}
            className="w-4 h-4 text-gray-500 mr-3 flex-shrink-0"
          />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-6 text-gray-900 truncate">
              {section.pathLabel}
            </h2>
            <p className="mt-1 text-sm text-gray-500 hidden md:block">
              Resources that will be shown on the page
            </p>
          </div>
        </div>
        <div className="ml-4 flex-shrink-0">
          <Button
            title="Show Resources"
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            icon={IconProp.ChevronDown}
            onClick={expand}
          />
        </div>
      </div>
    );
  };

  const getGroupSection: GetGroupSectionFunction = (
    section: StatusPageGroupSection,
  ): ReactElement => {
    const isExpanded: boolean = isStatusPageGroupSectionExpanded({
      groupId: section.groupId,
      expandedOverrides: expandedGroupIdOverrides,
      isExpandedByDefault: isGroupSectionExpandedByDefault,
    });

    if (!isExpanded) {
      return getCollapsedGroupSection(section);
    }

    if (section.group.viewMode === StatusPageGroupViewMode.Grid) {
      return (
        <GridResourceEditor
          group={section.group}
          groupPathLabel={section.pathLabel}
          statusPageId={modelId}
          projectId={new ObjectID(props.currentProject!._id!)}
          currentProject={props.currentProject!}
          canCreateStatusPageResource={canCreateStatusPageResource}
          baseFormFields={formFields}
          formSteps={[
            { title: "Monitor Details", id: "monitor-details" },
            { title: "Advanced", id: "advanced" },
          ]}
          onCollapse={() => {
            setGroupSectionExpanded(section.groupId, false);
          }}
        />
      );
    }

    return getModelTable(section);
  };

  /*
   * Only shown once the groups outgrow a single page. Below that the tab looks
   * exactly like it always has: every group open, no controls above them.
   */
  const getGroupSectionToolbar: GetReactElementFunction = (): ReactElement => {
    if (allGroupSections.length <= STATUS_PAGE_GROUP_SECTIONS_PER_PAGE) {
      return <></>;
    }

    return (
      <div className="mb-5">
        <Input
          value={groupSearchText}
          placeholder="Search groups by name or path..."
          dataTestId="status-page-group-section-search"
          onChange={(value: string) => {
            setGroupSearchText(value);
            setGroupSectionPageNumber(1);
          }}
        />
        <p className="mt-2 text-sm text-gray-500">
          {`This status page has ${allGroupSections.length.toLocaleString()} groups${
            groupSearchText.trim()
              ? `, ${matchingGroupSections.length.toLocaleString()} matching your search`
              : ""
          }. Open a group to load its resources.`}
        </p>
      </div>
    );
  };

  const getGroupSectionPagination: GetReactElementFunction =
    (): ReactElement => {
      if (groupSectionPage.totalPageCount <= 1) {
        return <></>;
      }

      return (
        <div className="mb-5 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <Pagination
            currentPageNumber={groupSectionPage.pageNumber}
            totalItemsCount={groupSectionPage.totalSectionCount}
            itemsOnPage={groupSectionPage.pageSize}
            itemsOnCurrentPage={groupSectionPage.sections.length}
            isLoading={false}
            isError={false}
            singularLabel="group"
            pluralLabel="groups"
            dataTestId="status-page-group-section-pagination"
            onNavigateToPage={(pageNumber: number) => {
              setGroupSectionPageNumber(pageNumber);
            }}
          />
        </div>
      );
    };

  return (
    <Fragment>
      <>
        {isLoading ? <ComponentLoader /> : <></>}

        {error ? <ErrorMessage message={error} /> : <></>}

        {!isLoading && !error ? getModelTable(null) : <></>}

        {!isLoading && !error && allGroupSections.length > 0 ? (
          <>
            {getGroupSectionToolbar()}

            {groupSectionPage.sections.map(
              (section: StatusPageGroupSection) => {
                return (
                  <Fragment key={section.groupId}>
                    {getGroupSection(section)}
                  </Fragment>
                );
              },
            )}

            {groupSectionPage.sections.length === 0 ? (
              <div className="mb-5 bg-white border border-gray-200 rounded-xl shadow-sm px-5 md:px-6 py-6 text-sm text-gray-500">
                No groups match your search.
              </div>
            ) : (
              <></>
            )}

            {getGroupSectionPagination()}
          </>
        ) : (
          <></>
        )}

        {bulkAddTarget ? (
          <BulkAddStatusPageMonitorsModal
            projectId={new ObjectID(props.currentProject!._id!)}
            statusPageId={modelId}
            statusPageGroupId={bulkAddTarget.statusPageGroupId || undefined}
            onClose={() => {
              setBulkAddTarget(null);
            }}
            onComplete={() => {
              setBulkAddRefreshCounter((counter: number) => {
                return counter + 1;
              });
            }}
          />
        ) : null}
      </>
    </Fragment>
  );
};

export default StatusPageDelete;
