import PageComponentProps from "../../PageComponentProps";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseCustomField from "Common/Models/DatabaseModels/SecurityCaseCustomField";
import ObjectID from "Common/Types/ObjectID";
import CustomFieldsDetail from "Common/UI/Components/CustomFields/CustomFieldsDetail";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The values of the project's own case fields on this case (Security
 * Events > Settings > Custom Fields), every field listed - filled in or not
 * - and edited together. The Overview shows the same card while the project
 * has fields; this page is where it always is, under Advanced, as an
 * incident's and an alert's Custom Fields pages are.
 */
const SecurityCaseCustomFieldsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  return (
    <CustomFieldsDetail
      key={view.caseId.toString()}
      title="Case Custom Fields"
      description="The project's own fields, filled in for this case."
      modelType={SecurityCase}
      customFieldType={SecurityCaseCustomField}
      name="Security Case Custom Fields"
      projectId={projectId}
      modelId={view.caseId}
    />
  );
};

export default SecurityCaseCustomFieldsPage;
