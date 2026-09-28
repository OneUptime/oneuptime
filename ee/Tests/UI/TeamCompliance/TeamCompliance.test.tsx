import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  RenderHookResult,
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";

/*
 * Teams > View > Compliance, the Enterprise page, end to end in the browser:
 * one status read feeds the verdict, the rule warnings, the rules card and
 * the members section; editors change rules in place and every change is
 * followed by one re-read; viewers get the same page with nothing to press.
 *
 * The page moved to ee/ in the Community / Enterprise split (core keeps a
 * shell at the page's old path - see
 * packages/Common/Tests/App/Dashboard/AuditLogsAndComplianceShells.test.tsx).
 * The members section is not a plugin key: only the Compliance page renders
 * it, importing it from this directory.
 *
 * The network is mocked at its two doors - API.get for the status read,
 * ModelAPI for rule writes and the severity lookup - and ModelFormModal is a
 * stub that records its props, so the form's configuration is asserted
 * exactly (ComplianceRuleForm.test.tsx covers the form itself).
 */

/*
 * UserElement imports "Common/UI/Images/users/blank-profile.svg". ee's ui jest
 * project maps "Common/..." before Common's asset mapper, so the SVG would be
 * parsed as JavaScript; stub it the way Common's own suites do.
 */
jest.mock("Common/UI/Images/users/blank-profile.svg", () => {
  return "data:image/svg+xml;base64,////YXZhdGFy";
});

// The signed-in person's permissions, per test.
let mockPermissions: Array<string> = [];

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return mockPermissions;
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

type CapturedFormModalProps = {
  title?: string;
  initialValues?: Record<string, unknown> | undefined;
  modelIdToEdit?: { toString: () => string } | undefined;
  onBeforeCreate?: (item: Record<string, unknown>) => Promise<unknown>;
  onSuccess?: (item: unknown) => void;
  onClose?: () => void;
  formProps?: { fields?: Array<unknown> };
};

let capturedFormModal: CapturedFormModalProps | null = null;

jest.mock("Common/UI/Components/ModelFormModal/ModelFormModal", () => {
  const react: typeof React = jest.requireActual("react");

  return {
    __esModule: true,
    default: (props: CapturedFormModalProps): ReactElement => {
      capturedFormModal = props;
      return react.createElement(
        "div",
        { "data-testid": "rule-form-modal" },
        props.title,
      );
    },
  };
});

import TeamViewCompliance from "../../../Dashboard/TeamCompliance/Compliance";
import useTeamComplianceStatus, {
  TeamComplianceStatusState,
} from "../../../Dashboard/TeamCompliance/useTeamComplianceStatus";
import TeamCompliancePlugins from "../../../Dashboard/TeamCompliance/Plugins";
import EnterpriseDashboardPlugins from "../../../Dashboard/Index";
import { COMPLIANCE_RULE_PRESETS } from "../../../Dashboard/TeamCompliance/ComplianceRulePresets";
import {
  ALERT_RULE_ID,
  CALL_REASON,
  CALL_RULE_ID,
  CRITICAL_ID,
  EMAIL_REASON,
  EMAIL_RULE_ID,
  EVALUATED_AT,
  JANE_ID,
  OMAR_ID,
  PAUSED_RULE_ID,
  PRIYA_ID,
  PROJECT_ID,
  TEAM_ID,
  alertRule,
  buildMember,
  buildRule,
  buildStatus,
  callForIncidentsRule,
  emailRule,
  issue,
  standardStatus,
} from "./ComplianceFixtures";
import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Project from "Common/Models/DatabaseModels/Project";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import {
  TeamComplianceRuleJSON,
  TeamComplianceStatusJSON,
} from "Common/Types/Team/TeamComplianceStatus";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

const EDITOR: Array<string> = [Permission.ProjectAdmin];
// May read the team's rules but not change them.
const READER: Array<string> = [Permission.ProjectMember];

const SOMEONE_ELSE_ID: string = "00000000-0000-4000-8000-0000000000ff";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project-id/settings/teams/x/compliance"),
  currentProject: Object.assign(new Project(), {
    _id: PROJECT_ID.toString(),
  }),
  hasPaymentMethod: true,
};

// How the standard Call rule is named wherever it has to be told apart.
const CALL_LABEL: string =
  "Call for incidents for Critical Incident and Major Incident";

const CALL_WARNING: string =
  "Call notifications are switched off for this project, so members will not be notified by Call even when they meet this rule. Turn them on in Project Settings > Notification Settings.";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred: <T>() => Deferred<T> = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => {
    return undefined;
  };
  let reject: (error: unknown) => void = () => {
    return undefined;
  };
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: unknown) => void) => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise: promise, resolve: resolve, reject: reject };
};

const respondWith: (status: TeamComplianceStatusJSON) => never = (
  status: TeamComplianceStatusJSON,
): never => {
  return { data: status } as never;
};

/*
 * A failing call, as a native async function: a rejection built here by
 * mockRejectedValue is a zone.js promise (the Telemetry util loads zone.js)
 * that zone reports as unhandled even though the page catches it.
 */
const failWith: (message: string) => () => Promise<never> = (
  message: string,
): (() => Promise<never>) => {
  return async (): Promise<never> => {
    throw new Error(message);
  };
};

let apiGet: jest.SpyInstance;

const renderPage: (status?: TeamComplianceStatusJSON) => Promise<void> = async (
  status?: TeamComplianceStatusJSON,
): Promise<void> => {
  if (status) {
    apiGet.mockResolvedValue(respondWith(status));
  }

  render(<TeamViewCompliance {...PAGE_PROPS} />);

  await screen.findByTestId("team-compliance-page");
};

const ruleRow: (settingId: string) => HTMLElement = (
  settingId: string,
): HTMLElement => {
  return screen.getByTestId(`compliance-rule-${settingId}`);
};

const ruleSwitch: (label: string) => HTMLElement = (
  label: string,
): HTMLElement => {
  return screen.getByRole("switch", {
    name: `Check members against ${label}`,
  });
};

// The standard fixture with some of its rules paused, as the server reports it.
const withPaused: (settingIds: Array<string>) => TeamComplianceStatusJSON = (
  settingIds: Array<string>,
): TeamComplianceStatusJSON => {
  const status: TeamComplianceStatusJSON = standardStatus();

  for (const rule of status.complianceSettings) {
    if (settingIds.includes(rule.settingId)) {
      rule.enabled = false;
    }
  }

  return status;
};

