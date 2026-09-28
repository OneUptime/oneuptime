import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";

/*
 * The members section of Teams > Compliance, rendered on its own from a
 * status payload: who is listed and in what order, the per-rule squares and
 * reasons, the filters and search, paging, and the way each member is sent
 * to the page that fixes them - which depends on who is looking.
 */

/*
 * UserElement imports "Common/UI/Images/users/blank-profile.svg". ee's ui jest
 * project maps "Common/..." before Common's asset mapper, so the SVG would be
 * parsed as JavaScript; stub it the way Common's own suites do.
 */
jest.mock("Common/UI/Images/users/blank-profile.svg", () => {
  return "data:image/svg+xml;base64,////YXZhdGFy";
});

import TeamComplianceStatusTable, {
  MEMBER_PAGE_SIZE,
} from "../../../Dashboard/TeamCompliance/TeamComplianceStatusTable";
import { MemberStatusFilter } from "../../../Dashboard/TeamCompliance/ComplianceView";
import {
  CALL_REASON,
  CALL_RULE_ID,
  EMAIL_REASON,
  EMAIL_RULE_ID,
  JANE_ID,
  OMAR_ID,
  PRIYA_ID,
  PROJECT_ID,
  alertRule,
  buildMember,
  buildRule,
  buildStatus,
  callForIncidentsRule,
  emailRule,
  issue,
  standardStatus,
} from "./ComplianceFixtures";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import {
  TeamComplianceRuleJSON,
  TeamComplianceStatusJSON,
  TeamMemberComplianceJSON,
} from "Common/Types/Team/TeamComplianceStatus";
import ProjectUtil from "Common/UI/Utils/Project";

interface HarnessProps {
  status: TeamComplianceStatusJSON;
  initialFilter?: MemberStatusFilter | undefined;
  initialFailingRuleId?: string | null | undefined;
  canViewMemberSetup?: boolean | undefined;
  currentUserId?: string | undefined;
  onStatusFilterChange?: ((filter: MemberStatusFilter) => void) | undefined;
  onClearFailingRule?: (() => void) | undefined;
}

// The page owns the filters; this harness owns them the same way.
const Harness: (props: HarnessProps) => ReactElement = (
  props: HarnessProps,
): ReactElement => {
  const [filter, setFilter] = useState<MemberStatusFilter>(
    props.initialFilter || MemberStatusFilter.All,
  );
  const [failingRuleId, setFailingRuleId] = useState<string | null>(
    props.initialFailingRuleId || null,
  );

  return (
    <TeamComplianceStatusTable
      status={props.status}
      statusFilter={filter}
      onStatusFilterChange={(next: MemberStatusFilter) => {
        props.onStatusFilterChange?.(next);
        setFilter(next);
      }}
      failingRuleId={failingRuleId}
      onClearFailingRule={() => {
        props.onClearFailingRule?.();
        setFailingRuleId(null);
      }}
      canViewMemberSetup={props.canViewMemberSetup || false}
      currentUserId={props.currentUserId || ""}
    />
  );
};

const listedNames: () => Array<string> = (): Array<string> => {
  const list: HTMLElement = screen.getByTestId("compliance-members-list");

  return Array.from(list.children).map((row: Element): string => {
    return row.querySelector("img")?.getAttribute("alt") || "";
  });
};

const row: (userId: string) => HTMLElement = (userId: string): HTMLElement => {
  return screen.getByTestId(`compliance-member-${userId}`);
};

