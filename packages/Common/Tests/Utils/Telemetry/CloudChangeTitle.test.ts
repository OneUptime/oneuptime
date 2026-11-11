import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Dictionary from "../../../Types/Dictionary";
import { isRightToLeftLanguage } from "../../../Types/ReadingDirection";
import {
  createTranslator,
  getTemplatePlaceholders,
  Translator,
} from "../../../Types/Translator";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
} from "../../../Utils/Telemetry/ChangeEventFields";
import {
  AWS_HEALTH_EVENT_KIND_WORDS,
  AZURE_RESOURCE_HEALTH_CHANGE_SENTENCE,
  AZURE_RESOURCE_HEALTH_STATES,
  CLOUD_CHANGE_TITLE_SENTENCES,
  CLOUD_HEALTH_STATUS_SENTENCES,
  CLOUD_HEALTH_TITLE_SENTENCES,
  CLOUD_HEALTH_UNNAMED_EVENTS,
  CloudChangeTitleFacts,
  CloudHealthSource,
  CloudHealthTitleFacts,
  describeAwsHealthEventType,
  getChangeTitleDirection,
  getChangeTitleForReader,
  getCloudChangeTitle,
  getCloudHealthTitle,
  parseAwsHealthEventType,
  readCloudChangeTitleFacts,
  readCloudChangeTitleFactsJson,
  readCloudHealthTitleFacts,
  readCloudHealthTitleFactsJson,
  readResourceFromCloudChangeTitle,
} from "../../../Utils/Telemetry/CloudChangeTitle";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A cloud change's title in the reader's language. The server stores it in
 * English ("Failed: DeleteLoadBalancer on web-alb") for the API and
 * OneUptime AI; every page words it from the facts kept beside it - the
 * operation, whether it failed, the resource - and, for a row written
 * before the resource's name was kept, from the English title's own shape.
 * Only the frame is translated: the operation and the resource are drawn as
 * written.
 */

const OPERATION: string = "DeleteLoadBalancer";
const RESOURCE: string = "web-alb";

function cloudAttributes(
  overrides: Dictionary<string> = {},
): Dictionary<string> {
  return {
    [ChangeEventAttribute.Source]: ChangeEventSource.Cloud,
    [ChangeEventAttribute.CloudOperation]: OPERATION,
    [ChangeEventAttribute.Status]: ChangeEventStatus.Succeeded,
    [ChangeEventAttribute.CloudResourceId]:
      "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web-alb/50dc6c495c0c9188",
    ...overrides,
  };
}

describe("the title in English, as the recorder stores it", () => {
  test("an operation on a resource", () => {
    expect(
      getCloudChangeTitle({
        operation: OPERATION,
        resource: RESOURCE,
        failed: false,
      }),
    ).toBe("DeleteLoadBalancer on web-alb");
  });

  test("an operation that failed says so first", () => {
    expect(
      getCloudChangeTitle({
        operation: OPERATION,
        resource: RESOURCE,
        failed: true,
      }),
    ).toBe("Failed: DeleteLoadBalancer on web-alb");
  });

  test("an operation that names no resource is its name alone", () => {
    expect(
      getCloudChangeTitle({
        operation: "CreateUser",
        resource: "",
        failed: false,
      }),
    ).toBe("CreateUser");
    expect(
      getCloudChangeTitle({
        operation: "CreateUser",
        resource: "",
        failed: true,
      }),
    ).toBe("Failed: CreateUser");
  });

  test("a value is put in as written, never looked up again", () => {
    expect(
      getCloudChangeTitle({
        operation: "{{resource}}",
        resource: "{{operation}}",
        failed: false,
      }),
    ).toBe("{{resource}} on {{operation}}");
  });

  test("the sentences keep their values' places", () => {
    expect(
      getTemplatePlaceholders(CLOUD_CHANGE_TITLE_SENTENCES.onResource).sort(),
    ).toEqual(["operation", "resource"]);
    expect(
      getTemplatePlaceholders(
        CLOUD_CHANGE_TITLE_SENTENCES.failedOnResource,
      ).sort(),
    ).toEqual(["operation", "resource"]);
    expect(
      getTemplatePlaceholders(CLOUD_CHANGE_TITLE_SENTENCES.failed),
    ).toEqual(["operation"]);
  });
});

