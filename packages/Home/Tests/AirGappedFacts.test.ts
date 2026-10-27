import {
  AIR_GAPPED_LLM_PROVIDER_ENV,
  AIR_GAPPED_REGISTRY,
  AIR_GAPPED_VALUES_YAML,
  AirGappedAiOptions,
  AirGappedAiSafety,
  AirGappedAiSetup,
  AirGappedCapabilities,
  AirGappedCapability,
  AirGappedCompliance,
  AirGappedCompliancePoint,
  AirGappedConnection,
  AirGappedConnections,
  AirGappedDocs,
  AirGappedFaq,
  AirGappedFaqs,
  AirGappedSteps,
  AirGappedUpgradeNote,
  CHART_SIGNING_KEY_FINGERPRINT,
  CHART_SIGNING_KEY_URL,
  fingerprintHalves,
  plainText,
} from "../Utils/AirGapped";
import { Claim, getClaim } from "../Utils/Claims";
import LlmType from "Common/Types/LLM/LlmType";
import MonitorType from "Common/Types/Monitor/MonitorType";
import CallProviderType from "Common/Types/Call/CallProviderType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY CLAIM ON THE AIR-GAPPED PAGE, HELD TO THE FILE THAT MAKES IT TRUE.
 *
 * The page (/enterprise/air-gapped, Utils/AirGapped.ts) tells a buyer whose
 * network never reaches the internet what works there and exactly what to
 * set. Each statement rests on a chart value, a line of product code, a docs
 * page or a governed claim, and each test here reads that file - as text,
 * the way Tests/DocsLinks.test.ts reads the docs: this job installs only
 * Home's and Common's dependencies. When a fact moves (a chart value is
 * renamed, the probe image drops a browser, a new default calls out), the
 * test that pins it fails, naming the file and the words it no longer has,
 * and the sentence of the page to change with it.
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");
const HAS_EE: boolean = fs.existsSync(path.join(REPO_ROOT, "ee"));

const CHART: string = "HelmChart/Public/oneuptime";
const CHART_VALUES: string = `${CHART}/values.yaml`;
const CHART_HELPERS: string = `${CHART}/templates/_helpers.tpl`;
const CHART_CONFIGURATION: string = `${CHART}/docs/configuration.md`;
const AIR_GAPPED_VALUES_FILE: string = "HelmChart/Tests/air-gapped-values.yaml";
const AIR_GAPPED_SUITE: string = "HelmChart/Tests/suites/air-gapped.sh";
const ENVIRONMENT_CONFIG: string =
  "packages/Common/Server/EnvironmentConfig.ts";
const UPDATE_CHECK_JOB: string =
  "packages/App/FeatureSet/Workers/Jobs/InstanceUpdate/CheckForNewVersion.ts";
const CHECK_IN_JOB: string =
  "packages/App/FeatureSet/Workers/Jobs/InstanceCheckIn/CheckIn.ts";
const SIGN_UP_API: string =
  "packages/App/FeatureSet/Identity/API/Authentication.ts";
const REGISTER_PAGE: string =
  "packages/App/FeatureSet/Accounts/src/Pages/Register.tsx";
const RELEASE_WORKFLOW: string = ".github/workflows/release.yml";
const BUILD_IMAGES: string = "Scripts/GHA/build_docker_images.sh";

// A quoted https:// address in source, and the suites the helm-test job runs.
const QUOTED_HTTPS_ADDRESS: RegExp = /"(https:\/\/[^"\s]+)"/g;

const fileCache: Map<string, string> = new Map<string, string>();

function repoFile(relativePath: string): string {
  if (!fileCache.has(relativePath)) {
    fileCache.set(
      relativePath,
      fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"),
    );
  }

  return fileCache.get(relativePath)!;
}

