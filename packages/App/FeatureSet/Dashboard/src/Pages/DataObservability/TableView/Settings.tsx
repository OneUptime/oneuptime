import PageComponentProps from "../../PageComponentProps";
import { useTableViewContext } from "./TableViewContext";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

// What a person can say about a table that OneUptime cannot read: what it is for.
const TableSettingsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataAssetId, refresh } = useTableViewContext();

  return (
    <CardModelDetail<DataAsset>
      name="Table Description"
      cardProps={{
        title: "Description",
        description:
          "What this table holds and who relies on it, in your team's words. It shows on the table's Overview.",
      }}
      isEditable={true}
      editButtonText="Edit Description"
      formFields={[
        {
          field: { description: true },
          title: "Description",
          fieldType: FormFieldSchemaType.Markdown,
          required: false,
          placeholder:
            "Orders placed in the web shop. Read by the revenue dashboards.",
        },
      ]}
      onSaveSuccess={(): void => {
        refresh();
      }}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: DataAsset,
        id: "data-asset-description",
        modelId: dataAssetId,
        fields: [
          {
            field: { description: true },
            title: "Description",
            fieldType: FieldType.Markdown,
            placeholder: "No description",
          },
        ],
      }}
    />
  );
};

export default TableSettingsPage;
