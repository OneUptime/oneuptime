import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseStatus, {
  OPEN_SECURITY_CASE_STATUSES,
} from "Common/Types/SecurityCase/SecurityCaseStatus";
import SecurityPlaybookRunStatus from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SECURITY_CASE_QUEUE_VIEWS,
  SECURITY_CASE_QUEUE_VIEW_KEYS,
  SecurityCaseQueueView,
  getSecurityCaseAssigneeForMe,
  getSecurityCaseQueueFilters,
  getSecurityCaseQueueQuery,
  getSecurityCaseQueueStatusOptions,
  getSecurityCaseQueueView,
  getSecurityCaseQueueViewForPage,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseQueueViews";
import {
  PLAYBOOK_RUNS_PAGE_LIMIT,
  SECURITY_PLAYBOOK_RUN_VIEWS,
  SecurityPlaybookRunView,
  getSecurityPlaybookRunView,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunViews";

/*
 * The case queue's pages and the two runs pages, as data: each is a page
 * of its own under the Security Events side menu (they were views switched
 * by buttons along the top of one list), and each page's list fits its
 * question - its query, columns, filters and sort, whether it offers Open
 * Security Case, and what its empty state means. Their words are in every
 * Dashboard language.
 *
 * The rendered pages are pinned in Common/Tests/App/Dashboard/
 * SecurityCasesPages.test.tsx and SecurityPlaybookRunsPages.test.tsx.
 */

const ME: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(".json", "");
  })
  .sort();

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// Two short lines under a label, and two across a card (ShortDescriptionsGuard).
const LINE_LIMIT: number = 150;
const CARD_LIMIT: number = 210;

function rowOf(view: SecurityCaseQueueView): JSONObject {
  return {
    key: view.key,
    page: view.page,
    title: view.title,
    columns: [...view.columns],
    hiddenColumns: [...view.hiddenColumns],
    filters: [...view.filters],
    sortBy: view.sortBy,
    isEmptyGoodNews: view.isEmptyGoodNews,
    canOpenCase: view.canOpenCase,
    canAssignToMe: view.canAssignToMe,
  };
}

