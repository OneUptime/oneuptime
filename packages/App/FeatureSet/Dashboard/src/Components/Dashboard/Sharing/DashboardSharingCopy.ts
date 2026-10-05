import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import {
  DASHBOARD_MASTER_PASSWORD_COLUMN,
  DashboardAccess,
  DashboardAccessColumn,
  DashboardAccessState,
  getDashboardAccess,
  getDashboardAccessChanges,
  getDashboardAccessColumnsWritten,
  getDashboardAccessStateAfter,
  isDashboardPasswordNeededFor,
} from "Common/Types/Dashboard/DashboardAccess";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Who can view a dashboard, on Dashboards -> a dashboard -> Sharing (and
 * ⋯ -> Share on the dashboard itself): one choice of three
 * (Common/Types/Dashboard/DashboardAccess).
 *
 * It used to be "Authentication", folded away under Advanced, with three
 * cards for one question: an "Is Visible to Public" switch behind an Edit
 * button; a "Master Password" card with a "Require Master Password" switch
 * behind a second Edit button and the password behind a third button and
 * dialog; and the IP whitelist. The public link sat in a fourth card. Turning
 * the password on before setting one locked every visitor out - the server
 * fails closed - and nothing said so.
 *
 * Now the page opens on one question, "Who can view this dashboard", with
 * the three answers the server enforces. Picking one asks first, saying
 * what changes for visitors, then writes only the columns that change - the
 * public switch needs the Growth plan on OneUptime Cloud to turn on, and a
 * write that carries it on, changed or not, is refused below Growth.
 * Turning it off - "Only people in this project" - works on every plan, so
 * a dashboard a trial left public can always be made private again; the
 * dialog then says that sharing it again needs Growth. The password is asked
 * for in the same dialog when the dashboard has none, so the page never
 * locks visitors out by itself. The public link, with a copy button, sits
 * under the public choice in force. The IP allowlist, which few dashboards
 * need, is folded under Advanced and saves on its own.
 *
 * Kept free of React (and of the browser's config, so App/Tests can load
 * it) so the card, the page and App/Tests read these exact strings and
 * decisions. Every sentence is wrapped in translationKey() so
 * npm run i18n:extract finds it. The public link's address is worked out in
 * PublicDashboardUrl.
 */

export interface DashboardAccessChoiceCopy {
  title: string;
  description: string;
}

export const DASHBOARD_ACCESS_CHOICE_COPY: Record<
  DashboardAccess,
  DashboardAccessChoiceCopy
> = {
  [DashboardAccess.ProjectOnly]: {
    title: translationKey("Only people in this project"),
    description: translationKey(
      "Project members see it when they sign in to OneUptime. It has no public link.",
    ),
  },
  [DashboardAccess.AnyoneWithLink]: {
    title: translationKey("Anyone with the link"),
    description: translationKey(
      "The dashboard is public: anyone who has its link can see it, without signing in.",
    ),
  },
  [DashboardAccess.AnyoneWithPassword]: {
    title: translationKey("Anyone with the link and a password"),
    description: translationKey(
      "Visitors open the link, then enter one password that you share with them. Nobody needs an account.",
    ),
  },
};

// What the dialog says before a choice is saved.
export interface DashboardAccessConfirmationCopy {
  title: string;
  description: string;
  submitButtonText: string;
}

export const DASHBOARD_ACCESS_CONFIRMATION_COPY: Record<
  DashboardAccess,
  DashboardAccessConfirmationCopy
> = {
  [DashboardAccess.ProjectOnly]: {
    title: translationKey("Stop sharing this dashboard?"),
    description: translationKey(
      "Only people in this project will see this dashboard. Its public link stops working at once, and so does any custom domain it has.",
    ),
    submitButtonText: translationKey("Stop Sharing"),
  },
  [DashboardAccess.AnyoneWithLink]: {
    title: translationKey("Make this dashboard public?"),
    description: translationKey(
      "Anyone with the link will see this dashboard and every widget on it, without signing in.",
    ),
    submitButtonText: translationKey("Share Publicly"),
  },
  [DashboardAccess.AnyoneWithPassword]: {
    title: translationKey("Require a password?"),
    description: translationKey(
      "Anyone with the link who enters the password will see this dashboard and every widget on it. Share the password only with the people who should see it.",
    ),
    submitButtonText: translationKey("Require Password"),
  },
};

/*
 * Sharing a private dashboard with a password is a first share, not a
 * password added to one: the dialog says so.
 */
export const SHARE_WITH_PASSWORD_CONFIRMATION_COPY: DashboardAccessConfirmationCopy =
  {
    title: translationKey("Share this dashboard with a password?"),
    description:
      DASHBOARD_ACCESS_CONFIRMATION_COPY[DashboardAccess.AnyoneWithPassword]
        .description,
    submitButtonText: translationKey("Share with Password"),
  };

/*
 * Dropping the password from a public dashboard: it stays public, and stops
 * asking for the password.
 */
