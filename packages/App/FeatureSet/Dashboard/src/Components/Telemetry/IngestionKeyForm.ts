import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import IconProp from "Common/Types/Icon/IconProp";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { translateText, translationKey } from "Common/UI/Utils/TranslateTemplate";
import OriginAllowList from "Common/Utils/Telemetry/OriginAllowList";
import { getTelemetryPayAsYouGoFormFields } from "../Billing/PayAsYouGo";

/*
 * CREATE A TELEMETRY INGESTION KEY: ONE PREFILLED PAGE, FROM EVERY DOOR.
 *
 * A key is created from two places: Settings > Telemetry Ingestion Keys,
 * and the "Choose an ingestion key" step at the top of every setup guide
 * (IngestionKeySelector). Both build their form here, so they ask the same
 * questions, in the same words, with the same checks - a browser key's
 * origins are refused in the form, not by the server after the submit.
 *
 * What the form asks:
 *
 *   - Name, already filled in. A guide names the key after what it is for
 *     ("Kubernetes key", numbered when the project already has one); the
 *     Settings page after its type ("Server key", "Browser key"), and the
 *     name follows the type until someone types a name of their own.
 *   - Key Type, Server picked, as cards - only where the type is open.
 *     A guide knows which kind of key its snippet needs (an agent or a
 *     collector can only use a Server key; a page's snippet only a Browser
 *     key) and does not ask.
 *   - Advanced, folded: the description.
 *
 * So a Server key on a paid plan is one page and one click. What is left
 * walks steps only where it has to:
 *
 *   - Browser Settings, for a Browser key picked on the Settings page:
 *     Allowed Origins, which a Browser key cannot work without, and the
 *     Pinned Service Name under Advanced. A guide that pins a Browser key
 *     asks for the origins on its one page instead.
 *   - Billing, on the Free plan only: the pay-as-you-go notice
 *     (PayAsYouGo.tsx), a step the form cannot be finished without having
 *     shown (Forms/Utils/FinishFromAnyStep.ts) - the same gate on both
 *     doors, because a gate with a way around it is not a gate.
 *
 * There is no Summary step: the page is short enough to read before
 * pressing Create, and the key's own page - where its secret is - shows
 * everything once it exists.
 */

/*
 * The names a key from the Settings page starts with: what kind of key it
 * is, until its creator names it.
 */
export const SERVER_INGESTION_KEY_NAME: string = translationKey("Server key");
export const BROWSER_INGESTION_KEY_NAME: string = translationKey("Browser key");

export interface IngestionKeyFormOptions {
  /*
   * The kind of key this door makes. The form then does not ask: a guide
   * whose snippet runs in an agent or a collector makes Server keys, one
   * whose snippet is published in a page makes Browser keys. Left out, the
   * form asks, with Server picked (the Settings page).
   */
  keyType?: TelemetryIngestionKeyType | undefined;
  /*
   * The name the form starts with, in the reader's language and already
   * unique - a guide's "Kubernetes key" (getUniqueIngestionKeyName). Left
   * out, the name says the key's type and follows it.
   */
  keyName?: string | undefined;
}

type IsBrowserKeyFunction = (
  values: FormValues<TelemetryIngestionKey>,
) => boolean;

/*
 * The origin allowlist and the pinned service name mean something only on a
 * Browser key - the ingest guard ignores both on a Server key - so the form
 * asks for them only once Browser is picked. A field the server silently
 * ignores reads as protection that is not there.
 */
export const isBrowserIngestionKey: IsBrowserKeyFunction = (
  values: FormValues<TelemetryIngestionKey>,
): boolean => {
  return values.keyType === TelemetryIngestionKeyType.Browser;
};

/**
 * The name a key of this type starts with on the Settings page, in the
 * reader's language: "Server key" or "Browser key".
 */
export const getDefaultIngestionKeyName: (
  keyType: TelemetryIngestionKeyType | undefined,
) => string = (keyType: TelemetryIngestionKeyType | undefined): string => {
  const name: string =
    keyType === TelemetryIngestionKeyType.Browser
      ? BROWSER_INGESTION_KEY_NAME
      : SERVER_INGESTION_KEY_NAME;

  return translateText(name) || name;
};

type GetNameAfterTypeChangeFunction = (data: {
  // The name the form holds now.
  name: unknown;
  // The type picked before, and the one picked now.
  previousKeyType: unknown;
  keyType: unknown;
}) => string | null;

/**
 * The name once another key type is picked: the new type's name, while the
 * name is still the form's own - empty, or the name of the type picked
 * before. Null when it stays as it is: somebody typed a name of their own,
 * or the type did not change.
 */
export const getIngestionKeyNameAfterTypeChange: GetNameAfterTypeChangeFunction =
  (data: {
    name: unknown;
    previousKeyType: unknown;
    keyType: unknown;
  }): string | null => {
    if (data.keyType === data.previousKeyType) {
      return null;
    }

    const name: string = typeof data.name === "string" ? data.name : "";

    const isTheFormsOwn: boolean =
      name.trim().length === 0 ||
      name ===
        getDefaultIngestionKeyName(
          data.previousKeyType as TelemetryIngestionKeyType | undefined,
        );

    if (!isTheFormsOwn) {
      return null;
    }

    return getDefaultIngestionKeyName(
      data.keyType as TelemetryIngestionKeyType | undefined,
    );
  };

