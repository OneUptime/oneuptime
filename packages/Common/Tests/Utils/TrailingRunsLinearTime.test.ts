import { buildPrometheusApiUrl } from "../../Server/Utils/DataSource/Connectors/PrometheusConnector";
import LlmProviderEndpoint from "../../Utils/LLM/LlmProviderEndpoint";
import MonitoringIntervalUtil from "../../Utils/Monitor/MonitoringIntervalUtil";
import ProbeNetworkFailureUtil, {
  ProbeNetworkOperation,
} from "../../Utils/ProbeNetworkFailureUtil";
import { isWhiteSpaceCode } from "../../Utils/RegExpCharacterClasses";
import { normalizeHost } from "../../Utils/Telemetry/NetworkHost";
import {
  codesOf,
  withoutTrailingDots,
  withoutTrailingRun,
  withoutTrailingSlashes,
} from "../../Utils/TrailingRuns";
import VMwareVCenterAddress from "../../Utils/VMware/VMwareVCenterAddress";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE RUN THAT ENDS A TEXT COMES OFF IN TIME IN LINE WITH THE TEXT'S LENGTH,
 * EXACTLY AS THE PATTERN TOOK IT OFF.
 *
 * A data source's or security connector's URL, an LLM provider's base URL,
 * a vCenter's address and a status page's URL are whatever a project saved;
 * a host name is whatever an application reported; a monitoring interval
 * and a probe's failure line are read on servers and probes every project
 * shares. A pattern for the slashes or dots that end such a text was tried
 * from every character of every run of them, each try reading on to the end
 * of its run: a long run inside the text took time that grows with the
 * square of its length. withoutTrailingRun reads the text back from its end
 * once.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  const startedAt: number = Date.now();
  run();
  return Date.now() - startedAt;
};

describe("a run that does not end the text is read quickly", () => {
  test.each([
    [
      "a run of slashes before the end",
      (): unknown => {
        return withoutTrailingSlashes(repeat("/", LENGTH) + "\u0000/");
      },
    ],
    [
      "a run of dots before the end",
      (): unknown => {
        return withoutTrailingDots(repeat(".", LENGTH) + "\u0000.");
      },
    ],
    [
      "a run of white space before the end",
      (): unknown => {
        return withoutTrailingRun(
          repeat("\t", LENGTH) + "\u0000\t",
          isWhiteSpaceCode,
        );
      },
    ],
    [
      "a Prometheus data source's URL",
      (): unknown => {
        return buildPrometheusApiUrl(
          "https://prometheus.example.com" + repeat("/", LENGTH) + "x/",
          "/api/v1/query",
          {},
        );
      },
    ],
    [
      "an LLM provider's base URL",
      (): unknown => {
        return LlmProviderEndpoint.resolveAzureOpenAI(
          "https://contoso.openai.azure.com" + repeat("/", LENGTH) + "x/",
        );
      },
    ],
    [
      "an LLM provider's base URL with no scheme",
      (): unknown => {
        return LlmProviderEndpoint.splitBaseUrl(repeat("/", LENGTH) + "x/");
      },
    ],
    [
      "a vCenter's address",
      (): unknown => {
        return VMwareVCenterAddress.normalize(
          "https://vcenter.example.com" + repeat("/", LENGTH) + "x/",
        );
      },
    ],
    [
      "a host name an application reported",
      (): unknown => {
        return normalizeHost("db" + repeat(".", LENGTH) + "x.");
      },
    ],
    [
      "a monitoring interval",
      (): unknown => {
        return MonitoringIntervalUtil.normalize(
          "every 5 minutes" + repeat(".", LENGTH) + "x.",
        );
      },
    ],
    [
      "a probe's failure detail",
      (): unknown => {
        return ProbeNetworkFailureUtil.classifyErrorCode({
          code: "ENETUNREACH",
          detail: "connect ENETUNREACH db" + repeat(".", LENGTH) + "x.",
          operation: ProbeNetworkOperation.PingOrTraceroute,
        });
      },
    ],
  ])("%s", (_label: string, run: () => unknown) => {
    expect(timeOf(run)).toBeLessThan(2000);
  });
});

describe("what comes off is what the pattern took off", () => {
  test("the slashes or dots that end a text, on forty thousand drawn texts", () => {
    const differences: Array<string> = [];

    for (const text of generatedTexts(
      40000,
      8191,
      ["/", "//", ".", "..", "a", " ", "\n", "x/", "/x", "\u0000"],
      12,
    )) {
      if (
        withoutTrailingSlashes(text) !== text.replace(/\/+$/, "") ||
        withoutTrailingDots(text) !== text.replace(/\.+$/, "")
      ) {
        differences.push(JSON.stringify(text));
      }
    }

    expect(differences).toEqual([]);
  });

  test.each([
    ["white space", (code: number): boolean => isWhiteSpaceCode(code), /\s+$/],
    [
      "full stops and white space",
      (code: number): boolean => {
        return code === 0x2e || isWhiteSpaceCode(code);
      },
      /[.\s]+$/,
    ],
    [
      "the punctuation a title may not end with",
      (code: number): boolean => {
        return codesOf(".,;:!?…").has(code) || isWhiteSpaceCode(code);
      },
      /[.,;:!?…\s]+$/,
    ],
    [
      "the quotes a title may not end with",
      (code: number): boolean => {
        return codesOf("\"'`“”‘’").has(code) || isWhiteSpaceCode(code);
      },
      /["'`“”‘’\s]+$/,
    ],
    [
      "what a clipped summary may not end with",
      (code: number): boolean => {
        return codesOf(".,;:!?—–-").has(code) || isWhiteSpaceCode(code);
      },
      /[\s.,;:!?—–-]+$/,
    ],
  ])(
    "a run of %s, on forty thousand drawn texts",
    (_label: string, isRunCode: (code: number) => boolean, before: RegExp) => {
      const differences: Array<string> = [];

      for (const text of generatedTexts(
        40000,
        6007,
        [
          " ",
          "\t",
          "\n",
          "\u2028",
          "\u00a0",
          ".",
          ",",
          ";",
          ":",
          "!",
          "?",
          "…",
          "—",
          "–",
          "-",
          '"',
          "'",
          "`",
          "“",
          "”",
          "‘",
          "’",
          "x",
          "😀",
        ],
        12,
      )) {
        if (withoutTrailingRun(text, isRunCode) !== text.replace(before, "")) {
          differences.push(JSON.stringify(text));
        }
      }

      expect(differences).toEqual([]);
    },
  );

  test("the URLs, hosts and intervals they are written for", () => {
    expect(withoutTrailingSlashes("https://example.com//")).toBe(
      "https://example.com",
    );
    expect(withoutTrailingSlashes("///")).toBe("");
    expect(withoutTrailingDots("example.com.")).toBe("example.com");
    expect(withoutTrailingRun("", isWhiteSpaceCode)).toBe("");
    expect(
      buildPrometheusApiUrl("https://prometheus.example.com//", "/api/v1/query", {
        query: "up",
      }),
    ).toBe("https://prometheus.example.com/api/v1/query?query=up");
    expect(normalizeHost("db.example.com.")).toBe("db.example.com");
    expect(
      LlmProviderEndpoint.splitBaseUrl("https://contoso.openai.azure.com/openai/"),
    ).toEqual(
      expect.objectContaining({
        origin: "https://contoso.openai.azure.com",
        path: "/openai",
      }),
    );
  });
});