function repoPathExists(relativePath: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function docsPagePath(page: string): string {
  return `packages/App/FeatureSet/Docs/Content/en/${page}.md`;
}

/*
 * The file says these words. A failure names the file and the words, not
 * the whole file.
 */
function expectFileToSay(relativePath: string, words: string): void {
  expect([relativePath, words, repoFile(relativePath).includes(words)]).toEqual(
    [relativePath, words, true],
  );
}

function expectFileNotToSay(relativePath: string, words: string): void {
  expect([relativePath, words, repoFile(relativePath).includes(words)]).toEqual(
    [relativePath, words, false],
  );
}

function expectTextToSay(label: string, text: string, words: string): void {
  expect([label, words, text.includes(words)]).toEqual([label, words, true]);
}

// Lines of a YAML file without its comment lines, trimmed.
function withoutComments(yaml: string): string {
  return yaml
    .split("\n")
    .filter((line: string): boolean => {
      return !line.trimStart().startsWith("#");
    })
    .join("\n")
    .trim();
}

function connection(key: string): AirGappedConnection {
  const found: AirGappedConnection | undefined = AirGappedConnections.find(
    (entry: AirGappedConnection): boolean => {
      return entry.key === key;
    },
  );

  expect([key, Boolean(found)]).toEqual([key, true]);

  return found!;
}

function capability(key: string): string {
  return AirGappedCapabilities.find((entry: AirGappedCapability): boolean => {
    return entry.key === key;
  })!.description;
}

function compliancePoint(key: string): string {
  return AirGappedCompliance.find(
    (entry: AirGappedCompliancePoint): boolean => {
      return entry.key === key;
    },
  )!.description;
}

function faqAnswer(question: string): string {
  return AirGappedFaqs.find((faq: AirGappedFaq): boolean => {
    return faq.question === question;
  })!.answer;
}

describe("the values the page shows are the values the chart is tested with", () => {
  test("the page's values.yaml is HelmChart/Tests/air-gapped-values.yaml, comments aside", () => {
    expect(AIR_GAPPED_VALUES_YAML).toBe(
      withoutComments(repoFile(AIR_GAPPED_VALUES_FILE)),
    );
  });

  test("the chart's air-gapped suite renders that file, and the helm-test job runs it", () => {
    expectFileToSay(
      AIR_GAPPED_SUITE,
      'AIR_GAPPED_VALUES="${TESTS_DIR}/air-gapped-values.yaml"',
    );
    expectFileToSay(AIR_GAPPED_SUITE, `REGISTRY="${AIR_GAPPED_REGISTRY}"`);
    expectFileToSay(AIR_GAPPED_SUITE, 'PULL_SECRET="internal-registry"');

    // The suites the helm-test job runs: run.sh's ALL_SUITES=(...) line.
    const allSuites: string | undefined = repoFile("HelmChart/Tests/run.sh")
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("ALL_SUITES=(") && line.endsWith(")");
      });

    expect(allSuites).toBeDefined();
    expect(allSuites!.slice("ALL_SUITES=(".length, -1).split(" ")).toContain(
      "air-gapped",
    );
    expectFileToSay("HelmChart/README.md", "| `air-gapped`");
  });

  test("the suite checks each thing the caption under the values promises", () => {
    // "every image comes from your registry"
    expectFileToSay(
      AIR_GAPPED_SUITE,
      "every image of every workload comes from",
    );
    // "every pod gets the pull secret"
    expectFileToSay(AIR_GAPPED_SUITE, "gets the ${PULL_SECRET} pull secret");
    // "the update check and the daily check-in are off"
    expectFileToSay(
      AIR_GAPPED_SUITE,
      "the app is told the update check is off",
    );
    expectFileToSay(
      AIR_GAPPED_SUITE,
      "the app is told the daily check-in is off",
    );
    // "no probe is given a public nameserver"
    expectFileToSay(
      AIR_GAPPED_SUITE,
      "no probe is given a nameserver of its own",
    );
    // "probes and webhooks may reach private addresses"
    expectFileToSay(
      AIR_GAPPED_SUITE,
      "every probe may check private addresses",
    );
    expectFileToSay(
      AIR_GAPPED_SUITE,
      "the app lets webhooks reach private addresses",
    );
    // ...and the stock render the suite contrasts it with refuses both.
    expectFileToSay(
      AIR_GAPPED_SUITE,
      "a stock probe refuses private addresses",
    );
    expectFileToSay(
      AIR_GAPPED_SUITE,
      "a stock install refuses webhooks to private addresses",
    );
  });

  test("the values the snippet changes are the chart's own keys and defaults", () => {
    expectFileToSay(
      CHART_VALUES,
      "image:\n  registry: docker.io\n  repository: oneuptime",
    );
    expectFileToSay(CHART_VALUES, "    repository: postgres\n");
    expectFileToSay(
      CHART_VALUES,
      "    repository: clickhouse/clickhouse-server\n",
    );
    expectFileToSay(CHART_VALUES, "    repository: valkey/valkey\n");
    expectFileToSay(CHART_VALUES, "updateCheck:\n  disabled: false\n  url:");
    expectFileToSay(CHART_VALUES, "instanceCheckIn:\n  disabled: false\n");
    expectFileToSay(CHART_VALUES, "# imagePullSecrets:");
    // The chart's probe is probes.one, and both private-address switches start off.
    expectFileToSay(CHART_VALUES, "probes:\n  one:\n");
    expectFileToSay(CHART_VALUES, "    allowPrivateNetworkMonitors: false\n");
    expectFileToSay(CHART_VALUES, "webhooks:\n");
    expectFileToSay(CHART_VALUES, "  allowPrivateNetwork: false\n");
  });

  test("every pod template the chart has takes the chart-wide pull secrets", () => {
    const templates: string = path.join(REPO_ROOT, CHART, "templates");
    const podTemplates: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(full);
          continue;
        }

        const source: string = fs.readFileSync(full, "utf8");

        if (!source.includes("containers:")) {
          continue;
        }

        const name: string = path.relative(templates, full);

        podTemplates.push(name);
        expect([name, source.includes("Values.imagePullSecrets")]).toEqual([
          name,
          true,
        ]);
      }
    };

    walk(templates);

    // The shared deployment helper, the datastores and the test hook among them.
    expect(podTemplates).toEqual(
      expect.arrayContaining([
        "_helpers.tpl",
        "postgresql-statefulset.yaml",
        "clickhouse-statefulset.yaml",
        "valkey-statefulset.yaml",
        path.join("tests", "test.yaml"),
      ]),
    );
  });
});

