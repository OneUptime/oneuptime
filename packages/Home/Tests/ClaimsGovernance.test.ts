import {
  RetiredClaim,
  RetiredClaims,
  RetiredEditionClaims,
} from "../Utils/Claims";
import fs from "fs";
import path from "path";

/*
 * Governance enforcement.
 *
 * The claims matrix is only worth something if the pages obey it. This suite
 * walks every template under Home/Views and fails when retired language
 * reappears — with the reason it was retired and the approved replacement, so
 * whoever trips it does not have to go digging.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");

interface ViewFile {
  relativePath: string;
  contents: string;
}

function collectViewFiles(directory: string): Array<ViewFile> {
  const files: Array<ViewFile> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectViewFiles(fullPath));
      continue;
    }

    if (!entry.name.endsWith(".ejs")) {
      continue;
    }

    files.push({
      relativePath: path.relative(VIEWS_ROOT, fullPath),
      contents: fs.readFileSync(fullPath, "utf-8"),
    });
  }

  return files;
}

const viewFiles: Array<ViewFile> = collectViewFiles(VIEWS_ROOT);

const UTILS_ROOT: string = path.join(__dirname, "..", "Utils");

/*
 * The Utils modules that carry page copy: comparison tables, the self-hosted
 * page's content, SEO descriptions and structured data. Claims.ts is left
 * out because it defines the retired patterns, and so quotes every one.
 */
function collectPageDataFiles(directory: string): Array<ViewFile> {
  return fs
    .readdirSync(directory)
    .filter((name: string) => {
      return name.endsWith(".ts") && name !== "Claims.ts";
    })
    .map((name: string): ViewFile => {
      return {
        relativePath: name,
        contents: fs.readFileSync(path.join(directory, name), "utf-8"),
      };
    });
}

const pageDataFiles: Array<ViewFile> = collectPageDataFiles(UTILS_ROOT);

interface Violation {
  file: string;
  line: number;
  text: string;
}