const manyMembers: (count: number) => Array<TeamMemberComplianceJSON> = (
  count: number,
): Array<TeamMemberComplianceJSON> => {
  const members: Array<TeamMemberComplianceJSON> = [];

  for (let index: number = 0; index < count; index++) {
    const suffix: string = String(index).padStart(12, "0");

    members.push(
      buildMember({
        userId: `10000000-0000-4000-8000-${suffix}`,
        userName: `Member ${String(index).padStart(3, "0")}`,
        userEmail: `member${index}@acme.com`,
      }),
    );
  }

  return members;
};

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("who is listed", () => {
  test("worst first: most failed rules, then the rest, then everyone compliant", () => {
    render(<Harness status={standardStatus()} />);

    expect(listedNames()).toEqual(["Jane Doe", "Omar Haddad", "Priya Patel"]);
    expect(screen.getByTestId("compliance-members-count")).toHaveTextContent(
      "3 members, worst first",
    );
  });

  test("shows the member's email beside their name", () => {
    render(<Harness status={standardStatus()} />);

    expect(within(row(JANE_ID)).getByTestId("user-email")).toHaveTextContent(
      "jane@acme.com",
    );
  });

  /*
   * The row is hand-built from the compliance payload. Without the id the
   * avatar route cannot be built and every member falls back to the blank
   * picture, which reads as "nobody has a photo" rather than as a bug.
   */
  test("builds the avatar from the member's own id", () => {
    render(<Harness status={standardStatus()} />);

    expect(
      within(row(JANE_ID)).getByRole("img", { name: "Jane Doe" }),
    ).toHaveAttribute("src", `/api/user/profile-picture/${JANE_ID}`);
  });

  test("status chips", () => {
    render(<Harness status={standardStatus()} />);

    expect(
      within(row(JANE_ID)).getByTestId("compliance-member-status"),
    ).toHaveTextContent("Needs attention");
    expect(
      within(row(PRIYA_ID)).getByTestId("compliance-member-status"),
    ).toHaveTextContent("Compliant");
  });

  test("the section says whose team it is", () => {
    render(<Harness status={standardStatus()} />);

    expect(screen.getByTestId("compliance-members")).toHaveTextContent(
      "How everyone on Platform On-Call measures up",
    );
  });
});