describe("a title written before the resource's name was kept", () => {
  test("is read back by the recorder's own shape", () => {
    expect(
      readResourceFromCloudChangeTitle({
        title: "DeleteLoadBalancer on web-alb",
        operation: OPERATION,
      }),
    ).toBe("web-alb");
    expect(
      readResourceFromCloudChangeTitle({
        title: "Failed: DeleteLoadBalancer on web-alb",
        operation: OPERATION,
      }),
    ).toBe("web-alb");
    expect(
      readResourceFromCloudChangeTitle({
        title: "CreateUser",
        operation: "CreateUser",
      }),
    ).toBe("");
    expect(
      readResourceFromCloudChangeTitle({
        title: "Failed: CreateUser",
        operation: "CreateUser",
      }),
    ).toBe("");
  });

  test("a resource whose name has ' on ' in it keeps it whole", () => {
    expect(
      readResourceFromCloudChangeTitle({
        title: "PutBucketPolicy on logs on prod",
        operation: "PutBucketPolicy",
      }),
    ).toBe("logs on prod");
  });

  test("an Azure or Google Cloud operation reads the same way", () => {
    expect(
      readResourceFromCloudChangeTitle({
        title: "Microsoft.Compute/virtualMachines/write on vm-checkout-1",
        operation: "Microsoft.Compute/virtualMachines/write",
      }),
    ).toBe("vm-checkout-1");
    expect(
      readResourceFromCloudChangeTitle({
        title: "Failed: v1.compute.instances.delete on web-1",
        operation: "v1.compute.instances.delete",
      }),
    ).toBe("web-1");
  });

  test("a title of another shape has no resource to read", () => {
    // Cut short inside its operation (a title holds 500 characters).
    expect(
      readResourceFromCloudChangeTitle({
        title: `${"x".repeat(499)}…`,
        operation: "x".repeat(600),
      }),
    ).toBeNull();
    // Another operation's title.
    expect(
      readResourceFromCloudChangeTitle({
        title: "ModifyDBInstance on orders-db",
        operation: OPERATION,
      }),
    ).toBeNull();
    // Words after the operation that are not the recorder's.
    expect(
      readResourceFromCloudChangeTitle({
        title: "DeleteLoadBalancer (web-alb)",
        operation: OPERATION,
      }),
    ).toBeNull();
    // No operation to read it by.
    expect(
      readResourceFromCloudChangeTitle({
        title: "DeleteLoadBalancer on web-alb",
        operation: "  ",
      }),
    ).toBeNull();
  });
});

describe("a stored change's facts", () => {
  test("a change written with its resource's name reads the name", () => {
    expect(
      readCloudChangeTitleFacts({
        title: "Failed: DeleteLoadBalancer on web-alb",
        attributes: cloudAttributes({
          [ChangeEventAttribute.CloudResourceName]: "web-alb",
          [ChangeEventAttribute.Status]: ChangeEventStatus.Failed,
        }),
      }),
    ).toEqual({ operation: OPERATION, resource: "web-alb", failed: true });
  });

  test("the name kept beside the title wins over the title's words", () => {
    expect(
      readCloudChangeTitleFacts({
        title: "something else entirely",
        attributes: cloudAttributes({
          [ChangeEventAttribute.CloudResourceName]: "web-alb",
        }),
      }),
    ).toEqual({ operation: OPERATION, resource: "web-alb", failed: false });
  });

  test("an old row - no name kept - reads its resource from its title", () => {
    expect(
      readCloudChangeTitleFacts({
        title: "Failed: DeleteLoadBalancer on web-alb",
        attributes: cloudAttributes({
          [ChangeEventAttribute.Status]: ChangeEventStatus.Failed,
        }),
      }),
    ).toEqual({ operation: OPERATION, resource: "web-alb", failed: true });
  });

  test("a change no held resource names reads the cloud's id from its title", () => {
    const arn: string = "arn:aws:iam::123456789012:role/deploy-role";

    expect(
      readCloudChangeTitleFacts({
        title: `AttachRolePolicy on ${arn}`,
        attributes: cloudAttributes({
          [ChangeEventAttribute.CloudOperation]: "AttachRolePolicy",
          [ChangeEventAttribute.CloudResourceId]: arn,
        }),
      }),
    ).toEqual({ operation: "AttachRolePolicy", resource: arn, failed: false });
  });

  test("whether it failed is read from its status, never its words", () => {
    expect(
      readCloudChangeTitleFacts({
        title: "DeleteLoadBalancer on web-alb",
        attributes: cloudAttributes({
          [ChangeEventAttribute.Status]: ChangeEventStatus.Failed,
        }),
      })?.failed,
    ).toBe(true);
    expect(
      readCloudChangeTitleFacts({
        title: "Failed: DeleteLoadBalancer on web-alb",
        attributes: cloudAttributes(),
      })?.failed,
    ).toBe(false);
  });

  test("a health event, a deploy or a pipeline's change has no facts: its title is its own", () => {
    expect(
      readCloudChangeTitleFacts({
        title: "AWS Health: EC2 operational issue (open)",
        attributes: cloudAttributes({
          [ChangeEventAttribute.Source]: ChangeEventSource.CloudHealth,
        }),
      }),
    ).toBeNull();
    expect(
      readCloudChangeTitleFacts({
        title: "Deploy 2.3.1",
        attributes: { [ChangeEventAttribute.Source]: ChangeEventSource.Api },
      }),
    ).toBeNull();
    expect(
      readCloudChangeTitleFacts({ title: "Deploy 2.3.1", attributes: {} }),
    ).toBeNull();
    expect(
      readCloudChangeTitleFacts({ title: "Deploy 2.3.1", attributes: null }),
    ).toBeNull();
  });

  test("a cloud change with no operation, or a title of another shape, has no facts", () => {
    expect(
      readCloudChangeTitleFacts({
        title: "DeleteLoadBalancer on web-alb",
        attributes: cloudAttributes({
          [ChangeEventAttribute.CloudOperation]: "",
        }),
      }),
    ).toBeNull();
    expect(
      readCloudChangeTitleFacts({
        title: "Something a person typed",
        attributes: cloudAttributes(),
      }),
    ).toBeNull();
  });
});

