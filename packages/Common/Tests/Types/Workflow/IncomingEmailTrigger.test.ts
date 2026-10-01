/*
 * The Incoming Email trigger's address and the values a run starts with.
 *
 * The address is a promise to whoever is told to send mail to it, so it is
 * checked against the parser the inbound webhook routes mail with - not
 * against a copy of it. The values are a promise to every later step that
 * reads them: all present, of the type the step's metadata names, and the
 * same whether the run came from an email or from Run Workflow.
 */

import ObjectID from "../../../Types/ObjectID";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import Components from "../../../Types/Workflow/Components";
import IncomingEmailTrigger, {
  INCOMING_EMAIL_TRIGGER_LOCAL_PART_PREFIX,
  INCOMING_EMAIL_TRIGGER_SECRET_MASK,
  INCOMING_EMAIL_TRIGGER_TRUNCATED_SUFFIX,
  IncomingEmailTriggerEmail,
  IncomingEmailTriggerValue,
  MAX_INCOMING_EMAIL_TRIGGER_BODY_LENGTH,
} from "../../../Types/Workflow/IncomingEmailTrigger";
import IncomingEmailMonitorAddress, {
  IncomingEmailRecipient,
  IncomingEmailRecipientKind,
} from "../../../Utils/Monitor/IncomingEmailMonitorAddress";
import { WEBHOOK_TRIGGER_SECRET_MASK } from "../../../Types/Workflow/WebhookTrigger";
import { describe, expect, test } from "@jest/globals";

const SECRET: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const DOMAIN: string = "inbound.oneuptime.example";
const ADDRESS: string = `workflow-${SECRET}@${DOMAIN}`;

const RECEIVED_AT: string = "2026-10-01T08:30:00.000Z";

const metadata: ComponentMetadata = Components.find(
  (component: ComponentMetadata) => {
    return component.id === ComponentID.IncomingEmail;
  },
)!;

const email: (
  overrides?: Partial<IncomingEmailTriggerEmail>,
) => IncomingEmailTriggerEmail = (
  overrides?: Partial<IncomingEmailTriggerEmail>,
): IncomingEmailTriggerEmail => {
  return {
    from: "alerts@vendor.example",
    to: [ADDRESS, "ops@acme.example"],
    cc: ["oncall@acme.example"],
    subject: "Disk space low on db-1",
    body: "Only 4% left on /var.",
    htmlBody: "<p>Only <b>4%</b> left on /var.</p>",
    headers: {
      "Message-ID": "<abc@vendor.example>",
      "X-Priority": "1",
    },
    attachments: [
      { filename: "graph.png", contentType: "image/png", size: 2048 },
    ],
    receivedAt: RECEIVED_AT,
    ...(overrides || {}),
  };
};

describe("the workflow's address", () => {
  test("is workflow- and the key, on the inbound domain", () => {
    expect(
      IncomingEmailTrigger.getAddress({
        secretKey: SECRET,
        inboundDomain: DOMAIN,
      }),
    ).toBe(ADDRESS);
  });

  test("takes the key as an ObjectID too, and lowercases it", () => {
    expect(
      IncomingEmailTrigger.getAddress({
        secretKey: new ObjectID(SECRET.toUpperCase()),
        inboundDomain: DOMAIN,
      }),
    ).toBe(ADDRESS);
  });

  test.each([null, undefined, "", "   "])(
    "there is no address when the server's inbound domain is %p",
    (inboundDomain: string | null | undefined) => {
      expect(
        IncomingEmailTrigger.getAddress({
          secretKey: SECRET,
          inboundDomain: inboundDomain,
        }),
      ).toBeNull();
    },
  );

  test.each([null, undefined, ""])(
    "there is no address without a key (%p)",
    (secretKey: string | null | undefined) => {
      expect(
        IncomingEmailTrigger.getAddress({
          secretKey: secretKey,
          inboundDomain: DOMAIN,
        }),
      ).toBeNull();
    },
  );

  test("the inbound webhook routes it back to this workflow's key", () => {
    const recipient: IncomingEmailRecipient | null =
      IncomingEmailMonitorAddress.parseRecipient({
        emailAddress: ADDRESS,
        inboundDomain: DOMAIN,
      });

    expect(recipient).toEqual({
      kind: IncomingEmailRecipientKind.Workflow,
      secretKey: SECRET,
    });
  });

  test("the key is read back out of the local part, whatever its case", () => {
    expect(
      IncomingEmailTrigger.getSecretKeyFromLocalPart(
        `WORKFLOW-${SECRET.toUpperCase()}`,
      ),
    ).toBe(SECRET);
    expect(IncomingEmailTrigger.isLocalPart(`workflow-${SECRET}`)).toBe(true);
  });

  test.each([
    "workflow-",
    "workflow-backups",
    `workflow-${SECRET}-2`,
    `x-workflow-${SECRET}`,
    `monitor-${SECRET}`,
    SECRET,
  ])("%p is not a workflow's local part", (localPart: string) => {
    expect(IncomingEmailTrigger.isLocalPart(localPart)).toBe(false);
    expect(
      IncomingEmailTrigger.getSecretKeyFromLocalPart(localPart),
    ).toBeNull();
  });

  test("the masked address is the real one with only the key hidden", () => {
    expect(IncomingEmailTrigger.getMaskedAddress(DOMAIN)).toBe(
      ADDRESS.replace(SECRET, INCOMING_EMAIL_TRIGGER_SECRET_MASK),
    );
    expect(IncomingEmailTrigger.getMaskedAddress(DOMAIN)).not.toContain(SECRET);
  });

  test("the mask is the Webhook trigger's, so the two triggers read alike", () => {
    expect(INCOMING_EMAIL_TRIGGER_SECRET_MASK).toBe(
      WEBHOOK_TRIGGER_SECRET_MASK,
    );
    expect(INCOMING_EMAIL_TRIGGER_LOCAL_PART_PREFIX).toBe("workflow-");
  });
});