export const REMOVE_PASSWORD_CONFIRMATION_COPY: DashboardAccessConfirmationCopy =
  {
    title: translationKey("Stop asking for the password?"),
    description: translationKey(
      "Anyone with the link will see this dashboard and every widget on it, without entering a password.",
    ),
    submitButtonText: translationKey("Remove Password"),
  };

// What the dialog for a move says: by where it goes, and where from.
export const getDashboardAccessConfirmationCopy: (data: {
  from: DashboardAccess;
  to: DashboardAccess;
}) => DashboardAccessConfirmationCopy = (data: {
  from: DashboardAccess;
  to: DashboardAccess;
}): DashboardAccessConfirmationCopy => {
  if (
    data.to === DashboardAccess.AnyoneWithPassword &&
    data.from === DashboardAccess.ProjectOnly
  ) {
    return SHARE_WITH_PASSWORD_CONFIRMATION_COPY;
  }

  if (
    data.to === DashboardAccess.AnyoneWithLink &&
    data.from === DashboardAccess.AnyoneWithPassword
  ) {
    return REMOVE_PASSWORD_CONFIRMATION_COPY;
  }

  return DASHBOARD_ACCESS_CONFIRMATION_COPY[data.to];
};

export const DashboardSharingCopy: {
  cardTitle: string;
  cardDescription: string;
  notFound: string;
  // Under the public choice in force.
  publicLinkTitle: string;
  copyLink: string;
  copyLinkTitle: string;
  copied: string;
  // Under the password choice, while it is the choice.
  lockedWithoutPassword: string;
  setPassword: string;
  setPasswordDescription: string;
  changePassword: string;
  changePasswordDescription: string;
  // The password, in the dialogs.
  passwordFieldTitle: string;
  newPasswordFieldTitle: string;
  keepPasswordDescription: string;
  passwordPlaceholder: string;
  // The folded Advanced section, and the IP allowlist card in it.
  advancedDescription: string;
  advancedSummaryOpen: string;
  advancedSummaryConfigured: string;
  ipAllowlistDescription: string;
  ipAllowlistEmpty: string;
  ipAllowlistNoAddress: string;
} = {
  cardTitle: translationKey("Who can view this dashboard"),
  cardDescription: translationKey(
    "Pick who can open this dashboard. A change asks you to confirm, then applies at once.",
  ),
  notFound: translationKey("Dashboard not found."),
  publicLinkTitle: translationKey("Public link"),
  copyLink: translationKey("Copy link"),
  copyLinkTitle: translationKey("Copy the public link"),
  copied: translationKey("Copied!"),
  lockedWithoutPassword: translationKey(
    "No password is set yet, so nobody can open the public link. Set one to let visitors in.",
  ),
  setPassword: translationKey("Set Password"),
  setPasswordDescription: translationKey(
    "Visitors enter this password to see the dashboard. Share it only with the people who should see it.",
  ),
  changePassword: translationKey("Change Password"),
  changePasswordDescription: translationKey(
    "The new password works at once. People who entered the old one can keep viewing the dashboard for up to 7 days.",
  ),
  passwordFieldTitle: translationKey("Password"),
  newPasswordFieldTitle: translationKey("New Password"),
  keepPasswordDescription: translationKey(
    "Leave this empty to keep the password set before.",
  ),
  passwordPlaceholder: translationKey("Enter a password"),
  advancedDescription: translationKey(
    "Limit which IP addresses can open this dashboard's public link.",
  ),
  advancedSummaryOpen: translationKey(
    "Every IP address can open the public link.",
  ),
  advancedSummaryConfigured: translationKey(
    "Only the IP addresses on the allowlist can open the public link.",
  ),
  ipAllowlistDescription: translationKey(
    "Only visitors from these IP addresses or ranges can open the public link, with or without the password. Leave it empty to allow every address. Project members who sign in are not affected.",
  ),
  ipAllowlistEmpty: translationKey(
    "Empty: every IP address can open the public link.",
  ),
  ipAllowlistNoAddress: translationKey(
    "The list holds no address, so no IP address can open the public link.",
  ),
};

/*
 * Every dashboard column a choice can write: someone who may not change all
 * of them sees the choices locked (the server checks each).
 */
export const DASHBOARD_ACCESS_GATED_COLUMNS: ReadonlyArray<string> = [
  "isPublicDashboard",
  "enableMasterPassword",
  DASHBOARD_MASTER_PASSWORD_COLUMN,
];

// Test ids.
export const DASHBOARD_SHARING_CARD_TEST_ID: string = "dashboard-sharing";
export const DASHBOARD_PUBLIC_LINK_TEST_ID: string = "dashboard-public-link";
export const DASHBOARD_SHARING_LOCKED_TEST_ID: string =
  "dashboard-sharing-locked-without-password";
export const DASHBOARD_SHARING_SET_PASSWORD_TEST_ID: string =
  "dashboard-sharing-set-password";
