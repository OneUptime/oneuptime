import PageComponentProps from "../../PageComponentProps";
import CustomFieldsPageBase from "../../Settings/Base/CustomFieldsPageBase";
import { SECURITY_CASE_CUSTOM_FIELDS_COPY } from "../../../Components/SecurityCase/CustomFields/SecurityCaseCustomFieldsCopy";
import SecurityCaseCustomField from "Common/Models/DatabaseModels/SecurityCaseCustomField";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Security Events > Settings > Custom Fields: the fields a project adds to
 * its security cases - a business unit, a customer, a regulator to notify,
 * a ticket in another tool - each filled in on a case (its Overview's
 * Custom Fields card and its Custom Fields page) and listed as a column of
 * the case queue. Drawn as every product's custom fields page is
 * (CustomFieldsPageBase): a field's name and type, a dropdown's options.
 * Its card says what the fields are for, and names one as its title does:
 * Create Case Custom Field (SecurityCaseCustomFieldsCopy).
 */
const SecurityCaseCustomFieldsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const copy: typeof SECURITY_CASE_CUSTOM_FIELDS_COPY =
    SECURITY_CASE_CUSTOM_FIELDS_COPY;

  return (
    <CustomFieldsPageBase
      {...props}
      title={copy.settingsTitle}
      description={copy.settingsDescription}
      singularName={copy.singularName}
      pluralName={copy.pluralName}
      modelType={SecurityCaseCustomField}
    />
  );
};

export default SecurityCaseCustomFieldsPage;
