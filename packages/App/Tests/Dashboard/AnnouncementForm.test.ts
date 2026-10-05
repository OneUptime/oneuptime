import {
  ANNOUNCEMENT_ENDS_AT_KEY,
  ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR,
  ANNOUNCEMENT_ENDS_IN_THE_PAST_ERROR,
  ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY,
  ANNOUNCEMENT_SCHEDULE_SUMMARIES,
  ANNOUNCEMENT_STARTS_AT_KEY,
  ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM,
  ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY,
  ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY,
  ANNOUNCEMENT_TEMPLATE_QUERY_PARAM,
  AnnouncementFormKind,
  SCHEDULE_AND_NOTIFICATIONS_SECTION_ID,
  SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE,
  SCHEDULE_SECTION_ID,
  SCHEDULE_SECTION_TITLE,
  getAnnouncementCreateQueryParams,
  getAnnouncementEndsAtError,
  getAnnouncementNotificationSummary,
  getAnnouncementScheduleSection,
  getAnnouncementScheduleSectionSummary,
  getAnnouncementScheduleSummary,
  getStatusPageToReturnTo,
  readAnnouncementQueryId,
  readRecordIds,
} from "../../FeatureSet/Dashboard/src/Components/Announcement/AnnouncementForm";
import {
  CreateFromRecordKind,
  CreatedRecordKind,
  pickRecordToCreateFrom,
  readCreateFromRecordId,
} from "../../FeatureSet/Dashboard/src/Components/CreateFromRecord/CreateFromRecord";
import { JSONObject } from "Common/Types/JSON";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import Timezone from "Common/Types/Timezone";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Creating an announcement in two steps
 * (Components/Announcement/AnnouncementForm): the address the create page
 * is opened with, the pages a new announcement starts with and where Create
 * goes back to, what the folded schedule section says on Create and on
 * Edit, when an end is refused, and that every word of it is translated.
 * The forms themselves are drawn for real in Common's
 * Tests/App/Dashboard/AnnouncementCreateForm.test.tsx and
 * AnnouncementEditAndTemplateForms.test.tsx, and their shape is pinned by
 * AnnouncementFormsStructure.test.ts.
 */

const NOW: Date = new Date("2026-10-03T09:20:00.000Z");
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_ID: string = "11111111-1111-4111-8111-111111111111";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const readLocale: (locale: string) => Record<string, string> = (
  locale: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
};

const at: (iso: string) => string = (iso: string): string => {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(new Date(iso));
};

const windowOf: (
  startsAt: unknown,
  endsAt?: unknown,
) => Record<string, unknown> = (
  startsAt: unknown,
  endsAt?: unknown,
): Record<string, unknown> => {
  return {
    [ANNOUNCEMENT_STARTS_AT_KEY]: startsAt,
    [ANNOUNCEMENT_ENDS_AT_KEY]: endsAt,
  };
};

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);
});

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("the create page's address", () => {
  test("names the status page first, then the template", () => {
    expect(
      getAnnouncementCreateQueryParams({
        statusPageId: new ObjectID(STATUS_PAGE_ID),
        announcementTemplateId: new ObjectID(TEMPLATE_ID),
      }),
    ).toEqual({
      [ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM]: STATUS_PAGE_ID,
      [ANNOUNCEMENT_TEMPLATE_QUERY_PARAM]: TEMPLATE_ID,
    });

    const query: Dictionary<string> = getAnnouncementCreateQueryParams({
      statusPageId: STATUS_PAGE_ID,
      announcementTemplateId: TEMPLATE_ID,
    });

    expect(Object.keys(query)).toEqual([
      "statusPageId",
      "announcementTemplateId",
    ]);
  });

  test("carries only what there is", () => {
    expect(
      getAnnouncementCreateQueryParams({ statusPageId: STATUS_PAGE_ID }),
    ).toEqual({ statusPageId: STATUS_PAGE_ID });
    expect(
      getAnnouncementCreateQueryParams({ announcementTemplateId: TEMPLATE_ID }),
    ).toEqual({ announcementTemplateId: TEMPLATE_ID });
    expect(getAnnouncementCreateQueryParams({})).toEqual({});
    expect(
      getAnnouncementCreateQueryParams({
        statusPageId: null,
        announcementTemplateId: undefined,
      }),
    ).toEqual({});
  });

  test("keeps the query parameter names the create page has always read", () => {
    // Bookmarked "Create from Template" links keep working.
    expect(ANNOUNCEMENT_TEMPLATE_QUERY_PARAM).toBe("announcementTemplateId");
    expect(ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM).toBe("statusPageId");
  });

  test("reads a real ID off the address, and nothing else", () => {
    expect(readAnnouncementQueryId(STATUS_PAGE_ID)).toBe(STATUS_PAGE_ID);
    expect(readAnnouncementQueryId(` ${STATUS_PAGE_ID} `)).toBe(STATUS_PAGE_ID);
    expect(readAnnouncementQueryId("not-a-status-page")).toBeNull();
    expect(readAnnouncementQueryId(`${STATUS_PAGE_ID}x`)).toBeNull();
    expect(readAnnouncementQueryId("")).toBeNull();
    expect(readAnnouncementQueryId(null)).toBeNull();
    expect(readAnnouncementQueryId(undefined)).toBeNull();
    expect(
      getAnnouncementCreateQueryParams({ statusPageId: "javascript:alert(1)" }),
    ).toEqual({});
  });
});

