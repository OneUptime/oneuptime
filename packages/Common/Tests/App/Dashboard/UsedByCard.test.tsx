/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import UsedByApi, {
  getUsedByPageUrl,
  getUsedBySummaryUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UsedBy/UsedByApi";
import UsedByCard from "../../../../App/FeatureSet/Dashboard/src/Components/UsedBy/UsedByCard";
import UsedByDialog from "../../../../App/FeatureSet/Dashboard/src/Components/UsedBy/UsedByDialog";
import {
  UsedByBulkImpact,
  UsedByImpactForRecord,
  UsedByImpactList,
  UsedByImpactNotice,
  hasUsedByImpact,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UsedBy/UsedByImpact";
import {
  UsedByListActions,
  getUsedByListActions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UsedBy/UsedByListActions";
import {
  USED_BY_CARD_WORDS,
  USED_BY_RELATION_WORDS,
  USED_BY_ROW_KIND_NAMES,
  getUsedByBulkImpactSentence,
  getUsedByHiddenInImpact,
  getUsedByHiddenNote,
  getUsedByImpactSentence,
  getUsedByPartsLine,
  getUsedByRowName,
  getUsedByRowPage,
  getUsedByRowRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UsedBy/UsedByWords";
import { BulkActionConfirmControls } from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { DeleteConfirmation } from "../../../UI/Components/ModelTable/BaseModelTable";
import { UsedBySummaryState } from "../../../../App/FeatureSet/Dashboard/src/Components/UsedBy/useUsedBySummary";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ArchiveResourceCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import Route from "../../../Types/API/Route";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import {
  USED_BY_PAGE_SIZE,
  UsedByBulkSummary,
  UsedByCounts,
  UsedByGroup,
  UsedByPage,
  UsedByRecordKind,
  UsedByRelation,
  UsedByRow,
  UsedByRowKind,
  UsedBySummary,
  getUsedByBulkRelations,
  getUsedByRelations,
} from "../../../Types/UsedBy/UsedBy";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import {
  createTranslator,
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import fs from "fs";
import path from "path";

/*
 * "USED BY" (#6813): a compact card on a record's overview - one line per
 * kind of record that refers to it, with how many the reader may see, the
 * first three as links, how many they may not see (never named), and "See
 * all" for the rest a page at a time - an empty card that says what to do
 * next, and the Delete and Archive dialogs that say what still uses it.
 */

const RECORD: ObjectID = new ObjectID("68135555-0000-4000-8000-000000000001");
const translator: Translator = getGlobalTranslator();

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function localeTranslator(language: string): Translator {
  const words: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;

  return createTranslator((text: string): string | undefined => {
    const value: unknown = words[text];
    return typeof value === "string" ? value : undefined;
  }, language);
}

function row(index: number, overrides: Partial<UsedByRow> = {}): UsedByRow {
  return {
    id: `68135555-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `Page ${index}`,
    ...overrides,
  };
}

function group(overrides: Partial<UsedByGroup> = {}): UsedByGroup {
  return {
    relation: UsedByRelation.MonitorStatusPages,
    rowKind: UsedByRowKind.StatusPage,
    count: 0,
    hiddenCount: 0,
    rows: [],
    ...overrides,
  };
}

// A monitor's summary: every relation, empty unless given.
function monitorSummary(
  groups: Array<Partial<UsedByGroup>> = [],
): UsedBySummary {
  return {
    recordKind: UsedByRecordKind.Monitor,
    recordId: RECORD.toString(),
    groups: getUsedByRelations(UsedByRecordKind.Monitor).map(
      (description: { relation: UsedByRelation; rowKind: UsedByRowKind }) => {
        const given: Partial<UsedByGroup> | undefined = groups.find(
          (each: Partial<UsedByGroup>): boolean => {
            return each.relation === description.relation;
          },
        );

        return group({
          relation: description.relation,
          rowKind: description.rowKind,
          ...(given || {}),
        });
      },
    ),
  };
}

function loaded(summary: UsedBySummary): UsedBySummaryState {
  return { status: "loaded", summary: summary };
}

function renderCard(
  recordKind: UsedByRecordKind = UsedByRecordKind.Monitor,
  refreshToken?: number,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <UsedByCard
        recordKind={recordKind}
        recordId={RECORD}
        refreshToken={refreshToken}
      />
    </MemoryRouter>,
  );
}

let getSummary: SpyInstance<typeof UsedByApi.getSummary>;
let getPage: SpyInstance<typeof UsedByApi.getPage>;
let sendEvent: SpyInstance<typeof ProductEvents.send>;

beforeEach(() => {
  getSummary = jest.spyOn(UsedByApi, "getSummary");
  getPage = jest.spyOn(UsedByApi, "getPage");
  sendEvent = jest.spyOn(ProductEvents, "send").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the words", () => {
  test("every relation has a title and a sentence for its dialogs", () => {
    for (const relation of Object.values(UsedByRelation)) {
      expect(USED_BY_RELATION_WORDS[relation].title.length).toBeGreaterThan(0);
      expect(USED_BY_RELATION_WORDS[relation].impact.one).toContain(
        "{{count}}",
      );
      expect(USED_BY_RELATION_WORDS[relation].impact.other).toContain(
        "{{count}}",
      );
      expect(USED_BY_RELATION_WORDS[relation].impact.other).toMatch(/\.$/u);
    }
  });

  test("every kind's card has a title, a description and an empty state that says what to do", () => {
    for (const kind of Object.values(UsedByRecordKind)) {
      const words: (typeof USED_BY_CARD_WORDS)[UsedByRecordKind] =
        USED_BY_CARD_WORDS[kind];

      expect(words.title).toBeTruthy();
      expect(words.description).toMatch(/\.$/u);
      expect(words.emptyTitle).toBeTruthy();
      expect(words.emptyDescription).toMatch(/\.$/u);
      // An action comes with the page it is done on, or not at all.
      expect(Boolean(words.emptyActionTitle)).toBe(
        Boolean(words.emptyActionPage),
      );
    }

    expect(USED_BY_CARD_WORDS[UsedByRecordKind.OnCallSchedule]).toMatchObject({
      emptyTitle: "Nothing uses this schedule yet",
      emptyActionPage: PageMap.ON_CALL_DUTY_POLICIES,
    });
    expect(
      USED_BY_CARD_WORDS[UsedByRecordKind.OnCallSchedule].emptyDescription,
    ).toContain("Add it to an on-call policy's escalation rule.");
  });

  test("the sentence counts every record that refers, seen or not", () => {
    expect(
      getUsedByImpactSentence(
        {
          relation: UsedByRelation.MonitorStatusPages,
          count: 1,
          hiddenCount: 2,
        },
        translator,
      ),
    ).toBe("3 status pages show this monitor.");
    expect(
      getUsedByImpactSentence(
        {
          relation: UsedByRelation.MonitorStatusPages,
          count: 1,
          hiddenCount: 0,
        },
        translator,
      ),
    ).toBe("1 status page shows this monitor.");
    expect(
      getUsedByImpactSentence(
        {
          relation: UsedByRelation.ScheduleOnCallPolicies,
          count: 2,
          hiddenCount: 0,
        },
        translator,
      ),
    ).toBe("2 on-call policies page this schedule.");
  });

  test("what the reader may not see is said, and never named", () => {
    expect(getUsedByHiddenNote({ count: 3, hiddenCount: 2 }, translator)).toBe(
      "and 2 you can't see",
    );
    expect(getUsedByHiddenNote({ count: 0, hiddenCount: 2 }, translator)).toBe(
      "2 you can't see",
    );
    expect(getUsedByHiddenNote({ count: 3, hiddenCount: 0 }, translator)).toBe(
      "",
    );
    expect(getUsedByHiddenInImpact({ hiddenCount: 1 }, translator)).toBe(
      "(1 of them you can't see)",
    );
    expect(getUsedByHiddenInImpact({ hiddenCount: 0 }, translator)).toBe("");
  });

  test("a row is named as its own page names it, its number first", () => {
    expect(getUsedByRowName(row(1), translator)).toBe("Page 1");
    expect(
      getUsedByRowName(
        row(2, { name: "Checkout down", number: "INC-18" }),
        translator,
      ),
    ).toBe("INC-18 Checkout down");
    expect(getUsedByRowName(row(3, { name: "  " }), translator)).toBe(
      "Untitled",
    );
  });

  test("every kind of row opens its own page, but an AI agent, which has none", () => {
    for (const rowKind of Object.values(UsedByRowKind)) {
      const page: PageMap | null = getUsedByRowPage(rowKind);

      if (rowKind === UsedByRowKind.AIAgent) {
        expect(page).toBeNull();
        expect(getUsedByRowRoute(rowKind, row(1).id)).toBeNull();
        continue;
      }

      expect({ rowKind, route: RouteMap[page as PageMap] }).toEqual({
        rowKind,
        route: expect.anything(),
      });
      // And is named by the model's own name.
      expect(USED_BY_ROW_KIND_NAMES[rowKind].length).toBeGreaterThan(0);
    }

    expect(
      getUsedByRowRoute(UsedByRowKind.StatusPage, row(1).id)?.toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
        { modelId: new ObjectID(row(1).id) },
      ).toString(),
    );
  });

  test("the sentences read in German and Persian, with the count in them", () => {
    const german: Translator = localeTranslator("de");
    const persian: Translator = localeTranslator("fa");

    expect(
      getUsedByImpactSentence(
        {
          relation: UsedByRelation.MonitorStatusPages,
          count: 3,
          hiddenCount: 0,
        },
        german,
      ),
    ).toBe("3 Statusseiten zeigen diesen Monitor.");
    expect(
      getUsedByImpactSentence(
        {
          relation: UsedByRelation.MonitorStatusPages,
          count: 1,
          hiddenCount: 0,
        },
        german,
      ),
    ).toBe("1 Statusseite zeigt diesen Monitor.");
    expect(
      getUsedByHiddenNote({ count: 3, hiddenCount: 2 }, persian),
    ).toContain("نمی‌توانید ببینید");
  });

  test("the addresses the card asks", () => {
    expect(
      getUsedBySummaryUrl({
        recordKind: UsedByRecordKind.OnCallSchedule,
        recordId: RECORD,
      }).toString(),
    ).toContain(`/used-by/on-call-schedule/${RECORD.toString()}`);

    const page: string = getUsedByPageUrl({
      recordKind: UsedByRecordKind.Monitor,
      recordId: RECORD,
      relation: UsedByRelation.MonitorSlos,
      skip: 50,
      limit: 50,
    }).toString();

    expect(page).toContain(`/used-by/monitor/${RECORD.toString()}/MonitorSlos`);
    expect(page).toContain("skip=50");
    expect(page).toContain("limit=50");
  });
});

describe("the card", () => {
  test("loads once, then lists each kind with its count and first rows as links", async () => {
    getSummary.mockResolvedValue(
      monitorSummary([
        {
          relation: UsedByRelation.MonitorStatusPages,
          count: 2,
          rows: [
            row(1, { name: "Public status" }),
            row(2, { name: "Partners" }),
          ],
        },
        {
          relation: UsedByRelation.MonitorSlos,
          count: 1,
          rows: [row(3, { name: "Checkout 99.9" })],
        },
      ]),
    );
    renderCard();

    expect(screen.getByTestId("used-by-loading")).toBeInTheDocument();

    const groups: Array<HTMLElement> =
      await screen.findAllByTestId("used-by-group");

    expect(
      groups.map((each: HTMLElement): string | null => {
        return each.getAttribute("data-relation");
      }),
    ).toEqual([UsedByRelation.MonitorStatusPages, UsedByRelation.MonitorSlos]);

    const pages: HTMLElement = groups[0] as HTMLElement;
    expect(within(pages).getByText("Status pages")).toBeInTheDocument();
    expect(within(pages).getByTestId("used-by-count")).toHaveTextContent("2");

    const link: HTMLElement = within(pages).getByText("Public status");
    expect(link.closest("a")?.getAttribute("href")).toBe(
      getUsedByRowRoute(UsedByRowKind.StatusPage, row(1).id)?.toString(),
    );

    // Three rows or fewer, all shown: nothing more to see.
    expect(within(pages).queryByTestId("used-by-see-all")).toBeNull();
    expect(screen.getByText("Used by")).toBeInTheDocument();
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getSummary.mock.calls[0]?.[0]).toEqual({
      recordKind: UsedByRecordKind.Monitor,
      recordId: RECORD,
    });
  });

  test("says how many the reader may not see, without naming them", async () => {
    getSummary.mockResolvedValue(
      monitorSummary([
        {
          relation: UsedByRelation.MonitorStatusPages,
          count: 1,
          hiddenCount: 2,
          rows: [row(1)],
        },
        { relation: UsedByRelation.MonitorSlos, count: 0, hiddenCount: 4 },
      ]),
    );
    renderCard();

    const groups: Array<HTMLElement> =
      await screen.findAllByTestId("used-by-group");

    expect(
      within(groups[0] as HTMLElement).getByTestId("used-by-hidden"),
    ).toHaveTextContent("and 2 you can't see");
    expect(
      within(groups[1] as HTMLElement).getByTestId("used-by-hidden"),
    ).toHaveTextContent("4 you can't see");
    expect(
      within(groups[1] as HTMLElement).getByTestId("used-by-count"),
    ).toHaveTextContent("0");
    expect(
      within(groups[1] as HTMLElement).queryAllByTestId("used-by-row"),
    ).toHaveLength(0);
  });

  test("a policy's escalation rules are said under its name", async () => {
    getSummary.mockResolvedValue({
      recordKind: UsedByRecordKind.OnCallSchedule,
      recordId: RECORD.toString(),
      groups: [
        group({
          relation: UsedByRelation.ScheduleOnCallPolicies,
          rowKind: UsedByRowKind.OnCallDutyPolicy,
          count: 1,
          rows: [
            row(1, { name: "Primary", detail: "First line, Second line" }),
          ],
        }),
      ],
    });
    renderCard(UsedByRecordKind.OnCallSchedule);

    expect(await screen.findByTestId("used-by-row-detail")).toHaveTextContent(
      "First line, Second line",
    );
    /*
     * The policy opens where the schedule is named: its Escalation Rules,
     * the rules its line names (#9701).
     */
    expect(screen.getByText("Primary").closest("a")?.getAttribute("href")).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route,
        { modelId: new ObjectID(row(1).id) },
      ).toString(),
    );
  });

  test("a policy that pages a team opens on its Escalation Rules too; one the team owns, on its overview", async () => {
    getSummary.mockResolvedValue({
      recordKind: UsedByRecordKind.Team,
      recordId: RECORD.toString(),
      groups: [
        group({
          relation: UsedByRelation.TeamOnCallPolicies,
          rowKind: UsedByRowKind.OnCallDutyPolicy,
          count: 1,
          rows: [row(1, { name: "Payments", detail: "Level 1" })],
        }),
        group({
          relation: UsedByRelation.TeamOwnedOnCallPolicies,
          rowKind: UsedByRowKind.OnCallDutyPolicy,
          count: 1,
          rows: [row(2, { name: "Billing" })],
        }),
      ],
    });
    renderCard(UsedByRecordKind.Team);

    expect(
      (await screen.findByText("Payments")).closest("a")?.getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route,
        { modelId: new ObjectID(row(1).id) },
      ).toString(),
    );
    expect(screen.getByText("Billing").closest("a")?.getAttribute("href")).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
        { modelId: new ObjectID(row(2).id) },
      ).toString(),
    );
  });

  test("See all lists a schedule's policies on their Escalation Rules as well", async () => {
    getPage.mockResolvedValue({
      recordKind: UsedByRecordKind.OnCallSchedule,
      recordId: RECORD.toString(),
      relation: UsedByRelation.ScheduleOnCallPolicies,
      rowKind: UsedByRowKind.OnCallDutyPolicy,
      count: 1,
      hiddenCount: 0,
      pageStart: 0,
      pageSize: USED_BY_PAGE_SIZE,
      rows: [row(3, { name: "Checkout", detail: "Level 1, Level 2" })],
    });

    render(
      <MemoryRouter>
        <UsedByDialog
          recordKind={UsedByRecordKind.OnCallSchedule}
          recordId={RECORD}
          relation={UsedByRelation.ScheduleOnCallPolicies}
          onClose={() => {
            return undefined;
          }}
        />
      </MemoryRouter>,
    );

    expect(
      (await screen.findByText("Checkout")).closest("a")?.getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route,
        { modelId: new ObjectID(row(3).id) },
      ).toString(),
    );
    expect(screen.getByTestId("used-by-row-detail")).toHaveTextContent(
      "Level 1, Level 2",
    );
  });

  test("a row's route is its relation's page where the relation names one, its kind's otherwise", () => {
    const id: string = row(4).id;

    expect(
      getUsedByRowRoute(
        UsedByRowKind.OnCallDutyPolicy,
        id,
        undefined,
        UsedByRelation.ScheduleOnCallPolicies,
      )?.toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route,
        { modelId: new ObjectID(id) },
      ).toString(),
    );
    expect(
      getUsedByRowRoute(UsedByRowKind.OnCallDutyPolicy, id)?.toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
        { modelId: new ObjectID(id) },
      ).toString(),
    );
    expect(
      getUsedByRowRoute(
        UsedByRowKind.StatusPage,
        id,
        undefined,
        UsedByRelation.MonitorStatusPages,
      )?.toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
        { modelId: new ObjectID(id) },
      ).toString(),
    );
  });

  test("nothing refers to it: says so, and what to do next with the page it is done on", async () => {
    getSummary.mockResolvedValue({
      recordKind: UsedByRecordKind.OnCallSchedule,
      recordId: RECORD.toString(),
      groups: [
        group({
          relation: UsedByRelation.ScheduleOnCallPolicies,
          rowKind: UsedByRowKind.OnCallDutyPolicy,
        }),
      ],
    });
    renderCard(UsedByRecordKind.OnCallSchedule);

    const empty: HTMLElement = await screen.findByTestId("used-by-empty");

    expect(empty).toHaveTextContent("Nothing uses this schedule yet");
    expect(empty).toHaveTextContent(
      "No on-call policy pages it, so nobody on it is paged. Add it to an on-call policy's escalation rule.",
    );
    expect(
      within(empty)
        .getByTestId("used-by-empty-action")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route,
      ).toString(),
    );
    expect(screen.queryByTestId("used-by-groups")).toBeNull();
  });

  test("a status page's card is what visitors see now, and its empty state needs no action", async () => {
    getSummary.mockResolvedValue({
      recordKind: UsedByRecordKind.StatusPage,
      recordId: RECORD.toString(),
      groups: [
        group({
          relation: UsedByRelation.StatusPageOpenIncidents,
          rowKind: UsedByRowKind.Incident,
        }),
        group({
          relation: UsedByRelation.StatusPageMaintenance,
          rowKind: UsedByRowKind.ScheduledMaintenance,
        }),
      ],
    });
    renderCard(UsedByRecordKind.StatusPage);

    expect(await screen.findByTestId("used-by-empty")).toHaveTextContent(
      "Nothing to tell visitors right now",
    );
    expect(screen.getByText("Showing now")).toBeInTheDocument();
    expect(screen.queryByTestId("used-by-empty-action")).toBeNull();
  });

  test("hidden records alone are not nothing: the card lists them", async () => {
    getSummary.mockResolvedValue(
      monitorSummary([
        { relation: UsedByRelation.MonitorDashboards, hiddenCount: 1 },
      ]),
    );
    renderCard();

    expect(await screen.findByTestId("used-by-hidden")).toHaveTextContent(
      "1 you can't see",
    );
    expect(screen.queryByTestId("used-by-empty")).toBeNull();
  });

  test("a failed read says why, and Try again reads it again", async () => {
    getSummary.mockRejectedValueOnce(
      new Error("The server could not be reached. Check your connection."),
    );
    getSummary.mockResolvedValueOnce(
      monitorSummary([
        { relation: UsedByRelation.MonitorGroups, count: 1, rows: [row(1)] },
      ]),
    );
    renderCard();

    const error: HTMLElement = await screen.findByTestId("used-by-error");

    expect(error).toHaveTextContent(
      "Couldn't load what uses this. The server could not be reached. Check your connection.",
    );

    fireEvent.click(within(error).getByTestId("used-by-try-again"));

    expect(await screen.findByTestId("used-by-group")).toBeInTheDocument();
    expect(getSummary).toHaveBeenCalledTimes(2);
  });

  /*
   * The card's sentence says an error nobody explained in the reader's
   * words (#7307): a gateway's 502 never reads "Error connecting to
   * server.", and a server failure's reference is in code with its copy
   * button.
   */
  test("a gateway's 502 says the server did not answer; a server failure keeps its reference", async () => {
    getSummary.mockRejectedValueOnce(new Error(SERVER_DOWN_MESSAGE));
    const first: ReturnType<typeof render> = renderCard();

    const down: HTMLElement = await screen.findByTestId("used-by-error");

    expect(down).toHaveTextContent(
      `Couldn't load what uses this. ${UnexplainedErrorWords.serverDownWhy} ${UnexplainedErrorWords.serverDownNext}`,
    );
    expect(down.textContent).not.toContain(SERVER_DOWN_MESSAGE);

    first.unmount();

    getSummary.mockRejectedValueOnce(
      new Error(getUnexplainedServerErrorMessage("1f0c9a2b")),
    );
    renderCard();

    const failed: HTMLElement = await screen.findByTestId("used-by-error");
    const reference: HTMLElement =
      within(failed).getByTestId("error-reference");

    expect(failed).toHaveTextContent(UnexplainedErrorWords.serverWhy);
    expect(within(reference).getByText("1f0c9a2b").tagName).toBe("CODE");
    expect(
      within(reference).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
  });

  test("read again when the page refreshes, and only then", async () => {
    getSummary.mockResolvedValue(monitorSummary());
    const view: ReturnType<typeof render> = renderCard(
      UsedByRecordKind.Monitor,
      0,
    );

    await screen.findByTestId("used-by-empty");
    expect(getSummary).toHaveBeenCalledTimes(1);

    view.rerender(
      <MemoryRouter>
        <UsedByCard
          recordKind={UsedByRecordKind.Monitor}
          recordId={new ObjectID(RECORD.toString())}
          refreshToken={0}
        />
      </MemoryRouter>,
    );
    expect(getSummary).toHaveBeenCalledTimes(1);

    view.rerender(
      <MemoryRouter>
        <UsedByCard
          recordKind={UsedByRecordKind.Monitor}
          recordId={RECORD}
          refreshToken={1}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(getSummary).toHaveBeenCalledTimes(2);
    });
  });

  test("an answer for a record the page has left is never drawn for the next one", async () => {
    let resolveFirst: (summary: UsedBySummary) => void = () => {
      return undefined;
    };

    getSummary.mockImplementationOnce(() => {
      return new Promise<UsedBySummary>(
        (resolve: (s: UsedBySummary) => void) => {
          resolveFirst = resolve;
        },
      );
    });
    getSummary.mockResolvedValueOnce(monitorSummary());

    const view: ReturnType<typeof render> = renderCard();
    const next: ObjectID = new ObjectID("68135555-0000-4000-8000-000000000999");

    view.rerender(
      <MemoryRouter>
        <UsedByCard recordKind={UsedByRecordKind.Monitor} recordId={next} />
      </MemoryRouter>,
    );

    await screen.findByTestId("used-by-empty");

    await act(async () => {
      resolveFirst(
        monitorSummary([
          { relation: UsedByRelation.MonitorGroups, count: 1, rows: [row(1)] },
        ]),
      );
    });

    expect(screen.queryByTestId("used-by-group")).toBeNull();
  });
});

describe("See all", () => {
  function manyRows(from: number, count: number): Array<UsedByRow> {
    return Array.from({ length: count }, (_value: unknown, index: number) => {
      return row(from + index);
    });
  }

  function page(data: Partial<UsedByPage>): UsedByPage {
    return {
      recordKind: UsedByRecordKind.Monitor,
      recordId: RECORD.toString(),
      relation: UsedByRelation.MonitorStatusPages,
      rowKind: UsedByRowKind.StatusPage,
      count: 120,
      hiddenCount: 5,
      pageStart: 0,
      pageSize: USED_BY_PAGE_SIZE,
      rows: [],
      ...data,
    };
  }

  test("opens the full list a page at a time, and Show more reads the next", async () => {
    getSummary.mockResolvedValue(
      monitorSummary([
        {
          relation: UsedByRelation.MonitorStatusPages,
          count: 120,
          hiddenCount: 5,
          rows: manyRows(0, 3),
        },
      ]),
    );
    getPage.mockResolvedValueOnce(page({ rows: manyRows(0, 50) }));
    getPage.mockResolvedValueOnce(
      page({ pageStart: 50, rows: manyRows(50, 50) }),
    );
    renderCard();

    fireEvent.click(await screen.findByTestId("used-by-see-all"));

    const dialog: HTMLElement = await screen.findByTestId(
      "used-by-dialog-rows",
    );

    expect(within(dialog).getAllByTestId("used-by-row")).toHaveLength(50);
    expect(
      within(dialog).getByTestId("used-by-dialog-impact"),
    ).toHaveTextContent("125 status pages show this monitor.");
    expect(within(dialog).getByTestId("used-by-hidden")).toHaveTextContent(
      "and 5 you can't see",
    );
    expect(getPage.mock.calls[0]?.[0]).toEqual({
      recordKind: UsedByRecordKind.Monitor,
      recordId: RECORD,
      relation: UsedByRelation.MonitorStatusPages,
      skip: 0,
      limit: USED_BY_PAGE_SIZE,
    });

    fireEvent.click(within(dialog).getByTestId("used-by-show-more"));

    await waitFor(() => {
      expect(within(dialog).getAllByTestId("used-by-row")).toHaveLength(100);
    });
    expect(getPage.mock.calls[1]?.[0]).toMatchObject({ skip: 50 });
    expect(sendEvent).toHaveBeenCalledWith(ProductEventName.UsedByListOpened, {
      record_kind: UsedByRecordKind.Monitor,
      relation: UsedByRelation.MonitorStatusPages,
    });
  });

  test("Show more goes when every row the reader may see is listed", async () => {
    getPage.mockResolvedValue(
      page({ count: 2, hiddenCount: 0, rows: manyRows(0, 2) }),
    );

    render(
      <MemoryRouter>
        <UsedByDialog
          recordKind={UsedByRecordKind.Monitor}
          recordId={RECORD}
          relation={UsedByRelation.MonitorStatusPages}
          onClose={() => {
            return undefined;
          }}
        />
      </MemoryRouter>,
    );

    await screen.findByTestId("used-by-dialog-rows");

    expect(screen.queryByTestId("used-by-show-more")).toBeNull();
    expect(screen.queryByTestId("used-by-hidden")).toBeNull();
  });

  test("a failed page says why and reads it again", async () => {
    getPage.mockRejectedValueOnce(new Error("Try again in a moment."));
    getPage.mockResolvedValueOnce(
      page({ count: 1, hiddenCount: 0, rows: [row(1)] }),
    );

    render(
      <MemoryRouter>
        <UsedByDialog
          recordKind={UsedByRecordKind.Monitor}
          recordId={RECORD}
          relation={UsedByRelation.MonitorStatusPages}
          onClose={() => {
            return undefined;
          }}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId("used-by-try-again"));

    expect(await screen.findByTestId("used-by-row")).toBeInTheDocument();
  });

  test("a label's Used by lists every kind first, and See all moves to one with a way back", async () => {
    getSummary.mockResolvedValue({
      recordKind: UsedByRecordKind.Label,
      recordId: RECORD.toString(),
      groups: [
        group({
          relation: UsedByRelation.LabelMonitors,
          rowKind: UsedByRowKind.Monitor,
          count: 4800,
          hiddenCount: 200,
          rows: manyRows(0, 3),
        }),
        group({
          relation: UsedByRelation.LabelIncidents,
          rowKind: UsedByRowKind.Incident,
        }),
      ],
    });
    getPage.mockResolvedValue(
      page({
        recordKind: UsedByRecordKind.Label,
        relation: UsedByRelation.LabelMonitors,
        rowKind: UsedByRowKind.Monitor,
        count: 4800,
        hiddenCount: 200,
        rows: manyRows(0, 50),
      }),
    );

    render(
      <MemoryRouter>
        <UsedByDialog
          recordKind={UsedByRecordKind.Label}
          recordId={RECORD}
          onClose={() => {
            return undefined;
          }}
        />
      </MemoryRouter>,
    );

    const groups: Array<HTMLElement> =
      await screen.findAllByTestId("used-by-group");
    expect(groups).toHaveLength(1);
    expect(
      within(groups[0] as HTMLElement).getByTestId("used-by-count"),
    ).toHaveTextContent("4,800");
    expect(sendEvent).toHaveBeenCalledWith(ProductEventName.UsedByListOpened, {
      record_kind: UsedByRecordKind.Label,
      relation: "all",
    });

    fireEvent.click(
      within(groups[0] as HTMLElement).getByTestId("used-by-see-all"),
    );

    expect(
      await screen.findByTestId("used-by-dialog-rows"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("used-by-dialog-impact")).toHaveTextContent(
      "5,000 monitors carry this label.",
    );

    fireEvent.click(screen.getByTestId("used-by-back"));

    expect(await screen.findAllByTestId("used-by-group")).toHaveLength(1);
  });
});

describe("Delete and Archive say what still uses it", () => {
  const usedSummary: UsedBySummary = monitorSummary([
    {
      relation: UsedByRelation.MonitorStatusPages,
      count: 1,
      hiddenCount: 2,
      rows: [row(1)],
    },
    { relation: UsedByRelation.MonitorSlos, count: 2, rows: [row(2), row(3)] },
  ]);

  test("the dialog's list: one sentence per kind, with how many the reader may not see", () => {
    render(<UsedByImpactList state={loaded(usedSummary)} />);

    const lines: Array<HTMLElement> = screen.getAllByTestId(
      "used-by-impact-line",
    );

    expect(
      lines.map((line: HTMLElement): string | null => {
        return line.textContent;
      }),
    ).toEqual([
      "3 status pages show this monitor.(2 of them you can't see)",
      "2 SLOs measure this monitor.",
    ]);
    expect(screen.getByTestId("used-by-impact")).toHaveTextContent(
      "Still in use",
    );
  });

  test("the page's notice can leave out what the page says otherwise", () => {
    render(
      <UsedByImpactNotice
        state={loaded(usedSummary)}
        leaveOut={[UsedByRelation.MonitorSlos]}
      />,
    );

    const notice: HTMLElement = screen.getByTestId("used-by-impact-notice");

    expect(notice).toHaveTextContent(
      "Deleting it changes these. Check them before you delete it.",
    );
    expect(within(notice).getAllByTestId("used-by-impact-line")).toHaveLength(
      1,
    );
    expect(notice).not.toHaveTextContent("SLOs measure this monitor");
  });

  test("nothing is said while it loads, when it fails, or when nothing uses it", () => {
    for (const state of [
      { status: "loading" } as UsedBySummaryState,
      { status: "error", message: "No." } as UsedBySummaryState,
      loaded(monitorSummary()),
    ]) {
      const view: ReturnType<typeof render> = render(
        <>
          <UsedByImpactNotice state={state} />
          <UsedByImpactList state={state} />
        </>,
      );

      expect(screen.queryByTestId("used-by-impact-notice")).toBeNull();
      expect(screen.queryByTestId("used-by-impact")).toBeNull();
      expect(hasUsedByImpact(state)).toBe(false);
      view.unmount();
    }

    expect(hasUsedByImpact(loaded(usedSummary))).toBe(true);
    expect(
      hasUsedByImpact(
        loaded(
          monitorSummary([{ relation: UsedByRelation.MonitorSlos, count: 1 }]),
        ),
        [UsedByRelation.MonitorSlos],
      ),
    ).toBe(false);
  });

  test("an Archive dialog reads what uses the record only when it opens, and lists it", async () => {
    getSummary.mockResolvedValue(usedSummary);
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: true,
    } as never);
    jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(
        Object.assign(new Monitor(), { isArchived: false }) as never,
      );

    render(
      <MemoryRouter>
        <ArchiveResourceCard<Monitor>
          modelType={Monitor}
          modelId={RECORD}
          singularName="monitor"
          archiveConfirmationContent={
            <UsedByImpactForRecord
              recordKind={UsedByRecordKind.Monitor}
              recordId={RECORD}
            />
          }
        />
      </MemoryRouter>,
    );

    const archive: HTMLElement = await screen.findByRole("button", {
      name: /Archive/u,
    });

    // The card alone reads nothing of what uses the monitor.
    expect(getSummary).not.toHaveBeenCalled();

    fireEvent.click(archive);

    expect(await screen.findByTestId("used-by-impact")).toHaveTextContent(
      "3 status pages show this monitor.",
    );
    expect(getSummary).toHaveBeenCalledTimes(1);
  });

  test("an Unarchive dialog says nothing of what uses it", async () => {
    getSummary.mockResolvedValue(usedSummary);
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: true,
    } as never);
    jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(
        Object.assign(new Monitor(), { isArchived: true }) as never,
      );

    render(
      <MemoryRouter>
        <ArchiveResourceCard<Monitor>
          modelType={Monitor}
          modelId={RECORD}
          singularName="monitor"
          archiveConfirmationContent={
            <UsedByImpactForRecord
              recordKind={UsedByRecordKind.Monitor}
              recordId={RECORD}
            />
          }
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Unarchive/u }));

    await screen.findByText(/unarchive this monitor/u);
    expect(screen.queryByTestId("used-by-impact")).toBeNull();
    expect(getSummary).not.toHaveBeenCalled();
  });
});