describe("the values a run starts with, from an email", () => {
  const values: JSONObject = IncomingEmailTrigger.getReturnValues(email());

  test("hold exactly the values the trigger's metadata promises", () => {
    expect(Object.keys(values).sort()).toEqual(
      metadata.returnValues
        .map((returnValue: ReturnValue) => {
          return returnValue.id;
        })
        .sort(),
    );
    expect(Object.keys(values).sort()).toEqual(
      Object.values(IncomingEmailTriggerValue).sort(),
    );
  });

  test("map the email field by field", () => {
    expect(values).toEqual({
      from: "alerts@vendor.example",
      to: `${ADDRESS}, ops@acme.example`,
      cc: "oncall@acme.example",
      subject: "Disk space low on db-1",
      body: "Only 4% left on /var.",
      "html-body": "<p>Only <b>4%</b> left on /var.</p>",
      headers: {
        "message-id": "<abc@vendor.example>",
        "x-priority": "1",
      },
      attachments: [
        { filename: "graph.png", contentType: "image/png", size: 2048 },
      ],
      "received-at": RECEIVED_AT,
    });
  });

  test("an address list is one line, as a message would quote it", () => {
    expect(typeof values["to"]).toBe("string");
    expect(typeof values["cc"]).toBe("string");
  });

  test("header names are lowercased, so a reference works for every sender", () => {
    expect(
      Object.keys(values["headers"] as JSONObject).every((name: string) => {
        return name === name.toLowerCase();
      }),
    ).toBe(true);
  });

  test("an email with no CC, no HTML, no headers and no attachments still has every value", () => {
    const plain: JSONObject = IncomingEmailTrigger.getReturnValues(
      email({
        cc: [],
        htmlBody: undefined,
        headers: undefined,
        attachments: undefined,
      }),
    );

    expect(plain["cc"]).toBe("");
    expect(plain["html-body"]).toBe("");
    expect(plain["headers"]).toEqual({});
    expect(plain["attachments"]).toEqual([]);
  });

  test("a body over the limit is cut, and says so", () => {
    const huge: string = "a".repeat(
      MAX_INCOMING_EMAIL_TRIGGER_BODY_LENGTH + 10,
    );
    const cut: JSONObject = IncomingEmailTrigger.getReturnValues(
      email({ body: huge, htmlBody: `<p>${huge}</p>` }),
    );

    expect(cut["body"]).toBe(
      "a".repeat(MAX_INCOMING_EMAIL_TRIGGER_BODY_LENGTH) +
        INCOMING_EMAIL_TRIGGER_TRUNCATED_SUFFIX,
    );
    expect((cut["html-body"] as string).length).toBe(
      MAX_INCOMING_EMAIL_TRIGGER_BODY_LENGTH +
        INCOMING_EMAIL_TRIGGER_TRUNCATED_SUFFIX.length,
    );
  });

  test("cutting a body that was already cut changes nothing, so the worker and the trigger can both cut", () => {
    const huge: string = "c".repeat(MAX_INCOMING_EMAIL_TRIGGER_BODY_LENGTH * 2);
    const once: string = IncomingEmailTrigger.truncateBody(huge);

    expect(IncomingEmailTrigger.truncateBody(once)).toBe(once);
    expect(
      IncomingEmailTrigger.getReturnValues(email({ body: once }))["body"],
    ).toBe(once);
  });

  test("a body at the limit is kept whole", () => {
    const exact: string = "b".repeat(MAX_INCOMING_EMAIL_TRIGGER_BODY_LENGTH);

    expect(
      IncomingEmailTrigger.getReturnValues(email({ body: exact }))["body"],
    ).toBe(exact);
  });

  test("an attachment's size is a whole number of bytes, never negative or missing", () => {
    const attachments: JSONArray = IncomingEmailTrigger.getReturnValues(
      email({
        attachments: [
          { filename: "a.txt", contentType: "text/plain", size: 12.7 },
          { filename: "b.txt", contentType: "text/plain", size: -1 },
          {
            filename: "c.txt",
            contentType: "text/plain",
            size: Number.NaN,
          },
        ],
      }),
    )["attachments"] as JSONArray;

    expect(attachments).toEqual([
      { filename: "a.txt", contentType: "text/plain", size: 12 },
      { filename: "b.txt", contentType: "text/plain", size: 0 },
      { filename: "c.txt", contentType: "text/plain", size: 0 },
    ]);
  });
});

