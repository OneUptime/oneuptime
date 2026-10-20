import {
  DEFAULT_ROLE_LEVEL,
  ROLE_LEVEL_TITLES,
  ROLE_LEVELS,
  ROLE_REACH_TITLES,
  ROLE_REACHES,
  RoleAreaId,
  RoleLevel,
  RoleReach,
} from "./RoleCatalog";
import {
  getAreaRoleAtLevel,
  getRolePickerAreas,
  getRolePickerRoles,
  getWholeProjectPickerRoles,
  ROLE_PICKER_FIELD_TITLE,
  ROLE_PICKER_LEVEL_LABEL,
  ROLE_PICKER_PICK_AN_AREA,
  ROLE_PICKER_PICK_AN_AREA_HINT,
  ROLE_PICKER_SEARCH_PLACEHOLDER,
  RolePickerArea,
  RolePickerRole,
  searchRolePickerRoles,
} from "./RolePickerOptions";
import IconProp from "Common/Types/Icon/IconProp";
import Permission from "Common/Types/Permission";
import Icon from "Common/UI/Components/Icon/Icon";
import ViewSwitch, {
  ViewSwitchOption,
} from "Common/UI/Components/ViewSwitch/ViewSwitch";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  KeyboardEvent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * THE ROLE PICKER OF ADD A ROLE: THE WHOLE PROJECT, OR ONE AREA OF IT.
 *
 * It replaced forty look-alike cards - "This is very confusing. it gives a
 * lot of information to the user" (the maintainer) - with the two questions
 * every built-in role answers (RoleCatalog):
 *
 *   - Whole project | One area, a switch at the top, on Whole project to
 *     start with: Project Owner, Project Admin, Project Member and Viewer,
 *     one row each with what the role is for in one line;
 *   - One area: twelve tiles, one per area, each with its product's icon,
 *     and under them a panel with an Admin | Member | Viewer switch. Before
 *     a tile is picked the panel says what to do (pick an area, then a
 *     level); picking one picks the area's role at the level on the switch
 *     - Member to start with - and the panel names it with its line. The
 *     switch then changes the level in place.
 *
 * What is picked is always on screen, and is what Add Role adds: switching
 * between the two answers keeps each one's own pick, so going back finds
 * it, and an answer with nothing picked yet adds nothing. Like the cards
 * it replaced, it says a role is missing only once Add Role is pressed,
 * not when focus moves on: a line appearing under the picker while a tile
 * is pressed would move the tile from under the pointer.
 *
 * A search box beside the switch finds any role by its name, area, level or
 * line (RolePickerOptions.searchRolePickerRoles): Enter picks the first
 * match, the down arrow moves into the matches, Escape clears it - without
 * closing the dialog. A pick made there shows where it lives once the
 * search is cleared.
 *
 * Each list is a group of the browser's own radio buttons, kept out of
 * sight but focusable, so Tab reaches each group once, the arrow keys move
 * through it, and a screen reader hears a role's name with its line. On a
 * phone the switch and the search stack, the tiles go two to a row, and
 * the level switch moves under the pick.
 *
 * The roles and what they grant are Common/Types/Permission's; the picker
 * hands back the role's stored value (IncidentMember), as the cards did.
 */

export interface ComponentProps {
  // The role picked, or nothing.
  value?: Permission | string | null | undefined;
  onChange: (value: Permission | null) => void;
  // Roles not offered: a custom role leaves out Project Owner.
  excludeRoles?: ReadonlyArray<Permission> | undefined;
  /*
   * The answer it opens on when nothing is picked yet: Whole project, or
   * One area where an area's role is what is usually added (a custom
   * role's permissions, a team's block permissions).
   */
  startOn?: RoleReach | undefined;
  error?: string | undefined;
  dataTestId?: string | undefined;
}

// The switch's test id, and its two buttons': `${id}-${RoleReach}`.
export const ROLE_PICKER_REACH_TEST_ID: string = "role-picker-reach";
export const ROLE_PICKER_LEVEL_TEST_ID: string = "role-picker-level";
export const ROLE_PICKER_SEARCH_TEST_ID: string = "role-picker-search";

