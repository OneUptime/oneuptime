import PageComponentProps from "../../PageComponentProps";
import DataObservabilityApi from "../../../Components/DataObservability/DataObservabilityApi";
import {
  DATA_PRODUCT_FORM_STEPS,
  getDataProductFormFields,
} from "../../../Components/DataObservability/DataProductForm";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import ObjectID from "Common/Types/ObjectID";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { errorInSentence } from "Common/UI/Utils/ErrorInSentence";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import { useParams } from "react-router-dom";

/*
 * What a data product is made of: its name, its consumers and owner, its
 * tables, and its SLA. Saved, its monitor and SLO are brought in step with
 * it - a new name, a new target - as the person who saved it.
 */
const DataProductSettingsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { id } = useParams();
  const dataProductId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(id || "");
  }, [id]);
  const [syncError, setSyncError] = useState<string>("");

  return (
    <div className="space-y-3">
      {syncError ? (
        <p className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
          {syncError}
        </p>
      ) : (
        <></>
      )}
      <CardModelDetail<DataProduct>
        name="Data Product Settings"
        cardProps={{
          title: "Settings",
          description:
            "What the data product is, who owns and uses it, its tables, and the freshness SLA it promises.",
        }}
        isEditable={true}
        editButtonText="Edit Data Product"
        formSteps={DATA_PRODUCT_FORM_STEPS}
        formFields={getDataProductFormFields()}
        onSaveSuccess={(): void => {
          setSyncError("");
          DataObservabilityApi.syncDataProduct(dataProductId).catch(
            (err: Error) => {
              setSyncError(
                translator.translateTemplate(
                  "The data product is saved, but its monitor and SLO could not be brought in step: {{reason}}",
                  { reason: errorInSentence(err.message) },
                ),
              );
            },
          );
        }}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: DataProduct,
          id: "data-product-settings",
          modelId: dataProductId,
          fields: [
            {
              field: { name: true },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: { ownerTeam: { name: true } },
              title: "Owner Team",
              fieldType: FieldType.Element,
              getElement: (product: DataProduct): ReactElement => {
                return <span>{product.ownerTeam?.name || "-"}</span>;
              },
            },
            {
              field: { description: true },
              title: "Description",
              fieldType: FieldType.LongText,
              placeholder: "No description",
            },
            {
              field: { consumers: true },
              title: "Consumers",
              fieldType: FieldType.LongText,
              placeholder: "No consumers named",
            },
            {
              field: { freshByTimeOfDay: true },
              title: "Fresh By (UTC)",
              fieldType: FieldType.Text,
              placeholder: "No daily deadline",
            },
            {
              field: { maxDataAgeInMinutes: true },
              title: "Maximum Data Age (Minutes)",
              fieldType: FieldType.Number,
              placeholder: "No limit",
            },
            {
              field: { slaTargetPercentage: true },
              title: "SLA Target (%)",
              fieldType: FieldType.Number,
            },
          ],
        }}
      />
    </div>
  );
};

export default DataProductSettingsPage;
