import Dashboard from "../../../../Models/DatabaseModels/Dashboard";
import PublicDashboardAccessPolicy, {
  PUBLIC_DASHBOARD_ACCESS_SELECT,
  PUBLIC_DASHBOARD_ADDRESS_UNKNOWN_MESSAGE,
  PUBLIC_DASHBOARD_NOT_AVAILABLE_MESSAGE,
  PublicDashboardAccess,
  PublicDashboardAccessResult,
  PublicDashboardVisitor,
  UNKNOWN_PUBLIC_DASHBOARD_VISITOR,
  getPublicDashboardAddressBlockedMessage,
} from "../../../../Server/Utils/Dashboard/PublicDashboardAccess";
import {
  DASHBOARD_ACCESS_CHOICES,
  DASHBOARD_ACCESS_COLUMNS,
  DashboardAccess,
  DashboardAccessState,
  getDashboardAccess,
  isDashboardMasterPasswordRequired,
} from "../../../../Types/Dashboard/DashboardAccess";
import { DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE } from "../../../../Types/Dashboard/MasterPassword";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import MasterPasswordRequiredException from "../../../../Types/Exception/MasterPasswordRequiredException";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import HashedString from "../../../../Types/HashedString";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, it, test } from "@jest/globals";

/*
 * What a dashboard's public link answers one visitor, decided before any
 * route reads what it sends. Every public dashboard route runs this one
 * decision (the read check, the metadata, the page head, the password
 * route), so it is pinned here on its own, for every state a dashboard can
 * be stored in and every visitor:
 *
 *   no such dashboard, archived, or only people in the project  NotFound
 *   the IP allowlist does not name the visitor's address          Forbidden
 *   a password the visitor has not entered (or, locked, none set) PasswordRequired
 *   otherwise                                                     Granted
 */

const ALLOWED_IP: string = "203.0.113.7";
const OTHER_IP: string = "198.51.100.5";
const ALLOWLIST: string = `10.0.0.0/8\n${ALLOWED_IP}`;

const ANONYMOUS: PublicDashboardVisitor = {
  clientIp: ALLOWED_IP,
  hasUnlockCookie: false,
};

const UNLOCKED: PublicDashboardVisitor = {
  clientIp: ALLOWED_IP,
  hasUnlockCookie: true,
};

type StoredDashboardOptions = DashboardAccessState & {
  isArchived?: boolean | undefined;
  ipWhitelist?: string | undefined;
};

const storedDashboard: (options: StoredDashboardOptions) => Dashboard = (
  options: StoredDashboardOptions,
): Dashboard => {
  const dashboard: Dashboard = new Dashboard();
  dashboard.id = ObjectID.generate();
  dashboard.isPublicDashboard = options.isPublicDashboard === true;
  dashboard.enableMasterPassword = options.enableMasterPassword === true;
  dashboard.isArchived = options.isArchived === true;

  if (options.hasMasterPassword) {
    dashboard.masterPassword = new HashedString("stored-hash", true);
  }

  if (options.ipWhitelist !== undefined) {
    dashboard.ipWhitelist = options.ipWhitelist;
  }

  return dashboard;
};

const decide: (
  dashboard: Dashboard | null,
  visitor: PublicDashboardVisitor,
) => PublicDashboardAccessResult = (
  dashboard: Dashboard | null,
  visitor: PublicDashboardVisitor,
): PublicDashboardAccessResult => {
  return PublicDashboardAccessPolicy.decide({ dashboard, visitor });
};

// Every state the three columns can hold, labelled for the test names.
const STORED_STATES: Array<[string, DashboardAccessState]> = [];

for (const isPublicDashboard of [false, true]) {
  for (const enableMasterPassword of [false, true]) {
    for (const hasMasterPassword of [false, true]) {
      STORED_STATES.push([
        `public ${isPublicDashboard}, switch ${enableMasterPassword}, password ${hasMasterPassword}`,
        { isPublicDashboard, enableMasterPassword, hasMasterPassword },
      ]);
    }
  }
}

describe("the link answers nobody (NotFound) for a dashboard it does not serve", () => {
  it("no such dashboard", () => {
    const result: PublicDashboardAccessResult = decide(null, UNLOCKED);

    expect(result.access).toBe(PublicDashboardAccess.NotFound);
    expect(result.isMasterPasswordRequired).toBe(false);
    expect(result.error).toBeInstanceOf(NotAuthenticatedException);
    expect(result.error?.message).toBe(PUBLIC_DASHBOARD_NOT_AVAILABLE_MESSAGE);
  });

  test.each(
    STORED_STATES.filter(([, state]: [string, DashboardAccessState]) => {
      return !state.isPublicDashboard;
    }),
  )(
    "a dashboard only its project sees (%s), whoever asks",
    (_label: string, state: DashboardAccessState) => {
      for (const visitor of [
        ANONYMOUS,
        UNLOCKED,
        UNKNOWN_PUBLIC_DASHBOARD_VISITOR,
      ]) {
        expect(decide(storedDashboard(state), visitor)).toEqual(
          decide(null, visitor),
        );
      }
    },
  );

  test.each(STORED_STATES)(
    "an archived dashboard (%s), whatever its sharing setting",
    (_label: string, state: DashboardAccessState) => {
      for (const visitor of [ANONYMOUS, UNLOCKED]) {
        expect(
          decide(storedDashboard({ ...state, isArchived: true }), visitor),
        ).toEqual(decide(null, visitor));
      }
    },
  );

  it("before the IP allowlist is ever asked: a private dashboard with an allowlist is not Forbidden", () => {
    const result: PublicDashboardAccessResult = decide(
      storedDashboard({
        isPublicDashboard: false,
        enableMasterPassword: false,
        hasMasterPassword: false,
        ipWhitelist: ALLOWLIST,
      }),
      { clientIp: OTHER_IP, hasUnlockCookie: false },
    );

    expect(result.access).toBe(PublicDashboardAccess.NotFound);
  });
});

