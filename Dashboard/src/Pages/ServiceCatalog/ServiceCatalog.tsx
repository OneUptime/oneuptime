import LabelsElement from "../../Components/Label/Labels";
import ServiceCatalogElement from "../../Components/ServiceCatalog/ServiceElement";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import TechStack from "Common/Types/ServiceCatalog/TechStack";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import ServiceCatalog from "Common/Models/DatabaseModels/ServiceCatalog";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceCatalogPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<ServiceCatalog>
      modelType={ServiceCatalog}
      id="service-catalog-table"
      userPreferencesKey="service-catalog-table"
      isDeleteable={false}
      isEditable={false}
      isCreateable={true}
      name="Service Catalog"
      isViewable={true}
      cardProps={{
        title: "Service Catalog",
        description: "List and manage services for this project here.",
      }}
      showViewIdButton={true}
      noItemsMessage={"No services found."}
      selectMoreFields={{
        serviceColor: true,
      }}
      formFields={[
        {
          field: {
            name: true,
          },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Service Name",
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
        {
          field: {
            techStack: true,
          },
          title: "Tech Stack",
          description:
            "Tech stack used in the service. This will help other developers understand the service better.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          required: true,
          placeholder: "Tech Stack",
          dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(TechStack),
        },
      ]}
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
          getElement: (service: ServiceCatalog): ReactElement => {
            return (
              <Fragment>
                <ServiceCatalogElement serviceCatalog={service} />
              </Fragment>
            );
          },
        },
        {
          field: {
            description: true,
          },
          noValueMessage: "-",
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

          getElement: (item: ServiceCatalog): ReactElement => {
            return <LabelsElement labels={item["labels"] || []} />;
          },
        },
      ]}
    />
  );
};

export default ServiceCatalogPage;
