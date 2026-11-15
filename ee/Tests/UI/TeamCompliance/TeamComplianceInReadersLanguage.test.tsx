import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * ---------------------------------------------------------------------------
 * Teams > Compliance, in the reader's language (#8296, #8461).
 * ---------------------------------------------------------------------------
 *
 * None of the page's screens called the translator: its verdict, its facts,
 * a rule's name, sentence, scope chips and pass rate, the members section's
 * filters, counts and legend, the rule warnings, the recommended rules and
 * the rule form's preview were English in every language, and a rule's
 * severity chip drew a new project's "Critical Incident" as stored where
 * every other screen says "Kritischer Vorfall". Every sentence is one whole
 * key now, with a count in its language's form and a name as a value.
 *
 * The words are checked in every Dashboard language as the page's helpers
 * write them, and the screens are drawn in English, German, Arabic and
 * Persian. What the server words itself - a rule's warnings, why a member
 * fails a rule - arrives in English and is drawn as it came.
 */

jest.mock("Common/UI/Images/users/blank-profile.svg", () => {
  return "data:image/svg+xml;base64,////YXZhdGFy";
});

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: () => {
        return null;
      },
      getGlobalPermissions: () => {
        return null;
      },
    },
  };
});

jest.mock("@oneuptime/dashboard/Utils/CustomNotificationChannels", () => {
  return {
    __esModule: true,
    useCustomNotificationChannels: (): {
      channels: Array<unknown>;
      error: null;
    } => {
      return { channels: [], error: null };
    },
  };
});

