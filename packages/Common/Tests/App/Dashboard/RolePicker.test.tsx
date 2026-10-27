import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * THE ROLE PICKER OF ADD A ROLE (Dashboard/src/Components/Permission/
 * RolePicker), rendered on its own as the form draws it: a value, and what
 * it hands back when a role is picked.
 *
 * "This is very confusing. it gives a lot of information to the user ...
 * Make it natural for people to understand and use." (the maintainer, on
 * forty look-alike cards.) The picker asks the two questions every role
 * answers instead - the whole project, or one area; and for an area, Admin,
 * Member or Viewer - and these hold what that promises:
 *
 *   - it opens on the four whole-project roles, a row each with its line;
 *   - One area is twelve tiles; a tile picks its area's role at the level
 *     on the switch beside the pick (Member to start with), and the pick is
 *     named, with its line, where the dialog says what it adds;
 *   - each answer keeps its own pick, and the picker hands back the pick of
 *     the answer on screen - nothing while it has none;
 *   - every one of the forty roles can be picked, and an Edit opens on the
 *     row's role where it lives;
 *   - nothing a pick changes moves the dialog: every row keeps its check's
 *     room, the panel under the tiles keeps the room of all it could say,
 *     and the picker keeps the room of the form's More fields line while
 *     the form does not draw it;
 *   - the search finds a role by name, area, level or line, Enter takes the
 *     first match, the down arrow moves into the matches, Escape clears it
 *     without closing the dialog; while it lists matches neither answer is
 *     pressed;
 *   - roles left out (Project Owner, in a custom role) are nowhere;
 *   - it reads in the reader's language.
 *
 * The browser keyboard (arrow keys through the browser's own radios), the
 * phone layout and dark mode are checked in real Chromium:
 * packages/E2E/CustomRoles/AddRoleDialog.spec.ts.
 */

const mockTranslations: Record<string, string> = {};

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          if (value === undefined) {
            return value;
          }

          return mockTranslations[value] ?? value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import RolePicker, {
  ComponentProps,
  getRolePickerAreaTestId,
  getRolePickerRoleTestId,
  ROLE_PICKER_LEVEL_TEST_ID,
  ROLE_PICKER_REACH_TEST_ID,
  ROLE_PICKER_SEARCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RolePicker";
import {
  getRolePickerFormField,
  ROLE_PICKER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RolePickerFormField";
import {
  getRolePickerRoles,
  RolePickerRole,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RolePickerOptions";
import { ROLE_CARD_SUMMARIES } from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCardSelectOptions";
import {
  ROLE_AREAS,
  RoleArea,
  RoleAreaId,
  RoleLevel,
  RoleReach,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCatalog";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import { PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE } from "../../../Types/Team/CustomRole";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import { CustomElementProps } from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

const GERMAN: Record<string, string> = germanLocale as unknown as Record<
  string,
  string
>;

// Everything the picker handed back, in order.
let picks: Array<Permission | null> = [];

interface HarnessProps {
  initial?: Permission | null | undefined;
  excludeRoles?: ReadonlyArray<Permission> | undefined;
  startOn?: RoleReach | undefined;
  error?: string | undefined;
  keepsMoreFieldsRoom?: boolean | undefined;
}

/*
 * The picker as a form holds it: the value it hands back is the value it
 * is drawn with next.
 */
function Harness(props: HarnessProps): ReactElement {
  const [value, setValue] = useState<Permission | null>(props.initial || null);

  const pickerProps: ComponentProps = {
    value: value,
    onChange: (next: Permission | null): void => {
      picks.push(next);
      setValue(next);
    },
    excludeRoles: props.excludeRoles,
    startOn: props.startOn,
    error: props.error,
    keepsMoreFieldsRoom: props.keepsMoreFieldsRoom,
  };

  return <RolePicker {...pickerProps} />;
}

function lastPick(): Permission | null | undefined {
  return picks[picks.length - 1];
}

function reachButton(reach: RoleReach): HTMLElement {
  return screen.getByTestId(`${ROLE_PICKER_REACH_TEST_ID}-${reach}`);
}

function levelButton(level: RoleLevel): HTMLElement {
  return screen.getByTestId(`${ROLE_PICKER_LEVEL_TEST_ID}-${level}`);
}

function roleRow(permission: Permission): HTMLElement {
  return screen.getByTestId(getRolePickerRoleTestId(permission));
}

function areaTile(areaId: RoleAreaId): HTMLElement {
  return screen.getByTestId(getRolePickerAreaTestId(areaId));
}

function radioIn(element: HTMLElement): HTMLInputElement {
  return element.querySelector("input[type='radio']") as HTMLInputElement;
}

function searchBox(): HTMLInputElement {
  return screen.getByTestId(ROLE_PICKER_SEARCH_TEST_ID) as HTMLInputElement;
}

function pickedTitle(): string {
  return screen.getByTestId("role-picker-picked-title").textContent || "";
}

function pickedSummary(): string {
  return screen.getByTestId("role-picker-picked-summary").textContent || "";
}

function wholeProjectNames(): Array<string> {
  return within(screen.getByTestId("role-picker-whole-project"))
    .getAllByRole("radio")
    .map((radio: HTMLElement): string => {
      return radio.getAttribute("value") || "";
    });
}

function typeSearch(text: string): void {
  fireEvent.change(searchBox(), { target: { value: text } });
}

function title(permission: Permission): string {
  return PermissionHelper.getTitle(permission);
}

beforeEach(() => {
  picks = [];
  for (const key of Object.keys(mockTranslations)) {
    delete mockTranslations[key];
  }
});

afterEach(() => {
  cleanup();
});

describe("Whole project, where it opens", () => {
  test("shows the four whole-project roles, each named and described by its one line", () => {
    render(<Harness />);

    expect(reachButton(RoleReach.WholeProject)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(reachButton(RoleReach.OneArea)).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    expect(wholeProjectNames()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]);

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]) {
      const radio: HTMLElement = screen.getByRole("radio", {
        name: title(permission),
      });

      expect(radio).toHaveAccessibleDescription(
        ROLE_CARD_SUMMARIES[permission] as string,
      );
      expect(radio).not.toBeChecked();
    }

    // Nothing else is on screen: no tiles, no area pick, no forty cards.
    expect(screen.queryByTestId("role-picker-areas")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.queryByText("Domain Roles")).toBeNull();
  });

  test("a row picks its role, and says so", () => {
    render(<Harness />);

    fireEvent.click(roleRow(Permission.ProjectMember));

    expect(lastPick()).toBe(Permission.ProjectMember);
    expect(
      screen.getByRole("radio", { name: title(Permission.ProjectMember) }),
    ).toBeChecked();
    expect(roleRow(Permission.ProjectMember)).toHaveAttribute(
      "data-checked",
      "true",
    );
    expect(roleRow(Permission.Viewer)).toHaveAttribute("data-checked", "false");

    fireEvent.click(roleRow(Permission.Viewer));

    expect(lastPick()).toBe(Permission.Viewer);
    expect(
      screen.getByRole("radio", { name: title(Permission.ProjectMember) }),
    ).not.toBeChecked();
  });

  /*
   * A row's line wrapped one way at rest and another once its check was
   * drawn beside it (Project Admin's took a second line), so picking it
   * grew the dialog under the pointer. Every row keeps the check's room.
   */
  test("every row keeps its check's room, picked or not, so a pick never re-wraps its line", () => {
    render(<Harness />);

    fireEvent.click(roleRow(Permission.ProjectAdmin));

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]) {
      const slot: HTMLElement = within(roleRow(permission)).getByTestId(
        "role-picker-role-check",
      );

      expect(slot.className).toContain("h-5 w-5 flex-shrink-0");
      // The check itself only on the row picked.
      expect({
        permission,
        drawn: slot.querySelectorAll("svg").length,
      }).toEqual({
        permission,
        drawn: permission === Permission.ProjectAdmin ? 1 : 0,
      });
    }
  });

  test("its radios are one group: one name, one stop for Tab", () => {
    render(<Harness />);

    const names: Set<string> = new Set(
      screen.getAllByRole("radio").map((radio: HTMLElement): string => {
        return radio.getAttribute("name") || "";
      }),
    );

    expect(names.size).toBe(1);
    expect(
      screen.getByRole("radiogroup", { name: "Whole project" }),
    ).toBeInTheDocument();
  });
});

describe("One area", () => {
  test("is twelve tiles, and under them what to do: pick an area, then a level", () => {
    render(<Harness />);

    fireEvent.click(reachButton(RoleReach.OneArea));

    expect(reachButton(RoleReach.OneArea)).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const group: HTMLElement = screen.getByRole("radiogroup", {
      name: "One area",
    });
    const tiles: Array<string> = within(group)
      .getAllByRole("radio")
      .map((radio: HTMLElement): string => {
        return radio.getAttribute("value") || "";
      });

    expect(tiles).toEqual(
      ROLE_AREAS.map((area: RoleArea): string => {
        return area.id;
      }),
    );

    for (const area of ROLE_AREAS) {
      expect(
        within(group).getByRole("radio", { name: area.title }),
      ).not.toBeChecked();
    }

    // Nothing picked yet, so nothing is handed back.
    expect(lastPick()).toBeNull();
    expect(screen.getByTestId("role-picker-picked")).toHaveAttribute(
      "data-picked",
      "false",
    );
    expect(pickedTitle()).toBe("Pick an area");
    expect(pickedSummary()).toBe("Then choose Admin, Member or Viewer.");

    // The level switch is there from the start, on Member.
    expect(levelButton(RoleLevel.Member)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("group", { name: "Access level" }),
    ).toBeInTheDocument();
  });

  test("a tile picks its area's Member role, named with its line", () => {
    render(<Harness />);

    fireEvent.click(reachButton(RoleReach.OneArea));
    fireEvent.click(areaTile(RoleAreaId.Incidents));

    expect(lastPick()).toBe(Permission.IncidentMember);
    expect(radioIn(areaTile(RoleAreaId.Incidents))).toBeChecked();
    expect(screen.getByTestId("role-picker-picked")).toHaveAttribute(
      "data-picked",
      "true",
    );
    expect(pickedTitle()).toBe("Incident Member");
    expect(pickedSummary()).toBe(
      ROLE_CARD_SUMMARIES[Permission.IncidentMember],
    );
  });

  test("the level switch makes it the area's Admin or Viewer, in place", () => {
    render(<Harness />);

    fireEvent.click(reachButton(RoleReach.OneArea));
    fireEvent.click(areaTile(RoleAreaId.Incidents));
    fireEvent.click(levelButton(RoleLevel.Viewer));

    expect(lastPick()).toBe(Permission.IncidentViewer);
    expect(pickedTitle()).toBe("Incident Viewer");
    expect(pickedSummary()).toBe("Read incidents. Change nothing.");
    expect(levelButton(RoleLevel.Viewer)).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(levelButton(RoleLevel.Admin));

    expect(lastPick()).toBe(Permission.IncidentAdmin);
    expect(pickedTitle()).toBe("Incident Admin");
  });

  test("another area keeps the level picked", () => {
    render(<Harness />);

    fireEvent.click(reachButton(RoleReach.OneArea));
    fireEvent.click(areaTile(RoleAreaId.Incidents));
    fireEvent.click(levelButton(RoleLevel.Viewer));
    fireEvent.click(areaTile(RoleAreaId.Alerts));

    expect(lastPick()).toBe(Permission.AlertViewer);
    expect(radioIn(areaTile(RoleAreaId.Incidents))).not.toBeChecked();
    expect(radioIn(areaTile(RoleAreaId.Alerts))).toBeChecked();
  });

  test("a level chosen before the area is the one the area gets", () => {
    render(<Harness />);

    fireEvent.click(reachButton(RoleReach.OneArea));
    fireEvent.click(levelButton(RoleLevel.Admin));

    // Choosing a level picks nothing on its own.
    expect(lastPick()).toBeNull();

    fireEvent.click(areaTile(RoleAreaId.Monitors));

    expect(lastPick()).toBe(Permission.MonitorAdmin);
  });

  /*
   * The panel under the tiles says one role's name and line at a time, and
   * lines run from one row to four (German, on a phone): it keeps the room
   * of the longest thing it could say, so a pick never grows or shrinks it.
   */
  test("the panel keeps the room of all it could say, out of sight and unread", () => {
    render(<Harness startOn={RoleReach.OneArea} />);

    const text: HTMLElement = screen.getByTestId("role-picker-picked-text");
    const rooms: Array<HTMLElement> = within(text).getAllByTestId(
      "role-picker-picked-room",
    );
    const areaRoles: Array<RolePickerRole> = getRolePickerRoles().filter(
      (role: RolePickerRole): boolean => {
        return role.place?.reach === RoleReach.OneArea;
      },
    );

    // The hint, then every area's three roles.
    expect(areaRoles).toHaveLength(36);
    expect(rooms).toHaveLength(37);
    expect(rooms[0]).toHaveTextContent(
      "Pick an areaThen choose Admin, Member or Viewer.",
    );
    areaRoles.forEach((role: RolePickerRole, index: number): void => {
      expect(rooms[index + 1]).toHaveTextContent(role.title + role.summary);
    });

    for (const room of rooms) {
      // Drawn in the same cell as the words on screen, never seen or read.
      expect(room.className).toContain("invisible col-start-1 row-start-1");
      expect(room).toHaveAttribute("aria-hidden", "true");
      expect(room.querySelector("[data-testid]")).toBeNull();
    }

    // What is said on screen sits in that cell too, read out as it changes.
    const said: HTMLElement = screen.getByTestId("role-picker-picked-title")
      .parentElement as HTMLElement;

    expect(said.parentElement).toBe(text);
    expect(said.className).toContain("col-start-1 row-start-1");
    expect(said).toHaveAttribute("aria-live", "polite");
    expect(text.className).toContain("grid");
  });

  test("the panel's room follows what is offered: a role left out is not measured", () => {
    render(
      <Harness
        startOn={RoleReach.OneArea}
        excludeRoles={[Permission.BillingAdmin]}
      />,
    );

    const rooms: Array<HTMLElement> = screen.getAllByTestId(
      "role-picker-picked-room",
    );

    expect(rooms).toHaveLength(36);
    expect(
      rooms.some((room: HTMLElement): boolean => {
        return (room.textContent || "").startsWith("Billing Admin");
      }),
    ).toBe(false);
  });

  test("its tiles are one group of radios, named by their areas", () => {
    render(<Harness startOn={RoleReach.OneArea} />);

    const names: Set<string> = new Set(
      within(screen.getByRole("radiogroup", { name: "One area" }))
        .getAllByRole("radio")
        .map((radio: HTMLElement): string => {
          return radio.getAttribute("name") || "";
        }),
    );

    expect(names.size).toBe(1);
  });
});

describe("the two answers", () => {
  test("each keep their own pick, and the one on screen is handed back", () => {
    render(<Harness />);

    fireEvent.click(roleRow(Permission.ProjectAdmin));
    expect(lastPick()).toBe(Permission.ProjectAdmin);

    // One area has no pick yet: nothing would be added.
    fireEvent.click(reachButton(RoleReach.OneArea));
    expect(lastPick()).toBeNull();

    fireEvent.click(areaTile(RoleAreaId.Billing));
    expect(lastPick()).toBe(Permission.BillingMember);

    fireEvent.click(reachButton(RoleReach.WholeProject));
    expect(lastPick()).toBe(Permission.ProjectAdmin);
    expect(
      screen.getByRole("radio", { name: title(Permission.ProjectAdmin) }),
    ).toBeChecked();

    fireEvent.click(reachButton(RoleReach.OneArea));
    expect(lastPick()).toBe(Permission.BillingMember);
    expect(radioIn(areaTile(RoleAreaId.Billing))).toBeChecked();
    expect(pickedTitle()).toBe("Billing Member");
  });

  test("pressing the answer already on screen changes nothing", () => {
    render(<Harness />);

    fireEvent.click(roleRow(Permission.Viewer));
    const before: number = picks.length;

    fireEvent.click(reachButton(RoleReach.WholeProject));

    expect(picks.length).toBe(before);
    expect(lastPick()).toBe(Permission.Viewer);
  });

  /*
   * The body is one cell holding the answer on screen and, out of sight
   * under it, the one that is not - so switching answers moves nothing (on
   * a phone the sheet grew or shrank by up to a hundred pixels). What keeps
   * that room is never read, reached by Tab or found by a test id.
   */
  test("the answer not on screen keeps its room out of sight: no radio, no test id, never read", () => {
    render(<Harness />);

    const body: HTMLElement = screen.getByTestId("role-picker-body");
    let rooms: Array<HTMLElement> = within(body).getAllByTestId(
      "role-picker-body-room",
    );

    expect(body.className).toContain("grid");
    // On Whole project, One area's tiles and panel keep their room.
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toHaveAttribute("aria-hidden", "true");
    expect(rooms[0]!.className).toContain("invisible col-start-1 row-start-1");
    expect(rooms[0]!.querySelectorAll("label")).toHaveLength(12);
    expect(rooms[0]!.querySelectorAll("input")).toHaveLength(0);
    expect(rooms[0]!.querySelectorAll("[id]")).toHaveLength(0);
    expect(
      rooms[0]!.querySelectorAll("[data-testid^='role-picker-area']"),
    ).toHaveLength(0);
    // Nothing of it is read: the radios on screen are the four rows.
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.queryAllByTestId("role-picker-picked-title")).toHaveLength(0);
    expect(screen.queryAllByTestId("role-picker-level-Member")).toHaveLength(0);

    // On One area, the four rows keep theirs.
    fireEvent.click(reachButton(RoleReach.OneArea));
    rooms = screen.getAllByTestId("role-picker-body-room");

    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.querySelectorAll("label")).toHaveLength(4);
    expect(rooms[0]!.querySelectorAll("input")).toHaveLength(0);
    expect(screen.queryAllByTestId(/^role-picker-role-/)).toHaveLength(0);
    expect(screen.getAllByRole("radio")).toHaveLength(12);

    // While a search lists matches, both answers keep their room.
    typeSearch("alert");

    expect(screen.getAllByTestId("role-picker-body-room")).toHaveLength(2);
  });

  test("a custom role's and a block's picker can open on One area", () => {
    render(<Harness startOn={RoleReach.OneArea} />);

    expect(reachButton(RoleReach.OneArea)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("role-picker-areas")).toBeInTheDocument();
    expect(picks).toEqual([]);
  });
});

