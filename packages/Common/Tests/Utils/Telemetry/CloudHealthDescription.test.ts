import { describe, expect, test } from "@jest/globals";
import Dictionary from "../../../Types/Dictionary";
import { getTemplatePlaceholders } from "../../../Types/Translator";
import {
  ChangeEventAttribute,
  ChangeEventSource,
} from "../../../Utils/Telemetry/ChangeEventFields";
import {
  asOneSentence,
  AZURE_RESOURCE_HEALTH_CAUSE_SENTENCES,
  AZURE_SERVICE_HEALTH_PUBLISHED,
  AZURE_SERVICE_HEALTH_PUBLISHED_SENTENCES,
  AZURE_SERVICE_HEALTH_TRACKING_ID,
  AzureResourceHealthCause,
  CLOUD_HEALTH_PUBLISHED_SENTENCES,
  CloudHealthDescription,
  CloudHealthDescriptionFacts,
  CloudHealthDescriptionKind,
  getCloudHealthDescription,
  GOOGLE_CLOUD_AFFECTS_SENTENCE,
  joinSentences,
  readCloudHealthDescriptionFacts,
} from "../../../Utils/Telemetry/CloudHealthDescription";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { fastestRun, FastestRun } from "../../Helpers/FastestRun";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A CLOUD HEALTH EVENT'S DESCRIPTION, IN THE READER'S LANGUAGE WHERE IT IS
 * OURS (#6149's follow-up).
 *
 * The provider's own words - an AWS Health or Google Cloud event's
 * description, an Azure resource's health title - are drawn as written:
 * OneUptime never translates or rewrites what a provider said. OneUptime's
 * own sentences in a description - an Azure Service Health event's kind and
 * tracking id, what caused an Azure resource's change, the products a
 * Google Cloud incident affects, who published an event that came without
 * words - are read back off the stored English, old rows too, and worded in
 * the reader's language.
 */

function healthAttributes(
  provider: string,
  operation: string,
  overrides: Dictionary<string> = {},
): Dictionary<string> {
  return {
    [ChangeEventAttribute.Source]: ChangeEventSource.CloudHealth,
    [ChangeEventAttribute.CloudProvider]: provider,
    [ChangeEventAttribute.CloudAccountId]: "123456789012",
    [ChangeEventAttribute.CloudOperation]: operation,
    ...overrides,
  };
}

function facts(
  provider: string,
  operation: string,
  description: string | undefined,
): CloudHealthDescriptionFacts | null {
  return readCloudHealthDescriptionFacts({
    description,
    attributes: healthAttributes(provider, operation),
  });
}

function described(
  provider: string,
  operation: string,
  description: string,
  language: string = "en",
): CloudHealthDescription {
  const read: CloudHealthDescriptionFacts | null = facts(
    provider,
    operation,
    description,
  );

  expect(read).not.toBeNull();

  return getCloudHealthDescription(
    read as CloudHealthDescriptionFacts,
    dashboardTranslator(language),
  );
}

const AWS_DESCRIPTION: string =
  "[Investigating] We are investigating increased API error rates for the RunInstances API in the US-EAST-1 Region. Existing instances are not affected.";

describe("what is read", () => {
  test("only a health event's description", () => {
    expect(
      readCloudHealthDescriptionFacts({
        description: "maya.lopez ran AuthorizeSecurityGroupIngress.",
        attributes: { [ChangeEventAttribute.Source]: ChangeEventSource.Cloud },
      }),
    ).toBeNull();
    expect(
      readCloudHealthDescriptionFacts({
        description: AWS_DESCRIPTION,
        attributes: undefined,
      }),
    ).toBeNull();
  });

  test("nothing, when it has no words", () => {
    expect(facts("aws", "AWS_EC2_OPERATIONAL_ISSUE", undefined)).toBeNull();
    expect(facts("aws", "AWS_EC2_OPERATIONAL_ISSUE", "   ")).toBeNull();
    expect(facts("azure", "ResourceHealth Unavailable", ".")).toBeNull();
  });
});

describe("the provider's own words", () => {
  test("an AWS Health event's description is drawn as written, in every language", () => {
    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      expect({
        language,
        description: described(
          "aws",
          "AWS_EC2_OPERATIONAL_ISSUE",
          AWS_DESCRIPTION,
          language,
        ),
      }).toEqual({
        language,
        description: { written: AWS_DESCRIPTION, worded: "" },
      });
    }
  });

  test("a Google Cloud incident's own description is drawn as written", () => {
    const own: string =
      "We are experiencing an issue with Cloud SQL in us-east1. Affects new connections.";

    expect(facts("gcp", "INCIDENT", own)).toEqual({
      kind: CloudHealthDescriptionKind.Written,
      text: own,
    });
    // A sentence of its own that starts like OneUptime's: still Google's.
    expect(
      facts("gcp", "INCIDENT", "Affects users of Cloud SQL. More soon."),
    ).toEqual({
      kind: CloudHealthDescriptionKind.Written,
      text: "Affects users of Cloud SQL. More soon.",
    });
    expect(facts("gcp", "INCIDENT", "Affects Cloud SQL\nin us-east1.")).toEqual(
      {
        kind: CloudHealthDescriptionKind.Written,
        text: "Affects Cloud SQL\nin us-east1.",
      },
    );
  });

  test("an Azure description of a shape no rule knows is Azure's words", () => {
    for (const description of [
      "Incident published by Azure, tracking id ABC-123, region West Europe.",
      "Service issue published by Azure, tracking id ABC-123.",
      "Incident published by Azure, tracking id ABC-123",
      "Something else entirely.",
    ]) {
      expect(facts("azure", "ServiceHealth Incident", description)).toEqual({
        kind: CloudHealthDescriptionKind.Written,
        text: description,
      });
    }
  });

  test("a rule for one cloud never reads another's", () => {
    // An AWS description that happens to read like Azure's or Google's.
    for (const description of [
      "Incident published by Azure, tracking id ABC-123, stage Active.",
      "Affects Amazon EC2.",
    ]) {
      expect(facts("aws", "AWS_EC2_OPERATIONAL_ISSUE", description)).toEqual({
        kind: CloudHealthDescriptionKind.Written,
        text: description,
      });
    }
  });
});

