import DataMigrationBase from "./DataMigrationBase";
import { ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME } from "Common/Server/Utils/OnCall/OnCallAcknowledgeLink";
import logger from "Common/Server/Utils/Logger";

/*
 * Records when this server was upgraded to on-call links that carry the
 * page's own token (#10025): its row in the DataMigrations table, written
 * by the runner as it runs, says when. It changes no data.
 *
 * From this release a link acknowledges a page only with the page's token
 * (OnCallAcknowledgeLink), and every link OneUptime sends that leads to
 * Acknowledge carries it, an email's included. An email sent before the
 * upgrade, and an acknowledge page drawn before it, carry none: they go on
 * acknowledging a page sent before this moment, for a week after it was
 * sent. OnCallAcknowledgeLink reads the moment from here.
 *
 * Postgres only, and safe to run twice at once: two rows say the same, and
 * the first is read.
 */
export default class RequireTokenToAcknowledgeOnCallPages extends DataMigrationBase {
  public constructor() {
    super(ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME);
  }

  public override async migrate(): Promise<void> {
    logger.info(
      `${ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME}: on-call links acknowledge with the page's own token from now on. A link sent before now without one acknowledges its page for a week after the page was sent.`,
    );
  }

  public override async rollback(): Promise<void> {
    // Nothing was changed: the record of when it ran is the runner's.
    return;
  }
}
