import {
  ServiceRepoLinkSuggestion,
  SuggestableRepository,
  SuggestableService,
  computeLinkSuggestions,
} from "../../../Server/Utils/CodeRepository/ServiceRepoLinkSuggester";
import { describe, expect, test } from "@jest/globals";

/*
 * The link suggester powers the service ↔ repository auto-mapping the AI fix
 * pipeline depends on. It must be deterministic and explainable: exact
 * normalized match (3) > containment (2) > token overlap (1), never
 * suggesting services that already have a link, capped and sorted.
 */

function service(id: string, name: string): SuggestableService {
  return { id, name };
}

function repo(
  id: string,
  repositoryName: string,
  data?: { name?: string; organizationName?: string },
): SuggestableRepository {
  return {
    id,
    name: data?.name || repositoryName,
    repositoryName,
    organizationName: data?.organizationName || "acme",
  };
}

describe("computeLinkSuggestions", () => {
  test("exact match wins regardless of case and separators", () => {
    const suggestions: Array<ServiceRepoLinkSuggestion> =
      computeLinkSuggestions({
        services: [service("s1", "Checkout Service")],
        repositories: [repo("r1", "checkout-service")],
        existingLinks: [],
      });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.score).toBe(3);
    expect(suggestions[0]!.serviceId).toBe("s1");
    expect(suggestions[0]!.codeRepositoryId).toBe("r1");
    expect(suggestions[0]!.repositoryFullName).toBe("acme/checkout-service");
  });

  test("containment matches when one name contains the other", () => {
    const suggestions: Array<ServiceRepoLinkSuggestion> =
      computeLinkSuggestions({
        services: [service("s1", "billing")],
        repositories: [repo("r1", "acme-billing-monorepo")],
        existingLinks: [],
      });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.score).toBe(2);
  });

  test("token overlap catches suffix/prefix variants like checkout-service vs checkout", () => {
    const suggestions: Array<ServiceRepoLinkSuggestion> =
      computeLinkSuggestions({
        services: [service("s1", "payments-service-v2")],
        repositories: [repo("r1", "payments-service")],
        existingLinks: [],
      });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.score).toBeGreaterThanOrEqual(1);
    expect(suggestions[0]!.reason).toBeTruthy();
  });

  test("unrelated names produce no suggestion", () => {
    const suggestions: Array<ServiceRepoLinkSuggestion> =
      computeLinkSuggestions({
        services: [service("s1", "checkout")],
        repositories: [repo("r1", "infra-terraform")],
        existingLinks: [],
      });

    expect(suggestions).toHaveLength(0);
  });

  test("sharing only a generic short token is not enough", () => {
    // {payments, service} vs {billing, service}: Jaccard 1/3 < 0.5.
    const suggestions: Array<ServiceRepoLinkSuggestion> =
      computeLinkSuggestions({
        services: [service("s1", "payments-service")],
        repositories: [repo("r1", "billing-service")],
        existingLinks: [],
      });

    expect(suggestions).toHaveLength(0);
  });

  test("already-linked services are never suggested again", () => {
    const suggestions: Array<ServiceRepoLinkSuggestion> =
      computeLinkSuggestions({
        services: [service("s1", "checkout"), service("s2", "billing")],
        repositories: [repo("r1", "checkout"), repo("r2", "billing")],
        existingLinks: [{ serviceId: "s1", codeRepositoryId: "r1" }],
      });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.serviceId).toBe("s2");
  });

  test("a repository can be suggested for several services (monorepo)", () => {
    const suggestions: Array<ServiceRepoLinkSuggestion> =
      computeLinkSuggestions({
        services: [
          service("s1", "acme-platform-api"),
          service("s2", "acme-platform-worker"),
        ],
        repositories: [repo("r1", "acme-platform")],
        existingLinks: [],
      });

    expect(suggestions).toHaveLength(2);
  });

  test("results are sorted by score descending", () => {
    const suggestions: Array<ServiceRepoLinkSuggestion> =
      computeLinkSuggestions({
        services: [
          service("s1", "checkout-service-v2"),
          service("s2", "checkout"),
        ],
        repositories: [repo("r1", "checkout")],
        existingLinks: [],
      });

    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions[0]!.serviceId).toBe("s2"); // exact
    expect(suggestions[0]!.score).toBe(3);
    expect(suggestions[0]!.score).toBeGreaterThanOrEqual(suggestions[1]!.score);
  });

  test("camelCase display names tokenize across boundaries", () => {
    const suggestions: Array<ServiceRepoLinkSuggestion> =
      computeLinkSuggestions({
        services: [service("s1", "CheckoutApi")],
        repositories: [repo("r1", "checkout-api")],
        existingLinks: [],
      });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.score).toBe(3); // normalized: checkoutapi === checkoutapi
  });

  test("caps output at 50 suggestions", () => {
    const services: Array<SuggestableService> = [];
    for (let i: number = 0; i < 80; i++) {
      services.push(service(`s${i}`, `svc-${i}-common-name`));
    }

    const suggestions: Array<ServiceRepoLinkSuggestion> =
      computeLinkSuggestions({
        services,
        repositories: [repo("r1", "common-name")],
        existingLinks: [],
      });

    expect(suggestions.length).toBeLessThanOrEqual(50);
  });
});
