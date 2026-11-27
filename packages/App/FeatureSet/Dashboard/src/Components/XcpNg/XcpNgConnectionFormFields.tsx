import Probe from "Common/Models/DatabaseModels/Probe";
import XcpNgConnection from "Common/Models/DatabaseModels/XcpNgConnection";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import XcpNgConnectionType from "Common/Types/XcpNg/XcpNgConnectionType";
import ModelField, {
  FieldFooterProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
} from "Common/Utils/XcpNg/XcpNgCollectionSettings";
import React, { ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  getDefaultVMwareCollectionProbeId,
  getVMwareCollectionProbeOptions,
} from "../VMware/VMwareProbeCollectionView";
import XcpNgConnectionTestPanel from "./XcpNgConnectionTestPanel";
import {
  getXcpNgConnectionTestInput,
  getXcpNgConnectionTypeOptions,
  getXcpNgFormConnectionType,
  validateXcpNgAddress,
  validateXcpNgTrustedCertificate,
} from "./XcpNgConnectionView";

/*
 * The fields of an XCP-ng connection a probe reads: connecting a new one
 * (Connect, on the Connections page), and changing how one is reached
 * (Edit Connection, on its page).
 *
 * Connect walks three steps: what to read - a Xen Orchestra and all its
 * pools, or one pool's XAPI - with its address and the probe that reaches
 * it; how to sign in, which is the kind's own (the OpenMetrics plugin's
 * secret and an optional API token, or the pool's user name and password);
 * then the certificate, with "Test connection" under it, which shows the
 * one presented and trusts it in one click, and a name. The kind is never
 * changed afterwards: an edit asks only for that kind's fields.
 *
 * Secrets are write-only: an edit leaves them empty to keep the saved ones
 * (ModelForm offers such a field empty, and sends it only when typed). A
 * saved secret only ever goes to the address, through the probe, and to the
 * certificate it was entered for: changing one of them asks for it again -
 * except trusting the certificate a test or a read found.
 *
 * The probes offered are the ones a vCenter may be read through, by the
 * same rule (Common/Utils/XcpNg/XcpNgCollectionSettings.getProbeRefusal):
 * the project's own, and the instance's own on a self-hosted instance.
 */

export const XCP_NG_CONNECT_FORM_STEPS: Array<FormStep<XcpNgConnection>> = [
  { title: "Source", id: "source" },
  { title: "Sign In", id: "sign-in" },
  { title: "Certificate and Name", id: "certificate-and-name" },
];

export const XCP_NG_CONNECTION_EDIT_FORM_STEPS: Array<
  FormStep<XcpNgConnection>
> = [
  { title: "Connection", id: "connection" },
  { title: "Certificate", id: "certificate" },
];

export interface XcpNgConnectionFormOptions {
  probes: Array<Probe>;
  isBillingEnabled: boolean;
  translator: Translator;
}

export interface XcpNgConnectionEditOptions extends XcpNgConnectionFormOptions {
  // The connection an edit changes: its saved secrets are tested when none is typed.
  xcpNgConnectionId: ObjectID;
  connectionType: XcpNgConnectionType;
}

const isXenOrchestra: (values: FormValues<XcpNgConnection>) => boolean = (
  values: FormValues<XcpNgConnection>,
): boolean => {
  return (
    getXcpNgFormConnectionType(values) === XcpNgConnectionType.XenOrchestra
  );
};

const isXapi: (values: FormValues<XcpNgConnection>) => boolean = (
  values: FormValues<XcpNgConnection>,
): boolean => {
  return getXcpNgFormConnectionType(values) === XcpNgConnectionType.Xapi;
};

function getProbesPageRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITORS_SETTINGS_PROBES] as Route,
  );
}

