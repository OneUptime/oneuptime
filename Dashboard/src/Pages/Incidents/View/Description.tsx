import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";

const IncidentDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
    name="Incident Description"
    cardProps={{
      title: "Incident Description",
      description:
        "Description of this incident. This is visible on Status Page and is in markdown format.",
    }}
    editButtonText="Edit Incident Description"
    isEditable={true}
    formFields={[
      {
        field: {
          description: true,
        },
        title: "Description",

        fieldType: FormFieldSchemaType.Markdown,
        required: false,
        placeholder: "Description",
      },
    ]}
    modelDetailProps={{
      showDetailsInNumberOfColumns: 1,
      modelType: Incident,
      id: "model-detail-incident-description",
      fields: [
        {
          field: {
            description: true,
          },
          title: "Description",
          fieldType: FieldType.Markdown,
        },
      ],
      modelId: modelId,
    }}
  />
  );
};

export default IncidentDelete;