type GetUniqueNameFunction = (data: {
  // The name wanted: "Kubernetes key".
  name: string;
  // The names of the keys the project already has (that the door lists).
  existingNames: Iterable<string | null | undefined>;
}) => string;

/**
 * The name itself while no other key has it, else the first of "name 2",
 * "name 3", ... that none has - so a second key made from the same guide
 * can be told from the first in the key picker. Compared without case or
 * surrounding spaces, the way they read in a list.
 */
export const getUniqueIngestionKeyName: GetUniqueNameFunction = (data: {
  name: string;
  existingNames: Iterable<string | null | undefined>;
}): string => {
  const normalize: (name: string) => string = (name: string): string => {
    return name.trim().toLowerCase();
  };

  const taken: Set<string> = new Set<string>();

  for (const existing of data.existingNames) {
    if (typeof existing === "string" && existing.trim().length > 0) {
      taken.add(normalize(existing));
    }
  }

  if (!taken.has(normalize(data.name))) {
    return data.name;
  }

  // One more than there are names is always enough.
  for (let number: number = 2; number <= taken.size + 2; number++) {
    const candidate: string = `${data.name} ${number}`;

    if (!taken.has(normalize(candidate))) {
      return candidate;
    }
  }

  // Unreachable (see the loop bound); kept so the function always returns.
  return `${data.name} ${taken.size + 2}`;
};

/**
 * The steps the form walks. None at all for a guide that pins the type on
 * a paid plan: name and description, one page. Otherwise Key, then Browser
 * Settings for a Browser key picked here, then Billing on the Free plan.
 * BasicForm draws a form whose steps come down to one (a Server key on a
 * paid plan, on the Settings page) as that one page, without a step list.
 */
export const getIngestionKeyFormSteps: (
  options: IngestionKeyFormOptions,
) => Array<FormStep<TelemetryIngestionKey>> = (
  options: IngestionKeyFormOptions,
): Array<FormStep<TelemetryIngestionKey>> => {
  const hasBillingStep: boolean = getTelemetryPayAsYouGoFormFields().length > 0;

  if (options.keyType && !hasBillingStep) {
    return [];
  }

  return [
    { id: "key", title: "Key" },
    ...(options.keyType
      ? []
      : [
          {
            id: "browser-settings",
            title: "Browser Settings",
            showIf: isBrowserIngestionKey,
          },
        ]),
    ...(hasBillingStep ? [{ id: "billing", title: "Billing" }] : []),
  ];
};

type GetAllowedOriginsFieldFunction = (data: {
  stepId: string;
  showIf?: IsBrowserKeyFunction | undefined;
}) => ModelField<TelemetryIngestionKey>;

/*
 * Allowed Origins, required: a Browser key with no origins is refused on
 * every request from the moment it exists. Checked here with the rules the
 * key's own page and the ingest path use (OriginAllowList), so a bad origin
 * is named under the field, not refused by the server after the submit.
 */
const getAllowedOriginsField: GetAllowedOriginsFieldFunction = (data: {
  stepId: string;
  showIf?: IsBrowserKeyFunction | undefined;
}): ModelField<TelemetryIngestionKey> => {
  return {
    field: {
      allowedOrigins: true,
    },
    title: "Allowed Origins",
    stepId: data.stepId,
    showIf: data.showIf,
    fieldType: FormFieldSchemaType.JSON,
    required: true,
    customValidation: (
      values: FormValues<TelemetryIngestionKey>,
    ): string | null => {
      if (!values.allowedOrigins) {
        return null; // The required-field check says what is missing.
      }

      return OriginAllowList.validateAllowedOriginsFormValue({
        value: values.allowedOrigins,
        allowEmptyList: false,
      });
    },
    placeholder: '["https://app.example.com", "app://com.example.mobile"]',
    description:
      'List web origins and exact native app identities as a JSON array. Web origins include the scheme and any port; one leading host wildcard is supported. React Native session replay uses "app://" plus the Android package or iOS bundle id, and app entries cannot contain wildcards. An app identity is self-asserted by the client, not platform attestation.',
  };
};

type GetPinnedServiceNameFieldFunction = (data: {
  stepId: string;
  showIf?: IsBrowserKeyFunction | undefined;
  collapsibleSection: FormFieldCollapsibleSection<TelemetryIngestionKey>;
}) => ModelField<TelemetryIngestionKey>;

/*
 * Optional, so folded under Advanced - unpinned, every sender names its own
 * service, which is what most keys want. The key's page edits it too.
 */
const getPinnedServiceNameField: GetPinnedServiceNameFieldFunction = (data: {
  stepId: string;
  showIf?: IsBrowserKeyFunction | undefined;
  collapsibleSection: FormFieldCollapsibleSection<TelemetryIngestionKey>;
}): ModelField<TelemetryIngestionKey> => {
  return {
    field: {
      pinnedServiceName: true,
    },
    title: "Pinned Service Name",
    stepId: data.stepId,
    showIf: data.showIf,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: "storefront-web",
    description:
      "Set service.name on all telemetry sent with this key. This prevents someone who copies the public key from writing telemetry under a different service name.",
    collapsibleSection: data.collapsibleSection,
  };
};

