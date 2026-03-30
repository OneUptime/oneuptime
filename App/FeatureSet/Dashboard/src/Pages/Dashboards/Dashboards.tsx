import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import DashboardElement from "../../Components/Dashboard/DashboardElement";
import DashboardTemplateCard from "../../Components/Dashboard/DashboardTemplateCard";
import {
  DashboardTemplates,
  DashboardTemplateType,
  getTemplateConfig,
  DashboardTemplate,
} from "Common/Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";

const Dashboards: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [selectedTemplate, setSelectedTemplate] =
    useState<DashboardTemplateType | null>(null);
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);

  const handleTemplateClick: (type: DashboardTemplateType) => void =
    useCallback((type: DashboardTemplateType): void => {
      setSelectedTemplate(type);
      setShowTemplateModal(false);
      setShowCreateForm(true);
    }, []);

  return (
    <Page
      title={"Dashboards"}
      breadcrumbLinks={[
        {
          title: "Project",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Dashboards",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.DASHBOARDS] as Route,
          ),
        },
      ]}
    >
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
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
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
          _miscDataProps: JSONObject,
        ): Promise<Dashboard> => {
          if (
            selectedTemplate &&
            selectedTemplate !== DashboardTemplateType.Blank
          ) {
            const templateConfig: DashboardViewConfig | null =
              getTemplateConfig(selectedTemplate);
            if (templateConfig) {
              item.dashboardViewConfig = templateConfig;
            }
          }
          setSelectedTemplate(null);
          setShowCreateForm(false);
          return item;
        }}
        saveFilterProps={{
          tableId: "all-dashboards-table",
        }}
        showRefreshButton={true}
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
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
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
        ]}
      />
    </Page>
  );
};

export default Dashboards;