describe("for every Sharing choice, the link answers what the choice says", () => {
  test.each(
    DASHBOARD_ACCESS_CHOICES.map(
      (access: DashboardAccess): [DashboardAccess] => {
        return [access];
      },
    ),
  )("%s", (choice: DashboardAccess) => {
    const state: DashboardAccessState = {
      ...DASHBOARD_ACCESS_COLUMNS[choice],
      hasMasterPassword: true,
    };

    expect(getDashboardAccess(state)).toBe(choice);

    const anonymous: PublicDashboardAccessResult = decide(
      storedDashboard(state),
      ANONYMOUS,
    );
    const unlocked: PublicDashboardAccessResult = decide(
      storedDashboard(state),
      UNLOCKED,
    );

    if (choice === DashboardAccess.ProjectOnly) {
      expect(anonymous.access).toBe(PublicDashboardAccess.NotFound);
      expect(unlocked.access).toBe(PublicDashboardAccess.NotFound);
      return;
    }

    if (choice === DashboardAccess.AnyoneWithLink) {
      expect(anonymous).toEqual({
        access: PublicDashboardAccess.Granted,
        isMasterPasswordRequired: false,
      });
      expect(unlocked).toEqual(anonymous);
      return;
    }

    expect(anonymous.access).toBe(PublicDashboardAccess.PasswordRequired);
    expect(anonymous.isMasterPasswordRequired).toBe(true);
    expect(anonymous.error).toBeInstanceOf(MasterPasswordRequiredException);
    expect(anonymous.error?.message).toBe(
      DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
    );

    // The password lets the visitor in, and the link still asks for it.
    expect(unlocked).toEqual({
      access: PublicDashboardAccess.Granted,
      isMasterPasswordRequired: true,
    });
  });

  test.each(STORED_STATES)(
    "isMasterPasswordRequired follows the Sharing rule (%s)",
    (_label: string, state: DashboardAccessState) => {
      const result: PublicDashboardAccessResult = decide(
        storedDashboard(state),
        UNLOCKED,
      );

      expect(result.isMasterPasswordRequired).toBe(
        isDashboardMasterPasswordRequired(state),
      );
    },
  );
});

describe("a locked dashboard (the switch on, no password) fails closed", () => {
  const locked: Dashboard = storedDashboard({
    isPublicDashboard: true,
    enableMasterPassword: true,
    hasMasterPassword: false,
  });

  it.each([
    ["a visitor with nothing", ANONYMOUS],
    ["a visitor holding an unlock cookie", UNLOCKED],
    ["a visitor nothing is known about", UNKNOWN_PUBLIC_DASHBOARD_VISITOR],
  ])(
    "asks %s for a password nobody can enter",
    (_label: string, visitor: PublicDashboardVisitor) => {
      const result: PublicDashboardAccessResult = decide(locked, visitor);

      expect(result.access).toBe(PublicDashboardAccess.PasswordRequired);
      expect(result.isMasterPasswordRequired).toBe(true);
      expect(result.error).toBeInstanceOf(MasterPasswordRequiredException);
    },
  );
});

