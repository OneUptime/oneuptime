import OpenStackCloudCheck from "Common/Models/DatabaseModels/OpenStackCloudCheck";
import Probe from "Common/Models/DatabaseModels/Probe";
import Route from "Common/Types/API/Route";
import {
  DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES,
  DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
  DEFAULT_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB,
  MAX_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
  MAX_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB,
  MIN_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
  OPENSTACK_API_CHECK_INTERVALS_IN_MINUTES,
  OpenStackLifecycleCheckOptions,
} from "Common/Types/OpenStack/OpenStackCheck";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import ModelField, {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { OpenStackNamesField } from "../OpenStackConnectionFields";
import {
  getDefaultOpenStackCollectionProbeId,
  getOpenStackCollectionProbeOptions,
  readOpenStackCredentialKind,
  validateOpenStackAuthUrl,
  validateOpenStackFingerprints,
} from "../OpenStackProbeCollectionView";

/*
 * The forms that turn a cloud's checks on and change them. Simple by default: what has to be
 * answered is on show, and what most people leave alone is folded under More fields.
 *
 * What the check connects with is the same for both: Keystone's address and a probe, which a cloud
 * a probe already collects has, and a credential of the check's own. The secret and the OSProfiler
 * key are write-only: leave them empty to keep what is saved.
 */

type CheckField = ModelField<OpenStackCloudCheck>;
type CheckValues = FormValues<OpenStackCloudCheck>;

export interface OpenStackCheckFormOptions {
  probes: Array<Probe>;
  isBillingEnabled: boolean;
  translator: Translator;
  // Keystone's address and a probe are not known yet, so they are not folded away.
  isConnectionNeeded: boolean;
  // Whether a credential of the check's own is already saved.
  isCredentialSaved: boolean;
}

function isPasswordKind(values: CheckValues): boolean {
  return (
    readOpenStackCredentialKind(values as Record<string, unknown>) ===
    "password"
  );
}

function isApplicationCredentialKind(values: CheckValues): boolean {
  return !isPasswordKind(values);
}

function isCredentialTyped(values: CheckValues): boolean {
  const record: Record<string, unknown> = values as Record<string, unknown>;

  return Boolean(
    record["credentialSecret"] ||
      record["applicationCredentialId"] ||
      record["keystoneUsername"],
  );
}

const NAMES_OF_A_PASSWORD: ReadonlyArray<string> = [
  "keystoneUsername",
  "userDomainName",
  "credentialProjectName",
  "credentialProjectDomainName",
];

// Only one kind of credential is ever saved, and a form sends every field it has.
export function keepOpenStackCheckCredentialKind(
  item: OpenStackCloudCheck,
): OpenStackCloudCheck {
  if (!item.credentialSecret) {
    // Nothing new was typed, so the saved credential stays as it is.
    delete item.credentialKind;
    delete item.applicationCredentialId;
    delete item.keystoneUsername;
    delete item.userDomainName;
    delete item.credentialProjectName;
    delete item.credentialProjectDomainName;
    return item;
  }

  if (item.credentialKind === "password") {
    delete item.applicationCredentialId;
    return item;
  }

  delete item.keystoneUsername;
  delete item.userDomainName;
  delete item.credentialProjectName;
  delete item.credentialProjectDomainName;

  return item;
}

function getConnectionFields(data: {
  options: OpenStackCheckFormOptions;
  section: FormFieldCollapsibleSection<OpenStackCloudCheck> | undefined;
}): Array<CheckField> {
  const { options } = data;
  const onlyProbeId: string = getDefaultOpenStackCollectionProbeId(
    options.probes,
    options.isBillingEnabled,
  );

  return [
    {
      field: { authUrl: true },
      title: "Keystone Address",
      fieldType: FormFieldSchemaType.Text,
      required: options.isConnectionNeeded,
      placeholder: "https://keystone.example.com:5000/v3",
      description: options.isConnectionNeeded
        ? "The auth_url from your clouds.yaml or openrc file. It has to be HTTPS."
        : "Leave empty to use the address this cloud is collected from.",
      dataTestId: "openstack-check-auth-url",
      customValidation: (values: CheckValues): string | null => {
        const address: unknown = (values as Record<string, unknown>)["authUrl"];

        return address ? validateOpenStackAuthUrl(address) : null;
      },
      collapsibleSection: data.section,
    },
    {
      field: { probe: true },
      title: "Probe",
      fieldType: FormFieldSchemaType.Dropdown,
      required: options.isConnectionNeeded,
      placeholder: "Probe",
      description:
        "The probe that runs these checks. Pick one outside the cloud: a check inside a failed cloud says nothing.",
      dataTestId: "openstack-check-probe",
      sideLink: {
        text: "Add a probe",
        url: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITORS_SETTINGS_PROBES] as Route,
        ),
        openLinkInNewTab: true,
      },
      dropdownOptions: getOpenStackCollectionProbeOptions(
        options.probes,
        options.isBillingEnabled,
        options.translator,
      ),
      ...(options.isConnectionNeeded && onlyProbeId
        ? { defaultValue: onlyProbeId }
        : {}),
      collapsibleSection: data.section,
    },
  ];
}