describe("facts from an API answer", () => {
  test("are read when they have the shape", () => {
    expect(
      readCloudChangeTitleFactsJson({
        operation: OPERATION,
        resource: RESOURCE,
        failed: true,
      }),
    ).toEqual({ operation: OPERATION, resource: RESOURCE, failed: true });
    expect(
      readCloudChangeTitleFactsJson({
        operation: "CreateUser",
        resource: "",
        failed: false,
      }),
    ).toEqual({ operation: "CreateUser", resource: "", failed: false });
  });

  test("anything else is no facts", () => {
    for (const value of [
      null,
      undefined,
      "DeleteLoadBalancer",
      [OPERATION],
      { operation: "", resource: RESOURCE, failed: false },
      { operation: OPERATION, resource: 5, failed: false },
      { operation: OPERATION, resource: RESOURCE, failed: "yes" },
      { resource: RESOURCE, failed: false },
    ]) {
      expect(readCloudChangeTitleFactsJson(value)).toBeNull();
    }
  });
});

describe("what a page calls a change", () => {
  const english: Translator = createTranslator(undefined, "en");

  test("a cloud change by its facts", () => {
    expect(
      getChangeTitleForReader({
        title: "Failed: DeleteLoadBalancer on web-alb",
        eventType: "config-change",
        facts: { operation: OPERATION, resource: RESOURCE, failed: true },
        translator: dashboardTranslator("de"),
      }),
    ).toBe("Fehlgeschlagen: DeleteLoadBalancer für web-alb");
  });

  test("any other change by its own title, else its kind", () => {
    expect(
      getChangeTitleForReader({
        title: "Deploy 2.3.1",
        eventType: "deployment",
        facts: null,
        translator: english,
      }),
    ).toBe("Deploy 2.3.1");
    expect(
      getChangeTitleForReader({
        title: "  ",
        eventType: "deployment",
        facts: undefined,
        translator: english,
      }),
    ).toBe("deployment");
    expect(
      getChangeTitleForReader({
        title: null,
        eventType: null,
        facts: null,
        translator: english,
      }),
    ).toBe("");
  });
});

/*
 * Which way a page lays a change's title out (the UI review of #6149). A
 * health title in Persian starts with its cloud's name - "AWS Health:" -
 * and a line read by its first letter (dir="auto") was laid out left to
 * right: its event and its state stood in the wrong order for someone
 * reading from the right. A title OneUptime words for the reader reads
 * their way; any other title its own.
 */
describe("which way a change's title reads", () => {
  const HEALTH: CloudHealthTitleFacts = {
    source: CloudHealthSource.Aws,
    event: "EC2 operational issue",
    status: "open",
    awsEventTypeCode: "AWS_EC2_OPERATIONAL_ISSUE",
  };
  const CHANGE: CloudChangeTitleFacts = {
    operation: OPERATION,
    resource: RESOURCE,
    failed: false,
  };

  test("a worded title reads the reader's way: right to left in Persian and Arabic, left to right in every other language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const reader: Translator = dashboardTranslator(language);
      const way: string = isRightToLeftLanguage(language) ? "rtl" : "ltr";

      expect([language, way === "rtl"]).toEqual([
        language,
        language === "fa" || language === "ar",
      ]);

      expect({
        language,
        health: getChangeTitleDirection({
          facts: null,
          health: HEALTH,
          translator: reader,
        }),
        change: getChangeTitleDirection({
          facts: CHANGE,
          translator: reader,
        }),
        failed: getChangeTitleDirection({
          facts: { ...CHANGE, resource: "", failed: true },
          translator: reader,
        }),
      }).toEqual({ language, health: way, change: way, failed: way });
    }
  });

  test("so does every health source and state, the frame alone too", () => {
    const persian: Translator = dashboardTranslator("fa");

    for (const health of [
      { source: CloudHealthSource.AzureService, event: "Outage", status: "" },
      {
        source: CloudHealthSource.AzureResource,
        event: "Unavailable",
        status: "Available",
      },
      {
        source: CloudHealthSource.GoogleCloud,
        event: "an incident",
        status: "closed",
      },
    ] as Array<CloudHealthTitleFacts>) {
      expect(
        getChangeTitleDirection({ facts: null, health, translator: persian }),
      ).toBe("rtl");
    }
  });

  test("a title as written reads its own way: an operation alone, a deploy's, a pipeline's", () => {
    const persian: Translator = dashboardTranslator("fa");

    expect(
      getChangeTitleDirection({
        facts: { operation: "CreateBucket", resource: "", failed: false },
        translator: persian,
      }),
    ).toBe("auto");
    expect(getChangeTitleDirection({ facts: null, translator: persian })).toBe(
      "auto",
    );
    expect(
      getChangeTitleDirection({
        facts: undefined,
        health: null,
        translator: persian,
      }),
    ).toBe("auto");
  });

  test("a change's facts come first, as its title is worded from them", () => {
    expect(
      getChangeTitleDirection({
        facts: { operation: "CreateBucket", resource: "", failed: false },
        health: HEALTH,
        translator: dashboardTranslator("fa"),
      }),
    ).toBe("auto");
  });
});

