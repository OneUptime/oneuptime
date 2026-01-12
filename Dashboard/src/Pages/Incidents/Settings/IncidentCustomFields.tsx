import PageComponentProps from "../../PageComponentProps";
import CustomFieldsPageBase from "../../Settings/Base/CustomFieldsPageBase";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentCustomFields: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <CustomFieldsPageBase
      {...props}
      title="Incident Custom Fields"
      modelType={IncidentCustomField}
    />
  );
};

export default IncidentCustomFields;
