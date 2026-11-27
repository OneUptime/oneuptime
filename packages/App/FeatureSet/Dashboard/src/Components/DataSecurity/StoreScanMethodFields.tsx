import DataStore from "Common/Models/DatabaseModels/DataStore";
import Probe from "Common/Models/DatabaseModels/Probe";
import {
  DataStoreKind,
  isSearchEngineDataStoreKind,
  PROBE_SCANNABLE_DATA_STORE_KINDS,
} from "Common/Types/DataSecurity/DataStoreKind";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import StoreCoverageList from "./StoreCoverageList";
import { SELF_MANAGED_STORE_KIND_OPTIONS } from "./StoreFieldOptions";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { takesConnectionString } from "Common/Utils/DataSecurity/DataStoreCoverage";
import React, { ReactElement } from "react";

/*
 * HOW A STORE YOU RUN IS SCANNED, AS ITS FORMS ASK IT (#11140): from one of
 * your probes, which reads the connection string from its own environment,
 * or from OneUptime's workers, with a read-only connection string.
 *
 * Each field shows only for a kind it does something for. The Connection
 * String showed for every kind a person could add, and named only
 * PostgreSQL, MySQL and SQL Server: on an Elasticsearch store it was saved
 * and never read, and on a MongoDB or Redis store it still is nothing
 * OneUptime's scans read. A probe scans the kinds its samplers read
 * (PROBE_SCANNABLE_DATA_STORE_KINDS); the workers, the kinds that take a
 * connection string (takesConnectionString). The example under the field
 * is the kind's own.
 *
 * The Add form and a store's Settings both build their fields here, so the
 * two never ask differently.
 */

// The example under the Connection String, by the kind it is for.
export const CONNECTION_STRING_EXAMPLES: Readonly<
  Partial<Record<DataStoreKind, string>>
> = {
  [DataStoreKind.PostgreSql]:
    "postgresql://reader:password@db.internal:5432/app",
  [DataStoreKind.MySql]: "mysql://reader:password@db.internal:3306/app",
  [DataStoreKind.SqlServer]: "mssql://reader:password@db.internal:1433/app",
  [DataStoreKind.Elasticsearch]: "https://reader:password@search.internal:9200",
  [DataStoreKind.OpenSearch]: "https://reader:password@search.internal:9200",
};

// Whether one of your probes can scan a store of this kind.
export function isProbeScannableKind(kind: string | undefined | null): boolean {
  return Boolean(
    kind && PROBE_SCANNABLE_DATA_STORE_KINDS.includes(kind as DataStoreKind),
  );
}

/*
 * What a form saves of how a store is scanned, kept to what its kind reads:
 * a connection string or a probe the person filled in for one kind, then
 * left behind by picking another, is not saved with it.
 */
export function keepScanFieldsTheKindReads(
  item: DataStore,
  kind: string | undefined | null,
): DataStore {
  const record: Record<string, unknown> = item as unknown as Record<
    string,
    unknown
  >;
  const isFromProbe: boolean = Boolean(
    record["scanProbe"] || record["scanProbeId"],
  );

  if (
    !takesConnectionString(kind) ||
    (isFromProbe && isProbeScannableKind(kind))
  ) {
    delete record["connectionString"];
  }

  if (!isProbeScannableKind(kind)) {
    delete record["scanProbe"];
    delete record["scanProbeId"];
    delete record["probeConnectionVariable"];
  } else if (!isFromProbe) {
    delete record["probeConnectionVariable"];
  }

  return item;
}

/*
 * The Add form's Kind: what a store you run runs, and, once one is picked,
 * what OneUptime will and will not check on it, and why (#11140) - before
 * anyone fills in a connection string a kind would never read.
 */
export function getStoreKindField(data: {
  translator: Translator;
}): Field<DataStore> {
  return {
    field: { kind: true },
    title: "Kind",
    // The model's own words name buckets and logs, which nobody adds here.
    description: "What it runs, such as PostgreSQL or Elasticsearch.",
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: SELF_MANAGED_STORE_KIND_OPTIONS,
    required: true,
    placeholder: "Choose what it runs",
    getFooterElement: (
      values: FormValues<DataStore>,
    ): ReactElement | undefined => {
      if (!values.kind) {
        return undefined;
      }

      return (
        <div
          className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-3"
          data-testid="data-store-kind-coverage"
        >
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            {data.translator.translateText("What OneUptime checks on it")}
          </p>
          <StoreCoverageList
            kind={values.kind}
            isScannedFromProbe={Boolean(values.scanProbe)}
          />
        </div>
      );
    },
  };
}

export function getStoreScanMethodFields(data: {
  section: FormFieldCollapsibleSection<DataStore>;
  // The store's kind: what the form holds, or the store's own on its Settings.
  kindOf: (values: FormValues<DataStore>) => string | undefined | null;
  translator: Translator;
}): Fields<DataStore> {
  return [
    {
      field: { scanProbe: true },
      title: "Scan From Probe",
      description:
        "Scan from one of your probes, inside your network. Leave it empty to scan from OneUptime's workers with a connection string.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownModal: {
        type: Probe,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Scan from OneUptime's workers",
      collapsibleSection: data.section,
      showIf: (values: FormValues<DataStore>): boolean => {
        return isProbeScannableKind(data.kindOf(values));
      },
    },
    {
      field: { probeConnectionVariable: true },
      title: "Probe Connection Variable",
      description:
        "The environment variable on that probe that holds a read-only connection string. The connection string itself never reaches OneUptime.",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "ORDERS_DB_URL",
      collapsibleSection: data.section,
      showIf: (values: FormValues<DataStore>): boolean => {
        return (
          Boolean(values.scanProbe) && isProbeScannableKind(data.kindOf(values))
        );
      },
    },
    {
      field: { connectionString: true },
      title: "Connection String",
      description:
        "A read-only connection string for OneUptime's workers. It is encrypted and never shown again.",
      fieldType: FormFieldSchemaType.Password,
      required: false,
      collapsibleSection: data.section,
      showIf: (values: FormValues<DataStore>): boolean => {
        return !values.scanProbe && takesConnectionString(data.kindOf(values));
      },
      getFooterElement: (
        values: FormValues<DataStore>,
      ): ReactElement | undefined => {
        const kind: string | undefined | null = data.kindOf(values);
        const example: string | undefined =
          CONNECTION_STRING_EXAMPLES[kind as DataStoreKind];

        if (!example) {
          return undefined;
        }

        return (
          <p
            className="mt-1.5 text-xs text-gray-500 [overflow-wrap:anywhere]"
            data-testid="connection-string-example"
          >
            {isSearchEngineDataStoreKind(kind)
              ? data.translator.translateText(
                  "The cluster's address, with a read-only user or ?api_key= in it. For example:",
                )
              : data.translator.translateText("For example:")}{" "}
            <code className="font-mono text-gray-700" dir="ltr">
              {example}
            </code>
          </p>
        );
      },
    },
  ];
}
