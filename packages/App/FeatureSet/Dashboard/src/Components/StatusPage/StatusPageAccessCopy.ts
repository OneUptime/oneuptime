import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import {
  getStatusPageAccessColumnsWritten,
  isStatusPagePasswordNeededFor,
  StatusPageAccess,
  StatusPageAccessColumn,
  StatusPageAccessState,
  STATUS_PAGE_MASTER_PASSWORD_COLUMN,
} from "Common/Types/StatusPage/StatusPageAccess";
import IpAllowlistCopy from "../IpAllowlist/IpAllowlistCopy";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The IP allowlist's rules (which lines the server can match, and why a
 * list cannot be saved) are shared with a dashboard's Sharing page, which
 * has the same list: they live in Components/IpAllowlist and are exported
 * from here as before.
 */
export {
  getIpAllowlistEntries,
  getIpAllowlistProblem,
  isIpAllowlistEntryValid,
  isIpAllowlistInForce,
} from "../IpAllowlist/IpAllowlistCopy";

/*
 * Who can see a status page, on Status Pages -> a page -> Security ->
 * Access: one choice of three (Common/Types/StatusPage/StatusPageAccess).
 *
 * It used to be "Authentication Settings", the last of five Security
 * entries, with three cards: an "Is Visible to Public" switch behind an
 * Edit button, a "Require Master Password" switch behind a second Edit
 * button with the password behind a third button, and the IP whitelist. A
 * master password switched on for a public page did nothing (the server
 * asks for it only on a private page), and one switched on with no password
 * set did not protect the page either - while the status page app sent every
 * visitor to a password prompt nobody could pass. The Private Users page
 * then said, in a banner, that private users could not sign in.
 *
 * Now the page opens on one question, "Who can see this status page", with
 * the three answers the server enforces. Picking one asks first, saying what
 * changes for visitors, then writes only the columns that change - the
 * public switch needs the Growth plan on OneUptime Cloud, and a write that
 * carries it, changed or not, is refused below Growth. The password is asked
 * for in the same dialog when the page has none, so the page can never say
 * "password" without one. The IP allowlist, which few pages need, is folded
 * under Advanced.
 *
 * Kept free of React so the card, the page and App/Tests read these exact
 * strings and decisions. Every sentence is wrapped in translationKey() so
 * npm run i18n:extract finds it; the plural is a plain { one, other } the
 * extractor reads as one.
 */

export interface AccessChoiceCopy {
  title: string;
  description: string;
}

export const ACCESS_CHOICE_COPY: Record<StatusPageAccess, AccessChoiceCopy> = {
  [StatusPageAccess.Anyone]: {
    title: translationKey("Anyone with the link"),
    description: translationKey(
      "The page is public: anyone who has its address can see it, without signing in.",
    ),
  },
  [StatusPageAccess.SignIn]: {
    title: translationKey("Only people who sign in"),
    description: translationKey(
      "Visitors sign in first, as a private user or with your SSO or OIDC provider.",
    ),
  },
  [StatusPageAccess.Password]: {
    title: translationKey("Anyone with the password"),
    description: translationKey(
      "Visitors enter one password that you share with them. Nobody needs an account.",
    ),
  },
};

// What the dialog says before a choice is saved.
export interface AccessConfirmationCopy {
  title: string;
  description: string;
  submitButtonText: string;
}

export const ACCESS_CONFIRMATION_COPY: Record<
  StatusPageAccess,
  AccessConfirmationCopy
> = {
  [StatusPageAccess.Anyone]: {
    title: translationKey("Make this status page public?"),
    description: translationKey(
      "Anyone with the link will see this status page, with its incidents, scheduled maintenance and announcements, without signing in or entering a password.",
    ),
    submitButtonText: translationKey("Make Public"),
  },
  [StatusPageAccess.SignIn]: {
    title: translationKey("Require visitors to sign in?"),
    description: translationKey(
      "Only private users, and people your SSO or OIDC provider lets in, will see this status page. Everyone else is asked to sign in.",
    ),
    submitButtonText: translationKey("Require Sign-in"),
  },
  [StatusPageAccess.Password]: {
    title: translationKey("Require a password?"),
    description: translationKey(
      "Visitors will enter the password to see this status page. Share it only with the people who should see the page.",
    ),
    submitButtonText: translationKey("Require Password"),
  },
};

