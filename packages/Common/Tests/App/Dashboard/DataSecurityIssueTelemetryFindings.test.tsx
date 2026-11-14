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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DataSecurityApi, {
  DataSecurityApiError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import FindingOccurrences, {
  FINDING_OCCURRENCES_TEST_ID,
  NONE_IN_WINDOW,
  UNAVAILABLE_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/FindingOccurrences";
import {
  getOccurrenceLinks,
  getOccurrenceLogsRoute,
  getTelemetryStoreOwnerRoute,
  NEIGHBOUR_LOGS_WINDOW_IN_SECONDS,
  OccurrenceLink,
  OccurrenceLinkKind,
  REQUEST_LOGS_WINDOW_IN_MINUTES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/FindingOccurrenceLinks";
import IssueTelemetryFindings, {
  getFindingsBehindIssue,
  getIssueFindingsSelect,
  ISSUE_TELEMETRY_FINDINGS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueTelemetryFindings";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  DataSecurityFindingOccurrence,
  DataSecurityFindingOccurrences,
  DataSecurityOccurrenceRecordKind,
  DataSecurityOccurrencesUnavailableReason,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";
import type { Mock, SpyInstance } from "jest-mock";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * WHAT A TELEMETRY ISSUE FOUND, WHERE, AND THE RECORDS IT WAS IN
 * (Components/DataSecurity/IssueTelemetryFindings, issue #5594).
 *
 * An issue's page names each kind of data behind a telemetry issue and the
 * place it sits, with its masked samples and Scrub It, and opens the
 * newest records that carry it - each leading to the trace, the logs, the
 * exception or the session replay. A Security Viewer reads what was found
 * and where, never a sample or a record.
 */

configure({ asyncUtilTimeout: 15000 });

const SERVICE_ID: string = "1a1a1a1a-0000-4000-8000-0000000000a1";
const WEB_APP_ID: string = "2b2b2b2b-0000-4000-8000-0000000000b2";
const STORE_ID: string = "3c3c3c3c-0000-4000-8000-0000000000c3";
const PPS_ID: string = "4d4d4d4d-0000-4000-8000-0000000000d4";
const IP_ID: string = "5e5e5e5e-0000-4000-8000-0000000000e5";
const EMAIL_ID: string = "6f6f6f6f-0000-4000-8000-0000000000f6";
const TOKEN_ID: string = "7a7a7a7a-0000-4000-8000-0000000000a7";
const LOW_ID: string = "8b8b8b8b-0000-4000-8000-0000000000b8";

const OWNER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.ProjectOwner,
];

const VIEWER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.SecurityViewer,
];

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

function findingOf(
  id: string,
  overrides: Partial<DataStoreFinding> = {},
): DataStoreFinding {
  const finding: DataStoreFinding = new DataStoreFinding(new ObjectID(id));
  finding.dataTypeId = "ie-ppsn";
  finding.dataTypeName = "Ireland PPS number";
  finding.sensitivity = DataSensitivity.Restricted;
  finding.location = "attributes.user.pps";
  finding.locationKind = "Attribute";
  finding.confidence = DataConfidence.High;
  finding.matchCount = 48;
  finding.valueCount = 50;
  finding.isScrubbed = false;
  finding.isSuppressed = false;
  finding.isConfirmed = false;
  finding.isAiSuggested = false;
  finding.lastSeenAt = new Date(Date.now() - 3 * 60 * 1000);
  finding.maskedSamples = ["******7A", "******2W"];
  Object.assign(finding, overrides);
  return finding;
}

function issueOf(checkId: string = "sensitive-data-in-telemetry"): {
  issue: DataSecurityIssue;
  store: DataStore;
} {
  const store: DataStore = new DataStore(new ObjectID(STORE_ID));
  store.name = "oneuptime-app · Traces";
  store.kind = DataStoreKind.TelemetryTraces;
  store.serviceId = new ObjectID(SERVICE_ID);
  store.storeKey = `telemetry:${SERVICE_ID}:Traces`;
  const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());
  issue.checkId = checkId;
  issue.dataStoreId = new ObjectID(STORE_ID);
  issue.dataStore = store;
  return { issue, store };
}

const SPAN: DataSecurityFindingOccurrence = {
  time: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  recordKind: DataSecurityOccurrenceRecordKind.Span,
  serviceId: SERVICE_ID,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
  name: "POST /api/signup",
  maskedValue: "******7A",
};

let stored: Array<DataStoreFinding>;
let listSpy: ReturnType<typeof jest.spyOn>;
let occurrencesSpy: SpyInstance<typeof DataSecurityApi.getFindingOccurrences>;
let scrubSpy: SpyInstance<typeof DataSecurityApi.scrubFinding>;
let onChanged: Mock<() => void>;
let occurrences: DataSecurityFindingOccurrences;

function findingListCalls(): Array<{
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}> {
  return listSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        modelType: { new (): BaseModel };
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        limit: number;
      };
    })
    .filter((call: { modelType: { new (): BaseModel } }): boolean => {
      return call.modelType === DataStoreFinding;
    });
}