describe("an Azure Service Health event", () => {
  const STORED: string =
    "Incident published by Azure, tracking id ABC-123, stage Active.";

  test("is read back from the connector's sentence", () => {
    expect(facts("azure", "ServiceHealth Incident", STORED)).toEqual({
      kind: CloudHealthDescriptionKind.AzureServicePublished,
      incidentType: "Incident",
      trackingId: "ABC-123",
    });
    // Its parts are each optional, as the connector writes them.
    expect(
      facts("azure", "ServiceHealth", "Published by Azure, stage Active."),
    ).toEqual({
      kind: CloudHealthDescriptionKind.AzureServicePublished,
      incidentType: "",
      trackingId: "",
    });
    expect(
      facts(
        "azure",
        "ServiceHealth Maintenance",
        "Maintenance published by Azure.",
      ),
    ).toEqual({
      kind: CloudHealthDescriptionKind.AzureServicePublished,
      incidentType: "Maintenance",
      trackingId: "",
    });
  });

  test("says its kind and its tracking id in plain words; the stage is its title's", () => {
    expect(described("azure", "ServiceHealth Incident", STORED)).toEqual({
      written: "",
      worded: "Azure published an incident. Tracking ID: ABC-123.",
    });
  });

  test.each([
    ["Incident", "Azure published an incident."],
    ["Maintenance", "Azure published planned maintenance."],
    ["Information", "Azure published a health advisory."],
    ["ActionRequired", "Azure published an advisory that needs your action."],
    ["Security", "Azure published a security advisory."],
  ])("%s is worded as a whole sentence", (type: string, sentence: string) => {
    expect(
      described(
        "azure",
        `ServiceHealth ${type}`,
        `${type} published by Azure, tracking id XY-1, stage Active.`,
      ).worded,
    ).toBe(`${sentence} Tracking ID: XY-1.`);
  });

  test("a kind it does not name is published by Azure; no tracking id, no second sentence", () => {
    expect(
      described(
        "azure",
        "ServiceHealth Outage",
        "Outage published by Azure, tracking id XY-1, stage Active.",
      ).worded,
    ).toBe("Published by Azure. Tracking ID: XY-1.");
    expect(
      described(
        "azure",
        "ServiceHealth Incident",
        "Incident published by Azure.",
      ).worded,
    ).toBe("Azure published an incident.");
  });

  test("in German, French, Japanese and Persian", () => {
    expect(
      described("azure", "ServiceHealth Incident", STORED, "de").worded,
    ).toBe("Azure hat einen Vorfall veröffentlicht. Tracking-ID: ABC-123.");
    expect(
      described("azure", "ServiceHealth Incident", STORED, "fr").worded,
    ).toBe("Azure a publié un incident. ID de suivi : ABC-123.");
    expect(
      described("azure", "ServiceHealth Incident", STORED, "ja").worded,
    ).toBe("Azure がインシデントを公開しました。追跡 ID: ABC-123。");

    const persian: string = described(
      "azure",
      "ServiceHealth Incident",
      STORED,
      "fa",
    ).worded;

    expect(withoutIsolateMarks(persian)).toBe(
      "Azure یک حادثه منتشر کرد. شناسه پیگیری: ABC-123.",
    );
    // The tracking id is set apart, so its dash and digits keep their place.
    expect(persian).not.toBe(withoutIsolateMarks(persian));
  });
});