describe("in every language", () => {
  const facts: CloudChangeTitleFacts = {
    operation: OPERATION,
    resource: RESOURCE,
    failed: true,
  };

  test("each language words all three sentences, and keeps their values", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of Object.values(CLOUD_CHANGE_TITLE_SENTENCES)) {
        const worded: string | undefined = words[sentence];

        expect({ language, sentence, translated: worded !== sentence }).toEqual(
          { language, sentence, translated: true },
        );
        expect({
          language,
          sentence,
          values: getTemplatePlaceholders(worded || "").sort(),
        }).toEqual({
          language,
          sentence,
          values: getTemplatePlaceholders(sentence).sort(),
        });
      }
    }
  });

  test("a title reads in the reader's language, the cloud's words as written", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const title: string = withoutIsolateMarks(
        getCloudChangeTitle(facts, dashboardTranslator(language)),
      );

      expect({ language, english: title.includes("Failed") }).toEqual({
        language,
        english: false,
      });
      expect(title).toContain(OPERATION);
      expect(title).toContain(RESOURCE);
    }
  });

  test("German, Japanese and Persian, word for word", () => {
    expect(getCloudChangeTitle(facts, dashboardTranslator("de"))).toBe(
      "Fehlgeschlagen: DeleteLoadBalancer für web-alb",
    );
    expect(
      getCloudChangeTitle(
        { ...facts, failed: false },
        dashboardTranslator("ja"),
      ),
    ).toBe("web-alb に対する DeleteLoadBalancer");
    expect(
      withoutIsolateMarks(
        getCloudChangeTitle(facts, dashboardTranslator("fa")),
      ),
    ).toBe("ناموفق: DeleteLoadBalancer روی web-alb");
  });

  test("a Persian title drawn on a page sets the Latin words apart", () => {
    expect(
      getCloudChangeTitle(facts, dashboardTranslator("fa"), {
        setsValuesApart: true,
      }),
    ).toBe(`ناموفق: ${isolated(OPERATION)} روی ${isolated(RESOURCE)}`);

    // A Latin sentence has nothing to set apart.
    expect(
      getCloudChangeTitle(facts, dashboardTranslator("de"), {
        setsValuesApart: true,
      }),
    ).toBe("Fehlgeschlagen: DeleteLoadBalancer für web-alb");
  });

  test("an operation that names no resource reads in the reader's language too", () => {
    expect(
      getCloudChangeTitle(
        { operation: "CreateUser", resource: "", failed: true },
        dashboardTranslator("fr"),
      ),
    ).toBe("Échec : CreateUser");
    expect(
      getCloudChangeTitle(
        { operation: "CreateUser", resource: "", failed: false },
        dashboardTranslator("fr"),
      ),
    ).toBe("CreateUser");
  });

  test("a language with no words for it reads the whole title in English", () => {
    const untranslated: Translator = createTranslator(() => {
      return undefined;
    }, "de");

    expect(getCloudChangeTitle(facts, untranslated)).toBe(
      "Failed: DeleteLoadBalancer on web-alb",
    );
  });
});

/*
 * A cloud's health event is stored with the English title its connector
 * writes. Pages word its frame and the state the provider reports in the
 * reader's language, each state inside its own sentence, and OneUptime's
 * own words in the event - AWS's event type said in words, and what a
 * connector writes when the provider names nothing. The provider's own
 * words are drawn as written.
 */
