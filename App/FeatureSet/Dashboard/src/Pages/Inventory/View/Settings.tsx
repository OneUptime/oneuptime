import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Editing an inventory item.
 *
 * Only the name and description are here, and that is the whole story: type
 * and identity key are what the item *is*, derived server-side from
 * (project, type, name) at create time. Letting either be edited would
 * re-identify the row and strand every relationship edge pointing at the old
 * key, so the model refuses the write and this form does not offer it.
 *
 * The side menu only routes here for hand-added items — for discovered and
 * mirrored ones the owning source rewrites these fields on its next pass, so
 * an edit would silently revert.
 */
const InventoryItemSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<InventoryItem>
        name="Inventory Item Settings"
        cardProps={{
          title: "Item Settings",
          description:
            "The name and description for this item. Its type and identity key are fixed — they are what OneUptime matches telemetry against.",
        }}
        isEditable={true}
        editButtonText="Edit Item"
        formFields={[
          {
            field: {
              displayName: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Stripe Payments API",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Vendor-managed. No telemetry. Owned by Payments.",
          },
        ]}
        modelDetailProps={{
          modelType: InventoryItem,
          id: "inventory-item-settings",
          fields: [
            {
              field: {
                displayName: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.LongText,
              placeholder: "No description.",
            },
            {
              field: {
                entityType: true,
              },
              title: "Type",
              fieldType: FieldType.Text,
            },
            {
              field: {
                entityKey: true,
              },
              title: "Identity Key",
              fieldType: FieldType.Text,
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default InventoryItemSettings;
