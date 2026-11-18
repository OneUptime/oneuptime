import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import type { ServerProductsClass } from "./ServerProducts";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { getProductsOfRecordTable } from "../../../Types/Product/ProductRecordTables";

/*
 * NO WRITE OF A PRODUCT THAT IS OFF GOES THROUGH (#7479).
 *
 * Every create, change and delete a caller makes - a person in the
 * Dashboard, an API key, a step of a workflow (WorkflowPrincipal), a member
 * pressing a button in Slack, Microsoft Teams or Mattermost, Ask AI, an MCP
 * client - reaches the database through DatabaseService or
 * AnalyticsDatabaseService with the caller's props, and asks here first,
 * beside the refusal of a read-only credential. A record of a product that
 * is switched off on the server (ProductRecordTables: the product's main
 * record and every record that hangs off it) is refused before any hook
 * runs, with what happened and who can switch it on
 * (ProductSwitchedOffException). So a custom route, a chat's button or a
 * workflow's step cannot write what the CRUD API refuses.
 *
 * Root props are let through: they are the server's own work - a monitor's
 * check, a published status page's subscriber, telemetry arriving, a hook
 * that records something on the caller's behalf - and "what already runs
 * keeps running" is the promise of switching a product off. A master admin
 * is refused like anybody: they switch the product on first.
 *
 * What the server would start anew on a product that is off is refused
 * where it starts instead (#9489), since it writes as root: OneUptime AI's
 * runs - an investigation, a chat, a code fix, a plan - and the claim of
 * one (AIRunService, InvestigationQueue), its postmortem drafts, insights
 * and pull request reviews, auto-remediation and the fixes it proposes
 * (AutoRemediationRuleEngineService, RemediationFixProducts), and a runbook
 * started from inside OneUptime while Runbooks is off (RunbookStarter).
 *
 * A table of no product is answered without reading anything. Without a
 * database to read the products from (a unit test of a service) nothing is
 * refused: no write could reach one either.
 *
 * ServerProducts is required rather than imported: it reads GlobalConfig
 * through GlobalConfigService, a DatabaseService, and DatabaseService asks
 * here.
 */
export default class ProductWriteRefusal {
  public static async refuseWhileProductIsOff(data: {
    tableName: string | null | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot) {
      return;
    }

    if (getProductsOfRecordTable(data.tableName).length === 0) {
      return;
    }

    if (!PostgresAppInstance.isConnected()) {
      return;
    }

    const serverProducts: ServerProductsClass =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("./ServerProducts").default;

    await serverProducts.assertRecordTableIsOn(data.tableName);
  }
}
