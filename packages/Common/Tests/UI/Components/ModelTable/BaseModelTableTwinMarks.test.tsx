import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

configure({ asyncUtilTimeout: 15000 });

/*
 * EVERY LIST OF A KIND REQUIRE UNIQUE NAMES HOLDS MARKS ITS TWINS (#11021).
 *
 * The shared list (BaseModelTable, TwinMarks) marks a record whose name
 * another record of its kind has - "Same name as another monitor", with the
 * day it was made - and says above the list how many there are, for every
 * kind a model marks @UniqueNameWhenRequired, so a kind marked tomorrow is
 * marked in its list with no line of its own. Pinned here:
 *
 *   - every such kind, read from the models, is marked in a list of it;
 *   - which records are twins is read from the server after the rows are
 *     (GET /shared-names/<Table>), never for a kind the setting does not
 *     hold, a list that does not show the kind's name, or outside a
 *     project; a failure marks nothing, and the list works as ever;
 *   - only the records the answer names are marked; every other row draws
 *     exactly as it did, and its name reads its way as before;
 *   - a name drawn by the list's own element is marked beside it;
 *   - twins made the same day are told apart by the moment;
 *   - the words are the reader's: German here.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          permissions: permissionsForTest.map((permission: unknown) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        };
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import {
  TWIN_MARKS_NOTE,
  TWIN_MARKS_NOTE_TEST_ID,
  TWIN_MARK_CREATED,
  TWIN_MARK_CREATED_TEST_ID,
  TWIN_MARK_PILL,
  TWIN_MARK_PILL_TEST_ID,
  TWIN_MARK_TOOLTIP,
} from "../../../../UI/Components/ModelTable/TwinMarkWords";
import FieldType from "../../../../UI/Components/Types/FieldType";
import ProjectUtil from "../../../../UI/Utils/Project";
import {
  writeReaderDay,
  writeReaderMoment,
} from "../../../../UI/Utils/ReaderMoments";
import {
  getGlobalTranslator,
  translatableTerm,
  Translator,
} from "../../../../UI/Utils/TranslateTemplate";
import UniqueNamesApi from "../../../../UI/Utils/UniqueNamesApi";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Team from "../../../../Models/DatabaseModels/Team";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import OneUptimeDate from "../../../../Types/Date";
import { SharedNamesAnswer } from "../../../../Types/Database/SharedNames";
import { getUniqueNameWhenRequiredColumn } from "../../../../Types/Database/UniqueNameWhenRequired";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import { getJestSpyOn } from "../../../Spy";

const PROJECT_ID: string = "9a9a9a9a-0000-4000-8000-000000011021";
const TWIN_A: string = "aaaaaaaa-0000-4000-8000-000000011021";
const TWIN_B: string = "bbbbbbbb-0000-4000-8000-000000011021";
const OTHER: string = "cccccccc-0000-4000-8000-000000011021";

const CREATED_A: string = "2026-03-02T10:00:00.000Z";
const CREATED_B: string = "2026-09-14T08:30:00.000Z";

const TWINS: SharedNamesAnswer = {
  groups: [[TWIN_A, TWIN_B]],
  createdAt: { [TWIN_A]: CREATED_A, [TWIN_B]: CREATED_B },
};

type ModelType = { new (): BaseModel };

// Every kind Require Unique Names holds, read from the models.
const HELD_KINDS: Array<{
  tableName: string;
  modelType: ModelType;
  column: string;
}> = AllModelTypes.map((modelType: ModelType) => {
  return {
    tableName: new modelType().tableName || "",
    modelType: modelType,
    column: getUniqueNameWhenRequiredColumn(modelType) || "",
  };
})
  .filter((kind: { column: string }): boolean => {
    return Boolean(kind.column);
  })
  .sort((a: { tableName: string }, b: { tableName: string }): number => {
    return a.tableName.localeCompare(b.tableName);
  });

let readSharedNames: jest.SpyInstance;

function row(
  modelType: ModelType,
  column: string,
  id: string,
  name: string,
): BaseModel {
  const model: BaseModel = new modelType();
  model._id = id;
  (model as unknown as Record<string, unknown>)[column] = name;
  return model;
}

function rowsOf(modelType: ModelType, column: string): Array<BaseModel> {
  return [
    row(modelType, column, TWIN_A, "API Health Check"),
    row(modelType, column, TWIN_B, "api health check"),
    row(modelType, column, OTHER, "Checkout"),
  ];
}

function listOf(data: {
  modelType: ModelType;
  column: string;
  rows?: Array<BaseModel> | undefined;
  getElement?: ((item: BaseModel) => ReactElement) | undefined;
  showsName?: boolean | undefined;
}): ReactElement {
  const rows: Array<BaseModel> =
    data.rows || rowsOf(data.modelType, data.column);

  const callbacks: BaseTableCallbacks<BaseModel> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): BaseModel => {
      return item as unknown as BaseModel;
    },
    getJSONFromModel: (item: BaseModel): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (list: {
      skip: number;
      limit: number;
    }): Promise<ListResult<BaseModel>> => {
      return {
        data: rows,
        count: rows.length,
        skip: list.skip,
        limit: list.limit,
      };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): ReactElement => {
      return <div />;
    },
  } as unknown as BaseTableCallbacks<BaseModel>;

  const props: BaseModelTableProps<BaseModel> = {
    modelType: data.modelType,
    id: "twin-marks-table",
    name: "Twin marks",
    userPreferencesKey: "twin-marks-table",
    urlStateKey: "twin-marks-table",
    columns: [
      data.showsName === false
        ? {
            field: { _id: true },
            title: "ID",
            type: FieldType.Text,
          }
        : {
            field: { [data.column]: true },
            title: "Name",
            type: data.getElement ? FieldType.Element : FieldType.Text,
            ...(data.getElement ? { getElement: data.getElement } : {}),
          },
    ],
    filters: [],
    cardProps: { title: "Records", description: "The project's records." },
    isCreateable: false,
    isEditable: false,
    isDeleteable: false,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<BaseModel>;

  return <BaseModelTable<BaseModel> {...props} />;
}

function rowOf(id: string): HTMLElement {
  const name: string =
    id === TWIN_A
      ? "API Health Check"
      : id === TWIN_B
        ? "api health check"
        : "Checkout";

  return screen.getAllByText(name)[0]!.closest("tr")!;
}

function readText(element: Element): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function english(): Translator {
  return getGlobalTranslator();
}

function pillOf(modelType: ModelType): string {
  return english().translateTemplate(TWIN_MARK_PILL, {
    kind: translatableTerm(new modelType().singularName || "", {
      inSentence: true,
    }),
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectOwner];
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  readSharedNames = getJestSpyOn(
    UniqueNamesApi,
    "readSharedNames",
  ).mockResolvedValue(TWINS);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("every kind Require Unique Names holds", () => {
  test("is dozens of kinds, read from the models", () => {
    expect(HELD_KINDS.length).toBeGreaterThan(40);
    expect(
      HELD_KINDS.map((kind: { tableName: string }): string => {
        return kind.tableName;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Monitor",
        "MonitorGroup",
        "ApiKey",
        "IncidentTemplate",
        "AIAgent",
      ]),
    );
  });

  test.each(HELD_KINDS)(
    "$tableName: its list marks its twins, and nothing else",
    async (kind: {
      tableName: string;
      modelType: ModelType;
      column: string;
    }) => {
      render(listOf({ modelType: kind.modelType, column: kind.column }));

      await waitFor(() => {
        expect(screen.getAllByTestId(TWIN_MARK_PILL_TEST_ID)).toHaveLength(2);
      });

      // Asked once, for this kind, by its table's name.
      expect(readSharedNames).toHaveBeenCalledTimes(1);
      expect(readSharedNames).toHaveBeenCalledWith(kind.tableName);

      for (const id of [TWIN_A, TWIN_B]) {
        const pill: HTMLElement = within(rowOf(id)).getByTestId(
          TWIN_MARK_PILL_TEST_ID,
        );

        expect(readText(pill)).toBe(pillOf(kind.modelType));
      }

      // The day each was made, to tell them apart.
      expect(
        readText(within(rowOf(TWIN_A)).getByTestId(TWIN_MARK_CREATED_TEST_ID)),
      ).toBe(
        english().translateTemplate(TWIN_MARK_CREATED, {
          date: writeReaderDay(OneUptimeDate.fromString(CREATED_A)),
        }),
      );

      // The record no other shares its name with is drawn as it was.
      expect(
        within(rowOf(OTHER)).queryByTestId(TWIN_MARK_PILL_TEST_ID),
      ).toBeNull();

      // One note above the list, counting them.
      expect(screen.getAllByTestId(TWIN_MARKS_NOTE_TEST_ID)).toHaveLength(1);
    },
  );
});

describe("the words", () => {
  test("a monitor's twins: the pill, its tip, the day, and the note in English", async () => {
    render(listOf({ modelType: Monitor, column: "name" }));

    await waitFor(() => {
      expect(screen.getAllByTestId(TWIN_MARK_PILL_TEST_ID)).toHaveLength(2);
    });

    expect(
      readText(within(rowOf(TWIN_A)).getByTestId(TWIN_MARK_PILL_TEST_ID)),
    ).toBe("Same name as another monitor");
    expect(
      english().translateTemplate(TWIN_MARK_TOOLTIP, {
        kind: translatableTerm("Monitor", { inSentence: true }),
      }),
    ).toBe(
      "Another monitor in this project has this name, so pickers can't tell them apart. Open each to see which is which, then rename one.",
    );
    expect(readText(screen.getByTestId(TWIN_MARKS_NOTE_TEST_ID))).toBe(
      "2 monitors have the same name as another monitor, and pickers can't tell them apart. Open each to see which is which, then rename one.",
    );
    expect(
      readText(within(rowOf(TWIN_B)).getByTestId(TWIN_MARK_CREATED_TEST_ID)),
    ).toBe(`Created ${writeReaderDay(OneUptimeDate.fromString(CREATED_B))}`);
  });

  test("an API key's: its name as a sentence writes it, its letters kept", async () => {
    const apiKey: { modelType: ModelType; column: string } = HELD_KINDS.find(
      (kind: { tableName: string }): boolean => {
        return kind.tableName === "ApiKey";
      },
    )!;

    render(listOf(apiKey));

    await waitFor(() => {
      expect(screen.getAllByTestId(TWIN_MARK_PILL_TEST_ID)).toHaveLength(2);
    });

    expect(
      readText(within(rowOf(TWIN_A)).getByTestId(TWIN_MARK_PILL_TEST_ID)),
    ).toBe("Same name as another API key");
  });

  test("the note counts every twin the reader may read, on this page or another, in its plural forms", async () => {
    readSharedNames.mockResolvedValue({
      groups: [
        [TWIN_A, TWIN_B],
        [
          "dddddddd-0000-4000-8000-000000011021",
          "eeeeeeee-0000-4000-8000-000000011021",
          "ffffffff-0000-4000-8000-000000011021",
        ],
      ],
      createdAt: {},
    });

    render(listOf({ modelType: Monitor, column: "name" }));

    await waitFor(() => {
      expect(screen.getByTestId(TWIN_MARKS_NOTE_TEST_ID)).toBeInTheDocument();
      expect(screen.getAllByTestId(TWIN_MARK_PILL_TEST_ID)).toHaveLength(2);
    });

    expect(readText(screen.getByTestId(TWIN_MARKS_NOTE_TEST_ID))).toBe(
      english().translatePlural(TWIN_MARKS_NOTE, 5, {
        kind: translatableTerm("Monitor", { inSentence: true }),
        kinds: translatableTerm("Monitors", { inSentence: true }),
      }),
    );
    expect(readText(screen.getByTestId(TWIN_MARKS_NOTE_TEST_ID))).toContain(
      "5 monitors have the same name as another monitor",
    );
    // Two of them on this page, each marked; no date said, none shown.
    expect(screen.getAllByTestId(TWIN_MARK_PILL_TEST_ID)).toHaveLength(2);
    expect(screen.queryByTestId(TWIN_MARK_CREATED_TEST_ID)).toBeNull();
  });

  test("twins made the same day are told apart by the moment", async () => {
    readSharedNames.mockResolvedValue({
      groups: [[TWIN_A, TWIN_B]],
      createdAt: {
        [TWIN_A]: "2026-09-14T08:30:00.000Z",
        [TWIN_B]: "2026-09-14T08:45:00.000Z",
      },
    });

    render(listOf({ modelType: Monitor, column: "name" }));

    await waitFor(() => {
      expect(screen.getAllByTestId(TWIN_MARK_CREATED_TEST_ID)).toHaveLength(2);
    });

    expect(
      readText(within(rowOf(TWIN_A)).getByTestId(TWIN_MARK_CREATED_TEST_ID)),
    ).toBe(
      `Created ${writeReaderMoment(OneUptimeDate.fromString("2026-09-14T08:30:00.000Z"))}`,
    );
    expect(
      readText(within(rowOf(TWIN_B)).getByTestId(TWIN_MARK_CREATED_TEST_ID)),
    ).toBe(
      `Created ${writeReaderMoment(OneUptimeDate.fromString("2026-09-14T08:45:00.000Z"))}`,
    );
  });
});

describe("when nothing is read", () => {
  test.each([
    ["an incident: names repeat by design", Incident, "title"],
    ["a team: unique always, marked by its own page", Team, "name"],
  ])("%s", async (_label: string, modelType: unknown, column: string) => {
    render(listOf({ modelType: modelType as ModelType, column: column }));

    await waitFor(() => {
      expect(screen.getAllByText("Checkout").length).toBeGreaterThan(0);
    });
    await settle();

    expect(readSharedNames).not.toHaveBeenCalled();
    expect(screen.queryByTestId(TWIN_MARK_PILL_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(TWIN_MARKS_NOTE_TEST_ID)).toBeNull();
  });

  test("a list that does not show the kind's name: nowhere to mark, nothing asked", async () => {
    render(listOf({ modelType: Monitor, column: "name", showsName: false }));

    await waitFor(() => {
      expect(screen.getAllByText(TWIN_A).length).toBeGreaterThan(0);
    });
    await settle();

    expect(readSharedNames).not.toHaveBeenCalled();
  });

  test("outside a project: nothing asked", async () => {
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    render(listOf({ modelType: Monitor, column: "name" }));

    await waitFor(() => {
      expect(screen.getAllByText("Checkout").length).toBeGreaterThan(0);
    });
    await settle();

    expect(readSharedNames).not.toHaveBeenCalled();
    expect(screen.queryByTestId(TWIN_MARK_PILL_TEST_ID)).toBeNull();
  });

  test("an empty list asks nothing", async () => {
    render(listOf({ modelType: Monitor, column: "name", rows: [] }));
    await settle();
    await settle();

    expect(readSharedNames).not.toHaveBeenCalled();
    expect(screen.queryByTestId(TWIN_MARKS_NOTE_TEST_ID)).toBeNull();
  });

  test("a failure marks nothing, and the list works as ever", async () => {
    readSharedNames.mockRejectedValue(new Error("Network down"));

    render(listOf({ modelType: Monitor, column: "name" }));

    await waitFor(() => {
      expect(readSharedNames).toHaveBeenCalledTimes(1);
    });
    await settle();

    expect(screen.getAllByText("API Health Check").length).toBeGreaterThan(0);
    expect(screen.queryByTestId(TWIN_MARK_PILL_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(TWIN_MARKS_NOTE_TEST_ID)).toBeNull();
  });

  test("no twins: the list draws exactly as it did", async () => {
    readSharedNames.mockResolvedValue({ groups: [], createdAt: {} });

    const { container } = render(
      listOf({ modelType: Monitor, column: "name" }),
    );

    await waitFor(() => {
      expect(readSharedNames).toHaveBeenCalledTimes(1);
    });
    await settle();

    // The ids React makes for each draw's checkboxes aside.
    const drawn: (element: HTMLElement) => string = (
      element: HTMLElement,
    ): string => {
      return element.innerHTML.replace(/:r[0-9a-z]+:/g, ":r:");
    };

    const withNone: string = drawn(rowOf(OTHER));

    cleanup();
    readSharedNames.mockResolvedValue(TWINS);
    render(listOf({ modelType: Monitor, column: "name" }));

    await waitFor(() => {
      expect(screen.getAllByTestId(TWIN_MARK_PILL_TEST_ID)).toHaveLength(2);
    });

    // A row no other shares its name with is drawn as it was without twins.
    expect(drawn(rowOf(OTHER))).toBe(withNone);
    expect(container).toBeDefined();
  });
});

describe("a name the list draws itself", () => {
  test("is marked beside its own element, which is kept", async () => {
    render(
      listOf({
        modelType: IncidentTemplate,
        column: "templateName",
        getElement: (item: BaseModel): ReactElement => {
          return (
            <a href="#template" data-testid="template-link">
              {(item as unknown as Record<string, string>)["templateName"]}
            </a>
          );
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getAllByTestId(TWIN_MARK_PILL_TEST_ID)).toHaveLength(2);
    });

    // Every row keeps the list's own element.
    expect(screen.getAllByTestId("template-link")).toHaveLength(3);
    expect(
      within(rowOf(TWIN_A)).getByTestId("template-link"),
    ).toHaveTextContent("API Health Check");
    expect(
      readText(within(rowOf(TWIN_A)).getByTestId(TWIN_MARK_PILL_TEST_ID)),
    ).toBe("Same name as another incident template");
    expect(
      within(rowOf(OTHER)).queryByTestId(TWIN_MARK_PILL_TEST_ID),
    ).toBeNull();
  });
});

describe("in German", () => {
  const DE: Record<string, string> = readDashboardLocale("de");

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: "en",
      resources: { de: { translation: DE } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    await act(async () => {
      await i18next.changeLanguage("de");
    });
  });

  afterAll(async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });
  });

  test("the pill and the note read in German, the kind in German", async () => {
    render(listOf({ modelType: Monitor, column: "name" }));

    await waitFor(() => {
      expect(screen.getAllByTestId(TWIN_MARK_PILL_TEST_ID)).toHaveLength(2);
    });

    const pill: string = readText(
      within(rowOf(TWIN_A)).getByTestId(TWIN_MARK_PILL_TEST_ID),
    );
    const note: string = readText(screen.getByTestId(TWIN_MARKS_NOTE_TEST_ID));

    // Worded by the German file, not English.
    expect(DE[TWIN_MARK_PILL]).toBeTruthy();
    expect(DE[TWIN_MARK_PILL]).not.toBe(TWIN_MARK_PILL);
    expect(pill).not.toContain("Same name as another");
    expect(pill).toContain("Monitor");
    expect(note).not.toContain("have the same name");
    expect(note).toContain("2");
  });
});