describe("the status pages a new announcement starts with", () => {
  /*
   * The page it was opened from is picked the way every create page picks
   * the record it was opened from (Components/CreateFromRecord).
   */
  const startingStatusPages: (data: {
    statusPageId?: string | undefined;
    templateStatusPageIds?: Array<string> | undefined;
  }) => unknown = (data: {
    statusPageId?: string | undefined;
    templateStatusPageIds?: Array<string> | undefined;
  }): unknown => {
    const values: JSONObject = data.templateStatusPageIds
      ? { statusPages: data.templateStatusPageIds }
      : {};

    return pickRecordToCreateFrom({
      values: values,
      record: data.statusPageId
        ? {
            kind: CreateFromRecordKind.StatusPage,
            id: data.statusPageId,
            name: "Acme Public Status",
          }
        : null,
      created: CreatedRecordKind.Announcement,
    })["statusPages"];
  };

  test("the page it was created from, then its template's, each once", () => {
    expect(
      startingStatusPages({
        statusPageId: STATUS_PAGE_ID,
        templateStatusPageIds: [OTHER_STATUS_PAGE_ID, STATUS_PAGE_ID],
      }),
    ).toEqual([STATUS_PAGE_ID, OTHER_STATUS_PAGE_ID]);
  });

  test("only the template's, or only the page, or none", () => {
    expect(
      startingStatusPages({
        templateStatusPageIds: [OTHER_STATUS_PAGE_ID],
      }),
    ).toEqual([OTHER_STATUS_PAGE_ID]);
    expect(startingStatusPages({ statusPageId: STATUS_PAGE_ID })).toEqual([
      STATUS_PAGE_ID,
    ]);
    expect(startingStatusPages({})).toBeUndefined();
  });

  test("reads the address with the one reader every create page uses", () => {
    expect(readAnnouncementQueryId).toBe(readCreateFromRecordId);
  });

  test("reads the IDs a picker writes, ObjectIDs and records alike, each once", () => {
    const statusPage: StatusPage = new StatusPage();
    statusPage._id = OTHER_STATUS_PAGE_ID;

    expect(
      readRecordIds([
        STATUS_PAGE_ID,
        new ObjectID(OTHER_STATUS_PAGE_ID),
        statusPage,
        { _id: TEMPLATE_ID },
        STATUS_PAGE_ID,
      ]),
    ).toEqual([STATUS_PAGE_ID, OTHER_STATUS_PAGE_ID, TEMPLATE_ID]);
    expect(readRecordIds(undefined)).toEqual([]);
    expect(readRecordIds("not a list")).toEqual([]);
    expect(readRecordIds([null, {}, ""])).toEqual([]);
  });
});

