import PageComponentProps from "../../PageComponentProps";
import CustomFieldsPageBase from "../../Settings/Base/CustomFieldsPageBase";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import React, { FunctionComponent, ReactElement } from "react";

const ScheduledMaintenanceCustomFields: FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): ReactElement => {
  return (
    <CustomFieldsPageBase
      {...props}
      title="Scheduled Maintenance Custom Fields"
      modelType={ScheduledMaintenanceCustomField}
    />
  );
};

export default ScheduledMaintenanceCustomFields;
