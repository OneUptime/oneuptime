import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CustomFieldsDetail from "Common/UI/Components/CustomFields/CustomFieldsDetail";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemCustomField from "Common/Models/DatabaseModels/InventoryItemCustomField";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const InventoryItemCustomFields: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CustomFieldsDetail
        title="Custom Fields"
        description="Your project's own fields on this item. Define which fields exist under Inventory settings."
        modelType={InventoryItem}
        customFieldType={InventoryItemCustomField}
        name="Inventory Item Custom Fields"
        projectId={ProjectUtil.getCurrentProject()!.id!}
        modelId={modelId}
      />
    </Fragment>
  );
};

export default InventoryItemCustomFields;