describe("a family's line: rules, templates, everything a team owns (#7433, #7434)", () => {
  const rulesSummary: UsedBySummary = monitorSummary([
    {
      relation: UsedByRelation.MonitorRules,
      rowKind: UsedByRowKind.IncidentOnCallRule,
      count: 3,
      hiddenCount: 2,
      parts: [
        { rowKind: UsedByRowKind.IncidentOnCallRule, count: 2, hiddenCount: 0 },
        { rowKind: UsedByRowKind.AlertOwnerRule, count: 1, hiddenCount: 2 },
      ],
      rows: [
        row(1, {
          name: "Page the platform team",
          rowKind: UsedByRowKind.IncidentOnCallRule,
        }),
        row(2, {
          name: "Database alerts",
          rowKind: UsedByRowKind.AlertOwnerRule,
          isOff: true,
        }),
        row(3, {
          name: "Fast burn",
          rowKind: UsedByRowKind.SloBurnRateRule,
          linkId: "68135555-0000-4000-8000-000000000777",
        }),
      ],
    },
  ]);

  test("each row says its kind under its name, Off when it is, and opens its own page", async () => {
    getSummary.mockResolvedValue(rulesSummary);
    renderCard();

    const rows: Array<HTMLElement> =
      await screen.findAllByTestId("used-by-row");

    expect(
      rows.map((each: HTMLElement): string | null => {
        return each.getAttribute("data-row-kind");
      }),
    ).toEqual([
      UsedByRowKind.IncidentOnCallRule,
      UsedByRowKind.AlertOwnerRule,
      UsedByRowKind.SloBurnRateRule,
    ]);
    expect(
      within(rows[0] as HTMLElement).getByTestId("used-by-row-detail"),
    ).toHaveTextContent("Incident On-Call Rule");
    expect(
      within(rows[1] as HTMLElement).getByTestId("used-by-row-detail"),
    ).toHaveTextContent("Alert Owner Rule · Off");

    // An on-call rule opens its event's rules; an owner rule its own page.
    expect(
      within(rows[0] as HTMLElement)
        .getByText("Page the platform team")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES] as Route,
      ).toString(),
    );
    expect(
      within(rows[1] as HTMLElement)
        .getByText("Database alerts")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ALERTS_SETTINGS_OWNER_RULE_VIEW] as Route,
        { modelId: new ObjectID(row(2).id) },
      ).toString(),
    );
    // An SLO's burn-rate rule opens its SLO's page of them.
    expect(
      within(rows[2] as HTMLElement)
        .getByText("Fast burn")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.SLO_VIEW_BURN_RATE_RULES] as Route,
        { modelId: new ObjectID("68135555-0000-4000-8000-000000000777") },
      ).toString(),
    );

    const family: HTMLElement = screen.getByTestId("used-by-group");
    expect(within(family).getByText("Rules that name it")).toBeInTheDocument();
    expect(within(family).getByTestId("used-by-hidden")).toHaveTextContent(
      "and 2 you can't see",
    );
  });

  test("a kind with no page of its own is its name, not a link", async () => {
    getSummary.mockResolvedValue({
      recordKind: UsedByRecordKind.Team,
      recordId: RECORD.toString(),
      groups: [
        group({
          relation: UsedByRelation.TeamOwnedOther,
          rowKind: UsedByRowKind.ServiceLevelObjective,
          count: 1,
          parts: [{ rowKind: UsedByRowKind.AIAgent, count: 1, hiddenCount: 0 }],
          rows: [
            row(1, { name: "Cluster agent", rowKind: UsedByRowKind.AIAgent }),
          ],
        }),
      ],
    });
    renderCard(UsedByRecordKind.Team);

    const name: HTMLElement = await screen.findByTestId("used-by-row-name");

    expect(name).toHaveTextContent("Cluster agent");
    expect(name.closest("a")).toBeNull();
    expect(screen.getByText("Everything else it owns")).toBeInTheDocument();
  });

  test("its Delete dialog says its kinds under its sentence", () => {
    render(<UsedByImpactList state={loaded(rulesSummary)} />);

    const line: HTMLElement = screen.getByTestId("used-by-impact-line");

    expect(line).toHaveTextContent("5 rules name this monitor.");
    expect(within(line).getByTestId("used-by-impact-parts")).toHaveTextContent(
      "Incident On-Call Rule: 2 · Alert Owner Rule: 3",
    );
  });

  test("the kinds read in the reader's language, with its own colon", () => {
    const french: Translator = localeTranslator("fr");
    const german: Translator = localeTranslator("de");
    const parts: Pick<UsedByCounts, "parts"> = {
      parts: [
        { rowKind: UsedByRowKind.IncidentOnCallRule, count: 2, hiddenCount: 0 },
      ],
    };

    expect(getUsedByPartsLine(parts, german)).toBe(
      "Bereitschaftsregel für Vorfälle: 2",
    );
    // French sets its colon apart (Docs/ux/README.md#in-every-language).
    expect(getUsedByPartsLine(parts, french)).toMatch(
      /^Règle d'astreinte des incidents\s:\s2$/u,
    );
    expect(getUsedByPartsLine({}, german)).toBe("");
  });
});