export const StatusPageAccessCopy: {
  cardTitle: string;
  cardDescription: string;
  notFound: string;
  // The private users and SSO lines under "Only people who sign in".
  privateUsers: PluralTemplate;
  ssoOn: string;
  ssoOff: string;
  oidcOn: string;
  oidcOff: string;
  ssoRequired: string;
  // The warning under "Only people who sign in", while it is the choice.
  nobodyCanSignIn: string;
  nobodyCanSignInSsoRequired: string;
  addPrivateUsers: string;
  setUpSso: string;
  // In the dialog, when moving to sign-in would let nobody in.
  confirmNobodyCanSignIn: string;
  // In the dialog, when moving to a password from sign-in.
  confirmPrivateUsersUsePassword: string;
  // The password, in the dialog and on its own.
  passwordFieldTitle: string;
  newPasswordFieldTitle: string;
  keepPasswordDescription: string;
  passwordPlaceholder: string;
  changePassword: string;
  changePasswordDescription: string;
  // The folded Advanced section, and the IP allowlist card in it.
  advancedDescription: string;
  advancedSummaryOpen: string;
  advancedSummaryConfigured: string;
  ipAllowlistTitle: string;
  ipAllowlistDescription: string;
  ipAllowlistEditButton: string;
  ipAllowlistFieldDescription: string;
  ipAllowlistEmpty: string;
  ipAllowlistNoAddress: string;
  ipAllowlistBlank: string;
  ipAllowlistInvalidEntry: string;
  // The Private Users page while the password is what lets visitors in.
  privateUsersPasswordNotice: string;
  privateUsersPasswordNoticeAction: string;
} = {
  cardTitle: translationKey("Who can see this status page"),
  cardDescription: translationKey(
    "Pick who can open this status page. A change asks you to confirm, then applies at once.",
  ),
  notFound: translationKey("Status page not found."),
  privateUsers: {
    one: "{{count}} private user",
    other: "{{count}} private users",
  },
  ssoOn: translationKey("SSO on"),
  ssoOff: translationKey("SSO off"),
  oidcOn: translationKey("OIDC on"),
  oidcOff: translationKey("OIDC off"),
  ssoRequired: translationKey("SSO required"),
  nobodyCanSignIn: translationKey("Nobody can sign in yet. {{link}}"),
  nobodyCanSignInSsoRequired: translationKey(
    "Nobody can sign in: SSO is required, and no SSO or OIDC provider is on. {{link}}",
  ),
  addPrivateUsers: translationKey("Add private users"),
  setUpSso: translationKey("Set up SSO"),
  confirmNobodyCanSignIn: translationKey(
    "Nobody can sign in yet, so nobody will see the page until you add private users or set up SSO.",
  ),
  confirmPrivateUsersUsePassword: translationKey(
    "Private users can no longer sign in while a password is required: they enter the password too.",
  ),
  passwordFieldTitle: translationKey("Password"),
  newPasswordFieldTitle: translationKey("New Password"),
  keepPasswordDescription: translationKey(
    "Leave this empty to keep the password set before.",
  ),
  passwordPlaceholder: translationKey("Enter a password"),
  changePassword: translationKey("Change Password"),
  changePasswordDescription: translationKey(
    "The new password works at once. People who entered the old one can keep viewing the page for up to 7 days.",
  ),
  advancedDescription: translationKey(
    "Limit which IP addresses can open this status page.",
  ),
  advancedSummaryOpen: translationKey(
    "Every IP address can open this status page.",
  ),
  advancedSummaryConfigured: translationKey(
    "Only the IP addresses on the allowlist can open this status page.",
  ),
  ipAllowlistTitle: IpAllowlistCopy.title,
  ipAllowlistDescription: translationKey(
    "Only visitors from these IP addresses or ranges can open this status page, whoever it is open to. Leave it empty to allow every address.",
  ),
  ipAllowlistEditButton: IpAllowlistCopy.editButton,
  ipAllowlistFieldDescription: IpAllowlistCopy.fieldDescription,
  ipAllowlistEmpty: translationKey(
    "Empty: every IP address can open this status page.",
  ),
  ipAllowlistNoAddress: translationKey(
    "The list holds no address, so no IP address can open this status page.",
  ),
  ipAllowlistBlank: IpAllowlistCopy.blank,
  ipAllowlistInvalidEntry: IpAllowlistCopy.invalidEntry,
  privateUsersPasswordNotice: translationKey(
    "Master password is enabled for this status page. Private users authentication is disabled while the master password is active.",
  ),
  privateUsersPasswordNoticeAction: translationKey("Change access"),
};

