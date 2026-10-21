/**
 * Who can view a dashboard: one choice of three (only people in this
 * project, anyone with the link, anyone with the link and a password),
 * stored in three columns.
 *
 * The rule here is the one the server enforces (DashboardService.
 * hasReadAccess answers the public link only for a public dashboard, and
 * asks its visitors for the password whenever the switch is on - letting
 * nobody in when no password is set), and the one the public dashboard
 * app and the Sharing page read. These tests pin it for every state the
 * three columns can be in, and pin what a move from any state to any
 * choice writes: only the columns that change, and never a state the
 * server would read as a different choice than the one picked - nor the
 * locked one, once the password the move asks for is entered.
 */

import {
  DASHBOARD_ACCESS_CHOICES,
  DASHBOARD_ACCESS_COLUMN_NAMES,
  DASHBOARD_ACCESS_COLUMNS,
  DASHBOARD_MASTER_PASSWORD_COLUMN,
  DashboardAccess,
  DashboardAccessColumns,
  DashboardAccessState,
  getDashboardAccess,
  getDashboardAccessChanges,
  getDashboardAccessColumnsWritten,
  getDashboardAccessStateAfter,
  isDashboardLockedWithoutPassword,
  isDashboardMasterPasswordRequired,
  isDashboardPasswordNeededFor,
  isDashboardPublic,
} from "../../../Types/Dashboard/DashboardAccess";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import { describe, expect, test } from "@jest/globals";

type Stored = boolean | null | undefined;

// Every state the three columns can be in, nothing stored included.
const STORED_VALUES: Array<Stored> = [true, false, null, undefined];

const ALL_STATES: Array<DashboardAccessState> = STORED_VALUES.flatMap(
  (isPublicDashboard: Stored): Array<DashboardAccessState> => {
    return STORED_VALUES.flatMap(
      (enableMasterPassword: Stored): Array<DashboardAccessState> => {
        return [true, false].map(
          (hasMasterPassword: boolean): DashboardAccessState => {
            return {
              isPublicDashboard,
              enableMasterPassword,
              hasMasterPassword,
            };
          },
        );
      },
    );
  },
);

const describeState: (state: DashboardAccessState) => string = (
  state: DashboardAccessState,
): string => {
  return `public=${String(state.isPublicDashboard)} switch=${String(
    state.enableMasterPassword,
  )} password=${String(state.hasMasterPassword)}`;
};

describe("who can view a dashboard, read off its columns", () => {
  test("the three choices, in the order they are offered: the default first", () => {
    expect(DASHBOARD_ACCESS_CHOICES).toEqual([
      DashboardAccess.ProjectOnly,
      DashboardAccess.AnyoneWithLink,
      DashboardAccess.AnyoneWithPassword,
    ]);
  });

  test("a dashboard that is not public is for the project only, whatever the password switch says", () => {
    for (const isPublicDashboard of [false, null, undefined]) {
      for (const enableMasterPassword of STORED_VALUES) {
        for (const hasMasterPassword of [true, false]) {
          const state: DashboardAccessState = {
            isPublicDashboard,
            enableMasterPassword,
            hasMasterPassword,
          };

          expect([describeState(state), getDashboardAccess(state)]).toEqual([
            describeState(state),
            DashboardAccess.ProjectOnly,
          ]);
          expect(isDashboardPublic(state)).toBe(false);
          // A private dashboard never asks for the password...
          expect(isDashboardMasterPasswordRequired(state)).toBe(false);
          // ...so it is never locked by a missing one either.
          expect(isDashboardLockedWithoutPassword(state)).toBe(false);
        }
      }
    }
  });

  test("nothing stored reads as the columns' defaults, which the model declares: not public, switch off", () => {
    const model: Dashboard = new Dashboard();

    expect(model.getTableColumnMetadata("isPublicDashboard").defaultValue).toBe(
      false,
    );
    expect(
      model.getTableColumnMetadata("enableMasterPassword").defaultValue,
    ).toBe(false);

    const nothingStored: DashboardAccessState = {
      isPublicDashboard: undefined,
      enableMasterPassword: undefined,
      hasMasterPassword: false,
    };

    expect(getDashboardAccess(nothingStored)).toBe(DashboardAccess.ProjectOnly);

    const publicWithNoSwitch: DashboardAccessState = {
      isPublicDashboard: true,
      enableMasterPassword: null,
      hasMasterPassword: true,
    };

    expect(getDashboardAccess(publicWithNoSwitch)).toBe(
      DashboardAccess.AnyoneWithLink,
    );
  });

  test("a public dashboard with the switch off is open to anyone with the link, a stored password or not", () => {
    for (const enableMasterPassword of [false, null, undefined]) {
      for (const hasMasterPassword of [true, false]) {
        const state: DashboardAccessState = {
          isPublicDashboard: true,
          enableMasterPassword,
          hasMasterPassword,
        };

        expect(getDashboardAccess(state)).toBe(DashboardAccess.AnyoneWithLink);
        expect(isDashboardMasterPasswordRequired(state)).toBe(false);
        expect(isDashboardLockedWithoutPassword(state)).toBe(false);
      }
    }
  });

  test("a public dashboard with the switch on asks for the password", () => {
    const state: DashboardAccessState = {
      isPublicDashboard: true,
      enableMasterPassword: true,
      hasMasterPassword: true,
    };

    expect(getDashboardAccess(state)).toBe(DashboardAccess.AnyoneWithPassword);
    expect(isDashboardPublic(state)).toBe(true);
    expect(isDashboardMasterPasswordRequired(state)).toBe(true);
    expect(isDashboardLockedWithoutPassword(state)).toBe(false);
  });

  test("with the switch on and no password set, it is still the password choice - locked, as the server lets nobody in", () => {
    const state: DashboardAccessState = {
      isPublicDashboard: true,
      enableMasterPassword: true,
      hasMasterPassword: false,
    };

    expect(getDashboardAccess(state)).toBe(DashboardAccess.AnyoneWithPassword);
    expect(isDashboardMasterPasswordRequired(state)).toBe(true);
    expect(isDashboardLockedWithoutPassword(state)).toBe(true);
  });

  test("the password is required exactly when the dashboard is public and the switch is on", () => {
    for (const state of ALL_STATES) {
      expect([
        describeState(state),
        isDashboardMasterPasswordRequired(state),
      ]).toEqual([
        describeState(state),
        state.isPublicDashboard === true && state.enableMasterPassword === true,
      ]);
    }
  });

  test("the switches alone decide the password requirement (the public app knows nothing of the hash)", () => {
    expect(
      isDashboardMasterPasswordRequired({
        isPublicDashboard: true,
        enableMasterPassword: true,
      }),
    ).toBe(true);
    expect(
      isDashboardMasterPasswordRequired({
        isPublicDashboard: false,
        enableMasterPassword: true,
      }),
    ).toBe(false);
  });
});

