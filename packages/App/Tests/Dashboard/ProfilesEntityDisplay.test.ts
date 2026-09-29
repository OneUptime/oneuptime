/*
 * A performance profile's source is a (primaryEntityId, primaryEntityType)
 * pair: a Service id only when the type says so. The profiles list used to
 * name Services and Hosts only — every other source rendered as a type label
 * over "84858d6c…", a RUM application read "Unknown source", and the profile
 * page printed the whole uuid. These tests pin the naming rules the table and
 * the page now share.
 *
 * The helper imports the shared resolver module, which imports ModelAPI; it
 * is mocked so nothing reaches the network.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import { describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  TELEMETRY_ENTITY_TYPES,
  TelemetryEntityNameMap,
  getTelemetryEntityTypeLabel,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import {
  ProfileEntityDisplay,
  ProfileEntityRef,
  UNKNOWN_PROFILE_SOURCE_LABEL,
  buildProfileEntityTypeHints,
  collectProfileEntityRefs,
  getProfileEntityDisplay,
  getProfileEntityRefsKey,
  getProfileServiceFilterChipDisplay,
  isKnownProfileEntityType,
  shortenProfileEntityId,
} from "../../FeatureSet/Dashboard/src/Utils/ProfilesEntityDisplay";

const RUM_APP_ID: string = "84858d6c-1111-4111-8111-111111111111";
const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLUSTER_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROJECT_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UNRESOLVED_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const NAMES: TelemetryEntityNameMap = {
  [RUM_APP_ID]: {
    id: RUM_APP_ID,
    name: "checkout-web",
    entityType: ServiceType.RealUserMonitor,
    typeLabel: "RUM Application",
  },
  [CLUSTER_ID]: {
    id: CLUSTER_ID,
    name: "prod-eu",
    entityType: ServiceType.KubernetesCluster,
    typeLabel: "Kubernetes Cluster",
  },
  [SERVICE_ID]: {
    id: SERVICE_ID,
    name: "checkout-api",
    entityType: ServiceType.OpenTelemetry,
    typeLabel: "Service",
  },
  [PROJECT_ID]: {
    id: PROJECT_ID,
    name: "Unknown Service",
    entityType: ServiceType.Unknown,
    typeLabel: "Service",
  },
};

describe("isKnownProfileEntityType", () => {
  test("recognises every ServiceType the resolver has a label for", () => {
    for (const type of Object.values(ServiceType)) {
      expect(isKnownProfileEntityType(type)).toBe(true);
    }
    expect(Object.keys(TELEMETRY_ENTITY_TYPES).sort()).toEqual(
      Object.values(ServiceType).sort(),
    );
  });

  test("rejects blanks and discriminators this build has never heard of", () => {
    expect(isKnownProfileEntityType(undefined)).toBe(false);
    expect(isKnownProfileEntityType(null)).toBe(false);
    expect(isKnownProfileEntityType("")).toBe(false);
    expect(isKnownProfileEntityType("SomethingNew")).toBe(false);
    expect(isKnownProfileEntityType("toString")).toBe(false);
  });
});

describe("collectProfileEntityRefs", () => {
  test("distinct (id, type) pairs, skipping ids the page already names", () => {
    const refs: Array<ProfileEntityRef> = collectProfileEntityRefs({
      profiles: [
        {
          primaryEntityId: new ObjectID(RUM_APP_ID),
          primaryEntityType: ServiceType.RealUserMonitor,
        },
        {
          primaryEntityId: new ObjectID(RUM_APP_ID),
          primaryEntityType: ServiceType.RealUserMonitor,
        },
        {
          primaryEntityId: new ObjectID(SERVICE_ID),
          primaryEntityType: ServiceType.OpenTelemetry,
        },
        {
          primaryEntityId: new ObjectID(HOST_ID),
          primaryEntityType: ServiceType.Host,
        },
        {
          primaryEntityId: new ObjectID(CLUSTER_ID),
          primaryEntityType: ServiceType.KubernetesCluster,
        },
      ],
      knownIds: new Set<string>([SERVICE_ID, HOST_ID]),
    });

    expect(refs).toEqual([
      { id: RUM_APP_ID, entityType: ServiceType.RealUserMonitor },
      { id: CLUSTER_ID, entityType: ServiceType.KubernetesCluster },
    ]);
  });

  test("an unknown discriminator still resolves, just without a hint", () => {
    expect(
      collectProfileEntityRefs({
        profiles: [
          { primaryEntityId: UNRESOLVED_ID, primaryEntityType: "Future" },
          { primaryEntityId: RUM_APP_ID },
        ],
      }),
    ).toEqual([{ id: RUM_APP_ID }, { id: UNRESOLVED_ID }]);
  });

  test("a typed row wins over an untyped row for the same id", () => {
    expect(
      collectProfileEntityRefs({
        profiles: [
          { primaryEntityId: RUM_APP_ID },
          {
            primaryEntityId: RUM_APP_ID,
            primaryEntityType: ServiceType.RealUserMonitor,
          },
          { primaryEntityId: RUM_APP_ID },
        ],
      }),
    ).toEqual([{ id: RUM_APP_ID, entityType: ServiceType.RealUserMonitor }]);
  });

  test("rows without an id are skipped", () => {
    expect(
      collectProfileEntityRefs({
        profiles: [
          { primaryEntityId: undefined },
          { primaryEntityId: null },
          { primaryEntityId: "  " },
        ],
      }),
    ).toEqual([]);
  });

  test("is sorted by id so a refetch of the same page yields the same key", () => {
    const first: Array<ProfileEntityRef> = collectProfileEntityRefs({
      profiles: [
        { primaryEntityId: CLUSTER_ID },
        { primaryEntityId: RUM_APP_ID },
      ],
    });
    const second: Array<ProfileEntityRef> = collectProfileEntityRefs({
      profiles: [
        { primaryEntityId: RUM_APP_ID },
        { primaryEntityId: CLUSTER_ID },
      ],
    });

    expect(getProfileEntityRefsKey(first)).toBe(
      getProfileEntityRefsKey(second),
    );
  });
});

describe("buildProfileEntityTypeHints / getProfileEntityRefsKey", () => {
  test("typed refs become hints; untyped refs are left to the general pass", () => {
    expect(
      buildProfileEntityTypeHints([
        { id: RUM_APP_ID, entityType: ServiceType.RealUserMonitor },
        { id: UNRESOLVED_ID },
        { id: CLUSTER_ID, entityType: ServiceType.KubernetesCluster },
      ]),
    ).toEqual({
      [RUM_APP_ID]: ServiceType.RealUserMonitor,
      [CLUSTER_ID]: ServiceType.KubernetesCluster,
    });
    expect(buildProfileEntityTypeHints([])).toEqual({});
  });

  test("the key changes when an id or its type changes", () => {
    expect(getProfileEntityRefsKey([])).toBe("");
    expect(
      getProfileEntityRefsKey([
        { id: RUM_APP_ID, entityType: ServiceType.RealUserMonitor },
      ]),
    ).not.toBe(getProfileEntityRefsKey([{ id: RUM_APP_ID }]));
  });
});

describe("shortenProfileEntityId", () => {
  test("truncates uuids, keeps short identifiers whole", () => {
    expect(shortenProfileEntityId(RUM_APP_ID)).toBe("84858d6c…");
    expect(shortenProfileEntityId("short-id")).toBe("short-id");
    expect(shortenProfileEntityId("")).toBe("");
  });
});

describe("getProfileEntityDisplay", () => {
  test("REGRESSION: a RUM application source shows its name, not 'Unknown source'", () => {
    const display: ProfileEntityDisplay = getProfileEntityDisplay({
      entityId: RUM_APP_ID,
      entityType: ServiceType.RealUserMonitor,
      nameMap: NAMES,
    });

    expect(display).toEqual({
      primary: "checkout-web",
      typeLabel: "RUM Application",
      isResolved: true,
      shortId: "",
    });
  });

  test("a cluster source shows its name and the shared type label", () => {
    const display: ProfileEntityDisplay = getProfileEntityDisplay({
      entityId: CLUSTER_ID,
      entityType: ServiceType.KubernetesCluster,
      nameMap: NAMES,
    });

    expect(display.primary).toBe("prod-eu");
    expect(display.typeLabel).toBe(
      getTelemetryEntityTypeLabel(ServiceType.KubernetesCluster),
    );
  });

  test("before the lookup lands a known type reads '<type label>' over a short id", () => {
    const display: ProfileEntityDisplay = getProfileEntityDisplay({
      entityId: RUM_APP_ID,
      entityType: ServiceType.RealUserMonitor,
      nameMap: {},
    });

    expect(display).toEqual({
      primary: "RUM Application",
      typeLabel: "RUM Application",
      isResolved: false,
      shortId: "84858d6c…",
    });
  });

  test("uses the shared label vocabulary for every type (no local switch drift)", () => {
    for (const type of Object.values(ServiceType)) {
      const display: ProfileEntityDisplay = getProfileEntityDisplay({
        entityId: UNRESOLVED_ID,
        entityType: type,
        nameMap: {},
      });
      expect(display.typeLabel).toBe(getTelemetryEntityTypeLabel(type));
      expect(display.typeLabel).not.toBe(UNKNOWN_PROFILE_SOURCE_LABEL);
    }
  });

  test("'Unknown source' only when the type is unrecognised AND the id is unresolved", () => {
    expect(
      getProfileEntityDisplay({
        entityId: UNRESOLVED_ID,
        entityType: "Future",
        nameMap: NAMES,
      }).primary,
    ).toBe(UNKNOWN_PROFILE_SOURCE_LABEL);

    expect(
      getProfileEntityDisplay({
        entityId: UNRESOLVED_ID,
        entityType: undefined,
        nameMap: undefined,
      }).typeLabel,
    ).toBe(UNKNOWN_PROFILE_SOURCE_LABEL);

    // An unrecognised type whose id DID resolve is named.
    expect(
      getProfileEntityDisplay({
        entityId: RUM_APP_ID,
        entityType: "Future",
        nameMap: NAMES,
      }),
    ).toMatchObject({ primary: "checkout-web", typeLabel: "RUM Application" });
  });

  test("the projectId bucket reads 'Unknown Service'", () => {
    expect(
      getProfileEntityDisplay({
        entityId: PROJECT_ID,
        entityType: ServiceType.Unknown,
        nameMap: NAMES,
      }),
    ).toMatchObject({
      primary: "Unknown Service",
      typeLabel: "Service",
      isResolved: true,
    });
  });

  test("a blank id never matches a map entry", () => {
    expect(
      getProfileEntityDisplay({
        entityId: "",
        entityType: ServiceType.Host,
        nameMap: { "": NAMES[RUM_APP_ID]! },
      }),
    ).toEqual({
      primary: "Host",
      typeLabel: "Host",
      isResolved: false,
      shortId: "",
    });
  });
});

describe("getProfileServiceFilterChipDisplay", () => {
  test("a loaded Service name is used straight away", () => {
    expect(
      getProfileServiceFilterChipDisplay({
        serviceId: SERVICE_ID,
        serviceName: "checkout-api",
        nameMap: {},
      }),
    ).toEqual({ key: "Service", value: "checkout-api", isResolved: true });
  });

  test("REGRESSION: a deep link to a non-Service source shows its name, not an 8-char prefix", () => {
    expect(
      getProfileServiceFilterChipDisplay({
        serviceId: RUM_APP_ID,
        serviceName: undefined,
        nameMap: NAMES,
      }),
    ).toEqual({
      key: "RUM Application",
      value: "checkout-web",
      isResolved: true,
    });
  });

  test("a Service past the per-project cap resolves through the resolver", () => {
    expect(
      getProfileServiceFilterChipDisplay({
        serviceId: SERVICE_ID,
        nameMap: NAMES,
      }),
    ).toEqual({ key: "Service", value: "checkout-api", isResolved: true });
  });

  test("REGRESSION: a deep link to a loaded Host reads 'Host: <name>', not 'Service: <prefix>'", () => {
    /*
     * The table does not send a loaded Host's id to the resolver, so the
     * chip must name it from the Host list alone (an empty name map).
     */
    expect(
      getProfileServiceFilterChipDisplay({
        serviceId: HOST_ID,
        serviceName: undefined,
        hostName: "web-01",
        nameMap: {},
      }),
    ).toEqual({ key: "Host", value: "web-01", isResolved: true });
  });

  test("a loaded Service name wins over a Host name for the same id", () => {
    expect(
      getProfileServiceFilterChipDisplay({
        serviceId: SERVICE_ID,
        serviceName: "checkout-api",
        hostName: "web-01",
        nameMap: {},
      }),
    ).toEqual({ key: "Service", value: "checkout-api", isResolved: true });
  });

  test("without list names the chip is unresolved until the resolver answers", () => {
    expect(
      getProfileServiceFilterChipDisplay({
        serviceId: HOST_ID,
        serviceName: undefined,
        hostName: undefined,
        nameMap: undefined,
      }).isResolved,
    ).toBe(false);
  });

  test("an id nothing can name degrades to the short id under 'Service'", () => {
    expect(
      getProfileServiceFilterChipDisplay({
        serviceId: UNRESOLVED_ID,
        nameMap: NAMES,
      }),
    ).toEqual({ key: "Service", value: "eeeeeeee…", isResolved: false });
  });
});
