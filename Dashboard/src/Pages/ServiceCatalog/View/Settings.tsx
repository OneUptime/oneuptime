import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import ServiceCatalog from "Common/AppModels/Models/ServiceCatalog";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail
        name="Service Settings"
        cardProps={{
          title: "Service Settings",
          description: "Configure settings for your service.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              serviceColor: true,
            },
            title: "Service Color",
            description: "Choose a color for your service.",
            fieldType: FormFieldSchemaType.Color,
            required: true,
            placeholder: "15",
          },
        ]}
        modelDetailProps={{
          modelType: ServiceCatalog,
          id: "model-detail-project",
          fields: [
            {
              field: {
                serviceColor: true,
              },
              title: "Service Color",
              description: "Color for your service.",
              fieldType: FieldType.Color,
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default ServiceDelete;
