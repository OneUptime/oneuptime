/**
 * NetworkSite hierarchy model contracts.
 *
 * NetworkSite is the schema's first self-nesting container: parentSite is a
 * ManyToOne pointing back at NetworkSite itself. That self-reference is easy
 * to break silently — a lazy-arrow typo or a decorator reorder leaves tsc
 * green while TypeORM builds a relation to the wrong target. The FK actions
 * are pinned too, because they carry the deletion semantics of the whole
 * hierarchy: deleting a parent must orphan (SET NULL) its children, not
 * cascade the subtree away, while timelines/links/rules die with their site.
 */

import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "../../Models/DatabaseModels/NetworkEndpoint";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import NetworkSiteAssignmentRule from "../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import NetworkSiteLink from "../../Models/DatabaseModels/NetworkSiteLink";
import NetworkSiteStatusTimeline from "../../Models/DatabaseModels/NetworkSiteStatusTimeline";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { getUniqueColumnBy } from "../../Types/Database/UniqueColumnBy";
import GenericFunction from "../../Types/GenericFunction";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

function relationArgs(
  target: GenericFunction,
  propertyName: string,
): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs) => {
      return (
        relation.target === target && relation.propertyName === propertyName
      );
    },
  );
}

function relationTarget(
  relation: RelationMetadataArgs | undefined,
): GenericFunction | undefined {
  const type: unknown = relation?.type;
  if (typeof type === "function" && type.prototype === undefined) {
    return (type as () => GenericFunction)();
  }
  return type as GenericFunction | undefined;
}

describe("NetworkSite self-nesting hierarchy", () => {
  test("parentSite is an Entity relation back to NetworkSite", () => {
    const metadata: TableColumnMetadata =
      new NetworkSite().getTableColumnMetadata("parentSite");

    expect(metadata).toBeDefined();
    expect(metadata.type).toBe(TableColumnType.Entity);
    expect(metadata.modelType).toBe(NetworkSite);
    expect(metadata.manyToOneRelationColumn).toBe("parentSiteId");
  });

  test("parentSite FK resolves to NetworkSite and orphans children with SET NULL", () => {
    const relation: RelationMetadataArgs | undefined = relationArgs(
      NetworkSite,
      "parentSite",
    );

    expect(relation).toBeDefined();
    expect(relationTarget(relation)).toBe(NetworkSite);
    expect(relation?.options.onDelete).toBe("SET NULL");
  });

  test("NetworkDevice.site relation targets NetworkSite with SET NULL", () => {
    const metadata: TableColumnMetadata =
      new NetworkDevice().getTableColumnMetadata("site");

    expect(metadata.modelType).toBe(NetworkSite);
    expect(metadata.manyToOneRelationColumn).toBe("siteId");

    const relation: RelationMetadataArgs | undefined = relationArgs(
      NetworkDevice,
      "site",
    );
    expect(relationTarget(relation)).toBe(NetworkSite);
    expect(relation?.options.onDelete).toBe("SET NULL");
  });

  test("child rows die with their site: CASCADE from timeline, link and rule", () => {
    expect(
      relationArgs(NetworkSiteStatusTimeline, "site")?.options.onDelete,
    ).toBe("CASCADE");
    expect(relationArgs(NetworkSiteLink, "fromSite")?.options.onDelete).toBe(
      "CASCADE",
    );
    expect(relationArgs(NetworkSiteLink, "toSite")?.options.onDelete).toBe(
      "CASCADE",
    );
    expect(
      relationArgs(NetworkSiteAssignmentRule, "site")?.options.onDelete,
    ).toBe("CASCADE");
  });

  test("endpoints detach from sites (SET NULL) but die with their device (CASCADE)", () => {
    expect(relationArgs(NetworkEndpoint, "site")?.options.onDelete).toBe(
      "SET NULL",
    );
    expect(
      relationArgs(NetworkEndpoint, "attachedNetworkDevice")?.options.onDelete,
    ).toBe("CASCADE");
  });

  test("endpoints are unique per MAC per project", () => {
    expect(getUniqueColumnBy(new NetworkEndpoint(), "macAddress")).toBe(
      "projectId",
    );
  });

  test("crud api routes are registered", () => {
    expect(new NetworkSite().getCrudApiPath()?.toString()).toBe(
      "/network-site",
    );
    expect(new NetworkEndpoint().getCrudApiPath()?.toString()).toBe(
      "/network-endpoint",
    );
    expect(new NetworkSiteStatusTimeline().getCrudApiPath()?.toString()).toBe(
      "/network-site-status-timeline",
    );
    expect(new NetworkSiteLink().getCrudApiPath()?.toString()).toBe(
      "/network-site-link",
    );
    expect(new NetworkSiteAssignmentRule().getCrudApiPath()?.toString()).toBe(
      "/network-site-assignment-rule",
    );
  });
});
