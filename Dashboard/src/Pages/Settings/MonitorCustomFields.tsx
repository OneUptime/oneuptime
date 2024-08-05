import PageComponentProps from "../PageComponentProps";
import CustomFieldsPageBase from "./Base/CustomFieldsPageBase";
import MonitorCustomField from "Common/AppModels/Models/MonitorCustomField";
import React, { FunctionComponent, ReactElement } from "react";

const MonitorCustomFields: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <CustomFieldsPageBase
      {...props}
      title="Monitor Custom Fields"
      modelType={MonitorCustomField}
    />
  );
};

export default MonitorCustomFields;