jest.mock("Common/UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

import ComplianceHero from "../../../Dashboard/TeamCompliance/ComplianceHero";
import { ComplianceRulePreview } from "../../../Dashboard/TeamCompliance/ComplianceRuleForm";
import ComplianceRulePresets from "../../../Dashboard/TeamCompliance/ComplianceRulePresets";
import ComplianceRulesCard from "../../../Dashboard/TeamCompliance/ComplianceRulesCard";
import ComplianceRuleWarnings from "../../../Dashboard/TeamCompliance/ComplianceRuleWarnings";
import {
  ComplianceSummary,
  getChannelLabel,
  getComplianceVerdict,
  getInvitedNote,
  getNoActiveRulesAdvice,
  getRuleLabel,
  getRulePassRateText,
  getIssueReasonText,
  getRuleSentence,
  getRuleTitle,
  getRuleWarningTexts,
  MemberStatusFilter,
} from "../../../Dashboard/TeamCompliance/ComplianceView";
import TeamComplianceStatusTable from "../../../Dashboard/TeamCompliance/TeamComplianceStatusTable";
import { ComplianceAccess } from "../../../Dashboard/TeamCompliance/ComplianceAccess";
import {
  alertRule,
  buildMember,
  buildStatus,
  CALL_REASON,
  callAndPushForIncidentsRule,
  callForEveryIncidentRule,
  callForIncidentsRule,
  emailRule,
  issue,
  noSeveritiesLeftRule,
  PROJECT_ID,
  standardStatus,
  TEAM_ID,
} from "./ComplianceFixtures";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import {
  TeamComplianceFindingKind,
  TeamComplianceIssueJSON,
  TeamComplianceRuleJSON,
  TeamComplianceStatusJSON,
  TeamComplianceWarningJSON,
  TeamComplianceWarningKind,
} from "Common/Types/Team/TeamComplianceStatus";
import { getComplianceWarningText } from "Common/Types/Team/TeamComplianceFindings";
import { Translator } from "Common/Types/Translator";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const TRANSLATED: ReadonlyArray<string> = ["de", "ar", "fa"];

const english: Translator = dashboardTranslator("en");
const german: Translator = dashboardTranslator("de");

const instanceFor: (language: string) => i18n = (language: string): i18n => {
  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language]: { translation: readDashboardLocale(language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
};

const drawIn: (language: string, element: ReactElement) => HTMLElement = (
  language: string,
  element: ReactElement,
): HTMLElement => {
  return render(
    <I18nextProvider i18n={instanceFor(language)}>
      <MemoryRouter>{element}</MemoryRouter>
    </I18nextProvider>,
  ).container;
};

// A word as `language` writes it.
const wordIn: (language: string, englishText: string) => string = (
  language: string,
  englishText: string,
): string => {
  return readDashboardLocale(language)[englishText] || englishText;
};

const EDITOR: ComplianceAccess = {
  create: { isAllowed: true },
  update: { isAllowed: true },
  delete: { isAllowed: true },
  canViewMemberSetup: true,
  currentUserId: "",
};

const summary: (overrides: Partial<ComplianceSummary>) => ComplianceSummary = (
  overrides: Partial<ComplianceSummary>,
): ComplianceSummary => {
  return {
    memberCount: 3,
    invitedCount: 0,
    compliantCount: 1,
    attentionCount: 2,
    ruleCount: 2,
    activeRuleCount: 2,
    pausedRuleCount: 0,
    resumableRuleCount: 0,
    noSeveritiesLeftRuleCount: 0,
    unrecognisedRuleCount: 0,
    noChannelToCheckRuleCount: 0,
    ...overrides,
  };
};

afterEach(() => {
  cleanup();
});

describe("the page's sentences, in English, word for word as before", () => {
  test("a rule's title, name with its scope, and sentence", () => {
    expect(getRuleTitle(callForIncidentsRule(), english)).toBe(
      "Call for incidents",
    );
    expect(getRuleLabel(callForIncidentsRule(), english)).toBe(
      "Call for incidents (Critical Incident and Major Incident)",
    );
    expect(getRuleSentence(callForIncidentsRule(), english)).toBe(
      "Every member has an incident on-call rule that notifies them by Call for Critical Incident and Major Incident.",
    );
    expect(getRuleSentence(callAndPushForIncidentsRule(), english)).toBe(
      getRuleSentence(callAndPushForIncidentsRule()),
    );
    expect(getRuleLabel(noSeveritiesLeftRule(), english)).toBe(
      getRuleLabel(noSeveritiesLeftRule()),
    );
    expect(getRuleLabel(callForEveryIncidentRule(), english)).toBe(
      "Call for incidents (all incident severities)",
    );
  });

  test("the verdict, and why nothing is checked", () => {
    const verdict: ReturnType<typeof getComplianceVerdict> =
      getComplianceVerdict(summary({}), english);

    expect(verdict.headline).toBe("1 of 3 members meet every rule");
    expect(verdict.badgeText).toBe("2 need attention");

    expect(
      getNoActiveRulesAdvice(
        summary({
          activeRuleCount: 0,
          resumableRuleCount: 2,
          unrecognisedRuleCount: 1,
          ruleCount: 3,
        }),
        english,
      ),
    ).toBe(
      "2 rules are paused and 1 rule is of a type this version does not recognise. Turn a paused rule on, or replace the unrecognised one.",
    );
    expect(getInvitedNote(1, english)).toBe(
      "1 person invited to this team is not checked until they accept their invitation.",
    );
  });
});

describe("the page's sentences in every Dashboard language", () => {
  const rules: ReadonlyArray<TeamComplianceRuleJSON> = [
    emailRule(),
    callForIncidentsRule(),
    callAndPushForIncidentsRule(),
    callForEveryIncidentRule(),
    alertRule(),
    noSeveritiesLeftRule(),
  ];

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every rule's title, name and sentence its own way",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const rule of rules) {
        expect({
          rule: rule.settingId,
          sentence: getRuleSentence(rule, translator),
        }).not.toEqual({
          rule: rule.settingId,
          sentence: getRuleSentence(rule, english),
        });
        expect(getRuleLabel(rule, translator)).not.toBe(
          getRuleLabel(rule, english),
        );
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every verdict, its badge and what to do next",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const cases: ReadonlyArray<Partial<ComplianceSummary>> = [
        { ruleCount: 0, activeRuleCount: 0 },
        { activeRuleCount: 0, resumableRuleCount: 2 },
        { activeRuleCount: 0, ruleCount: 1, resumableRuleCount: 1 },
        {
          activeRuleCount: 0,
          resumableRuleCount: 1,
          noSeveritiesLeftRuleCount: 1,
        },
        { memberCount: 0, compliantCount: 0, attentionCount: 0 },
        { memberCount: 0, invitedCount: 2 },
        { compliantCount: 3, attentionCount: 0 },
        { memberCount: 1, compliantCount: 1, attentionCount: 0 },
        { compliantCount: 0, attentionCount: 3 },
        {},
      ];

      for (const overrides of cases) {
        const ours: ReturnType<typeof getComplianceVerdict> =
          getComplianceVerdict(summary(overrides), translator);
        const theirs: ReturnType<typeof getComplianceVerdict> =
          getComplianceVerdict(summary(overrides), english);

        expect({ overrides, headline: ours.headline }).not.toEqual({
          overrides,
          headline: theirs.headline,
        });
        expect({ overrides, badge: ours.badgeText }).not.toEqual({
          overrides,
          badge: theirs.badgeText,
        });

        if (theirs.detail) {
          expect({ overrides, detail: ours.detail }).not.toEqual({
            overrides,
            detail: theirs.detail,
          });
        }
      }

      expect(
        getRulePassRateText(
          { passing: 2, failing: 1, total: 3, passingPercent: 67 },
          translator,
        ).text,
      ).not.toBe("2 of 3 members meet it");
      expect(getInvitedNote(3, translator)).not.toBe(
        getInvitedNote(3, english),
      );
      expect(getChannelLabel(undefined, translator)).not.toBe("Any channel");
    },
  );
});

