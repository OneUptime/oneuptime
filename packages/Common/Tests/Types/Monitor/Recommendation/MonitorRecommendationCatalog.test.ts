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
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../../Types/ObjectID";

import { getAllCephAlertTemplates } from "../../../../Types/Monitor/CephAlertTemplates";
import { getAllDockerAlertTemplates } from "../../../../Types/Monitor/DockerAlertTemplates";
import { getAllDockerSwarmAlertTemplates } from "../../../../Types/Monitor/DockerSwarmAlertTemplates";
import { getAllHostAlertTemplates } from "../../../../Types/Monitor/HostAlertTemplates";
import { getAllIoTAlertTemplates } from "../../../../Types/Monitor/IotAlertTemplates";
import { getAllKubernetesAlertTemplates } from "../../../../Types/Monitor/KubernetesAlertTemplates";
import { getAllPodmanAlertTemplates } from "../../../../Types/Monitor/PodmanAlertTemplates";
import { getAllProxmoxAlertTemplates } from "../../../../Types/Monitor/ProxmoxAlertTemplates";
import {
  RumAlertTemplate,
  getAllRumAlertTemplates,
  getRumAlertTemplates,
} from "../../../../Types/Monitor/RumAlertTemplates";
import { getAllVMwareAlertTemplates } from "../../../../Types/Monitor/VMwareAlertTemplates";
import {
  StorageArrayAlertTemplate,
  getAllStorageArrayAlertTemplates,
  getStorageArrayAlertTemplatesForSystem,
} from "../../../../Types/Monitor/StorageArrayAlertTemplates";
import StorageSystem from "../../../../Types/StorageArray/StorageSystem";
import {
  getAllServiceAlertTemplates,
  getLanguagesWithServiceAlertTemplates,
  getServiceAlertTemplates,
} from "../../../../Types/Monitor/ServiceAlertTemplates";
import {
  DatabaseAlertTemplate,
  getAllDatabaseAlertTemplates,
  getDatabaseAlertTemplates,
  getDatabaseEnginesWithAlertTemplates,
} from "../../../../Types/Monitor/DatabaseAlertTemplates";

/*
 * Resource types whose recommendation set is EMPTY without context, on
 * purpose: a database with no known engine has no template that applies to
 * it (every database template reads one engine receiver's metrics), and a
 * storage array with no known platform has none either (every template
 * reads one platform's purefa_* or purefb_* metrics). Every other resource
 * type has a non-empty context-free subset, and the tests below keep
 * holding them to that.
 */
