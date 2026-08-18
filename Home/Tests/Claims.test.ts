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
    for (const id of [
      "compliance-gxp",
      "compliance-csa-star",
      "compliance-pci",
    ]) {
      expect(getClaim(id)!.status).toBe("aligned");
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
});
