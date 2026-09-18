import {
  AirGapStep,
  AirGapSteps,
  ArchitectureComponent,
  ArchitectureTier,
  ArchitectureTiers,
  AvailabilityControls,
  DeploymentModel,
  DeploymentModels,
  DisasterRecoveryPractices,
  EnterpriseEditionFeatures,
  HelmDocs,
  InfrastructureRequirements,
  RequirementGroup,
  ResilienceControl,
  ResponsibilityRow,
  SecurityHardeningFeatures,
  SelfHostedContent,
  SelfHostedFaq,
  SelfHostedFaqs,
  SharedResponsibilities,
  SizingTier,
  SizingTiers,
  SupportBoundaries,
  SupportTierRow,
  UpgradeResponsibilities,
  getSelfHostedContent,
} from "../Utils/SelfHosted";
import PageSEOConfig, { PageSEOData } from "../Utils/PageSEO";

describe("SelfHosted content model", () => {
  test("covers every deployment model an enterprise buyer will ask about", () => {
    const keys: Array<string> = DeploymentModels.map(
      (model: DeploymentModel) => {
        return model.key;
      },
    );

    expect(keys).toEqual([
      "kubernetes",
      "docker-compose",
      "private-cloud",
      "cloud",
    ]);
  });

  test("exactly one deployment model is recommended, and it is Kubernetes", () => {
    const recommended: Array<DeploymentModel> = DeploymentModels.filter(
      (model: DeploymentModel) => {
        return model.recommended;
      },
    );

    expect(recommended).toHaveLength(1);
    expect(recommended[0]!.key).toBe("kubernetes");
  });

  test("every deployment model states who owns infrastructure and upgrades", () => {
    for (const model of DeploymentModels) {
      expect(model.name.length).toBeGreaterThan(0);
      expect(model.tagline.length).toBeGreaterThan(0);
      expect(model.bestFor.length).toBeGreaterThan(0);
      expect(model.infrastructure.length).toBeGreaterThan(0);
      expect(model.upgrades.length).toBeGreaterThan(0);
      expect(model.highlights.length).toBeGreaterThanOrEqual(3);
      expect(model.docsUrl.length).toBeGreaterThan(0);
    }
  });

  test("the docker-compose model is honest about not being production-grade", () => {
    const compose: DeploymentModel | undefined = DeploymentModels.find(
      (model: DeploymentModel) => {
        return model.key === "docker-compose";
      },
    );

    expect(compose).toBeDefined();
    expect(compose!.recommended).toBe(false);
    expect(compose!.highlights.join(" ")).toContain(
      "Not recommended for production",
    );
  });

  test("the reference architecture covers edge, application, data, and ingest", () => {
    const keys: Array<string> = ArchitectureTiers.map(
      (tier: ArchitectureTier) => {
        return tier.key;
      },
    );

    expect(keys).toEqual(["edge", "application", "data", "ingest"]);
  });

  test("every architecture component describes how it scales", () => {
    for (const tier of ArchitectureTiers) {
      expect(tier.components.length).toBeGreaterThan(0);
      for (const component of tier.components) {
        expect(component.name.length).toBeGreaterThan(0);
        expect(component.description.length).toBeGreaterThan(0);
        expect(component.scaling.length).toBeGreaterThan(0);
      }
    }
  });

  test("the architecture names the tiers the Helm chart actually deploys", () => {
    const componentNames: string = ArchitectureTiers.flatMap(
      (tier: ArchitectureTier) => {
        return tier.components.map((component: ArchitectureComponent) => {
          return component.name;
        });
      },
    ).join(" | ");

    expect(componentNames).toContain("Worker");
    expect(componentNames).toContain("Telemetry writer");
    expect(componentNames).toContain("Probes");
    expect(componentNames).toContain("PostgreSQL");
    expect(componentNames).toContain("ClickHouse");
    expect(componentNames).toContain("Valkey");
    expect(componentNames).toContain("PgBouncer");
  });

  test("the agents component lists every infrastructure agent that ships", () => {
    /*
     * The ingest tier's "Agents" component is the one sentence on the
     * self-hosted page that tells a buyer which infrastructure products report
     * into their own instance. A product with an agent directory in the repo
     * but no mention here reads as "cloud only".
     */
    const agents: ArchitectureComponent | undefined = ArchitectureTiers.flatMap(
      (tier: ArchitectureTier) => {
        return tier.components;
      },
    ).find((component: ArchitectureComponent) => {
      return component.name === "Agents";
    });

    expect(agents).toBeDefined();
    for (const product of [
      "Docker",
      "Docker Swarm",
      "Podman",
      "Proxmox",
      "VMware",
      "Kubernetes",
      "Ceph",
    ]) {
      expect(agents!.description).toContain(product);
    }
  });

  test("sizing tiers go from evaluation to scale and each is fully specified", () => {
    expect(
      SizingTiers.map((tier: SizingTier) => {
        return tier.key;
      }),
    ).toEqual(["evaluation", "production", "scale"]);

    for (const tier of SizingTiers) {
      expect(tier.workload.length).toBeGreaterThan(0);
      expect(tier.nodes.length).toBeGreaterThan(0);
      expect(tier.cpu.length).toBeGreaterThan(0);
      expect(tier.memory.length).toBeGreaterThan(0);
      expect(tier.storage.length).toBeGreaterThan(0);
      expect(tier.notes.length).toBeGreaterThan(0);
    }
  });

  test("infrastructure requirements cover kubernetes, networking, and data stores", () => {
    const titles: Array<string> = InfrastructureRequirements.map(
      (group: RequirementGroup) => {
        return group.title;
      },
    );

    expect(titles).toContain("Kubernetes");
    expect(titles).toContain("Networking");
    expect(titles).toContain("Data stores");

    for (const group of InfrastructureRequirements) {
      expect(group.items.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("availability controls point at real chart settings", () => {
    expect(AvailabilityControls.length).toBeGreaterThanOrEqual(5);

    const settings: string = AvailabilityControls.map(
      (control: ResilienceControl) => {
        return control.setting;
      },
    ).join(" ");

    expect(settings).toContain("postgresOperator.cnpg.enabled");
    expect(settings).toContain("clickhouseOperator.altinity.enabled");
    expect(settings).toContain("podDisruptionBudget.enabled");
    expect(settings).toContain("pgbouncer.enabled");
  });

  test("disaster recovery guidance tells the customer the RTO and RPO are theirs", () => {
    const text: string = DisasterRecoveryPractices.join(" ");
    expect(text).toContain("RTO");
    expect(text).toContain("RPO");
    expect(text).toContain("Test restores");
  });

  test("air-gap steps cover registry, update check, DNS, and upgrades", () => {
    const settings: string = AirGapSteps.map((step: AirGapStep) => {
      return `${step.title} ${step.setting}`;
    }).join(" ");

    expect(settings).toContain("image.registry");
    expect(settings).toContain("updateCheck.disabled");
    expect(settings).toContain("dnsConfig");
    expect(settings).toContain("helm upgrade");
  });

  test("Enterprise Edition guidance names the chart value and the compose tag", () => {
    const text: string = EnterpriseEditionFeatures.join(" ");

    expect(text).toContain("image.type: enterprise-edition");
    expect(text).toContain("APP_TAG=enterprise-release");
  });

  test("Enterprise Edition guidance lists what the ee/ modules add", () => {
    const text: string = EnterpriseEditionFeatures.join(" ");

    for (const feature of [
      "SAML",
      "OpenID Connect",
      "SCIM",
      "Audit logs",
      "team compliance",
      "health dashboards",
      "query console",
    ]) {
      expect(text).toContain(feature);
    }
  });

  test("Enterprise Edition guidance states that production use needs a license", () => {
    expect(EnterpriseEditionFeatures.join(" ")).toContain(
      "OneUptime Enterprise License",
    );
  });

  test("no self-hosted copy calls the Enterprise Edition images hardened", () => {
    /*
     * The Enterprise image is the Community image plus ee/. Hardening comes
     * from the chart and applies to both editions.
     */
    const text: string = [
      ...EnterpriseEditionFeatures,
      ...SupportBoundaries.flatMap((tier: SupportTierRow) => {
        return [tier.description, ...tier.included, ...tier.excluded];
      }),
      ...SelfHostedFaqs.map((faq: SelfHostedFaq) => {
        return faq.answer;
      }),
    ].join(" ");

    expect(text).not.toMatch(/hardened/i);
  });

  test("the chart hardening controls are not attributed to one edition", () => {
    expect(SecurityHardeningFeatures.length).toBeGreaterThanOrEqual(4);

    const text: string = SecurityHardeningFeatures.join(" ");

    expect(text).toContain("RuntimeDefault seccomp");
    expect(text).toContain("Non-root");
    expect(text).not.toMatch(/enterprise/i);
  });

  test("the edition lists do not overlap", () => {
    for (const feature of EnterpriseEditionFeatures) {
      expect(SecurityHardeningFeatures).not.toContain(feature);
    }
  });

  test("upgrade responsibilities split every area between us and the customer", () => {
    expect(UpgradeResponsibilities.length).toBeGreaterThanOrEqual(4);

    for (const row of UpgradeResponsibilities) {
      expect(row.area.length).toBeGreaterThan(0);
      expect(row.oneuptime.length).toBeGreaterThan(0);
      expect(row.customer.length).toBeGreaterThan(0);
    }

    const areas: Array<string> = UpgradeResponsibilities.map(
      (row: ResponsibilityRow) => {
        return row.area;
      },
    );
    expect(areas).toContain("Breaking changes");
    expect(areas).toContain("Database migrations");
    expect(areas).toContain("Rollback");
  });

  test("shared responsibility covers infrastructure, availability, and compliance", () => {
    const areas: Array<string> = SharedResponsibilities.map(
      (row: ResponsibilityRow) => {
        return row.area;
      },
    );

    expect(areas).toContain("Infrastructure");
    expect(areas).toContain("Availability");
    expect(areas).toContain("Compliance");
  });

  test("support boundaries state what is NOT included, not just what is", () => {
    expect(
      SupportBoundaries.map((tier: SupportTierRow) => {
        return tier.key;
      }),
    ).toEqual(["community", "enterprise"]);

    for (const tier of SupportBoundaries) {
      expect(tier.included.length).toBeGreaterThanOrEqual(3);
      expect(tier.excluded.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("enterprise support explicitly excludes the cloud SLA from self-hosted uptime", () => {
    const enterprise: SupportTierRow | undefined = SupportBoundaries.find(
      (tier: SupportTierRow) => {
        return tier.key === "enterprise";
      },
    );

    expect(enterprise).toBeDefined();
    expect(enterprise!.excluded.join(" ")).toContain(
      "not covered by the OneUptime Cloud SLA",
    );
  });

  test("the community tier no longer claims every feature, and names what it lacks", () => {
    const community: SupportTierRow | undefined = SupportBoundaries.find(
      (tier: SupportTierRow) => {
        return tier.key === "community";
      },
    );

    expect(community).toBeDefined();

    const included: string = community!.included.join(" ");
    const excluded: string = community!.excluded.join(" ");

    expect(`${community!.description} ${included}`).not.toMatch(
      /feature-limited|every product feature|full platform/i,
    );
    expect(community!.description).toContain("Apache-2.0");

    for (const enterpriseOnly of [
      "SSO",
      "SCIM",
      "audit logs",
      "team compliance",
      "instance health dashboards",
    ]) {
      expect(excluded).toContain(enterpriseOnly);
    }
  });

  test("the enterprise tier names the features the Enterprise Edition image adds", () => {
    const enterprise: SupportTierRow | undefined = SupportBoundaries.find(
      (tier: SupportTierRow) => {
        return tier.key === "enterprise";
      },
    );

    expect(enterprise).toBeDefined();

    const included: string = enterprise!.included.join(" ");

    expect(included).toContain("Enterprise Edition image");
    expect(included).toContain("SSO");
    expect(included).toContain("SCIM");
    expect(included).toContain("audit logs");
    expect(enterprise!.description).toContain("Community Edition plus");
  });

  test("the edition FAQ names the enterprise features and their license", () => {
    const editionFaq: SelfHostedFaq | undefined = SelfHostedFaqs.find(
      (faq: SelfHostedFaq) => {
        return faq.question.includes("feature-limited");
      },
    );

    expect(editionFaq).toBeDefined();
    expect(editionFaq!.answer).not.toMatch(/^No\./);
    expect(editionFaq!.answer).toContain("Community Edition");
    expect(editionFaq!.answer).toContain("Apache 2.0");
    expect(editionFaq!.answer).toContain("OneUptime Enterprise License");
    expect(editionFaq!.answer).toContain("SCIM");
    expect(editionFaq!.answer).toContain("audit logs");
  });

  test("the phone-home FAQ discloses the Enterprise license check and what it sends", () => {
    const phoneHomeFaq: SelfHostedFaq | undefined = SelfHostedFaqs.find(
      (faq: SelfHostedFaq) => {
        return faq.question.includes("phone home");
      },
    );

    expect(phoneHomeFaq).toBeDefined();

    const answer: string = phoneHomeFaq!.answer;

    expect(answer).toContain("version check");
    expect(answer).toContain("Enterprise Edition");
    expect(answer).toContain("hashed user emails");
    expect(answer).toContain("master-admin contact emails");
    expect(answer).toContain("never monitoring data");
    // The "no connectivity at all" promise is scoped to the Community Edition.
    expect(answer).not.toMatch(/(?<!Community Edition )install runs with no connectivity/);
  });

  test("the update-check air-gap step mentions the Enterprise license check", () => {
    const updateCheck: AirGapStep | undefined = AirGapSteps.find(
      (step: AirGapStep) => {
        return step.setting === "updateCheck.disabled";
      },
    );

    expect(updateCheck).toBeDefined();
    expect(updateCheck!.description).toContain("Community Edition");
    expect(updateCheck!.description).toContain("offline license token");
  });

  test("shared responsibility puts SSO, SCIM, and audit logs in the Enterprise Edition", () => {
    const accessControl: ResponsibilityRow | undefined =
      SharedResponsibilities.find((row: ResponsibilityRow) => {
        return row.area === "Access control";
      });

    expect(accessControl).toBeDefined();
    expect(accessControl!.oneuptime).toContain(
      "SSO/SAML, SCIM, and audit logs in the Enterprise Edition",
    );
  });

  test("the FAQ answers the uptime-responsibility question directly", () => {
    const uptimeFaq: SelfHostedFaq | undefined = SelfHostedFaqs.find(
      (faq: SelfHostedFaq) => {
        return faq.question.includes("responsible for uptime");
      },
    );

    expect(uptimeFaq).toBeDefined();
    expect(uptimeFaq!.answer).toContain("You are.");
  });

  test("the FAQ describes what an architecture assessment covers", () => {
    const assessmentFaq: SelfHostedFaq | undefined = SelfHostedFaqs.find(
      (faq: SelfHostedFaq) => {
        return faq.question.includes("architecture assessment");
      },
    );

    expect(assessmentFaq).toBeDefined();
    expect(assessmentFaq!.answer.length).toBeGreaterThan(80);
  });

  test("every helm doc link points at the oneuptime repository", () => {
    for (const url of Object.values(HelmDocs)) {
      expect(url).toMatch(/^https:\/\/github\.com\/OneUptime\/oneuptime/);
    }
  });

  test("getSelfHostedContent returns every section the page renders", () => {
    const content: SelfHostedContent = getSelfHostedContent();

    expect(content.deploymentModels).toBe(DeploymentModels);
    expect(content.architectureTiers).toBe(ArchitectureTiers);
    expect(content.sizingTiers).toBe(SizingTiers);
    expect(content.infrastructureRequirements).toBe(InfrastructureRequirements);
    expect(content.availabilityControls).toBe(AvailabilityControls);
    expect(content.disasterRecoveryPractices).toBe(DisasterRecoveryPractices);
    expect(content.airGapSteps).toBe(AirGapSteps);
    expect(content.enterpriseEditionFeatures).toBe(EnterpriseEditionFeatures);
    expect(content.securityHardeningFeatures).toBe(SecurityHardeningFeatures);
    expect(content.upgradeResponsibilities).toBe(UpgradeResponsibilities);
    expect(content.sharedResponsibilities).toBe(SharedResponsibilities);
    expect(content.supportBoundaries).toBe(SupportBoundaries);
    expect(content.faqs).toBe(SelfHostedFaqs);
    expect(content.helmDocs).toBe(HelmDocs);
  });
});

describe("SelfHosted page SEO", () => {
  test("the canonical self-hosted route is registered for SEO and markdown", () => {
    const seo: PageSEOData | undefined =
      PageSEOConfig["/enterprise/self-hosted"];

    expect(seo).toBeDefined();
    expect(seo!.canonicalPath).toBe("/enterprise/self-hosted");
    expect(seo!.pageType).toBe("enterprise");
  });

  test("the title and description carry the terms buyers search for", () => {
    const seo: PageSEOData = PageSEOConfig["/enterprise/self-hosted"]!;

    expect(seo.title.toLowerCase()).toContain("self-hosted");
    expect(seo.description.toLowerCase()).toContain("kubernetes");
    expect(seo.description.toLowerCase()).toContain("air-gapped");
    expect(seo.description.toLowerCase()).toContain("data residency");
  });

  test("breadcrumbs place the page under Enterprise", () => {
    const seo: PageSEOData = PageSEOConfig["/enterprise/self-hosted"]!;

    expect(
      seo.breadcrumbs.map((crumb: { name: string }) => {
        return crumb.name;
      }),
    ).toEqual(["Home", "Enterprise", "Self-Hosted"]);
  });

  test("the structured data lists the deployment capabilities buyers evaluate", () => {
    const features: Array<string> =
      PageSEOConfig["/enterprise/self-hosted"]!.softwareApplication!.features;
    const joined: string = features.join(" ").toLowerCase();

    expect(joined).toContain("helm");
    expect(joined).toContain("air-gapped");
    expect(joined).toContain("high availability");
    expect(joined).toContain("enterprise edition");
    expect(joined).not.toContain("hardened");
  });

  test("the description names the Enterprise Edition, not hardened images", () => {
    const seo: PageSEOData = PageSEOConfig["/enterprise/self-hosted"]!;

    expect(seo.description).toContain("the Enterprise Edition");
    expect(seo.description.toLowerCase()).not.toContain("hardened");
  });
});
