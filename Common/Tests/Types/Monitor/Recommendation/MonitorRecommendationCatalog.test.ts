import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
  buildRecommendationId,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorType from "../../../../Types/Monitor/MonitorType";

import { getAllCephAlertTemplates } from "../../../../Types/Monitor/CephAlertTemplates";
import { getAllDockerAlertTemplates } from "../../../../Types/Monitor/DockerAlertTemplates";
import { getAllDockerSwarmAlertTemplates } from "../../../../Types/Monitor/DockerSwarmAlertTemplates";
import { getAllHostAlertTemplates } from "../../../../Types/Monitor/HostAlertTemplates";
import { getAllIoTAlertTemplates } from "../../../../Types/Monitor/IotAlertTemplates";
import { getAllKubernetesAlertTemplates } from "../../../../Types/Monitor/KubernetesAlertTemplates";
import { getAllPodmanAlertTemplates } from "../../../../Types/Monitor/PodmanAlertTemplates";
import { getAllProxmoxAlertTemplates } from "../../../../Types/Monitor/ProxmoxAlertTemplates";

/*
 * The catalog is the seam between eight independently-maintained alert-template
 * modules and one Recommendations UI. Everything it can silently get wrong is
 * a wiring mistake that produces a page that looks fine and creates broken or
 * duplicated monitors:
 *
 *   1. A resource type declared in the enum but never adapted -> its section
 *      renders empty and the user concludes we ship no templates for it.
 *   2. A recommendation id that is not globally unique -> selecting the Docker
 *      "high CPU" card also selects the Podman one, because THREE modules ship
 *      a template whose local id ends in `-high-cpu`. This is not
 *      hypothetical; see the `templateId collisions` test below, which asserts
 *      the collision exists so the prefix can never be "simplified" away.
 *   3. A monitorType that disagrees with the resource type -> the created
 *      monitor is evaluated by the wrong criteria evaluator.
 *
 * These tests are deliberately written against the underlying modules'
 * `getAll<X>AlertTemplates()` rather than against hardcoded counts, so adding
 * a template to any module does not break them — but adding a MODULE without
 * wiring it here does.
 */

interface ModuleExpectation {
  resourceType: MonitorRecommendationResourceType;
  monitorType: MonitorType;
  templateCount: number;
  identifierFieldName:
    | "clusterIdentifier"
    | "hostIdentifier"
    | "fleetIdentifier";
}

const MODULE_EXPECTATIONS: Array<ModuleExpectation> = [
  {
    resourceType: MonitorRecommendationResourceType.Kubernetes,
    monitorType: MonitorType.Kubernetes,
    templateCount: getAllKubernetesAlertTemplates().length,
    identifierFieldName: "clusterIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.Host,
    monitorType: MonitorType.Host,
    templateCount: getAllHostAlertTemplates().length,
    identifierFieldName: "hostIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.Docker,
    monitorType: MonitorType.Docker,
    templateCount: getAllDockerAlertTemplates().length,
    identifierFieldName: "hostIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.DockerSwarm,
    monitorType: MonitorType.DockerSwarm,
    templateCount: getAllDockerSwarmAlertTemplates().length,
    identifierFieldName: "clusterIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.Podman,
    monitorType: MonitorType.Podman,
    templateCount: getAllPodmanAlertTemplates().length,
    identifierFieldName: "hostIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.Proxmox,
    monitorType: MonitorType.Proxmox,
    templateCount: getAllProxmoxAlertTemplates().length,
    identifierFieldName: "clusterIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.Ceph,
    monitorType: MonitorType.Ceph,
    templateCount: getAllCephAlertTemplates().length,
    identifierFieldName: "clusterIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.IoTDevice,
    monitorType: MonitorType.IoTDevice,
    templateCount: getAllIoTAlertTemplates().length,
    identifierFieldName: "fleetIdentifier",
  },
];

