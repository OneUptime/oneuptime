import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CustomFieldsDetail from "CommonUI/src/Components/CustomFields/CustomFieldsDetail";
import Navigation from "CommonUI/src/Utils/Navigation";
import ProjectUtil from "CommonUI/src/Utils/Project";
import Incident from "Model/Models/Incident";
import IncidentCustomField from "Model/Models/IncidentCustomField";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentCustomFields: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CustomFieldsDetail
      title="Incident Custom Fields"
      description="Custom fields help you add new fields to your resources in OneUptime."
      modelType={Incident}
      customFieldType={IncidentCustomField}
      name="Incident Custom Fields"
      projectId={ProjectUtil.getCurrentProject()!.id!}
      modelId={modelId}
    />
  );
};

export default IncidentCustomFields;
