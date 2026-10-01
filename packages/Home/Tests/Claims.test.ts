import {
  Claim,
  ClaimCategories,
  ClaimCategory,
  ClaimCategoryGroup,
  ClaimCategoryKey,
  ClaimStatusDefinition,
  ClaimStatusKey,
  ClaimStatuses,
  Claims,
  RetiredClaim,
  RetiredClaims,
  RetiredEditionClaims,
  getClaim,
  getClaimStatus,
  getClaimsByCategory,
  getClaimsMatrix,
  getClaimsNeedingReview,
} from "../Utils/Claims";

const EXPECTED_STATUS_KEYS: Array<ClaimStatusKey> = [
  "certified",
  "attested",
  "compliant",
  "aligned",
  "in-progress",
  "customer-configurable",
];

/*
 * Single sign-on is part of the Community Edition: SAML and OIDC single
 * sign-on, global SSO, and "Require SSO for login" are Apache 2.0 and need no
 * license. The Enterprise Edition adds SCIM, audit logs, team compliance, and
 * the instance health dashboards. OneUptime Cloud still puts SSO on the Scale
 * plan, which is a plan, not an edition.
 */
const SINGLE_SIGN_ON_WORDING: RegExp =
  /\bSSO\b|single sign-on|\bSAML\b|\bOIDC\b|OpenID Connect/i;

// The examples the two single sign-on related edition rules carry.
const SSO_UNDER_ENTERPRISE_EDITION: string =
  "the Enterprise Edition adds SSO, SCIM, audit logs, team compliance, and instance health dashboards";
const FEATURES_UNDER_OPEN_SOURCE: string =
  "supports SCIM provisioning and audit logs while remaining open source";

type RetiredEditionClaimFunction = (example: string) => RetiredClaim;

const retiredEditionClaim: RetiredEditionClaimFunction = (
  example: string,
): RetiredClaim => {
  const retired: RetiredClaim | undefined = RetiredEditionClaims.find(
    (candidate: RetiredClaim) => {
      return candidate.example === example;
    },
  );

  if (!retired) {
    throw new Error(`No retired edition claim has the example "${example}"`);
  }

  return retired;
};

const EXPECTED_CATEGORY_KEYS: Array<ClaimCategoryKey> = [
  "sla",
  "support",
  "compliance",
  "encryption",
  "deployment",
  "migration",
  "scale",
  "discounts",
  "contract",
];

describe("Claims vocabulary", () => {
  test("the status vocabulary is exactly the governed set", () => {
    expect(
      ClaimStatuses.map((status: ClaimStatusDefinition) => {
        return status.key;
      }),
    ).toEqual(EXPECTED_STATUS_KEYS);
  });

  test("every status publishes a definition and an evidence bar", () => {
    for (const status of ClaimStatuses) {
      expect(status.label.length).toBeGreaterThan(0);
      expect(status.definition.length).toBeGreaterThan(20);
      expect(status.evidenceBar.length).toBeGreaterThan(10);
    }
  });

  test("status labels are the exact words the brief asked for", () => {
    const labels: Array<string> = ClaimStatuses.map(
      (status: ClaimStatusDefinition) => {
        return status.label;
      },
    );

    expect(labels).toEqual([
      "Certified",
      "Attested",
      "Compliant",
      "Aligned",
      "In progress",
      "Customer-configurable",
    ]);
  });

  test("getClaimStatus resolves every key and rejects unknown ones", () => {
    for (const key of EXPECTED_STATUS_KEYS) {
      expect(getClaimStatus(key).key).toBe(key);
    }

    expect(() => {
      return getClaimStatus("world-class" as ClaimStatusKey);
    }).toThrow("Unknown claim status: world-class");
  });
});