describe("where Create goes back to", () => {
  test("the status page's tab it was opened from, while the announcement shows there", () => {
    expect(
      getStatusPageToReturnTo({
        fromStatusPageId: STATUS_PAGE_ID,
        createdStatusPageIds: [OTHER_STATUS_PAGE_ID, STATUS_PAGE_ID],
      }),
    ).toBe(STATUS_PAGE_ID);
  });

  test("the project's list once that page was unpicked: its tab would not list it", () => {
    expect(
      getStatusPageToReturnTo({
        fromStatusPageId: STATUS_PAGE_ID,
        createdStatusPageIds: [OTHER_STATUS_PAGE_ID],
      }),
    ).toBeNull();
  });

  test("the project's list when it was opened from there", () => {
    expect(
      getStatusPageToReturnTo({
        fromStatusPageId: null,
        createdStatusPageIds: [STATUS_PAGE_ID],
      }),
    ).toBeNull();
  });
});

describe("when the announcement shows", () => {
  test("now, until it is ended: the default", () => {
    expect(getAnnouncementScheduleSummary(windowOf(NOW))).toBe(
      "Shows now and stays until you end it.",
    );
    // A start already passed shows now too, held as the date input holds it.
    expect(
      getAnnouncementScheduleSummary(windowOf("2026-10-01T00:00:00.000Z")),
    ).toBe(ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded);
  });

  test("now, until a set end", () => {
    expect(
      getAnnouncementScheduleSummary(windowOf(NOW, "2026-10-05T14:00:00.000Z")),
    ).toBe(`Shows now and stays until ${at("2026-10-05T14:00:00.000Z")}.`);
  });

  test("from a later start, until it is ended or until a set end", () => {
    expect(
      getAnnouncementScheduleSummary(windowOf("2026-10-04T08:00:00.000Z")),
    ).toBe(
      `Shows from ${at("2026-10-04T08:00:00.000Z")} and stays until you end it.`,
    );
    expect(
      getAnnouncementScheduleSummary(
        windowOf("2026-10-04T08:00:00.000Z", "2026-10-05T08:00:00.000Z"),
      ),
    ).toBe(
      `Shows from ${at("2026-10-04T08:00:00.000Z")} until ${at("2026-10-05T08:00:00.000Z")}.`,
    );
  });

  test("an announcement whose end has passed has stopped showing", () => {
    expect(
      getAnnouncementScheduleSummary(
        windowOf("2026-10-01T08:00:00.000Z", "2026-10-03T08:00:00.000Z"),
      ),
    ).toBe(`Stopped showing at ${at("2026-10-03T08:00:00.000Z")}.`);
    // Ending right now counts as ended.
    expect(
      getAnnouncementScheduleSummary(windowOf("2026-10-01T08:00:00.000Z", NOW)),
    ).toBe(`Stopped showing at ${at(NOW.toISOString())}.`);
  });

  test("says nothing while the window cannot be read", () => {
    // No start: the field asks for it.
    expect(getAnnouncementScheduleSummary(windowOf(""))).toBeNull();
    expect(getAnnouncementScheduleSummary(windowOf(undefined))).toBeNull();
    expect(getAnnouncementScheduleSummary({})).toBeNull();
    expect(getAnnouncementScheduleSummary(null)).toBeNull();
    // An end not after the start: the end's own check says so.
    expect(
      getAnnouncementScheduleSummary(
        windowOf("2026-10-04T08:00:00.000Z", "2026-10-04T07:00:00.000Z"),
      ),
    ).toBeNull();
    expect(
      getAnnouncementScheduleSummary(
        windowOf("2026-10-04T08:00:00.000Z", "2026-10-04T08:00:00.000Z"),
      ),
    ).toBeNull();
  });

  test("an end that is cleared reads as no end", () => {
    expect(getAnnouncementScheduleSummary(windowOf(NOW, ""))).toBe(
      ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded,
    );
    expect(getAnnouncementScheduleSummary(windowOf(NOW, null))).toBe(
      ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded,
    );
  });
});

