/*
 * Who can see a status page: one choice of three.
 *
 *   Anyone with the link      the page is public.
 *   Only people who sign in   private users, and people the page's SSO or
 *                             OIDC provider lets in, sign in first.
 *   Anyone with the password  visitors enter one shared password.
 *
 * The choice is stored in three columns, which the API and Terraform read
 * and write as they always have: isPublicStatusPage (on by default),
 * enableMasterPassword (off by default) and masterPassword (a hash). The
 * server asks for the password only on a page that is not public and has a
 * password set (StatusPageService.hasReadAccess); anything else with
 * enableMasterPassword on is a sign-in page, or a public one. So:
 *
 *   isPublicStatusPage on                                 -> Anyone
 *   off, enableMasterPassword on and a password set       -> Password
 *   off, otherwise                                        -> Sign in
 *
 * That rule lives here, once, and everything that has to agree on it reads
 * it from here: the server's read check, the status page app's "does this
 * page ask for a password?" (the master-page answer), and the dashboard's
 * Access page, which shows the choice and writes it.
 *
 * Writing a choice writes only the columns whose value changes
 * (getStatusPageAccessChanges): isPublicStatusPage needs the Growth plan to
 * change on OneUptime Cloud, and a write that carries it - changed or not -
 * is refused below Growth, so moving between the two private choices must
 * leave it out.
 */

export enum StatusPageAccess {
  Anyone = "Anyone",
  SignIn = "SignIn",
  Password = "Password",
}

// The order the choices are offered in.
export const STATUS_PAGE_ACCESS_CHOICES: ReadonlyArray<StatusPageAccess> = [
  StatusPageAccess.Anyone,
  StatusPageAccess.SignIn,
  StatusPageAccess.Password,
];

// What a status page holds that decides who can see it.
export interface StatusPageAccessState {
  // Nothing stored reads as the column's default: public.
  isPublicStatusPage?: boolean | null | undefined;
  // Nothing stored reads as the column's default: off.
  enableMasterPassword?: boolean | null | undefined;
  // Whether a master password is stored (its hash is never shown).
  hasMasterPassword: boolean;
}

// The two switches each choice stores.
export interface StatusPageAccessColumns {
  isPublicStatusPage: boolean;
  enableMasterPassword: boolean;
}

export const STATUS_PAGE_ACCESS_COLUMNS: Record<
  StatusPageAccess,
  StatusPageAccessColumns
> = {
  [StatusPageAccess.Anyone]: {
    isPublicStatusPage: true,
    /*
     * A public page never asks for the password, so the switch did nothing
     * while it was on. Turning it off means making the page private later
     * never brings back a password nobody remembers asking for.
     */
    enableMasterPassword: false,
  },
  [StatusPageAccess.SignIn]: {
    isPublicStatusPage: false,
    enableMasterPassword: false,
  },
  [StatusPageAccess.Password]: {
    isPublicStatusPage: false,
    enableMasterPassword: true,
  },
};

// The columns a choice writes, in the order they are written.
export type StatusPageAccessColumn = keyof StatusPageAccessColumns;

export const STATUS_PAGE_ACCESS_COLUMN_NAMES: ReadonlyArray<StatusPageAccessColumn> =
  ["isPublicStatusPage", "enableMasterPassword"];

// The column the password is written to, beside the choice's columns.
export const STATUS_PAGE_MASTER_PASSWORD_COLUMN: string = "masterPassword";

const isPublic: (state: StatusPageAccessState) => boolean = (
  state: StatusPageAccessState,
): boolean => {
  return state.isPublicStatusPage !== false;
};

const isMasterPasswordSwitchOn: (state: StatusPageAccessState) => boolean = (
  state: StatusPageAccessState,
): boolean => {
  return state.enableMasterPassword === true;
};

/*
 * Whether visitors have to enter the master password: the page is not
 * public, the switch is on and a password is set. The one rule the server
 * enforces (StatusPageService.hasReadAccess) and tells the status page app
 * (the master-page answer's enableMasterPassword).
 */
export const isStatusPageMasterPasswordRequired: (
  state: StatusPageAccessState,
) => boolean = (state: StatusPageAccessState): boolean => {
  return (
    !isPublic(state) &&
    isMasterPasswordSwitchOn(state) &&
    state.hasMasterPassword
  );
};

// Who can see the page now, by the rule the server enforces.
export const getStatusPageAccess: (
  state: StatusPageAccessState,
) => StatusPageAccess = (state: StatusPageAccessState): StatusPageAccess => {
  if (isPublic(state)) {
    return StatusPageAccess.Anyone;
  }

  if (isStatusPageMasterPasswordRequired(state)) {
    return StatusPageAccess.Password;
  }

  return StatusPageAccess.SignIn;
};

/*
 * The columns to write to move a page to a choice: only those whose stored
 * value differs from what the choice stores. Empty when nothing changes -
 * the page already holds it, or (to Password) only the password is missing.
 */
export const getStatusPageAccessChanges: (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
}) => Partial<StatusPageAccessColumns> = (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
}): Partial<StatusPageAccessColumns> => {
  const target: StatusPageAccessColumns = STATUS_PAGE_ACCESS_COLUMNS[data.to];
  const changes: Partial<StatusPageAccessColumns> = {};

  if (isPublic(data.from) !== target.isPublicStatusPage) {
    changes.isPublicStatusPage = target.isPublicStatusPage;
  }

  if (isMasterPasswordSwitchOn(data.from) !== target.enableMasterPassword) {
    changes.enableMasterPassword = target.enableMasterPassword;
  }

  return changes;
};

// The columns a move to a choice writes (see getStatusPageAccessChanges).
export const getStatusPageAccessColumnsWritten: (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
}) => Array<StatusPageAccessColumn> = (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
}): Array<StatusPageAccessColumn> => {
  const changes: Partial<StatusPageAccessColumns> =
    getStatusPageAccessChanges(data);

  return STATUS_PAGE_ACCESS_COLUMN_NAMES.filter(
    (column: StatusPageAccessColumn): boolean => {
      return changes[column] !== undefined;
    },
  );
};

/*
 * Whether moving to a choice has to ask for a password: Password, on a page
 * with none stored. Without one the server would not ask visitors for it,
 * and the page would be a sign-in page that only looks like it is protected
 * by a password.
 */
export const isStatusPagePasswordNeededFor: (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
}) => boolean = (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
}): boolean => {
  return data.to === StatusPageAccess.Password && !data.from.hasMasterPassword;
};

/*
 * The page as it is once a move is written, password included when one is
 * entered with it: what the server then enforces is getStatusPageAccess of
 * this, which is the choice made.
 */
export const getStatusPageAccessStateAfter: (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
  isPasswordEntered: boolean;
}) => StatusPageAccessState = (data: {
  from: StatusPageAccessState;
  to: StatusPageAccess;
  isPasswordEntered: boolean;
}): StatusPageAccessState => {
  return {
    ...data.from,
    ...getStatusPageAccessChanges({ from: data.from, to: data.to }),
    hasMasterPassword: data.from.hasMasterPassword || data.isPasswordEntered,
  };
};