describe("the case queue's pages", () => {
  test("are Open Cases, Assigned to Me, Unassigned, Closed Cases and All Cases, each a page of its own", () => {
    expect(SECURITY_CASE_QUEUE_VIEW_KEYS).toEqual([
      "open",
      "mine",
      "unassigned",
      "closed",
      "all",
    ]);
    expect(
      SECURITY_CASE_QUEUE_VIEWS.map(
        (view: SecurityCaseQueueView): [string, string] => {
          return [view.title, view.page];
        },
      ),
    ).toEqual([
      ["Open Cases", "SECURITY_CASES"],
      ["Assigned to Me", "SECURITY_CASES_ASSIGNED_TO_ME"],
      ["Unassigned", "SECURITY_CASES_UNASSIGNED"],
      ["Closed Cases", "SECURITY_CASES_CLOSED"],
      ["All Cases", "SECURITY_CASES_ALL"],
    ]);
  });

  test("each list draws, filters and sorts what its question needs", () => {
    expect(SECURITY_CASE_QUEUE_VIEWS.map(rowOf)).toEqual([
      {
        key: "open",
        page: "SECURITY_CASES",
        title: "Open Cases",
        columns: [
          "case",
          "priority",
          "status",
          "assignee",
          "labels",
          "lastDetection",
        ],
        hiddenColumns: ["labels"],
        filters: [
          "title",
          "priority",
          "status",
          "aiVerdict",
          "labels",
          "opened",
        ],
        sortBy: "lastDetectedAt",
        isEmptyGoodNews: true,
        canOpenCase: true,
        canAssignToMe: true,
      },
      {
        // Every case here is yours: no Assignee column, no Assign to Me.
        key: "mine",
        page: "SECURITY_CASES_ASSIGNED_TO_ME",
        title: "Assigned to Me",
        columns: ["case", "priority", "status", "labels", "lastDetection"],
        hiddenColumns: ["labels"],
        filters: [
          "title",
          "priority",
          "status",
          "aiVerdict",
          "labels",
          "opened",
        ],
        sortBy: "lastDetectedAt",
        isEmptyGoodNews: false,
        canOpenCase: false,
        canAssignToMe: false,
      },
      {
        /*
         * Nobody is on any case here, so no Assignee column saying
         * Unassigned on every row: a case handed to a team waits here
         * too, and Team names it. Assign to Me is how a case is taken on.
         */
        key: "unassigned",
        page: "SECURITY_CASES_UNASSIGNED",
        title: "Unassigned",
        columns: [
          "case",
          "priority",
          "status",
          "team",
          "labels",
          "lastDetection",
        ],
        hiddenColumns: ["labels"],
        filters: [
          "title",
          "priority",
          "status",
          "aiVerdict",
          "labels",
          "opened",
        ],
        sortBy: "lastDetectedAt",
        isEmptyGoodNews: true,
        canOpenCase: false,
        canAssignToMe: true,
      },
      {
        /*
         * Read by verdict and when it closed; every case here is Closed,
         * and nobody takes a closed case on.
         */
        key: "closed",
        page: "SECURITY_CASES_CLOSED",
        title: "Closed Cases",
        columns: [
          "case",
          "priority",
          "verdict",
          "assignee",
          "labels",
          "closed",
        ],
        hiddenColumns: ["labels"],
        filters: [
          "title",
          "priority",
          "verdict",
          "aiVerdict",
          "labels",
          "opened",
          "closed",
        ],
        sortBy: "closedAt",
        isEmptyGoodNews: false,
        canOpenCase: false,
        canAssignToMe: false,
      },
      {
        key: "all",
        page: "SECURITY_CASES_ALL",
        title: "All Cases",
        columns: [
          "case",
          "priority",
          "status",
          "verdict",
          "assignee",
          "labels",
          "lastDetection",
        ],
        hiddenColumns: ["verdict", "labels"],
        filters: [
          "title",
          "priority",
          "status",
          "verdict",
          "aiVerdict",
          "labels",
          "opened",
        ],
        sortBy: "lastDetectedAt",
        isEmptyGoodNews: false,
        canOpenCase: true,
        canAssignToMe: true,
      },
    ]);
  });

  test("every list filters by what OneUptime AI read a case as, and none does with the project's AI off", () => {
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      expect([view.key, getSecurityCaseQueueFilters(view, true)]).toEqual([
        view.key,
        [...view.filters],
      ]);
      expect(getSecurityCaseQueueFilters(view, true)).toContain("aiVerdict");
      expect(getSecurityCaseQueueFilters(view, false)).toEqual(
        view.filters.filter((filter: string): boolean => {
          return filter !== "aiVerdict";
        }),
      );
    }
  });

  test("an open list never offers a verdict, and the closed list never a status", () => {
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const isOpenList: boolean =
        view.key === "open" || view.key === "mine" || view.key === "unassigned";

      if (isOpenList) {
        expect([view.key, view.filters.includes("verdict")]).toEqual([
          view.key,
          false,
        ]);
        expect([view.key, view.columns.includes("verdict")]).toEqual([
          view.key,
          false,
        ]);
      }

      if (view.key === "closed") {
        expect(view.filters).not.toContain("status");
        expect(view.columns).not.toContain("status");
      }
    }
  });

  test("hides by default only columns it draws, and always draws the case", () => {
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      expect(view.columns[0]).toBe("case");
      expect(view.hiddenColumns).not.toContain("case");

      for (const hidden of view.hiddenColumns) {
        expect([view.key, view.columns.includes(hidden)]).toEqual([
          view.key,
          true,
        ]);
      }
    }
  });

  test("offers an open list's Status filter only the open statuses, so it never empties itself", () => {
    expect(getSecurityCaseQueueStatusOptions("open")).toEqual([
      ...OPEN_SECURITY_CASE_STATUSES,
    ]);
    expect(getSecurityCaseQueueStatusOptions("mine")).toEqual([
      ...OPEN_SECURITY_CASE_STATUSES,
    ]);
    expect(getSecurityCaseQueueStatusOptions("unassigned")).toEqual([
      ...OPEN_SECURITY_CASE_STATUSES,
    ]);
    expect(getSecurityCaseQueueStatusOptions("all")).toEqual([
      ...OPEN_SECURITY_CASE_STATUSES,
      SecurityCaseStatus.Closed,
    ]);
    expect(getSecurityCaseQueueStatusOptions("open")).not.toContain(
      SecurityCaseStatus.Closed,
    );
  });

  test("finds a page's view by its key and by its page, and falls back to Open Cases", () => {
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      expect(getSecurityCaseQueueView(view.key)).toBe(view);
      expect(getSecurityCaseQueueViewForPage(view.page)).toBe(view);
    }

    expect(getSecurityCaseQueueView(undefined).key).toBe("open");
    expect(
      getSecurityCaseQueueViewForPage("SECURITY_CASE_VIEW" as never),
    ).toBeUndefined();
    expect(getSecurityCaseQueueViewForPage(undefined)).toBeUndefined();
  });
});

