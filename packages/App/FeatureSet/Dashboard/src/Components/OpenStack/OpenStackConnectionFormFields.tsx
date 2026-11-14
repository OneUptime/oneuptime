import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import Probe from "Common/Models/DatabaseModels/Probe";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  OPENSTACK_ENDPOINT_INTERFACES,
  OpenStackCollectionOptions,
  OpenStackEndpointInterface,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import ModelField, {
  CustomElementProps,
  FieldFooterProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
} from "Common/Utils/OpenStack/OpenStackCollectionSettings";
import React, { ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import OpenStackConnectionTestPanel from "./OpenStackConnectionTestPanel";
import {
  OpenStackCollectionOptionsField,
  OpenStackNamesField,
} from "./OpenStackConnectionFields";
import {
  getDefaultOpenStackCollectionProbeId,
  getOpenStackCollectionProbeOptions,
  getOpenStackConnectionTestInput,
  readOpenStackCredentialKind,
  readOpenStackNames,
  readOpenStackOptions,
  validateOpenStackAuthUrl,
  validateOpenStackFingerprints,
  validateOpenStackOptions,
  validateOpenStackRegions,
} from "./OpenStackProbeCollectionView";
import { joinList } from "Common/UI/Utils/ListSeparator";

/*
 * The fields of a cloud a probe collects: connecting a new one (Connect Cloud, on the clouds
 * list), and changing how one is connected (Edit Connection, on its Settings page).
 *
 * Both walk three steps: where Keystone is and which probe goes, how to log in, then its
 * certificates and regions, with "Test connection" between them, which shows a certificate an
 * API presents and trusts it in one click, and names the regions the catalog holds. Connect
 * asks for the cloud's name on that step too, and an edit leaves the name, description and
 * labels to the cloud's Details card, the one place they are edited.
 *
 * The secret is write-only: an edit leaves it empty to keep the saved one (ModelForm offers
 * such a field empty, and sends it only when typed). A saved secret only ever goes to the
 * address, through the probe, and to the certificates it was entered for: changing one of them
 * asks for it again, except trusting the certificate a test or a collection found.
 */

export const OPENSTACK_CONNECT_FORM_STEPS: Array<FormStep<OpenStackCloud>> = [
  { title: "Keystone", id: "connection" },
  { title: "Credential", id: "credential" },
  { title: "Certificates, Regions and Name", id: "regions-and-name" },
];

export const OPENSTACK_CONNECTION_EDIT_FORM_STEPS: Array<
  FormStep<OpenStackCloud>
> = [
  { title: "Keystone", id: "connection" },
  { title: "Credential", id: "credential" },
  { title: "Certificates and Regions", id: "regions-and-name" },
];

export interface OpenStackConnectionFormOptions {
  probes: Array<Probe>;
  isBillingEnabled: boolean;
  translator: Translator;
  // The cloud an edit changes: its saved secret is tested when none is typed.
  openStackCloudId?: ObjectID | undefined;
  // An agent's cloud has none saved, and so one going to a probe has to give it.
  isSecretRequired?: boolean | undefined;
  // "Use these regions", on the test under the certificates.
  onUseRegions?: ((regions: Array<string>) => void) | undefined;
}

type CloudField = ModelField<OpenStackCloud>;
type CloudValues = FormValues<OpenStackCloud>;

function isPasswordKind(values: CloudValues): boolean {
  return (
    readOpenStackCredentialKind(values as Record<string, unknown>) ===
    "password"
  );
}

function isApplicationCredentialKind(values: CloudValues): boolean {
  return !isPasswordKind(values);
}

function getProbesPageRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITORS_SETTINGS_PROBES] as Route,
  );
}

// The columns that name the kind of credential a person is moving away from.
const NAMES_OF_A_PASSWORD: ReadonlyArray<string> = [
  "keystoneUsername",
  "userDomainName",
  "projectName",
  "projectDomainName",
];

