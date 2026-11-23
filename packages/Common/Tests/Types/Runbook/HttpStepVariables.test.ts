import { describe, expect, test } from "@jest/globals";
import {
  fillHttpStepConfig,
  fillHttpStepJsonText,
  getHttpStepVariableTexts,
  redactHttpStepSecrets,
} from "../../../Types/Runbook/HttpStepVariables";
import { HttpRequestStepConfig } from "../../../Types/Runbook/RunbookStep";
import {
  RunbookVariableReference,
  RunbookVariableScope,
  getRunbookVariableReferenceKey,
} from "../../../Types/Runbook/RunbookVariableReference";
import { REDACTED_SECRET_TEXT } from "../../../Types/Runbook/SecretOutputRedaction";

/*
 * AN HTTP REQUEST STEP FILLS IN THE RUNBOOK VARIABLES IT NAMES
 * (Types/Runbook/HttpStepVariables): in its URL as written, in its headers
 * and body within the JSON's own strings - so a value with a quote or a
 * line break stays one string - in its CA certificate when that is one
 * variable alone and the step checks certificates (#10441), and hidden in
 * what the step records.
 */

// A CA's certificate as a variable holds it: PEM, lines and all.
const CA_PEM: string = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBszCCAVmgAwIBAgIUQ2VydGlmaWNhdGUgc2hhcGUgb25seQ==",
  "-----END CERTIFICATE-----",
  "",
].join("\n");

const VALUES: Record<string, string> = {
  "global:API_BASE": "https://api.status.example.com/v2",
  "global:TOKEN": 'sk_live_8f2a"quote\\back',
  "global:SERVICE": "checkout",
  "local:REPLICAS": "3",
  "global:MULTILINE": "line one\nline two",
  "global:BRACES": "{{global.variables.TOKEN}}",
  "global:INTERNAL_CA": CA_PEM,
  "local:LAB_CA": `subject=CN=Lab CA\n${CA_PEM}`,
  "global:EMPTY": "",
};

const getValue: (reference: RunbookVariableReference) => string | undefined = (
  reference: RunbookVariableReference,
): string | undefined => {
  return VALUES[getRunbookVariableReferenceKey(reference)];
};

const http: (
  fields: Partial<HttpRequestStepConfig>,
) => HttpRequestStepConfig = (
  fields: Partial<HttpRequestStepConfig>,
): HttpRequestStepConfig => {
  return {
    url: "https://api.example.com",
    method: "POST",
    ...fields,
  };
};

describe("the fields that may name variables", () => {
  test("are the URL, the headers, the body and the CA certificate, as stored", () => {
    expect(
      getHttpStepVariableTexts(
        http({
          url: "u",
          headersJson: "h",
          body: "b",
          caCertificate: "{{global.variables.INTERNAL_CA}}",
        }),
      ),
    ).toEqual(["u", "h", "b", "{{global.variables.INTERNAL_CA}}"]);
  });

  test("an empty field is an empty text", () => {
    expect(getHttpStepVariableTexts({ url: "" })).toEqual(["", "", "", ""]);
  });

  test("a CA certificate is a field that names a variable only when it is one variable alone", () => {
    const texts: (caCertificate: unknown) => Array<string> = (
      caCertificate: unknown,
    ): Array<string> => {
      return getHttpStepVariableTexts(
        http({ caCertificate: caCertificate as string }),
      );
    };

    // White space around the one variable is taken, as written.
    expect(texts("\n  {{local.variables.LAB_CA}} \n")[3]).toBe(
      "\n  {{local.variables.LAB_CA}} \n",
    );
    // A certificate pasted in names nothing.
    expect(texts(CA_PEM)[3]).toBe("");
    // A variable beside other text, or beside another, is refused, not read.
    expect(texts(`${CA_PEM}{{global.variables.INTERNAL_CA}}`)[3]).toBe("");
    expect(
      texts("{{global.variables.INTERNAL_CA}}{{global.variables.OTHER}}")[3],
    ).toBe("");
    // Text in braces that names no variable, and what is not text at all.
    expect(texts("{{ .Values.ca }}")[3]).toBe("");
    expect(texts(42)[3]).toBe("");
  });

  test("with Allow self-signed certificates on, the CA certificate is not used, so its variable is not read", () => {
    expect(
      getHttpStepVariableTexts(
        http({
          allowSelfSignedCertificates: true,
          caCertificate: "{{global.variables.GONE}}",
        }),
      ),
    ).toEqual(["https://api.example.com", "", "", ""]);

    // Only exactly true turns the checks off, as the step reads it.
    expect(
      getHttpStepVariableTexts(
        http({
          allowSelfSignedCertificates: "true" as unknown as boolean,
          caCertificate: "{{global.variables.INTERNAL_CA}}",
        }),
      )[3],
    ).toBe("{{global.variables.INTERNAL_CA}}");
  });
});