function getCredentialFields(data: {
  isSecretRequired: boolean;
  // The project this login is for, when the form does not already say so.
  section: FormFieldCollapsibleSection<OpenStackCloudCheck> | undefined;
  moreSection: FormFieldCollapsibleSection<OpenStackCloudCheck>;
}): Array<CheckField> {
  const isRequiredOfKind: (
    kindMatches: (values: CheckValues) => boolean,
  ) => (values: CheckValues) => boolean = (
    kindMatches: (values: CheckValues) => boolean,
  ): ((values: CheckValues) => boolean) => {
    return (values: CheckValues): boolean => {
      return (
        kindMatches(values) &&
        (data.isSecretRequired || isCredentialTyped(values))
      );
    };
  };

  return [
    {
      field: { credentialKind: true },
      title: "How the Probe Logs In",
      fieldType: FormFieldSchemaType.RadioButton,
      required: false,
      hideOptionalLabel: true,
      description: "A credential for these checks alone.",
      defaultValue: "applicationCredential",
      dataTestId: "openstack-check-credential-kind",
      radioButtonOptions: [
        {
          title: "Application credential",
          description:
            "The better of the two: it stays in one project, and it can expire.",
          value: "applicationCredential",
        },
        {
          title: "User name and password",
          description: "Works too, and can do whatever its account can.",
          value: "password",
        },
      ],
      onChange: (
        value: string,
        current: CheckValues,
        setNewFormValues: (values: CheckValues) => void,
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

        setNewFormValues(cleared as CheckValues);
      },
      collapsibleSection: data.section,
    },
    {
      field: { applicationCredentialId: true },
      title: "Application Credential ID",
      fieldType: FormFieldSchemaType.Text,
      required: isRequiredOfKind(isApplicationCredentialKind),
      showIf: isApplicationCredentialKind,
      description:
        "What openstack application credential create prints as its id.",
      dataTestId: "openstack-check-application-credential-id",
      autoComplete: "off",
      collapsibleSection: data.section,
    },
    {
      field: { keystoneUsername: true },
      title: "User Name",
      fieldType: FormFieldSchemaType.Text,
      required: isRequiredOfKind(isPasswordKind),
      showIf: isPasswordKind,
      placeholder: "oneuptime-check",
      dataTestId: "openstack-check-username",
      autoComplete: "off",
      collapsibleSection: data.section,
    },
    {
      field: { credentialProjectName: true },
      title: "Project It Logs In To",
      fieldType: FormFieldSchemaType.Text,
      required: isRequiredOfKind(isPasswordKind),
      showIf: isPasswordKind,
      placeholder: "oneuptime-checks",
      dataTestId: "openstack-check-credential-project",
      autoComplete: "off",
      collapsibleSection: data.section,
    },
    {
      field: { credentialSecret: true },
      title: "Secret or Password",
      fieldType: FormFieldSchemaType.Password,
      required: data.isSecretRequired,
      hasNothingStoredWhenEditing: data.isSecretRequired,
      description:
        "Encrypted, never shown again, and sent only to the probe you picked.",
      dataTestId: "openstack-check-credential-secret",
      autoComplete: "new-password",
      collapsibleSection: data.section,
    },
    /*
     * Both start as the domain called Default. Their placeholder is that domain's name in
     * Keystone, in every language (isPlaceholderIdentifier), as on Connect Cloud (#7663).
     */
    {
      field: { userDomainName: true },
      title: "User Domain",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      showIf: isPasswordKind,
      placeholder: "Default",
      isPlaceholderIdentifier: true,
      autoComplete: "off",
      collapsibleSection: data.moreSection,
    },
    {
      field: { credentialProjectDomainName: true },
      title: "Project Domain",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      showIf: isPasswordKind,
      placeholder: "Default",
      isPlaceholderIdentifier: true,
      autoComplete: "off",
      collapsibleSection: data.moreSection,
    },
  ];
}

