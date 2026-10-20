import IconProp from "Common/Types/Icon/IconProp";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { getRoleCardSummary, getRoleIcon } from "./RoleCardSelectOptions";
import {
  getRolePlace,
  ROLE_AREAS,
  ROLE_LEVEL_TITLES,
  ROLE_LEVELS,
  ROLE_REACH_TITLES,
  RoleArea,
  RoleLevel,
  RolePlace,
  RoleReach,
  WHOLE_PROJECT_ROLES,
  WholeProjectRole,
} from "./RoleCatalog";

/*
 * WHAT THE ROLE PICKER OFFERS, AND HOW ITS SEARCH READS (RolePicker).
 *
 * The picker opens on the four roles that reach the whole project (a
 * custom role's and a block's on One area). The other answer, One area, is
 * twelve area tiles over a level switch; picking a tile picks its role at
 * the level on the switch, Member to start with. A search box finds any
 * role by its name, its area, its level or what its one line says, in
 * English or in the reader's language.
 *
 * React-free, so tests read it without rendering anything.
 */

// What the search box says before anything is typed in it.
export const ROLE_PICKER_SEARCH_PLACEHOLDER: string =
  translationKey("Search roles");

// What the group of level buttons is called, for a screen reader.
export const ROLE_PICKER_LEVEL_LABEL: string = translationKey("Access level");

// What the role picker field is called, for a screen reader.
export const ROLE_PICKER_FIELD_TITLE: string = translationKey("Role");

/*
 * What One area says under its tiles before one is picked: what to do,
 * where the role it adds will be named.
 */
export const ROLE_PICKER_PICK_AN_AREA: string = translationKey("Pick an area");

export const ROLE_PICKER_PICK_AN_AREA_HINT: string = translationKey(
  "Then choose Admin, Member or Viewer.",
);

export interface RolePickerRole {
  permission: Permission;
  // English: the role's own name ("Incident Member").
  title: string;
  // English: what the role is for, in one line (ROLE_CARD_SUMMARIES).
  summary: string;
  icon: IconProp;
  /*
   * Where the catalog places it, or null for a role added later and not
   * placed yet: the picker lists that one with the whole-project roles, so
   * it can still be picked.
   */
  place: RolePlace | null;
}

/*
 * Every role the picker offers, in the catalog's order: the whole-project
 * roles, then each area's Admin, Member and Viewer, then any role not
 * placed yet. Roles left out (Project Owner in a custom role) are not
 * offered anywhere: not in the list, not in a tile, not in a search.
 */
export const getRolePickerRoles: (
  excludeRoles?: ReadonlyArray<Permission> | undefined,
) => Array<RolePickerRole> = (
  excludeRoles?: ReadonlyArray<Permission> | undefined,
): Array<RolePickerRole> => {
  const offered: Array<PermissionProps> =
    PermissionHelper.getRolePermissionProps().filter(
      (props: PermissionProps): boolean => {
        return !excludeRoles?.includes(props.permission);
      },
    );

  const order: Array<Permission> = [
    ...WHOLE_PROJECT_ROLES.map((role: WholeProjectRole): Permission => {
      return role.permission;
    }),
    ...ROLE_AREAS.flatMap((area: RoleArea): Array<Permission> => {
      return ROLE_LEVELS.map((level: RoleLevel): Permission => {
        return area.roles[level];
      });
    }),
  ];

  const rankOf: (permission: Permission) => number = (
    permission: Permission,
  ): number => {
    const rank: number = order.indexOf(permission);

    return rank === -1 ? order.length : rank;
  };

  return offered
    .map((props: PermissionProps): RolePickerRole => {
      return {
        permission: props.permission,
        title: props.title,
        summary: getRoleCardSummary(props),
        icon: getRoleIcon(props.permission),
        place: getRolePlace(props.permission),
      };
    })
    .sort((a: RolePickerRole, b: RolePickerRole): number => {
      return rankOf(a.permission) - rankOf(b.permission);
    });
};

/*
 * The rows of Whole project: the roles that reach the whole project, and
 * any role the catalog does not place yet.
 */
export const getWholeProjectPickerRoles: (
  roles: ReadonlyArray<RolePickerRole>,
) => Array<RolePickerRole> = (
  roles: ReadonlyArray<RolePickerRole>,
): Array<RolePickerRole> => {
  return roles.filter((role: RolePickerRole): boolean => {
    return !role.place || role.place.reach === RoleReach.WholeProject;
  });
};

export interface RolePickerArea {
  area: RoleArea;
  // The levels of it on offer, most first.
  levels: Array<RoleLevel>;
}

// The tiles of One area: every area with at least one role on offer.
export const getRolePickerAreas: (
  roles: ReadonlyArray<RolePickerRole>,
) => Array<RolePickerArea> = (
  roles: ReadonlyArray<RolePickerRole>,
): Array<RolePickerArea> => {
  const offered: Set<Permission> = new Set<Permission>(
    roles.map((role: RolePickerRole): Permission => {
      return role.permission;
    }),
  );

  return ROLE_AREAS.map((area: RoleArea): RolePickerArea => {
    return {
      area: area,
      levels: ROLE_LEVELS.filter((level: RoleLevel): boolean => {
        return offered.has(area.roles[level]);
      }),
    };
  }).filter((entry: RolePickerArea): boolean => {
    return entry.levels.length > 0;
  });
};

