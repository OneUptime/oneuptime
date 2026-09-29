import PageComponentProps from "../PageComponentProps";
import CustomFieldsPageBase from "../Settings/Base/CustomFieldsPageBase";
import TeamCustomField from "Common/Models/DatabaseModels/TeamCustomField";
import React, { FunctionComponent, ReactElement } from "react";

const TeamCustomFields: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <CustomFieldsPageBase
      {...props}
      title="Team Custom Fields"
      modelType={TeamCustomField}
    />
  );
};

export default TeamCustomFields;