describe("the values a run starts with, from Run Workflow", () => {
  const NOW: Date = new Date("2026-10-01T09:00:00.000Z");

  test("only the sender, subject and body are typed in; the rest arrive empty", () => {
    expect(
      IncomingEmailTrigger.normalizeReturnValues(
        {
          from: "alerts@vendor.example",
          subject: "Test",
          body: "Hello",
        },
        NOW,
      ),
    ).toEqual({
      from: "alerts@vendor.example",
      to: "",
      cc: "",
      subject: "Test",
      body: "Hello",
      "html-body": "",
      headers: {},
      attachments: [],
      "received-at": NOW.toISOString(),
    });
  });

  test("an empty run has every value too, received now", () => {
    const values: JSONObject = IncomingEmailTrigger.normalizeReturnValues(
      {},
      NOW,
    );

    expect(values["from"]).toBe("");
    expect(values["subject"]).toBe("");
    expect(values["received-at"]).toBe(NOW.toISOString());
  });

  test('a sender typed as "Name <address>" becomes the address', () => {
    expect(
      IncomingEmailTrigger.normalizeReturnValues({
        from: "Vendor Alerts <Alerts@Vendor.example>",
      })["from"],
    ).toBe("alerts@vendor.example");
  });

  test("a sender that is not an address is kept as it was typed", () => {
    expect(
      IncomingEmailTrigger.normalizeReturnValues({ from: "the backup job" })[
        "from"
      ],
    ).toBe("the backup job");
  });

  test("headers and attachments typed as JSON text are read as JSON", () => {
    const values: JSONObject = IncomingEmailTrigger.normalizeReturnValues({
      headers: '{"X-Source": "cron"}',
      attachments:
        '[{"filename": "a.csv", "contentType": "text/csv", "size": 10}]',
    });

    expect(values["headers"]).toEqual({ "x-source": "cron" });
    expect(values["attachments"]).toEqual([
      { filename: "a.csv", contentType: "text/csv", size: 10 },
    ]);
  });

  test("text that is not JSON leaves headers and attachments empty, rather than failing the run", () => {
    const values: JSONObject = IncomingEmailTrigger.normalizeReturnValues({
      headers: "not json",
      attachments: "{",
    });

    expect(values["headers"]).toEqual({});
    expect(values["attachments"]).toEqual([]);
  });

  test("a time it cannot read is replaced by now", () => {
    expect(
      IncomingEmailTrigger.normalizeReturnValues(
        { "received-at": "yesterday-ish" },
        NOW,
      )["received-at"],
    ).toBe(NOW.toISOString());
  });

  test("numbers and booleans become text; objects do not leak in as text", () => {
    const values: JSONObject = IncomingEmailTrigger.normalizeReturnValues({
      subject: 42,
      body: { not: "text" } as unknown as string,
    });

    expect(values["subject"]).toBe("42");
    expect(values["body"]).toBe("");
  });

  test("normalizing twice changes nothing", () => {
    const once: JSONObject = IncomingEmailTrigger.getReturnValues(email());

    expect(IncomingEmailTrigger.normalizeReturnValues(once)).toEqual(once);
  });
});

describe("the component", () => {
  test("is a trigger in the Email category, with nothing to set", () => {
    expect(metadata.componentType).toBe(ComponentType.Trigger);
    expect(metadata.category).toBe("Email");
    expect(metadata.arguments).toEqual([]);
    expect(metadata.inPorts).toEqual([]);
    expect(
      metadata.outPorts.map((port: { id: string }) => {
        return port.id;
      }),
    ).toEqual(["out"]);
  });

  test("each value's type is the shape it really arrives in", () => {
    const types: Record<string, ComponentInputType> = {};

    for (const returnValue of metadata.returnValues) {
      types[returnValue.id] = returnValue.type;
    }

    expect(types).toEqual({
      from: ComponentInputType.Email,
      to: ComponentInputType.Text,
      cc: ComponentInputType.Text,
      subject: ComponentInputType.Text,
      body: ComponentInputType.LongText,
      "html-body": ComponentInputType.HTML,
      headers: ComponentInputType.StringDictionary,
      attachments: ComponentInputType.JSONArray,
      "received-at": ComponentInputType.DateTime,
    });
  });

  test("Run Workflow asks for a sender, a subject and a body, and nothing it does not hand on", () => {
    const asked: Array<string> = (
      metadata.runWorkflowManuallyArguments || []
    ).map((argument: { id: string }) => {
      return argument.id;
    });

    expect(asked).toEqual(["from", "subject", "body"]);

    for (const id of asked) {
      expect(
        metadata.returnValues.some((returnValue: ReturnValue) => {
          return returnValue.id === id;
        }),
      ).toBe(true);
    }
  });

  test("no value is marked sensitive: the address is masked in them instead", () => {
    for (const returnValue of metadata.returnValues) {
      expect(returnValue.isSensitive).toBeFalsy();
    }
  });
});
