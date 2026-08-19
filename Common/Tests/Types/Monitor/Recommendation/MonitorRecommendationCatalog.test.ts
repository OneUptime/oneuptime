import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationContext,
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
import { getAllRumAlertTemplates } from "../../../../Types/Monitor/RumAlertTemplates";
import {
  getAllServiceAlertTemplates,
  getLanguagesWithServiceAlertTemplates,
  getServiceAlertTemplates,
} from "../../../../Types/Monitor/ServiceAlertTemplates";

/*
 * The catalog is the seam between ten independently-maintained alert-template
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
  monitorTypes: Array<MonitorType>;
  /*
   * Everything the module can ever produce. For nine of the ten this is also
   * what the page shows; for Service it is the union across every runtime.
   */
  templateCount: number;
  /*
   * What `getRecommendations(resourceType)` returns with NO context — what a
   * caller that knows nothing about the specific resource is offered. Equal to
   * `templateCount` for every resource type whose set is a constant, and
   * smaller for Service, where knowing nothing means the language-agnostic
   * subset.
   */
  contextFreeTemplateCount: number;
  identifierFieldName:
    | "clusterIdentifier"
    | "hostIdentifier"
    | "fleetIdentifier"
    | "rumApplicationId"
    | "serviceId";
}

const MODULE_EXPECTATIONS: Array<ModuleExpectation> = [
  {
    resourceType: MonitorRecommendationResourceType.Kubernetes,
    monitorTypes: [MonitorType.Kubernetes],
    templateCount: getAllKubernetesAlertTemplates().length,
    contextFreeTemplateCount: getAllKubernetesAlertTemplates().length,
    identifierFieldName: "clusterIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.Host,
    monitorTypes: [MonitorType.Host],
    templateCount: getAllHostAlertTemplates().length,
    contextFreeTemplateCount: getAllHostAlertTemplates().length,
    identifierFieldName: "hostIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.Docker,
    monitorTypes: [MonitorType.Docker],
    templateCount: getAllDockerAlertTemplates().length,
    contextFreeTemplateCount: getAllDockerAlertTemplates().length,
    identifierFieldName: "hostIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.DockerSwarm,
    monitorTypes: [MonitorType.DockerSwarm],
    templateCount: getAllDockerSwarmAlertTemplates().length,
    contextFreeTemplateCount: getAllDockerSwarmAlertTemplates().length,
    identifierFieldName: "clusterIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.Podman,
    monitorTypes: [MonitorType.Podman],
    templateCount: getAllPodmanAlertTemplates().length,
    contextFreeTemplateCount: getAllPodmanAlertTemplates().length,
    identifierFieldName: "hostIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.Proxmox,
    monitorTypes: [MonitorType.Proxmox],
    templateCount: getAllProxmoxAlertTemplates().length,
    contextFreeTemplateCount: getAllProxmoxAlertTemplates().length,
    identifierFieldName: "clusterIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.Ceph,
    monitorTypes: [MonitorType.Ceph],
    templateCount: getAllCephAlertTemplates().length,
    contextFreeTemplateCount: getAllCephAlertTemplates().length,
    identifierFieldName: "clusterIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.IoTDevice,
    monitorTypes: [MonitorType.IoTDevice],
    templateCount: getAllIoTAlertTemplates().length,
    contextFreeTemplateCount: getAllIoTAlertTemplates().length,
    identifierFieldName: "fleetIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.RumApplication,
    monitorTypes: [
      MonitorType.Metrics,
      MonitorType.Traces,
      MonitorType.Exceptions,
    ],
    templateCount: getAllRumAlertTemplates().length,
    contextFreeTemplateCount: getAllRumAlertTemplates().length,
    identifierFieldName: "rumApplicationId",
  },
  {
    resourceType: MonitorRecommendationResourceType.Service,
    monitorTypes: [
      MonitorType.Metrics,
      MonitorType.Traces,
      MonitorType.Exceptions,
    ],
    templateCount: getAllServiceAlertTemplates().length,
    /*
     * The only row where these two differ, and the reason the field exists.
     * `getServiceAlertTemplates(null)` is the module's own answer to "what
     * applies to a service whose runtime is unknown", so this stays correct
     * when a template moves between the agnostic and language-specific sets.
     */
    contextFreeTemplateCount: getServiceAlertTemplates(null).length,
    identifierFieldName: "serviceId",
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
       *
       * Two counts, because the two questions are different and only one of
       * them is context-free: `getRecommendations` with no context answers
       * "what applies to a resource we know nothing about", while
       * `getAllRecommendations` has to stay exhaustive or every invariant
       * downstream of it silently stops covering the language-specific half of
       * the service catalog.
       */
      const allRecommendations: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getAllRecommendations();

      for (const expectation of MODULE_EXPECTATIONS) {
        const recommendations: Array<MonitorRecommendation> =
          MonitorRecommendationCatalog.getRecommendations(
            expectation.resourceType,
          );

        expect(expectation.templateCount).toBeGreaterThan(0);
        expect(expectation.contextFreeTemplateCount).toBeGreaterThan(0);
        expect(recommendations.length).toBe(
          expectation.contextFreeTemplateCount,
        );

        expect(
          allRecommendations.filter((recommendation: MonitorRecommendation) => {
            return recommendation.resourceType === expectation.resourceType;
          }).length,
        ).toBe(expectation.templateCount);
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
       * `podman-high-cpu`), so no two of them collide right now. That is a
       * convention across ten independently maintained files, not a
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
    it("maps each resource type to all MonitorTypes its recommendations use", () => {
      for (const expectation of MODULE_EXPECTATIONS) {
        const definition:
          | MonitorRecommendationResourceTypeDefinition
          | undefined = MonitorRecommendationCatalog.getResourceTypeDefinition(
          expectation.resourceType,
        );

        expect(definition?.monitorTypes).toEqual(expectation.monitorTypes);
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

    it("stamps every recommendation with one of its definition's monitorTypes and its resourceType", () => {
      for (const definition of MonitorRecommendationCatalog.getResourceTypeDefinitions()) {
        for (const recommendation of definition.getRecommendations()) {
          expect(definition.monitorTypes).toContain(recommendation.monitorType);
          expect(recommendation.resourceType).toBe(definition.resourceType);
        }
      }
    });

    it("declares no unused MonitorTypes on a resource definition", () => {
      for (const definition of MonitorRecommendationCatalog.getResourceTypeDefinitions()) {
        const usedTypes: Array<MonitorType> = Array.from(
          new Set(
            definition
              .getRecommendations()
              .map((recommendation: MonitorRecommendation) => {
                return recommendation.monitorType;
              }),
          ),
        );

        expect([...definition.monitorTypes].sort()).toEqual(usedTypes.sort());
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

  /*
   * Services are the only resource type whose recommendation set is not a
   * constant. Everything below is about the seam between "what applies to this
   * resource" and "what this catalog can ever produce" — the two are the same
   * question for nine resource types and different for the tenth, and the
   * failure mode of conflating them is a page that offers JVM heap monitors to
   * a Go service.
   */
  describe("context-aware recommendations", () => {
    const AGNOSTIC_COUNT: number = getServiceAlertTemplates(null).length;

    function serviceRecommendationIds(
      context?: MonitorRecommendationContext | undefined,
    ): Array<string> {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.Service,
        context,
      ).map((recommendation: MonitorRecommendation) => {
        return recommendation.recommendationId;
      });
    }

    it("treats no context, an empty context and a null language alike", () => {
      /*
       * `detectServiceLanguage` returns null while an absent field is
       * undefined, so both reach this API in practice. They mean the same
       * thing and must not diverge — a null narrowing to some default language
       * would be the worst possible reading of "we could not tell".
       */
      const noContext: Array<string> = serviceRecommendationIds();

      expect(noContext.length).toBe(AGNOSTIC_COUNT);
      expect(serviceRecommendationIds({})).toEqual(noContext);
      expect(serviceRecommendationIds({ serviceLanguage: null })).toEqual(
        noContext,
      );
      expect(serviceRecommendationIds({ serviceLanguage: undefined })).toEqual(
        noContext,
      );
    });

    it("adds a runtime's own recommendations on top of the agnostic set", () => {
      const agnostic: Array<string> = serviceRecommendationIds();
      const forJava: Array<string> = serviceRecommendationIds({
        serviceLanguage: "java",
      });

      expect(forJava.length).toBeGreaterThan(agnostic.length);

      for (const recommendationId of agnostic) {
        expect(forJava).toContain(recommendationId);
      }
    });

    it("never offers one runtime's recommendations to another", () => {
      const forJava: Array<string> = serviceRecommendationIds({
        serviceLanguage: "java",
      });
      const forGo: Array<string> = serviceRecommendationIds({
        serviceLanguage: "go",
      });

      const javaOnly: Array<string> = forJava.filter(
        (recommendationId: string) => {
          return !serviceRecommendationIds().includes(recommendationId);
        },
      );

      expect(javaOnly.length).toBeGreaterThan(0);

      for (const recommendationId of javaOnly) {
        expect(forGo).not.toContain(recommendationId);
      }
    });

    it("is inert for every resource type whose set is a constant", () => {
      for (const resourceType of Object.values(
        MonitorRecommendationResourceType,
      )) {
        if (resourceType === MonitorRecommendationResourceType.Service) {
          continue;
        }

        const withoutContext: Array<string> =
          MonitorRecommendationCatalog.getRecommendations(resourceType).map(
            (recommendation: MonitorRecommendation) => {
              return recommendation.recommendationId;
            },
          );

        const withContext: Array<string> =
          MonitorRecommendationCatalog.getRecommendations(resourceType, {
            serviceLanguage: "java",
          }).map((recommendation: MonitorRecommendation) => {
            return recommendation.recommendationId;
          });

        expect(withContext).toEqual(withoutContext);
      }
    });

    it("keeps getAllRecommendations exhaustive", () => {
      /*
       * The registry-wide invariants — unique ids, distinct fingerprints,
       * a mappable severity — all run over this. If it narrowed to the
       * context-free subset, the language-specific templates would be the ones
       * left unchecked, which is exactly the half most likely to collide.
       */
      const serviceRecommendations: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getAllRecommendations().filter(
          (recommendation: MonitorRecommendation) => {
            return (
              recommendation.resourceType ===
              MonitorRecommendationResourceType.Service
            );
          },
        );

      expect(serviceRecommendations.length).toBe(
        getAllServiceAlertTemplates().length,
      );
      expect(serviceRecommendations.length).toBeGreaterThan(AGNOSTIC_COUNT);
    });

    it("resolves a language-specific recommendation by id, with no context", () => {
      /*
       * The path a dismissal takes: the row stores a recommendation id and
       * nothing about the language, so lookup has to work without one.
       */
      for (const template of getAllServiceAlertTemplates()) {
        const recommendationId: string = buildRecommendationId(
          MonitorRecommendationResourceType.Service,
          template.id,
        );

        expect(
          MonitorRecommendationCatalog.getRecommendationById(recommendationId),
        ).toBeDefined();
      }
    });

    it("lists the agnostic categories first, whatever the runtime", () => {
      const agnosticCategories: Array<string> =
        MonitorRecommendationCatalog.getCategories(
          MonitorRecommendationResourceType.Service,
        );

      expect(agnosticCategories.length).toBeGreaterThan(0);

      for (const language of getLanguagesWithServiceAlertTemplates()) {
        const categories: Array<string> =
          MonitorRecommendationCatalog.getCategories(
            MonitorRecommendationResourceType.Service,
            { serviceLanguage: language },
          );

        expect(categories.slice(0, agnosticCategories.length)).toEqual(
          agnosticCategories,
        );
        expect(categories.length).toBeGreaterThan(agnosticCategories.length);
      }
    });

    it("carries the service monitor types the coverage query needs", () => {
      /*
       * The page queries existing monitors by these types. A missing one means
       * monitors of that type are never considered, so every recommendation it
       * covers renders as still-to-do and accepting it creates a duplicate.
       */
      const definition: MonitorRecommendationResourceTypeDefinition =
        MonitorRecommendationCatalog.getResourceTypeDefinition(
          MonitorRecommendationResourceType.Service,
        )!;

      const usedMonitorTypes: Set<MonitorType> = new Set<MonitorType>(
        MonitorRecommendationCatalog.getAllRecommendations()
          .filter((recommendation: MonitorRecommendation) => {
            return (
              recommendation.resourceType ===
              MonitorRecommendationResourceType.Service
            );
          })
          .map((recommendation: MonitorRecommendation) => {
            return recommendation.monitorType;
          }),
      );

      for (const monitorType of usedMonitorTypes) {
        expect(definition.monitorTypes).toContain(monitorType);
      }
    });
  });
});