describe("what runs an on-call policy (#7758)", () => {
  test("the card says what runs it, its on-call rules first", async () => {
    getSummary.mockResolvedValue({
      recordKind: UsedByRecordKind.OnCallPolicy,
      recordId: RECORD.toString(),
      groups: [
        group({
          relation: UsedByRelation.OnCallPolicyRules,
          rowKind: UsedByRowKind.IncidentOnCallRule,
          count: 1,
          parts: [
            {
              rowKind: UsedByRowKind.IncidentOnCallRule,
              count: 1,
              hiddenCount: 0,
            },
          ],
          rows: [
            row(1, {
              name: "Page Default on-call policy for every incident",
              rowKind: UsedByRowKind.IncidentOnCallRule,
            }),
          ],
        }),
        group({
          relation: UsedByRelation.OnCallPolicyMonitors,
          rowKind: UsedByRowKind.Monitor,
          count: 1,
          rows: [row(2, { name: "Checkout API", isOff: true })],
        }),
      ],
    });
    renderCard(UsedByRecordKind.OnCallPolicy);

    const groups: Array<HTMLElement> =
      await screen.findAllByTestId("used-by-group");

    expect(screen.getByText("What runs this policy")).toBeInTheDocument();
    expect(
      within(groups[0] as HTMLElement).getByText("On-call rules that page it"),
    ).toBeInTheDocument();
    expect(
      within(groups[1] as HTMLElement).getByText(
        "Monitors whose criteria page it",
      ),
    ).toBeInTheDocument();
    // A monitor that is not checked pages nobody: it says Off.
    expect(
      within(groups[1] as HTMLElement).getByTestId("used-by-row-detail"),
    ).toHaveTextContent("Off");
  });

  test("nothing runs it: says so plainly, and where to add a rule", async () => {
    getSummary.mockResolvedValue({
      recordKind: UsedByRecordKind.OnCallPolicy,
      recordId: RECORD.toString(),
      groups: getUsedByRelations(UsedByRecordKind.OnCallPolicy).map(
        (description: { relation: UsedByRelation; rowKind: UsedByRowKind }) => {
          return group({
            relation: description.relation,
            rowKind: description.rowKind,
          });
        },
      ),
    });
    renderCard(UsedByRecordKind.OnCallPolicy);

    const empty: HTMLElement = await screen.findByTestId("used-by-empty");

    expect(empty).toHaveTextContent("Nothing runs this policy yet");
    expect(empty).toHaveTextContent(
      "No on-call rule, monitor or template pages it, so it pages nobody.",
    );
    expect(
      within(empty)
        .getByTestId("used-by-empty-action")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES] as Route,
      ).toString(),
    );
  });
});

