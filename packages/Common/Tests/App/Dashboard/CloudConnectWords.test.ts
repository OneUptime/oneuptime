import { describe, expect, test } from "@jest/globals";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import { Green, Red, Yellow, Gray500 } from "../../../Types/BrandColors";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { getCloudResourceTypeLabel } from "../../../Types/Cloud/CloudResourceCatalog";
import {
  CloudConnectionCostEstimate,
  estimateCloudConnectionCost,
} from "../../../Types/CloudConnection/CloudConnectionCost";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
} from "../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../Types/JSON";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  CloudConnectionHealth,
  CloudTemplate,
  CloudWords,
  LAST_READ_AT,
  LISTED_REGION_COUNT,
  MORE_COUNT,
  NOT_READ_YET,
  PASTE_HOLDS_NOTHING,
  PASTE_NOTHING_YET,
  PASTE_STILL_MISSING,
  drawCloudTemplate,
  getAccountsNotInName,
  getCloudAccountsWords,
  getCloudConnectionHealth,
  getCloudCostWords,
  getCloudFailureWords,
  getCloudReadFailureWords,
  getCloudReadIntervalWords,
  getCloudRegionNames,
  getCloudTestWords,
  getResourceCountWords,
  getResourceTypeEntries,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionWords";

/*
 * What Cloud > Connect says about a connection, React-free:
 *
 *   - a test's headline says "It works", never "Connected" (nothing is
 *     saved by a test), and a failure says what to do by its kind, with
 *     the cloud's own answer kept apart as the details;
 *   - a connection is off, waiting for its first read, working, or not
 *     working - and "not working" carries the stored error itself;
 *   - counts are plurals in the reader's language, numbers are written
 *     their way, and how often a connection is read reads naturally;
 *   - a row of the list names the first two regions a read found
 *     resources in, and how many more, and when it was last read;
 *   - what reading the resources costs comes from the cloud's own prices;
 *   - what a connection reads is named in its cloud's own word (an AWS
 *     account, an Azure subscription, a Google Cloud project), and a row
 *     of the list does not repeat what its name already says;
 *   - the Credentials step says once, on the paste, why it cannot go on.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

// A German reader whose language words these sentences.
const GERMAN: Translator = createTranslator((text: string) => {
  const words: Record<string, string> = {
    "{{count}} resources": "{{count}} Ressourcen",
    "{{count}} resources_one": "{{count}} Ressource",
    "+{{count}} more": "+{{count}} weitere",
    "+{{count}} more_one": "+{{count}} weitere",
    "Last read {{time}}": "Zuletzt gelesen {{time}}",
    "Reading these every {{minutes}} minutes costs about ${{cost}} a month in your cloud's monitoring charges.":
      "Diese alle {{minutes}} Minuten zu lesen, kostet etwa {{cost}} USD pro Monat.",
    "Every {{minutes}} minutes": "Alle {{minutes}} Minuten",
    "Subscriptions: {{accounts}}": "Abonnements: {{accounts}}",
    "Subscriptions: {{accounts}}_one": "Abonnement: {{accounts}}",
  };
  return words[text];
}, "de");

function result(
  data: Partial<CloudConnectionTestResult>,
): CloudConnectionTestResult {
  return {
    provider: CloudProvider.AWS,
    status: "pass",
    message: "",
    durationMs: 10,
    ...data,
  };
}

function summary(data: JSONObject): Pick<CloudConnection, "lastPullResult"> {
  return {
    lastPullResult: {
      status: "success",
      accounts: ["123456789012"],
      resourceCount: 0,
      resourceTypes: [],
      regions: [],
      newResources: 0,
      archivedResources: 0,
      pointsWritten: 0,
      requestCount: 0,
      warnings: [],
      durationMs: 1,
      finishedAt: "2026-10-21T10:00:00.000Z",
      ...data,
    },
  } as Pick<CloudConnection, "lastPullResult">;
}

describe("a test's answer", () => {
  test("a pass says it works and what was found to monitor - never 'Connected'", () => {
    const words: CloudWords = getCloudTestWords(result({ status: "pass" }));

    expect(words.headline).toBe(
      "It works. Here is what OneUptime found to monitor.",
    );
    expect(words.headline).not.toContain("Connected");
    expect(words.advice).toBeUndefined();
    expect(words.details).toBeUndefined();
  });

  test("a warning works but found nothing, and says where resources come from", () => {
    const words: CloudWords = getCloudTestWords(result({ status: "warn" }));

    expect(words.headline).toBe(
      "It works, but OneUptime found no resources to monitor yet.",
    );
    // The inventory lists them all: metrics are not how a resource arrives.
    expect(words.advice).toContain(
      "The first read lists every resource of the account, whether it reports metrics or not.",
    );
    expect(words.advice).not.toContain("once they report metrics");
  });

  test.each([
    [
      CloudConnectionFailureKind.Authentication,
      "The key or secret was not accepted.",
      "Copy everything the command printed",
    ],
    [
      CloudConnectionFailureKind.Permission,
      "Signed in, but this access cannot read what OneUptime needs.",
      "Run the setup command again",
    ],
    [
      CloudConnectionFailureKind.RateLimited,
      "The cloud asked OneUptime to slow down.",
      "Test again in a minute.",
    ],
    [
      CloudConnectionFailureKind.Unavailable,
      "The cloud could not be reached.",
      "can reach the cloud's APIs",
    ],
    [
      CloudConnectionFailureKind.Settings,
      "A setting is not right.",
      "Fix the setting named below",
    ],
    [
      CloudConnectionFailureKind.Other,
      "The cloud refused the test.",
      "Its answer is below.",
    ],
  ])(
    "a %s failure says what to fix, with the cloud's answer as the details",
    (kind: CloudConnectionFailureKind, headline: string, advice: string) => {
      const words: CloudWords = getCloudTestWords(
        result({
          status: "fail",
          failureKind: kind,
          message: "AccessDenied: not authorized",
        }),
      );

      expect(words.headline).toBe(headline);
      expect(words.advice).toContain(advice);
      expect(words.details).toBe("AccessDenied: not authorized");
    },
  );

  test("a failure of no known kind reads as the cloud's refusal", () => {
    expect(getCloudFailureWords(undefined).headline).toBe(
      "The cloud refused the test.",
    );
    expect(
      getCloudFailureWords("something-new" as CloudConnectionFailureKind)
        .headline,
    ).toBe("The cloud refused the test.");
  });
});

describe("a read's failure", () => {
  test("a known kind is said the way a test says it", () => {
    expect(
      getCloudReadFailureWords(
        summary({
          status: "failed",
          failureKind: CloudConnectionFailureKind.Permission,
        }),
      )?.headline,
    ).toBe("Signed in, but this access cannot read what OneUptime needs.");
  });

  test("a read that worked, one of no known kind, and none yet say nothing", () => {
    expect(getCloudReadFailureWords(summary({}))).toBeUndefined();
    expect(
      getCloudReadFailureWords(
        summary({
          status: "failed",
          failureKind: CloudConnectionFailureKind.Other,
        }),
      ),
    ).toBeUndefined();
    expect(getCloudReadFailureWords(new CloudConnection())).toBeUndefined();
  });
});

describe("how a connection is doing", () => {
  test("off: not read until it is turned on", () => {
    const health: CloudConnectionHealth = getCloudConnectionHealth({
      isEnabled: false,
      lastError: "an old error",
    });

    expect(health).toMatchObject({ key: "off", label: "Off", color: Gray500 });
    expect(health.tooltipIsError).toBe(false);
  });

  test("never read: waiting for the first read", () => {
    expect(getCloudConnectionHealth({ isEnabled: true })).toMatchObject({
      key: "waiting",
      label: "Waiting for the first read",
      color: Yellow,
    });
  });

  test("its last read worked: working", () => {
    expect(
      getCloudConnectionHealth({
        isEnabled: true,
        lastPulledAt: new Date("2026-10-21T10:00:00Z"),
        lastSuccessfulPullAt: new Date("2026-10-21T10:00:00Z"),
      }),
    ).toMatchObject({ key: "working", label: "Working", color: Green });
  });

  test("its last read failed after one that worked: not working, the stored error as its words", () => {
    const health: CloudConnectionHealth = getCloudConnectionHealth({
      isEnabled: true,
      lastPulledAt: new Date("2026-10-21T10:10:00Z"),
      lastSuccessfulPullAt: new Date("2026-10-21T10:00:00Z"),
      lastError: "AccessDenied: role cannot be assumed",
    });

    expect(health).toMatchObject({
      key: "failing",
      label: "Not working",
      color: Red,
      tooltip: "AccessDenied: role cannot be assumed",
      tooltipIsError: true,
    });
  });

  test("an error from before the last good read is history", () => {
    expect(
      getCloudConnectionHealth({
        isEnabled: true,
        lastPulledAt: new Date("2026-10-21T10:00:00Z"),
        lastSuccessfulPullAt: new Date("2026-10-21T10:00:00Z"),
        lastError: "an old error",
      }).key,
    ).toBe("working");
  });
});

describe("counts in the reader's language", () => {
  test("one resource, and many, in English", () => {
    expect(drawCloudTemplate(ENGLISH, getResourceCountWords(1))).toBe(
      "1 resource",
    );
    expect(drawCloudTemplate(ENGLISH, getResourceCountWords(1234))).toBe(
      "1,234 resources",
    );
  });

  test("German words and German numbers", () => {
    expect(drawCloudTemplate(GERMAN, getResourceCountWords(1))).toBe(
      "1 Ressource",
    );
    expect(drawCloudTemplate(GERMAN, getResourceCountWords(1234))).toBe(
      "1.234 Ressourcen",
    );
  });

  test("how often: every few minutes, or every hour", () => {
    expect(drawCloudTemplate(ENGLISH, getCloudReadIntervalWords(10))).toBe(
      "Every 10 minutes",
    );
    expect(drawCloudTemplate(GERMAN, getCloudReadIntervalWords(5))).toBe(
      "Alle 5 Minuten",
    );
    expect(getCloudReadIntervalWords(60).template).toBe("Every hour");
  });

  test("a sentence the reader's language does not word stays English; its count is still written their way", () => {
    const words: CloudTemplate = getResourceCountWords(1500);

    // No Russian words: the sentence is English, its count Russian-written.
    expect(
      drawCloudTemplate(
        createTranslator(() => {
          return undefined;
        }, "ru"),
        words,
      ),
    ).toBe(`${(1500).toLocaleString("ru")} resources`);
  });

  test("when it was last read, and never, in the reader's language", () => {
    expect(
      ENGLISH.translateTemplate(LAST_READ_AT, { time: "Oct 21, 09:50" }),
    ).toBe("Last read Oct 21, 09:50");
    expect(
      GERMAN.translateTemplate(LAST_READ_AT, { time: "Oct 21, 09:50" }),
    ).toBe("Zuletzt gelesen Oct 21, 09:50");
    expect(ENGLISH.translateText(NOT_READ_YET)).toBe("Not read yet");
  });
});

describe("where a read found resources, as a row of the list names it", () => {
  test("the first two regions, most first, and how many more", () => {
    expect(LISTED_REGION_COUNT).toBe(2);
    expect(
      getCloudRegionNames([
        { region: "us-east-1", count: 31 },
        { region: "eu-west-1", count: 15 },
        { region: "ap-south-1", count: 4 },
        { region: "sa-east-1", count: 1 },
      ]),
    ).toEqual({ names: ["us-east-1", "eu-west-1"], more: 2 });
    expect(ENGLISH.translatePlural(MORE_COUNT, 2)).toBe("+2 more");
    expect(GERMAN.translatePlural(MORE_COUNT, 2)).toBe("+2 weitere");
  });

  test("one or two regions are all named; a resource with no region names none", () => {
    expect(getCloudRegionNames([{ region: "westeurope", count: 12 }])).toEqual({
      names: ["westeurope"],
      more: 0,
    });
    expect(
      getCloudRegionNames([
        { region: "", count: 3 },
        { region: "europe-west1", count: 9 },
      ]),
    ).toEqual({ names: ["europe-west1"], more: 0 });
    expect(getCloudRegionNames([])).toEqual({ names: [], more: 0 });
  });
});

describe("the resources by service", () => {
  test("each type by the catalog's name for it, most first as the read counted them", () => {
    expect(
      getResourceTypeEntries({
        provider: CloudProvider.Azure,
        resourceTypes: [
          { type: "Microsoft.Compute/virtualMachines", count: 3 },
          { type: "Contoso.Custom/widgets", count: 1 },
        ],
      }),
    ).toEqual([
      {
        label: getCloudResourceTypeLabel(
          CloudProvider.Azure,
          "Microsoft.Compute/virtualMachines",
        ),
        count: 3,
      },
      {
        label: getCloudResourceTypeLabel(
          CloudProvider.Azure,
          "Contoso.Custom/widgets",
        ),
        count: 1,
      },
    ]);
  });
});

describe("what reading them costs", () => {
  test("AWS: priced per metric read, at the interval the connection is read", () => {
    const resourceTypes: Array<{ type: string; count: number }> = [
      { type: "AWS::EC2::Instance", count: 40 },
    ];
    const estimate: CloudConnectionCostEstimate = estimateCloudConnectionCost({
      provider: CloudProvider.AWS,
      resourceTypes,
      readIntervalInMinutes: 10,
      accounts: 1,
    });

    expect(estimate.monthlyCostUsd).toBeGreaterThan(0.01);

    const words: CloudTemplate = getCloudCostWords({
      provider: CloudProvider.AWS,
      resourceTypes,
      readIntervalInMinutes: 10,
      accounts: 1,
    });
    const cost: number = Math.round(estimate.monthlyCostUsd * 100) / 100;

    expect(drawCloudTemplate(ENGLISH, words)).toBe(
      `Reading these every 10 minutes costs about $${cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a month in your cloud's monitoring charges.`,
    );
    expect(drawCloudTemplate(GERMAN, words)).toBe(
      `Diese alle 10 Minuten zu lesen, kostet etwa ${cost.toLocaleString("de", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD pro Monat.`,
    );
  });

  test("AWS with nothing to read: under a cent", () => {
    expect(
      getCloudCostWords({
        provider: CloudProvider.AWS,
        resourceTypes: [],
        readIntervalInMinutes: 10,
        accounts: 1,
      }).template,
    ).toBe("Reading these costs under a cent a month in CloudWatch charges.");
  });

  test("Google Cloud and Azure: a few resources fit in the free allowance", () => {
    for (const [provider, type] of [
      [CloudProvider.GCP, "gce_instance"],
      [CloudProvider.Azure, "Microsoft.Compute/virtualMachines"],
    ] as Array<[CloudProvider, string]>) {
      expect(
        getCloudCostWords({
          provider,
          resourceTypes: [{ type, count: 3 }],
          readIntervalInMinutes: 5,
          accounts: 1,
        }).template,
      ).toBe(
        "Reading these fits in your cloud's free monthly allowance for monitoring reads.",
      );
    }
  });
});

describe("what a connection reads, in its cloud's word", () => {
  test.each([
    [CloudProvider.AWS, ["123456789012"], "Account: 123456789012"],
    [
      CloudProvider.AWS,
      ["123456789012", "210987654321"],
      "Accounts: 123456789012, 210987654321",
    ],
    [
      CloudProvider.Azure,
      ["7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"],
      "Subscription: 7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b",
    ],
    [CloudProvider.Azure, ["sub-1", "sub-2"], "Subscriptions: sub-1, sub-2"],
    [CloudProvider.GCP, ["acme-prod"], "Project: acme-prod"],
    [
      CloudProvider.GCP,
      ["acme-prod", "acme-dev"],
      "Projects: acme-prod, acme-dev",
    ],
  ] as Array<[CloudProvider, Array<string>, string]>)(
    "%s reading %j says %s",
    (provider: CloudProvider, accounts: Array<string>, said: string) => {
      const words: CloudTemplate | undefined = getCloudAccountsWords({
        provider,
        accounts,
      });

      expect(drawCloudTemplate(ENGLISH, words!)).toBe(said);
    },
  );

  test("nothing read names nothing - an empty account is not one", () => {
    expect(
      getCloudAccountsWords({ provider: CloudProvider.AWS, accounts: [] }),
    ).toBeUndefined();
    expect(
      getCloudAccountsWords({
        provider: CloudProvider.GCP,
        accounts: ["", " "],
      }),
    ).toBeUndefined();
  });

  test("a cloud the catalog does not know is read as accounts", () => {
    expect(
      drawCloudTemplate(
        ENGLISH,
        getCloudAccountsWords({ provider: "oracle", accounts: ["a", "b"] })!,
      ),
    ).toBe("Accounts: a, b");
  });

  test("in the reader's language, one and many", () => {
    expect(
      drawCloudTemplate(
        GERMAN,
        getCloudAccountsWords({
          provider: CloudProvider.Azure,
          accounts: ["sub-1"],
        })!,
      ),
    ).toBe("Abonnement: sub-1");
    expect(
      drawCloudTemplate(
        GERMAN,
        getCloudAccountsWords({
          provider: CloudProvider.Azure,
          accounts: ["sub-1", "sub-2"],
        })!,
      ),
    ).toBe("Abonnements: sub-1, sub-2");
  });

  test("a row names only the accounts its name does not already say", () => {
    expect(
      getAccountsNotInName({
        name: "AWS 123456789012",
        accounts: ["123456789012"],
      }),
    ).toEqual([]);
    expect(
      getAccountsNotInName({
        name: "Google Cloud ACME-PROD",
        accounts: ["acme-prod", "acme-dev"],
      }),
    ).toEqual(["acme-dev"]);
    expect(
      getAccountsNotInName({
        name: "Contoso production",
        accounts: ["7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"],
      }),
    ).toEqual(["7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"]);
    expect(
      getAccountsNotInName({ name: undefined, accounts: ["", "acme-prod"] }),
    ).toEqual(["acme-prod"]);
  });
});

describe("why the Credentials step cannot go on", () => {
  test("nothing pasted, a paste that holds nothing, and a value still missing are three sentences", () => {
    expect(PASTE_NOTHING_YET).toBe("Paste everything the command printed.");
    expect(PASTE_HOLDS_NOTHING).toBe(
      "Nothing OneUptime needs is in this yet. Copy everything the command printed.",
    );
    expect(
      ENGLISH.translateTemplate(PASTE_STILL_MISSING, {
        fields: "Client secret",
      }),
    ).toBe(
      "Still missing: Client secret. Paste everything the command printed, or enter the values below.",
    );
  });
});