describe("German, word for word", () => {
  test("a rule's severity reads by its list: a new project's default in German, a project's own as written", () => {
    expect(getRuleLabel(callForIncidentsRule(), german)).toBe(
      "Anruf für Vorfälle (Kritischer Vorfall und Schwerwiegender Vorfall)",
    );
    expect(
      getRuleSentence(
        callForIncidentsRule({
          severities: [{ id: "s1", name: "Sev 1" }],
        }),
        german,
      ),
    ).toBe(
      "Jedes Mitglied hat eine Bereitschaftsregel für Vorfälle, die es per Anruf benachrichtigt, für Sev 1.",
    );
  });

  test("the verdict and a pass rate take German's own forms", () => {
    expect(getComplianceVerdict(summary({}), german).headline).toBe(
      "1 von 3 Mitgliedern erfüllen jede Regel",
    );
    expect(
      getRulePassRateText(
        { passing: 1, failing: 0, total: 1, passingPercent: 100 },
        german,
      ),
    ).toEqual({
      text: "1 von 1 Mitglied erfüllt sie",
      label: "1 von 1 Mitglied erfüllt diese Regel",
    });
  });
});

describe("the hero", () => {
  test.each(LANGUAGES)(
    "%s: the verdict, the subline and the facts read in the reader's words",
    (language: string) => {
      drawIn(
        language,
        <ComplianceHero
          status={standardStatus()}
          isRefreshing={false}
          refreshError=""
          onRefresh={() => {}}
          memberFilter={MemberStatusFilter.All}
          onShowMembers={() => {}}
        />,
      );

      const translator: Translator = dashboardTranslator(language);
      const verdict: ReturnType<typeof getComplianceVerdict> =
        getComplianceVerdict(
          summary({
            memberCount: 3,
            compliantCount: 1,
            attentionCount: 2,
          }),
          translator,
        );

      expect(screen.getByTestId("compliance-hero-headline")).toHaveTextContent(
        verdict.headline,
      );
      expect(screen.getByTestId("compliance-hero-badge")).toHaveTextContent(
        verdict.badgeText,
      );

      for (const label of [
        "Members",
        "Compliant",
        "Need attention",
        "Active rules",
      ]) {
        expect(screen.getAllByText(wordIn(language, label)).length).toBe(1);
      }

      const subline: string =
        screen.getByTestId("compliance-hero-subline").textContent || "";

      if (TRANSLATED.includes(language)) {
        expect(subline).not.toContain("Checked against");
        expect(subline).not.toContain("checked");
        expect(
          screen.getByTestId("compliance-hero").textContent || "",
        ).not.toMatch(/members|compliant|attention/);
      } else {
        expect(subline).toMatch(/^Checked against 2 active rules · checked /);
      }
    },
  );

  test("a translated badge is drawn as given, never looked up a second time", () => {
    drawIn(
      "de",
      <ComplianceHero
        status={standardStatus()}
        isRefreshing={false}
        refreshError=""
        onRefresh={() => {}}
        memberFilter={MemberStatusFilter.All}
        onShowMembers={() => {}}
      />,
    );

    expect(screen.getByTestId("compliance-hero-badge")).toHaveTextContent(
      "2 erfordern Aufmerksamkeit",
    );
  });
});