/*
 * The role an area tile picks at a level: that level's role, or - when it
 * is not on offer - the nearest one that is, Member first, so a tile always
 * picks something.
 */
export const getAreaRoleAtLevel: (
  entry: RolePickerArea,
  level: RoleLevel,
) => { permission: Permission; level: RoleLevel } | null = (
  entry: RolePickerArea,
  level: RoleLevel,
): { permission: Permission; level: RoleLevel } | null => {
  const fallbacks: Array<RoleLevel> = [
    level,
    RoleLevel.Member,
    RoleLevel.Viewer,
    RoleLevel.Admin,
  ];

  for (const candidate of fallbacks) {
    if (entry.levels.includes(candidate)) {
      return { permission: entry.area.roles[candidate], level: candidate };
    }
  }

  return null;
};

// A run of spaces, tabs or line breaks between two words of a search.
const WORD_GAP: RegExp = /\s+/;

// The words of a search, in lower case. Empty when nothing is typed.
export const getRolePickerSearchTokens: (search: string) => Array<string> = (
  search: string,
): Array<string> => {
  return search
    .toLowerCase()
    .split(WORD_GAP)
    .filter((token: string): boolean => {
      return token.length > 0;
    });
};

/*
 * Words a level answers to that its name does not say: "read only" finds
 * the Viewer roles. Looked up in the reader's language too.
 */
export const ROLE_LEVEL_SEARCH_WORDS: Readonly<
  Record<RoleLevel, ReadonlyArray<string>>
> = {
  [RoleLevel.Admin]: [],
  [RoleLevel.Member]: [],
  [RoleLevel.Viewer]: [translationKey("Read-only")],
};

// Text in English and, where it differs, in the reader's language.
type TranslateFunction = (english: string) => string;

const bothLanguages: (
  english: string,
  translate: TranslateFunction,
) => string = (english: string, translate: TranslateFunction): string => {
  const translated: string = translate(english) || english;

  return translated === english ? english : `${english} ${translated}`;
};

/*
 * The roles a search finds, best first: every word typed must be found in
 * the role's name, its area, its level, its one line or its code name
 * (IncidentMember) - in English or in the reader's language. A word at the
 * start of the name counts most, then anywhere in the name, then the area
 * and the level, then the line. Ties keep the catalog's order.
 */
export const searchRolePickerRoles: (
  roles: ReadonlyArray<RolePickerRole>,
  search: string,
  translate: TranslateFunction,
) => Array<RolePickerRole> = (
  roles: ReadonlyArray<RolePickerRole>,
  search: string,
  translate: TranslateFunction,
): Array<RolePickerRole> => {
  const tokens: Array<string> = getRolePickerSearchTokens(search);

  if (tokens.length === 0) {
    return [];
  }

  const scored: Array<{ role: RolePickerRole; score: number; rank: number }> =
    [];

  roles.forEach((role: RolePickerRole, rank: number): void => {
    const title: string = bothLanguages(role.title, translate).toLowerCase();
    const titleWords: Array<string> = title.split(" ");
    const area: string = role.place?.area
      ? bothLanguages(role.place.area.title, translate).toLowerCase()
      : bothLanguages(
          ROLE_REACH_TITLES[RoleReach.WholeProject],
          translate,
        ).toLowerCase();
    const level: string = role.place?.level
      ? [
          ROLE_LEVEL_TITLES[role.place.level],
          ...ROLE_LEVEL_SEARCH_WORDS[role.place.level],
        ]
          .map((words: string): string => {
            return bothLanguages(words, translate);
          })
          .join(" ")
          .toLowerCase()
      : "";
    const summary: string = bothLanguages(
      role.summary,
      translate,
    ).toLowerCase();
    const code: string = role.permission.toLowerCase();

    let score: number = 0;

    for (const token of tokens) {
      let tokenScore: number = 0;

      if (
        titleWords.some((word: string): boolean => {
          return word.startsWith(token);
        })
      ) {
        tokenScore = 40;
      } else if (title.includes(token) || code.includes(token)) {
        tokenScore = 30;
      } else if (area.includes(token)) {
        tokenScore = 20;
      } else if (level.includes(token)) {
        tokenScore = 15;
      } else if (summary.includes(token)) {
        tokenScore = 5;
      }

      if (tokenScore === 0) {
        return;
      }

      score += tokenScore;
    }

    scored.push({ role: role, score: score, rank: rank });
  });

  return scored
    .sort(
      (
        a: { score: number; rank: number },
        b: { score: number; rank: number },
      ): number => {
        return b.score - a.score || a.rank - b.rank;
      },
    )
    .map((entry: { role: RolePickerRole }): RolePickerRole => {
      return entry.role;
    });
};
