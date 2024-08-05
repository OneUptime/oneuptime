import PageComponentProps from "../PageComponentProps";
import CustomFieldsPageBase from "./Base/CustomFieldsPageBase";
import OnCallDutyPolicyCustomField from "Common/AppModels/Models/OnCallDutyPolicyCustomField";
import React, { FunctionComponent, ReactElement } from "react";

const OnCallDutyPolicyCustomFields: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <CustomFieldsPageBase
      {...props}
      title="On-Call Policy Custom Fields"
      modelType={OnCallDutyPolicyCustomField}
    />
  );
};

export default OnCallDutyPolicyCustomFields;