describe("the URL", () => {
  test("is filled in as written: a variable may be a whole base URL", () => {
    const filled: HttpRequestStepConfig = fillHttpStepConfig(
      http({
        url: "{{global.variables.API_BASE}}/services/{{global.variables.SERVICE}}/restart",
      }),
      getValue,
    );

    expect(filled.url).toBe(
      "https://api.status.example.com/v2/services/checkout/restart",
    );
  });

  test("a runbook's own variable is read as its own", () => {
    expect(
      fillHttpStepConfig(
        http({
          url: "https://k8s.example.com/scale?replicas={{local.variables.REPLICAS}}",
        }),
        getValue,
      ).url,
    ).toBe("https://k8s.example.com/scale?replicas=3");
  });

  test("a reference it has no value for stays as written", () => {
    expect(
      fillHttpStepConfig(
        http({ url: "https://x.example.com/{{global.variables.NOPE}}" }),
        getValue,
      ).url,
    ).toBe("https://x.example.com/{{global.variables.NOPE}}");
  });

  test("anything between braces that is not a variable reference stays", () => {
    expect(
      fillHttpStepConfig(
        http({ url: "https://x.example.com/?q={{ .Values.host }}" }),
        getValue,
      ).url,
    ).toBe("https://x.example.com/?q={{ .Values.host }}");
  });
});

describe("the headers and the body, when they are JSON", () => {
  test("a value with a quote and a backslash stays one string", () => {
    const headersJson: string = fillHttpStepJsonText(
      JSON.stringify({
        Authorization: "Bearer {{global.variables.TOKEN}}",
        "Content-Type": "application/json",
      }),
      getValue,
    );

    expect(JSON.parse(headersJson)).toEqual({
      Authorization: `Bearer ${VALUES["global:TOKEN"]}`,
      "Content-Type": "application/json",
    });
  });

  test("a value of several lines stays one string", () => {
    const body: string = fillHttpStepJsonText(
      '{ "note": "{{global.variables.MULTILINE}}" }',
      getValue,
    );

    expect(JSON.parse(body)).toEqual({ note: "line one\nline two" });
  });

  test("names are filled in too", () => {
    const headersJson: string = fillHttpStepJsonText(
      '{ "X-{{global.variables.SERVICE}}-Key": "1" }',
      getValue,
    );

    expect(JSON.parse(headersJson)).toEqual({ "X-checkout-Key": "1" });
  });

  test("every string in nested objects and arrays is filled in; numbers, booleans and null stay", () => {
    const body: string = fillHttpStepJsonText(
      JSON.stringify({
        service: "{{global.variables.SERVICE}}",
        tags: ["prod", "{{global.variables.SERVICE}}"],
        retries: 3,
        dryRun: false,
        owner: null,
        nested: { target: { name: "{{local.variables.REPLICAS}}" } },
      }),
      getValue,
    );

    expect(JSON.parse(body)).toEqual({
      service: "checkout",
      tags: ["prod", "checkout"],
      retries: 3,
      dryRun: false,
      owner: null,
      nested: { target: { name: "3" } },
    });
  });

  test("a value that itself holds a reference is placed as it is, never read again", () => {
    const body: string = fillHttpStepJsonText(
      '{ "text": "{{global.variables.BRACES}}" }',
      getValue,
    );

    expect(JSON.parse(body)).toEqual({ text: "{{global.variables.TOKEN}}" });
  });

  test("text with no reference is left exactly as written", () => {
    const written: string = '{\n  "a": 1\n}';

    expect(fillHttpStepJsonText(written, getValue)).toBe(written);
  });
});