/*
 * Every role of Permission can be reached and is handed back as itself -
 * a whole-project role by its row, an area's role by its tile and level.
 */
describe("every built-in role", () => {
  const roles: Array<RolePickerRole> = getRolePickerRoles();

  test("is offered: forty of them", () => {
    expect(roles).toHaveLength(
      PermissionHelper.getRolePermissionProps().length,
    );
    expect(roles).toHaveLength(40);
  });

  test.each(
    roles.map((role: RolePickerRole): [string, RolePickerRole] => {
      return [role.title, role];
    }),
  )(
    "%s can be picked, and is handed back as itself",
    (_title: string, role: RolePickerRole) => {
      render(<Harness />);

      if (role.place?.reach === RoleReach.OneArea) {
        fireEvent.click(reachButton(RoleReach.OneArea));
        fireEvent.click(areaTile(role.place.area!.id));
        fireEvent.click(levelButton(role.place.level!));

        expect(pickedTitle()).toBe(role.title);
        expect(pickedSummary()).toBe(role.summary);
      } else {
        fireEvent.click(roleRow(role.permission));

        expect(screen.getByRole("radio", { name: role.title })).toBeChecked();
      }

      expect(lastPick()).toBe(role.permission);
    },
  );

  test.each(
    roles.map((role: RolePickerRole): [string, RolePickerRole] => {
      return [role.title, role];
    }),
  )(
    "%s, held already (Edit), opens where it lives, picked",
    (_title: string, role: RolePickerRole) => {
      render(
        <Harness initial={role.permission} startOn={RoleReach.WholeProject} />,
      );

      if (role.place?.reach === RoleReach.OneArea) {
        expect(reachButton(RoleReach.OneArea)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(radioIn(areaTile(role.place.area!.id))).toBeChecked();
        expect(levelButton(role.place.level!)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(pickedTitle()).toBe(role.title);
      } else {
        expect(reachButton(RoleReach.WholeProject)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(screen.getByRole("radio", { name: role.title })).toBeChecked();
      }

      // Opening on it hands nothing back: the form already holds it.
      expect(picks).toEqual([]);
    },
  );
});

describe("a value set from outside", () => {
  test("moves the picker to it, wherever it lives", () => {
    const { rerender } = render(
      <RolePicker
        value={Permission.Viewer}
        onChange={(next: Permission | null): void => {
          picks.push(next);
        }}
      />,
    );

    expect(screen.getByRole("radio", { name: "Viewer" })).toBeChecked();

    rerender(
      <RolePicker
        value={Permission.TelemetryAdmin}
        onChange={(next: Permission | null): void => {
          picks.push(next);
        }}
      />,
    );

    expect(reachButton(RoleReach.OneArea)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(radioIn(areaTile(RoleAreaId.Telemetry))).toBeChecked();
    expect(pickedTitle()).toBe("Telemetry Admin");

    // Emptied - what an answer with no pick hands back - it stays put.
    rerender(
      <RolePicker
        value={null}
        onChange={(next: Permission | null): void => {
          picks.push(next);
        }}
      />,
    );

    expect(reachButton(RoleReach.OneArea)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(picks).toEqual([]);
  });

  test("a value that is not a role opens on the answer asked for, nothing picked", () => {
    render(
      <RolePicker
        value={Permission.ReadProjectIncident}
        startOn={RoleReach.OneArea}
        onChange={(next: Permission | null): void => {
          picks.push(next);
        }}
      />,
    );

    expect(reachButton(RoleReach.OneArea)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(pickedTitle()).toBe("Pick an area");
  });
});

describe("roles left out", () => {
  test("are nowhere: no row, and no match", () => {
    render(<Harness excludeRoles={PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE} />);

    expect(wholeProjectNames()).toEqual([
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]);
    expect(
      screen.queryByTestId(getRolePickerRoleTestId(Permission.ProjectOwner)),
    ).toBeNull();

    typeSearch("owner");

    expect(
      screen.queryByTestId(getRolePickerRoleTestId(Permission.ProjectOwner)),
    ).toBeNull();
  });
});

describe("the search", () => {
  test("is a search box beside the switch, saying what it searches", () => {
    render(<Harness />);

    expect(
      screen.getByRole("searchbox", { name: "Search roles" }),
    ).toHaveAttribute("placeholder", "Search roles");
  });

  test("lists the matches in place of the answer on screen, best first", () => {
    render(<Harness />);

    typeSearch("billing");

    const results: HTMLElement = screen.getByTestId("role-picker-results");
    const matches: Array<string> = within(results)
      .getAllByRole("radio")
      .map((radio: HTMLElement): string => {
        return radio.getAttribute("value") || "";
      });

    expect(matches.slice(0, 3)).toEqual([
      Permission.BillingAdmin,
      Permission.BillingMember,
      Permission.BillingViewer,
    ]);
    expect(screen.queryByTestId("role-picker-whole-project")).toBeNull();
    expect(
      within(results).getByRole("radio", { name: "Billing Viewer" }),
    ).toHaveAccessibleDescription(
      ROLE_CARD_SUMMARIES[Permission.BillingViewer] as string,
    );
  });

  test("a match picked is picked where it lives, and the matches stay", () => {
    render(<Harness />);

    typeSearch("billing viewer");
    fireEvent.click(roleRow(Permission.BillingViewer));

    expect(lastPick()).toBe(Permission.BillingViewer);
    expect(screen.getByTestId("role-picker-results")).toBeInTheDocument();
    expect(searchBox().value).toBe("billing viewer");

    // Cleared, it shows where the role lives: Billing, at Viewer.
    fireEvent.click(screen.getByTestId("role-picker-search-clear"));

    expect(searchBox().value).toBe("");
    expect(reachButton(RoleReach.OneArea)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(radioIn(areaTile(RoleAreaId.Billing))).toBeChecked();
    expect(levelButton(RoleLevel.Viewer)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.activeElement).toBe(searchBox());
  });

  test("Enter takes the first match, and never submits the form", () => {
    render(<Harness />);

    typeSearch("incident view");

    const notPrevented: boolean = fireEvent.keyDown(searchBox(), {
      key: "Enter",
    });

    expect(notPrevented).toBe(false);
    expect(lastPick()).toBe(Permission.IncidentViewer);
  });

  test("Enter with no match picks nothing", () => {
    render(<Harness />);

    typeSearch("zzz");
    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(picks).toEqual([]);
  });

  test("the down arrow moves into the matches, onto the one picked or the first", () => {
    render(<Harness />);

    typeSearch("monitor");
    fireEvent.keyDown(searchBox(), { key: "ArrowDown" });

    expect(document.activeElement).toBe(
      radioIn(roleRow(Permission.MonitorAdmin)),
    );

    fireEvent.click(roleRow(Permission.MonitorViewer));
    searchBox().focus();
    fireEvent.keyDown(searchBox(), { key: "ArrowDown" });

    expect(document.activeElement).toBe(
      radioIn(roleRow(Permission.MonitorViewer)),
    );
  });

  test("Escape clears the search, and goes no further: the dialog stays open", () => {
    const outerKeyDown: Mock<(event: React.KeyboardEvent) => void> =
      jest.fn<(event: React.KeyboardEvent) => void>();

    render(
      <div onKeyDown={outerKeyDown}>
        <Harness />
      </div>,
    );

    typeSearch("alert");
    fireEvent.keyDown(searchBox(), { key: "Escape" });

    expect(searchBox().value).toBe("");
    expect(outerKeyDown).not.toHaveBeenCalled();
    expect(screen.getByTestId("role-picker-whole-project")).toBeInTheDocument();

    // With nothing to clear, Escape is the dialog's again.
    fireEvent.keyDown(searchBox(), { key: "Escape" });

    expect(outerKeyDown).toHaveBeenCalledTimes(1);
  });

  test("no match says so, with a way back", () => {
    render(<Harness />);

    typeSearch("incident zebra");

    const empty: HTMLElement = screen.getByTestId("role-picker-no-results");

    expect(empty).toHaveTextContent("Nothing matches every word you typed.");

    fireEvent.click(
      within(empty).getByRole("button", { name: "Clear search" }),
    );

    expect(searchBox().value).toBe("");
    expect(screen.getByTestId("role-picker-whole-project")).toBeInTheDocument();
    expect(document.activeElement).toBe(searchBox());
  });

  /*
   * The matches come from both answers, so neither is pressed while they
   * are listed; pressing one - the one on screen before, too - goes back.
   */
  test("while it lists matches neither answer is pressed, and pressing one goes back to it", () => {
    render(<Harness />);

    fireEvent.click(roleRow(Permission.Viewer));
    typeSearch("alert");

    expect(reachButton(RoleReach.WholeProject)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(reachButton(RoleReach.OneArea)).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    const before: number = picks.length;

    fireEvent.click(reachButton(RoleReach.WholeProject));

    expect(searchBox().value).toBe("");
    expect(reachButton(RoleReach.WholeProject)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("role-picker-whole-project")).toBeInTheDocument();
    // Back on the answer that held the pick: it still holds it.
    expect(picks.length).toBe(before + 1);
    expect(lastPick()).toBe(Permission.Viewer);
    expect(
      screen.getByRole("radio", { name: title(Permission.Viewer) }),
    ).toBeChecked();
  });

  /*
   * A centred dialog that grew and shrank with each letter typed moved the
   * search box from under the caret: from sm up the matches scroll inside
   * the answers' room, its foot faded so a cut list reads as one that goes
   * on. On a phone the sheet's body scrolls them as one.
   */
  test("its matches scroll inside the answers' room from sm up, the foot faded", () => {
    render(<Harness />);

    const onScreen: HTMLElement = screen.getByTestId(
      "role-picker-body-on-screen",
    );

    expect(onScreen.className).not.toContain("sm:absolute");

    typeSearch("member");

    for (const token of [
      "sm:absolute",
      "sm:inset-0",
      "sm:overflow-y-auto",
      "sm:overscroll-contain",
      "sm:pb-6",
      "sm:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]",
    ]) {
      expect(onScreen.className.split(" ")).toContain(token);
    }
    // The room it scrolls in: both answers', kept out of sight.
    expect(screen.getAllByTestId("role-picker-body-room")).toHaveLength(2);
  });

  test("a match the arrow keys reach is scrolled into view whole, not just its radio", () => {
    const scrolled: Array<{ element: Element; options: unknown }> = [];
    const original: unknown = (
      HTMLElement.prototype as unknown as { scrollIntoView?: unknown }
    ).scrollIntoView;

    (
      HTMLElement.prototype as unknown as {
        scrollIntoView: (options?: unknown) => void;
      }
    ).scrollIntoView = function (this: Element, options?: unknown): void {
      scrolled.push({ element: this, options: options });
    };

    try {
      render(<Harness />);
      typeSearch("member");

      act(() => {
        radioIn(roleRow(Permission.MonitorMember)).focus();
      });

      expect(scrolled).toHaveLength(1);
      expect(scrolled[0]!.element).toBe(roleRow(Permission.MonitorMember));
      expect(scrolled[0]!.options).toEqual({ block: "nearest" });
    } finally {
      (
        HTMLElement.prototype as unknown as { scrollIntoView?: unknown }
      ).scrollIntoView = original;
    }
  });

  test("picking an answer clears the search", () => {
    render(<Harness />);

    typeSearch("alert");
    fireEvent.click(reachButton(RoleReach.OneArea));

    expect(searchBox().value).toBe("");
    expect(screen.getByTestId("role-picker-areas")).toBeInTheDocument();
  });

  test("a search as long as a book takes no time", () => {
    render(<Harness />);

    /*
     * Each attempt types a search of its own: typing the same text again
     * changes nothing, so the picker would not search, and a second attempt
     * would time nothing at all.
     */
    let attempt: number = 0;
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        attempt++;
        typeSearch(`${"monitor ".repeat(50000)}zzz${attempt}`);

        expect(
          screen.getByTestId("role-picker-no-results"),
        ).toBeInTheDocument();
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("what the form says", () => {
  test("a missing role is said under the picker, for a screen reader too", () => {
    render(<Harness error="Role is required." />);

    expect(screen.getByRole("alert")).toHaveTextContent("Role is required.");
  });

  test("nothing is said while there is nothing to say", () => {
    render(<Harness />);

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/*
 * A team's and a custom role's Add Role fold the Scope under More fields,
 * for a role that takes one: the form draws that line under the picker only
 * then. The picker keeps its room the rest of the time, so neither the first
 * pick nor a role without a scope moves the dialog.
 */
describe("the room of the form's More fields line", () => {
  test("is kept while asked for, as tall as the line and the gap above it", () => {
    render(<Harness keepsMoreFieldsRoom={true} />);

    const room: HTMLElement = screen.getByTestId("role-picker-room");

    // A flex column: the error's margin stays inside the room.
    expect(room.className).toBe("flex min-h-10 flex-col");
    expect(room).toBeEmptyDOMElement();
  });

  test("says a missing role inside it, so Add Role with nothing picked grows nothing", () => {
    render(<Harness keepsMoreFieldsRoom={true} error="Role is required." />);

    expect(
      within(screen.getByTestId("role-picker-room")).getByRole("alert"),
    ).toHaveTextContent("Role is required.");
  });

  test("is not kept unless asked: an API key's Add Role has no More fields", () => {
    render(<Harness error="Role is required." />);

    expect(screen.queryByTestId("role-picker-room")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Role is required.");
  });
});

describe("in the reader's language", () => {
  test("German: the answers, the areas, the levels and the lines", () => {
    for (const key of [
      "Whole project",
      "One area",
      "Admin",
      "Member",
      "Viewer",
      "Incidents",
      "Pick an area",
      "Then choose Admin, Member or Viewer.",
      "Search roles",
      "Access level",
      ROLE_CARD_SUMMARIES[Permission.IncidentViewer] as string,
      ROLE_CARD_SUMMARIES[Permission.Viewer] as string,
    ]) {
      expect({
        key,
        translated: Boolean(GERMAN[key]) && GERMAN[key] !== key,
      }).toEqual({
        key,
        translated: true,
      });
      mockTranslations[key] = GERMAN[key] as string;
    }

    render(<Harness />);

    expect(reachButton(RoleReach.WholeProject)).toHaveTextContent(
      "Ganzes Projekt",
    );
    expect(reachButton(RoleReach.OneArea)).toHaveTextContent("Ein Bereich");
    expect(searchBox()).toHaveAttribute("placeholder", "Rollen durchsuchen");
    expect(roleRow(Permission.Viewer)).toHaveTextContent(
      GERMAN[ROLE_CARD_SUMMARIES[Permission.Viewer] as string] as string,
    );

    fireEvent.click(reachButton(RoleReach.OneArea));

    expect(pickedTitle()).toBe("Bereich wählen");
    expect(pickedSummary()).toBe(
      "Dann Administrator, Mitglied oder Betrachter wählen.",
    );
    expect(levelButton(RoleLevel.Admin)).toHaveTextContent("Administrator");
    expect(levelButton(RoleLevel.Member)).toHaveTextContent("Mitglied");
    expect(levelButton(RoleLevel.Viewer)).toHaveTextContent("Betrachter");
    expect(
      screen.getByRole("group", { name: "Zugriffsstufe" }),
    ).toBeInTheDocument();
    expect(areaTile(RoleAreaId.Incidents)).toHaveTextContent("Vorfälle");

    fireEvent.click(areaTile(RoleAreaId.Incidents));
    fireEvent.click(levelButton(RoleLevel.Viewer));

    expect(pickedSummary()).toBe(
      GERMAN[ROLE_CARD_SUMMARIES[Permission.IncidentViewer] as string],
    );
    expect(lastPick()).toBe(Permission.IncidentViewer);
  });

  test("a German search finds a role by its German area and level", () => {
    for (const key of ["Incidents", "Viewer"]) {
      mockTranslations[key] = GERMAN[key] as string;
    }

    render(<Harness />);

    typeSearch("vorfälle betrachter");

    expect(
      within(screen.getByTestId("role-picker-results"))
        .getAllByRole("radio")[0]
        ?.getAttribute("value"),
    ).toBe(Permission.IncidentViewer);
  });
});

describe("the form field every Add Role uses", () => {
  test("draws the picker for the row's permission column, required, with no label of its own over it", () => {
    const field: ModelField<TeamPermission> =
      getRolePickerFormField<TeamPermission>();

    expect(field.field).toEqual({ permission: true });
    expect(field.title).toBe("Role");
    expect(field.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(field.customElementDrawsOwnLabel).toBe(true);
    expect(field.required).toBe(true);
    expect(field.description).toBeUndefined();
    expect(field.doNotShowWhenEditing).toBeUndefined();
    expect(field.onChange).toBeUndefined();
    expect(field.dataTestId).toBe(ROLE_PICKER_TEST_ID);
  });

  test("hands the picker the form's value, the error, and what it may offer, and the pick back to the form", () => {
    const onFieldChange: Mock<(value: unknown) => void> =
      jest.fn<(value: unknown) => void>();
    const field: ModelField<TeamPermission> =
      getRolePickerFormField<TeamPermission>({
        excludeRoles: PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE,
        startOn: RoleReach.OneArea,
        doNotShowWhenEditing: true,
        onChange: async (): Promise<void> => {},
      });

    expect(field.doNotShowWhenEditing).toBe(true);
    expect(field.onChange).toBeDefined();

    const props: CustomElementProps = {
      initialValue: Permission.AlertViewer,
      error: "Role is required.",
      onChange: (value: unknown): void => {
        onFieldChange(value);
      },
    };

    render(
      field.getCustomElement!(
        {} as FormValues<TeamPermission>,
        props,
      ) as ReactElement,
    );

    expect(screen.getByTestId(ROLE_PICKER_TEST_ID)).toBeInTheDocument();
    expect(radioIn(areaTile(RoleAreaId.Alerts))).toBeChecked();
    expect(levelButton(RoleLevel.Viewer)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Role is required.");

    fireEvent.click(reachButton(RoleReach.WholeProject));

    // Project Owner is left out.
    expect(
      screen.queryByTestId(getRolePickerRoleTestId(Permission.ProjectOwner)),
    ).toBeNull();

    act(() => {
      fireEvent.click(roleRow(Permission.ProjectAdmin));
    });

    expect(onFieldChange).toHaveBeenLastCalledWith(Permission.ProjectAdmin);
  });

  test("keeps the More fields room while the form does not draw that line for the role it holds", () => {
    const shownFor: Array<Permission | null> = [];
    const field: ModelField<TeamPermission> =
      getRolePickerFormField<TeamPermission>({
        isMoreFieldsShownFor: (permission: Permission | null): boolean => {
          shownFor.push(permission);
          return (
            Boolean(permission) &&
            PermissionHelper.isScopeApplicable(permission as Permission)
          );
        },
      });

    const draw: (initialValue: unknown) => void = (
      initialValue: unknown,
    ): void => {
      cleanup();
      render(
        field.getCustomElement!({} as FormValues<TeamPermission>, {
          initialValue: initialValue,
          onChange: (): void => {},
        }) as ReactElement,
      );
    };

    // Nothing picked: the form hands an empty field over as "" - none.
    draw("");
    expect(shownFor[shownFor.length - 1]).toBeNull();
    expect(screen.getByTestId("role-picker-room")).toBeInTheDocument();

    // Project Admin takes no scope: no line, so the room is kept.
    draw(Permission.ProjectAdmin);
    expect(screen.getByTestId("role-picker-room")).toBeInTheDocument();

    // Project Member takes one: the line is drawn in the room's place.
    draw(Permission.ProjectMember);
    expect(screen.queryByTestId("role-picker-room")).toBeNull();
    expect(shownFor[shownFor.length - 1]).toBe(Permission.ProjectMember);
  });

  test("keeps no room when the form folds nothing under it", () => {
    const field: ModelField<TeamPermission> =
      getRolePickerFormField<TeamPermission>({ doNotShowWhenEditing: true });

    render(
      field.getCustomElement!({} as FormValues<TeamPermission>, {
        initialValue: "",
        onChange: (): void => {},
      }) as ReactElement,
    );

    expect(screen.getByTestId(ROLE_PICKER_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByTestId("role-picker-room")).toBeNull();
  });
});
