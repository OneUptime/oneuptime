import { describe, expect, test } from "@jest/globals";
import {
  ComponentArgument,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  KubernetesCommonArgumentsOptions,
  KubernetesDisplaySection,
  KubernetesFiltersSection,
  getKubernetesCommonArguments,
} from "../../../../Utils/Dashboard/Components/DashboardKubernetesResourceListShared";

/*
 * getKubernetesCommonArguments builds the shared config-form fields for every
 * Kubernetes resource-list widget (pods, deployments, services, ...). It is a
 * fixed sequence of args.push() calls with exactly one conditional branch: the
 * "Namespaces" text filter is appended only when
 * options.includeNamespaceFilter is true.
 *
 * The failure modes worth guarding are the quiet ones the compiler cannot see:
 *  - the namespace branch leaking into a widget that has no namespaces, or
 *    being dropped from one that does;
 *  - an argument being mis-sectioned so a Display option renders under Filters
 *    (or vice-versa), since section is what the editor groups fields by;
 *  - a wrong ComponentInputType or a wrong entityFilterModelType, which would
 *    render the wrong editor or wire the cluster picker to the wrong model;
 *  - a duplicated id, which silently makes the second field overwrite the
 *    first's stored value;
 *  - the function returning a shared/mutated array across calls, which would
 *    let one widget's edited config bleed into the next.
 *
 * All inputs are pure booleans, so the whole suite is deterministic with no
 * mocks, network, DB, clock, or randomness.
 */

type Args = Array<ComponentArgument<DashboardBaseComponent>>;

const withNamespace: KubernetesCommonArgumentsOptions = {
  includeNamespaceFilter: true,
};

const withoutNamespace: KubernetesCommonArgumentsOptions = {
  includeNamespaceFilter: false,
};

function build(withNamespaceFilter: boolean): Args {
  return getKubernetesCommonArguments<DashboardBaseComponent>({
    includeNamespaceFilter: withNamespaceFilter,
  });
}

function findById(
  args: Args,
  id: string,
): ComponentArgument<DashboardBaseComponent> {
  const match: ComponentArgument<DashboardBaseComponent> | undefined =
    args.find((a: ComponentArgument<DashboardBaseComponent>) => {
      return String(a.id) === id;
    });
  if (!match) {
    throw new Error(`Expected an argument with id "${id}" but none was found`);
  }
  return match;
}

