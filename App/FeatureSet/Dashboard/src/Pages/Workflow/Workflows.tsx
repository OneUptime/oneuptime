import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import WorkflowPlan from "Common/Types/Workflow/WorkflowPlan";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelProgress from "Common/UI/Components/ModelProgress/ModelProgress";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import WorkflowOwnerTeam from "Common/Models/DatabaseModels/WorkflowOwnerTeam";
import WorkflowOwnerUser from "Common/Models/DatabaseModels/WorkflowOwnerUser";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import {
  WorkflowTemplate,
  buildGraphForTemplate,
  getWorkflowTemplates,
} from "Common/Types/Workflow/Templates";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green500, Red500 } from "Common/Types/BrandColors";
import WorkflowElement from "../../Components/Workflow/WorkflowElement";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildBooleanFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";
import IconProp from "Common/Types/Icon/IconProp";

const Workflows: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showTemplatePicker, setShowTemplatePicker] = useState<boolean>(false);
  const [templateError, setTemplateError] = useState<string>("");
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(
    null,
  );

  /*
   * A template is created through the ordinary Workflow create path, which is
   * what denormalizes the trigger onto the row (WorkflowService
   * .onCreateSuccess). Building the graph any other way would produce a
   * workflow that looks right and never fires.
   */
  type CreateFromTemplateFunction = (
    template: WorkflowTemplate,
  ) => Promise<void>;

  const createFromTemplate: CreateFromTemplateFunction = async (
    template: WorkflowTemplate,
  ): Promise<void> => {
    setCreatingTemplateId(template.id);
    setTemplateError("");

    try {
      const graph: JSONObject | null = buildGraphForTemplate(
        template.id,
        () => {
          return ObjectID.generate().toString();
        },
      );

      if (!graph) {
        throw new Error("This template could not be built.");
      }

      const workflow: Workflow = new Workflow();
      workflow.name = template.workflowName;
      workflow.description = template.workflowDescription;
      workflow.projectId = ProjectUtil.getCurrentProjectId()!;
      workflow.graph = graph;
      /*
       * Created switched off on purpose: a scheduled template would otherwise
       * start firing against a placeholder URL the moment it is created.
       */
      workflow.isEnabled = false;

      const created: Workflow = await ModelAPI.create<Workflow>({
        data: workflow,
        modelType: Workflow,
      });

      setShowTemplatePicker(false);
      Navigation.navigate(
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.WORKFLOW_VIEW] as Route,
          { modelId: created.id as ObjectID },
        ),
      );
    } catch (err) {
      setTemplateError(API.getFriendlyMessage(err));
    }

    setCreatingTemplateId(null);
  };

  const startDate: Date = OneUptimeDate.getSomeDaysAgo(30);
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const plan: PlanType | null = ProjectUtil.getCurrentPlan();

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Workflow>({ modelType: Workflow });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Workflow>({
      ownerUserModelType: WorkflowOwnerUser,
      ownerTeamModelType: WorkflowOwnerTeam,
      resourceIdField: "workflowId",
    });

  const workflowExtraFacets: Array<ResourceFacet> = [
    {
      key: "isEnabled",
      label: "Enabled",
      icon: IconProp.Power,
      isMultiSelect: false,
      options: [
        { value: "true", label: "Enabled" },
        { value: "false", label: "Disabled" },
      ],
      supportedOperators: ["is", "is_not"],
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildBooleanFacetQuery(values, operator);
      },
    },
  ];

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Workflow>({
    persistKey: "workflows-table",
    ownerUserModelType: WorkflowOwnerUser,
    ownerTeamModelType: WorkflowOwnerTeam,
    resourceIdField: "workflowId",
    showLabelsFacet: true,
    extraFacets: workflowExtraFacets,
  });

  return (
    <Fragment>
      <>
        {plan && (plan === PlanType.Growth || plan === PlanType.Scale) && (
          <ModelProgress<WorkflowLog>
            totalCount={WorkflowPlan[plan]}
            modelType={WorkflowLog}
            countQuery={{
              createdAt: new InBetween(startDate, endDate),
            }}
            title="Workflow Runs"
            description={
              "Workflow runs in the last 30 days. Your current plan is " +
              plan +
              ". It currently supports " +
              WorkflowPlan[plan] +
              " runs in the last 30 days."
            }
          />
        )}

        <ModelTable<Workflow>
          modelType={Workflow}
          enableJsonImportExport={true}
          id="workflows-table"
          userPreferencesKey="workflow-table"
          topContent={filterBar}
          currentFacetState={facetSaveState}
          onFacetStateRestored={restoreFacetState}
          query={mergeFiltersIntoQuery(undefined)}
          onFetchSuccess={(data: Array<Workflow>) => {
            onResourcesFetched(data);
          }}
          saveFilterProps={{
            tableId: "workflows-table",
          }}
          isDeleteable={false}
          isEditable={false}
          isCreateable={true}
          bulkActions={{
            buttons: [...labelBulkActions, ...ownerBulkActions],
          }}
          name="Workflows"
          isViewable={true}
          showViewIdButton={true}
          cardProps={{
            title: "Workflows",
            description: "Here is a list of workflows for this project.",
            buttons: [
              {
                title: "Start from a template",
                icon: IconProp.Add,
                buttonStyle: ButtonStyleType.OUTLINE,
                onClick: () => {
                  setShowTemplatePicker(true);
                },
              },
            ],
          }}
          videoLink={URL.fromString("https://youtu.be/z-b7_KQcUDY")}
          noItemsMessage={"No workflows found."}
          formSteps={[
            {
              title: "Workflow Info",
              id: "workflow-info",
            },
            {
              title: "Labels",
              id: "labels",
            },
          ]}
          formFields={[
            {
              field: {
                name: true,
              },
              stepId: "workflow-info",
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Workflow Name",
              validation: {
                minLength: 2,
              },
            },
            {
              field: {
                description: true,
              },
              stepId: "workflow-info",
              title: "Description",
              fieldType: FormFieldSchemaType.LongText,
              required: true,
              placeholder: "Description",
            },
            {
              field: {
                isEnabled: true,
              },
              stepId: "workflow-info",
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
            },
            {
              field: {
                labels: true,
              },
              stepId: "labels",
              title: "Labels ",
              description:
                "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownModal: {
                type: Label,
                labelField: "name",
                valueField: "_id",
              },
              required: false,
              placeholder: "Labels",
            },
          ]}
          showRefreshButton={true}
          searchableFields={["name", "description"]}
          viewPageRoute={Navigation.getCurrentRoute()}
          filters={[
            {
              title: "Name",
              type: FieldType.Text,
              field: {
                name: true,
              },
            },
            {
              title: "Description",
              type: FieldType.Text,
              field: {
                description: true,
              },
            },
          ]}
          columns={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Element,
              getElement: (item: Workflow): ReactElement => {
                return <WorkflowElement workflow={item} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.LongText,
              hideOnMobile: true,
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              type: FieldType.Element,
              getElement: (item: Workflow): ReactElement => {
                if (item.isEnabled) {
                  return (
                    <Pill text="Enabled" color={Green500} isMinimal={true} />
                  );
                }
                return <Pill text="Disabled" color={Red500} isMinimal={true} />;
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              type: FieldType.EntityArray,
              hideOnMobile: true,
              getElement: (item: Workflow): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                _id: true,
              },
              title: "Owners",
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (item: Workflow): ReactElement => {
                return (
                  <OwnersCell
                    owners={getOwnersForResource(item)}
                    isLoading={isLoadingOwners}
                  />
                );
              },
            },
          ]}
        />
        {showTemplatePicker && (
          <Modal
            title="Start from a template"
            description="Each of these is a small, working workflow. They are created switched off so you can read them before anything runs."
            modalWidth={ModalWidth.Large}
            submitButtonText="Close"
            submitButtonStyleType={ButtonStyleType.NORMAL}
            onSubmit={() => {
              setShowTemplatePicker(false);
            }}
          >
            <div className="space-y-3">
              {templateError && (
                <p className="text-sm text-red-600">{templateError}</p>
              )}

              {getWorkflowTemplates().map(
                (template: WorkflowTemplate): ReactElement => {
                  return (
                    <button
                      key={template.id}
                      type="button"
                      disabled={creatingTemplateId !== null}
                      className="w-full text-left rounded-md border border-gray-200 bg-white p-4 hover:border-gray-400 cursor-pointer disabled:opacity-50"
                      onClick={() => {
                        void createFromTemplate(template);
                      }}
                    >
                      <p className="text-sm font-medium text-gray-900">
                        {template.name}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        {template.description}
                      </p>
                      <p className="text-xs text-gray-400 mt-2">
                        Teaches: {template.teaches}
                      </p>
                      {creatingTemplateId === template.id && (
                        <p className="text-xs text-gray-500 mt-2">Creating…</p>
                      )}
                    </button>
                  );
                },
              )}
            </div>
          </Modal>
        )}

        {labelBulkActionModals}
        {ownerBulkActionModals}
      </>
    </Fragment>
  );
};

export default Workflows;
