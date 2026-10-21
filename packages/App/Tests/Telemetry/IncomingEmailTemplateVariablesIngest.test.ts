/*
 * From the inbound email webhook's queued job to the text of an alert or an
 * incident: what an Incoming Email monitor's template variables render, given
 * the payload processIncomingEmailFromQueue really builds.
 *
 * The monitor's inbound address is a credential. The queue worker masks it
 * before the payload exists, and the template variables are read from that
 * payload - so a title can quote {{emailTo}} without paging, posting or
 * publishing the address. MonitorTemplateUtilIncomingEmail.test.ts (Common)
 * pins the variables against a copy of that masking; this runs the real one,
 * so a change on either side that would put the address into a title fails
 * here. The payload is rendered the way MonitorAlert and MonitorIncident
 * render it: buildTemplateStorageMap, buildTitleStorageMap for the title, and
 * processTemplateString.
 *
 * MonitorResource is mocked wholesale (it is the assertion target, and the
 * real one drags in the criteria sandbox), as in
 * IncomingEmailCustomAddressIngest.test.ts.
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

/*
 * The template renderer lives in VMAPI, next to the code sandbox, whose
 * native isolated-vm binding is not installed for this suite. Rendering a
 * template never runs the sandbox.
 */
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

import { processIncomingEmailFromQueue } from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import {
  IncomingEmailJobData,
  ProbeIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorTemplateUtil from "Common/Server/Utils/Monitor/MonitorTemplateUtil";
import MonitorService from "Common/Server/Services/MonitorService";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ColumnLength from "Common/Types/Database/ColumnLength";
import { JSONObject } from "Common/Types/JSON";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const CUSTOM_NAME: string = "nightly-backups";
const DOMAIN: string = "inbound.oneuptime.example";
const CUSTOM_ADDRESS: string = `${CUSTOM_NAME}@${DOMAIN}`;
const GENERATED_ADDRESS: string = `monitor-${SECRET}@${DOMAIN}`;
const WORKFLOW_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const WORKFLOW_ADDRESS: string = `workflow-${WORKFLOW_KEY}@${DOMAIN}`;

const MONITOR_ID: string = "8f14e45f-ceea-467a-9575-1b0d0d3e7a9c";
const PROJECT_ID: string = "3c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19";

// Every variable the monitor's templates can use, in one line.
const EVERY_VARIABLE: string =
  "{{emailSubject}} | {{emailFrom}} | {{emailTo}} | {{emailBody}} | {{emailReceivedAt}}";

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;

const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;

const updateColumns: jest.Mock =
  MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;

// The monitor as the DB hands it back: both of its credentials included.
function monitorFixture(customLocalPart?: string | undefined): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.projectId = new ObjectID(PROJECT_ID);
  monitor.monitorType = MonitorType.IncomingEmail;
  monitor.name = "Nightly backups";
  monitor.incomingEmailSecretKey = new ObjectID(SECRET);
  monitor.disableActiveMonitoring = false;

  if (customLocalPart) {
    monitor.incomingEmailCustomLocalPart = customLocalPart;
  }

  return monitor;
}

// Mail to the generated address, also sent to a workflow, as the webhook enqueues it.
function generatedAddressJob(
  overrides?: Partial<IncomingEmailJobData>,
): ProbeIngestJobData {
  return {
    jobType: "incoming-email",
    ingestionTimestamp: new Date("2026-10-05T09:55:00.000Z"),
    incomingEmail: {
      secretKey: SECRET,
      emailFrom: "backups@acme.example",
      emailTo: `${GENERATED_ADDRESS}, ${WORKFLOW_ADDRESS}`,
      emailSubject: "[FAILED] Nightly backup of orders-db",
      emailBody: `The backup failed.\n\nReplies go to ${GENERATED_ADDRESS.toUpperCase()}.`,
      emailBodyHtml: "<p>The backup failed.</p>",
      emailHeaders: {
        To: `Backups <${GENERATED_ADDRESS}>`,
        Cc: WORKFLOW_ADDRESS,
        "Delivered-To": GENERATED_ADDRESS,
      },
      attachments: undefined,
      ...overrides,
    },
  } as ProbeIngestJobData;
}