describe("step 1: mirror the images", () => {
  test("OneUptime's images are published to Docker Hub and the GitHub Container Registry", () => {
    expectFileToSay(BUILD_IMAGES, '--tag "oneuptime/${IMAGE}:');
    expectFileToSay(BUILD_IMAGES, '--tag "ghcr.io/oneuptime/${IMAGE}:');
    expect(AirGappedSteps[0]!.description).toContain(
      "from Docker Hub or the GitHub Container Registry",
    );
  });

  test("image.registry and image.repository build every OneUptime image's reference", () => {
    expectFileToSay(
      CHART_HELPERS,
      'printf "%s/%s/%s:%s" $values.image.registry $values.image.repository $imageName',
    );
  });

  test("the bundled datastores take their image from their own image.repository", () => {
    expectFileToSay(
      `${CHART}/templates/postgresql-statefulset.yaml`,
      ".Values.postgresql.image.repository",
    );
    expectFileToSay(
      `${CHART}/templates/clickhouse-statefulset.yaml`,
      ".Values.clickhouse.image.repository",
    );
    expectFileToSay(
      `${CHART}/templates/valkey-statefulset.yaml`,
      "$valkey.image.repository",
    );
  });

  test("image.tag pins a release, as the chart's docs ask for production", () => {
    expectFileToSay(
      CHART_CONFIGURATION,
      "Docker image tag. Pin this in production",
    );
    expect(AirGappedSteps[0]!.settings).toEqual([
      "image.registry",
      "image.tag",
      "imagePullSecrets",
    ]);
  });

  test("what the step says to mirror later is off in a stock install, so the values above move every image it runs", () => {
    // PgBouncer, vLLM and the database operators: each off until turned on.
    expectFileToSay(CHART_VALUES, "pgbouncer:\n  enabled: false\n");
    expectFileToSay(CHART_VALUES, "vllm:\n  enabled: false\n");
    expectFileToSay(CHART_VALUES, "keda:\n  enabled: false\n");
    expectFileToSay(
      CHART_VALUES,
      "postgresOperator:\n  cnpg:\n    enabled: false\n",
    );
    expectFileToSay(
      CHART_VALUES,
      "clickhouseOperator:\n  altinity:\n    enabled: false\n",
    );
    // Once one is on, its image is named like any other: image.overrides.
    expectFileToSay(
      CHART_VALUES,
      "## clickhouseKeeper, valkey, pgbouncer, vllm, kubectl. Each is either a full",
    );
    expect(AirGappedSteps[0]!.description).toContain(
      "Anything you turn on later, such as PgBouncer or a database operator, needs its images mirrored too.",
    );
  });

  test("imagePullSecrets is documented as reaching every pod the chart defines", () => {
    expectFileToSay(
      CHART_CONFIGURATION,
      "| `imagePullSecrets`    | Pull secrets (a list of `name:` entries) for every pod the chart defines",
    );
  });
});

describe("step 2: bring in the signed chart", () => {
  test("every release signs the chart with OneUptime's key", () => {
    expectFileToSay(
      RELEASE_WORKFLOW,
      "helm package --sign --key 'key@oneuptime.com' --keyring ~/.gnupg/secring.gpg oneuptime ",
    );
  });

  test("the page's fingerprint and key are the ones the chart publishes", () => {
    expectFileToSay(
      `${CHART}/Chart.yaml`,
      `fingerprint: ${CHART_SIGNING_KEY_FINGERPRINT}`,
    );
    expectFileToSay(`${CHART}/Chart.yaml`, `url: ${CHART_SIGNING_KEY_URL}`);
  });

  test("the fingerprint is shown as GnuPG prints it, in two halves of five groups", () => {
    expect(fingerprintHalves(CHART_SIGNING_KEY_FINGERPRINT)).toEqual([
      "83F2 C1DD F58A 0524 64C4",
      "A172 9D87 E494 AC01 6697",
    ]);
    expect(fingerprintHalves("ABCDEFGH")).toEqual(["ABCD", "EFGH"]);
    expect(fingerprintHalves("ABCDEFGHIJKL")).toEqual(["ABCD EFGH", "IJKL"]);
  });

  test("the operators the chart can install are packed inside it", () => {
    const charts: Array<string> = fs.readdirSync(
      path.join(REPO_ROOT, CHART, "charts"),
    );

    for (const operator of [
      "keda-",
      "cloudnative-pg-",
      "altinity-clickhouse-operator-",
    ]) {
      expect([
        operator,
        charts.some((file: string): boolean => {
          return file.startsWith(operator) && file.endsWith(".tgz");
        }),
      ]).toEqual([operator, true]);
    }

    expect(AirGappedSteps[1]!.description).toContain(
      "KEDA, CloudNativePG and Altinity's ClickHouse operator",
    );
  });
});

describe("step 3: point the install inward", () => {
  test("updateCheck.disabled becomes DISABLE_UPDATE_CHECK, which the check obeys", () => {
    expectFileToSay(
      CHART_HELPERS,
      "- name: DISABLE_UPDATE_CHECK\n  value: {{ default false $.Values.updateCheck.disabled | squote }}",
    );
    expectFileToSay(
      ENVIRONMENT_CONFIG,
      'process.env["DISABLE_UPDATE_CHECK"] === "true"',
    );
    expectFileToSay(UPDATE_CHECK_JOB, "if (DisableUpdateCheck) {");
  });

  test("instanceCheckIn.disabled becomes DISABLE_INSTANCE_CHECK_IN, which the check-in obeys", () => {
    expectFileToSay(
      CHART_HELPERS,
      "- name: DISABLE_INSTANCE_CHECK_IN\n  value: {{ default false (($.Values.instanceCheckIn).disabled) | squote }}",
    );
    expectFileToSay(
      ENVIRONMENT_CONFIG,
      'process.env["DISABLE_INSTANCE_CHECK_IN"] === "true"',
    );
    expectFileToSay(CHECK_IN_JOB, "if (DisableInstanceCheckIn) {");
  });

  test("the probes' public fallback nameservers are the chart's default dnsConfig", () => {
    expectFileToSay(
      CHART_VALUES,
      '  nameservers:\n    - "8.8.8.8"\n    - "1.1.1.1"',
    );
    expectFileToSay(
      CHART_VALUES,
      "# Air-gapped clusters with no egress to public DNS: drop the `nameservers` list",
    );
    // Each probe uses the chart-wide dnsConfig unless it sets its own.
    expectFileToSay(
      `${CHART}/templates/probe.yaml`,
      "{{- else if $.Values.dnsConfig }}",
    );
  });
});

