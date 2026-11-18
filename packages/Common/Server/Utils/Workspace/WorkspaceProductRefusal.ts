import ServerProducts from "../ServerProducts/ServerProducts";
import ProductSwitchedOffException from "../../../Types/Exception/ProductSwitchedOffException";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  ServerProductOffReason,
  getProductOffMessage,
} from "../../../Types/Product/ServerProducts";
import { WorkspaceCommandName } from "./WorkspaceCommands";

/*
 * A CHAT APP'S BUTTON OR COMMAND OF A PRODUCT THAT IS OFF (#7479).
 *
 * The Slack, Microsoft Teams and Mattermost apps act on incidents, alerts,
 * their episodes, on-call, monitors and maintenance events as the member
 * who pressed (WorkspaceActionAuthorization). While the server has
 * switched that product off (Admin Dashboard > Settings > Products), a
 * press of one of its buttons or a command of it is answered where it was
 * made - "Incidents is switched off on this server. A server admin can
 * switch it on in Admin Dashboard > Settings > Products. Nothing was
 * deleted." - and nothing is opened, read out or changed. Each app asks
 * here before it routes a press to the product's handler; the write
 * itself is refused too, should one get past (ProductWriteRefusal), and
 * each app tells that refusal in place (isRefusal).
 */
export default class WorkspaceProductRefusal {
  /*
   * What a command acts on: "incident" an incident, "page" and "oncall"
   * on-call, "maintenance" a maintenance event. Null for one of no product
   * (help, and a question for OneUptime AI, which Ask AI's own check
   * answers).
   */
  public static getProductOfCommand(
    command: WorkspaceCommandName | null | undefined,
  ): ProductKey | null {
    switch (command) {
      case WorkspaceCommandName.Incident:
        return ProductKey.Incidents;
      case WorkspaceCommandName.Maintenance:
        return ProductKey.ScheduledMaintenance;
      case WorkspaceCommandName.OnCall:
      case WorkspaceCommandName.Page:
        return ProductKey.OnCall;
      default:
        return null;
    }
  }

  /*
   * What a press of a product's button, or a command of it, is answered
   * with while the product is off: what happened and who can switch it on.
   * Null while it is on, and for no product.
   */
  public static async getRefusal(
    product: ProductKey | null | undefined,
  ): Promise<string | null> {
    if (!product) {
      return null;
    }

    const reason: ServerProductOffReason | null =
      await ServerProducts.getOffReason(product);

    return reason
      ? getProductOffMessage({ product: product, reason: reason })
      : null;
  }

  // A write refused because its product is off, to be told where it was made.
  public static isRefusal(
    error: unknown,
  ): error is ProductSwitchedOffException {
    return ProductSwitchedOffException.isException(error);
  }
}