describe("the rules card", () => {
  const drawCard: (language: string) => void = (language: string): void => {
    drawIn(
      language,
      <ComplianceRulesCard
        rules={[
          emailRule({ compliantCount: 2, nonCompliantCount: 1 }),
          callForIncidentsRule({ compliantCount: 1, nonCompliantCount: 2 }),
          alertRule(),
        ]}
        access={EDITOR}
        teamId={TEAM_ID}
        projectId={PROJECT_ID}
        failingRuleId={null}
        onShowFailing={() => {}}
        onChanged={() => {
          return Promise.resolve(true);
        }}
      />,
    );
  };

  test.each(LANGUAGES)(
    "%s: a rule's title, sentence, chips and pass rate",
    (language: string) => {
      drawCard(language);

      const translator: Translator = dashboardTranslator(language);

      expect(
        screen.getByText(getRuleTitle(callForIncidentsRule(), translator)),
      ).toBeInTheDocument();
      expect(
        screen.getByText(getRuleSentence(callForIncidentsRule(), translator)),
      ).toBeInTheDocument();
      // The severity chip reads by its list (#8296).
      expect(
        screen.getAllByText(wordIn(language, "Critical Incident")).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(
          getRulePassRateText(
            { passing: 1, failing: 2, total: 3, passingPercent: 33 },
            translator,
          ).text,
        ).length,
      ).toBe(1);

      if (TRANSLATED.includes(language)) {
        expect(screen.queryByText("Critical Incident")).toBeNull();
        expect(screen.queryByText(/meet it|who fail/)).toBeNull();
      }
    },
  );

  test("the edit and delete buttons say which rule, in the reader's words", () => {
    drawCard("de");

    expect(
      screen.getByRole("button", {
        name: "Anruf für Vorfälle (Kritischer Vorfall und Schwerwiegender Vorfall) bearbeiten",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Anruf für Vorfälle (Kritischer Vorfall und Schwerwiegender Vorfall) löschen",
      }),
    ).toBeInTheDocument();
  });

  test.each(LANGUAGES)(
    "%s: an empty card and its recommended rules",
    (language: string) => {
      drawIn(
        language,
        <ComplianceRulesCard
          rules={[]}
          access={EDITOR}
          teamId={TEAM_ID}
          projectId={PROJECT_ID}
          failingRuleId={null}
          onShowFailing={() => {}}
          onChanged={() => {
            return Promise.resolve(true);
          }}
        />,
      );

      for (const text of [
        "No compliance rules yet",
        "Recommended rules",
        "Call for critical incidents",
        "Push for critical alerts",
      ]) {
        expect(screen.getByText(wordIn(language, text))).toBeInTheDocument();
      }
    },
  );
});

