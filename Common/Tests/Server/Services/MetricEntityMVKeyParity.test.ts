import TelemetryEntity, {
  ExtractedEntity,
  keyForContainer,
} from "../../../Server/Utils/Telemetry/TelemetryEntity";
import {
  keyForHost,
  keyForKubernetesCluster,
  keyForService,
} from "../../../Utils/Telemetry/EntityKey";
import EntityType from "../../../Types/Telemetry/EntityType";
import { describe, expect, test } from "@jest/globals";

/*
 * Pins the read-side key derivations MetricService's entity-MV routing
 * uses (keyForHost / keyForKubernetesCluster / keyForContainer /
 * keyForService) against the ingest side that stamps the scalar
 * entity-key columns the per-entity rollup MVs group by
 * (TelemetryEntity.extractEntities -> serviceEntityKey / hostEntityKey /
 * k8sClusterEntityKey / containerEntityKey on MetricItemV3; the MVs copy
 * the stamped column verbatim — `WHERE <key> != '' GROUP BY ... <key>`).
 *
 * Byte-equality between the two sides is what makes an MV lookup
 * correct: a routed predicate whose key doesn't match the stamp finds
 * nothing. This is the sibling of EntityKeySqlParity.test.ts (which pins
 * keyForHost against ClickHouse's SQL SHA-256); the host vector below
 * reuses that test's live-ClickHouse-verified literal so the ingest
 * stamping stays anchored to the same externally computed value.
 */
describe("entity-MV routing keys — parity with ingest-stamped scalar entity keys", () => {
  const projectId: string = "proj-123";

  /*
   * A resource carrying all four routable identities at once, with
   * casing/whitespace drift to exercise canonicalization.
   */
  const attributes: Record<string, string> = {
    "host.name": "Web-Server-01 ",
    "k8s.cluster.name": "Prod-EU-1",
    "container.id": "ABC123def456",
    "service.name": "Checkout",
  };

  type FirstOfTypeFunction = (
    entities: Array<ExtractedEntity>,
    entityType: EntityType,
  ) => string;

  /*
   * Mirrors OtelIngestBaseService.scalarEntityKeysFromEntities: the
   * FIRST extracted entity of a type is what lands in the scalar column
   * ('' when the type is absent).
   */
  const firstOfType: FirstOfTypeFunction = (
    entities: Array<ExtractedEntity>,
    entityType: EntityType,
  ): string => {
    return (
      entities.find((entity: ExtractedEntity) => {
        return entity.entityType === entityType;
      })?.entityKey || ""
    );
  };

  test("each routable read-side key byte-matches the stamped scalar column", () => {
    const entities: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
      projectId,
      attributes,
    });

    expect(firstOfType(entities, EntityType.Host)).toBe(
      keyForHost(projectId, "Web-Server-01 "),
    );
    expect(firstOfType(entities, EntityType.KubernetesCluster)).toBe(
      keyForKubernetesCluster(projectId, "Prod-EU-1"),
    );
    expect(firstOfType(entities, EntityType.Container)).toBe(
      keyForContainer(projectId, "ABC123def456"),
    );
    expect(firstOfType(entities, EntityType.Service)).toBe(
      keyForService(projectId, "Checkout"),
    );
  });

  test("read-side keys canonicalize exactly like ingest (spelling drift lands on one rollup stream)", () => {
    const drifted: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
      projectId,
      attributes: {
        "host.name": "web-server-01",
        "k8s.cluster.name": " prod-eu-1 ",
        "container.id": "abc123DEF456",
        "service.name": "  checkout",
      },
    });

    expect(firstOfType(drifted, EntityType.Host)).toBe(
      keyForHost(projectId, "Web-Server-01 "),
    );
    expect(firstOfType(drifted, EntityType.KubernetesCluster)).toBe(
      keyForKubernetesCluster(projectId, "Prod-EU-1"),
    );
    expect(firstOfType(drifted, EntityType.Container)).toBe(
      keyForContainer(projectId, "ABC123def456"),
    );
    expect(firstOfType(drifted, EntityType.Service)).toBe(
      keyForService(projectId, "Checkout"),
    );
  });

  test("host stamping matches the live-ClickHouse-verified vector from EntityKeySqlParity", () => {
    const entities: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
      projectId: "proj-123",
      attributes: { "host.name": "Web-Server-01 " },
    });

    // Literal output of ClickHouse 25.7's SHA-256 SQL for this identity.
    expect(firstOfType(entities, EntityType.Host)).toBe("dba90fb9cca1242e");
  });

  test("service.namespace forks the stamped key — the bare-name key MUST NOT be assumed (registry required)", () => {
    const namespaced: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
      projectId,
      attributes: {
        "service.name": "checkout",
        "service.namespace": "prod",
      },
    });

    const stampedKey: string = firstOfType(namespaced, EntityType.Service);

    // Ingest folds the namespace in ...
    expect(stampedKey).toBe(keyForService(projectId, "checkout", "prod"));
    /*
     * ... so the bare-name derivation finds NOTHING for these rows. This
     * is why MetricService resolves service key SETS from the registry
     * and falls back to raw on a miss, instead of computing one key.
     */
    expect(stampedKey).not.toBe(keyForService(projectId, "checkout"));
  });

  test("a blank namespace is not identity-bearing on either side", () => {
    const blankNamespace: Array<ExtractedEntity> =
      TelemetryEntity.extractEntities({
        projectId,
        attributes: {
          "service.name": "checkout",
          "service.namespace": "   ",
        },
      });

    expect(firstOfType(blankNamespace, EntityType.Service)).toBe(
      keyForService(projectId, "checkout"),
    );
    expect(keyForService(projectId, "checkout", "   ")).toBe(
      keyForService(projectId, "checkout"),
    );
  });

  test("entityKeys membership (the entityScope raw predicate) contains every routable key", () => {
    const membershipKeys: Array<string> = TelemetryEntity.extractEntityKeys({
      projectId,
      attributes,
    });

    for (const key of [
      keyForHost(projectId, "Web-Server-01 "),
      keyForKubernetesCluster(projectId, "Prod-EU-1"),
      keyForContainer(projectId, "ABC123def456"),
      keyForService(projectId, "Checkout"),
    ]) {
      expect(membershipKeys).toContain(key);
    }
  });
});
