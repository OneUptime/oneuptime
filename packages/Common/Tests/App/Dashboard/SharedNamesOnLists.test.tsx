import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A LIST OF RECORDS THAT MAY SHARE A NAME, MARKED (#9746).
 *
 * Teams, labels, on-call policies and on-call schedules named alike before
 * their names were one record's each keep their names, and every picker
 * draws them alike. Their lists (Components/SharedName/UseSharedNames):
 *
 *   - ask the server which records share a name each time they read their
 *     rows - never before, and the newest answer wins;
 *   - mark each such record with a pill beside its name, and no other;
 *   - say above the list how many there are and how to tell them apart,
 *     counted in the reader's plural forms, and say nothing while there
 *     are none, or when the server could not say;
 *   - give each marked row its Rename, as the row's button: hidden on a row
 *     no one renames (Owners, Admin), shown locked where the reader may not
 *     rename and the gate says why, and hidden where it does not;
 *   - rename in a dialog of the name alone, where a name another record has
 *     is said under the field, and read the list again once it is saved;
 *   - keep the Name column a name: it sorts, exports and reads its way as
 *     before, drawn as the list draws its names where that is more than
 *     their words (a label's coloured chip, #9856).
 *
 * Each kind's words are in every Dashboard language.
 */

const readMock: MockFunction = getJestMockFunction();
const checkMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SharedName/SharedNamesApi",
  () => {
    return {
      __esModule: true,
      default: {
        read: (...args: Array<unknown>) => {
          return readMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/PermissionGate", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/PermissionGate",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: {
      check: (...args: Array<unknown>) => {
        return checkMock(...args);
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import useSharedNames, {
  SharedNamesOfList,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SharedName/UseSharedNames";
import {
  SHARED_NAME_RENAME_BUTTON,
  SHARED_NAME_WORDS,
  SharedNameWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SharedName/SharedNameWords";
import Team from "../../../Models/DatabaseModels/Team";
import { SharedNameKind } from "../../../Types/Database/SharedNames";
import { isNameTakenRefusal } from "../../../Types/Database/UniqueName";
import { ModelAction } from "../../../UI/Utils/PermissionGate";
import { ActionButtonPlacement } from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { drawsItsOwnLines } from "../../../UI/Components/Table/ColumnLineText";
import FieldType from "../../../UI/Components/Types/FieldType";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ObjectID from "../../../Types/ObjectID";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

const TENANTS: string = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANTS_TWIN: string = "aaaaaaaa-0000-4000-8000-000000000002";
const PLATFORM: string = "aaaaaaaa-0000-4000-8000-000000000003";
const OWNERS: string = "aaaaaaaa-0000-4000-8000-000000000004";

const WORDS: SharedNameWords = SHARED_NAME_WORDS[SharedNameKind.Team];

function teamRow(
  id: string,
  name: string,
  options?: { isTeamEditable?: boolean },
): Team {
  const team: Team = new Team(new ObjectID(id));
  team.name = name;

  if (options?.isTeamEditable !== undefined) {
    team.isTeamEditable = options.isTeamEditable;
  }

  return team;
}

const ROWS: Array<Team> = [
  teamRow(TENANTS, "Tenants"),
  teamRow(TENANTS_TWIN, "tenants "),
  teamRow(PLATFORM, "Platform"),
  teamRow(OWNERS, "Owners", { isTeamEditable: false }),
];

// The hook as the list last drew it.
let latest: SharedNamesOfList<Team> | null = null;

function current(): SharedNamesOfList<Team> {
  if (!latest) {
    throw new Error("The list has not drawn yet.");
  }

  return latest;
}

const ListHarness: (props: {
  rows: Array<Team>;
  withCanRename?: boolean;
  withNameElement?: boolean;
}) => ReactElement = (props: {
  rows: Array<Team>;
  withCanRename?: boolean;
  withNameElement?: boolean;
}): ReactElement => {
  const shared: SharedNamesOfList<Team> = useSharedNames<Team>({
    kind: SharedNameKind.Team,
    modelType: Team,
    canRename: props.withCanRename
      ? (team: Team): boolean => {
          return team.isTeamEditable !== false;
        }
      : undefined,
    getNameElement: props.withNameElement
      ? (team: Team): ReactElement => {
          return <strong data-testid="drawn-name">{`[${team.name}]`}</strong>;
        }
      : undefined,
  });

  latest = shared;

  return (
    <div>
      {shared.note}
      {props.rows.map((row: Team): ReactElement => {
        return (
          <div key={row.id!.toString()} data-testid={`row-${row.id}`}>
            {shared.nameColumn.getElement!(row)}
          </div>
        );
      })}
    </div>
  );
};

async function listFetched(): Promise<void> {
  await act(async () => {
    current().onListFetched();
    await Promise.resolve();
  });
}

function pillOf(id: string): HTMLElement | null {
  return screen
    .getByTestId(`row-${id}`)
    .querySelector('[data-testid="shared-name-pill"]');
}

beforeEach(() => {
  latest = null;
  readMock.mockReset();
  checkMock.mockReset();
  checkMock.mockReturnValue({ isAllowed: true });
  readMock.mockResolvedValue({ groups: [[TENANTS, TENANTS_TWIN]] });
});

afterEach(() => {
  cleanup();
});

describe("which records share a name", () => {
  test("is asked when the list reads its rows, never before", async () => {
    render(<ListHarness rows={ROWS} />);

    expect(readMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("shared-names-note")).toBeNull();

    await listFetched();

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(readMock).toHaveBeenCalledWith(SharedNameKind.Team);
  });

  test("marks each record that shares its name, and no other", async () => {
    render(<ListHarness rows={ROWS} />);
    await listFetched();

    expect(pillOf(TENANTS)).not.toBeNull();
    expect(pillOf(TENANTS_TWIN)).not.toBeNull();
    expect(pillOf(PLATFORM)).toBeNull();
    expect(pillOf(OWNERS)).toBeNull();
    expect(pillOf(TENANTS)).toHaveTextContent(WORDS.pill);
    expect(current().isShared(ROWS[1]!)).toBe(true);
    expect(current().count).toBe(2);
  });

  test("draws the name as it is written beside its pill", async () => {
    render(<ListHarness rows={ROWS} />);
    await listFetched();

    expect(screen.getByTestId(`row-${TENANTS_TWIN}`)).toHaveTextContent(
      "tenants",
    );
  });

  test("says above the list how many, and how to tell them apart", async () => {
    render(<ListHarness rows={ROWS} />);
    await listFetched();

    expect(screen.getByTestId("shared-names-note")).toHaveTextContent(
      "2 teams have the same name as another team, and pickers can't tell them apart. Compare their members, then rename one.",
    );
  });

  test("counts one record in the one form", async () => {
    // Its twin is a team the reader may not read: it still holds the name.
    readMock.mockResolvedValue({ groups: [[PLATFORM]] });

    render(<ListHarness rows={ROWS} />);
    await listFetched();

    expect(screen.getByTestId("shared-names-note")).toHaveTextContent(
      "1 team has the same name as another team, and pickers can't tell them apart. Compare their members, then rename one.",
    );
  });

  test("says nothing while no record shares a name", async () => {
    readMock.mockResolvedValue({ groups: [] });

    render(<ListHarness rows={ROWS} />);
    await listFetched();

    expect(screen.queryByTestId("shared-names-note")).toBeNull();
    expect(pillOf(TENANTS)).toBeNull();
  });

  test("marks nothing when the server could not say", async () => {
    readMock.mockRejectedValue(new Error("Failed to fetch"));

    render(<ListHarness rows={ROWS} />);
    await listFetched();

    expect(screen.queryByTestId("shared-names-note")).toBeNull();
    expect(pillOf(TENANTS)).toBeNull();
  });

  test("the newest answer wins over an older one that answers late", async () => {
    let answerFirst: (value: unknown) => void = (): void => {};

    readMock
      .mockImplementationOnce((): Promise<unknown> => {
        return new Promise((resolve: (value: unknown) => void) => {
          answerFirst = resolve;
        });
      })
      .mockResolvedValueOnce({ groups: [] });

    render(<ListHarness rows={ROWS} />);
    await listFetched();
    await listFetched();

    await act(async () => {
      answerFirst({ groups: [[TENANTS, TENANTS_TWIN]] });
      await Promise.resolve();
    });

    expect(pillOf(TENANTS)).toBeNull();
    expect(screen.queryByTestId("shared-names-note")).toBeNull();
  });
});

describe("Rename, on a marked row", () => {
  test("is the row's button there, and on no other row", async () => {
    render(<ListHarness rows={ROWS} />);
    await listFetched();

    const action: SharedNamesOfList<Team>["renameAction"] =
      current().renameAction;

    expect(action.placement).toBe(ActionButtonPlacement.Primary);
    expect(action.title).toBe(WORDS.rename);
    expect(action.rowButtonTitle).toBe(SHARED_NAME_RENAME_BUTTON);
    expect(action.isVisible!(ROWS[0]!)).toBe(true);
    expect(action.isVisible!(ROWS[1]!)).toBe(true);
    expect(action.isVisible!(ROWS[2]!)).toBe(false);
  });

  test("is not offered on a team no one renames: its twin is the one to rename", async () => {
    readMock.mockResolvedValue({ groups: [[OWNERS, PLATFORM]] });

    render(<ListHarness rows={ROWS} withCanRename={true} />);
    await listFetched();

    expect(current().renameAction.isVisible!(ROWS[3]!)).toBe(false);
    expect(current().renameAction.isVisible!(ROWS[2]!)).toBe(true);
    // Still marked: the pill says why.
    expect(pillOf(OWNERS)).not.toBeNull();
  });

  test("is asked of the reader's permission to change the kind", async () => {
    render(<ListHarness rows={ROWS} />);
    await listFetched();

    expect(checkMock).toHaveBeenCalled();
    expect(checkMock.mock.calls[0]![0]).toBeInstanceOf(Team);
    expect(checkMock.mock.calls[0]![1]).toBe(ModelAction.Update);
  });

  test("is locked, saying why, for a reader who may not rename", async () => {
    checkMock.mockReturnValue({
      isAllowed: false,
      disabledReason: "You need Edit Team to do this.",
    });

    render(<ListHarness rows={ROWS} />);
    await listFetched();

    expect(current().renameAction.isVisible!(ROWS[0]!)).toBe(true);
    expect(current().renameAction.disabled).toBe(true);
    expect(current().renameAction.tooltip).toBe(
      "You need Edit Team to do this.",
    );
  });

  test("is hidden where the gate has nothing to say", async () => {
    checkMock.mockReturnValue({ isAllowed: false });

    render(<ListHarness rows={ROWS} />);
    await listFetched();

    expect(current().renameAction.isVisible!(ROWS[0]!)).toBe(false);
  });

  test("opens a dialog of the name alone, where a name another team has is said under the field", async () => {
    render(<ListHarness rows={ROWS} />);
    await listFetched();

    expect(current().renameModal).toBeNull();

    await act(async () => {
      current().renameAction.onClick(
        ROWS[1]!,
        () => {},
        () => {},
      );
    });

    const modal: ReactElement = current().renameModal!;
    const props: Record<string, any> = modal.props as Record<string, any>;

    expect(props["modelType"]).toBe(Team);
    expect(props["modelIdToEdit"].toString()).toBe(TENANTS_TWIN);
    expect(props["title"]).toBe(WORDS.rename);
    expect(props["description"]).toBe(WORDS.renameDescription);
    expect(props["submitButtonText"]).toBe(WORDS.rename);
    expect(props["formProps"]["formType"]).toBe(FormType.Update);
    expect(props["formProps"]["fields"]).toHaveLength(1);

    const field: Record<string, any> = props["formProps"]["fields"][0];

    expect(field["field"]).toEqual({ name: true });
    expect(field["required"]).toBe(true);
    expect(field["ownsServerError"]).toBe(isNameTakenRefusal);
  });

  test("once saved, closes and reads the list again", async () => {
    render(<ListHarness rows={ROWS} />);
    await listFetched();

    const before: string = current().refreshToken;

    await act(async () => {
      current().renameAction.onClick(
        ROWS[1]!,
        () => {},
        () => {},
      );
    });

    await act(async () => {
      (current().renameModal!.props as { onSuccess: () => void }).onSuccess();
    });

    expect(current().renameModal).toBeNull();
    expect(current().refreshToken).not.toBe(before);
  });

  test("closed without saving, reads nothing again", async () => {
    render(<ListHarness rows={ROWS} />);
    await listFetched();

    const before: string = current().refreshToken;

    await act(async () => {
      current().renameAction.onClick(
        ROWS[1]!,
        () => {},
        () => {},
      );
    });

    await act(async () => {
      (current().renameModal!.props as { onClose: () => void }).onClose();
    });

    expect(current().renameModal).toBeNull();
    expect(current().refreshToken).toBe(before);
  });
});

describe("the Name column", () => {
  test("drawn as the list draws its names, keeps the pill beside them", async () => {
    render(<ListHarness rows={ROWS} withNameElement={true} />);
    await listFetched();

    const twin: HTMLElement = screen.getByTestId(`row-${TENANTS_TWIN}`);

    expect(twin.querySelector('[data-testid="drawn-name"]')).toHaveTextContent(
      "[tenants ]",
    );
    expect(pillOf(TENANTS_TWIN)).toHaveTextContent(WORDS.pill);
    expect(
      screen
        .getByTestId(`row-${PLATFORM}`)
        .querySelector('[data-testid="drawn-name"]'),
    ).toHaveTextContent("[Platform]");
    expect(pillOf(PLATFORM)).toBeNull();

    // Still a name to export, whatever the cell draws.
    expect(current().nameColumn.getExportValue!(ROWS[1]!)).toBe("tenants ");
  });

  test("is a name: it sorts by it, exports it and reads its way", async () => {
    render(<ListHarness rows={ROWS} />);

    const column: SharedNamesOfList<Team>["nameColumn"] = current().nameColumn;

    expect(column.field).toEqual({ name: true });
    expect(column.title).toBe("Name");
    expect(column.type).toBe(FieldType.Element);
    expect(column.disableSort).toBeUndefined();
    expect(column.getLineText).toBe(drawsItsOwnLines);
    expect(column.getExportValue!(ROWS[1]!)).toBe("tenants ");
  });
});

describe("the words", () => {
  test("every kind has its own", () => {
    for (const kind of Object.values(SharedNameKind)) {
      const words: SharedNameWords = SHARED_NAME_WORDS[kind];

      expect(words.pill.length).toBeGreaterThan(0);
      expect(words.pillTooltip.endsWith(".")).toBe(true);
      expect(words.note.one).toContain("{{count}}");
      expect(words.note.other).toContain("{{count}}");
      expect(words.renameDescription.endsWith(".")).toBe(true);
    }
  });

  test.each(DASHBOARD_LANGUAGES)("are worded in %s", (language: string) => {
    const locale: Record<string, string> = readDashboardLocale(language);

    for (const kind of Object.values(SharedNameKind)) {
      const words: SharedNameWords = SHARED_NAME_WORDS[kind];

      for (const key of [
        words.pill,
        words.pillTooltip,
        words.note.other,
        words.rename,
        words.renameDescription,
      ]) {
        expect({
          key,
          worded: Boolean(locale[key]) && locale[key] !== key,
        }).toEqual({ key, worded: true });
      }

      expect(locale[`${words.note.other}_one`]).toBeTruthy();
    }
  });
});
