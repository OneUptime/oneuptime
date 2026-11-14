import { getProductTitle } from "Common/Types/Product/ProductCatalog";
import ProductKey from "Common/Types/Product/ProductKey";
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
 * where config.env, Docker Compose and the Helm chart set it. No memory or
 * CPU figure is given that was not measured.
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
      "The API refuses to create, change or delete the product's records",
    );
    expect(ENGLISH_SECTION).toContain("Reading still works");
  });

  test("names the telemetry products stopped ingestion turns off", () => {
    for (const product of TELEMETRY_INGESTION_PRODUCTS) {
      expect(ENGLISH_SECTION).toContain(getProductTitle(product));
    }
  });

  test("gives no memory or CPU figure for the profile: none was measured", () => {
    expect(ENGLISH_SECTION).not.toMatch(/\d+\s?(GB|MB|GiB|MiB|cores?|vCPU)/i);
  });
});

describe.each(LANGUAGES)("the %s docs", (language: string) => {
  const compose: string = page(language, "installation/docker-compose");

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
