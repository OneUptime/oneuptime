import PermissionGate, {
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  PAYMENT_METHOD_ADD_PERMISSIONS,
  PAYMENT_METHOD_SET_DEFAULT_PERMISSIONS,
  PROJECT_INVOICE_PAY_PERMISSIONS,
} from "Common/Utils/Project/ProjectBilling";

/*
 * Whether the billing pages offer what charges the card or changes how it
 * is charged - adding a payment method, making one the default, paying an
 * invoice - by the lists the server asks for them (Common/Utils/Project
 * /ProjectBilling). Those stay with a project owner and Manage Billing: a
 * Billing Viewer, Member or Admin reads the pages and sees these buttons
 * locked, saying why and who may. Before the permission snapshot has landed
 * nobody is told anything and the server decides
 * (PermissionGate.checkPermissions).
 */

// The first sentence of each refusal, one translation key each.
export const BillingActionCopy: {
  readonly addPaymentMethodRefused: string;
  readonly setDefaultPaymentMethodRefused: string;
  readonly payInvoiceRefused: string;
} = {
  addPaymentMethodRefused: translationKey(
    "You do not have permission to add a payment method.",
  ),
  setDefaultPaymentMethodRefused: translationKey(
    "You do not have permission to change the default payment method.",
  ),
  payInvoiceRefused: translationKey(
    "You do not have permission to pay invoices.",
  ),
};

export type BillingActionGateFunction = (
  options?: PermissionGateOptions | undefined,
) => PermissionGateResult;

// Add Payment Method (the Payment Methods card's button).
export const getAddPaymentMethodGate: BillingActionGateFunction = (
  options?: PermissionGateOptions | undefined,
): PermissionGateResult => {
  return PermissionGate.checkPermissions(PAYMENT_METHOD_ADD_PERMISSIONS, {
    ...options,
    sentence: BillingActionCopy.addPaymentMethodRefused,
  });
};

// Set as Default and Re-sync Autopay (a payment method's row actions).
export const getSetDefaultPaymentMethodGate: BillingActionGateFunction = (
  options?: PermissionGateOptions | undefined,
): PermissionGateResult => {
  return PermissionGate.checkPermissions(
    PAYMENT_METHOD_SET_DEFAULT_PERMISSIONS,
    {
      ...options,
      sentence: BillingActionCopy.setDefaultPaymentMethodRefused,
    },
  );
};

// Pay Invoice (an open invoice's row action).
export const getPayInvoiceGate: BillingActionGateFunction = (
  options?: PermissionGateOptions | undefined,
): PermissionGateResult => {
  return PermissionGate.checkPermissions(PROJECT_INVOICE_PAY_PERMISSIONS, {
    ...options,
    sentence: BillingActionCopy.payInvoiceRefused,
  });
};

/*
 * The reason an action is locked, or undefined when it is not: refused with
 * something to say. A gate that refuses with nothing to say - the snapshot
 * has not landed - leaves the action working, and the server decides.
 */
export const getBillingActionLockedReason: (
  gate: PermissionGateResult,
) => string | undefined = (gate: PermissionGateResult): string | undefined => {
  if (gate.isAllowed) {
    return undefined;
  }

  return gate.disabledReason || undefined;
};
