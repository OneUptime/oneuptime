import { describe, expect, test } from "@jest/globals";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  CephDisplaySection,
  CephFiltersSection,
  getCephCommonArguments,
} from "../../../Utils/Dashboard/Components/DashboardCephResourceListShared";
import {
  DockerSwarmDisplaySection,
  DockerSwarmFiltersSection,
  getDockerSwarmCommonArguments,
} from "../../../Utils/Dashboard/Components/DashboardDockerSwarmResourceListShared";
import {
  ProxmoxDisplaySection,
  ProxmoxFiltersSection,
  getProxmoxCommonArguments,
} from "../../../Utils/Dashboard/Components/DashboardProxmoxResourceListShared";
import {
  KubernetesDisplaySection,
  KubernetesFiltersSection,
  getKubernetesCommonArguments,
} from "../../../Utils/Dashboard/Components/DashboardKubernetesResourceListShared";

/*
 * The per-provider argument builders behind the infrastructure list widgets.
 *
 * Ceph, Docker Swarm and Proxmox are the same widget four times over — the
 * files are identical but for the provider's name — and Kubernetes is that
 * shape plus a namespace filter. They were written by copying one another,
 * which is fine, and it is also exactly why they drift: a fix or an addition
 * made to one has no reason to fail anywhere else, so the widgets slowly stop
 * behaving alike and nobody finds out until an operator asks why the Proxmox
 * list has no honeycomb view.
 *
 * The entity filter type is the sharper risk. It is what a cluster filter
 * resolves ids against, and a copy-paste that left the wrong provider's model
 * behind would offer one product's clusters as the filter for another's — no
 * type error, no crash, just a picker that lists the wrong things and a widget
 * that silently matches nothing.
 */

type AnyArgument = ComponentArgument<DashboardBaseComponent>;

interface ProviderWidget {
  provider: string;
  args: Array<AnyArgument>;
  displaySection: ComponentArgumentSection;
  filtersSection: ComponentArgumentSection;
  clusterArgumentId: string;
  clusterEntityType: EntityFilterModelType;
}

/*
 * Kubernetes is asked for WITHOUT its namespace filter here, which is the
 * arrangement in which it is meant to be the same widget as the other three.
 * Its extra argument is covered separately below.
 */
const WIDGETS: Array<ProviderWidget> = [
  {
    provider: "Ceph",
    args: getCephCommonArguments<DashboardBaseComponent>(),
    displaySection: CephDisplaySection,
    filtersSection: CephFiltersSection,
    clusterArgumentId: "cephClusterIds",
    clusterEntityType: EntityFilterModelType.CephCluster,
  },
  {
    provider: "Docker Swarm",
    args: getDockerSwarmCommonArguments<DashboardBaseComponent>(),
    displaySection: DockerSwarmDisplaySection,
    filtersSection: DockerSwarmFiltersSection,
    clusterArgumentId: "dockerSwarmClusterIds",
    clusterEntityType: EntityFilterModelType.DockerSwarmCluster,
  },
  {
    provider: "Proxmox",
    args: getProxmoxCommonArguments<DashboardBaseComponent>(),
    displaySection: ProxmoxDisplaySection,
    filtersSection: ProxmoxFiltersSection,
    clusterArgumentId: "proxmoxClusterIds",
    clusterEntityType: EntityFilterModelType.ProxmoxCluster,
  },
  {
    provider: "Kubernetes",
    args: getKubernetesCommonArguments<DashboardBaseComponent>({
      includeNamespaceFilter: false,
    }),
    displaySection: KubernetesDisplaySection,
    filtersSection: KubernetesFiltersSection,
    clusterArgumentId: "kubernetesClusterIds",
    clusterEntityType: EntityFilterModelType.KubernetesCluster,
  },
];

function argumentById(
  args: Array<AnyArgument>,
  id: string,
): AnyArgument | undefined {
  return args.find((argument: AnyArgument): boolean => {
    return (argument.id as unknown as string) === id;
  });
}

