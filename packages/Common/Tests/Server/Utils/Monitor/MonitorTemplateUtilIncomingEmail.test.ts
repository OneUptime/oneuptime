import MonitorTemplateUtil, {
  MaxEmailValueLengthInTitle,
} from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import {
  redactGeneratedInboundAddressKeys,
  redactMonitorEmailAddress,
  redactMonitorSecret,
} from "../../../../Server/Utils/Monitor/MonitorPayloadRedaction";
import { REDACTED } from "../../../../Server/Utils/LogRedaction";
import logger from "../../../../Server/Utils/Logger";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import TemplateVariablesCatalog, {
  TemplateVariable,
  TemplateVariableGroup,
} from "../../../../UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";
import { JSONObject } from "../../../../Types/JSON";
import IncomingEmailMonitorRequest from "../../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The MonitorType.IncomingEmail branch of buildTemplateStorageMap, and the
 * title map built from it.
 *
 * The Incoming Email monitor docs promised {{emailSubject}}, {{emailFrom}},
 * {{emailTo}}, {{emailBody}} and {{emailReceivedAt}} to alert and incident
 * templates, but the storage map had no branch for the type: each placeholder
 * was left in the rendered title as written. These tests pin the variables,
 * that they carry nothing the ingest boundary masked, what a scheduled
 * "not received" check gives them, and the one bounded line a title gets.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const DOMAIN: string = "inbound.oneuptime.example";
const SECRET_KEY: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const GENERATED_ADDRESS: string = `monitor-${SECRET_KEY}@${DOMAIN}`;
const CUSTOM_LOCAL_PART: string = "backups";
const CUSTOM_ADDRESS: string = `${CUSTOM_LOCAL_PART}@${DOMAIN}`;
const WORKFLOW_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const WORKFLOW_ADDRESS: string = `workflow-${WORKFLOW_KEY}@${DOMAIN}`;

const RECEIVED_AT: Date = new Date("2026-10-05T09:55:00.000Z");
const MONITOR_CREATED_AT: Date = new Date("2026-10-01T08:00:00.000Z");
const CHECKED_AT: Date = new Date("2026-10-05T11:00:00.000Z");

const SERIES_CONTEXT_KEYS: Array<string> = [
  "seriesResourceSuffix",
  "seriesResourceSummary",
  "seriesResourceBlock",
  "seriesDebugCommands",
];

const EVERY_EMAIL_VARIABLE: string =
  "{{emailSubject}} {{emailFrom}} {{emailTo}} {{emailBody}} {{emailReceivedAt}}";

type SentEmail = Pick<
  IncomingEmailMonitorRequest,
  | "emailFrom"
  | "emailTo"
  | "emailSubject"
  | "emailBody"
  | "emailBodyHtml"
  | "emailHeaders"
  | "attachments"
>;

/*
 * Mail from a sender whose own address shares the custom name (backups@ to
 * backups@<inbound>), also sent to a workflow's Incoming Email trigger.
 */
function sentTo(recipient: string): SentEmail {
  return {
    emailFrom: "backups@acme.example",
    emailTo: `${recipient}, ${WORKFLOW_ADDRESS}`,
    emailSubject: "[FAILED] Nightly backups",
    emailBody: `Backups failed.\nReplies go to ${recipient}.`,
    emailBodyHtml: "<p>Backups <b>failed</b>.</p>",
    emailHeaders: {
      "Delivered-To": recipient,
      "X-Mailer": "cron-mailer 2.1",
    },
    attachments: [
      { filename: "backup-report.log", contentType: "text/plain", size: 2048 },
    ],
  };
}

/*
 * What processIncomingEmailFromQueue (App/FeatureSet/Telemetry/Jobs/
 * ProbeIngest/ProcessProbeIngest.ts) does to an email before it becomes the
 * monitor's payload, in the same order: mask the monitor's own key, then its
 * custom address, then the address of any workflow the email also went to.
 */
function atIngestBoundary(
  email: SentEmail,
  address: { customLocalPart?: string | undefined } = {},
): IncomingEmailMonitorRequest {
  const masked: SentEmail = redactGeneratedInboundAddressKeys(
    redactMonitorEmailAddress(redactMonitorSecret(email, SECRET_KEY), {
      localPart: address.customLocalPart,
      domain: DOMAIN,
    }),
    ["workflow"],
  );

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    ...masked,
    emailReceivedAt: RECEIVED_AT,
    checkedAt: RECEIVED_AT,
    onlyCheckForIncomingEmailReceivedAt: false,
  };
}

