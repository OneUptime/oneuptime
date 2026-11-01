import PageComponentProps from "../../PageComponentProps";
import { SensitivityPill } from "../../../Components/DataSecurity/DataSecurityPills";
import StoreExclusionsInput from "../../../Components/DataSecurity/StoreExclusionsInput";
import {
  STORE_ENVIRONMENT_OPTIONS,
  STORE_SENSITIVITY_OPTIONS,
} from "../../../Components/DataSecurity/StoreFieldOptions";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import {
  DataStoreKindFacts,
  getDataStoreKindFacts,
  useDataStoreViewContext,
} from "./DataStoreViewContext";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Label from "Common/Models/DatabaseModels/Label";
import Probe from "Common/Models/DatabaseModels/Probe";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import LabelsElement from "Common/UI/Components/Label/Labels";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDetailField from "Common/UI/Components/ModelDetail/Field";
import { announceModelHeaderChanged } from "Common/UI/Components/Page/ModelHeaderEvents";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A STORE'S SETTINGS, each card one question:
 *
 *   - what it is called, how it is described and labelled - the one place
 *     these are edited;
 *   - what Data Security should know about it that it cannot read: which
 *     environment it serves, a sensitivity set by hand, whether it is meant
 *     to be public, whether it holds data used for AI. Each changes what its
 *     checks say;
 *   - whether its content is scanned and what the scans skip, and - for a
 *     database you run yourself, folded under More fields - how it is
 *     scanned;
 *   - why it holds personal data and how long it keeps it, for the record
 *     of processing on Compliance.
 */

const DataStoreSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataStoreId, dataStore, refresh } = useDataStoreViewContext();
  const kindFacts: DataStoreKindFacts = getDataStoreKindFacts(dataStore?.kind);

  const scanMethodSection: FormFieldCollapsibleSection<DataStore> =
    getAdvancedFormSection<DataStore>({
      description:
        "How OneUptime samples the database: from its own workers with a read-only connection string, or from one of your probes inside your network.",
    });

  // The two switches few stores need: folded under More fields.
  const treatmentMoreFields: FormFieldCollapsibleSection<DataStore> =
    getAdvancedFormSection<DataStore>();

  const yesOrNo: (value: boolean | undefined) => ReactElement = (
    value: boolean | undefined,
  ): ReactElement => {
    return (
      <span className="text-sm text-gray-900">
        {value
          ? translator.translateText("Yes")
          : translator.translateText("No")}
      </span>
    );
  };

  const scanningFormFields: Fields<DataStore> = [
    {
      field: { isContentScanEnabled: true },
      title: "Scan Content",
      description:
        "Sample this store's content to find sensitive data in it. Its configuration is checked either way.",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    },
    {
      field: { scanExclusions: true },
      title: "Scan Exclusions",
      description:
        "Path prefixes, tables or attribute keys the content scan skips, one per line.",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      getCustomElement: (
        values: FormValues<DataStore>,
        elementProps: CustomElementProps,
      ): ReactElement => {
        return (
          <StoreExclusionsInput
            initialValue={values.scanExclusions}
            placeholder={translator.translateText("e.g. backups/")}
            ariaLabelledby={elementProps.ariaLabelledby}
            ariaDescribedby={elementProps.ariaDescribedby}
            error={elementProps.error}
            onChange={(exclusions: Array<string>) => {
              elementProps.onChange?.(exclusions);
            }}
          />
        );
      },
    },
    ...(kindFacts.isSelfManaged
      ? ([
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
            collapsibleSection: scanMethodSection,
          },
          {
            field: { probeConnectionVariable: true },
            title: "Probe Connection Variable",
            description:
              "The environment variable on that probe that holds a read-only connection string. The connection string itself never reaches OneUptime.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "ORDERS_DB_URL",
            collapsibleSection: scanMethodSection,
            showIf: (values: FormValues<DataStore>): boolean => {
              return Boolean(values.scanProbe);
            },
          },
          {
            field: { connectionString: true },
            title: "Connection String",
            description:
              "A read-only connection string for PostgreSQL, MySQL or SQL Server. It is encrypted and never shown again.",
            fieldType: FormFieldSchemaType.Password,
            required: false,
            placeholder: "postgresql://reader:password@db.internal:5432/app",
            collapsibleSection: scanMethodSection,
            showIf: (values: FormValues<DataStore>): boolean => {
              return !values.scanProbe;
            },
          },
        ] as Fields<DataStore>)
      : []),
  ];

  const scanningDetailFields: Array<ModelDetailField<DataStore>> = [
    {
      field: { isContentScanEnabled: true },
      title: "Scan Content",
      fieldType: FieldType.Element,
      getElement: (item: DataStore): ReactElement => {
        if (!kindFacts.isContentScannable) {
          return (
            <span className="text-sm text-gray-500">
              {translator.translateText(
                "OneUptime cannot sample this kind of store's content yet. Its configuration is still checked.",
              )}
            </span>
          );
        }

        return yesOrNo(item.isContentScanEnabled);
      },
    },
    {
      field: { scanExclusions: true },
      title: "Scan Exclusions",
      fieldType: FieldType.Element,
      getElement: (item: DataStore): ReactElement => {
        const exclusions: Array<string> = Array.isArray(item.scanExclusions)
          ? item.scanExclusions
          : [];

        if (exclusions.length === 0) {
          return (
            <span className="text-sm text-gray-500">
              {translator.translateText("Nothing is skipped.")}
            </span>
          );
        }

        return (
          <div className="flex flex-col gap-0.5">
            {exclusions.map((exclusion: string): ReactElement => {
              return (
                <code
                  key={exclusion}
                  className="font-mono text-sm text-gray-800"
                >
                  {exclusion}
                </code>
              );
            })}
          </div>
        );
      },
    },
    ...(kindFacts.isSelfManaged
      ? ([
          {
            field: { scanProbe: { name: true } },
            title: "Scanned From",
            fieldType: FieldType.Element,
            getElement: (item: DataStore): ReactElement => {
              if (item.scanProbe?.name) {
                return (
                  <span className="text-sm text-gray-900">
                    {translator.translateTemplate(
                      "The probe {{probe}}, with the connection string in {{variable}}",
                      {
                        probe: item.scanProbe.name,
                        variable: item.probeConnectionVariable || "-",
                      },
                    )}
                  </span>
                );
              }

              return (
                <span className="text-sm text-gray-900">
                  {translator.translateText(
                    "OneUptime's workers, with the connection string you gave",
                  )}
                </span>
              );
            },
          },
        ] as Array<ModelDetailField<DataStore>>)
      : []),
  ];

  return (
    <Fragment>
      <CardModelDetail<DataStore>
        name="Data Store Details"
        cardProps={{
          title: "Data Store Details",
          description:
            "How this store is named, described and labelled everywhere it appears. Renaming it changes nothing in its cloud.",
        }}
        isEditable={true}
        editButtonText="Edit Details"
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "orders-db",
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "What the store is for, in your team's words",
          },
          getLabelsFormField<DataStore>(),
        ]}
        onSaveSuccess={(): void => {
          // The page header shows the name and the labels: read them again.
          announceModelHeaderChanged({
            modelType: DataStore,
            modelId: dataStoreId,
          });
          refresh();
        }}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: DataStore,
          id: "data-store-details",
          modelId: dataStoreId,
          fields: [
            {
              field: { name: true },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: { kind: true },
              title: "Kind",
              fieldType: FieldType.Text,
            },
            {
              field: { description: true },
              title: "Description",
              fieldType: FieldType.Text,
              placeholder: "No description",
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: DataStore): ReactElement => {
                return (
                  <LabelsElement
                    labels={(item.labels as Array<Label> | undefined) || []}
                  />
                );
              },
            },
          ],
        }}
      />

      {/*
       * Each card's button names what it edits: three cards all saying
       * "Edit Data Store" read as three ways to do one thing.
       */}
      <CardModelDetail<DataStore>
        name="Classification"
        cardProps={{
          title: "Classification",
          description:
            "What its tags and scans cannot always tell. Each changes what its checks find.",
        }}
        isEditable={true}
        editButtonText="Edit Classification"
        formFields={[
          {
            field: { environment: true },
            title: "Environment",
            description:
              "Read from its tags and name. Production data in a store that is not production is an issue of its own.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: STORE_ENVIRONMENT_OPTIONS,
            required: true,
          },
          {
            field: { sensitivityOverride: true },
            title: "Sensitivity Override",
            description:
              "Treat the store as this sensitive, whatever its scans find. Leave it empty to go by its scans.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: STORE_SENSITIVITY_OPTIONS,
            required: false,
            placeholder: "As its scans find",
          },
          {
            field: { isPublicByDesign: true },
            title: "Public By Design",
            description:
              "The store is meant to be public, such as a website's images. Its public access checks pass.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            collapsibleSection: treatmentMoreFields,
          },
          {
            field: { isAiData: true },
            title: "Used For AI",
            description:
              "The store holds data used to train or ground an AI model. Restricted data in it is an issue of its own.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            collapsibleSection: treatmentMoreFields,
          },
        ]}
        onSaveSuccess={(): void => {
          refresh();
        }}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: DataStore,
          id: "data-store-handling",
          modelId: dataStoreId,
          selectMoreFields: { sensitivity: true },
          fields: [
            {
              field: { environment: true },
              title: "Environment",
              fieldType: FieldType.Element,
              getElement: (item: DataStore): ReactElement => {
                return (
                  <span className="text-sm text-gray-900">
                    {translator.translateText(item.environment) || "-"}
                  </span>
                );
              },
            },
            {
              field: { sensitivityOverride: true },
              title: "Sensitivity",
              fieldType: FieldType.Element,
              getElement: (item: DataStore): ReactElement => {
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <SensitivityPill
                      sensitivity={item.sensitivityOverride || item.sensitivity}
                    />
                    <span className="text-sm text-gray-500">
                      {item.sensitivityOverride
                        ? translator.translateText("Set by hand")
                        : translator.translateText("As its scans find")}
                    </span>
                  </div>
                );
              },
            },
            {
              field: { isPublicByDesign: true },
              title: "Public By Design",
              fieldType: FieldType.Element,
              getElement: (item: DataStore): ReactElement => {
                return yesOrNo(item.isPublicByDesign);
              },
            },
            {
              field: { isAiData: true },
              title: "Used For AI",
              fieldType: FieldType.Element,
              getElement: (item: DataStore): ReactElement => {
                return yesOrNo(item.isAiData);
              },
            },
          ],
        }}
      />

      <CardModelDetail<DataStore>
        name="Content Scans"
        cardProps={{
          title: "Content Scans",
          description:
            "Whether samples of its content are read to find sensitive data, and what the scans skip.",
        }}
        isEditable={true}
        editButtonText="Edit Content Scans"
        formFields={scanningFormFields}
        onSaveSuccess={(): void => {
          refresh();
        }}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: DataStore,
          id: "data-store-scanning",
          modelId: dataStoreId,
          selectMoreFields: kindFacts.isSelfManaged
            ? { probeConnectionVariable: true }
            : {},
          fields: scanningDetailFields,
        }}
      />

      <CardModelDetail<DataStore>
        name="Record of Processing"
        cardProps={{
          title: "Record of Processing",
          description:
            "Why this store holds personal data and how long it keeps it, for the GDPR record of processing on Compliance.",
        }}
        isEditable={true}
        editButtonText="Edit Record"
        formFields={[
          {
            field: { purpose: true },
            title: "Purpose",
            description: "Why the store holds personal data.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Customer orders, for fulfilment and support",
          },
          {
            field: { retention: true },
            title: "Retention",
            description: "How long data is kept in the store.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Two years after an account is closed",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: DataStore,
          id: "data-store-record-of-processing",
          modelId: dataStoreId,
          fields: [
            {
              field: { purpose: true },
              title: "Purpose",
              fieldType: FieldType.Text,
              placeholder: "Not set",
            },
            {
              field: { retention: true },
              title: "Retention",
              fieldType: FieldType.Text,
              placeholder: "Not set",
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default DataStoreSettings;