describe("getKubernetesCommonArguments", () => {
  describe("argument count and namespace branch", () => {
    test("includes the namespace filter as a 5th argument when requested", () => {
      const args: Args = build(true);
      expect(args).toHaveLength(5);
    });

    test("omits the namespace filter when not requested", () => {
      const args: Args = build(false);
      expect(args).toHaveLength(4);
    });

    test("the only structural difference between the two modes is the Namespaces field", () => {
      const withNs: Args = build(true);
      const withoutNs: Args = build(false);

      /*
       * The first four arguments must be identical in both modes; the branch
       * appends, it must never re-order or alter the fields before it.
       */
      expect(withNs.slice(0, 4)).toEqual(withoutNs);

      const extra: ComponentArgument<DashboardBaseComponent> | undefined =
        withNs[4];
      expect(extra).toBeDefined();
      expect(String(extra!.id)).toBe("namespaces");
    });

    test("the namespaces argument is absent (not merely undefined) when excluded", () => {
      const args: Args = build(false);
      const ids: Array<string> = args.map(
        (a: ComponentArgument<DashboardBaseComponent>) => {
          return String(a.id);
        },
      );
      expect(ids).not.toContain("namespaces");
    });
  });

  describe("argument order and identity", () => {
    test("arguments are emitted in a stable, documented order (with namespace)", () => {
      const ids: Array<string> = build(true).map(
        (a: ComponentArgument<DashboardBaseComponent>) => {
          return String(a.id);
        },
      );
      expect(ids).toEqual([
        "title",
        "maxRows",
        "viewMode",
        "kubernetesClusterIds",
        "namespaces",
      ]);
    });

    test("arguments are emitted in a stable order (without namespace)", () => {
      const ids: Array<string> = build(false).map(
        (a: ComponentArgument<DashboardBaseComponent>) => {
          return String(a.id);
        },
      );
      expect(ids).toEqual([
        "title",
        "maxRows",
        "viewMode",
        "kubernetesClusterIds",
      ]);
    });

    test("no argument id is duplicated in either mode", () => {
      for (const args of [build(true), build(false)]) {
        const ids: Array<string> = args.map(
          (a: ComponentArgument<DashboardBaseComponent>) => {
            return String(a.id);
          },
        );
        expect(new Set<string>(ids).size).toBe(ids.length);
      }
    });
  });

  describe("Title argument", () => {
    test("is an optional text field in the Display section", () => {
      const title: ComponentArgument<DashboardBaseComponent> = findById(
        build(true),
        "title",
      );
      expect(title.name).toBe("Title");
      expect(title.type).toBe(ComponentInputType.Text);
      expect(title.required).toBe(false);
      expect(title.section).toBe(KubernetesDisplaySection);
      expect(title.description.length).toBeGreaterThan(0);
    });
  });

  describe("Max Rows argument", () => {
    test("is an optional number field with a placeholder in the Display section", () => {
      const maxRows: ComponentArgument<DashboardBaseComponent> = findById(
        build(true),
        "maxRows",
      );
      expect(maxRows.name).toBe("Max Rows");
      expect(maxRows.type).toBe(ComponentInputType.Number);
      expect(maxRows.required).toBe(false);
      expect(maxRows.placeholder).toBe("25");
      expect(maxRows.section).toBe(KubernetesDisplaySection);
    });
  });

  describe("View Mode argument", () => {
    test("is the shared dropdown offering list and honeycomb views", () => {
      const viewMode: ComponentArgument<DashboardBaseComponent> = findById(
        build(true),
        "viewMode",
      );
      expect(viewMode.name).toBe("View Mode");
      expect(viewMode.type).toBe(ComponentInputType.Dropdown);
      expect(viewMode.required).toBe(false);
      expect(viewMode.section).toBe(KubernetesDisplaySection);

      const values: Array<unknown> = (viewMode.dropdownOptions ?? []).map(
        (o: { value: unknown }) => {
          return o.value;
        },
      );
      expect(values).toEqual(["list", "honeycomb"]);
    });
  });

  describe("Clusters argument", () => {
    test("is an entity multi-select bound to the KubernetesCluster model in the Filters section", () => {
      const clusters: ComponentArgument<DashboardBaseComponent> = findById(
        build(true),
        "kubernetesClusterIds",
      );
      expect(clusters.name).toBe("Clusters");
      expect(clusters.type).toBe(ComponentInputType.EntityMultiSelectDropdown);
      expect(clusters.required).toBe(false);
      expect(clusters.placeholder).toBe("All clusters");
      expect(clusters.section).toBe(KubernetesFiltersSection);
      expect(clusters.entityFilterModelType).toBe(
        EntityFilterModelType.KubernetesCluster,
      );
    });
  });

  describe("Namespaces argument", () => {
    test("is an optional text field with an example placeholder in the Filters section", () => {
      const namespaces: ComponentArgument<DashboardBaseComponent> = findById(
        build(true),
        "namespaces",
      );
      expect(namespaces.name).toBe("Namespaces");
      expect(namespaces.type).toBe(ComponentInputType.Text);
      expect(namespaces.required).toBe(false);
      expect(namespaces.placeholder).toBe("default, kube-system");
      expect(namespaces.section).toBe(KubernetesFiltersSection);

      /*
       * The cluster picker is an entity dropdown; the namespaces field is a
       * free-text list, so it must NOT carry an entityFilterModelType.
       */
      expect(namespaces.entityFilterModelType).toBeUndefined();
    });
  });

  describe("section assignment and exported section constants", () => {
    test("every argument is required=false (all fields are optional filters/options)", () => {
      for (const args of [build(true), build(false)]) {
        for (const arg of args) {
          expect(arg.required).toBe(false);
        }
      }
    });

    test("Display options come before Filters and are grouped by their sections", () => {
      const args: Args = build(true);

      const displayIds: Array<string> = args
        .filter((a: ComponentArgument<DashboardBaseComponent>) => {
          return a.section === KubernetesDisplaySection;
        })
        .map((a: ComponentArgument<DashboardBaseComponent>) => {
          return String(a.id);
        });
      const filterIds: Array<string> = args
        .filter((a: ComponentArgument<DashboardBaseComponent>) => {
          return a.section === KubernetesFiltersSection;
        })
        .map((a: ComponentArgument<DashboardBaseComponent>) => {
          return String(a.id);
        });

      expect(displayIds).toEqual(["title", "maxRows", "viewMode"]);
      expect(filterIds).toEqual(["kubernetesClusterIds", "namespaces"]);
    });

    test("every argument references one of the two known sections", () => {
      for (const args of [build(true), build(false)]) {
        for (const arg of args) {
          const isKnownSection: boolean =
            arg.section === KubernetesDisplaySection ||
            arg.section === KubernetesFiltersSection;
          expect(isKnownSection).toBe(true);
        }
      }
    });

    test("the exported sections carry the expected ordering and collapse behavior", () => {
      expect(KubernetesDisplaySection.name).toBe("Display Options");
      expect(KubernetesDisplaySection.order).toBe(1);

      expect(KubernetesFiltersSection.name).toBe("Filters");
      expect(KubernetesFiltersSection.order).toBe(2);

      /*
       * Filters render below Display, so they default to collapsed while
       * Display stays open.
       */
      expect(KubernetesFiltersSection.defaultCollapsed).toBe(true);
      expect(KubernetesDisplaySection.defaultCollapsed).toBeUndefined();
      expect(KubernetesFiltersSection.order).toBeGreaterThan(
        KubernetesDisplaySection.order,
      );
    });
  });

  describe("well-formedness of every argument", () => {
    const validInputTypes: Set<string> = new Set<string>(
      Object.values(ComponentInputType),
    );

    test("each argument has a non-empty name, id, boolean required, and valid input type", () => {
      for (const args of [build(true), build(false)]) {
        for (const arg of args) {
          expect(typeof arg.name).toBe("string");
          expect(arg.name.length).toBeGreaterThan(0);

          expect(typeof arg.id).toBe("string");
          expect(String(arg.id).length).toBeGreaterThan(0);

          expect(typeof arg.required).toBe("boolean");

          expect(validInputTypes.has(arg.type)).toBe(true);

          expect(typeof arg.description).toBe("string");
          expect(arg.description.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("determinism and array independence", () => {
    test("repeated calls with the same options are deeply equal but not the same reference", () => {
      const first: Args = build(true);
      const second: Args = build(true);
      expect(second).toEqual(first);
      expect(second).not.toBe(first);
    });

    test("mutating a returned array does not affect a subsequent call", () => {
      const first: Args = build(true);
      first.pop();
      first[0]!.name = "MUTATED";

      const fresh: Args = build(true);
      expect(fresh).toHaveLength(5);
      expect(fresh[0]!.name).toBe("Title");
    });

    test("accepts the options object literals defined for both modes", () => {
      expect(
        getKubernetesCommonArguments<DashboardBaseComponent>(withNamespace),
      ).toHaveLength(5);
      expect(
        getKubernetesCommonArguments<DashboardBaseComponent>(withoutNamespace),
      ).toHaveLength(4);
    });
  });
});
