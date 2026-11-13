import { NotificationMethodChoice } from "../OnCallRulesTable";
import {
  PagingLadderStep,
  PagingMethodColumn,
  getChannelForPagingMethodColumn,
  getPagingLadderMethodKey,
  getPagingMethodColumnForChannel,
} from "Common/Types/NotificationRule/PagingLadder";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";

/*
 * THE METHODS A LADDER CAN NAME (#6820), one shape for both places the
 * ladder is drawn:
 *
 *   - your own page reads your methods (NotificationMethodUtil.getLabel's
 *     "SMS: +15550100", split into its channel and its identifier);
 *   - an admin's view of a member is handed the member's methods masked by
 *     On-Call Readiness ("SMS: +1 ••• ••• 4821"), and never reads the rows
 *     (OnCallRulesTable says why).
 *
 * React-free, so tests read it.
 */

export interface PagingMethodChoice {
  methodColumn: PagingMethodColumn;
  methodId: string;
  channel: OnCallPageChannel;
  /*
   * The channel's English name, as NotificationMethodUtil.getLabel and the
   * readiness payload write it: "SMS", "Call", "Push". The page names a
   * method from its channel, in the reader's words (MethodLabel).
   */
  title: string;
  // The number, the address or the device; masked for a member. "" when unknown.
  identifier: string;
  isVerified: boolean;
  /*
   * A phone with the OneUptime app, where a push can ring as a critical
   * alert. A browser cannot. Unknown for a member's (masked) devices, which
   * are offered the level, as the grid offers it.
   */
  hasPushLevel: boolean;
}

/*
 * A method as NotificationMethodUtil.getLabel names it ("SMS: +15550100"),
 * split back into its channel's name and its identifier.
 */
export const splitMethodLabel: (label: string) => {
  title: string;
  identifier: string;
} = (label: string): { title: string; identifier: string } => {
  const separator: number = label.indexOf(": ");

  if (separator === -1) {
    return { title: label, identifier: "" };
  }

  return {
    title: label.slice(0, separator),
    identifier: label.slice(separator + 2),
  };
};

// A member's methods, as readiness masked them.
export const getMemberMethodChoices: (
  methods: ReadonlyArray<NotificationMethodChoice>,
) => Array<PagingMethodChoice> = (
  methods: ReadonlyArray<NotificationMethodChoice>,
): Array<PagingMethodChoice> => {
  const choices: Array<PagingMethodChoice> = [];

  for (const method of methods) {
    const column: PagingMethodColumn | null = getPagingMethodColumnForChannel(
      method.methodType,
    );

    if (!column || !method.methodId) {
      continue;
    }

    choices.push({
      methodColumn: column,
      methodId: method.methodId,
      channel: getChannelForPagingMethodColumn(column),
      title: method.methodType,
      identifier: method.maskedIdentifier || "",
      isVerified: method.isVerified,
      hasPushLevel: column === "userPushId",
    });
  }

  return choices;
};

// The choice a step names, when the page knows it.
export const findMethodChoice: (
  choices: ReadonlyArray<PagingMethodChoice>,
  step: { methodColumn: PagingMethodColumn; methodId: string },
) => PagingMethodChoice | undefined = (
  choices: ReadonlyArray<PagingMethodChoice>,
  step: { methodColumn: PagingMethodColumn; methodId: string },
): PagingMethodChoice | undefined => {
  const key: string = getPagingLadderMethodKey(step);

  return choices.find((choice: PagingMethodChoice): boolean => {
    return getPagingLadderMethodKey(choice) === key;
  });
};

/*
 * The methods a step can be added for: verified ones, and push only while
 * the server sends push (PushNotificationsTurnedOff). A method already in
 * the ladder is offered again - a call at once and again after ten minutes
 * is two steps.
 */
export const getAddableMethodChoices: (data: {
  choices: ReadonlyArray<PagingMethodChoice>;
  isPushTurnedOff: boolean;
}) => Array<PagingMethodChoice> = (data: {
  choices: ReadonlyArray<PagingMethodChoice>;
  isPushTurnedOff: boolean;
}): Array<PagingMethodChoice> => {
  return data.choices.filter((choice: PagingMethodChoice): boolean => {
    if (!choice.isVerified) {
      return false;
    }

    return !(data.isPushTurnedOff && choice.methodColumn === "userPushId");
  });
};

// The step a newly added method starts as: at once, as a verified method's rules start.
export const getNewStep: (choice: PagingMethodChoice) => PagingLadderStep = (
  choice: PagingMethodChoice,
): PagingLadderStep => {
  return {
    methodColumn: choice.methodColumn,
    methodId: choice.methodId,
    notifyAfterMinutes: 0,
  };
};