function build(
  email: IncomingEmailMonitorRequest,
  extra: { monitor?: Monitor } = {},
): JSONObject {
  return MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.IncomingEmail,
    dataToProcess: email,
    ...extra,
  });
}

function titleMapOf(storageMap: JSONObject): JSONObject {
  return MonitorTemplateUtil.buildTitleStorageMap({
    monitorType: MonitorType.IncomingEmail,
    storageMap,
  });
}

function render(value: string, storageMap: JSONObject): string {
  return MonitorTemplateUtil.processTemplateString({ value, storageMap });
}

/** The storage map minus the always-present series-context variables. */
function withoutSeriesContext(map: JSONObject): JSONObject {
  const copy: JSONObject = { ...map };
  for (const key of SERIES_CONTEXT_KEYS) {
    delete copy[key];
  }
  return copy;
}

function catalogGroup(): TemplateVariableGroup {
  const group: TemplateVariableGroup | undefined =
    TemplateVariablesCatalog.getVariables({
      monitorType: MonitorType.IncomingEmail,
    }).find((candidate: TemplateVariableGroup): boolean => {
      return candidate.title === "Incoming Email";
    });

  expect(group).toBeDefined();
  return group!;
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation(() => {});
  jest.spyOn(logger, "debug").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — IncomingEmail", () => {
  test("exposes exactly the documented variables, from the payload the ingest boundary left", () => {
    const map: JSONObject = build(atIngestBoundary(sentTo(GENERATED_ADDRESS)));

    expect(withoutSeriesContext(map)).toEqual({
      emailSubject: "[FAILED] Nightly backups",
      emailFrom: "backups@acme.example",
      emailTo: `monitor-${REDACTED}@${DOMAIN}, workflow-${REDACTED}@${DOMAIN}`,
      emailBody: `Backups failed.\nReplies go to monitor-${REDACTED}@${DOMAIN}.`,
      emailReceivedAt: "2026-10-05T09:55:00.000Z",
    });
  });

  test("offers the same variables the template-variables picker lists for the type", () => {
    const map: JSONObject = build(atIngestBoundary(sentTo(GENERATED_ADDRESS)));
    const pickerKeys: Array<string> = catalogGroup().variables.map(
      (variable: TemplateVariable): string => {
        return variable.key;
      },
    );

    expect(Object.keys(withoutSeriesContext(map)).sort()).toEqual(
      [...pickerKeys].sort(),
    );
  });

  test("keeps the headers, the HTML body and the attachments out", () => {
    const serialized: string = JSON.stringify(
      build(atIngestBoundary(sentTo(GENERATED_ADDRESS))),
    );

    expect(serialized).not.toContain("cron-mailer");
    expect(serialized).not.toContain("<b>failed</b>");
    expect(serialized).not.toContain("backup-report.log");
  });

  test("renders the subject into a title", () => {
    const map: JSONObject = build(atIngestBoundary(sentTo(GENERATED_ADDRESS)));

    expect(render("{{emailSubject}}", titleMapOf(map))).toBe(
      "[FAILED] Nightly backups",
    );
  });

  test("reads the received time of a stored email, which comes back as text", () => {
    // Monitor.incomingEmailMonitorRequest is jsonb: its Date is a string.
    const stored: IncomingEmailMonitorRequest = {
      ...atIngestBoundary(sentTo(GENERATED_ADDRESS)),
      emailReceivedAt: "2026-10-05T09:55:00.000Z" as unknown as Date,
    };

    expect(build(stored)["emailReceivedAt"]).toBe("2026-10-05T09:55:00.000Z");
  });

  test.each(["emailSubject", "emailFrom", "emailTo", "emailBody"])(
    "renders %s empty, not as a placeholder, when the email had none",
    (key: string) => {
      const email: IncomingEmailMonitorRequest = {
        ...atIngestBoundary(sentTo(GENERATED_ADDRESS)),
        [key]: undefined,
      };

      const map: JSONObject = build(email);

      expect(map[key]).toBe("");
      expect(render(`[{{${key}}}]`, map)).toBe("[]");
      expect(render(`[{{${key}}}]`, titleMapOf(map))).toBe("[]");
    },
  );

  test.each([
    { shape: "a Date", value: RECEIVED_AT },
    { shape: "UTC text", value: "2026-10-05T09:55:00.000Z" },
    { shape: "text with an offset", value: "2026-10-05T11:55:00+02:00" },
    {
      shape: "a serialized DateTime",
      value: { _type: "DateTime", value: "2026-10-05T09:55:00.000Z" },
    },
  ])(
    "gives the received time as UTC ISO 8601 when it arrives as $shape",
    (received: { value: unknown }) => {
      const map: JSONObject = build({
        ...atIngestBoundary(sentTo(GENERATED_ADDRESS)),
        emailReceivedAt: received.value as Date,
      });

      expect(map["emailReceivedAt"]).toBe("2026-10-05T09:55:00.000Z");
    },
  );

  test("renders the received time empty when the email has none", () => {
    const map: JSONObject = build({
      ...atIngestBoundary(sentTo(GENERATED_ADDRESS)),
      emailReceivedAt: undefined as unknown as Date,
    });

    expect(map["emailReceivedAt"]).toBe("");
    expect(map["emailSubject"]).toBe("[FAILED] Nightly backups");
  });

  test("an unreadable received time renders empty and costs the email none of its other variables", () => {
    // moment warns once about the unparseable text it falls back on.
    jest.spyOn(console, "warn").mockImplementation(() => {});

    const map: JSONObject = build({
      ...atIngestBoundary(sentTo(GENERATED_ADDRESS)),
      emailReceivedAt: "not a date" as unknown as Date,
    });

    expect(map["emailReceivedAt"]).toBe("");
    expect(render("{{emailSubject}} from {{emailFrom}}", map)).toBe(
      "[FAILED] Nightly backups from backups@acme.example",
    );
    expect(logger.error).toHaveBeenCalled();
  });

  test("quotes the sender's text exactly as it was written", () => {
    // Replacement patterns, Markdown and markup are the sender's, not ours.
    const subject: string = "Cost up $& 50$ on $1 — **prod** <b>now</b> 🔥";
    const body: string =
      "# Report\n\n- [link](https://acme.example)\n\t`x = 1`";

    const map: JSONObject = build(
      atIngestBoundary({
        ...sentTo(GENERATED_ADDRESS),
        emailSubject: subject,
        emailBody: body,
      }),
    );

    expect(render("{{emailSubject}}\n{{emailBody}}", map)).toBe(
      `${subject}\n${body}`,
    );
  });

  test("a template of one variable gets the value itself, line breaks and all", () => {
    const map: JSONObject = build(atIngestBoundary(sentTo(GENERATED_ADDRESS)));

    expect(render("{{emailBody}}", map)).toBe(
      `Backups failed.\nReplies go to monitor-${REDACTED}@${DOMAIN}.`,
    );
  });

  test("fills a variable everywhere the template uses it", () => {
    const map: JSONObject = build(atIngestBoundary(sentTo(GENERATED_ADDRESS)));

    expect(render("{{emailSubject}} / {{emailSubject}}", map)).toBe(
      "[FAILED] Nightly backups / [FAILED] Nightly backups",
    );
  });

  test("renders alongside the monitor's identity in one template", () => {
    const model: Monitor = new Monitor();
    model.name = "Nightly backups";

    const map: JSONObject = build(atIngestBoundary(sentTo(GENERATED_ADDRESS)), {
      monitor: model,
    });

    expect(render("{{monitorName}}: {{emailSubject}}", titleMapOf(map))).toBe(
      "Nightly backups: [FAILED] Nightly backups",
    );
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — IncomingEmail keeps masked what the ingest boundary masked", () => {
  test("keeps the email's other recipients as they were", () => {
    const map: JSONObject = build(
      atIngestBoundary({
        ...sentTo(GENERATED_ADDRESS),
        emailTo: `ops@acme.example, ${GENERATED_ADDRESS}, Dev Team <dev@acme.example>`,
      }),
    );

    expect(map["emailTo"]).toBe(
      `ops@acme.example, monitor-${REDACTED}@${DOMAIN}, Dev Team <dev@acme.example>`,
    );
  });

  test("masks the monitor's address whatever case a relay wrote it in", () => {
    const shouted: string = GENERATED_ADDRESS.toUpperCase();

    const map: JSONObject = build(
      atIngestBoundary({
        ...sentTo(GENERATED_ADDRESS),
        emailTo: shouted,
        emailBody: `Forwarded for ${shouted} and ${GENERATED_ADDRESS}.`,
      }),
    );

    const rendered: string = render(EVERY_EMAIL_VARIABLE, map);

    expect(rendered.toLowerCase()).not.toContain(SECRET_KEY);
    expect(map["emailBody"]).toBe(
      `Forwarded for MONITOR-${REDACTED}@${DOMAIN.toUpperCase()} and monitor-${REDACTED}@${DOMAIN}.`,
    );
  });

  test.each([
    {
      kind: "generated",
      recipient: GENERATED_ADDRESS,
      customLocalPart: undefined,
      masked: `monitor-${REDACTED}@${DOMAIN}`,
    },
    {
      kind: "custom",
      recipient: CUSTOM_ADDRESS,
      customLocalPart: CUSTOM_LOCAL_PART,
      masked: `${REDACTED}@${DOMAIN}`,
    },
  ])(
    "an email to the monitor's $kind address quotes it masked, in a title and in a description",
    (address: {
      recipient: string;
      customLocalPart: string | undefined;
      masked: string;
    }) => {
      const map: JSONObject = build(
        atIngestBoundary(sentTo(address.recipient), {
          customLocalPart: address.customLocalPart,
        }),
      );

      for (const rendered of [
        render(EVERY_EMAIL_VARIABLE, map),
        render(EVERY_EMAIL_VARIABLE, titleMapOf(map)),
      ]) {
        expect(rendered).toContain(address.masked);
        expect(rendered.toLowerCase()).not.toContain(
          address.recipient.toLowerCase(),
        );
        // The workflow the email also went to keeps its address, too.
        expect(rendered).not.toContain(WORKFLOW_KEY);
      }
    },
  );

  test("keeps the sender's own address, even when it shares the custom name", () => {
    const map: JSONObject = build(
      atIngestBoundary(sentTo(CUSTOM_ADDRESS), {
        customLocalPart: CUSTOM_LOCAL_PART,
      }),
    );

    expect(render("{{emailFrom}}", map)).toBe("backups@acme.example");
  });

  test("never reads the monitor's secret key or custom address, though the monitor carries both", () => {
    const model: Monitor = new Monitor();
    model.name = "Nightly backups";
    model.monitorType = MonitorType.IncomingEmail;
    model.incomingEmailSecretKey = new ObjectID(SECRET_KEY);
    model.incomingEmailCustomLocalPart = CUSTOM_LOCAL_PART;

    const map: JSONObject = build(
      atIngestBoundary(sentTo(CUSTOM_ADDRESS), {
        customLocalPart: CUSTOM_LOCAL_PART,
      }),
      { monitor: model },
    );

    const serialized: string = JSON.stringify([
      map,
      titleMapOf(map),
    ]).toLowerCase();

    expect(map["monitorName"]).toBe("Nightly backups");
    expect(serialized).not.toContain(SECRET_KEY);
    expect(serialized).not.toContain(CUSTOM_ADDRESS);
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — IncomingEmail on a scheduled check", () => {
  /*
   * Workers' IncomingEmailMonitor/CheckOnlineStatus evaluates "not received
   * in N minutes" criteria between emails. Its payload is the monitor's
   * last email, read back from Monitor.incomingEmailMonitorRequest.
   */
  test("before any email arrived, every variable is empty rather than left as a placeholder", () => {
    const map: JSONObject = build({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      emailFrom: "",
      emailTo: "",
      emailSubject: "",
      emailBody: "",
      // The monitor's creation time, standing in: it is not an email.
      emailReceivedAt: MONITOR_CREATED_AT,
      checkedAt: CHECKED_AT,
      onlyCheckForIncomingEmailReceivedAt: true,
    });

    expect(
      render(
        "[{{emailSubject}}][{{emailFrom}}][{{emailTo}}][{{emailBody}}][{{emailReceivedAt}}]",
        map,
      ),
    ).toBe("[][][][][]");
    expect(map["emailReceivedAt"]).toBe("");
  });

  test("after an email arrived, the variables describe that last email", () => {
    const lastEmail: IncomingEmailMonitorRequest = atIngestBoundary(
      sentTo(GENERATED_ADDRESS),
    );

    const map: JSONObject = build({
      ...lastEmail,
      emailReceivedAt:
        lastEmail.emailReceivedAt.toISOString() as unknown as Date,
      checkedAt: CHECKED_AT,
      onlyCheckForIncomingEmailReceivedAt: true,
    });

    expect(
      render("Last email: {{emailSubject}} at {{emailReceivedAt}}", map),
    ).toBe("Last email: [FAILED] Nightly backups at 2026-10-05T09:55:00.000Z");
  });
});

describe("MonitorTemplateUtil.buildTitleStorageMap", () => {
  function emailMap(overrides: Partial<SentEmail>): JSONObject {
    return build(
      atIngestBoundary({ ...sentTo(GENERATED_ADDRESS), ...overrides }),
    );
  }

  test.each(
    (Object.values(MonitorType) as Array<MonitorType>).filter(
      (monitorType: MonitorType): boolean => {
        return monitorType !== MonitorType.IncomingEmail;
      },
    ),
  )("returns a %s monitor's map as it is", (monitorType: MonitorType) => {
    const storageMap: JSONObject = { requestBody: "a\nb", emailBody: "a\nb" };

    expect(
      MonitorTemplateUtil.buildTitleStorageMap({ monitorType, storageMap }),
    ).toBe(storageMap);
  });

  test.each([
    { length: MaxEmailValueLengthInTitle - 1, cut: false },
    { length: MaxEmailValueLengthInTitle, cut: false },
    { length: MaxEmailValueLengthInTitle + 1, cut: true },
  ])(
    "a $length-character value is cut: $cut",
    (boundary: { length: number; cut: boolean }) => {
      const subject: string = "s".repeat(boundary.length);

      const value: string = titleMapOf(emailMap({ emailSubject: subject }))[
        "emailSubject"
      ] as string;

      expect(value).toBe(
        boundary.cut
          ? `${"s".repeat(MaxEmailValueLengthInTitle - 3)}...`
          : subject,
      );
      expect(value.length).toBeLessThanOrEqual(MaxEmailValueLengthInTitle);
    },
  );

  test("turns every kind of whitespace and line break into a single space", () => {
    const map: JSONObject = emailMap({
      emailSubject: [
        "Disk",
        String.fromCharCode(0x2028), // LINE SEPARATOR
        "full",
        String.fromCharCode(0x2029), // PARAGRAPH SEPARATOR
        "on",
        String.fromCharCode(0x00a0), // NO-BREAK SPACE
        "db-1\vand\fdb-2\t\t(prod)\r\n\r\nnow",
      ].join(""),
    });

    expect(titleMapOf(map)["emailSubject"]).toBe(
      "Disk full on db-1 and db-2 (prod) now",
    );
  });

  test("gives the same map when applied to its own result", () => {
    const map: JSONObject = emailMap({
      emailSubject: "word ".repeat(100),
      emailBody: "a\n\nb\n".repeat(100),
    });
    const once: JSONObject = titleMapOf(map);

    expect(titleMapOf(once)).toEqual(once);
  });

  test("leaves a value that is not text alone", () => {
    const storageMap: JSONObject = {
      emailSubject: 42,
      emailBody: null,
      emailTo: { address: "a\nb" },
    };

    expect(titleMapOf(storageMap)).toEqual(storageMap);
  });

  test("keeps an emoji whole when all of it fits", () => {
    // The emoji's second half is the last character kept.
    const subject: string = `${"a".repeat(MaxEmailValueLengthInTitle - 5)}😀${"b".repeat(50)}`;

    expect(
      titleMapOf(emailMap({ emailSubject: subject }))["emailSubject"],
    ).toBe(`${"a".repeat(MaxEmailValueLengthInTitle - 5)}😀...`);
  });

  test("a value of only whitespace becomes empty, not an ellipsis", () => {
    const map: JSONObject = emailMap({ emailBody: " \n\t\r\n " });

    expect(titleMapOf(map)["emailBody"]).toBe("");
  });

  test("a title of one variable gets the bounded line", () => {
    const body: string = `${"Disk full. ".repeat(40)}\nEnd.`;

    expect(
      render("{{emailBody}}", titleMapOf(emailMap({ emailBody: body }))),
    ).toBe(
      `${body
        .split("\n")
        .join(" ")
        .slice(0, MaxEmailValueLengthInTitle - 3)}...`,
    );
  });

  test("shapes only what the email's sender wrote", () => {
    const model: Monitor = new Monitor();
    model.name = "Nightly backups";
    model.description = `${"Watches the nightly backup job. ".repeat(10)}\nOwned by ops.`;

    const map: JSONObject = build(atIngestBoundary(sentTo(GENERATED_ADDRESS)), {
      monitor: model,
    });

    expect(titleMapOf(map)["monitorDescription"]).toBe(model.description);
  });

  test("leaves a short one-line value as it is", () => {
    expect(titleMapOf(emailMap({}))["emailSubject"]).toBe(
      "[FAILED] Nightly backups",
    );
  });

  test("puts a body's lines and paragraphs on one line", () => {
    const map: JSONObject = emailMap({
      emailBody: "  Backup failed.\r\n\r\nDisk:\t/data  is full.\n",
    });

    expect(titleMapOf(map)["emailBody"]).toBe(
      "Backup failed. Disk: /data is full.",
    );
  });

  test.each(["emailSubject", "emailFrom", "emailTo", "emailBody"])(
    "cuts a long %s to MaxEmailValueLengthInTitle characters, marked as cut",
    (key: string) => {
      const long: string = `${"word ".repeat(200)}end`;
      const value: unknown = titleMapOf(
        emailMap({ [key]: long } as Partial<SentEmail>),
      )[key];

      expect(value).toBe(`${long.slice(0, MaxEmailValueLengthInTitle - 3)}...`);
      expect((value as string).length).toBe(MaxEmailValueLengthInTitle);
    },
  );

  test("does not cut an emoji in half", () => {
    // The emoji's first half would be the last character kept.
    const subject: string = `${"a".repeat(MaxEmailValueLengthInTitle - 4)}😀${"b".repeat(50)}`;

    const cut: string = titleMapOf(emailMap({ emailSubject: subject }))[
      "emailSubject"
    ] as string;

    expect(cut).toBe(`${"a".repeat(MaxEmailValueLengthInTitle - 4)}...`);
    expect(cut).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  test("keeps the received time and the monitor's identity as they are", () => {
    const model: Monitor = new Monitor();
    model.name = "Nightly backups";

    const map: JSONObject = build(atIngestBoundary(sentTo(GENERATED_ADDRESS)), {
      monitor: model,
    });
    const titleMap: JSONObject = titleMapOf(map);

    expect(titleMap["emailReceivedAt"]).toBe("2026-10-05T09:55:00.000Z");
    expect(titleMap["monitorName"]).toBe("Nightly backups");
    expect(titleMap["seriesResourceSuffix"]).toBe("");
  });

  test("leaves the description's map untouched", () => {
    const map: JSONObject = emailMap({ emailBody: `${"x".repeat(1000)}\ny` });
    const before: string = JSON.stringify(map);

    titleMapOf(map);

    expect(JSON.stringify(map)).toBe(before);
    expect(render("{{emailBody}}", map)).toBe(`${"x".repeat(1000)}\ny`);
  });

  test("a title quoting three long values fits the 500-character title column", () => {
    const long: string = "z".repeat(5000);
    const map: JSONObject = emailMap({
      emailSubject: long,
      emailBody: long,
      emailTo: long,
    });

    const title: string = render(
      "Email {{emailSubject}} to {{emailTo}}: {{emailBody}}",
      titleMapOf(map),
    );

    expect(title.length).toBeLessThanOrEqual(500);
  });
});

describe("The template-variables picker for an Incoming Email monitor", () => {
  test("tells the reader how much of a value a title gets", () => {
    expect(catalogGroup().description).toContain(
      `at most ${MaxEmailValueLengthInTitle} characters`,
    );
  });
});
