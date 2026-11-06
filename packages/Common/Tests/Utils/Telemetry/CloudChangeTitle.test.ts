import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Dictionary from "../../../Types/Dictionary";
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
  CLOUD_CHANGE_TITLE_SENTENCES,
  CLOUD_HEALTH_STATE_WORDS,
  CLOUD_HEALTH_TITLE_SENTENCES,
  CloudChangeTitleFacts,
  CloudHealthSource,
  CloudHealthTitleFacts,
  getChangeTitleForReader,
  getCloudChangeTitle,
  getCloudHealthTitle,
  readCloudChangeTitleFacts,
  readCloudChangeTitleFactsJson,
  readCloudHealthTitleFacts,
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
 * reader's language; the event is the provider's words, drawn as written.
 */
describe("a health event's title", () => {
  function health(title: string): {
    title: string;
    attributes: Dictionary<string>;
  } {
    return {
      title,
      attributes: {
        [ChangeEventAttribute.Source]: ChangeEventSource.CloudHealth,
        [ChangeEventAttribute.CloudOperation]: "AWS_EC2_OPERATIONAL_ISSUE",
      },
    };
  }

  function factsOf(title: string): CloudHealthTitleFacts {
    const facts: CloudHealthTitleFacts | null = readCloudHealthTitleFacts(
      health(title),
    );

    expect(facts).not.toBeNull();
    return facts!;
  }

  test.each([
    "AWS Health: EC2 operational issue (open)",
    "AWS Health: EC2 operational issue (closed)",
    "AWS Health: RDS maintenance scheduled (upcoming)",
    "AWS Health: EC2 operational issue",
    "Azure Service Health: Network connectivity issues in West Europe (Active)",
    "Azure Service Health: Network connectivity issues in West Europe (Resolved)",
    "Azure Service Health: an event",
    "Azure Resource Health: Available → Unavailable",
    "Azure Resource Health: Unavailable",
    "Azure Resource Health: The virtual machine is starting",
    "Google Cloud Service Health: Cloud SQL latency in us-central1 (active)",
    "Google Cloud Service Health: Cloud SQL latency in us-central1 (closed)",
  ])(
    "reads back as its connector stored it, in English: %s",
    (title: string) => {
      expect(getCloudHealthTitle(factsOf(title))).toBe(title);
    },
  );

  test("the event is the provider's words, and the state the one it reports", () => {
    expect(factsOf("AWS Health: EC2 operational issue (open)")).toEqual({
      source: CloudHealthSource.Aws,
      event: "EC2 operational issue",
      status: "open",
    });
    expect(factsOf("Azure Resource Health: Degraded → Available")).toEqual({
      source: CloudHealthSource.AzureResource,
      event: "Available",
      status: "Degraded",
    });
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

  test("each connector still starts its titles the way they are read", () => {
    const read: (file: string) => string = (file: string): string => {
      return fs.readFileSync(
        path.join(__dirname, "../../../Server/Utils/CloudConnection", file),
        "utf8",
      );
    };

    expect(read("Aws/AwsChanges.ts")).toContain("title: `AWS Health: ${");
    expect(read("Azure/AzureChanges.ts")).toContain(
      "title: `Azure Service Health: ${",
    );
    expect(read("Azure/AzureChanges.ts")).toContain(
      "title: `Azure Resource Health: ${",
    );
    expect(read("Azure/AzureChanges.ts")).toContain("→ ");
    expect(read("Gcp/GcpChanges.ts")).toContain(
      "title: `Google Cloud Service Health: ${",
    );
  });

  test("German, Japanese and Persian say the frame and the state in their words, the event as written", () => {
    expect(
      getCloudHealthTitle(
        factsOf("AWS Health: EC2 operational issue (open)"),
        dashboardTranslator("de"),
      ),
    ).toBe("AWS Health: EC2 operational issue (offen)");
    expect(
      getCloudHealthTitle(
        factsOf("Azure Resource Health: Available → Unavailable"),
        dashboardTranslator("de"),
      ),
    ).toBe("Azure Resource Health: Verfügbar → Nicht verfügbar");
    expect(
      getCloudHealthTitle(
        factsOf("AWS Health: RDS maintenance scheduled (upcoming)"),
        dashboardTranslator("ja"),
      ),
    ).toBe("AWS Health: RDS maintenance scheduled (予定)");
    expect(
      withoutIsolateMarks(
        getCloudHealthTitle(
          factsOf("Google Cloud Service Health: Cloud SQL latency (closed)"),
          dashboardTranslator("fa"),
        ),
      ),
    ).toBe("Google Cloud Service Health: Cloud SQL latency (بسته‌شده)");
  });

  test("a Persian title drawn on a page sets its own state apart in the Latin frame", () => {
    expect(
      getCloudHealthTitle(
        factsOf("AWS Health: EC2 operational issue (open)"),
        dashboardTranslator("fa"),
        { setsValuesApart: true },
      ),
    ).toBe(`AWS Health: EC2 operational issue (${isolated("باز")})`);
  });

  test("every language has each frame with its values, and its own word for each state", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentences of Object.values(CLOUD_HEALTH_TITLE_SENTENCES)) {
        for (const sentence of [sentences.event, sentences.eventWithStatus]) {
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
      }

      for (const states of Object.values(CLOUD_HEALTH_STATE_WORDS)) {
        for (const word of Object.values(states)) {
          expect({ language, word, worded: Boolean(words[word]) }).toEqual({
            language,
            word,
            worded: true,
          });

          // A word new for these titles is each language's own (Dutch rightly writes open as open).
          if (language !== "en" && ["closed", "upcoming"].includes(word)) {
            expect({ language, word, english: words[word] === word }).toEqual({
              language,
              word,
              english: false,
            });
          }
        }
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
    ).toBe("AWS Health: EC2 operational issue (geschlossen)");
    expect(
      getChangeTitleForReader({
        title: "Failed: DeleteLoadBalancer on web-alb",
        facts: { operation: OPERATION, resource: RESOURCE, failed: true },
        health: factsOf("AWS Health: EC2 operational issue (closed)"),
        translator: dashboardTranslator("de"),
      }),
    ).toBe("Fehlgeschlagen: DeleteLoadBalancer für web-alb");
  });
});
