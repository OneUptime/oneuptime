import { describe, expect, test } from "@jest/globals";
import EntityType from "Common/Types/Telemetry/EntityType";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  LinkedResource,
  LinkedResourceKind,
  buildLinkedResourceQuery,
  canHaveLinkedResource,
  describeMissingLink,
  getLinkedResourceKindForEntityType,
  getLinkedResourceQueryField,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/LinkedResource";

/*
 * An inventory item owns no incidents, alerts or maintenance windows. It
 * reaches them through the typed row it mirrors — a Service, Host or
 * KubernetesCluster — all three of which Incident, Alert and
 * ScheduledMaintenance already relate to.
 *
 * Two things can go quietly wrong with that:
 *
 *   - The relation name could drift. `services` / `hosts` /
 *     `kubernetesClusters` are strings here, and a wrong one produces a query
 *     the API accepts and that matches nothing, so the page renders an empty
 *     table that reads as "no incidents" rather than as a bug.
 *   - An entity type could be assumed to reach a typed row when it cannot. A
 *     pod has no Host row of its own; promising one sends people looking for
 *     a page that will never exist.
 *
 * The first is checked against the real model classes rather than against a
 * copy of the names.
 */

const ALL_KINDS: Array<LinkedResourceKind> = Object.values(LinkedResourceKind);

describe("the relation names exist on the models that carry them", () => {
  /*
   * Instantiating each model gives the property set the API will accept.
   * Checking against that, rather than against a literal, is what makes a
   * renamed relation fail here instead of silently matching nothing.
   */
  const MODELS: Array<{ label: string; instance: BaseModel }> = [
    { label: "Incident", instance: new Incident() },
    { label: "Alert", instance: new Alert() },
    { label: "ScheduledMaintenance", instance: new ScheduledMaintenance() },
  ];

  test("there are kinds to check", () => {
    expect(ALL_KINDS.length).toBeGreaterThan(0);
  });

  for (const model of MODELS) {
    for (const kind of ALL_KINDS) {
      test(`${model.label} has a "${getLinkedResourceQueryField(kind)}" relation`, () => {
        expect(
          Object.prototype.hasOwnProperty.call(
            model.instance,
            getLinkedResourceQueryField(kind),
          ),
        ).toBe(true);
      });
    }
  }
});

describe("query building", () => {
  const ID: ObjectID = new ObjectID("d4e5f6a7-b8c9-0123-def1-234567890123");

  test.each(ALL_KINDS)(
    "%s builds a single-relation query",
    (kind: LinkedResourceKind) => {
      const resource: LinkedResource = { kind, id: ID };
      const query: Record<string, Includes> =
        buildLinkedResourceQuery(resource);

      expect(Object.keys(query)).toEqual([getLinkedResourceQueryField(kind)]);
    },
  );

  test("the query selects by the resource id", () => {
    const query: Record<string, Includes> = buildLinkedResourceQuery({
      kind: LinkedResourceKind.Service,
      id: ID,
    });

    const includes: Includes = query["services"]!;

    expect(includes).toBeInstanceOf(Includes);
    expect(includes.values.map(String)).toEqual([ID.toString()]);
  });

  test("each kind maps to a distinct relation", () => {
    // Two kinds sharing a relation would silently query the wrong table.
    const fields: Array<string> = ALL_KINDS.map(
      (kind: LinkedResourceKind): string => {
        return getLinkedResourceQueryField(kind);
      },
    );

    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe("which entity types can reach a typed row", () => {
  test.each([
    [EntityType.Service, LinkedResourceKind.Service],
    [EntityType.Host, LinkedResourceKind.Host],
    [EntityType.KubernetesCluster, LinkedResourceKind.KubernetesCluster],
  ])("%s maps to %s", (entityType: EntityType, kind: LinkedResourceKind) => {
    expect(getLinkedResourceKindForEntityType(entityType)).toBe(kind);
    expect(canHaveLinkedResource(entityType)).toBe(true);
  });

  test.each([
    EntityType.KubernetesPod,
    EntityType.Container,
    EntityType.Process,
    EntityType.ExternalService,
    EntityType.Appliance,
    EntityType.NetworkDevice,
    EntityType.IoTDevice,
  ])("%s reaches nothing, and says so", (entityType: EntityType) => {
    /*
     * These are the types the empty state exists for. Claiming a link would
     * send someone hunting for a page that does not exist.
     */
    expect(getLinkedResourceKindForEntityType(entityType)).toBeNull();
    expect(canHaveLinkedResource(entityType)).toBe(false);
  });

  test("every entity type gets a definite answer", () => {
    for (const entityType of Object.values(EntityType)) {
      const kind: LinkedResourceKind | null =
        getLinkedResourceKindForEntityType(entityType);

      expect(kind === null || ALL_KINDS.includes(kind)).toBe(true);
    }
  });

  test("an unknown or missing type reaches nothing rather than guessing", () => {
    expect(getLinkedResourceKindForEntityType("future.thing")).toBeNull();
    expect(getLinkedResourceKindForEntityType(undefined)).toBeNull();
    expect(canHaveLinkedResource(undefined)).toBe(false);
  });
});

describe("the empty-state sentence", () => {
  test("names the kind of thing the reader is looking at", () => {
    expect(
      describeMissingLink(EntityType.KubernetesPod, "incidents"),
    ).toContain("Kubernetes Pod");
  });

  test("starts with the signal, capitalised", () => {
    expect(
      describeMissingLink(EntityType.Container, "alerts").startsWith("Alerts"),
    ).toBe(true);
    expect(
      describeMissingLink(
        EntityType.Container,
        "maintenance windows",
      ).startsWith("Maintenance windows"),
    ).toBe(true);
  });

  test("points somewhere the reader can actually go", () => {
    // A dead end is worse than an empty table.
    expect(
      describeMissingLink(EntityType.KubernetesPod, "incidents"),
    ).toContain("Connections");
  });

  test("degrades without an entity type", () => {
    expect(describeMissingLink(undefined, "incidents").length).toBeGreaterThan(
      0,
    );
  });
});
