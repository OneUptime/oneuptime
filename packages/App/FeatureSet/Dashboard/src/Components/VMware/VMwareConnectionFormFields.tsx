import Probe from "Common/Models/DatabaseModels/Probe";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
} from "Common/Utils/VMware/VMwareCollectionSettings";
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
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import VMwareConnectionTestPanel from "./VMwareConnectionTestPanel";
import {
  getDefaultVMwareCollectionProbeId,
  getVMwareCollectionProbeOptions,
  getVMwareConnectionTestInput,
  validateTrustedCertificate,
  validateVCenterAddress,
} from "./VMwareProbeCollectionView";

/*
 * The fields of a vCenter a probe collects: connecting a new one (Connect
 * vCenter, on the vCenters list), and changing how one is connected (Edit
 * Connection, on its Settings page).
 *
 * Both walk two steps: where vCenter is and how to log in to it, then its
 * certificate - with "Test connection" under it, which shows the
 * certificate vCenter presents and trusts it in one click. Connect asks
 * for the vCenter's name on that step too; an edit leaves the name,
 * description and labels to the vCenter's Details card, the one place they
 * are edited.
 *
 * The password is write-only: an edit leaves it empty to keep the saved
 * one (ModelForm offers such a field empty, and sends it only when typed).
 * A saved password only ever goes to the address, through the probe, and
 * to the certificate it was entered for: changing one of them asks for it
 * again - except trusting the certificate a test or a collection found.
 */

export const VMWARE_CONNECT_FORM_STEPS: Array<FormStep<VMwareVCenter>> = [
  { title: "vCenter", id: "connection" },
  { title: "Certificate and Name", id: "certificate-and-name" },
];

export const VMWARE_CONNECTION_EDIT_FORM_STEPS: Array<FormStep<VMwareVCenter>> =
  [
    { title: "vCenter", id: "connection" },
    { title: "Certificate", id: "certificate" },
  ];

export interface VMwareConnectionFormOptions {
  probes: Array<Probe>;
  isBillingEnabled: boolean;
  translator: Translator;
  // The vCenter an edit changes: its saved password is tested when none is typed.
  vmwareVCenterId?: ObjectID | undefined;
}

