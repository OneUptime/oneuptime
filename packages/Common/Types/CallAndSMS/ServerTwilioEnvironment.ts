import { JSONObject } from "../JSON";
import Phone from "../Phone";
import { refusedValue } from "../../Utils/RefusedValue";
import {
  DEFAULT_TWILIO_CONFIG_USE,
  TWILIO_CONFIG_USES,
  TwilioConfigUse,
} from "./TwilioConfigUse";
import TwilioPhoneNumbers from "./TwilioPhoneNumbers";

/*
 * THE SERVER'S OWN TWILIO ACCOUNT, SET BY ENVIRONMENT VARIABLES (#7515).
 *
 * Admin Dashboard > Settings > Call and SMS keeps the server's Twilio
 * account in GlobalConfig. An installation that keeps its configuration in
 * code - Helm values, Terraform's helm_release, a config.env kept in git -
 * sets it with these variables instead. Once GLOBAL_TWILIO_ACCOUNT_SID is
 * set, the server's account is the one the variables describe: the senders
 * read it (Server/Utils/ServerTwilioConfig), the Admin Dashboard shows it
 * without an Edit button, and the server refuses a write to the saved one
 * (GlobalConfigService). Unset, the saved account applies again, as it was.
 * Nothing is copied into the database, so the auth token stays where it was
 * given: a Kubernetes Secret, or config.env.
 *
 * All of the account comes from the variables, or none of it: a variable
 * left unset is empty, never the saved value, so the variables are the
 * whole account and a value nobody wrote down cannot change what is sent.
 *
 * What is wrong with them is said by the variable's name, and never with
 * the auth token: when the server starts, on the Admin Dashboard's Call and
 * SMS page, and in what the server's sending status says SMS and calls are
 * missing (ServerChannelSetup). An account with something wrong sends
 * nothing, as an account that is not set up, rather than send from a number
 * nobody meant or with a use nobody chose.
 *
 * The variables are new names. TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
 * TWILIO_PHONE_NUMBER were read once, into a new installation's database, by
 * the UpdateGlobalConfigFromEnv data migration, and an old config.env may
 * still hold them: reading them again would put a stale account over the one
 * an admin has saved since.
 */

export enum ServerTwilioEnvironmentVariable {
  AccountSid = "GLOBAL_TWILIO_ACCOUNT_SID",
  AuthToken = "GLOBAL_TWILIO_AUTH_TOKEN",
  UsedFor = "GLOBAL_TWILIO_USED_FOR",
  PrimaryPhoneNumber = "GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER",
  SecondaryPhoneNumbers = "GLOBAL_TWILIO_SECONDARY_PHONE_NUMBERS",
  SmsPhoneNumbers = "GLOBAL_TWILIO_SMS_PHONE_NUMBERS",
}

// Every variable, the one that turns them on first.
export const SERVER_TWILIO_ENVIRONMENT_VARIABLES: ReadonlyArray<ServerTwilioEnvironmentVariable> =
  [
    ServerTwilioEnvironmentVariable.AccountSid,
    ServerTwilioEnvironmentVariable.AuthToken,
    ServerTwilioEnvironmentVariable.UsedFor,
    ServerTwilioEnvironmentVariable.PrimaryPhoneNumber,
    ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers,
    ServerTwilioEnvironmentVariable.SmsPhoneNumbers,
  ];

/*
 * What GLOBAL_TWILIO_USED_FOR is written as for each use, in the docs, the
 * Helm chart and config.example.env. The Admin Dashboard's own words ("SMS
 * only") are taken too, in any case and with spaces, hyphens or underscores
 * (readUse): "Calls and SMS", "calls_and_sms" and "CallsAndSms" are one use.
 * Unset, it is calls and SMS, as every account was before the choice.
 */
export const SERVER_TWILIO_USED_FOR_VALUES: Readonly<
  Record<TwilioConfigUse, string>
> = {
  [TwilioConfigUse.CallsAndSms]: "calls-and-sms",
  [TwilioConfigUse.SmsOnly]: "sms-only",
  [TwilioConfigUse.CallsOnly]: "calls-only",
};