describe("an Azure resource's health", () => {
  test("keeps Azure's title as written, and words what caused it", () => {
    expect(
      described(
        "azure",
        "ResourceHealth Unavailable",
        "Virtual machine is unavailable. Azure caused it.",
      ),
    ).toEqual({
      written: "Virtual machine is unavailable.",
      worded: "Azure caused it.",
    });
    expect(
      described(
        "azure",
        "ResourceHealth Unavailable",
        "Virtual machine is unavailable. Azure caused it.",
        "de",
      ),
    ).toEqual({
      written: "Virtual machine is unavailable.",
      worded: "Azure hat es verursacht.",
    });
    expect(
      described(
        "azure",
        "ResourceHealth changed",
        "Rebooted by user. Someone with access caused it.",
        "es",
      ),
    ).toEqual({
      written: "Rebooted by user.",
      worded: "Lo causó alguien con acceso.",
    });
  });

  test("an older row's doubled full stop reads as one; a title's own ? stays", () => {
    expect(
      described(
        "azure",
        "ResourceHealth Unavailable",
        "The virtual machine is being restarted.. Azure caused it.",
      ).written,
    ).toBe("The virtual machine is being restarted.");
    expect(
      described(
        "azure",
        "ResourceHealth Unavailable",
        "Is it down? Azure caused it.",
      ).written,
    ).toBe("Is it down?");
  });

  test("a cause alone, without Azure's title", () => {
    expect(
      described(
        "azure",
        "ResourceHealth Unavailable",
        "Azure caused it.",
        "fr",
      ),
    ).toEqual({ written: "", worded: "Azure en est la cause." });
  });

  test("a title alone is Azure's words", () => {
    expect(
      facts(
        "azure",
        "ResourceHealth Unavailable",
        "Virtual machine is unavailable.",
      ),
    ).toEqual({
      kind: CloudHealthDescriptionKind.Written,
      text: "Virtual machine is unavailable.",
    });
  });

  test("the connector writes the cause with the very sentences the page reads", () => {
    expect(
      AZURE_RESOURCE_HEALTH_CAUSE_SENTENCES[AzureResourceHealthCause.Platform],
    ).toBe("Azure caused it.");
    expect(
      AZURE_RESOURCE_HEALTH_CAUSE_SENTENCES[AzureResourceHealthCause.User],
    ).toBe("Someone with access caused it.");
  });
});

describe("a Google Cloud incident that says nothing more", () => {
  test("names the products it affects, as Google names them, listed the reader's way", () => {
    const stored: string = "Affects Cloud SQL, Google Compute Engine.";

    expect(facts("gcp", "INCIDENT", stored)).toEqual({
      kind: CloudHealthDescriptionKind.GoogleCloudAffects,
      products: ["Cloud SQL", "Google Compute Engine"],
    });
    // English reads as stored.
    expect(described("gcp", "INCIDENT", stored).worded).toBe(stored);
    expect(described("gcp", "INCIDENT", stored, "de").worded).toBe(
      "Betrifft Cloud SQL, Google Compute Engine.",
    );
    expect(described("gcp", "INCIDENT", stored, "ja").worded).toBe(
      "Cloud SQL、Google Compute Engine に影響します。",
    );
    expect(
      withoutIsolateMarks(described("gcp", "INCIDENT", stored, "fa").worded),
    ).toBe("بر Cloud SQL، Google Compute Engine اثر می‌گذارد.");
  });
});

describe("an event that came without words", () => {
  const STORED: string =
    "AWS_EC2_OPERATIONAL_ISSUE, published by the cloud provider for account 123456789012 (us-east-1).";

  test("says who published it, for which account - its kind is its title's", () => {
    expect(facts("aws", "AWS_EC2_OPERATIONAL_ISSUE", STORED)).toEqual({
      kind: CloudHealthDescriptionKind.Published,
      provider: "aws",
      account: "123456789012 (us-east-1)",
    });
    expect(described("aws", "AWS_EC2_OPERATIONAL_ISSUE", STORED)).toEqual({
      written: "",
      worded: "Published by AWS for account 123456789012 (us-east-1).",
    });
    expect(
      described("aws", "AWS_EC2_OPERATIONAL_ISSUE", STORED, "de").worded,
    ).toBe("Von AWS für das Konto 123456789012 (us-east-1) veröffentlicht.");
    expect(
      described(
        "azure",
        "ResourceHealth Unavailable",
        "ResourceHealth Unavailable, published by the cloud provider for account d0cfe6b2.",
      ).worded,
    ).toBe("Published by Azure for account d0cfe6b2.");
  });

  test("a cloud OneUptime does not name is the cloud provider", () => {
    expect(
      described(
        "",
        "SOMETHING",
        "SOMETHING, published by the cloud provider for account acme.",
      ).worded,
    ).toBe("Published by the cloud provider for account acme.");
  });
});

