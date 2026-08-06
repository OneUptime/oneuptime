import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupTreeUtil from "Common/Utils/StatusPage/GroupTree";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ProjectUtil from "Common/UI/Utils/Project";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import AxisValuesInput from "../../../Components/StatusPage/AxisValuesInput";
import ImportGroupsFromCsvModal from "../../../Components/StatusPage/ImportGroupsFromCsvModal";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [showImportModal, setShowImportModal] = useState<boolean>(false);

  /*
   * Bumped when a CSV import creates groups, so the table refetches without a
   * page reload while the modal is still open on its results.
   */
  const [refreshToggle, setRefreshToggle] = useState<string>("");

  /*
   * Groups nest, so the parent picker has to show where each candidate sits in
   * the tree - two groups can easily be called "Region 1000" at different
   * levels. Options are labelled with their full path and fetched every time
   * the form opens, so a group added a moment ago is immediately selectable.
   *
   * Whether the chosen parent is actually legal (not the group itself, not one
   * of its own sub groups, not past the nesting limit) is decided by
   * StatusPageGroupService, which is the only place that can see the tree as
   * it is at write time.
   */
  const fetchParentGroupOptions: () => Promise<
    Array<DropdownOption>
  > = async (): Promise<Array<DropdownOption>> => {
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
          order: true,
          parentStatusPageGroupId: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        requestOptions: {},
      });

    const allGroups: Array<StatusPageGroup> = listResult.data;

    return allGroups.map((group: StatusPageGroup) => {
      const path: Array<string> = StatusPageGroupTreeUtil.getAncestorGroups({
        statusPageGroup: group,
        statusPageGroups: allGroups,
      })
        .reverse()
        .map((ancestor: StatusPageGroup) => {
          return ancestor.name || "";
        });

      return {
        value: group._id?.toString() || "",
        label: [...path, group.name || ""].join(" › "),
      };
    });
  };

  return (
    <Fragment>
      <ModelTable<StatusPageGroup>
        modelType={StatusPageGroup}
        refreshToggle={refreshToggle}
        id="status-page-group"
        name="Status Page > Groups"
        userPreferencesKey="status-page-group-table"
        saveFilterProps={{
          tableId: "status-page-groups-table",
        }}
        isDeleteable={true}
        sortBy="order"
        showViewIdButton={true}
        sortOrder={SortOrder.Ascending}
        isCreateable={true}
        isViewable={false}
        isEditable={true}
        query={{
          statusPageId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        onBeforeCreate={(item: StatusPageGroup): Promise<StatusPageGroup> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.statusPageId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Resource Groups",
          description:
            "Here are different groups for your status page resources. Groups can be nested inside other groups, and each level shows the rolled up status and uptime of everything beneath it. Deleting a group also deletes its sub groups, the resources in them, and any monitor rules that add monitors to them.",
          buttons: [
            /*
             * OUTLINE, not NORMAL/PRIMARY: BaseModelTable promotes the first
             * NORMAL/PRIMARY button to the header slot, and bulk import
             * belongs in the ⋯ overflow next to the other table-wide actions
             * — the same place every other bulk import in the product lives.
             */
            {
              title: "Import from CSV",
              buttonStyle: ButtonStyleType.OUTLINE,
              icon: IconProp.Upload,
              onClick: () => {
                setShowImportModal(true);
              },
            } as CardButtonSchema,
          ],
        }}
        noItemsMessage={"No status page group created for this status page."}
        formSteps={[
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
        ]}
        formFields={[
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
            fetchDropdownOptions: fetchParentGroupOptions,
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
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Resource Group Name",
            type: FieldType.Text,
          },
          {
            field: {
              isExpandedByDefault: true,
            },
            title: "Expanded on Status Page by Default",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Resource Group Name",
            type: FieldType.Text,
          },
          {
            field: {
              parentStatusPageGroup: {
                name: true,
              },
            },
            title: "Parent Group",
            type: FieldType.Entity,
            getElement: (item: StatusPageGroup): ReactElement => {
              if (!item.parentStatusPageGroup?.name) {
                return <span className="text-gray-400">Top level</span>;
              }

              return <span>{item.parentStatusPageGroup.name}</span>;
            },
          },
          {
            field: {
              isExpandedByDefault: true,
            },
            title: "Expanded on Status Page by Default",
            type: FieldType.Boolean,
            hideOnMobile: true,
          },
        ]}
      />

      {showImportModal && (
        <ImportGroupsFromCsvModal
          statusPageId={modelId}
          projectId={ProjectUtil.getCurrentProjectId()!}
          onClose={() => {
            setShowImportModal(false);
          }}
          onImportComplete={() => {
            /*
             * Fires while the modal is still open on its results, so the
             * table behind it is already current when the user closes it.
             */
            setRefreshToggle(Date.now().toString());
          }}
        />
      )}
    </Fragment>
  );
};

export default StatusPageDelete;
