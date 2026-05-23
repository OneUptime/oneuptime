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
  DashboardTemplates,
  DashboardTemplateType,
  DashboardTemplate,
} from "Common/Types/Dashboard/DashboardTemplates";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
    ownersByResourceId,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
  } = useResourceOwners<Dashboard>({
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {DashboardTemplates.map(
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
        </Modal>
      ) : (
        <></>
      )}

      <ModelTable<Dashboard>
        modelType={Dashboard}
        id="dashboard-table"
        userPreferencesKey="dashboards-table"
        topContent={filterBar}
        query={mergeFiltersIntoQuery(undefined)}
        onFetchSuccess={(data: Array<Dashboard>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        bulkActions={{
          buttons: [...labelBulkActions, ...ownerBulkActions],
        }}
        name="Dashboards"
        isViewable={true}
        showCreateForm={showCreateForm}
        cardProps={{
          title: "Dashboards",
          description: "Here is a list of dashboards for this project.",
          buttons: [
            {
              title: "Create from Template",
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: () => {
                setShowTemplateModal(true);
              },
              icon: IconProp.Add,
            },
          ],
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
              const id: string | undefined = item.id?.toString();
              return (
                <OwnersCell
                  owners={id ? ownersByResourceId[id] : undefined}
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
