import IncomingCallPhoneNumberAccess, {
  IncomingCallPhoneNumberAction,
} from "Common/Utils/IncomingCall/IncomingCallPhoneNumberAccess";
import { HeldPermissions } from "Common/Types/HeldPermissions";
import PermissionGate, {
  PermissionGateOptions,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";

/*
 * Whether the buttons of an incoming call policy's number picker may be
 * pressed: the dashboard's half of the rule the phone-number routes ask on
 * the server (Common/Utils/IncomingCall/IncomingCallPhoneNumberAccess), so
 * the picker is offered to exactly the people the routes let in.
 *
 *  - Add Phone Number opens the picker, which looks numbers up (search
 *    Twilio, list the numbers the account has) and then reserves or attaches
 *    one: it needs both, the read of incoming call policies and of call and
 *    SMS settings, and the edit of incoming call policies.
 *  - Release needs the edit of incoming call policies.
 *
 * For someone the dashboard knows may not, the button stays on screen,
 * locked, and its tooltip says in one plain sentence what it takes. Someone
 * it knows nothing about yet (the permissions not loaded) keeps the button,
 * and the server decides. A team's block row is never a grant, and a block
 * with no labels takes the permission away (PermissionGate). A master admin
 * is never locked out.
 *
 * Kept free of React so it can be tested on its own.
 */

export interface IncomingCallPhoneNumberLock {
  isLocked: boolean;
  // Why it is locked, in English: the button translates it.
  tooltip?: string | undefined;
}

export const INCOMING_CALL_PHONE_NUMBER_LOCKED_TOOLTIPS: {
  add: string;
  release: string;
} = {
  add: translationKey(
    "Adding a phone number needs permission to edit incoming call policies and to read call and SMS settings.",
  ),
  release: translationKey(
    "Releasing a phone number needs permission to edit incoming call policies.",
  ),
};

const NOT_LOCKED: IncomingCallPhoneNumberLock = { isLocked: false };

const getLock: (data: {
  actions: ReadonlyArray<IncomingCallPhoneNumberAction>;
  tooltip: string;
  options?: PermissionGateOptions | undefined;
}) => IncomingCallPhoneNumberLock = (data: {
  actions: ReadonlyArray<IncomingCallPhoneNumberAction>;
  tooltip: string;
  options?: PermissionGateOptions | undefined;
}): IncomingCallPhoneNumberLock => {
  /*
   * A master admin holds everything, and before the snapshot has landed
   * there is nothing honest to say: either way the button is offered.
   */
  if (User.isMasterAdmin() || !PermissionGate.hasPermissionSnapshot(data.options)) {
    return NOT_LOCKED;
  }

  const held: HeldPermissions = PermissionGate.getHeldPermissions(
    data.options,
  );

  if (IncomingCallPhoneNumberAccess.mayDo(held, data.actions)) {
    return NOT_LOCKED;
  }

  return {
    isLocked: true,
    tooltip: data.tooltip,
  };
};

// Add Phone Number: look numbers up, then reserve or attach one.
export const getAddPhoneNumberLock: (
  options?: PermissionGateOptions | undefined,
) => IncomingCallPhoneNumberLock = (
  options?: PermissionGateOptions | undefined,
): IncomingCallPhoneNumberLock => {
  return getLock({
    actions: [
      IncomingCallPhoneNumberAction.LookUp,
      IncomingCallPhoneNumberAction.Change,
    ],
    tooltip: INCOMING_CALL_PHONE_NUMBER_LOCKED_TOOLTIPS.add,
    options: options,
  });
};

// Release, beside each of the policy's numbers.
export const getReleasePhoneNumberLock: (
  options?: PermissionGateOptions | undefined,
) => IncomingCallPhoneNumberLock = (
  options?: PermissionGateOptions | undefined,
): IncomingCallPhoneNumberLock => {
  return getLock({
    actions: [IncomingCallPhoneNumberAction.Change],
    tooltip: INCOMING_CALL_PHONE_NUMBER_LOCKED_TOOLTIPS.release,
    options: options,
  });
};