describe("what each choice stores", () => {
  test("only the project: not public, and the password switch off", () => {
    expect(DASHBOARD_ACCESS_COLUMNS[DashboardAccess.ProjectOnly]).toEqual({
      isPublicDashboard: false,
      enableMasterPassword: false,
    });
  });

  test("anyone with the link: public, the switch off", () => {
    expect(DASHBOARD_ACCESS_COLUMNS[DashboardAccess.AnyoneWithLink]).toEqual({
      isPublicDashboard: true,
      enableMasterPassword: false,
    });
  });

  test("anyone with the link and a password: public, the switch on", () => {
    expect(
      DASHBOARD_ACCESS_COLUMNS[DashboardAccess.AnyoneWithPassword],
    ).toEqual({
      isPublicDashboard: true,
      enableMasterPassword: true,
    });
  });

  test("each choice's columns read back as that choice", () => {
    for (const access of DASHBOARD_ACCESS_CHOICES) {
      for (const hasMasterPassword of [true, false]) {
        const state: DashboardAccessState = {
          ...DASHBOARD_ACCESS_COLUMNS[access],
          hasMasterPassword,
        };

        expect(getDashboardAccess(state)).toBe(access);
      }
    }
  });

  test("the columns a choice writes, and the password's, are the model's own", () => {
    const model: Dashboard = new Dashboard();

    expect(DASHBOARD_ACCESS_COLUMN_NAMES).toEqual([
      "isPublicDashboard",
      "enableMasterPassword",
    ]);
    expect(DASHBOARD_MASTER_PASSWORD_COLUMN).toBe("masterPassword");

    for (const column of [
      ...DASHBOARD_ACCESS_COLUMN_NAMES,
      DASHBOARD_MASTER_PASSWORD_COLUMN,
    ]) {
      expect([
        column,
        model.getTableColumnMetadata(column) !== undefined,
      ]).toEqual([column, true]);
    }
  });
});