describe("the members section", () => {
  test.each(LANGUAGES)(
    "%s: its filters, count, legend and each member's chip",
    (language: string) => {
      drawIn(
        language,
        <TeamComplianceStatusTable
          status={standardStatus()}
          statusFilter={MemberStatusFilter.All}
          onStatusFilterChange={() => {}}
          failingRuleId={null}
          onClearFailingRule={() => {}}
          canViewMemberSetup={true}
          currentUserId=""
        />,
      );

      for (const text of [
        "Needs attention",
        "meets a rule",
        "fails it",
        "Members",
      ]) {
        expect(
          screen.getAllByText(wordIn(language, text)).length,
        ).toBeGreaterThan(0);
      }

      expect(screen.getByTestId("compliance-members-count")).toHaveTextContent(
        dashboardTranslator(language).translatePlural(
          {
            one: "{{count}} member, worst first",
            other: "{{count}} members, worst first",
          },
          3,
        ),
      );

      // Why a member fails a rule is the server's own sentence, as it came.
      expect(screen.getAllByText(CALL_REASON).length).toBe(2);

      if (TRANSLATED.includes(language)) {
        expect(screen.queryByText(/worst first|on-call setup/)).toBeNull();
      }
    },
  );

  test("the link to another member's setup names them in a German sentence", () => {
    drawIn(
      "de",
      <TeamComplianceStatusTable
        status={standardStatus()}
        statusFilter={MemberStatusFilter.All}
        onStatusFilterChange={() => {}}
        failingRuleId={null}
        onClearFailingRule={() => {}}
        canViewMemberSetup={true}
        currentUserId=""
      />,
    );

    expect(
      screen.getAllByTestId("compliance-member-fix-link")[0],
    ).toHaveTextContent(/^Bereitschaftseinrichtung von (Omar|Jane) öffnen$/);
  });

  test.each(LANGUAGES)(
    "%s: a team whose every rule is paused says so whole",
    (language: string) => {
      const status: TeamComplianceStatusJSON = buildStatus({
        complianceSettings: [emailRule({ enabled: false })],
        userComplianceStatuses: [buildMember({})],
      });

      drawIn(
        language,
        <TeamComplianceStatusTable
          status={status}
          statusFilter={MemberStatusFilter.All}
          onStatusFilterChange={() => {}}
          failingRuleId={null}
          onClearFailingRule={() => {}}
          canViewMemberSetup={false}
          currentUserId=""
        />,
      );

      const text: string =
        screen.getByTestId("compliance-members-no-active-rules").textContent ||
        "";

      if (language === "en") {
        expect(text).toBe(
          "Every rule on this team is paused, so none of its 1 member is being checked. Turn a rule back on to see who meets it.",
        );
      } else {
        expect(text).not.toMatch(/paused|checked|member/);
      }
    },
  );
});

describe("the rule warnings", () => {
  test.each(LANGUAGES)(
    "%s: the banner's title counts the rules in the reader's words",
    (language: string) => {
      drawIn(
        language,
        <ComplianceRuleWarnings
          rules={[
            callForIncidentsRule({ warnings: ["Call notifications are off."] }),
          ]}
        />,
      );

      const banner: HTMLElement = screen.getByTestId(
        "compliance-rule-warnings",
      );

      expect(banner).toHaveTextContent(
        dashboardTranslator(language).translatePlural(
          {
            one: "{{count}} rule has a problem members cannot fix",
            other: "{{count}} rules have problems members cannot fix",
          },
          1,
        ),
      );
      // The server's warning, as it came.
      expect(banner).toHaveTextContent("Call notifications are off.");
      expect(
        within(banner).getByTestId("compliance-rule-warnings-settings-link"),
      ).toHaveTextContent(wordIn(language, "Open notification settings"));
    },
  );
});

/*
 * What the server found, in the reader's words (#8632): a rule's warnings
 * and why a member fails one came only as the server's English sentences.
 * The server sends what it found as data beside them now, and the page
 * words it; from a server that sends none, the English is drawn as before.
 */