describe("who is told, on Create", () => {
  test("the subscribers are told unless the switch is off", () => {
    expect(getAnnouncementNotificationSummary({})).toBe(
      ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY,
    );
    expect(
      getAnnouncementNotificationSummary({
        [ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY]: true,
      }),
    ).toBe("Subscribers are notified when it starts showing.");
    expect(
      getAnnouncementNotificationSummary({
        [ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY]: false,
      }),
    ).toBe("Subscribers are not notified.");
  });
});

describe("the folded schedule section", () => {
  test("on Create, says when it shows, then who is told", () => {
    expect(
      getAnnouncementScheduleSectionSummary(
        windowOf(NOW),
        AnnouncementFormKind.Create,
      ),
    ).toEqual([
      "Shows now and stays until you end it.",
      "Subscribers are notified when it starts showing.",
    ]);
    expect(
      getAnnouncementScheduleSectionSummary(
        {
          ...windowOf("2026-10-04T08:00:00.000Z"),
          [ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY]: false,
        },
        AnnouncementFormKind.Create,
      ),
    ).toEqual([
      `Shows from ${at("2026-10-04T08:00:00.000Z")} and stays until you end it.`,
      ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY,
    ]);
    // Still says who is told while the window cannot be read.
    expect(
      getAnnouncementScheduleSectionSummary({}, AnnouncementFormKind.Create),
    ).toEqual([ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY]);
  });

  test("on Edit, says only when it shows: the notify switch takes no updates", () => {
    expect(
      getAnnouncementScheduleSectionSummary(
        { ...windowOf(NOW), [ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY]: false },
        AnnouncementFormKind.Edit,
      ),
    ).toEqual([ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded]);
    expect(
      getAnnouncementScheduleSectionSummary({}, AnnouncementFormKind.Edit),
    ).toEqual([]);
  });

  test("is Schedule & Notifications on Create and Schedule on Edit, always starting folded", () => {
    const onCreate: FormFieldCollapsibleSection<StatusPageAnnouncement> =
      getAnnouncementScheduleSection<StatusPageAnnouncement>(
        AnnouncementFormKind.Create,
      );
    const onEdit: FormFieldCollapsibleSection<StatusPageAnnouncement> =
      getAnnouncementScheduleSection<StatusPageAnnouncement>(
        AnnouncementFormKind.Edit,
      );

    expect(onCreate.id).toBe(SCHEDULE_AND_NOTIFICATIONS_SECTION_ID);
    expect(onCreate.title).toBe("Schedule & Notifications");
    expect(onCreate.title).toBe(SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE);
    expect(onEdit.id).toBe(SCHEDULE_SECTION_ID);
    expect(onEdit.title).toBe("Schedule");
    expect(onEdit.title).toBe(SCHEDULE_SECTION_TITLE);

    for (const section of [onCreate, onEdit]) {
      expect(section.openWhenConfigured).toBe(false);
    }

    expect(
      onCreate.getSummary!(windowOf(NOW) as FormValues<StatusPageAnnouncement>),
    ).toEqual(
      getAnnouncementScheduleSectionSummary(
        windowOf(NOW),
        AnnouncementFormKind.Create,
      ),
    );
    expect(
      onEdit.getSummary!(windowOf(NOW) as FormValues<StatusPageAnnouncement>),
    ).toEqual([ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded]);
  });

  test("reads the columns the forms write", () => {
    const model: StatusPageAnnouncement = new StatusPageAnnouncement();

    for (const key of [
      ANNOUNCEMENT_STARTS_AT_KEY,
      ANNOUNCEMENT_ENDS_AT_KEY,
      ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY,
    ]) {
      expect(`${key}: ${model.hasColumn(key)}`).toBe(`${key}: true`);
    }

    // The line's default is the column's: the subscribers are told.
    expect(
      model.getTableColumnMetadata(ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY)
        .defaultValue,
    ).toBe(true);
  });
});