/*
 * Requiring SSO for the people who sign in, on Security -> SSO under the
 * providers and the link that tests them: one switch that saves when it is
 * flipped (it was a card whose Edit dialog held one switch, "Force SSO for
 * Login", with "Please test SSO before you you enable this feature" under
 * it). Named "Require SSO for Login" as the project's own switch is.
 * Turning it on asks first, with a red button: private users who sign in
 * with an email and password are locked out from then on.
 */
export const StatusPageRequireSsoCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  note: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmButton: string;
} = {
  cardTitle: translationKey("SSO Settings"),
  cardDescription: translationKey(
    "Test SSO with the link above before you require it.",
  ),
  switchTitle: translationKey("Require SSO for Login"),
  switchOnDescription: translationKey(
    "Private users sign in with SSO or OIDC only. Signing in with an email and password is turned off.",
  ),
  switchOffDescription: translationKey(
    "Private users can sign in with an email and password, or with SSO or OIDC.",
  ),
  note: translationKey(
    "It applies while only people who sign in can see this status page.",
  ),
  confirmTitle: translationKey("Require SSO for this status page?"),
  confirmDescription: translationKey(
    "Private users will no longer be able to sign in with an email and password. Only people your SSO or OIDC provider lets in will see this status page, so test SSO with the link above first.",
  ),
  confirmButton: translationKey("Require SSO"),
};

// The status page column the SSO page's switch writes.
export type StatusPageRequireSsoColumn = "requireSsoForLogin";

export const STATUS_PAGE_REQUIRE_SSO_COLUMN: StatusPageRequireSsoColumn =
  "requireSsoForLogin";

/*
 * Every status page column a choice can write: someone who may not change
 * all of them sees the choices locked (the server checks each).
 */
export const STATUS_PAGE_ACCESS_GATED_COLUMNS: ReadonlyArray<string> = [
  "isPublicStatusPage",
  "enableMasterPassword",
  STATUS_PAGE_MASTER_PASSWORD_COLUMN,
];

// Test ids.
export const STATUS_PAGE_ACCESS_CARD_TEST_ID: string = "status-page-access";
export const STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID: string =
  "status-page-access-advanced";
export const STATUS_PAGE_ACCESS_SIGN_IN_METHODS_TEST_ID: string =
  "status-page-access-sign-in-methods";
export const STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID: string =
  "status-page-access-nobody-can-sign-in";
export const STATUS_PAGE_ACCESS_CHANGE_PASSWORD_TEST_ID: string =
  "status-page-access-change-password";
export const STATUS_PAGE_REQUIRE_SSO_SWITCH_TEST_ID: string =
  "status-page-require-sso-switch";
export const PRIVATE_USERS_PASSWORD_NOTICE_TEST_ID: string =
  "private-users-password-notice";
export const STATUS_PAGE_IP_ALLOWLIST_ENTRIES_TEST_ID: string =
  "status-page-ip-allowlist-entries";

export const getAccessChoiceTestId: (access: StatusPageAccess) => string = (
  access: StatusPageAccess,
): string => {
  return `status-page-access-${access}`;
};

/*
 * The sign-in methods set up for a page, for the line under "Only people who
 * sign in". A count is null when it could not be read (the read failed, or
 * private users on a plan without them): such a method is left out of the
 * line, and never counted as "nobody". SSO and OIDC on a plan without single
 * sign-on are not offered to the project at all: they count as none, and the
 * line leaves them out.
 */
export interface SignInMethods {
  privateUsers: number | null;
  enabledSsoProviders: number | null;
  enabledOidcProviders: number | null;
  isSsoRequired: boolean;
  // Whether the project's plan includes single sign-on (SSO and OIDC).
  isSsoOnPlan: boolean;
}

