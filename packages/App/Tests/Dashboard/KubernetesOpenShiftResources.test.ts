import { describe, expect, test } from "@jest/globals";
import {
  OpenShiftRouteBackend,
  OpenShiftRouteObject,
} from "Common/Types/Kubernetes/OpenShiftObjectParser";
import {
  KubernetesObjectMetadata,
  KubernetesServicePort,
} from "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectParser";
import {
  DEPLOYMENT_CONFIG_POD_ATTRIBUTE,
  DEPLOYMENT_CONFIG_POD_LABEL,
  getPodOwnerReferences,
  getRouteHost,
  getRouteTargets,
  getRouteTlsLabel,
  getRouteUrl,
  getServicePortsLabel,
  isRouteToService,
} from "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesOpenShiftResources";

/*
 * What the pages of a Route, a Service and a DeploymentConfig read off those
 * objects. packages/E2E/OpenShiftPages draws them; these hold every shape a
 * cluster can send, which a fixture would never finish listing.
 */

function backend(
  name: string,
  weight: number | null = null,
  kind: string = "Service",
): OpenShiftRouteBackend {
  return { kind, name, weight };
}

function route(
  spec: Partial<OpenShiftRouteObject["spec"]> = {},
  ingressHosts: Array<string> = [],
  metadata: Partial<KubernetesObjectMetadata> = {},
): OpenShiftRouteObject {
  return {
    metadata: {
      name: "frontend",
      namespace: "shop",
      uid: "",
      creationTimestamp: "",
      labels: {},
      annotations: {},
      ownerReferences: [],
      ...metadata,
    },
    spec: {
      host: "",
      path: "",
      to: backend("frontend"),
      alternateBackends: [],
      targetPort: "",
      tlsTermination: "",
      insecureEdgeTerminationPolicy: "",
      wildcardPolicy: "",
      ...spec,
    },
    status: {
      ingress: ingressHosts.map((host: string) => {
        return {
          host,
          routerName: "default",
          routerCanonicalHostname: "",
          conditions: [],
        };
      }),
    },
  };
}

describe("getRouteTargets", () => {
  test("one backend has no share to speak of", () => {
    expect(getRouteTargets(route())).toEqual([
      { kind: "Service", name: "frontend", sharePercent: null },
    ]);
  });

  test("one backend with a weight still has none", () => {
    expect(getRouteTargets(route({ to: backend("frontend", 100) }))).toEqual([
      { kind: "Service", name: "frontend", sharePercent: null },
    ]);
  });

  test("alternate backends split the traffic by weight", () => {
    expect(
      getRouteTargets(
        route({
          to: backend("stable", 90),
          alternateBackends: [backend("canary", 10)],
        }),
      ),
    ).toEqual([
      { kind: "Service", name: "stable", sharePercent: 90 },
      { kind: "Service", name: "canary", sharePercent: 10 },
    ]);
  });

  test("weights need not add up to 100", () => {
    const shares: Array<number | null> = getRouteTargets(
      route({
        to: backend("a", 1),
        alternateBackends: [backend("b", 1), backend("c", 2)],
      }),
    ).map((target: { sharePercent: number | null }) => {
      return target.sharePercent;
    });

    expect(shares).toEqual([25, 25, 50]);
  });

  test("a backend with no weight counts as OpenShift's default, 100", () => {
    expect(
      getRouteTargets(
        route({
          to: backend("a"),
          alternateBackends: [backend("b", 100)],
        }),
      ).map((target: { sharePercent: number | null }) => {
        return target.sharePercent;
      }),
    ).toEqual([50, 50]);
  });

  test("a weight of 0 takes no traffic", () => {
    expect(
      getRouteTargets(
        route({
          to: backend("live", 100),
          alternateBackends: [backend("drained", 0)],
        }),
      ).map((target: { sharePercent: number | null }) => {
        return target.sharePercent;
      }),
    ).toEqual([100, 0]);
  });

  test("every weight 0 divides by nothing and still draws", () => {
    expect(
      getRouteTargets(
        route({
          to: backend("a", 0),
          alternateBackends: [backend("b", 0)],
        }),
      ).map((target: { sharePercent: number | null }) => {
        return target.sharePercent;
      }),
    ).toEqual([0, 0]);
  });

  test("a backend with no name is left out", () => {
    expect(getRouteTargets(route({ to: backend("") }))).toEqual([]);
  });

  test("a row stored without alternate backends still reads", () => {
    const stored: OpenShiftRouteObject = route();
    delete (stored.spec as unknown as Record<string, unknown>)[
      "alternateBackends"
    ];

    expect(getRouteTargets(stored)).toHaveLength(1);
  });
});

