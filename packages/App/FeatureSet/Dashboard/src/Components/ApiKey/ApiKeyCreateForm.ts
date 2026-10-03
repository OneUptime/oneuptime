import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import OneUptimeDate from "Common/Types/Date";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { API_KEY_ACCESS_FIELD_KEY, API_KEY_ACCESS_LATER } from "./ApiKeyAccess";

/*
 * CREATE API KEY: A NAME, WHAT THE KEY MAY DO, AND THE REST FOLDED AWAY.
 *
 * The form asked for a name, a description and an expiry date with nothing
 * filled in, and the key it made could do nothing. It now asks:
 *
 *   - Name.
 *   - Access: Project Admin, Project Member, Viewer or Choose permissions
 *     later (ApiKeyAccess.ts), with Choose permissions later picked. Not
 *     asked of someone who may not give a key permissions.
 *   - Advanced, folded: the description, and Expires - a year from today,
 *     already filled in. The key's page shows the date and edits it.
 *
 * Three rows, so no steps. React-free, so tests can read the fields without
 * rendering the page.
 */

/*
 * The day a new key expires on unless someone picks another: a year from
 * today, at the start of that day in the user's timezone - exactly what
 * picking that date in the date picker stores. Fixed for the whole day, so
 * the Advanced section can tell a date someone picked from the one the form
 * started with.
 */
export const getDefaultApiKeyExpiry: (now?: Date | undefined) => Date = (
  now?: Date | undefined,
): Date => {
  const aYearFromNow: Date = OneUptimeDate.addRemoveYears(
    now || OneUptimeDate.getCurrentDate(),
    1,
  );

  return OneUptimeDate.fromDateTimeLocalString(
    OneUptimeDate.asDateForDatabaseQuery(aYearFromNow),
  );
};

export interface ApiKeyCreateFormOptions {
  /*
   * The Access cards this user may pick from (getApiKeyAccessOptions). Empty
   * leaves the question out: the key starts with no access, as it always
   * did, and its page is where access is added.
   */
  accessOptions: Array<CardSelectOption>;
}

export const getApiKeyCreateFormFields: (
  options: ApiKeyCreateFormOptions,
) => Array<ModelField<ApiKey>> = (
  options: ApiKeyCreateFormOptions,
): Array<ModelField<ApiKey>> => {
  const advanced: FormFieldCollapsibleSection<ApiKey> =
    getAdvancedFormSection<ApiKey>();

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "API Key Name",
      validation: {
        minLength: 2,
      },
    },
    ...(options.accessOptions.length > 0
      ? [
          {
            /*
             * Not a column of the key: the page adds the role once the key
             * exists (ApiKeyAccess.giveApiKeyAccess), so nothing of it is
             * sent with the key.
             */
            overrideField: {
              [API_KEY_ACCESS_FIELD_KEY]: true,
            },
            overrideFieldKey: API_KEY_ACCESS_FIELD_KEY,
            formOnly: true,
            showEvenIfPermissionDoesNotExist: true,
            title: "Access",
            description:
              "What this key can do. You can change it on the key's page at any time.",
            fieldType: FormFieldSchemaType.CardSelect,
            cardSelectOptions: options.accessOptions,
            cardSelectSingleColumn: true,
            required: true,
            defaultValue: API_KEY_ACCESS_LATER,
            dataTestId: "api-key-access",
          } as ModelField<ApiKey>,
        ]
      : []),
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "API Key Description",
      collapsibleSection: advanced,
    },
    {
      field: {
        expiresAt: true,
      },
      title: "Expires",
      description:
        "The key stops working on this date. A year from today unless you pick another.",
      fieldType: FormFieldSchemaType.Date,
      required: true,
      placeholder: "Expires at",
      validation: {
        dateShouldBeInTheFuture: true,
      },
      getDefaultValue: (): Date => {
        return getDefaultApiKeyExpiry();
      },
      collapsibleSection: advanced,
    },
  ];
};