// Where the Admin Dashboard asks the server whether the variables set its account.
export const SERVER_TWILIO_ENVIRONMENT_ROUTE: string =
  "/global-config/twilio-environment";

/*
 * Said when someone tries to change an account the variables set: the
 * server refuses the write (GlobalConfigService), and the docs and the
 * Admin Dashboard say where the account is changed instead.
 */
export const SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE: string = `This server's Twilio account is set by environment variables (${ServerTwilioEnvironmentVariable.AccountSid} and the other GLOBAL_TWILIO_ variables), so it cannot be changed in the Admin Dashboard. Change those variables - twilio in the Helm chart's values, or config.env with Docker Compose - and restart OneUptime.`;

/*
 * The account as the variables give it, by the names of the GlobalConfig
 * columns it stands in for: what the senders read (ServerTwilioConfig).
 */
export interface ServerTwilioEnvironmentAccount {
  twilioAccountSID: string;
  // Empty when GLOBAL_TWILIO_AUTH_TOKEN is not set.
  twilioAuthToken: string;
  twilioUsedFor: TwilioConfigUse;
  // Left out when it is not set, or is not a phone number.
  twilioPrimaryPhoneNumber?: Phone | undefined;
  // The lists as they were written, separated by commas.
  twilioSecondaryPhoneNumbers: string;
  twilioSmsPhoneNumbers: string;
}

export interface ServerTwilioEnvironmentReading {
  // Whether GLOBAL_TWILIO_ACCOUNT_SID is set: the variables are then the account.
  isSet: boolean;
  // The account the variables give, when they are set.
  account: ServerTwilioEnvironmentAccount | null;
  /*
   * What is wrong, each naming its variable and never the auth token. While
   * the variables are set, an account with any problem sends nothing. While
   * they are not, the problem is the variables set without
   * GLOBAL_TWILIO_ACCOUNT_SID, which nothing reads.
   */
  problems: Array<string>;
}

/*
 * The variables as the Admin Dashboard is told them (GET
 * /global-config/twilio-environment): the account without its auth token -
 * only whether there is one - and what is wrong with them.
 */
export interface ServerTwilioEnvironmentAnswer {
  isSetByEnvironment: boolean;
  usedFor: TwilioConfigUse | null;
  accountSid: string | null;
  hasAuthToken: boolean;
  primaryPhoneNumber: string | null;
  secondaryPhoneNumbers: string | null;
  smsPhoneNumbers: string | null;
  problems: Array<string>;
}

export type ServerTwilioEnvironmentValues = Readonly<
  Record<string, string | undefined>
>;

// "callsandsms" for "Calls and SMS", "calls-and-sms" and "CALLS_AND_SMS".
const comparableUse: (value: string) => string = (value: string): string => {
  return value.toLowerCase().replace(/[^a-z]/g, "");
};