describe("the end's own check", () => {
  for (const kind of [AnnouncementFormKind.Create, AnnouncementFormKind.Edit]) {
    test(`refuses an end that is not after the start (${kind})`, () => {
      expect(
        getAnnouncementEndsAtError(
          windowOf("2026-10-04T08:00:00.000Z", "2026-10-04T07:00:00.000Z"),
          kind,
        ),
      ).toBe(ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR);
      expect(
        getAnnouncementEndsAtError(
          windowOf("2026-10-04T08:00:00.000Z", "2026-10-04T08:00:00.000Z"),
          kind,
        ),
      ).toBe(
        "End Showing Announcement At must be after Start Showing Announcement At.",
      );
    });

    test(`lets an end still to come, or no end at all, through (${kind})`, () => {
      expect(
        getAnnouncementEndsAtError(
          windowOf("2026-10-04T08:00:00.000Z", "2026-10-04T09:00:00.000Z"),
          kind,
        ),
      ).toBeNull();
      expect(getAnnouncementEndsAtError(windowOf(NOW), kind)).toBeNull();
      expect(getAnnouncementEndsAtError(windowOf(NOW, ""), kind)).toBeNull();
      // A missing start is the start's own business.
      expect(
        getAnnouncementEndsAtError(
          windowOf("", "2026-10-04T09:00:00.000Z"),
          kind,
        ),
      ).toBeNull();
    });
  }

  test("Create refuses an end that has passed: the announcement would never show", () => {
    expect(
      getAnnouncementEndsAtError(
        windowOf("2026-10-01T08:00:00.000Z", "2026-10-03T08:00:00.000Z"),
        AnnouncementFormKind.Create,
      ),
    ).toBe(ANNOUNCEMENT_ENDS_IN_THE_PAST_ERROR);
    // Ending right now has passed too.
    expect(
      getAnnouncementEndsAtError(
        windowOf("2026-10-01T08:00:00.000Z", NOW),
        AnnouncementFormKind.Create,
      ),
    ).toBe("End Showing Announcement At must be in the future.");
    // An end before the start says that first.
    expect(
      getAnnouncementEndsAtError(
        windowOf("2026-10-02T08:00:00.000Z", "2026-10-01T08:00:00.000Z"),
        AnnouncementFormKind.Create,
      ),
    ).toBe(ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR);
  });

  test("an Edit may set an end that has passed: that is how an announcement is taken down", () => {
    expect(
      getAnnouncementEndsAtError(
        windowOf("2026-10-01T08:00:00.000Z", "2026-10-03T08:00:00.000Z"),
        AnnouncementFormKind.Edit,
      ),
    ).toBeNull();
  });
});

describe("every sentence of it is translated", () => {
  const SENTENCES: Array<string> = [
    ...Object.values(ANNOUNCEMENT_SCHEDULE_SUMMARIES),
    ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY,
    ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY,
    ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR,
    ANNOUNCEMENT_ENDS_IN_THE_PAST_ERROR,
    SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE,
    SCHEDULE_SECTION_TITLE,
    getAnnouncementScheduleSection(AnnouncementFormKind.Create)
      .description as string,
    getAnnouncementScheduleSection(AnnouncementFormKind.Edit)
      .description as string,
  ];

  const english: Record<string, string> = readLocale("en");

  test("in English, each a key of its own", () => {
    for (const sentence of SENTENCES) {
      expect(`${sentence}: ${english[sentence]}`).toBe(
        `${sentence}: ${sentence}`,
      );
    }
  });

  test("the retired Edit sentences are gone with the box they described", () => {
    expect(english["Subscribers are notified about this edit."]).toBe(
      undefined,
    );
    expect(english["Subscribers are not notified about this edit."]).toBe(
      undefined,
    );
  });

  for (const locale of OTHER_LOCALES) {
    test(`in ${locale}, keeping the times where they go`, () => {
      const translations: Record<string, string> = readLocale(locale);

      for (const sentence of SENTENCES) {
        const translated: string | undefined = translations[sentence];

        expect(`${sentence}: ${Boolean(translated)}`).toBe(`${sentence}: true`);
        expect(translated).not.toBe(sentence);

        for (const placeholder of ["{{startsAt}}", "{{endsAt}}"]) {
          expect(
            `${sentence} ${placeholder}: ${translated!.includes(placeholder)}`,
          ).toBe(
            `${sentence} ${placeholder}: ${sentence.includes(placeholder)}`,
          );
        }
      }
    });
  }
});