describe("what each case page asks the server for", () => {
  test("Open Cases: every status but Closed", () => {
    const query: JSONObject = getSecurityCaseQueueQuery(
      "open",
      ME,
    ) as unknown as JSONObject;
    const status: Includes = query["status"] as unknown as Includes;

    expect(Object.keys(query)).toEqual(["status"]);
    expect(status).toBeInstanceOf(Includes);
    expect(status.values).toEqual([...OPEN_SECURITY_CASE_STATUSES]);
  });

  test("Assigned to Me: the open cases of the person signed in", () => {
    const query: JSONObject = getSecurityCaseQueueQuery(
      "mine",
      ME,
    ) as unknown as JSONObject;

    expect(query["assignedToUserId"]).toEqual(ME);
    expect((query["status"] as unknown as Includes).values).toEqual([
      ...OPEN_SECURITY_CASE_STATUSES,
    ]);
  });

  test("Assigned to Me with nobody signed in, or an empty id, is nobody's cases, not everybody's", () => {
    for (const nobody of [undefined, new ObjectID("")]) {
      const query: JSONObject = getSecurityCaseQueueQuery(
        "mine",
        nobody,
      ) as unknown as JSONObject;

      expect(query["assignedToUserId"]).toEqual(ObjectID.getZeroObjectID());
    }

    expect(getSecurityCaseAssigneeForMe(ME)).toBe(ME);
    expect(getSecurityCaseAssigneeForMe(new ObjectID(""))).toEqual(
      ObjectID.getZeroObjectID(),
    );
  });

  test("Unassigned: the open cases with no person on them", () => {
    const query: JSONObject = getSecurityCaseQueueQuery(
      "unassigned",
      ME,
    ) as unknown as JSONObject;

    expect(query["assignedToUserId"]).toBeInstanceOf(IsNull);
    expect((query["status"] as unknown as Includes).values).toEqual([
      ...OPEN_SECURITY_CASE_STATUSES,
    ]);
  });

  test("Closed Cases: Closed; All Cases: nothing", () => {
    expect(getSecurityCaseQueueQuery("closed", ME)).toEqual({
      status: SecurityCaseStatus.Closed,
    });
    expect(getSecurityCaseQueueQuery("all", ME)).toEqual({});
  });
});

describe("the runs pages", () => {
  test("are Waiting for Approval and Playbook Runs, each a page of its own", () => {
    expect(
      SECURITY_PLAYBOOK_RUN_VIEWS.map(
        (view: SecurityPlaybookRunView): [string, string, string] => {
          return [view.key, view.title, view.page];
        },
      ),
    ).toEqual([
      [
        "waiting",
        "Waiting for Approval",
        "SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL",
      ],
      ["all", "Playbook Runs", "SECURITY_PLAYBOOK_RUNS"],
    ]);
  });

  test("Waiting for Approval asks for the runs held for an approval; Playbook Runs for every run", () => {
    expect(getSecurityPlaybookRunView("waiting").query).toEqual({
      status: SecurityPlaybookRunStatus.WaitingForApproval,
    });
    expect(getSecurityPlaybookRunView("all").query).toEqual({});
    expect(getSecurityPlaybookRunView(undefined).key).toBe("waiting");
    expect(PLAYBOOK_RUNS_PAGE_LIMIT).toBe(50);
  });

  test("an empty Waiting for Approval is good news; an empty Playbook Runs is a first visit", () => {
    expect(
      SECURITY_PLAYBOOK_RUN_VIEWS.map(
        (view: SecurityPlaybookRunView): [string, boolean, string] => {
          return [view.key, view.isEmptyGoodNews, view.emptyTitle];
        },
      ),
    ).toEqual([
      ["waiting", true, "No step is waiting for approval."],
      ["all", false, "No playbook has run yet."],
    ]);
  });
});

describe("the pages' words", () => {
  const caseWords: Array<[string, string, number]> =
    SECURITY_CASE_QUEUE_VIEWS.flatMap(
      (view: SecurityCaseQueueView): Array<[string, string, number]> => {
        return [
          [`${view.key} title`, view.title, LINE_LIMIT],
          [`${view.key} description`, view.description, CARD_LIMIT],
          [`${view.key} empty`, view.emptyMessage, LINE_LIMIT],
        ];
      },
    );

  const runWords: Array<[string, string, number]> =
    SECURITY_PLAYBOOK_RUN_VIEWS.flatMap(
      (view: SecurityPlaybookRunView): Array<[string, string, number]> => {
        return [
          [`${view.key} title`, view.title, LINE_LIMIT],
          [`${view.key} description`, view.description, CARD_LIMIT],
          [`${view.key} empty title`, view.emptyTitle, LINE_LIMIT],
          [`${view.key} empty description`, view.emptyDescription, LINE_LIMIT],
        ];
      },
    );

  const words: Array<[string, string, number]> = [
    ...caseWords,
    ...runWords,
    ["Assigned to Me's way forward", "View Unassigned Cases", LINE_LIMIT],
    ["Playbook Runs' way forward", "View Playbooks", LINE_LIMIT],
  ];

  test.each(words)(
    "%s is short, and a whole sentence where it is one",
    (_name: string, text: string, limit: number) => {
      expect(text.length).toBeLessThanOrEqual(limit);
      expect(text.trim()).toBe(text);
    },
  );

  test("every description and empty message ends as a sentence does", () => {
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      expect(view.description.endsWith(".")).toBe(true);
      expect(view.emptyMessage.endsWith(".")).toBe(true);
    }

    for (const view of SECURITY_PLAYBOOK_RUN_VIEWS) {
      expect(view.description.endsWith(".")).toBe(true);
      expect(view.emptyDescription.endsWith(".")).toBe(true);
    }
  });

  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )("%s reads every one of them in its own words", (language: string) => {
    const english: Record<string, string> = locale("en");
    const translated: Record<string, string> = locale(language);

    const untranslated: Array<string> = words
      .map(([, text]: [string, string, number]): string => {
        return text;
      })
      .filter((text: string): boolean => {
        return (
          english[text] !== text ||
          !translated[text] ||
          translated[text] === text
        );
      });

    expect(untranslated).toEqual([]);
  });
});
