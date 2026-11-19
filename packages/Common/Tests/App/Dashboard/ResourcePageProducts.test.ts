import { afterEach, describe, expect, jest, test } from "@jest/globals";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import {
  RESOURCE_PAGE_PRODUCTS,
  getOffProductOfPath,
  getProductOfPath,
  getProductsOfPath,
  getResourcePageOfPath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProductOfRoute";
import {
  PRODUCTS_IN_RESOURCES,
  isProductShownInResources,
  withResourcePagesShown,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProductsInResources";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ProductKey from "../../../Types/Product/ProductKey";
import { ProductUsage } from "../../../Types/Product/ProductUsage";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import { ServerProductOffReason } from "../../../Types/Product/ServerProducts";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

/*
 * ANOTHER PRODUCT, INSIDE A RESOURCE'S PAGES (#9547).
 *
 * A host's Security Events, a cluster's Data Security and Compliance live
 * under the host's and the cluster's own addresses, and need Security
 * Events or Data Security on too: while that product is switched off on
 * the server, the page says so, as a guided setup's does. A resource's
 * menu offers such a page only while the product is on, shown, in use and
 * readable - and Search offers what the menu offers.
 */

const PROJECT: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const RECORD: string = "0193c0de-4444-4aaa-8bbb-000000000004";

function addressOf(page: PageMap): string {
  return (RouteMap[page] as Route)
    .toString()
    .replace(":projectId", PROJECT)
    .replace(":id", RECORD);
}

function answerOf(
  extra: Partial<ProjectProductsAnswer>,
): ProjectProductsAnswer {
  return { ...getEmptyProjectProductsAnswer(), ...extra };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the resource pages that show another product", () => {
  test("every resource's Security Events needs Security Events; every data page Data Security", () => {
    expect(RESOURCE_PAGE_PRODUCTS).toEqual({
      [PageMap.NETWORK_DEVICE_VIEW_SECURITY_EVENTS]: ProductKey.SecurityEvents,
      [PageMap.HOST_VIEW_SECURITY_EVENTS]: ProductKey.SecurityEvents,
      [PageMap.KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS]:
        ProductKey.SecurityEvents,
      // A container host's, a cloud's and a service's (#9628).
      [PageMap.DOCKER_HOST_VIEW_SECURITY_EVENTS]: ProductKey.SecurityEvents,
      [PageMap.PODMAN_HOST_VIEW_SECURITY_EVENTS]: ProductKey.SecurityEvents,
      [PageMap.OPENSTACK_CLOUD_VIEW_SECURITY_EVENTS]: ProductKey.SecurityEvents,
      [PageMap.SERVICE_VIEW_SECURITY_EVENTS]: ProductKey.SecurityEvents,
      [PageMap.KUBERNETES_CLUSTER_VIEW_DATA_SECURITY]: ProductKey.DataSecurity,
      [PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE]: ProductKey.DataSecurity,
      [PageMap.DATABASE_SERVER_VIEW_DATA_SECURITY]: ProductKey.DataSecurity,
      [PageMap.DATABASE_SERVER_VIEW_COMPLIANCE]: ProductKey.DataSecurity,
      [PageMap.SERVICE_VIEW_DATA_SECURITY]: ProductKey.DataSecurity,
      [PageMap.SERVICE_VIEW_COMPLIANCE]: ProductKey.DataSecurity,
      [PageMap.CLOUD_RESOURCE_VIEW_DATA_SECURITY]: ProductKey.DataSecurity,
      [PageMap.CLOUD_RESOURCE_VIEW_COMPLIANCE]: ProductKey.DataSecurity,
      [PageMap.DOCKER_HOST_VIEW_DATA_SECURITY]: ProductKey.DataSecurity,
      [PageMap.DOCKER_HOST_VIEW_COMPLIANCE]: ProductKey.DataSecurity,
      [PageMap.PODMAN_HOST_VIEW_DATA_SECURITY]: ProductKey.DataSecurity,
      [PageMap.PODMAN_HOST_VIEW_COMPLIANCE]: ProductKey.DataSecurity,
    });
  });

  test.each([
    [PageMap.DOCKER_HOST_VIEW_SECURITY_EVENTS, ProductKey.Docker],
    [PageMap.PODMAN_HOST_VIEW_SECURITY_EVENTS, ProductKey.Podman],
    [PageMap.OPENSTACK_CLOUD_VIEW_SECURITY_EVENTS, ProductKey.OpenStack],
    [PageMap.SERVICE_VIEW_SECURITY_EVENTS, ProductKey.Services],
  ])(
    "%s stays a page of %s, and needs Security Events too (#9628)",
    (page: PageMap, product: ProductKey) => {
      expect(getProductOfPath(addressOf(page))).toBe(product);
      expect(getProductsOfPath(addressOf(page))).toEqual([
        product,
        ProductKey.SecurityEvents,
      ]);
      expect(
        getOffProductOfPath({
          pathname: addressOf(page),
          offOnServer: {
            [ProductKey.SecurityEvents]: ServerProductOffReason.SwitchedOff,
          },
        }),
      ).toEqual({
        product: ProductKey.SecurityEvents,
        reason: ServerProductOffReason.SwitchedOff,
        pageProduct: product,
      });
    },
  );

  test.each([
    [PageMap.DATABASE_SERVER_VIEW_COMPLIANCE, ProductKey.Databases],
    [PageMap.SERVICE_VIEW_DATA_SECURITY, ProductKey.Services],
    [PageMap.CLOUD_RESOURCE_VIEW_COMPLIANCE, ProductKey.Cloud],
    [PageMap.DOCKER_HOST_VIEW_DATA_SECURITY, ProductKey.Docker],
    [PageMap.PODMAN_HOST_VIEW_COMPLIANCE, ProductKey.Podman],
  ])(
    "%s stays a page of %s, and needs Data Security too",
    (page: PageMap, product: ProductKey) => {
      expect(getProductOfPath(addressOf(page))).toBe(product);
      expect(getProductsOfPath(addressOf(page))).toEqual([
        product,
        ProductKey.DataSecurity,
      ]);
      expect(
        getOffProductOfPath({
          pathname: addressOf(page),
          offOnServer: {
            [ProductKey.DataSecurity]: ServerProductOffReason.SwitchedOff,
          },
        }),
      ).toEqual({
        product: ProductKey.DataSecurity,
        reason: ServerProductOffReason.SwitchedOff,
        pageProduct: product,
      });
    },
  );

  test.each(Object.keys(RESOURCE_PAGE_PRODUCTS) as Array<PageMap>)(
    "%s is found by its address, with any record's id",
    (page: PageMap) => {
      expect(getResourcePageOfPath(addressOf(page))).toBe(page);
      expect(getResourcePageOfPath(`${addressOf(page)}/`)).toBe(page);
    },
  );

  test("an address that only looks like one is not: another page, or one more segment", () => {
    expect(
      getResourcePageOfPath(addressOf(PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS)),
    ).toBeNull();
    expect(
      getResourcePageOfPath(
        `${addressOf(PageMap.HOST_VIEW_SECURITY_EVENTS)}/extra`,
      ),
    ).toBeNull();
    expect(
      getResourcePageOfPath(`/dashboard/${PROJECT}/security-events`),
    ).toBeNull();
    expect(getResourcePageOfPath("/accounts/login")).toBeNull();
  });

  test("each stays its resource's page, and needs the product it shows too", () => {
    const host: string = addressOf(PageMap.HOST_VIEW_SECURITY_EVENTS);
    const compliance: string = addressOf(
      PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE,
    );

    expect(getProductOfPath(host)).toBe(ProductKey.Hosts);
    expect(getProductsOfPath(host)).toEqual([
      ProductKey.Hosts,
      ProductKey.SecurityEvents,
    ]);
    expect(getProductOfPath(compliance)).toBe(ProductKey.Kubernetes);
    expect(getProductsOfPath(compliance)).toEqual([
      ProductKey.Kubernetes,
      ProductKey.DataSecurity,
    ]);
  });

  test("with the product it shows switched off, the page says so, naming the resource's own product", () => {
    expect(
      getOffProductOfPath({
        pathname: addressOf(PageMap.KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS),
        offOnServer: {
          [ProductKey.SecurityEvents]: ServerProductOffReason.SwitchedOff,
        },
      }),
    ).toEqual({
      product: ProductKey.SecurityEvents,
      reason: ServerProductOffReason.SwitchedOff,
      pageProduct: ProductKey.Kubernetes,
    });
  });

  test("the resource's own product off comes first; the other pages of the resource need nothing more", () => {
    expect(
      getOffProductOfPath({
        pathname: addressOf(PageMap.HOST_VIEW_SECURITY_EVENTS),
        offOnServer: {
          [ProductKey.Hosts]: ServerProductOffReason.SwitchedOff,
          [ProductKey.SecurityEvents]: ServerProductOffReason.SwitchedOff,
        },
      })?.product,
    ).toBe(ProductKey.Hosts);
    expect(
      getOffProductOfPath({
        pathname: addressOf(PageMap.HOST_VIEW_LOGS),
        offOnServer: {
          [ProductKey.SecurityEvents]: ServerProductOffReason.SwitchedOff,
        },
      }),
    ).toBeNull();
  });
});

describe("whether a resource's menu offers a product's pages", () => {
  test("the products a resource's pages show", () => {
    expect([...PRODUCTS_IN_RESOURCES]).toEqual([
      ProductKey.SecurityEvents,
      ProductKey.DataSecurity,
    ]);
  });

  test("on, shown and in use: offered", () => {
    expect(
      isProductShownInResources(
        answerOf({
          usage: { [ProductKey.SecurityEvents]: ProductUsage.InUse },
        }),
        ProductKey.SecurityEvents,
      ),
    ).toBe(true);
  });

  test.each([
    [
      "switched off on the server",
      answerOf({
        usage: { [ProductKey.SecurityEvents]: ProductUsage.InUse },
        offOnServer: {
          [ProductKey.SecurityEvents]: ServerProductOffReason.SwitchedOff,
        },
      }),
    ],
    [
      "off while telemetry ingestion is stopped",
      answerOf({
        usage: { [ProductKey.SecurityEvents]: ProductUsage.InUse },
        offOnServer: {
          [ProductKey.SecurityEvents]:
            ServerProductOffReason.TelemetryIngestionStopped,
        },
      }),
    ],
    [
      "hidden in the project",
      answerOf({
        usage: { [ProductKey.SecurityEvents]: ProductUsage.InUse },
        hidden: [ProductKey.SecurityEvents],
      }),
    ],
    [
      "not set up",
      answerOf({
        usage: { [ProductKey.SecurityEvents]: ProductUsage.NotSetUp },
      }),
    ],
    ["of unknown use (not the reader's to read)", answerOf({ usage: {} })],
    ["not answered yet", getEmptyProjectProductsAnswer()],
  ])("%s: not offered", (_label: string, answer: ProjectProductsAnswer) => {
    expect(isProductShownInResources(answer, ProductKey.SecurityEvents)).toBe(
      false,
    );
  });

  test("each product by its own answer", () => {
    const answer: ProjectProductsAnswer = answerOf({
      usage: {
        [ProductKey.SecurityEvents]: ProductUsage.InUse,
        [ProductKey.DataSecurity]: ProductUsage.NotSetUp,
      },
    });

    expect(isProductShownInResources(answer, ProductKey.SecurityEvents)).toBe(
      true,
    );
    expect(isProductShownInResources(answer, ProductKey.DataSecurity)).toBe(
      false,
    );
  });
});

describe("what Search offers of a record's pages", () => {
  const kind: {
    id: string;
    pages: Array<{ page: string; title: string }>;
  } = {
    id: "kubernetes-clusters",
    pages: [
      { page: PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS, title: "Events" },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS,
        title: "Security Events",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE,
        title: "Compliance",
      },
    ],
  };

  function titlesFor(
    answer: ProjectProductsAnswer,
    isAllowed: boolean = true,
  ): Array<string> {
    jest.spyOn(PermissionGate, "check").mockImplementation(() => {
      return { isAllowed } as PermissionGateResult;
    });

    return withResourcePagesShown(kind, answer).pages.map(
      (page: { title: string }): string => {
        return page.title;
      },
    );
  }

  test("what the menu offers, and the record's own pages always", () => {
    expect(
      titlesFor(
        answerOf({
          usage: {
            [ProductKey.SecurityEvents]: ProductUsage.InUse,
            [ProductKey.DataSecurity]: ProductUsage.InUse,
          },
        }),
      ),
    ).toEqual(["Events", "Security Events", "Compliance"]);
    expect(
      titlesFor(
        answerOf({
          usage: { [ProductKey.SecurityEvents]: ProductUsage.InUse },
        }),
      ),
    ).toEqual(["Events", "Security Events"]);
    expect(titlesFor(answerOf({}))).toEqual(["Events"]);
  });

  test("nothing of a product the reader may not read", () => {
    expect(
      titlesFor(
        answerOf({
          usage: {
            [ProductKey.SecurityEvents]: ProductUsage.InUse,
            [ProductKey.DataSecurity]: ProductUsage.InUse,
          },
        }),
        false,
      ),
    ).toEqual(["Events"]);
  });

  test("the kind is otherwise left as it was", () => {
    jest.spyOn(PermissionGate, "check").mockImplementation(() => {
      return { isAllowed: true } as PermissionGateResult;
    });

    expect(withResourcePagesShown(kind, answerOf({})).id).toBe(
      "kubernetes-clusters",
    );
    expect(kind.pages).toHaveLength(3);
  });
});
