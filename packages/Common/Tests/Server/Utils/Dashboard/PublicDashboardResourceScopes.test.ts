import Includes from "../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../Types/BaseDatabase/Search";
import { DashboardResourceScope } from "../../../../Types/Dashboard/DashboardResourceScope";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../../Types/Dashboard/DashboardVariable";
import BadDataException from "../../../../Types/Exception/BadDataException";
import PublicDashboardResourceScopes, {
  PUBLIC_DASHBOARD_FOREIGN_ATTRIBUTE_MESSAGE,
  PUBLIC_DASHBOARD_FOREIGN_RESOURCE_SCOPE_MESSAGE,
} from "../../../../Server/Utils/Dashboard/PublicDashboardResourceScopes";
import { describe, expect, test } from "@jest/globals";

/*
 * A public dashboard keeps to the kind of resource its stored variables pick
 * among (issue #11258), whatever the request: the kind's filters are added
 * when a request leaves them out, a key only the kind names takes only the
 * kind's own operator - so it is no way to search values the board does not
 * show - and a picker lists only the kind's values.
 */

const HOST: DashboardVariable = {
  id: "host",
  name: "host",
  type: DashboardVariableType.TelemetryAttribute,
  attributeKey: "resource.host.name",
  isMultiSelect: true,
  resourceScope: DashboardResourceScope.Host,
};

const CLUSTER: DashboardVariable = {
  id: "cluster",
  name: "cluster",
  type: DashboardVariableType.TelemetryAttribute,
  attributeKey: "resource.k8s.cluster.name",
  resourceScope: DashboardResourceScope.KubernetesCluster,
};

const UNSCOPED_HOST: DashboardVariable = {
  ...HOST,
  id: "host2",
  name: "host2",
  resourceScope: undefined,
};

// The keys the board's widgets and variables filter by (the route's allowlist).
const WIDGET_KEYS: Set<string> = new Set<string>([
  "resource.host.name",
  "state",
]);