// The words of each kind's fields, the same on Connect and Edit Connection.
const WORDS: {
  xenOrchestraAddress: {
    title: string;
    placeholder: string;
    description: string;
  };
  xapiAddress: { title: string; placeholder: string; description: string };
  probe: string;
  openMetricsSecret: string;
  apiToken: string;
  username: string;
  password: string;
  certificate: string;
  interval: string;
} = {
  xenOrchestraAddress: {
    title: "Xen Orchestra Address",
    placeholder: "https://xo.example.com",
    description:
      "The address you open Xen Orchestra at in a browser. Every pool it manages is read through this one connection.",
  },
  xapiAddress: {
    title: "Pool Master Address",
    placeholder: "https://10.0.0.10",
    description:
      "The management address of the pool's master. When another host becomes master, the probe follows it.",
  },
  probe:
    "The probe that reads this connection. It has to reach the address on TCP 443, so it is usually one you run in the same network.",
  openMetricsSecret:
    "The secret set in Xen Orchestra's OpenMetrics plugin, under Settings > Plugins > openmetrics. Encrypted, never shown again, and sent only to the probe you picked.",
  apiToken:
    "Optional. A token of a Xen Orchestra user with the Read only role: OneUptime checks that it only reads, warns you before it expires, and reads the REST API with it. Encrypted, never shown again.",
  username:
    "root, or an Active Directory user of the pool with XAPI's read-only role. XAPI has no read-only local account.",
  password:
    "Encrypted, never shown again, and sent only to the probe you picked.",
  certificate:
    "Leave empty if the probe trusts the certificate. Xen Orchestra and XCP-ng sign their own by default: test the connection to see it and trust it.",
  interval:
    "From 1 to 60 minutes. Every minute matches the XCP-ng Agent; read a large Xen Orchestra less often to go easier on it.",
};

