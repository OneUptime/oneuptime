import Queue, { QueueName } from "../../../../Server/Infrastructure/Queue";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../../Server/Services/SecurityDetectionService";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import { OnUpdate } from "../../../../Server/Types/Database/Hooks";
import SecurityCaseSourceAlerts, {
  SECURITY_CASE_SOURCE_ALERTS_ATTEMPTS,
  SECURITY_CASE_SOURCE_ALERTS_BACKOFF_IN_MS,
  SECURITY_CASE_SOURCE_ALERTS_JOB,
  SecurityCaseSourceAlertsJobKind,
  sourceAlertsClosedMarkdown,
  sourceAlertsFailedMarkdown,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseSourceAlerts";
import {
  SecurityAlertCloser,
  SourceAlertCloseResult,
  SourceAlertClosing,
  emptySourceAlertCloseResult,
} from "../../../../Server/Utils/SecurityEvent/Connectors/AlertClosing/SecurityAlertCloser";
import SecurityAlertCloserRegistry from "../../../../Server/Utils/SecurityEvent/Connectors/AlertClosing/SecurityAlertCloserRegistry";
import { SecurityConnectorSettings } from "../../../../Server/Utils/SecurityEvent/Connectors/Types";
import logger from "../../../../Server/Utils/Logger";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import URL from "../../../../Types/API/URL";
import SecurityCaseStatus from "../../../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityCaseStage from "../../../../Types/SecurityCase/SecurityCaseStage";
import {
  TEST_STATUS_IDS,
  buildDefaultTestStatuses,
  buildTestStatus,
  testStatusId,
} from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";
import SecurityCaseVerdict from "../../../../Types/SecurityCase/SecurityCaseVerdict";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { CLOSE_ALERTS_WHEN_CASE_CLOSES_KEY } from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Closing a case closes its alerts where they came from: the case's
 * service queues the closing and never waits on it; the job reads which
 * connections the case's alerts came from and queues one job for each that
 * closes alerts (its option on, its product able to); that job closes the
 * connection's alerts with the case's verdict, note and link, tries again
 * with backoff while its product cannot answer, and says on the case's
 * timeline what was closed - or why not - once. A case reopened before its
 * job runs closes nothing, and another project's connection is never read.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000002",
);
const CASE_ID: ObjectID = new ObjectID("bbbbbbbb-0000-4000-8000-000000000001");
const SECOPS_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000001",
);
const SECOPS_OFF_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000002",
);
const OKTA_ID: ObjectID = new ObjectID("cccccccc-0000-4000-8000-000000000003");
const FOREIGN_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000004",
);
const CASE_URL: string =
  "https://oneuptime.example.com/dashboard/aaaaaaaa/security-events/cases/bbbbbbbb";

function closedCase(overrides: Partial<SecurityCase> = {}): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.Closed);
  securityCase.verdict = SecurityCaseVerdict.FalsePositive;
  securityCase.closingNote = "Scheduled scan.";
  securityCase.caseNumberWithPrefix = "CASE-7";
  Object.assign(securityCase, overrides);
  return securityCase;
}

function detection(
  connectionId: ObjectID,
  eventUid: string,
): SecurityDetection {
  const item: SecurityDetection = new SecurityDetection();
  item.securityEventConnectionId = connectionId;
  item.eventUid = eventUid;
  return item;
}

function connection(data: {
  id: ObjectID;
  provider: SecurityEventConnectorProvider;
  closes: boolean;
  projectId?: ObjectID | undefined;
}): SecurityEventConnection {
  const item: SecurityEventConnection = new SecurityEventConnection();
  item._id = data.id.toString();
  item.projectId = data.projectId || PROJECT_ID;
  item.name = `Connection ${data.id.toString().slice(-1)}`;
  item.provider = data.provider;
  item.config = {
    region: "us",
    ...(data.closes ? { [CLOSE_ALERTS_WHEN_CASE_CLOSES_KEY]: true } : {}),
  };
  return item;
}