// Where Keystone is, which probe goes to it, and which kind of credential it logs in with.
function getKeystoneFields(data: {
  options: OpenStackConnectionFormOptions;
  startsOnOnlyProbe: boolean;
}): Array<CloudField> {
  const { options } = data;

  return [
    {
      field: {
        authUrl: true,
      },
      title: "Keystone Address",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "https://keystone.example.com:5000/v3",
      description:
        "The auth_url from your clouds.yaml or openrc file. It has to be HTTPS: if your APIs only speak plain HTTP, turn on TLS or use the OpenStack agent.",
      dataTestId: "openstack-auth-url",
      customValidation: (values: CloudValues): string | null => {
        return validateOpenStackAuthUrl(
          (values as Record<string, unknown>)["authUrl"],
        );
      },
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
        "The probe that collects this cloud. It has to reach Keystone and every service's API over HTTPS, so it is usually one you run in the cloud's network.",
      dataTestId: "openstack-collection-probe",
      sideLink: {
        text: "Add a probe",
        url: getProbesPageRoute(),
        openLinkInNewTab: true,
      },
      dropdownOptions: getOpenStackCollectionProbeOptions(
        options.probes,
        options.isBillingEnabled,
        options.translator,
      ),
      ...(data.startsOnOnlyProbe
        ? {
            defaultValue: getDefaultOpenStackCollectionProbeId(
              options.probes,
              options.isBillingEnabled,
            ),
          }
        : {}),
    },
    {
      field: {
        credentialKind: true,
      },
      title: "How the Probe Logs In",
      stepId: "connection",
      fieldType: FormFieldSchemaType.RadioButton,
      required: false,
      // One of the two is always picked, so there is nothing to leave out.
      hideOptionalLabel: true,
      defaultValue: "applicationCredential",
      dataTestId: "openstack-credential-kind",
      radioButtonOptions: [
        {
          title: "Application credential",
          description:
            "The better of the two: it can be limited to reading, and it can expire.",
          value: "applicationCredential",
        },
        {
          title: "User name and password",
          description: "Works too, and can do whatever its account can.",
          value: "password",
        },
      ],
      /*
       * Only one kind is ever saved. What was typed for the other would be sent with it, and
       * an application credential's ID wins over a user name.
       */
      onChange: (
        value: string,
        current: CloudValues,
        setNewFormValues: (values: CloudValues) => void,
      ): void => {
        const cleared: Record<string, unknown> = {
          ...(current as Record<string, unknown>),
        };

        if (value === "password") {
          cleared["applicationCredentialId"] = "";
        } else {
          for (const column of NAMES_OF_A_PASSWORD) {
            cleared[column] = "";
          }
        }

        setNewFormValues(cleared as CloudValues);
      },
    },
  ];
}

// What the credential is called and its secret, whichever kind the first step picked.
function getCredentialFields(data: {
  isSecretRequired: boolean;
}): Array<CloudField> {
  /*
   * Most clouds log in to the domain called Default, which is what these start as. Their
   * placeholder is that domain's name in Keystone, in every language (isPlaceholderIdentifier):
   * German read it "Normal" and Spanish "Predeterminado", domains no cloud has (#7663).
   */
  const domainsSection: FormFieldCollapsibleSection<OpenStackCloud> =
    getAdvancedFormSection<OpenStackCloud>();

  return [
    {
      field: {
        applicationCredentialId: true,
      },
      title: "Application Credential ID",
      stepId: "credential",
      fieldType: FormFieldSchemaType.Text,
      required: isApplicationCredentialKind,
      showIf: isApplicationCredentialKind,
      description:
        "What openstack application credential create prints as its id. The docs have the access rules that limit it to reading.",
      dataTestId: "openstack-application-credential-id",
      autoComplete: "off",
    },
    {
      field: {
        keystoneUsername: true,
      },
      title: "User Name",
      stepId: "credential",
      fieldType: FormFieldSchemaType.Text,
      required: isPasswordKind,
      showIf: isPasswordKind,
      placeholder: "oneuptime-reader",
      dataTestId: "openstack-keystone-username",
      autoComplete: "off",
    },
    {
      field: {
        projectName: true,
      },
      title: "Project",
      stepId: "credential",
      fieldType: FormFieldSchemaType.Text,
      required: isPasswordKind,
      showIf: isPasswordKind,
      placeholder: "monitoring",
      description: "The project that user logs in to.",
      dataTestId: "openstack-project-name",
      autoComplete: "off",
    },
    {
      field: {
        credentialSecret: true,
      },
      title: "Secret or Password",
      stepId: "credential",
      fieldType: FormFieldSchemaType.Password,
      required: data.isSecretRequired,
      // An edit leaves it empty to keep the saved one, and the form says so under it.
      hasNothingStoredWhenEditing: data.isSecretRequired,
      description:
        "Encrypted, never shown again, and sent only to the probe you picked.",
      dataTestId: "openstack-credential-secret",
      autoComplete: "new-password",
    },
    {
      field: {
        userDomainName: true,
      },
      title: "User Domain",
      stepId: "credential",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      showIf: isPasswordKind,
      placeholder: "Default",
      isPlaceholderIdentifier: true,
      autoComplete: "off",
      collapsibleSection: domainsSection,
    },
    {
      field: {
        projectDomainName: true,
      },
      title: "Project Domain",
      stepId: "credential",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      showIf: isPasswordKind,
      placeholder: "Default",
      isPlaceholderIdentifier: true,
      autoComplete: "off",
      collapsibleSection: domainsSection,
    },
  ];
}

