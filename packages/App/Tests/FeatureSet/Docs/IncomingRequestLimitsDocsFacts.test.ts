import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  BoundedIntegerSetting,
  INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR_SETTING,
  INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR_SETTING,
  INCOMING_REQUEST_MAX_REQUESTS_PER_JOB_SETTING,
} from "../../../FeatureSet/Telemetry/Config";
import {
  BYTES_PER_MEGABYTE,
  DEFAULT_MAX_PENDING_BYTES_PER_MONITOR,
  DEFAULT_MAX_PENDING_REQUESTS_PER_MONITOR,
} from "../../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore";
import { DEFAULT_MAX_REQUESTS_PER_JOB } from "../../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import {
  TRANSLATED_LANGUAGES,
  anchorsOf,
  readPage,
} from "./DocsContentSupport";
import { inlineCode } from "./DocsTranslationChecks";

/*
 * WHAT A SELF-HOSTED INSTALL CAN CHANGE ABOUT A GROUPED INCOMING REQUEST
 * MONITOR, SAID THE SAME WAY EVERYWHERE (#10652).
 *
 * How many requests a grouped Incoming Request monitor keeps waiting, how
 * many megabytes of them, and how many one job evaluates are settings of the
 * Telemetry worker (Telemetry/Config), with defaults and bounds. Five places
 * name them, and each must say what the code does:
 *
 *   - the Incoming Request monitor page's Self-hosted notes, in every docs
 *     language, with the note on the limits linking to it;
 *   - the Helm chart: its values (incomingRequests), its schema's bounds, and
 *     the env it hands the app and worker pods (_helpers.tpl);
 *   - Docker Compose: config.example.env and the app service's environment.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const CHART: string = path.join(REPOSITORY_ROOT, "HelmChart/Public/oneuptime");

const PAGE: string = "monitor/incoming-request-monitor";

interface Limit {
  setting: BoundedIntegerSetting;
  // Its key under incomingRequests in the chart's values.
  helmKey: string;
}

const LIMITS: ReadonlyArray<Limit> = [
  {
    setting: INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR_SETTING,
    helmKey: "maxPendingRequestsPerMonitor",
  },
  {
    setting: INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR_SETTING,
    helmKey: "maxPendingMegabytesPerMonitor",
  },
  {
    setting: INCOMING_REQUEST_MAX_REQUESTS_PER_JOB_SETTING,
    helmKey: "maxRequestsPerJob",
  },
];

/*
 * The chart's incomingRequests block as values.yaml writes it: one
 * "key: number" a line, under the top-level key, with comments between.
 */
function readIncomingRequestsValues(
  valuesYaml: string,
): Record<string, number> {
  const lines: Array<string> = valuesYaml.split("\n");
  const start: number = lines.indexOf("incomingRequests:");

  expect(start).toBeGreaterThanOrEqual(0);

  const values: Record<string, number> = {};

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }

    const setting: RegExpMatchArray | null = line.match(/^ {2}(\w+): (\S+)$/);

    // The block ends at the next top-level key.
    if (!setting) {
      break;
    }

    values[setting[1]!] = Number(setting[2]);
  }

  return values;
}

function readRepositoryFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