beforeEach(() => {
  capturedFormModal = null;
  mockPermissions = [];
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(TEAM_ID);
  jest
    .spyOn(UserUtil, "getUserId")
    .mockReturnValue(new ObjectID(SOMEONE_ELSE_ID));
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  apiGet = jest
    .spyOn(API, "get")
    .mockResolvedValue(respondWith(standardStatus()));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("reading the status", () => {
  test("asks the Enterprise compliance route about exactly this team, once", async () => {
    await renderPage();

    expect(apiGet).toHaveBeenCalledTimes(1);

    const request: { url: { toString: () => string } } = apiGet.mock
      .calls[0]![0] as { url: { toString: () => string } };

    expect(request.url.toString()).toContain(
      `/team/compliance-status/${TEAM_ID.toString()}`,
    );
  });

  test("the hero, the rules and the members all draw from that one read", async () => {
    await renderPage();

    expect(screen.getByTestId("compliance-hero")).toBeInTheDocument();
    expect(screen.getByTestId("compliance-rules-card")).toBeInTheDocument();
    expect(screen.getByTestId("compliance-members")).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test("the first load draws the page's shape, not a spinner", async () => {
    const pending: Deferred<never> = deferred<never>();
    apiGet.mockReturnValue(pending.promise);

    render(<TeamViewCompliance {...PAGE_PROPS} />);

    expect(
      screen.getByRole("status", { name: "Loading team compliance" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("team-compliance-page")).toBeNull();

    await act(async () => {
      pending.resolve(respondWith(standardStatus()));
    });

    expect(screen.getByTestId("team-compliance-page")).toBeInTheDocument();
    expect(screen.queryByTestId("compliance-skeleton")).toBeNull();
  });

  test("a first read that fails shows the error, not an endless skeleton", async () => {
    apiGet.mockImplementation(failWith("boom"));
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Compliance is down");

    render(<TeamViewCompliance {...PAGE_PROPS} />);

    expect(await screen.findByText("Compliance is down")).toBeInTheDocument();
    expect(screen.getByTestId("compliance-load-error")).toBeInTheDocument();
    expect(screen.queryByTestId("compliance-skeleton")).toBeNull();
    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
  });

  test("retrying after a failed first read loads the page", async () => {
    apiGet.mockImplementationOnce(failWith("boom"));
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Compliance is down");

    render(<TeamViewCompliance {...PAGE_PROPS} />);
    await screen.findByText("Compliance is down");

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(
      await screen.findByTestId("team-compliance-page"),
    ).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Compliance is down")).not.toBeInTheDocument();
  });

  test("an HTTP error response is an error too", async () => {
    const errorResponse: HTTPErrorResponse = Object.create(
      HTTPErrorResponse.prototype,
    );

    apiGet.mockResolvedValue(errorResponse as never);
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Not allowed");

    render(<TeamViewCompliance {...PAGE_PROPS} />);

    expect(await screen.findByText("Not allowed")).toBeInTheDocument();
  });

  test("Refresh reads again; a failure keeps the last results and says so", async () => {
    await renderPage();

    apiGet.mockImplementationOnce(failWith("boom"));
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Compliance is down");

    await act(async () => {
      fireEvent.click(screen.getByTestId("compliance-hero-refresh"));
    });

    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByTestId("compliance-hero-refresh-error"),
    ).toHaveTextContent(
      "Could not check again - showing the last results that loaded. Compliance is down",
    );
    expect(
      screen.getByTestId(`compliance-member-${JANE_ID}`),
    ).toBeInTheDocument();
  });

  test("a successful refresh after a failure clears the error", async () => {
    await renderPage();

    apiGet.mockImplementationOnce(failWith("boom"));
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Compliance is down");

    await act(async () => {
      fireEvent.click(screen.getByTestId("compliance-hero-refresh"));
    });
    await screen.findByTestId("compliance-hero-refresh-error");

    await act(async () => {
      fireEvent.click(screen.getByTestId("compliance-hero-refresh"));
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("compliance-hero-refresh-error"),
      ).not.toBeInTheDocument();
    });
    expect(apiGet).toHaveBeenCalledTimes(3);
  });

  test("the refresh button spins while a read is in flight", async () => {
    await renderPage();

    const pending: Deferred<never> = deferred<never>();
    apiGet.mockReturnValueOnce(pending.promise);

    await act(async () => {
      fireEvent.click(screen.getByTestId("compliance-hero-refresh"));
    });

    expect(screen.getByTestId("compliance-hero-refresh")).toBeDisabled();

    await act(async () => {
      pending.resolve(respondWith(standardStatus()));
    });

    expect(screen.getByTestId("compliance-hero-refresh")).not.toBeDisabled();
  });

  test("another team is another answer: the old one is not shown while it loads", async () => {
    const otherTeamId: ObjectID = new ObjectID(
      "00000000-0000-4000-8000-0000000000ee",
    );
    const params: jest.SpyInstance = jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(TEAM_ID);

    const { rerender } = render(<TeamViewCompliance {...PAGE_PROPS} />);
    await screen.findByTestId("team-compliance-page");

    const pending: Deferred<never> = deferred<never>();
    apiGet.mockReturnValueOnce(pending.promise);
    params.mockReturnValue(otherTeamId);

    await act(async () => {
      rerender(<TeamViewCompliance {...PAGE_PROPS} />);
    });

    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(
      (
        apiGet.mock.calls[1]![0] as { url: { toString: () => string } }
      ).url.toString(),
    ).toContain(`/team/compliance-status/${otherTeamId.toString()}`);
    expect(screen.getByTestId("compliance-skeleton")).toBeInTheDocument();
    expect(
      screen.queryByTestId(`compliance-member-${JANE_ID}`),
    ).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(respondWith(buildStatus({ teamName: "Other team" })));
    });

    expect(screen.getByTestId("team-compliance-page")).toBeInTheDocument();
  });

  test("re-rendering the same team reads nothing new", async () => {
    const { rerender } = render(<TeamViewCompliance {...PAGE_PROPS} />);
    await screen.findByTestId("team-compliance-page");

    await act(async () => {
      rerender(<TeamViewCompliance {...PAGE_PROPS} />);
    });

    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test("an older answer that arrives late never replaces a newer one", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    const older: Deferred<never> = deferred<never>();
    const newer: Deferred<never> = deferred<never>();
    apiGet
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    jest.spyOn(ModelAPI, "updateById").mockResolvedValue({} as never);

    // Read 2: a refresh. Read 3: the refresh after pausing a rule.
    await act(async () => {
      fireEvent.click(screen.getByTestId("compliance-hero-refresh"));
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("switch", {
          name: "Check members against Verified email",
        }),
      );
    });

    const paused: TeamComplianceStatusJSON = standardStatus();
    paused.complianceSettings[0]!.enabled = false;

    await act(async () => {
      newer.resolve(respondWith(paused));
    });
    await act(async () => {
      older.resolve(respondWith(standardStatus()));
    });

    expect(
      within(ruleRow(EMAIL_RULE_ID)).getByTestId("compliance-rule-paused"),
    ).toBeInTheDocument();
  });
});

describe("reloading, when reads overlap", () => {
  /*
   * A caller that saved something awaits reload() to know the page now shows
   * a status read after its save. When a newer read overtook its own, that
   * promise used to resolve at once with nothing written - and a toggle
   * dropped its "saving" state and snapped back to the status from before.
   */
  const mountHook: () => Promise<
    RenderHookResult<TeamComplianceStatusState, unknown>
  > = async (): Promise<
    RenderHookResult<TeamComplianceStatusState, unknown>
  > => {
    const hook: RenderHookResult<TeamComplianceStatusState, unknown> =
      renderHook(() => {
        return useTeamComplianceStatus(TEAM_ID);
      });

    await waitFor(() => {
      expect(hook.result.current.status).not.toBeNull();
    });

    return hook;
  };

  test("an overtaken reload resolves only once the newest read has put its status on the page", async () => {
    const hook: RenderHookResult<TeamComplianceStatusState, unknown> =
      await mountHook();

    const olderRead: Deferred<never> = deferred<never>();
    const newerRead: Deferred<never> = deferred<never>();
    apiGet
      .mockReturnValueOnce(olderRead.promise)
      .mockReturnValueOnce(newerRead.promise);

    let olderSettled: boolean | null = null;
    let newerSettled: boolean | null = null;

    await act(async () => {
      hook.result.current.reload().then((applied: boolean) => {
        olderSettled = applied;
      });
      hook.result.current.reload().then((applied: boolean) => {
        newerSettled = applied;
      });
    });

    await act(async () => {
      olderRead.resolve(respondWith(standardStatus()));
    });

    // Overtaken, and the newest read is still out: nothing is known yet.
    expect(olderSettled).toBeNull();
    expect(newerSettled).toBeNull();

    await act(async () => {
      newerRead.resolve(respondWith(withPaused([EMAIL_RULE_ID])));
    });

    expect(olderSettled).toBe(true);
    expect(newerSettled).toBe(true);
    expect(hook.result.current.status?.complianceSettings[0]!.enabled).toBe(
      false,
    );
  });

  test("when the newest read fails, every reload waiting on it says so", async () => {
    const hook: RenderHookResult<TeamComplianceStatusState, unknown> =
      await mountHook();

    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Compliance is down");
    const olderRead: Deferred<never> = deferred<never>();
    apiGet
      .mockReturnValueOnce(olderRead.promise)
      .mockImplementationOnce(failWith("boom"));

    const settled: Array<boolean> = [];

    await act(async () => {
      const older: Promise<boolean> = hook.result.current.reload();
      const newer: Promise<boolean> = hook.result.current.reload();

      olderRead.resolve(respondWith(standardStatus()));
      settled.push(await older, await newer);
    });

    expect(settled).toEqual([false, false]);
    expect(hook.result.current.error).toBe("Compliance is down");
  });

  test("a reload nobody overtook resolves to whether it loaded", async () => {
    const hook: RenderHookResult<TeamComplianceStatusState, unknown> =
      await mountHook();

    let applied: boolean | null = null;

    await act(async () => {
      applied = await hook.result.current.reload();
    });

    expect(applied).toBe(true);
  });
});

describe("an answer from an older API", () => {
  /*
   * During a rolling deploy a browser holding this bundle can be answered by
   * an older App replica, whose payload has no rule ids, no counts and no
   * scope. The page used to parse it and then contradict itself: the member's
   * square for the rule she fails read "met" beside "Needs attention", and
   * the rule's switch would have saved to a made-up id.
   */
  const legacyPayload: JSONObject = {
    teamId: TEAM_ID.toString(),
    teamName: "Legacy",
    complianceSettings: [
      { ruleType: "HasNotificationEmailMethod", enabled: true },
    ],
    userComplianceStatuses: [
      {
        userId: JANE_ID,
        userName: "Jane Doe",
        userEmail: "jane@acme.com",
        nonCompliantRules: [
          { ruleType: "HasNotificationEmailMethod", reason: EMAIL_REASON },
        ],
      },
    ],
  };

  test("the page agrees with itself, and offers nothing that would write a made-up id", async () => {
    mockPermissions = EDITOR;
    const updateById: jest.SpyInstance = jest.spyOn(ModelAPI, "updateById");
    const deleteItem: jest.SpyInstance = jest.spyOn(ModelAPI, "deleteItem");
    apiGet.mockResolvedValue({ data: legacyPayload } as never);

    render(<TeamViewCompliance {...PAGE_PROPS} />);
    await screen.findByTestId("team-compliance-page");

    const jane: HTMLElement = screen.getByTestId(
      `compliance-member-${JANE_ID}`,
    );
    const square: HTMLElement = within(jane).getByRole("img", {
      name: /^Verified email: /,
    });

    expect(square).toHaveAttribute("data-result", "fail");
    expect(square).toHaveAttribute(
      "aria-label",
      `Verified email: not met. ${EMAIL_REASON}`,
    );
    expect(jane).toHaveTextContent("0 of 1");
    expect(
      within(jane).getByTestId("compliance-member-status"),
    ).toHaveTextContent("Needs attention");

    const rule: HTMLElement = screen.getByRole("listitem", {
      name: "Verified email",
    });

    expect(
      within(rule).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent(/^0 of 1 member meets itShow the 1 who fails it$/);
    expect(within(rule).queryByRole("switch")).toBeNull();
    expect(within(rule).queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(within(rule).queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(rule).toHaveTextContent("Refresh the page to change this rule");
    expect(screen.queryByRole("switch")).toBeNull();

    // Adding a rule names no existing one, so it stays on offer.
    expect(screen.getByRole("button", { name: "Add rule" })).not.toBeDisabled();
    expect(updateById).not.toHaveBeenCalled();
    expect(deleteItem).not.toHaveBeenCalled();
  });
});

describe("the verdict", () => {
  test("some members need attention", async () => {
    await renderPage();

    expect(screen.getByTestId("compliance-hero-badge")).toHaveTextContent(
      "2 need attention",
    );
    expect(screen.getByTestId("compliance-hero-headline")).toHaveTextContent(
      "1 of 3 members meets every rule",
    );
    expect(screen.getByTestId("compliance-hero-subline")).toHaveTextContent(
      /^Checked against 2 active rules · checked .+ ago$/,
    );
    expect(
      screen.getByRole("img", {
        name: "1 of 3 members compliant, 2 need attention",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("compliance-hero-bar")).toHaveTextContent(
      "33% compliant67% need attention",
    );
  });

  test("the fact strip", async () => {
    await renderPage();

    expect(screen.getByTestId("compliance-fact-members")).toHaveTextContent(
      "Members3",
    );
    expect(screen.getByTestId("compliance-fact-compliant")).toHaveTextContent(
      "Compliant1",
    );
    expect(screen.getByTestId("compliance-fact-attention")).toHaveTextContent(
      "Need attention2",
    );
    expect(screen.getByTestId("compliance-fact-rules")).toHaveTextContent(
      "Active rules2",
    );
  });

  test("the check time is a real <time>", async () => {
    await renderPage();

    const time: HTMLElement = screen
      .getByTestId("compliance-hero-subline")
      .querySelector("time") as HTMLElement;

    expect(time).toHaveAttribute("datetime", EVALUATED_AT);
  });

  test("with nothing measured, the check time is its own sentence, not a clause trailing a full stop", async () => {
    await renderPage(
      buildStatus({
        complianceSettings: [],
      }),
    );

    const subline: HTMLElement = screen.getByTestId("compliance-hero-subline");

    expect(subline).toHaveTextContent(
      /^Add a rule to say what everyone on this team must set up to be reachable - for example, a phone call for critical incidents\. Last checked .+ ago\.$/,
    );
    expect(subline.textContent).not.toContain(". ·");
  });

  test("everyone compliant", async () => {
    const status: TeamComplianceStatusJSON = buildStatus({
      complianceSettings: [emailRule({ compliantCount: 2 })],
      userComplianceStatuses: [
        buildMember(),
        buildMember({ userId: OMAR_ID, userName: "Omar Haddad" }),
      ],
    });

    await renderPage(status);

    expect(screen.getByTestId("compliance-hero-badge")).toHaveTextContent(
      "All compliant",
    );
    expect(screen.getByTestId("compliance-hero-headline")).toHaveTextContent(
      "All 2 members meet every rule",
    );
    expect(screen.getByTestId("compliance-hero-subline")).toHaveTextContent(
      "Checked against 1 active rule ·",
    );
    expect(
      screen.getByTestId("compliance-hero-bar-compliant"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("compliance-hero-bar-attention"),
    ).not.toBeInTheDocument();
  });

  test("paused rules are counted separately", async () => {
    const status: TeamComplianceStatusJSON = standardStatus();
    status.complianceSettings.push(
      alertRule({ settingId: PAUSED_RULE_ID, enabled: false }),
    );

    await renderPage(status);

    expect(screen.getByTestId("compliance-hero-subline")).toHaveTextContent(
      "Checked against 2 active rules (1 paused)",
    );
    expect(screen.getByTestId("compliance-fact-rules")).toHaveTextContent(
      "Active rules21 paused",
    );
  });

  test("no rules yet: a neutral verdict, and no members section", async () => {
    await renderPage(buildStatus({ userComplianceStatuses: [buildMember()] }));

    expect(screen.getByTestId("compliance-hero-badge")).toHaveTextContent(
      "No active rules",
    );
    expect(screen.getByTestId("compliance-hero-headline")).toHaveTextContent(
      "Nothing is being checked yet",
    );
    expect(screen.queryByTestId("compliance-hero-bar")).toBeNull();
    // Nothing is measured, so the compliant counts are neither numbers nor green.
    const compliant: HTMLElement = screen.getByTestId(
      "compliance-fact-compliant",
    );

    expect(compliant).toHaveTextContent("Compliant—");
    expect(compliant.querySelector("dd span")?.className).toContain(
      "text-gray-900",
    );
    expect(within(compliant).queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("compliance-members")).toBeNull();
  });

  test("every rule paused", async () => {
    await renderPage(
      buildStatus({
        complianceSettings: [
          emailRule({ enabled: false }),
          callForIncidentsRule({ enabled: false }),
        ],
        userComplianceStatuses: [buildMember()],
      }),
    );

    expect(screen.getByTestId("compliance-hero-headline")).toHaveTextContent(
      "All 2 rules are paused",
    );
    expect(screen.getByTestId("compliance-hero-badge")).toHaveTextContent(
      "No active rules",
    );
    expect(
      screen.getByTestId("compliance-members-no-active-rules"),
    ).toBeInTheDocument();
  });

  /*
   * A rule of a type this build does not recognise is listed, switched ON,
   * and not checked. "Turn a rule on" and "every rule is paused" both sent
   * the admin to a switch that was already on.
   */
  test("an enabled rule of an unrecognised type: not checked, not called paused", async () => {
    await renderPage(
      buildStatus({
        complianceSettings: [
          buildRule({
            settingId: "pigeon",
            ruleType: "HasCarrierPigeon" as ComplianceRuleType,
          }),
        ],
        userComplianceStatuses: [
          buildMember(),
          buildMember({ userId: OMAR_ID }),
        ],
      }),
    );

    expect(screen.getByTestId("compliance-hero-headline")).toHaveTextContent(
      "No rule is being checked",
    );

    const subline: HTMLElement = screen.getByTestId("compliance-hero-subline");

    expect(subline).toHaveTextContent(
      "Nobody is being checked right now. This team's rule is of a type this version does not recognise, so it is not checked. Delete it and add a supported rule.",
    );
    expect(subline).not.toHaveTextContent("Turn a rule on");

    const members: HTMLElement = screen.getByTestId(
      "compliance-members-no-active-rules",
    );

    expect(members).toHaveTextContent(
      "No rule on this team can be checked right now, so none of its 2 members are being checked.",
    );
    expect(members).not.toHaveTextContent("paused");
    expect(members).not.toHaveTextContent("Turn a rule back on");
  });

  test("a paused rule beside an unrecognised one: both said, in the hero and the members section", async () => {
    await renderPage(
      buildStatus({
        complianceSettings: [
          emailRule({ enabled: false }),
          buildRule({
            settingId: "pigeon",
            ruleType: "HasCarrierPigeon" as ComplianceRuleType,
          }),
        ],
        userComplianceStatuses: [buildMember()],
      }),
    );

    const advice: string =
      "1 rule is paused and 1 rule is of a type this version does not recognise. Turn a paused rule on, or replace the unrecognised one.";

    expect(screen.getByTestId("compliance-hero-subline")).toHaveTextContent(
      advice,
    );
    expect(
      screen.getByTestId("compliance-members-no-active-rules"),
    ).toHaveTextContent(advice);
  });

  test("a team with nobody on it", async () => {
    await renderPage(buildStatus({ complianceSettings: [emailRule()] }));

    expect(screen.getByTestId("compliance-hero-headline")).toHaveTextContent(
      "This team has no members to check",
    );
    expect(screen.getByText("No members on this team yet")).toBeInTheDocument();
  });

  test("pressing a count filters the members section, pressing it again clears it", async () => {
    await renderPage();

    const attention: HTMLElement = screen.getByRole("button", {
      name: "Show the 2 members who need attention",
    });

    expect(attention).toHaveAttribute("aria-pressed", "false");
    expect(attention).toHaveAttribute("aria-controls", "compliance-members");

    fireEvent.click(attention);

    expect(attention).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("radio", { name: /Needs attention/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.queryByTestId(`compliance-member-${PRIYA_ID}`),
    ).not.toBeInTheDocument();

    fireEvent.click(attention);

    expect(screen.getByRole("radio", { name: /All/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByTestId(`compliance-member-${PRIYA_ID}`),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Show the 1 compliant member" }),
    );

    expect(
      screen.queryByTestId(`compliance-member-${JANE_ID}`),
    ).not.toBeInTheDocument();
  });

  test("a count of nobody is not pressable", async () => {
    await renderPage(
      buildStatus({
        complianceSettings: [emailRule({ compliantCount: 1 })],
        userComplianceStatuses: [buildMember()],
      }),
    );

    expect(
      within(screen.getByTestId("compliance-fact-attention")).queryByRole(
        "button",
      ),
    ).toBeNull();
  });
});

describe("rule warnings", () => {
  test("a rule on a channel the project has switched off", async () => {
    const status: TeamComplianceStatusJSON = standardStatus();
    status.complianceSettings[1]!.warnings = [CALL_WARNING];

    await renderPage(status);

    const banner: HTMLElement = screen.getByTestId("compliance-rule-warnings");

    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("1 rule has a problem members cannot fix");
    expect(
      screen.getByTestId(`compliance-rule-warning-${CALL_RULE_ID}`),
    ).toHaveTextContent(`${CALL_LABEL}: ${CALL_WARNING}`);
    expect(
      within(banner).getByRole("link", { name: /Open notification settings/ }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/settings/notification-settings`,
    );
    expect(
      within(ruleRow(CALL_RULE_ID)).getByTestId("compliance-rule-warning-chip"),
    ).toHaveAttribute("aria-label", `Warning: ${CALL_WARNING}`);
  });

  test("several rules, and no settings link when no switchable channel is involved", async () => {
    const status: TeamComplianceStatusJSON = buildStatus({
      complianceSettings: [
        buildRule({
          settingId: "push",
          ruleType: ComplianceRuleType.HasNotificationPushMethod,
          warnings: ["Push is not configured for this server."],
        }),
        buildRule({
          settingId: "pigeon",
          ruleType: "HasCarrierPigeon" as ComplianceRuleType,
          warnings: ["This rule type is not recognised, so it is not checked."],
        }),
      ],
      userComplianceStatuses: [buildMember()],
    });

    await renderPage(status);

    expect(screen.getByTestId("compliance-rule-warnings")).toHaveTextContent(
      "2 rules have problems members cannot fix",
    );
    expect(
      screen.queryByTestId("compliance-rule-warnings-settings-link"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("compliance-rule-warning-pigeon"),
    ).toHaveTextContent(
      "HasCarrierPigeon: This rule type is not recognised, so it is not checked.",
    );
  });

  test("a paused rule's warnings wait until it is turned back on", async () => {
    const status: TeamComplianceStatusJSON = standardStatus();
    status.complianceSettings[1]!.enabled = false;
    status.complianceSettings[1]!.warnings = [CALL_WARNING];

    await renderPage(status);

    expect(
      screen.queryByTestId("compliance-rule-warnings"),
    ).not.toBeInTheDocument();
  });

  test("no warnings, no banner", async () => {
    await renderPage();

    expect(
      screen.queryByTestId("compliance-rule-warnings"),
    ).not.toBeInTheDocument();
  });
});

describe("the rules card", () => {
  test("a method rule", async () => {
    await renderPage();

    const row: HTMLElement = ruleRow(EMAIL_RULE_ID);

    expect(within(row).getByTestId("compliance-rule-title")).toHaveTextContent(
      "Verified email",
    );
    expect(
      within(row).getByTestId("compliance-rule-sentence"),
    ).toHaveTextContent("Every member has a verified email address.");
    expect(within(row).queryByTestId("compliance-rule-scope")).toBeNull();
    expect(
      within(row).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent("2 of 3 members meet it");
    expect(
      within(row).getByRole("img", { name: "2 of 3 members meet this rule" }),
    ).toBeInTheDocument();
  });

  test("an on-call rule on a channel for chosen severities", async () => {
    await renderPage();

    const row: HTMLElement = ruleRow(CALL_RULE_ID);

    expect(within(row).getByTestId("compliance-rule-title")).toHaveTextContent(
      "Call for incidents",
    );
    expect(
      within(row).getByTestId("compliance-rule-sentence"),
    ).toHaveTextContent(
      "Every member has an incident on-call rule that notifies them by Call for Critical Incident and Major Incident.",
    );

    const scope: HTMLElement = within(row).getByTestId("compliance-rule-scope");

    expect(scope).toHaveAttribute("aria-label", "Rule scope");
    expect(
      within(scope).getByTestId(`compliance-rule-severity-${CRITICAL_ID}`),
    ).toHaveTextContent("Critical Incident");
    // The severity's own colour marks its chip.
    expect(
      within(scope)
        .getByTestId(`compliance-rule-severity-${CRITICAL_ID}`)
        .querySelector("span[aria-hidden='true']"),
    ).toHaveStyle({ backgroundColor: "#ff0000" });
    expect(
      within(scope).getByTestId("compliance-rule-channel"),
    ).toHaveTextContent("Call");
    expect(
      within(scope).queryByTestId("compliance-rule-all-severities"),
    ).toBeNull();
  });

  test("an any-channel rule for every severity", async () => {
    const status: TeamComplianceStatusJSON = standardStatus();
    status.complianceSettings.push(alertRule({ compliantCount: 3 }));

    await renderPage(status);

    const row: HTMLElement = ruleRow(ALERT_RULE_ID);

    expect(within(row).getByTestId("compliance-rule-title")).toHaveTextContent(
      "Alert on-call rules",
    );
    expect(
      within(row).getByTestId("compliance-rule-all-severities"),
    ).toHaveTextContent("All alert severities");
    expect(
      within(row).getByTestId("compliance-rule-channel"),
    ).toHaveTextContent("Any channel");
    expect(
      within(row).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent("All 3 meet it");
    expect(
      within(row).getByRole("img", { name: "All 3 meet this rule" }),
    ).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Show the/ })).toBeNull();
  });

  /*
   * The row's headline number. It read "1 of 1 all meet it" and "0 of 1
   * members meet it" before.
   */
  test("a one-member team's pass rate reads as English", async () => {
    await renderPage(
      buildStatus({
        complianceSettings: [
          emailRule({ compliantCount: 1 }),
          callForIncidentsRule({ nonCompliantCount: 1 }),
        ],
        userComplianceStatuses: [
          buildMember({
            nonCompliantRules: [issue(callForIncidentsRule(), CALL_REASON)],
          }),
        ],
      }),
    );

    expect(
      within(ruleRow(EMAIL_RULE_ID)).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent(/^1 of 1 member meets it$/);
    expect(
      within(ruleRow(CALL_RULE_ID)).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent(/^0 of 1 member meets itShow the 1 who fails it$/);
    expect(
      within(ruleRow(CALL_RULE_ID)).getByRole("img", {
        name: "0 of 1 member meets this rule",
      }),
    ).toBeInTheDocument();
  });

  test("nobody meeting a rule on a bigger team", async () => {
    const status: TeamComplianceStatusJSON = standardStatus();
    status.complianceSettings[1]!.compliantCount = 0;
    status.complianceSettings[1]!.nonCompliantCount = 3;

    await renderPage(status);

    expect(
      within(ruleRow(CALL_RULE_ID)).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent(/^0 of 3 members meet it/);
  });

  test("episode rules", async () => {
    await renderPage(
      buildStatus({
        complianceSettings: [
          buildRule({
            settingId: "episodes",
            ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
            notificationChannel: ComplianceNotificationChannel.SMS,
            appliesToAllSeverities: true,
          }),
        ],
        userComplianceStatuses: [buildMember()],
      }),
    );

    expect(
      within(ruleRow("episodes")).getByTestId("compliance-rule-title"),
    ).toHaveTextContent("SMS for incident episodes");
    expect(
      within(ruleRow("episodes")).getByTestId("compliance-rule-all-severities"),
    ).toHaveTextContent("All incident severities");
  });

  test("a paused rule", async () => {
    const status: TeamComplianceStatusJSON = standardStatus();
    status.complianceSettings.push(
      alertRule({ settingId: PAUSED_RULE_ID, enabled: false }),
    );

    await renderPage(status);

    const row: HTMLElement = ruleRow(PAUSED_RULE_ID);

    expect(within(row).getByTestId("compliance-rule-paused")).toHaveTextContent(
      "Paused",
    );
    expect(
      within(row).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent("Paused - not checked");
  });

  test("a rule type this build does not know", async () => {
    await renderPage(
      buildStatus({
        complianceSettings: [
          buildRule({
            settingId: "pigeon",
            ruleType: "HasCarrierPigeon" as ComplianceRuleType,
          }),
        ],
        userComplianceStatuses: [buildMember()],
      }),
    );

    const row: HTMLElement = ruleRow("pigeon");

    expect(within(row).getByTestId("compliance-rule-title")).toHaveTextContent(
      "HasCarrierPigeon",
    );
    expect(
      within(row).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent("Not checked");
  });

  test("a team with no members", async () => {
    await renderPage(buildStatus({ complianceSettings: [emailRule()] }));

    expect(
      within(ruleRow(EMAIL_RULE_ID)).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent("No members to check");
  });

  test("rules are listed in the order the server gives", async () => {
    await renderPage();

    expect(
      screen
        .getAllByTestId("compliance-rule-title")
        .map((title: HTMLElement): string => {
          return title.textContent || "";
        }),
    ).toEqual(["Verified email", "Call for incidents"]);
  });
});

describe("who may change rules", () => {
  test("an editor can add, pause, edit and delete", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    expect(screen.getByRole("button", { name: "Add rule" })).not.toBeDisabled();
    expect(
      screen.getByRole("switch", {
        name: "Check members against Verified email",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("button", { name: `Edit ${CALL_LABEL}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Delete ${CALL_LABEL}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: `Check members against ${CALL_LABEL}`,
      }),
    ).toBeInTheDocument();
  });

  test("a reader sees the rules but nothing to press, and Add rule says why", async () => {
    mockPermissions = READER;
    await renderPage();

    const add: HTMLElement = screen.getByRole("button", { name: "Add rule" });

    expect(add).toBeDisabled();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(ruleRow(EMAIL_RULE_ID)).toBeInTheDocument();
  });

  test("before permissions load, nothing is offered and nothing is refused", async () => {
    mockPermissions = [];
    await renderPage();

    expect(screen.queryByRole("button", { name: "Add rule" })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  test("an empty team for a reader: no recommendations, and who to ask", async () => {
    mockPermissions = READER;
    await renderPage(buildStatus());

    expect(screen.getByTestId("compliance-rules-empty")).toHaveTextContent(
      "ask a project admin to add one",
    );
    expect(screen.queryByTestId("compliance-presets")).toBeNull();
    expect(screen.queryByTestId("compliance-rules-empty-add")).toBeNull();
  });

  test("a master admin may open other members' setup", async () => {
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    await renderPage();

    expect(
      within(screen.getByTestId(`compliance-member-${JANE_ID}`)).getByTestId(
        "compliance-member-fix-link",
      ),
    ).toBeInTheDocument();
  });

  test("so may anyone who can read members' notification rules", async () => {
    mockPermissions = [Permission.ReadProjectUserNotificationRule];
    await renderPage();

    expect(
      within(screen.getByTestId(`compliance-member-${OMAR_ID}`)).getByTestId(
        "compliance-member-fix-link",
      ),
    ).toBeInTheDocument();
  });

  test("a plain member may not", async () => {
    mockPermissions = READER;
    await renderPage();

    expect(screen.queryByTestId("compliance-member-fix-link")).toBeNull();
  });

  test("the signed-in member gets their own fix links, one per page they need", async () => {
    jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(JANE_ID));
    await renderPage();

    expect(
      within(screen.getByTestId(`compliance-member-${JANE_ID}`))
        .getAllByTestId("compliance-member-fix-self")
        .map((link: HTMLElement): string => {
          return link.textContent || "";
        }),
    ).toEqual([
      "Open my notification methods",
      "Open my incident on-call rules",
    ]);
  });
});

describe("pausing and resuming a rule", () => {
  test("saves only `enabled`, then reads the status once more", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    const updateById: jest.SpyInstance = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);
    const paused: TeamComplianceStatusJSON = standardStatus();
    paused.complianceSettings[0]!.enabled = false;
    apiGet.mockResolvedValue(respondWith(paused));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("switch", {
          name: "Check members against Verified email",
        }),
      );
    });

    expect(updateById).toHaveBeenCalledTimes(1);

    const call: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateById.mock.calls[0]![0];

    expect(call.modelType).toBe(TeamComplianceSetting);
    expect(call.id.toString()).toBe(EMAIL_RULE_ID);
    expect(call.data).toEqual({ enabled: false });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
    expect(
      within(ruleRow(EMAIL_RULE_ID)).getByTestId("compliance-rule-paused"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: "Check members against Verified email",
      }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("a paused rule is turned back on", async () => {
    mockPermissions = EDITOR;
    const status: TeamComplianceStatusJSON = standardStatus();
    status.complianceSettings[0]!.enabled = false;
    await renderPage(status);

    const updateById: jest.SpyInstance = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("switch", {
          name: "Check members against Verified email",
        }),
      );
    });

    expect(updateById.mock.calls[0]![0].data).toEqual({ enabled: true });
  });

  /*
   * The wrapper's pointer-events stop a second CLICK while a save is in
   * flight, but not Space or Enter on the switch that still has focus. That
   * press used to flip the switch's own copy of its value and then be
   * refused, leaving it showing ON beside a "Paused" rule - and the next
   * press then did the opposite of what the switch showed.
   */
  test("a second press while the save is in flight changes nothing, and the switch keeps telling the truth", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    const save: Deferred<never> = deferred<never>();
    const updateById: jest.SpyInstance = jest
      .spyOn(ModelAPI, "updateById")
      .mockReturnValue(save.promise);
    apiGet.mockResolvedValue(respondWith(withPaused([EMAIL_RULE_ID])));

    const emailSwitch: HTMLElement = ruleSwitch("Verified email");

    act(() => {
      emailSwitch.focus();
    });

    await act(async () => {
      fireEvent.click(emailSwitch);
    });

    expect(emailSwitch).toHaveAttribute("aria-checked", "false");
    expect(emailSwitch).toHaveAttribute("aria-disabled", "true");

    // Space on the focused switch, mid-save.
    await act(async () => {
      fireEvent.click(emailSwitch);
    });

    expect(emailSwitch).toHaveAttribute("aria-checked", "false");
    expect(updateById).toHaveBeenCalledTimes(1);

    await act(async () => {
      save.resolve({} as never);
    });
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(emailSwitch).not.toHaveAttribute("aria-disabled");
    });

    // The same element throughout - never remounted - so focus stayed on it.
    expect(ruleSwitch("Verified email")).toBe(emailSwitch);
    expect(emailSwitch).toHaveFocus();
    expect(emailSwitch).toHaveAttribute("aria-checked", "false");
    expect(
      within(ruleRow(EMAIL_RULE_ID)).getByTestId("compliance-rule-paused"),
    ).toBeInTheDocument();

    // The next press does what the switch shows: turns the rule back on.
    updateById.mockResolvedValue({} as never);

    await act(async () => {
      fireEvent.click(emailSwitch);
    });

    expect(updateById).toHaveBeenCalledTimes(2);
    expect(updateById.mock.calls[1]![0].data).toEqual({ enabled: true });
  });

  /*
   * Pause rule A, then rule B before A's refresh is back: A's refresh is
   * overtaken, and its answer dropped. A's switch used to fall back to the
   * status from before its save - ON - until B's refresh landed.
   */
  test("pausing a second rule while the first refreshes never flips the first back on", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    jest.spyOn(ModelAPI, "updateById").mockResolvedValue({} as never);
    const firstRead: Deferred<never> = deferred<never>();
    const secondRead: Deferred<never> = deferred<never>();
    apiGet
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise);

    await act(async () => {
      fireEvent.click(ruleSwitch("Verified email"));
    });
    await act(async () => {
      fireEvent.click(ruleSwitch(CALL_LABEL));
    });

    expect(apiGet).toHaveBeenCalledTimes(3);
    expect(ruleSwitch("Verified email")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(ruleSwitch(CALL_LABEL)).toHaveAttribute("aria-checked", "false");

    // The older, overtaken read lands first.
    await act(async () => {
      firstRead.resolve(respondWith(standardStatus()));
    });

    expect(ruleSwitch("Verified email")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      within(ruleRow(EMAIL_RULE_ID)).getByTestId("compliance-rule-paused"),
    ).toBeInTheDocument();
    // Overtaken is not failed: the newer read is still coming.
    expect(
      screen.queryByTestId(`compliance-rule-refresh-note-${EMAIL_RULE_ID}`),
    ).toBeNull();

    await act(async () => {
      secondRead.resolve(
        respondWith(withPaused([EMAIL_RULE_ID, CALL_RULE_ID])),
      );
    });

    expect(ruleSwitch("Verified email")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(ruleSwitch(CALL_LABEL)).toHaveAttribute("aria-checked", "false");
    expect(
      screen.queryByTestId(`compliance-rule-refresh-note-${EMAIL_RULE_ID}`),
    ).toBeNull();
    expect(screen.getByTestId("compliance-hero-headline")).toHaveTextContent(
      "All 2 rules are paused",
    );
  });

  test("overlapping pauses whose newest refresh fails keep both rules paused, and say the results are older", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    jest.spyOn(ModelAPI, "updateById").mockResolvedValue({} as never);
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Compliance is down");
    const firstRead: Deferred<never> = deferred<never>();
    const secondRead: Deferred<never> = deferred<never>();
    apiGet
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise);

    await act(async () => {
      fireEvent.click(ruleSwitch("Verified email"));
    });
    await act(async () => {
      fireEvent.click(ruleSwitch(CALL_LABEL));
    });
    await act(async () => {
      firstRead.resolve(respondWith(standardStatus()));
    });
    await act(async () => {
      secondRead.reject(new Error("boom"));
    });

    await screen.findByTestId("compliance-hero-refresh-error");

    for (const [settingId, label] of [
      [EMAIL_RULE_ID, "Verified email"],
      [CALL_RULE_ID, CALL_LABEL],
    ] as Array<[string, string]>) {
      expect(ruleSwitch(label)).toHaveAttribute("aria-checked", "false");
      // Not locked: a failed refresh must never leave a switch unpressable.
      expect(ruleSwitch(label)).not.toHaveAttribute("aria-disabled");
      expect(
        within(ruleRow(settingId)).getByTestId("compliance-rule-paused"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`compliance-rule-refresh-note-${settingId}`),
      ).toHaveTextContent(
        "Paused. The results could not be refreshed, so the counts on this page are from before this change.",
      );
    }
  });

  test("a save whose refresh fails keeps showing what was saved until a later read says otherwise", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    jest.spyOn(ModelAPI, "updateById").mockResolvedValue({} as never);
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Compliance is down");
    apiGet.mockImplementationOnce(failWith("boom"));

    await act(async () => {
      fireEvent.click(ruleSwitch("Verified email"));
    });
    await screen.findByTestId("compliance-hero-refresh-error");

    expect(ruleSwitch("Verified email")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      within(ruleRow(EMAIL_RULE_ID)).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent("Paused - not checked");
    expect(
      screen.getByTestId(`compliance-rule-refresh-note-${EMAIL_RULE_ID}`),
    ).toBeInTheDocument();

    // The next read that lands is the truth - here, someone turned it back on.
    apiGet.mockResolvedValue(respondWith(standardStatus()));

    await act(async () => {
      fireEvent.click(screen.getByTestId("compliance-hero-refresh"));
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId(`compliance-rule-refresh-note-${EMAIL_RULE_ID}`),
      ).toBeNull();
    });
    expect(ruleSwitch("Verified email")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("turning a rule on shows it on at once, without the empty counts of the paused rule it was", async () => {
    mockPermissions = EDITOR;
    await renderPage(withPaused([EMAIL_RULE_ID]));

    jest.spyOn(ModelAPI, "updateById").mockResolvedValue({} as never);
    const read: Deferred<never> = deferred<never>();
    apiGet.mockReturnValueOnce(read.promise);

    await act(async () => {
      fireEvent.click(ruleSwitch("Verified email"));
    });

    expect(ruleSwitch("Verified email")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      within(ruleRow(EMAIL_RULE_ID)).queryByTestId("compliance-rule-paused"),
    ).toBeNull();
    expect(
      within(ruleRow(EMAIL_RULE_ID)).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent("Not checked yet");

    await act(async () => {
      read.resolve(respondWith(standardStatus()));
    });

    expect(
      within(ruleRow(EMAIL_RULE_ID)).getByTestId("compliance-rule-pass-rate"),
    ).toHaveTextContent("2 of 3 members meet it");
  });

  test("a failed save says so on the row, moves the switch back, and reads nothing", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    jest.spyOn(ModelAPI, "updateById").mockImplementation(failWith("nope"));
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Permission denied");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("switch", {
          name: "Check members against Verified email",
        }),
      );
    });

    expect(
      await screen.findByTestId(`compliance-rule-error-${EMAIL_RULE_ID}`),
    ).toHaveTextContent("Could not pause this rule. Permission denied");
    expect(
      screen.getByRole("switch", {
        name: "Check members against Verified email",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});

describe("adding and editing rules", () => {
  test("Add rule opens the form enforced by default, for this team", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

    expect(screen.getByTestId("rule-form-modal")).toHaveTextContent(
      "Add a compliance rule",
    );
    expect(capturedFormModal?.initialValues).toEqual({ enabled: true });
    expect(capturedFormModal?.modelIdToEdit).toBeUndefined();

    const item: Record<string, unknown> = {};
    await capturedFormModal?.onBeforeCreate?.(item);

    expect((item["teamId"] as ObjectID).toString()).toBe(TEAM_ID.toString());
    expect((item["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("the project comes from the page when it has one, else the session", async () => {
    mockPermissions = EDITOR;
    apiGet.mockResolvedValue(respondWith(standardStatus()));

    render(
      <TeamViewCompliance
        pageRoute={PAGE_PROPS.pageRoute}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
    await screen.findByTestId("team-compliance-page");

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

    const item: Record<string, unknown> = {};
    await capturedFormModal?.onBeforeCreate?.(item);

    expect((item["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a created rule closes the form and reads the status again", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

    await act(async () => {
      capturedFormModal?.onSuccess?.(new TeamComplianceSetting());
    });

    expect(screen.queryByTestId("rule-form-modal")).toBeNull();
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
  });

  test("closing the form changes nothing", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

    act(() => {
      capturedFormModal?.onClose?.();
    });

    expect(screen.queryByTestId("rule-form-modal")).toBeNull();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test("Edit opens that rule by its id, and saving reads the status again", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: `Edit ${CALL_LABEL}` }));

    expect(screen.getByTestId("rule-form-modal")).toHaveTextContent(
      "Edit compliance rule",
    );
    expect(capturedFormModal?.modelIdToEdit?.toString()).toBe(CALL_RULE_ID);
    expect(capturedFormModal?.initialValues).toBeUndefined();

    await act(async () => {
      capturedFormModal?.onSuccess?.(new TeamComplianceSetting());
    });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
  });
});

describe("two rules of one type and channel", () => {
  /*
   * Call for Critical incidents and Call for Major incidents: both allowed,
   * both titled "Call for incidents". Every control, the delete confirmation
   * and the warnings have to say WHICH one.
   */
  const CRITICAL_CALL_ID: string = "00000000-0000-4000-8000-0000000000b1";
  const MAJOR_CALL_ID: string = "00000000-0000-4000-8000-0000000000b2";

  const twoCallRules: () => TeamComplianceStatusJSON =
    (): TeamComplianceStatusJSON => {
      return buildStatus({
        complianceSettings: [
          callForIncidentsRule({
            settingId: CRITICAL_CALL_ID,
            severities: [{ id: CRITICAL_ID, name: "Critical Incident" }],
            compliantCount: 1,
            warnings: [CALL_WARNING],
          }),
          callForIncidentsRule({
            settingId: MAJOR_CALL_ID,
            severities: [{ id: "major", name: "Major Incident" }],
            compliantCount: 1,
            warnings: [CALL_WARNING],
          }),
        ],
        userComplianceStatuses: [buildMember()],
      });
    };

  test("same title, different names", async () => {
    mockPermissions = EDITOR;
    await renderPage(twoCallRules());

    expect(
      screen
        .getAllByTestId("compliance-rule-title")
        .map((title: HTMLElement): string => {
          return title.textContent || "";
        }),
    ).toEqual(["Call for incidents", "Call for incidents"]);

    for (const [settingId, label] of [
      [CRITICAL_CALL_ID, "Call for incidents for Critical Incident"],
      [MAJOR_CALL_ID, "Call for incidents for Major Incident"],
    ] as Array<[string, string]>) {
      const row: HTMLElement = ruleRow(settingId);

      expect(screen.getByRole("listitem", { name: label })).toBe(row);
      expect(within(row).getByRole("switch")).toHaveAccessibleName(
        `Check members against ${label}`,
      );
      expect(
        within(row).getByRole("button", { name: `Edit ${label}` }),
      ).toBeInTheDocument();
      expect(
        within(row).getByRole("button", { name: `Delete ${label}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`compliance-rule-warning-${settingId}`),
      ).toHaveTextContent(`${label}: ${CALL_WARNING}`);
    }
  });

  test("the delete confirmation names the rule being deleted, scope and all", async () => {
    mockPermissions = EDITOR;
    await renderPage(twoCallRules());

    const deleteItem: jest.SpyInstance = jest
      .spyOn(ModelAPI, "deleteItem")
      .mockResolvedValue(undefined as never);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete Call for incidents for Major Incident",
      }),
    );

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      '"Call for incidents for Major Incident" stops being checked for everyone on this team.',
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(deleteItem.mock.calls[0]![0].id.toString()).toBe(MAJOR_CALL_ID);
  });

  test("the members section's filter chip names the scope too", async () => {
    const status: TeamComplianceStatusJSON = twoCallRules();
    status.complianceSettings[0]!.compliantCount = 0;
    status.complianceSettings[0]!.nonCompliantCount = 1;
    status.userComplianceStatuses[0]!.isCompliant = false;
    status.userComplianceStatuses[0]!.nonCompliantRules = [
      issue(status.complianceSettings[0]!, "No Call rule for Critical"),
    ];

    await renderPage(status);

    fireEvent.click(
      screen.getByTestId(`compliance-rule-show-failing-${CRITICAL_CALL_ID}`),
    );

    expect(
      screen.getByTestId("compliance-members-rule-filter"),
    ).toHaveTextContent("FailingCall for incidents for Critical Incident");
  });
});

describe("deleting a rule", () => {
  test("asks first, then deletes by id and reads the status again", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    const deleteItem: jest.SpyInstance = jest
      .spyOn(ModelAPI, "deleteItem")
      .mockResolvedValue(undefined as never);
    apiGet.mockResolvedValue(
      respondWith(
        buildStatus({
          complianceSettings: [standardStatus().complianceSettings[1]!],
          userComplianceStatuses: standardStatus().userComplianceStatuses,
        }),
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete Verified email" }),
    );

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      '"Verified email" stops being checked for everyone on this team.',
    );
    expect(deleteItem).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(deleteItem).toHaveBeenCalledTimes(1);
    expect(deleteItem.mock.calls[0]![0].modelType).toBe(TeamComplianceSetting);
    expect(deleteItem.mock.calls[0]![0].id.toString()).toBe(EMAIL_RULE_ID);

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId("modal")).toBeNull();
    expect(screen.queryByTestId(`compliance-rule-${EMAIL_RULE_ID}`)).toBeNull();
  });

  test("cancelling deletes nothing", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    const deleteItem: jest.SpyInstance = jest.spyOn(ModelAPI, "deleteItem");

    fireEvent.click(
      screen.getByRole("button", { name: "Delete Verified email" }),
    );
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("modal")).toBeNull();
    expect(deleteItem).not.toHaveBeenCalled();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test("a failed delete stays open and says why", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    jest.spyOn(ModelAPI, "deleteItem").mockImplementation(failWith("nope"));
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Rule is locked");

    fireEvent.click(
      screen.getByRole("button", { name: "Delete Verified email" }),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(
      within(screen.getByTestId("modal")).getByText("Rule is locked"),
    ).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test("deleting the rule the members are filtered by drops the filter", async () => {
    mockPermissions = EDITOR;
    await renderPage();

    fireEvent.click(
      screen.getByTestId(`compliance-rule-show-failing-${EMAIL_RULE_ID}`),
    );
    expect(
      screen.getByTestId("compliance-members-rule-filter"),
    ).toBeInTheDocument();

    jest.spyOn(ModelAPI, "deleteItem").mockResolvedValue(undefined as never);

    fireEvent.click(
      screen.getByRole("button", { name: "Delete Verified email" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(
      screen.queryByTestId("compliance-members-rule-filter"),
    ).not.toBeInTheDocument();
  });
});

describe("an empty team: recommended rules", () => {
  const listResult: (id: string | null) => never = (
    id: string | null,
  ): never => {
    return {
      data: id ? [{ _id: id }] : [],
      count: id ? 1 : 0,
      skip: 0,
      limit: 1,
    } as never;
  };

  beforeEach(() => {
    mockPermissions = EDITOR;
  });

  test("the empty state explains rules and offers four recommendations", async () => {
    await renderPage(buildStatus({ userComplianceStatuses: [buildMember()] }));

    expect(screen.getByTestId("compliance-rules-empty")).toHaveTextContent(
      "No compliance rules yet",
    );
    expect(
      screen
        .getAllByTestId(/^compliance-preset-/)
        .map((preset: HTMLElement): string => {
          return preset.textContent || "";
        }),
    ).toEqual(
      COMPLIANCE_RULE_PRESETS.map(
        (preset: { title: string; description: string }) => {
          return `${preset.title}${preset.description}`;
        },
      ),
    );
    expect(
      COMPLIANCE_RULE_PRESETS.map((preset: { title: string }) => {
        return preset.title;
      }),
    ).toEqual([
      "Call for critical incidents",
      "Push for critical alerts",
      "Incident on-call rules for every severity",
      "Verified phone for calls",
    ]);
  });

  test("the recommendations' heading is readable: AA contrast, not faint grey", async () => {
    await renderPage(buildStatus());

    const heading: HTMLElement = screen.getByRole("heading", {
      name: "Recommended rules",
    });

    // gray-500 on white is 4.8:1; the gray-400 it was is 2.5:1.
    expect(heading).toHaveClass("text-gray-500");
    expect(heading).not.toHaveClass("text-gray-400");
  });

  test("Call for critical incidents opens the form prefilled with the most severe incident severity", async () => {
    await renderPage(buildStatus());

    const getList: jest.SpyInstance = jest
      .spyOn(ModelAPI, "getList")
      .mockResolvedValue(listResult(CRITICAL_ID));

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("compliance-preset-call-for-critical-incidents"),
      );
    });

    expect(getList).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      query: Record<string, unknown>;
      limit: number;
      skip: number;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = getList.mock.calls[0]![0];

    expect(request.modelType).toBe(IncidentSeverity);
    expect(request.limit).toBe(1);
    expect(request.skip).toBe(0);
    expect(request.sort).toEqual({ order: SortOrder.Ascending });
    expect(request.select).toEqual({ _id: true, name: true, order: true });
    expect((request.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );

    // Opened, not created.
    expect(screen.getByTestId("rule-form-modal")).toHaveTextContent(
      "Add a compliance rule",
    );
    expect(capturedFormModal?.initialValues).toEqual({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [CRITICAL_ID],
      enabled: true,
    });
  });

  test("Push for critical alerts preselects the most severe alert severity", async () => {
    await renderPage(buildStatus());

    const getList: jest.SpyInstance = jest
      .spyOn(ModelAPI, "getList")
      .mockResolvedValue(listResult("alert-high"));

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("compliance-preset-push-for-critical-alerts"),
      );
    });

    expect(getList.mock.calls[0]![0].modelType).toBe(AlertSeverity);
    expect(capturedFormModal?.initialValues).toEqual({
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Push,
      alertSeverities: ["alert-high"],
      enabled: true,
    });
  });

  test("when the severities cannot be read, the form opens with none preselected", async () => {
    await renderPage(buildStatus());

    jest.spyOn(ModelAPI, "getList").mockImplementation(failWith("422"));

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("compliance-preset-call-for-critical-incidents"),
      );
    });

    expect(capturedFormModal?.initialValues).toEqual({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      enabled: true,
    });
  });

  test("a project with no severities of that kind: none preselected", async () => {
    await renderPage(buildStatus());

    jest.spyOn(ModelAPI, "getList").mockResolvedValue(listResult(null));

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("compliance-preset-push-for-critical-alerts"),
      );
    });

    expect(capturedFormModal?.initialValues).toEqual({
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Push,
      enabled: true,
    });
  });

  test("presets without a severity open straight away, with no lookup", async () => {
    await renderPage(buildStatus());

    const getList: jest.SpyInstance = jest.spyOn(ModelAPI, "getList");

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          "compliance-preset-incident-rules-for-every-severity",
        ),
      );
    });

    expect(capturedFormModal?.initialValues).toEqual({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      enabled: true,
    });

    act(() => {
      capturedFormModal?.onClose?.();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("compliance-preset-verified-phone-for-calls"),
      );
    });

    expect(capturedFormModal?.initialValues).toEqual({
      ruleType: ComplianceRuleType.HasNotificationCallMethod,
      enabled: true,
    });
    expect(getList).not.toHaveBeenCalled();
  });

  test("while a preset looks up its severity, the presets wait", async () => {
    await renderPage(buildStatus());

    const pending: Deferred<never> = deferred<never>();
    jest.spyOn(ModelAPI, "getList").mockReturnValue(pending.promise);

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("compliance-preset-call-for-critical-incidents"),
      );
    });

    expect(
      screen.getByTestId("compliance-preset-call-for-critical-incidents"),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByTestId("compliance-preset-verified-phone-for-calls"),
    ).toBeDisabled();
    expect(screen.queryByTestId("rule-form-modal")).toBeNull();

    await act(async () => {
      pending.resolve(listResult(CRITICAL_ID));
    });

    expect(screen.getByTestId("rule-form-modal")).toBeInTheDocument();
    expect(
      screen.getByTestId("compliance-preset-verified-phone-for-calls"),
    ).not.toBeDisabled();
  });

  test("or build a custom rule from scratch", async () => {
    await renderPage(buildStatus());

    fireEvent.click(screen.getByTestId("compliance-rules-empty-add"));

    expect(capturedFormModal?.initialValues).toEqual({ enabled: true });
  });
});

describe("from a rule to the members failing it", () => {
  test("shows who fails a rule, and pressing again shows everyone", async () => {
    await renderPage();

    const showFailing: HTMLElement = screen.getByTestId(
      `compliance-rule-show-failing-${CALL_RULE_ID}`,
    );

    expect(showFailing).toHaveTextContent("Show the 2 who fail it");
    expect(showFailing).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(showFailing);

    expect(showFailing).toHaveAttribute("aria-pressed", "true");
    expect(showFailing).toHaveTextContent("Showing who fails it");
    expect(
      screen.getByTestId("compliance-members-rule-filter"),
    ).toHaveTextContent("Call for incidents");
    expect(
      screen.queryByTestId(`compliance-member-${PRIYA_ID}`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`compliance-member-${OMAR_ID}`),
    ).toBeInTheDocument();

    fireEvent.click(showFailing);

    expect(
      screen.queryByTestId("compliance-members-rule-filter"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`compliance-member-${PRIYA_ID}`),
    ).toBeInTheDocument();
  });

  test("the chip in the members section clears it too", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByTestId(`compliance-rule-show-failing-${EMAIL_RULE_ID}`),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear the rule filter" }),
    );

    expect(
      screen.getByTestId(`compliance-rule-show-failing-${EMAIL_RULE_ID}`),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("a rule filter replaces a 'Compliant' filter, which would hide everyone", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("radio", { name: /Compliant/ }));
    fireEvent.click(
      screen.getByTestId(`compliance-rule-show-failing-${EMAIL_RULE_ID}`),
    );

    expect(screen.getByRole("radio", { name: /All/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByTestId(`compliance-member-${JANE_ID}`),
    ).toBeInTheDocument();
  });

  /*
   * Everyone failing a rule needs attention, so "Compliant" plus a rule
   * filter is always nobody - "0 of 3 members" under a count that promised 1.
   * Choosing Compliant drops the rule filter, wherever it is chosen.
   */
  test("choosing Compliant in the hero drops the rule filter", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByTestId(`compliance-rule-show-failing-${CALL_RULE_ID}`),
    );
    expect(
      screen.getByTestId("compliance-members-rule-filter"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Show the 1 compliant member" }),
    );

    expect(
      screen.queryByTestId("compliance-members-rule-filter"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("compliance-members-no-match"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`compliance-member-${PRIYA_ID}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`compliance-rule-show-failing-${CALL_RULE_ID}`),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("so does the members section's Compliant segment", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByTestId(`compliance-rule-show-failing-${EMAIL_RULE_ID}`),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Compliant/ }));

    expect(
      screen.queryByTestId("compliance-members-rule-filter"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("compliance-members-count")).toHaveTextContent(
      "1 of 3 members",
    );
    expect(
      screen.getByTestId(`compliance-member-${PRIYA_ID}`),
    ).toBeInTheDocument();
  });

  test("Needs attention keeps the rule filter: it narrows the same people", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByTestId(`compliance-rule-show-failing-${EMAIL_RULE_ID}`),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Needs attention/ }));

    expect(
      screen.getByTestId("compliance-members-rule-filter"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`compliance-member-${JANE_ID}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`compliance-member-${OMAR_ID}`),
    ).not.toBeInTheDocument();
  });

  test("once everybody passes the rule, the filter goes away", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByTestId(`compliance-rule-show-failing-${EMAIL_RULE_ID}`),
    );

    const fixed: TeamComplianceStatusJSON = standardStatus();
    fixed.complianceSettings[0]!.compliantCount = 3;
    fixed.complianceSettings[0]!.nonCompliantCount = 0;
    fixed.userComplianceStatuses[2]!.nonCompliantRules = [
      issue(fixed.complianceSettings[1]!, CALL_REASON),
    ];
    apiGet.mockResolvedValue(respondWith(fixed));

    await act(async () => {
      fireEvent.click(screen.getByTestId("compliance-hero-refresh"));
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("compliance-members-rule-filter"),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`compliance-member-${PRIYA_ID}`),
    ).toBeInTheDocument();
  });

  test("the members section shows each failure with its reason", async () => {
    await renderPage();

    expect(
      within(screen.getByTestId(`compliance-member-${JANE_ID}`)).getByTestId(
        "compliance-member-issues",
      ),
    ).toHaveTextContent(`Verified email: ${EMAIL_REASON}`);
  });
});

describe("the team-compliance plugin keys", () => {
  test("the assembled Enterprise plugin carries the Compliance page", () => {
    const plugins: DashboardEnterprisePlugins = EnterpriseDashboardPlugins;

    expect(plugins.TeamCompliance).toBe(TeamCompliancePlugins.TeamCompliance);
  });

  /*
   * The status table used to have a key of its own, read only by a core
   * shell nothing rendered. The key, that shell and this lazy entry are gone.
   */
  test("the area provides the Compliance page only, not the status table", () => {
    expect(Object.keys(TeamCompliancePlugins)).toEqual(["TeamCompliance"]);
    expect(
      Object.keys(EnterpriseDashboardPlugins).includes(
        "TeamComplianceStatusTable",
      ),
    ).toBe(false);
  });

  test("the Compliance page is lazy", () => {
    const lazyType: symbol = Symbol.for("react.lazy");

    expect(
      (TeamCompliancePlugins.TeamCompliance as unknown as { $$typeof: symbol })
        .$$typeof,
    ).toBe(lazyType);
  });

  test("the lazy Compliance page reads the status once and again after a rule changes", async () => {
    mockPermissions = EDITOR;

    const CompliancePlugin: NonNullable<
      DashboardEnterprisePlugins["TeamCompliance"]
    > = TeamCompliancePlugins.TeamCompliance!;

    render(
      <React.Suspense fallback={<div data-testid="loading" />}>
        <CompliancePlugin
          pageRoute={new Route("/dashboard/p/settings/teams/t/compliance")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </React.Suspense>,
    );

    expect(
      await screen.findByTestId(`compliance-member-${JANE_ID}`),
    ).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

    await act(async () => {
      capturedFormModal?.onSuccess?.(new TeamComplianceSetting());
    });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
  });

  test("the lazy Compliance page resolves to the Enterprise page", async () => {
    const CompliancePlugin: NonNullable<
      DashboardEnterprisePlugins["TeamCompliance"]
    > = TeamCompliancePlugins.TeamCompliance!;

    render(
      <React.Suspense fallback={<div data-testid="loading" />}>
        <CompliancePlugin
          pageRoute={new Route("/dashboard/p/settings/teams/t/compliance")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </React.Suspense>,
    );

    expect(
      await screen.findByTestId("team-compliance-page"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("compliance-hero")).toBeInTheDocument();
  });
});

const EE_DASHBOARD_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Dashboard",
);

const TEAM_COMPLIANCE_DIR: string = path.join(
  EE_DASHBOARD_DIR,
  "TeamCompliance",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const IMPORT_SPECIFIER: RegExp =
  /(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g;

const sourceOf: (file: string) => string = (file: string): string => {
  return fs
    .readFileSync(path.join(TEAM_COMPLIANCE_DIR, file), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1");
};

const importsOf: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  const source: string = sourceOf(file);
  const specifiers: Array<string> = [];
  const pattern: RegExp = new RegExp(IMPORT_SPECIFIER.source, "g");
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    specifiers.push(match[1] as string);
    match = pattern.exec(source);
  }

  return specifiers;
};

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

const TEAM_COMPLIANCE_FILES: Array<string> = fs
  .readdirSync(TEAM_COMPLIANCE_DIR)
  .filter((file: string): boolean => {
    return TYPESCRIPT_FILE.test(file);
  })
  .sort();

describe("the team-compliance screens' imports", () => {
  test("the screens are where the rest of ee expects them", () => {
    expect(TEAM_COMPLIANCE_FILES).toEqual(
      expect.arrayContaining([
        "Compliance.tsx",
        "Plugins.ts",
        "TeamComplianceStatusTable.tsx",
      ]),
    );
  });

  test("the page takes the members section from ee/, never from core", () => {
    const specifiers: Array<string> = importsOf("Compliance.tsx");

    expect(specifiers).toContain("./TeamComplianceStatusTable");
    expect(specifiers).not.toContain(
      "@oneuptime/dashboard/Components/Team/TeamComplianceStatusTable",
    );
  });

  test("the plugin entry lazy-loads the Compliance page, and not the status table", () => {
    const specifiers: Array<string> = importsOf("Plugins.ts");

    expect(specifiers).toContain("./Compliance");
    expect(specifiers).not.toContain("./TeamComplianceStatusTable");
  });

  test.each(TEAM_COMPLIANCE_FILES)(
    "%s never reads the plugins",
    (file: string) => {
      const specifiers: Array<string> = importsOf(file);

      expect(specifiers).not.toContain(
        "@oneuptime/dashboard/Enterprise/Plugins",
      );
      expect(specifiers).not.toContain("@oneuptime/ee-dashboard");
      expect(specifiers).not.toContain(
        "@oneuptime/dashboard/Pages/Teams/View/Compliance",
      );
    },
  );

  test.each(TEAM_COMPLIANCE_FILES)(
    "%s reaches core only as Common/... or @oneuptime/dashboard/...",
    (file: string) => {
      for (const specifier of importsOf(file)) {
        expect(
          specifier === "react" ||
            specifier.startsWith("./") ||
            specifier.startsWith("Common/") ||
            specifier.startsWith("@oneuptime/dashboard/"),
        ).toBe(true);
      }
    },
  );

  test.each(TEAM_COMPLIANCE_FILES)(
    "%s makes no request of its own outside the refresh-aware clients",
    (file: string) => {
      const source: string = sourceOf(file);

      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/XMLHttpRequest/);
      expect(importsOf(file)).not.toContain("Common/Utils/API");
    },
  );

  test("only the page's status hook reads the compliance route", () => {
    const readers: Array<string> = TEAM_COMPLIANCE_FILES.filter(
      (file: string): boolean => {
        return sourceOf(file).includes("/team/compliance-status/");
      },
    );

    expect(readers).toEqual(["useTeamComplianceStatus.ts"]);
  });
});

/*
 * Pinned so a change to the fixture that every suite here leans on is a
 * deliberate one.
 */
describe("the fixtures", () => {
  test("describe a team with two active rules and three members", () => {
    const status: TeamComplianceStatusJSON = standardStatus();

    expect(
      status.complianceSettings.map((rule: TeamComplianceRuleJSON) => {
        return rule.settingId;
      }),
    ).toEqual([EMAIL_RULE_ID, CALL_RULE_ID]);
    expect(status.userComplianceStatuses).toHaveLength(3);
  });
});