// The certificates, with "Test connection" under them, and the regions it names.
function getCertificatesAndRegionsFields(
  options: OpenStackConnectionFormOptions,
): Array<CloudField> {
  return [
    {
      field: {
        trustedCertificateFingerprints: true,
      },
      title: "Trusted Certificates",
      stepId: "regions-and-name",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      description:
        "Leave empty if the probe trusts every API's certificate. For a cloud with its own authority, test the connection to see each certificate and trust it.",
      getCustomElement: (
        _values: CloudValues,
        props: CustomElementProps,
      ): ReactElement => {
        return (
          <OpenStackNamesField
            value={props.initialValue}
            isMultiLine={true}
            placeholder="AB:CD:EF:..."
            error={props.error}
            tabIndex={props.tabIndex}
            ariaLabelledby={props.ariaLabelledby}
            ariaDescribedby={props.ariaDescribedby}
            dataTestId="openstack-trusted-certificates"
            {...(props.onBlur ? { onBlur: props.onBlur } : {})}
            onChange={(names: Array<string>) => {
              props.onChange?.(names);
            }}
          />
        );
      },
      customValidation: (values: CloudValues): string | null => {
        return validateOpenStackFingerprints(
          (values as Record<string, unknown>)["trustedCertificateFingerprints"],
        );
      },
      getFooterElement: (
        values: CloudValues,
        _error?: string,
        footer?: FieldFooterProps,
      ): ReactElement => {
        return (
          <OpenStackConnectionTestPanel
            input={getOpenStackConnectionTestInput(
              values,
              options.openStackCloudId,
            )}
            onUseRegions={options.onUseRegions}
            onTrustCertificate={
              footer
                ? (fingerprint: string) => {
                    const trusted: Array<string> = readOpenStackNames(
                      (values as Record<string, unknown>)[
                        "trustedCertificateFingerprints"
                      ],
                    );

                    // One cloud can have a certificate per service: this adds to the rest.
                    footer.setValue(
                      trusted.includes(fingerprint)
                        ? trusted
                        : [...trusted, fingerprint],
                    );
                  }
                : undefined
            }
          />
        );
      },
    },
    {
      field: {
        collectionRegions: true,
      },
      title: "Regions",
      stepId: "regions-and-name",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: true,
      description:
        "The regions the probe reads, separated by commas. The connection test lists the ones the catalog names.",
      getCustomElement: (
        _values: CloudValues,
        props: CustomElementProps,
      ): ReactElement => {
        return (
          <OpenStackNamesField
            value={props.initialValue}
            placeholder="RegionOne"
            error={props.error}
            tabIndex={props.tabIndex}
            ariaLabelledby={props.ariaLabelledby}
            ariaDescribedby={props.ariaDescribedby}
            dataTestId="openstack-collection-regions"
            {...(props.onBlur ? { onBlur: props.onBlur } : {})}
            onChange={(names: Array<string>) => {
              props.onChange?.(names);
            }}
          />
        );
      },
      customValidation: (values: CloudValues): string | null => {
        return validateOpenStackRegions(
          (values as Record<string, unknown>)["collectionRegions"],
        );
      },
    },
  ];
}

