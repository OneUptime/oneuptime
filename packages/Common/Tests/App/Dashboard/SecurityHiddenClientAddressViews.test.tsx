/** @timezone UTC */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import { SecurityAttackCampaignsResult } from "../../../Types/SecurityEvent/SecurityAttackCampaign";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  HiddenClientAddress,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  ScrubbedAddressRole,
  markAddressScrubbed,
  markClientAddressScrubbed,
  nameAddressScrubRule,
  nameClientAddressScrubRule,
} from "../../../Utils/SecurityEvent/ScrubbedAddress";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { refuseRequestsTo } from "../../Helpers/RealNetworkRequests";
import { getHiddenAddressRulesRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressRoute";
import HiddenClientAddressText, {
  HIDDEN_CLIENT_ADDRESS_TEST_ID,
  HIDDEN_TARGET_ADDRESS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressText";
import SecurityEventDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailPanel";
import SecurityEventWhatHappenedNext, {
  WHAT_HAPPENED_NEXT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventWhatHappenedNext";
import { readSecurityEventRequestFacts } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventRequestStory";
import SecurityAttackCampaigns, {
  SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityAttackCampaigns";
import SecurityOverviewStatus, {
  SECURITY_ADDRESS_SCRUB_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatus";
import { SecuritySetupStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel";
import { SecurityOverviewQueue } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatusModel";

/*
 * An address a scrub rule hid, as a reader sees it (#10397): where an
 * event's address would be, "Hidden by the scrub rule Scrub IP addresses",
 * the rule's name opening the Scrub Rules it is in; who sent a request, in
 * What happened next; a campaign's row; and the Overview's line that says
 * which rule keeps Security Events from naming attackers' addresses, with
 * Open Scrub Rules.
 */

// The drawer's source sentence asks for its service's name: refused at once.
refuseRequestsTo(["/service/*/get-item"]);

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: string = "44444444-4444-4444-8444-444444444444";

const getAttackCampaignsMock: MockFunction = getJestMockFunction();
const getConnectionsMock: MockFunction = getJestMockFunction();
const getTelemetryMentionsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        getAttackCampaigns: (...args: Array<unknown>) => {
          return getAttackCampaignsMock(...args);
        },
        getConnections: (...args: Array<unknown>) => {
          return getConnectionsMock(...args);
        },
        getTelemetryMentions: (...args: Array<unknown>) => {
          return getTelemetryMentionsMock(...args);
        },
      },
    };
  },
);

function hidden(
  overrides: Partial<HiddenClientAddress> = {},
): HiddenClientAddress {
  return {
    kind: ScrubbedAddressKind.Redacted,
    value: "[REDACTED]",
    place: ScrubbedAddressPlace.LogBody,
    signal: "log",
    ruleId: RULE_ID,
    ruleName: "Scrub IP addresses",
    ...overrides,
  };
}

// An event as a scan stores it once a log rule hid its client's address.
function hiddenEvent(ruleName: string = "Scrub IP addresses"): SecurityEvent {
  const attributes: JSONObject = { "web.attack.kind": "path-traversal" };

  markClientAddressScrubbed(attributes, {
    scrubbed: { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
    place: ScrubbedAddressPlace.LogBody,
  });

  if (ruleName) {
    nameClientAddressScrubRule(attributes, { id: RULE_ID, name: ruleName });
  }

  return Object.assign(new SecurityEvent(), {
    time: new Date("2026-11-20T10:00:05.000Z"),
    eventUid: "log:abc:0",
    severityName: OcsfSeverity.Low,
    className: "HTTP Activity",
    activityName: "GET",
    message: "Path traversal attempt: GET /static/../../etc/passwd → 404",
    principalIp: "",
    observables: [],
    requestOutcome: SecurityEventRequestOutcome.Rejected,
    attributes,
  });
}

function inRouter(element: React.ReactElement): React.ReactElement {
  return <MemoryRouter>{element}</MemoryRouter>;
}

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getAttackCampaignsMock.mockReset();
  getConnectionsMock.mockReset();
  getTelemetryMentionsMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("where an event's address would be", () => {
  test("names the rule that hid it, its name opening the logs' Scrub Rules", () => {
    render(inRouter(<HiddenClientAddressText hidden={hidden()} />));

    const text: HTMLElement = screen.getByTestId(HIDDEN_CLIENT_ADDRESS_TEST_ID);

    expect(text).toHaveTextContent(
      "Hidden by the scrub rule Scrub IP addresses",
    );

    const link: HTMLElement = within(text).getByRole("link", {
      name: "Scrub IP addresses",
    });

    expect(link.getAttribute("href")).toBe(
      getHiddenAddressRulesRoute("log")!.toString(),
    );
    expect(link.getAttribute("href")).toContain(PROJECT_ID.toString());
  });

  test("says a scrub rule hid it when no rule explains it, the whole sentence the link, to the traces' rules for a span", () => {
    render(
      inRouter(
        <HiddenClientAddressText
          hidden={hidden({
            ruleId: "",
            ruleName: "",
            place: ScrubbedAddressPlace.SpanAttributes,
            signal: "trace",
          })}
        />,
      ),
    );

    const link: HTMLElement = screen.getByRole("link", {
      name: "Hidden by a scrub rule",
    });

    expect(link.getAttribute("href")).toBe(
      getHiddenAddressRulesRoute("trace")!.toString(),
    );
  });

  test("without a kind of rules to open, it is a sentence alone", () => {
    render(
      inRouter(
        <HiddenClientAddressText
          hidden={hidden({ place: null, signal: null, ruleName: "" })}
        />,
      ),
    );

    expect(screen.getByTestId(HIDDEN_CLIENT_ADDRESS_TEST_ID)).toHaveTextContent(
      "Hidden by a scrub rule",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("never shows what the rule left", () => {
    render(
      inRouter(
        <HiddenClientAddressText
          hidden={hidden({
            kind: ScrubbedAddressKind.Hashed,
            value: "[HASHED:3f9a1c0e7b2d4a68]",
          })}
        />,
      ),
    );

    expect(
      screen.getByTestId(HIDDEN_CLIENT_ADDRESS_TEST_ID),
    ).not.toHaveTextContent("HASHED");
  });
});

describe("the event's drawer", () => {
  test("Principal IP says which scrub rule hid the address, and filters the list to every such event", () => {
    const onFilterBy: MockFunction = getJestMockFunction();

    render(
      inRouter(
        <SecurityEventDetailPanel
          securityEvent={hiddenEvent()}
          onClose={(): void => {}}
          onFilterBy={(facetKey: string, value: string): void => {
            onFilterBy(facetKey, value);
          }}
        />,
      ),
    );

    const label: HTMLElement = screen.getByText("Principal IP");
    const row: HTMLElement = label.closest("div")!;

    expect(row).toHaveTextContent(
      "Hidden by the scrub rule Scrub IP addresses",
    );
    expect(
      within(row).getByRole("link", { name: "Scrub IP addresses" }),
    ).toBeInTheDocument();
    expect(row).not.toHaveTextContent("[REDACTED]");

    fireEvent.click(
      within(row).getByRole("button", {
        name: "Show events whose address a scrub rule hid",
      }),
    );

    expect(onFilterBy).toHaveBeenCalledWith(
      "attributes.oneuptime.request.client_address_hidden",
      "scrub-rule",
    );
  });

  /*
   * #10419: a firewall's connection whose destination a scrub rule hid says
   * so on Target IP, and its own filter shows every event whose
   * destination a rule hid; the source the event names stays its address.
   */
  test("Target IP says which scrub rule hid the destination, and filters to every such event", () => {
    const onFilterBy: MockFunction = getJestMockFunction();
    const attributes: JSONObject = {};

    markAddressScrubbed(attributes, {
      role: ScrubbedAddressRole.Target,
      scrubbed: { kind: ScrubbedAddressKind.Masked, value: "***.***.***.***" },
      place: ScrubbedAddressPlace.LogBody,
    });
    nameAddressScrubRule(attributes, ScrubbedAddressRole.Target, {
      id: RULE_ID,
      name: "Mask IP addresses",
    });

    render(
      inRouter(
        <SecurityEventDetailPanel
          securityEvent={Object.assign(new SecurityEvent(), {
            time: new Date("2026-11-20T10:00:05.000Z"),
            eventUid: "log:def:0",
            severityName: OcsfSeverity.Low,
            className: "Network Activity",
            activityName: "Refuse",
            message: "ms-rdp from 203.0.113.7 to ***.***.***.***:3389 blocked",
            principalIp: "203.0.113.7",
            targetIp: "",
            targetPort: 3389,
            observables: ["203.0.113.7"],
            attributes,
          })}
          onClose={(): void => {}}
          onFilterBy={(facetKey: string, value: string): void => {
            onFilterBy(facetKey, value);
          }}
        />,
      ),
    );

    const target: HTMLElement = screen.getByTestId(
      HIDDEN_TARGET_ADDRESS_TEST_ID,
    );
    const row: HTMLElement = screen.getByText("Target IP").closest("div")!;

    expect(target).toHaveTextContent("Hidden by the scrub rule Mask IP addresses");
    expect(
      within(row).getByRole("link", { name: "Mask IP addresses" }),
    ).toBeInTheDocument();
    expect(row).not.toHaveTextContent("***");
    // The source is no hidden address.
    expect(screen.queryByTestId(HIDDEN_CLIENT_ADDRESS_TEST_ID)).toBeNull();
    expect(screen.getByText("Principal IP").closest("div")!).toHaveTextContent(
      "203.0.113.7",
    );

    fireEvent.click(
      within(row).getByRole("button", {
        name: "Show events whose target address a scrub rule hid",
      }),
    );

    expect(onFilterBy).toHaveBeenCalledWith(
      "attributes.oneuptime.target_address_hidden",
      "scrub-rule",
    );
  });
});

describe("What happened next", () => {
  test("says the request came from an address a scrub rule hid, where it would name the address", () => {
    render(
      inRouter(
        <SecurityEventWhatHappenedNext
          facts={readSecurityEventRequestFacts(hiddenEvent())}
          hasTrace={false}
          isReadingTrace={false}
        />,
      ),
    );

    const section: HTMLElement = screen.getByTestId(WHAT_HAPPENED_NEXT_TEST_ID);

    expect(section).toHaveTextContent("From an address a scrub rule hid");
    expect(section).not.toHaveTextContent("[REDACTED]");
  });

  test("names the address when the event does", () => {
    const named: SecurityEvent = hiddenEvent();
    named.principalIp = "203.0.113.7";

    render(
      inRouter(
        <SecurityEventWhatHappenedNext
          facts={readSecurityEventRequestFacts(named)}
          hasTrace={false}
          isReadingTrace={false}
        />,
      ),
    );

    const section: HTMLElement = screen.getByTestId(WHAT_HAPPENED_NEXT_TEST_ID);

    expect(section).toHaveTextContent("From 203.0.113.7");
    expect(section).not.toHaveTextContent("scrub rule");
  });
});

describe("Campaigns", () => {
  test("the row of requests whose address a scrub rule hid says so, not Unknown address", async () => {
    const result: SecurityAttackCampaignsResult = {
      campaigns: [
        {
          sourceIp: "",
          requestCount: 12,
          rejectedCount: 12,
          reachedAppCount: 0,
          erroredCount: 0,
          reachedDatabaseCount: 0,
          worstOutcome: SecurityEventRequestOutcome.Rejected,
          maxSeverityId: 2,
          attackKinds: ["path-traversal"],
          userAgents: [],
          targetCount: 3,
          sampleTargets: ["/static/../../etc/passwd"],
          firstSeen: "2026-11-20T10:00:00.000Z",
          lastSeen: "2026-11-20T10:05:00.000Z",
          hiddenAddressCount: 12,
        },
      ],
      startTime: "2026-11-13T12:00:00.000Z",
      endTime: "2026-11-20T12:00:00.000Z",
      isTruncated: false,
    };
    getAttackCampaignsMock.mockResolvedValue(result as never);

    render(inRouter(<SecurityAttackCampaigns />));

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID,
    );

    expect(rows).toHaveLength(1);
    expect(
      within(rows[0]!).getByTestId("security-attack-campaign-address"),
    ).toHaveTextContent("Hidden by a scrub rule");
    expect(rows[0]).not.toHaveTextContent("Unknown address");
  });
});

describe("the Overview's card", () => {
  function status(
    overrides: Partial<SecuritySetupStatus> = {},
  ): SecuritySetupStatus {
    return {
      connections: 0,
      logsSourceEnabled: true,
      telemetrySourcesEnabled: 1,
      eventsLast24Hours: 12,
      lastEventAt: new Date("2026-11-20T11:00:00.000Z"),
      enabledRules: 19,
      recommendedRules: 19,
      recommendedRulesOn: 19,
      threatIntelFeeds: 0,
      openCases: 0,
      enabledPlaybooks: 1,
      destinations: 0,
      ...overrides,
    };
  }

  const QUEUE: SecurityOverviewQueue = {
    openCases: 0,
    criticalOpenCases: 0,
    highOpenCases: 0,
    myOpenCases: 0,
    unassignedOpenCases: 0,
    runsWaitingForApproval: 0,
  };

  function renderCard(value: SecuritySetupStatus, showPipeline: boolean): void {
    render(
      inRouter(
        <SecurityOverviewStatus
          queue={QUEUE}
          status={value}
          showPipeline={showPipeline}
          hasStatusFailed={false}
          isReading={false}
          now={new Date("2026-11-20T12:00:00.000Z")}
          onChanged={(): void => {}}
          onTryAgain={(): void => {}}
          onSetUp={(): void => {}}
        />,
      ),
    );
  }

  test("says IP addresses are scrubbed from the logs and the traces Security Events reads, which rule does it, and opens its Scrub Rules", () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    renderCard(
      status({
        addressScrubRules: [
          {
            signal: "log",
            ruleId: RULE_ID,
            ruleName: "Scrub IP addresses",
            scrubAction: LogScrubAction.Redact,
          },
          {
            signal: "trace",
            ruleId: "55555555-5555-4555-8555-555555555555",
            ruleName: "Mask IPs in spans",
            scrubAction: LogScrubAction.Mask,
          },
        ],
      }),
      true,
    );

    const logs: HTMLElement = screen.getByTestId(
      `${SECURITY_ADDRESS_SCRUB_TEST_ID}-log`,
    );
    const traces: HTMLElement = screen.getByTestId(
      `${SECURITY_ADDRESS_SCRUB_TEST_ID}-trace`,
    );

    expect(logs).toHaveTextContent(
      "IP addresses are scrubbed from your logs, so Security Events can't tell you which address to block.",
    );
    expect(logs).toHaveTextContent(
      "The scrub rule Scrub IP addresses redacts them.",
    );
    expect(traces).toHaveTextContent(
      "IP addresses are scrubbed from your traces, so Security Events can't tell you which address to block.",
    );
    expect(traces).toHaveTextContent(
      "The scrub rule Mask IPs in spans masks them.",
    );

    fireEvent.click(
      within(traces).getByRole("button", { name: "Open Scrub Rules" }),
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0]![0] as Route).toString()).toBe(
      getHiddenAddressRulesRoute("trace")!.toString(),
    );
  });

  test("says it while Get started is on the page too, and nothing without such a rule", () => {
    renderCard(
      status({
        addressScrubRules: [
          {
            signal: "log",
            ruleId: RULE_ID,
            ruleName: "Scrub IP addresses",
            scrubAction: LogScrubAction.Redact,
          },
        ],
      }),
      false,
    );

    expect(
      screen.getByTestId(`${SECURITY_ADDRESS_SCRUB_TEST_ID}-log`),
    ).toBeInTheDocument();
    cleanup();

    renderCard(status(), true);

    expect(
      screen.queryByTestId(`${SECURITY_ADDRESS_SCRUB_TEST_ID}-log`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`${SECURITY_ADDRESS_SCRUB_TEST_ID}-trace`),
    ).toBeNull();
  });
});