const CONNECTIONS: Map<string, SecurityEventConnection> = new Map([
  [
    SECOPS_ID.toString(),
    connection({
      id: SECOPS_ID,
      provider: SecurityEventConnectorProvider.GoogleSecOps,
      closes: true,
    }),
  ],
  [
    SECOPS_OFF_ID.toString(),
    connection({
      id: SECOPS_OFF_ID,
      provider: SecurityEventConnectorProvider.GoogleSecOps,
      closes: false,
    }),
  ],
  [
    OKTA_ID.toString(),
    connection({
      id: OKTA_ID,
      provider: SecurityEventConnectorProvider.OktaSystemLog,
      closes: true,
    }),
  ],
  [
    FOREIGN_ID.toString(),
    connection({
      id: FOREIGN_ID,
      provider: SecurityEventConnectorProvider.GoogleSecOps,
      closes: true,
      projectId: OTHER_PROJECT_ID,
    }),
  ],
]);

interface Recorded {
  addJob: Spy;
  feed: Spy;
  closes: Array<{ alertIds: Array<string>; closing: SourceAlertClosing }>;
}

let theCase: SecurityCase | null;
let closeResult: SourceAlertCloseResult;

function install(): Recorded {
  const closes: Array<{
    alertIds: Array<string>;
    closing: SourceAlertClosing;
  }> = [];

  const fakeCloser: SecurityAlertCloser = {
    closeAlerts: async (data: {
      settings: SecurityConnectorSettings;
      alertIds: Array<string>;
      closing: SourceAlertClosing;
    }): Promise<SourceAlertCloseResult> => {
      closes.push({ alertIds: data.alertIds, closing: data.closing });
      return closeResult;
    },
  };

  getJestSpyOn(SecurityAlertCloserRegistry, "getCloser").mockImplementation(((
    provider: string,
  ) => {
    return provider === SecurityEventConnectorProvider.GoogleSecOps
      ? fakeCloser
      : undefined;
  }) as never);

  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    (async () => {
      return theCase;
    }) as never,
  );

  getJestSpyOn(SecurityCaseService, "getCaseLinkInDashboard").mockResolvedValue(
    URL.fromString(CASE_URL) as never,
  );

  getJestSpyOn(SecurityDetectionService, "findBy").mockResolvedValue([
    detection(SECOPS_ID, "de_1"),
    detection(SECOPS_ID, "de_2"),
    detection(SECOPS_OFF_ID, "de_3"),
    detection(OKTA_ID, "okta-1"),
    detection(FOREIGN_ID, "de_9"),
  ] as never);

  getJestSpyOn(
    SecurityEventConnectionService,
    "findOneById",
  ).mockImplementation((async (args: { id: ObjectID }) => {
    return CONNECTIONS.get(args.id.toString()) || null;
  }) as never);

  getJestSpyOn(
    SecurityEventConnectionService,
    "getConnectorSettings",
  ).mockResolvedValue({
    provider: SecurityEventConnectorProvider.GoogleSecOps,
    config: {},
    secrets: {},
    alertingOnly: true,
  } as never);

  return {
    addJob: getJestSpyOn(Queue, "addJob").mockResolvedValue({} as never),
    feed: getJestSpyOn(
      SecurityCaseFeedService,
      "createSecurityCaseFeedItem",
    ).mockResolvedValue(undefined as never),
    closes,
  };
}