describe("in every language", () => {
  const SENTENCES: Array<string> = [
    ...Object.values(AZURE_SERVICE_HEALTH_PUBLISHED_SENTENCES),
    AZURE_SERVICE_HEALTH_PUBLISHED,
    AZURE_SERVICE_HEALTH_TRACKING_ID,
    ...Object.values(AZURE_RESOURCE_HEALTH_CAUSE_SENTENCES),
    GOOGLE_CLOUD_AFFECTS_SENTENCE,
    CLOUD_HEALTH_PUBLISHED_SENTENCES.byProvider,
    CLOUD_HEALTH_PUBLISHED_SENTENCES.byCloudProvider,
  ];

  test("every sentence of ours is a key of the Dashboard's locale files", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const sentence of SENTENCES) {
      expect({ sentence, inEnglish: english[sentence] }).toEqual({
        sentence,
        inEnglish: sentence,
      });
    }
  });

  test("and every language words each one, with its values", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of SENTENCES) {
        expect({
          language,
          sentence,
          worded: isWordedInDashboardLocale(sentence, language),
          values: placeholdersOf(words[sentence] || ""),
        }).toEqual({
          language,
          sentence,
          worded: true,
          values: placeholdersOf(sentence),
        });
      }
    }
  });

  test("a sentence's values are only the facts it carries", () => {
    expect(getTemplatePlaceholders(AZURE_SERVICE_HEALTH_TRACKING_ID)).toEqual([
      "trackingId",
    ]);
    expect(getTemplatePlaceholders(GOOGLE_CLOUD_AFFECTS_SENTENCE)).toEqual([
      "products",
    ]);
    expect(
      getTemplatePlaceholders(CLOUD_HEALTH_PUBLISHED_SENTENCES.byProvider),
    ).toEqual(["provider", "account"]);
  });
});

describe("joinSentences", () => {
  test("a space between two sentences; none in Japanese or Chinese", () => {
    expect(joinSentences(["One.", "Two."], "en")).toBe("One. Two.");
    expect(joinSentences(["Eins.", "Zwei."], "de")).toBe("Eins. Zwei.");
    expect(joinSentences(["一。", "二。"], "ja")).toBe("一。二。");
    expect(joinSentences(["一。", "二。"], "zh-TW")).toBe("一。二。");
    expect(joinSentences(["하나.", "둘."], "ko")).toBe("하나. 둘.");
  });

  test("an empty sentence leaves no gap", () => {
    expect(joinSentences(["One.", ""], "en")).toBe("One.");
    expect(joinSentences(["", "Two."], "fr")).toBe("Two.");
  });
});

describe("asOneSentence", () => {
  test.each([
    ["Rebooted", "Rebooted."],
    ["Rebooted.", "Rebooted."],
    ["Rebooted..  ", "Rebooted."],
    ["Is it down?", "Is it down?"],
    ["Down!", "Down!"],
    ["", ""],
    [" . ", ""],
  ])("%j is %j", (text: string, sentence: string) => {
    expect(asOneSentence(text)).toBe(sentence);
  });
});

/*
 * Every read is a plain string read - startsWith, endsWith, indexOf, split -
 * never a pattern, so a description a cloud wrote takes time in line with
 * its length, whatever its shape.
 */
describe("a long description", () => {
  test.each([
    [
      "Azure's sentence with 100,000 parts",
      "azure",
      "ServiceHealth Incident",
      `Incident published by Azure${", stage Active".repeat(100000)}.`,
    ],
    [
      "a cause after 400,000 full stops",
      "azure",
      "ResourceHealth Unavailable",
      `${".".repeat(400000)} Azure caused it.`,
    ],
    [
      "a product list of 100,000 names",
      "gcp",
      "INCIDENT",
      `Affects ${"Cloud SQL, ".repeat(40000)}Compute Engine.`,
    ],
    [
      "a provider's 400,000 characters",
      "aws",
      "AWS_EC2_OPERATIONAL_ISSUE",
      `${"a, published by the cloud provider for account ".repeat(8000)}x`,
    ],
  ])(
    "%s is read in time that grows with it",
    (
      _name: string,
      provider: string,
      operation: string,
      description: string,
    ) => {
      const timed: FastestRun<CloudHealthDescription | null> = fastestRun({
        run: (): CloudHealthDescription | null => {
          const read: CloudHealthDescriptionFacts | null = facts(
            provider,
            operation,
            description,
          );

          return read
            ? getCloudHealthDescription(read, dashboardTranslator("de"))
            : null;
        },
        limitInMs: 2000,
      });

      expect(timed.result).not.toBeNull();
      expect(timed.inMs).toBeLessThan(2000);
    },
  );
});