describe("the IP allowlist", () => {
  const open: Dashboard = storedDashboard({
    isPublicDashboard: true,
    enableMasterPassword: false,
    hasMasterPassword: false,
    ipWhitelist: ALLOWLIST,
  });

  const protectedDashboard: Dashboard = storedDashboard({
    isPublicDashboard: true,
    enableMasterPassword: true,
    hasMasterPassword: true,
    ipWhitelist: ALLOWLIST,
  });

  it("lets in an address it names, or one inside a range it names", () => {
    expect(decide(open, ANONYMOUS).access).toBe(PublicDashboardAccess.Granted);
    expect(
      decide(open, { clientIp: "10.20.30.40", hasUnlockCookie: false }).access,
    ).toBe(PublicDashboardAccess.Granted);
  });

  it("refuses any other address, naming it", () => {
    const result: PublicDashboardAccessResult = decide(open, {
      clientIp: OTHER_IP,
      hasUnlockCookie: false,
    });

    expect(result.access).toBe(PublicDashboardAccess.Forbidden);
    expect(result.error).toBeInstanceOf(ForbiddenException);
    expect(result.error?.message).toBe(
      getPublicDashboardAddressBlockedMessage(OTHER_IP),
    );
    expect(result.error?.message).toBe(
      `Your IP address ${OTHER_IP} is blocked from accessing this dashboard.`,
    );
  });

  it("refuses a visitor whose address is not known", () => {
    const result: PublicDashboardAccessResult = decide(
      open,
      UNKNOWN_PUBLIC_DASHBOARD_VISITOR,
    );

    expect(result.access).toBe(PublicDashboardAccess.Forbidden);
    expect(result.error?.message).toBe(
      PUBLIC_DASHBOARD_ADDRESS_UNKNOWN_MESSAGE,
    );
  });

  it("is asked before the password: an address it refuses is never asked for the password, unlock cookie or not", () => {
    for (const hasUnlockCookie of [false, true]) {
      const result: PublicDashboardAccessResult = decide(protectedDashboard, {
        clientIp: OTHER_IP,
        hasUnlockCookie,
      });

      expect(result.access).toBe(PublicDashboardAccess.Forbidden);
      // Still the Sharing rule's answer to "does the link ask for one?".
      expect(result.isMasterPasswordRequired).toBe(true);
    }
  });

  it("still asks an address it names for the password", () => {
    expect(decide(protectedDashboard, ANONYMOUS).access).toBe(
      PublicDashboardAccess.PasswordRequired,
    );
    expect(decide(protectedDashboard, UNLOCKED).access).toBe(
      PublicDashboardAccess.Granted,
    );
  });

  it("an empty allowlist lets every address in", () => {
    const dashboard: Dashboard = storedDashboard({
      isPublicDashboard: true,
      enableMasterPassword: false,
      hasMasterPassword: false,
      ipWhitelist: "",
    });

    expect(decide(dashboard, UNKNOWN_PUBLIC_DASHBOARD_VISITOR).access).toBe(
      PublicDashboardAccess.Granted,
    );
  });
});

describe("what every visitor sees: a visitor nothing is known about", () => {
  it("knows no address and holds no unlock cookie", () => {
    expect(UNKNOWN_PUBLIC_DASHBOARD_VISITOR).toEqual({
      clientIp: undefined,
      hasUnlockCookie: false,
    });
  });

  it.each([
    [
      "anyone with the link",
      { isPublicDashboard: true, enableMasterPassword: false },
      undefined,
      PublicDashboardAccess.Granted,
    ],
    [
      "anyone with the link and a password",
      { isPublicDashboard: true, enableMasterPassword: true },
      undefined,
      PublicDashboardAccess.PasswordRequired,
    ],
    [
      "anyone with the link, from some addresses",
      { isPublicDashboard: true, enableMasterPassword: false },
      ALLOWLIST,
      PublicDashboardAccess.Forbidden,
    ],
    [
      "only people in this project",
      { isPublicDashboard: false, enableMasterPassword: false },
      undefined,
      PublicDashboardAccess.NotFound,
    ],
  ])(
    "%s",
    (
      _label: string,
      switches: { isPublicDashboard: boolean; enableMasterPassword: boolean },
      ipWhitelist: string | undefined,
      expected: PublicDashboardAccess,
    ) => {
      const dashboard: Dashboard = storedDashboard({
        ...switches,
        hasMasterPassword: true,
        ipWhitelist,
      });

      expect(decide(dashboard, UNKNOWN_PUBLIC_DASHBOARD_VISITOR).access).toBe(
        expected,
      );
    },
  );
});

describe("what the decision reads", () => {
  it("selects the access columns and nothing a route sends", () => {
    expect(Object.keys(PUBLIC_DASHBOARD_ACCESS_SELECT).sort()).toEqual(
      [
        "_id",
        "enableMasterPassword",
        "ipWhitelist",
        "isArchived",
        "isPublicDashboard",
        "masterPassword",
      ].sort(),
    );
  });

  it("never carries the stored password into its answer", () => {
    const result: PublicDashboardAccessResult = decide(
      storedDashboard({
        isPublicDashboard: true,
        enableMasterPassword: true,
        hasMasterPassword: true,
      }),
      ANONYMOUS,
    );

    expect(JSON.stringify(result)).not.toContain("stored-hash");
  });
});

describe("getAddressRefusal", () => {
  it.each([
    ["no allowlist", undefined, OTHER_IP],
    ["an empty allowlist", "", undefined],
    ["an address it names", ALLOWLIST, ALLOWED_IP],
    ["an address inside a range it names", ALLOWLIST, "10.1.2.3"],
  ])(
    "lets in: %s",
    (
      _label: string,
      ipWhitelist: string | undefined,
      clientIp: string | undefined,
    ) => {
      expect(
        PublicDashboardAccessPolicy.getAddressRefusal({
          ipWhitelist,
          clientIp,
        }),
      ).toBeNull();
    },
  );

  it.each([
    ["an address it does not name", OTHER_IP],
    ["an unknown address", undefined],
  ])("refuses: %s", (_label: string, clientIp: string | undefined) => {
    expect(
      PublicDashboardAccessPolicy.getAddressRefusal({
        ipWhitelist: ALLOWLIST,
        clientIp,
      }),
    ).toBeInstanceOf(ForbiddenException);
  });
});
