/*
 * An Incoming Email monitor can be given a custom inbound address
 * (`Monitor.incomingEmailCustomLocalPart`) in place of its generated
 * `monitor-{secretKey}@` one. These tests pin how the queue worker treats mail
 * for both:
 *
 *   - mail to a custom address finds the monitor by that name;
 *   - once a custom address is set, the generated address is RETIRED -- mail
 *     to it is refused, so choosing a new address really does cut the old one
 *     off;
 *   - the custom address is a credential just like the key, so it is masked in
 *     everything that gets stored, without eating the evidence around it.
 *
 * MonitorResource is mocked wholesale (it is an assertion target, and the real
 * one drags in the criteria sandbox), as in
 * IncomingMonitorIngestSecretRedaction.test.ts, which covers the
 * generated-address path in depth.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(() => {
        return Promise.resolve();
      }),
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getActiveProjectStatusQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock(
  "Common/Server/Services/InboundEmail/InboundEmailProviderFactory",
  () => {
    return {
      __esModule: true,
      default: {
        getInboundDomain: jest.fn(() => {
          return "inbound.oneuptime.example";
        }),
      },
    };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import { processIncomingEmailFromQueue } from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import {
  IncomingEmailJobData,
  ProbeIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorService from "Common/Server/Services/MonitorService";
import InboundEmailProviderFactory from "Common/Server/Services/InboundEmail/InboundEmailProviderFactory";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const CUSTOM_NAME: string = "nightly-backups";
const DOMAIN: string = "inbound.oneuptime.example";
const CUSTOM_ADDRESS: string = `${CUSTOM_NAME}@${DOMAIN}`;
const GENERATED_ADDRESS: string = `monitor-${SECRET}@${DOMAIN}`;

const MONITOR_ID: string = "8f14e45f-ceea-467a-9575-1b0d0d3e7a9c";
const PROJECT_ID: string = "3c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19";

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;

const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;

const updateColumns: jest.Mock =
  MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;

const getInboundDomain: jest.Mock =
  InboundEmailProviderFactory.getInboundDomain as unknown as jest.Mock;

type MonitorFixtureFunction = (overrides?: {
  customLocalPart?: string | undefined;
  disabled?: boolean | undefined;
}) => Monitor;

// What the DB hands back for a monitor that has a custom address.
const monitorFixture: MonitorFixtureFunction = (overrides?: {
  customLocalPart?: string | undefined;
  disabled?: boolean | undefined;
}): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.projectId = new ObjectID(PROJECT_ID);
  monitor.incomingEmailSecretKey = new ObjectID(SECRET);
  const customLocalPart: string | undefined =
    overrides && "customLocalPart" in overrides
      ? overrides.customLocalPart
      : CUSTOM_NAME;

  if (customLocalPart !== undefined) {
    monitor.incomingEmailCustomLocalPart = customLocalPart;
  }
  monitor.disableActiveMonitoring = Boolean(overrides?.disabled);
  return monitor;
};

type EmailJobFunction = (
  overrides?: Partial<IncomingEmailJobData>,
) => ProbeIngestJobData;

// Mail sent to the custom address, as the webhook route enqueues it.
const customAddressJob: EmailJobFunction = (
  overrides?: Partial<IncomingEmailJobData>,
): ProbeIngestJobData => {
  return {
    jobType: "incoming-email",
    ingestionTimestamp: new Date("2026-08-23T10:00:00.000Z"),
    incomingEmail: {
      customLocalPart: CUSTOM_NAME,
      emailFrom: "nightly-backups@acme.example",
      emailTo: CUSTOM_ADDRESS,
      emailSubject: "Nightly backups completed",
      emailBody: "Backup finished in 42 minutes. 0 errors.",
      emailBodyHtml: "<p>Backup finished in 42 minutes. 0 errors.</p>",
      emailHeaders: {
        To: `Backups <${CUSTOM_ADDRESS}>`,
        From: "Nightly Backups <nightly-backups@acme.example>",
        Subject: "Nightly backups completed",
        "Delivered-To": CUSTOM_ADDRESS,
        Received: `by mx.sendgrid.net with SMTP id xW9 for <${CUSTOM_ADDRESS}>; Sun, 23 Aug 2026 10:00:00 +0000`,
      },
      attachments: undefined,
      ...overrides,
    },
  } as ProbeIngestJobData;
};

// Mail sent to the generated address.
const generatedAddressJob: EmailJobFunction = (
  overrides?: Partial<IncomingEmailJobData>,
): ProbeIngestJobData => {
  return customAddressJob({
    customLocalPart: undefined,
    secretKey: SECRET,
    emailTo: GENERATED_ADDRESS,
    emailHeaders: { To: GENERATED_ADDRESS },
    ...overrides,
  });
};

type LookupQueryFunction = () => JSONObject;

const lookupQuery: LookupQueryFunction = (): JSONObject => {
  expect(findOneBy).toHaveBeenCalledTimes(1);

  return (
    (
      findOneBy.mock.calls as unknown as Array<Array<JSONObject>>
    )[0]![0] as JSONObject
  )["query"] as JSONObject;
};

type PersistedRequestFunction = () => JSONObject;

const persistedEmailRequest: PersistedRequestFunction = (): JSONObject => {
  expect(updateColumns).toHaveBeenCalledTimes(1);

  const input: JSONObject = (
    updateColumns.mock.calls as unknown as Array<Array<JSONObject>>
  )[0]![0] as JSONObject;

  return (input["data"] as JSONObject)[
    "incomingEmailMonitorRequest"
  ] as JSONObject;
};

type EvaluatedPayloadFunction = () => JSONObject;

const evaluatedPayload: EvaluatedPayloadFunction = (): JSONObject => {
  expect(monitorResource).toHaveBeenCalledTimes(1);

  return (
    monitorResource.mock.calls as unknown as Array<Array<unknown>>
  )[0]![0] as JSONObject;
};

beforeEach(() => {
  monitorResource.mockClear();
  updateColumns.mockClear();
  findOneBy.mockReset();
  getInboundDomain.mockReset();
  getInboundDomain.mockReturnValue(DOMAIN);

  findOneBy.mockImplementation(() => {
    return Promise.resolve(monitorFixture());
  });
});

describe("mail to a custom address", () => {
  it("finds the monitor by its custom name, among Incoming Email monitors only", async () => {
    await processIncomingEmailFromQueue(customAddressJob());

    const query: JSONObject = lookupQuery();

    expect(query["incomingEmailCustomLocalPart"]).toBe(CUSTOM_NAME);
    expect(query["monitorType"]).toBe(MonitorType.IncomingEmail);
    expect(query["incomingEmailSecretKey"]).toBeUndefined();
  });

  it("looks the name up lowercased, the way it is stored", async () => {
    await processIncomingEmailFromQueue(
      customAddressJob({ customLocalPart: "Nightly-Backups" }),
    );

    expect(lookupQuery()["incomingEmailCustomLocalPart"]).toBe(CUSTOM_NAME);
  });

  it("records the email and evaluates the monitor", async () => {
    await processIncomingEmailFromQueue(customAddressJob());

    const input: JSONObject = (
      updateColumns.mock.calls as unknown as Array<Array<JSONObject>>
    )[0]![0] as JSONObject;

    expect((input["id"] as ObjectID).toString()).toBe(MONITOR_ID);
    expect(
      (input["data"] as JSONObject)["incomingEmailMonitorLastEmailReceivedAt"],
    ).toBeInstanceOf(Date);

    const payload: JSONObject = evaluatedPayload();

    expect((payload["monitorId"] as ObjectID).toString()).toBe(MONITOR_ID);
    expect((payload["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
  });

  it("refuses mail to a custom name no monitor has", async () => {
    findOneBy.mockImplementation(() => {
      return Promise.resolve(null);
    });

    await expect(
      processIncomingEmailFromQueue(customAddressJob()),
    ).rejects.toThrow(ExceptionMessages.MonitorNotFound);

    expect(updateColumns).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
  });

  it("still records a disabled monitor's email but does not evaluate it", async () => {
    findOneBy.mockImplementation(() => {
      return Promise.resolve(monitorFixture({ disabled: true }));
    });

    await processIncomingEmailFromQueue(customAddressJob());

    expect(updateColumns).toHaveBeenCalledTimes(1);
    expect(monitorResource).not.toHaveBeenCalled();
  });
});

describe("mail to the generated address", () => {
  it("is refused once the monitor has a custom address", async () => {
    /*
     * The point of choosing a new address is that the old one stops working.
     * The generated address's key is still in the row, so without this check
     * mail to it would keep counting as a heartbeat.
     */
    await expect(
      processIncomingEmailFromQueue(generatedAddressJob()),
    ).rejects.toThrow(ExceptionMessages.MonitorNotFound);

    expect(updateColumns).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
  });

  it("is accepted for a monitor with no custom address", async () => {
    findOneBy.mockImplementation(() => {
      return Promise.resolve(monitorFixture({ customLocalPart: undefined }));
    });

    await processIncomingEmailFromQueue(generatedAddressJob());

    expect(
      (lookupQuery()["incomingEmailSecretKey"] as ObjectID).toString(),
    ).toBe(SECRET);
    expect(monitorResource).toHaveBeenCalledTimes(1);
  });

  it("refuses a key that is not a uuid without querying", async () => {
    await expect(
      processIncomingEmailFromQueue(
        generatedAddressJob({ secretKey: "not-a-uuid" }),
      ),
    ).rejects.toThrow("Invalid Secret Key");

    expect(findOneBy).not.toHaveBeenCalled();
  });

  it("refuses a job that names no address at all", async () => {
    await expect(
      processIncomingEmailFromQueue(
        customAddressJob({ customLocalPart: undefined, secretKey: undefined }),
      ),
    ).rejects.toThrow("Invalid Secret Key");

    expect(findOneBy).not.toHaveBeenCalled();
  });
});

