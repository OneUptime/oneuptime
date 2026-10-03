/*
 * Who can view a dashboard: one choice of three.
 *
 *   Only people in this project            members sign in to OneUptime;
 *                                          the dashboard has no public link.
 *   Anyone with the link                   the dashboard is public.
 *   Anyone with the link and a password    the dashboard is public, and
 *                                          visitors enter one shared
 *                                          password first.
 *
 * The choice is stored in three columns, which the API and Terraform read
 * and write as they always have: isPublicDashboard (off by default),
 * enableMasterPassword (off by default) and masterPassword (a hash). The
 * public link answers only for a public dashboard, and the server asks
 * public visitors for the password whenever the password switch is on
 * (DashboardService.hasReadAccess). A private dashboard never asks for it,
 * so its switch does nothing. So:
 *
 *   isPublicDashboard off                               -> Project only
 *   on, enableMasterPassword off                        -> Anyone with the link
 *   on, enableMasterPassword on                         -> ... and a password
 *
 * With the switch on and no password set, the server lets nobody in through
 * the public link (it fails closed: someone asked for a password, and there
 * is none to check). That state is the third choice, locked: the Sharing
 * page says so and asks for the password, and it never writes the state
 * itself - a move to the third choice asks for a password in the same
 * dialog when none is set.
 *
 * That rule lives here, once, and everything that has to agree on it reads
 * it from here: the server's read check and its password route, the public
 * dashboard app's "does this dashboard ask for a password?" (the metadata
 * answer), and the Sharing page, which shows the choice and writes it.
 *
 * Writing a choice writes only the columns whose value changes
 * (getDashboardAccessChanges): isPublicDashboard needs the Growth plan to
 * change on OneUptime Cloud, and a write that carries it - changed or not -
 * is refused below Growth, so moving between the two public choices must
 * leave it out.
 */

export enum DashboardAccess {
  ProjectOnly = "ProjectOnly",
  AnyoneWithLink = "AnyoneWithLink",
  AnyoneWithPassword = "AnyoneWithPassword",
}

// The order the choices are offered in, the default first.
export const DASHBOARD_ACCESS_CHOICES: ReadonlyArray<DashboardAccess> = [
  DashboardAccess.ProjectOnly,
  DashboardAccess.AnyoneWithLink,
  DashboardAccess.AnyoneWithPassword,
];

// The two switches that decide whether the public link asks for a password.
export interface DashboardAccessSwitches {
  // Nothing stored reads as the column's default: not public.
  isPublicDashboard?: boolean | null | undefined;
  // Nothing stored reads as the column's default: off.
  enableMasterPassword?: boolean | null | undefined;
}

// What a dashboard holds that decides who can view it.
export interface DashboardAccessState extends DashboardAccessSwitches {
  // Whether a master password is stored (its hash is never shown).
  hasMasterPassword: boolean;
}

// The two switches each choice stores.
export interface DashboardAccessColumns {
  isPublicDashboard: boolean;
  enableMasterPassword: boolean;
}

export const DASHBOARD_ACCESS_COLUMNS: Record<
  DashboardAccess,
  DashboardAccessColumns
> = {
  [DashboardAccess.ProjectOnly]: {
    isPublicDashboard: false,
    /*
     * A private dashboard never asks for the password, so the switch did
     * nothing while it was on. Turning it off means sharing the link again
     * later never brings back a password nobody remembers asking for. The
     * password itself is kept: picking the password again offers to keep it.
     */
    enableMasterPassword: false,
  },
  [DashboardAccess.AnyoneWithLink]: {
    isPublicDashboard: true,
    enableMasterPassword: false,
  },
  [DashboardAccess.AnyoneWithPassword]: {
    isPublicDashboard: true,
    enableMasterPassword: true,
  },
};

// The columns a choice writes, in the order they are written.
export type DashboardAccessColumn = keyof DashboardAccessColumns;

export const DASHBOARD_ACCESS_COLUMN_NAMES: ReadonlyArray<DashboardAccessColumn> =
  ["isPublicDashboard", "enableMasterPassword"];

// The column the password is written to, beside the choice's columns.
export const DASHBOARD_MASTER_PASSWORD_COLUMN: string = "masterPassword";

const isPublic: (state: DashboardAccessSwitches) => boolean = (
  state: DashboardAccessSwitches,
): boolean => {
  return state.isPublicDashboard === true;
};