describe("Claims matrix", () => {
  test("every governed category from the brief is covered", () => {
    expect(
      ClaimCategories.map((category: ClaimCategory) => {
        return category.key;
      }),
    ).toEqual(EXPECTED_CATEGORY_KEYS);
  });

  test("every category carries claims and names its governing document", () => {
    for (const group of getClaimsMatrix()) {
      expect(group.claims.length).toBeGreaterThan(0);
      expect(group.category.governingDocument.length).toBeGreaterThan(0);
      expect(group.category.governingDocumentUrl.length).toBeGreaterThan(0);
    }
  });

  test("claim ids are unique", () => {
    const ids: Array<string> = Claims.map((claim: Claim) => {
      return claim.id;
    });

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every claim has a statement, a qualifier, evidence, and a source", () => {
    for (const claim of Claims) {
      expect(claim.statement.length).toBeGreaterThan(20);
      expect(claim.qualifier.length).toBeGreaterThan(10);
      expect(claim.evidence.length).toBeGreaterThan(5);
      expect(claim.sourceUrl).toMatch(/^(\/|https:\/\/)/);
    }
  });

  test("every claim uses a status and a category from the vocabulary", () => {
    for (const claim of Claims) {
      expect(EXPECTED_STATUS_KEYS).toContain(claim.status);
      expect(EXPECTED_CATEGORY_KEYS).toContain(claim.category);
      expect(["cloud", "self-hosted", "both"]).toContain(claim.scope);
    }
  });

  test("no claim statement contains a hedge-free superlative", () => {
    // These read as puffery on a page that is meant to be checkable.
    const bannedWords: Array<RegExp> = [
      /\bworld[- ]class\b/i,
      /\bbest[- ]in[- ]class\b/i,
      /\bunbreakable\b/i,
      /\bbulletproof\b/i,
      /\bhighest standards\b/i,
      /\b100% secure\b/i,
    ];

    for (const claim of Claims) {
      for (const banned of bannedWords) {
        expect(`${claim.statement} ${claim.qualifier}`).not.toMatch(banned);
      }
    }
  });

  test("a claim marked for review explains what the reviewer must confirm", () => {
    for (const claim of getClaimsNeedingReview()) {
      expect(claim.reviewRequired).toBe(true);
      expect(claim.reviewNote).toBeDefined();
      expect(claim.reviewNote!.length).toBeGreaterThan(20);
    }
  });

  test("every published claim currently has its evidence confirmed", () => {
    /*
     * Legal and security signed off on the ISO family, the PCI attestation and
     * the CSA STAR Level 2 certificate, so the queue is empty. If this fails,
     * someone added a claim faster than the evidence for it — which is the
     * whole failure mode this matrix exists to prevent. Either produce the
     * evidence or soften the status.
     */
    expect(getClaimsNeedingReview()).toHaveLength(0);
  });

  test("a claim without confirmed evidence cannot silently ship", () => {
    // The flag has to survive on the type, or the guard above becomes a no-op.
    const flagged: Claim = {
      ...getClaim("compliance-iso-27001")!,
      id: "test-only",
      reviewRequired: true,
      reviewNote: "Reviewer must confirm the certificate number and scope.",
    };

    expect(flagged.reviewRequired).toBe(true);
    expect(flagged.reviewNote).toBeDefined();
  });

  test("getClaimsByCategory and getClaim look claims up", () => {
    const slaClaims: Array<Claim> = getClaimsByCategory("sla");
    expect(slaClaims.length).toBeGreaterThan(0);
    for (const claim of slaClaims) {
      expect(claim.category).toBe("sla");
    }

    expect(getClaim("sla-cloud-enterprise")!.status).toBe("compliant");
    expect(getClaim("does-not-exist")).toBeNull();
  });

  test("the matrix keeps categories in publication order", () => {
    const matrix: Array<ClaimCategoryGroup> = getClaimsMatrix();
    expect(
      matrix.map((group: ClaimCategoryGroup) => {
        return group.category.key;
      }),
    ).toEqual(EXPECTED_CATEGORY_KEYS);
  });
});

