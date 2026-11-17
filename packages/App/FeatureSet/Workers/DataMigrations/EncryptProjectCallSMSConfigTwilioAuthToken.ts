import DataMigrationBase from "./DataMigrationBase";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import {
  ColumnToEncrypt,
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

/*
 * The Twilio auth tokens that were stored before the column became a
 * secret.
 *
 * ProjectCallSMSConfig.twilioAuthToken is now encrypted at rest (the model's
 * `encrypted: true`), but a row written before that holds the token as
 * plaintext.
 *
 * THE UPGRADE CHANGES NO TOKEN (#9266). A server of a release before
 * 14.0.56, still running while an upgrade from it rolls out, reads the
 * column as it is stored: a project's SMS and calls would go out with a
 * ciphertext for a token, and fail. So this runs at the upgrade and changes
 * nothing, and when it ran starts the wait: a day later, once no server of
 * the release before can still be running, the
 * CredentialsAtRest:EncryptInPlace job encrypts each token still stored as
 * written, in place, in raw SQL, only while the row still holds the token
 * read (CredentialsAtRest, EncryptColumnInPlace). An install that ran this
 * when it still encrypted at once (14.0.56 to 15.0.0) has its tokens
 * encrypted already: the job encrypts what is left, and never a ciphertext
 * again.
 *
 * Every reader of this release reads the same token before and after:
 * DatabaseService.decrypt hands back a value that is not our ciphertext
 * untouched.
 */
export default class EncryptProjectCallSMSConfigTwilioAuthToken extends DataMigrationBase {
  public constructor() {
    super("EncryptProjectCallSMSConfigTwilioAuthToken");
  }

  // Leaves every token as written: see the top of this file.
  public override async migrate(): Promise<void> {
    return;
  }

  // The column whose tokens are encrypted in place a day after this ran.
  public static getTargets(): Array<ColumnToEncrypt> {
    return [
      {
        kind: "Twilio config",
        repository:
          ProjectCallSMSConfigService.getRepository() as unknown as ModelRepository,
        column: "twilioAuthToken",
      },
    ];
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
