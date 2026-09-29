import PageComponentProps from "../../PageComponentProps";
import CustomFieldsPageBase from "../../Settings/Base/CustomFieldsPageBase";
import AlertCustomField from "Common/Models/DatabaseModels/AlertCustomField";
import React, { FunctionComponent, ReactElement } from "react";

const AlertCustomFields: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <CustomFieldsPageBase
      {...props}
      title="Alert Custom Fields"
      modelType={AlertCustomField}
    />
  );
};

export default AlertCustomFields;
