import PageComponentProps from "../../PageComponentProps";
import CustomFieldsPageBase from "../../Settings/Base/CustomFieldsPageBase";
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import React, { FunctionComponent, ReactElement } from "react";

const StatusPageCustomFields: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <CustomFieldsPageBase
      {...props}
      title="Status Page Custom Fields"
      modelType={StatusPageCustomField}
    />
  );
};

export default StatusPageCustomFields;
