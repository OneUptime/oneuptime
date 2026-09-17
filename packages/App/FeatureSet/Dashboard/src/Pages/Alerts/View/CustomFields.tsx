import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CustomFieldsDetail from "Common/UI/Components/CustomFields/CustomFieldsDetail";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertCustomField from "Common/Models/DatabaseModels/AlertCustomField";
import React, { FunctionComponent, ReactElement } from "react";

const AlertCustomFields: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CustomFieldsDetail
      title="Alert Custom Fields"
      description="Custom fields help you add new fields to your resources in OneUptime."
      modelType={Alert}
      customFieldType={AlertCustomField}
      name="Alert Custom Fields"
      projectId={ProjectUtil.getCurrentProject()!.id!}
      modelId={modelId}
    />
  );
};

export default AlertCustomFields;