describe("the headers and the body, when they are not JSON as written", () => {
  test("a reference where a number goes is filled in as text, and then reads as JSON", () => {
    const body: string = fillHttpStepJsonText(
      '{ "replicas": {{local.variables.REPLICAS}} }',
      getValue,
    );

    expect(JSON.parse(body)).toEqual({ replicas: 3 });
  });

  test("a plain-text body is filled in as written", () => {
    expect(
      fillHttpStepJsonText(
        "restart {{global.variables.SERVICE}} now",
        getValue,
      ),
    ).toBe("restart checkout now");
  });

  test("a JSON string as a whole is filled in as written", () => {
    expect(
      fillHttpStepJsonText('"{{global.variables.SERVICE}}"', getValue),
    ).toBe('"checkout"');
  });
});

describe("the CA certificate", () => {
  test("one variable alone is filled in with its value, as it is: plain text, nothing escaped", () => {
    expect(
      fillHttpStepConfig(
        http({ caCertificate: "{{global.variables.INTERNAL_CA}}" }),
        getValue,
      ).caCertificate,
    ).toBe(CA_PEM);
    expect(
      fillHttpStepConfig(
        http({ caCertificate: "  {{local.variables.LAB_CA}}\n" }),
        getValue,
      ).caCertificate,
    ).toBe(VALUES["local:LAB_CA"]);
  });

  test("a variable with an empty value is filled in empty: the run refuses that as no certificate", () => {
    expect(
      fillHttpStepConfig(
        http({ caCertificate: "{{global.variables.EMPTY}}" }),
        getValue,
      ).caCertificate,
    ).toBe("");
  });

  test("a variable it has no value for stays as written", () => {
    expect(
      fillHttpStepConfig(
        http({ caCertificate: "{{global.variables.NOPE}}" }),
        getValue,
      ).caCertificate,
    ).toBe("{{global.variables.NOPE}}");
  });

  test("a value that itself names a variable is placed as it is, never read again", () => {
    expect(
      fillHttpStepConfig(
        http({ caCertificate: "{{global.variables.BRACES}}" }),
        getValue,
      ).caCertificate,
    ).toBe("{{global.variables.TOKEN}}");
  });

  test("a certificate pasted in, and a variable beside other text, are left as written", () => {
    const mixed: string = `${CA_PEM}{{global.variables.INTERNAL_CA}}`;

    expect(
      fillHttpStepConfig(http({ caCertificate: CA_PEM }), getValue)
        .caCertificate,
    ).toBe(CA_PEM);
    expect(
      fillHttpStepConfig(http({ caCertificate: mixed }), getValue)
        .caCertificate,
    ).toBe(mixed);
  });

  test("with Allow self-signed certificates on, it is not filled in: it is not used", () => {
    let asked: number = 0;

    const filled: HttpRequestStepConfig = fillHttpStepConfig(
      http({
        allowSelfSignedCertificates: true,
        caCertificate: "{{global.variables.INTERNAL_CA}}",
      }),
      (reference: RunbookVariableReference): string | undefined => {
        asked++;
        return getValue(reference);
      },
    );

    expect(filled.caCertificate).toBe("{{global.variables.INTERNAL_CA}}");
    // The URL is the only field read, and it names nothing.
    expect(asked).toBe(0);
  });

  test("a step with no CA certificate gets none", () => {
    expect(fillHttpStepConfig(http({}), getValue)).not.toHaveProperty(
      "caCertificate",
    );
  });
});

describe("the whole step", () => {
  test("keeps its method, timeout and everything it does not fill in", () => {
    const filled: HttpRequestStepConfig = fillHttpStepConfig(
      {
        url: "{{global.variables.API_BASE}}/x",
        method: "PATCH",
        timeoutInMs: 30000,
        headersJson: '{ "A": "{{global.variables.SERVICE}}" }',
        body: '{ "b": "{{global.variables.SERVICE}}" }',
      },
      getValue,
    );

    expect(filled.method).toBe("PATCH");
    expect(filled.timeoutInMs).toBe(30000);
    expect(JSON.parse(filled.headersJson!)).toEqual({ A: "checkout" });
    expect(JSON.parse(filled.body!)).toEqual({ b: "checkout" });
  });

  test("a step with no headers or body gets none", () => {
    const filled: HttpRequestStepConfig = fillHttpStepConfig(
      { url: "https://x.example.com", method: "GET" },
      getValue,
    );

    expect(filled).toEqual({ url: "https://x.example.com", method: "GET" });
  });

  test("the step as stored is never changed", () => {
    const stored: HttpRequestStepConfig = http({
      url: "{{global.variables.API_BASE}}",
      body: '{"a":"{{global.variables.SERVICE}}"}',
      caCertificate: "{{global.variables.INTERNAL_CA}}",
    });
    const copy: HttpRequestStepConfig = JSON.parse(JSON.stringify(stored));

    fillHttpStepConfig(stored, getValue);

    expect(stored).toEqual(copy);
  });
});

