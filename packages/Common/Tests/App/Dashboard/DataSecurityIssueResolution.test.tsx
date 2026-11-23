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
import i18next from "i18next";
import type { Mock } from "jest-mock";
import { initReactI18next } from "react-i18next";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import DataSecurityApi, {
  readIssueContainment,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import { IssueResolutionPill } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityPills";
import IssueResolution, {
  ISSUE_RESOLUTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueResolution";
import {
  CAME_BACK_AFTER_FIX,
  CAME_BACK_AFTER_PULL_REQUEST,
  CAME_BACK_IN_VERSION,
  CAME_BACK_IN_VERSION_AFTER_FIX,
  CHECK_PASSED_AT,
  FIXED_IN_CODE,
  FIXED_IN_CODE_IN_COMMIT,
  FIXED_IN_CODE_IN_COMMIT_NO_NUMBER,
  FIXED_IN_CODE_IN_VERSION,
  FIXED_IN_CODE_IN_VERSION_NO_NUMBER,
  FIXED_IN_CODE_NO_NUMBER,
  FIXED_IN_INFRASTRUCTURE_CODE,
  FIXED_IN_INFRASTRUCTURE_CODE_NO_NUMBER,
  FIXED_FROM_HERE,
  FIXED_FROM_HERE_WITH,
  RESOLUTION_LABELS,
  ResolutionTone,
  getCameBackTemplate,
  getClosedLineTemplate,
  getFixedLineTemplate,
  getResolutionOptions,
  getResolutionTone,
  isResolutionShown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueResolutionCopy";
import { getDataSecurityIssueFeedKind } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueFeedKind";
import { getDataStoreFeedKind } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/StoreFeedKind";
import {
  PULL_REQUEST_FIX_KIND_LABELS,
  getPullRequestFixesByKind,
  parseAiOutcomes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsData";
import { getTrendDays } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/Overview";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import { DataStoreFeedEventType } from "../../../Models/DatabaseModels/DataStoreFeed";
import FixProductionCheck from "../../../Types/AI/FixProductionCheck";
import { SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID } from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import { DataSecurityIssueContainment } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSecurityIssueResolution, {
  ALL_DATA_SECURITY_ISSUE_RESOLUTIONS,
} from "../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataSecurityResponseAction } from "../../../Types/DataSecurity/DataSecurityResponseAction";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { PROJECT_ID } from "./SideMenuHarness";

/*
 * i18next as the Dashboard sets it up, with no translation: each sentence
 * reads as its English, its values and slots placed (TranslatedSentence).
 */
beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
});

/*
 * HOW AN ISSUE WAS RESOLVED, ON ITS PAGE (#10368).
 *
 * Each resolution reads plainly and in the colour of what it means: "Fixed
 * in pull request #482, deployed in version 2.4.1, verified" in green; a
 * leak contained at ingest in amber, "not fixed", with the rule that hides
 * it, what it changed lately and Fix the Code; a leak back after its fix in
 * red, naming the version; the rule kept after a verified fix, with Remove
 * Rule. The Issues list's pill, the timelines' entries, the Overview's
 * trend and AI Results' fixes by kind say the same.
 */

configure({ asyncUtilTimeout: 15000 });

/*
 * What an element reads: a name or a figure is set apart from the words
 * around it with invisible direction marks, and a figure keeps to its unit
 * with a no-break space - neither is part of what the sentence says.
 */
function shown(element: HTMLElement): string {
  return (element.textContent || "")
    .replace(/[\u2066-\u2069\u200E\u200F]/g, "")
    .replace(/\u00A0/g, " ");
}

const ISSUE_ID: ObjectID = new ObjectID("ae7c5b50-0000-4000-8000-000000000001");
const RULE_ID: string = "ae7c5b50-0000-4000-8000-000000000002";
const VERIFIED_AT: string = "2026-11-21T14:10:00.000Z";

const FIX: JSONObject = {
  pullRequestId: "ae7c5b50-0000-4000-8000-000000000003",
  number: 482,
  url: "https://github.com/acme/checkout/pull/482",
  version: "2.4.1",
};

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

function issueOf(data: {
  status: DataSecurityIssueStatus;
  resolution?: DataSecurityIssueResolution | undefined;
  resolutionDetails?: JSONObject | undefined;
  checkId?: string | undefined;
}): DataSecurityIssue {
  const issue: DataSecurityIssue = new DataSecurityIssue(ISSUE_ID);

  issue.checkId = data.checkId || SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID;
  issue.status = data.status;
  issue.resolvedAt = new Date(VERIFIED_AT);

  if (data.resolution) {
    issue.resolution = data.resolution;
  }

  if (data.resolutionDetails) {
    issue.resolutionDetails = data.resolutionDetails;
  }

  return issue;
}

function containmentOf(
  rules: DataSecurityIssueContainment["rules"],
): DataSecurityIssueContainment {
  return { days: 7, containedFindingCount: 1, rules };
}

beforeEach(() => {
  grant([
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
    Permission.ProjectUser,
    Permission.ProjectOwner,
  ]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the words of a resolution", () => {
  test("every resolution has a label, a filter option, and a tone - contained is never a fix", () => {
    for (const resolution of ALL_DATA_SECURITY_ISSUE_RESOLUTIONS) {
      expect(RESOLUTION_LABELS[resolution]).toBeTruthy();
    }

    expect(
      getResolutionOptions().map((option: { value: unknown }) => {
        return option.value;
      }),
    ).toEqual([...ALL_DATA_SECURITY_ISSUE_RESOLUTIONS]);
    expect(
      getResolutionTone(DataSecurityIssueResolution.ContainedAtIngest),
    ).toBe(ResolutionTone.Contained);
    expect(getResolutionTone(DataSecurityIssueResolution.FixedInCode)).toBe(
      ResolutionTone.Fixed,
    );
    expect(getResolutionTone(DataSecurityIssueResolution.NoLongerChecked)).toBe(
      ResolutionTone.Closed,
    );
  });

  test("a verified fix's line names what its deploy is known by", () => {
    expect(
      getFixedLineTemplate({
        resolution: DataSecurityIssueResolution.FixedInCode,
        fix: { pullRequestId: "x", number: 482, version: "2.4.1" },
      }),
    ).toBe(FIXED_IN_CODE_IN_VERSION);
    expect(
      getFixedLineTemplate({
        resolution: DataSecurityIssueResolution.FixedInCode,
        fix: { pullRequestId: "x", number: 482, commitSha: "1a2b3c4" },
      }),
    ).toBe(FIXED_IN_CODE_IN_COMMIT);
    expect(
      getFixedLineTemplate({
        resolution: DataSecurityIssueResolution.FixedInCode,
        fix: { pullRequestId: "x", number: 482 },
      }),
    ).toBe(FIXED_IN_CODE);
    expect(
      getFixedLineTemplate({
        resolution: DataSecurityIssueResolution.FixedInInfrastructureCode,
        fix: { pullRequestId: "x", number: 482 },
      }),
    ).toBe(FIXED_IN_INFRASTRUCTURE_CODE);
    expect(
      getFixedLineTemplate({
        resolution: DataSecurityIssueResolution.CheckPassed,
        fix: undefined,
      }),
    ).toBeNull();
    expect(
      getClosedLineTemplate({
        resolution: DataSecurityIssueResolution.FixedFromHere,
        details: { responseAction: DataSecurityResponseAction.RevokeSharing },
      }),
    ).toBe(FIXED_FROM_HERE_WITH);
    expect(
      getClosedLineTemplate({
        resolution: DataSecurityIssueResolution.FixedFromHere,
        details: {},
      }),
    ).toBe(FIXED_FROM_HERE);
    expect(
      getClosedLineTemplate({
        resolution: DataSecurityIssueResolution.CheckPassed,
        details: {},
      }),
    ).toBe(CHECK_PASSED_AT);
  });

  test("a pull request recorded without its number is never named - the line says what was fixed", () => {
    expect(
      getFixedLineTemplate({
        resolution: DataSecurityIssueResolution.FixedInCode,
        fix: { pullRequestId: "x", version: "2.4.1" },
      }),
    ).toBe(FIXED_IN_CODE_IN_VERSION_NO_NUMBER);
    expect(
      getFixedLineTemplate({
        resolution: DataSecurityIssueResolution.FixedInCode,
        fix: { pullRequestId: "x", commitSha: "1a2b3c4" },
      }),
    ).toBe(FIXED_IN_CODE_IN_COMMIT_NO_NUMBER);
    expect(
      getFixedLineTemplate({
        resolution: DataSecurityIssueResolution.FixedInCode,
        fix: { pullRequestId: "x" },
      }),
    ).toBe(FIXED_IN_CODE_NO_NUMBER);
    expect(
      getFixedLineTemplate({
        resolution: DataSecurityIssueResolution.FixedInInfrastructureCode,
        fix: undefined,
      }),
    ).toBe(FIXED_IN_INFRASTRUCTURE_CODE_NO_NUMBER);
    expect(
      getCameBackTemplate({
        regression: {
          at: VERIFIED_AT,
          version: "2.5.0",
          fix: { pullRequestId: "x", version: "2.4.1" },
        },
      }),
    ).toBe(CAME_BACK_IN_VERSION_AFTER_FIX);
    expect(
      getCameBackTemplate({
        regression: { at: VERIFIED_AT, fix: { pullRequestId: "x" } },
      }),
    ).toBe(CAME_BACK_AFTER_FIX);
  });

  test("a leak that came back names the version, and the fix's when known", () => {
    expect(
      getCameBackTemplate({
        regression: {
          at: VERIFIED_AT,
          version: "2.5.0",
          fix: { pullRequestId: "x", number: 482, version: "2.4.1" },
        },
      }),
    ).toBe(CAME_BACK_IN_VERSION);
    expect(
      getCameBackTemplate({
        regression: {
          at: VERIFIED_AT,
          fix: { pullRequestId: "x", number: 482 },
        },
      }),
    ).toBe(CAME_BACK_AFTER_PULL_REQUEST);
    expect(
      getCameBackTemplate({
        regression: { at: VERIFIED_AT, version: "2.5.0" },
      }),
    ).toBe(CAME_BACK_IN_VERSION_AFTER_FIX);
  });

  test("shown for a resolved issue with a resolution, or an open one that came back - never for an older resolved issue", () => {
    expect(
      isResolutionShown({
        status: DataSecurityIssueStatus.Resolved,
        resolution: undefined,
        details: {},
      }),
    ).toBe(false);
    expect(
      isResolutionShown({
        status: DataSecurityIssueStatus.Open,
        resolution: undefined,
        details: { regression: { at: VERIFIED_AT } },
      }),
    ).toBe(true);
    expect(
      isResolutionShown({
        status: DataSecurityIssueStatus.Accepted,
        resolution: DataSecurityIssueResolution.CheckPassed,
        details: {},
      }),
    ).toBe(false);
  });
});

describe("the issue's page", () => {
  test("a code fix production proved: Fixed in pull request #482, deployed in version 2.4.1, verified - in green", () => {
    jest.spyOn(DataSecurityApi, "getIssueContainment").mockResolvedValue(null);

    render(
      <IssueResolution
        issue={issueOf({
          status: DataSecurityIssueStatus.Resolved,
          resolution: DataSecurityIssueResolution.FixedInCode,
          resolutionDetails: { at: VERIFIED_AT, fix: FIX },
        })}
        issueId={ISSUE_ID}
      />,
    );

    const panel: HTMLElement = screen.getByTestId(ISSUE_RESOLUTION_TEST_ID);

    expect(panel).toHaveAttribute("data-tone", ResolutionTone.Fixed);
    expect(shown(panel)).toContain(
      "Fixed in pull request #482, deployed in version 2.4.1, verified",
    );
    expect(screen.getByRole("link", { name: "#482" })).toHaveAttribute(
      "href",
      "https://github.com/acme/checkout/pull/482",
    );
    // No rule was kept: nothing is read about one.
    expect(DataSecurityApi.getIssueContainment).not.toHaveBeenCalled();
  });

  test("contained at ingest: amber, not fixed, the rule and what it changed lately, and Fix the Code", async () => {
    jest.spyOn(DataSecurityApi, "getIssueContainment").mockResolvedValue(
      containmentOf([
        {
          id: RULE_ID,
          signal: "log",
          name: "Data Security: Email address in log attributes of checkout",
          valuesChanged: 1204,
          lastChangedVersion: "2.3.1",
          isKept: false,
        },
      ]),
    );
    const fixTheCode: Mock<() => void> = jest.fn<() => void>();

    render(
      <IssueResolution
        issue={issueOf({
          status: DataSecurityIssueStatus.Resolved,
          resolution: DataSecurityIssueResolution.ContainedAtIngest,
          resolutionDetails: { at: VERIFIED_AT },
        })}
        issueId={ISSUE_ID}
        onFixTheCode={fixTheCode}
      />,
    );

    const panel: HTMLElement = screen.getByTestId(ISSUE_RESOLUTION_TEST_ID);

    expect(panel).toHaveAttribute("data-tone", ResolutionTone.Contained);
    expect(shown(panel)).toContain("Contained at ingest, not fixed");
    expect(shown(panel)).toContain("but the code still writes it");
    await waitFor(() => {
      expect(shown(panel)).toContain(
        "Data Security: Email address in log attributes of checkout changed 1,204 values in this service in the last 7 days, the latest in version 2.3.1.",
      );
    });

    fireEvent.click(screen.getByTestId("data-security-issue-fix-the-code"));
    expect(fixTheCode).toHaveBeenCalledTimes(1);
  });

  test("with the project's AI off, a contained leak still says so - with no button to press", () => {
    jest
      .spyOn(DataSecurityApi, "getIssueContainment")
      .mockResolvedValue(containmentOf([]));

    render(
      <IssueResolution
        issue={issueOf({
          status: DataSecurityIssueStatus.Resolved,
          resolution: DataSecurityIssueResolution.ContainedAtIngest,
        })}
        issueId={ISSUE_ID}
      />,
    );

    expect(
      screen.getByText("Contained at ingest, not fixed"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("data-security-issue-fix-the-code"),
    ).not.toBeInTheDocument();
  });

  test("after a verified fix, the kept rule says it changed nothing since, and Remove Rule deletes it once confirmed", async () => {
    jest.spyOn(DataSecurityApi, "getIssueContainment").mockResolvedValue(
      containmentOf([
        {
          id: RULE_ID,
          signal: "log",
          name: "Email rule",
          valuesChanged: 0,
          valuesChangedSinceFix: 0,
          isKept: true,
        },
      ]),
    );
    const deleted: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "deleteItem")
      .mockResolvedValue(undefined as never);

    render(
      <IssueResolution
        issue={issueOf({
          status: DataSecurityIssueStatus.Resolved,
          resolution: DataSecurityIssueResolution.FixedInCode,
          resolutionDetails: {
            at: VERIFIED_AT,
            fix: FIX,
            scrubRules: [{ id: RULE_ID, signal: "log", name: "Email rule" }],
          },
        })}
        issueId={ISSUE_ID}
      />,
    );

    await waitFor(() => {
      expect(shown(screen.getByTestId(ISSUE_RESOLUTION_TEST_ID))).toContain(
        "Email rule contained this leak, and is kept, so a regression is hidden on arrival. It has changed no value since the fix.",
      );
    });

    fireEvent.click(screen.getByTestId("data-security-issue-remove-rule"));
    expect(
      await screen.findByText("Are you sure you want to delete", {
        exact: false,
      }),
    ).toBeInTheDocument();
    // The dialog's own Remove Rule, after the row's.
    const removes: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Remove Rule",
    });

    fireEvent.click(removes[removes.length - 1]!);

    await waitFor(() => {
      expect(deleted).toHaveBeenCalledTimes(1);
    });
    expect((deleted.mock.calls[0]![0] as { id: ObjectID }).id.toString()).toBe(
      RULE_ID,
    );
  });

  test("a reader who may not delete scrub rules sees Remove Rule locked, saying why", async () => {
    grant([
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.ProjectUser,
      Permission.SecurityViewer,
    ]);
    jest.spyOn(DataSecurityApi, "getIssueContainment").mockResolvedValue(
      containmentOf([
        {
          id: RULE_ID,
          signal: "log",
          name: "Email rule",
          valuesChanged: 0,
          valuesChangedSinceFix: 0,
          isKept: true,
        },
      ]),
    );

    render(
      <IssueResolution
        issue={issueOf({
          status: DataSecurityIssueStatus.Resolved,
          resolution: DataSecurityIssueResolution.FixedInCode,
          resolutionDetails: {
            at: VERIFIED_AT,
            fix: FIX,
            scrubRules: [{ id: RULE_ID, signal: "log", name: "Email rule" }],
          },
        })}
        issueId={ISSUE_ID}
      />,
    );

    const remove: HTMLElement = await screen.findByTestId(
      "data-security-issue-remove-rule",
    );

    expect(remove).toBeDisabled();
  });

  test("a leak back after its fix: red, the version that brought it back, open until fixed again", () => {
    jest
      .spyOn(DataSecurityApi, "getIssueContainment")
      .mockResolvedValue(containmentOf([]));

    render(
      <IssueResolution
        issue={issueOf({
          status: DataSecurityIssueStatus.Open,
          resolutionDetails: {
            regression: { at: VERIFIED_AT, version: "2.5.0", fix: FIX },
          },
        })}
        issueId={ISSUE_ID}
        onFixTheCode={jest.fn()}
      />,
    );

    const panel: HTMLElement = screen.getByTestId(ISSUE_RESOLUTION_TEST_ID);

    expect(panel).toHaveAttribute("data-tone", ResolutionTone.CameBack);
    expect(shown(panel)).toContain(
      "The leak came back in version 2.5.0, after pull request #482 fixed it in version 2.4.1.",
    );
    expect(shown(panel)).toContain("It stays open until it is fixed again");
    expect(
      screen.getByTestId("data-security-issue-fix-the-code"),
    ).toBeInTheDocument();
  });

  test("an issue resolved before resolutions were recorded shows nothing new", () => {
    const { container } = render(
      <IssueResolution
        issue={issueOf({ status: DataSecurityIssueStatus.Resolved })}
        issueId={ISSUE_ID}
      />,
    );

    expect(container.innerHTML).toBe("");
  });
});

describe("the Issues list's pill", () => {
  test("a resolved issue says how; an older one says Resolved; an open one its status", () => {
    render(
      <div>
        <span data-testid="contained">
          <IssueResolutionPill
            status={DataSecurityIssueStatus.Resolved}
            resolution={DataSecurityIssueResolution.ContainedAtIngest}
          />
        </span>
        <span data-testid="older">
          <IssueResolutionPill
            status={DataSecurityIssueStatus.Resolved}
            resolution={undefined}
          />
        </span>
        <span data-testid="accepted">
          <IssueResolutionPill
            status={DataSecurityIssueStatus.Accepted}
            resolution={DataSecurityIssueResolution.CheckPassed}
          />
        </span>
      </div>,
    );

    expect(shown(screen.getByTestId("contained"))).toContain(
      "Contained at ingest",
    );
    expect(shown(screen.getByTestId("older"))).toContain("Resolved");
    expect(shown(screen.getByTestId("accepted"))).toContain("Accepted");
  });
});

describe("the timelines", () => {
  test("draw every new entry: contained is a warning, never the green check of a fix", () => {
    for (const eventType of [
      DataSecurityIssueFeedEventType.Contained,
      DataSecurityIssueFeedEventType.FixShipped,
      DataSecurityIssueFeedEventType.FixVerified,
      DataSecurityIssueFeedEventType.FixNotApplied,
      DataSecurityIssueFeedEventType.FixRegressed,
      DataSecurityIssueFeedEventType.FixUnverifiable,
    ]) {
      expect(getDataSecurityIssueFeedKind(eventType)).toBeDefined();
    }

    expect(
      getDataSecurityIssueFeedKind(DataSecurityIssueFeedEventType.Contained)
        ?.tone,
    ).toBe("Warning");

    for (const eventType of [
      DataStoreFeedEventType.IssueFixVerified,
      DataStoreFeedEventType.IssueFixNotApplied,
      DataStoreFeedEventType.IssueFixRegressed,
    ]) {
      expect(getDataStoreFeedKind(eventType)).toBeDefined();
    }
  });
});

describe("the Overview's trend", () => {
  test("draws the leaks only contained apart from the issues resolved, from what the server counted", () => {
    expect(
      getTrendDays([
        { day: "2026-11-20", opened: 2, resolved: 5, contained: 2 },
        // An older server's day: no contained count.
        { day: "2026-11-21", opened: 1, resolved: 3 },
      ]),
    ).toEqual([
      {
        day: "2026-11-20",
        total: 7,
        byKey: { opened: 2, resolved: 3, contained: 2 },
      },
      {
        day: "2026-11-21",
        total: 4,
        byKey: { opened: 1, resolved: 3, contained: 0 },
      },
    ]);
  });
});

describe("AI Results: fixes verified by kind", () => {
  test("a Data Security fix is counted apart, by what production watched it for", () => {
    expect(
      getPullRequestFixesByKind([
        {
          check: FixProductionCheck.TelemetryLeak,
          verified: 2,
          regressed: 1,
          watching: 0,
          awaitingDeploy: 0,
          unverifiable: 0,
        },
      ]),
    ).toEqual({
      rows: [
        {
          kind: FixProductionCheck.TelemetryLeak,
          label: PULL_REQUEST_FIX_KIND_LABELS[FixProductionCheck.TelemetryLeak],
          value: 2,
          total: 3,
          isLabelKey: true,
        },
      ],
    });
  });

  test("one kind of other fixes needs no breakdown; none checked neither; a newer build's kind is named as stored", () => {
    expect(
      getPullRequestFixesByKind([
        {
          check: FixProductionCheck.Exception,
          verified: 4,
          regressed: 1,
          watching: 0,
          awaitingDeploy: 0,
          unverifiable: 0,
        },
      ]),
    ).toBeNull();
    expect(
      getPullRequestFixesByKind([
        {
          check: FixProductionCheck.StoreConfiguration,
          verified: 0,
          regressed: 0,
          watching: 0,
          awaitingDeploy: 3,
          unverifiable: 0,
        },
      ]),
    ).toBeNull();
    expect(
      getPullRequestFixesByKind([
        {
          check: FixProductionCheck.Exception,
          verified: 1,
          regressed: 0,
          watching: 0,
          awaitingDeploy: 0,
          unverifiable: 0,
        },
        {
          check: "FasterQueries",
          verified: 1,
          regressed: 0,
          watching: 0,
          awaitingDeploy: 0,
          unverifiable: 0,
        },
      ])?.rows[1],
    ).toEqual({
      kind: "FasterQueries",
      label: "FasterQueries",
      value: 1,
      total: 1,
      isLabelKey: false,
    });
  });

  test("the server's kinds are read, and an older server's answer without them still is", () => {
    const week: JSONObject = {
      weekStart: "2026-11-16",
      pagesAvoided: 0,
      pagesHeld: 0,
      fixesVerified: 0,
      fixesChecked: 0,
      rootCausesConfirmed: 0,
      rootCausesJudged: 0,
      dataSecurityChangesProven: 0,
      dataSecurityChangesMade: 0,
    };
    const answer: JSONObject = {
      windowStart: "2026-09-01T00:00:00.000Z",
      windowEnd: "2026-11-21T00:00:00.000Z",
      pages: null,
      remediationFixes: null,
      pullRequestFixes: {
        verified: 2,
        regressed: 1,
        watching: 0,
        awaitingDeploy: 0,
        unverifiable: 0,
      },
      rootCauses: null,
      dataSecurity: null,
      models: null,
      weeks: [week],
      isPartial: false,
    };

    expect(parseAiOutcomes(answer)?.pullRequestFixKinds).toBeUndefined();
    expect(
      parseAiOutcomes({
        ...answer,
        pullRequestFixKinds: [
          {
            check: FixProductionCheck.TelemetryLeak,
            verified: 2,
            regressed: 1,
            watching: 0,
            awaitingDeploy: 0,
            unverifiable: 0,
          },
          { check: 7 },
        ],
      })?.pullRequestFixKinds,
    ).toEqual([
      {
        check: FixProductionCheck.TelemetryLeak,
        verified: 2,
        regressed: 1,
        watching: 0,
        awaitingDeploy: 0,
        unverifiable: 0,
      },
    ]);
  });
});

describe("the containment the server sends", () => {
  test("is read rule by rule, one of the wrong shape left out, a count it could not read none", () => {
    expect(
      readIssueContainment({
        days: 7,
        containedFindingCount: 2,
        rules: [
          {
            id: RULE_ID,
            signal: "trace",
            name: "Token rule",
            valuesChanged: null,
            valuesChangedSinceFix: 0,
            isKept: true,
          },
          { signal: "log" },
        ],
      }),
    ).toEqual({
      days: 7,
      containedFindingCount: 2,
      rules: [
        {
          id: RULE_ID,
          signal: "trace",
          name: "Token rule",
          valuesChanged: null,
          valuesChangedSinceFix: 0,
          isKept: true,
        },
      ],
    });
    expect(readIssueContainment(null)).toBeNull();
  });
});
