import ServerEmailEnvironment, {
  ServerEmailEnvironmentReading,
  ServerEmailSettings,
} from "../../Types/Email/ServerEmailEnvironment";

/*
 * THE ONEUPTIME SERVER'S OWN EMAIL SETTINGS, AS THE SENDERS TAKE THEM.
 *
 * Admin Dashboard > Settings > Emails keeps them in GlobalConfig - unless
 * the GLOBAL_EMAIL_ environment variables set them (Types/Email/
 * ServerEmailEnvironment, #7738): once GLOBAL_EMAIL_SERVER_TYPE is set, the
 * settings are the ones they describe, whatever the row holds, and with
 * something wrong with them nothing is sent. The Notification service sends
 * with them (Notification/Config: getEmailServerType, getGlobalSMTPConfig,
 * getSendgridConfig, getGlobalEmailProviderServer), and the server's
 * sending status (ServerChannelSetup) and setup checklist
 * (getEmailSentThrough) read them - one reading for all of them, so the
 * variables reach every one.
 */

// Before what is wrong with the GLOBAL_EMAIL_ environment variables.
export const SERVER_EMAIL_ENVIRONMENT_PROBLEM: string =
  "The email settings set by environment variables cannot send:";

/*
 * The GLOBAL_EMAIL_ variables as this server was started with them, read
 * again on every call: a test, or a process that sets them, is read as it
 * is now.
 */
export const getServerEmailEnvironment: () => ServerEmailEnvironmentReading =
  (): ServerEmailEnvironmentReading => {
    return ServerEmailEnvironment.read(process.env);
  };

/*
 * What is wrong with the variables, by their names and never with a
 * password or a key - or null while they are not set, or nothing is.
 */
export const getServerEmailEnvironmentProblem: (
  reading?: ServerEmailEnvironmentReading,
) => string | null = (
  reading: ServerEmailEnvironmentReading = getServerEmailEnvironment(),
): string | null => {
  if (!reading.isSet) {
    return null;
  }

  if (ServerEmailEnvironment.isUsable(reading)) {
    return null;
  }

  return `${SERVER_EMAIL_ENVIRONMENT_PROBLEM} ${reading.problems.join(" ")}`;
};

/*
 * The server's email settings as the senders read them: the variables'
 * once GLOBAL_EMAIL_SERVER_TYPE is set - every column, a column the type
 * does not read empty, and none at all (null) while something is wrong
 * with them - or else the saved row's, as it is.
 */
export const toServerEmailSettings: (
  globalConfig: ServerEmailSettings | null | undefined,
  environment?: ServerEmailEnvironmentReading,
) => ServerEmailSettings | null = (
  globalConfig: ServerEmailSettings | null | undefined,
  environment: ServerEmailEnvironmentReading = getServerEmailEnvironment(),
): ServerEmailSettings | null => {
  if (environment.isSet) {
    return ServerEmailEnvironment.isUsable(environment)
      ? environment.settings
      : null;
  }

  return globalConfig || null;
};

export default toServerEmailSettings;