// "Test connection" under the certificate, and "Trust this certificate" filling it in.
function getTestPanel(
  values: FormValues<XcpNgConnection>,
  footer: FieldFooterProps | undefined,
  saved:
    | { xcpNgConnectionId: ObjectID; connectionType: XcpNgConnectionType }
    | undefined,
): ReactElement {
  return (
    <XcpNgConnectionTestPanel
      input={getXcpNgConnectionTestInput(values, saved)}
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

function getProbeField(
  options: XcpNgConnectionFormOptions,
  stepId: string,
  withDefault: boolean,
): ModelField<XcpNgConnection> {
  return {
    field: {
      collectionProbe: true,
    },
    title: "Probe",
    stepId: stepId,
    fieldType: FormFieldSchemaType.Dropdown,
    required: true,
    placeholder: "Probe",
    description: WORDS.probe,
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
    ...(withDefault
      ? {
          defaultValue: getDefaultVMwareCollectionProbeId(
            options.probes,
            options.isBillingEnabled,
          ),
        }
      : {}),
  };
}

function getAddressField(
  type: XcpNgConnectionType,
  stepId: string,
  showIf?: ((values: FormValues<XcpNgConnection>) => boolean) | undefined,
): ModelField<XcpNgConnection> {
  const words: { title: string; placeholder: string; description: string } =
    type === XcpNgConnectionType.Xapi
      ? WORDS.xapiAddress
      : WORDS.xenOrchestraAddress;

  return {
    field: {
      address: true,
    },
    title: words.title,
    stepId: stepId,
    ...(showIf ? { showIf: showIf } : {}),
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: words.placeholder,
    description: words.description,
    customValidation: (values: FormValues<XcpNgConnection>): string | null => {
      return validateXcpNgAddress(
        (values as Record<string, unknown>)["address"],
        type,
      );
    },
  };
}

// The kind's own way in: a Xen Orchestra's secrets, or a pool's account.
function getSignInFields(data: {
  stepId: string;
  // Connect asks for every secret; an edit keeps the saved ones when left empty.
  isCreate: boolean;
  type?: XcpNgConnectionType | undefined;
}): Array<ModelField<XcpNgConnection>> {
  const showIfXenOrchestra: Partial<ModelField<XcpNgConnection>> = data.type
    ? {}
    : { showIf: isXenOrchestra };
  const showIfXapi: Partial<ModelField<XcpNgConnection>> = data.type
    ? {}
    : { showIf: isXapi };
  const fields: Array<ModelField<XcpNgConnection>> = [];

  if (!data.type || data.type === XcpNgConnectionType.XenOrchestra) {
    fields.push(
      {
        field: {
          openMetricsSecret: true,
        },
        title: "OpenMetrics Secret",
        stepId: data.stepId,
        ...showIfXenOrchestra,
        fieldType: FormFieldSchemaType.Password,
        required: data.isCreate,
        description: WORDS.openMetricsSecret,
        autoComplete: "new-password",
      },
      {
        field: {
          apiToken: true,
        },
        title: "API Token",
        stepId: data.stepId,
        ...showIfXenOrchestra,
        fieldType: FormFieldSchemaType.Password,
        required: false,
        description: WORDS.apiToken,
        autoComplete: "new-password",
      },
    );
  }

  if (!data.type || data.type === XcpNgConnectionType.Xapi) {
    fields.push(
      {
        field: {
          username: true,
        },
        title: "User Name",
        stepId: data.stepId,
        ...showIfXapi,
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: "root",
        description: WORDS.username,
        autoComplete: "off",
      },
      {
        field: {
          password: true,
        },
        title: "Password",
        stepId: data.stepId,
        ...showIfXapi,
        fieldType: FormFieldSchemaType.Password,
        required: data.isCreate,
        description: WORDS.password,
        autoComplete: "new-password",
      },
    );
  }

  return fields;
}

function getCertificateField(
  stepId: string,
  saved:
    | { xcpNgConnectionId: ObjectID; connectionType: XcpNgConnectionType }
    | undefined,
): ModelField<XcpNgConnection> {
  return {
    field: {
      trustedCertificateFingerprint: true,
    },
    title: "Trusted Certificate",
    stepId: stepId,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: "AB:CD:EF:...",
    description: WORDS.certificate,
    customValidation: (values: FormValues<XcpNgConnection>): string | null => {
      return validateXcpNgTrustedCertificate(
        (values as Record<string, unknown>)["trustedCertificateFingerprint"],
      );
    },
    getFooterElement: (
      values: FormValues<XcpNgConnection>,
      _error?: string,
      footer?: FieldFooterProps,
    ): ReactElement => {
      return getTestPanel(values, footer, saved);
    },
  };
}

function getIntervalField(
  stepId: string,
  collapsibleSection: FormFieldCollapsibleSection<XcpNgConnection>,
  withDefault: boolean,
): ModelField<XcpNgConnection> {
  return {
    field: {
      collectionIntervalInMinutes: true,
    },
    title: "Read Every (Minutes)",
    stepId: stepId,
    fieldType: FormFieldSchemaType.Number,
    required: false,
    ...(withDefault
      ? { defaultValue: DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES }
      : {}),
    // The bounds and default of XcpNgCollectionSettings.
    description: WORDS.interval,
    validation: {
      minValue: MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
      maxValue: MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
    },
    collapsibleSection: collapsibleSection,
  };
}

// Connect: a new connection, of either kind.
export function getXcpNgConnectFormFields(
  options: XcpNgConnectionFormOptions,
): Array<ModelField<XcpNgConnection>> {
  const advancedSection: FormFieldCollapsibleSection<XcpNgConnection> =
    getAdvancedFormSection<XcpNgConnection>();

  return [
    {
      field: {
        connectionType: true,
      },
      title: "What to Read",
      stepId: "source",
      fieldType: FormFieldSchemaType.CardSelect,
      cardSelectOptions: getXcpNgConnectionTypeOptions(),
      cardSelectMaxColumns: 2,
      defaultValue: XcpNgConnectionType.XenOrchestra,
      required: true,
      description:
        "Connect Xen Orchestra once for every pool it manages. A pool with no Xen Orchestra is read from its own master.",
    },
    getAddressField(XcpNgConnectionType.XenOrchestra, "source", isXenOrchestra),
    getAddressField(XcpNgConnectionType.Xapi, "source", isXapi),
    getProbeField(options, "source", true),
    ...getSignInFields({ stepId: "sign-in", isCreate: true }),
    getCertificateField("certificate-and-name", undefined),
    {
      field: {
        name: true,
      },
      title: "Name",
      stepId: "certificate-and-name",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "Defaults to the address's host name",
      description:
        "How this connection is named in OneUptime. A Xen Orchestra's name also shows on every pool it reads.",
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "certificate-and-name",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Xen Orchestra for the Paris datacenter",
      collapsibleSection: advancedSection,
    },
    getIntervalField("certificate-and-name", advancedSection, true),
  ];
}

// Edit Connection: how a saved connection is reached and signed in to.
export function getXcpNgConnectionEditFormFields(
  options: XcpNgConnectionEditOptions,
): Array<ModelField<XcpNgConnection>> {
  const advancedSection: FormFieldCollapsibleSection<XcpNgConnection> =
    getAdvancedFormSection<XcpNgConnection>();
  const saved: {
    xcpNgConnectionId: ObjectID;
    connectionType: XcpNgConnectionType;
  } = {
    xcpNgConnectionId: options.xcpNgConnectionId,
    connectionType: options.connectionType,
  };

  return [
    getAddressField(options.connectionType, "connection"),
    getProbeField(options, "connection", false),
    ...getSignInFields({
      stepId: "connection",
      isCreate: false,
      type: options.connectionType,
    }),
    getCertificateField("certificate", saved),
    getIntervalField("certificate", advancedSection, false),
  ];
}