describe("Claims match the documents that bind us", () => {
  test("the enterprise uptime claim matches the SLA, not marketing", () => {
    const claim: Claim = getClaim("sla-cloud-enterprise")!;

    expect(claim.statement).toContain("99.95%");
    expect(claim.statement).not.toContain("99.99%");
    expect(claim.sourceUrl).toBe("/legal/sla");
  });

  test("the paid-plan uptime claim matches the SLA", () => {
    const claim: Claim = getClaim("sla-cloud-paid")!;

    expect(claim.statement).toContain("99.9%");
    expect(claim.sourceUrl).toBe("/legal/sla");
  });

  test("free plans are stated as having no uptime commitment", () => {
    const claim: Claim = getClaim("sla-free-plans")!;

    expect(claim.statement.toLowerCase()).toContain("no uptime commitment");
    expect(claim.status).toBe("aligned");
  });

  test("support response times are described as targets, never guarantees", () => {
    const claim: Claim = getClaim("support-p1")!;

    expect(claim.statement.toLowerCase()).toContain("target");
    expect(claim.qualifier.toLowerCase()).toContain(
      "not a credit-backed guarantee",
    );
  });

  test("self-hosted uptime is explicitly excluded from the cloud SLA", () => {
    const claim: Claim = getClaim("sla-self-hosted")!;

    expect(claim.status).toBe("customer-configurable");
    expect(claim.scope).toBe("self-hosted");
    expect(claim.qualifier).toContain(
      "does not extend to infrastructure you operate",
    );
  });

  test("SOC 2 is attested rather than certified", () => {
    const claim: Claim = getClaim("compliance-soc2")!;

    expect(claim.status).toBe("attested");
    expect(claim.qualifier.toLowerCase()).toContain("not a certificate");
  });

  test("regimes with no vendor certification scheme are aligned, not certified", () => {
    /*
     * 21 CFR Part 11, Annex 11 and GAMP 5 certify no vendor — the regulated
     * customer validates their own system. No amount of documentation on our
     * side turns that into a certification.
     */
    expect(getClaim("compliance-gxp")!.status).toBe("aligned");
  });

  test("PCI DSS is attested — the scheme issues an AOC, not a certificate", () => {
    const claim: Claim = getClaim("compliance-pci")!;

    expect(claim.status).toBe("attested");
    expect(claim.statement).toContain("Qualified Security Assessor");
    expect(claim.statement).toContain("Attestation of Compliance");
    expect(claim.qualifier).toContain("not a certificate");
    // Our own scope limit still has to travel with the claim.
    expect(claim.qualifier).toContain("does not store primary account numbers");
  });

  test("CSA STAR is certified at Level 2, and says which level", () => {
    const claim: Claim = getClaim("compliance-csa-star")!;

    expect(claim.status).toBe("certified");
    expect(claim.statement).toContain("Level 2");
    expect(claim.qualifier).toContain("third-party audit");
  });

  test("every certified claim can point at an actual certificate", () => {
    const certified: Array<Claim> = Claims.filter((claim: Claim) => {
      return claim.status === "certified";
    });

    expect(certified.length).toBeGreaterThan(0);

    for (const claim of certified) {
      expect(claim.evidence.toLowerCase()).toMatch(/certificate/);
    }
  });

  test("every attested claim points at a third-party report, not a certificate", () => {
    const attested: Array<Claim> = Claims.filter((claim: Claim) => {
      return claim.status === "attested";
    });

    expect(attested.length).toBeGreaterThan(0);

    for (const claim of attested) {
      expect(claim.evidence.toLowerCase()).toMatch(
        /report|attestation|status page|caiq/,
      );
    }
  });

  test("the ISO family is certified and scoped to the cloud service", () => {
    for (const id of [
      "compliance-iso-27001",
      "compliance-iso-27017",
      "compliance-iso-27018",
      "compliance-iso-9001",
    ]) {
      const claim: Claim = getClaim(id)!;

      expect(claim.status).toBe("certified");
      expect(claim.scope).toBe("cloud");
      expect(claim.evidence.toLowerCase()).toContain("certificate");
    }
  });

  test("ISO 27001 says certification does not cover a customer's own deployment", () => {
    expect(getClaim("compliance-iso-27001")!.qualifier).toContain(
      "not a customer's self-hosted deployment",
    );
  });

  test("the 27017 and 27018 extensions do not claim to be standalone schemes", () => {
    for (const id of ["compliance-iso-27017", "compliance-iso-27018"]) {
      expect(getClaim(id)!.qualifier).toContain(
        "not a standalone certification",
      );
    }
  });

  test("statutory regimes with no certification body are compliant", () => {
    for (const id of [
      "compliance-gdpr",
      "compliance-ccpa",
      "compliance-hipaa",
    ]) {
      const claim: Claim = getClaim(id)!;
      expect(claim.status).toBe("compliant");
      expect(claim.qualifier.toLowerCase()).toMatch(
        /no certification|not a certification|must be executed/,
      );
    }
  });

  test("FedRAMP stays in progress and promises no date", () => {
    const claim: Claim = getClaim("compliance-fedramp")!;

    expect(claim.status).toBe("in-progress");
    expect(claim.qualifier.toLowerCase()).toContain("no date is promised");
  });

  test("encryption claims split cloud from self-hosted responsibility", () => {
    expect(getClaim("encryption-in-transit")!.scope).toBe("cloud");
    expect(getClaim("encryption-self-hosted")!.scope).toBe("self-hosted");
    expect(getClaim("encryption-self-hosted")!.status).toBe(
      "customer-configurable",
    );
  });

  test("the discounts category does not invent a programme we do not run", () => {
    const claim: Claim = getClaim("discount-open-source")!;

    expect(claim.statement.toLowerCase()).toContain("no non-profit");
    expect(claim.statement.toLowerCase()).toContain("free to self-host");
  });

  test("annual billing avoids publishing a single headline percentage", () => {
    const claim: Claim = getClaim("discount-annual")!;

    expect(claim.statement).not.toMatch(/\d+\s*%/);
  });

  test("contract terms say the order form wins over a marketing page", () => {
    const claim: Claim = getClaim("contract-order-form")!;

    expect(claim.qualifier.toLowerCase()).toContain("order form governs");
  });

  test("scale is stated as architecture, not as an unverifiable headline number", () => {
    for (const claim of getClaimsByCategory("scale")) {
      expect(claim.statement).not.toMatch(/billions?\b/i);
      expect(claim.statement).not.toMatch(/Fortune 500/i);
      expect(claim.statement).not.toMatch(
        /millions? of (log )?events per second/i,
      );
    }
  });
});

