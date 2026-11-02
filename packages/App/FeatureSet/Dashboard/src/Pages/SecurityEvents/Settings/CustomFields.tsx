import PageComponentProps from "../../PageComponentProps";
import CustomFieldsPageBase from "../../Settings/Base/CustomFieldsPageBase";
import SecurityCaseCustomField from "Common/Models/DatabaseModels/SecurityCaseCustomField";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Security Events > Settings > Custom Fields: the fields a project adds to
 * its security cases - a business unit, a customer, a regulator to notify,
 * a ticket in another tool - each filled in on a case (its Overview's
 * Custom Fields card and its Custom Fields page) and listed as a column of
 * the case queue. Drawn as every product's custom fields page is
 * (CustomFieldsPageBase): a field's name and type, a dropdown's options.
 */
const SecurityCaseCustomFieldsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <CustomFieldsPageBase
      {...props}
      title="Case Custom Fields"
      modelType={SecurityCaseCustomField}
    />
  );
};

export default SecurityCaseCustomFieldsPage;