export enum NobodyCanSignInReason {
  // Nothing at all: no private users, no SSO, no OIDC.
  NothingSetUp = "NothingSetUp",
  // SSO is required, and no SSO or OIDC provider is on.
  SsoRequiredWithoutProvider = "SsoRequiredWithoutProvider",
}

/*
 * Why nobody can sign in, or null when somebody can - or when a method
 * could not be read, so the page does not claim "nobody" without knowing.
 * Single sign-on adds a private user the first time someone signs in with
 * it, so an SSO or OIDC provider that is on lets people in by itself.
 */
export const getNobodyCanSignInReason: (
  methods: SignInMethods,
) => NobodyCanSignInReason | null = (
  methods: SignInMethods,
): NobodyCanSignInReason | null => {
  if (
    methods.enabledSsoProviders === null ||
    methods.enabledOidcProviders === null
  ) {
    return null;
  }

  const providers: number =
    methods.enabledSsoProviders + methods.enabledOidcProviders;

  if (methods.isSsoRequired) {
    return providers === 0
      ? NobodyCanSignInReason.SsoRequiredWithoutProvider
      : null;
  }

  if (methods.privateUsers === null) {
    return null;
  }

  return methods.privateUsers + providers === 0
    ? NobodyCanSignInReason.NothingSetUp
    : null;
};

/*
 * The plan the project would need to move a page to a choice, or null when
 * it can: the first column the move writes that the plan cannot change
 * (getPlanNeeded answers per column, from @ColumnBillingAccessControl).
 * Moving between the two private choices leaves isPublicStatusPage out, so
 * it needs no plan; the password column needs none either.
 */
export const getPlanNeededForAccess: (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
  getPlanNeeded: (column: string) => PlanType | null;
}) => PlanType | null = (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
  getPlanNeeded: (column: string) => PlanType | null;
}): PlanType | null => {
  for (const column of getStatusPageAccessColumnsWrittenWithPassword(data)) {
    const plan: PlanType | null = data.getPlanNeeded(column);

    if (plan) {
      return plan;
    }
  }

  return null;
};

/*
 * Every column a move can write, the password's included for a move to the
 * password (the dialog asks for one, or offers to replace the one set):
 * what the permission gate and the plan are checked against.
 */
export const getStatusPageAccessColumnsWrittenWithPassword: (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
}) => Array<string> = (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
}): Array<string> => {
  const columns: Array<string> = getStatusPageAccessColumnsWritten({
    from: data.from,
    to: data.to,
  }).map((column: StatusPageAccessColumn): string => {
    return column;
  });

  if (data.to === StatusPageAccess.Password) {
    columns.push(STATUS_PAGE_MASTER_PASSWORD_COLUMN);
  }

  return columns;
};

/*
 * Whether the dialog for a move has to have a password typed in: a move to
 * the password, on a page with none set. With one set, the field is there
 * to replace it, and may be left empty.
 */
export const isPasswordRequiredInDialog: (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
}) => boolean = (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
}): boolean => {
  return isStatusPagePasswordNeededFor(data);
};

// The columns the Access card reads.
export const getStatusPageAccessSelect: () => {
  isPublicStatusPage: true;
  enableMasterPassword: true;
  masterPassword: true;
  requireSsoForLogin: true;
} = (): {
  isPublicStatusPage: true;
  enableMasterPassword: true;
  masterPassword: true;
  requireSsoForLogin: true;
} => {
  return {
    isPublicStatusPage: true,
    enableMasterPassword: true,
    masterPassword: true,
    requireSsoForLogin: true,
  };
};

// What a status page the card read holds, for the rule.
export const getStatusPageAccessState: (
  statusPage: StatusPage,
) => StatusPageAccessState = (
  statusPage: StatusPage,
): StatusPageAccessState => {
  return {
    isPublicStatusPage: statusPage.isPublicStatusPage,
    enableMasterPassword: statusPage.enableMasterPassword,
    hasMasterPassword: Boolean(statusPage.masterPassword),
  };
};

export default StatusPageAccessCopy;
