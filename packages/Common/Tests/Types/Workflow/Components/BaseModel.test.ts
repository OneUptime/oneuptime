import BaseModelComponent from "../../../../Types/Workflow/Components/BaseModel";
import Text from "../../../../Types/Text";
import ComponentMetadata, {
  ComponentType,
} from "../../../../Types/Workflow/Component";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EnableWorkflowOn from "../../../../Types/BaseDatabase/EnableWorkflowOn";

/*
 * BaseModelComponent.getComponents turns a model's enableWorkflowOn flags into
 * the palette of workflow blocks offered for that model. Each flag unlocks a
 * fixed set of blocks, and every block id is namespaced by the table name, so
 * the mapping is worth pinning: a resource that quietly stops offering its
 * create/update/delete blocks, or starts colliding ids with another table, is
 * invisible until someone opens the workflow builder.
 */

type FakeModelOptions = {
  enableWorkflowOn?: EnableWorkflowOn | undefined;
  tableName?: string;
  singularName?: string;
  pluralName?: string;
};

const makeModel: (options: FakeModelOptions) => BaseModel = (
  options: FakeModelOptions,
): BaseModel => {
  return {
    enableWorkflowOn: options.enableWorkflowOn,
    tableName: options.tableName ?? "WidgetGizmo",
    singularName: options.singularName ?? "Widget",
    pluralName: options.pluralName ?? "Widgets",
  } as unknown as BaseModel;
};

const idsOf: (components: Array<ComponentMetadata>) => Array<string> = (
  components: Array<ComponentMetadata>,
): Array<string> => {
  return components.map((component: ComponentMetadata) => {
    return component.id;
  });
};

describe("BaseModelComponent.getComponents", () => {
  test("returns nothing when workflows are not enabled on the model", () => {
    expect(
      BaseModelComponent.getComponents(
        makeModel({ enableWorkflowOn: undefined }),
      ),
    ).toEqual([]);
  });

  test("returns nothing when every flag is off", () => {
    expect(
      BaseModelComponent.getComponents(makeModel({ enableWorkflowOn: {} })),
    ).toEqual([]);
  });

  test("read unlocks exactly find-one and find-many", () => {
    const prefix: string = Text.pascalCaseToDashes("WidgetGizmo");

    const components: Array<ComponentMetadata> =
      BaseModelComponent.getComponents(
        makeModel({ enableWorkflowOn: { read: true } }),
      );

    expect(idsOf(components)).toEqual([
      `${prefix}-find-one`,
      `${prefix}-find-many`,
    ]);
  });

  test("create, update and delete each unlock their trigger + one + many", () => {
    const prefix: string = Text.pascalCaseToDashes("WidgetGizmo");

    const create: Array<string> = idsOf(
      BaseModelComponent.getComponents(
        makeModel({ enableWorkflowOn: { create: true } }),
      ),
    );
    expect(create).toEqual([
      `${prefix}-on-create`,
      `${prefix}-create-one`,
      `${prefix}-create-many`,
    ]);

    const update: Array<string> = idsOf(
      BaseModelComponent.getComponents(
        makeModel({ enableWorkflowOn: { update: true } }),
      ),
    );
    expect(update).toEqual([
      `${prefix}-on-update`,
      `${prefix}-update-one`,
      `${prefix}-update-many`,
    ]);

    const del: Array<string> = idsOf(
      BaseModelComponent.getComponents(
        makeModel({ enableWorkflowOn: { delete: true } }),
      ),
    );
    expect(del).toEqual([
      `${prefix}-on-delete`,
      `${prefix}-delete-one`,
      `${prefix}-delete-many`,
    ]);
  });

  test("all four flags together yield 11 unique, table-scoped components", () => {
    const components: Array<ComponentMetadata> =
      BaseModelComponent.getComponents(
        makeModel({
          enableWorkflowOn: {
            read: true,
            create: true,
            update: true,
            delete: true,
          },
        }),
      );

    expect(components.length).toBe(11);

    const ids: Array<string> = idsOf(components);
    expect(new Set<string>(ids).size).toBe(ids.length);

    const prefix: string = Text.pascalCaseToDashes("WidgetGizmo");
    for (const id of ids) {
      expect(id.startsWith(prefix)).toBe(true);
    }
  });

  test("ids are namespaced by table name, so two tables never collide", () => {
    const widget: Array<string> = idsOf(
      BaseModelComponent.getComponents(
        makeModel({
          tableName: "WidgetGizmo",
          enableWorkflowOn: { read: true },
        }),
      ),
    );
    const gadget: Array<string> = idsOf(
      BaseModelComponent.getComponents(
        makeModel({
          tableName: "GadgetThing",
          enableWorkflowOn: { read: true },
        }),
      ),
    );

    for (const id of widget) {
      expect(gadget).not.toContain(id);
    }
  });

  test("blocks carry the model's names and a column hint explaining _id", () => {
    const components: Array<ComponentMetadata> =
      BaseModelComponent.getComponents(
        makeModel({
          singularName: "Widget",
          pluralName: "Widgets",
          enableWorkflowOn: { read: true, create: true },
        }),
      );

    const findMany: ComponentMetadata | undefined = components.find(
      (component: ComponentMetadata) => {
        return component.title === "Find Many Widgets";
      },
    );
    expect(findMany).toBeTruthy();

    const createOne: ComponentMetadata | undefined = components.find(
      (component: ComponentMetadata) => {
        return component.title === "Create One Widget";
      },
    );
    expect(createOne).toBeTruthy();

    // The _id-vs-id hint is the whole reason the description text exists.
    const query: { description?: string } | undefined = (
      findMany?.arguments as Array<{ id: string; description?: string }>
    ).find((argument: { id: string }) => {
      return argument.id === "query";
    });
    expect(query?.description).toContain('"_id"');
  });

  test("triggers are entry points (no in-port); regular blocks are connectable", () => {
    const components: Array<ComponentMetadata> =
      BaseModelComponent.getComponents(
        makeModel({
          enableWorkflowOn: {
            read: true,
            create: true,
            update: true,
            delete: true,
          },
        }),
      );

    for (const component of components) {
      // Every block, trigger or not, has to lead somewhere.
      expect((component.outPorts ?? []).length).toBeGreaterThan(0);

      if (component.componentType === ComponentType.Trigger) {
        // A trigger starts a workflow, so it takes no incoming connection.
        expect((component.inPorts ?? []).length).toBe(0);
      } else {
        expect(component.componentType).toBe(ComponentType.Component);
        // A regular block is useless if nothing can connect into it.
        expect((component.inPorts ?? []).length).toBeGreaterThan(0);
      }
    }

    // The three change-triggers are exactly the Trigger-typed blocks.
    const triggers: Array<ComponentMetadata> = components.filter(
      (component: ComponentMetadata) => {
        return component.componentType === ComponentType.Trigger;
      },
    );
    expect(triggers.length).toBe(3);
  });
});