describe("per-rule results", () => {
  test("one square per active rule, in rule order, saying why it fails", () => {
    render(<Harness status={standardStatus()} />);

    const email: HTMLElement = within(row(JANE_ID)).getByTestId(
      `compliance-member-rule-${EMAIL_RULE_ID}`,
    );
    const call: HTMLElement = within(row(OMAR_ID)).getByTestId(
      `compliance-member-rule-${CALL_RULE_ID}`,
    );
    const omarEmail: HTMLElement = within(row(OMAR_ID)).getByTestId(
      `compliance-member-rule-${EMAIL_RULE_ID}`,
    );

    expect(email).toHaveAttribute("data-result", "fail");
    expect(email).toHaveAttribute(
      "aria-label",
      `Verified email: not met. ${EMAIL_REASON}`,
    );
    expect(call).toHaveAttribute("data-result", "fail");
    // Named with its scope, so two Call rules for different severities differ.
    expect(call).toHaveAttribute(
      "aria-label",
      `Call for incidents (Critical Incident and Major Incident): not met. ${CALL_REASON}`,
    );
    expect(omarEmail).toHaveAttribute("data-result", "pass");
    expect(omarEmail).toHaveAttribute("aria-label", "Verified email: met");

    const squares: Array<string> = within(
      within(row(JANE_ID)).getByTestId("compliance-member-rule-results"),
    )
      .getAllByRole("img")
      .map((square: HTMLElement): string => {
        return square.getAttribute("data-testid") || "";
      });

    expect(squares).toEqual([
      `compliance-member-rule-${EMAIL_RULE_ID}`,
      `compliance-member-rule-${CALL_RULE_ID}`,
    ]);
  });

  /*
   * One tab stop per member, not one per square: 25 members and 6 rules made
   * 150 presses of Tab before "Show more". The arrows, Home and End move
   * between a member's squares, and each still opens its tooltip on focus -
   * the only place a passing square names its rule.
   */
  test("a member's squares are one tab stop; the arrow keys move between them", () => {
    const status: TeamComplianceStatusJSON = standardStatus();
    status.complianceSettings.push(alertRule({ compliantCount: 3 }));

    render(<Harness status={status} />);

    const squares: Array<HTMLElement> = within(
      within(row(JANE_ID)).getByTestId("compliance-member-rule-results"),
    ).getAllByRole("img");

    expect(squares).toHaveLength(3);
    expect(
      squares.map((square: HTMLElement): string | null => {
        return square.getAttribute("tabindex");
      }),
    ).toEqual(["0", "-1", "-1"]);

    // Across the whole list: one stop per member.
    expect(
      screen
        .getAllByTestId("compliance-member-rule-results")
        .map((results: HTMLElement): number => {
          return results.querySelectorAll("[tabindex='0']").length;
        }),
    ).toEqual([1, 1, 1]);

    act(() => {
      squares[0]!.focus();
    });
    fireEvent.keyDown(squares[0]!, { key: "ArrowRight" });

    expect(squares[1]).toHaveFocus();
    expect(squares[1]).toHaveAttribute("tabindex", "0");
    expect(squares[0]).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(squares[1]!, { key: "End" });
    expect(squares[2]).toHaveFocus();

    // Clamped at the end, not wrapped.
    fireEvent.keyDown(squares[2]!, { key: "ArrowRight" });
    expect(squares[2]).toHaveFocus();

    fireEvent.keyDown(squares[2]!, { key: "Home" });
    expect(squares[0]).toHaveFocus();

    fireEvent.keyDown(squares[0]!, { key: "ArrowLeft" });
    expect(squares[0]).toHaveFocus();

    // Tab is left to the browser.
    const tab: boolean = fireEvent.keyDown(squares[0]!, { key: "Tab" });
    expect(tab).toBe(true);

    // Each row keeps its own stop.
    expect(
      within(row(OMAR_ID)).getByTestId(
        `compliance-member-rule-${EMAIL_RULE_ID}`,
      ),
    ).toHaveAttribute("tabindex", "0");
  });

  test("a square reached by the arrow keys opens its tooltip", async () => {
    jest.useFakeTimers();

    try {
      render(<Harness status={standardStatus()} />);

      const squares: Array<HTMLElement> = within(
        within(row(OMAR_ID)).getByTestId("compliance-member-rule-results"),
      ).getAllByRole("img");

      act(() => {
        squares[0]!.focus();
      });
      fireEvent.keyDown(squares[0]!, { key: "ArrowRight" });

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(squares[1]).toHaveFocus();
      expect(screen.getByText(CALL_REASON, { selector: "p" })).toBeVisible();
    } finally {
      jest.useRealTimers();
    }
  });

  test("a legend says what the squares mean, once", () => {
    render(<Harness status={standardStatus()} />);

    const legend: HTMLElement = screen.getByTestId("compliance-members-legend");

    expect(legend).toHaveTextContent("meets a rulefails it");
    // Every square is labelled itself, so the legend stays out of the way.
    expect(legend).toHaveAttribute("aria-hidden", "true");
  });

  test("the tally beside the squares", () => {
    render(<Harness status={standardStatus()} />);

    expect(row(JANE_ID)).toHaveTextContent("0 of 2");
    expect(row(OMAR_ID)).toHaveTextContent("1 of 2");
    expect(row(PRIYA_ID)).toHaveTextContent("2 of 2");
  });

  test("paused and unrecognised rules get no square", () => {
    const status: TeamComplianceStatusJSON = standardStatus();
    status.complianceSettings.push(
      alertRule({ enabled: false }),
      buildRule({
        settingId: "unknown-rule",
        ruleType: "HasCarrierPigeon" as ComplianceRuleType,
      }),
    );

    render(<Harness status={status} />);

    expect(
      within(row(PRIYA_ID)).getAllByRole("img", { name: /: met/ }),
    ).toHaveLength(2);
    expect(
      screen.queryByTestId("compliance-member-rule-unknown-rule"),
    ).not.toBeInTheDocument();
  });

  test("each failure is listed as 'rule: reason'", () => {
    render(<Harness status={standardStatus()} />);

    const issues: HTMLElement = within(row(JANE_ID)).getByTestId(
      "compliance-member-issues",
    );

    expect(within(issues).getAllByRole("listitem")).toHaveLength(2);
    expect(issues).toHaveTextContent(`Verified email: ${EMAIL_REASON}`);
    expect(issues).toHaveTextContent(`Call for incidents: ${CALL_REASON}`);
    expect(
      within(row(PRIYA_ID)).queryByTestId("compliance-member-issues"),
    ).not.toBeInTheDocument();
  });

  test("an issue for a rule not in the list is titled from the catalog", () => {
    const status: TeamComplianceStatusJSON = buildStatus({
      complianceSettings: [emailRule()],
      userComplianceStatuses: [
        buildMember({
          nonCompliantRules: [
            {
              settingId: "gone",
              ruleType: ComplianceRuleType.HasNotificationPushMethod,
              reason: "No verified push notification device configured",
            },
          ],
        }),
      ],
    });

    render(<Harness status={status} />);

    expect(
      within(row(JANE_ID)).getByTestId("compliance-member-issues"),
    ).toHaveTextContent(
      "Verified push device: No verified push notification device configured",
    );
  });
});