function renderCard(checkId?: string): void {
  const { issue, store } = issueOf(checkId);

  render(
    <MemoryRouter>
      <IssueTelemetryFindings
        issue={issue}
        store={store}
        onChanged={onChanged}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/data-security/issues/x`);
  PermissionGate.clearPermissionPropsCache();
  grant(OWNER);
  onChanged = jest.fn<() => void>();
  stored = [
    findingOf(PPS_ID),
    findingOf(IP_ID, {
      dataTypeId: "ip-address",
      dataTypeName: "IP address",
      sensitivity: DataSensitivity.Confidential,
      location: "attributes.http.client_ip",
      matchCount: 50,
      maskedSamples: ["81.***.***.***"],
    }),
    findingOf(EMAIL_ID, {
      dataTypeId: "email-address",
      dataTypeName: "Email address",
      location: "attributes.user.email",
      isScrubbed: true,
    }),
    // The other check's, and one that counts toward nothing.
    findingOf(TOKEN_ID, {
      dataTypeId: "github-token",
      dataTypeName: "GitHub token",
      location: "attributes.config.token",
    }),
    findingOf(LOW_ID, {
      dataTypeId: "phone-number",
      dataTypeName: "Phone number",
      location: "attributes.user.phone",
      confidence: DataConfidence.Low,
    }),
  ];
  occurrences = {
    occurrences: [SPAN],
    since: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    until: new Date().toISOString(),
    recordsRead: 12,
    isComplete: true,
  };

  listSpy = jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    data: unknown,
  ): Promise<ListResult<BaseModel>> => {
    const modelType: { new (): BaseModel } = (
      data as { modelType: { new (): BaseModel } }
    ).modelType;
    const rows: Array<BaseModel> =
      modelType === DataStoreFinding ? [...stored] : [];

    return { data: rows, count: rows.length, skip: 0, limit: 100 };
  }) as never);
  occurrencesSpy = jest
    .spyOn(DataSecurityApi, "getFindingOccurrences")
    .mockImplementation(async () => {
      return occurrences;
    });
  scrubSpy = jest.spyOn(DataSecurityApi, "scrubFinding").mockResolvedValue({
    signal: "trace",
    scrubRuleId: "9c9c9c9c-0000-4000-8000-0000000000c9",
    scrubRuleName: "Data Security: Ireland PPS number in attributes.user.pps",
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which findings an issue lists", () => {
  test("the check's own data types that count - the unscrubbed first, then the scrubbed", () => {
    expect(
      getFindingsBehindIssue("sensitive-data-in-telemetry", [
        findingOf(EMAIL_ID, { dataTypeId: "email-address", isScrubbed: true }),
        ...stored.slice(0, 2),
        stored[3]!,
        stored[4]!,
      ]).map((finding: DataStoreFinding): string => {
        return finding._id!.toString();
      }),
    ).toEqual([PPS_ID, IP_ID, EMAIL_ID]);
    expect(
      getFindingsBehindIssue("secrets-in-telemetry", stored).map(
        (finding: DataStoreFinding): string => {
          return finding._id!.toString();
        },
      ),
    ).toEqual([TOKEN_ID]);
  });

  test("OneUptime AI's suggestion nobody confirmed, or a finding marked not sensitive, is not one", () => {
    expect(
      getFindingsBehindIssue("sensitive-data-in-telemetry", [
        findingOf(PPS_ID, { isAiSuggested: true, matchCount: 0 }),
        findingOf(IP_ID, { dataTypeId: "ip-address", isSuppressed: true }),
      ]),
    ).toEqual([]);
  });

  test("masked samples are asked for only by a reader who may read them", () => {
    expect(getIssueFindingsSelect(true)["maskedSamples"]).toBe(true);
    expect(getIssueFindingsSelect(false)["maskedSamples"]).toBeUndefined();
    expect(getIssueFindingsSelect(false)["location"]).toBe(true);
  });
});

describe("the card", () => {
  test("names each kind of data, where it sits, how often it matched and its masked samples", async () => {
    renderCard();

    const card: HTMLElement = await screen.findByTestId(
      ISSUE_TELEMETRY_FINDINGS_TEST_ID,
    );
    const blocks: Array<HTMLElement> = await within(card).findAllByTestId(
      "data-security-issue-finding",
    );

    expect(
      blocks.map((block: HTMLElement): string => {
        return within(block).getByTestId("data-security-issue-finding-type")
          .textContent as string;
      }),
    ).toEqual(["Ireland PPS number", "IP address", "Email address"]);
    expect(
      within(blocks[0]!).getByTestId("data-security-issue-finding-location"),
    ).toHaveTextContent("attributes.user.pps");
    expect(within(blocks[0]!).getByText("Attribute")).toBeInTheDocument();
    expect(
      within(blocks[0]!).getByText("48 of 50 sampled values matched"),
    ).toBeInTheDocument();
    expect(
      within(blocks[0]!)
        .getAllByTestId("data-security-issue-finding-sample")
        .map((sample: HTMLElement): string => {
          return sample.textContent as string;
        }),
    ).toEqual(["******7A", "******2W"]);
    expect(within(card).queryByText("GitHub token")).not.toBeInTheDocument();
    expect(within(card).queryByText("Phone number")).not.toBeInTheDocument();
  });

  test("reads the store's findings that count, still seen, the most matched first", async () => {
    renderCard();

    await screen.findAllByTestId("data-security-issue-finding");

    const [read] = findingListCalls();

    expect(read!.query["dataStoreId"]).toEqual(new ObjectID(STORE_ID));
    expect(read!.query["isSuppressed"]).toBe(false);
    expect(read!.query["lastSeenAt"]).toBeInstanceOf(GreaterThanOrEqual);
    expect(read!.select["maskedSamples"]).toBe(true);
    expect(read!.limit).toBe(100);
  });

  test("opens the first unscrubbed finding's newest records, each leading to the trace", async () => {
    renderCard();

    const records: HTMLElement = await screen.findByTestId(
      "data-security-finding-occurrence",
    );

    expect(occurrencesSpy).toHaveBeenCalledTimes(1);
    expect(occurrencesSpy).toHaveBeenCalledWith(new ObjectID(PPS_ID));
    expect(within(records).getByText("Span")).toBeInTheDocument();
    expect(within(records).getByText("POST /api/signup")).toBeInTheDocument();
    expect(
      within(records).getByTestId("data-security-finding-occurrence-value"),
    ).toHaveTextContent("******7A");

    const trace: HTMLElement = within(records).getByText("Open trace");

    expect(trace.closest("a")?.getAttribute("href")).toBe(
      `${routeFor(PageMap.TRACE_VIEW).replace(":id", SPAN.traceId!)}?spanId=${SPAN.spanId}`,
    );
  });

  test("another finding's records open when asked, and close again", async () => {
    renderCard();

    const blocks: Array<HTMLElement> = await screen.findAllByTestId(
      "data-security-issue-finding",
    );

    fireEvent.click(
      within(blocks[1]!).getByTestId(
        "data-security-issue-finding-records-toggle",
      ),
    );

    await waitFor(() => {
      expect(occurrencesSpy).toHaveBeenCalledWith(new ObjectID(IP_ID));
    });
    expect(
      within(blocks[1]!).getByTestId(FINDING_OCCURRENCES_TEST_ID),
    ).toBeInTheDocument();

    fireEvent.click(
      within(blocks[0]!).getByTestId(
        "data-security-issue-finding-records-toggle",
      ),
    );

    expect(
      within(blocks[0]!).queryByTestId(FINDING_OCCURRENCES_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("names the service and opens its traces", async () => {
    renderCard();

    const owner: HTMLElement = await screen.findByTestId(
      "data-security-issue-findings-owner",
    );
    const link: HTMLAnchorElement | null = owner.querySelector("a");

    expect(owner).toHaveTextContent("In the traces of oneuptime-app");
    expect(link?.getAttribute("href")).toBe(
      routeFor(PageMap.SERVICE_VIEW_TRACES).replace(":id", SERVICE_ID),
    );
  });

  test("a scrubbed finding says so and offers no Scrub It", async () => {
    renderCard();

    const blocks: Array<HTMLElement> = await screen.findAllByTestId(
      "data-security-issue-finding",
    );

    expect(within(blocks[2]!).getByText("Scrubbed")).toBeInTheDocument();
    expect(
      within(blocks[2]!).queryByTestId("data-security-issue-finding-scrub"),
    ).not.toBeInTheDocument();
    expect(
      within(blocks[0]!).getByTestId("data-security-issue-finding-scrub"),
    ).toBeEnabled();
  });

  test("Scrub It asks first, makes the rule, says which, reads the findings again and tells the issue", async () => {
    renderCard();

    const blocks: Array<HTMLElement> = await screen.findAllByTestId(
      "data-security-issue-finding",
    );

    fireEvent.click(
      within(blocks[0]!).getByTestId("data-security-issue-finding-scrub"),
    );

    expect(
      await screen.findByText("Scrub This Data at Ingest"),
    ).toBeInTheDocument();
    expect(scrubSpy).not.toHaveBeenCalled();

    const before: number = findingListCalls().length;

    stored[0] = findingOf(PPS_ID, { isScrubbed: true });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Scrub It",
      }),
    );

    const notice: HTMLElement = await screen.findByTestId(
      "data-security-issue-findings-scrub-notice",
    );

    expect(scrubSpy).toHaveBeenCalledWith(new ObjectID(PPS_ID));
    expect(notice).toHaveTextContent(
      "The scrub rule Data Security: Ireland PPS number in attributes.user.pps now masks this data in new traces.",
    );
    expect(
      within(notice)
        .getByText("View scrub rules")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(routeFor(PageMap.TRACES_SETTINGS_SCRUB_RULES));
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(findingListCalls().length).toBe(before + 1);
    });
  });

  test("a Scrub It the server refuses says why, in the dialog", async () => {
    scrubSpy.mockRejectedValue(
      new DataSecurityApiError(
        "You do not have permission to create trace scrub rules.",
        403,
      ),
    );
    renderCard();

    const blocks: Array<HTMLElement> = await screen.findAllByTestId(
      "data-security-issue-finding",
    );

    fireEvent.click(
      within(blocks[0]!).getByTestId("data-security-issue-finding-scrub"),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Scrub It",
      }),
    );

    expect(
      await screen.findByText(
        "You do not have permission to create trace scrub rules.",
      ),
    ).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("a Security Viewer reads what was found and where - never a sample, never a record - and is told why", async () => {
    grant(VIEWER);
    renderCard();

    const card: HTMLElement = await screen.findByTestId(
      ISSUE_TELEMETRY_FINDINGS_TEST_ID,
    );
    const blocks: Array<HTMLElement> = await within(card).findAllByTestId(
      "data-security-issue-finding",
    );

    expect(findingListCalls()[0]!.select["maskedSamples"]).toBeUndefined();
    expect(blocks.length).toBe(3);
    expect(
      within(card).queryByTestId("data-security-issue-finding-sample"),
    ).not.toBeInTheDocument();
    expect(
      within(card).queryByTestId("data-security-issue-finding-records-toggle"),
    ).not.toBeInTheDocument();
    expect(
      within(card).getByText(
        "Your role does not show masked samples, or the records they were seen in.",
      ),
    ).toBeInTheDocument();
    expect(occurrencesSpy).not.toHaveBeenCalled();
    // Scrub It is there, locked, saying what it takes.
    expect(
      within(blocks[0]!).getByTestId("data-security-issue-finding-scrub"),
    ).toBeDisabled();
  });

  test("with nothing left behind the issue, it says so", async () => {
    stored = [stored[3]!, stored[4]!];
    renderCard();

    expect(
      await screen.findByText(
        "Nothing is left to scrub: every finding behind this issue is masked at ingest, or no longer seen.",
      ),
    ).toBeInTheDocument();
  });

  test("a read that fails says so, and reads again when asked", async () => {
    listSpy.mockRejectedValueOnce(new Error("Something went wrong."));
    renderCard();

    /*
     * A bare "Something went wrong." explains nothing, so the card says what
     * it means instead (#6836).
     */
    expect(
      await screen.findByText(
        "The server ran into a problem it could not explain. Try again in a moment.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /refresh|try again/i }));

    expect(
      await screen.findAllByTestId("data-security-issue-finding"),
    ).toHaveLength(3);
  });

  test("leads to everything found in the store", async () => {
    renderCard();

    const link: HTMLElement = await screen.findByText(
      "See everything found in this store",
    );

    expect(link.closest("a")?.getAttribute("href")).toBe(
      routeFor(PageMap.DATA_SECURITY_STORE_VIEW_INSIDE).replace(
        ":id",
        STORE_ID,
      ),
    );
  });
});

describe("the records", () => {
  function renderRecords(): void {
    render(
      <MemoryRouter>
        <FindingOccurrences findingId={new ObjectID(PPS_ID)} />
      </MemoryRouter>,
    );
  }

  test.each([
    DataSecurityOccurrencesUnavailableReason.NoTelemetryAccess,
    DataSecurityOccurrencesUnavailableReason.UnreadableLocation,
    DataSecurityOccurrencesUnavailableReason.NoOwner,
  ])(
    "%s says why there are none",
    async (reason: DataSecurityOccurrencesUnavailableReason) => {
      occurrences = {
        ...occurrences,
        occurrences: [],
        unavailableReason: reason,
      };
      renderRecords();

      expect(
        await screen.findByText(UNAVAILABLE_SENTENCES[reason]),
      ).toBeInTheDocument();
    },
  );

  test("none in the window, when every record there was read", async () => {
    occurrences = { ...occurrences, occurrences: [], isComplete: true };
    renderRecords();

    expect(await screen.findByText(NONE_IN_WINDOW)).toBeInTheDocument();
  });

  test("none among the newest records read, when there were more", async () => {
    occurrences = {
      ...occurrences,
      occurrences: [],
      recordsRead: 300,
      isComplete: false,
    };
    renderRecords();

    expect(
      await screen.findByText(
        "None of the newest records with a value here carries it (300 read).",
      ),
    ).toBeInTheDocument();
  });

  test("a read that fails says so, and reads again when asked", async () => {
    occurrencesSpy.mockRejectedValueOnce(
      new DataSecurityApiError(
        "Could not read these records just now. Try again in a minute.",
        400,
      ),
    );
    renderRecords();

    expect(
      await screen.findByText(
        "Could not read these records just now. Try again in a minute.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /refresh|try again/i }));

    expect(
      await screen.findByTestId("data-security-finding-occurrence"),
    ).toBeInTheDocument();
    expect(occurrencesSpy).toHaveBeenCalledTimes(2);
  });

  test("each kind of record says what it is and offers where it opens", async () => {
    occurrences = {
      ...occurrences,
      occurrences: [
        {
          ...SPAN,
          recordKind: DataSecurityOccurrenceRecordKind.Log,
          name: undefined,
          severity: "Error",
        },
        {
          time: SPAN.time,
          recordKind: DataSecurityOccurrenceRecordKind.Exception,
          serviceId: SERVICE_ID,
          fingerprint: "fp-123",
          name: "PaymentDeclined",
          maskedValue: "j***@a********.com",
        },
        {
          time: SPAN.time,
          recordKind: DataSecurityOccurrenceRecordKind.Session,
          rumApplicationId: WEB_APP_ID,
          sessionId: "session-1",
          maskedValue: "k***@a********.com",
        },
      ],
    };
    renderRecords();

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "data-security-finding-occurrence",
    );

    expect(within(rows[0]!).getByText("Log line")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Error")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Open in Logs")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Open trace")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Exception")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("PaymentDeclined")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Open exception")).toBeInTheDocument();
    expect(within(rows[1]!).queryByText("Open trace")).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText("Session")).toBeInTheDocument();
    expect(
      within(rows[2]!).getByText("Open session replay"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The newest records from the last 7 days that carry it, up to 10. Values are masked: open a record to see it in full.",
      ),
    ).toBeInTheDocument();
  });
});

describe("where a record opens", () => {
  function hrefs(links: Array<OccurrenceLink>): Array<string> {
    return links.map((link: OccurrenceLink): string => {
      return `${link.kind} ${link.route.toString()}`;
    });
  }

  function queryOf(route: string): URLSearchParams {
    return new URLSearchParams(route.slice(route.indexOf("?") + 1));
  }

  test("a span or an AI call: its trace, focused on it", () => {
    const trace: string = `${routeFor(PageMap.TRACE_VIEW).replace(":id", SPAN.traceId!)}?spanId=${SPAN.spanId}`;

    expect(hrefs(getOccurrenceLinks(SPAN))).toEqual([`Trace ${trace}`]);
    expect(
      hrefs(
        getOccurrenceLinks({
          ...SPAN,
          recordKind: DataSecurityOccurrenceRecordKind.AiCall,
        }),
      ),
    ).toEqual([`Trace ${trace}`]);
  });

  test("a log line in a request: its span's lines in the minutes around it, then its trace", () => {
    const time: Date = new Date("2026-11-03T12:00:00.000Z");
    const links: Array<OccurrenceLink> = getOccurrenceLinks({
      ...SPAN,
      time: time.toISOString(),
      recordKind: DataSecurityOccurrenceRecordKind.Log,
    });

    expect(
      links.map((link: OccurrenceLink): OccurrenceLinkKind => {
        return link.kind;
      }),
    ).toEqual([OccurrenceLinkKind.Logs, OccurrenceLinkKind.Trace]);

    const logs: string = links[0]!.route.toString();
    const query: URLSearchParams = queryOf(logs);

    expect(logs.startsWith(routeFor(PageMap.LOGS))).toBe(true);
    expect(JSON.parse(query.get("filters") || "[]")).toEqual([
      ["traceId", [SPAN.traceId]],
      ["spanId", [SPAN.spanId]],
    ]);
    expect(query.get("range")).toBe("Custom");
    expect(new Date(query.get("start") || "").getTime()).toBe(
      time.getTime() - REQUEST_LOGS_WINDOW_IN_MINUTES * 60_000,
    );
    expect(new Date(query.get("end") || "").getTime()).toBe(
      time.getTime() + REQUEST_LOGS_WINDOW_IN_MINUTES * 60_000,
    );
  });

  test("a log line outside any request: its service's lines in the second around it", () => {
    const time: Date = new Date("2026-11-03T12:00:00.000Z");
    const logs: string =
      getOccurrenceLogsRoute({
        time: time.toISOString(),
        recordKind: DataSecurityOccurrenceRecordKind.Log,
        serviceId: SERVICE_ID,
        maskedValue: "******7A",
      })?.toString() || "";
    const query: URLSearchParams = queryOf(logs);

    expect(JSON.parse(query.get("filters") || "[]")).toEqual([
      ["primaryEntityId", [SERVICE_ID]],
    ]);
    expect(new Date(query.get("start") || "").getTime()).toBe(
      time.getTime() - NEIGHBOUR_LOGS_WINDOW_IN_SECONDS * 1000,
    );
  });

  test("a log line with no time, or nothing to filter by, opens nowhere in the logs", () => {
    expect(
      getOccurrenceLogsRoute({
        time: "not a time",
        recordKind: DataSecurityOccurrenceRecordKind.Log,
        serviceId: SERVICE_ID,
        maskedValue: "x",
      }),
    ).toBeNull();
    expect(
      getOccurrenceLogsRoute({
        time: SPAN.time,
        recordKind: DataSecurityOccurrenceRecordKind.Log,
        maskedValue: "x",
      }),
    ).toBeNull();
  });

  test("an exception: its group, then its trace when it was in one", () => {
    const links: Array<OccurrenceLink> = getOccurrenceLinks({
      time: SPAN.time,
      recordKind: DataSecurityOccurrenceRecordKind.Exception,
      serviceId: SERVICE_ID,
      traceId: SPAN.traceId,
      fingerprint: "fp-123",
      maskedValue: "x",
    });

    expect(links[0]!.kind).toBe(OccurrenceLinkKind.Exception);
    expect(links[0]!.route.toString()).toContain(
      routeFor(PageMap.EXCEPTIONS_UNRESOLVED),
    );
    expect(decodeURIComponent(links[0]!.route.toString())).toContain(
      "@fingerprint:fp-123",
    );
    expect(links[1]!.kind).toBe(OccurrenceLinkKind.Trace);
  });

  test("a RUM record: the session replay it belongs to", () => {
    expect(
      hrefs(
        getOccurrenceLinks({
          time: SPAN.time,
          recordKind: DataSecurityOccurrenceRecordKind.Session,
          rumApplicationId: WEB_APP_ID,
          sessionId: "session-1",
          maskedValue: "x",
        }),
      ),
    ).toEqual([
      `SessionReplay ${routeFor(
        PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW,
      )
        .replace(":id", WEB_APP_ID)
        .replace(":subModelId", "session-1")}`,
    ]);
    expect(
      getOccurrenceLinks({
        ...SPAN,
        serviceId: undefined,
        rumApplicationId: WEB_APP_ID,
        sessionId: "session-2",
      }).map((link: OccurrenceLink): OccurrenceLinkKind => {
        return link.kind;
      }),
    ).toEqual([OccurrenceLinkKind.Trace, OccurrenceLinkKind.SessionReplay]);
  });

  test("never the value a record carried, in any address", () => {
    const records: Array<DataSecurityFindingOccurrence> = [
      SPAN,
      { ...SPAN, recordKind: DataSecurityOccurrenceRecordKind.Log },
      {
        ...SPAN,
        recordKind: DataSecurityOccurrenceRecordKind.Exception,
        fingerprint: "fp",
      },
      {
        time: SPAN.time,
        recordKind: DataSecurityOccurrenceRecordKind.Log,
        serviceId: SERVICE_ID,
        maskedValue: SPAN.maskedValue,
      },
    ];

    for (const record of records) {
      for (const link of getOccurrenceLinks(record)) {
        expect(decodeURIComponent(link.route.toString())).not.toContain("7A");
      }
    }
  });

  test("the store's own service, at its signal - or its RUM application's replays", () => {
    const service: (kind: DataStoreKind) => string | undefined = (
      kind: DataStoreKind,
    ): string | undefined => {
      return getTelemetryStoreOwnerRoute({
        kind,
        serviceId: new ObjectID(SERVICE_ID),
      })?.toString();
    };

    expect(service(DataStoreKind.TelemetryLogs)).toBe(
      routeFor(PageMap.SERVICE_VIEW_LOGS).replace(":id", SERVICE_ID),
    );
    expect(service(DataStoreKind.TelemetryTraces)).toBe(
      routeFor(PageMap.SERVICE_VIEW_TRACES).replace(":id", SERVICE_ID),
    );
    expect(service(DataStoreKind.TelemetryExceptions)).toBe(
      routeFor(PageMap.SERVICE_VIEW_EXCEPTIONS).replace(":id", SERVICE_ID),
    );
    expect(service(DataStoreKind.TelemetryAiConversations)).toBe(
      routeFor(PageMap.SERVICE_VIEW).replace(":id", SERVICE_ID),
    );
    expect(
      getTelemetryStoreOwnerRoute({
        kind: DataStoreKind.TelemetrySessionReplays,
        storeKey: `telemetry:${WEB_APP_ID}:Session Replays`,
      })?.toString(),
    ).toBe(
      routeFor(PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY).replace(
        ":id",
        WEB_APP_ID,
      ),
    );
    expect(service(DataStoreKind.AwsS3Bucket)).toBeUndefined();
    expect(
      getTelemetryStoreOwnerRoute({
        kind: DataStoreKind.TelemetrySessionReplays,
        storeKey: "telemetry:not-an-id:Session Replays",
      }),
    ).toBeNull();
    expect(
      getTelemetryStoreOwnerRoute({ kind: DataStoreKind.TelemetryLogs }),
    ).toBeNull();
  });
});