// A role's row - in Whole project, or among the search's matches.
export const getRolePickerRoleTestId: (permission: string) => string = (
  permission: string,
): string => {
  return `role-picker-role-${permission}`;
};

// An area's tile in One area.
export const getRolePickerAreaTestId: (areaId: string) => string = (
  areaId: string,
): string => {
  return `role-picker-area-${areaId}`;
};

// The keyboard's focus ring, drawn round the row or tile of a focused radio.
const FOCUS_RING: string =
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500";

const RolePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const baseId: string = useId();
  const searchRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const resultsRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const translate: (english: string) => string = (english: string): string => {
    return translator.translateText(english) || english;
  };

  const roles: Array<RolePickerRole> = useMemo(() => {
    return getRolePickerRoles(props.excludeRoles);
  }, [props.excludeRoles]);

  const wholeProjectRoles: Array<RolePickerRole> = useMemo(() => {
    return getWholeProjectPickerRoles(roles);
  }, [roles]);

  const areas: Array<RolePickerArea> = useMemo(() => {
    return getRolePickerAreas(roles);
  }, [roles]);

  const findRole: (
    permission: Permission | string | null | undefined,
  ) => RolePickerRole | null = (
    permission: Permission | string | null | undefined,
  ): RolePickerRole | null => {
    return (
      roles.find((role: RolePickerRole): boolean => {
        return role.permission === permission;
      }) || null
    );
  };

  const isWholeProjectRole: (role: RolePickerRole) => boolean = (
    role: RolePickerRole,
  ): boolean => {
    return !role.place || role.place.reach === RoleReach.WholeProject;
  };

  const initialRole: RolePickerRole | null = findRole(props.value);

  const [reach, setReach] = useState<RoleReach>((): RoleReach => {
    if (initialRole) {
      return isWholeProjectRole(initialRole)
        ? RoleReach.WholeProject
        : RoleReach.OneArea;
    }

    return props.startOn || RoleReach.WholeProject;
  });

  // Each answer keeps its own pick, so switching back finds it.
  const [wholeProjectPick, setWholeProjectPick] = useState<Permission | null>(
    (): Permission | null => {
      return initialRole && isWholeProjectRole(initialRole)
        ? initialRole.permission
        : null;
    },
  );

  const [areaId, setAreaId] = useState<RoleAreaId | null>(
    (): RoleAreaId | null => {
      return initialRole?.place?.area?.id || null;
    },
  );

  const [level, setLevel] = useState<RoleLevel>((): RoleLevel => {
    return initialRole?.place?.level || DEFAULT_ROLE_LEVEL;
  });

  const [search, setSearch] = useState<string>("");

  /*
   * A value set from outside - Edit opening on a row's role - shows where
   * it lives. An empty value changes nothing: it is what an answer with no
   * pick hands back.
   */
  useEffect(() => {
    const role: RolePickerRole | null = findRole(props.value);

    if (!role) {
      return;
    }

    if (isWholeProjectRole(role)) {
      setReach(RoleReach.WholeProject);
      setWholeProjectPick(role.permission);
      return;
    }

    setReach(RoleReach.OneArea);
    setAreaId(role.place?.area?.id || null);
    setLevel(role.place?.level || DEFAULT_ROLE_LEVEL);
  }, [props.value, roles]);

  const pickedArea: RolePickerArea | null =
    areas.find((entry: RolePickerArea): boolean => {
      return entry.area.id === areaId;
    }) || null;

  const searchResults: Array<RolePickerRole> = useMemo(() => {
    return searchRolePickerRoles(roles, search, translate);
  }, [roles, search, translator]);

  const isSearching: boolean = search.trim().length > 0;

  // The role an answer adds as it stands: its pick, or nothing.
  const getPickOf: (answer: RoleReach) => Permission | null = (
    answer: RoleReach,
  ): Permission | null => {
    if (answer === RoleReach.WholeProject) {
      return wholeProjectPick;
    }

    if (!pickedArea) {
      return null;
    }

    return getAreaRoleAtLevel(pickedArea, level)?.permission || null;
  };

  const pickReach: (answer: RoleReach) => void = (answer: RoleReach): void => {
    setReach(answer);
    setSearch("");
    props.onChange(getPickOf(answer));
  };

  const pickWholeProjectRole: (permission: Permission) => void = (
    permission: Permission,
  ): void => {
    setReach(RoleReach.WholeProject);
    setWholeProjectPick(permission);
    props.onChange(permission);
  };

  const pickArea: (entry: RolePickerArea) => void = (
    entry: RolePickerArea,
  ): void => {
    const pick: { permission: Permission; level: RoleLevel } | null =
      getAreaRoleAtLevel(entry, level);

    if (!pick) {
      return;
    }

    setReach(RoleReach.OneArea);
    setAreaId(entry.area.id);
    setLevel(pick.level);
    props.onChange(pick.permission);
  };

  const pickLevel: (newLevel: RoleLevel) => void = (
    newLevel: RoleLevel,
  ): void => {
    if (!pickedArea) {
      setLevel(newLevel);
      return;
    }

    const pick: { permission: Permission; level: RoleLevel } | null =
      getAreaRoleAtLevel(pickedArea, newLevel);

    if (!pick) {
      return;
    }

    setLevel(pick.level);
    props.onChange(pick.permission);
  };

  // A match picked: it is picked where it lives, and the matches stay.
  const pickRole: (role: RolePickerRole) => void = (
    role: RolePickerRole,
  ): void => {
    if (isWholeProjectRole(role)) {
      pickWholeProjectRole(role.permission);
      return;
    }

    setReach(RoleReach.OneArea);
    setAreaId(role.place?.area?.id || null);
    setLevel(role.place?.level || DEFAULT_ROLE_LEVEL);
    props.onChange(role.permission);
  };

  const clearSearch: () => void = (): void => {
    setSearch("");
    searchRef.current?.focus();
  };

  const focusFirstMatch: () => void = (): void => {
    const radios: Array<HTMLInputElement> = Array.from(
      resultsRef.current?.querySelectorAll<HTMLInputElement>(
        "input[type='radio']",
      ) || [],
    );

    (
      radios.find((radio: HTMLInputElement): boolean => {
        return radio.checked;
      }) || radios[0]
    )?.focus();
  };

  const onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void = (
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Escape" && search.length > 0) {
      // Clears the search; the dialog stays open.
      event.preventDefault();
      event.stopPropagation();
      setSearch("");
      return;
    }

    if (event.key === "Enter") {
      // Never the form's own Enter: the first match is the answer.
      event.preventDefault();

      if (searchResults[0]) {
        pickRole(searchResults[0]);
      }

      return;
    }

    if (event.key === "ArrowDown" && searchResults.length > 0) {
      event.preventDefault();
      focusFirstMatch();
    }
  };

  const reachOptions: Array<ViewSwitchOption<RoleReach>> = ROLE_REACHES.map(
    (answer: RoleReach): ViewSwitchOption<RoleReach> => {
      return {
        value: answer,
        label: ROLE_REACH_TITLES[answer],
      };
    },
  );

  // A role as a row: its icon, its name and its line, the radio out of sight.
  const renderRoleRow: (
    role: RolePickerRole,
    groupName: string,
    onPick: (role: RolePickerRole) => void,
  ) => ReactElement = (
    role: RolePickerRole,
    groupName: string,
    onPick: (role: RolePickerRole) => void,
  ): ReactElement => {
    const isChecked: boolean = props.value === role.permission;
    const titleId: string = `${groupName}-${role.permission}-title`;
    const summaryId: string = `${groupName}-${role.permission}-summary`;

    return (
      <label
        key={role.permission}
        data-testid={getRolePickerRoleTestId(role.permission)}
        data-checked={isChecked ? "true" : "false"}
        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150 ${FOCUS_RING} ${
          isChecked
            ? "border-indigo-500 bg-indigo-50/50"
            : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-gray-50"
        }`}
      >
        <input
          type="radio"
          className="sr-only"
          name={groupName}
          value={role.permission}
          checked={isChecked}
          aria-labelledby={titleId}
          aria-describedby={summaryId}
          onChange={() => {
            onPick(role);
          }}
        />
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${
            isChecked ? "bg-indigo-100" : "bg-gray-100"
          }`}
        >
          <Icon
            icon={role.icon}
            className={`h-4 w-4 ${
              isChecked ? "text-indigo-600" : "text-gray-600"
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <span
            id={titleId}
            className="block break-words text-sm font-medium text-gray-900"
          >
            {translate(role.title)}
          </span>
          <span
            id={summaryId}
            className="mt-0.5 block break-words text-sm text-gray-500"
          >
            {translate(role.summary)}
          </span>
        </div>
        {isChecked ? (
          <Icon
            icon={IconProp.CheckCircle}
            className="h-5 w-5 flex-shrink-0 text-indigo-500"
          />
        ) : (
          <></>
        )}
      </label>
    );
  };

  const renderWholeProject: () => ReactElement = (): ReactElement => {
    return (
      <div
        role="radiogroup"
        aria-label={translate(ROLE_REACH_TITLES[RoleReach.WholeProject])}
        className="space-y-2"
        data-testid="role-picker-whole-project"
      >
        {wholeProjectRoles.map((role: RolePickerRole): ReactElement => {
          return renderRoleRow(
            role,
            `${baseId}-whole-project`,
            (picked: RolePickerRole): void => {
              pickWholeProjectRole(picked.permission);
            },
          );
        })}
      </div>
    );
  };

  /*
   * Under the tiles, always: the role an area adds, with the level switch
   * beside it. Before an area is picked it says what to do - pick an area,
   * then a level - and the switch already works, so a level chosen first
   * is the one the area gets. Picking only changes what the panel says:
   * nothing moves, and the dialog does not jump.
   */
  const renderPickedAreaRole: () => ReactElement = (): ReactElement => {
    const pick: { permission: Permission; level: RoleLevel } | null = pickedArea
      ? getAreaRoleAtLevel(pickedArea, level)
      : null;
    const role: RolePickerRole | null = pick ? findRole(pick.permission) : null;

    const levelChoices: Array<RoleLevel> = pickedArea
      ? pickedArea.levels
      : ROLE_LEVELS.filter((option: RoleLevel): boolean => {
          return areas.some((entry: RolePickerArea): boolean => {
            return entry.levels.includes(option);
          });
        });

    return (
      <div
        className={`mt-3 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
          role
            ? "border-indigo-200 bg-indigo-50/50"
            : "border-dashed border-gray-300 bg-white"
        }`}
        data-testid="role-picker-picked"
        data-picked={role ? "true" : "false"}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${
              role ? "bg-indigo-100" : "bg-gray-100"
            }`}
          >
            <Icon
              icon={pickedArea ? pickedArea.area.icon : IconProp.Squares}
              className={`h-4 w-4 ${role ? "text-indigo-600" : "text-gray-400"}`}
            />
          </div>
          {/*
           * Read out as it changes: a new level is a new role. From sm up
           * it keeps room for a line of two rows, centred, so a role whose
           * line fits on one does not make the dialog shrink and jump.
           */}
          <div
            className="flex min-w-0 flex-col justify-center sm:min-h-[3.875rem]"
            aria-live="polite"
          >
            <span
              className={`block break-words text-sm font-medium ${
                role ? "text-gray-900" : "text-gray-500"
              }`}
              data-testid="role-picker-picked-title"
            >
              {role
                ? translate(role.title)
                : translate(ROLE_PICKER_PICK_AN_AREA)}
            </span>
            <span
              className="mt-0.5 block break-words text-sm text-gray-500"
              data-testid="role-picker-picked-summary"
            >
              {role
                ? translate(role.summary)
                : translate(ROLE_PICKER_PICK_AN_AREA_HINT)}
            </span>
          </div>
        </div>
        {levelChoices.length > 1 ? (
          <ViewSwitch<RoleLevel>
            options={levelChoices.map(
              (option: RoleLevel): ViewSwitchOption<RoleLevel> => {
                return {
                  value: option,
                  label: ROLE_LEVEL_TITLES[option],
                };
              },
            )}
            value={pick ? pick.level : level}
            onChange={pickLevel}
            ariaLabel={ROLE_PICKER_LEVEL_LABEL}
            dataTestId={ROLE_PICKER_LEVEL_TEST_ID}
            fillWidthOnPhone={true}
          />
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderOneArea: () => ReactElement = (): ReactElement => {
    const groupName: string = `${baseId}-areas`;

    return (
      <div>
        <div
          role="radiogroup"
          aria-label={translate(ROLE_REACH_TITLES[RoleReach.OneArea])}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          data-testid="role-picker-areas"
        >
          {areas.map((entry: RolePickerArea): ReactElement => {
            const isChecked: boolean = entry.area.id === areaId;

            return (
              <label
                key={entry.area.id}
                data-testid={getRolePickerAreaTestId(entry.area.id)}
                data-checked={isChecked ? "true" : "false"}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors duration-150 ${FOCUS_RING} ${
                  isChecked
                    ? "border-indigo-500 bg-indigo-50/50"
                    : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={groupName}
                  value={entry.area.id}
                  checked={isChecked}
                  onChange={() => {
                    pickArea(entry);
                  }}
                />
                <Icon
                  icon={entry.area.icon}
                  className={`h-5 w-5 flex-shrink-0 ${
                    isChecked ? "text-indigo-600" : "text-gray-400"
                  }`}
                />
                <span className="min-w-0 break-words text-sm font-medium text-gray-900">
                  {translate(entry.area.title)}
                </span>
              </label>
            );
          })}
        </div>
        {renderPickedAreaRole()}
      </div>
    );
  };

  const renderSearchResults: () => ReactElement = (): ReactElement => {
    if (searchResults.length === 0) {
      return (
        <div
          className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center"
          data-testid="role-picker-no-results"
        >
          <p className="text-sm text-gray-500">
            {translate("Nothing matches every word you typed.")}
          </p>
          <button
            type="button"
            className="mt-2 rounded-md text-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={clearSearch}
          >
            {translate("Clear search")}
          </button>
        </div>
      );
    }

    return (
      <div
        ref={resultsRef}
        role="radiogroup"
        aria-label={translate(ROLE_PICKER_SEARCH_PLACEHOLDER)}
        className="space-y-2"
        data-testid="role-picker-results"
      >
        {searchResults.map((role: RolePickerRole): ReactElement => {
          return renderRoleRow(role, `${baseId}-results`, pickRole);
        })}
      </div>
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (isSearching) {
      return renderSearchResults();
    }

    return reach === RoleReach.WholeProject
      ? renderWholeProject()
      : renderOneArea();
  };

  return (
    <div data-testid={props.dataTestId || "role-picker"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitch<RoleReach>
          options={reachOptions}
          value={reach}
          onChange={pickReach}
          ariaLabel={ROLE_PICKER_FIELD_TITLE}
          dataTestId={ROLE_PICKER_REACH_TEST_ID}
          fillWidthOnPhone={true}
        />
        <div className="relative w-full sm:w-56">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <input
            ref={searchRef}
            type="text"
            role="searchbox"
            value={search}
            autoComplete="off"
            placeholder={translate(ROLE_PICKER_SEARCH_PLACEHOLDER)}
            aria-label={translate(ROLE_PICKER_SEARCH_PLACEHOLDER)}
            data-testid={ROLE_PICKER_SEARCH_TEST_ID}
            className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-9 pr-8 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setSearch(event.target.value);
            }}
            onKeyDown={onSearchKeyDown}
          />
          {search.length > 0 ? (
            <button
              type="button"
              aria-label={translate("Clear search")}
              data-testid="role-picker-search-clear"
              className="absolute inset-y-0 right-0 flex items-center rounded-md pr-2.5 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              onClick={clearSearch}
            >
              <Icon icon={IconProp.Close} className="h-4 w-4" />
            </button>
          ) : (
            <></>
          )}
        </div>
      </div>

      {/*
       * At least as tall as the four whole-project rows, or the tiles and
       * the panel under them, so the dialog keeps its size - and stays where
       * it is - while a search narrows the list down to a match or none.
       */}
      <div className="mt-4 min-h-[17.5rem]">{renderBody()}</div>

      {props.error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {props.error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default RolePicker;