describe("getRouteHost", () => {
  test("is the Route's own", () => {
    expect(getRouteHost(route({ host: "a.example.com" }))).toBe(
      "a.example.com",
    );
  });

  test("falls back to what a router assigned", () => {
    expect(getRouteHost(route({}, ["generated.apps.example.com"]))).toBe(
      "generated.apps.example.com",
    );
  });

  test("is empty until there is one", () => {
    expect(getRouteHost(route())).toBe("");
  });

  test("a row stored without status still reads", () => {
    const stored: OpenShiftRouteObject = route();
    stored.status = {} as OpenShiftRouteObject["status"];

    expect(getRouteHost(stored)).toBe("");
  });
});

describe("getRouteUrl", () => {
  test.each(["edge", "passthrough", "reencrypt"])(
    "%s termination is HTTPS",
    (termination: string) => {
      expect(
        getRouteUrl(
          route({ host: "a.example.com", tlsTermination: termination }),
        ),
      ).toBe("https://a.example.com");
    },
  );

  test("no TLS is plain HTTP", () => {
    expect(getRouteUrl(route({ host: "a.example.com" }))).toBe(
      "http://a.example.com",
    );
  });

  test("keeps the Route's path", () => {
    expect(
      getRouteUrl(
        route({ host: "a.example.com", path: "/pay", tlsTermination: "edge" }),
      ),
    ).toBe("https://a.example.com/pay");
  });

  test("uses a host a router assigned", () => {
    expect(getRouteUrl(route({}, ["b.apps.example.com"]))).toBe(
      "http://b.apps.example.com",
    );
  });

  test("a Route with no host yet has no address", () => {
    expect(getRouteUrl(route())).toBe("");
  });

  test("a wildcard host is no address to open", () => {
    expect(getRouteUrl(route({ host: "*.apps.example.com" }))).toBe("");
  });
});

describe("getRouteTlsLabel", () => {
  test.each([
    ["edge", "Edge"],
    ["passthrough", "Passthrough"],
    ["reencrypt", "Re-encrypt"],
    ["Reencrypt", "Re-encrypt"],
    [" edge ", "Edge"],
    ["", "None"],
    ["   ", "None"],
  ])("%j reads %s", (termination: string, label: string) => {
    expect(getRouteTlsLabel(termination)).toBe(label);
  });

  test("a termination OpenShift adds later reads as written", () => {
    expect(getRouteTlsLabel("mutual")).toBe("mutual");
  });

  test.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "%s off the wire never reaches Object.prototype",
    (termination: string) => {
      expect(getRouteTlsLabel(termination)).toBe(termination);
    },
  );

  test("a row stored without it reads None", () => {
    expect(getRouteTlsLabel(undefined as unknown as string)).toBe("None");
  });
});

describe("getServicePortsLabel", () => {
  function port(fields: Partial<KubernetesServicePort>): KubernetesServicePort {
    return {
      name: "",
      protocol: "TCP",
      port: 8080,
      targetPort: "",
      nodePort: 0,
      ...fields,
    };
  }

  test("a port that targets itself is one number", () => {
    expect(getServicePortsLabel([port({ targetPort: "8080" })])).toBe(
      "8080/TCP",
    );
  });

  test("no target port is one number", () => {
    expect(getServicePortsLabel([port({})])).toBe("8080/TCP");
  });

  test("names where it goes when that differs", () => {
    expect(
      getServicePortsLabel([port({ port: 443, targetPort: "8443" })]),
    ).toBe("443→8443/TCP");
    expect(
      getServicePortsLabel([port({ port: 443, targetPort: "https" })]),
    ).toBe("443→https/TCP");
  });

  test("names a node port", () => {
    expect(
      getServicePortsLabel([
        port({ port: 80, targetPort: "http", nodePort: 31080 }),
      ]),
    ).toBe("80:31080→http/TCP");
  });

  test("reads the protocol, and assumes Kubernetes' default without one", () => {
    expect(getServicePortsLabel([port({ protocol: "UDP" })])).toBe("8080/UDP");
    expect(getServicePortsLabel([port({ protocol: "" })])).toBe("8080/TCP");
  });

  test("lists them all, and nothing for none", () => {
    expect(
      getServicePortsLabel([port({ port: 80 }), port({ port: 443 })]),
    ).toBe("80/TCP, 443/TCP");
    expect(getServicePortsLabel([])).toBe("");
  });
});

