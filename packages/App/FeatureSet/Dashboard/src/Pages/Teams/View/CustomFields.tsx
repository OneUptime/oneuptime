import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CustomFieldsDetail from "Common/UI/Components/CustomFields/CustomFieldsDetail";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamCustomField from "Common/Models/DatabaseModels/TeamCustomField";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const TeamCustomFields: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CustomFieldsDetail
        title="Team Custom Fields"
        description="Custom fields help you add new fields to your teams in OneUptime."
        modelType={Team}
        customFieldType={TeamCustomField}
        name="Team Custom Fields"
        projectId={ProjectUtil.getCurrentProject()!.id!}
        modelId={modelId}
      />
    </Fragment>
  );
};

export default TeamCustomFields;
