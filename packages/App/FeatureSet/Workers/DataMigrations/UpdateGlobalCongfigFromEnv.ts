import DataMigrationBase from "./DataMigrationBase";
import Hostname from "Common/Types/API/Hostname";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import { EmailServerType } from "Common/Models/DatabaseModels/GlobalConfig";
import HelpAndSupportSeeding from "Common/Server/Utils/HelpAndSupport/HelpAndSupportSeeding";

const WHOLE_NUMBER: RegExp = /^\d+$/;

/*
 * The SMTP port a new installation's settings start with: SMTP_PORT, when
 * it is a port a mail server can listen on (a whole number from 1 to
 * 65535), and none otherwise (#7458). This seeded 25 when SMTP_PORT was not
 * set, and a fresh server then showed "SMTP Port 25" on Settings > Emails,
 * opened Edit SMTP Config on 25 while its help said "usually 587", and read
 * as half set up: the port was the one thing filled in, so the Test email
 * card named the From Email as missing, as if the rest were done. With no
 * port, Edit SMTP Config starts on 587 (#6875).
 *
 * The migration runs once, when an installation is new: a server seeded
 * with 25 before keeps it, as one that chose 25 would.
 */
export const getSeededSmtpPort: (value: string | undefined) => Port | null = (
  value: string | undefined,
): Port | null => {
  const text: string = (value || "").trim();

  if (!WHOLE_NUMBER.test(text)) {
    return null;
  }

  const port: number = Number(text);

  if (port < 1 || port > 65535) {
    return null;
  }

  return new Port(port);
};

export default class UpdateGlobalConfigFromEnv extends DataMigrationBase {
  public constructor() {
    super("UpdateGlobalConfigFromEnv");
  }

  public override async migrate(): Promise<void> {
    let emailServerType: EmailServerType = EmailServerType.CustomSMTP;

    if (process.env["SENDGRID_API_KEY"]) {
      emailServerType = EmailServerType.Sendgrid;
    }

    const smtpHost: string = (process.env["SMTP_HOST"] || "").trim();
    const smtpPort: Port | null = getSeededSmtpPort(process.env["SMTP_PORT"]);

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: {
        // Update Twilio

        twilioAccountSID: process.env["TWILIO_ACCOUNT_SID"] || "",
        twilioAuthToken: process.env["TWILIO_AUTH_TOKEN"] || "",
        twilioPrimaryPhoneNumber: process.env["TWILIO_PHONE_NUMBER"] || "",

        // Update SMTP
        smtpUsername: process.env["SMTP_USERNAME"] || "",
        smtpPassword: process.env["SMTP_PASSWORD"] || "",
        /*
         * No host and no port are written unless they are given: an empty
         * host was written as a Hostname of nothing, and the port as 25
         * (getSeededSmtpPort).
         */
        ...(smtpHost ? { smtpHost: Hostname.fromString(smtpHost) } : {}),
        ...(smtpPort ? { smtpPort: smtpPort } : {}),
        isSMTPSecure: process.env["SMTP_IS_SECURE"] === "true",
        smtpFromEmail:
          process.env["SMTP_FROM_EMAIL"] || process.env["SMTP_EMAIL"] || "",
        smtpFromName: process.env["SMTP_FROM_NAME"] || "",

        emailServerType: emailServerType,

        // diable signup
        disableSignup: process.env["DISABLE_SIGNUP"] === "true",

        sendgridApiKey: process.env["SENDGRID_API_KEY"] || "",
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * Where a new server sends its people for help, from its configuration
     * (helpAndSupport in the Helm chart, HELP_AND_SUPPORT_* in config.env,
     * #10938), the moment its settings row is made: its first start may run
     * the startup migration that seeds it (SeedHelpAndSupportFromConfiguration)
     * before the row exists. Written only while nothing is saved, like that
     * one, so the two never undo each other.
     */
    await HelpAndSupportSeeding.seed();
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
