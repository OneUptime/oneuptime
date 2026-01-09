import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceDependency from "Common/Models/DatabaseModels/ServiceDependency";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ServiceElement from "../../../Components/Service/ServiceElement";
import ProjectUtil from "Common/UI/Utils/Project";

const ServiceDependencies: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<ServiceDependency>
        modelType={ServiceDependency}
        id="table-service-dependency"
        name="Service > Dependency"
        userPreferencesKey="service-dependency-table"
        singularName="Dependency"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          serviceId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: ServiceDependency,
        ): Promise<ServiceDependency> => {
          item.serviceId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
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
              dependencyService: true,
            },
            title: "Dependency Service",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select Dependency Service",
            dropdownModal: {
              type: Service,
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
              dependencyService: true,
            },
            type: FieldType.Entity,
            title: "Dependency Service",
            filterEntityType: Service,
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
              dependencyService: {
                name: true,
                serviceColor: true,
              },
            },
            title: "Dependency Service",
            type: FieldType.Entity,

            getElement: (item: ServiceDependency): ReactElement => {
              if (!item["dependencyService"]) {
                throw new BadDataException("Dependency not found");
              }

              return (
                <ServiceElement
                  service={item["dependencyService"]}
                />
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default ServiceDependencies;
