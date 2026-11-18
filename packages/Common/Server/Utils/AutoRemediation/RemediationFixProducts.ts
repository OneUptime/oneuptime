import ServerProducts from "../ServerProducts/ServerProducts";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ProductKey from "../../../Types/Product/ProductKey";

/*
 * THE PRODUCTS A FIX OF ONEUPTIME AI ACTS ON, WHILE ONE IS SWITCHED OFF ON
 * THE SERVER (#9489).
 *
 * A fix is for an incident or an alert: approving it, dry-running it,
 * dismissing it or working it out again writes to that record - its feed,
 * its Remediation step - as the server, once the person was checked. A fix
 * that starts a runbook starts it in Runbooks, and a dry run of a cloud
 * change asks the account's Cloud AI agent. While the server has one of
 * those products switched off, the press is refused with what happened and
 * who can switch it on (ProductSwitchedOffException): the AI card's, and a
 * Slack or Microsoft Teams button's alike, since both come through
 * RemediationApproval. The fix stays as it is, and can be acted on once the
 * product is on again: switching a product on loses nothing.
 */

type FixFacts = Pick<
  AutoRemediationSuggestion,
  "incidentId" | "alertId" | "suggestionType"
>;

export default class RemediationFixProducts {
  // The product of the incident or the alert a fix is for.
  public static ofSubject(fix: FixFacts): Array<ProductKey> {
    const products: Array<ProductKey> = [];

    if (fix.incidentId) {
      products.push(ProductKey.Incidents);
    }

    if (fix.alertId) {
      products.push(ProductKey.Alerts);
    }

    return products;
  }

  /*
   * What approving a fix acts on: its record, and Runbooks for a fix that
   * starts a runbook - every fix that is neither an AI command plan nor a
   * fix through MCP servers, as approving reads it.
   */
  public static ofApproval(fix: FixFacts): Array<ProductKey> {
    const products: Array<ProductKey> = RemediationFixProducts.ofSubject(fix);

    if (RemediationFixProducts.startsRunbook(fix)) {
      products.push(ProductKey.Runbooks);
    }

    return products;
  }

  // What a dry run of a fix's cloud changes acts on: its record, and Cloud.
  public static ofDryRun(fix: FixFacts): Array<ProductKey> {
    return [...RemediationFixProducts.ofSubject(fix), ProductKey.Cloud];
  }

  public static startsRunbook(fix: FixFacts): boolean {
    return (
      fix.suggestionType !== AutoRemediationSuggestionType.CommandPlan &&
      fix.suggestionType !== AutoRemediationSuggestionType.McpToolCalls
    );
  }

  // Refused while any of the products is off, naming the first that is.
  public static async assertMayActOn(
    products: ReadonlyArray<ProductKey>,
  ): Promise<void> {
    for (const product of products) {
      await ServerProducts.assertProductIsOn(product);
    }
  }
}