describe("what the step records", () => {
  const TOKEN: string = "sk_live_51Hc9nM2eZvKYlo2C";

  test("hides a secret it was given, wherever it comes back", () => {
    expect(
      redactHttpStepSecrets(
        `Status: 200 OK\nBody: {"echo": "Bearer ${TOKEN}"}`,
        [TOKEN],
      ),
    ).toBe(`Status: 200 OK\nBody: {"echo": "Bearer ${REDACTED_SECRET_TEXT}"}`);
  });

  test("hides it as a URL carries it, percent-encoded", () => {
    const secret: string = "p@ss/word+1=";

    expect(
      redactHttpStepSecrets(
        `Error: request to https://x.example.com/?k=${encodeURIComponent(secret)} failed`,
        [secret],
      ),
    ).toBe(
      `Error: request to https://x.example.com/?k=${REDACTED_SECRET_TEXT} failed`,
    );
  });

  test("hides the lines of a secret of several lines, as a script's output does", () => {
    const key: string = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");

    expect(
      redactHttpStepSecrets(
        "echo: b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW",
        [key],
      ),
    ).toBe(`echo: ${REDACTED_SECRET_TEXT}`);
  });

  test("with no secret, the text is as it was", () => {
    expect(redactHttpStepSecrets("anything at all", [])).toBe(
      "anything at all",
    );
  });

  test("a plain value is never hidden: only what is handed as a secret", () => {
    expect(redactHttpStepSecrets("checkout", [TOKEN])).toBe("checkout");
  });

  test("hides a CA certificate kept as a secret, line by line, wherever it comes back", () => {
    const body: string = [
      "-----BEGIN CERTIFICATE-----",
      "MIIBszCCAVmgAwIBAgIUQ2VydGlmaWNhdGUgc2hhcGUgb25seQ==",
      "MIIBtDCCAVqgAwIBAgIUQW5vdGhlciBjZXJ0aWZpY2F0ZQ==",
      "-----END CERTIFICATE-----",
    ].join("\n");

    // An echo of it as JSON writes its lines apart, between "\n"s.
    const echoed: string = redactHttpStepSecrets(
      `Body: ${JSON.stringify({ ca: body })}`,
      [body],
    );

    expect(echoed).not.toContain(
      "MIIBszCCAVmgAwIBAgIUQ2VydGlmaWNhdGUgc2hhcGUgb25seQ==",
    );
    expect(echoed).not.toContain(
      "MIIBtDCCAVqgAwIBAgIUQW5vdGhlciBjZXJ0aWZpY2F0ZQ==",
    );
    expect(echoed).toContain(REDACTED_SECRET_TEXT);
  });
});

describe("references read", () => {
  test("global, local and the old runbook secret spelling", () => {
    const filled: HttpRequestStepConfig = fillHttpStepConfig(
      http({
        url: "https://x.example.com/{{runbookSecrets.SERVICE}}",
      }),
      (reference: RunbookVariableReference): string | undefined => {
        return reference.scope === RunbookVariableScope.Global &&
          reference.name === "SERVICE"
          ? "checkout"
          : undefined;
      },
    );

    expect(filled.url).toBe("https://x.example.com/checkout");
  });

  test("a CA certificate names a global, a local or an old secret's variable alike", () => {
    const asked: Array<RunbookVariableReference> = [];

    for (const caCertificate of [
      "{{global.variables.INTERNAL_CA}}",
      "{{local.variables.LAB_CA}}",
      "{{runbookSecrets.INTERNAL_CA}}",
      "{{ global.variables.INTERNAL_CA }}",
    ]) {
      fillHttpStepConfig(
        http({ caCertificate }),
        (reference: RunbookVariableReference): string | undefined => {
          asked.push(reference);
          return getValue(reference);
        },
      );
    }

    expect(asked).toEqual([
      { scope: RunbookVariableScope.Global, name: "INTERNAL_CA" },
      { scope: RunbookVariableScope.Local, name: "LAB_CA" },
      { scope: RunbookVariableScope.Global, name: "INTERNAL_CA" },
      { scope: RunbookVariableScope.Global, name: "INTERNAL_CA" },
    ]);
  });
});