// Mail to a custom address, from a sender whose own address shares its name.
function customAddressJob(
  overrides?: Partial<IncomingEmailJobData>,
): ProbeIngestJobData {
  return generatedAddressJob({
    secretKey: undefined,
    customLocalPart: CUSTOM_NAME,
    emailFrom: "nightly-backups@acme.example",
    emailTo: CUSTOM_ADDRESS,
    emailBody: `Backup finished. Replies go to ${CUSTOM_ADDRESS}.`,
    emailHeaders: { "Delivered-To": CUSTOM_ADDRESS },
    ...overrides,
  });
}

// The payload the queue worker handed to monitorResource.
function evaluatedPayload(): IncomingEmailMonitorRequest {
  expect(monitorResource).toHaveBeenCalledTimes(1);

  return (
    monitorResource.mock.calls as unknown as Array<Array<unknown>>
  )[0]![0] as IncomingEmailMonitorRequest;
}

// What the queue worker stored on Monitor.incomingEmailMonitorRequest.
function storedEmailRequest(): JSONObject {
  expect(updateColumns).toHaveBeenCalledTimes(1);

  const input: JSONObject = (
    updateColumns.mock.calls as unknown as Array<Array<JSONObject>>
  )[0]![0] as JSONObject;

  return (input["data"] as JSONObject)[
    "incomingEmailMonitorRequest"
  ] as JSONObject;
}

interface Rendered {
  title: string;
  description: string;
}

// `template` as MonitorAlert and MonitorIncident render it for `payload`.
function render(
  template: string,
  payload: IncomingEmailMonitorRequest,
  monitor: Monitor,
): Rendered {
  const storageMap: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.IncomingEmail,
    dataToProcess: payload,
    monitor: monitor,
  });

  const titleStorageMap: JSONObject = MonitorTemplateUtil.buildTitleStorageMap({
    monitorType: MonitorType.IncomingEmail,
    storageMap,
  });

  return {
    title: MonitorTemplateUtil.processTemplateString({
      value: template,
      storageMap: titleStorageMap,
    }),
    description: MonitorTemplateUtil.processTemplateString({
      value: template,
      storageMap,
    }),
  };
}

function expectNoCredential(rendered: Rendered): void {
  for (const text of [rendered.title, rendered.description]) {
    const lower: string = text.toLowerCase();

    expect(lower).not.toContain(SECRET);
    expect(lower).not.toContain(CUSTOM_ADDRESS);
    expect(lower).not.toContain(WORKFLOW_KEY);
    expect(text).not.toContain("{{");
  }
}

beforeEach(() => {
  monitorResource.mockClear();
  updateColumns.mockClear();
  findOneBy.mockReset();
});