beforeEach(() => {
  // The project's statuses: a new project's.
  stubSecurityCaseValues();
  theCase = closedCase();
  closeResult = { ...emptySourceAlertCloseResult(), closed: 2 };
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityCaseSourceAlerts.caseClosed", () => {
  test("queues the case's job on the worker queue, tried again with backoff", async () => {
    const recorded: Recorded = install();

    await SecurityCaseSourceAlerts.caseClosed({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(recorded.addJob).toHaveBeenCalledTimes(1);

    const [queue, jobId, jobName, data, options] = recorded.addJob.mock
      .calls[0] as [QueueName, string, string, JSONObject, JSONObject];

    expect(queue).toBe(QueueName.Worker);
    expect(jobId.startsWith("security-case-source-alerts-")).toBe(true);
    expect(jobName).toBe(SECURITY_CASE_SOURCE_ALERTS_JOB);
    expect(data).toEqual({
      kind: SecurityCaseSourceAlertsJobKind.Case,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
    });
    expect(options).toEqual({
      attempts: 3,
      backoffDelayInMs: SECURITY_CASE_SOURCE_ALERTS_BACKOFF_IN_MS,
      skipExistenceCheck: true,
    });
  });

  test("never throws: a case closes whatever the queue says", async () => {
    install();
    getJestSpyOn(Queue, "addJob").mockRejectedValue(new Error("redis down"));

    await expect(
      SecurityCaseSourceAlerts.caseClosed({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("the case's job", () => {
  test("queues one job per connection that closes alerts, and no other", async () => {
    const recorded: Recorded = install();

    await SecurityCaseSourceAlerts.runJob({
      kind: SecurityCaseSourceAlertsJobKind.Case,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
    });

    // Only the Google SecOps connection with the option on, in this project.
    expect(recorded.addJob).toHaveBeenCalledTimes(1);

    const [, , jobName, data, options] = recorded.addJob.mock.calls[0] as [
      QueueName,
      string,
      string,
      JSONObject,
      JSONObject,
    ];

    expect(jobName).toBe(SECURITY_CASE_SOURCE_ALERTS_JOB);
    expect(data).toEqual({
      kind: SecurityCaseSourceAlertsJobKind.Connection,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
      connectionId: SECOPS_ID.toString(),
    });
    expect(options).toMatchObject({
      attempts: SECURITY_CASE_SOURCE_ALERTS_ATTEMPTS,
    });
    expect(recorded.closes).toHaveLength(0);
  });

  test("reads only the case's connected-product alerts, in its project", async () => {
    install();
    const findBy: Spy = getJestSpyOn(SecurityDetectionService, "findBy");
    findBy.mockResolvedValue([] as never);

    await SecurityCaseSourceAlerts.queueConnections({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    const query: JSONObject = (
      findBy.mock.calls[0]![0] as { query: JSONObject }
    ).query;

    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(query["securityCaseId"])).toBe(CASE_ID.toString());
    expect(query["source"]).toBe("Connected Product");
  });

  test("a case reopened before its job runs closes nothing", async () => {
    const recorded: Recorded = install();
    theCase = closedCase({
      securityCaseStatusId: testStatusId(SecurityCaseStage.Acknowledged),
    });

    expect(
      await SecurityCaseSourceAlerts.queueConnections({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toEqual([]);
    expect(recorded.addJob).not.toHaveBeenCalled();

    theCase = null;

    expect(
      await SecurityCaseSourceAlerts.queueConnections({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toEqual([]);
  });

  test("bad ids in the job are nothing to do", async () => {
    const recorded: Recorded = install();

    await SecurityCaseSourceAlerts.runJob({ projectId: "nope" });
    await SecurityCaseSourceAlerts.runJob({
      kind: SecurityCaseSourceAlertsJobKind.Connection,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
      connectionId: "not-a-uuid",
    });

    expect(recorded.addJob).not.toHaveBeenCalled();
    expect(recorded.closes).toHaveLength(0);
  });
});

describe("a connection's job", () => {
  async function runConnectionJob(
    connectionId: ObjectID,
    isLastAttempt: boolean = true,
  ): Promise<void> {
    await SecurityCaseSourceAlerts.runJob(
      {
        kind: SecurityCaseSourceAlertsJobKind.Connection,
        projectId: PROJECT_ID.toString(),
        securityCaseId: CASE_ID.toString(),
        connectionId: connectionId.toString(),
      },
      { isLastAttempt },
    );
  }

  test("closes that connection's alerts with the case's verdict, note and link", async () => {
    const recorded: Recorded = install();

    await runConnectionJob(SECOPS_ID);

    expect(recorded.closes).toEqual([
      {
        alertIds: ["de_1", "de_2"],
        closing: {
          verdict: SecurityCaseVerdict.FalsePositive,
          closingNote: "Scheduled scan.",
          caseLabel: "CASE-7",
          caseUrl: CASE_URL,
        },
      },
    ]);
  });

  test("says on the case's timeline what it closed, once", async () => {
    const recorded: Recorded = install();
    closeResult = {
      ...emptySourceAlertCloseResult(),
      closed: 1,
      notFound: 1,
    };

    await runConnectionJob(SECOPS_ID);

    expect(recorded.feed).toHaveBeenCalledTimes(1);

    const item: JSONObject = recorded.feed.mock.calls[0]![0] as JSONObject;

    expect(item["eventType"]).toBe(SecurityCaseFeedEventType.ResponseAction);
    expect(item["feedInfoInMarkdown"]).toBe(
      "Closed 1 alert in **Google SecOps** through the connection **Connection 1**. 1 was not found there.",
    );
  });

  test("a failure that may pass is thrown back to the queue, saying nothing yet", async () => {
    const recorded: Recorded = install();
    closeResult = {
      ...emptySourceAlertCloseResult(),
      notTried: 2,
      failure:
        "Google SecOps is rate limiting this service account (HTTP 429).",
      retryable: true,
    };

    await expect(runConnectionJob(SECOPS_ID, false)).rejects.toThrow(
      "HTTP 429",
    );
    expect(recorded.feed).not.toHaveBeenCalled();
  });

  test("on the last try, the failure is written on the case", async () => {
    const recorded: Recorded = install();
    closeResult = {
      ...emptySourceAlertCloseResult(),
      closed: 1,
      notTried: 1,
      failure: "Could not reach Google SecOps.",
      retryable: true,
    };

    await runConnectionJob(SECOPS_ID, true);

    expect(
      (recorded.feed.mock.calls[0]![0] as JSONObject)["feedInfoInMarkdown"],
    ).toBe(
      "Could not close the case's alerts in **Google SecOps** through the connection **Connection 1**: Could not reach Google SecOps. It closed 1 before it stopped.",
    );
  });

  test("a failure that will not pass is written at once", async () => {
    const recorded: Recorded = install();
    closeResult = {
      ...emptySourceAlertCloseResult(),
      notTried: 2,
      failure: "The service account cannot update alerts (HTTP 403).",
      retryable: false,
    };

    await runConnectionJob(SECOPS_ID, false);

    expect(recorded.feed).toHaveBeenCalledTimes(1);
  });

  test("a connection with the option off, a product without a closer, or another project's, closes nothing", async () => {
    const recorded: Recorded = install();

    await runConnectionJob(SECOPS_OFF_ID);
    await runConnectionJob(OKTA_ID);
    await runConnectionJob(FOREIGN_ID);

    expect(recorded.closes).toHaveLength(0);
    expect(recorded.feed).not.toHaveBeenCalled();
  });

  test("a case reopened before the connection's job runs closes nothing", async () => {
    const recorded: Recorded = install();
    theCase = closedCase({
      securityCaseStatusId: testStatusId(SecurityCaseStage.Contained),
    });

    await runConnectionJob(SECOPS_ID);

    expect(recorded.closes).toHaveLength(0);
  });

  test("an undetermined verdict is closed as undetermined when the case has none", async () => {
    const recorded: Recorded = install();
    theCase = closedCase({
      verdict: undefined as unknown as SecurityCaseVerdict,
    });

    await runConnectionJob(SECOPS_ID);

    expect(recorded.closes[0]!.closing.verdict).toBe(
      SecurityCaseVerdict.Undetermined,
    );
  });
});

describe("what the timeline says", () => {
  test("closed, not found, and refused, in one line", () => {
    expect(
      sourceAlertsClosedMarkdown({
        productName: "Google SecOps",
        connectionName: "SecOps *prod*",
        result: {
          ...emptySourceAlertCloseResult(),
          closed: 3,
          notFound: 2,
          refused: 1,
        },
      }).toString(),
    ).toBe(
      "Closed 3 alerts in **Google SecOps** through the connection **SecOps \\*prod\\***. 2 were not found there. Google SecOps refused to close 1.",
    );
  });

  test("a failure names what to fix", () => {
    expect(
      sourceAlertsFailedMarkdown({
        productName: "Google SecOps",
        connectionName: "SecOps",
        result: {
          ...emptySourceAlertCloseResult(),
          failure: "Grant it the Chronicle API Editor role.",
        },
      }).toString(),
    ).toBe(
      "Could not close the case's alerts in **Google SecOps** through the connection **SecOps**: Grant it the Chronicle API Editor role.",
    );
  });
});

describe("the case's service", () => {
  type HookCaller = {
    onUpdateSuccess: (
      onUpdate: OnUpdate<SecurityCase>,
      updatedItemIds: Array<ObjectID>,
    ) => Promise<OnUpdate<SecurityCase>>;
  };

  const service: HookCaller = SecurityCaseService as unknown as HookCaller;

  function onUpdate(
    data: JSONObject,
    oldStatusId: string,
  ): OnUpdate<SecurityCase> {
    return {
      updateBy: {
        query: { _id: CASE_ID.toString() },
        data: data as never,
        props: { isRoot: true },
      },
      carryForward: new Map([
        [
          CASE_ID.toString(),
          {
            id: CASE_ID.toString(),
            projectId: PROJECT_ID,
            statusId: oldStatusId,
          },
        ],
      ]),
    } as unknown as OnUpdate<SecurityCase>;
  }

  test("closing a case queues the closing of its alerts", async () => {
    install();
    getJestSpyOn(
      SecurityCaseService,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined as never);
    const caseClosed: Spy = getJestSpyOn(
      SecurityCaseSourceAlerts,
      "caseClosed",
    ).mockResolvedValue(undefined as never);

    await service.onUpdateSuccess(
      onUpdate(
        {
          securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
          verdict: SecurityCaseVerdict.TruePositive,
        },
        TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      ),
      [CASE_ID],
    );

    expect(caseClosed).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });
  });

  test("any other change of status closes nothing", async () => {
    install();
    getJestSpyOn(
      SecurityCaseService,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined as never);
    const caseClosed: Spy = getJestSpyOn(
      SecurityCaseSourceAlerts,
      "caseClosed",
    ).mockResolvedValue(undefined as never);

    await service.onUpdateSuccess(
      onUpdate(
        { securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Contained] },
        TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      ),
      [CASE_ID],
    );

    // Saved as Closed again, with nothing changing: no second closing.
    await service.onUpdateSuccess(
      onUpdate(
        { securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Closed] },
        TEST_STATUS_IDS[SecurityCaseStage.Closed],
      ),
      [CASE_ID],
    );

    expect(caseClosed).not.toHaveBeenCalled();
  });

  describe("with statuses of the project's own", () => {
    const DUPLICATE_ID: string = "c2000000-0000-4000-8000-0000000000a3";
    const ERADICATING_ID: string = "c2000000-0000-4000-8000-0000000000a2";

    function teamStatuses(): Array<SecurityCaseStatus> {
      const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
      statuses[3]!.order = 5; // Closed

      return [
        ...statuses,
        buildTestStatus({ id: ERADICATING_ID, name: "Eradicating", order: 4 }),
        buildTestStatus({
          id: DUPLICATE_ID,
          name: "Closed - Duplicate",
          order: 6,
        }),
      ];
    }

    test("closing into a status after Closed closes the alerts too, once", async () => {
      install();
      stubSecurityCaseValues({ statuses: teamStatuses() });
      getJestSpyOn(
        SecurityCaseService,
        "updateColumnsByIdWithoutHooks",
      ).mockResolvedValue(undefined as never);
      const caseClosed: Spy = getJestSpyOn(
        SecurityCaseSourceAlerts,
        "caseClosed",
      ).mockResolvedValue(undefined as never);

      await service.onUpdateSuccess(
        onUpdate(
          {
            securityCaseStatusId: DUPLICATE_ID,
            verdict: SecurityCaseVerdict.FalsePositive,
          },
          ERADICATING_ID,
        ),
        [CASE_ID],
      );
      expect(caseClosed).toHaveBeenCalledTimes(1);

      // From one closed status to another: already closed, nothing more.
      await service.onUpdateSuccess(
        onUpdate(
          { securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Closed] },
          DUPLICATE_ID,
        ),
        [CASE_ID],
      );
      expect(caseClosed).toHaveBeenCalledTimes(1);
    });

    test("the job reads a case in a status after Closed as closed", async () => {
      stubSecurityCaseValues({ statuses: teamStatuses() });
      const recorded: Recorded = install();
      theCase = closedCase({ securityCaseStatusId: new ObjectID(DUPLICATE_ID) });

      expect(
        await SecurityCaseSourceAlerts.queueConnections({
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
        }),
      ).toHaveLength(1);

      // Eradicating sits before Closed: open, so nothing is queued.
      recorded.addJob.mockClear();
      theCase = closedCase({
        securityCaseStatusId: new ObjectID(ERADICATING_ID),
      });

      expect(
        await SecurityCaseSourceAlerts.queueConnections({
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
        }),
      ).toEqual([]);
      expect(recorded.addJob).not.toHaveBeenCalled();
    });
  });
});
