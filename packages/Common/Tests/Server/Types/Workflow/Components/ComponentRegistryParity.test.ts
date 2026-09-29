/*
 * The runtime component registry reaches the native isolated-vm addon through
 * the JavaScript component's sandbox (Components/JavaScript -> VMRunner).
 * Nothing under test here runs a sandbox, and the prebuilt binary cannot
 * always dlopen in the test environment - so stub the module out before
 * anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../../../Models/DatabaseModels/Index";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import Services from "../../../../../Server/Services/Index";
import ComponentCode from "../../../../../Server/Types/Workflow/ComponentCode";
import RuntimeComponents from "../../../../../Server/Types/Workflow/Components/Index";
import BaseService from "../../../../../Server/Services/BaseService";
import EnableWorkflowOn from "../../../../../Types/BaseDatabase/EnableWorkflowOn";
import Dictionary from "../../../../../Types/Dictionary";
import Text from "../../../../../Types/Text";
import ComponentMetadata from "../../../../../Types/Workflow/Component";
import NonModelComponents from "../../../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../../../Types/Workflow/Components/BaseModel";

/*
 * A workflow step is resolved twice on the worker, against two registries that
 * are built from two different sources:
 *
 *   metadata - App/FeatureSet/Workflow/Utils/ComponentMetadata.ts walks
 *              Models/DatabaseModels/Index.ts and emits components for every
 *              model carrying @EnableWorkflow. This is also what fills the
 *              editor palette, so it decides what a user can drag onto a
 *              workflow and save.
 *   code     - Server/Types/Workflow/Components/Index.ts walks
 *              Server/Services/Index.ts and emits components for every
 *              REGISTERED DatabaseService whose model carries @EnableWorkflow.
 *              This is what RunWorkflow actually executes.
 *
 * A model that is workflow-enabled but whose service was never added to
 * Server/Services/Index.ts satisfies the first registry and not the second. Its
 * components appear in the palette, save into a workflow without complaint, and
 * then fail at execution time with
 * `BadDataException("Component <id> not found")` from RunWorkflow - the failure
 * that Dashboard shipped with, where `dashboard-update-one` was offered by the
 * editor while DashboardService was absent from Server/Services/Index.ts.
 *
 * Nothing in the type system ties the two lists together, so these tests are
 * the thing that keeps them in step.
 */

interface ModelComponents {
  modelName: string;
  tableName: string;
  enableWorkflowOn: EnableWorkflowOn;
  componentIds: Array<string>;
}

/*
 * Every model carrying @EnableWorkflow, whether or not it ends up contributing
 * components. Filtering the empty ones out here instead would make any
 * assertion phrased as "every workflow-enabled model ..." quietly exempt them,
 * which is how MetricType and TeamComplianceSetting - both annotated with all
 * four flags false - stay invisible to the palette while still being
 * workflow-annotated models.
 */
const workflowAnnotatedModels: Array<ModelComponents> = [];

for (const model of Entities) {
  const instance: DatabaseBaseModel = new model();

  if (!instance.enableWorkflowOn) {
    continue;
  }

  // Mirrors loadAllComponentMetadata() in App/FeatureSet/Workflow/Utils/ComponentMetadata.ts.
  const components: Array<ComponentMetadata> =
    BaseModelComponentFactory.getComponents(instance);

  workflowAnnotatedModels.push({
    modelName: model.name,
    tableName: instance.tableName!,
    enableWorkflowOn: instance.enableWorkflowOn,
    componentIds: components.map((component: ComponentMetadata) => {
      return component.id;
    }),
  });
}

// The subset the editor actually puts in front of a user.
const editorModelComponents: Array<ModelComponents> =
  workflowAnnotatedModels.filter((entry: ModelComponents) => {
    return entry.componentIds.length > 0;
  });

const allEditorModelComponentIds: Array<string> = editorModelComponents.flatMap(
  (entry: ModelComponents) => {
    return entry.componentIds;
  },
);

const registeredDatabaseServices: Array<DatabaseService<DatabaseBaseModel>> =
  Services.filter((service: BaseService) => {
    return service instanceof DatabaseService;
  }) as Array<DatabaseService<DatabaseBaseModel>>;

