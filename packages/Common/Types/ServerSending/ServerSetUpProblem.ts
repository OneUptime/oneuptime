import {
  fillTemplate,
  TemplateValues,
  translatableTerm,
  translationKey,
} from "../Translator";

/*
 * WHAT A CHANNEL'S SETTINGS ARE MISSING, IN WORDS EVERY LANGUAGE HAS (#9437).
 *
 * The server works out what the settings of its email, SMS, calls and push
 * are missing (Server/Utils/ServerSending/ServerChannelSetup), and Server
 * Setup (/admin/setup) and the test cards on Settings > Emails and Settings
 * > Call and SMS say it. It used to be sent as a finished English sentence,
 * drawn as it came, so a German or Persian reader read "Nothing is set up
 * under Settings > Emails yet." under a title and a status in their own
 * language.
 *
 * So the server sends it as words too: one of the sentences below - a
 * translation key in every language the Admin Dashboard speaks - and the
 * values that fill it: a provider's name, drawn as written (SendGrid is
 * SendGrid in every language), and the name of the setting that is left
 * blank, which is a key of its own, looked up as the settings form draws
 * it. The English sentence is still sent beside it (setUpProblem), so a
 * page of an older version, and `npm run doctor`, read what they always did.
 *
 * What is not OneUptime's own sentence - what is wrong with the GLOBAL_EMAIL_
 * or GLOBAL_TWILIO_ environment variables, named by the variables, and a
 * provider's own answer - is sent as written, with no words: it is drawn as
 * it came.
 *
 * Pure, with no Node or browser APIs.
 */

// The setting a push turned off is read from: said by a test push too.
export const SERVER_PUSH_TURNED_OFF_PROBLEM: string = translationKey(
  "Push notifications are turned off under Settings > Push Notifications.",
);

export const SERVER_SET_UP_PROBLEMS: {
  emailNotSetUp: string;
  emailSettingNotSet: string;
  smsNotSetUp: string;
  callNotSetUp: string;
  twilioUsedForSmsOnly: string;
  twilioUsedForCallsOnly: string;
  twilioHasNoSmsNumber: string;
  twilioHasNoCallNumber: string;
  pushTurnedOff: string;
} = {
  emailNotSetUp: translationKey(
    "Nothing is set up under Settings > Emails yet.",
  ),
  // A provider's name, and a setting of its form (SERVER_EMAIL_SETTING_NAMES).
  emailSettingNotSet: translationKey(
    "{{provider}}: the {{field}} is not set under Settings > Emails.",
  ),
  smsNotSetUp: translationKey(
    "No Twilio account or SMS gateway is set up under Settings > Call and SMS.",
  ),
  callNotSetUp: translationKey(
    "No Twilio account or call gateway is set up under Settings > Call and SMS.",
  ),
  // The server's Twilio account, used for one kind of message (TwilioPhoneNumbers.getCannotSendReason).
  twilioUsedForSmsOnly: translationKey(
    "This Twilio config is used for SMS only, so it makes no calls.",
  ),
  twilioUsedForCallsOnly: translationKey(
    "This Twilio config is used for calls only, so it sends no SMS.",
  ),
  twilioHasNoSmsNumber: translationKey(
    "This Twilio config has no number to send SMS from.",
  ),
  twilioHasNoCallNumber: translationKey(
    "This Twilio config has no number to make calls from.",
  ),
  pushTurnedOff: SERVER_PUSH_TURNED_OFF_PROBLEM,
};

/*
 * The settings of Settings > Emails a set-up problem can name, as the form
 * names them: looked up in the reader's language with the sentence.
 */
export const SERVER_EMAIL_SETTING_NAMES: {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  host: string;
  port: string;
  username: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthTokenUrl: string;
  oauthScope: string;
  accessKeyId: string;
  secretAccessKey: string;
  serverApiToken: string;
  awsRegion: string;
  mailgunDomain: string;
} = {
  apiKey: translationKey("API Key"),
  fromEmail: translationKey("From Email"),
  fromName: translationKey("From Name"),
  host: translationKey("Host"),
  port: translationKey("Port"),
  username: translationKey("Username"),
  oauthClientId: translationKey("OAuth Client ID"),
  oauthClientSecret: translationKey("OAuth Client Secret"),
  oauthTokenUrl: translationKey("OAuth Token URL"),
  oauthScope: translationKey("OAuth Scope"),
  accessKeyId: translationKey("Access Key ID"),
  secretAccessKey: translationKey("Secret Access Key"),
  serverApiToken: translationKey("Server API Token"),
  awsRegion: translationKey("Region (an AWS Region code, such as us-east-1)"),
  mailgunDomain: translationKey(
    "Domain (the sending domain, such as mg.example.com)",
  ),
};

