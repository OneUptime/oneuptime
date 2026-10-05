import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import OneUptimeDate from "Common/Types/Date";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  getAdvancedFormSection,
  isFormFieldValueSet,
} from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  RoleAccessHolder,
  getRoleAccessFormField,
} from "../Permission/RoleAccess";

/*
 * CREATE API KEY: A NAME, WHAT THE KEY MAY DO, AND THE REST FOLDED AWAY.
 *
 * The form asked for a name, a description and an expiry date with nothing
 * filled in, and the key it made could do nothing. It now asks:
 *
 *   - Name.
 *   - Access: Project Admin, Project Member, Viewer or Choose permissions
 *     later (Permission/RoleAccess.ts, the same question Create Team asks),
 *     with Choose permissions later picked. Not asked of someone who may not
 *     give a key permissions.
 *   - Advanced, folded: the description, and Expires - a year from today,
 *     already filled in. Folded, the section says so ("The key expires a
 *     year from today."): a key that stops working is a default nobody
 *     should find out about a year later. The key's page shows the date and
 *     edits it.
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

/*
 * Expires on a new key, held the way the date picker holds a picked date -
 * its ISO string - so picking the same day again does not read as a change.
 */
export const getDefaultApiKeyExpiryValue: () => string = (): string => {
  return OneUptimeDate.toString(getDefaultApiKeyExpiry());
};

/*
 * Under the folded Advanced header while Expires is the date the form
 * started with. Once another date is picked it is not shown, and the header
 * says "Configured" as for any other setting.
 */
export const API_KEY_DEFAULT_EXPIRY_SUMMARY: string = translationKey(
  "The key expires a year from today.",
);

/*
 * Expires' value and default, as the folded section reads them - with the
 * rule that decides "Configured" (isFormFieldValueSet), so the line and the
 * badge never disagree about whether another date was picked.
 */
const EXPIRES_VALUE: Field<ApiKey> = {
  field: {
    expiresAt: true,
  },
  fieldType: FormFieldSchemaType.Date,
  getDefaultValue: getDefaultApiKeyExpiryValue,
};

/*
 * What the folded Advanced section says: when the key expires, while that
 * is still a year from today; nothing once another date is picked. The
 * description is the user's own words, not a setting, so it changes nothing.
 */
export const getApiKeyAdvancedSummary: (
  values: FormValues<ApiKey>,
) => Array<string> | undefined = (
  values: FormValues<ApiKey>,
): Array<string> | undefined => {
  return isFormFieldValueSet(EXPIRES_VALUE, values)
    ? undefined
    : [API_KEY_DEFAULT_EXPIRY_SUMMARY];
};

export interface ApiKeyCreateFormOptions {
  /*
   * The Access cards this user may pick from (getRoleAccessOptions). Empty
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
    getAdvancedFormSection<ApiKey>({
      getSummary: getApiKeyAdvancedSummary,
    });

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
    /*
     * Not a column of the key: the page adds the role once the key exists
     * (RoleAccess.giveRoleAccess), so nothing of it is sent with the key.
     */
    ...(options.accessOptions.length > 0
      ? [
          getRoleAccessFormField<ApiKey>({
            holder: RoleAccessHolder.ApiKey,
            accessOptions: options.accessOptions,
          }),
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
      getDefaultValue: getDefaultApiKeyExpiryValue,
      collapsibleSection: advanced,
    },
  ];
};