describe("a monitor group's and an SLO's card (#7437)", () => {
  test("a group no status page shows says where to add it", async () => {
    getSummary.mockResolvedValue({
      recordKind: UsedByRecordKind.MonitorGroup,
      recordId: RECORD.toString(),
      groups: [
        group({
          relation: UsedByRelation.MonitorGroupStatusPages,
          rowKind: UsedByRowKind.StatusPage,
        }),
      ],
    });
    renderCard(UsedByRecordKind.MonitorGroup);

    const empty: HTMLElement = await screen.findByTestId("used-by-empty");

    expect(empty).toHaveTextContent("No status page shows this group yet");
    expect(
      within(empty)
        .getByTestId("used-by-empty-action")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGES] as Route,
      ).toString(),
    );
  });

  test("a group two status pages show says so", async () => {
    getSummary.mockResolvedValue({
      recordKind: UsedByRecordKind.MonitorGroup,
      recordId: RECORD.toString(),
      groups: [
        group({
          relation: UsedByRelation.MonitorGroupStatusPages,
          rowKind: UsedByRowKind.StatusPage,
          count: 2,
          rows: [row(1, { name: "Public" }), row(2, { name: "Partners" })],
        }),
      ],
    });
    renderCard(UsedByRecordKind.MonitorGroup);

    expect(await screen.findByTestId("used-by-count")).toHaveTextContent("2");
    expect(
      screen.getByText("Partners").closest("a")?.getAttribute("href"),
    ).toBe(getUsedByRowRoute(UsedByRowKind.StatusPage, row(2).id)?.toString());
  });

  test("an unused SLO says so with no button of its own: its Getting started card offers burn-rate rules", async () => {
    getSummary.mockResolvedValue({
      recordKind: UsedByRecordKind.Slo,
      recordId: RECORD.toString(),
      groups: [],
    });
    renderCard(UsedByRecordKind.Slo);

    expect(await screen.findByTestId("used-by-empty")).toHaveTextContent(
      "Nothing uses this SLO yet",
    );
    expect(screen.queryByTestId("used-by-empty-action")).toBeNull();
  });
});