describe("Retired claims", () => {
  test("every retired claim explains itself and offers a replacement", () => {
    for (const retired of RetiredClaims) {
      expect(retired.example.length).toBeGreaterThan(0);
      expect(retired.reason.length).toBeGreaterThan(20);
      expect(retired.replacement.length).toBeGreaterThan(10);
      expect(getClaim(retired.claimId)).not.toBeNull();
    }
  });

  test("each retired pattern still matches the language it was written to catch", () => {
    for (const retired of RetiredClaims) {
      expect(retired.example).toMatch(retired.pattern);
    }
  });

  test("no retired pattern matches its own approved replacement", () => {
    for (const retired of RetiredClaims) {
      expect(retired.replacement).not.toMatch(retired.pattern);
    }
  });

  test("no retired pattern matches an approved claim statement", () => {
    for (const retired of RetiredClaims) {
      for (const claim of Claims) {
        const matched: boolean = retired.pattern.test(claim.statement);
        if (matched) {
          throw new Error(
            `Approved claim "${claim.id}" uses retired language "${retired.example}": ${claim.statement}`,
          );
        }
      }
    }
  });

  test("the retired list covers the contradictions this work was opened for", () => {
    const examples: Array<string> = RetiredClaims.map(
      (retired: RetiredClaim) => {
        return retired.example;
      },
    );

    expect(examples).toContain("99.99% uptime SLA");
    expect(examples).toContain("guaranteed response times");
    expect(examples).toContain("financial-backed reliability guarantee");
  });

  test("the retired list covers the claims the Community / Enterprise split made false", () => {
    const examples: Array<string> = RetiredClaims.map(
      (retired: RetiredClaim) => {
        return retired.example;
      },
    );

    expect(examples).toContain("fully open-source, not open-core");
    expect(examples).toContain("100% open source");
    expect(examples).toContain("the entire platform is Apache-2.0 open source");
    expect(examples).toContain("Hardened Enterprise Edition container images");
    expect(examples).toContain("the community edition is not feature-limited");
    expect(examples).toContain("self-host the entire stack under Apache 2.0");
    expect(examples).toContain("fully self-hostable for free");
    expect(examples).toContain("self-host the full platform for free");
    expect(examples).toContain("The software is open-source and free");
    expect(examples).toContain(
      "Free to self-host: Run the full platform on your own infrastructure.",
    );
  });

  test("the retired list covers single sign-on filed under the Enterprise Edition, and SCIM and audit logs put under Apache 2.0", () => {
    const examples: Array<string> = RetiredClaims.map(
      (retired: RetiredClaim) => {
        return retired.example;
      },
    );

    expect(examples).toContain(SSO_UNDER_ENTERPRISE_EDITION);
    expect(examples).toContain(FEATURES_UNDER_OPEN_SOURCE);
  });
});

