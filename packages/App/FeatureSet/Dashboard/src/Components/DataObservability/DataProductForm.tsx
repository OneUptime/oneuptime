import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import Team from "Common/Models/DatabaseModels/Team";
import { Gray500, Green500, Yellow500 } from "Common/Types/BrandColors";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DataProductStatus,
  MINUTES_PER_DAY,
} from "Common/Types/DataObservability/DataProductFreshness";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import Pill from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement } from "react";

/*
 * What a data product is made of, asked the same way when it is made (Data
 * Products) and when it is changed (its Settings): what it is and who uses
 * it, its tables, and its freshness SLA - a time of day in UTC, a maximum
 * age, or both, which the server checks as it saves.
 */

export const DATA_PRODUCT_FORM_STEPS: Array<FormStep<DataProduct>> = [
  { title: "Data Product", id: "product" },
  { title: "Tables", id: "tables" },
  { title: "Freshness SLA", id: "sla" },
];

export function getDataProductFormFields(): Array<ModelField<DataProduct>> {
  return [
    {
      field: { name: true },
      stepId: "product",
      title: "Name",
      description: "What the data product is called, as its consumers know it.",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Revenue dashboard",
    },
    {
      field: { description: true },
      stepId: "product",
      title: "Description",
      description: "What the data is, and what it is for.",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Daily revenue by region, for the finance team's dashboard.",
    },
    {
      field: { consumers: true },
      stepId: "product",
      title: "Consumers",
      description: "Who uses the data: teams, dashboards, reports, AI agents.",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Finance, the board deck, the forecasting agent",
    },
    {
      field: { ownerTeam: true },
      stepId: "product",
      title: "Owner Team",
      description: "The team that owns the data product.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownModal: {
        type: Team,
        labelField: "name",
        valueField: "_id",
        sort: { name: SortOrder.Ascending },
      },
      required: false,
      placeholder: "Select a team",
    },
    {
      field: { dataAssets: true },
      stepId: "tables",
      title: "Tables",
      description:
        "The watched tables the data product is made of. Search by schema and table name.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: DataAsset,
        labelField: "assetKey",
        valueField: "_id",
        sort: { assetKey: SortOrder.Ascending },
        query: { isDropped: false },
      },
      required: true,
      placeholder: "Select tables",
    },
    {
      field: { freshByTimeOfDay: true },
      stepId: "sla",
      title: "Fresh By (UTC)",
      description:
        "The time of day, in UTC, by which each day's data lands, as HH:MM. From then, every table must have changed that day.",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "07:00",
    },
    {
      field: { maxDataAgeInMinutes: true },
      stepId: "sla",
      title: "Maximum Data Age (Minutes)",
      description:
        "How old the data may be before the product is late, in minutes: 120 is two hours. Give this, a Fresh By time, or both.",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      placeholder: "120",
    },
    {
      field: { slaTargetPercentage: true },
      stepId: "sla",
      title: "SLA Target (%)",
      description:
        "The share of the time the data must be on time, which the product's SLO tracks over 30 days: 99 allows about 7 hours late a month.",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      placeholder: "99",
    },
  ];
}

export function getDataProductStatusPill(
  status: string | undefined,
): ReactElement {
  switch (status) {
    case DataProductStatus.OnTime:
      return <Pill text="On Time" color={Green500} />;
    case DataProductStatus.Late:
      return <Pill text="Late" color={Yellow500} />;
    default:
      return <Pill text="Unknown" color={Gray500} />;
  }
}

function describeMinutes(translator: Translator, minutes: number): string {
  if (minutes % MINUTES_PER_DAY === 0) {
    return translator.translateTemplate("{{count}}d", {
      count: minutes / MINUTES_PER_DAY,
    });
  }

  if (minutes % 60 === 0) {
    return translator.translateTemplate("{{count}}h", { count: minutes / 60 });
  }

  return translator.translateTemplate("{{count}}m", { count: minutes });
}

// The SLA in a line: "Fresh by 07:00 UTC, never older than 2h".
export function describeDataProductSla(
  translator: Translator,
  product: Pick<DataProduct, "freshByTimeOfDay" | "maxDataAgeInMinutes">,
): string {
  const parts: Array<string> = [];

  if (product.freshByTimeOfDay) {
    parts.push(
      translator.translateTemplate("Fresh by {{time}} UTC", {
        time: product.freshByTimeOfDay,
      }),
    );
  }

  if (
    product.maxDataAgeInMinutes !== undefined &&
    product.maxDataAgeInMinutes !== null
  ) {
    parts.push(
      translator.translateTemplate("never older than {{age}}", {
        age: describeMinutes(translator, Number(product.maxDataAgeInMinutes)),
      }),
    );
  }

  return parts.length > 0 ? parts.join(", ") : "-";
}
