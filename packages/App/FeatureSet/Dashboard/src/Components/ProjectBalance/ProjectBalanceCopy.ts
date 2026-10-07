import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ProjectBalanceType } from "Common/Utils/Project/ProjectBalance";

/*
 * What the dashboard says about a project's two prepaid balances - the one
 * that pays for SMS, calls, WhatsApp and Telegram, and the AI credits - in
 * its own translated copy.
 *
 * Only a project owner, or someone with Manage Billing, may add to either
 * (Common/Utils/Project/ProjectBalance, which also words what the server
 * says). So the page that holds a balance tells those people to recharge it,
 * and offers the Recharge button; everyone else is told who can, and the
 * button stays locked, saying why. A step that needs AI credits links to
 * AI Credits only for the people who may add them, and names who can to
 * everyone else - never "ask an admin", who could not.
 *
 * Kept free of React, so App/Tests can read these exact strings. Every
 * string is a whole sentence, wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

export interface ProjectBalanceCardDescriptions {
  // For someone who may recharge the balance: the card asks them to.
  forPeopleWhoMayAdd: string;
  /*
   * For everyone else, and while that is not known yet: who can, instead
   * of asking the reader to.
   */
  forEveryoneElse: string;
}

// The Current Balance card's description on the page that holds a balance.
export const PROJECT_BALANCE_CARD_DESCRIPTIONS: Readonly<
  Record<ProjectBalanceType, ProjectBalanceCardDescriptions>
> = {
  [ProjectBalanceType.SmsOrCall]: {
    forPeopleWhoMayAdd: translationKey(
      "SMS, calls, WhatsApp and Telegram messages are paid from this balance, in USD. Recharge it, or turn on Auto Recharge so it never runs out.",
    ),
    forEveryoneElse: translationKey(
      "SMS, calls, WhatsApp and Telegram messages are paid from this balance, in USD. A project owner or someone with Manage Billing can recharge it, or turn on Auto Recharge so it never runs out.",
    ),
  },
  [ProjectBalanceType.AI]: {
    forPeopleWhoMayAdd: translationKey(
      "AI features are paid from this balance, in USD. Recharge it, or turn on Auto Recharge so it never runs out.",
    ),
    forEveryoneElse: translationKey(
      "AI features are paid from this balance, in USD. A project owner or someone with Manage Billing can recharge it, or turn on Auto Recharge so it never runs out.",
    ),
  },
};

/*
 * At the top of the page that holds a balance while Auto Recharge's last
 * automatic charge has failed (AutoRechargeState.Failed): what happened -
 * it tries the card again within the hour, or as soon as someone recharges
 * by hand or saves Auto Recharge - and then what to do, for someone who may
 * add balance, or who can, for everyone else (the words of the Current
 * Balance card). It used to be known only to the owners, by email.
 */
export const AUTO_RECHARGE_FAILED_TITLE: string = translationKey(
  "Auto Recharge could not charge the card.",
);

export const AUTO_RECHARGE_FAILED_DESCRIPTIONS: Readonly<
  Record<ProjectBalanceType, ProjectBalanceCardDescriptions>
> = {
  [ProjectBalanceType.SmsOrCall]: {
    forPeopleWhoMayAdd: translationKey(
      "It tries again within an hour. Check the payment method in Project Settings > Billing, or recharge the balance now.",
    ),
    forEveryoneElse: translationKey(
      "It tries again within an hour. A project owner or someone with Manage Billing can recharge the balance.",
    ),
  },
  [ProjectBalanceType.AI]: {
    forPeopleWhoMayAdd: translationKey(
      "It tries again within an hour. Check the payment method in Project Settings > Billing, or add AI credits now.",
    ),
    forEveryoneElse: translationKey(
      "It tries again within an hour. A project owner or someone with Manage Billing can add AI credits.",
    ),
  },
};

/*
 * The locked Recharge Balance button's tooltip: the permissions a recharge
 * needs, by their titles.
 */
export const RECHARGE_BALANCE_LOCKED_TEMPLATE: string = translationKey(
  "Adding balance needs one of these permissions: {{permissions}}.",
);

/*
 * A step that needs AI credits (an AI agent page's "Needs attention", the
 * AI Investigation card), for someone who may not add them.
 */
export const WHO_CAN_ADD_AI_CREDITS: string = translationKey(
  "A project owner or someone with Manage Billing can add AI credits.",
);

/*
 * The AI agent pages' step for a project out of AI credits. Adding credits
 * is the way out whatever Auto Recharge is doing: the step only shows when
 * Auto Recharge cannot refill them - it is off, or its last charge failed
 * (the gap's description says which).
 */
export const ADD_AI_CREDITS_STEP: string = translationKey(
  "Add AI credits to this project.",
);