function getTrustedCertificatesField(
  section: FormFieldCollapsibleSection<OpenStackCloudCheck>,
): CheckField {
  return {
    field: { trustedCertificateFingerprints: true },
    title: "Trusted Certificates",
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    description:
      "Leave empty if the probe trusts every API's certificate. For a cloud with its own certificate authority, give each certificate's SHA-256 fingerprint.",
    getCustomElement: (
      _values: CheckValues,
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
          dataTestId="openstack-check-trusted-certificates"
          {...(props.onBlur ? { onBlur: props.onBlur } : {})}
          onChange={(names: Array<string>) => {
            props.onChange?.(names);
          }}
        />
      );
    },
    customValidation: (values: CheckValues): string | null => {
      return validateOpenStackFingerprints(
        (values as Record<string, unknown>)["trustedCertificateFingerprints"],
      );
    },
    collapsibleSection: section,
  };
}

function getRegionsField(
  section: FormFieldCollapsibleSection<OpenStackCloudCheck>,
): CheckField {
  return {
    field: { regions: true },
    title: "Regions",
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    description:
      "Leave empty to check every region the catalog names. Separate names with commas.",
    getCustomElement: (
      _values: CheckValues,
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
          dataTestId="openstack-check-regions"
          {...(props.onBlur ? { onBlur: props.onBlur } : {})}
          onChange={(names: Array<string>) => {
            props.onChange?.(names);
          }}
        />
      );
    },
    collapsibleSection: section,
  };
}

// Turn On API Checks, for a cloud the check has to be told how to reach, and Edit API Checks.
export function getOpenStackApiCheckFormFields(
  options: OpenStackCheckFormOptions,
): Array<CheckField> {
  const more: FormFieldCollapsibleSection<OpenStackCloudCheck> =
    getAdvancedFormSection<OpenStackCloudCheck>();
  // A cloud a probe collects has a connection, so a check of its own is what the fold offers.
  const connectionSection:
    | FormFieldCollapsibleSection<OpenStackCloudCheck>
    | undefined = options.isConnectionNeeded ? undefined : more;

  return [
    ...getConnectionFields({ options: options, section: connectionSection }),
    ...getCredentialFields({
      isSecretRequired:
        options.isConnectionNeeded && !options.isCredentialSaved,
      section: connectionSection,
      moreSection: more,
    }),
    {
      field: { apiCheckIntervalInMinutes: true },
      title: "Check Every (Minutes)",
      fieldType: FormFieldSchemaType.Dropdown,
      required: false,
      defaultValue: DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES,
      dropdownOptions: OPENSTACK_API_CHECK_INTERVALS_IN_MINUTES.map(
        (minutes: number) => {
          return { label: String(minutes), value: minutes };
        },
      ),
      collapsibleSection: more,
    },
    getRegionsField(more),
    getTrustedCertificatesField(more),
  ];
}