describe("filters and search", () => {
  test("the status filter shows its counts and narrows the list", () => {
    const onStatusFilterChange: jest.Mock = jest.fn();

    render(
      <Harness
        status={standardStatus()}
        onStatusFilterChange={onStatusFilterChange}
      />,
    );

    const needsAttention: HTMLElement = screen.getByRole("radio", {
      name: /Needs attention/,
    });

    expect(needsAttention).toHaveTextContent("Needs attention2");
    expect(screen.getByRole("radio", { name: /Compliant/ })).toHaveTextContent(
      "Compliant1",
    );
    expect(screen.getByRole("radio", { name: /All/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(needsAttention);

    expect(onStatusFilterChange).toHaveBeenCalledWith(
      MemberStatusFilter.NeedsAttention,
    );
    expect(listedNames()).toEqual(["Jane Doe", "Omar Haddad"]);
    expect(screen.getByTestId("compliance-members-count")).toHaveTextContent(
      "2 of 3 members",
    );

    fireEvent.click(screen.getByRole("radio", { name: /Compliant/ }));

    expect(listedNames()).toEqual(["Priya Patel"]);
  });

  test("a filter chosen elsewhere on the page is honoured", () => {
    render(
      <Harness
        status={standardStatus()}
        initialFilter={MemberStatusFilter.Compliant}
      />,
    );

    expect(listedNames()).toEqual(["Priya Patel"]);
    expect(screen.getByRole("radio", { name: /Compliant/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("search by name or email", () => {
    render(<Harness status={standardStatus()} />);

    const search: HTMLElement = screen.getByRole("searchbox", {
      name: "Search members by name or email",
    });

    fireEvent.change(search, { target: { value: "OMAR" } });
    expect(listedNames()).toEqual(["Omar Haddad"]);

    fireEvent.change(search, { target: { value: "priya@" } });
    expect(listedNames()).toEqual(["Priya Patel"]);
  });

  test("nobody matching says so, and clears every filter", () => {
    const onClearFailingRule: jest.Mock = jest.fn();

    render(
      <Harness
        status={standardStatus()}
        initialFilter={MemberStatusFilter.Compliant}
        initialFailingRuleId={CALL_RULE_ID}
        onClearFailingRule={onClearFailingRule}
      />,
    );

    expect(screen.getByTestId("compliance-members-no-match")).toHaveTextContent(
      "No members match these filters.",
    );
    expect(
      screen.queryByTestId("compliance-members-list"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("compliance-members-clear-filters"));

    expect(onClearFailingRule).toHaveBeenCalledTimes(1);
    expect(listedNames()).toEqual(["Jane Doe", "Omar Haddad", "Priya Patel"]);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  test("a rule filter from the rules card narrows to who fails it", () => {
    render(
      <Harness
        status={standardStatus()}
        initialFailingRuleId={EMAIL_RULE_ID}
      />,
    );

    expect(listedNames()).toEqual(["Jane Doe"]);
    expect(
      screen.getByTestId("compliance-members-rule-filter"),
    ).toHaveTextContent("FailingVerified email");

    // The filtered rule's square is picked out in every row.
    expect(
      within(row(JANE_ID)).getByTestId(
        `compliance-member-rule-${EMAIL_RULE_ID}`,
      ).className,
    ).toContain("outline-indigo-500");
    expect(
      within(row(JANE_ID)).getByTestId(`compliance-member-rule-${CALL_RULE_ID}`)
        .className,
    ).not.toContain("outline-indigo-500");

    fireEvent.click(
      screen.getByRole("button", { name: "Clear the rule filter" }),
    );

    expect(
      screen.queryByTestId("compliance-members-rule-filter"),
    ).not.toBeInTheDocument();
    expect(listedNames()).toHaveLength(3);
  });

  test("the rule filter's chip names the rule with its scope", () => {
    render(
      <Harness status={standardStatus()} initialFailingRuleId={CALL_RULE_ID} />,
    );

    expect(
      screen.getByTestId("compliance-members-rule-filter"),
    ).toHaveTextContent(
      "FailingCall for incidents (Critical Incident and Major Incident)",
    );
  });

  /*
   * Two rules of one type and channel, scoped to different severities: the
   * same title, so every place that names one of them on its own needs the
   * scope to tell them apart.
   */
  test("two Call rules for different severities get different names", () => {
    const critical: TeamComplianceRuleJSON = callForIncidentsRule({
      settingId: "call-critical",
      severities: [{ id: "c", name: "Critical Incident" }],
      compliantCount: 0,
      nonCompliantCount: 1,
    });
    const major: TeamComplianceRuleJSON = callForIncidentsRule({
      settingId: "call-major",
      notificationChannel: ComplianceNotificationChannel.Call,
      severities: [{ id: "m", name: "Major Incident" }],
      compliantCount: 1,
      nonCompliantCount: 0,
    });

    render(
      <Harness
        status={buildStatus({
          complianceSettings: [critical, major],
          userComplianceStatuses: [
            buildMember({
              nonCompliantRules: [issue(critical, "No Call rule for Critical")],
            }),
          ],
        })}
        initialFailingRuleId="call-critical"
      />,
    );

    expect(
      within(row(JANE_ID)).getByTestId("compliance-member-rule-call-critical"),
    ).toHaveAttribute(
      "aria-label",
      "Call for incidents (Critical Incident): not met. No Call rule for Critical",
    );
    expect(
      within(row(JANE_ID)).getByTestId("compliance-member-rule-call-major"),
    ).toHaveAttribute("aria-label", "Call for incidents (Major Incident): met");
    expect(
      screen.getByTestId("compliance-members-rule-filter"),
    ).toHaveTextContent("FailingCall for incidents (Critical Incident)");
    expect(
      screen.getByTestId("compliance-members-rule-filter"),
    ).not.toHaveTextContent("Major");
  });

  test("a rule filter for a rule that is not listed shows no chip", () => {
    render(<Harness status={standardStatus()} initialFailingRuleId="gone" />);

    expect(
      screen.queryByTestId("compliance-members-rule-filter"),
    ).not.toBeInTheDocument();
  });
});

describe("large teams", () => {
  test(`draws ${MEMBER_PAGE_SIZE} at a time`, () => {
    const status: TeamComplianceStatusJSON = buildStatus({
      complianceSettings: [emailRule({ compliantCount: 60 })],
      userComplianceStatuses: manyMembers(60),
    });

    render(<Harness status={status} />);

    expect(listedNames()).toHaveLength(MEMBER_PAGE_SIZE);
    expect(screen.getByText(`Showing 25 of 60`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("compliance-members-show-more"));
    expect(listedNames()).toHaveLength(50);

    expect(
      screen.getByTestId("compliance-members-show-more"),
    ).toHaveTextContent("Show 10 more");
    fireEvent.click(screen.getByTestId("compliance-members-show-more"));

    expect(listedNames()).toHaveLength(60);
    expect(
      screen.queryByTestId("compliance-members-show-more"),
    ).not.toBeInTheDocument();
  });

  test("a new filter starts the list from the top", () => {
    const status: TeamComplianceStatusJSON = buildStatus({
      complianceSettings: [emailRule({ compliantCount: 60 })],
      userComplianceStatuses: manyMembers(60),
    });

    render(<Harness status={status} />);

    fireEvent.click(screen.getByTestId("compliance-members-show-more"));
    expect(listedNames()).toHaveLength(50);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Member" },
    });

    expect(listedNames()).toHaveLength(MEMBER_PAGE_SIZE);
  });
});

describe("the way to the fix", () => {
  test("the signed-in member is sent to their own settings for the first rule they fail", () => {
    render(<Harness status={standardStatus()} currentUserId={OMAR_ID} />);

    expect(
      within(row(OMAR_ID)).getByTestId("compliance-member-fix-self"),
    ).toHaveTextContent("Open my incident on-call rules");

    const link: HTMLElement = within(row(OMAR_ID)).getByRole("link", {
      name: /Open my incident on-call rules/,
    });

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/user-settings/incident-on-call-rules`,
    );
  });

  test("a failed method rule sends the member to their notification methods", () => {
    render(<Harness status={standardStatus()} currentUserId={JANE_ID} />);

    expect(
      within(row(JANE_ID)).getByRole("link", {
        name: /Open my notification methods/,
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/user-settings/notification-methods`,
    );
  });

  /*
   * Jane fails the email rule (created first) AND Call for incidents. One
   * link to her notification methods left her no way to the on-call rules
   * page the second failure needs.
   */
  test("a member failing a method rule and an on-call rule gets a link to each page", () => {
    render(<Harness status={standardStatus()} currentUserId={JANE_ID} />);

    expect(
      within(row(JANE_ID))
        .getAllByTestId("compliance-member-fix-self")
        .map((link: HTMLElement): string => {
          return link.textContent || "";
        }),
    ).toEqual([
      "Open my notification methods",
      "Open my incident on-call rules",
    ]);
    expect(
      within(row(JANE_ID)).getByRole("link", {
        name: /Open my incident on-call rules/,
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/user-settings/incident-on-call-rules`,
    );
  });

  test("two failures fixed on the same page get one link to it", () => {
    const status: TeamComplianceStatusJSON = buildStatus({
      complianceSettings: [
        callForIncidentsRule(),
        callForIncidentsRule({ settingId: "sms-incidents" }),
        alertRule(),
      ],
      userComplianceStatuses: [
        buildMember({
          nonCompliantRules: [
            issue(callForIncidentsRule(), CALL_REASON),
            issue(
              callForIncidentsRule({ settingId: "sms-incidents" }),
              "No SMS rule",
            ),
            issue(alertRule(), "No alert rule"),
          ],
        }),
      ],
    });

    render(<Harness status={status} currentUserId={JANE_ID} />);

    expect(
      within(row(JANE_ID))
        .getAllByTestId("compliance-member-fix-self")
        .map((link: HTMLElement): string => {
          return link.textContent || "";
        }),
    ).toEqual([
      "Open my incident on-call rules",
      "Open my alert on-call rules",
    ]);
  });

  test("an admin gets a link to each member's on-call setup", () => {
    render(<Harness status={standardStatus()} canViewMemberSetup={true} />);

    const link: HTMLElement = within(row(JANE_ID)).getByRole("link", {
      name: /Open Jane's on-call setup/,
    });

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/users/${JANE_ID}/on-call-readiness`,
    );
    expect(
      within(row(OMAR_ID)).getByTestId("compliance-member-fix-link"),
    ).toHaveTextContent("Open Omar's on-call setup");
  });

  test("the signed-in admin still gets their own settings, not the admin page", () => {
    render(
      <Harness
        status={standardStatus()}
        canViewMemberSetup={true}
        currentUserId={JANE_ID}
      />,
    );

    expect(
      within(row(JANE_ID)).getAllByTestId("compliance-member-fix-self"),
    ).toHaveLength(2);
    expect(
      within(row(JANE_ID)).queryByTestId("compliance-member-fix-link"),
    ).not.toBeInTheDocument();
    expect(
      within(row(OMAR_ID)).getByTestId("compliance-member-fix-link"),
    ).toBeInTheDocument();
  });

  test("anyone else gets no link to a page they could not open", () => {
    render(<Harness status={standardStatus()} currentUserId={PRIYA_ID} />);

    expect(
      screen.queryByTestId("compliance-member-fix-link"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("compliance-member-fix-self"),
    ).not.toBeInTheDocument();
  });

  test("a compliant member has nothing to fix", () => {
    render(
      <Harness
        status={standardStatus()}
        canViewMemberSetup={true}
        currentUserId={PRIYA_ID}
      />,
    );

    expect(within(row(PRIYA_ID)).queryByRole("button")).not.toBeInTheDocument();
    expect(within(row(PRIYA_ID)).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("nothing to list", () => {
  test("a team with no members", () => {
    render(
      <Harness status={buildStatus({ complianceSettings: [emailRule()] })} />,
    );

    expect(screen.getByText("No members on this team yet")).toBeInTheDocument();
    expect(
      screen.queryByTestId("compliance-members-list"),
    ).not.toBeInTheDocument();
  });

  test("every rule paused: nobody is being checked, so nobody is called compliant", () => {
    const rules: Array<TeamComplianceRuleJSON> = [
      emailRule({ enabled: false }),
      callForIncidentsRule({ enabled: false }),
    ];

    render(
      <Harness
        status={buildStatus({
          complianceSettings: rules,
          userComplianceStatuses: [
            buildMember(),
            buildMember({ userId: OMAR_ID }),
          ],
        })}
      />,
    );

    expect(
      screen.getByTestId("compliance-members-no-active-rules"),
    ).toHaveTextContent(
      "Every rule on this team is paused, so none of its 2 members are being checked.",
    );
    expect(screen.queryByText("Compliant")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  test("one member, every rule paused", () => {
    render(
      <Harness
        status={buildStatus({
          complianceSettings: [emailRule({ enabled: false })],
          userComplianceStatuses: [buildMember()],
        })}
      />,
    );

    expect(
      screen.getByTestId("compliance-members-no-active-rules"),
    ).toHaveTextContent("none of its 1 member is being checked");
  });

  /*
   * An enabled rule of a type this build does not recognise is ON: "every
   * rule is paused ... turn a rule back on" sends the admin to a switch that
   * is already on.
   */
  test("an enabled rule of an unrecognised type is not called paused", () => {
    render(
      <Harness
        status={buildStatus({
          complianceSettings: [
            buildRule({
              settingId: "pigeon",
              ruleType: "HasCarrierPigeon" as ComplianceRuleType,
            }),
          ],
          userComplianceStatuses: [buildMember()],
        })}
      />,
    );

    const message: HTMLElement = screen.getByTestId(
      "compliance-members-no-active-rules",
    );

    expect(message).toHaveTextContent(
      "No rule on this team can be checked right now, so none of its 1 member is being checked. This team's rule is of a type this version does not recognise, so it is not checked. Delete it and add a supported rule.",
    );
    expect(message).not.toHaveTextContent("paused");
    expect(message).not.toHaveTextContent("Turn a rule back on");
  });

  test("paused rules and an unrecognised one: says both, and what to do", () => {
    render(
      <Harness
        status={buildStatus({
          complianceSettings: [
            emailRule({ enabled: false }),
            buildRule({
              settingId: "pigeon",
              ruleType: "HasCarrierPigeon" as ComplianceRuleType,
            }),
          ],
          userComplianceStatuses: [
            buildMember(),
            buildMember({ userId: OMAR_ID }),
          ],
        })}
      />,
    );

    expect(
      screen.getByTestId("compliance-members-no-active-rules"),
    ).toHaveTextContent(
      "No rule on this team can be checked right now, so none of its 2 members are being checked. 1 rule is paused and 1 rule is of a type this version does not recognise. Turn a paused rule on, or replace the unrecognised one.",
    );
  });

  test("a paused-only team hides stale failure reasons", () => {
    render(
      <Harness
        status={buildStatus({
          complianceSettings: [emailRule({ enabled: false })],
          userComplianceStatuses: [
            buildMember({
              nonCompliantRules: [issue(emailRule(), EMAIL_REASON)],
            }),
          ],
        })}
      />,
    );

    expect(screen.queryByText(EMAIL_REASON, { exact: false })).toBeNull();
  });
});