describe("Claims match the Community / Enterprise Edition split", () => {
  test("the open-source claim limits Apache-2.0 to the core and names the ee/ license", () => {
    const claim: Claim = getClaim("deployment-open-source")!;

    expect(claim.statement).toContain("The core platform is Apache-2.0");
    expect(claim.statement).not.toMatch(/entire platform is Apache/i);
    expect(claim.qualifier).toContain("OneUptime Enterprise License");
    expect(claim.evidence).toContain("ee/LICENSE");
  });

  test("the Enterprise Edition images claim replaces the hardened-images claim", () => {
    expect(getClaim("deployment-hardened-images")).toBeNull();

    const claim: Claim = getClaim("deployment-enterprise-edition")!;

    expect(claim.subject).toBe("Enterprise Edition images");
    expect(claim.statement).not.toMatch(/hardened/i);
    expect(claim.statement).toContain("SCIM");
    expect(claim.statement).toContain("audit logs");
    expect(claim.qualifier).toContain("requires a valid Enterprise license");
    expect(claim.qualifier).toContain("not separately hardened");
  });

  test("the self-hosted claim no longer calls the Community Edition the complete product", () => {
    const claim: Claim = getClaim("deployment-self-hosted")!;

    expect(claim.qualifier).not.toMatch(/complete product|hardened/i);
    expect(claim.qualifier).toContain("core platform under Apache 2.0");
    expect(claim.qualifier).toContain("OneUptime Enterprise License");
  });

  test("the air-gapped claim discloses the Enterprise Edition license check", () => {
    const claim: Claim = getClaim("deployment-air-gapped")!;

    expect(claim.qualifier).toContain("offline license token");
  });

  test("free self-hosting is claimed for the Community Edition only", () => {
    expect(getClaim("discount-open-source")!.statement).toContain(
      "The Community Edition is free to self-host",
    );
    expect(getClaim("discount-self-host")!.statement).toContain(
      "The Community Edition is free to run yourself",
    );
  });

  test("no claim says all of OneUptime is Apache-2.0 or open source", () => {
    for (const claim of Claims) {
      const text: string = `${claim.statement} ${claim.qualifier}`;

      expect(text).not.toMatch(/\b(?:entire|whole)\s+platform\s+is\s+Apache/i);
      expect(text).not.toMatch(/100\s*%\s*open[- ]source/i);
      expect(text).not.toMatch(/not\s+open[- ]core/i);
    }
  });
});

describe("Claims put single sign-on in the Community Edition", () => {
  test("the Enterprise Edition images claim names what the images add, and single sign-on is not part of it", () => {
    const claim: Claim = getClaim("deployment-enterprise-edition")!;

    for (const feature of [
      "SCIM",
      "audit logs",
      "team compliance",
      "instance health dashboards",
    ]) {
      expect(claim.statement).toContain(feature);
    }

    expect(claim.statement).not.toMatch(SINGLE_SIGN_ON_WORDING);
    expect(claim.qualifier).not.toMatch(SINGLE_SIGN_ON_WORDING);
  });

  test("the self-hosted claim names single sign-on on the Community Edition side of the split, never the Enterprise side", () => {
    const sides: Array<string> = getClaim(
      "deployment-self-hosted",
    )!.qualifier.split(";");

    expect(sides).toHaveLength(2);

    const communitySide: string = sides[0]!;
    const enterpriseSide: string = sides[1]!;

    expect(communitySide).toContain("The Community Edition");
    expect(communitySide).toContain("SAML and OIDC single sign-on included");
    expect(enterpriseSide).toContain(
      "the Enterprise Edition adds SCIM, audit logs, team compliance, and instance health dashboards",
    );
    expect(enterpriseSide).not.toMatch(SINGLE_SIGN_ON_WORDING);
  });

  test("no claim files single sign-on under the Enterprise Edition, in its statement or its qualifier", () => {
    const ssoRule: RetiredClaim = retiredEditionClaim(
      SSO_UNDER_ENTERPRISE_EDITION,
    );

    for (const claim of Claims) {
      expect({
        id: claim.id,
        statement: ssoRule.pattern.test(claim.statement),
        qualifier: ssoRule.pattern.test(claim.qualifier),
      }).toEqual({ id: claim.id, statement: false, qualifier: false });
    }
  });

  test("no approved qualifier uses retired edition language", () => {
    // The statements are checked against every retired claim above.
    for (const retired of RetiredEditionClaims) {
      for (const claim of Claims) {
        if (retired.pattern.test(claim.qualifier)) {
          throw new Error(
            `The qualifier of "${claim.id}" uses retired language "${retired.example}": ${claim.qualifier}`,
          );
        }
      }
    }
  });

  test("the hardened-images replacement and the feature-limited reason name SCIM, never single sign-on, as an Enterprise Edition feature", () => {
    const hardened: RetiredClaim = retiredEditionClaim(
      "Hardened Enterprise Edition container images",
    );
    const featureLimited: RetiredClaim = retiredEditionClaim(
      "the community edition is not feature-limited",
    );

    expect(hardened.replacement).toContain("SCIM, audit logs");
    expect(hardened.replacement).not.toMatch(SINGLE_SIGN_ON_WORDING);
    expect(featureLimited.reason).toContain("SCIM, audit logs");
    expect(featureLimited.reason).not.toMatch(SINGLE_SIGN_ON_WORDING);
  });
});