const RESOURCE_TYPES_WITHOUT_CONTEXT_FREE_SUBSET: Array<MonitorRecommendationResourceType> =
  [
    MonitorRecommendationResourceType.DatabaseServer,
    MonitorRecommendationResourceType.StorageArray,
  ];

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
   * Everything the module can ever produce. For the resource types whose set
   * is a constant this is also what the page shows; for Service it is the
   * union across every runtime, for Database across every engine, and for RUM
   * it includes the session replay budget alerts.
   */
  templateCount: number;
  /*
   * What `getRecommendations(resourceType)` returns with NO context — what a
   * caller that knows nothing about the specific resource is offered. Equal to
   * `templateCount` for every resource type whose set is a constant, and
   * smaller for Service (the language-agnostic subset), Database (nothing)
   * and RUM (everything but the budget alerts).
   */
  contextFreeTemplateCount: number;
  identifierFieldName:
    | "clusterIdentifier"
    | "vcenterIdentifier"
    | "hostIdentifier"
    | "fleetIdentifier"
    | "arrayIdentifier"
    | "rumApplicationId"
    | "serviceId"
    | "databaseServerId";
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
    resourceType: MonitorRecommendationResourceType.VMware,
    monitorTypes: [MonitorType.VMware],
    templateCount: getAllVMwareAlertTemplates().length,
    contextFreeTemplateCount: getAllVMwareAlertTemplates().length,
    identifierFieldName: "vcenterIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.Ceph,
    monitorTypes: [MonitorType.Ceph],
    templateCount: getAllCephAlertTemplates().length,
    contextFreeTemplateCount: getAllCephAlertTemplates().length,
    identifierFieldName: "clusterIdentifier",
  },
  {
    resourceType: MonitorRecommendationResourceType.StorageArray,
    monitorTypes: [MonitorType.StorageArray],
    templateCount: getAllStorageArrayAlertTemplates().length,
    /*
     * Zero, and deliberately so — see RESOURCE_TYPES_WITHOUT_CONTEXT_FREE_SUBSET.
     * An array whose platform is not known yet is offered nothing.
     */
    contextFreeTemplateCount: 0,
    identifierFieldName: "arrayIdentifier",
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
    /*
     * Everything but the session replay budget alerts, which wait until the
     * application is known to record replays. `getRumAlertTemplates(undefined)`
     * is the module's own answer to "what applies to an application we know
     * nothing about".
     */
    contextFreeTemplateCount: getRumAlertTemplates(undefined).length,
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
  {
    resourceType: MonitorRecommendationResourceType.DatabaseServer,
    monitorTypes: [MonitorType.Metrics],
    templateCount: getAllDatabaseAlertTemplates().length,
    /*
     * Zero, and deliberately so — see RESOURCE_TYPES_WITHOUT_CONTEXT_FREE_SUBSET.
     * `getDatabaseAlertTemplates(null)` is the module's own answer to "what
     * applies to a database whose engine is unknown".
     */
    contextFreeTemplateCount: getDatabaseAlertTemplates(null).length,
    identifierFieldName: "databaseServerId",
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

        if (
          RESOURCE_TYPES_WITHOUT_CONTEXT_FREE_SUBSET.includes(
            expectation.resourceType,
          )
        ) {
          expect(expectation.contextFreeTemplateCount).toBe(0);
        } else {
          expect(expectation.contextFreeTemplateCount).toBeGreaterThan(0);
        }

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

    /*
     * Both run over EVERY recommendation a type can produce, not the
     * context-free subset: a database has no context-free subset at all, and a
     * service's is missing every runtime template — checking only that would
     * leave exactly the engine- and runtime-specific half unchecked.
     */
    it("stamps every recommendation with one of its definition's monitorTypes and its resourceType", () => {
      for (const definition of MonitorRecommendationCatalog.getResourceTypeDefinitions()) {
        const recommendations: Array<MonitorRecommendation> =
          MonitorRecommendationCatalog.getAllPossibleRecommendations(
            definition.resourceType,
          );

        expect(recommendations.length).toBeGreaterThan(0);

        for (const recommendation of recommendations) {
          expect(definition.monitorTypes).toContain(recommendation.monitorType);
          expect(recommendation.resourceType).toBe(definition.resourceType);
        }
      }
    });

    it("declares no unused MonitorTypes on a resource definition", () => {
      for (const definition of MonitorRecommendationCatalog.getResourceTypeDefinitions()) {
        const usedTypes: Array<MonitorType> = Array.from(
          new Set(
            MonitorRecommendationCatalog.getAllPossibleRecommendations(
              definition.resourceType,
            ).map((recommendation: MonitorRecommendation) => {
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
   * Services were the first resource type whose recommendation set is not a
   * constant (databases and RUM applications have suites of their own below).
   * Everything here is about the seam between "what applies to this resource"
   * and "what this catalog can ever produce" — the same question for every
   * resource type whose set is a constant, and a different one for these, and
   * the failure mode of conflating them is a page that offers JVM heap
   * monitors to a Go service.
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
        /*
         * The three resource types whose set is NOT a constant, each with a
         * suite of its own below: a service by runtime, a database by engine,
         * and a RUM application by whether it records session replays (its
         * budget alerts).
         */
        if (
          resourceType === MonitorRecommendationResourceType.Service ||
          resourceType === MonitorRecommendationResourceType.DatabaseServer ||
          resourceType === MonitorRecommendationResourceType.RumApplication
        ) {
          continue;
        }

        const withoutContext: Array<string> =
          MonitorRecommendationCatalog.getRecommendations(resourceType).map(
            (recommendation: MonitorRecommendation) => {
              return recommendation.recommendationId;
            },
          );

        /*
         * Every fact any resource type reads, set to the value that moves its
         * own list the most, so a constant set that started reading one of
         * them would change here.
         */
        const withContext: Array<string> =
          MonitorRecommendationCatalog.getRecommendations(resourceType, {
            serviceLanguage: "java",
            databaseEngine: "postgresql",
            databaseEngineMetricsReported: true,
            sessionReplayEnabled: true,
            sessionReplayHasRecorded: true,
            sessionReplayMonthlyBudgetInGB: 10,
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

  /*
   * Databases: the second context-dependent resource type, and the first
   * whose context-free set is empty. The failure modes mirror Service's —
   * a PostgreSQL monitor offered to a Redis server — plus one of their own:
   * a monitor offered to a database whose engine metrics never arrive, which
   * either never fires or (Engine Metrics Stopped) fires the moment it is
   * created.
   */
  describe("database recommendations", () => {
    function databaseRecommendationIds(
      context?: MonitorRecommendationContext | undefined,
    ): Array<string> {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.DatabaseServer,
        context,
      ).map((recommendation: MonitorRecommendation) => {
        return recommendation.recommendationId;
      });
    }

    function templateIdsFor(engine: string): Array<string> {
      return getDatabaseAlertTemplates(engine).map(
        (template: DatabaseAlertTemplate) => {
          return buildRecommendationId(
            MonitorRecommendationResourceType.DatabaseServer,
            template.id,
          );
        },
      );
    }

    it("offers nothing when the engine is not known", () => {
      expect(databaseRecommendationIds()).toEqual([]);
      expect(databaseRecommendationIds({})).toEqual([]);
      expect(databaseRecommendationIds({ databaseEngine: null })).toEqual([]);
      expect(databaseRecommendationIds({ databaseEngine: "" })).toEqual([]);
      expect(
        databaseRecommendationIds({ databaseEngineMetricsReported: true }),
      ).toEqual([]);
    });

    it("offers exactly the engine's templates, in the module's order", () => {
      for (const engine of getDatabaseEnginesWithAlertTemplates()) {
        expect(
          databaseRecommendationIds({
            databaseEngine: engine,
            databaseEngineMetricsReported: true,
          }),
        ).toEqual(templateIdsFor(engine));
      }
    });

    it("withholds everything from a database whose engine metrics never arrived", () => {
      for (const engine of getDatabaseEnginesWithAlertTemplates()) {
        expect(
          databaseRecommendationIds({
            databaseEngine: engine,
            databaseEngineMetricsReported: false,
          }),
        ).toEqual([]);
      }
    });

    it("treats an unknown metrics state as 'do not withhold'", () => {
      for (const reported of [null, undefined]) {
        expect(
          databaseRecommendationIds({
            databaseEngine: "postgresql",
            databaseEngineMetricsReported: reported,
          }),
        ).toEqual(templateIdsFor("postgresql"));
      }
    });

    it("never offers one engine's recommendations to another", () => {
      const forPostgres: Array<string> = databaseRecommendationIds({
        databaseEngine: "postgresql",
      });
      const forRedis: Array<string> = databaseRecommendationIds({
        databaseEngine: "redis",
      });

      expect(forPostgres.length).toBeGreaterThan(0);
      expect(forRedis.length).toBeGreaterThan(0);

      for (const recommendationId of forPostgres) {
        expect(forRedis).not.toContain(recommendationId);
      }
    });

    it("offers a fork its family receiver's recommendations", () => {
      expect(databaseRecommendationIds({ databaseEngine: "mariadb" })).toEqual(
        databaseRecommendationIds({ databaseEngine: "mysql" }),
      );
      expect(databaseRecommendationIds({ databaseEngine: "valkey" })).toEqual(
        databaseRecommendationIds({ databaseEngine: "redis" }),
      );
    });

    it("offers nothing for an engine no template receiver covers", () => {
      expect(
        databaseRecommendationIds({ databaseEngine: "cassandra" }),
      ).toEqual([]);
    });

    it("keeps the two context-dependent resource types independent", () => {
      expect(databaseRecommendationIds({ serviceLanguage: "java" })).toEqual(
        [],
      );

      const serviceIds: Array<string> =
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.Service,
        ).map((recommendation: MonitorRecommendation) => {
          return recommendation.recommendationId;
        });

      expect(
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.Service,
          { databaseEngine: "postgresql" },
        ).map((recommendation: MonitorRecommendation) => {
          return recommendation.recommendationId;
        }),
      ).toEqual(serviceIds);
    });

    it("stays exhaustive and resolvable by id with no context", () => {
      const all: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getAllPossibleRecommendations(
          MonitorRecommendationResourceType.DatabaseServer,
        );

      expect(all.length).toBe(getAllDatabaseAlertTemplates().length);

      for (const recommendation of all) {
        expect(recommendation.monitorType).toBe(MonitorType.Metrics);
        expect(
          MonitorRecommendationCatalog.getRecommendationById(
            recommendation.recommendationId,
          )?.templateId,
        ).toBe(recommendation.templateId);
      }
    });

    it("threads the database id into every query of every recommendation", () => {
      const databaseServerId: string = "d0000000-0000-4000-8000-000000000007";

      for (const recommendation of MonitorRecommendationCatalog.getAllPossibleRecommendations(
        MonitorRecommendationResourceType.DatabaseServer,
      )) {
        const step: MonitorStep = recommendation.getMonitorStep({
          resourceIdentifier: databaseServerId,
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "PostgreSQL db.prod:5432",
        });

        for (const queryConfig of step.data!.metricMonitor!.metricViewConfig
          .queryConfigs) {
          expect(
            (
              queryConfig.metricQueryData.filterData.attributes as Record<
                string,
                unknown
              >
            )["oneuptime.database.server.id"],
          ).toBe(databaseServerId);
        }
      }
    });

    it("lists categories in first-declaration order for an engine", () => {
      const categories: Array<string> =
        MonitorRecommendationCatalog.getCategories(
          MonitorRecommendationResourceType.DatabaseServer,
          { databaseEngine: "postgresql" },
        );

      // Availability (Engine Metrics Stopped) always leads.
      expect(categories[0]).toBe("Availability");
      expect(new Set(categories).size).toBe(categories.length);
    });
  });

  /*
   * Storage arrays: the platform decides the set. A FlashBlade exports no
   * purefa_* series, so a FlashArray template on it would be a monitor that
   * can never fire.
   */
  describe("storage array recommendations", () => {
    function storageArrayTemplateIds(
      context?: MonitorRecommendationContext | undefined,
    ): Array<string> {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.StorageArray,
        context,
      ).map((recommendation: MonitorRecommendation) => {
        return recommendation.templateId;
      });
    }

    function idsFor(system: StorageSystem): Array<string> {
      return getAllStorageArrayAlertTemplates()
        .filter((template: StorageArrayAlertTemplate) => {
          return template.storageSystems.includes(system);
        })
        .map((template: StorageArrayAlertTemplate) => {
          return template.id;
        });
    }

    it("offers a FlashArray only the FlashArray templates", () => {
      const ids: Array<string> = storageArrayTemplateIds({
        storageSystem: StorageSystem.PureStorageFlashArray,
      });

      expect(ids).toEqual(idsFor(StorageSystem.PureStorageFlashArray));
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(id.startsWith("purefa-")).toBe(true);
      }
    });

    it("offers a FlashBlade only the FlashBlade templates", () => {
      const ids: Array<string> = storageArrayTemplateIds({
        storageSystem: StorageSystem.PureStorageFlashBlade,
      });

      expect(ids).toEqual(idsFor(StorageSystem.PureStorageFlashBlade));
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(id.startsWith("purefb-")).toBe(true);
      }
    });

    it("offers nothing to an array that has not reported its platform yet", () => {
      /*
       * Offering both platforms' sets would put two "Critical Array Alert"
       * cards on one array, one of which could never fire.
       */
      expect(storageArrayTemplateIds()).toEqual([]);
      expect(storageArrayTemplateIds({})).toEqual([]);
      expect(storageArrayTemplateIds({ storageSystem: null })).toEqual([]);
    });

    it("offers nothing to an array of a platform OneUptime ships no templates for", () => {
      expect(
        storageArrayTemplateIds({ storageSystem: "netapp.ontap" }),
      ).toEqual([]);
      // The module itself would hand such a platform every template.
      expect(
        getStorageArrayAlertTemplatesForSystem("netapp.ontap").length,
      ).toBe(getAllStorageArrayAlertTemplates().length);
    });

    it("the two platforms' sets partition the whole catalog", () => {
      const flashArray: Array<string> = storageArrayTemplateIds({
        storageSystem: StorageSystem.PureStorageFlashArray,
      });
      const flashBlade: Array<string> = storageArrayTemplateIds({
        storageSystem: StorageSystem.PureStorageFlashBlade,
      });

      expect(
        flashArray.filter((id: string) => {
          return flashBlade.includes(id);
        }),
      ).toEqual([]);
      expect([...flashArray, ...flashBlade].sort()).toEqual(
        getAllStorageArrayAlertTemplates()
          .map((template: StorageArrayAlertTemplate) => {
            return template.id;
          })
          .sort(),
      );
    });

    it("ignores context meant for other resource types", () => {
      expect(
        storageArrayTemplateIds({
          storageSystem: StorageSystem.PureStorageFlashArray,
          databaseEngine: "postgresql",
          serviceLanguage: null,
        }),
      ).toEqual(idsFor(StorageSystem.PureStorageFlashArray));
    });

    it("stays exhaustive and resolvable by id with no context", () => {
      const all: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getAllPossibleRecommendations(
          MonitorRecommendationResourceType.StorageArray,
        );

      expect(all.length).toBe(getAllStorageArrayAlertTemplates().length);

      for (const recommendation of all) {
        expect(recommendation.monitorType).toBe(MonitorType.StorageArray);
        expect(
          MonitorRecommendationCatalog.getRecommendationById(
            recommendation.recommendationId,
          )?.templateId,
        ).toBe(recommendation.templateId);
      }
    });

    it("threads the array identifier into every recommendation's step", () => {
      for (const recommendation of MonitorRecommendationCatalog.getAllPossibleRecommendations(
        MonitorRecommendationResourceType.StorageArray,
      )) {
        const step: MonitorStep = recommendation.getMonitorStep({
          resourceIdentifier: "pure-prod-01",
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "pure-prod-01",
        });

        expect(step.data!.storageArrayMonitor!.arrayIdentifier).toBe(
          "pure-prod-01",
        );
      }
    });
  });

  /*
   * RUM applications: the third context-dependent resource type. Every
   * application is offered the same web vital and error recommendations, but
   * the session replay budget alerts only once the application records
   * replays (and, for the monthly pair, has a monthly budget) - the sweep
   * writes nothing for any other application, so each would be a monitor
   * that can never fire. The page's side-menu badge counts from the same
   * answer, so a wrong one inflates the badge on every RUM application.
   */
  describe("RUM application recommendations", () => {
    const FULL_REPLAY_CONTEXT: MonitorRecommendationContext = {
      sessionReplayEnabled: true,
      sessionReplayHasRecorded: true,
      sessionReplayMonthlyBudgetInGB: 10,
    };

    const BUDGET_TEMPLATE_IDS: Array<string> = [
      "rum-session-replay-daily-budget-nearly-spent",
      "rum-session-replay-daily-budget-spent",
      "rum-session-replay-monthly-budget-nearly-spent",
      "rum-session-replay-monthly-budget-spent",
    ];

    function rumRecommendationIds(
      context?: MonitorRecommendationContext | undefined,
    ): Array<string> {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.RumApplication,
        context,
      ).map((recommendation: MonitorRecommendation) => {
        return recommendation.recommendationId;
      });
    }

    function idsOf(templates: Array<RumAlertTemplate>): Array<string> {
      return templates.map((template: RumAlertTemplate) => {
        return buildRecommendationId(
          MonitorRecommendationResourceType.RumApplication,
          template.id,
        );
      });
    }

    it("offers the original seven when nothing is known about the application", () => {
      const contextFree: Array<string> = rumRecommendationIds();

      expect(contextFree).toHaveLength(7);
      expect(contextFree).toEqual(idsOf(getRumAlertTemplates(undefined)));
      expect(rumRecommendationIds({})).toEqual(contextFree);

      for (const templateId of BUDGET_TEMPLATE_IDS) {
        expect(contextFree).not.toContain(
          buildRecommendationId(
            MonitorRecommendationResourceType.RumApplication,
            templateId,
          ),
        );
      }
    });

    it("offers all eleven, in the module's order, to an application that records and has a budget", () => {
      const offered: Array<string> = rumRecommendationIds(FULL_REPLAY_CONTEXT);

      expect(offered).toHaveLength(11);
      expect(offered).toEqual(idsOf(getAllRumAlertTemplates()));
    });

    /*
     * The adapter re-assembles the module's context field by field, so a
     * field it forgot to forward would read as "not known" - withholding the
     * alerts on every page while every other test stays green. One case per
     * field: each moves the count, so each must have arrived.
     */
    it("forwards every replay fact to the module", () => {
      expect(
        rumRecommendationIds({
          sessionReplayEnabled: true,
          sessionReplayHasRecorded: true,
        }),
      ).toEqual(
        idsOf(
          getRumAlertTemplates({
            sessionReplayEnabled: true,
            sessionReplayHasRecorded: true,
          }),
        ),
      );
      expect(
        rumRecommendationIds({
          sessionReplayEnabled: true,
          sessionReplayHasRecorded: true,
        }),
      ).toHaveLength(9);
      expect(
        rumRecommendationIds({
          ...FULL_REPLAY_CONTEXT,
          sessionReplayEnabled: false,
        }),
      ).toHaveLength(7);
      expect(
        rumRecommendationIds({
          ...FULL_REPLAY_CONTEXT,
          sessionReplayHasRecorded: false,
        }),
      ).toHaveLength(7);
      expect(
        rumRecommendationIds({
          ...FULL_REPLAY_CONTEXT,
          sessionReplayMonthlyBudgetInGB: 0,
        }),
      ).toHaveLength(9);
    });

    it("stays exhaustive, and resolves every budget recommendation by id with no context", () => {
      /*
       * The path a dismissal takes: the row stores a recommendation id and
       * nothing about the application, so lookup has to work without one.
       */
      const all: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getAllPossibleRecommendations(
          MonitorRecommendationResourceType.RumApplication,
        );

      expect(all).toHaveLength(11);
      expect(all.length).toBe(getAllRumAlertTemplates().length);

      for (const templateId of BUDGET_TEMPLATE_IDS) {
        const recommendation: MonitorRecommendation | undefined =
          MonitorRecommendationCatalog.getRecommendationById(
            buildRecommendationId(
              MonitorRecommendationResourceType.RumApplication,
              templateId,
            ),
          );

        expect(recommendation).toBeDefined();
        expect(recommendation?.templateId).toBe(templateId);
        expect(recommendation?.resourceType).toBe(
          MonitorRecommendationResourceType.RumApplication,
        );
        expect(recommendation?.monitorType).toBe(MonitorType.Metrics);
        expect(recommendation?.category).toBe("Session Replay");
      }
    });

    it("lists Session Replay last, and only once the budget alerts are offered", () => {
      const contextFreeCategories: Array<string> =
        MonitorRecommendationCatalog.getCategories(
          MonitorRecommendationResourceType.RumApplication,
        );
      const fullCategories: Array<string> =
        MonitorRecommendationCatalog.getCategories(
          MonitorRecommendationResourceType.RumApplication,
          FULL_REPLAY_CONTEXT,
        );

      expect(contextFreeCategories).toEqual(["Core Web Vitals", "Errors"]);
      expect(fullCategories).toEqual([
        ...contextFreeCategories,
        "Session Replay",
      ]);
      expect(fullCategories[fullCategories.length - 1]).toBe("Session Replay");
    });

    it("scopes every budget recommendation's step to the application id", () => {
      const rumApplicationId: string = ObjectID.generate().toString();

      const budgetRecommendations: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.RumApplication,
          FULL_REPLAY_CONTEXT,
        ).filter((item: MonitorRecommendation) => {
          return item.category === "Session Replay";
        });

      // Or the loop below would pass having checked nothing.
      expect(
        budgetRecommendations.map((recommendation: MonitorRecommendation) => {
          return recommendation.templateId;
        }),
      ).toEqual(BUDGET_TEMPLATE_IDS);

      for (const recommendation of budgetRecommendations) {
        const step: MonitorStep = recommendation.getMonitorStep({
          resourceIdentifier: rumApplicationId,
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "Storefront",
        });

        expect(
          step.data?.metricMonitor?.telemetryServiceIds?.map((id: ObjectID) => {
            return id.toString();
          }),
        ).toEqual([rumApplicationId]);
      }
    });

    it("keeps the three context-dependent resource types independent", () => {
      // Replay facts change nothing for a service or a database...
      expect(
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.Service,
          FULL_REPLAY_CONTEXT,
        ).map((recommendation: MonitorRecommendation) => {
          return recommendation.recommendationId;
        }),
      ).toEqual(
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.Service,
        ).map((recommendation: MonitorRecommendation) => {
          return recommendation.recommendationId;
        }),
      );
      expect(
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.DatabaseServer,
          FULL_REPLAY_CONTEXT,
        ),
      ).toEqual([]);

      // ...and a runtime or an engine changes nothing for a RUM application.
      expect(
        rumRecommendationIds({
          serviceLanguage: "java",
          databaseEngine: "postgresql",
          databaseEngineMetricsReported: true,
        }),
      ).toEqual(rumRecommendationIds());
    });
  });
});
