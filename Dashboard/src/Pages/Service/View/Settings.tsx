import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Service from "Common/Models/DatabaseModels/Service";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceSettings: FunctionComponent<
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
          modelType: Service,
          id: "model-detail-service",
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

export default ServiceSettings;
