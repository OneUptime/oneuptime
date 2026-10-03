/**
 * Who can see a status page: one choice of three (anyone with the link, only
 * people who sign in, anyone with the password), stored in three columns.
 *
 * The rule here is the one the server enforces (StatusPageService.
 * hasReadAccess asks for the password only on a page that is not public,
 * with the switch on and a password set), and the one the status page app
 * and the dashboard's Access page read. These tests pin it for every state
 * the three columns can be in, and pin what a move from any state to any
 * choice writes: only the columns that change, and never a state the
 * server would read as a different choice than the one picked.
 */

import {
  getStatusPageAccess,
  getStatusPageAccessChanges,
  getStatusPageAccessColumnsWritten,
  getStatusPageAccessStateAfter,
  isStatusPageMasterPasswordRequired,
  isStatusPagePasswordNeededFor,
  STATUS_PAGE_ACCESS_CHOICES,
  STATUS_PAGE_ACCESS_COLUMN_NAMES,
  STATUS_PAGE_ACCESS_COLUMNS,
  STATUS_PAGE_MASTER_PASSWORD_COLUMN,
  StatusPageAccess,
  StatusPageAccessColumns,
  StatusPageAccessState,
} from "../../../Types/StatusPage/StatusPageAccess";
import { describe, expect, test } from "@jest/globals";

type Stored = boolean | null | undefined;

// Every state the three columns can be in, nothing stored included.
const STORED_VALUES: Array<Stored> = [true, false, null, undefined];

const ALL_STATES: Array<StatusPageAccessState> = STORED_VALUES.flatMap(
  (isPublicStatusPage: Stored): Array<StatusPageAccessState> => {
    return STORED_VALUES.flatMap(
      (enableMasterPassword: Stored): Array<StatusPageAccessState> => {
        return [true, false].map(
          (hasMasterPassword: boolean): StatusPageAccessState => {
            return {
              isPublicStatusPage,
              enableMasterPassword,
              hasMasterPassword,
            };
          },
        );
      },
    );
  },
);

const describeState: (state: StatusPageAccessState) => string = (
  state: StatusPageAccessState,
): string => {
  return `public=${String(state.isPublicStatusPage)} switch=${String(
    state.enableMasterPassword,
  )} password=${String(state.hasMasterPassword)}`;
};

describe("who can see a status page, read off its columns", () => {
  test("the three choices, in the order they are offered", () => {
    expect(STATUS_PAGE_ACCESS_CHOICES).toEqual([
      StatusPageAccess.Anyone,
      StatusPageAccess.SignIn,
      StatusPageAccess.Password,
    ]);
  });

  test("a public page is open to anyone, whatever the password switch says", () => {
    for (const enableMasterPassword of STORED_VALUES) {
      for (const hasMasterPassword of [true, false]) {
        expect(
          getStatusPageAccess({
            isPublicStatusPage: true,
            enableMasterPassword,
            hasMasterPassword,
          }),
        ).toBe(StatusPageAccess.Anyone);
      }
    }
  });

  test("nothing stored reads as the column's default: public", () => {
    for (const isPublicStatusPage of [null, undefined]) {
      expect(
        getStatusPageAccess({
          isPublicStatusPage,
          enableMasterPassword: true,
          hasMasterPassword: true,
        }),
      ).toBe(StatusPageAccess.Anyone);
    }
  });

  test("a private page with the switch on and a password set asks for the password", () => {
    expect(
      getStatusPageAccess({
        isPublicStatusPage: false,
        enableMasterPassword: true,
        hasMasterPassword: true,
      }),
    ).toBe(StatusPageAccess.Password);
  });

  test("a private page without a usable password is a sign-in page", () => {
    // The switch on with no password set: the server asks for none.
    expect(
      getStatusPageAccess({
        isPublicStatusPage: false,
        enableMasterPassword: true,
        hasMasterPassword: false,
      }),
    ).toBe(StatusPageAccess.SignIn);

    // A password set but the switch off, or never stored.
    for (const enableMasterPassword of [false, null, undefined]) {
      for (const hasMasterPassword of [true, false]) {
        expect(
          getStatusPageAccess({
            isPublicStatusPage: false,
            enableMasterPassword,
            hasMasterPassword,
          }),
        ).toBe(StatusPageAccess.SignIn);
      }
    }
  });

  test.each(ALL_STATES.map((state: StatusPageAccessState) => {
    return [describeState(state), state];
  }))(
    "%s: the password is asked for exactly when the choice is the password",
    (_label: string, state: StatusPageAccessState) => {
      expect(isStatusPageMasterPasswordRequired(state)).toBe(
        getStatusPageAccess(state) === StatusPageAccess.Password,
      );
    },
  );

  test("the password is required only for not public, switch on, password set", () => {
    const required: Array<string> = ALL_STATES.filter(
      (state: StatusPageAccessState): boolean => {
        return isStatusPageMasterPasswordRequired(state);
      },
    ).map(describeState);

    expect(required).toEqual(["public=false switch=true password=true"]);
  });
});