/**
 * The form's fields, for the steps getIngestionKeyFormSteps gives with the
 * same options. Every door creating a key takes its fields from here:
 * IngestionKeyFormGuard fails a door that declares its own.
 */
export const getIngestionKeyFormFields: (
  options: IngestionKeyFormOptions,
) => Array<ModelField<TelemetryIngestionKey>> = (
  options: IngestionKeyFormOptions,
): Array<ModelField<TelemetryIngestionKey>> => {
  const advanced: FormFieldCollapsibleSection<TelemetryIngestionKey> =
    getAdvancedFormSection<TelemetryIngestionKey>();

  const isPinnedToBrowser: boolean =
    options.keyType === TelemetryIngestionKeyType.Browser;

  /*
   * A name of the door's own stays put; the Settings page's follows the
   * type picked (getIngestionKeyNameAfterTypeChange).
   */
  const nameFollowsKeyType: boolean = !options.keyName && !options.keyType;

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      stepId: "key",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Ingestion Key Name",
      defaultValue:
        options.keyName || getDefaultIngestionKeyName(options.keyType),
      validation: {
        minLength: 2,
      },
    },
    ...(options.keyType
      ? []
      : [
          {
            field: {
              keyType: true,
            },
            title: "Key Type",
            stepId: "key",
            fieldType: FormFieldSchemaType.CardSelect,
            cardSelectSingleColumn: true,
            cardSelectOptions: [
              {
                value: TelemetryIngestionKeyType.Server,
                title: "Server",
                icon: IconProp.Server,
                description:
                  "For servers, containers and OpenTelemetry collectors. Writes every kind of telemetry without origin restrictions. Keep it secret: never include it in browser JavaScript or a mobile app.",
              },
              {
                value: TelemetryIngestionKeyType.Browser,
                title: "Browser",
                icon: IconProp.Globe,
                description:
                  "For public web telemetry and React Native session replay. Web origins may send traces, logs, metrics and replays; exact app:// identities authorize mobile replay only. Requests are rate limited. Configure the identities in the next step.",
              },
            ],
            required: true,
            defaultValue: TelemetryIngestionKeyType.Server,
            onChange: (
              value: unknown,
              values: FormValues<TelemetryIngestionKey>,
              setValues: (values: FormValues<TelemetryIngestionKey>) => void,
            ): void => {
              const nextValues: FormValues<TelemetryIngestionKey> = {
                ...values,
              };

              if (value === TelemetryIngestionKeyType.Server) {
                /*
                 * Browser-only drafts must not reach the request after a
                 * Server key is picked.
                 */
                nextValues.allowedOrigins = undefined;
                nextValues.pinnedServiceName = undefined;
              }

              if (nameFollowsKeyType) {
                const name: string | null = getIngestionKeyNameAfterTypeChange(
                  {
                    name: values.name,
                    previousKeyType: values.keyType,
                    keyType: value,
                  },
                );

                if (name !== null) {
                  nextValues.name = name;
                }
              }

              setValues(nextValues);
            },
            description:
              "Choose where you will send telemetry from. The key type cannot be changed after creation.",
          } as ModelField<TelemetryIngestionKey>,
        ]),
    ...(isPinnedToBrowser ? [getAllowedOriginsField({ stepId: "key" })] : []),
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "key",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Ingestion Key Description",
      description: "Describe where this key will be used.",
      collapsibleSection: advanced,
    },
    ...(isPinnedToBrowser
      ? [
          getPinnedServiceNameField({
            stepId: "key",
            collapsibleSection: advanced,
          }),
        ]
      : []),
    ...(options.keyType
      ? []
      : [
          getAllowedOriginsField({
            stepId: "browser-settings",
            showIf: isBrowserIngestionKey,
          }),
          getPinnedServiceNameField({
            stepId: "browser-settings",
            showIf: isBrowserIngestionKey,
            collapsibleSection: advanced,
          }),
        ]),
    ...getTelemetryPayAsYouGoFormFields().map(
      (
        field: ModelField<TelemetryIngestionKey>,
      ): ModelField<TelemetryIngestionKey> => {
        return { ...field, stepId: "billing" };
      },
    ),
  ];
};

/**
 * The key as it is sent: of the door's type when the door pins one, and
 * with nothing of a Browser key's settings on a Server key - a draft typed
 * before switching to Server never reaches the API.
 */
export const prepareIngestionKeyForCreate: (
  item: TelemetryIngestionKey,
  options: IngestionKeyFormOptions,
) => TelemetryIngestionKey = (
  item: TelemetryIngestionKey,
  options: IngestionKeyFormOptions,
): TelemetryIngestionKey => {
  if (options.keyType) {
    item.keyType = options.keyType;
  }

  if (item.keyType !== TelemetryIngestionKeyType.Browser) {
    delete item.allowedOrigins;
    delete item.pinnedServiceName;
  }

  return item;
};
