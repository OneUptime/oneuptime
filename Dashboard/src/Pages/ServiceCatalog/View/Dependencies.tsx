import DashboardNavigation from "../../../Utils/Navigation";
import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ServiceCatalog from "Common/Models/DatabaseModels/ServiceCatalog";
import ServiceCatalogDependency from "Common/Models/DatabaseModels/ServiceCatalogDependency";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ServiceCatalogElement from "../../../Components/ServiceCatalog/ServiceElement";

const ServiceCatalogDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<ServiceCatalogDependency>
        modelType={ServiceCatalogDependency}
        id="table-ServiceCatalog-dependency"
        name="ServiceCatalog > Dependency"
        singularName="Dependency"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          serviceCatalogId: modelId,
          projectId: DashboardNavigation.getProjectId()!,
        }}
        onBeforeCreate={(
          item: ServiceCatalogDependency,
        ): Promise<ServiceCatalogDependency> => {
          item.serviceCatalogId = modelId;
          item.projectId = DashboardNavigation.getProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Dependencies",
          description: "Here is list of services that this service depends on.",
        }}
        noItemsMessage={"No dependencies associated with this service so far."}
        formFields={[
          {
            field: {
              dependencyServiceCatalog: true,
            },
            title: "Dependency Service",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select Dependency Service",
            dropdownModal: {
              type: ServiceCatalog,
              labelField: "name",
              valueField: "_id",
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              dependencyServiceCatalog: true,
            },
            type: FieldType.Entity,
            title: "Dependency Service",
            filterEntityType: ServiceCatalog,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()!,
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
              dependencyServiceCatalog: {
                name: true,
                serviceColor: true,
              },
            },
            title: "Dependency Service",
            type: FieldType.Entity,

            getElement: (item: ServiceCatalogDependency): ReactElement => {
              if (!item["dependencyServiceCatalog"]) {
                throw new BadDataException("Dependency not found");
              }

              return (
                <ServiceCatalogElement
                  serviceCatalog={item["dependencyServiceCatalog"]}
                />
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default ServiceCatalogDelete;