describe("The open-source edition rule stays strict for SCIM and audit logs, and leaves single sign-on alone", () => {
  const openSourceRule: RetiredClaim = retiredEditionClaim(
    FEATURES_UNDER_OPEN_SOURCE,
  );

  test.each([
    "supports SCIM provisioning and audit logs while remaining open source",
    "OneUptime ships SCIM and audit logging while remaining open-source and self-hostable.",
    "Audit logs, SCIM, and RBAC, and the platform remains open source.",
    "Enterprise features include SCIM and audit logs. Self-hosting is available under the Apache 2.0 license for organizations requiring complete infrastructure control.",
    "Yes. OneUptime supports SSO/SAML, RBAC, and audit logs, and maintains SOC 2 Type II, ISO 27001, and GDPR compliance, so it fits enterprise requirements while remaining open source and self-hostable.",
  ])(
    "catches SCIM or audit logs put under the open-source license: %s",
    (sentence: string) => {
      expect(openSourceRule.pattern.test(sentence)).toBe(true);
    },
  );

  test.each([
    "SAML and OIDC single sign-on are part of the Community Edition and remain open source under Apache 2.0.",
    "OneUptime supports SSO/SAML and RBAC while remaining open source.",
    "Enterprise features include SSO/SAML and role-based access control. Self-hosting is available under the Apache 2.0 license for organizations requiring complete infrastructure control.",
    "Single sign-on ships in the Community Edition. Self-hosted, it runs under the Apache 2.0 license.",
  ])(
    "leaves single sign-on under the open-source license alone: %s",
    (sentence: string) => {
      for (const retired of RetiredEditionClaims) {
        expect({
          retired: retired.example,
          caught: retired.pattern.test(sentence),
        }).toEqual({ retired: retired.example, caught: false });
      }
    },
  );

  test("its reason names SCIM and audit logs as the Enterprise Edition features, and its replacement puts single sign-on under Apache 2.0", () => {
    expect(openSourceRule.reason).toContain(
      "SCIM and audit logs are Enterprise Edition features",
    );
    expect(openSourceRule.reason).not.toMatch(SINGLE_SIGN_ON_WORDING);
    expect(openSourceRule.replacement).toContain(
      "including SAML and OIDC single sign-on, is open source (Apache 2.0)",
    );
    expect(openSourceRule.replacement).toContain(
      "SCIM and audit logs are part of the Enterprise Edition",
    );
  });
});

describe("The single sign-on edition rule", () => {
  const ssoRule: RetiredClaim = retiredEditionClaim(
    SSO_UNDER_ENTERPRISE_EDITION,
  );

  test("is enforced over the templates and the page data", () => {
    expect(RetiredEditionClaims).toContain(ssoRule);
    expect(RetiredClaims).toContain(ssoRule);
    expect(ssoRule.claimId).toBe("deployment-enterprise-edition");
  });

  test("its reason says where single sign-on is, and that a Cloud plan is not an edition", () => {
    expect(ssoRule.reason).toContain("Apache 2.0 Community Edition");
    expect(ssoRule.reason).toContain("need no license");
    expect(ssoRule.reason).toContain("Scale plan: a plan, not an edition");
    expect(ssoRule.replacement).toContain(
      "SAML and OIDC single sign-on are part of the Apache 2.0 Community Edition",
    );
    expect(ssoRule.replacement).toContain(
      "the Enterprise Edition adds SCIM, audit logs, team compliance, and instance health dashboards",
    );
  });

  test("its replacement passes every edition rule, not just its own", () => {
    for (const retired of RetiredEditionClaims) {
      expect({
        retired: retired.example,
        caught: retired.pattern.test(ssoRule.replacement),
      }).toEqual({ retired: retired.example, caught: false });
    }
  });
});
