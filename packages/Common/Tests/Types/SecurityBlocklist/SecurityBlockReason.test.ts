import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_WAF_REASONS,
  cloudWafReason,
} from "../../../Types/SecurityBlocklist/CloudWafReasons";
import {
  SECURITY_BLOCK_REASON_FRAMES,
  SECURITY_BLOCK_REASON_VALUE_MAX_LENGTH,
  SecurityBlockReason,
  fillSecurityBlockReason,
  frameSecurityBlockFailure,
  frameSecurityBlockReason,
  readSecurityBlockReason,
  toSecurityBlockReasonJson,
  wordSecurityBlockReason,
} from "../../../Types/SecurityBlocklist/SecurityBlockReason";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * WHY A BLOCK OR A CLOUD WAF IS NOT ENFORCED, IN THE READER'S LANGUAGE
 * (#10629): a reason is an English sentence that is a locale key, with its
 * values, figures and the sentences inside it, kept as JSON and worded
 * where it is drawn - wholly in the reader's language, or wholly in
 * English for the text columns, the logs and the API.
 */

function translatorOf(
  wordings: Record<string, string>,
  language: string,
): Translator {
  return createTranslator((text: string): string | undefined => {
    return wordings[text];
  }, language);
}

describe("a reason", () => {
  test("is worded in English for the text columns, its figures in English digits", () => {
    expect(
      fillSecurityBlockReason(
        cloudWafReason(
          CLOUD_WAF_REASONS.full,
          { policy: "prod-waf" },
          { addresses: 6000 },
        ),
      ),
    ).toBe(
      "prod-waf is full: OneUptime's rules there hold 6,000 addresses, the most it keeps in one policy.",
    );
  });

  test("is worded wholly in the reader's language: its frame and the sentence in it alike, names as they are", () => {
    const framed: SecurityBlockReason = frameSecurityBlockReason(
      SECURITY_BLOCK_REASON_FRAMES.notApplied,
      cloudWafReason(CLOUD_WAF_REASONS.ipv4Only, { value: "2001:db8::7" }),
    )!;
    const german: Translator = translatorOf(
      {
        [SECURITY_BLOCK_REASON_FRAMES.notApplied]:
          "Nicht angewendet: {{reason}}",
        [CLOUD_WAF_REASONS.ipv4Only]:
          "Application Gateway gleicht nur IPv4-Adressen ab und kann {{value}} daher nicht blockieren.",
      },
      "de",
    );

    expect(wordSecurityBlockReason(framed, german)).toBe(
      "Nicht angewendet: Application Gateway gleicht nur IPv4-Adressen ab und kann 2001:db8::7 daher nicht blockieren.",
    );
    expect(fillSecurityBlockReason(framed)).toBe(
      "Not applied: Application Gateway matches IPv4 addresses only, so it cannot block 2001:db8::7.",
    );
  });

  test("a frame is said only around a sentence: without one, the row's English text is all", () => {
    expect(
      frameSecurityBlockReason(SECURITY_BLOCK_REASON_FRAMES.notApplied, null),
    ).toBeNull();
    expect(
      frameSecurityBlockFailure({
        frame: SECURITY_BLOCK_REASON_FRAMES.couldNotWrite,
        destination: "Azure WAF (prod-waf)",
        error: new Error("socket hang up"),
      }),
    ).toBeNull();

    const carried: Error & { reason?: SecurityBlockReason } = new Error("busy");
    carried.reason = cloudWafReason(CLOUD_WAF_REASONS.busy, {
      policy: "prod-waf",
    });

    expect(
      fillSecurityBlockReason(
        frameSecurityBlockFailure({
          frame: SECURITY_BLOCK_REASON_FRAMES.couldNotWrite,
          destination: "Azure WAF (prod-waf)",
          error: carried,
        })!,
      ),
    ).toBe(
      "Could not write to Azure WAF (prod-waf): Azure is still applying an earlier change to prod-waf. OneUptime writes it again shortly.",
    );
  });

  test("survives its JSON column, and anything else read from one is not a reason", () => {
    const reason: SecurityBlockReason = frameSecurityBlockReason(
      SECURITY_BLOCK_REASON_FRAMES.notApplied,
      cloudWafReason(
        CLOUD_WAF_REASONS.groupFull,
        { group: "oneuptime-1a2b3c4d-block-ipv6" },
        {
          capacity: 2000,
        },
      ),
    )!;

    expect(
      readSecurityBlockReason(
        JSON.parse(JSON.stringify(toSecurityBlockReasonJson(reason))),
      ),
    ).toEqual(reason);

    for (const value of [
      null,
      "Not applied",
      [],
      { values: {} },
      { template: "  " },
    ]) {
      expect(readSecurityBlockReason(value)).toBeNull();
    }

    // A value is kept to its length; one that is not text is dropped.
    const read: SecurityBlockReason = readSecurityBlockReason({
      template: CLOUD_WAF_REASONS.refused,
      values: {
        cloud: "Azure",
        policy: "prod-waf",
        error: "x".repeat(5000),
        extra: 7,
      },
    })!;

    expect(read.values!["error"]).toHaveLength(
      SECURITY_BLOCK_REASON_VALUE_MAX_LENGTH,
    );
    expect(read.values!["extra"]).toBeUndefined();
  });

  test("parts nest only so deep", () => {
    let nested: Record<string, unknown> = {
      template: "{{a}}",
      values: { a: "x" },
    };

    for (let level: number = 0; level < 6; level++) {
      nested = { template: "{{reason}}", parts: { reason: nested } };
    }

    const read: SecurityBlockReason | null = readSecurityBlockReason(nested);

    expect(read).not.toBeNull();
    expect(JSON.stringify(read).split("parts").length - 1).toBeLessThan(6);
  });
});

describe("every cloud WAF sentence", () => {
  test("is a sentence with its placeholders, ending as a sentence ends", () => {
    for (const [name, template] of Object.entries(CLOUD_WAF_REASONS)) {
      expect({
        name,
        ends:
          template.trim().endsWith(".") ||
          template.trim().endsWith(":") ||
          template.endsWith("{{error}}"),
      }).toEqual({
        name,
        ends: true,
      });
    }

    expect(Object.keys(CLOUD_WAF_REASONS).length).toBeGreaterThan(25);
  });
});