describe("isRouteToService", () => {
  const SERVICE: {
    metadata: Pick<KubernetesObjectMetadata, "name" | "namespace">;
  } = { metadata: { name: "frontend", namespace: "shop" } };

  function service(): Parameters<typeof isRouteToService>[1] {
    return SERVICE as unknown as Parameters<typeof isRouteToService>[1];
  }

  test("a Route to it, in its namespace", () => {
    expect(isRouteToService(route(), service())).toBe(true);
  });

  test("an alternate backend counts", () => {
    expect(
      isRouteToService(
        route({
          to: backend("other"),
          alternateBackends: [backend("frontend")],
        }),
        service(),
      ),
    ).toBe(true);
  });

  test("a Route to a same-named Service in another namespace does not", () => {
    expect(
      isRouteToService(route({}, [], { namespace: "payments" }), service()),
    ).toBe(false);
  });

  test("a Route to another Service does not", () => {
    expect(isRouteToService(route({ to: backend("other") }), service())).toBe(
      false,
    );
  });

  test("a backend of another kind does not", () => {
    expect(
      isRouteToService(
        route({ to: backend("frontend", null, "VirtualService") }),
        service(),
      ),
    ).toBe(false);
  });

  test("a backend that names no kind is a Service, as OpenShift defaults it", () => {
    expect(
      isRouteToService(route({ to: backend("frontend", null, "") }), service()),
    ).toBe(true);
  });
});

describe("getPodOwnerReferences", () => {
  const ROLLOUT: { kind: string; name: string; uid: string } = {
    kind: "ReplicationController",
    name: "legacy-web-7",
    uid: "",
  };

  test("a DeploymentConfig's pod shows the DeploymentConfig, not its rollout", () => {
    expect(
      getPodOwnerReferences({
        labels: { [DEPLOYMENT_CONFIG_POD_LABEL]: "legacy-web" },
        ownerReferences: [ROLLOUT],
      }),
    ).toEqual([{ kind: "DeploymentConfig", name: "legacy-web" }]);
  });

  test("a plain ReplicationController's pod keeps its owner", () => {
    expect(
      getPodOwnerReferences({ labels: {}, ownerReferences: [ROLLOUT] }),
    ).toEqual([ROLLOUT]);
  });

  test("the label alone proves nothing: someone can set it on any pod", () => {
    const owner: { kind: string; name: string; uid: string } = {
      kind: "ReplicaSet",
      name: "web-7d4f9b6c5",
      uid: "",
    };

    expect(
      getPodOwnerReferences({
        labels: { [DEPLOYMENT_CONFIG_POD_LABEL]: "legacy-web" },
        ownerReferences: [owner],
      }),
    ).toEqual([owner]);
  });

  test("a pod with no owner has none", () => {
    expect(getPodOwnerReferences({ labels: {}, ownerReferences: [] })).toEqual(
      [],
    );
    expect(
      getPodOwnerReferences({
        labels: {},
        ownerReferences: undefined as unknown as [],
      }),
    ).toEqual([]);
  });
});

test("the pod's attribute is the chart's label, as its collectors extract it", () => {
  expect(DEPLOYMENT_CONFIG_POD_ATTRIBUTE).toBe(
    `resource.k8s.pod.label.${DEPLOYMENT_CONFIG_POD_LABEL}`,
  );
});