describe("step 3: probes and webhooks reach the private addresses an air-gapped network has", () => {
  const privateAccess: string = docsPagePath(
    "self-hosted/private-network-access",
  );

  test("a probe refuses private addresses until allowPrivateNetworkMonitors lets it", () => {
    // Website and API monitors - "websites and APIs" on the page - are the ones refused.
    expectFileToSay(
      privateAccess,
      "Four monitor types are affected: **API**, **Website**, **External Status Page** and **Custom JavaScript Code**. On a stock probe they can reach public HTTP(S) targets, but refuse private address space.",
    );
    expectFileToSay(
      CHART_CONFIGURATION,
      "| `probes.<key>.allowPrivateNetworkMonitors`        | Let API, Website, External Status Page and Custom JavaScript Code monitors on this probe reach private network addresses",
    );
    expectFileToSay(
      `${CHART}/templates/probe.yaml`,
      "- name: PROBE_ALLOW_PRIVATE_NETWORK_MONITORS\n              value: {{ default false $val.allowPrivateNetworkMonitors | squote }}",
    );
    expect(capability("monitoring")).toContain("websites and APIs");
  });

  test("webhooks, workflows and Mattermost refuse private addresses until webhooks.allowPrivateNetwork lets them", () => {
    expectFileToSay(
      privateAccess,
      "| Workflows, project webhooks, on-call user webhooks | The **API server**'s environment | Private addresses refused |",
    );
    expectFileToSay(
      CHART_HELPERS,
      '- name: ALLOW_PRIVATE_NETWORK_WEBHOOKS\n  value: {{ ternary "true" "false" (default false (($.Values.webhooks).allowPrivateNetwork)) | quote }}',
    );
    expect(capability("notifications")).toContain("webhooks to your own tools");
  });

  test("the mail server, identity provider and AI model need no switch: those connections allow private addresses already", () => {
    expectFileToSay(
      privateAccess,
      "| Data sources, LLM providers, SMTP servers, OIDC discovery and other connections | The **API server**'s environment | Private addresses allowed |",
    );
  });

  test("the step names both switches, and the values set them", () => {
    expect(AirGappedSteps[2]!.settings).toEqual([
      "updateCheck.disabled",
      "instanceCheckIn.disabled",
      "dnsConfig.nameservers",
      "probes.one.allowPrivateNetworkMonitors",
      "webhooks.allowPrivateNetwork",
    ]);
    expect(AIR_GAPPED_VALUES_YAML).toContain(
      "probes:\n  one:\n    allowPrivateNetworkMonitors: true",
    );
    expect(AIR_GAPPED_VALUES_YAML).toContain(
      "webhooks:\n  allowPrivateNetwork: true",
    );
  });
});

describe("step 4: license the Enterprise Edition offline", () => {
  const enterprise: string = docsPagePath("self-hosted/enterprise");

  test("the docs give offline activation its own steps, from the instance ID on the edition label", () => {
    expectFileToSay(enterprise, "### Offline activation (air-gapped installs)");
    expectFileToSay(
      enterprise,
      "Sign in as a master admin, open the edition label and note the **instance ID**.",
    );
    expectFileToSay(
      enterprise,
      "The install verifies the token itself, against the OneUptime signing keys built into your release. It never contacts OneUptime.",
    );
    expectFileToSay(
      enterprise,
      "A token issued for one instance ID is refused by every other install",
    );
    expectFileToSay(
      enterprise,
      "To renew or add seats, activate a new token before the current one expires.",
    );
  });

  test("the releases trust a signing key, so a token can be verified offline", () => {
    if (!HAS_EE) {
      // Core runs without ee/ (Common Test and App Test remove it).
      return;
    }

    const keys: string = repoFile("ee/Server/License/TrustedLicenseKeys.ts");
    const productionList: string = keys.slice(
      keys.indexOf("PRODUCTION_TRUSTED_LICENSE_KEYS"),
      keys.indexOf("let trustedLicenseKeysForTests"),
    );

    expectTextToSay("the production key list", productionList, "kid:");
    expectTextToSay(
      "the production key list",
      productionList,
      "-----BEGIN PUBLIC KEY-----",
    );
  });

  test("an install activated offline never reports to OneUptime", () => {
    if (!HAS_EE) {
      return;
    }

    expectFileToSay(
      "ee/Server/License/Jobs/ReportUserCount.ts",
      "if (LicenseInputsUtil.isOfflineActivated(inputs)) {",
    );
  });
});

