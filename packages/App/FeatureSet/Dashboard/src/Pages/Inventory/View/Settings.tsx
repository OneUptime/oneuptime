import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import {
  InventorySettingsPolicy,
  getInventorySettingsPolicy,
} from "../../../Components/Inventory/InventorySettingsPolicy";
import useInventoryItem, {
  UseInventoryItemResult,
} from "../../../Components/Inventory/useInventoryItem";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Route from "Common/Types/API/Route";
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
 * Only manual items are editable here because Inventory owns those records.
 * Discovered and mirrored metadata is reconciled from its source, so those
 * items render the same details read-only with an explanation of where a
 * lasting change must be made. Type and identity key remain fixed for every
 * source because changing either would strand relationship edges.
 *
 * Archiving lives here too, beside the other lifecycle controls, so the list
 * itself can keep one unambiguous row action: View. The shared archive card
 * also turns this page into the restore path for an archived item.
 */
const InventoryItemSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { item, isLoading, error }: UseInventoryItemResult =
    useInventoryItem(modelId);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!item) {
    return <ErrorMessage message="This inventory item could not be found." />;
  }

  const policy: InventorySettingsPolicy = getInventorySettingsPolicy(
    item.source,
  );

  return (
    <Fragment>
      {policy.readOnlyExplanation ? (
        <Alert
          dataTestId="inventory-settings-source-owned"
          type={AlertType.INFO}
          strongTitle="This item's source owns its metadata"
          title={policy.readOnlyExplanation}
        />
      ) : null}

      <CardModelDetail<InventoryItem>
        name="Inventory Item Settings"
        cardProps={{
          title: "Item Settings",
          description:
            "The name and description for this item. Its type and identity key are fixed — they are what OneUptime matches telemetry against.",
        }}
        isEditable={policy.isEditable}
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
      <ArchiveResourceCard<InventoryItem>
        modelType={InventoryItem}
        modelId={modelId}
        singularName="inventory item"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.INVENTORY_ITEMS] as Route,
        )}
      />
    </Fragment>
  );
};

export default InventoryItemSettings;