/*
 * The providers a set-up problem can name, as the Email settings page names
 * them: product names, the same in every language.
 */
export const SERVER_EMAIL_PROVIDER_NAMES: ReadonlyArray<string> = [
  "SMTP",
  "Microsoft Graph",
  "SendGrid",
  "Amazon SES",
  "Mailgun",
  "Postmark",
  "Resend",
];

// A set-up problem in words: a sentence above, and what fills it.
export interface ServerSetUpProblemWords {
  template: string;
  values: {
    provider?: string | undefined;
    field?: string | undefined;
  };
}

const TEMPLATES: ReadonlyArray<string> = Object.values(SERVER_SET_UP_PROBLEMS);
const SETTING_NAMES: ReadonlyArray<string> = Object.values(
  SERVER_EMAIL_SETTING_NAMES,
);

export default class ServerSetUpProblem {
  // A sentence of OneUptime's own, with no values.
  public static of(template: string): ServerSetUpProblemWords {
    return { template: template, values: {} };
  }

  // "SendGrid: the API Key is not set under Settings > Emails.", in words.
  public static emailSettingNotSet(
    provider: string,
    field: string,
  ): ServerSetUpProblemWords {
    return {
      template: SERVER_SET_UP_PROBLEMS.emailSettingNotSet,
      values: { provider: provider, field: field },
    };
  }

  // The English sentence: what the server sends beside the words, and logs.
  public static toEnglish(words: ServerSetUpProblemWords): string {
    return fillTemplate(words.template, ServerSetUpProblem.toValues(words));
  }

  /*
   * What fills the sentence when a page draws it: the provider as written,
   * the setting looked up with the sentence, in the same language.
   */
  public static toValues(words: ServerSetUpProblemWords): TemplateValues {
    const values: TemplateValues = {};

    if (words.values.provider) {
      values["provider"] = words.values.provider;
    }

    if (words.values.field) {
      values["field"] = translatableTerm(words.values.field);
    }

    return values;
  }

  /*
   * Words read from an answer, or null when they are not ones this
   * version knows: a sentence of the list above, with the values it names
   * and nothing else - a provider of the list, a setting of the list. A
   * page then draws the English sentence sent beside them, as it came.
   */
  public static parse(value: unknown): ServerSetUpProblemWords | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const row: Record<string, unknown> = value as Record<string, unknown>;
    const template: unknown = row["template"];
    const values: unknown = row["values"];

    if (typeof template !== "string" || !TEMPLATES.includes(template)) {
      return null;
    }

    if (
      values !== undefined &&
      (!values || typeof values !== "object" || Array.isArray(values))
    ) {
      return null;
    }

    const given: Record<string, unknown> =
      (values as Record<string, unknown> | undefined) || {};
    const words: ServerSetUpProblemWords = { template: template, values: {} };

    for (const key of Object.keys(given)) {
      if (key !== "provider" && key !== "field") {
        return null;
      }
    }

    const placeholders: Array<string> = (
      template.match(/\{\{(\w+)\}\}/g) || []
    ).map((placeholder: string): string => {
      return placeholder.slice(2, -2);
    });

    if (placeholders.includes("provider")) {
      const provider: unknown = given["provider"];

      if (
        typeof provider !== "string" ||
        !SERVER_EMAIL_PROVIDER_NAMES.includes(provider)
      ) {
        return null;
      }

      words.values.provider = provider;
    }

    if (placeholders.includes("field")) {
      const field: unknown = given["field"];

      if (typeof field !== "string" || !SETTING_NAMES.includes(field)) {
        return null;
      }

      words.values.field = field;
    }

    return words;
  }

  // Whether a sentence is one of OneUptime's own set-up problems.
  public static isTemplate(template: string): boolean {
    return TEMPLATES.includes(template);
  }
}
