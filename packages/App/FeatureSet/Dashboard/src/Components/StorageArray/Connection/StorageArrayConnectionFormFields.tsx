import Probe from "Common/Models/DatabaseModels/Probe";
import StorageArrayConnection from "Common/Models/DatabaseModels/StorageArrayConnection";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { StorageArrayProbeCollector } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollector";
import ModelField, {
  FieldFooterProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import StorageArrayConnectionTestPanel from "./StorageArrayConnectionTestPanel";
import {
  getDefaultStorageArrayProbeId,
  getStorageArrayProbeOptions,
  getStorageArrayTestInput,
  validateStorageArrayAddress,
  validateTrustedCertificate,
} from "./StorageArrayConnectionView";

/*
 * The fields of a storage array connection (#11004): connecting a new one
 * (Connect Unisphere, on the Connections list), and changing how one is
 * connected (Edit Connection, on its page) - VMware's Connect vCenter, for
 * a Unisphere for PowerMax.
 *
 * Both walk the same two steps: where the server is and how to log in to
 * it, then its certificate - with "Test connection" under it, which shows
 * what the account can see on each array and trusts the certificate in one
 * click - and its name.
 *
 * The password is write-only: an edit leaves it empty to keep the saved
 * one. A saved password only ever goes to the address, through the probe
 * and to the certificate it was entered for: changing one asks for it
 * again - except trusting the certificate a test or a collection found.
 */

export const STORAGE_ARRAY_CONNECTION_FORM_STEPS: Array<
  FormStep<StorageArrayConnection>
> = [
  { title: "Unisphere", id: "connection" },
  { title: "Certificate and Name", id: "certificate-and-name" },
];

export interface StorageArrayConnectionFormOptions {
  probes: Array<Probe>;
  isBillingEnabled: boolean;
  translator: Translator;
  collector: StorageArrayProbeCollector;
  // The connection an edit changes: its saved password is tested when none is typed.
  storageArrayConnectionId?: ObjectID | undefined;
}

function getTestPanel(
  values: FormValues<StorageArrayConnection>,
  footer: FieldFooterProps | undefined,
  options: StorageArrayConnectionFormOptions,
): ReactElement {
  return (
    <StorageArrayConnectionTestPanel
      input={getStorageArrayTestInput(
        values,
        options.collector.storageSystem,
        options.storageArrayConnectionId,
      )}
      collector={options.collector}
      onTrustCertificate={
        footer
          ? (fingerprint: string) => {
              footer.setValue(fingerprint);
            }
          : undefined
      }
    />
  );
}

function getProbesPageRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITORS_SETTINGS_PROBES] as Route,
  );
}

function getConnectionFields(
  options: StorageArrayConnectionFormOptions,
  isEdit: boolean,
): Array<ModelField<StorageArrayConnection>> {
  const words: StorageArrayProbeCollector["words"] = options.collector.words;
  return [
    {
      field: {
        address: true,
      },
      title: words.addressTitle,
      stepId: "connection",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: words.addressPlaceholder,
      description: words.addressDescription,
      customValidation: (
        values: FormValues<StorageArrayConnection>,
      ): string | null => {
        return validateStorageArrayAddress(
          (values as Record<string, unknown>)["address"],
          options.collector.storageSystem,
        );
      },
    },
    {
      field: {
        username: true,
      },
      title: "User Name",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: words.usernamePlaceholder,
      description: words.usernameDescription,
      autoComplete: "off",
    },
    {
      field: {
        password: true,
      },
      title: "Password",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Password,
      // An edit keeps the saved password when this stays empty.
      required: !isEdit,
      description:
        "Encrypted, never shown again, and sent only to the probe below.",
      autoComplete: "new-password",
    },
    {
      field: {
        collectionProbe: true,
      },
      title: "Probe",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      placeholder: "Probe",
      description: words.probeDescription,
      sideLink: {
        text: "Add a probe",
        url: getProbesPageRoute(),
        openLinkInNewTab: true,
      },
      dropdownOptions: getStorageArrayProbeOptions(
        options.probes,
        options.isBillingEnabled,
        options.translator,
      ),
      ...(isEdit
        ? {}
        : {
            defaultValue: getDefaultStorageArrayProbeId(
              options.probes,
              options.isBillingEnabled,
            ),
          }),
    },
  ];
}

function getCertificateField(
  options: StorageArrayConnectionFormOptions,
  stepId: string,
): ModelField<StorageArrayConnection> {
  return {
    field: {
      trustedCertificateFingerprint: true,
    },
    title: "Trusted Certificate",
    stepId: stepId,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: "AB:CD:EF:...",
    description: options.collector.words.certificateDescription,
    customValidation: (
      values: FormValues<StorageArrayConnection>,
    ): string | null => {
      return validateTrustedCertificate(
        (values as Record<string, unknown>)["trustedCertificateFingerprint"],
      );
    },
    getFooterElement: (
      values: FormValues<StorageArrayConnection>,
      _error?: string,
      footer?: FieldFooterProps,
    ): ReactElement => {
      return getTestPanel(values, footer, options);
    },
  };
}

function getIntervalField(
  options: StorageArrayConnectionFormOptions,
  stepId: string,
  section: FormFieldCollapsibleSection<StorageArrayConnection>,
  isEdit: boolean,
): ModelField<StorageArrayConnection> {
  const interval: StorageArrayProbeCollector["collectionInterval"] =
    options.collector.collectionInterval;
  return {
    field: {
      collectionIntervalInMinutes: true,
    },
    title: "Collect Every (Minutes)",
    stepId: stepId,
    fieldType: FormFieldSchemaType.Number,
    required: false,
    ...(isEdit ? {} : { defaultValue: interval.defaultMinutes }),
    description: options.collector.words.intervalDescription,
    validation: {
      minValue: interval.minMinutes,
      maxValue: interval.maxMinutes,
    },
    collapsibleSection: section,
  };
}

/*
 * Connect Unisphere (a new connection, read by a probe) and Edit Connection
 * (a saved one) ask the same questions in the same order, so changing one
 * reads like making it.
 */
function getFormFields(
  options: StorageArrayConnectionFormOptions,
  isEdit: boolean,
): Array<ModelField<StorageArrayConnection>> {
  const advancedSection: FormFieldCollapsibleSection<StorageArrayConnection> =
    getAdvancedFormSection<StorageArrayConnection>();

  return [
    ...getConnectionFields(options, isEdit),
    getCertificateField(options, "certificate-and-name"),
    {
      field: {
        name: true,
      },
      title: "Name",
      stepId: "certificate-and-name",
      fieldType: FormFieldSchemaType.Text,
      // A new connection is named after its host when this stays empty.
      required: isEdit,
      placeholder: options.collector.words.namePlaceholder,
      description: options.collector.words.nameDescription,
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "certificate-and-name",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Unisphere for PowerMax of the primary datacenter",
      collapsibleSection: advancedSection,
    },
    getIntervalField(options, "certificate-and-name", advancedSection, isEdit),
  ];
}

export function getStorageArrayConnectFormFields(
  options: StorageArrayConnectionFormOptions,
): Array<ModelField<StorageArrayConnection>> {
  return getFormFields(options, false);
}

export function getStorageArrayConnectionEditFormFields(
  options: StorageArrayConnectionFormOptions,
): Array<ModelField<StorageArrayConnection>> {
  return getFormFields(options, true);
}
