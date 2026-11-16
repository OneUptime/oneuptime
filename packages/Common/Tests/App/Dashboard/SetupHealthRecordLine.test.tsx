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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import type { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import SetupHealthApi, {
  getSetupHealthRecordUrl,
  isSetupHealthRecordAnswer,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthApi";
import SetupHealthRecordFindings, {
  getRecordLineFindings,
  getSetupHealthPageRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthRecordFindings";
import SetupHealthView from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthView";
import { RECORD_LINE_LOOK } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthLook";
import SetupHealthQuickFixApi from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthQuickFix";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  SETUP_HEALTH_LEVEL_ORDER,
  SETUP_HEALTH_WORDS,
  SetupHealthAnswer,
  SetupHealthCheck,
  SetupHealthEventKind,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthRecordKind,
  getSetupHealthCounts,
  makeSetupHealthFinding,
} from "../../../Types/SetupHealth/SetupHealth";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import User from "../../../UI/Utils/User";

/*
 * A RECORD'S FINDINGS AT THE TOP OF ITS PAGE (#7297): the Setup Health
 * page's own sentence and fix for the record, Dismiss, and nothing at all
 * when there is nothing to say - nor what the page's own cards already say.
 */

const POLICY: string = "68127297-0000-4000-8000-0000000000b1";
const STATUS_PAGE: string = "68127297-0000-4000-8000-0000000000e1";
const DOMAIN: string = "68127297-0000-4000-8000-0000000000e2";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const POLICY_NOT_RUN: SetupHealthFinding = makeSetupHealthFinding({
  check: SetupHealthCheck.PolicyNotRun,
  level: SetupHealthLevel.WorthFixing,
  record: {
    kind: SetupHealthRecordKind.OnCallDutyPolicy,
    id: POLICY,
    name: "Secondary",
  },
  fix: SetupHealthFix.IncidentOnCallRules,
  words: SETUP_HEALTH_WORDS.policyNotRun,
  values: { policy: "Secondary" },
});

const POLICY_NO_LEVELS: SetupHealthFinding = makeSetupHealthFinding({
  check: SetupHealthCheck.PolicyHasNoEscalationRules,
  level: SetupHealthLevel.PagesWillNotArrive,
  record: {
    kind: SetupHealthRecordKind.OnCallDutyPolicy,
    id: POLICY,
    name: "Secondary",
  },
  fix: SetupHealthFix.OnCallPolicy,
  fixRecordId: POLICY,
  words: SETUP_HEALTH_WORDS.policyHasNoEscalationRules,
  values: { policy: "Secondary" },
});

const DOMAIN_NOT_VERIFIED: SetupHealthFinding = makeSetupHealthFinding({
  check: SetupHealthCheck.StatusPageDomainNotVerified,
  level: SetupHealthLevel.WorthFixing,
  record: {
    kind: SetupHealthRecordKind.StatusPageDomain,
    id: DOMAIN,
    name: "status.acme.com",
  },
  related: [
    { kind: SetupHealthRecordKind.StatusPage, id: STATUS_PAGE, name: "Acme" },
  ],
  fix: SetupHealthFix.StatusPageDomains,
  fixRecordId: STATUS_PAGE,
  words: SETUP_HEALTH_WORDS.statusPageDomainNotVerified,
  values: { domain: "status.acme.com", statusPage: "Acme" },
});

function answer(findings: Array<SetupHealthFinding>): SetupHealthAnswer {
  return {
    findings: findings,
    dismissed: [],
    counts: getSetupHealthCounts(findings),
    monitorCount: 3,
    checkedAt: new Date().toISOString(),
  };
}

describe("the record's line, as data", () => {
  test("asks the server for one record, by its kind and id", () => {
    expect(
      getSetupHealthRecordUrl({
        kind: SetupHealthRecordKind.OnCallDutyPolicy,
        id: POLICY,
      }).toString(),
    ).toMatch(
      new RegExp(`/setup-health/record\\?kind=OnCallDutyPolicy&id=${POLICY}$`),
    );
    // Worked out again only when asked: after a fix made from the line.
    expect(
      getSetupHealthRecordUrl(
        { kind: SetupHealthRecordKind.StatusPage, id: STATUS_PAGE },
        { refresh: true },
      ).toString(),
    ).toMatch(
      new RegExp(
        `/setup-health/record\\?kind=StatusPage&id=${STATUS_PAGE}&refresh=true$`,
      ),
    );
  });

  test("only an answer with findings and a time is drawn", () => {
    expect(
      isSetupHealthRecordAnswer({ findings: [], checkedAt: "2026-11-16" }),
    ).toBe(true);
    expect(isSetupHealthRecordAnswer({ findings: [] })).toBe(false);
    expect(isSetupHealthRecordAnswer("<html>")).toBe(false);
    expect(isSetupHealthRecordAnswer(null)).toBe(false);
  });

  test("leaves out what the page's own cards say, and keeps the rest in order", () => {
    expect(
      getRecordLineFindings(
        [POLICY_NO_LEVELS, POLICY_NOT_RUN],
        [SetupHealthCheck.PolicyHasNoEscalationRules],
      ),
    ).toEqual([POLICY_NOT_RUN]);
    expect(getRecordLineFindings([POLICY_NO_LEVELS, POLICY_NOT_RUN])).toEqual([
      POLICY_NO_LEVELS,
      POLICY_NOT_RUN,
    ]);
  });

  test("opens Setup Health from the record, which its opened event says", () => {
    expect(getSetupHealthPageRoute().toString()).toBe(
      `${RouteUtil.populateRouteParams(
        RouteMap[PageMap.HOME_SETUP_HEALTH] as Route,
      ).toString()}?from=record`,
    );
  });

  test("each level has its panel's colours", () => {
    for (const level of SETUP_HEALTH_LEVEL_ORDER) {
      expect(RECORD_LINE_LOOK[level]).toMatch(/^border-\w+-200 bg-\w+-50$/);
    }
  });
});

describe("the record's line on its page", () => {
  let getRecordFindings: SpyInstance<typeof SetupHealthApi.getRecordFindings>;

  function renderLine(props: {
    kind: SetupHealthRecordKind;
    id: string;
    saidByThisPage?: Array<SetupHealthCheck>;
  }): void {
    render(
      <MemoryRouter>
        <SetupHealthRecordFindings
          recordKind={props.kind}
          recordId={new ObjectID(props.id)}
          saidByThisPage={props.saidByThisPage}
        />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    getRecordFindings = jest.spyOn(SetupHealthApi, "getRecordFindings");
    jest.spyOn(ProductEvents, "send").mockImplementation(() => {
      return undefined;
    });
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest
      .spyOn(PermissionGate, "checkColumnUpdate")
      .mockReturnValue({ isAllowed: true });
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("a policy nothing runs says so at the top of its page, with Set Up Paging, Dismiss and Setup Health", async () => {
    getRecordFindings.mockResolvedValue([POLICY_NOT_RUN]);
    renderLine({ kind: SetupHealthRecordKind.OnCallDutyPolicy, id: POLICY });

    const line: HTMLElement = await screen.findByTestId(
      "setup-health-record-finding",
    );

    expect(getRecordFindings).toHaveBeenCalledWith(
      {
        kind: SetupHealthRecordKind.OnCallDutyPolicy,
        id: POLICY,
      },
      { refresh: false },
    );
    expect(within(line).getByTestId("setup-health-sentence").textContent).toBe(
      POLICY_NOT_RUN.sentence,
    );
    expect(within(line).getByTestId("setup-health-name")).toHaveTextContent(
      "Secondary",
    );
    expect(within(line).getByTestId("setup-health-fix")).toHaveTextContent(
      "Set Up Paging",
    );
    expect(
      within(line).getByTestId("setup-health-dismiss"),
    ).toBeInTheDocument();
    expect(
      within(line)
        .getByTestId("setup-health-record-page-link")
        .getAttribute("href"),
    ).toBe(getSetupHealthPageRoute().toString());
    expect(line.className).toContain(
      RECORD_LINE_LOOK[SetupHealthLevel.WorthFixing],
    );
  });

  test("the line and the Setup Health page say the same finding in the same sentence, with the same fix", async () => {
    getRecordFindings.mockResolvedValue([POLICY_NOT_RUN]);
    jest
      .spyOn(SetupHealthApi, "getAnswer")
      .mockResolvedValue(answer([POLICY_NOT_RUN]));

    renderLine({ kind: SetupHealthRecordKind.OnCallDutyPolicy, id: POLICY });

    const line: HTMLElement = await screen.findByTestId(
      "setup-health-record-finding",
    );
    const lineSentence: string | null = within(line).getByTestId(
      "setup-health-sentence",
    ).textContent;
    const lineFix: string | null = within(line)
      .getByTestId("setup-health-fix")
      .getAttribute("href");

    cleanup();
    render(
      <MemoryRouter>
        <SetupHealthView />
      </MemoryRouter>,
    );

    const row: HTMLElement = await screen.findByTestId("setup-health-finding");

    expect(within(row).getByTestId("setup-health-sentence").textContent).toBe(
      lineSentence,
    );
    expect(
      within(row).getByTestId("setup-health-fix").getAttribute("href"),
    ).toBe(lineFix);
  });

  test("what the page's own cards say is left out; with nothing else, nothing is drawn", async () => {
    getRecordFindings.mockResolvedValue([POLICY_NO_LEVELS]);
    renderLine({
      kind: SetupHealthRecordKind.OnCallDutyPolicy,
      id: POLICY,
      saidByThisPage: [SetupHealthCheck.PolicyHasNoEscalationRules],
    });

    await waitFor(() => {
      expect(getRecordFindings).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("setup-health-record")).toBeNull();
  });

  test("a record with no finding, or one whose findings could not be read, draws nothing", async () => {
    getRecordFindings.mockResolvedValue([]);
    renderLine({ kind: SetupHealthRecordKind.OnCallDutyPolicy, id: POLICY });

    await waitFor(() => {
      expect(getRecordFindings).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("setup-health-record")).toBeNull();

    cleanup();
    getRecordFindings.mockRejectedValue(new Error("Server is down."));
    renderLine({ kind: SetupHealthRecordKind.OnCallDutyPolicy, id: POLICY });

    await waitFor(() => {
      expect(getRecordFindings).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId("setup-health-record")).toBeNull();
    expect(screen.queryByText("Server is down.")).toBeNull();
  });

  test("a status page's line says its custom domain's finding, whose fix opens the page's Custom Domains", async () => {
    getRecordFindings.mockResolvedValue([DOMAIN_NOT_VERIFIED]);
    renderLine({ kind: SetupHealthRecordKind.StatusPage, id: STATUS_PAGE });

    const line: HTMLElement = await screen.findByTestId(
      "setup-health-record-finding",
    );

    expect(line).toHaveTextContent(DOMAIN_NOT_VERIFIED.sentence);
    expect(
      within(line).getByTestId("setup-health-fix").getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route,
        { modelId: new ObjectID(STATUS_PAGE) },
      ).toString(),
    );
  });

  test("Dismiss asks why, hides it for everyone, and the line reads its findings again", async () => {
    getRecordFindings.mockResolvedValue([POLICY_NOT_RUN]);
    const dismiss: SpyInstance<typeof SetupHealthApi.dismiss> = jest
      .spyOn(SetupHealthApi, "dismiss")
      .mockResolvedValue(undefined as never);
    renderLine({ kind: SetupHealthRecordKind.OnCallDutyPolicy, id: POLICY });

    fireEvent.click(await screen.findByTestId("setup-health-dismiss"));
    fireEvent.change(screen.getByTestId("setup-health-dismiss-reason"), {
      target: { value: "Paged by hand." },
    });
    getRecordFindings.mockResolvedValue([]);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(dismiss).toHaveBeenCalledWith({
        finding: POLICY_NOT_RUN,
        reason: "Paged by hand.",
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("setup-health-record")).toBeNull();
    });
    expect(getRecordFindings).toHaveBeenCalledTimes(2);
  });

  test("a fix made from the line works the record's findings out again, so the one fixed is gone", async () => {
    const MONITOR: string = "68127297-0000-4000-8000-0000000000a1";
    const pagesNobody: SetupHealthFinding = makeSetupHealthFinding({
      check: SetupHealthCheck.MonitorPagesNobody,
      level: SetupHealthLevel.WorthFixing,
      subject: SetupHealthEventKind.Incident,
      record: {
        kind: SetupHealthRecordKind.Monitor,
        id: MONITOR,
        name: "Checkout API",
      },
      fix: SetupHealthFix.IncidentOnCallRules,
      words: SETUP_HEALTH_WORDS.monitorPagesNobody.incident,
      values: { monitor: "Checkout API" },
    });

    getRecordFindings.mockResolvedValue([pagesNobody]);
    jest
      .spyOn(SetupHealthQuickFixApi, "getPolicies")
      .mockResolvedValue([{ id: POLICY, name: "Primary" }]);
    const create: SpyInstance<typeof SetupHealthQuickFixApi.createOnCallRule> =
      jest
        .spyOn(SetupHealthQuickFixApi, "createOnCallRule")
        .mockResolvedValue(undefined as never);
    renderLine({ kind: SetupHealthRecordKind.Monitor, id: MONITOR });

    fireEvent.click(await screen.findByTestId("setup-health-quick-fix"));
    await screen.findByTestId("setup-health-quick-fix-change");

    getRecordFindings.mockResolvedValue([]);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(create).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(getRecordFindings).toHaveBeenLastCalledWith(
        { kind: SetupHealthRecordKind.Monitor, id: MONITOR },
        { refresh: true },
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("setup-health-record")).toBeNull();
    });
  });

  test("someone who may not dismiss is not offered Dismiss", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: false });
    getRecordFindings.mockResolvedValue([POLICY_NOT_RUN]);
    renderLine({ kind: SetupHealthRecordKind.OnCallDutyPolicy, id: POLICY });

    const line: HTMLElement = await screen.findByTestId(
      "setup-health-record-finding",
    );

    expect(within(line).queryByTestId("setup-health-dismiss")).toBeNull();
    expect(within(line).getByTestId("setup-health-fix")).toBeInTheDocument();
  });
});