describe("getMetricQueryAttributes", () => {
  test("a request that leaves the kind out gets it all the same", () => {
    const attributes: Record<string, unknown> =
      PublicDashboardResourceScopes.getMetricQueryAttributes({
        requestedAttributes: {},
        allowedFilterAttributeKeys: WIDGET_KEYS,
        variables: [HOST],
      });

    expect(attributes["resource.host.name"]).toBeInstanceOf(NotNull);
    expect(attributes["resource.container.runtime"]).toBeInstanceOf(IsNull);
    expect(attributes["resource.k8s.cluster.name"]).toBeInstanceOf(IsNull);
    expect(attributes["resource.telemetry.sdk.name"]).toBeInstanceOf(IsNull);
  });

  test("the board's own filters and picks pass as sent", () => {
    const picked: Includes = new Includes(["db-01"]);
    const attributes: Record<string, unknown> =
      PublicDashboardResourceScopes.getMetricQueryAttributes({
        requestedAttributes: {
          "resource.host.name": picked,
          state: "used",
          "resource.container.runtime": new IsNull(),
        },
        allowedFilterAttributeKeys: WIDGET_KEYS,
        variables: [HOST],
      });

    expect(attributes["resource.host.name"]).toBe(picked);
    expect(attributes["state"]).toBe("used");
    expect(attributes["resource.container.runtime"]).toBeInstanceOf(IsNull);
  });

  test("a key only the kind names takes only the kind's operator - never a search", () => {
    expect(() => {
      return PublicDashboardResourceScopes.getMetricQueryAttributes({
        requestedAttributes: {
          "resource.container.runtime": new Search("dock"),
        },
        allowedFilterAttributeKeys: WIDGET_KEYS,
        variables: [HOST],
      });
    }).toThrow(
      new BadDataException(PUBLIC_DASHBOARD_FOREIGN_ATTRIBUTE_MESSAGE),
    );

    // Nor the opposite of the kind: "is not empty" where it says "is empty".
    expect(() => {
      return PublicDashboardResourceScopes.getMetricQueryAttributes({
        requestedAttributes: { "resource.container.runtime": new NotNull() },
        allowedFilterAttributeKeys: WIDGET_KEYS,
        variables: [HOST],
      });
    }).toThrow(BadDataException);

    // Nor a plain value.
    expect(() => {
      return PublicDashboardResourceScopes.getMetricQueryAttributes({
        requestedAttributes: { "resource.container.id": "abc" },
        allowedFilterAttributeKeys: WIDGET_KEYS,
        variables: [HOST],
      });
    }).toThrow(BadDataException);
  });

  test("the serialized shape off the wire is read like the operator", () => {
    const attributes: Record<string, unknown> =
      PublicDashboardResourceScopes.getMetricQueryAttributes({
        requestedAttributes: {
          "resource.container.id": { _type: "IsNull", value: null },
        },
        allowedFilterAttributeKeys: WIDGET_KEYS,
        variables: [HOST],
      });

    expect(attributes["resource.container.id"]).toBeInstanceOf(IsNull);
  });

  test("any other key is refused, as it always was", () => {
    expect(() => {
      return PublicDashboardResourceScopes.getMetricQueryAttributes({
        requestedAttributes: { "enduser.id": "42" },
        allowedFilterAttributeKeys: WIDGET_KEYS,
        variables: [HOST],
      });
    }).toThrow(
      new BadDataException(PUBLIC_DASHBOARD_FOREIGN_ATTRIBUTE_MESSAGE),
    );
  });

  test("a board whose variables name no kind adds nothing", () => {
    expect(
      PublicDashboardResourceScopes.getMetricQueryAttributes({
        requestedAttributes: { state: "used" },
        allowedFilterAttributeKeys: WIDGET_KEYS,
        variables: [UNSCOPED_HOST],
      }),
    ).toEqual({ state: "used" });
  });

  test("two kinds on one board: each key keeps the first variable's operator unless the request sends the other's", () => {
    const declared: Map<
      string,
      Array<string>
    > = PublicDashboardResourceScopes.getDeclaredScopeAttributes([
      CLUSTER,
      HOST,
    ]) as Map<string, Array<string>>;

    expect(declared.get("resource.k8s.cluster.name")).toEqual([
      "NotNull",
      "IsNull",
    ]);

    const attributes: Record<string, unknown> =
      PublicDashboardResourceScopes.getMetricQueryAttributes({
        requestedAttributes: {},
        allowedFilterAttributeKeys: new Set<string>(),
        variables: [CLUSTER, HOST],
      });
    expect(attributes["resource.k8s.cluster.name"]).toBeInstanceOf(NotNull);
  });
});

describe("getAttributeValueScope", () => {
  test("the kind the stored variable names, whatever the request says", () => {
    expect(
      PublicDashboardResourceScopes.getAttributeValueScope({
        variables: [HOST],
        attributeKey: "resource.host.name",
        requestedScope: undefined,
      }),
    ).toBe(DashboardResourceScope.Host);
  });

  test("a request naming another kind is refused", () => {
    expect(() => {
      return PublicDashboardResourceScopes.getAttributeValueScope({
        variables: [HOST],
        attributeKey: "resource.host.name",
        requestedScope: DashboardResourceScope.KubernetesCluster,
      });
    }).toThrow(
      new BadDataException(PUBLIC_DASHBOARD_FOREIGN_RESOURCE_SCOPE_MESSAGE),
    );

    expect(() => {
      return PublicDashboardResourceScopes.getAttributeValueScope({
        variables: [HOST],
        attributeKey: "resource.host.name",
        requestedScope: "Everything",
      });
    }).toThrow(BadDataException);
  });

  test("two variables on one key: the one the request names, or none", () => {
    expect(
      PublicDashboardResourceScopes.getAttributeValueScope({
        variables: [HOST, UNSCOPED_HOST],
        attributeKey: "resource.host.name",
        requestedScope: undefined,
      }),
    ).toBeUndefined();

    expect(
      PublicDashboardResourceScopes.getAttributeValueScope({
        variables: [HOST, UNSCOPED_HOST],
        attributeKey: "resource.host.name",
        requestedScope: DashboardResourceScope.Host,
      }),
    ).toBe(DashboardResourceScope.Host);
  });

  test("an unscoped board's picker reads as it always has", () => {
    expect(
      PublicDashboardResourceScopes.getAttributeValueScope({
        variables: [UNSCOPED_HOST],
        attributeKey: "resource.host.name",
        requestedScope: undefined,
      }),
    ).toBeUndefined();
  });
});
