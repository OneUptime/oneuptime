import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CustomFieldsDetail from "CommonUI/src/Components/CustomFields/CustomFieldsDetail";
import Navigation from "CommonUI/src/Utils/Navigation";
import ProjectUtil from "CommonUI/src/Utils/Project";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const MonitorCustomFields: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      <CustomFieldsDetail
        title="Monitor Custom Fields"
        description="Custom fields help you add new fields to your resources in OneUptime."
        modelType={Monitor}
        customFieldType={MonitorCustomField}
        name="Monitor Custom Fields"
        projectId={ProjectUtil.getCurrentProject()!.id!}
        modelId={modelId}
      />
    </Fragment>
  );
};

export default MonitorCustomFields;
