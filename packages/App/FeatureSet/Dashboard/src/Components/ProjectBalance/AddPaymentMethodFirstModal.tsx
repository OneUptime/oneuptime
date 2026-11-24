import {
  ADD_PAYMENT_METHOD_TITLE,
  ADD_TO_BALANCE_TITLE,
  NO_PAYMENT_METHOD_DESCRIPTIONS,
} from "./ProjectBalanceCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Navigation from "Common/UI/Utils/Navigation";
import { ProjectBalanceType } from "Common/Utils/Project/ProjectBalance";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What Add to Balance opens on a project known to have no payment method,
 * which no cloud marketplace bills (isPaymentMethodNeededFirst, #11053), on
 * the SMS and call balance's card, on AI Credits and in the on-call guided
 * setup alike.
 *
 * It says a payment method is needed first, and where it is added, before
 * any amount is asked for: the amount used to come first, and the missing
 * card only once Add to Balance was pressed, in the server's refusal. Its
 * one action, Add Payment Method, opens Project Settings > Billing and
 * Invoices > Billing, where the button of that name adds one. Cancel leaves
 * the person where they were.
 */
export interface ComponentProps {
  balance: ProjectBalanceType;
  onClose: () => void;
}

export const getBillingPageRoute: () => Route = (): Route => {
  return RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS_BILLING]!);
};

const AddPaymentMethodFirstModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ConfirmModal
      // The words of the button that opened it (#7475).
      title={ADD_TO_BALANCE_TITLE}
      description={NO_PAYMENT_METHOD_DESCRIPTIONS[props.balance]}
      submitButtonText={ADD_PAYMENT_METHOD_TITLE}
      onSubmit={() => {
        props.onClose();
        Navigation.navigate(getBillingPageRoute());
      }}
      onClose={props.onClose}
    />
  );
};

export default AddPaymentMethodFirstModal;