describe("Workflow component registry parity", () => {
  describe("editor palette vs worker runtime", () => {
    test("every model component the editor offers is runnable by the worker", () => {
      /*
       * Reported per model rather than per component id: one unregistered
       * service costs eleven component ids, and the model name is what points
       * at the missing Server/Services/Index.ts entry.
       */
      const modelsWithMissingComponents: Array<string> = editorModelComponents
        .filter((entry: ModelComponents) => {
          return entry.componentIds.some((id: string) => {
            return !RuntimeComponents[id];
          });
        })
        .map((entry: ModelComponents) => {
          return entry.modelName;
        });

      expect(modelsWithMissingComponents).toEqual([]);
    });

    test("every non-model component the editor offers is runnable by the worker", () => {
      const missing: Array<string> = NonModelComponents.filter(
        (component: ComponentMetadata) => {
          return !RuntimeComponents[component.id];
        },
      ).map((component: ComponentMetadata) => {
        return component.id;
      });

      expect(missing).toEqual([]);
    });

    test("the worker runs no model component the editor cannot produce", () => {
      /*
       * The other direction. A component the worker can run but the editor
       * never offers is not a user-visible failure, but it means the two id
       * derivations have drifted apart - which is the same defect pointed the
       * other way, and would hide the next real gap.
       */
      const editorIds: Set<string> = new Set(allEditorModelComponentIds);
      const nonModelIds: Set<string> = new Set(
        NonModelComponents.map((component: ComponentMetadata) => {
          return component.id;
        }),
      );

      const runtimeOnly: Array<string> = Object.keys(RuntimeComponents).filter(
        (id: string) => {
          return !editorIds.has(id) && !nonModelIds.has(id);
        },
      );

      expect(runtimeOnly).toEqual([]);
    });

    test("the two registries agree on the exact component id set", () => {
      const editorIds: Array<string> = [
        ...allEditorModelComponentIds,
        ...NonModelComponents.map((component: ComponentMetadata) => {
          return component.id;
        }),
      ].sort();

      expect(Object.keys(RuntimeComponents).sort()).toEqual(editorIds);
    });
  });

  describe("the palette is actually populated", () => {
    /*
     * Guards the parity assertions above against passing because both sides
     * are empty - an import that silently resolves to nothing would otherwise
     * turn this whole file green.
     */
    test("the editor offers components for many models", () => {
      expect(editorModelComponents.length).toBeGreaterThan(100);
    });

    test("the editor offers the non-model components too", () => {
      expect(NonModelComponents.length).toBeGreaterThan(0);
    });

    test("a model contributes components exactly when one of its flags is on", () => {
      /*
       * The invariant the palette actually rests on. Phrasing it as "every
       * workflow-enabled model contributes a component" would be false -
       * @EnableWorkflow with every flag false is legal and contributes nothing
       * - and phrasing it over the already-filtered list would make it
       * unfailable. Comparing the two conditions catches both a flag that
       * stops emitting components and a component emitted for a flag that is
       * switched off.
       */
      const disagreeing: Array<string> = workflowAnnotatedModels
        .filter((entry: ModelComponents) => {
          const anyFlagOn: boolean = Boolean(
            entry.enableWorkflowOn.create ||
              entry.enableWorkflowOn.read ||
              entry.enableWorkflowOn.update ||
              entry.enableWorkflowOn.delete,
          );

          const contributesComponents: boolean = entry.componentIds.length > 0;

          return anyFlagOn !== contributesComponents;
        })
        .map((entry: ModelComponents) => {
          return entry.modelName;
        });

      expect(disagreeing).toEqual([]);
    });

    test("the models annotated but inert are exactly the ones we know about", () => {
      /*
       * @EnableWorkflow with every flag false is legal and contributes nothing,
       * so such a model is outside the parity requirement further down. Naming
       * them rather than looping over whatever happens to be inert keeps that
       * exemption deliberate: a new inert model fails here and has to be
       * acknowledged, instead of quietly joining a list nothing asserts on.
       */
      const inert: Array<string> = workflowAnnotatedModels
        .filter((entry: ModelComponents) => {
          return entry.componentIds.length === 0;
        })
        .map((entry: ModelComponents) => {
          return entry.modelName;
        })
        .sort();

      expect(inert).toEqual(["MetricType", "TeamComplianceSetting"]);
    });
  });

  describe("Dashboard, the model this parity check was written for", () => {
    /*
     * Dashboard is workflow-enabled and exported from
     * Models/DatabaseModels/Index.ts, but DashboardService was missing from
     * Server/Services/Index.ts - only DashboardDomainService was there. Every
     * dashboard component was therefore offered by the editor and unrunnable.
     */
    test("dashboard-update-one is runnable", () => {
      expect(RuntimeComponents["dashboard-update-one"]).toBeDefined();
    });

    test("the whole dashboard component family is runnable", () => {
      const dashboard: ModelComponents | undefined = editorModelComponents.find(
        (entry: ModelComponents) => {
          return entry.modelName === "Dashboard";
        },
      );

      expect(dashboard).toBeDefined();

      const missing: Array<string> = dashboard!.componentIds.filter(
        (id: string) => {
          return !RuntimeComponents[id];
        },
      );

      expect(missing).toEqual([]);
    });

    test("the dashboard components cover create, read, update and delete", () => {
      for (const id of [
        "dashboard-create-one",
        "dashboard-create-many",
        "dashboard-find-one",
        "dashboard-find-many",
        "dashboard-update-one",
        "dashboard-update-many",
        "dashboard-delete-one",
        "dashboard-delete-many",
        "dashboard-on-create",
        "dashboard-on-update",
        "dashboard-on-delete",
      ]) {
        expect(RuntimeComponents[id]).toBeDefined();
      }
    });
  });

  describe("the service registry the runtime is built from", () => {
    test("every model the palette offers has a service registered in Server/Services/Index.ts", () => {
      const servicedTableNames: Set<string> = new Set(
        registeredDatabaseServices.map(
          (service: DatabaseService<DatabaseBaseModel>) => {
            return service.getModel().tableName!;
          },
        ),
      );

      const unserviced: Array<string> = editorModelComponents
        .filter((entry: ModelComponents) => {
          return !servicedTableNames.has(entry.tableName);
        })
        .map((entry: ModelComponents) => {
          return entry.modelName;
        });

      expect(unserviced).toEqual([]);
    });

    test("no service is registered twice", () => {
      /*
       * Services are singletons, so a duplicated entry is the same object
       * appearing twice - harmless to the registry, but it means an edit landed
       * in the array twice and the second copy will rot.
       */
      const seen: Set<BaseService> = new Set();
      const duplicated: Array<string> = [];

      for (const service of Services) {
        if (seen.has(service)) {
          duplicated.push(service.constructor.name);
        }
        seen.add(service);
      }

      expect(duplicated).toEqual([]);
    });

    test("no two registered services claim the same model", () => {
      const byTableName: Dictionary<Array<string>> = {};

      for (const service of registeredDatabaseServices) {
        const tableName: string = service.getModel().tableName!;
        byTableName[tableName] = byTableName[tableName] || [];
        byTableName[tableName]!.push(service.constructor.name);
      }

      const contested: Array<string> = Object.keys(byTableName).filter(
        (tableName: string) => {
          return byTableName[tableName]!.length > 1;
        },
      );

      expect(contested).toEqual([]);
    });
  });

  describe("runtime registry integrity", () => {
    test("every registered component is a ComponentCode", () => {
      const notComponentCode: Array<string> = Object.keys(
        RuntimeComponents,
      ).filter((id: string) => {
        return !(RuntimeComponents[id] instanceof ComponentCode);
      });

      expect(notComponentCode).toEqual([]);
    });

    test("every component is registered under the id its own metadata declares", () => {
      /*
       * Each model component derives its metadata from the service it was
       * constructed with, while the registry key is derived separately at the
       * call site. A component wired to the wrong service still registers
       * cleanly and then acts on the wrong table, so the two have to match.
       */
      const mismatched: Array<string> = [];

      for (const id of Object.keys(RuntimeComponents)) {
        const component: ComponentCode | undefined = RuntimeComponents[id];
        const declaredId: string = component!.getMetadata().id;

        if (declaredId !== id) {
          mismatched.push(`${id} -> ${declaredId}`);
        }
      }

      expect(mismatched).toEqual([]);
    });

    test("model component ids are derived from the table name", () => {
      for (const entry of editorModelComponents) {
        const prefix: string = Text.pascalCaseToDashes(entry.tableName);

        const wrongPrefix: Array<string> = entry.componentIds.filter(
          (id: string) => {
            return !id.startsWith(`${prefix}-`);
          },
        );

        expect(wrongPrefix).toEqual([]);
      }
    });

    test("no two models derive the same component id", () => {
      /*
       * Two models whose table names collapse to the same dashed id would
       * silently overwrite each other in the registry, leaving one model's
       * components pointing at the other model's service.
       */
      const owners: Dictionary<Array<string>> = {};

      for (const entry of editorModelComponents) {
        for (const id of entry.componentIds) {
          owners[id] = owners[id] || [];
          owners[id]!.push(entry.modelName);
        }
      }

      const collisions: Array<string> = Object.keys(owners).filter(
        (id: string) => {
          return owners[id]!.length > 1;
        },
      );

      expect(collisions).toEqual([]);
    });
  });
});
