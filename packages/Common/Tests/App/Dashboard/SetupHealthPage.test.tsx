/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import type { SpyInstance } from "jest-mock";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import SetupHealthApi, {
  getSetupHealthSummaryUrl,
  getSetupHealthUrl,
  isSetupHealthAnswer,
  isSetupHealthSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthApi";
import SetupHealthView from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthView";
import {
  CHECK_ICONS,
  LEVEL_LOOK,
  RECORD_ICONS,
  VERDICT_LOOK,
  getSetupHealthFindingIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthLook";
import {
  FINDINGS_SHOWN_PER_CHECK,
  LEVEL_WORDS,
  RELATED_RECORDS_SHOWN,
  SETUP_HEALTH_AFFECTS,
  SETUP_HEALTH_VERDICT_WORDS,
  SETUP_HEALTH_WORDS_PAGE,
  SetupHealthSentenceValues,
  SetupHealthVerdict,
  SetupHealthVerdictKind,
  getSetupHealthFixLink,
  getSetupHealthRecordRoute,
  getSetupHealthSentence,
  getSetupHealthSentenceValues,
  getSetupHealthVerdict,
  groupSetupHealthFindings,
  translateSetupHealthVerdictText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthWords";
import { SETUP_HEALTH_HOME_WORDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthHomeWords";
import { getHomeBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/HomeBreadcrumbs";
import { getPageSearchAreas } from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  HomeRoutePath,
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import RecommendationType from "../../../Types/Recommendation/RecommendationType";
import {
  SETUP_HEALTH_WORDS,
  SetupHealthAnswer,
  SetupHealthCertificateReason,
  SetupHealthCheck,
  SetupHealthEventKind,
  SETUP_HEALTH_LEVEL_ORDER,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthReadable,
  SetupHealthOwnerSubject,
  SetupHealthRecord,
  SetupHealthRecordKind,
  SetupHealthResponderReason,
  SetupHealthScheduleReason,
  getSetupHealthCounts,
  makeSetupHealthFinding,
  redactSetupHealthFindings,
} from "../../../Types/SetupHealth/SetupHealth";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WhoIsToldServerChannel } from "../../../Types/Monitor/WhoIsTold";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import {
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import User from "../../../UI/Utils/User";
import RecommendationDismissalUtil from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationDismissalUtil";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { toHeadline } from "../../../UI/Components/Table/EmptyTableMessage";
import { goTo, PROJECT_ID as SIDE_MENU_PROJECT_ID } from "./SideMenuHarness";

/*
 * SETUP HEALTH ON THE DASHBOARD (#6812, #8135): the page opens with the
 * verdict - how badly, in the colour of the worst level with findings -
 * then lists the findings by level, worst first, each with the icon of
 * what it is about, its sentence in the reader's words with the project's
 * names in bold, the records it reaches, and right under the sentence the
 * button that opens its fix; a check broken for many records is folded past
 * a few; a finding is dismissed with a reason, for everyone, and restored
 * from Dismissed; and a project with nothing wrong says so plainly.
 */

const PROJECT: string = "68125555-0000-4000-8000-000000000001";
const CHECKOUT: string = "68125555-0000-4000-8000-0000000000a1";
const PRIMARY: string = "68125555-0000-4000-8000-0000000000b1";
const ANA: string = "68125555-0000-4000-8000-0000000000c1";
const SCHEDULE: string = "68125555-0000-4000-8000-0000000000d1";
const STATUS_PAGE: string = "68125555-0000-4000-8000-0000000000e1";
const DISMISSAL: string = "68125555-0000-4000-8000-0000000000f1";
const INGESTION_KEY: string = "68125555-0000-4000-8000-0000000000f2";
const OWNER_TEAM: string = "68125555-0000-4000-8000-0000000000f3";
const NETWORK_DEVICE: string = "68125555-0000-4000-8000-0000000000f4";
const DOMAIN: string = "68125555-0000-4000-8000-0000000000e2";

const translator: Translator = getGlobalTranslator();

const DASHBOARD_LANGUAGES_BUT_ENGLISH: Array<string> = [
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
  "ar",
];

function monitorFinding(index: number): SetupHealthFinding {
  return makeSetupHealthFinding({
    check: SetupHealthCheck.MonitorPagesNobody,
    level: SetupHealthLevel.WorthFixing,
    subject: SetupHealthEventKind.Incident,
    record: {
      kind: SetupHealthRecordKind.Monitor,
      id: `68125555-1111-4000-8000-${index.toString().padStart(12, "0")}`,
      name: `Monitor ${index}`,
    },
    fix: SetupHealthFix.IncidentOnCallRules,
    words: SETUP_HEALTH_WORDS.monitorPagesNobody.incident,
    values: { monitor: `Monitor ${index}` },
  });
}

const POLICY_FINDING: SetupHealthFinding = makeSetupHealthFinding({
  check: SetupHealthCheck.PolicyHasNoEscalationRules,
  level: SetupHealthLevel.PagesWillNotArrive,
  record: {
    kind: SetupHealthRecordKind.OnCallDutyPolicy,
    id: PRIMARY,
    name: "Primary",
  },
  fix: SetupHealthFix.OnCallPolicy,
  fixRecordId: PRIMARY,
  words: SETUP_HEALTH_WORDS.policyHasNoEscalationRules,
  values: { policy: "Primary" },
});

const SERVER_FINDING: SetupHealthFinding = makeSetupHealthFinding({
  check: SetupHealthCheck.ServerCannotSend,
  level: SetupHealthLevel.PagesWillNotArrive,
  subject: WhoIsToldServerChannel.Email,
  record: { kind: SetupHealthRecordKind.Project, id: PROJECT, name: "" },
  fix: SetupHealthFix.ServerSettings,
  words: SETUP_HEALTH_WORDS.serverCannotSend.Email,
});

const OWNER_FINDING: SetupHealthFinding = makeSetupHealthFinding({
  check: SetupHealthCheck.OneOwner,
  level: SetupHealthLevel.Suggestion,
  record: { kind: SetupHealthRecordKind.Project, id: PROJECT, name: "" },
  fix: SetupHealthFix.ProjectOwners,
  words: SETUP_HEALTH_WORDS.oneOwner,
});

function answer(
  findings: Array<SetupHealthFinding>,
  overrides: Partial<SetupHealthAnswer> = {},
): SetupHealthAnswer {
  return {
    findings: findings,
    dismissed: [],
    counts: getSetupHealthCounts(findings),
    monitorCount: 12,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("a finding, in the reader's words, with where to fix it", () => {
  test("the server's template, with the names as written", () => {
    expect(getSetupHealthSentence(POLICY_FINDING, translator)).toBe(
      "On-call policy Primary has no escalation rules, so it pages nobody.",
    );
  });

  test("in German and in Arabic, the names set in as written", () => {
    expect(
      getSetupHealthSentence(POLICY_FINDING, dashboardTranslator("de")),
    ).toContain("Primary");
    expect(
      getSetupHealthSentence(POLICY_FINDING, dashboardTranslator("de")),
    ).not.toBe(POLICY_FINDING.sentence);
    expect(
      getSetupHealthSentence(monitorFinding(1), dashboardTranslator("ar")),
    ).toContain("Monitor 1");
    expect(
      getSetupHealthSentence(monitorFinding(1), dashboardTranslator("ar")),
    ).not.toBe(monitorFinding(1).sentence);
  });

  test("a switched-off channel by its name in the reader's words", () => {
    const off: SetupHealthFinding = makeSetupHealthFinding({
      check: SetupHealthCheck.ChannelOff,
      level: SetupHealthLevel.PagesWillNotArrive,
      subject: OnCallPageChannel.Call,
      record: { kind: SetupHealthRecordKind.Project, id: PROJECT, name: "" },
      fix: SetupHealthFix.ProjectNotificationSettings,
      words: SETUP_HEALTH_WORDS.channelOff,
      values: { channel: "Phone call" },
    });

    expect(getSetupHealthSentence(off, translator)).toBe(
      "Phone call is off in this project, so pages that use it are not sent.",
    );
    expect(
      getSetupHealthSentence(off, dashboardTranslator("de")),
    ).not.toContain("Phone call");
  });

  test("a gap's start, and a balance, written the reader's way", () => {
    const gap: SetupHealthFinding = makeSetupHealthFinding({
      check: SetupHealthCheck.ScheduleHasNobodyOnCall,
      level: SetupHealthLevel.WorthFixing,
      reason: SetupHealthScheduleReason.GapAhead,
      record: {
        kind: SetupHealthRecordKind.OnCallDutyPolicySchedule,
        id: SCHEDULE,
        name: "Primary rota",
      },
      fix: SetupHealthFix.OnCallSchedule,
      fixRecordId: SCHEDULE,
      words: SETUP_HEALTH_WORDS.scheduleHasNobodyOnCall.gap_ahead,
      values: { schedule: "Primary rota", time: "2026-11-14 03:00 UTC" },
      startsAt: "2026-11-14T03:00:00.000Z",
    });

    const english: string = getSetupHealthSentence(gap, translator);

    expect(english).toContain("Primary rota");
    expect(english).toContain("2026");

    /*
     * Its start is startsAt in the reader's zone and words, never the
     * server's "2026-11-14 03:00 UTC". This reader is on UTC, which reads as
     * UTC (issue #8475) where it read as moment's "GMT", so the zone's name
     * no longer tells the two apart: the server's way of writing the date does.
     */
    expect(english).toContain("Nov 14, 2026, 3:00 AM UTC");
    expect(english).not.toContain("2026-11-14");

    const low: SetupHealthFinding = makeSetupHealthFinding({
      check: SetupHealthCheck.LowBalance,
      level: SetupHealthLevel.WorthFixing,
      record: { kind: SetupHealthRecordKind.Project, id: PROJECT, name: "" },
      fix: SetupHealthFix.ProjectBilling,
      words: SETUP_HEALTH_WORDS.lowBalance,
      values: { balance: "$4.20" },
      balanceInUSDCents: 420,
    });

    expect(getSetupHealthSentence(low, translator)).toContain("$4.20");
    expect(getSetupHealthSentence(low, dashboardTranslator("de"))).toContain(
      "4,20",
    );
  });

  test("a custom domain's certificate and an unused ingestion key, in every Dashboard language, the names as written (#7294, #7295)", () => {
    const findings: Array<SetupHealthFinding> = [
      ...Object.values(SetupHealthCertificateReason).map(
        (reason: SetupHealthCertificateReason): SetupHealthFinding => {
          return makeSetupHealthFinding({
            check: SetupHealthCheck.StatusPageDomainCertificateFailed,
            level: SetupHealthLevel.WorthFixing,
            reason: reason,
            record: {
              kind: SetupHealthRecordKind.StatusPageDomain,
              id: DOMAIN,
              name: "status.acme.com",
            },
            related: [
              {
                kind: SetupHealthRecordKind.StatusPage,
                id: STATUS_PAGE,
                name: "Acme Status",
              },
            ],
            fix: SetupHealthFix.StatusPageDomains,
            fixRecordId: STATUS_PAGE,
            words: SETUP_HEALTH_WORDS.statusPageDomainCertificateFailed[reason],
            values: { domain: "status.acme.com", statusPage: "Acme Status" },
          });
        },
      ),
      makeSetupHealthFinding({
        check: SetupHealthCheck.IngestionKeyNeverUsed,
        level: SetupHealthLevel.Suggestion,
        record: {
          kind: SetupHealthRecordKind.TelemetryIngestionKey,
          id: INGESTION_KEY,
          name: "Production collector",
        },
        fix: SetupHealthFix.TelemetryIngestionKey,
        fixRecordId: INGESTION_KEY,
        words: SETUP_HEALTH_WORDS.ingestionKeyNeverUsed,
        values: { key: "Production collector" },
      }),
    ];

    for (const finding of findings) {
      expect(getSetupHealthSentence(finding, translator)).toBe(
        finding.sentence,
      );

      for (const language of DASHBOARD_LANGUAGES_BUT_ENGLISH) {
        const sentence: string = getSetupHealthSentence(
          finding,
          dashboardTranslator(language),
        );

        expect({ language, translated: sentence !== finding.sentence }).toEqual(
          { language, translated: true },
        );

        for (const name of Object.values(finding.values)) {
          expect(sentence).toContain(name);
        }
      }
    }

    expect(
      getSetupHealthFixLink({ finding: findings[2]!, translator: translator })!
        .text,
    ).toBe("Open Ingestion Key");
    expect(
      getSetupHealthFixLink({
        finding: findings[2]!,
        translator: dashboardTranslator("de"),
      })!.text,
    ).not.toBe("Open Ingestion Key");
  });

  test("an owner no Created email reaches, in every Dashboard language, the names as written, fixed where the card fixes it (#9371)", () => {
    const owner: (
      subject: SetupHealthOwnerSubject,
      data: {
        record: SetupHealthRecord;
        fix: SetupHealthFix;
        fixRecordId?: string;
        values: Record<string, string>;
      },
    ) => SetupHealthFinding = (
      subject: SetupHealthOwnerSubject,
      data: {
        record: SetupHealthRecord;
        fix: SetupHealthFix;
        fixRecordId?: string;
        values: Record<string, string>;
      },
    ): SetupHealthFinding => {
      return makeSetupHealthFinding({
        check: SetupHealthCheck.OwnerNotEmailed,
        level: SetupHealthLevel.WorthFixing,
        subject: subject,
        record: data.record,
        fix: data.fix,
        fixRecordId: data.fixRecordId,
        words: SETUP_HEALTH_WORDS.ownerNotEmailed[subject],
        values: data.values,
      });
    };
    const monitor: SetupHealthRecord = {
      kind: SetupHealthRecordKind.Monitor,
      id: CHECKOUT,
      name: "Checkout API",
    };
    const rule: SetupHealthRecord = {
      kind: SetupHealthRecordKind.AlertOwnerRule,
      id: "68125555-0000-4000-8000-0000000000f5",
      name: "Payments routes",
    };

    const findings: Array<SetupHealthFinding> = [
      owner(SetupHealthOwnerSubject.TeamHasNobody, {
        record: {
          kind: SetupHealthRecordKind.Team,
          id: OWNER_TEAM,
          name: "Night shift",
        },
        fix: SetupHealthFix.TeamMembers,
        fixRecordId: OWNER_TEAM,
        values: { team: "Night shift" },
      }),
      ...[
        SetupHealthOwnerSubject.CriteriaNotInProject,
        SetupHealthOwnerSubject.CriteriaTeamOfAnotherProject,
      ].map((subject: SetupHealthOwnerSubject): SetupHealthFinding => {
        return owner(subject, {
          record: monitor,
          fix: SetupHealthFix.MonitorCriteria,
          fixRecordId: CHECKOUT,
          values: { monitor: "Checkout API" },
        });
      }),
      ...[
        SetupHealthOwnerSubject.NetworkDeviceNotInProject,
        SetupHealthOwnerSubject.NetworkDeviceTeamOfAnotherProject,
      ].map((subject: SetupHealthOwnerSubject): SetupHealthFinding => {
        return owner(subject, {
          record: monitor,
          fix: SetupHealthFix.NetworkDeviceOwners,
          fixRecordId: NETWORK_DEVICE,
          values: { monitor: "Checkout API" },
        });
      }),
      ...[
        SetupHealthOwnerSubject.OwnerRuleNotInProject,
        SetupHealthOwnerSubject.OwnerRuleTeamOfAnotherProject,
      ].map((subject: SetupHealthOwnerSubject): SetupHealthFinding => {
        return owner(subject, {
          record: rule,
          fix: SetupHealthFix.AlertOwnerRules,
          values: { rule: "Payments routes" },
        });
      }),
    ];

    expect(
      findings.map((finding: SetupHealthFinding): string => {
        return finding.subject;
      }),
    ).toEqual(Object.values(SetupHealthOwnerSubject));

    for (const finding of findings) {
      expect(getSetupHealthSentence(finding, translator)).toBe(
        finding.sentence,
      );

      for (const language of DASHBOARD_LANGUAGES_BUT_ENGLISH) {
        const sentence: string = getSetupHealthSentence(
          finding,
          dashboardTranslator(language),
        );

        expect({ language, translated: sentence !== finding.sentence }).toEqual(
          { language, translated: true },
        );

        for (const name of Object.values(finding.values)) {
          expect(sentence).toContain(name);
        }
      }
    }

    // The card's own link words, in the reader's language.
    expect(
      findings.map((finding: SetupHealthFinding): string => {
        return getSetupHealthFixLink({
          finding: finding,
          translator: translator,
        })!.text;
      }),
    ).toEqual([
      "Open Team",
      "Open Criteria",
      "Open Criteria",
      "Open Network Device",
      "Open Network Device",
      "Open Owner Rules",
      "Open Owner Rules",
    ]);
    expect(
      getSetupHealthFixLink({
        finding: findings[0]!,
        translator: dashboardTranslator("de"),
      })!.text,
    ).toBe("Team öffnen");
  });

  test("a person with no name is someone, in the reader's words", () => {
    const nameless: SetupHealthFinding = makeSetupHealthFinding({
      check: SetupHealthCheck.ResponderCannotBePaged,
      level: SetupHealthLevel.PagesWillNotArrive,
      reason: SetupHealthResponderReason.NoVerifiedMethod,
      record: { kind: SetupHealthRecordKind.User, id: ANA, name: "" },
      fix: SetupHealthFix.OnCallReadiness,
      words: SETUP_HEALTH_WORDS.responderCannotBePaged.no_verified_method,
      values: { name: "Someone" },
    });

    expect(getSetupHealthSentence(nameless, translator)).toBe(
      "Someone has no verified notification method, so pages don't reach them.",
    );
  });

  test.each([
    [SetupHealthFix.MonitorCriteria, PageMap.MONITOR_VIEW_CRITERIA, CHECKOUT],
    [SetupHealthFix.MonitorProbes, PageMap.MONITOR_VIEW_PROBES, CHECKOUT],
    [SetupHealthFix.MonitorOverview, PageMap.MONITOR_VIEW, CHECKOUT],
    [SetupHealthFix.CreateMonitor, PageMap.MONITOR_CREATE, ""],
    [
      SetupHealthFix.IncidentOnCallRules,
      PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES,
      "",
    ],
    [
      SetupHealthFix.AlertOnCallRules,
      PageMap.ALERTS_SETTINGS_ON_CALL_RULES,
      "",
    ],
    // No on-call policy yet (#7369): the on-call guided setup.
    [SetupHealthFix.OnCallGuidedSetup, PageMap.ON_CALL_DUTY_GUIDED_SETUP, ""],
    [
      SetupHealthFix.OnCallPolicy,
      PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
      PRIMARY,
    ],
    [
      SetupHealthFix.OnCallSchedule,
      PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS,
      SCHEDULE,
    ],
    [SetupHealthFix.OnCallReadiness, PageMap.ON_CALL_DUTY_READINESS, ""],
    [
      SetupHealthFix.ProjectNotificationSettings,
      PageMap.SETTINGS_NOTIFICATION_SETTINGS,
      "",
    ],
    [SetupHealthFix.ProjectBilling, PageMap.SETTINGS_BILLING, ""],
    [
      SetupHealthFix.StatusPageResources,
      PageMap.STATUS_PAGE_VIEW_RESOURCES,
      STATUS_PAGE,
    ],
    [
      SetupHealthFix.StatusPageDomains,
      PageMap.STATUS_PAGE_VIEW_DOMAINS,
      STATUS_PAGE,
    ],
    [SetupHealthFix.ProjectOwners, PageMap.TEAMS, ""],
    // #7295: the key's own page, with when it was last used and Delete.
    [
      SetupHealthFix.TelemetryIngestionKey,
      PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW,
      INGESTION_KEY,
    ],
    // #9371: where the card puts an owner no Created email reaches right.
    [SetupHealthFix.TeamMembers, PageMap.TEAM_VIEW_MEMBERS, OWNER_TEAM],
    [
      SetupHealthFix.NetworkDeviceOwners,
      PageMap.NETWORK_DEVICE_VIEW_OWNERS,
      NETWORK_DEVICE,
    ],
    [
      SetupHealthFix.IncidentOwnerRules,
      PageMap.INCIDENTS_SETTINGS_OWNER_RULES,
      "",
    ],
    [SetupHealthFix.AlertOwnerRules, PageMap.ALERTS_SETTINGS_OWNER_RULES, ""],
  ])(
    "%s opens %s",
    (fix: SetupHealthFix, pageMap: PageMap, recordId: string) => {
      const finding: SetupHealthFinding = {
        ...POLICY_FINDING,
        fix: fix,
        fixRecordId: recordId,
      };
      const link: ReturnType<typeof getSetupHealthFixLink> =
        getSetupHealthFixLink({ finding: finding, translator: translator });

      expect(link).not.toBeNull();
      expect(link!.route.toString()).toBe(
        (recordId
          ? RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
              modelId: new ObjectID(recordId),
            })
          : RouteUtil.populateRouteParams(RouteMap[pageMap] as Route)
        ).toString(),
      );
      expect(link!.text.length).toBeGreaterThan(3);
    },
  );

  test.each([
    [WorkspaceType.Slack, PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK],
    [
      WorkspaceType.MicrosoftTeams,
      PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    ],
    [
      WorkspaceType.Mattermost,
      PageMap.INCIDENTS_WORKSPACE_CONNECTION_MATTERMOST,
    ],
  ])(
    "a chat workspace's rules are its own page: %s",
    (workspace: WorkspaceType, pageMap: PageMap) => {
      const link: ReturnType<typeof getSetupHealthFixLink> =
        getSetupHealthFixLink({
          finding: {
            ...OWNER_FINDING,
            check: SetupHealthCheck.WorkspaceNotUsed,
            subject: workspace,
            fix: SetupHealthFix.WorkspaceNotificationRules,
          },
          translator: translator,
        });

      expect(link!.route.toString()).toBe(
        RouteUtil.populateRouteParams(RouteMap[pageMap] as Route).toString(),
      );
      expect(link!.text).toBe("Add Notification Rule");
    },
  );

  test("the server's fix is its admin's, not a page of the Dashboard", () => {
    expect(
      getSetupHealthFixLink({
        finding: SERVER_FINDING,
        translator: translator,
      }),
    ).toBeNull();
  });

  test("a check broken for many records is one group, in the server's order", () => {
    const groups: ReturnType<typeof groupSetupHealthFindings> =
      groupSetupHealthFindings([
        monitorFinding(1),
        monitorFinding(2),
        POLICY_FINDING,
        monitorFinding(3),
      ]);

    expect(
      groups.map((group: { findings: Array<unknown> }) => {
        return group.findings.length;
      }),
    ).toEqual([3, 1]);
  });
});

/*
 * The page opens with one line that says how badly (#8135): the worst level
 * with findings, counted, in the reader's words.
 */
describe("the verdict the page opens with", () => {
  function headline(counts: {
    pagesWillNotArrive: number;
    worthFixing: number;
  }): string {
    return translateSetupHealthVerdictText(
      translator,
      getSetupHealthVerdict(counts).headline,
      { isHeadline: true },
    );
  }

  test("the worst level with findings decides it", () => {
    expect(
      getSetupHealthVerdict({ pagesWillNotArrive: 2, worthFixing: 5 }).kind,
    ).toBe(SetupHealthVerdictKind.PagesWillNotArrive);
    expect(
      getSetupHealthVerdict({ pagesWillNotArrive: 0, worthFixing: 5 }).kind,
    ).toBe(SetupHealthVerdictKind.WorthFixing);
    expect(
      getSetupHealthVerdict({ pagesWillNotArrive: 0, worthFixing: 0 }).kind,
    ).toBe(SetupHealthVerdictKind.NothingToFix);
  });

  test("its headline counts that level's findings in the reader's plural, and never ends on a full stop", () => {
    expect(headline({ pagesWillNotArrive: 1, worthFixing: 4 })).toBe(
      "1 problem would stop people from being told",
    );
    expect(headline({ pagesWillNotArrive: 3, worthFixing: 0 })).toBe(
      "3 problems would stop people from being told",
    );
    expect(headline({ pagesWillNotArrive: 0, worthFixing: 1 })).toBe(
      "1 thing in your setup is worth fixing",
    );
    expect(headline({ pagesWillNotArrive: 0, worthFixing: 6 })).toBe(
      "6 things in your setup are worth fixing",
    );
    // Nothing to fix: the empty state's words, as a headline.
    expect(headline({ pagesWillNotArrive: 0, worthFixing: 0 })).toBe(
      toHeadline(SETUP_HEALTH_WORDS_PAGE.nothingToFix),
    );
    expect(
      translateSetupHealthVerdictText(
        translator,
        getSetupHealthVerdict({ pagesWillNotArrive: 0, worthFixing: 0 })
          .summary,
      ),
    ).toBe(SETUP_HEALTH_WORDS_PAGE.nothingToFixDescription);
  });

  test.each(["de", "fr", "es", "ru", "ja", "zh-CN", "hi", "fa", "ar"])(
    "in %s, every verdict and the records a finding reaches read in the reader's words",
    (language: string) => {
      const reader: Translator = dashboardTranslator(language);

      for (const counts of [
        { pagesWillNotArrive: 1, worthFixing: 0 },
        { pagesWillNotArrive: 3, worthFixing: 0 },
        { pagesWillNotArrive: 0, worthFixing: 1 },
        { pagesWillNotArrive: 0, worthFixing: 6 },
        { pagesWillNotArrive: 0, worthFixing: 0 },
      ]) {
        const verdict: SetupHealthVerdict = getSetupHealthVerdict(counts);

        for (const text of [verdict.headline, verdict.summary]) {
          expect(translateSetupHealthVerdictText(reader, text)).not.toBe(
            translateSetupHealthVerdictText(translator, text),
          );
        }
      }

      expect(reader.translateText(SETUP_HEALTH_AFFECTS)).not.toBe(
        SETUP_HEALTH_AFFECTS,
      );
    },
  );

  test("a count reads right in Russian and Arabic, whose general form holds every count", () => {
    const counts: { pagesWillNotArrive: number; worthFixing: number } = {
      pagesWillNotArrive: 0,
      worthFixing: 6,
    };

    for (const language of ["ru", "ar"]) {
      const words: string = translateSetupHealthVerdictText(
        dashboardTranslator(language),
        getSetupHealthVerdict(counts).headline,
      );

      expect(words).toContain("6");
      expect(words).not.toContain("{{count}}");
    }

    // Persian writes the count in its own digits.
    expect(
      translateSetupHealthVerdictText(
        dashboardTranslator("fa"),
        getSetupHealthVerdict({ pagesWillNotArrive: 3, worthFixing: 0 })
          .headline,
      ),
    ).toContain("۳");
  });

  test("each verdict, and each level, has its own colours and icon", () => {
    for (const kind of Object.values(SetupHealthVerdictKind)) {
      expect(VERDICT_LOOK[kind]).toBeDefined();
    }

    expect(
      VERDICT_LOOK[SetupHealthVerdictKind.PagesWillNotArrive].bandClassName,
    ).toBe("bg-red-50");
    expect(VERDICT_LOOK[SetupHealthVerdictKind.WorthFixing].bandClassName).toBe(
      "bg-amber-50",
    );
    expect(
      VERDICT_LOOK[SetupHealthVerdictKind.NothingToFix].bandClassName,
    ).toBe("bg-emerald-50");

    for (const level of SETUP_HEALTH_LEVEL_ORDER) {
      expect(LEVEL_LOOK[level].iconBox.bg).toMatch(/^bg-/);
      expect(LEVEL_LOOK[level].countClassName).toMatch(/text-/);
    }
  });
});

describe("how a finding looks: its icon, its names and the records it reaches", () => {
  test("every check has the icon of what it is about; the server's channel and a chat workspace their own", () => {
    for (const check of Object.values(SetupHealthCheck)) {
      expect(CHECK_ICONS[check]).toBeDefined();
    }

    expect(
      getSetupHealthFindingIcon({
        check: SetupHealthCheck.MonitorPagesNobody,
        subject: SetupHealthEventKind.Incident,
      }),
    ).toBe(IconProp.AltGlobe);
    expect(getSetupHealthFindingIcon(POLICY_FINDING)).toBe(IconProp.Call);
    expect(getSetupHealthFindingIcon(SERVER_FINDING)).toBe(IconProp.Email);
    expect(
      getSetupHealthFindingIcon({
        check: SetupHealthCheck.ServerCannotSend,
        subject: WhoIsToldServerChannel.SMS,
      }),
    ).toBe(IconProp.SMS);
    expect(
      getSetupHealthFindingIcon({
        check: SetupHealthCheck.ServerCannotSend,
        subject: WhoIsToldServerChannel.Call,
      }),
    ).toBe(IconProp.Phone);
    expect(
      getSetupHealthFindingIcon({
        check: SetupHealthCheck.WorkspaceNotUsed,
        subject: WorkspaceType.MicrosoftTeams,
      }),
    ).toBe(IconProp.MicrosoftTeams);

    // A status page's menu icon is a check mark: on a problem it reads "fine".
    expect(CHECK_ICONS[SetupHealthCheck.StatusPageShowsNoMonitor]).not.toBe(
      IconProp.CheckCircle,
    );

    for (const kind of Object.values(SetupHealthRecordKind)) {
      expect(RECORD_ICONS[kind]).toBeDefined();
    }
  });

  test("a sentence's values: the project's names, apart from the channel, the time and the amount", () => {
    expect(getSetupHealthSentenceValues(POLICY_FINDING).names).toEqual({
      policy: "Primary",
    });

    const off: SetupHealthSentenceValues = getSetupHealthSentenceValues(
      makeSetupHealthFinding({
        check: SetupHealthCheck.ChannelOff,
        level: SetupHealthLevel.PagesWillNotArrive,
        subject: OnCallPageChannel.SMS,
        record: { kind: SetupHealthRecordKind.Project, id: PROJECT, name: "" },
        fix: SetupHealthFix.ProjectNotificationSettings,
        words: SETUP_HEALTH_WORDS.channelOff,
        values: { channel: "SMS" },
      }),
    );

    expect(off.names).toEqual({});
    expect(Object.keys(off.values)).toEqual(["channel"]);

    const gap: SetupHealthSentenceValues = getSetupHealthSentenceValues(
      makeSetupHealthFinding({
        check: SetupHealthCheck.ScheduleHasNobodyOnCall,
        level: SetupHealthLevel.WorthFixing,
        reason: SetupHealthScheduleReason.GapAhead,
        record: {
          kind: SetupHealthRecordKind.OnCallDutyPolicySchedule,
          id: SCHEDULE,
          name: "Primary rota",
        },
        fix: SetupHealthFix.OnCallSchedule,
        words: SETUP_HEALTH_WORDS.scheduleHasNobodyOnCall.gap_ahead,
        values: { schedule: "Primary rota", time: "2026-11-14 03:00 UTC" },
        startsAt: "2026-11-14T03:00:00.000Z",
      }),
    );

    expect(gap.names).toEqual({ schedule: "Primary rota" });
    expect(Object.keys(gap.values)).toEqual(["time"]);

    // A person with no name is "Someone", in the reader's words, not a name.
    const nameless: SetupHealthSentenceValues = getSetupHealthSentenceValues(
      makeSetupHealthFinding({
        check: SetupHealthCheck.ResponderCannotBePaged,
        level: SetupHealthLevel.PagesWillNotArrive,
        reason: SetupHealthResponderReason.NoVerifiedMethod,
        record: { kind: SetupHealthRecordKind.User, id: ANA, name: "" },
        fix: SetupHealthFix.OnCallReadiness,
        words: SETUP_HEALTH_WORDS.responderCannotBePaged.no_verified_method,
        values: { name: "Someone" },
      }),
    );

    expect(nameless.names).toEqual({});
    expect(Object.keys(nameless.values)).toEqual(["name"]);
  });

  test.each([
    [SetupHealthRecordKind.Monitor, PageMap.MONITOR_VIEW],
    [SetupHealthRecordKind.OnCallDutyPolicy, PageMap.ON_CALL_DUTY_POLICY_VIEW],
    [
      SetupHealthRecordKind.OnCallDutyPolicySchedule,
      PageMap.ON_CALL_DUTY_SCHEDULE_VIEW,
    ],
    [SetupHealthRecordKind.StatusPage, PageMap.STATUS_PAGE_VIEW],
    [
      SetupHealthRecordKind.TelemetryIngestionKey,
      PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW,
    ],
  ])(
    "a %s a finding reaches opens %s",
    (kind: SetupHealthRecordKind, pageMap: PageMap) => {
      expect(
        getSetupHealthRecordRoute({ kind: kind, id: CHECKOUT })!.toString(),
      ).toBe(
        RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
          modelId: new ObjectID(CHECKOUT),
        }).toString(),
      );
    },
  );

  test("a person, a domain and the project open no page of their own", () => {
    for (const kind of [
      SetupHealthRecordKind.User,
      SetupHealthRecordKind.StatusPageDomain,
      SetupHealthRecordKind.Project,
    ]) {
      expect(
        getSetupHealthRecordRoute({ kind: kind, id: CHECKOUT }),
      ).toBeNull();
    }

    expect(
      getSetupHealthRecordRoute({
        kind: SetupHealthRecordKind.Monitor,
        id: "",
      }),
    ).toBeNull();
  });
});

describe("the page's requests", () => {
  test("one GET for the findings, with refresh only when asked; one for Home's counts", () => {
    expect(getSetupHealthUrl().toString()).toMatch(/\/setup-health$/);
    expect(getSetupHealthUrl({ refresh: true }).toString()).toMatch(
      /\/setup-health\?refresh=true$/,
    );
    expect(getSetupHealthSummaryUrl().toString()).toMatch(
      /\/setup-health\/summary$/,
    );
  });

  test("only an answer with findings, dismissed ones, counts and a time is drawn", () => {
    expect(isSetupHealthAnswer(answer([]))).toBe(true);
    expect(isSetupHealthAnswer({ findings: [] })).toBe(false);
    expect(isSetupHealthAnswer(null)).toBe(false);
    expect(isSetupHealthAnswer([])).toBe(false);
    expect(
      isSetupHealthSummary({
        counts: getSetupHealthCounts([]),
        checkedAt: "x",
      }),
    ).toBe(true);
    expect(isSetupHealthSummary({ counts: {} })).toBe(false);
    expect(isSetupHealthSummary("<html>")).toBe(false);
  });

  test("a dismissal is the project's RecommendationDismissal of the finding's check and record", async () => {
    const dismiss: SpyInstance<typeof RecommendationDismissalUtil.dismiss> =
      jest
        .spyOn(RecommendationDismissalUtil, "dismiss")
        .mockResolvedValue(undefined as never);
    const restore: SpyInstance<typeof RecommendationDismissalUtil.restore> =
      jest
        .spyOn(RecommendationDismissalUtil, "restore")
        .mockResolvedValue(undefined as never);

    await SetupHealthApi.dismiss({
      finding: monitorFinding(7),
      reason: "Staging",
    });

    expect(dismiss).toHaveBeenCalledWith({
      recommendationId: "monitor_pages_nobody:incident",
      recommendationType: RecommendationType.SetupHealth,
      resourceType: SetupHealthRecordKind.Monitor,
      resourceId: new ObjectID(monitorFinding(7).record.id),
      dismissalReason: "Staging",
    });

    await SetupHealthApi.restore(DISMISSAL);

    expect(restore).toHaveBeenCalledWith(new ObjectID(DISMISSAL));

    jest.restoreAllMocks();
  });
});

describe("the page lives under Home, and Search finds it", () => {
  test("at …/home/setup-health, with a trail of Project, Home and Setup Health", () => {
    expect(HomeRoutePath[PageMap.HOME_SETUP_HEALTH]).toBe("setup-health");
    expect(RouteMap[PageMap.HOME_SETUP_HEALTH]!.toString()).toBe(
      "/dashboard/:projectId/home/setup-health",
    );

    goTo(`/dashboard/${SIDE_MENU_PROJECT_ID}/home/setup-health`);

    const trail: ReturnType<typeof getHomeBreadcrumbs> = getHomeBreadcrumbs(
      RouteMap[PageMap.HOME_SETUP_HEALTH]!.toString(),
    );

    expect(
      trail!.map((link: { title: string }) => {
        return link.title;
      }),
    ).toEqual(["Project", "Home", "Setup Health"]);
  });

  test("Search offers it under Home, by name and by what people ask", () => {
    const home: ReturnType<typeof getPageSearchAreas>[number] | undefined =
      getPageSearchAreas().find((area: { id: string }): boolean => {
        return area.id === "home";
      });

    expect(home).toBeDefined();
    expect(home!.productPage).toBe(PageMap.HOME);

    const page: {
      page: string;
      title: string;
      keywords?: Array<string> | undefined;
    } = home!.sections[0]!.pages[0]!;

    expect(page.page).toBe(PageMap.HOME_SETUP_HEALTH);
    expect(page.title).toBe("Setup Health");
    expect(page.keywords).toEqual(
      expect.arrayContaining(["misconfigured", "is my setup ok"]),
    );
  });
});

describe("SetupHealthView", () => {
  let getAnswer: SpyInstance<typeof SetupHealthApi.getAnswer>;
  let send: SpyInstance<typeof ProductEvents.send>;

  function renderView(): void {
    render(
      <MemoryRouter>
        <SetupHealthView />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    getAnswer = jest.spyOn(SetupHealthApi, "getAnswer");
    send = jest.spyOn(ProductEvents, "send").mockImplementation(() => {
      return undefined;
    });
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("lists the findings by level, worst first, each with its sentence and its fix", async () => {
    getAnswer.mockResolvedValue(
      answer([POLICY_FINDING, monitorFinding(1), OWNER_FINDING]),
    );
    renderView();

    expect(screen.getByTestId("setup-health-loading")).toBeInTheDocument();

    const pages: HTMLElement = await screen.findByTestId(
      `setup-health-level-${SetupHealthLevel.PagesWillNotArrive}`,
    );
    const worth: HTMLElement = screen.getByTestId(
      `setup-health-level-${SetupHealthLevel.WorthFixing}`,
    );
    const suggestions: HTMLElement = screen.getByTestId(
      `setup-health-level-${SetupHealthLevel.Suggestion}`,
    );

    // Worst first.
    expect(
      pages.compareDocumentPosition(worth) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      worth.compareDocumentPosition(suggestions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(pages).toHaveTextContent(
      LEVEL_WORDS[SetupHealthLevel.PagesWillNotArrive].title,
    );
    expect(pages).toHaveTextContent(
      "On-call policy Primary has no escalation rules, so it pages nobody.",
    );

    const fix: HTMLElement = within(pages).getByTestId("setup-health-fix");

    expect(fix).toHaveTextContent("Open On-Call Policy");
    expect(fix.getAttribute("href")).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route,
        { modelId: new ObjectID(PRIMARY) },
      ).toString(),
    );
    expect(
      within(worth).getByTestId("setup-health-fix").getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES] as Route,
      ).toString(),
    );
    expect(
      screen.getByTestId(
        `setup-health-level-${SetupHealthLevel.WorthFixing}-count`,
      ),
    ).toHaveTextContent("1");
    expect(screen.queryByTestId("setup-health-nothing-to-fix")).toBeNull();
    expect(getAnswer).toHaveBeenCalledWith({ refresh: false });
  });

  test("says when it was opened, from where, and how many findings of each level", async () => {
    getAnswer.mockResolvedValue(
      answer([POLICY_FINDING, monitorFinding(1), OWNER_FINDING]),
    );
    renderView();

    await screen.findByTestId(
      `setup-health-level-${SetupHealthLevel.PagesWillNotArrive}`,
    );

    expect(send).toHaveBeenCalledWith(ProductEventName.SetupHealthOpened, {
      source: "direct",
      pages_will_not_arrive_count: 1,
      worth_fixing_count: 1,
      suggestion_count: 1,
      dismissed_count: 0,
    });

    fireEvent.click(
      within(
        screen.getByTestId(
          `setup-health-level-${SetupHealthLevel.PagesWillNotArrive}`,
        ),
      ).getByTestId("setup-health-fix"),
    );

    expect(send).toHaveBeenCalledWith(ProductEventName.SetupHealthFixOpened, {
      check: SetupHealthCheck.PolicyHasNoEscalationRules,
      level: SetupHealthLevel.PagesWillNotArrive,
    });
  });

  test("opens with the verdict, red while pages will not arrive, with when it was checked and Recheck", async () => {
    getAnswer.mockResolvedValue(
      answer([POLICY_FINDING, monitorFinding(1), OWNER_FINDING]),
    );
    renderView();

    const summary: HTMLElement = await screen.findByTestId(
      "setup-health-summary",
    );

    expect(summary).toHaveAttribute(
      "data-verdict",
      SetupHealthVerdictKind.PagesWillNotArrive,
    );
    expect(
      within(summary).getByTestId("setup-health-headline"),
    ).toHaveTextContent("1 problem would stop people from being told");
    expect(
      within(summary).getByTestId("setup-health-verdict"),
    ).toHaveTextContent(SETUP_HEALTH_VERDICT_WORDS.pagesWillNotArriveSummary);
    expect(
      within(summary).getByTestId("setup-health-checked"),
    ).toHaveTextContent("Checked");
    expect(within(summary).getByTestId("setup-health-recheck")).toBeEnabled();
    // The section is named by its headline.
    expect(summary).toHaveAttribute(
      "aria-labelledby",
      within(summary).getByTestId("setup-health-headline").id,
    );

    // The verdict first, then the levels.
    expect(
      summary.compareDocumentPosition(
        screen.getByTestId(
          `setup-health-level-${SetupHealthLevel.PagesWillNotArrive}`,
        ),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Each level's count in its own colours.
    expect(
      screen.getByTestId(
        `setup-health-level-${SetupHealthLevel.PagesWillNotArrive}-count`,
      ),
    ).toHaveClass("text-red-700");
    expect(
      screen.getByTestId(
        `setup-health-level-${SetupHealthLevel.WorthFixing}-count`,
      ),
    ).toHaveClass("text-amber-700");
    expect(
      screen.getByTestId(
        `setup-health-level-${SetupHealthLevel.Suggestion}-count`,
      ),
    ).toHaveClass("text-gray-700");
  });

  test("with nothing that stops pages, the verdict counts the gaps worth fixing", async () => {
    getAnswer.mockResolvedValue(
      answer([monitorFinding(1), monitorFinding(2), OWNER_FINDING]),
    );
    renderView();

    const summary: HTMLElement = await screen.findByTestId(
      "setup-health-summary",
    );

    expect(summary).toHaveAttribute(
      "data-verdict",
      SetupHealthVerdictKind.WorthFixing,
    );
    expect(
      within(summary).getByTestId("setup-health-headline"),
    ).toHaveTextContent("2 things in your setup are worth fixing");
    expect(
      within(summary).getByTestId("setup-health-verdict"),
    ).toHaveTextContent(SETUP_HEALTH_VERDICT_WORDS.worthFixingSummary);
  });

  test("a project with nothing wrong says so plainly", async () => {
    getAnswer.mockResolvedValue(answer([]));
    renderView();

    const summary: HTMLElement = await screen.findByTestId(
      "setup-health-summary",
    );

    expect(summary).toHaveAttribute(
      "data-verdict",
      SetupHealthVerdictKind.NothingToFix,
    );
    // The all-clear's words, its title a heading without the stop.
    expect(
      within(summary).getByTestId("setup-health-headline").textContent,
    ).toBe(toHeadline(SETUP_HEALTH_WORDS_PAGE.nothingToFix));
    expect(
      within(summary).getByTestId("setup-health-verdict"),
    ).toHaveTextContent(SETUP_HEALTH_WORDS_PAGE.nothingToFixDescription);
    expect(screen.queryByTestId("setup-health-finding")).toBeNull();
    expect(screen.queryByTestId(/^setup-health-level-/)).toBeNull();
  });

  test("with only suggestions there is nothing to fix, and the suggestions follow", async () => {
    getAnswer.mockResolvedValue(answer([OWNER_FINDING]));
    renderView();

    const summary: HTMLElement = await screen.findByTestId(
      "setup-health-summary",
    );

    expect(summary).toHaveAttribute(
      "data-verdict",
      SetupHealthVerdictKind.NothingToFix,
    );
    expect(
      screen.getByTestId(`setup-health-level-${SetupHealthLevel.Suggestion}`),
    ).toHaveTextContent(SETUP_HEALTH_WORDS.oneOwner);
  });

  test("a finding names its records in bold, with the icon of what it is about, and its fix right under its sentence", async () => {
    getAnswer.mockResolvedValue(answer([POLICY_FINDING]));
    renderView();

    const row: HTMLElement = await screen.findByTestId("setup-health-finding");
    const sentence: HTMLElement = within(row).getByTestId(
      "setup-health-sentence",
    );

    // The whole sentence, word for word.
    expect(sentence.textContent).toBe(
      "On-call policy Primary has no escalation rules, so it pages nobody.",
    );

    const names: Array<HTMLElement> =
      within(sentence).getAllByTestId("setup-health-name");

    expect(
      names.map((name: HTMLElement): string | null => {
        return name.textContent;
      }),
    ).toEqual(["Primary"]);
    expect(names[0]).toHaveClass("font-semibold");

    // The fix follows the sentence in the same column: never at the far end of a wide row.
    const fix: HTMLElement = within(row).getByTestId("setup-health-fix");

    expect(sentence.parentElement).toContainElement(fix);
    expect(
      sentence.compareDocumentPosition(fix) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(row).getByTestId("setup-health-dismiss")).toBeInTheDocument();
    expect(sentence.parentElement).toContainElement(
      within(row).getByTestId("setup-health-dismiss"),
    );
  });

  test("a name the sentence does not hold never stops the sentence from being drawn whole", async () => {
    getAnswer.mockResolvedValue(
      answer([{ ...OWNER_FINDING, values: { workspace: "Slack" } }]),
    );
    renderView();

    const sentence: HTMLElement = await screen.findByTestId(
      "setup-health-sentence",
    );

    expect(sentence.textContent).toBe(SETUP_HEALTH_WORDS.oneOwner);
    expect(within(sentence).queryByTestId("setup-health-name")).toBeNull();
  });

  test("the records a finding reaches: a few, each opening its page, and how many more", async () => {
    const monitors: Array<SetupHealthRecord> = [1, 2, 3, 4, 5].map(
      (index: number): SetupHealthRecord => {
        return monitorFinding(index).record;
      },
    );

    getAnswer.mockResolvedValue(
      answer([
        {
          ...POLICY_FINDING,
          // A record with no name is left out: nothing to show for it.
          related: [
            ...monitors,
            { kind: SetupHealthRecordKind.Monitor, id: CHECKOUT, name: "" },
          ],
        },
        OWNER_FINDING,
      ]),
    );
    renderView();

    const related: HTMLElement = await screen.findByTestId(
      "setup-health-related",
    );

    expect(related).toHaveTextContent(SETUP_HEALTH_AFFECTS);

    const records: Array<HTMLElement> = within(related).getAllByTestId(
      "setup-health-related-record",
    );

    expect(records).toHaveLength(RELATED_RECORDS_SHOWN);
    expect(records[0]).toHaveTextContent("Monitor 1");
    expect(records[0]!.getAttribute("href")).toBe(
      RouteUtil.populateRouteParams(RouteMap[PageMap.MONITOR_VIEW] as Route, {
        modelId: new ObjectID(monitors[0]!.id),
      }).toString(),
    );
    expect(
      within(related).getByTestId("setup-health-related-more"),
    ).toHaveTextContent("+2 more");

    // A finding that reaches nothing else says nothing of it.
    expect(screen.getAllByTestId("setup-health-related")).toHaveLength(1);
  });

  /*
   * #7296: a record the reader may not see is never named. The server
   * leaves it out of what a finding reaches (redactSetupHealthFindings),
   * and a finding left with nothing to name draws no Affects line.
   */
  test("the records a finding reaches that the reader may not see are never named, nor is the line drawn for none", async () => {
    const monitors: Array<SetupHealthRecord> = [1, 2, 3].map(
      (index: number): SetupHealthRecord => {
        return monitorFinding(index).record;
      },
    );
    const readable: SetupHealthReadable = {
      monitorIds: new Set<string>([monitors[1]!.id]),
      policyIds: new Set<string>([PRIMARY]),
      scheduleIds: new Set<string>(),
      statusPageIds: new Set<string>(),
      ingestionKeyIds: new Set<string>(),
      canReadResponders: false,
    };
    const asSeen: (seenBy: SetupHealthReadable) => SetupHealthFinding = (
      seenBy: SetupHealthReadable,
    ): SetupHealthFinding => {
      return redactSetupHealthFindings(
        [{ ...POLICY_FINDING, related: monitors }],
        seenBy,
      )[0]!;
    };

    getAnswer.mockResolvedValue(answer([asSeen(readable)]));
    renderView();

    const related: HTMLElement = await screen.findByTestId(
      "setup-health-related",
    );

    expect(
      within(related)
        .getAllByTestId("setup-health-related-record")
        .map((record: HTMLElement): string | null => {
          return record.textContent;
        }),
    ).toEqual(["Monitor 2"]);
    expect(related).not.toHaveTextContent("Monitor 1");
    expect(related).not.toHaveTextContent("Monitor 3");
    expect(
      within(related).queryByTestId("setup-health-related-more"),
    ).toBeNull();

    cleanup();
    getAnswer.mockResolvedValue(
      answer([asSeen({ ...readable, monitorIds: new Set<string>() })]),
    );
    renderView();

    expect(await screen.findByTestId("setup-health-finding")).toHaveTextContent(
      POLICY_FINDING.sentence,
    );
    expect(screen.queryByTestId("setup-health-related")).toBeNull();
    expect(screen.queryByText("Monitor 1")).toBeNull();
  });

  test("after a failed read, Try again reads it again", async () => {
    getAnswer
      .mockRejectedValueOnce(new Error("Server is down."))
      .mockResolvedValueOnce(answer([OWNER_FINDING]));
    renderView();

    fireEvent.click(await screen.findByTestId("setup-health-try-again"));

    expect(
      await screen.findByTestId("setup-health-finding"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("setup-health-error")).toBeNull();
    expect(getAnswer).toHaveBeenCalledTimes(2);
  });

  test("a check broken for many monitors shows a few, and the rest a click away, saying which way it is", async () => {
    const many: Array<SetupHealthFinding> = [1, 2, 3, 4, 5].map(monitorFinding);
    getAnswer.mockResolvedValue(answer(many));
    renderView();

    const toggle: HTMLElement = await screen.findByTestId(
      "setup-health-group-toggle",
    );

    expect(screen.getAllByTestId("setup-health-finding")).toHaveLength(
      FINDINGS_SHOWN_PER_CHECK,
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Show 2 more");

    fireEvent.click(toggle);

    expect(screen.getAllByTestId("setup-health-finding")).toHaveLength(5);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent(SETUP_HEALTH_WORDS_PAGE.showFewer);
  });

  test("the server's findings ask its admin, and open the Admin Dashboard for one", async () => {
    getAnswer.mockResolvedValue(answer([SERVER_FINDING]));
    renderView();

    expect(
      await screen.findByTestId("setup-health-ask-admin"),
    ).toHaveTextContent(SETUP_HEALTH_WORDS_PAGE.askServerAdmin);
    expect(screen.queryByTestId("setup-health-fix")).toBeNull();

    cleanup();
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    renderView();

    const fix: HTMLElement = await screen.findByTestId("setup-health-fix");

    expect(fix).toHaveTextContent("Open Server Setup");
    expect(fix.getAttribute("href")).toMatch(/\/setup$/);
    expect(fix).toHaveAttribute("target", "_blank");
  });

  test("dismissing asks why, hides the finding for everyone, and reads the list again", async () => {
    getAnswer.mockResolvedValue(answer([monitorFinding(1), OWNER_FINDING]));
    const dismiss: SpyInstance<typeof SetupHealthApi.dismiss> = jest
      .spyOn(SetupHealthApi, "dismiss")
      .mockResolvedValue(undefined as never);
    renderView();

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "setup-health-finding",
    );

    fireEvent.click(within(rows[0]!).getByTestId("setup-health-dismiss"));

    expect(
      screen.getByText(SETUP_HEALTH_WORDS_PAGE.dismissTitle),
    ).toBeInTheDocument();

    const reason: HTMLElement = screen.getByTestId(
      "setup-health-dismiss-reason",
    );

    expect(reason).toHaveAttribute(
      "placeholder",
      SETUP_HEALTH_WORDS_PAGE.dismissPlaceholder,
    );

    fireEvent.change(reason, { target: { value: "Staging, on purpose" } });
    getAnswer.mockResolvedValue(answer([OWNER_FINDING]));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(dismiss).toHaveBeenCalledWith({
        finding: monitorFinding(1),
        reason: "Staging, on purpose",
      });
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("setup-health-finding")).toHaveLength(1);
    });
    expect(getAnswer).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(
      ProductEventName.SetupHealthFindingDismissed,
      { check: SetupHealthCheck.MonitorPagesNobody, has_reason: true },
    );
  });

  test("somebody who may not dismiss is not offered Dismiss", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: false });
    getAnswer.mockResolvedValue(answer([monitorFinding(1)]));
    renderView();

    await screen.findByTestId("setup-health-finding");

    expect(screen.queryByTestId("setup-health-dismiss")).toBeNull();
  });

  test("Dismissed is folded, says who hid each and why, and Restore brings one back", async () => {
    const restore: SpyInstance<typeof SetupHealthApi.restore> = jest
      .spyOn(SetupHealthApi, "restore")
      .mockResolvedValue(undefined as never);

    getAnswer.mockResolvedValue(
      answer([OWNER_FINDING], {
        dismissed: [
          {
            finding: monitorFinding(1),
            dismissal: {
              id: DISMISSAL,
              recommendationId: "monitor_pages_nobody:incident",
              resourceType: SetupHealthRecordKind.Monitor,
              resourceId: monitorFinding(1).record.id,
              reason: "Staging",
              dismissedByName: "Ana Lopez",
              dismissedAt: null,
            },
          },
        ],
      }),
    );
    renderView();

    const toggle: HTMLElement = await screen.findByTestId(
      "setup-health-dismissed-toggle",
    );

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("setup-health-dismissed-finding")).toBeNull();

    fireEvent.click(toggle);

    const row: HTMLElement = screen.getByTestId(
      "setup-health-dismissed-finding",
    );

    expect(row).toHaveTextContent(
      "Nobody is paged when Monitor 1 goes down: no on-call rule matches its incidents.",
    );
    expect(
      within(row).getByTestId("setup-health-dismissed-by"),
    ).toHaveTextContent("Dismissed by Ana Lopez: Staging");

    getAnswer.mockResolvedValue(answer([OWNER_FINDING, monitorFinding(1)]));
    fireEvent.click(within(row).getByTestId("setup-health-restore"));

    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith(DISMISSAL);
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("setup-health-finding")).toHaveLength(2);
    });
    expect(send).toHaveBeenCalledWith(
      ProductEventName.SetupHealthFindingRestored,
      { check: SetupHealthCheck.MonitorPagesNobody },
    );
  });

  test("Recheck asks the server to work it out again", async () => {
    getAnswer.mockResolvedValue(answer([OWNER_FINDING]));
    renderView();

    await screen.findByTestId("setup-health-finding");
    fireEvent.click(screen.getByTestId("setup-health-recheck"));

    await waitFor(() => {
      expect(getAnswer).toHaveBeenLastCalledWith({ refresh: true });
    });
    // Opened once, however many times it is read again.
    expect(
      send.mock.calls.filter((call: Array<unknown>) => {
        return call[0] === ProductEventName.SetupHealthOpened;
      }),
    ).toHaveLength(1);
  });

  test("a failed read says so, in words", async () => {
    getAnswer.mockRejectedValue(new Error("Server is down."));
    renderView();

    expect(await screen.findByTestId("setup-health-error")).toHaveTextContent(
      "Couldn't check the setup. Server is down.",
    );
  });
});