export interface OpenStackLifecycleOptionsFieldProps {
  value: unknown;
  onChange: (options: OpenStackLifecycleCheckOptions) => void;
}

function readLifecycleOptions(value: unknown): OpenStackLifecycleCheckOptions {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as OpenStackLifecycleCheckOptions)
    : {};
}

/*
 * A text box with its label, for one thing the check would otherwise pick by itself. Its
 * placeholder is English, which Input looks up, once - or, said so, a sentence put in the
 * reader's words here already (#7682).
 */
const OptionInput: FunctionComponent<{
  label: string;
  placeholder: string;
  isPlaceholderTranslated?: boolean | undefined;
  value: string | undefined;
  dataTestId: string;
  type?: InputType | undefined;
  onChange: (value: string) => void;
}> = (props: {
  label: string;
  placeholder: string;
  isPlaceholderTranslated?: boolean | undefined;
  value: string | undefined;
  dataTestId: string;
  type?: InputType | undefined;
  onChange: (value: string) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = useId();

  return (
    <div>
      <div id={labelId} className="mb-1 text-xs font-medium text-gray-700">
        {translator.translateText(props.label)}
      </div>
      <Input
        value={props.value || ""}
        placeholder={props.placeholder}
        isPlaceholderTranslated={props.isPlaceholderTranslated}
        ariaLabelledby={labelId}
        dataTestId={props.dataTestId}
        {...(props.type ? { type: props.type } : {})}
        onChange={props.onChange}
      />
    </div>
  );
};

/*
 * What a run does beyond booting a server. The toggles say what each adds to what a run creates,
 * because that is the choice: a floating IP and a volume are things it makes in the project too.
 */
export const OpenStackLifecycleOptionsField: FunctionComponent<
  OpenStackLifecycleOptionsFieldProps
> = (props: OpenStackLifecycleOptionsFieldProps): ReactElement => {
  const translator: Translator = useTranslator();
  const options: OpenStackLifecycleCheckOptions = readLifecycleOptions(
    props.value,
  );

  const change: (changed: OpenStackLifecycleCheckOptions) => void = (
    changed: OpenStackLifecycleCheckOptions,
  ): void => {
    props.onChange({ ...options, ...changed });
  };

  return (
    <div className="space-y-4" data-testid="openstack-lifecycle-options-field">
      <Toggle
        title={translator.translateText("Ping it on a floating IP")}
        description={translator.translateText(
          "Also creates a floating IP and a security group that lets a ping in, and pings the server from the probe, which has to reach your floating IPs.",
        )}
        value={Boolean(options.isFloatingIpEnabled)}
        dataTestId="openstack-lifecycle-option-floating-ip"
        onChange={(value: boolean) => {
          change({ isFloatingIpEnabled: value });
        }}
      />
      {options.isFloatingIpEnabled ? (
        <OptionInput
          label="External network"
          placeholder="The only one there is"
          value={options.floatingIpNetwork}
          dataTestId="openstack-lifecycle-option-floating-ip-network"
          onChange={(value: string) => {
            change({ floatingIpNetwork: value || undefined });
          }}
        />
      ) : (
        <></>
      )}
      <Toggle
        title={translator.translateText("Attach a volume")}
        description={translator.translateText(
          "Also creates a volume, attaches it to the server, detaches it and deletes it. It counts against the project's volume quota while it lasts.",
        )}
        value={Boolean(options.isVolumeEnabled)}
        dataTestId="openstack-lifecycle-option-volume"
        onChange={(value: boolean) => {
          change({ isVolumeEnabled: value });
        }}
      />
      {options.isVolumeEnabled ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <OptionInput
            label="Volume size (GiB)"
            placeholder={translator.translateTemplate(
              "{{size}}, up to {{max}}",
              {
                size: translator.formatNumber(
                  DEFAULT_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB,
                ),
                max: translator.formatNumber(
                  MAX_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB,
                ),
              },
            )}
            isPlaceholderTranslated={true}
            value={
              options.volumeSizeInGiB !== undefined
                ? String(options.volumeSizeInGiB)
                : undefined
            }
            type={InputType.NUMBER}
            dataTestId="openstack-lifecycle-option-volume-size"
            onChange={(value: string) => {
              const size: number = Number.parseInt(value, 10);

              change({
                volumeSizeInGiB: Number.isNaN(size) ? undefined : size,
              });
            }}
          />
          <OptionInput
            label="Volume type"
            placeholder="The cloud's default"
            value={options.volumeType}
            dataTestId="openstack-lifecycle-option-volume-type"
            onChange={(value: string) => {
              change({ volumeType: value || undefined });
            }}
          />
        </div>
      ) : (
        <></>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <OptionInput
          label="Flavor"
          placeholder="The smallest that will do"
          value={options.flavor}
          dataTestId="openstack-lifecycle-option-flavor"
          onChange={(value: string) => {
            change({ flavor: value || undefined });
          }}
        />
        <OptionInput
          label="Image"
          placeholder="A small one it finds"
          value={options.image}
          dataTestId="openstack-lifecycle-option-image"
          onChange={(value: string) => {
            change({ image: value || undefined });
          }}
        />
        <OptionInput
          label="Network"
          placeholder="The project's only one"
          value={options.network}
          dataTestId="openstack-lifecycle-option-network"
          onChange={(value: string) => {
            change({ network: value || undefined });
          }}
        />
      </div>
    </div>
  );
};

// Turn On the Lifecycle Check, and Edit Lifecycle Check.
export function getOpenStackLifecycleCheckFormFields(
  options: OpenStackCheckFormOptions,
): Array<CheckField> {
  const more: FormFieldCollapsibleSection<OpenStackCloudCheck> =
    getAdvancedFormSection<OpenStackCloudCheck>();

  return [
    {
      field: { lifecycleProjectName: true },
      title: "Project It Has to Itself",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "oneuptime-checks",
      description:
        "Create a project for this, with a small quota and nothing else in it. A credential on any other project is refused before anything is written.",
      dataTestId: "openstack-lifecycle-project",
      autoComplete: "off",
    },
    ...getCredentialFields({
      isSecretRequired: !options.isCredentialSaved,
      section: undefined,
      moreSection: more,
    }),
    {
      field: { lifecycleCheckOptions: true },
      title: "What Each Run Does",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      hideOptionalLabel: true,
      description:
        "Booting a server, and what else you turn on here. Leave the flavor, image and network empty and each run picks them.",
      getCustomElement: (
        _values: CheckValues,
        props: CustomElementProps,
      ): ReactElement => {
        return (
          <OpenStackLifecycleOptionsField
            value={props.initialValue}
            onChange={(value: OpenStackLifecycleCheckOptions) => {
              props.onChange?.(value);
            }}
          />
        );
      },
    },
    ...getConnectionFields({
      options: options,
      section: options.isConnectionNeeded ? undefined : more,
    }),
    {
      field: { lifecycleCheckIntervalInMinutes: true },
      title: "Run Every (Minutes)",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      defaultValue: DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
      description: options.translator.translateTemplate(
        "From {{minutes}} minutes to {{hours}} hours. A run never starts while one is going.",
        {
          minutes: options.translator.formatNumber(
            MIN_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
          ),
          hours: options.translator.formatNumber(
            MAX_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES / 60,
          ),
        },
      ),
      validation: {
        minValue: MIN_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
        maxValue: MAX_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
      },
      collapsibleSection: more,
    },
    {
      field: { osProfilerKey: true },
      title: "OSProfiler Key",
      fieldType: FormFieldSchemaType.Password,
      required: false,
      hasNothingStoredWhenEditing: false,
      description:
        "One of the hmac_keys in your services' [profiler] config, which signs each step's writes, so a slow boot has a trace. Encrypted and never shown again.",
      dataTestId: "openstack-lifecycle-osprofiler-key",
      autoComplete: "new-password",
      collapsibleSection: more,
    },
    getRegionsField(more),
    getTrustedCertificatesField(more),
  ];
}