describe("upgrades", () => {
  test("the chart migrates the database in a Job of its own, one major version at a time", () => {
    const upgrading: string = docsPagePath("installation/upgrading");

    expectFileToSay(
      upgrading,
      "The chart runs the database migrations in a Job of its own before the new pods serve traffic.",
    );
    expectFileToSay(upgrading, "**Upgrade one major version at a time**");
    expect(repoPathExists(`${CHART}/templates/migrate-job.yaml`)).toBe(true);
    expect(AirGappedUpgradeNote).toContain(
      "The chart runs the database migrations in a Job of its own, inside your cluster.",
    );
    expect(faqAnswer("How do upgrades work?")).toContain(
      "Upgrade one major version at a time.",
    );
  });
});

describe("what runs inside the network", () => {
  test("every monitor the page names is a monitor type OneUptime has", () => {
    expect([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.DNS,
      MonitorType.SSLCertificate,
      MonitorType.NetworkDevice,
      MonitorType.SQLQuery,
      MonitorType.SyntheticMonitor,
    ]).toEqual([
      "Website",
      "API",
      "Ping",
      "Port",
      "DNS",
      "SSL Certificate",
      "Network Device",
      "SQL Query",
      "Synthetic Monitor",
    ]);
    expect(capability("monitoring")).toContain(
      "websites and APIs, ping, ports, DNS, SSL certificates, network devices over SNMP, SQL databases, and synthetic browser tests",
    );
  });

  test("the probe image carries Chromium and Firefox for synthetic tests", () => {
    expectFileToSay(
      "packages/Probe/Dockerfile.tpl",
      "npx playwright install --with-deps chromium firefox",
    );
    expect(capability("monitoring")).toContain(
      "in the Chromium and Firefox the probe image carries",
    );
  });

  test("a status page's custom domain takes an uploaded certificate", () => {
    expectFileToSay(
      docsPagePath("status-pages/branding-and-domains"),
      "switch **Upload Custom Certificate** on",
    );
  });

  test("telemetry comes in over OpenTelemetry (HTTP and gRPC), Fluentd and Fluent Bit, syslog and agents", () => {
    expectFileToSay(
      CHART_VALUES,
      "# metrics / logs / profiles (HTTP + gRPC), Fluentd logs, Syslog logs, and",
    );
    expectFileToSay(
      docsPagePath("self-hosted/architecture"),
      'Senders["Telemetry senders:<br/>OpenTelemetry,<br/>Fluent Bit,<br/>syslog, agents"]',
    );
  });

  test("Mattermost and IRC are workflow steps, and webhooks reach private addresses when allowed", () => {
    const components: string =
      "packages/Common/Server/Types/Workflow/Components";

    expect(
      repoPathExists(`${components}/Mattermost/SendMessageToChannel.ts`),
    ).toBe(true);
    expect(repoPathExists(`${components}/IRC/SendMessageToChannel.ts`)).toBe(
      true,
    );

    const privateAccess: string = docsPagePath(
      "self-hosted/private-network-access",
    );

    expectFileToSay(privateAccess, "The workflow **Mattermost** component");
    expectFileToSay(privateAccess, "On-call **user webhooks**");
    expectFileToSay(privateAccess, "`webhooks.allowPrivateNetwork`");
    expectFileToSay(
      CHART_CONFIGURATION,
      "| `webhooks.allowPrivateNetwork`            | Let workflows, project webhooks and on-call user webhooks reach private ranges.",
    );
  });

  test("single sign-on is in every edition", () => {
    expectFileToSay(
      docsPagePath("self-hosted/enterprise"),
      "**Single sign-on is in every edition.**",
    );
    expect(capability("sign-in")).toContain("in every edition");
  });

  test("browser assets are served by the install, and a guard keeps CDNs out", () => {
    expectFileToSay(
      "packages/Common/Server/Utils/VendorAssets.ts",
      'export const VendorAssetsRoute: string = "/oneuptime-assets";',
    );
    expect(
      repoPathExists(
        "packages/Common/Tests/Server/Utils/OfflineAssetHygiene.test.ts",
      ),
    ).toBe(true);
  });

  test("emails carry OneUptime's logo inside them", () => {
    expect(
      repoPathExists(
        "packages/Common/Server/Static/Brand/oneuptime-email-logo.png",
      ),
    ).toBe(true);
    expectFileToSay(
      "AGENTS.md",
      "### Emails load nothing from outside the installation",
    );
    expectFileToSay(
      docsPagePath("self-hosted/architecture"),
      "OneUptime's logo travels inside every email it sends, so it shows even on a network without internet access",
    );
  });

  test("the docs and the API reference are served by the install itself", () => {
    const nginx: string = repoFile("packages/Nginx/default.conf.template");

    for (const location of ["location /docs {", "location /reference {"]) {
      const start: number = nginx.indexOf(location);

      expect([location, start > -1]).toEqual([location, true]);

      const block: string = nginx.slice(start, nginx.indexOf("\n    }", start));

      expectTextToSay(location, block, "proxy_pass ${BACKEND_APP_TARGET};");
    }
  });
});