describe("a list's bulk Delete and Archive (#7435)", () => {
  const SECOND: ObjectID = new ObjectID("68135555-0000-4000-8000-000000000002");

  const bulkSummary: UsedByBulkSummary = {
    recordKind: UsedByRecordKind.Monitor,
    recordCount: 2,
    groups: [
      {
        relation: UsedByRelation.MonitorStatusPages,
        rowKind: UsedByRowKind.StatusPage,
        count: 10,
        hiddenCount: 2,
      },
      {
        relation: UsedByRelation.MonitorGroups,
        rowKind: UsedByRowKind.MonitorGroup,
        count: 0,
        hiddenCount: 0,
      },
      {
        relation: UsedByRelation.MonitorRules,
        rowKind: UsedByRowKind.IncidentOnCallRule,
        count: 1,
        hiddenCount: 0,
        parts: [
          {
            rowKind: UsedByRowKind.IncidentOnCallRule,
            count: 1,
            hiddenCount: 0,
          },
        ],
      },
    ],
  };

  function controls(): {
    held: Array<boolean>;
    value: BulkActionConfirmControls;
  } {
    const held: Array<boolean> = [];

    return {
      held: held,
      value: {
        setIsSubmitHeld: (isHeld: boolean): void => {
          held.push(isHeld);
        },
      },
    };
  }

  test("one request for the whole selection; its action waits for the answer", async () => {
    const getSummaries: SpyInstance<typeof UsedByApi.getSummaries> = jest
      .spyOn(UsedByApi, "getSummaries")
      .mockResolvedValue(bulkSummary);
    const hold: { held: Array<boolean>; value: BulkActionConfirmControls } =
      controls();

    render(
      <UsedByBulkImpact
        recordKind={UsedByRecordKind.Monitor}
        recordIds={[RECORD, SECOND]}
        controls={hold.value}
      />,
    );

    expect(screen.getByTestId("used-by-bulk-checking")).toHaveTextContent(
      "Checking what still uses them…",
    );

    const box: HTMLElement = await screen.findByTestId("used-by-bulk-impact");
    const lines: Array<HTMLElement> = within(box).getAllByTestId(
      "used-by-impact-line",
    );

    expect(
      lines.map((line: HTMLElement): string | null => {
        return line.getAttribute("data-relation");
      }),
    ).toEqual([UsedByRelation.MonitorStatusPages, UsedByRelation.MonitorRules]);
    expect(lines[0]).toHaveTextContent(
      "12 status pages show the selected monitors.(2 of them you can't see)",
    );
    expect(lines[1]).toHaveTextContent("1 rule names the selected monitors.");
    expect(box).toHaveTextContent("Still in use");
    expect(getSummaries).toHaveBeenCalledTimes(1);
    expect(getSummaries.mock.calls[0]?.[0]).toEqual({
      recordKind: UsedByRecordKind.Monitor,
      recordIds: [RECORD, SECOND],
    });
    // Held while it read, let go once it had the answer.
    expect(hold.held).toEqual([true, false]);
  });

  test("a read that fails says nothing and lets the action go", async () => {
    jest
      .spyOn(UsedByApi, "getSummaries")
      .mockRejectedValue(new Error("The server could not be reached."));
    const hold: { held: Array<boolean>; value: BulkActionConfirmControls } =
      controls();

    render(
      <UsedByBulkImpact
        recordKind={UsedByRecordKind.Monitor}
        recordIds={[RECORD]}
        controls={hold.value}
      />,
    );

    await waitFor(() => {
      expect(hold.held).toEqual([true, false]);
    });
    expect(screen.queryByTestId("used-by-bulk-impact")).toBeNull();
    expect(screen.queryByTestId("used-by-bulk-checking")).toBeNull();
  });

  test("nothing using the selection says nothing", async () => {
    jest.spyOn(UsedByApi, "getSummaries").mockResolvedValue({
      ...bulkSummary,
      groups: [],
    });

    render(
      <UsedByBulkImpact
        recordKind={UsedByRecordKind.Monitor}
        recordIds={[RECORD]}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("used-by-bulk-checking")).toBeNull();
    });
    expect(screen.queryByTestId("used-by-bulk-impact")).toBeNull();
  });

  test("a row's Delete reads its record's summary and says what still uses it under its question", async () => {
    getSummary.mockResolvedValue(
      monitorSummary([
        {
          relation: UsedByRelation.MonitorStatusPages,
          count: 3,
          rows: [row(1)],
        },
      ]),
    );
    const actions: UsedByListActions<Monitor> = getUsedByListActions<Monitor>(
      UsedByRecordKind.Monitor,
    );
    const monitor: Monitor = Object.assign(new Monitor(), {
      _id: RECORD.toString(),
    });

    const confirmation: DeleteConfirmation =
      await actions.getDeleteConfirmation(monitor);

    // The table's own question stays: only details are added.
    expect(confirmation.description).toBeUndefined();
    render(<>{confirmation.details}</>);
    expect(screen.getByTestId("used-by-impact-line")).toHaveTextContent(
      "3 status pages show this monitor.",
    );
    expect(getSummary).toHaveBeenCalledWith({
      recordKind: UsedByRecordKind.Monitor,
      recordId: RECORD,
    });
  });

  test("a row's Delete whose read fails opens as it always did", async () => {
    getSummary.mockRejectedValue(new Error("No."));
    const actions: UsedByListActions<Monitor> = getUsedByListActions<Monitor>(
      UsedByRecordKind.Monitor,
    );

    expect(
      await actions.getDeleteConfirmation(
        Object.assign(new Monitor(), { _id: RECORD.toString() }),
      ),
    ).toEqual({});
  });

  test("a row's Archive reads what uses it when its dialog opens, saying it is checking", async () => {
    let resolve: (summary: UsedBySummary) => void = () => {
      return undefined;
    };
    getSummary.mockImplementation(() => {
      return new Promise<UsedBySummary>((done: (s: UsedBySummary) => void) => {
        resolve = done;
      });
    });
    const actions: UsedByListActions<Monitor> = getUsedByListActions<Monitor>(
      UsedByRecordKind.Monitor,
    );

    render(
      <>
        {actions.getArchiveConfirmationDetails(
          Object.assign(new Monitor(), { _id: RECORD.toString() }),
        )}
      </>,
    );

    expect(screen.getByTestId("used-by-checking")).toHaveTextContent(
      "Checking what still uses it…",
    );

    await act(async () => {
      resolve(
        monitorSummary([
          { relation: UsedByRelation.MonitorSlos, count: 2, rows: [row(1)] },
        ]),
      );
    });

    expect(screen.getByTestId("used-by-impact")).toHaveTextContent(
      "2 SLOs measure this monitor.",
    );
  });

  test("the bulk dialogs' details read the selection's ids", () => {
    const actions: UsedByListActions<Monitor> = getUsedByListActions<Monitor>(
      UsedByRecordKind.Monitor,
    );
    const element: React.ReactElement | undefined =
      actions.deleteConfirmationDetails(
        [
          Object.assign(new Monitor(), { _id: RECORD.toString() }),
          Object.assign(new Monitor(), { _id: SECOND.toString() }),
        ],
        controls().value,
      );

    expect(
      (element?.props as { recordIds: Array<ObjectID> }).recordIds.map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([RECORD.toString(), SECOND.toString()]);
    expect(actions.archiveConfirmDetails([], controls().value)).toBeUndefined();
  });

  test("every relation a list's bulk Delete counts has its sentence for a selection", () => {
    for (const kind of [
      UsedByRecordKind.Monitor,
      UsedByRecordKind.OnCallSchedule,
      UsedByRecordKind.Service,
      UsedByRecordKind.StatusPage,
      UsedByRecordKind.Team,
      UsedByRecordKind.OnCallPolicy,
      UsedByRecordKind.MonitorGroup,
      UsedByRecordKind.Slo,
    ]) {
      for (const description of getUsedByBulkRelations(kind)) {
        const words: (typeof USED_BY_RELATION_WORDS)[UsedByRelation] =
          USED_BY_RELATION_WORDS[description.relation];

        expect({
          relation: description.relation,
          one: words.bulkImpact?.one.includes("{{count}}"),
          other: words.bulkImpact?.other.includes("{{count}}"),
        }).toEqual({ relation: description.relation, one: true, other: true });
      }
    }

    expect(
      getUsedByBulkImpactSentence(
        {
          relation: UsedByRelation.TeamOwnedOther,
          count: 1,
          hiddenCount: 0,
        },
        translator,
      ),
    ).toBe("The selected teams own 1 other record.");
    // A relation no list counts for a selection has no sentence for one.
    expect(
      getUsedByBulkImpactSentence(
        {
          relation: UsedByRelation.StatusPageOpenIncidents,
          count: 1,
          hiddenCount: 0,
        },
        translator,
      ),
    ).toBe("");
  });

  test("the sentences for a selection read in German and Persian, with the count in them", () => {
    expect(
      getUsedByBulkImpactSentence(
        {
          relation: UsedByRelation.MonitorStatusPages,
          count: 12,
          hiddenCount: 0,
        },
        localeTranslator("de"),
      ),
    ).toBe("12 Statusseiten zeigen die ausgewählten Monitore.");
    expect(
      getUsedByBulkImpactSentence(
        {
          relation: UsedByRelation.MonitorStatusPages,
          count: 1,
          hiddenCount: 0,
        },
        localeTranslator("de"),
      ),
    ).toBe("1 Statusseite zeigt die ausgewählten Monitore.");
    expect(
      getUsedByBulkImpactSentence(
        {
          relation: UsedByRelation.TeamOwnedMonitors,
          count: 3,
          hiddenCount: 0,
        },
        localeTranslator("fa"),
      ),
    ).toContain("تیم‌های انتخاب‌شده");
  });
});
