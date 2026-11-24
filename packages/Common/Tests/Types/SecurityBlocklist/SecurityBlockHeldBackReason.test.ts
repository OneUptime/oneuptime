import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SECURITY_BLOCK_REASON_FRAMES,
  SECURITY_PROTECTED_RESOURCE_KIND,
  SecurityBlockReason,
  fillSecurityBlockReason,
  frameSecurityBlockReason,
  isSecurityBlockHeldBackReason,
  readSecurityBlockReason,
  securityBlockHeldBackReason,
  securityBlockReason,
  securityProtectionReasons,
  toSecurityBlockReasonJson,
  wordSecurityBlockReason,
} from "../../../Types/SecurityBlocklist/SecurityBlockReason";
import {
  SECURITY_PROTECTED_ADDRESS_SENTENCES,
  SECURITY_PROTECTED_INSIDE_RANGE,
  SECURITY_PROTECTED_OWN_ADDRESS,
  SECURITY_PROTECTED_RANGE_HOLDS,
  SecurityAddressProtection,
  SecurityProtectedAddressSource,
  describeSecurityAddressProtection,
} from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * A HELD-BACK BLOCK'S ROW, IN THE READER'S LANGUAGE (#10804).
 *
 * When an address becomes protected after it was blocked, the reconciler
 * takes the block off everywhere and each row says why (#10640). That was
 * an English sentence in a text column, so a German reader saw it beside a
 * German chip. It is a reason now (#10629's shape): a frame that is a key
 * of the Dashboard's locales, around what protects the address - the
 * protected-address sentences, keys already, and the one before them that
 * says how a range meets what it holds. Filled in English it is the text
 * the column, the logs and the case's timeline always had, word for word.
 */

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

// Every language the Dashboard ships besides English.
const DASHBOARD_LANGUAGES: Array<string> = fs
  .readdirSync(DASHBOARD_LOCALES)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function translatorOf(
  wordings: Record<string, unknown>,
  language: string,
): Translator {
  return createTranslator((text: string): string | undefined => {
    const wording: unknown = wordings[text];

    return typeof wording === "string" ? wording : undefined;
  }, language);
}

// The held-back text as the reconciler wrote it before #10804, from describeSecurityAddressProtection.
function heldBackAsItWas(data: {
  value: string;
  protection: SecurityAddressProtection;
}): string {
  return `Held back: ${data.value} is protected now, so OneUptime took the block off. ${describeSecurityAddressProtection(
    data,
  )}`;
}

// One protection of every source, as the server reads them, named where a name belongs.
const PROTECTIONS: Array<SecurityAddressProtection> = [
  {
    source: SecurityProtectedAddressSource.ProtectedEntity,
    protectedValue: "35.205.11.131",
  },
  {
    source: SecurityProtectedAddressSource.LocalRange,
    protectedValue: "10.0.0.0/8",
  },
  {
    source: SecurityProtectedAddressSource.Host,
    protectedValue: "35.205.11.131",
    name: "web-3",
  },
  {
    source: SecurityProtectedAddressSource.KubernetesNode,
    protectedValue: "35.205.11.131",
    name: "node-a",
  },
  {
    source: SecurityProtectedAddressSource.CloudResource,
    protectedValue: "35.205.11.131",
    name: "prod-alb",
    kind: "AWS::ElasticLoadBalancingV2::LoadBalancer",
    where: "AWS account Production",
  },
  {
    source: SecurityProtectedAddressSource.CloudResource,
    protectedValue: "35.205.11.131",
    name: "prod-alb",
    kind: "AWS::ElasticLoadBalancingV2::LoadBalancer",
  },
  {
    source: SecurityProtectedAddressSource.NetworkDevice,
    protectedValue: "35.205.11.131",
    name: "core-sw-1",
  },
  {
    source: SecurityProtectedAddressSource.NetworkEndpoint,
    protectedValue: "35.205.11.131",
    name: "printer-2",
  },
  {
    source: SecurityProtectedAddressSource.AddressName,
    protectedValue: "35.205.11.0/24",
    name: "Office",
  },
  {
    source: SecurityProtectedAddressSource.Probe,
    protectedValue: "35.205.11.131",
    name: "Frankfurt probe",
  },
  {
    source: SecurityProtectedAddressSource.GlobalProbe,
    protectedValue: "35.205.11.131",
    name: "Europe",
  },
  {
    source: SecurityProtectedAddressSource.OneUptimeCloud,
    protectedValue: "35.205.11.131",
  },
  {
    source: SecurityProtectedAddressSource.Edge,
    protectedValue: "173.245.48.0/20",
    name: "Cloudflare",
  },
  {
    source: SecurityProtectedAddressSource.OneUptime,
    protectedValue: "oneuptime.example.com",
  },
  {
    source: SecurityProtectedAddressSource.EndpointProduct,
    protectedValue: "falcon.crowdstrike.com",
    name: "CrowdStrike Falcon",
  },
  {
    source: SecurityProtectedAddressSource.Monitor,
    protectedValue: "api.example.com",
    name: "API",
  },
  {
    source: SecurityProtectedAddressSource.StatusPage,
    protectedValue: "status.example.com",
    name: "Status",
  },
  {
    source: SecurityProtectedAddressSource.ProjectDomain,
    protectedValue: "example.com",
  },
  {
    source: SecurityProtectedAddressSource.EmptyFile,
    protectedValue:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
];

// A value that is the same as what is protected, and one that is not, for each protection.
function valuesFor(protection: SecurityAddressProtection): Array<string> {
  const values: Array<string> = [protection.protectedValue];

  if (protection.protectedValue === "35.205.11.131") {
    // A range that holds the address.
    values.push("35.205.11.0/24");
  }

  if (protection.protectedValue === "10.0.0.0/8") {
    // An address inside the range.
    values.push("10.1.2.3");
  }

  if (protection.protectedValue === "example.com") {
    // A name under the domain.
    values.push("shop.example.com");
  }

  return values;
}

const GERMAN: Translator = translatorOf(
  {
    [SECURITY_BLOCK_REASON_FRAMES.heldBack]:
      "Zurückgehalten: {{value}} ist jetzt geschützt, daher hat OneUptime die Sperre aufgehoben. {{protection}}",
    [SECURITY_BLOCK_REASON_FRAMES.heldBackOverlapping]:
      "Zurückgehalten: {{value}} ist jetzt geschützt, daher hat OneUptime die Sperre aufgehoben. {{overlap}} {{protection}}",
    [SECURITY_PROTECTED_OWN_ADDRESS]:
      "{{address}} ist eine der eigenen Adressen Ihres Projekts.",
    [SECURITY_PROTECTED_RANGE_HOLDS]: "{{value}} enthält {{address}}.",
    [SECURITY_PROTECTED_INSIDE_RANGE]: "{{value}} liegt in {{address}}.",
    [SECURITY_PROTECTED_ADDRESS_SENTENCES[
      SecurityProtectedAddressSource.CloudResource
    ]]: "{{address}} ist die Adresse von {{kind}} {{name}} in {{where}}.",
    [SECURITY_PROTECTED_ADDRESS_SENTENCES[SecurityProtectedAddressSource.Edge]]:
      "{{address}} ist eine Adresse von {{name}}, und {{name}} steht vor Ihrer App: eine Sperre würde Ihre Website lahmlegen.",
    [SECURITY_PROTECTED_RESOURCE_KIND]: "Ressource",
  },
  "de",
);

describe("a held-back block's reason, in English", () => {
  test("reads word for word as the row and the case's timeline did before #10804, for every protection and both shapes", () => {
    for (const protection of PROTECTIONS) {
      for (const value of valuesFor(protection)) {
        expect({
          source: protection.source,
          value,
          text: fillSecurityBlockReason(
            securityBlockHeldBackReason({ value, protection }),
          ),
        }).toEqual({
          source: protection.source,
          value,
          text: heldBackAsItWas({ value, protection }),
        });
      }
    }
  });

  test("its protection, alone, reads as describeSecurityAddressProtection writes it", () => {
    for (const protection of PROTECTIONS) {
      for (const value of valuesFor(protection)) {
        const sentences: {
          overlap: SecurityBlockReason | null;
          protection: SecurityBlockReason;
        } = securityProtectionReasons({ value, protection });
        const text: string = [sentences.overlap, sentences.protection]
          .filter((reason: SecurityBlockReason | null): boolean => {
            return Boolean(reason);
          })
          .map((reason: SecurityBlockReason | null): string => {
            return fillSecurityBlockReason(reason!);
          })
          .join(" ");

        expect({ source: protection.source, value, text }).toEqual({
          source: protection.source,
          value,
          text: describeSecurityAddressProtection({ value, protection }),
        });
      }
    }
  });

  test("an address that is what is protected says no overlap; a range that holds it says how", () => {
    const own: SecurityAddressProtection = {
      source: SecurityProtectedAddressSource.ProtectedEntity,
      protectedValue: "35.205.11.131",
    };

    const same: SecurityBlockReason = securityBlockHeldBackReason({
      value: "35.205.11.131",
      protection: own,
    });
    const range: SecurityBlockReason = securityBlockHeldBackReason({
      value: "35.205.11.0/24",
      protection: own,
    });

    expect(same.template).toBe(SECURITY_BLOCK_REASON_FRAMES.heldBack);
    expect(Object.keys(same.parts || {})).toEqual(["protection"]);
    expect(range.template).toBe(
      SECURITY_BLOCK_REASON_FRAMES.heldBackOverlapping,
    );
    expect(Object.keys(range.parts || {}).sort()).toEqual([
      "overlap",
      "protection",
    ]);
    expect(range.parts!["overlap"]!.template).toBe(
      SECURITY_PROTECTED_RANGE_HOLDS,
    );
    // An entry of the list with no name to show is said to be one of the project's own, as before.
    expect(fillSecurityBlockReason(range)).toBe(
      "Held back: 35.205.11.0/24 is protected now, so OneUptime took the block off. 35.205.11.0/24 holds 35.205.11.131. 35.205.11.131 is one of your project's own addresses.",
    );
  });

  test("keeps only the values its sentences say: no empty account, no stray name", () => {
    const sentences: {
      overlap: SecurityBlockReason | null;
      protection: SecurityBlockReason;
    } = securityProtectionReasons({
      value: "35.205.11.131",
      protection: {
        source: SecurityProtectedAddressSource.ProtectedEntity,
        protectedValue: "35.205.11.131",
        name: "Office",
      },
    });

    expect(sentences.overlap).toBeNull();
    expect(sentences.protection).toEqual({
      template:
        SECURITY_PROTECTED_ADDRESS_SENTENCES[
          SecurityProtectedAddressSource.ProtectedEntity
        ],
      values: { address: "35.205.11.131" },
    });
  });
});

describe("a held-back block's reason, in the reader's language", () => {
  test("is wholly German: its frame and what protects the address, the address as it is", () => {
    const reason: SecurityBlockReason = securityBlockHeldBackReason({
      value: "35.205.11.131",
      protection: {
        source: SecurityProtectedAddressSource.Host,
        protectedValue: "35.205.11.131",
      },
    });

    expect(wordSecurityBlockReason(reason, GERMAN)).toBe(
      "Zurückgehalten: 35.205.11.131 ist jetzt geschützt, daher hat OneUptime die Sperre aufgehoben. 35.205.11.131 ist eine der eigenen Adressen Ihres Projekts.",
    );
  });

  test("a range that holds the address says how in German too", () => {
    const reason: SecurityBlockReason = securityBlockHeldBackReason({
      value: "35.205.11.0/24",
      protection: {
        source: SecurityProtectedAddressSource.Edge,
        protectedValue: "35.205.11.131",
        name: "Cloudflare",
      },
    });

    expect(wordSecurityBlockReason(reason, GERMAN)).toBe(
      "Zurückgehalten: 35.205.11.0/24 ist jetzt geschützt, daher hat OneUptime die Sperre aufgehoben. 35.205.11.0/24 enthält 35.205.11.131. 35.205.11.131 ist eine Adresse von Cloudflare, und Cloudflare steht vor Ihrer App: eine Sperre würde Ihre Website lahmlegen.",
    );
  });

  test("a cloud resource of no known kind is the reader's word for one; a kind it names is written as the cloud writes it", () => {
    const unnamed: SecurityBlockReason = securityProtectionReasons({
      value: "35.205.11.131",
      protection: {
        source: SecurityProtectedAddressSource.CloudResource,
        protectedValue: "35.205.11.131",
        name: "prod-alb",
        where: "Production",
      },
    }).protection;
    const named: SecurityBlockReason = securityProtectionReasons({
      value: "35.205.11.131",
      protection: {
        source: SecurityProtectedAddressSource.CloudResource,
        protectedValue: "35.205.11.131",
        name: "prod-alb",
        kind: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        where: "Production",
      },
    }).protection;

    expect(wordSecurityBlockReason(unnamed, GERMAN)).toBe(
      "35.205.11.131 ist die Adresse von Ressource prod-alb in Production.",
    );
    expect(fillSecurityBlockReason(unnamed)).toBe(
      "35.205.11.131 is the address of resource prod-alb in Production.",
    );
    expect(wordSecurityBlockReason(named, GERMAN)).toBe(
      "35.205.11.131 ist die Adresse von AWS::ElasticLoadBalancingV2::LoadBalancer prod-alb in Production.",
    );
  });

  test("a language with no wording of the frame reads the whole row in English, never half of it", () => {
    const partial: Translator = translatorOf(
      {
        [SECURITY_PROTECTED_OWN_ADDRESS]:
          "{{address}} ist eine der eigenen Adressen Ihres Projekts.",
      },
      "de",
    );
    const reason: SecurityBlockReason = securityBlockHeldBackReason({
      value: "35.205.11.131",
      protection: {
        source: SecurityProtectedAddressSource.Host,
        protectedValue: "35.205.11.131",
      },
    });

    expect(wordSecurityBlockReason(reason, partial)).toBe(
      "Held back: 35.205.11.131 is protected now, so OneUptime took the block off. 35.205.11.131 is one of your project's own addresses.",
    );
  });
});

describe("a held-back block's reason, kept", () => {
  test("survives its JSON column, and is still read as held back", () => {
    for (const value of ["35.205.11.131", "35.205.11.0/24"]) {
      const reason: SecurityBlockReason = securityBlockHeldBackReason({
        value,
        protection: {
          source: SecurityProtectedAddressSource.Edge,
          protectedValue: "35.205.11.131",
          name: "Cloudflare",
        },
      });
      const read: SecurityBlockReason | null = readSecurityBlockReason(
        JSON.parse(JSON.stringify(toSecurityBlockReasonJson(reason))),
      );

      expect(read).toEqual(reason);
      expect(isSecurityBlockHeldBackReason(read)).toBe(true);
      expect(fillSecurityBlockReason(read!)).toBe(
        fillSecurityBlockReason(reason),
      );
    }
  });

  test("only a held-back reason is one: a destination's own reasons and nothing are not", () => {
    expect(isSecurityBlockHeldBackReason(null)).toBe(false);
    expect(isSecurityBlockHeldBackReason(undefined)).toBe(false);
    expect(
      isSecurityBlockHeldBackReason(
        frameSecurityBlockReason(
          SECURITY_BLOCK_REASON_FRAMES.notApplied,
          securityBlockReason("Azure WAF cannot challenge."),
        ),
      ),
    ).toBe(false);
    expect(
      isSecurityBlockHeldBackReason(
        securityBlockReason(SECURITY_BLOCK_REASON_FRAMES.heldBack, {
          value: "35.205.11.131",
        }),
      ),
    ).toBe(true);
  });

  test("both frames open the way a row held back before this does, so a pass that cannot read what is protected keeps them", () => {
    for (const frame of [
      SECURITY_BLOCK_REASON_FRAMES.heldBack,
      SECURITY_BLOCK_REASON_FRAMES.heldBackOverlapping,
    ]) {
      expect(frame.startsWith("Held back: {{value}} is protected now")).toBe(
        true,
      );
    }
  });
});

describe("in every language the Dashboard ships", () => {
  test("there is more than English to check", () => {
    expect(DASHBOARD_LANGUAGES.length).toBeGreaterThanOrEqual(17);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words both frames, keeping their placeholders",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const [frame, placeholders] of [
        [SECURITY_BLOCK_REASON_FRAMES.heldBack, ["value", "protection"]],
        [
          SECURITY_BLOCK_REASON_FRAMES.heldBackOverlapping,
          ["value", "overlap", "protection"],
        ],
      ] as Array<[string, Array<string>]>) {
        const wording: unknown = locale[frame];

        expect({
          language,
          frame,
          worded: typeof wording === "string",
        }).toEqual({ language, frame, worded: true });
        expect({ language, frame, english: wording === frame }).toEqual({
          language,
          frame,
          english: false,
        });

        for (const placeholder of placeholders) {
          expect({
            language,
            frame,
            placeholder,
            kept: String(wording).split(`{{${placeholder}}}`).length - 1,
          }).toEqual({ language, frame, placeholder, kept: 1 });
        }
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s reads a held-back row wholly in its own words, the addresses as they are",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const translator: Translator = translatorOf(locale, language);
      const reason: SecurityBlockReason = securityBlockHeldBackReason({
        value: "35.205.11.0/24",
        protection: {
          source: SecurityProtectedAddressSource.Host,
          protectedValue: "35.205.11.131",
        },
      });
      const worded: string = wordSecurityBlockReason(reason, translator);

      expect(worded).toContain("35.205.11.0/24");
      expect(worded).toContain("35.205.11.131");
      // Not one English sentence of the three.
      expect(worded).not.toContain("is protected now");
      expect(worded).not.toContain("holds 35.205.11.131");
      expect(worded).not.toContain("one of your project's own addresses");
    },
  );
});
