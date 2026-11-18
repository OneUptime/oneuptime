import ForbiddenException from "./ForbiddenException";
import ProductKey from "../Product/ProductKey";
import {
  ServerProductOffReason,
  getProductOffMessage,
} from "../Product/ServerProducts";

/*
 * A write refused because the product it belongs to is switched off on the
 * server (#6815, #7479): Admin Dashboard > Settings > Products, or
 * DISABLE_TELEMETRY_INGESTION for the telemetry products. Its words say what
 * happened and who can switch it on (getProductOffMessage), the same words
 * wherever it is refused: the API, a workflow's step, the Slack, Microsoft
 * Teams and Mattermost apps.
 *
 * A 403, as ForbiddenException: nothing is wrong with the caller's session,
 * and a 401 would sign the Dashboard out. The product it names lets a chat
 * or a run log tell it apart from other refusals, by its type.
 */
export default class ProductSwitchedOffException extends ForbiddenException {
  public readonly product: ProductKey;
  public readonly reason: ServerProductOffReason;

  public constructor(data: {
    product: ProductKey;
    reason: ServerProductOffReason;
  }) {
    super(getProductOffMessage(data));
    this.product = data.product;
    this.reason = data.reason;
  }

  // Whether an error is one, by its fields, so one from another realm is too.
  public static isException(
    error: unknown,
  ): error is ProductSwitchedOffException {
    if (error instanceof ProductSwitchedOffException) {
      return true;
    }

    return Boolean(
      error &&
        typeof error === "object" &&
        typeof (error as { product?: unknown }).product === "string" &&
        typeof (error as { reason?: unknown }).reason === "string" &&
        error instanceof ForbiddenException,
    );
  }
}
