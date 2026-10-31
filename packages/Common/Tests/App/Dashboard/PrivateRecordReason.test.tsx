import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getPrivateRecordNoun,
  getPrivateRecordReason,
  getPrivateRecordScope,
  PRIVATE_RECORD_REASONS,
  PrivateRecordNoun,
  PrivateRecordOwners,
  PrivateRecordReasons,
} from "../../../../App/FeatureSet/Dashboard/src/Components/PrivateRecord/PrivateRecordScopeProvider";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { PRIVATE_RECORD_TABLES } from "../../../Types/PrivateRecord/PrivateRecordParts";
import PermissionUtil from "../../../UI/Utils/Permission";
import { PrivateRecordScope } from "../../../UI/Utils/PrivateRecordScope";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import UserUtil from "../../../UI/Utils/User";

/*
 * WHY A CHANGE IS LOCKED ON A PRIVATE RECORD, in the reader's words: after
 * the lock's first sentence ("You do not have permission to create this
 * Incident Internal Note."), that the record - named, since the first
 * sentence may name a part of it - is private, so only the permissions of
 * the teams that own it count, and that the reader's teams among them may
 * not do this, named as the reader knows them. And the scope a private
 * record's page hands its gates (getPrivateRecordScope).
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const JSON_EXTENSION: RegExp = /\.json$/;

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(JSON_EXTENSION, "");
  })
  .sort();

function locale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(code: string): Translator {
  const words: Record<string, string> = locale(code);

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, code);
}

const ENGLISH: Translator = createTranslator(undefined, "en");

const TEAM_1: string = "7c100000-0000-4000-8000-0000000000a1";
const TEAM_2: string = "7c100000-0000-4000-8000-0000000000a2";
const TEAM_3: string = "7c100000-0000-4000-8000-0000000000a3";
const TEAM_4: string = "7c100000-0000-4000-8000-0000000000a4";
const TEAM_5: string = "7c100000-0000-4000-8000-0000000000a5";
const PROJECT_ID: string = "7c100000-0000-4000-8000-000000000001";

// What every reason says first, of an incident.
const INCIDENT_IS_PRIVATE: string =
  "This incident is private, so it is changed only with the permissions of the teams that own it, and";

type ReasonFunction = (data: {
  owningTeams: Array<{ id: string; name: string }>;
  readerTeamIds: Array<string>;
  tableName?: string;
  translator?: Translator;
}) => string;

const reason: ReasonFunction = (data: {
  owningTeams: Array<{ id: string; name: string }>;
  readerTeamIds: Array<string>;
  tableName?: string;
  translator?: Translator;
}): string => {
  return getPrivateRecordReason({
    tableName: data.tableName || "Incident",
    owningTeams: data.owningTeams,
    readerTeamIds: data.readerTeamIds,
    translator: data.translator || ENGLISH,
  });
};

describe("getPrivateRecordReason", () => {
  test("names the one team of the reader's that owns it", () => {
    expect(
      reason({
        owningTeams: [{ id: TEAM_2, name: "Team 2" }],
        readerTeamIds: [TEAM_1, TEAM_2],
      }),
    ).toBe(
      `${INCIDENT_IS_PRIVATE} Team 2, your team that owns it, may not do this.`,
    );
  });

  test("names two, then three, of the reader's teams that own it, as a list", () => {
    expect(
      reason({
        owningTeams: [
          { id: TEAM_2, name: "Team 2" },
          { id: TEAM_3, name: "Payments" },
        ],
        readerTeamIds: [TEAM_2, TEAM_3],
      }),
    ).toBe(
      `${INCIDENT_IS_PRIVATE} Team 2 and Payments, your teams that own it, may not do this.`,
    );
    expect(
      reason({
        owningTeams: [
          { id: TEAM_2, name: "Team 2" },
          { id: TEAM_3, name: "Payments" },
          { id: TEAM_4, name: "SRE" },
        ],
        readerTeamIds: [TEAM_2, TEAM_3, TEAM_4],
      }),
    ).toBe(
      `${INCIDENT_IS_PRIVATE} Team 2, Payments and SRE, your teams that own it, may not do this.`,
    );
  });

  test("says more than three together, still as one list", () => {
    expect(
      reason({
        owningTeams: [
          { id: TEAM_1, name: "Team 1" },
          { id: TEAM_2, name: "Team 2" },
          { id: TEAM_3, name: "Payments" },
          { id: TEAM_4, name: "SRE" },
          { id: TEAM_5, name: "Database" },
        ],
        readerTeamIds: [TEAM_1, TEAM_2, TEAM_3, TEAM_4, TEAM_5],
      }),
    ).toBe(
      `${INCIDENT_IS_PRIVATE} Team 1, Team 2, Payments, SRE and Database, your teams that own it, may not do this.`,
    );
  });

  test("names only the reader's teams among its owners, matching ids in any case", () => {
    expect(
      reason({
        owningTeams: [
          { id: TEAM_3, name: "Someone else's team" },
          { id: TEAM_2.toUpperCase(), name: "Team 2" },
        ],
        readerTeamIds: [TEAM_1, TEAM_2],
      }),
    ).toBe(
      `${INCIDENT_IS_PRIVATE} Team 2, your team that owns it, may not do this.`,
    );
  });

  test("names a team once, and leaves out a name it cannot read", () => {
    expect(
      reason({
        owningTeams: [
          { id: TEAM_2, name: "Team 2" },
          { id: TEAM_2, name: " Team 2 " },
          { id: TEAM_3, name: "   " },
        ],
        readerTeamIds: [TEAM_2, TEAM_3],
      }),
    ).toBe(
      `${INCIDENT_IS_PRIVATE} Team 2, your team that owns it, may not do this.`,
    );
  });

  test("says the teams together when it can name none of them", () => {
    expect(
      reason({
        owningTeams: [{ id: TEAM_3, name: "" }],
        readerTeamIds: [TEAM_3],
      }),
    ).toBe(`${INCIDENT_IS_PRIVATE} your teams that own it may not do this.`);
    expect(reason({ owningTeams: [], readerTeamIds: [TEAM_1] })).toBe(
      PRIVATE_RECORD_REASONS.incident.unnamedTeams,
    );
  });

  test.each([
    ["Incident", "This incident is private"],
    ["Alert", "This alert is private"],
    ["IncidentEpisode", "This episode is private"],
    ["AlertEpisode", "This episode is private"],
  ])(
    "on a private %s, names what is private: %s",
    (tableName: string, opening: string) => {
      expect(
        reason({
          tableName: tableName,
          owningTeams: [{ id: TEAM_2, name: "Team 2" }],
          readerTeamIds: [TEAM_2],
        }),
      ).toBe(
        `${opening}, so it is changed only with the permissions of the teams that own it, and Team 2, your team that owns it, may not do this.`,
      );
    },
  );

  test("every kind of private record has its word", () => {
    expect(
      PRIVATE_RECORD_TABLES.map((tableName: string): PrivateRecordNoun => {
        return getPrivateRecordNoun(tableName);
      }),
    ).toEqual(["incident", "alert", "episode", "episode"]);
  });

  test("in German, agreeing with what is private, and right to left in Persian, with the team's name as it is", () => {
    expect(
      reason({
        owningTeams: [{ id: TEAM_2, name: "Team 2" }],
        readerTeamIds: [TEAM_2],
        translator: translatorFor("de"),
      }),
    ).toBe(
      "Dieser Vorfall ist privat, daher wird er nur mit den Berechtigungen der Teams geändert, denen er gehört, und Team 2, Ihr Team, dem er gehört, darf das nicht.",
    );
    expect(
      reason({
        tableName: "Alert",
        owningTeams: [
          { id: TEAM_2, name: "Team 2" },
          { id: TEAM_3, name: "Payments" },
        ],
        readerTeamIds: [TEAM_2, TEAM_3],
        translator: translatorFor("de"),
      }),
    ).toMatch(
      /^Diese Warnung ist privat, daher wird sie nur mit den Berechtigungen der Teams geändert, denen sie gehört, und Team 2 .+ Payments, Ihre Teams, denen sie gehört, dürfen das nicht\.$/,
    );

    const persian: string = reason({
      owningTeams: [{ id: TEAM_2, name: "Team 2" }],
      readerTeamIds: [TEAM_2],
      translator: translatorFor("fa"),
    });

    expect(persian).toBe(
      locale("fa")[PRIVATE_RECORD_REASONS.incident.oneTeam]!.replace(
        "{{team}}",
        "Team 2",
      ),
    );
    expect(persian).toContain("خصوصی");
  });

  test.each(LANGUAGES)(
    "the %s Dashboard says every one, each naming what it names",
    (code: string) => {
      const words: Record<string, string> = locale(code);

      for (const reasons of Object.values(
        PRIVATE_RECORD_REASONS,
      ) as Array<PrivateRecordReasons>) {
        for (const [key, placeholder] of [
          [reasons.oneTeam, "{{team}}"],
          [reasons.severalTeams, "{{teams}}"],
          [reasons.unnamedTeams, ""],
        ] as Array<[string, string]>) {
          const text: string | undefined = words[key];

          expect([code, key, typeof text]).toEqual([code, key, "string"]);
          expect(text!.trim().length).toBeGreaterThan(0);

          if (placeholder) {
            expect(text!.split(placeholder)).toHaveLength(2);
          } else {
            expect(text!).not.toContain("{{");
          }

          if (code !== "en") {
            expect([code, text !== key]).toEqual([code, true]);
          }
        }
      }
    },
  );
});

describe("getPrivateRecordScope", () => {
  const row: (permission: Permission, teamId?: string) => UserPermission = (
    permission: Permission,
    teamId?: string,
  ): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
      ...(teamId ? { teamId: new ObjectID(teamId) } : {}),
    };
  };

  const store: (rows: Array<UserPermission>) => void = (
    rows: Array<UserPermission>,
  ): void => {
    PermissionUtil.setGlobalPermissions({
      _type: "UserGlobalAccessPermission",
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [new ObjectID(PROJECT_ID)],
    });
    PermissionUtil.setProjectPermissions({
      _type: "UserTenantAccessPermission",
      projectId: new ObjectID(PROJECT_ID),
      permissions: rows,
    });
  };

  const MAINTAINERS_OWNERS: PrivateRecordOwners = {
    isPrivate: true,
    isOwnedByReader: false,
    owningTeams: [{ id: TEAM_2, name: "Team 2" }],
  };

  beforeEach(() => {
    localStorage.clear();
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
    store([
      row(Permission.ProjectUser),
      row(Permission.ProjectMember, TEAM_1),
      row(Permission.Viewer, TEAM_2),
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  test("the maintainer's case: what Team 2 holds, and why, naming Team 2", () => {
    const scope: PrivateRecordScope | null = getPrivateRecordScope({
      tableName: "Incident",
      owners: MAINTAINERS_OWNERS,
      translator: ENGLISH,
    });

    expect(scope?.tableName).toBe("Incident");
    expect(scope?.held.allowed).toContain(Permission.Viewer);
    expect(scope?.held.allowed).not.toContain(Permission.ProjectMember);
    expect(scope?.reason).toBe(
      `${INCIDENT_IS_PRIVATE} Team 2, your team that owns it, may not do this.`,
    );
  });

  test("while who owns it is being read: a scope that holds nothing, with no reason yet", () => {
    const scope: PrivateRecordScope | null = getPrivateRecordScope({
      tableName: "Incident",
      owners: undefined,
      translator: ENGLISH,
    });

    expect(scope).toEqual({
      tableName: "Incident",
      held: {
        allowed: [],
        allowedProjectWide: [],
        blocked: [],
        blockedForSomeLabels: [],
      },
      reason: "",
    });
    // Read as a snapshot not landed yet: a gate offers nothing, and locks nothing.
    expect(HeldPermissionsUtil.isLoaded(scope!.held)).toBe(false);
  });

  test("nothing to narrow: a record that is not private, or whose owners could not be read", () => {
    expect(
      getPrivateRecordScope({
        tableName: "Incident",
        owners: null,
        translator: ENGLISH,
      }),
    ).toBeNull();
    expect(
      getPrivateRecordScope({
        tableName: "Incident",
        owners: { ...MAINTAINERS_OWNERS, isPrivate: false },
        translator: ENGLISH,
      }),
    ).toBeNull();
  });

  test("nothing to narrow for a reader named as its owner", () => {
    expect(
      getPrivateRecordScope({
        tableName: "Incident",
        owners: { ...MAINTAINERS_OWNERS, isOwnedByReader: true },
        translator: ENGLISH,
      }),
    ).toBeNull();
  });

  test("nothing to narrow for a Project Admin, or a master admin", () => {
    store([
      row(Permission.ProjectUser),
      row(Permission.ProjectAdmin, TEAM_1),
      row(Permission.Viewer, TEAM_2),
    ]);

    expect(
      getPrivateRecordScope({
        tableName: "Incident",
        owners: MAINTAINERS_OWNERS,
        translator: ENGLISH,
      }),
    ).toBeNull();

    store([row(Permission.ProjectUser), row(Permission.Viewer, TEAM_2)]);
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

    expect(
      getPrivateRecordScope({
        tableName: "Incident",
        owners: MAINTAINERS_OWNERS,
        translator: ENGLISH,
      }),
    ).toBeNull();
  });

  test("of an alert, in the reader's language", () => {
    expect(
      getPrivateRecordScope({
        tableName: "Alert",
        owners: MAINTAINERS_OWNERS,
        translator: translatorFor("de"),
      })?.reason,
    ).toBe(
      "Diese Warnung ist privat, daher wird sie nur mit den Berechtigungen der Teams geändert, denen sie gehört, und Team 2, Ihr Team, dem sie gehört, darf das nicht.",
    );
  });
});