const isMasterPasswordSwitchOn: (state: DashboardAccessSwitches) => boolean = (
  state: DashboardAccessSwitches,
): boolean => {
  return state.enableMasterPassword === true;
};

/*
 * Whether the public link answers at all: the dashboard is public. (An
 * archived dashboard's link does not answer either, whatever this says: the
 * setting is kept so unarchiving puts the link back as it was.)
 */
export const isDashboardPublic: (state: DashboardAccessSwitches) => boolean = (
  state: DashboardAccessSwitches,
): boolean => {
  return isPublic(state);
};

/*
 * Whether visitors of the public link have to enter the master password:
 * the dashboard is public and the switch is on. The one rule the server
 * enforces (DashboardService.hasReadAccess) and tells the public dashboard
 * app (the metadata answer's enableMasterPassword).
 */
export const isDashboardMasterPasswordRequired: (
  state: DashboardAccessSwitches,
) => boolean = (state: DashboardAccessSwitches): boolean => {
  return isPublic(state) && isMasterPasswordSwitchOn(state);
};

/*
 * Whether the public link lets nobody in: the password is required and none
 * is set. The server fails closed here; the Sharing page asks for one.
 */
export const isDashboardLockedWithoutPassword: (
  state: DashboardAccessState,
) => boolean = (state: DashboardAccessState): boolean => {
  return isDashboardMasterPasswordRequired(state) && !state.hasMasterPassword;
};

// Who can view the dashboard now, by the rule the server enforces.
export const getDashboardAccess: (
  state: DashboardAccessSwitches,
) => DashboardAccess = (state: DashboardAccessSwitches): DashboardAccess => {
  if (!isPublic(state)) {
    return DashboardAccess.ProjectOnly;
  }

  if (isDashboardMasterPasswordRequired(state)) {
    return DashboardAccess.AnyoneWithPassword;
  }

  return DashboardAccess.AnyoneWithLink;
};

/*
 * The columns to write to move a dashboard to a choice: only those whose
 * stored value differs from what the choice stores. Empty when nothing
 * changes - the dashboard already holds it, or (to the password) only the
 * password is missing.
 */
export const getDashboardAccessChanges: (data: {
  from: DashboardAccessSwitches;
  to: DashboardAccess;
}) => Partial<DashboardAccessColumns> = (data: {
  from: DashboardAccessSwitches;
  to: DashboardAccess;
}): Partial<DashboardAccessColumns> => {
  const target: DashboardAccessColumns = DASHBOARD_ACCESS_COLUMNS[data.to];
  const changes: Partial<DashboardAccessColumns> = {};

  if (isPublic(data.from) !== target.isPublicDashboard) {
    changes.isPublicDashboard = target.isPublicDashboard;
  }

  if (isMasterPasswordSwitchOn(data.from) !== target.enableMasterPassword) {
    changes.enableMasterPassword = target.enableMasterPassword;
  }

  return changes;
};

// The columns a move to a choice writes (see getDashboardAccessChanges).
export const getDashboardAccessColumnsWritten: (data: {
  from: DashboardAccessSwitches;
  to: DashboardAccess;
}) => Array<DashboardAccessColumn> = (data: {
  from: DashboardAccessSwitches;
  to: DashboardAccess;
}): Array<DashboardAccessColumn> => {
  const changes: Partial<DashboardAccessColumns> =
    getDashboardAccessChanges(data);

  return DASHBOARD_ACCESS_COLUMN_NAMES.filter(
    (column: DashboardAccessColumn): boolean => {
      return changes[column] !== undefined;
    },
  );
};

/*
 * Whether moving to a choice has to ask for a password: the password choice,
 * on a dashboard with none stored. Without one the server would let nobody
 * in through the public link.
 */
export const isDashboardPasswordNeededFor: (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
}) => boolean = (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
}): boolean => {
  return (
    data.to === DashboardAccess.AnyoneWithPassword && !data.from.hasMasterPassword
  );
};

/*
 * The dashboard as it is once a move is written, password included when one
 * is entered with it: what the server then enforces is getDashboardAccess of
 * this, which is the choice made.
 */
export const getDashboardAccessStateAfter: (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
  isPasswordEntered: boolean;
}) => DashboardAccessState = (data: {
  from: DashboardAccessState;
  to: DashboardAccess;
  isPasswordEntered: boolean;
}): DashboardAccessState => {
  return {
    ...data.from,
    ...getDashboardAccessChanges({ from: data.from, to: data.to }),
    hasMasterPassword: data.from.hasMasterPassword || data.isPasswordEntered,
  };
};