describe("the custom address is masked in what gets stored", () => {
  it("leaves the custom address nowhere in the stored request", async () => {
    await processIncomingEmailFromQueue(customAddressJob());

    expect(JSON.stringify(persistedEmailRequest())).not.toContain(
      CUSTOM_ADDRESS,
    );
  });

  it("leaves it nowhere in what incidents and alerts snapshot", async () => {
    await processIncomingEmailFromQueue(customAddressJob());

    expect(JSON.stringify(evaluatedPayload())).not.toContain(CUSTOM_ADDRESS);
  });

  it("masks only the name, so the inbound domain still reads", async () => {
    await processIncomingEmailFromQueue(customAddressJob());

    const persisted: JSONObject = persistedEmailRequest();
    const headers: JSONObject = persisted["emailHeaders"] as JSONObject;

    expect(persisted["emailTo"]).toBe(`[REDACTED]@${DOMAIN}`);
    expect(headers["Delivered-To"]).toBe(`[REDACTED]@${DOMAIN}`);
    expect(headers["To"]).toBe(`Backups <[REDACTED]@${DOMAIN}>`);
  });

  it("keeps the sender's address even though it shares the name", async () => {
    /*
     * nightly-backups@acme.example is the sender, not the credential, and the
     * "Email from" criteria evaluate it.
     */
    await processIncomingEmailFromQueue(customAddressJob());

    const persisted: JSONObject = persistedEmailRequest();
    const headers: JSONObject = persisted["emailHeaders"] as JSONObject;

    expect(persisted["emailFrom"]).toBe("nightly-backups@acme.example");
    expect(headers["From"]).toBe(
      "Nightly Backups <nightly-backups@acme.example>",
    );
    expect(persisted["emailSubject"]).toBe("Nightly backups completed");
  });

  it("also masks the monitor's secret key if a relay quotes the old address", async () => {
    await processIncomingEmailFromQueue(
      customAddressJob({
        emailBody: `Forwarded from ${GENERATED_ADDRESS}`,
      }),
    );

    expect(JSON.stringify(persistedEmailRequest())).not.toContain(SECRET);
  });

  it("masks the address in whatever case the relay wrote it", async () => {
    await processIncomingEmailFromQueue(
      customAddressJob({
        emailHeaders: { To: CUSTOM_ADDRESS.toUpperCase() },
      }),
    );

    expect(JSON.stringify(persistedEmailRequest()).toLowerCase()).not.toContain(
      CUSTOM_ADDRESS,
    );
  });

  it("uses the configured inbound domain to find the address", async () => {
    await processIncomingEmailFromQueue(customAddressJob());

    expect(getInboundDomain).toHaveBeenCalled();
  });
});
