import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Alert from "Common/Models/DatabaseModels/Alert";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";

const AlertDelete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Root Cause"
      cardProps={{
        title: "Root Cause",
        description:
          "Why did this alert happen? Here is the root cause of this alert.",
      }}
      isEditable={true}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: Alert,
        id: "model-detail-alert-root-cause",
        fields: [
          {
            field: {
              rootCause: true,
            },
            title: "",
            placeholder: "No root cause identified for this alert.",
            fieldType: FieldType.Markdown,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default AlertDelete;