describe("a health event's title", () => {
  function health(
    title: string,
    operation: string = "AWS_EC2_OPERATIONAL_ISSUE",
  ): {
    title: string;
    attributes: Dictionary<string>;
  } {
    return {
      title,
      attributes: {
        [ChangeEventAttribute.Source]: ChangeEventSource.CloudHealth,
        [ChangeEventAttribute.CloudOperation]: operation,
      },
    };
  }

  function factsOf(
    title: string,
    operation: string = "AWS_EC2_OPERATIONAL_ISSUE",
  ): CloudHealthTitleFacts {
    const facts: CloudHealthTitleFacts | null = readCloudHealthTitleFacts(
      health(title, operation),
    );

    expect(facts).not.toBeNull();
    return facts!;
  }

  // Every sentence a health title is worded in, and the words in it.
  const HEALTH_SENTENCES: Array<string> = [
    ...Object.values(CLOUD_HEALTH_TITLE_SENTENCES),
    ...Object.values(CLOUD_HEALTH_STATUS_SENTENCES).flatMap(
      (sentences: Readonly<Record<string, string>> | undefined) => {
        return Object.values(sentences || {});
      },
    ),
    AZURE_RESOURCE_HEALTH_CHANGE_SENTENCE,
    ...Object.values(AWS_HEALTH_EVENT_KIND_WORDS),
  ];
  const HEALTH_WORDS: Array<string> = [
    ...Object.values(AZURE_RESOURCE_HEALTH_STATES),
    ...Object.values(CLOUD_HEALTH_UNNAMED_EVENTS).map(
      (word: string | undefined): string => {
        return word || "";
      },
    ),
  ];

  test.each([
    ["AWS Health: EC2 operational issue (open)", "AWS_EC2_OPERATIONAL_ISSUE"],
    ["AWS Health: EC2 operational issue (closed)", "AWS_EC2_OPERATIONAL_ISSUE"],
    [
      "AWS Health: RDS maintenance scheduled (upcoming)",
      "AWS_RDS_MAINTENANCE_SCHEDULED",
    ],
    ["AWS Health: EC2 operational issue", "AWS_EC2_OPERATIONAL_ISSUE"],
    [
      "AWS Health: EBS volume lost (open)",
      // A kind no rule words: the connector's words, as written.
      "AWS_EBS_VOLUME_LOST",
    ],
    [
      "Azure Service Health: Network connectivity issues in West Europe (Active)",
      "ServiceHealth Incident",
    ],
    [
      "Azure Service Health: Network connectivity issues in West Europe (Resolved)",
      "ServiceHealth Incident",
    ],
    ["Azure Service Health: an event", "ServiceHealth"],
    ["Azure Service Health: an event (Active)", "ServiceHealth"],
    [
      "Azure Resource Health: Available → Unavailable",
      "ResourceHealth Unavailable",
    ],
    ["Azure Resource Health: Unavailable", "ResourceHealth Unavailable"],
    ["Azure Resource Health: changed", "ResourceHealth changed"],
    [
      "Azure Resource Health: The virtual machine is starting",
      "ResourceHealth changed",
    ],
    [
      "Google Cloud Service Health: Cloud SQL latency in us-central1 (active)",
      "INCIDENT",
    ],
    [
      "Google Cloud Service Health: Cloud SQL latency in us-central1 (closed)",
      "INCIDENT",
    ],
    ["Google Cloud Service Health: an incident (closed)", "INCIDENT"],
  ])(
    "reads back as its connector stored it, in English: %s",
    (title: string, operation: string) => {
      expect(getCloudHealthTitle(factsOf(title, operation))).toBe(title);
    },
  );

  test("the event is the provider's words, the state the one it reports, AWS's type kept when the event is its words", () => {
    expect(factsOf("AWS Health: EC2 operational issue (open)")).toEqual({
      source: CloudHealthSource.Aws,
      event: "EC2 operational issue",
      status: "open",
      awsEventTypeCode: "AWS_EC2_OPERATIONAL_ISSUE",
    });
    expect(
      factsOf("Azure Resource Health: Degraded → Available", "ResourceHealth"),
    ).toEqual({
      source: CloudHealthSource.AzureResource,
      event: "Available",
      status: "Degraded",
    });
    expect(
      factsOf(
        "Azure Service Health: Outage in West Europe (Active)",
        "ServiceHealth Incident",
      ),
    ).toEqual({
      source: CloudHealthSource.AzureService,
      event: "Outage in West Europe",
      status: "Active",
    });
  });

  test("AWS's type is not kept for an event its words do not make: a title cut short, another type", () => {
    // The recorder cuts a long title with an ellipsis: its event is no longer the type's words.
    expect(
      factsOf("AWS Health: EC2 operational iss…").awsEventTypeCode,
    ).toBeUndefined();
    expect(
      factsOf(
        "AWS Health: EC2 operational issue (open)",
        "AWS_RDS_OPERATIONAL_ISSUE",
      ).awsEventTypeCode,
    ).toBeUndefined();
    // A row with no operation kept.
    expect(
      readCloudHealthTitleFacts({
        title: "AWS Health: EC2 operational issue (open)",
        attributes: {
          [ChangeEventAttribute.Source]: ChangeEventSource.CloudHealth,
        },
      })?.awsEventTypeCode,
    ).toBeUndefined();
    // Only AWS's events have a type of AWS's.
    expect(
      factsOf(
        "Google Cloud Service Health: EC2 operational issue (active)",
        "AWS_EC2_OPERATIONAL_ISSUE",
      ).awsEventTypeCode,
    ).toBeUndefined();
  });

  test("a state no provider reports stays in the event, as written, so nothing is cut wrongly", () => {
    expect(factsOf("AWS Health: EC2 issue (investigating)")).toEqual({
      source: CloudHealthSource.Aws,
      event: "EC2 issue (investigating)",
      status: "",
    });
    // AWS's state, written in an Azure Service Health title: not Azure's own.
    expect(factsOf("Azure Service Health: Outage (open)").status).toBe("");
    // An arrow between words that are no states is the title's own.
    expect(factsOf("Azure Resource Health: Restart → Stop requested")).toEqual({
      source: CloudHealthSource.AzureResource,
      event: "Restart → Stop requested",
      status: "",
    });
    // A name of the object's own ("constructor") is no state of any provider's.
    expect(factsOf("AWS Health: EC2 issue (constructor)").status).toBe("");
    expect(
      factsOf("Azure Resource Health: constructor → toString").status,
    ).toBe("");
  });

  test("a cloud change, any other change, or a health title of another shape has no health facts", () => {
    expect(
      readCloudHealthTitleFacts({
        title: "AWS Health: EC2 operational issue (open)",
        attributes: cloudAttributes(),
      }),
    ).toBeNull();
    expect(
      readCloudHealthTitleFacts({
        title: "AWS Health: EC2 operational issue (open)",
        attributes: {},
      }),
    ).toBeNull();
    expect(
      readCloudHealthTitleFacts(health("Scheduled maintenance of EC2")),
    ).toBeNull();
    expect(readCloudHealthTitleFacts(health("AWS Health: "))).toBeNull();
    expect(readCloudHealthTitleFacts(health(""))).toBeNull();
  });

  test("each connector still writes its titles the way they are read", () => {
    const read: (file: string) => string = (file: string): string => {
      return fs.readFileSync(
        path.join(__dirname, "../../../Server/Utils/CloudConnection", file),
        "utf8",
      );
    };

    const aws: string = read("Aws/AwsChanges.ts");
    const azure: string = read("Azure/AzureChanges.ts");
    const gcp: string = read("Gcp/GcpChanges.ts");

    expect(aws).toContain(
      "title: `AWS Health: ${describeAwsHealthEventType(code)}${",
    );
    expect(aws).toContain('status ? ` (${status})` : ""');
    // AWS's type is kept as the operation, which the title's kind is worded from.
    expect(aws).toContain("operation: code,");
    expect(azure).toContain("title: `Azure Service Health: ${");
    expect(azure).toContain('title || "an event"');
    expect(azure).toContain('stage ? ` (${stage})` : ""');
    expect(azure).toContain("title: `Azure Resource Health: ${");
    expect(azure).toContain("→ ");
    expect(azure).toContain('title || "changed"');
    expect(gcp).toContain("title: `Google Cloud Service Health: ${");
    expect(gcp).toContain('"an incident"');
    expect(gcp).toContain('state ? ` (${state.toLowerCase()})` : ""');
  });

  test("an old row - its title and its operation, as every health event was kept - reads in the reader's language", () => {
    // What the recorder wrote before the facts were read: nothing but these.
    const row: { title: string; attributes: Dictionary<string> } = {
      title: "AWS Health: EC2 operational issue (closed)",
      attributes: {
        [ChangeEventAttribute.Source]: ChangeEventSource.CloudHealth,
        [ChangeEventAttribute.CloudProvider]: "aws",
        [ChangeEventAttribute.CloudOperation]: "AWS_EC2_OPERATIONAL_ISSUE",
      },
    };

    expect(
      getChangeTitleForReader({
        title: row.title,
        facts: readCloudChangeTitleFacts(row),
        health: readCloudHealthTitleFacts(row),
        translator: dashboardTranslator("de"),
      }),
    ).toBe("AWS Health: EC2-Betriebsstörung (geschlossen)");
  });

  describe("AWS's kinds of event", () => {
    test("each reads in English word for word as the connector titles it, whatever the service", () => {
      for (const kind of Object.keys(AWS_HEALTH_EVENT_KIND_WORDS)) {
        for (const service of ["EC2", "RDS", "ELASTICLOADBALANCING"]) {
          const code: string = `AWS_${service}_${kind}`;
          const facts: CloudHealthTitleFacts = factsOf(
            `AWS Health: ${describeAwsHealthEventType(code)} (open)`,
            code,
          );

          expect(facts.awsEventTypeCode).toBe(code);
          expect(getCloudHealthTitle(facts)).toBe(
            `AWS Health: ${describeAwsHealthEventType(code)} (open)`,
          );
        }
      }
    });

    test("a code reads as its service and its kind", () => {
      expect(parseAwsHealthEventType("AWS_EC2_OPERATIONAL_ISSUE")).toEqual({
        service: "EC2",
        kind: "OPERATIONAL_ISSUE",
      });
      expect(
        parseAwsHealthEventType("AWS_EC2_SYSTEM_REBOOT_MAINTENANCE_SCHEDULED"),
      ).toEqual({
        service: "EC2",
        kind: "SYSTEM_REBOOT_MAINTENANCE_SCHEDULED",
      });
      expect(parseAwsHealthEventType("AWS_EC2")).toBeNull();
      expect(parseAwsHealthEventType("AWS")).toBeNull();
      expect(parseAwsHealthEventType("")).toBeNull();
    });

    test("the connector's words for a code are unchanged", () => {
      expect(describeAwsHealthEventType("AWS_EC2_OPERATIONAL_ISSUE")).toBe(
        "EC2 operational issue",
      );
      expect(
        describeAwsHealthEventType("AWS_RDS_PLANNED_LIFECYCLE_EVENT"),
      ).toBe("RDS planned lifecycle event");
      expect(describeAwsHealthEventType("AWS")).toBe("AWS");
      expect(describeAwsHealthEventType("")).toBe("");
    });

    test("a kind is worded in the reader's language, the service as AWS names it", () => {
      expect(
        getCloudHealthTitle(
          factsOf("AWS Health: EC2 operational issue (open)"),
          dashboardTranslator("de"),
        ),
      ).toBe("AWS Health: EC2-Betriebsstörung (offen)");
      expect(
        getCloudHealthTitle(
          factsOf(
            "AWS Health: RDS maintenance scheduled (upcoming)",
            "AWS_RDS_MAINTENANCE_SCHEDULED",
          ),
          dashboardTranslator("fr"),
        ),
      ).toBe("AWS Health : Maintenance planifiée RDS (à venir)");
      expect(
        getCloudHealthTitle(
          factsOf(
            "AWS Health: EKS planned lifecycle event (upcoming)",
            "AWS_EKS_PLANNED_LIFECYCLE_EVENT",
          ),
          dashboardTranslator("ja"),
        ),
      ).toBe("AWS Health: EKS の計画されたライフサイクルイベント (予定)");
    });

    test("a kind no rule words stays as the connector wrote it, its state still worded", () => {
      expect(
        getCloudHealthTitle(
          factsOf("AWS Health: EBS volume lost (open)", "AWS_EBS_VOLUME_LOST"),
          dashboardTranslator("de"),
        ),
      ).toBe("AWS Health: EBS volume lost (offen)");
    });
  });

  test("German, Chinese, Japanese and Persian say the frame and the state in their words", () => {
    expect(
      getCloudHealthTitle(
        factsOf("Azure Resource Health: Available → Unavailable", "x"),
        dashboardTranslator("de"),
      ),
    ).toBe("Azure Resource Health: Verfügbar → Nicht verfügbar");
    // An issue that is open, not a file opened: the state is worded in its sentence.
    expect(
      getCloudHealthTitle(
        factsOf("AWS Health: EC2 operational issue (open)"),
        dashboardTranslator("zh-CN"),
      ),
    ).toBe("AWS Health：EC2 运行问题（未解决）");
    expect(
      getCloudHealthTitle(
        factsOf(
          "Google Cloud Service Health: Cloud SQL latency (active)",
          "INCIDENT",
        ),
        dashboardTranslator("zh-TW"),
      ),
    ).toBe("Google Cloud Service Health：Cloud SQL latency（進行中）");
    expect(
      getCloudHealthTitle(
        factsOf("Azure Service Health: Outage (Resolved)", "ServiceHealth"),
        dashboardTranslator("ja"),
      ),
    ).toBe("Azure Service Health: Outage (解決済み)");
    expect(
      withoutIsolateMarks(
        getCloudHealthTitle(
          factsOf(
            "Google Cloud Service Health: Cloud SQL latency (closed)",
            "INCIDENT",
          ),
          dashboardTranslator("fa"),
        ),
      ),
    ).toBe("Google Cloud Service Health: Cloud SQL latency (بسته‌شده)");
  });

  test("what a connector writes when the provider names nothing is said in the reader's words", () => {
    expect(
      getCloudHealthTitle(
        factsOf("Azure Service Health: an event (Active)", "ServiceHealth"),
        dashboardTranslator("de"),
      ),
    ).toBe("Azure Service Health: ein Ereignis (Aktiv)");
    expect(
      getCloudHealthTitle(
        factsOf("Azure Resource Health: changed", "ResourceHealth changed"),
        dashboardTranslator("de"),
      ),
    ).toBe("Azure Resource Health: geändert");
    expect(
      getCloudHealthTitle(
        factsOf("Google Cloud Service Health: an incident", "INCIDENT"),
        dashboardTranslator("fr"),
      ),
    ).toBe("Google Cloud Service Health : un incident");
    // A provider's own words that happen to be OneUptime's for another source stay as written.
    expect(
      getCloudHealthTitle(
        factsOf("Google Cloud Service Health: changed", "INCIDENT"),
        dashboardTranslator("de"),
      ),
    ).toBe("Google Cloud Service Health: changed");
  });

  test("a Persian title drawn on a page sets its Latin words apart", () => {
    expect(
      getCloudHealthTitle(
        factsOf("AWS Health: EC2 operational issue (open)"),
        dashboardTranslator("fa"),
        { setsValuesApart: true },
      ),
    ).toBe(`AWS Health: ${isolated(`مشکل عملیاتی ${isolated("EC2")}`)} (باز)`);
  });

  /*
   * #6149's UI review: a resource's states, before and now, with the arrow
   * pointing the way its language reads - a health title is laid out the
   * reader's way (getChangeTitleDirection), so a Persian or Arabic title
   * read from the right needs "←" to lead from the state before to the
   * state now. An arrow is never mirrored by the browser.
   */
  test("the arrow between a resource's states points the way its language reads", () => {
    for (const language of [...DASHBOARD_LANGUAGES, "en"]) {
      const sentence: string =
        readDashboardLocale(language)[AZURE_RESOURCE_HEALTH_CHANGE_SENTENCE] ||
        "";
      const isRightToLeft: boolean = isRightToLeftLanguage(language);

      expect({
        language,
        forward: sentence.includes(isRightToLeft ? "←" : "→"),
        backward: sentence.includes(isRightToLeft ? "→" : "←"),
      }).toEqual({ language, forward: true, backward: false });
    }

    expect(
      withoutIsolateMarks(
        getCloudHealthTitle(
          factsOf(
            "Azure Resource Health: Available → Unavailable",
            "ResourceHealth Unavailable",
          ),
          dashboardTranslator("fa"),
          { setsValuesApart: true },
        ),
      ),
    ).toBe("Azure Resource Health: در دسترس ← در دسترس نیست");

    expect(
      withoutIsolateMarks(
        getCloudHealthTitle(
          factsOf(
            "Azure Resource Health: Available → Unavailable",
            "ResourceHealth Unavailable",
          ),
          dashboardTranslator("ar"),
          { setsValuesApart: true },
        ),
      ),
    ).toBe("Azure Resource Health: متاح ← غير متاح");
  });

  test("every language has each sentence with its values, worded its own way", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of HEALTH_SENTENCES) {
        expect({
          language,
          sentence,
          values: getTemplatePlaceholders(words[sentence] || "").sort(),
        }).toEqual({
          language,
          sentence,
          values: getTemplatePlaceholders(sentence).sort(),
        });
      }

      if (language === "en") {
        continue;
      }

      // A state's sentence and a kind are worded; a frame is the provider's name, which may read the same.
      for (const sentence of [
        ...Object.values(CLOUD_HEALTH_STATUS_SENTENCES).flatMap(
          (sentences: Readonly<Record<string, string>> | undefined) => {
            return Object.values(sentences || {});
          },
        ),
        ...Object.values(AWS_HEALTH_EVENT_KIND_WORDS),
      ]) {
        expect({
          language,
          sentence,
          english: words[sentence] === sentence,
        }).toEqual({ language, sentence, english: false });
      }

      for (const word of HEALTH_WORDS) {
        expect({
          language,
          word,
          worded: Boolean(words[word]) && words[word] !== word,
        }).toEqual({ language, word, worded: true });
      }
    }
  });

  test("a page calls a health event by its worded title, a cloud change still by its facts", () => {
    expect(
      getChangeTitleForReader({
        title: "AWS Health: EC2 operational issue (closed)",
        facts: null,
        health: factsOf("AWS Health: EC2 operational issue (closed)"),
        translator: dashboardTranslator("de"),
      }),
    ).toBe("AWS Health: EC2-Betriebsstörung (geschlossen)");
    expect(
      getChangeTitleForReader({
        title: "Failed: DeleteLoadBalancer on web-alb",
        facts: { operation: OPERATION, resource: RESOURCE, failed: true },
        health: factsOf("AWS Health: EC2 operational issue (closed)"),
        translator: dashboardTranslator("de"),
      }),
    ).toBe("Fehlgeschlagen: DeleteLoadBalancer für web-alb");
  });

  describe("as an API answer carries them", () => {
    test("facts of every shape read back", () => {
      for (const facts of [
        factsOf("AWS Health: EC2 operational issue (open)"),
        factsOf("Azure Resource Health: Degraded → Available", "x"),
        factsOf("Google Cloud Service Health: Cloud SQL latency", "INCIDENT"),
      ]) {
        expect(
          readCloudHealthTitleFactsJson(JSON.parse(JSON.stringify(facts))),
        ).toEqual(facts);
      }
    });

    test("anything else is no facts", () => {
      for (const value of [
        null,
        undefined,
        "AWS Health: EC2 operational issue (open)",
        [],
        { source: "aws-health", event: "EC2", status: "" },
        { source: CloudHealthSource.Aws, event: "", status: "" },
        { source: CloudHealthSource.Aws, event: "EC2", status: 1 },
        { source: CloudHealthSource.Aws, event: 5, status: "open" },
        {
          source: CloudHealthSource.Aws,
          event: "EC2 operational issue",
          status: "open",
          awsEventTypeCode: 7,
        },
      ]) {
        expect(readCloudHealthTitleFactsJson(value)).toBeNull();
      }
    });
  });
});