describe("infrastructure list widget arguments", () => {
  describe.each(WIDGETS)(
    "$provider",
    ({
      args,
      displaySection,
      filtersSection,
      clusterArgumentId,
      clusterEntityType,
    }: ProviderWidget) => {
      /*
       * These three are what the widget reads at render time. A dropped one
       * does not fail to compile — the widget just stops offering the
       * control, and the argument silently reads as undefined.
       */
      test("offers the title, row cap and view mode every one of these widgets has", () => {
        for (const id of ["title", "maxRows", "viewMode"]) {
          expect(argumentById(args, id)).toBeDefined();
        }
      });

      test("view mode is a dropdown offering exactly list and honeycomb", () => {
        const viewMode: AnyArgument = argumentById(args, "viewMode")!;

        expect(viewMode.type).toBe(ComponentInputType.Dropdown);
        expect(
          (viewMode.dropdownOptions || []).map(
            (option: { value: string | number | boolean }): unknown => {
              return option.value;
            },
          ),
        ).toEqual(["list", "honeycomb"]);
      });

      /*
       * The one that cannot be caught by reading the file: a cluster filter
       * pointed at another provider's model resolves ids against the wrong
       * table, so the picker lists the wrong clusters and the widget matches
       * nothing.
       */
      test("the cluster filter resolves against its own provider's clusters", () => {
        const clusterFilter: AnyArgument | undefined = argumentById(
          args,
          clusterArgumentId,
        );

        expect(clusterFilter).toBeDefined();
        expect(clusterFilter!.type).toBe(
          ComponentInputType.EntityMultiSelectDropdown,
        );
        expect(clusterFilter!.entityFilterModelType).toBe(clusterEntityType);
      });

      /*
       * Display holds what the widget looks like, Filters holds what it
       * shows. An argument filed under the wrong one is not a crash, it just
       * puts the control in a panel no operator thinks to open — and Filters
       * starts collapsed, so a misfiled display control is invisible.
       */
      test("display controls and filters are filed in the right panels", () => {
        for (const id of ["title", "maxRows", "viewMode"]) {
          expect(argumentById(args, id)!.section).toBe(displaySection);
        }

        expect(argumentById(args, clusterArgumentId)!.section).toBe(
          filtersSection,
        );
      });

      test("Display is ordered ahead of Filters, which starts collapsed", () => {
        expect(displaySection.order).toBeLessThan(filtersSection.order!);
        expect(filtersSection.defaultCollapsed).toBe(true);
      });

      /*
       * Ids are the keys the saved widget config is written under. A repeat
       * would have two controls writing over each other.
       */
      test("no argument id is used twice", () => {
        const ids: Array<string> = args.map((argument: AnyArgument): string => {
          return argument.id as unknown as string;
        });

        expect(new Set(ids).size).toBe(ids.length);
      });

      /*
       * Every one of these is optional: a required argument with no value
       * blocks the widget from rendering at all, and an empty list widget
       * showing everything is the intended default.
       */
      test("nothing is required, so a freshly added widget renders", () => {
        for (const argument of args) {
          expect(argument.required).toBe(false);
        }
      });
    },
  );

  /*
   * The point of the whole suite: the four are meant to be the same widget.
   * Comparing them to each other catches a change made to one and not the
   * rest, which is the way these files actually go wrong.
   */
  describe("the providers stay the same widget as each other", () => {
    test("they expose the same arguments, in the same order", () => {
      const shapes: Array<Array<string>> = WIDGETS.map(
        (widget: ProviderWidget): Array<string> => {
          return widget.args.map((argument: AnyArgument): string => {
            const id: string = argument.id as unknown as string;

            // The cluster filter is the one id that is legitimately per-provider.
            return id === widget.clusterArgumentId
              ? `clusterIds:${argument.type}`
              : `${id}:${argument.type}`;
          });
        },
      );

      for (const shape of shapes) {
        expect(shape).toEqual(shapes[0]);
      }
    });

    test("each provider filters on its own cluster model, and no two share one", () => {
      const entityTypes: Array<EntityFilterModelType> = WIDGETS.map(
        (widget: ProviderWidget): EntityFilterModelType => {
          return argumentById(widget.args, widget.clusterArgumentId)!
            .entityFilterModelType!;
        },
      );

      expect(new Set(entityTypes).size).toBe(WIDGETS.length);
    });
  });

  /*
   * Kubernetes is the one that differs, and it differs on request rather than
   * always — the namespace filter is only meaningful for widgets listing
   * namespaced objects.
   */
  describe("the Kubernetes namespace filter is opt-in", () => {
    test("it is absent unless asked for", () => {
      expect(
        argumentById(
          getKubernetesCommonArguments<DashboardBaseComponent>({
            includeNamespaceFilter: false,
          }),
          "namespaces",
        ),
      ).toBeUndefined();
    });

    test("asking for it adds it to the filters panel, still optional", () => {
      const namespaces: AnyArgument | undefined = argumentById(
        getKubernetesCommonArguments<DashboardBaseComponent>({
          includeNamespaceFilter: true,
        }),
        "namespaces",
      );

      expect(namespaces).toBeDefined();
      expect(namespaces!.required).toBe(false);
      expect(namespaces!.section).toBe(KubernetesFiltersSection);
    });

    /*
     * Asking for the namespace filter must not disturb anything else — it is
     * an addition, not a different widget.
     */
    test("it changes nothing else about the widget", () => {
      const without: Array<string> =
        getKubernetesCommonArguments<DashboardBaseComponent>({
          includeNamespaceFilter: false,
        }).map((argument: AnyArgument): string => {
          return argument.id as unknown as string;
        });

      const with_: Array<string> =
        getKubernetesCommonArguments<DashboardBaseComponent>({
          includeNamespaceFilter: true,
        })
          .map((argument: AnyArgument): string => {
            return argument.id as unknown as string;
          })
          .filter((id: string): boolean => {
            return id !== "namespaces";
          });

      expect(with_).toEqual(without);
    });
  });
});
