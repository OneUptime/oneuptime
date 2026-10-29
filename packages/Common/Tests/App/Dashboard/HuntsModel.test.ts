import {
  HUNT_FORM_STEPS,
  HUNT_TELL_FIELD_KEY,
  countHuntFormRecipients,
  getHuntFormFields,
  getHuntScheduleDropdownOptions,
  getHuntTellPickerConfig,
  getHuntTimeRangeDropdownOptions,
  getNewHuntInitialValues,
  getSaveAsHuntFormFields,
  hasHuntFormFilters,
  isHuntFormScheduled,
  isHuntFormSearchRequired,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntFormFields";
import {
  HUNT_RECIPIENTS_NAMED,
  HuntRunState,
  getHuntLastFoundWindow,
  getHuntRecipientsLine,
  getHuntRunState,
  getHuntTimeRange,
  getHuntTimeRangeToSave,
  getHuntValuesToSave,
  getHuntViewRoute,
  getHuntsRoute,
  getSecurityEventsRoute,
  hasHuntSearchToSave,
  isHuntSearchChanged,
  toCustomTimeRange,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsModel";
import {
  ADD_TO_CASE_LIST_LIMIT,
  CasePickerItem,
  getCaseEventOutcome,
  getCaseEventReferences,
  getOpenCasesQuery,
  toCasePickerItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/AddToCaseModel";
import {
  getEventEvidenceMeta,
  isEventEvidence,
  readEventEvidence,
  toSecurityEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Evidence/EventEvidence";
import { SECURITY_EVENT_FACET_KEYS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsFacets";
import * as DashboardSearch from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsSearchQuery";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseEvidence from "../../../Models/DatabaseModels/SecurityCaseEvidence";
import SecurityHunt from "../../../Models/DatabaseModels/SecurityHunt";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseEvidenceKind from "../../../Types/SecurityCase/SecurityCaseEvidenceKind";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  SECURITY_CASE_EVENTS_ADD_REASONS,
  SecurityCaseEventSnapshot,
  buildSecurityCaseEventSnapshot,
} from "../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SECURITY_HUNT_MESSAGES,
  SECURITY_HUNT_SCHEDULES,
  SECURITY_HUNT_TIME_RANGES,
  SecurityHuntSchedule,
} from "../../../Types/SecurityEvent/SecurityHunt";
import TimeRange from "../../../Types/Time/TimeRange";
import * as SharedSearch from "../../../Utils/SecurityEvent/SecurityEventSearch";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import {
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  testPriorityId,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";
import Navigation from "../../../UI/Utils/Navigation";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE HUNTS' SMALL RULES IN THE DASHBOARD, React-free: where a hunt opens,
 * what Save as Hunt keeps of the Events page, when a hunt's page holds a
 * change, what a row says about its runs; the forms (two steps, Tell once
 * scheduled); which cases Add to Case offers and what happened to each
 * event; and how a kept event reads on a case.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const HUNT_ID: string = "3b000000-0000-4000-8000-000000000001";

// A translator that hands each key back, as an English page reads it.
const translator: Translator = {
  translateText: (text: string): string => {
    return text;
  },
} as unknown as Translator;

function chips(
  entries: Array<[string, Array<string>]>,
): Map<string, Set<string>> {
  return new Map<string, Set<string>>(
    entries.map(
      ([key, values]: [string, Array<string>]): [string, Set<string>] => {
        return [key, new Set<string>(values)];
      },
    ),
  );
}

beforeEach(() => {
  jest.spyOn(Navigation, "getParamByName").mockImplementation(((
    name: string,
  ): string | null => {
    return name === "projectId" ? PROJECT_ID : null;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Dashboard's Events search is the shared one", () => {
  test("every compile the page uses is the one a hunt's run uses", () => {
    expect(DashboardSearch.parseSecurityEventSearch).toBe(
      SharedSearch.parseSecurityEventSearch,
    );
    expect(DashboardSearch.applySecurityEventSearchToQuery).toBe(
      SharedSearch.applySecurityEventSearchToQuery,
    );
    expect(DashboardSearch.SECURITY_EVENT_FIELD_ALIASES).toBe(
      SharedSearch.SECURITY_EVENT_FIELD_ALIASES,
    );
  });

  test("the sidebar offers exactly the columns a hunt's chip may name", () => {
    expect([...SECURITY_EVENT_FACET_KEYS]).toEqual([
      ...SharedSearch.SECURITY_EVENT_FACET_COLUMNS,
    ]);
  });
});

describe("where a hunt opens", () => {
  test("its page, under Security Events, and on a run's window as the Events page reads one", () => {
    const route: string = getHuntViewRoute(HUNT_ID).toString();

    expect(route).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_HUNT_VIEW] as Route,
        { modelId: HUNT_ID },
      ).toString(),
    );
    expect(route.endsWith(`/security-events/hunts/${HUNT_ID}`)).toBe(true);

    const onWindow: string = getHuntViewRoute(HUNT_ID, {
      startTime: new Date("2026-10-28T10:00:00.000Z"),
      endTime: new Date("2026-10-29T10:00:00.000Z"),
    }).toString();
    const query: URLSearchParams = new URLSearchParams(
      onWindow.split("?")[1] || "",
    );

    expect(onWindow.startsWith(`${route}?`)).toBe(true);
    expect(query.get("range")).toBe(TimeRange.CUSTOM);
    expect(query.get("start")).toBe("2026-10-28T10:00:00.000Z");
    expect(query.get("end")).toBe("2026-10-29T10:00:00.000Z");
  });

  test("the list, and Events, are their own pages", () => {
    expect(getHuntsRoute().toString().endsWith("/security-events/hunts")).toBe(
      true,
    );
    expect(
      getSecurityEventsRoute().toString().endsWith("/security-events"),
    ).toBe(true);
  });
});

describe("Save as Hunt", () => {
  test("has something to save with a search, or a chip", () => {
    expect(hasHuntSearchToSave({ search: "  ", filters: new Map() })).toBe(
      false,
    );
    expect(
      hasHuntSearchToSave({
        search: "",
        filters: chips([["severityName", []]]),
      }),
    ).toBe(false);
    expect(
      hasHuntSearchToSave({ search: "user:root", filters: new Map() }),
    ).toBe(true);
    expect(
      hasHuntSearchToSave({
        search: "",
        filters: chips([["severityName", ["High"]]]),
      }),
    ).toBe(true);
  });

  test("keeps the search as trimmed, the chips, and the window the page moves with", () => {
    expect(
      getHuntValuesToSave({
        search: "  user:root  ",
        filters: chips([["!statusName", ["Success"]]]),
        timeRange: { range: TimeRange.PAST_ONE_DAY },
      }),
    ).toEqual({
      searchQuery: "user:root",
      filters: { "!statusName": ["Success"] },
      timeRange: TimeRange.PAST_ONE_DAY,
    });
  });

  test("keeps a zoom or a typed range as the shortest moving window that holds it", () => {
    expect(
      getHuntTimeRangeToSave({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-10-29T10:00:00.000Z"),
          new Date("2026-10-29T11:30:00.000Z"),
        ),
      }),
    ).toBe(TimeRange.PAST_TWO_HOURS);
    expect(getHuntTimeRangeToSave(undefined)).toBe(TimeRange.PAST_ONE_WEEK);
  });

  test("opens a hunt on the window it keeps, a week for one it does not know", () => {
    expect(getHuntTimeRange(TimeRange.PAST_ONE_MONTH)).toEqual({
      range: TimeRange.PAST_ONE_MONTH,
    });
    expect(getHuntTimeRange("Past 2 Years")).toEqual({
      range: TimeRange.PAST_ONE_WEEK,
    });
    expect(getHuntTimeRange(null)).toEqual({ range: TimeRange.PAST_ONE_WEEK });
  });
});

describe("a hunt's page holds a change", () => {
  test("when its search or its chips differ from what the hunt keeps", () => {
    const saved: { savedSearch: string; savedFilters: JSONObject } = {
      savedSearch: "processname:powershell.exe",
      savedFilters: { severityName: ["High", "Critical"] },
    };

    expect(
      isHuntSearchChanged({
        ...saved,
        search: " processname:powershell.exe ",
        filters: chips([["severityName", ["Critical", "High"]]]),
      }),
    ).toBe(false);
    expect(
      isHuntSearchChanged({
        ...saved,
        search: "processname:pwsh.exe",
        filters: chips([["severityName", ["Critical", "High"]]]),
      }),
    ).toBe(true);
    expect(
      isHuntSearchChanged({
        ...saved,
        search: "processname:powershell.exe",
        filters: chips([["severityName", ["High"]]]),
      }),
    ).toBe(true);
  });
});

describe("what a row says", () => {
  test("names the first two it tells, then how many more", () => {
    expect(HUNT_RECIPIENTS_NAMED).toBe(2);
    expect(getHuntRecipientsLine([" Maya Chen ", "", "SOC Tier 2"])).toEqual({
      names: ["Maya Chen", "SOC Tier 2"],
      moreCount: 0,
    });
    expect(
      getHuntRecipientsLine(["Maya Chen", "SOC Tier 2", "Diego", "Sam"]),
    ).toEqual({ names: ["Maya Chen", "SOC Tier 2"], moreCount: 2 });
  });

  test("its runs' state: failed first, then found, then not scheduled, run or not yet", () => {
    const at: Date = new Date("2026-10-29T10:00:00.000Z");

    expect(
      getHuntRunState({
        schedule: SecurityHuntSchedule.EveryDay,
        lastRunError: "x",
        lastFoundAt: at,
        lastFoundEventCount: 3,
      }),
    ).toBe(HuntRunState.Failed);
    expect(
      getHuntRunState({
        schedule: SecurityHuntSchedule.EveryDay,
        lastFoundAt: at,
        lastFoundEventCount: 3,
      }),
    ).toBe(HuntRunState.Found);
    // Taken off its schedule: what it found stays said; an old error does not.
    expect(
      getHuntRunState({
        schedule: SecurityHuntSchedule.NotScheduled,
        lastRunError: "x",
        lastFoundAt: at,
        lastFoundEventCount: 3,
      }),
    ).toBe(HuntRunState.Found);
    expect(
      getHuntRunState({
        schedule: SecurityHuntSchedule.NotScheduled,
        lastRunError: "x",
      }),
    ).toBe(HuntRunState.NotScheduled);
    expect(
      getHuntRunState({
        schedule: SecurityHuntSchedule.EveryHour,
        lastRunAt: at,
      }),
    ).toBe(HuntRunState.NothingFound);
    expect(getHuntRunState({ schedule: SecurityHuntSchedule.EveryHour })).toBe(
      HuntRunState.NotRunYet,
    );
  });

  test("shows what the last find found on the window it read, or nothing for a window that does not read", () => {
    const window: { startTime: Date; endTime: Date } = {
      startTime: new Date("2026-10-28T10:00:00.000Z"),
      endTime: new Date("2026-10-29T10:00:00.000Z"),
    };

    expect(
      getHuntLastFoundWindow({
        lastFoundSinceAt: window.startTime,
        lastFoundAt: window.endTime,
      }),
    ).toEqual(window);
    expect(getHuntLastFoundWindow({ lastFoundAt: window.endTime })).toBeNull();
    expect(
      getHuntLastFoundWindow({
        lastFoundSinceAt: window.endTime,
        lastFoundAt: window.startTime,
      }),
    ).toBeNull();
    expect(toCustomTimeRange(window)).toEqual({
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(window.startTime, window.endTime),
    });
  });
});

describe("the hunt forms", () => {
  function fieldKeys(fields: Array<ModelField<SecurityHunt>>): Array<string> {
    return fields.map((field: ModelField<SecurityHunt>): string => {
      return Object.keys(field.field || {})[0] || "";
    });
  }

  function fieldOf(
    fields: Array<ModelField<SecurityHunt>>,
    key: string,
  ): ModelField<SecurityHunt> {
    const field: ModelField<SecurityHunt> | undefined = fields.find(
      (candidate: ModelField<SecurityHunt>): boolean => {
        return Object.keys(candidate.field || {})[0] === key;
      },
    );

    expect(field).toBeDefined();
    return field!;
  }

  const values: (data: Record<string, unknown>) => FormValues<SecurityHunt> = (
    data: Record<string, unknown>,
  ): FormValues<SecurityHunt> => {
    return data as FormValues<SecurityHunt>;
  };

  test("Create and Edit: what it searches for, then whether it runs on its own", () => {
    const fields: Array<ModelField<SecurityHunt>> = getHuntFormFields({
      translator,
    });

    expect(
      HUNT_FORM_STEPS.map((step: { id: string }) => {
        return step.id;
      }),
    ).toEqual(["search", "schedule"]);
    expect(fieldKeys(fields)).toEqual([
      "name",
      "searchQuery",
      "filters",
      "timeRange",
      "description",
      "schedule",
      HUNT_TELL_FIELD_KEY,
    ]);
    expect(
      fields.map((field: ModelField<SecurityHunt>): string | undefined => {
        return field.stepId;
      }),
    ).toEqual([
      "search",
      "search",
      "search",
      "search",
      "search",
      "schedule",
      "schedule",
    ]);
    // The description waits under More fields.
    expect(fieldOf(fields, "description").collapsibleSection).toBeDefined();
  });

  test("never shows a hunt's chips, but reads them: with chips, the search may be empty", () => {
    const fields: Array<ModelField<SecurityHunt>> = getHuntFormFields({
      translator,
    });
    const filters: ModelField<SecurityHunt> = fieldOf(fields, "filters");
    const search: ModelField<SecurityHunt> = fieldOf(fields, "searchQuery");

    expect(filters.showIf!(values({}))).toBe(false);
    expect(filters.fieldType).toBe(FormFieldSchemaType.JSON);
    expect(search.required).toBe(isHuntFormSearchRequired);
    expect(isHuntFormSearchRequired(values({}))).toBe(true);
    expect(
      isHuntFormSearchRequired(
        values({ filters: { "attributes.threat.matched": ["true"] } }),
      ),
    ).toBe(false);
    expect(hasHuntFormFilters(values({ filters: { severityName: [] } }))).toBe(
      false,
    );
  });

  test("says each field's problem in the shared rules' words", () => {
    const fields: Array<ModelField<SecurityHunt>> = getHuntFormFields({
      translator,
    });

    expect(
      fieldOf(fields, "name").customValidation!(values({ name: " " })),
    ).toBe(SECURITY_HUNT_MESSAGES.enterName.message);
    expect(
      fieldOf(fields, "searchQuery").customValidation!(
        values({ name: "n", searchQuery: "" }),
      ),
    ).toBe(SECURITY_HUNT_MESSAGES.enterSearch.message);
    expect(
      fieldOf(fields, "searchQuery").customValidation!(
        values({
          name: "n",
          searchQuery: "",
          filters: { severityName: ["High"] },
        }),
      ),
    ).toBeNull();
    expect(
      fieldOf(fields, "description").customValidation!(
        values({ name: "n", searchQuery: "x", description: "d".repeat(2001) }),
      ),
    ).toBe(SECURITY_HUNT_MESSAGES.descriptionTooLong.message);
  });

  test("asks who to tell once the hunt is scheduled - a person or a team - and needs one", () => {
    const tell: ModelField<SecurityHunt> = fieldOf(
      getHuntFormFields({ translator }),
      HUNT_TELL_FIELD_KEY,
    );

    expect(tell.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(tell.formOnly).toBe(true);
    expect(tell.showIf).toBe(isHuntFormScheduled);
    expect(
      isHuntFormScheduled(
        values({ schedule: SecurityHuntSchedule.NotScheduled }),
      ),
    ).toBe(false);
    expect(
      isHuntFormScheduled(values({ schedule: SecurityHuntSchedule.EveryHour })),
    ).toBe(true);

    expect(getHuntTellPickerConfig().kinds).toEqual([
      { kind: PeoplePickerKind.User, valueKey: "notifyUsers" },
      { kind: PeoplePickerKind.Team, valueKey: "notifyTeams" },
    ]);

    const scheduled: Record<string, unknown> = {
      schedule: SecurityHuntSchedule.EveryDay,
    };

    expect(tell.customValidation!(values(scheduled))).toBe(
      SECURITY_HUNT_MESSAGES.chooseRecipients.message,
    );
    expect(
      tell.customValidation!(
        values({
          ...scheduled,
          notifyTeams: ["81000000-0000-4000-8000-000000000001"],
        }),
      ),
    ).toBeNull();
    expect(
      tell.customValidation!(
        values({ schedule: SecurityHuntSchedule.NotScheduled }),
      ),
    ).toBeNull();
    expect(
      countHuntFormRecipients(
        values({
          notifyUsers: ["80000000-0000-4000-8000-000000000001"],
          notifyTeams: ["81000000-0000-4000-8000-000000000001"],
        }),
      ),
    ).toBe(2);
  });

  test("offers every schedule and every moving window", () => {
    expect(
      getHuntScheduleDropdownOptions().map(
        (option: { value: unknown }): unknown => {
          return option.value;
        },
      ),
    ).toEqual([...SECURITY_HUNT_SCHEDULES]);
    expect(
      getHuntTimeRangeDropdownOptions().map(
        (option: { value: unknown }): unknown => {
          return option.value;
        },
      ),
    ).toEqual([...SECURITY_HUNT_TIME_RANGES]);
  });

  test("Save as Hunt asks only the name, the schedule and who to tell, on one page", () => {
    const fields: Array<ModelField<SecurityHunt>> = getSaveAsHuntFormFields({
      translator,
    });

    expect(fieldKeys(fields)).toEqual([
      "name",
      "schedule",
      HUNT_TELL_FIELD_KEY,
    ]);
    for (const field of fields) {
      expect(field.stepId).toBeUndefined();
    }
  });

  test("a new hunt starts not scheduled, telling the person saving it once it is", () => {
    expect(
      getNewHuntInitialValues({
        userId: new ObjectID("80000000-0000-4000-8000-000000000001"),
        timeRange: TimeRange.PAST_ONE_DAY,
      }),
    ).toEqual({
      schedule: SecurityHuntSchedule.NotScheduled,
      timeRange: TimeRange.PAST_ONE_DAY,
      notifyUsers: ["80000000-0000-4000-8000-000000000001"],
    });
    expect(getNewHuntInitialValues({ userId: null })).toEqual({
      schedule: SecurityHuntSchedule.NotScheduled,
      timeRange: TimeRange.PAST_ONE_WEEK,
    });
  });
});

describe("Add to Case", () => {
  const PROJECT: ObjectID = new ObjectID(PROJECT_ID);

  test("offers the project's open cases, or those a number or title finds", () => {
    const statuses: ReturnType<typeof buildDefaultTestStatuses> =
      buildDefaultTestStatuses();
    const query: Record<string, unknown> = getOpenCasesQuery({
      projectId: PROJECT,
      statuses,
      searchText: "",
    }) as Record<string, unknown>;

    expect(ADD_TO_CASE_LIST_LIMIT).toBe(20);
    expect(query["projectId"]).toBe(PROJECT);
    expect(query["securityCaseStatusId"]).toEqual(
      new Includes([
        TEST_STATUS_IDS[SecurityCaseStage.New],
        TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
        TEST_STATUS_IDS[SecurityCaseStage.Contained],
      ]),
    );
    expect(Object.keys(query).sort()).toEqual(
      ["projectId", "securityCaseStatusId"].sort(),
    );

    const searched: Record<string, unknown> = getOpenCasesQuery({
      projectId: PROJECT,
      statuses,
      searchText: "  #142 ",
    }) as Record<string, unknown>;

    expect(searched["_multiFieldSearch"]).toEqual(
      new MultiSearch({
        fields: ["title", "caseNumberWithPrefix"],
        value: "142",
      }),
    );
  });

  test("lists a case by its number and title, its status and priority, when it last saw a detection", () => {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase._id = "20000000-0000-4000-8000-000000000138";
    securityCase.caseNumberWithPrefix = "CASE-138";
    securityCase.title = "Defender XDR: suspicious PowerShell on web-03";
    securityCase.securityCasePriorityId = testPriorityId(
      SecurityCasePriorityLevel.High,
    );
    securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
    securityCase.lastDetectedAt = new Date("2026-10-29T10:00:00.000Z");

    const item: CasePickerItem = toCasePickerItem({
      securityCase,
      priorities: buildDefaultTestPriorities(),
      statuses: buildDefaultTestStatuses(),
    });

    expect(item.id).toBe("20000000-0000-4000-8000-000000000138");
    expect(item.number).toBe("CASE-138");
    expect(item.title).toBe("Defender XDR: suspicious PowerShell on web-03");
    expect(item.state?.name).toBe("New");
    expect(item.severity?.name).toBe("High");
    expect(item.date).toEqual(new Date("2026-10-29T10:00:00.000Z"));
  });

  test("names each selected event once, with its id and its time, and none without", () => {
    function event(uid: string, time: string | null): SecurityEvent {
      const row: SecurityEvent = new SecurityEvent();
      row.eventUid = uid;
      if (time) {
        row.time = new Date(time);
      }
      return row;
    }

    expect(
      getCaseEventReferences([
        event("evt-1", "2026-10-28T22:42:00.000Z"),
        event("evt-1", "2026-10-28T23:00:00.000Z"),
        event("", "2026-10-28T23:00:00.000Z"),
        event("evt-2", null),
        event("evt-3", "2026-10-28T23:05:00.000Z"),
      ]),
    ).toEqual([
      { eventUid: "evt-1", time: new Date("2026-10-28T22:42:00.000Z") },
      { eventUid: "evt-3", time: new Date("2026-10-28T23:05:00.000Z") },
    ]);
  });

  test("reads what happened to each event from the one answer: kept, kept already, or not found", () => {
    const result: {
      added: Array<string>;
      alreadyOnCase: Array<string>;
      notFound: Array<string>;
    } = { added: ["evt-1"], alreadyOnCase: ["evt-2"], notFound: ["evt-3"] };

    expect(getCaseEventOutcome({ eventUid: "evt-1", result })).toBe(
      BULK_ITEM_CHANGED,
    );

    const unchanged: BulkItemOutcome = getCaseEventOutcome({
      eventUid: "evt-2",
      result,
    });

    expect(unchanged).not.toBe(BULK_ITEM_CHANGED);
    expect(JSON.stringify(unchanged)).toContain(
      SECURITY_CASE_EVENTS_ADD_REASONS.alreadyOnCase.message,
    );
    expect(() => {
      return getCaseEventOutcome({ eventUid: "evt-3", result });
    }).toThrow(SECURITY_CASE_EVENTS_ADD_REASONS.notFound.message);
  });
});

describe("a kept event on a case's Evidence page", () => {
  const SNAPSHOT: SecurityCaseEventSnapshot = buildSecurityCaseEventSnapshot({
    event: {
      time: "2026-10-28T22:42:00.000Z",
      eventUid: "evt-0002",
      primaryEntityId: "3d000000-0000-4000-8000-000000000001",
      severityName: "High",
      className: "Process Activity",
      vendorName: "Okta",
      productName: "Okta",
      message: "Encoded PowerShell downloaded a script on web-03",
      principalHost: "web-03",
      targetPort: 443,
      observables: ["10.20.4.13"],
      attributes: { "device.os": "windows" },
    },
    hunt: { id: HUNT_ID, name: "Encoded PowerShell" },
  });

  function evidence(kind: SecurityCaseEvidenceKind): SecurityCaseEvidence {
    const item: SecurityCaseEvidence = new SecurityCaseEvidence();
    item.kind = kind;
    item.eventSnapshot = SNAPSHOT as unknown as JSONObject;
    return item;
  }

  test("is read from the snapshot it keeps, never for a file or a link", () => {
    expect(isEventEvidence(evidence(SecurityCaseEvidenceKind.Event))).toBe(
      true,
    );
    expect(readEventEvidence(evidence(SecurityCaseEvidenceKind.Event))).toEqual(
      SNAPSHOT,
    );
    expect(
      readEventEvidence(evidence(SecurityCaseEvidenceKind.File)),
    ).toBeNull();
    expect(
      readEventEvidence(evidence(SecurityCaseEvidenceKind.Link)),
    ).toBeNull();
  });

  test("says when, how severe, what kind and where from, once each", () => {
    expect(
      getEventEvidenceMeta({
        snapshot: SNAPSHOT,
        formatTime: (time: Date): string => {
          return time.toISOString();
        },
      }),
    ).toBe("2026-10-28T22:42:00.000Z · High · Process Activity · Okta");
    expect(
      getEventEvidenceMeta({
        snapshot: {
          ...SNAPSHOT,
          time: "",
          severityName: "",
          productName: "Workforce",
        },
        formatTime: (): string => {
          return "never";
        },
      }),
    ).toBe("Process Activity · Okta Workforce");
  });

  test("opens in the Events panel as the event it was", () => {
    const event: SecurityEvent = toSecurityEvent(SNAPSHOT);

    expect(event.eventUid).toBe("evt-0002");
    expect(event.time).toEqual(new Date("2026-10-28T22:42:00.000Z"));
    expect(event.primaryEntityId?.toString()).toBe(
      "3d000000-0000-4000-8000-000000000001",
    );
    expect(event.getColumnValue("principalHost")).toBe("web-03");
    expect(event.getColumnValue("targetPort")).toBe(443);
    expect(event.getColumnValue("attributes")).toEqual({
      "device.os": "windows",
    });
  });
});
