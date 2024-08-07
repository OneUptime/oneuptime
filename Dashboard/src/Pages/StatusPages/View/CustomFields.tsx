import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CustomFieldsDetail from "Common/UI/src/Components/CustomFields/CustomFieldsDetail";
import Navigation from "Common/UI/src/Utils/Navigation";
import ProjectUtil from "Common/UI/src/Utils/Project";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StatusPageCustomFields: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CustomFieldsDetail
        title="Status Page Custom Fields"
        description="Custom fields help you add new fields to your resources in OneUptime."
        modelType={StatusPage}
        customFieldType={StatusPageCustomField}
        name="Status Page Custom Fields"
        projectId={ProjectUtil.getCurrentProject()!.id!}
        modelId={modelId}
      />
    </Fragment>
  );
};

export default StatusPageCustomFields;
