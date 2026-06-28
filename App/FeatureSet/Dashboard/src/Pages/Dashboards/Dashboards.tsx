import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardOwnerTeam from "Common/Models/DatabaseModels/DashboardOwnerTeam";
import DashboardOwnerUser from "Common/Models/DatabaseModels/DashboardOwnerUser";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import DashboardElement from "../../Components/Dashboard/DashboardElement";
import DashboardTemplateCard from "../../Components/Dashboard/DashboardTemplateCard";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import {
  DashboardTemplateType,
  DashboardTemplate,
  DashboardTemplateCategories,
  DashboardTemplateCategory,
  getDashboardTemplatesByCategory,
} from "Common/Types/Dashboard/DashboardTemplates";
import { JSONObject } from "Common/Types/JSON";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";

const Dashboards: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [selectedTemplate, setSelectedTemplate] =
    useState<DashboardTemplateType | null>(null);
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Dashboard>({ modelType: Dashboard });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Dashboard>({
      ownerUserModelType: DashboardOwnerUser,
      ownerTeamModelType: DashboardOwnerTeam,
      resourceIdField: "dashboardId",
    });

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Dashboard>({
    persistKey: "all-dashboards-table",
    ownerUserModelType: DashboardOwnerUser,
    ownerTeamModelType: DashboardOwnerTeam,
    resourceIdField: "dashboardId",
    showLabelsFacet: true,
  });

  const handleTemplateClick: (type: DashboardTemplateType) => void =
    useCallback((type: DashboardTemplateType): void => {
      setSelectedTemplate(type);
      setShowTemplateModal(false);
      setShowCreateForm(true);
    }, []);

  return (
    <Fragment>
      {showTemplateModal ? (
        <Modal
          title="Create from Template"
          description="Choose a template to quickly get started with a pre-configured dashboard."
          onClose={() => {
            setShowTemplateModal(false);
          }}
          modalWidth={ModalWidth.Large}
        >
          <div className="space-y-6">
            {DashboardTemplateCategories.map(
              (category: DashboardTemplateCategory): ReactElement => {
                const templates: Array<DashboardTemplate> =
                  getDashboardTemplatesByCategory(category);

                if (templates.length === 0) {
                  return <Fragment key={category}></Fragment>;
                }

                return (
                  <div key={category}>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      {category}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {templates.map(
                        (template: DashboardTemplate): ReactElement => {
                          return (
                            <DashboardTemplateCard
                              key={template.type}
                              title={template.name}
                              description={template.description}
                              icon={template.icon}
                              onClick={() => {
                                handleTemplateClick(template.type);
                              }}
                            />
                          );
                        },
                      )}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </Modal>
      ) : (
        <></>
      )}

      <ModelTable<Dashboard>
        modelType={Dashboard}
        enableJsonImportExport={true}
        id="dashboard-table"
        userPreferencesKey="dashboards-table"
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(undefined)}
        onFetchSuccess={(data: Array<Dashboard>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        onCreateClick={() => {
          setShowTemplateModal(true);
        }}
        onCreateEditModalClose={() => {
          setShowCreateForm(false);
        }}
        bulkActions={{
          buttons: [...labelBulkActions, ...ownerBulkActions],
        }}
        name="Dashboards"
        isViewable={true}
        showCreateForm={showCreateForm}
        cardProps={{
          title: "Dashboards",
          description: "Here is a list of dashboards for this project.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No dashboards found."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Dashboard Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
        ]}
        onBeforeCreate={async (
          item: Dashboard,
          miscDataProps: JSONObject,
        ): Promise<Dashboard> => {
          if (
            selectedTemplate &&
            selectedTemplate !== DashboardTemplateType.Blank
          ) {
            miscDataProps["dashboardTemplateType"] = selectedTemplate;
          }
          setSelectedTemplate(null);
          setShowCreateForm(false);
          return item;
        }}
        saveFilterProps={{
          tableId: "all-dashboards-table",
        }}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: Dashboard): ReactElement => {
              return <DashboardElement dashboard={item} />;
            },
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
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

            getElement: (item: Dashboard): ReactElement => {
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
            getElement: (item: Dashboard): ReactElement => {
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
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default Dashboards;