describe("what reaches out, and how it is stopped", () => {
  test("the update check asks api.github.com, once a day, and fails quietly without a route", () => {
    const defaultUrl: string =
      "https://api.github.com/repos/OneUptime/oneuptime/releases/latest";

    expectFileToSay(ENVIRONMENT_CONFIG, `"${defaultUrl}"`);
    expect(new URL(defaultUrl).host).toBe(
      plainText(connection("update-check").destination),
    );
    expectFileToSay(
      UPDATE_CHECK_JOB,
      "schedule: IsDevelopment ? EVERY_THREE_HOURS : EVERY_DAY",
    );
    expectFileToSay(
      UPDATE_CHECK_JOB,
      "Air-gapped installations have no route to api.github.com.",
    );
    expectFileToSay(
      CHART_VALUES,
      "# Set disabled to true to make no outbound call at all, or point url at an\n# internal mirror",
    );
  });

  test("the daily check-in tells oneuptime.com the install's address and version, once a day, and fails quietly without a route", () => {
    const address: string =
      "https://oneuptime.com/api/open-source-deployment/check-in";

    expectFileToSay(CHECK_IN_JOB, `"${address}"`);
    expect(new URL(address).host).toBe(
      plainText(connection("instance-check-in").destination),
    );
    expectFileToSay(CHECK_IN_JOB, "schedule: EVERY_DAY,");
    // The address and version, and nothing about anyone.
    expectFileToSay(
      CHECK_IN_JOB,
      "data: {\n        instanceUrl: instanceUrl,\n        oneuptimeVersion: AppVersion,\n      },",
    );
    expect(connection("instance-check-in").when).toContain(
      "its address and version, and nothing about anyone",
    );
    expectFileToSay(
      CHECK_IN_JOB,
      "Air-gapped installations have no route to oneuptime.com.",
    );
    expect(connection("instance-check-in").inside).toContain(
      "`instanceCheckIn.disabled: true`",
    );
    expectFileToSay(
      CHART_VALUES,
      "# Set disabled to true to make no call at all.\ninstanceCheckIn:",
    );
  });

  test("signing up with release emails ticked tells oneuptime.com what the page says, and the box starts ticked", () => {
    const signUp: string = repoFile(SIGN_UP_API);
    const address: string =
      "https://oneuptime.com/api/open-source-deployment/register";
    const call: number = signUp.indexOf(`"${address}"`);

    expect(call).toBeGreaterThan(-1);
    expect(new URL(address).host).toBe(
      plainText(connection("release-emails").destination),
    );

    const request: string = signUp.slice(
      signUp.lastIndexOf("if (", call),
      signUp.indexOf("});", call),
    );

    expectTextToSay(
      "the sign-up's call",
      request,
      'miscDataProps["notifySelfHosted"] === true',
    );
    for (const field of [
      "email:",
      "name:",
      "companyName:",
      "companyPhoneNumber:",
      "oneuptimeVersion: AppVersion",
      "instanceUrl: instanceUrl",
    ]) {
      expectTextToSay("the sign-up's call", request, field);
    }

    // Sent and not awaited: a failure is logged and the sign-up goes on.
    expectTextToSay(
      "the sign-up's call",
      signUp.slice(call, call + 1200),
      ".catch((err: Error) => {",
    );

    const register: string = repoFile(REGISTER_PAGE);
    const field: string = register.slice(
      register.indexOf('overrideFieldKey: "notifySelfHosted"'),
      register.indexOf('dataTestId: "notifySelfHosted"'),
    );

    expectTextToSay("the sign-up form's checkbox", field, "defaultValue: true");

    const label: string = JSON.parse(
      repoFile("packages/App/FeatureSet/Accounts/src/Locales/en.json"),
    ).register.notifySelfHosted;

    expect(connection("release-emails").when).toContain(`“${label}” ticked`);
  });

  test("the Enterprise license server is oneuptime.com, and an offline token never needs it", () => {
    expectFileToSay(
      ENVIRONMENT_CONFIG,
      'export const DEFAULT_ENTERPRISE_LICENSE_SERVER_URL: string =\n  "https://oneuptime.com";',
    );
    expect(plainText(connection("enterprise-license").destination)).toBe(
      "oneuptime.com",
    );
    expectFileToSay(
      docsPagePath("self-hosted/enterprise"),
      "The Community Edition sends none of this, and neither does an install activated offline.",
    );
  });

  test("a license activated online syncs once a day after that", () => {
    expect(connection("enterprise-license").when).toBe(
      "Activating a license key online, and a license sync once a day after that.",
    );
    expectFileToSay(
      docsPagePath("self-hosted/enterprise"),
      "From then on it keeps the license current with a daily sync.",
    );

    if (!HAS_EE) {
      // Core runs without ee/ (Common Test and App Test remove it).
      return;
    }

    expectFileToSay(
      "ee/Server/License/Jobs/ReportUserCount.ts",
      "schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_DAY,",
    );
  });

  test("certificates come from Let's Encrypt only when the install orders them", () => {
    expectFileToSay(
      CHART_VALUES,
      "# Automatically provision a Let's Encrypt certificate for the primary host when set to true.",
    );
    expectFileToSay(CHART_VALUES, "ssl:\n  # Automatically provision");
    expectFileToSay(CHART_VALUES, "  provision: false");
  });

  test("SMS and calls go through Twilio alone, and mobile push through the relay or Expo", () => {
    expect(Object.values(CallProviderType)).toEqual([CallProviderType.Twilio]);
    expectFileToSay(
      ENVIRONMENT_CONFIG,
      '"https://oneuptime.com/api/notification/push-relay/send"',
    );

    const push: string = docsPagePath("self-hosted/push-notifications");

    expectFileToSay(push, "`https://exp.host/--/api/v2/push/send`");
    expectFileToSay(
      push,
      "A server with no access to its relay or external push services cannot deliver these notifications.",
    );
  });

  test("the hosted AI providers the page names are provider types", () => {
    expect(LlmType.OpenAI).toBe("OpenAI");
    expect(LlmType.Anthropic).toBe("Anthropic");
  });

  test("the docs the page links for connections out name the same four, with the same settings", () => {
    /*
     * The note under the table sends readers to this docs section, which the
     * install serves too. It says what the page says: four connections
     * unless a setting stops them, and everything else only once set up.
     */
    const architecture: string = docsPagePath("self-hosted/architecture");

    expect(AirGappedDocs.connectionsOut).toBe(
      "/docs/self-hosted/architecture#connections-out-of-your-network",
    );
    expectFileToSay(architecture, "## Connections out of your network");
    expectFileToSay(
      architecture,
      "Four connections are made unless you change a setting:",
    );
    // The update check, and the two settings that turn it off.
    expectFileToSay(architecture, "GitHub's API (`api.github.com`)");
    expectFileToSay(
      architecture,
      "`updateCheck.disabled: true` in the Helm chart",
    );
    expectFileToSay(
      architecture,
      "`DISABLE_UPDATE_CHECK=true` in `config.env` on Docker Compose",
    );
    // The daily check-in, and the two settings that turn it off.
    expectFileToSay(
      architecture,
      "the app tells `oneuptime.com` your install's address and the version it runs",
    );
    expectFileToSay(
      architecture,
      "`instanceCheckIn.disabled: true` in the Helm chart",
    );
    expectFileToSay(
      architecture,
      "`DISABLE_INSTANCE_CHECK_IN=true` in `config.env` on Docker Compose",
    );
    // The release emails a sign-up asks for.
    expectFileToSay(
      architecture,
      "to `oneuptime.com`. Untick it on a network without internet access.",
    );
    // The probes' fallback resolvers.
    expectFileToSay(architecture, "`8.8.8.8` and `1.1.1.1`");
    expectFileToSay(architecture, "Set `dnsConfig.nameservers` to `[]`");
    expectFileToSay(
      architecture,
      "Everything else reaches out only when you turn it on",
    );
    expectFileNotToSay(
      architecture,
      "The app reaches out only for what you turn on.",
    );
  });

  test("exactly four connections are marked as made by default", () => {
    expect(
      AirGappedConnections.filter((entry: AirGappedConnection): boolean => {
        return entry.onByDefault;
      }).map((entry: AirGappedConnection): string => {
        return entry.key;
      }),
    ).toEqual([
      "update-check",
      "instance-check-in",
      "release-emails",
      "probe-dns",
    ]);
  });

  test("every outbound default the server config names is on the page", () => {
    /*
     * The addresses the server reaches unless a setting says otherwise. A new
     * one is a new connection out of every self-hosted install: put it on the
     * page (Utils/AirGapped.ts, AirGappedConnections), with what to do inside
     * an air gap, and add it here. Links into the docs are not calls.
     */
    const pageRowForAddress: Record<string, string> = {
      "api.github.com": "update-check",
      "oneuptime.com/api/notification/push-relay": "paging",
      "oneuptime.com": "enterprise-license",
    };
    const addresses: Array<string> = Array.from(
      repoFile(ENVIRONMENT_CONFIG).matchAll(QUOTED_HTTPS_ADDRESS),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(addresses.length).toBeGreaterThan(3);

    for (const address of addresses) {
      const url: URL = new URL(address);

      if (url.host === "oneuptime.com" && url.pathname.startsWith("/docs/")) {
        continue;
      }

      const key: string = url.pathname.startsWith(
        "/api/notification/push-relay",
      )
        ? `${url.host}/api/notification/push-relay`
        : url.host;
      const row: string | undefined = pageRowForAddress[key];

      expect([address, typeof row]).toEqual([address, "string"]);
      connection(row!);
    }
  });
});

describe("AI on a model the customer runs", () => {
  const llmProviders: string = docsPagePath("ai/llm-provider");

  test("Ollama and any OpenAI-compatible server are provider types", () => {
    expect(LlmType.Ollama).toBe("Ollama");
    expect(LlmType.OpenAICompatible).toBe("OpenAICompatible");
    expect(
      AirGappedAiOptions.map((option: { key: string }): string => {
        return option.key;
      }),
    ).toEqual(["ollama", "openai-compatible", "no-ai"]);
  });

  test("the OpenAI-compatible servers the page names are the ones the docs name", () => {
    expectFileToSay(
      llmProviders,
      "Any OpenAI-compatible server: vLLM, LocalAI, LM Studio and others",
    );
  });

  test("the provider settings shown are the docs' own Ollama example, and the server reads them", () => {
    for (const line of AIR_GAPPED_LLM_PROVIDER_ENV.split("\n")) {
      expectFileToSay(llmProviders, line);
    }

    expectFileToSay(
      "packages/App/FeatureSet/Workers/StartupMigrations/SeedGlobalLlmProviderFromEnv.ts",
      'process.env["GLOBAL_LLM_PROVIDER_TYPE"]',
    );
  });

  test("a global provider can be added in the Admin Dashboard, and every project uses it", () => {
    expectFileToSay(
      llmProviders,
      "in the Admin Dashboard under **Settings → Global LLM Providers**",
    );
    expectFileToSay(
      llmProviders,
      "AI features use the project's default provider. A project with no default provider uses the global provider",
    );
    expect(AirGappedAiSetup).toContain("Settings > Global LLM Providers");
  });

  test("with no provider, no AI feature runs", () => {
    expectFileToSay(
      llmProviders,
      "Nothing runs, and<br/>the AI pages say<br/>a provider is missing",
    );
  });

  test("the safety line is the governed claim, word for word", () => {
    expect(getClaim("encryption-secrets-redaction")!.statement).toContain(
      AirGappedAiSafety,
    );
  });
});

describe("compliance and data residency", () => {
  test("no monitoring data, telemetry or logs leave the install", () => {
    expectFileToSay(
      docsPagePath("self-hosted/enterprise"),
      "No monitoring data, telemetry, logs or configuration leave the install.",
    );
    expect(compliancePoint("residency")).toContain(
      "No monitoring data, telemetry or logs leave the install.",
    );
  });

  test("the keys line is the governed claim, word for word", () => {
    expect(compliancePoint("keys")).toBe(
      getClaim("encryption-self-hosted")!.statement,
    );
  });

  test("the accreditation line says what the claims matrix says about scope", () => {
    const iso: Claim = getClaim("compliance-iso-27001")!;
    const fedramp: Claim = getClaim("compliance-fedramp")!;
    const questionnaires: Claim = getClaim("contract-security-review")!;

    expect(iso.qualifier).toContain(
      "Certification covers OneUptime Cloud and the organisation that builds the platform, not a customer's self-hosted deployment.",
    );
    expect(fedramp.qualifier).toContain(
      "FedRAMP does not apply to self-hosted deployments, which fall under your own ATO.",
    );
    expect(questionnaires.statement).toContain(
      "We complete security questionnaires and share evidence",
    );
    expect(questionnaires.statement).toContain("under NDA");

    expect(compliancePoint("accreditation")).toContain(
      "OneUptime's certifications cover OneUptime Cloud and the company that builds it",
    );
    expect(compliancePoint("accreditation")).toContain(
      "we share evidence and complete security questionnaires under NDA",
    );
  });

  test("every release publishes CycloneDX SBOMs, and the images carry SPDX SBOMs and provenance", () => {
    expectFileToSay(RELEASE_WORKFLOW, "name: Generate CycloneDX SBOMs");
    expectFileToSay(RELEASE_WORKFLOW, "- name: Attach SBOMs to release");
    expectFileToSay(BUILD_IMAGES, "--sbom=true");
    expectFileToSay(BUILD_IMAGES, "--provenance=mode=max");
    expectFileToSay(BUILD_IMAGES, "The SBOM is SPDX 2.3.");
  });

  test("the page promises no certificate, customer count, percentage or authorization", () => {
    const text: string = JSON.stringify([
      AirGappedCapabilities,
      AirGappedCompliance,
      AirGappedFaqs,
      AirGappedConnections,
    ]);

    expect(text).not.toMatch(/\bcertified\b/i);
    expect(text).not.toMatch(/\d\s*%/);
    expect(text).not.toMatch(/\bcustomers\b/i);
    expect(text).not.toMatch(/FedRAMP/i);
  });
});

describe("the questions buyers ask", () => {
  test("Docker Compose names Docker Hub's images and pulls them when it updates", () => {
    expectFileToSay("docker-compose.yml", "image: oneuptime/app:${APP_TAG}");

    const scripts: Record<string, string> = JSON.parse(
      repoFile("package.json"),
    ).scripts;

    expectTextToSay(
      "npm run update",
      scripts["update"]!,
      "docker compose pull",
    );
    expect(scripts["start"]).not.toContain("docker compose pull");
    expect(faqAnswer("Can we run it with Docker Compose?")).toContain(
      "Docker Compose names its images as Docker Hub does and pulls them when it updates",
    );
  });

  test("the phone-home answer names every connection made by default", () => {
    const text: string = faqAnswer("Does OneUptime phone home?");

    expect(text).toContain("daily update check against GitHub's API");
    expect(text).toContain("updateCheck.disabled");
    expect(text).toContain("daily check-in");
    expect(text).toContain("instanceCheckIn.disabled");
    expect(text).toContain("release emails ticked");
    expect(text).toContain("offline license token never does");
  });

  test("the paging answer names Twilio and the push relay as what needs a route out", () => {
    const text: string = faqAnswer(
      "Can we page people without SMS, calls or push?",
    );

    expect(text).toContain("SMS and calls go through Twilio");
    expect(text).toContain("OneUptime's push relay or Expo");
  });
});

describe("the claims matrix agrees with the page", () => {
  test("the air-gapped claim lives on this page and names what still calls out", () => {
    const claim: Claim = getClaim("deployment-air-gapped")!;

    expect(claim.sourceUrl).toBe("/enterprise/air-gapped");
    expect(claim.qualifier).toContain("offline license token");
    expect(claim.qualifier).toContain("release emails");
    expect(claim.qualifier).toContain("SMS, calls and push");
  });

  test("nothing the page says points back at the self-hosted page's older wording", () => {
    // The update check never called oneuptime.com: it asks GitHub.
    expectFileNotToSay(
      "packages/Home/Utils/SelfHosted.ts",
      "makes no calls to oneuptime.com",
    );
    // OneUptime sends SMS through Twilio alone: there is no SMS gateway to point at.
    expectFileNotToSay("packages/Home/Utils/SelfHosted.ts", "SMS gateway");
  });
});