// What most clouds leave as it is.
function getAdvancedFields(
  advancedSection: FormFieldCollapsibleSection<OpenStackCloud>,
  options: { startsOnDefaults: boolean; translator: Translator },
): Array<CloudField> {
  return [
    {
      field: {
        endpointInterface: true,
      },
      title: "Endpoint Interface",
      stepId: "regions-and-name",
      fieldType: FormFieldSchemaType.Dropdown,
      required: false,
      description:
        "The catalog address the probe uses for each service. Most probes sit where public answers. One in the control plane's own network may want internal.",
      dropdownOptions: OPENSTACK_ENDPOINT_INTERFACES.map(
        (value: OpenStackEndpointInterface) => {
          return { label: value, value: value };
        },
      ),
      ...(options.startsOnDefaults
        ? { defaultValue: DEFAULT_OPENSTACK_ENDPOINT_INTERFACE }
        : {}),
      collapsibleSection: advancedSection,
    },
    {
      field: {
        collectionIntervalInMinutes: true,
      },
      title: "Collect Every (Minutes)",
      stepId: "regions-and-name",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      ...(options.startsOnDefaults
        ? { defaultValue: DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES }
        : {}),
      // The bounds and default of OpenStackCollectionSettings.
      description:
        "From 1 to 60 minutes. Every 2 minutes matches the OpenStack agent. Collect a large cloud less often to go easier on it.",
      validation: {
        minValue: MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
        maxValue: MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
      },
      collapsibleSection: advancedSection,
    },
    {
      field: {
        collectionOptions: true,
      },
      title: "What It Reads Beyond the Defaults",
      stepId: "regions-and-name",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      getCustomElement: (
        _values: CloudValues,
        props: CustomElementProps,
      ): ReactElement => {
        return (
          <OpenStackCollectionOptionsField
            value={props.initialValue}
            onChange={(value: unknown) => {
              props.onChange?.(value);
            }}
          />
        );
      },
      customValidation: (values: CloudValues): string | null => {
        return validateOpenStackOptions(
          (values as Record<string, unknown>)["collectionOptions"],
        );
      },
      // What is on, on the fold's line: nothing in force is hidden by folding it.
      getFoldedValue: (values: CloudValues): string | null => {
        const read: OpenStackCollectionOptions = readOpenStackOptions(
          (values as Record<string, unknown>)["collectionOptions"],
        );
        const on: Array<string> = [
          ...(read.collectProjectLimits ? ["Project limits"] : []),
          ...(read.collectPorts ? ["Ports"] : []),
        ].map((title: string): string => {
          return (options.translator.translateText(title) as string) || title;
        });

        return on.length > 0 ? joinList(on) : null;
      },
      collapsibleSection: advancedSection,
    },
  ];
}

// Connect Cloud: a new cloud, collected by a probe.
export function getOpenStackConnectFormFields(
  options: OpenStackConnectionFormOptions,
): Array<CloudField> {
  const advancedSection: FormFieldCollapsibleSection<OpenStackCloud> =
    getAdvancedFormSection<OpenStackCloud>();

  return [
    ...getKeystoneFields({ options: options, startsOnOnlyProbe: true }),
    ...getCredentialFields({ isSecretRequired: true }),
    ...getCertificatesAndRegionsFields(options),
    {
      field: {
        name: true,
      },
      title: "Name",
      stepId: "regions-and-name",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "Defaults to Keystone's host name",
      description: "How this cloud is named everywhere in OneUptime.",
      dataTestId: "openstack-cloud-name",
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "regions-and-name",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Production OpenStack cloud running in EU West",
      collapsibleSection: advancedSection,
    },
    ...getAdvancedFields(advancedSection, {
      startsOnDefaults: true,
      translator: options.translator,
    }),
    getLabelsFormField<OpenStackCloud>({
      stepId: "regions-and-name",
      collapsibleSection: advancedSection,
    }),
  ];
}

// Edit Connection: how a saved cloud is reached and logged in to.
export function getOpenStackConnectionFormFields(
  options: OpenStackConnectionFormOptions,
): Array<CloudField> {
  const advancedSection: FormFieldCollapsibleSection<OpenStackCloud> =
    getAdvancedFormSection<OpenStackCloud>();

  return [
    ...getKeystoneFields({ options: options, startsOnOnlyProbe: false }),
    ...getCredentialFields({
      isSecretRequired: Boolean(options.isSecretRequired),
    }),
    ...getCertificatesAndRegionsFields(options),
    ...getAdvancedFields(advancedSection, {
      startsOnDefaults: false,
      translator: options.translator,
    }),
  ];
}
