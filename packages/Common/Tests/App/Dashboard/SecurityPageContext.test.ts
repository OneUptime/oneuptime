import PageContextUtil, {
  DashboardPageContext,
  SuggestedQuestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import AIChatPageContextType, {
  AIChatPageContextHelper,
} from "../../../Types/AI/AIChatPageContext";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ASK AI ON THE SECURITY PAGES: a case's own page is an entity Ask AI reads
 * first (its title is the case's number and title), every other Security
 * Events page an area where a question in plain words searches the events.
 * Each offers four questions a responder would ask there.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CASE_ID: string = "20000000-0000-4000-8000-000000000042";

const CASE_CONTEXT: DashboardPageContext = {
  type: AIChatPageContextType.SecurityCase,
  entityId: CASE_ID,
  noun: "security case",
  chipLabel: "This security case",
  icon: IconProp.ShieldExclamation,
  isEntity: true,
};

const AREA_CONTEXT: DashboardPageContext = {
  type: AIChatPageContextType.SecurityEvents,
  noun: "security events",
  chipLabel: "Security Events",
  icon: IconProp.ShieldExclamation,
  isEntity: false,
};

function navigateTo(pathname: string): void {
  Navigation.setLocation({
    pathname,
    search: "",
    hash: "",
    state: null,
    key: "security-page-context-test",
  });
}

function questionsFor(type: AIChatPageContextType): Array<SuggestedQuestion> {
  return PageContextUtil.getSuggestions({
    ...(type === AIChatPageContextType.SecurityCase
      ? CASE_CONTEXT
      : AREA_CONTEXT),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which Security page Ask AI is on", () => {
  test.each([
    "",
    // Each page under the case's own side menu.
    "/timeline",
    "/detections",
    "/entities",
    "/playbook-runs",
    "/notes",
    "/audit-logs",
    "/delete",
    // And any address under it.
    "/overview",
    "/ai",
    "/playbooks",
  ])("a case's page (%s) is the case itself", (suffix: string) => {
    navigateTo(
      `/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}${suffix}`,
    );

    expect(PageContextUtil.detectPageContext()).toEqual(CASE_CONTEXT);
  });

  test.each([
    "",
    "/cases",
    "/cases/mine",
    "/cases/not-a-case-id",
    "/events",
    "/detection-rules",
    "/playbooks",
    "/ai/settings",
  ])(
    "every other Security page (%s) is the Security Events area",
    (suffix: string) => {
      navigateTo(`/dashboard/${PROJECT_ID}/security-events${suffix}`);

      expect(PageContextUtil.detectPageContext()).toEqual(AREA_CONTEXT);
    },
  );
});

describe("a case's title in Ask AI", () => {
  test("its number and title, read with the viewer's own permissions", async () => {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase.title = "Brute force against web-1";
    securityCase.caseNumberWithPrefix = "SC-12";
    const getItem: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(securityCase);

    expect(await PageContextUtil.resolveEntityTitle(CASE_CONTEXT)).toBe(
      "SC-12 Brute force against web-1",
    );
    expect(getItem).toHaveBeenCalledWith({
      modelType: SecurityCase,
      id: new ObjectID(CASE_ID),
      select: { title: true, caseNumberWithPrefix: true },
    });
  });

  test("a case without a number is its title alone", async () => {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase.title = "Brute force against web-1";
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(securityCase);

    expect(await PageContextUtil.resolveEntityTitle(CASE_CONTEXT)).toBe(
      "Brute force against web-1",
    );
  });

  test.each([
    ["no case", null],
    ["a case with no title", new SecurityCase()],
  ])(
    "%s leaves the plain label",
    async (_name: string, securityCase: SecurityCase | null) => {
      jest.spyOn(ModelAPI, "getItem").mockResolvedValue(securityCase);

      expect(await PageContextUtil.resolveEntityTitle(CASE_CONTEXT)).toBeNull();
    },
  );

  test("a case the viewer cannot read leaves the plain label", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValue(new Error("Read access denied"));

    expect(await PageContextUtil.resolveEntityTitle(CASE_CONTEXT)).toBeNull();
  });

  test("the area asks for no title", async () => {
    const getItem: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ModelAPI,
      "getItem",
    );

    expect(await PageContextUtil.resolveEntityTitle(AREA_CONTEXT)).toBeNull();
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe("what is sent to the server", () => {
  test("a case: its type, id and title, which the server accepts as they are", () => {
    const payload: JSONObject = PageContextUtil.toRequestPayload({
      ...CASE_CONTEXT,
      entityTitle: "SC-12 Brute force against web-1",
    });

    expect(payload).toEqual({
      type: AIChatPageContextType.SecurityCase,
      entityId: CASE_ID,
      entityTitle: "SC-12 Brute force against web-1",
    });
    expect(AIChatPageContextHelper.sanitize(payload)).toEqual(payload);
  });

  test("the area: its type alone", () => {
    const payload: JSONObject = PageContextUtil.toRequestPayload(AREA_CONTEXT);

    expect(payload).toEqual({ type: AIChatPageContextType.SecurityEvents });
    expect(AIChatPageContextHelper.sanitize(payload)).toEqual(payload);
  });
});

describe("the questions Ask AI offers", () => {
  test("on a case: summarize, is it real, threat intel, what next", () => {
    expect(
      questionsFor(AIChatPageContextType.SecurityCase).map(
        (question: SuggestedQuestion): [string, string] => {
          return [question.title, question.question];
        },
      ),
    ).toEqual([
      [
        "Summarize",
        "Summarize this security case: what happened, which users and hosts it is about, and how bad it is.",
      ],
      [
        "Is it real?",
        "Is this security case a real attack or a false positive? Weigh the evidence for each.",
      ],
      [
        "Check threat intel",
        "Check this case's IP addresses, domains and file hashes against our threat intel.",
      ],
      [
        "What next?",
        "What should I do next on this case? Name the playbook that fits, if one does.",
      ],
    ]);
  });

  test("anywhere else on Security: sign-ins, open cases, unusual activity, the week", () => {
    expect(
      questionsFor(AIChatPageContextType.SecurityEvents).map(
        (question: SuggestedQuestion): string => {
          return question.title;
        },
      ),
    ).toEqual([
      "Failed sign-ins",
      "Open cases",
      "Unusual activity",
      "This week",
    ]);
  });

  test("no question asks OneUptime AI to change anything on its own", () => {
    const asksForAChange: RegExp =
      /\b(close|delete|block|disable|isolate|run the)\b/i;

    for (const type of [
      AIChatPageContextType.SecurityCase,
      AIChatPageContextType.SecurityEvents,
    ]) {
      for (const question of questionsFor(type)) {
        expect([
          question.question,
          asksForAChange.test(question.question),
        ]).toEqual([question.question, false]);
      }
    }
  });
});
