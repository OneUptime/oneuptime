import PageContextUtil, {
  DashboardPageContext,
  SuggestedQuestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext";
import { getRouteForCitationTarget } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav";
import { describeCitationTargetPage } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Route from "../../../Types/API/Route";
import AIChatPageContextType from "../../../Types/AI/AIChatPageContext";
import { AIChatCitationTargetType } from "../../../Types/AI/AIChatTypes";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ASK AI ON DATA SECURITY'S PAGES: a data store's pages and a data
 * security issue's are the record itself - Ask AI reads it first, by name -
 * and every other Data Security page is the area, where the three Data
 * Security tools answer. Each offers four questions people ask there, and
 * what Ask AI cites opens the store, the issue or the list it read.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const STORE_ID: string = "20000000-0000-4000-8000-000000000042";
const ISSUE_ID: string = "30000000-0000-4000-8000-000000000007";

const STORE_CONTEXT: DashboardPageContext = {
  type: AIChatPageContextType.DataStore,
  entityId: STORE_ID,
  noun: "data store",
  chipLabel: "This data store",
  icon: IconProp.Database,
  isEntity: true,
};

const ISSUE_CONTEXT: DashboardPageContext = {
  type: AIChatPageContextType.DataSecurityIssue,
  entityId: ISSUE_ID,
  noun: "data security issue",
  chipLabel: "This data security issue",
  icon: IconProp.ShieldExclamation,
  isEntity: true,
};

const AREA_CONTEXT: DashboardPageContext = {
  type: AIChatPageContextType.DataSecurity,
  noun: "data security",
  chipLabel: "Data Security",
  icon: IconProp.ShieldCheck,
  isEntity: false,
};

function navigateTo(pathname: string): void {
  Navigation.setLocation({
    pathname,
    search: "",
    hash: "",
    state: null,
    key: "data-security-page-context-test",
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which Data Security page Ask AI is on", () => {
  test.each([
    "",
    "/inside",
    "/access",
    "/issues",
    "/flows",
    "/scans",
    "/owners",
    "/settings",
    "/delete",
  ])("a store's page (%s) is the store itself", (suffix: string) => {
    navigateTo(
      `/dashboard/${PROJECT_ID}/data-security/stores/${STORE_ID}${suffix}`,
    );

    expect(PageContextUtil.detectPageContext()).toEqual(STORE_CONTEXT);
  });

  test.each(["", "/timeline", "/delete"])(
    "an issue's page (%s) is the issue itself",
    (suffix: string) => {
      navigateTo(
        `/dashboard/${PROJECT_ID}/data-security/issues/${ISSUE_ID}${suffix}`,
      );

      expect(PageContextUtil.detectPageContext()).toEqual(ISSUE_CONTEXT);
    },
  );

  test.each([
    "/overview",
    "/stores",
    // An address segment is no store: archived stores are a list.
    "/stores/archived",
    "/issues",
    "/sensitive-data",
    "/telemetry",
    "/flows",
    "/access",
    "/compliance",
    "/scans",
    "/settings/data-types",
    "/settings/owner-rules",
    "/documentation",
  ])(
    "every other Data Security page (%s) is the Data Security area",
    (suffix: string) => {
      navigateTo(`/dashboard/${PROJECT_ID}/data-security${suffix}`);

      expect(PageContextUtil.detectPageContext()).toEqual(AREA_CONTEXT);
    },
  );
});

describe("the record's name in Ask AI", () => {
  test("a store by its name, read with the viewer's own permissions", async () => {
    const store: DataStore = new DataStore();
    store.name = "card-exports";
    const getItem: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(store);

    expect(await PageContextUtil.resolveEntityTitle(STORE_CONTEXT)).toBe(
      "card-exports",
    );
    expect(getItem).toHaveBeenCalledWith({
      modelType: DataStore,
      id: new ObjectID(STORE_ID),
      select: { name: true },
    });
  });

  test("an issue by its title", async () => {
    const issue: DataSecurityIssue = new DataSecurityIssue();
    issue.title = "Anyone on the internet can read it";
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(issue);

    expect(await PageContextUtil.resolveEntityTitle(ISSUE_CONTEXT)).toBe(
      "Anyone on the internet can read it",
    );
  });

  test("a record the viewer cannot read leaves the plain label", async () => {
    jest.spyOn(ModelAPI, "getItem").mockRejectedValue(new Error("No access"));

    expect(await PageContextUtil.resolveEntityTitle(STORE_CONTEXT)).toBeNull();
  });
});

describe("the questions it offers", () => {
  test.each([STORE_CONTEXT, ISSUE_CONTEXT, AREA_CONTEXT])(
    "four distinct questions on $chipLabel",
    (context: DashboardPageContext) => {
      const questions: Array<SuggestedQuestion> =
        PageContextUtil.getSuggestions(context);

      expect(questions).toHaveLength(4);
      expect(
        new Set(
          questions.map((question: SuggestedQuestion): string => {
            return question.title;
          }),
        ).size,
      ).toBe(4);
    },
  );

  test("the area's questions are the ones a Data Security tool answers", () => {
    const text: string = PageContextUtil.getSuggestions(AREA_CONTEXT)
      .map((question: SuggestedQuestion): string => {
        return question.question;
      })
      .join(" ");

    expect(text).toContain("card numbers");
    expect(text).toContain("public or shared with accounts outside ours");
    expect(text).toContain("If one of our roles leaked");
  });
});

describe("what Ask AI cites opens where the data is", () => {
  test.each([
    [AIChatCitationTargetType.DataStores, undefined, "data-security/stores"],
    [
      AIChatCitationTargetType.DataStoreView,
      { dataStoreId: STORE_ID },
      `data-security/stores/${STORE_ID}`,
    ],
    [
      AIChatCitationTargetType.DataSecurityIssues,
      undefined,
      "data-security/issues",
    ],
    [
      AIChatCitationTargetType.DataSecurityIssueView,
      { dataSecurityIssueId: ISSUE_ID },
      `data-security/issues/${ISSUE_ID}`,
    ],
    [
      AIChatCitationTargetType.DataSecurityAccess,
      undefined,
      "data-security/access",
    ],
  ])(
    "%s",
    (
      type: AIChatCitationTargetType,
      params: { [key: string]: string } | undefined,
      path: string,
    ) => {
      navigateTo(`/dashboard/${PROJECT_ID}/data-security/overview`);

      const route: Route | undefined = getRouteForCitationTarget({
        type,
        ...(params ? { params } : {}),
      });

      // The project is filled in from the current project when it is opened.
      expect(route?.toString()).toBe(`/dashboard/:projectId/${path}`);
    },
  );

  test("each page is named in the evidence list", () => {
    expect(
      describeCitationTargetPage(AIChatCitationTargetType.DataStoreView),
    ).toBe("Data store");
    expect(
      describeCitationTargetPage(AIChatCitationTargetType.DataSecurityIssues),
    ).toBe("Data security issues");
  });
});
