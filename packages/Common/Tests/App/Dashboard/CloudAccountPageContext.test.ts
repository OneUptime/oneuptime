import PageContextUtil, {
  DashboardPageContext,
  SuggestedQuestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import AIChatPageContextType from "../../../Types/AI/AIChatPageContext";
import { AIResourceType } from "../../../Types/AI/AIResourceContext";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ASK AI ON A CLOUD ACCOUNT'S PAGES (#5488's follow-up). An account's pages
 * - Overview, Resources, Topology, Changes, Costs, Feed, AI, Settings - are
 * under /cloud, where a cloud resource's own pages are (/cloud/:id), so
 * Ask AI took an account's address for a list of cloud resources: its chip
 * said "Cloud Resources" and its questions were about resources' telemetry.
 * An account's page is the account itself now - Ask AI reads it first, by
 * name, with query_cloud_accounts - and Cloud > Accounts is the accounts,
 * each with four questions people ask there.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const ACCOUNT_ID: string = "81000000-0000-4000-8000-000000000001";
const RESOURCE_ID: string = "82000000-0000-4000-8000-000000000001";

const ACCOUNT_CONTEXT: DashboardPageContext = {
  type: AIChatPageContextType.CloudAccount,
  entityId: ACCOUNT_ID,
  noun: "cloud account",
  chipLabel: "This cloud account",
  icon: IconProp.Cloud,
  isEntity: true,
};

const ACCOUNTS_CONTEXT: DashboardPageContext = {
  type: AIChatPageContextType.CloudAccountsList,
  noun: "cloud accounts",
  chipLabel: "Cloud accounts",
  icon: IconProp.Cloud,
  isEntity: false,
};

function navigateTo(pathname: string): void {
  Navigation.setLocation({
    pathname,
    search: "",
    hash: "",
    state: null,
    key: "cloud-account-page-context-test",
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which Cloud page Ask AI is on", () => {
  test.each([
    "",
    "/resources",
    "/topology",
    "/changes",
    "/costs",
    "/feed",
    "/ai/agent",
    "/ai/logs",
    "/settings",
    "/delete",
  ])("an account's page (%s) is the account itself", (suffix: string) => {
    navigateTo(
      `/dashboard/${PROJECT_ID}/cloud/accounts/${ACCOUNT_ID}${suffix}`,
    );

    expect(PageContextUtil.detectPageContext()).toEqual(ACCOUNT_CONTEXT);
  });

  test("Cloud > Accounts is the accounts", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/cloud/accounts`);

    expect(PageContextUtil.detectPageContext()).toEqual(ACCOUNTS_CONTEXT);
  });

  test("an address segment that is no account's id is the accounts, not an account", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/cloud/accounts/123456789012`);

    expect(PageContextUtil.detectPageContext()).toEqual(ACCOUNTS_CONTEXT);
  });

  test("a cloud resource's page is still that resource", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/cloud/${RESOURCE_ID}/changes`);

    expect(PageContextUtil.detectPageContext()).toMatchObject({
      type: AIChatPageContextType.Resource,
      resourceType: AIResourceType.CloudResource,
      entityId: RESOURCE_ID,
    });
  });

  test("every other Cloud page is still the cloud resources", () => {
    for (const suffix of ["", "/resources", "/connect", "/costs"]) {
      navigateTo(`/dashboard/${PROJECT_ID}/cloud${suffix}`);

      expect(PageContextUtil.detectPageContext()).toMatchObject({
        type: AIChatPageContextType.ResourcesList,
        resourceType: AIResourceType.CloudResource,
      });
    }
  });
});

describe("the account's name in Ask AI", () => {
  test("by the name it has in OneUptime, read with the viewer's own permissions", async () => {
    const account: CloudAccount = new CloudAccount();
    account.name = "Production";
    const getItem: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(account);

    expect(await PageContextUtil.resolveEntityTitle(ACCOUNT_CONTEXT)).toBe(
      "Production",
    );
    expect(getItem).toHaveBeenCalledWith({
      modelType: CloudAccount,
      id: new ObjectID(ACCOUNT_ID),
      select: { name: true },
    });
  });

  test("an account the viewer cannot read leaves the plain label", async () => {
    jest.spyOn(ModelAPI, "getItem").mockRejectedValue(new Error("No access"));

    expect(
      await PageContextUtil.resolveEntityTitle(ACCOUNT_CONTEXT),
    ).toBeNull();
  });
});

describe("the questions it offers", () => {
  test.each([ACCOUNT_CONTEXT, ACCOUNTS_CONTEXT])(
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

  test("an account's questions are about the account: its changes, what needs attention, its provider's health", () => {
    const text: string = PageContextUtil.getSuggestions(ACCOUNT_CONTEXT)
      .map((question: SuggestedQuestion): string => {
        return question.question;
      })
      .join(" ");

    expect(text).toContain("What changed in this account");
    expect(text).toContain("need attention");
    expect(text).toContain("health event about this account");
    // Never the resource list's telemetry questions.
    expect(text).not.toContain("telemetry");
  });

  test("each title, question, chip and noun reads in every language", () => {
    const words: Array<string> = [
      ACCOUNT_CONTEXT.chipLabel,
      ACCOUNTS_CONTEXT.chipLabel,
      ACCOUNT_CONTEXT.noun,
      ACCOUNTS_CONTEXT.noun,
    ];

    for (const context of [ACCOUNT_CONTEXT, ACCOUNTS_CONTEXT]) {
      for (const question of PageContextUtil.getSuggestions(context)) {
        words.push(question.title, question.question);
      }
    }

    for (const word of words) {
      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          language,
          word,
          worded: isWordedInDashboardLocale(word, language),
        }).toEqual({ language, word, worded: true });
      }
    }
  });
});