// "A", "A and B", "A, B and C".
const listed: (names: Array<string>) => string = (
  names: Array<string>,
): string => {
  if (names.length <= 1) {
    return names.join("");
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

const NO_ACCOUNT_ANSWER: ServerTwilioEnvironmentAnswer = {
  isSetByEnvironment: false,
  usedFor: null,
  accountSid: null,
  hasAuthToken: false,
  primaryPhoneNumber: null,
  secondaryPhoneNumbers: null,
  smsPhoneNumbers: null,
  problems: [],
};

export default class ServerTwilioEnvironment {
  /*
   * The use GLOBAL_TWILIO_USED_FOR names, calls and SMS when it is empty,
   * or null when it names none of the three.
   */
  public static readUse(value: string | undefined): TwilioConfigUse | null {
    const written: string = (value || "").trim();

    if (!written) {
      return DEFAULT_TWILIO_CONFIG_USE;
    }

    for (const use of TWILIO_CONFIG_USES) {
      if (comparableUse(use) === comparableUse(written)) {
        return use;
      }
    }

    return null;
  }

  /*
   * The server's Twilio account as the environment sets it - process.env on
   * the server, read again on every call, so nothing it held goes stale.
   * Each value is read without the whitespace around it: a token read from
   * a file keeps its final newline (helm --set-file, Terraform's file()).
   */
  public static read(
    environment: ServerTwilioEnvironmentValues,
  ): ServerTwilioEnvironmentReading {
    const value: (variable: ServerTwilioEnvironmentVariable) => string = (
      variable: ServerTwilioEnvironmentVariable,
    ): string => {
      const written: unknown = environment[variable];

      return typeof written === "string" ? written.trim() : "";
    };

    const accountSid: string = value(
      ServerTwilioEnvironmentVariable.AccountSid,
    );

    if (!accountSid) {
      const unused: Array<ServerTwilioEnvironmentVariable> =
        SERVER_TWILIO_ENVIRONMENT_VARIABLES.filter(
          (variable: ServerTwilioEnvironmentVariable): boolean => {
            return Boolean(value(variable));
          },
        );

      return {
        isSet: false,
        account: null,
        problems:
          unused.length > 0
            ? [
                `${listed(unused)} ${unused.length === 1 ? "is" : "are"} set, but ${ServerTwilioEnvironmentVariable.AccountSid} is not, so nothing reads ${unused.length === 1 ? "it" : "them"}: the Twilio account saved in the Admin Dashboard is used. Set ${ServerTwilioEnvironmentVariable.AccountSid} too, or remove ${unused.length === 1 ? "it" : "them"}.`,
              ]
            : [],
      };
    }

    const problems: Array<string> = [];
    const authToken: string = value(ServerTwilioEnvironmentVariable.AuthToken);

    if (!authToken) {
      problems.push(
        `${ServerTwilioEnvironmentVariable.AuthToken} is not set: Twilio refuses the account without its auth token.`,
      );
    }

    const usedForText: string = value(ServerTwilioEnvironmentVariable.UsedFor);
    const use: TwilioConfigUse | null =
      ServerTwilioEnvironment.readUse(usedForText);

    if (!use) {
      problems.push(
        `${ServerTwilioEnvironmentVariable.UsedFor} must be ${SERVER_TWILIO_USED_FOR_VALUES[TwilioConfigUse.CallsAndSms]}, ${SERVER_TWILIO_USED_FOR_VALUES[TwilioConfigUse.SmsOnly]} or ${SERVER_TWILIO_USED_FOR_VALUES[TwilioConfigUse.CallsOnly]}, not "${refusedValue(usedForText)}".`,
      );
    }

    const primaryText: string = value(
      ServerTwilioEnvironmentVariable.PrimaryPhoneNumber,
    );
    let primaryPhoneNumber: Phone | undefined = undefined;

    if (primaryText) {
      try {
        primaryPhoneNumber = new Phone(primaryText);
      } catch {
        problems.push(
          `${ServerTwilioEnvironmentVariable.PrimaryPhoneNumber}: "${refusedValue(primaryText)}" is not a phone number. Write it with its country code, like +14155550100.`,
        );
      }
    }

    const secondaryText: string = value(
      ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers,
    );
    const smsText: string = value(
      ServerTwilioEnvironmentVariable.SmsPhoneNumbers,
    );

    for (const [variable, text] of [
      [ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers, secondaryText],
      [ServerTwilioEnvironmentVariable.SmsPhoneNumbers, smsText],
    ] as Array<[ServerTwilioEnvironmentVariable, string]>) {
      const error: string | null = TwilioPhoneNumbers.getListError(text);

      if (error) {
        problems.push(`${variable}: ${error}`);
      }
    }

    /*
     * The numbers its use takes, as the Admin Dashboard's form asks for
     * them (TwilioConfigUses.getMissingNumberError): SMS numbers for an
     * account used for SMS only, a number to make calls from for the rest.
     */
    if (use === TwilioConfigUse.SmsOnly) {
      if (TwilioPhoneNumbers.getListEntries(smsText).length === 0) {
        problems.push(
          `${ServerTwilioEnvironmentVariable.SmsPhoneNumbers} is not set: an account used for SMS only sends every SMS from one of them.`,
        );
      }
    } else if (use && !primaryText) {
      problems.push(
        `${ServerTwilioEnvironmentVariable.PrimaryPhoneNumber} is not set: calls go out from it.`,
      );
    }

    const account: ServerTwilioEnvironmentAccount = {
      twilioAccountSID: accountSid,
      twilioAuthToken: authToken,
      twilioUsedFor: use || DEFAULT_TWILIO_CONFIG_USE,
      twilioSecondaryPhoneNumbers: secondaryText,
      twilioSmsPhoneNumbers: smsText,
    };

    if (primaryPhoneNumber) {
      account.twilioPrimaryPhoneNumber = primaryPhoneNumber;
    }

    return {
      isSet: true,
      account: account,
      problems: problems,
    };
  }

  // Whether the account the variables set can send: set, with nothing wrong.
  public static isUsable(reading: ServerTwilioEnvironmentReading): boolean {
    return (
      reading.isSet && reading.account !== null && reading.problems.length === 0
    );
  }

  // What the Admin Dashboard is told: never the auth token.
  public static toAnswer(
    reading: ServerTwilioEnvironmentReading,
  ): ServerTwilioEnvironmentAnswer {
    if (!reading.isSet || !reading.account) {
      return {
        ...NO_ACCOUNT_ANSWER,
        problems: [...reading.problems],
      };
    }

    const account: ServerTwilioEnvironmentAccount = reading.account;

    return {
      isSetByEnvironment: true,
      usedFor: account.twilioUsedFor,
      accountSid: account.twilioAccountSID,
      hasAuthToken: Boolean(account.twilioAuthToken),
      primaryPhoneNumber: account.twilioPrimaryPhoneNumber
        ? account.twilioPrimaryPhoneNumber.toString()
        : null,
      secondaryPhoneNumbers: account.twilioSecondaryPhoneNumbers || null,
      smsPhoneNumbers: account.twilioSmsPhoneNumbers || null,
      problems: [...reading.problems],
    };
  }

  /*
   * The answer as the Admin Dashboard reads it back. Anything that is not
   * the answer's shape reads as the variables not set, so the page shows
   * the saved account and its Edit button, and the server still refuses a
   * write it must not take.
   */
  public static answerFromJSON(json: unknown): ServerTwilioEnvironmentAnswer {
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { ...NO_ACCOUNT_ANSWER, problems: [] };
    }

    const data: JSONObject = json as JSONObject;

    const text: (key: string) => string | null = (
      key: string,
    ): string | null => {
      const read: unknown = data[key];

      return typeof read === "string" && read.trim() ? read : null;
    };

    const usedFor: unknown = data["usedFor"];

    return {
      isSetByEnvironment: data["isSetByEnvironment"] === true,
      usedFor: (TWILIO_CONFIG_USES as ReadonlyArray<unknown>).includes(usedFor)
        ? (usedFor as TwilioConfigUse)
        : null,
      accountSid: text("accountSid"),
      hasAuthToken: data["hasAuthToken"] === true,
      primaryPhoneNumber: text("primaryPhoneNumber"),
      secondaryPhoneNumbers: text("secondaryPhoneNumbers"),
      smsPhoneNumbers: text("smsPhoneNumbers"),
      problems: Array.isArray(data["problems"])
        ? (data["problems"] as Array<unknown>).filter(
            (problem: unknown): problem is string => {
              return typeof problem === "string" && problem.length > 0;
            },
          )
        : [],
    };
  }

  /*
   * What the server says once as it starts, so nobody looks for the
   * account in the Admin Dashboard: the variables set it, or are set and
   * unused. Null when no variable is set.
   */
  public static getStartupNotice(
    reading: ServerTwilioEnvironmentReading,
  ): string | null {
    if (!reading.isSet) {
      return null;
    }

    return `The server's Twilio account is set by environment variables (${ServerTwilioEnvironmentVariable.AccountSid} and the other GLOBAL_TWILIO_ variables): the account saved in the Admin Dashboard is not used.`;
  }

  // What is wrong with the variables, as the server says it when it starts.
  public static getStartupWarning(
    reading: ServerTwilioEnvironmentReading,
  ): string | null {
    if (reading.problems.length === 0) {
      return null;
    }

    if (!reading.isSet) {
      return reading.problems.join(" ");
    }

    return `The Twilio account set by environment variables sends no SMS and makes no calls until this is fixed: ${reading.problems.join(" ")}`;
  }
}