/*
 * The pages that draw the line, and what each leaves out because its own
 * cards say it: read from their source, so a page and its list never part.
 */
describe("the pages that draw it", () => {
  function source(file: string): string {
    return fs.readFileSync(path.join(DASHBOARD_SRC, file), "utf8");
  }

  test("an on-call policy's Overview, leaving out what its summary and What runs this policy say", () => {
    const page: string = source("Pages/OnCallDuty/OnCallDutyPolicy/Index.tsx");
    const summary: string = source(
      "Components/OnCallPolicy/OnCallPolicySummary.tsx",
    );
    const usedByWords: string = source("Components/UsedBy/UsedByWords.ts");

    expect(page).toContain(
      "recordKind={SetupHealthRecordKind.OnCallDutyPolicy}",
    );
    expect(page).toContain("saidByThisPage={POLICY_PAGE_SAYS}");
    expect(page).toMatch(
      /POLICY_PAGE_SAYS[^=]*=\s*\[\s*SetupHealthCheck\.PolicyHasNoEscalationRules,\s*SetupHealthCheck\.PolicyReachesNobody,\s*SetupHealthCheck\.PolicyNotRun,\s*\]/,
    );
    // What the summary says in their stead.
    expect(summary).toContain(
      "This policy has no escalation rules yet, so triggering it will not page anyone.",
    );
    expect(summary).toContain("with no one on call right now");
    // And What runs this policy (#7758), on the same page.
    expect(page).toContain("recordKind={UsedByRecordKind.OnCallPolicy}");
    expect(usedByWords).toContain(
      "No on-call rule, monitor or template pages it, so it pages nobody.",
    );
    // The line comes first: before the policy's details.
    expect(page.indexOf("<SetupHealthRecordFindings")).toBeLessThan(
      page.indexOf("<CardModelDetail"),
    );
  });

  test("a status page's Overview, leaving out what its first step says", () => {
    const page: string = source("Pages/StatusPages/View/Index.tsx");

    expect(page).toContain("recordKind={SetupHealthRecordKind.StatusPage}");
    expect(page).toContain("saidByThisPage={STATUS_PAGE_OVERVIEW_SAYS}");
    expect(page).toMatch(
      /STATUS_PAGE_OVERVIEW_SAYS[^=]*=\s*\[\s*SetupHealthCheck\.StatusPageShowsNoMonitor,\s*\]/,
    );
    expect(page).toContain("<StatusPageFirstStep statusPageId={modelId} />");
  });

  test("not a schedule's Overview, whose Final Schedule says every reason nobody is on call, nor Custom Domains, whose Status column says each domain's", () => {
    expect(
      source("Pages/OnCallDuty/OnCallDutySchedule/Index.tsx"),
    ).not.toContain("SetupHealthRecordFindings");
    expect(source("Pages/StatusPages/View/Domains.tsx")).not.toContain(
      "SetupHealthRecordFindings",
    );
  });
});