// "Test connection" under the certificate, and "Trust this certificate" filling it in.
function getTestPanel(
  values: FormValues<VMwareVCenter>,
  footer: FieldFooterProps | undefined,
  vmwareVCenterId: ObjectID | undefined,
): ReactElement {
  return (
    <VMwareConnectionTestPanel
      input={getVMwareConnectionTestInput(values, vmwareVCenterId)}
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

// Connect vCenter: a new vCenter, collected by a probe.
export function getVMwareConnectFormFields(
  options: VMwareConnectionFormOptions,
): Array<ModelField<VMwareVCenter>> {
  const advancedSection: FormFieldCollapsibleSection<VMwareVCenter> =
    getAdvancedFormSection<VMwareVCenter>();

  return [
    {
      field: {
        vcenterUrl: true,
      },
      title: "vCenter Address",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "https://vcsa.example.com",
      description:
        "The address you open the vSphere Client at: vCenter Server, or a standalone ESXi host.",
      customValidation: (values: FormValues<VMwareVCenter>): string | null => {
        return validateVCenterAddress(
          (values as Record<string, unknown>)["vcenterUrl"],
        );
      },
    },
    {
      field: {
        vcenterUsername: true,
      },
      title: "User Name",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "oneuptime@vsphere.local",
      description:
        "A vSphere user with its domain, given the Read-Only role on the top-level vCenter object with Propagate to children ticked. It needs nothing more.",
      autoComplete: "off",
    },
    {
      field: {
        vcenterPassword: true,
      },
      title: "Password",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Password,
      required: true,
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
      description:
        "The probe that collects this vCenter. It has to reach vCenter on TCP 443, so it is usually one you run in vCenter's network.",
      sideLink: {
        text: "Add a probe",
        url: getProbesPageRoute(),
        openLinkInNewTab: true,
      },
      dropdownOptions: getVMwareCollectionProbeOptions(
        options.probes,
        options.isBillingEnabled,
        options.translator,
      ),
      defaultValue: getDefaultVMwareCollectionProbeId(
        options.probes,
        options.isBillingEnabled,
      ),
    },
    {
      field: {
        trustedCertificateFingerprint: true,
      },
      title: "Trusted Certificate",
      stepId: "certificate-and-name",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "AB:CD:EF:...",
      description:
        "Leave empty when vCenter's certificate is from an authority the probe trusts. vCenter uses a certificate from its own authority by default: test the connection to see it, and trust it.",
      customValidation: (values: FormValues<VMwareVCenter>): string | null => {
        return validateTrustedCertificate(
          (values as Record<string, unknown>)["trustedCertificateFingerprint"],
        );
      },
      getFooterElement: (
        values: FormValues<VMwareVCenter>,
        _error?: string,
        footer?: FieldFooterProps,
      ): ReactElement => {
        return getTestPanel(values, footer, undefined);
      },
    },
    {
      field: {
        name: true,
      },
      title: "Name",
      stepId: "certificate-and-name",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "Defaults to the vCenter's host name",
      description: "How this vCenter is named everywhere in OneUptime.",
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "certificate-and-name",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Production vCenter Server in the US East datacenter",
      collapsibleSection: advancedSection,
    },
    {
      field: {
        collectionIntervalInMinutes: true,
      },
      title: "Collect Every (Minutes)",
      stepId: "certificate-and-name",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      defaultValue: DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
      // The bounds and default of VMwareCollectionSettings.
      description:
        "From 1 to 60 minutes. Every 2 minutes matches the VMware agent; collect a large vCenter less often to go easier on it.",
      validation: {
        minValue: MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
        maxValue: MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
      },
      collapsibleSection: advancedSection,
    },
    getLabelsFormField<VMwareVCenter>({
      stepId: "certificate-and-name",
      collapsibleSection: advancedSection,
    }),
  ];
}

// Edit Connection: how a saved vCenter is reached and logged in to.
export function getVMwareConnectionFormFields(
  options: VMwareConnectionFormOptions,
): Array<ModelField<VMwareVCenter>> {
  const advancedSection: FormFieldCollapsibleSection<VMwareVCenter> =
    getAdvancedFormSection<VMwareVCenter>();

  return [
    {
      field: {
        vcenterUrl: true,
      },
      title: "vCenter Address",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "https://vcsa.example.com",
      description:
        "The address you open the vSphere Client at: vCenter Server, or a standalone ESXi host.",
      customValidation: (values: FormValues<VMwareVCenter>): string | null => {
        return validateVCenterAddress(
          (values as Record<string, unknown>)["vcenterUrl"],
        );
      },
    },
    {
      field: {
        vcenterUsername: true,
      },
      title: "User Name",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "oneuptime@vsphere.local",
      description:
        "A vSphere user with its domain, given the Read-Only role on the top-level vCenter object with Propagate to children ticked. It needs nothing more.",
      autoComplete: "off",
    },
    {
      field: {
        vcenterPassword: true,
      },
      title: "Password",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Password,
      required: false,
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
      description:
        "The probe that collects this vCenter. It has to reach vCenter on TCP 443, so it is usually one you run in vCenter's network.",
      sideLink: {
        text: "Add a probe",
        url: getProbesPageRoute(),
        openLinkInNewTab: true,
      },
      dropdownOptions: getVMwareCollectionProbeOptions(
        options.probes,
        options.isBillingEnabled,
        options.translator,
      ),
    },
    {
      field: {
        trustedCertificateFingerprint: true,
      },
      title: "Trusted Certificate",
      stepId: "certificate",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "AB:CD:EF:...",
      description:
        "Leave empty when vCenter's certificate is from an authority the probe trusts. vCenter uses a certificate from its own authority by default: test the connection to see it, and trust it.",
      customValidation: (values: FormValues<VMwareVCenter>): string | null => {
        return validateTrustedCertificate(
          (values as Record<string, unknown>)["trustedCertificateFingerprint"],
        );
      },
      getFooterElement: (
        values: FormValues<VMwareVCenter>,
        _error?: string,
        footer?: FieldFooterProps,
      ): ReactElement => {
        return getTestPanel(values, footer, options.vmwareVCenterId);
      },
    },
    {
      field: {
        collectionIntervalInMinutes: true,
      },
      title: "Collect Every (Minutes)",
      stepId: "certificate",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      // The bounds and default of VMwareCollectionSettings.
      description:
        "From 1 to 60 minutes. Every 2 minutes matches the VMware agent; collect a large vCenter less often to go easier on it.",
      validation: {
        minValue: MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
        maxValue: MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
      },
      collapsibleSection: advancedSection,
    },
  ];
}
