import DataMigrationBase from "./DataMigrationBase";
import WorkspaceUserAuthTokenService, {
  LinksNotMadeBySignInCleanupResult,
} from "Common/Server/Services/WorkspaceUserAuthTokenService";
import logger from "Common/Server/Utils/Logger";

/*
 * A Slack or Microsoft Teams account is connected to a OneUptime member only
 * by the member signing in to the chat as that account: the API no longer
 * writes the link (WorkspaceUserAuthToken). It used to let anybody signed in
 * write one, and a button pressed with that account then acted as the
 * member it named. This removes the links people wrote that way - the ones
 * that name a creator, which no sign-in does - with the Slack and Microsoft
 * Teams notification methods made from them
 * (WorkspaceUserAuthTokenService.removeLinksNotMadeBySignIn). Whoever really
 * holds such an account connects it again by signing in.
 *
 * Postgres-only. Idempotent, and safe to run twice at once: it only ever
 * removes links that name a creator, which nothing writes any more, and a
 * link a sign-in wrote is never touched. A link that fails is logged and the
 * rest go on; failing to read the links at all stops the chain, like any
 * other migration, and it runs again.
 */
export default class RemoveChatAccountLinksNotMadeBySignIn extends DataMigrationBase {
  public constructor() {
    super("RemoveChatAccountLinksNotMadeBySignIn");
  }

  public override async migrate(): Promise<void> {
    const result: LinksNotMadeBySignInCleanupResult =
      await WorkspaceUserAuthTokenService.removeLinksNotMadeBySignIn();

    logger.info(
      `RemoveChatAccountLinksNotMadeBySignIn: removed ${result.removedLinkCount} Slack or Microsoft Teams account link(s) no sign-in made, with ${result.removedSlackMethodCount} Slack and ${result.removedMicrosoftTeamsMethodCount} Microsoft Teams notification method(s) made from them; ${result.failedLinkCount} could not be removed (logged).`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the links proved nothing about who holds the account.
     * Whoever does connects it again by signing in to Slack or Microsoft
     * Teams.
     */
    return;
  }
}
