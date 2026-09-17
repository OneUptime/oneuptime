import PageComponentProps from "../../PageComponentProps";
import CustomFieldsPageBase from "../../Settings/Base/CustomFieldsPageBase";
import InventoryItemCustomField from "Common/Models/DatabaseModels/InventoryItemCustomField";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Where a project defines its own vocabulary for the estate — owner team,
 * cost centre, compliance scope. Worth more here than on most tables: these
 * fields hang on rows OneUptime discovered rather than rows a person filled
 * in, which is exactly the metadata nobody would otherwise have anywhere to
 * put.
 */
const InventoryCustomFields: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <CustomFieldsPageBase
      {...props}
      title="Inventory Custom Fields"
      modelType={InventoryItemCustomField}
    />
  );
};

export default InventoryCustomFields;