describe("what the server found about a rule and a member", () => {
  const CALL_OFF: TeamComplianceWarningJSON = {
    kind: TeamComplianceWarningKind.ChannelsSwitchedOff,
    channels: [ComplianceNotificationChannel.Call],
  };
  const CALL_OFF_ENGLISH: string = getComplianceWarningText(CALL_OFF);

  const warnedRule: () => TeamComplianceRuleJSON =
    (): TeamComplianceRuleJSON => {
      return callForIncidentsRule({
        warnings: [CALL_OFF_ENGLISH],
        warningDetails: [CALL_OFF],
      });
    };

  // Grace has no Call rule for the Critical Incident severity, and opted out of Major.
  const failingIssue: (
    rule: TeamComplianceRuleJSON,
  ) => TeamComplianceIssueJSON = (
    rule: TeamComplianceRuleJSON,
  ): TeamComplianceIssueJSON => {
    return {
      ...issue(
        rule,
        `${CALL_REASON}. Opted out of incident notifications for: Sev-0 (pager only)`,
      ),
      findings: [
        {
          kind: TeamComplianceFindingKind.NoChannelRule,
          channel: ComplianceNotificationChannel.Call,
          severities: [{ id: "critical", name: "Critical Incident" }],
        },
        {
          kind: TeamComplianceFindingKind.OptedOut,
          severities: [{ id: "pager", name: "Sev-0 (pager only)" }],
        },
      ],
    };
  };

  const statusWith: (
    rule: TeamComplianceRuleJSON,
  ) => TeamComplianceStatusJSON = (
    rule: TeamComplianceRuleJSON,
  ): TeamComplianceStatusJSON => {
    return buildStatus({
      complianceSettings: [rule],
      userComplianceStatuses: [
        buildMember({
          userId: "grace",
          userName: "Grace Hopper",
          userEmail: "grace@acme.com",
          nonCompliantRules: [failingIssue(rule)],
        }),
      ],
    });
  };

  test("English reads as the server wrote it, word for word", () => {
    const rule: TeamComplianceRuleJSON = warnedRule();

    expect(getRuleWarningTexts(rule, english)).toEqual([CALL_OFF_ENGLISH]);
    expect(getIssueReasonText(failingIssue(rule), rule, english)).toBe(
      failingIssue(rule).reason,
    );
  });

  test.each(LANGUAGES)(
    "%s: the warnings banner says what is wrong in the reader's words",
    (language: string) => {
      drawIn(language, <ComplianceRuleWarnings rules={[warnedRule()]} />);

      const banner: HTMLElement = screen.getByTestId(
        "compliance-rule-warnings",
      );
      const worded: string = getComplianceWarningText(
        CALL_OFF,
        dashboardTranslator(language),
      );

      expect(banner).toHaveTextContent(worded);

      if (TRANSLATED.includes(language)) {
        expect(worded).not.toBe(CALL_OFF_ENGLISH);
        expect(banner.textContent).not.toContain("switched off");
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: a rule's warning chip says it in the reader's words, to a screen reader too",
    (language: string) => {
      drawIn(
        language,
        <ComplianceRulesCard
          rules={[warnedRule()]}
          access={EDITOR}
          teamId={TEAM_ID}
          projectId={PROJECT_ID}
          failingRuleId={null}
          onShowFailing={() => {}}
          onChanged={() => {
            return Promise.resolve(true);
          }}
        />,
      );

      const translator: Translator = dashboardTranslator(language);
      const chip: HTMLElement = screen.getByTestId(
        "compliance-rule-warning-chip",
      );

      expect(chip).toHaveAttribute(
        "aria-label",
        translator.translateTemplate("Warning: {{warnings}}", {
          warnings: getComplianceWarningText(CALL_OFF, translator),
        }),
      );

      if (TRANSLATED.includes(language)) {
        expect(chip.getAttribute("aria-label")).not.toContain("switched off");
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: why a member fails a rule reads in the reader's words, a project's own severity as written",
    (language: string) => {
      const rule: TeamComplianceRuleJSON = warnedRule();

      drawIn(
        language,
        <TeamComplianceStatusTable
          status={statusWith(rule)}
          statusFilter={MemberStatusFilter.All}
          onStatusFilterChange={() => {}}
          failingRuleId={null}
          onClearFailingRule={() => {}}
          canViewMemberSetup={true}
          currentUserId=""
        />,
      );

      const issues: HTMLElement = screen.getByTestId(
        "compliance-member-issues",
      );
      const reason: string = getIssueReasonText(
        failingIssue(rule),
        rule,
        dashboardTranslator(language),
      );

      expect(issues).toHaveTextContent(reason);
      expect(issues).toHaveTextContent("Sev-0 (pager only)");

      if (TRANSLATED.includes(language)) {
        // Neither the server's sentence nor the default severity's English name.
        expect(issues.textContent).not.toContain("No Call rule");
        expect(issues.textContent).not.toContain("Critical Incident");
        expect(issues.textContent).not.toContain("Opted out");
      }
    },
  );

  test("from a server that sends no findings, the reason is its English, as it came", () => {
    const rule: TeamComplianceRuleJSON = callForIncidentsRule({
      warnings: ["Call notifications are off."],
    });

    expect(getRuleWarningTexts(rule, german)).toEqual([
      "Call notifications are off.",
    ]);
    expect(getIssueReasonText(issue(rule, CALL_REASON), rule, german)).toBe(
      CALL_REASON,
    );
  });

  test("details that do not match the warnings one for one are not trusted: the English is drawn", () => {
    const rule: TeamComplianceRuleJSON = callForIncidentsRule({
      warnings: [CALL_OFF_ENGLISH, "Something else the server said."],
      warningDetails: [CALL_OFF],
    });

    expect(getRuleWarningTexts(rule, german)).toEqual(rule.warnings);
  });
});

describe("the rule form's preview", () => {
  test.each(LANGUAGES)(
    "%s: what members pass the rule by, and the project switch it needs",
    (language: string) => {
      drawIn(
        language,
        <ComplianceRulePreview
          values={{
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannels: [ComplianceNotificationChannel.Call],
            incidentSeverities: ["a", "b"],
            enabled: false,
          }}
        />,
      );

      const preview: HTMLElement = screen.getByTestId(
        "compliance-rule-preview",
      );

      expect(preview).toHaveTextContent(
        wordIn(language, "Members pass this rule when"),
      );
      expect(
        screen.getByTestId("compliance-rule-preview-title"),
      ).toHaveTextContent(
        getRuleTitle(callForIncidentsRule(), dashboardTranslator(language)),
      );

      if (TRANSLATED.includes(language)) {
        expect(preview.textContent || "").not.toMatch(
          /severities you selected|switched on|saved paused/,
        );
      } else {
        expect(
          screen.getByTestId("compliance-rule-preview-sentence"),
        ).toHaveTextContent(
          "Every member has an incident on-call rule that notifies them by Call for the 2 severities you selected.",
        );
      }
    },
  );

  test("German words a rule on one severity, and the saved-paused note", () => {
    drawIn(
      "de",
      <ComplianceRulePreview
        values={{
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannels: [],
          incidentSeverities: ["a"],
          enabled: false,
        }}
      />,
    );

    expect(
      screen.getByTestId("compliance-rule-preview-sentence"),
    ).toHaveTextContent(
      "Jedes Mitglied hat eine Bereitschaftsregel für Vorfälle für den gewählten Schweregrad.",
    );
    expect(
      screen.getByText(
        "Diese Regel wird pausiert gespeichert: Sie ist aufgeführt, aber niemand wird anhand ihrer geprüft, bis Sie sie aktivieren.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the recommended rules", () => {
  test.each(LANGUAGES)("%s: their heading and lines", (language: string) => {
    drawIn(language, <ComplianceRulePresets onChoose={() => {}} />);

    expect(
      screen.getByText(
        wordIn(
          language,
          "Start from one of these. Nothing is saved until you review it and press Add rule.",
        ),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(wordIn(language, "Verified phone for calls")),
    ).toBeInTheDocument();
  });
});
