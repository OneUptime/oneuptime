import PageComponentProps from "../../PageComponentProps";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import { SECURITY_CASE_CUSTOM_FIELDS_COPY } from "../../../Components/SecurityCase/CustomFields/SecurityCaseCustomFieldsCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseCustomField from "Common/Models/DatabaseModels/SecurityCaseCustomField";
import Route from "Common/Types/API/Route";
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
 *
 * While the project has none, it says so and offers Add Custom Fields,
 * which opens Security Events > Settings > Custom Fields - not the project's
 * settings, where a case's fields are not.
 */
const SecurityCaseCustomFieldsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const copy: typeof SECURITY_CASE_CUSTOM_FIELDS_COPY =
    SECURITY_CASE_CUSTOM_FIELDS_COPY;

  if (!projectId) {
    return <></>;
  }

  return (
    <CustomFieldsDetail
      key={view.caseId.toString()}
      title={copy.caseCardTitle}
      description={copy.caseCardDescription}
      emptyMessage={copy.caseEmptyMessage}
      addFieldsRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_SETTINGS_CUSTOM_FIELDS] as Route,
      )}
      modelType={SecurityCase}
      customFieldType={SecurityCaseCustomField}
      name="Security Case Custom Fields"
      projectId={projectId}
      modelId={view.caseId}
    />
  );
};

export default SecurityCaseCustomFieldsPage;