function findViolations(
  pattern: RegExp,
  files: Array<ViewFile> = viewFiles,
): Array<Violation> {
  const violations: Array<Violation> = [];

  for (const file of files) {
    const lines: Array<string> = file.contents.split("\n");

    lines.forEach((line: string, index: number) => {
      /*
       * Reset lastIndex defensively — a global flag on a shared regex would
       * otherwise make results depend on call order.
       */
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push({
          file: file.relativePath,
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }

  return violations;
}

function describeViolations(
  retired: RetiredClaim,
  violations: Array<Violation>,
  rootLabel: string = "Views",
): string {
  const locations: string = violations
    .map((violation: Violation) => {
      return `  - ${rootLabel}/${violation.file}:${violation.line}\n      ${violation.text}`;
    })
    .join("\n");

  return [
    "",
    `Retired claim language found: "${retired.example}"`,
    `Why it was retired: ${retired.reason}`,
    `Approved replacement: ${retired.replacement}`,
    `Governed by claim: ${retired.claimId} (see Home/Utils/Claims.ts)`,
    "Found in:",
    locations,
    "",
  ].join("\n");
}

describe("Claims governance over Home/Views", () => {
  test("the scanner actually found templates to scan", () => {
    expect(viewFiles.length).toBeGreaterThan(50);
  });

  test.each(
    RetiredClaims.map((retired: RetiredClaim) => {
      return [retired.example, retired] as [string, RetiredClaim];
    }),
  )(
    'no template uses retired language: "%s"',
    (_example: string, retired: RetiredClaim) => {
      const violations: Array<Violation> = findViolations(retired.pattern);

      if (violations.length > 0) {
        throw new Error(describeViolations(retired, violations));
      }

      expect(violations).toHaveLength(0);
    },
  );
});

describe("Edition claims governance over the Home/Utils page data", () => {
  test("the scanner found the modules that carry page copy, and skipped Claims.ts", () => {
    const names: Array<string> = pageDataFiles.map((file: ViewFile) => {
      return file.relativePath;
    });

    expect(names).toContain("ProductCompare.ts");
    expect(names).toContain("SelfHosted.ts");
    expect(names).toContain("PageSEO.ts");
    expect(names).not.toContain("Claims.ts");
  });

  test.each(
    RetiredEditionClaims.map((retired: RetiredClaim) => {
      return [retired.example, retired] as [string, RetiredClaim];
    }),
  )(
    'no page data uses retired edition language: "%s"',
    (_example: string, retired: RetiredClaim) => {
      const violations: Array<Violation> = findViolations(
        retired.pattern,
        pageDataFiles,
      );

      if (violations.length > 0) {
        throw new Error(describeViolations(retired, violations, "Utils"));
      }

      expect(violations).toHaveLength(0);
    },
  );
});

describe("Edition retired claims catch what the split made false", () => {
  /*
   * The exact sentences the Community / Enterprise split made false, as they
   * stood on the site before it. Each must still be caught, so none of them
   * can quietly come back.
   */
  const formerlyPublished: Array<string> = [
    "100% open source under Apache 2.0 - not open-core. Every line ships on GitHub, and the community edition is the full feature set.",
    "We're fully open-source, not open-core. Every line of code is on GitHub.",
    "That's why we built OneUptime as a fully open-source platform that combines monitoring, incident management, status pages, and on-call scheduling into one unified solution.",
    "<span>100% Open Source</span>",
    "The entire platform is Apache-2.0 licensed and developed in public on GitHub.",
    "The entire platform is open source on GitHub.",
    "Telemetry is priced per GB ingested, the whole thing is Apache-2.0 open source, and you can self-host the exact same product for free.",
    "The whole platform is Apache-2.0 open source, and you can self-host this exact product for free.",
    "OneUptime is fully open-source. Monitor your applications, manage incidents,",
    "Every product feature — the community edition is not feature-limited",
    "Same product as our cloud, no feature gates, no telemetry leaving your network.",
    "Hardened enterprise images",
    "Hardened Enterprise Edition container images",
    "No hardened Enterprise Edition images",
    "Enterprise agreements add hardened images, deployment support, and custom data residency",
    "Community and Enterprise run the same product. What the Enterprise Edition changes is the container image.",
    "Both editions are the same product. The difference is accountability.",
    "Self-host the entire Apache 2.0 platform for free with full data ownership, or use the managed cloud",
    "Self-host the entire OneUptime platform under Apache 2.0",
    "OneUptime is Apache 2.0 and the whole platform self-hosts for free, without operating Mimir, Loki, and Tempo as separate systems.",
    "Self-host the Apache 2.0 platform on your own infrastructure with the full feature set",
    "OneUptime is open source under Apache 2.0 and can be self-hosted on your own infrastructure with the full feature set, so you pay only for the compute you run.",
    // Comparison pages (Utils/ProductCompare.ts) and the pricing FAQ.
    "Checkly is a SaaS-only product with no open-source or self-host option. OneUptime is Apache 2.0 licensed and fully self-hostable for free, so you can run it on your own infrastructure, audit every line, and keep telemetry data in your environment, or use the managed cloud with predictable pricing.",
    "Yes. OneUptime is licensed under Apache 2.0 and can be fully self-hosted for free with complete data ownership, or used as a managed cloud service.",
    "You get predictable, flat pricing instead of a spreadsheet full of usage meters, and you can self-host the entire stack under Apache 2.0.",
    "Full platform available under a permissive license",
    "Yes. OneUptime is open source under the Apache 2.0 license and can be fully self-hosted for free with complete data ownership.",
    "Yes. OneUptime is licensed under the permissive Apache 2.0 license and can be fully self-hosted for free.",
    "Run the full platform yourself under an open license.",
    "Yes. OneUptime is Apache 2.0 licensed and fully self-hostable at no cost, just like Healthchecks.io's BSD-licensed code.",
    "Yes. OneUptime is licensed under Apache 2.0, so you can read the source, contribute, and self-host the full platform for free with no seat or subscriber caps. Instatus is a closed, hosted-only service.",
    "Yes. OneUptime is licensed under Apache 2.0 and is fully self-hostable at no license cost, just like Prometheus.",
    "Yes. OneUptime is Apache 2.0 open source and fully self-hostable at no license cost, just like Nagios Core.",
    "No. The software is open-source and free &mdash; self-host it for nothing, at any scale.",
    // Comparison rows, as they render: the title over the description.
    "Free self-hosting: Run the full platform on your own infra",
    "Self-hostable for free: Run the full platform on your own infra.",
    "Free to self-host: Run the full platform on your own infrastructure.",
    "Free self-hosting: Run the full product on your own infrastructure at no license cost.",
    // Comparison FAQs that put the Enterprise Edition features under the open-source license.
    "Yes. OneUptime supports SSO/SAML, RBAC, and audit logs, and maintains SOC 2 Type II, ISO 27001, and GDPR compliance, so it fits enterprise requirements while remaining open source and self-hostable.",
    "Enterprise features include SSO/SAML, role-based access control, audit logs, and data residency options. Self-hosting is available under the Apache 2.0 license for organizations requiring complete infrastructure control.",
  ];

  test.each(formerlyPublished)("catches: %s", (sentence: string) => {
    const caughtBy: Array<RetiredClaim> = RetiredEditionClaims.filter(
      (retired: RetiredClaim) => {
        return retired.pattern.test(sentence);
      },
    );

    expect(caughtBy.length).toBeGreaterThan(0);
  });

  /*
   * Comparison pages describe other products in the same Utils files. The
   * edition patterns must only catch statements about OneUptime.
   */
  const competitorCopy: Array<string> = [
    "Zabbix is a mature, fully open-source monitoring system built for infrastructure, network, and server metrics.",
    "Fully open source (GPL), no license fee",
    "SigNoz follows an open-core model - its core is permissively licensed.",
    "Sentry is source-available under the Functional Source License, not OSI open source at release.",
    "Open-core (ee module)",
    "Apache 2.0 license, fully self-hosted",
    "Free and open source, fully self-hosted",
    "It is free to self-host and highly customizable, with powerful triggers, templates, and auto-discovery.",
    "Grafana dashboards on top of Mimir, Loki, Tempo, and k6, with Grafana Cloud IRM bolted on for on-call and incidents.",
    "Keycloak is an open-source identity provider with SSO, SAML, and LDAP support, licensed under the Apache 2.0 license.",
  ];

  test.each(competitorCopy)(
    "leaves competitor copy alone: %s",
    (sentence: string) => {
      for (const retired of RetiredEditionClaims) {
        expect(retired.pattern.test(sentence)).toBe(false);
      }
    },
  );

  /*
   * Accurate OneUptime copy, including the rewrites of the sentences above.
   * The patterns have to leave all of it alone, or the next person to trip one
   * will narrow the copy until it says nothing.
   */
  const accurateCopy: Array<string> = [
    "OneUptime's Community Edition is Apache 2.0 licensed and free to self-host, so you can run it on your own infrastructure, audit every line, and keep telemetry data in your environment, or use the managed cloud with predictable pricing.",
    "Yes. OneUptime's Community Edition is licensed under Apache 2.0, so you can read the source, contribute, and self-host it for free with no seat or subscriber caps.",
    "You get predictable, flat pricing instead of a spreadsheet full of usage meters, and the Apache 2.0 Community Edition is free to self-host.",
    "Core platform under Apache 2.0; enterprise modules separately licensed",
    "Run the Apache 2.0 Community Edition yourself; enterprise modules are separately licensed.",
    "Free to self-host: Run the Apache 2.0 Community Edition on your own infrastructure.",
    "Self-hostable: Run the entire platform on your own infrastructure",
    "No. The Apache 2.0 Community Edition is free to self-host, at any scale.",
    "The entire platform's source code is public on GitHub.",
    "One chart deploys the whole platform — ingress, API, workers, probes, and databases",
    "OneUptime replaces the entire stack with one open-source platform where monitoring, on-call, incidents, and status pages already work together.",
    "OneUptime replaces that whole stack, which lowers engineering time and third-party subscriptions even if you self-host it for free.",
    "OneUptime delivers the entire stack in one platform, self-hosted free or on a predictable managed tier",
    "Self-hosted OneUptime under Apache 2.0 with monitoring, status, on-call, and incidents built in",
    "OneUptime is open source under Apache 2.0 and can be self-hosted for free, or run as managed cloud.",
    "Yes. OneUptime supports SSO/SAML, RBAC, and audit logs, and maintains SOC 2 Type II, ISO 27001, and GDPR compliance. The core platform, SAML and OIDC single sign-on included, is open source (Apache 2.0) and self-hostable; audit logs are part of the Enterprise Edition, licensed under the OneUptime Enterprise License.",
    "Enterprise features include SSO/SAML, role-based access control, audit logs, and data residency options. The Apache 2.0 Community Edition, SAML and OIDC single sign-on included, can be self-hosted for complete infrastructure control; self-hosted audit logs need the Enterprise Edition and an Enterprise license.",
    // Single sign-on is part of the Community Edition, so it may be called open source.
    "SAML and OIDC single sign-on are part of the Community Edition and remain open source under Apache 2.0.",
    "OneUptime supports SSO/SAML and RBAC while remaining open source.",
  ];

  test.each(accurateCopy)(
    "leaves accurate OneUptime copy alone: %s",
    (sentence: string) => {
      const caughtBy: Array<string> = RetiredEditionClaims.filter(
        (retired: RetiredClaim) => {
          return retired.pattern.test(sentence);
        },
      ).map((retired: RetiredClaim) => {
        return retired.example;
      });

      expect(caughtBy).toEqual([]);
    },
  );

  test("every edition claim is also enforced over the templates", () => {
    for (const retired of RetiredEditionClaims) {
      expect(RetiredClaims).toContain(retired);
    }
  });
});

describe("The single sign-on edition rule catches SSO filed under the Enterprise Edition", () => {
  /*
   * SAML and OIDC single sign-on, global SSO, and "Require SSO for login" are
   * part of the Apache 2.0 Community Edition and need no license. The
   * Enterprise Edition adds SCIM, audit logs, team compliance, and the
   * instance health dashboards.
   */
  const ssoRule: RetiredClaim = RetiredEditionClaims.find(
    (retired: RetiredClaim) => {
      return (
        retired.example ===
        "the Enterprise Edition adds SSO, SCIM, audit logs, team compliance, and instance health dashboards"
      );
    },
  )!;

  test("the rule exists", () => {
    expect(ssoRule).toBeDefined();
  });

  /*
   * Every sentence that filed single sign-on under the Enterprise Edition,
   * exactly as the site (templates, page data, and the claims matrix)
   * published it before single sign-on moved into the Community Edition.
   * Each one is caught by the single sign-on rule itself, not merely by some
   * rule, so none of them can quietly come back.
   */
  const formerlyPublished: Array<string> = [
    // The claims matrix.
    "The Community Edition is the core platform under Apache 2.0; the Enterprise Edition adds SSO, SCIM, audit logs, team compliance, and instance health dashboards under the OneUptime Enterprise License, plus a support agreement.",
    "Enterprise Edition images add SSO, SCIM, audit logs, team compliance, and instance health dashboards to the Community Edition, and are selected with a single chart value.",
    "Enterprise Edition images, which add SSO, SCIM, audit logs, team compliance, and instance health dashboards.",
    "SSO, SCIM, audit logs, team compliance, and instance health dashboards are Enterprise Edition features.",
    "The core platform is open source (Apache 2.0) and self-hostable; SSO/SAML and audit logs are part of the Enterprise Edition, licensed under the OneUptime Enterprise License.",
    // The self-hosted page (Utils/SelfHosted.ts) and its structured data.
    "We ship RBAC and API-key scoping in both editions, and SSO/SAML, SCIM, and audit logs in the Enterprise Edition.",
    "No SSO, SCIM, audit logs, team compliance, or instance health dashboards — those are Enterprise Edition features",
    "The Enterprise Edition image: SSO (SAML and OIDC), SCIM, audit logs, team compliance, and instance health dashboards",
    "The Community Edition is the full monitoring, incident, and observability platform under Apache 2.0 — monitoring, incidents, on-call, status pages, logs, metrics, traces, dashboards, and workflows. The Enterprise Edition adds identity and governance features — SAML and OIDC single sign-on, SCIM provisioning, audit logs, team compliance, and instance health dashboards — under the OneUptime Enterprise License, together with a commercial support agreement.",
    "Enterprise Edition images with SSO, SCIM, and audit logs",
    // Comparison pages (Utils/ProductCompare.ts).
    "Absolutely. OneUptime is built on distributed, high-availability infrastructure across multiple cloud regions. We are SOC 2 Type II certified, ISO 27001 compliant, and GDPR compliant. Enterprise features include SSO/SAML, role-based access control, audit logs, and data residency options. The Apache 2.0 Community Edition can be self-hosted for complete infrastructure control; self-hosted SSO/SAML and audit logs need the Enterprise Edition and an Enterprise license.",
    "Both are open source and self-hostable, and both follow an open-core model: the core is permissively licensed while an enterprise (ee) module is under a separate commercial license. SigNoz focuses on observability data. OneUptime's Apache 2.0 Community Edition covers the whole incident lifecycle - monitoring, on-call, incidents, status pages, and telemetry - and its enterprise module adds SSO, SCIM, audit logs, and instance administration. They solve related but different problems.",
    "Yes. OneUptime supports SSO/SAML, RBAC, and audit logs, and maintains SOC 2 Type II, ISO 27001, and GDPR compliance. The core platform is open source (Apache 2.0) and self-hostable; SSO/SAML and audit logs are part of the Enterprise Edition, licensed under the OneUptime Enterprise License.",
    // Templates.
    "Open source under Apache 2.0, with enterprise features like SSO and audit logs in a separately licensed ee/ directory. Every line ships on GitHub, and the Community Edition is the whole monitoring, incident, and observability platform. Run our cloud, or run it yourself - either way, you're never locked in.",
    "Yes. OneUptime is open source and deploys on your own infrastructure with our Helm chart on Kubernetes, or with Docker Compose on a single host. It runs air-gapped, with images mirrored to your registry and the update check disabled. Enterprise agreements add the Enterprise Edition (SSO, SCIM, audit logs, and instance health dashboards), deployment support, and custom data residency &mdash; and a private cloud option if you want a single-tenant environment you do not operate yourself.",
    // The same claim in other words.
    "Single sign-on is an Enterprise Edition feature.",
    "SAML SSO is Enterprise Edition only.",
    "OpenID Connect sign-in needs the OneUptime Enterprise Edition.",
    "Self-hosted SSO requires an Enterprise license.",
    "The Enterprise Edition includes SAML and OIDC single sign-on.",
  ];

  test.each(formerlyPublished)("catches: %s", (sentence: string) => {
    expect(ssoRule.pattern.test(sentence)).toBe(true);
  });

  /*
   * What the site says now, OneUptime Cloud's plan copy (SSO on the Scale
   * plan is a plan, not an edition), enterprise as an adjective, and
   * competitors' single sign-on. No edition rule may catch any of it.
   */
  const leftAlone: Array<string> = [
    // What the site says now.
    "The Community Edition is the core platform under Apache 2.0, SAML and OIDC single sign-on included; the Enterprise Edition adds SCIM, audit logs, team compliance, and instance health dashboards under the OneUptime Enterprise License, plus a support agreement.",
    "Enterprise Edition images add SCIM, audit logs, team compliance, and instance health dashboards to the Community Edition, and are selected with a single chart value.",
    "SAML and OIDC single sign-on are part of the Apache 2.0 Community Edition; the Enterprise Edition adds SCIM, audit logs, team compliance, and instance health dashboards.",
    "We ship RBAC, API-key scoping, and SAML and OIDC single sign-on in both editions, and SCIM and audit logs in the Enterprise Edition.",
    "SAML and OpenID Connect single sign-on for projects, private status pages, and the whole instance",
    "No SCIM, audit logs, team compliance, or instance health dashboards — those are Enterprise Edition features",
    "The Enterprise Edition image: SCIM, audit logs, team compliance, and instance health dashboards",
    "The Community Edition is the full monitoring, incident, and observability platform under Apache 2.0 — monitoring, incidents, on-call, status pages, logs, metrics, traces, dashboards, and workflows, with SAML and OIDC single sign-on. The Enterprise Edition adds identity and governance features — SCIM provisioning, audit logs, team compliance, and instance health dashboards — under the OneUptime Enterprise License, together with a commercial support agreement.",
    "SAML and OpenID Connect single sign-on in both editions",
    "Enterprise Edition images with SCIM, audit logs, and team compliance",
    "OneUptime's Apache 2.0 Community Edition covers the whole incident lifecycle - monitoring, on-call, incidents, status pages, and telemetry - along with SAML and OIDC single sign-on, and its enterprise module adds SCIM, audit logs, and instance administration.",
    "Open source under Apache 2.0, with enterprise features like SCIM and audit logs in a separately licensed ee/ directory.",
    "Enterprise agreements add the Enterprise Edition (SCIM, audit logs, team compliance, and instance health dashboards), deployment support, and custom data residency &mdash; and a private cloud option if you want a single-tenant environment you do not operate yourself.",
    "SAML and OIDC single sign-on are part of every self-hosted edition, including the free Community Edition; SCIM needs the Enterprise Edition, and on OneUptime Cloud both are on the Scale plan and above.",
    "The Community Edition is the core platform under Apache 2.0, SAML and OpenID Connect single sign-on included. The Enterprise Edition image adds the enterprise modules from the repository's ee/ directory",
    "SSO in every edition",
    "Enterprise SCIM &amp; audit logs",
    "Community Edition; Scale plan on Cloud",
    "The Enterprise Edition adds SCIM and audit logs, while single sign-on ships in every edition.",
    // OneUptime Cloud: SSO on the Scale plan.
    "Single sign-on (SSO) and SCIM provisioning on eligible plans.",
    "SSO, Advanced Access Control, Better Support for your team.",
    "SSO, OIDC, SCIM and team compliance on the Scale plan and above, and audit logs on the Enterprise plan.",
    "SAML 2.0 and OpenID Connect SSO. SCIM 2.0 user provisioning. MFA enforceable at tenant level (TOTP, WebAuthn).",
    // Enterprise as an adjective.
    "Enterprise SSO with SAML/OIDC. Fine-grained role-based access controls.",
    "SOC 2 Type II, ISO 27001, HIPAA, and GDPR compliant. SSO, SAML, SCIM, custom data residency, and dedicated support.",
    "OneUptime for enterprise. Self-hosted deployment, SSO/SAML, advanced security, SLA guarantees, dedicated support. SOC 2, HIPAA, GDPR compliant.",
    "Enterprise features include SSO/SAML, role-based access control, audit logs, and data residency options.",
    // Competitors.
    "White-label, password, SSO at $208-250/page",
    "Team roles and SAML SSO ($5/user)",
    "SSO/SAML and advanced security on higher tiers",
    "Instatus jumps from $20 to $300 per month for more monitors and SSO. OneUptime charges a flat $1 per active monitor with unlimited free static monitors and no subscriber caps.",
    "Keycloak is an open-source identity provider with SSO, SAML, and LDAP support, licensed under the Apache 2.0 license.",
  ];

  test.each(leftAlone)("leaves alone: %s", (sentence: string) => {
    const caughtBy: Array<string> = RetiredEditionClaims.filter(
      (retired: RetiredClaim) => {
        return retired.pattern.test(sentence);
      },
    ).map((retired: RetiredClaim) => {
      return retired.example;
    });

    expect(caughtBy).toEqual([]);
  });

  test("the scan reports single sign-on filed under the Enterprise Edition when it is put back into a template, with the file and line", () => {
    const planted: Array<ViewFile> = [
      {
        relativePath: "Partials/home-own-it.ejs",
        contents: [
          '<p class="mt-6">',
          "  Open source under Apache 2.0, with enterprise features like SSO and audit logs in a separately licensed ee/ directory.",
          "</p>",
        ].join("\n"),
      },
    ];

    expect(findViolations(ssoRule.pattern, planted)).toEqual([
      {
        file: "Partials/home-own-it.ejs",
        line: 2,
        text: "Open source under Apache 2.0, with enterprise features like SSO and audit logs in a separately licensed ee/ directory.",
      },
    ]);
  });
});

describe("Pages state the edition split accurately", () => {
  function readView(relativePath: string): string {
    return fs.readFileSync(path.join(VIEWS_ROOT, relativePath), "utf-8");
  }

  test("the home page's open-source section names the separately licensed ee/ directory", () => {
    const contents: string = readView("Partials/home-own-it.ejs");

    expect(contents).toContain("Open source under Apache 2.0");
    expect(contents).toContain("separately licensed ee/ directory");
  });

  test("the about page says the core is Apache 2.0 and the enterprise modules are on GitHub too", () => {
    const contents: string = readView("about.ejs");

    expect(contents).toContain(
      "The core platform is open source under Apache 2.0",
    );
    expect(contents).toContain(
      "including the enterprise modules, is on GitHub",
    );
  });

  test("the trust center still promises the whole source is auditable", () => {
    expect(readView("trust.ejs")).toContain(
      "The entire platform's source code is public on",
    );
  });

  test("the pricing FAQ says which edition is free to self-host", () => {
    const contents: string = readView("pricing.ejs");

    expect(contents).toContain(
      "The Apache 2.0 Community Edition is free to self-host, at any scale.",
    );
    expect(contents).not.toContain("The software is open-source and free");
  });

  test("the demo FAQ names what the Enterprise Edition adds", () => {
    expect(readView("demo.ejs")).toContain(
      "Enterprise agreements add the Enterprise Edition (SCIM, audit logs, team compliance, and instance health dashboards)",
    );
  });

  test("the home page's open-source section names SCIM and audit logs, not single sign-on, as the enterprise features", () => {
    const contents: string = readView("Partials/home-own-it.ejs");

    expect(contents).toContain(
      "with enterprise features like SCIM and audit logs in a separately licensed ee/ directory",
    );
    expect(contents).not.toContain("enterprise features like SSO");
  });

  test("the self-hosted hero says single sign-on is in every edition, and SCIM and audit logs are Enterprise", () => {
    const contents: string = readView("self-hosted.ejs");

    expect(contents).toContain("<span>SSO in every edition</span>");
    expect(contents).toContain("<span>Enterprise SCIM &amp; audit logs</span>");
    expect(contents).not.toContain("Enterprise SSO");
  });

  test("the self-hosted Enterprise Edition section puts single sign-on in the Community Edition", () => {
    const contents: string = readView("self-hosted.ejs").replace(/\s+/g, " ");

    expect(contents).toContain(
      "The Community Edition is the core platform under Apache 2.0, SAML and OpenID Connect single sign-on included. The Enterprise Edition image adds the enterprise modules from the repository's ee/ directory",
    );
  });

  test("the demo SSO FAQ says where single sign-on and SCIM are, self-hosted and on Cloud", () => {
    expect(readView("demo.ejs")).toContain(
      "SAML and OIDC single sign-on are part of every self-hosted edition, including the free Community Edition; SCIM needs the Enterprise Edition, and on OneUptime Cloud both are on the Scale plan and above.",
    );
  });
});

describe("Aligned pages state the governed numbers", () => {
  function readView(relativePath: string): string {
    return fs.readFileSync(path.join(VIEWS_ROOT, relativePath), "utf-8");
  }

  test("the enterprise overview quotes the SLA's Enterprise target", () => {
    const contents: string = readView("enterprise-overview.ejs");

    expect(contents).toContain("99.95%");
    expect(contents).toContain("/legal/sla");
  });

  test("the pricing page does not advertise an SLA on the free plan", () => {
    const contents: string = readView("pricing.ejs");

    expect(contents).toContain("No uptime SLA (best effort)");
    expect(contents).not.toContain("99.00% SLA");
  });

  test("the pricing page states paid uptime as a 99.9% target", () => {
    const contents: string = readView("pricing.ejs");

    expect(contents).toContain("99.9% uptime target");
    expect(contents).not.toContain("99.95% SLA");
  });

  /*
   * Paid plans are priced per user per month. Pages may say there is no cap
   * on team members, but not that members come free.
   */
  test("the enterprise overview does not sell team members as free", () => {
    const contents: string = readView("enterprise-overview.ejs");

    expect(contents).not.toContain("Unlimited team members");
    expect(contents).toContain("No cap on team members");
    expect(contents).toContain("Plans are priced per user");
  });

  test("the pricing comparison prices a team of 10 with seats", () => {
    const contents: string = readView("pricing-compare.ejs");

    expect(contents).toContain("10 users on Growth at $22/user");
    expect(contents).not.toContain("/mo to start");
  });

  test.each([
    ["product-compare.ejs", "per-seat"],
    ["observability.ejs", "not per seat"],
    ["security-events.ejs", "no per-seat analyst license"],
  ])("%s does not deny per-seat pricing", (file: string, retired: string) => {
    expect(readView(file)).not.toContain(retired);
  });

  test("the data residency page names Amazon Web Services", () => {
    const contents: string = readView("data-residency.ejs");

    expect(contents).toContain("Amazon Web Services");
    expect(contents).not.toContain("Aamazon");
  });

  test("the demo page points self-hosting buyers at the canonical page", () => {
    expect(readView("demo.ejs")).toContain("/enterprise/self-hosted");
  });

  test("the demo page separates certified, attested, and contractual claims", () => {
    const contents: string = readView("demo.ejs");

    expect(contents).toContain("CSA STAR Level 2 are certified");
    expect(contents).toContain("attested by third-party auditors");
    expect(contents).toContain("backed by a DPA or BAA");
    expect(contents).toContain("/trust#claims");
  });

  test("the security page points at the canonical trust center", () => {
    const contents: string = readView("security.ejs");

    expect(contents).toContain("/trust#claims");
    expect(contents).toContain("Trust Center");
  });

  test("the security page no longer calls internal targets an SLA", () => {
    const contents: string = readView("security.ejs");

    expect(contents).not.toContain("industry-standard SLAs");
    expect(contents).toContain("internal remediation targets");
  });

  test("the trust center renders the governed claims matrix", () => {
    const contents: string = readView("trust.ejs");

    expect(contents).toContain("./Partials/claims-matrix");
    expect(contents).toContain('href="#claims"');
  });

  test("the claims matrix partial reads from the Claims util, not hard-coded copy", () => {
    const contents: string = readView("Partials/claims-matrix.ejs");

    expect(contents).toContain("claimsMatrix.forEach");
    expect(contents).toContain("claimStatuses.forEach");
    expect(contents).toContain("claim.statement");
    expect(contents).toContain("claim.qualifier");
    expect(contents).toContain("claim.evidence");
  });

  test("the self-hosted page links back to the claims matrix", () => {
    expect(readView("self-hosted.ejs")).toContain("/trust#claims");
  });
});

describe("Compliance pages use the governed status words", () => {
  function readView(relativePath: string): string {
    return fs.readFileSync(path.join(VIEWS_ROOT, relativePath), "utf-8");
  }

  test.each([["21-cfr-part-11.ejs"], ["annex-11.ejs"], ["gamp-5.ejs"]])(
    "%s states an aligned status and links to the matrix",
    (file: string) => {
      const contents: string = readView(file);

      expect(contents).toContain("<strong>aligned</strong>");
      expect(contents).toContain("/trust#claims");
    },
  );

  test("the CSA STAR page states Level 2 certification, and which level it is", () => {
    const contents: string = readView("csa-star.ejs");

    expect(contents).toContain("<strong>certified</strong>");
    expect(contents).toContain("STAR Level 2");
    expect(contents).toContain("/trust#claims");
    // The distinction between the levels has to stay on the page.
    expect(contents).toContain("third-party assessor");
  });

  test("the PCI page offers an Attestation of Compliance, not a certificate", () => {
    const contents: string = readView("pci.ejs");

    expect(contents).toContain("Attestation of Compliance");
    expect(contents).toContain("Qualified Security Assessor");
    expect(contents).toContain("/trust#claims");
    expect(contents).not.toContain("To request the certificate please");
  });

  test("the ISO 27017 page explains it extends the ISO 27001 certificate", () => {
    const contents: string = readView("iso-27017.ejs");

    expect(contents).toContain("extension of our ISO/IEC 27001 certification");
  });

  test("the trust center badges use the governed status words", () => {
    const contents: string = readView("trust.ejs");

    for (const label of [
      ">Certified</span>",
      ">Attested</span>",
      ">Compliant</span>",
      ">Aligned</span>",
      ">In progress</span>",
    ]) {
      expect(contents).toContain(label);
    }

    // Words that are not in the vocabulary must not appear as a status badge.
    for (const stale of [
      ">Available</span>",
      ">CAIQ on file</span>",
      ">BAA available</span>",
    ]) {
      expect(contents).not.toContain(stale);
    }
  });
});
