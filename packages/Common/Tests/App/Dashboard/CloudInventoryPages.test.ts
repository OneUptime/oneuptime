import { describe, expect, test } from "@jest/globals";
import Includes from "../../../Types/BaseDatabase/Includes";
import { CloudRelationshipKind } from "../../../Types/Cloud/CloudInventory";
import {
  CloudLinkedResource,
  CloudResolvedRelationship,
} from "../../../Types/Cloud/CloudResourceIndex";
import ObjectID from "../../../Types/ObjectID";
import { ChangeEventAttribute } from "../../../Utils/Telemetry/ChangeEventFields";
import {
  getCloudAccountIdSpellings,
  getCloudAccountResourcesQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAccountScope";
import {
  CLOUD_ACCOUNT_READING_WINDOW_MS,
  getCloudAccountStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAccountStatus";
import { getCloudChangesAttributeFilter } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudChangesScope";
import {
  CloudConnectionGroup,
  groupCloudConnections,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudConnectionGroups";
import { getCloudRelationshipLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudRelationshipWords";

/*
 * What the cloud account and cloud resource pages read their rows by, and
 * how they say it: an account's resources by its cloud and its id in
 * either case, the changes a connection tied to a row, a resource's
 * connections one line per kind and direction, and an account's status.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

describe("an account's resources", () => {
  test("are its cloud's and its id's, in the case written and in either other", () => {
    expect(
      getCloudAccountIdSpellings(" 7C4A1F2E-aaaa-4bbb-8ccc-0123456789AB "),
    ).toEqual([
      "7C4A1F2E-aaaa-4bbb-8ccc-0123456789AB",
      "7c4a1f2e-aaaa-4bbb-8ccc-0123456789ab",
      "7C4A1F2E-AAAA-4BBB-8CCC-0123456789AB",
    ]);
    // A number has one spelling.
    expect(getCloudAccountIdSpellings("123456789012")).toEqual([
      "123456789012",
    ]);
    expect(getCloudAccountIdSpellings("  ")).toEqual([]);
  });

  test("live ones only, in the project", () => {
    const query: Record<string, unknown> = getCloudAccountResourcesQuery({
      projectId: PROJECT_ID,
      provider: "azure",
      accountId: "Sub-1",
    }) as Record<string, unknown>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["cloudProvider"]).toBe("azure");
    expect(query["isArchived"]).toBe(false);
    expect((query["cloudAccountId"] as Includes).values).toEqual([
      "Sub-1",
      "sub-1",
      "SUB-1",
    ]);
  });
});

describe("the changes a cloud page lists", () => {
  test("a resource's by the row a connection tied them to, an account's by its own", () => {
    const resourceId: ObjectID = ObjectID.generate();
    const accountId: ObjectID = ObjectID.generate();

    expect(
      getCloudChangesAttributeFilter({ cloudResourceId: resourceId }),
    ).toEqual({
      [ChangeEventAttribute.ResourceId]: resourceId.toString(),
    });
    expect(
      getCloudChangesAttributeFilter({ cloudAccountId: accountId }),
    ).toEqual({
      [ChangeEventAttribute.CloudAccountRecordId]: accountId.toString(),
    });
    // The same keys the recorder writes.
    expect(ChangeEventAttribute.ResourceId).toBe("oneuptime.resource.id");
    expect(ChangeEventAttribute.CloudAccountRecordId).toBe(
      "oneuptime.cloud_account.id",
    );
  });
});

describe("a resource's connections, as its card lists them", () => {
  const SUBNET: CloudLinkedResource = {
    id: ObjectID.generate(),
    name: "private-a",
    providerResourceId: "subnet-0abc",
    type: "AWS::EC2::Subnet",
    relationships: [],
  };
  const ALB: CloudLinkedResource = {
    id: ObjectID.generate(),
    name: "web-alb",
    providerResourceId: "web-alb",
    type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
    relationships: [],
  };

  function relationship(
    data: Partial<CloudResolvedRelationship> & {
      kind: CloudRelationshipKind;
      direction: "out" | "in";
    },
  ): CloudResolvedRelationship {
    return {
      other: null,
      otherName: "",
      otherType: "",
      ...data,
    };
  }

  test("one line per kind and direction, in the order met, each end once", () => {
    const groups: Array<CloudConnectionGroup> = groupCloudConnections([
      relationship({
        kind: CloudRelationshipKind.RunsIn,
        direction: "out",
        other: SUBNET,
        otherName: "private-a",
      }),
      relationship({
        kind: CloudRelationshipKind.ProtectedBy,
        direction: "out",
        otherName: "sg-0one",
      }),
      relationship({
        kind: CloudRelationshipKind.ProtectedBy,
        direction: "out",
        otherName: "SG-0ONE",
      }),
      relationship({
        kind: CloudRelationshipKind.ProtectedBy,
        direction: "out",
        otherName: "sg-0two",
      }),
      // The load balancer names it twice: one end.
      relationship({
        kind: CloudRelationshipKind.RoutesTo,
        direction: "in",
        other: ALB,
        otherName: "web-alb",
      }),
      relationship({
        kind: CloudRelationshipKind.RoutesTo,
        direction: "in",
        other: ALB,
        otherName: "web-alb",
      }),
    ]);

    expect(
      groups.map((group: CloudConnectionGroup): Array<unknown> => {
        return [
          getCloudRelationshipLabel(group.kind, group.direction),
          group.relationships.map(
            (entry: CloudResolvedRelationship): string => {
              return entry.otherName;
            },
          ),
        ];
      }),
    ).toEqual([
      ["Runs in", ["private-a"]],
      ["Protected by", ["sg-0one", "sg-0two"]],
      ["Gets traffic from", ["web-alb"]],
    ]);
  });

  test("the same kind read from each end is two lines", () => {
    expect(
      groupCloudConnections([
        relationship({
          kind: CloudRelationshipKind.PartOf,
          direction: "out",
          otherName: "cluster",
        }),
        relationship({
          kind: CloudRelationshipKind.PartOf,
          direction: "in",
          otherName: "member",
        }),
      ]).map((group: CloudConnectionGroup): string => {
        return getCloudRelationshipLabel(group.kind, group.direction);
      }),
    ).toEqual(["Part of", "Includes"]);
  });

  test("nothing to list, no lines", () => {
    expect(groupCloudConnections([])).toEqual([]);
  });
});

describe("an account's status", () => {
  const NOW: Date = new Date("2026-10-26T12:00:00Z");

  test("reading while a connection read it within the hour", () => {
    expect(
      getCloudAccountStatus({
        lastSeenAt: new Date(NOW.getTime() - CLOUD_ACCOUNT_READING_WINDOW_MS),
        hasConnection: true,
        now: NOW,
      }),
    ).toEqual({ label: "Reading", tone: "positive" });
    // As the API sends it, too.
    expect(
      getCloudAccountStatus({
        lastSeenAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
        hasConnection: true,
        now: NOW,
      }).label,
    ).toBe("Reading");
  });

  test("not read lately once that hour has passed, or when never read", () => {
    expect(
      getCloudAccountStatus({
        lastSeenAt: new Date(
          NOW.getTime() - CLOUD_ACCOUNT_READING_WINDOW_MS - 1,
        ),
        hasConnection: true,
        now: NOW,
      }),
    ).toEqual({ label: "Not read lately", tone: "warning" });
    expect(
      getCloudAccountStatus({ lastSeenAt: null, hasConnection: true, now: NOW })
        .tone,
    ).toBe("warning");
  });

  test("not connected when no connection reads it, however recently it was read", () => {
    expect(
      getCloudAccountStatus({
        lastSeenAt: NOW,
        hasConnection: false,
        now: NOW,
      }),
    ).toEqual({ label: "Not connected", tone: "neutral" });
  });
});
