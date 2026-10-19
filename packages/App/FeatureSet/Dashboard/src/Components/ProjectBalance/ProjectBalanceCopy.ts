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
      "It tries again within an hour. Check the payment method in Project Settings > Billing and Invoices > Billing, or recharge the balance now.",
    ),
    forEveryoneElse: translationKey(
      "It tries again within an hour. A project owner or someone with Manage Billing can recharge the balance.",
    ),
  },
  [ProjectBalanceType.AI]: {
    forPeopleWhoMayAdd: translationKey(
      "It tries again within an hour. Check the payment method in Project Settings > Billing and Invoices > Billing, or add AI credits now.",
    ),
    forEveryoneElse: translationKey(
      "It tries again within an hour. A project owner or someone with Manage Billing can add AI credits.",
    ),
  },
};

/*
 * For a project a cloud marketplace bills (Project.billingMarketplace),
 * which has no card: where its recharges are billed, after the Current
 * Balance card's description - and, when Auto Recharge's last charge was
 * refused, what to check: the project's subscription on the marketplace,
 * not a payment method. Who can do something about it is worded as for a
 * card.
 */
export const MARKETPLACE_RECHARGE_BILLED_TEMPLATE: string = translationKey(
  "Recharges and Auto Recharge are billed through {{marketplace}}, not a card.",
);

export const MARKETPLACE_AUTO_RECHARGE_FAILED_TITLE_TEMPLATE: string =
  translationKey("Auto Recharge could not bill {{marketplace}}.");

export const MARKETPLACE_AUTO_RECHARGE_FAILED_DESCRIPTIONS: Readonly<
  Record<ProjectBalanceType, ProjectBalanceCardDescriptions>
> = {
  [ProjectBalanceType.SmsOrCall]: {
    forPeopleWhoMayAdd: translationKey(
      "It tries again within an hour. Check that this project's subscription on {{marketplace}} is active, or recharge the balance now.",
    ),
    forEveryoneElse:
      AUTO_RECHARGE_FAILED_DESCRIPTIONS[ProjectBalanceType.SmsOrCall]
        .forEveryoneElse,
  },
  [ProjectBalanceType.AI]: {
    forPeopleWhoMayAdd: translationKey(
      "It tries again within an hour. Check that this project's subscription on {{marketplace}} is active, or add AI credits now.",
    ),
    forEveryoneElse:
      AUTO_RECHARGE_FAILED_DESCRIPTIONS[ProjectBalanceType.AI].forEveryoneElse,
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

/*
 * THE AUTO RECHARGE CARD, ONE FOR BOTH BALANCES (AutoRechargeCard).
 *
 * Each balance's page drew its own Auto Recharge card: a switch and two
 * amounts, all three always shown - "Auto Recharge by (in USD): 20 USD"
 * under a switch that was off - with the SMS balance's switch row titled
 * "Auto Recharge Balance by (in USD)", and 500 offered twice. The card now
 * says in one line what Auto Recharge does: "Off", or "Adds 20 USD
 * whenever the balance falls to 10 USD." Its Edit dialog asks for the
 * amounts only once Auto Recharge is on. The three columns of each balance
 * (PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS) and what they hold are unchanged.
 */
export const AUTO_RECHARGE_CARD_TITLE: string = translationKey("Auto Recharge");

export const AUTO_RECHARGE_CARD_DESCRIPTION: string = translationKey(
  "Adds to the balance automatically when it runs low.",
);

export const AUTO_RECHARGE_SWITCH_DESCRIPTION: string = translationKey(
  "Adds the amount you pick whenever the balance runs low.",
);

export const AUTO_RECHARGE_AMOUNT_TITLE: string =
  translationKey("Amount to add");

export const AUTO_RECHARGE_THRESHOLD_TITLE: string = translationKey(
  "When the balance falls to",
);

// What the card says while Auto Recharge is on, and while it is off.
export const AUTO_RECHARGE_ON_TEMPLATE: string = translationKey(
  "Adds {{amount}} USD whenever the balance falls to {{threshold}} USD.",
);

export const AUTO_RECHARGE_OFF: string = translationKey("Off");

// The amounts both dropdowns offer, in USD, each once.
export const AUTO_RECHARGE_AMOUNTS_IN_USD: ReadonlyArray<number> = [
  10, 20, 25, 50, 75, 100, 200, 500, 1000,
];

/*
 * The Recharge dialog's one field: how much, in USD, with the limits the
 * recharge routes hold it to (20 to 1,000) said where they apply.
 */
export const RECHARGE_AMOUNT_TITLE: string = translationKey("Amount (USD)");

export const RECHARGE_AMOUNT_DESCRIPTION: string = translationKey(
  "Between 20 and 1,000 USD, charged now.",
);

// The Current Balance card's one row.
export const CURRENT_BALANCE_ROW_TITLE: string = translationKey("Balance");