describe("what each choice stores", () => {
  test("anyone: public, and the password switch off", () => {
    expect(STATUS_PAGE_ACCESS_COLUMNS[StatusPageAccess.Anyone]).toEqual({
      isPublicStatusPage: true,
      enableMasterPassword: false,
    });
  });

  test("sign in: private, and the password switch off", () => {
    expect(STATUS_PAGE_ACCESS_COLUMNS[StatusPageAccess.SignIn]).toEqual({
      isPublicStatusPage: false,
      enableMasterPassword: false,
    });
  });

  test("password: private, and the password switch on", () => {
    expect(STATUS_PAGE_ACCESS_COLUMNS[StatusPageAccess.Password]).toEqual({
      isPublicStatusPage: false,
      enableMasterPassword: true,
    });
  });

  test("the columns a choice writes, and the password's column", () => {
    expect(STATUS_PAGE_ACCESS_COLUMN_NAMES).toEqual([
      "isPublicStatusPage",
      "enableMasterPassword",
    ]);
    expect(STATUS_PAGE_MASTER_PASSWORD_COLUMN).toBe("masterPassword");
  });
});

describe("moving a page to a choice", () => {
  test("from a new page (nothing stored but the defaults)", () => {
    const newPage: StatusPageAccessState = {
      isPublicStatusPage: true,
      enableMasterPassword: false,
      hasMasterPassword: false,
    };

    expect(
      getStatusPageAccessChanges({
        from: newPage,
        to: StatusPageAccess.Anyone,
      }),
    ).toEqual({});
    expect(
      getStatusPageAccessChanges({
        from: newPage,
        to: StatusPageAccess.SignIn,
      }),
    ).toEqual({ isPublicStatusPage: false });
    expect(
      getStatusPageAccessChanges({
        from: newPage,
        to: StatusPageAccess.Password,
      }),
    ).toEqual({ isPublicStatusPage: false, enableMasterPassword: true });
  });

  test("between the two private choices the public switch is never written", () => {
    const signIn: StatusPageAccessState = {
      isPublicStatusPage: false,
      enableMasterPassword: false,
      hasMasterPassword: true,
    };
    const password: StatusPageAccessState = {
      isPublicStatusPage: false,
      enableMasterPassword: true,
      hasMasterPassword: true,
    };

    expect(
      getStatusPageAccessChanges({
        from: signIn,
        to: StatusPageAccess.Password,
      }),
    ).toEqual({ enableMasterPassword: true });
    expect(
      getStatusPageAccessChanges({
        from: password,
        to: StatusPageAccess.SignIn,
      }),
    ).toEqual({ enableMasterPassword: false });
  });

  test("making a page public turns off a password switch it never used", () => {
    expect(
      getStatusPageAccessChanges({
        from: {
          isPublicStatusPage: false,
          enableMasterPassword: true,
          hasMasterPassword: true,
        },
        to: StatusPageAccess.Anyone,
      }),
    ).toEqual({ isPublicStatusPage: true, enableMasterPassword: false });
  });

  test("a public page with a stale switch moved to sign-in clears both", () => {
    expect(
      getStatusPageAccessChanges({
        from: {
          isPublicStatusPage: true,
          enableMasterPassword: true,
          hasMasterPassword: false,
        },
        to: StatusPageAccess.SignIn,
      }),
    ).toEqual({ isPublicStatusPage: false, enableMasterPassword: false });
  });

  test("a sign-in page whose switch was left on needs only the password to become a password page", () => {
    const stale: StatusPageAccessState = {
      isPublicStatusPage: false,
      enableMasterPassword: true,
      hasMasterPassword: false,
    };

    expect(getStatusPageAccess(stale)).toBe(StatusPageAccess.SignIn);
    expect(
      getStatusPageAccessChanges({ from: stale, to: StatusPageAccess.Password }),
    ).toEqual({});
    expect(
      isStatusPagePasswordNeededFor({
        from: stale,
        to: StatusPageAccess.Password,
      }),
    ).toBe(true);
  });

  test("a password is needed only to move to the password, and only when none is set", () => {
    for (const state of ALL_STATES) {
      for (const to of STATUS_PAGE_ACCESS_CHOICES) {
        expect([
          describeState(state),
          to,
          isStatusPagePasswordNeededFor({ from: state, to }),
        ]).toEqual([
          describeState(state),
          to,
          to === StatusPageAccess.Password && !state.hasMasterPassword,
        ]);
      }
    }
  });

  describe.each(ALL_STATES.map((state: StatusPageAccessState) => {
    return [describeState(state), state];
  }))("from %s", (_label: string, from: StatusPageAccessState) => {
    test.each(STATUS_PAGE_ACCESS_CHOICES)(
      "to %s: writes only what changes, and the server then enforces the choice made",
      (to: StatusPageAccess) => {
        const changes: Partial<StatusPageAccessColumns> =
          getStatusPageAccessChanges({ from, to });
        const target: StatusPageAccessColumns = STATUS_PAGE_ACCESS_COLUMNS[to];

        // Every written column takes the choice's value...
        for (const [column, value] of Object.entries(changes)) {
          expect([column, value]).toEqual([
            column,
            target[column as keyof StatusPageAccessColumns],
          ]);
        }

        // ...and a column already holding it is left out.
        const isPublicNow: boolean = from.isPublicStatusPage !== false;
        const isSwitchOnNow: boolean = from.enableMasterPassword === true;

        expect("isPublicStatusPage" in changes).toBe(
          isPublicNow !== target.isPublicStatusPage,
        );
        expect("enableMasterPassword" in changes).toBe(
          isSwitchOnNow !== target.enableMasterPassword,
        );

        expect(getStatusPageAccessColumnsWritten({ from, to })).toEqual(
          STATUS_PAGE_ACCESS_COLUMN_NAMES.filter((column: string) => {
            return column in changes;
          }),
        );

        /*
         * Written - with a password entered when one is needed - the page
         * is what was picked: the choice is never left in a state the
         * server reads as another.
         */
        const after: StatusPageAccessState = getStatusPageAccessStateAfter({
          from,
          to,
          isPasswordEntered: isStatusPagePasswordNeededFor({ from, to }),
        });

        expect(getStatusPageAccess(after)).toBe(to);
      },
    );
  });

  test("without the password it needs, a move to the password would be a sign-in page", () => {
    const after: StatusPageAccessState = getStatusPageAccessStateAfter({
      from: {
        isPublicStatusPage: true,
        enableMasterPassword: false,
        hasMasterPassword: false,
      },
      to: StatusPageAccess.Password,
      isPasswordEntered: false,
    });

    // Which is why the dashboard asks for one before it writes anything.
    expect(getStatusPageAccess(after)).toBe(StatusPageAccess.SignIn);
  });

  test("a password entered with any move is remembered as set", () => {
    const after: StatusPageAccessState = getStatusPageAccessStateAfter({
      from: {
        isPublicStatusPage: false,
        enableMasterPassword: true,
        hasMasterPassword: true,
      },
      to: StatusPageAccess.Password,
      isPasswordEntered: true,
    });

    expect(after).toEqual({
      isPublicStatusPage: false,
      enableMasterPassword: true,
      hasMasterPassword: true,
    });
  });
});