describe("An email to a monitor's generated address, rendered into its alert", () => {
  beforeEach(() => {
    findOneBy.mockImplementation(() => {
      return Promise.resolve(monitorFixture());
    });
  });

  it("fills every variable, with the monitor's address masked wherever the email quoted it", async () => {
    await processIncomingEmailFromQueue(generatedAddressJob());

    const payload: IncomingEmailMonitorRequest = evaluatedPayload();
    const rendered: Rendered = render(
      EVERY_VARIABLE,
      payload,
      monitorFixture(),
    );

    expect(rendered.description).toBe(
      [
        "[FAILED] Nightly backup of orders-db",
        "backups@acme.example",
        `monitor-[REDACTED]@${DOMAIN}, workflow-[REDACTED]@${DOMAIN}`,
        `The backup failed.\n\nReplies go to MONITOR-[REDACTED]@${DOMAIN.toUpperCase()}.`,
        (payload.emailReceivedAt as Date).toISOString(),
      ].join(" | "),
    );
    expectNoCredential(rendered);
  });

  it("puts the same values on one line in the title", async () => {
    await processIncomingEmailFromQueue(generatedAddressJob());

    const rendered: Rendered = render(
      "{{emailSubject}}: {{emailBody}}",
      evaluatedPayload(),
      monitorFixture(),
    );

    expect(rendered.title).toBe(
      `[FAILED] Nightly backup of orders-db: The backup failed. Replies go to MONITOR-[REDACTED]@${DOMAIN.toUpperCase()}.`,
    );
    expectNoCredential(rendered);
  });

  it("titles an alert with the subject alone when asked", async () => {
    await processIncomingEmailFromQueue(generatedAddressJob());

    expect(
      render("{{emailSubject}}", evaluatedPayload(), monitorFixture()).title,
    ).toBe("[FAILED] Nightly backup of orders-db");
  });

  it("renders the subject empty for an email that had none", async () => {
    await processIncomingEmailFromQueue(
      generatedAddressJob({ emailSubject: undefined as unknown as string }),
    );

    expect(
      render(
        "[{{emailSubject}}] {{emailFrom}}",
        evaluatedPayload(),
        monitorFixture(),
      ).title,
    ).toBe("[] backups@acme.example");
  });

  it("keeps the title of a long email inside its column", async () => {
    await processIncomingEmailFromQueue(
      generatedAddressJob({
        emailSubject: `Disk usage critical on ${"db.prod, ".repeat(100)}`,
        emailBody: "Volume at 99% of its quota.\n".repeat(500),
      }),
    );

    const rendered: Rendered = render(
      "Nightly backups: {{emailSubject}} - {{emailBody}} ({{emailTo}})",
      evaluatedPayload(),
      monitorFixture(),
    );

    expect(rendered.title.length).toBeLessThanOrEqual(ColumnLength.LongText);
    expect(rendered.title).not.toContain("\n");
    expect(rendered.description).toContain(
      "Volume at 99% of its quota.\n".repeat(500),
    );
    expectNoCredential(rendered);
  });

  it("renders the same from the stored copy a scheduled check reads", async () => {
    await processIncomingEmailFromQueue(generatedAddressJob());

    const live: Rendered = render(
      EVERY_VARIABLE,
      evaluatedPayload(),
      monitorFixture(),
    );

    /*
     * Workers' IncomingEmailMonitor/CheckOnlineStatus reads the jsonb column
     * back (its Date as text) and evaluates it as a scheduled check.
     */
    const stored: IncomingEmailMonitorRequest = JSON.parse(
      JSON.stringify(storedEmailRequest()),
    ) as IncomingEmailMonitorRequest;

    const scheduledCheck: IncomingEmailMonitorRequest = {
      ...stored,
      onlyCheckForIncomingEmailReceivedAt: true,
      checkedAt: new Date("2026-10-05T11:00:00.000Z"),
    };

    expect(render(EVERY_VARIABLE, scheduledCheck, monitorFixture())).toEqual(
      live,
    );
  });
});

describe("An email to a monitor's custom address, rendered into its alert", () => {
  beforeEach(() => {
    findOneBy.mockImplementation(() => {
      return Promise.resolve(monitorFixture(CUSTOM_NAME));
    });
  });

  it("masks the custom address, and keeps the sender's address that shares its name", async () => {
    await processIncomingEmailFromQueue(customAddressJob());

    const rendered: Rendered = render(
      "{{emailTo}} from {{emailFrom}}: {{emailBody}}",
      evaluatedPayload(),
      monitorFixture(CUSTOM_NAME),
    );

    expect(rendered.description).toBe(
      `[REDACTED]@${DOMAIN} from nightly-backups@acme.example: Backup finished. Replies go to [REDACTED]@${DOMAIN}.`,
    );
    expect(rendered.title).toBe(rendered.description);
    expectNoCredential(rendered);
  });
});
