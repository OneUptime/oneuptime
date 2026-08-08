import MonitorElement from "../../../Components/Monitor/Monitor";
import MonitorGroupElement from "../../../Components/MonitorGroup/MonitorGroupElement";
import BulkAddStatusPageMonitorsModal from "../../../Components/StatusPage/BulkAddStatusPageMonitorsModal";
import GridResourceEditor from "../../../Components/StatusPage/GridResourceEditor";
import { getStatusPageResourceAdvancedFields } from "../../../Components/StatusPage/StatusPageResourceFormFields";
import PageComponentProps from "../../PageComponentProps";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Columns from "Common/UI/Components/ModelTable/Column";
import Filter from "Common/UI/Components/ModelFilter/Filter";
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
import StatusPageGroupTreeUtil, {
  StatusPageGroupTreeIndex,
  StatusPageGroupTreeNode,
} from "Common/Utils/StatusPage/GroupTree";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
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

  /*
   * One index for the whole render. The tree helpers below build their own
   * when none is passed, which is once per group and therefore quadratic.
   */
  const groupTreeIndex: StatusPageGroupTreeIndex = useMemo(() => {
    return StatusPageGroupTreeUtil.buildIndex({ statusPageGroups: groups });
  }, [groups]);

  const [addMonitorGroup, setAddMonitorGroup] = useState<boolean>(false);
  const [bulkAddTarget, setBulkAddTarget] = useState<BulkAddTarget | null>(
    null,
  );
  const [bulkAddRefreshCounter, setBulkAddRefreshCounter] = useState<number>(0);

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

  type GetModelTableFunction = (
    statusPageGroup: StatusPageGroup | null,
  ) => ReactElement;

  /*
   * Groups can be nested, and two groups at different levels can share a name.
   * Show the full path so it is obvious which "Region 1000" a table belongs to.
   */
  /*
   * A parent's table should sit directly above the tables of the groups nested
   * under it, the same order the public status page renders them in - a flat
   * sort by `order` would scatter children away from their parent.
   */
  type GetGroupsInTreeOrderFunction = () => Array<StatusPageGroup>;

  const getGroupsInTreeOrder: GetGroupsInTreeOrderFunction =
    (): Array<StatusPageGroup> => {
      const flattened: Array<StatusPageGroup> = [];

      const visit: (nodes: Array<StatusPageGroupTreeNode>) => void = (
        nodes: Array<StatusPageGroupTreeNode>,
      ): void => {
        for (const node of nodes) {
          flattened.push(node.group);
          visit(node.children);
        }
      };

      visit(
        StatusPageGroupTreeUtil.buildTree({
          statusPageGroups: groups,
          index: groupTreeIndex,
        }),
      );

      return flattened;
    };

  type GetGroupPathFunction = (statusPageGroup: StatusPageGroup) => string;

  const getGroupPath: GetGroupPathFunction = (
    statusPageGroup: StatusPageGroup,
  ): string => {
    const ancestorNames: Array<string> =
      StatusPageGroupTreeUtil.getAncestorGroups({
        statusPageGroup: statusPageGroup,
        statusPageGroups: groups,
        index: groupTreeIndex,
      })
        .reverse()
        .map((ancestor: StatusPageGroup) => {
          return ancestor.name || "";
        });

    return [...ancestorNames, statusPageGroup.name || ""].join(" › ");
  };

  const getModelTable: GetModelTableFunction = (
    statusPageGroup: StatusPageGroup | null,
  ): ReactElement => {
    const statusPageGroupId: ObjectID | null = statusPageGroup?.id || null;
    const statusPageGroupName: string | null = statusPageGroup
      ? getGroupPath(statusPageGroup)
      : null;

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
          buttons: canCreateStatusPageResource
            ? [
                {
                  title: "Add Multiple Monitors",
                  buttonStyle: ButtonStyleType.OUTLINE,
                  icon: IconProp.Add,
                  onClick: () => {
                    setBulkAddTarget({ statusPageGroupId });
                  },
                },
              ]
            : [],
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

  return (
    <Fragment>
      <>
        {isLoading ? <ComponentLoader /> : <></>}

        {error ? <ErrorMessage message={error} /> : <></>}

        {!isLoading && !error ? getModelTable(null) : <></>}

        {!isLoading && !error && groups && groups.length > 0 ? (
          getGroupsInTreeOrder().map((group: StatusPageGroup) => {
            if (group.viewMode === StatusPageGroupViewMode.Grid) {
              return (
                <GridResourceEditor
                  key={group.id?.toString() || ""}
                  group={group}
                  statusPageId={modelId}
                  projectId={new ObjectID(props.currentProject!._id!)}
                  currentProject={props.currentProject!}
                  canCreateStatusPageResource={canCreateStatusPageResource}
                  baseFormFields={formFields}
                  formSteps={[
                    { title: "Monitor Details", id: "monitor-details" },
                    { title: "Advanced", id: "advanced" },
                  ]}
                />
              );
            }
            return getModelTable(group);
          })
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
