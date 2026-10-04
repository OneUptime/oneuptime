import {
  ANNOUNCEMENT_ENDS_AT_KEY,
  ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR,
  ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY,
  ANNOUNCEMENT_SCHEDULE_SUMMARIES,
  ANNOUNCEMENT_STARTS_AT_KEY,
  ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM,
  ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY,
  ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY,
  ANNOUNCEMENT_TEMPLATE_QUERY_PARAM,
  ANNOUNCEMENT_UPDATE_NOTIFIED_SUMMARY,
  ANNOUNCEMENT_UPDATE_NOT_NOTIFIED_SUMMARY,
  AnnouncementFormKind,
  SCHEDULE_AND_NOTIFICATIONS_SECTION_ID,
  SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE,
  getAnnouncementCreateQueryParams,
  getAnnouncementEndsAtError,
  getAnnouncementNotificationSummary,
  getAnnouncementScheduleSummary,
  getInitialAnnouncementStatusPageIds,
  getScheduleAndNotificationsSection,
  getScheduleAndNotificationsSummary,
  readAnnouncementQueryId,
} from "../../FeatureSet/Dashboard/src/Components/Announcement/AnnouncementForm";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
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
 * is opened with, the pages a new announcement starts with, what the folded
 * Schedule & Notifications section says, when an end is refused, and that
 * every word of it is translated. The forms themselves are drawn for real
 * in Common's Tests/App/Dashboard/AnnouncementCreateForm.test.tsx and
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
  test("the page it was created from, then its template's, each once", () => {
    expect(
      getInitialAnnouncementStatusPageIds({
        statusPageId: STATUS_PAGE_ID,
        templateStatusPageIds: [OTHER_STATUS_PAGE_ID, STATUS_PAGE_ID],
      }),
    ).toEqual([STATUS_PAGE_ID, OTHER_STATUS_PAGE_ID]);
  });

  test("only the template's, or only the page, or none", () => {
    expect(
      getInitialAnnouncementStatusPageIds({
        templateStatusPageIds: [OTHER_STATUS_PAGE_ID],
      }),
    ).toEqual([OTHER_STATUS_PAGE_ID]);
    expect(
      getInitialAnnouncementStatusPageIds({ statusPageId: STATUS_PAGE_ID }),
    ).toEqual([STATUS_PAGE_ID]);
    expect(getInitialAnnouncementStatusPageIds({ statusPageId: null })).toEqual(
      [],
    );
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

describe("who is told", () => {
  test("on Create, the subscribers are told unless the switch is off", () => {
    expect(
      getAnnouncementNotificationSummary({}, AnnouncementFormKind.Create),
    ).toBe(ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY);
    expect(
      getAnnouncementNotificationSummary(
        { [ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY]: true },
        AnnouncementFormKind.Create,
      ),
    ).toBe("Subscribers are notified when it starts showing.");
    expect(
      getAnnouncementNotificationSummary(
        { [ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY]: false },
        AnnouncementFormKind.Create,
      ),
    ).toBe("Subscribers are not notified.");
  });

  test("on Edit, only a ticked update box tells anyone", () => {
    expect(
      getAnnouncementNotificationSummary({}, AnnouncementFormKind.Edit),
    ).toBe(ANNOUNCEMENT_UPDATE_NOT_NOTIFIED_SUMMARY);
    expect(
      getAnnouncementNotificationSummary(
        { [SubscriberUpdateNotification.miscDataKey]: false },
        AnnouncementFormKind.Edit,
      ),
    ).toBe("Subscribers are not notified about this edit.");
    expect(
      getAnnouncementNotificationSummary(
        { [SubscriberUpdateNotification.miscDataKey]: true },
        AnnouncementFormKind.Edit,
      ),
    ).toBe("Subscribers are notified about this edit.");
    // The switch an Edit cannot change says nothing there.
    expect(
      getAnnouncementNotificationSummary(
        { [ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY]: false },
        AnnouncementFormKind.Edit,
      ),
    ).toBe(ANNOUNCEMENT_UPDATE_NOT_NOTIFIED_SUMMARY);
  });
});

describe("the Schedule & Notifications line", () => {
  test("says when it shows, then who is told", () => {
    expect(
      getScheduleAndNotificationsSummary(
        windowOf(NOW),
        AnnouncementFormKind.Create,
      ),
    ).toEqual([
      "Shows now and stays until you end it.",
      "Subscribers are notified when it starts showing.",
    ]);
    expect(
      getScheduleAndNotificationsSummary(
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
  });

  test("still says who is told while the window cannot be read", () => {
    expect(
      getScheduleAndNotificationsSummary({}, AnnouncementFormKind.Edit),
    ).toEqual([ANNOUNCEMENT_UPDATE_NOT_NOTIFIED_SUMMARY]);
  });

  test("the section always starts folded and says that line", () => {
    for (const kind of [
      AnnouncementFormKind.Create,
      AnnouncementFormKind.Edit,
    ]) {
      const section: FormFieldCollapsibleSection<StatusPageAnnouncement> =
        getScheduleAndNotificationsSection<StatusPageAnnouncement>(kind);

      expect(section.id).toBe(SCHEDULE_AND_NOTIFICATIONS_SECTION_ID);
      expect(section.title).toBe("Schedule & Notifications");
      expect(section.title).toBe(SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE);
      expect(section.openWhenConfigured).toBe(false);
      expect(
        section.getSummary!(
          windowOf(NOW) as FormValues<StatusPageAnnouncement>,
        ),
      ).toEqual(getScheduleAndNotificationsSummary(windowOf(NOW), kind));
    }

    expect(
      getScheduleAndNotificationsSection<StatusPageAnnouncement>(
        AnnouncementFormKind.Edit,
      ).getSummary!({} as FormValues<StatusPageAnnouncement>),
    ).toEqual([ANNOUNCEMENT_UPDATE_NOT_NOTIFIED_SUMMARY]);
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
  test("refuses an end that is not after the start", () => {
    expect(
      getAnnouncementEndsAtError(
        windowOf("2026-10-04T08:00:00.000Z", "2026-10-04T07:00:00.000Z"),
      ),
    ).toBe(ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR);
    expect(
      getAnnouncementEndsAtError(
        windowOf("2026-10-04T08:00:00.000Z", "2026-10-04T08:00:00.000Z"),
      ),
    ).toBe(
      "End Showing Announcement At must be after Start Showing Announcement At.",
    );
  });

  test("lets an end after the start, or no end at all, through", () => {
    expect(
      getAnnouncementEndsAtError(
        windowOf("2026-10-04T08:00:00.000Z", "2026-10-04T09:00:00.000Z"),
      ),
    ).toBeNull();
    expect(getAnnouncementEndsAtError(windowOf(NOW))).toBeNull();
    expect(getAnnouncementEndsAtError(windowOf(NOW, ""))).toBeNull();
    // A missing start is the start's own business.
    expect(
      getAnnouncementEndsAtError(windowOf("", "2026-10-04T09:00:00.000Z")),
    ).toBeNull();
  });
});

describe("every sentence of it is translated", () => {
  const SENTENCES: Array<string> = [
    ...Object.values(ANNOUNCEMENT_SCHEDULE_SUMMARIES),
    ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY,
    ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY,
    ANNOUNCEMENT_UPDATE_NOTIFIED_SUMMARY,
    ANNOUNCEMENT_UPDATE_NOT_NOTIFIED_SUMMARY,
    ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR,
    SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE,
    getScheduleAndNotificationsSection(AnnouncementFormKind.Create)
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