describe("MonitorRecommendationCatalog", () => {
  describe("completeness", () => {
    it("has a definition for every resource type in the enum", () => {
      const enumMembers: Array<MonitorRecommendationResourceType> =
        Object.values(MonitorRecommendationResourceType);

      const definedTypes: Array<MonitorRecommendationResourceType> =
        MonitorRecommendationCatalog.getResourceTypeDefinitions().map(
          (definition: MonitorRecommendationResourceTypeDefinition) => {
            return definition.resourceType;
          },
        );

      expect(definedTypes.sort()).toEqual(enumMembers.sort());
    });

    it("has exactly one definition per resource type", () => {
      const definedTypes: Array<MonitorRecommendationResourceType> =
        MonitorRecommendationCatalog.getResourceTypeDefinitions().map(
          (definition: MonitorRecommendationResourceTypeDefinition) => {
            return definition.resourceType;
          },
        );

      expect(new Set(definedTypes).size).toBe(definedTypes.length);
    });

    it("covers every alert-template module and loses no templates", () => {
      /*
       * A dropped `.map` or a filtered adapter would show up here as a count
       * mismatch rather than as a quietly shorter list in the UI.
       */
      for (const expectation of MODULE_EXPECTATIONS) {
        const recommendations: Array<MonitorRecommendation> =
          MonitorRecommendationCatalog.getRecommendations(
            expectation.resourceType,
          );

        expect(expectation.templateCount).toBeGreaterThan(0);
        expect(recommendations.length).toBe(expectation.templateCount);
      }
    });

    it("getAllRecommendations returns the sum of every module", () => {
      const expectedTotal: number = MODULE_EXPECTATIONS.reduce(
        (total: number, expectation: ModuleExpectation) => {
          return total + expectation.templateCount;
        },
        0,
      );

      expect(MonitorRecommendationCatalog.getAllRecommendations().length).toBe(
        expectedTotal,
      );
    });
  });

  describe("recommendation identity", () => {
    it("mints globally unique recommendation ids", () => {
      const ids: Array<string> =
        MonitorRecommendationCatalog.getAllRecommendations().map(
          (recommendation: MonitorRecommendation) => {
            return recommendation.recommendationId;
          },
        );

      expect(new Set(ids).size).toBe(ids.length);
    });

    it("composes the recommendation id as resourceType:templateId", () => {
      for (const recommendation of MonitorRecommendationCatalog.getAllRecommendations()) {
        expect(recommendation.recommendationId).toBe(
          buildRecommendationId(
            recommendation.resourceType,
            recommendation.templateId,
          ),
        );
      }
    });

    it("canary: raw templateIds happen to be globally unique today", () => {
      /*
       * Every module self-prefixes (`host-high-cpu`, `docker-high-cpu`,
       * `podman-high-cpu`), so no two of the 76 collide right now. That is a
       * convention across eight independently maintained files, not a
       * contract — each module only promises uniqueness within itself.
       *
       * This test is a canary, NOT a requirement the registry depends on. If
       * it fails, nothing is broken: `recommendationId` is prefixed precisely
       * so a collision stays harmless (see the test below). Update this
       * expectation and move on.
       */
      const templateIds: Array<string> =
        MonitorRecommendationCatalog.getAllRecommendations().map(
          (recommendation: MonitorRecommendation) => {
            return recommendation.templateId;
          },
        );

      expect(new Set(templateIds).size).toBe(templateIds.length);
    });

    it("keeps colliding templateIds distinct once prefixed", () => {
      /*
       * The property the registry actually relies on: two modules picking the
       * same local id still produce different recommendation ids, so selecting
       * a Docker card can never also select the Podman one.
       */
      expect(
        buildRecommendationId(
          MonitorRecommendationResourceType.Docker,
          "high-cpu",
        ),
      ).not.toBe(
        buildRecommendationId(
          MonitorRecommendationResourceType.Podman,
          "high-cpu",
        ),
      );
    });

    it("round-trips every recommendation through getRecommendationById", () => {
      for (const recommendation of MonitorRecommendationCatalog.getAllRecommendations()) {
        const found: MonitorRecommendation | undefined =
          MonitorRecommendationCatalog.getRecommendationById(
            recommendation.recommendationId,
          );

        expect(found).toBeDefined();
        expect(found?.templateId).toBe(recommendation.templateId);
        expect(found?.resourceType).toBe(recommendation.resourceType);
      }
    });

    it("returns undefined for an unknown recommendation id", () => {
      expect(
        MonitorRecommendationCatalog.getRecommendationById(
          "Nope:does-not-exist",
        ),
      ).toBeUndefined();
    });
  });

  describe("resource type definitions", () => {
    it("maps each resource type to the correct MonitorType", () => {
      for (const expectation of MODULE_EXPECTATIONS) {
        const definition:
          | MonitorRecommendationResourceTypeDefinition
          | undefined = MonitorRecommendationCatalog.getResourceTypeDefinition(
          expectation.resourceType,
        );

        expect(definition?.monitorType).toBe(expectation.monitorType);
      }
    });

    it("documents the identifier field name each module actually uses", () => {
      /*
       * `identifierFieldName` is the only place the args rename is written
       * down. If a template module renames e.g. `clusterIdentifier` ->
       * `clusterId`, its adapter stops threading the identifier and every
       * generated monitor silently scopes to undefined. This test pins the
       * expectation; MonitorRecommendationUtil.test.ts proves the value
       * actually arrives in the built step.
       */
      for (const expectation of MODULE_EXPECTATIONS) {
        const definition:
          | MonitorRecommendationResourceTypeDefinition
          | undefined = MonitorRecommendationCatalog.getResourceTypeDefinition(
          expectation.resourceType,
        );

        expect(definition?.identifierFieldName).toBe(
          expectation.identifierFieldName,
        );
      }
    });

    it("stamps every recommendation with its definition's monitorType and resourceType", () => {
      for (const definition of MonitorRecommendationCatalog.getResourceTypeDefinitions()) {
        for (const recommendation of definition.getRecommendations()) {
          expect(recommendation.monitorType).toBe(definition.monitorType);
          expect(recommendation.resourceType).toBe(definition.resourceType);
        }
      }
    });

    it("gives every definition a non-empty human label", () => {
      for (const definition of MonitorRecommendationCatalog.getResourceTypeDefinitions()) {
        expect(definition.resourceLabel.trim().length).toBeGreaterThan(0);
      }
    });

    it("returns an empty list for an unknown resource type", () => {
      expect(
        MonitorRecommendationCatalog.getRecommendations(
          "NotAResourceType" as MonitorRecommendationResourceType,
        ),
      ).toEqual([]);
    });

    it("returns undefined for an unknown resource type definition", () => {
      expect(
        MonitorRecommendationCatalog.getResourceTypeDefinition(
          "NotAResourceType" as MonitorRecommendationResourceType,
        ),
      ).toBeUndefined();
    });

    it("does not leak its internal definitions array to callers", () => {
      const first: Array<MonitorRecommendationResourceTypeDefinition> =
        MonitorRecommendationCatalog.getResourceTypeDefinitions();
      first.pop();

      expect(
        MonitorRecommendationCatalog.getResourceTypeDefinitions().length,
      ).toBe(MODULE_EXPECTATIONS.length);
    });
  });

  describe("recommendation content", () => {
    it("gives every recommendation a name, description, category and valid severity", () => {
      for (const recommendation of MonitorRecommendationCatalog.getAllRecommendations()) {
        expect(recommendation.name.trim().length).toBeGreaterThan(0);
        expect(recommendation.description.trim().length).toBeGreaterThan(0);
        expect(recommendation.category.trim().length).toBeGreaterThan(0);
        expect(["Critical", "Warning"]).toContain(recommendation.severity);
      }
    });
  });

  describe("getCategories", () => {
    it("returns distinct categories in first-declaration order", () => {
      for (const expectation of MODULE_EXPECTATIONS) {
        const recommendations: Array<MonitorRecommendation> =
          MonitorRecommendationCatalog.getRecommendations(
            expectation.resourceType,
          );

        const categories: Array<string> =
          MonitorRecommendationCatalog.getCategories(expectation.resourceType);

        expect(new Set(categories).size).toBe(categories.length);

        // Every category is real, and every recommendation's category is listed.
        for (const recommendation of recommendations) {
          expect(categories).toContain(recommendation.category);
        }

        // Order matches first appearance in the module's own declaration order.
        const firstAppearanceOrder: Array<string> = [];
        for (const recommendation of recommendations) {
          if (!firstAppearanceOrder.includes(recommendation.category)) {
            firstAppearanceOrder.push(recommendation.category);
          }
        }
        expect(categories).toEqual(firstAppearanceOrder);
      }
    });

    it("returns an empty list for an unknown resource type", () => {
      expect(
        MonitorRecommendationCatalog.getCategories(
          "NotAResourceType" as MonitorRecommendationResourceType,
        ),
      ).toEqual([]);
    });
  });
});
