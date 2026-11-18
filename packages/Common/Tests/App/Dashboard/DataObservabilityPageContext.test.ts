import PageContextUtil, {
  DashboardPageContext,
  SuggestedQuestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import AIChatPageContextType, {
  AIChatPageContextHelper,
} from "../../../Types/AI/AIChatPageContext";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ASK AI ON A DATA OBSERVABILITY TABLE'S PAGE KNOWS WHICH TABLE "THIS
 * TABLE" IS (#6735).
 *
 * A table's pages - its overview, its Lineage tab and every other tab - are
 * about that table: Ask AI is told its ID and its schema.table name, read
 * with the viewer's own grants, so "what feeds this table?" and "is it
 * fresh?" reach get_data_table_lineage and get_data_table_freshness with
 * the page's table, even when several databases have a table of that name.
 * The chip names the table, and four questions people ask about a table
 * are offered, in every language. Another product's page, or a list of
 * tables, is no table.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const TABLE_ID: string = "20000000-0000-4000-8000-000000000042";

const TABLE_CONTEXT: DashboardPageContext = {
  type: AIChatPageContextType.DataTable,
  entityId: TABLE_ID,
  noun: "table",
  chipLabel: "This table",
  icon: IconProp.TableCells,
  isEntity: true,
};

function navigateTo(pathname: string): void {
  Navigation.setLocation({
    pathname,
    search: "",
    hash: "",
    state: null,
    key: "data-observability-page-context-test",
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which page is a table's", () => {
  test.each([
    "",
    "/columns",
    "/metrics",
    "/timeline",
    "/services",
    "/checks",
    "/lineage",
    "/owners",
    "/settings",
    "/audit-logs",
    "/delete",
  ])("a table's page (%s) is the table itself", (suffix: string) => {
    navigateTo(
      `/dashboard/${PROJECT_ID}/data-observability/tables/${TABLE_ID}${suffix}`,
    );

    expect(PageContextUtil.detectPageContext()).toEqual(TABLE_CONTEXT);
  });

  test.each([
    "/tables",
    // An address segment is no table: the unused tables are a list.
    "/tables/unused",
    "/overview",
    "/issues",
    "/lineage-map",
    "/pipelines",
  ])(
    "Data Observability's other pages (%s) are about no one table",
    (suffix: string) => {
      navigateTo(`/dashboard/${PROJECT_ID}/data-observability${suffix}`);

      expect(PageContextUtil.detectPageContext()?.type).not.toBe(
        AIChatPageContextType.DataTable,
      );
    },
  );

  test.each([
    `/dashboard/${PROJECT_ID}/data-security/stores/${TABLE_ID}`,
    `/dashboard/${PROJECT_ID}/incidents/${TABLE_ID}`,
    `/dashboard/${PROJECT_ID}/monitors/${TABLE_ID}`,
  ])("another product's page (%s) is no table", (pathname: string) => {
    navigateTo(pathname);

    expect(PageContextUtil.detectPageContext()?.type).not.toBe(
      AIChatPageContextType.DataTable,
    );
  });

  test("a table is a record: its ID is sent, checked as one", () => {
    expect(
      AIChatPageContextHelper.isEntityType(AIChatPageContextType.DataTable),
    ).toBe(true);
    expect(
      AIChatPageContextHelper.sanitize({
        type: AIChatPageContextType.DataTable,
        entityId: TABLE_ID,
        entityTitle: "public.orders",
      }),
    ).toEqual({
      type: AIChatPageContextType.DataTable,
      entityId: TABLE_ID,
      entityTitle: "public.orders",
    });
    // Without an ID it says nothing of which table.
    expect(
      AIChatPageContextHelper.sanitize({
        type: AIChatPageContextType.DataTable,
      }),
    ).toBeUndefined();
  });
});

describe("the table's name in Ask AI", () => {
  test("by its schema.table key, read with the viewer's own grants", async () => {
    const table: DataAsset = new DataAsset();
    table.assetKey = "public.orders";
    table.name = "orders";
    const getItem: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(table);

    expect(await PageContextUtil.resolveEntityTitle(TABLE_CONTEXT)).toBe(
      "public.orders",
    );
    expect(getItem).toHaveBeenCalledWith({
      modelType: DataAsset,
      id: new ObjectID(TABLE_ID),
      select: { assetKey: true, name: true },
    });
  });

  test("a table with no key yet: by its name", async () => {
    const table: DataAsset = new DataAsset();
    table.name = "orders";
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(table);

    expect(await PageContextUtil.resolveEntityTitle(TABLE_CONTEXT)).toBe(
      "orders",
    );
  });

  test("a table the viewer may not read leaves the plain label: nothing of it is told", async () => {
    jest.spyOn(ModelAPI, "getItem").mockRejectedValue(new Error("No access"));

    expect(await PageContextUtil.resolveEntityTitle(TABLE_CONTEXT)).toBeNull();
  });

  test("the wire carries the table's ID and name", () => {
    expect(
      PageContextUtil.toRequestPayload({
        ...TABLE_CONTEXT,
        entityTitle: "public.orders",
      }),
    ).toEqual({
      type: AIChatPageContextType.DataTable,
      entityId: TABLE_ID,
      entityTitle: "public.orders",
    });
  });
});

describe("the questions it offers on a table's page", () => {
  const questions: Array<SuggestedQuestion> =
    PageContextUtil.getSuggestions(TABLE_CONTEXT);

  test("four distinct questions, about this table", () => {
    expect(questions).toHaveLength(4);
    expect(
      new Set(
        questions.map((question: SuggestedQuestion): string => {
          return question.title;
        }),
      ).size,
    ).toBe(4);

    for (const question of questions) {
      expect(question.question).toContain("this table");
    }
  });

  test("what it is built from, what breaks, whether it is fresh: the lineage and freshness tools answer them", () => {
    const text: string = questions
      .map((question: SuggestedQuestion): string => {
        return question.question;
      })
      .join(" ");

    expect(text).toContain("built from");
    expect(text).toContain("What breaks if this table stops loading");
    expect(text).toContain("Is this table fresh");
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every title and question",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const untranslated: Array<string> = questions
        .flatMap((question: SuggestedQuestion): Array<string> => {
          return [question.title, question.question];
        })
        .filter((text: string): boolean => {
          return typeof words[text] !== "string" || words[text] === text;
        });

      expect({ language, untranslated }).toEqual({
        language,
        untranslated: [],
      });
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s words the chip and the noun",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(typeof words["This table"]).toBe("string");
      expect(typeof words["table"]).toBe("string");
    },
  );
});