/*
 * The page in the reader's language: the verdict, the sentences and the
 * label of the records a finding reaches in their words, the project's
 * names as written - and still in bold, wherever the sentence puts them.
 */
describe("SetupHealthView in the reader's language", () => {
  const translation: i18n = createInstance();

  const POLICY_WITH_MONITOR: SetupHealthFinding = {
    ...POLICY_FINDING,
    related: [monitorFinding(1).record],
  };

  function renderIn(): void {
    render(
      <I18nextProvider i18n={translation}>
        <MemoryRouter>
          <SetupHealthView />
        </MemoryRouter>
      </I18nextProvider>,
    );
  }

  beforeAll(async () => {
    await translation.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        de: { translation: germanLocale },
        fa: { translation: persianLocale },
      },
      interpolation: { escapeValue: false },
    });
  });

  beforeEach(() => {
    jest
      .spyOn(SetupHealthApi, "getAnswer")
      .mockResolvedValue(answer([POLICY_WITH_MONITOR, monitorFinding(2)]));
    jest.spyOn(ProductEvents, "send").mockImplementation(() => {
      return undefined;
    });
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  });

  afterEach(async () => {
    cleanup();
    jest.restoreAllMocks();
    await translation.changeLanguage("en");
  });

  test("German: the verdict, the sentence and what it affects in German, the names as written, in bold", async () => {
    await translation.changeLanguage("de");
    renderIn();

    expect(
      await screen.findByTestId("setup-health-headline"),
    ).toHaveTextContent(
      "1 Problem würde verhindern, dass Menschen benachrichtigt werden",
    );

    const row: HTMLElement = screen.getAllByTestId("setup-health-finding")[0]!;
    const sentence: HTMLElement = within(row).getByTestId(
      "setup-health-sentence",
    );

    expect(sentence.textContent).not.toBe(POLICY_FINDING.sentence);
    expect(sentence.textContent).toContain("Primary");
    expect(within(sentence).getByTestId("setup-health-name")).toHaveTextContent(
      "Primary",
    );
    expect(within(row).getByTestId("setup-health-related")).toHaveTextContent(
      "Betrifft",
    );
    expect(within(row).getByTestId("setup-health-fix")).not.toHaveTextContent(
      "Open On-Call Policy",
    );
  });

  test("Persian: the sentence in Persian, the names still set apart in bold", async () => {
    await translation.changeLanguage("fa");
    renderIn();

    const headline: HTMLElement = await screen.findByTestId(
      "setup-health-headline",
    );

    expect(headline.textContent).toContain("۱");

    const sentence: HTMLElement = screen.getAllByTestId(
      "setup-health-sentence",
    )[0]!;

    expect(sentence.textContent).not.toContain("On-call policy");
    expect(within(sentence).getByTestId("setup-health-name")).toHaveTextContent(
      "Primary",
    );
  });
});

describe("Home's words for it", () => {
  test("how many things need a look, in the reader's plural", () => {
    expect(translator.translatePlural(SETUP_HEALTH_HOME_WORDS.line, 1)).toBe(
      "1 thing in your setup needs a look.",
    );
    expect(translator.translatePlural(SETUP_HEALTH_HOME_WORDS.line, 3)).toBe(
      "3 things in your setup need a look.",
    );
    expect(
      dashboardTranslator("de").translatePlural(
        SETUP_HEALTH_HOME_WORDS.line,
        3,
      ),
    ).not.toBe("3 things in your setup need a look.");
  });
});