export const DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID: string =
  "dashboard-sharing-change-password";
export const DASHBOARD_SHARING_ADVANCED_SECTION_TEST_ID: string =
  "dashboard-sharing-advanced";
// The dialog's sentence when a move leaves a choice the plan does not include.
export const DASHBOARD_SHARING_PLAN_LEFTOVER_TEST_ID: string =
  "dashboard-sharing-plan-leftover";
export const DASHBOARD_IP_ALLOWLIST_ENTRIES_TEST_ID: string =
  "dashboard-ip-allowlist-entries";

export const getDashboardAccessChoiceTestId: (
  access: DashboardAccess,
) => string = (access: DashboardAccess): string => {
  return `dashboard-access-${access}`;
};

/*
 * Every column a move can write, the password's included for a move to the
 * password (the dialog asks for one, or offers to replace the one set):
 * what the permission gate and the plan are checked against.
 */
export const getDashboardAccessColumnsWrittenWithPassword: (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
}) => Array<string> = (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
}): Array<string> => {
  const columns: Array<string> = getDashboardAccessColumnsWritten({
    from: data.from,
    to: data.to,
  }).map((column: DashboardAccessColumn): string => {
    return column;
  });

  if (data.to === DashboardAccess.AnyoneWithPassword) {
    columns.push(DASHBOARD_MASTER_PASSWORD_COLUMN);
  }

  return columns;
};

/*
 * The plan the project would need to move a dashboard to a choice, or null
 * when it can: the first column the move writes that the plan cannot write
 * with the value the move gives it (getPlanNeeded answers per column and
 * value, from @ColumnBillingAccessControl - ModelSwitchUtil's
 * getPlanNeededToWriteColumn). Sharing a dashboard needs Growth on OneUptime
 * Cloud; stopping does not: it takes isPublicDashboard back to its default,
 * which every plan may write, so a dashboard a trial left public can always
 * be made private again. Moving between the two public choices leaves
 * isPublicDashboard out, so it needs no plan; the password columns need none
 * either (the password's value is not known here: it is typed in the
 * dialog).
 */
export const getPlanNeededForDashboardAccess: (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
  getPlanNeeded: (column: string, value: unknown) => PlanType | null;
}) => PlanType | null = (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
  getPlanNeeded: (column: string, value: unknown) => PlanType | null;
}): PlanType | null => {
  const changes: Record<string, unknown> = {
    ...getDashboardAccessChanges({ from: data.from, to: data.to }),
  };

  for (const column of getDashboardAccessColumnsWrittenWithPassword(data)) {
    const plan: PlanType | null = data.getPlanNeeded(column, changes[column]);

    if (plan) {
      return plan;
    }
  }

  return null;
};

/*
 * Moving a dashboard off a choice the project's plan does not include - one
 * a trial left public, on a project now on Free: the move needs no plan, but
 * coming back does. The plan coming back needs, or null when the move is
 * not one of those (it needs a plan itself, or coming back needs none). The
 * dialog says so before the move is saved.
 */
export const getPlanNeededToComeBackToDashboardAccess: (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
  getPlanNeeded: (column: string, value: unknown) => PlanType | null;
}) => PlanType | null = (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
  getPlanNeeded: (column: string, value: unknown) => PlanType | null;
}): PlanType | null => {
  const current: DashboardAccess = getDashboardAccess(data.from);

  if (current === data.to || getPlanNeededForDashboardAccess(data)) {
    return null;
  }

  return getPlanNeededForDashboardAccess({
    from: getDashboardAccessStateAfter({
      from: data.from,
      to: data.to,
      isPasswordEntered: false,
    }),
    to: current,
    getPlanNeeded: data.getPlanNeeded,
  });
};

/*
 * Whether the dialog for a move has to have a password typed in: a move to
 * the password, on a dashboard with none set. With one set, the field is
 * there to replace it, and may be left empty.
 */
export const isDashboardPasswordRequiredInDialog: (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
}) => boolean = (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
}): boolean => {
  return isDashboardPasswordNeededFor(data);
};

// The columns the Sharing card reads.
export const getDashboardAccessSelect: () => {
  isPublicDashboard: true;
  enableMasterPassword: true;
  masterPassword: true;
} = (): {
  isPublicDashboard: true;
  enableMasterPassword: true;
  masterPassword: true;
} => {
  return {
    isPublicDashboard: true,
    enableMasterPassword: true,
    masterPassword: true,
  };
};

// What a dashboard the card read holds, for the rule.
export const getDashboardAccessState: (
  dashboard: Dashboard,
) => DashboardAccessState = (dashboard: Dashboard): DashboardAccessState => {
  return {
    isPublicDashboard: dashboard.isPublicDashboard,
    enableMasterPassword: dashboard.enableMasterPassword,
    hasMasterPassword: Boolean(dashboard.masterPassword),
  };
};

export default DashboardSharingCopy;
