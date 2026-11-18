import { getProductTitle } from "Common/Types/Product/ProductCatalog";
import ProductKey from "Common/Types/Product/ProductKey";
import RunbookTriggerType, {
  RUNBOOK_TRIGGER_TYPES,
  RUNBOOK_TRIGGERS_WHILE_SWITCHED_OFF,
} from "Common/Types/Runbook/RunbookTriggerType";
import {
  PRODUCTS_OF_PRESET,
  SERVER_PRODUCTS_ENV_VAR,
  SERVER_PRODUCTS_PRESETS,
  ServerProductsPreset,
  TELEMETRY_INGESTION_PRODUCTS,
} from "Common/Types/Product/ServerProducts";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * RUN ONLY WHAT YOU NEED, AS THE DOCS SAY IT (#6815): the install docs'
 * section on switching products off for the whole server and the
 * "Monitoring and status pages" profile, in every docs language, held to
 * the code: the presets and what each keeps on, the setting's name and its
 * values, the settings of the profile, the services that still run, and
 * where config.env, Docker Compose and the Helm chart set it - and what
 * the profile needs, as it was measured (#7477), in every language. No
 * memory or CPU figure is given that was not measured.
 */

const REPOSITORY: string = path.join(__dirname, "..", "..", "..", "..", "..");
const DOCS: string = path.join(
  REPOSITORY,
  "packages",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(DOCS)
  .filter((entry: string): boolean => {
    return fs.statSync(path.join(DOCS, entry)).isDirectory();
  })
  .sort();

const read: (relative: string) => string = (relative: string): string => {
  return fs.readFileSync(path.join(REPOSITORY, relative), "utf8");
};

const page: (language: string, name: string) => string = (
  language: string,
  name: string,
): string => {
  return fs.readFileSync(path.join(DOCS, language, `${name}.md`), "utf8");
};

const ENGLISH_COMPOSE: string = page("en", "installation/docker-compose");

/*
 * What the profile needs, as it was measured for #7477: release 15.0.0 under
 * Docker Compose, each service held to the same 4 CPU cores, from empty
 * volumes; memory as docker stats reports it, in MiB, the mean of five
 * readings 30 seconds apart - at rest (10 minutes after OneUptime was up,
 * no monitors) and 30 minutes after 100 Website monitors that check every
 * minute and a public status page were added. The readings and the scripts
 * that took them are on #7477. Pinned, so a figure changes only by
 * measuring again.
 */
interface MeasuredRow {
  service: string;
  rest: number;
  monitors: number;
}

const MEASURED: Array<MeasuredRow> = [
  { service: "ingress", rest: 304, monitors: 302 },
  { service: "app", rest: 782, monitors: 849 },
  { service: "probe-1", rest: 286, monitors: 231 },
  { service: "postgres", rest: 228, monitors: 269 },
  { service: "clickhouse", rest: 661, monitors: 818 },
  { service: "valkey", rest: 13, monitors: 17 },
];

const MEASURED_REST_TOTAL: number = 2274;
const MEASURED_MONITORS_TOTAL: number = 2486;
// The most the services used together while OneUptime started.
const MEASURED_STARTUP_PEAK: number = 3584;

const SERVICES_THAT_RUN: ReadonlyArray<string> = [
  "ingress",
  "app",
  "probe-1",
  "postgres",
  "clickhouse",
  "valkey",
];

// A figure as the English page writes it: 2,274.
const english: (value: number) => string = (value: number): string => {
  return value.toLocaleString("en-US");
};

const PERSIAN_DIGITS: string = "۰۱۲۳۴۵۶۷۸۹";

/*
 * Every number a page states, in Latin digits and without the thousands
 * separators its language writes (2,274 / 2.274 / 2 274 / ۲٬۲۷۴).
 */
const statedNumbers: (markdown: string) => Set<string> = (
  markdown: string,
): Set<string> => {
  const latin: string = markdown.replace(/[۰-۹]/g, (digit: string): string => {
    return String(PERSIAN_DIGITS.indexOf(digit));
  });
  const joined: string = latin.replace(
    /(\d)[,.\u066c\u00a0\u202f ](?=\d{3}\b)/g,
    "$1",
  );

  return new Set(joined.match(/\d+/g) || []);
};

// The English section, from its heading to the next one at its level.
const section: (markdown: string, heading: string) => string = (
  markdown: string,
  heading: string,
): string => {
  const start: number = markdown.indexOf(`\n${heading}\n`);
  expect(start).toBeGreaterThan(-1);
  const rest: string = markdown.slice(start + heading.length + 2);
  const next: number = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
};

const ENGLISH_SECTION: string = section(
  ENGLISH_COMPOSE,
  "## Run only what you need",
);

// A page's section where the English page has "Run only what you need".
const productsSection: (markdown: string) => string = (
  markdown: string,
): string => {
  const headings: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    return text.split("\n").filter((line: string): boolean => {
      return line.startsWith("## ");
    });
  };
  const at: number = headings(ENGLISH_COMPOSE).indexOf(
    "## Run only what you need",
  );

  return section(markdown, headings(markdown)[at]!);
};

const bulletsOf: (markdown: string) => Array<string> = (
  markdown: string,
): Array<string> => {
  return markdown.split("\n").filter((line: string): boolean => {
    return line.startsWith("- ");
  });
};

// Each way a runbook run starts, as the English page names it.
const RUNBOOK_TRIGGER_WORDS: Record<RunbookTriggerType, string> = {
  [RunbookTriggerType.Manual]: "a person",
  [RunbookTriggerType.Rule]: "rules",
  [RunbookTriggerType.AutoRemediation]: "auto-remediation",
  [RunbookTriggerType.AI]: "OneUptime AI",
  [RunbookTriggerType.Schedule]: "schedule",
  [RunbookTriggerType.Webhook]: "webhook",
  [RunbookTriggerType.SecurityPlaybook]: "a security playbook",
};

// "a, b and c" / "a, b or c".
const listed: (words: Array<string>, last: string) => string = (
  words: Array<string>,
  last: string,
): string => {
  return words.join(", ").replace(/, ([^,]*)$/, ` ${last} $1`);
};

const PROFILE_BLOCK: string = [
  "```bash",
  "SERVER_PRODUCTS=monitoring-and-status-pages",
  "DISABLE_TELEMETRY_INGESTION=true",
  "GLOBAL_RUNNER_REPLICAS=0",
  "MQTT_INGEST_ENABLED=false",
  "```",
].join("\n");

const LITERALS: Array<string> = [
  "`SERVER_PRODUCTS`",
  "`config.env`",
  "`products.onThisServer`",
  "`everything`",
  "`monitoring-and-status-pages`",
  "`incident-response`",
  "`monitors,incidents,on-call,status-pages`",
  "`SERVER_PRODUCTS=monitoring-and-status-pages`",
  "`DISABLE_TELEMETRY_INGESTION=true`",
  "`GLOBAL_RUNNER_REPLICAS=0`",
  "`MQTT_INGEST_ENABLED=false`",
  "`global-runner`",
  "`ingress`",
  "`app`",
  "`probe-1`",
  "`postgres`",
  "`clickhouse`",
  "`valkey`",
  "`products.onThisServer: monitoring-and-status-pages`",
  "`telemetry.disableIngestion: true`",
  "`globalRunner.enabled: false`",
];

describe("the English section", () => {
  test("names each preset with the products it keeps on, as the code does", () => {
    const monitoring: string = PRODUCTS_OF_PRESET[
      ServerProductsPreset.MonitoringAndStatusPages
    ]
      .map((product: ProductKey): string => {
        return getProductTitle(product);
      })
      .join(", ")
      .replace(/, ([^,]*)$/, " and $1");

    expect(ENGLISH_SECTION).toContain(
      `**Monitoring and status pages** keeps ${monitoring}`,
    );

    const added: string = PRODUCTS_OF_PRESET[
      ServerProductsPreset.IncidentResponse
    ]
      .filter((product: ProductKey): boolean => {
        return !PRODUCTS_OF_PRESET[
          ServerProductsPreset.MonitoringAndStatusPages
        ].includes(product);
      })
      .map((product: ProductKey): string => {
        return getProductTitle(product);
      })
      .join(", ")
      .replace(/, ([^,]*)$/, " and $1");

    expect(ENGLISH_SECTION).toContain(`**Incident response** adds ${added}`);
    expect(ENGLISH_SECTION).toContain("**Everything** keeps every product");
  });

  test("names every value SERVER_PRODUCTS takes", () => {
    expect(SERVER_PRODUCTS_ENV_VAR).toBe("SERVER_PRODUCTS");

    for (const preset of SERVER_PRODUCTS_PRESETS) {
      expect(ENGLISH_SECTION).toContain(`\`${preset}\``);
    }
  });

  test("says what off means: nothing deleted, what runs keeps running, writes refused, reads kept", () => {
    expect(ENGLISH_SECTION).toContain("Nothing is deleted");
    expect(ENGLISH_SECTION).toContain("monitors keep checking");
    expect(ENGLISH_SECTION).toContain("published status pages stay up");
    expect(ENGLISH_SECTION).toContain(
      "The API, workflows and the Slack, Microsoft Teams and Mattermost apps refuse to create, change or delete the product's records",
    );
    expect(ENGLISH_SECTION).toContain("Reading still works");
  });

  test("says OneUptime AI starts no work on a product that is off, and what still starts a runbook while Runbooks is off (#9489)", () => {
    expect(ENGLISH_SECTION).toContain(
      "OneUptime AI starts no work on the product: no investigation, postmortem draft, fix, code fix or insight.",
    );

    // What still starts a run, and what no longer does, as the code says.
    const still: Array<string> = RUNBOOK_TRIGGERS_WHILE_SWITCHED_OFF.map(
      (trigger: RunbookTriggerType): string => {
        return RUNBOOK_TRIGGER_WORDS[trigger];
      },
    );
    const refused: Array<string> = RUNBOOK_TRIGGER_TYPES.filter(
      (trigger: RunbookTriggerType): boolean => {
        return !RUNBOOK_TRIGGERS_WHILE_SWITCHED_OFF.includes(trigger);
      },
    ).map((trigger: RunbookTriggerType): string => {
      return RUNBOOK_TRIGGER_WORDS[trigger];
    });

    expect(ENGLISH_SECTION).toContain(
      `While ${getProductTitle(ProductKey.Runbooks)} is off, a runbook still runs by its own ${listed(still, "and")}, and nothing else starts one: not ${listed(refused, "or")}.`,
    );
  });

  test("names the telemetry products stopped ingestion turns off", () => {
    for (const product of TELEMETRY_INGESTION_PRODUCTS) {
      expect(ENGLISH_SECTION).toContain(getProductTitle(product));
    }
  });

  test("gives the profile's measured memory, service by service, at rest and with 100 monitors", () => {
    for (const row of MEASURED) {
      expect(ENGLISH_SECTION).toContain(
        `| \`${row.service}\` | ${english(row.rest)} MiB | ${english(row.monitors)} MiB |`,
      );
    }

    // The totals are the rows' sums, and every service that runs has a row.
    expect(ENGLISH_SECTION).toContain(
      `| Total | ${english(MEASURED_REST_TOTAL)} MiB | ${english(MEASURED_MONITORS_TOTAL)} MiB |`,
    );
    expect(
      MEASURED.map((row: MeasuredRow): string => {
        return row.service;
      }),
    ).toEqual([...SERVICES_THAT_RUN]);
  });

  test("says what it was measured on, and gives the server it needs in place of the requirements", () => {
    expect(ENGLISH_SECTION).toContain(
      "Measured on release 15.0.0 with Docker Compose, each service held to the same 4 CPU cores, as on a 4-core server.",
    );
    expect(ENGLISH_SECTION).toContain(
      `up to ${english(MEASURED_STARTUP_PEAK)} MiB together`,
    );
    expect(ENGLISH_SECTION).toContain(
      "So this profile runs on a server with 4 CPU cores and 6 GB of memory",
    );
    // The memory it needs is more than it used at its peak, starting.
    expect(6 * 1000 * 1000 * 1000).toBeGreaterThan(
      MEASURED_STARTUP_PEAK * 1024 * 1024,
    );
    expect(ENGLISH_SECTION).not.toContain("Size the server by the");
  });

  test("says how many monitors one probe checks a minute, and what the measurement set", () => {
    const compose: string = read("docker-compose.base.yml");
    const example: string = read("config.example.env");

    expect(example).toMatch(/^GLOBAL_PROBE_1_MONITORING_WORKERS=5$/m);
    expect(example).toMatch(/^GLOBAL_PROBE_1_MONITOR_FETCH_LIMIT=10$/m);
    expect(compose).toContain(
      "PROBE_MONITORING_WORKERS: ${GLOBAL_PROBE_1_MONITORING_WORKERS}",
    );
    expect(compose).toContain(
      "PROBE_MONITOR_FETCH_LIMIT: ${GLOBAL_PROBE_1_MONITOR_FETCH_LIMIT}",
    );
    expect(ENGLISH_SECTION).toContain(
      "One probe checks at most 50 monitors a minute with its default settings: 5 workers (`GLOBAL_PROBE_1_MONITORING_WORKERS`) of 10 monitors each (`GLOBAL_PROBE_1_MONITOR_FETCH_LIMIT`).",
    );
    expect(ENGLISH_SECTION).toContain(
      "`GLOBAL_PROBE_1_MONITOR_FETCH_LIMIT=20` in `config.env`",
    );
  });
});

describe.each(LANGUAGES)("the %s docs", (language: string) => {
  const compose: string = page(language, "installation/docker-compose");

  test("give the measured figures: every service's, the totals and the peak while starting", () => {
    const stated: Set<string> = statedNumbers(compose);

    for (const value of [
      ...MEASURED.flatMap((row: MeasuredRow): Array<number> => {
        return [row.rest, row.monitors];
      }),
      MEASURED_REST_TOTAL,
      MEASURED_MONITORS_TOTAL,
      MEASURED_STARTUP_PEAK,
    ]) {
      expect({ value, stated: true }).toEqual({
        value,
        stated: stated.has(String(value)),
      });
    }

    expect(compose).toContain("`GLOBAL_PROBE_1_MONITOR_FETCH_LIMIT=20`");
    expect(compose).toContain("`docker stats`");
  });

  test("carry the profile's settings word for word", () => {
    expect(compose).toContain(PROFILE_BLOCK);
  });

  test("carry every setting, value and service name, untranslated", () => {
    for (const literal of LITERALS) {
      expect({ literal, found: compose.includes(literal) }).toEqual({
        literal,
        found: true,
      });
    }
  });

  test("put the section after Back up and restore, and keep the production checklist's order", () => {
    const headings: Array<string> = compose
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("## ");
      });
    const english: Array<string> = ENGLISH_COMPOSE.split("\n").filter(
      (line: string): boolean => {
        return line.startsWith("## ");
      },
    );

    expect(headings).toHaveLength(english.length);
    expect(english.indexOf("## Run only what you need")).toBe(
      english.indexOf("## Back up and restore") + 1,
    );
  });

  test("say, as the English page does, what OneUptime AI and a runbook still do while a product is off (#9489)", () => {
    const bullets: Array<string> = bulletsOf(productsSection(compose));
    const english: Array<string> = bulletsOf(ENGLISH_SECTION);

    expect(bullets).toHaveLength(english.length);

    /*
     * Beside what the API refuses: OneUptime AI starts no work on it, and is
     * among what no longer starts a runbook while Runbooks is off.
     */
    const refuses: number = bullets.findIndex((line: string): boolean => {
      return line.includes("Mattermost");
    });

    expect(refuses).toBeGreaterThan(-1);
    expect(bullets[refuses + 1]!.split("OneUptime AI")).toHaveLength(3);
  });

  test("link Project Settings > Products to the section", () => {
    expect(page(language, "configuration/project-settings")).toContain(
      "/docs/installation/docker-compose#",
    );
  });
});

describe("where the starting value is set", () => {
  test("config.example.env starts every server with every product on", () => {
    expect(read("config.example.env")).toMatch(/^SERVER_PRODUCTS=everything$/m);
  });

  test("Docker Compose passes it to the app, everything when a config.env has none", () => {
    expect(read("docker-compose.base.yml")).toContain(
      "SERVER_PRODUCTS: ${SERVER_PRODUCTS:-everything}",
    );
  });

  test("the Helm chart has products.onThisServer, everything by default", () => {
    expect(read("HelmChart/Public/oneuptime/values.yaml")).toMatch(
      /^products:\n {2}onThisServer: everything$/m,
    );
    expect(read("HelmChart/Public/oneuptime/templates/_helpers.tpl")).toContain(
      "- name: SERVER_PRODUCTS",
    );
  });

  test("the server reads it", () => {
    expect(read("packages/Common/Server/EnvironmentConfig.ts")).toContain(
      'process.env["SERVER_PRODUCTS"]',
    );
  });
});
