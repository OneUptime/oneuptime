import PageComponentProps from "../PageComponentProps";
import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import {
  DATA_PRODUCT_FORM_STEPS,
  describeDataProductSla,
  getDataProductFormFields,
  getDataProductStatusPill,
} from "../../Components/DataObservability/DataProductForm";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { PluralTemplate } from "Common/Types/Translator";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { errorInSentence } from "Common/UI/Utils/ErrorInSentence";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";

const LATE_TABLES: PluralTemplate = {
  one: "{{count}} table late",
  other: "{{count}} tables late",
};

/*
 * Every data product: the tables someone relies on, with whether their
 * data is fresh by its SLA and what it is as of, late first. Making one
 * also makes its monitor and SLO, as the person who made it
 * (DataProductSync); when that fails, the product is kept and the reason
 * shown, and its Overview offers to try again.
 */
const DataObservabilityDataProductsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [syncError, setSyncError] = useState<string>("");

  const syncProduct: (item: DataProduct) => Promise<DataProduct> = async (
    item: DataProduct,
  ): Promise<DataProduct> => {
    setSyncError("");

    if (item.id) {
      try {
        await DataObservabilityApi.syncDataProduct(item.id);
      } catch (err) {
        setSyncError(
          translator.translateTemplate(
            "The data product is saved, but its monitor and SLO could not be set up: {{reason}}",
            { reason: errorInSentence((err as Error).message) },
          ),
        );
      }
    }

    return item;
  };

  return (
    <div className="space-y-3">
      {syncError ? (
        <p className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
          {syncError}
        </p>
      ) : (
        <></>
      )}
      <ModelTable<DataProduct>
        modelType={DataProduct}
        id="data-observability-data-products"
        name="Data Observability > Data Products"
        userPreferencesKey="data-observability-data-products"
        query={{ ...(projectId ? { projectId: projectId } : {}) }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        createVerb="Create"
        viewButtonText="View"
        onViewPage={(product: DataProduct): Promise<Route> => {
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW] as Route,
              { modelId: product.id! },
            ),
          );
        }}
        sortBy="lateTableCount"
        sortOrder={SortOrder.Descending}
        showRefreshButton={true}
        searchableFields={["name"]}
        cardProps={{
          title: "Data Products",
          description:
            "The tables people rely on, grouped as they know them - a dashboard's, a report's, an AI agent's - each with an owner, its consumers and a freshness SLA, on status pages and tracked as an SLO.",
        }}
        noItemsMessage="No data product yet. Create one for the tables a dashboard or report reads, with when their data must land: its consumers then see if it is fresh."
        formSteps={DATA_PRODUCT_FORM_STEPS}
        formFields={getDataProductFormFields()}
        onCreateSuccess={syncProduct}
        selectMoreFields={{
          freshByTimeOfDay: true,
          maxDataAgeInMinutes: true,
          lateTableCount: true,
        }}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Data Product",
            type: FieldType.Element,
            getExportValue: (product: DataProduct): string => {
              return product.name || "";
            },
            // The page's words beside the name: only the name reads its own way.
            getLineText: drawsItsOwnLines,
            getElement: (product: DataProduct): ReactElement => {
              return (
                <div className="min-w-0">
                  <IsolatedLine
                    as="span"
                    text={product.name || ""}
                    className="block truncate font-medium text-gray-900"
                  />
                  <span className="block truncate text-xs text-gray-500">
                    {describeDataProductSla(translator, product)}
                  </span>
                </div>
              );
            },
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Element,
            getExportValue: (product: DataProduct): string => {
              return product.status || "";
            },
            getElement: (product: DataProduct): ReactElement => {
              return (
                <div className="min-w-0 space-y-1">
                  {getDataProductStatusPill(product.status)}
                  {product.lateTableCount ? (
                    <span className="block text-xs text-yellow-700">
                      {translator.translatePlural(
                        LATE_TABLES,
                        product.lateTableCount,
                      )}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { dataAsOf: true },
            title: "Data As Of",
            type: FieldType.Element,
            getExportValue: (product: DataProduct): string => {
              return product.dataAsOf
                ? OneUptimeDate.fromString(product.dataAsOf).toISOString()
                : "";
            },
            getElement: (product: DataProduct): ReactElement => {
              return (
                <span className="whitespace-nowrap text-sm text-gray-700">
                  {product.dataAsOf
                    ? OneUptimeDate.fromNow(
                        OneUptimeDate.fromString(product.dataAsOf),
                      )
                    : "-"}
                </span>
              );
            },
          },
          {
            field: { ownerTeam: { name: true } },
            title: "Owner",
            type: FieldType.Element,
            disableSort: true,
            getElement: (product: DataProduct): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {product.ownerTeam?.name || "-"}
                </span>
              );
            },
          },
        ]}
      />
    </div>
  );
};

export default DataObservabilityDataProductsPage;
