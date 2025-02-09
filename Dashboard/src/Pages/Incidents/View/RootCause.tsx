import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";

const IncidentDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Root Cause"
      cardProps={{
        title: "Root Cause",
        description:
          "Why did this incident happen? Here is the root cause of this incident.",
      }}
      isEditable={true}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: Incident,
        id: "model-detail-incident-root-cause",
        fields: [
          {
            field: {
              rootCause: true,
            },
            title: "",
            placeholder: "No root cause identified for this incident.",
            fieldType: FieldType.Markdown,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default IncidentDelete;