describe("a move writes only the columns that change", () => {
  test.each(
    DASHBOARD_ACCESS_CHOICES.map(
      (access: DashboardAccess): [DashboardAccess] => {
        return [access];
      },
    ),
  )("to %s, from every state", (to: DashboardAccess) => {
    for (const from of ALL_STATES) {
      const changes: Partial<DashboardAccessColumns> =
        getDashboardAccessChanges({ from, to });
      const target: DashboardAccessColumns = DASHBOARD_ACCESS_COLUMNS[to];

      // Each written column holds what the choice stores...
      for (const column of DASHBOARD_ACCESS_COLUMN_NAMES) {
        if (changes[column] !== undefined) {
          expect([describeState(from), column, changes[column]]).toEqual([
            describeState(from),
            column,
            target[column],
          ]);
        }
      }

      // ...and a column is written exactly when its stored value differs.
      const storedPublic: boolean = from.isPublicDashboard === true;
      const storedSwitch: boolean = from.enableMasterPassword === true;

      expect([
        describeState(from),
        changes.isPublicDashboard !== undefined,
      ]).toEqual([
        describeState(from),
        storedPublic !== target.isPublicDashboard,
      ]);
      expect([
        describeState(from),
        changes.enableMasterPassword !== undefined,
      ]).toEqual([
        describeState(from),
        storedSwitch !== target.enableMasterPassword,
      ]);

      expect(getDashboardAccessColumnsWritten({ from, to })).toEqual(
        DASHBOARD_ACCESS_COLUMN_NAMES.filter(
          (column: keyof DashboardAccessColumns): boolean => {
            return changes[column] !== undefined;
          },
        ),
      );
    }
  });

  test("moving between the two public choices never carries the public switch (Growth-gated)", () => {
    for (const from of ALL_STATES.filter((state: DashboardAccessState) => {
      return state.isPublicDashboard === true;
    })) {
      for (const to of [
        DashboardAccess.AnyoneWithLink,
        DashboardAccess.AnyoneWithPassword,
      ]) {
        expect(
          getDashboardAccessChanges({ from, to }).isPublicDashboard,
        ).toBeUndefined();
      }
    }
  });

  test("making a dashboard private also turns the password switch off, so sharing again never brings back a forgotten password", () => {
    const from: DashboardAccessState = {
      isPublicDashboard: true,
      enableMasterPassword: true,
      hasMasterPassword: true,
    };

    expect(
      getDashboardAccessChanges({ from, to: DashboardAccess.ProjectOnly }),
    ).toEqual({ isPublicDashboard: false, enableMasterPassword: false });
  });

  test("sharing a private dashboard whose switch was left on writes the public switch and turns the password off", () => {
    const from: DashboardAccessState = {
      isPublicDashboard: false,
      enableMasterPassword: true,
      hasMasterPassword: true,
    };

    expect(
      getDashboardAccessChanges({ from, to: DashboardAccess.AnyoneWithLink }),
    ).toEqual({ isPublicDashboard: true, enableMasterPassword: false });
  });

  test("a move to the choice already held never writes the public switch, and changes nothing the server reads", () => {
    for (const from of ALL_STATES) {
      const held: DashboardAccess = getDashboardAccess(from);
      const changes: Partial<DashboardAccessColumns> =
        getDashboardAccessChanges({ from, to: held });

      expect([describeState(from), changes.isPublicDashboard]).toEqual([
        describeState(from),
        undefined,
      ]);

      /*
       * Only a private dashboard's leftover password switch would be tidied
       * away, which nothing reads (the Sharing page never offers the choice
       * already held anyway).
       */
      if (changes.enableMasterPassword !== undefined) {
        expect([describeState(from), held, changes]).toEqual([
          describeState(from),
          DashboardAccess.ProjectOnly,
          { enableMasterPassword: false },
        ]);
      }
    }
  });
});

// Each state, named, for test.each.
const STATE_CASES: Array<[string, DashboardAccessState]> = ALL_STATES.map(
  (state: DashboardAccessState): [string, DashboardAccessState] => {
    return [describeState(state), state];
  },
);

describe("a move to the password asks for one exactly when none is stored", () => {
  test.each(STATE_CASES)(
    "from %s",
    (_label: string, from: DashboardAccessState) => {
      for (const to of DASHBOARD_ACCESS_CHOICES) {
        expect([to, isDashboardPasswordNeededFor({ from, to })]).toEqual([
          to,
          to === DashboardAccess.AnyoneWithPassword && !from.hasMasterPassword,
        ]);
      }
    },
  );
});

describe("the dashboard after a move reads as the choice made, and is never locked", () => {
  test.each(STATE_CASES)(
    "from %s",
    (_label: string, from: DashboardAccessState) => {
      for (const to of DASHBOARD_ACCESS_CHOICES) {
        /*
         * The Sharing page enters a password with the move whenever the
         * move asks for one (and may enter one to replace the stored one).
         */
        for (const isPasswordEntered of isDashboardPasswordNeededFor({
          from,
          to,
        })
          ? [true]
          : [true, false]) {
          const after: DashboardAccessState = getDashboardAccessStateAfter({
            from,
            to,
            isPasswordEntered,
          });

          expect([to, isPasswordEntered, getDashboardAccess(after)]).toEqual([
            to,
            isPasswordEntered,
            to,
          ]);
          expect([
            to,
            isPasswordEntered,
            isDashboardLockedWithoutPassword(after),
          ]).toEqual([to, isPasswordEntered, false]);
          expect(after.hasMasterPassword).toBe(
            from.hasMasterPassword || isPasswordEntered,
          );
        }
      }
    },
  );

  test("the locked state only comes from what was stored before: a move to the password without one would leave it locked", () => {
    const after: DashboardAccessState = getDashboardAccessStateAfter({
      from: {
        isPublicDashboard: true,
        enableMasterPassword: false,
        hasMasterPassword: false,
      },
      to: DashboardAccess.AnyoneWithPassword,
      isPasswordEntered: false,
    });

    // Which is why the move asks for a password, and the dialog requires it.
    expect(isDashboardLockedWithoutPassword(after)).toBe(true);
    expect(
      isDashboardPasswordNeededFor({
        from: {
          isPublicDashboard: true,
          enableMasterPassword: false,
          hasMasterPassword: false,
        },
        to: DashboardAccess.AnyoneWithPassword,
      }),
    ).toBe(true);
  });
});
