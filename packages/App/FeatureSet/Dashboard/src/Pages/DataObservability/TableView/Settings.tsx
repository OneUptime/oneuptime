import PageComponentProps from "../../PageComponentProps";
import { useTableViewContext } from "./TableViewContext";
import LabelsElement from "Common/UI/Components/Label/Labels";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import Label from "Common/Models/DatabaseModels/Label";
import DataAssetKind from "Common/Types/DataObservability/DataAssetKind";
import {
  DataAssetColumn,
  readDataAssetColumns,
} from "Common/Types/DataObservability/DataAssetColumn";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a person can say about a table that OneUptime cannot read: what it is
 * for, its labels, and which column says when its data last changed.
 */
const TableSettingsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataAssetId, dataAsset, refresh } = useTableViewContext();
  const columnOptions: Array<DropdownOption> = readDataAssetColumns(
    dataAsset?.columns,
  ).map((column: DataAssetColumn): DropdownOption => {
    return { value: column.name, label: column.name };
  });

  return (
    <div className="space-y-5">
      <CardModelDetail<DataAsset>
        name="Table Description"
        cardProps={{
          title: "Description",
          description:
            "What this table holds and who relies on it, in your team's words. It shows on the table's Overview.",
        }}
        isEditable={true}
        editButtonText="Edit Description"
        editModalTitle="Edit Description"
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
      <CardModelDetail<DataAsset>
        name="Table Labels"
        cardProps={{
          title: "Labels",
          description:
            "What this table is about. Owner rules and alert routing can match on them, and Label Rules can set them for you.",
        }}
        isEditable={true}
        editButtonText="Edit Labels"
        editModalTitle="Edit Labels"
        formFields={[
          {
            field: { labels: true },
            title: "Labels",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Labels",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: DataAsset,
          id: "data-asset-labels",
          modelId: dataAssetId,
          fields: [
            {
              field: { labels: { name: true, color: true } },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: DataAsset): ReactElement => {
                return <LabelsElement labels={item.labels || []} />;
              },
            },
          ],
        }}
      />
      {dataAsset?.assetKind === DataAssetKind.StoragePath ? (
        <></>
      ) : (
        <CardModelDetail<DataAsset>
          name="Table Freshness Column"
          cardProps={{
            title: "Freshness Column",
            description:
              "A column that says when each row was written, such as updated_at. The table's last change is then its newest value, not what the database's catalog says. The login needs to read this column.",
          }}
          isEditable={true}
          editButtonText="Edit Freshness Column"
          editModalTitle="Edit Freshness Column"
          formFields={[
            {
              field: { freshnessColumn: true },
              title: "Column",
              description:
                "Read at every collection, so it should be indexed. Times without a zone are taken as UTC.",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: columnOptions,
              required: false,
            },
          ]}
          onSaveSuccess={(): void => {
            refresh();
          }}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 1,
            modelType: DataAsset,
            id: "data-asset-freshness-column",
            modelId: dataAssetId,
            fields: [
              {
                field: { freshnessColumn: true },
                title: "Column",
                fieldType: FieldType.Text,
                placeholder: "The database's catalog says when it last changed",
              },
            ],
          }}
        />
      )}
    </div>
  );
};

export default TableSettingsPage;
