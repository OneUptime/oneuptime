import Project from "Common/Models/DatabaseModels/Project";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS,
  PROJECT_BALANCE_RECHARGE_PERMISSIONS,
  ProjectBalanceType,
} from "Common/Utils/Project/ProjectBalance";
import {
  AUTO_RECHARGE_FAILED_DESCRIPTIONS,
  PROJECT_BALANCE_CARD_DESCRIPTIONS,
  RECHARGE_BALANCE_LOCKED_TEMPLATE,
} from "./ProjectBalanceCopy";

/*
 * Whether the signed-in person may add to one of the project's prepaid
 * balances - recharge it, or change its Auto Recharge - as the server would
 * decide.
 *
 * The recharge routes let in a project owner or someone with Manage Billing
 * (PROJECT_BALANCE_RECHARGE_PERMISSIONS), and the Auto Recharge columns'
 * update permissions are the same people (a test holds the two together).
 * So the answer is PermissionGate's for those columns: the Project's own
 * update permissions, then each column's - the same check the notification
 * channel switches take (NotificationMethods/ProjectNotificationChannels).
 *
 *   Yes     - they may.
 *   No      - they may not, and the gate says which permission they lack.
 *   Unknown - the permission snapshot has not arrived yet (it rides on a
 *             response header, so it is empty for a moment after a fresh
 *             sign-in or a project switch). Nobody is offered the Recharge
 *             button or a link to the page then, and nobody is told they
 *             lack a permission.
 */
export enum ProjectBalanceAccess {
  Yes = "Yes",
  No = "No",
  Unknown = "Unknown",
}

export const getProjectBalanceAccess: (
  balance: ProjectBalanceType,
) => ProjectBalanceAccess = (
  balance: ProjectBalanceType,
): ProjectBalanceAccess => {
  const project: Project = new Project();

  const gates: Array<PermissionGateResult> =
    PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS[balance].map(
      (column: string): PermissionGateResult => {
        return PermissionGate.checkColumnUpdate(project, column);
      },
    );

  if (
    gates.every((gate: PermissionGateResult): boolean => {
      return gate.isAllowed;
    })
  ) {
    return ProjectBalanceAccess.Yes;
  }

  // Refused with a reason: the gate knows who this is, and it is not them.
  if (
    gates.some((gate: PermissionGateResult): boolean => {
      return !gate.isAllowed && Boolean(gate.disabledReason);
    })
  ) {
    return ProjectBalanceAccess.No;
  }

  return ProjectBalanceAccess.Unknown;
};

/*
 * Whether the Recharge button, or a link to the page that holds the
 * balance, may be offered: only to someone the server would let add to it,
 * and not while that is unknown.
 */
export const canAddProjectBalance: (balance: ProjectBalanceType) => boolean = (
  balance: ProjectBalanceType,
): boolean => {
  return getProjectBalanceAccess(balance) === ProjectBalanceAccess.Yes;
};

/*
 * Whether this person is known not to be allowed to add to it - so a line
 * saying who can is for them. Never while the permissions are on their way:
 * an owner is not told to ask someone else.
 */
export const isKnownNotToAddProjectBalance: (
  balance: ProjectBalanceType,
) => boolean = (balance: ProjectBalanceType): boolean => {
  return getProjectBalanceAccess(balance) === ProjectBalanceAccess.No;
};

/*
 * The Current Balance card's description: it asks someone who may recharge
 * the balance to, and tells everyone else who can.
 */
export const getProjectBalanceCardDescription: (
  balance: ProjectBalanceType,
  access: ProjectBalanceAccess,
) => string = (
  balance: ProjectBalanceType,
  access: ProjectBalanceAccess,
): string => {
  return access === ProjectBalanceAccess.Yes
    ? PROJECT_BALANCE_CARD_DESCRIPTIONS[balance].forPeopleWhoMayAdd
    : PROJECT_BALANCE_CARD_DESCRIPTIONS[balance].forEveryoneElse;
};

/*
 * What the notice that Auto Recharge's last charge failed says after its
 * title: what to do, for someone who may add balance; who can, for everyone
 * else - and while that is not known yet, so an owner is never told to ask
 * someone else, and nobody is told to do what they may not.
 */
export const getAutoRechargeFailedDescription: (
  balance: ProjectBalanceType,
  access: ProjectBalanceAccess,
) => string = (
  balance: ProjectBalanceType,
  access: ProjectBalanceAccess,
): string => {
  return access === ProjectBalanceAccess.Yes
    ? AUTO_RECHARGE_FAILED_DESCRIPTIONS[balance].forPeopleWhoMayAdd
    : AUTO_RECHARGE_FAILED_DESCRIPTIONS[balance].forEveryoneElse;
};

// Why the Recharge Balance button is locked, in the reader's language.
export const getRechargeBalanceLockedReason: (
  translator?: Translator | undefined,
) => string = (translator?: Translator | undefined): string => {
  const words: Translator = translator || getGlobalTranslator();

  return words.translateTemplate(RECHARGE_BALANCE_LOCKED_TEMPLATE, {
    permissions: PermissionGate.getPermissionTitles([
      ...PROJECT_BALANCE_RECHARGE_PERMISSIONS,
    ])
      .map((title: string): string => {
        return words.translateText(title) || title;
      })
      .join(", "),
  });
};

/*
 * The Current Balance card's Recharge Balance button: working for someone
 * who may recharge, locked with the reason for someone known not to, and
 * not there while that is unknown - the rule CardModelDetail applies to its
 * own Edit button.
 */
export const getRechargeBalanceButtons: (data: {
  access: ProjectBalanceAccess;
  onRecharge: () => void;
  translator?: Translator | undefined;
}) => Array<CardButtonSchema> = (data: {
  access: ProjectBalanceAccess;
  onRecharge: () => void;
  translator?: Translator | undefined;
}): Array<CardButtonSchema> => {
  if (data.access === ProjectBalanceAccess.Unknown) {
    return [];
  }

  if (data.access === ProjectBalanceAccess.No) {
    return [
      {
        title: "Recharge Balance",
        icon: IconProp.Add,
        buttonStyle: ButtonStyleType.NORMAL,
        disabled: true,
        tooltip: getRechargeBalanceLockedReason(data.translator),
        onClick: () => {
          // Locked. The tooltip says which permission is missing.
        },
      },
    ];
  }

  return [
    {
      title: "Recharge Balance",
      icon: IconProp.Add,
      onClick: data.onRecharge,
    },
  ];
};
