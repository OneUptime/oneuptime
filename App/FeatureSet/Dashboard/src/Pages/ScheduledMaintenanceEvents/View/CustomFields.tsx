import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CustomFieldsDetail from "Common/UI/Components/CustomFields/CustomFieldsDetail";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ScheduledMaintenanceCustomFields: FunctionComponent<
  PageComponentProps
> = (_props: PageComponentProps): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CustomFieldsDetail
        title="Scheduled Maintenance Custom Fields"
        description="Custom fields help you add new fields to your resources in OneUptime."
        modelType={ScheduledMaintenance}
        customFieldType={ScheduledMaintenanceCustomField}
        name="Scheduled Maintenance Custom Fields"
        projectId={ProjectUtil.getCurrentProject()!.id!}
        modelId={modelId}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceCustomFields;
