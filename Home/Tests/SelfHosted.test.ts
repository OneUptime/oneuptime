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
  HardenedImageFeatures,
  HelmDocs,
  InfrastructureRequirements,
  RequirementGroup,
  ResilienceControl,
  ResponsibilityRow,
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
    expect(componentNames).toContain("Redis");
    expect(componentNames).toContain("PgBouncer");
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

  test("hardened image guidance names the enterprise-edition chart value", () => {
    expect(HardenedImageFeatures.join(" ")).toContain("enterprise-edition");
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
    expect(content.hardenedImageFeatures).toBe(HardenedImageFeatures);
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
    expect(joined).toContain("hardened");
  });
});