// The page's table row that names an environment variable, split into cells.
function rowOf(markdown: string, envKey: string): Array<string> {
  const row: string | undefined = markdown.split("\n").find((line: string) => {
    return line.startsWith(`| \`${envKey}\` |`);
  });

  expect({ envKey, row }).toEqual({ envKey, row: expect.any(String) });

  return row!
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

describe("the settings' defaults", () => {
  test("are the limits OneUptime has always kept", () => {
    expect(
      INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR_SETTING.defaultValue,
    ).toBe(1000);
    expect(
      INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR_SETTING.defaultValue,
    ).toBe(16);
    expect(INCOMING_REQUEST_MAX_REQUESTS_PER_JOB_SETTING.defaultValue).toBe(
      100,
    );
  });

  test("are what the store and the job use when nothing is set", () => {
    expect(DEFAULT_MAX_PENDING_REQUESTS_PER_MONITOR).toBe(1000);
    expect(DEFAULT_MAX_PENDING_BYTES_PER_MONITOR).toBe(16 * BYTES_PER_MEGABYTE);
    expect(DEFAULT_MAX_REQUESTS_PER_JOB).toBe(100);
  });

  test.each(
    LIMITS.map((limit: Limit): [string, Limit] => {
      return [limit.setting.envKey, limit];
    }),
  )("%s lies within its own bounds", (_envKey: string, limit: Limit) => {
    expect(limit.setting.min).toBeLessThanOrEqual(limit.setting.defaultValue);
    expect(limit.setting.defaultValue).toBeLessThanOrEqual(limit.setting.max);
    expect(Number.isSafeInteger(limit.setting.min)).toBe(true);
    expect(Number.isSafeInteger(limit.setting.max)).toBe(true);
  });
});

describe("the Incoming Request monitor page", () => {
  const english: string = readPage("en", PAGE);

  test.each(
    LIMITS.map((limit: Limit): [string, Limit] => {
      return [limit.setting.envKey, limit];
    }),
  )(
    "lists %s with its Helm key, its default and its bounds",
    (_envKey: string, limit: Limit) => {
      const [envKey, helmKey, defaultValue, range] = rowOf(
        english,
        limit.setting.envKey,
      );

      expect(envKey).toBe(`\`${limit.setting.envKey}\``);
      expect(helmKey).toBe(`\`incomingRequests.${limit.helmKey}\``);
      expect(defaultValue).toBe(`\`${limit.setting.defaultValue}\``);
      expect(range).toBe(
        `\`${limit.setting.min}\` to \`${limit.setting.max}\``,
      );
    },
  );

  test("says where to set them, and that a bad value is not used", () => {
    expect(english).toContain(
      "With Docker Compose, set them in `config.env`; with Helm, under `incomingRequests` in the chart's values, which gives the app and worker pods the same ones:",
    );
    expect(english).toContain(
      "When requests are skipped, the **Monitor Summary** card says which limit was reached.",
    );
    expect(english).toContain(
      "A value that is not a whole number in its range is not used: the default is, and the app logs a warning that names the setting.",
    );
  });

  test("the note on the limits names the limit reached and links to the settings", () => {
    expect(english).toContain(
      "the **Monitor Summary** card says how many. It names the limit that was reached, and a self-hosted installation can change both: see [Self-hosted notes](#self-hosted-notes).",
    );
    expect(anchorsOf("en", PAGE).has("self-hosted-notes")).toBe(true);
  });

  test.each(TRANSLATED_LANGUAGES)(
    "in %s, lists every setting as written, and its note links to its own heading",
    (language: string) => {
      const translated: string = readPage(language, PAGE);

      for (const limit of LIMITS) {
        const cells: Array<string> = rowOf(translated, limit.setting.envKey);

        expect(cells.slice(0, 3)).toEqual([
          `\`${limit.setting.envKey}\``,
          `\`incomingRequests.${limit.helmKey}\``,
          `\`${limit.setting.defaultValue}\``,
        ]);
        // The bounds as written, in the language's words for "from ... to".
        expect(inlineCode(cells[3]!)).toEqual(
          [String(limit.setting.min), String(limit.setting.max)].sort(),
        );
      }

      // The link the note adds lands on a heading of the reader's page.
      const anchors: Set<string> = anchorsOf(language, PAGE);
      const links: Array<string> = Array.from(
        translated.matchAll(/\]\(#([^)]+)\)/g),
      ).map((match: RegExpMatchArray): string => {
        return decodeURIComponent(match[1]!);
      });
      const toTheSettings: Array<string> = links.filter((anchor: string) => {
        return !anchors.has(anchor);
      });

      expect({ language, linksToNoHeading: toTheSettings }).toEqual({
        language,
        linksToNoHeading: [],
      });
      expect(translated).toContain("`config.env`");
      expect(translated).toContain("`incomingRequests`");
    },
  );
});

describe("the Helm chart", () => {
  const values: {
    incomingRequests?: Record<string, number> | undefined;
  } = {
    incomingRequests: readIncomingRequestsValues(
      fs.readFileSync(path.join(CHART, "values.yaml"), "utf8"),
    ),
  };
  const schema: {
    properties: Record<
      string,
      {
        properties?: Record<
          string,
          { type: string; minimum: number; maximum: number }
        >;
        additionalProperties?: boolean;
      }
    >;
  } = JSON.parse(
    fs.readFileSync(path.join(CHART, "values.schema.json"), "utf8"),
  );
  const helpers: string = fs.readFileSync(
    path.join(CHART, "templates/_helpers.tpl"),
    "utf8",
  );

  test("its values hold exactly the three settings", () => {
    expect(Object.keys(values.incomingRequests || {}).sort()).toEqual(
      LIMITS.map((limit: Limit): string => {
        return limit.helmKey;
      }).sort(),
    );
    expect(schema.properties["incomingRequests"]!.additionalProperties).toBe(
      false,
    );
  });

  test.each(
    LIMITS.map((limit: Limit): [string, Limit] => {
      return [limit.helmKey, limit];
    }),
  )(
    "incomingRequests.%s: the code's default, bounds and variable",
    (helmKey: string, limit: Limit) => {
      expect(values.incomingRequests![helmKey]).toBe(
        limit.setting.defaultValue,
      );

      const property: { type: string; minimum: number; maximum: number } =
        schema.properties["incomingRequests"]!.properties![helmKey]!;

      expect(property).toEqual(
        expect.objectContaining({
          type: "integer",
          minimum: limit.setting.min,
          maximum: limit.setting.max,
        }),
      );

      // The env it hands the pods, falling back to the same default.
      expect(helpers).toContain(`- name: ${limit.setting.envKey}\n`);
      expect(helpers).toContain(
        `{{ dig "${helmKey}" ${limit.setting.defaultValue} ($.Values.incomingRequests | default dict) | int64 | squote }}`,
      );
    },
  );

  test("the env is in the runtime block the app and worker pods include", () => {
    const runtime: string = helpers.slice(
      helpers.indexOf('{{- define "oneuptime.env.runtime" }}'),
    );

    for (const limit of LIMITS) {
      expect(runtime).toContain(`- name: ${limit.setting.envKey}\n`);
    }

    for (const template of ["app.yaml", "worker.yaml"]) {
      expect(
        fs.readFileSync(path.join(CHART, "templates", template), "utf8"),
      ).toContain('include "oneuptime.env.runtime"');
    }
  });
});

describe("Docker Compose", () => {
  const example: string = readRepositoryFile("config.example.env");
  const compose: string = readRepositoryFile("docker-compose.base.yml");

  test.each(
    LIMITS.map((limit: Limit): [string] => {
      return [limit.setting.envKey];
    }),
  )(
    "%s is in config.example.env, empty for the default, and reaches the app container",
    (envKey: string) => {
      expect(example).toMatch(new RegExp(`^${envKey}=$`, "m"));
      expect(compose).toContain(`${envKey}: \${${envKey}:-}`);
    },
  );

  test("config.example.env gives each default and range", () => {
    for (const limit of LIMITS) {
      expect(example).toContain(
        `${limit.setting.min} to ${limit.setting.max}, default ${limit.setting.defaultValue}`,
      );
    }
  });
});
