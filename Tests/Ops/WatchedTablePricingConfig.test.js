"use strict";

/**
 * What Data Observability's watched tables cost is configured in one place per
 * way of installing OneUptime, and reaches every container that reads it: the App
 * bills with it and Home's pricing page says it. The defaults are the rates
 * Common/Types/Billing/PayAsYouGoPricing.ts lists, so an install that sets nothing
 * bills what the code and the page say.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..", "..");
const CHART = path.join(ROOT, "HelmChart", "Public", "oneuptime");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

const VARIABLES = {
  WATCHED_TABLES_INCLUDED_PER_PROJECT: {
    value: "includedPerProject",
    rate: "includedTables",
  },
  WATCHED_TABLE_PRICE_IN_USD: {
    value: "pricePerTableInUSD",
    rate: "pricePerTableInUSD",
  },
  WATCHED_TABLE_VOLUME_THRESHOLD: {
    value: "volumeThreshold",
    rate: "volumeThresholdInTables",
  },
  WATCHED_TABLE_VOLUME_PRICE_IN_USD: {
    value: "volumePricePerTableInUSD",
    rate: "volumePricePerTableInUSD",
  },
};

function codeDefault(rate) {
  const match = read("packages/Common/Types/Billing/PayAsYouGoPricing.ts").match(
    new RegExp(`\\b${rate}: ([0-9._]+),`),
  );

  return Number(match[1].replace(/_/g, ""));
}

describe("the watched table rates", () => {
  const values = yaml.load(
    fs.readFileSync(path.join(CHART, "values.yaml"), "utf8"),
  ).billing.watchedTables;
  const schema = JSON.parse(
    fs.readFileSync(path.join(CHART, "values.schema.json"), "utf8"),
  ).properties.billing.properties.watchedTables.properties;
  const helpers = fs.readFileSync(
    path.join(CHART, "templates", "_helpers.tpl"),
    "utf8",
  );
  const common = helpers.slice(
    helpers.indexOf('define "oneuptime.env.common"'),
    helpers.indexOf('define "oneuptime.env.globalRunner"'),
  );
  const compose = read("docker-compose.base.yml");
  const example = read("config.example.env");
  const config = read("packages/Common/Server/EnvironmentConfig.ts");

  test.each(Object.entries(VARIABLES))(
    "%s reaches every install, defaulting to the listed rate",
    (name, { value, rate }) => {
      // Helm: the value, its schema, and the env of every container.
      expect(values[value]).toBe(codeDefault(rate));
      expect(schema[value]).toBeDefined();
      expect(common).toContain(`- name: ${name}`);
      expect(common).toContain(`$.Values.billing.watchedTables.${value}`);
      // Compose and its example env.
      expect(compose).toContain(`${name}: \${${name}}`);
      expect(example).toContain(`${name}=${codeDefault(rate)}`);
      // The server reads it.
      expect(config).toContain(`"${name}"`);
    },
  );

  test("nothing is charged until an install names its Stripe price", () => {
    expect(values.stripePriceId === null || values.stripePriceId === "").toBe(
      true,
    );
    expect(schema.stripePriceId.type).toContain("null");
    expect(common).toContain("- name: WATCHED_TABLE_STRIPE_PRICE_ID");
    expect(compose).toContain(
      "WATCHED_TABLE_STRIPE_PRICE_ID: ${WATCHED_TABLE_STRIPE_PRICE_ID}",
    );
    expect(example).toMatch(/^WATCHED_TABLE_STRIPE_PRICE_ID=$/m);
    expect(config).toContain('"WATCHED_TABLE_STRIPE_PRICE_ID"');
  });

  test("Home, which says them, gets them with the App, which bills them", () => {
    for (const template of ["home.yaml", "app.yaml", "worker.yaml"]) {
      expect(
        fs.readFileSync(path.join(CHART, "templates", template), "utf8"),
      ).toMatch(/oneuptime\.env\.(common|runtime)/);
    }
  });
});
