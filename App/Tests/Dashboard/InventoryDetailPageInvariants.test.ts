import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The inventory detail pages replaced a single 657-line page that rendered
 * every attribute as an undifferentiated definition list, aged every row the
 * same way regardless of source, and offered edit and delete on rows the
 * server would rewrite or re-create.
 *
 * These are the invariants that keep the replacement honest. Each one is
 * something that is wrong in a way nothing crashes over:
 *
 *   - Telemetry read through the signal's primary owner instead of
 *     `entityKeys` membership returns nothing at all for a pod, which looks
 *     like "this pod has no telemetry" rather than like a bug.
 *   - Relationships queried in one direction only silently halve the graph.
 *   - A delete page with no source caveat promises a permanence it cannot
 *     deliver for two of the three sources.
 *   - An edit form offering `entityType` or `entityKey` re-identifies the row
 *     and strands every edge pointing at the old key.
 *
 * The App suite runs in a plain Node environment with no React renderer, so
 * these are source-level invariants, following the same pattern as
 * EmptyResourceInventoryPages.test.ts.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadCodeFunction = (...segments: Array<string>) => string;

/** Source with comments removed and whitespace squashed to single spaces. */
const readCode: ReadCodeFunction = (...segments: Array<string>): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
};

describe("the item overview", () => {
  const overview: string = readCode(
    "Pages",
    "Inventory",
    "View",
    "Index.tsx",
  );

  test("leads with all three identity badges", () => {
    /*
     * Type, source and status are what make the rest of the page mean
     * anything — "last seen 4 months ago" is alarming for a discovered
     * service and meaningless for a hand-registered vendor API.
     */
    expect(overview).toContain("<InventoryTypeBadge");
    expect(overview).toContain("<InventorySourceBadge");
    expect(overview).toContain("<InventoryLivenessBadge");
  });

  test("explains what the row's source means", () => {
    expect(overview).toContain("getInventorySourceDescriptor");
  });

  test("the identity key is copyable", () => {
    // It is the value support asks for; selecting 16 hex chars by hand is not.
    expect(overview).toContain("<CopyTextButton");
  });

  test("cross-links to the rich page for the same thing when there is one", () => {
    expect(overview).toContain("resolveTypedRowLink");
  });

  test("renders the attribute inspector rather than a raw list", () => {
    expect(overview).toContain("<InventoryAttributes");
  });
});

describe("the attribute inspector", () => {
  const attributes: string = readCode(
    "Components",
    "Inventory",
    "InventoryAttributes.tsx",
  );

  test("keeps identifying and descriptive attributes apart", () => {
    /*
     * The split is the difference between what the thing IS and what merely
     * happens to be true of it — which is why an item survives a redeploy.
     */
    expect(attributes).toContain("props.identifyingAttributes");
    expect(attributes).toContain("props.descriptiveAttributes");
    /*
     * Both groups render through one helper, so the test id is what tells the
     * two apart in the DOM.
     */
    expect(attributes).toContain(
      'renderRows(identifying, "inventory-identifying-attributes")',
    );
    expect(attributes).toContain(
      'renderRows(descriptive, "inventory-descriptive-attributes")',
    );
    expect(attributes).toContain("data-testid={testId}");
  });

  test("filters on keys and on values", () => {
    // "which attribute has this value" is as common as "what is this key".
    expect(attributes).toContain("key.toLowerCase().includes(needle)");
    expect(attributes).toContain("String(value).toLowerCase().includes(needle)");
  });

  test("only offers the filter when there is enough to filter", () => {
    expect(attributes).toContain("totalCount > 8");
  });

  test("renders nothing at all when the item carries no attributes", () => {
    // An empty "Attributes" card reads as a loading failure.
    expect(attributes).toContain("if (totalCount === 0) { return <></>; }");
  });
});

describe("the relationships view", () => {
  const relationships: string = readCode(
    "Components",
    "Inventory",
    "InventoryRelationships.tsx",
  );

  test("queries edges from both ends", () => {
    // One direction silently halves the graph.
    expect(relationships).toContain("fromEntityKey: props.entityKey");
    expect(relationships).toContain("toEntityKey: props.entityKey");
  });

  test("resolves the far end of each edge in one batched read", () => {
    /*
     * Per-row lookups would be N requests; without any lookup the rows read
     * as pairs of 16-hex hashes.
     */
    expect(relationships).toContain("new Includes(otherKeys)");
  });

  test("phrases each edge from this item's end", () => {
    expect(relationships).toContain(
      "getRelationshipPhrase(row.relationshipType, row.direction)",
    );
  });

  test("an edge whose far end has no row still renders", () => {
    // The connection is real even when we can no longer name what it points at.
    expect(relationships).toContain("row.otherEntityKey.substring(0, 16)");
  });
});

describe("the telemetry view", () => {
  const telemetry: string = readCode(
    "Pages",
    "Inventory",
    "View",
    "Telemetry.tsx",
  );

  test("reads telemetry by entityKeys membership, not by primary owner", () => {
    /*
     * A span owned by the checkout service but executed on this pod belongs
     * to both. A primary-owner query returns nothing at all for a pod.
     */
    expect(telemetry).toContain("entityKeysFilter={[entityKey]}");
    expect(telemetry).toContain("entityKeys: new Includes([entityKey])");
    expect(telemetry).toContain("entityKeys={[entityKey]}");
  });

  test("covers every signal type", () => {
    for (const viewer of [
      "TracesViewer",
      "LogsViewer",
      "MetricsViewer",
      "ExceptionsTable",
      "ProfileTable",
    ]) {
      expect(telemetry).toContain(viewer);
    }
  });
});

describe("the settings page", () => {
  const settings: string = readCode(
    "Pages",
    "Inventory",
    "View",
    "Settings.tsx",
  );

  test("edits only the fields a human owns", () => {
    expect(settings).toContain("displayName: true");
    expect(settings).toContain("description: true");
  });

  test("never offers the type or the identity key as editable", () => {
    /*
     * Both are derived server-side from (project, type, name). Editing either
     * re-identifies the row and strands every edge pointing at the old key.
     */
    const formSection: string = settings.slice(
      settings.indexOf("formFields={["),
      settings.indexOf("modelDetailProps={{"),
    );

    expect(formSection.length).toBeGreaterThan(0);
    expect(formSection).not.toContain("entityType: true");
    expect(formSection).not.toContain("entityKey: true");
  });

  test("still shows the type and key read-only, so they are findable", () => {
    const detailSection: string = settings.slice(
      settings.indexOf("modelDetailProps={{"),
    );

    expect(detailSection).toContain("entityType: true");
    expect(detailSection).toContain("entityKey: true");
  });
});

describe("the delete page", () => {
  const remove: string = readCode("Pages", "Inventory", "View", "Delete.tsx");

  test("warns when deleting will not stick", () => {
    /*
     * Discovered rows come back on the next reconcile and mirrored rows on
     * the next poll. Finding that out an hour later is the worst way to
     * learn it.
     */
    expect(remove).toContain("getInventoryDeleteCaveat");
    expect(remove).toContain('dataTestId="inventory-delete-caveat"');
  });

  test("returns to the list rather than to a page that no longer exists", () => {
    expect(remove).toContain("RouteMap[PageMap.INVENTORY_ITEMS] as Route");
  });
});

describe("the item loader", () => {
  const loader: string = readCode(
    "Components",
    "Inventory",
    "useInventoryItem.ts",
  );

  test("selects every column the detail tabs read", () => {
    for (const field of [
      "entityType",
      "displayName",
      "entityKey",
      "source",
      "description",
      "labels",
      "identifyingAttributes",
      "descriptiveAttributes",
      "resourceType",
      "resourceId",
      "firstSeenAt",
      "lastSeenAt",
    ]) {
      expect(loader).toContain(`${field}: true`);
    }
  });

  test("drops a response that lands after the id changed", () => {
    // Otherwise the wrong item renders under the right URL.
    expect(loader).toContain("if (isCancelled) { return; }");
  });
});

describe("the documentation page", () => {
  const documentation: string = readCode(
    "Pages",
    "Inventory",
    "Documentation.tsx",
  );

  test("is generated from the catalog rather than hand-listed", () => {
    /*
     * A hand-written list of types goes stale the first time one is added,
     * and a docs page listing types the product does not have is worse than
     * no docs page.
     */
    expect(documentation).toContain("INVENTORY_CATEGORY_ORDER");
    expect(documentation).toContain("getEntityTypesInCategory");
    expect(documentation).toContain("INVENTORY_SOURCE_ORDER");
  });

  test("quotes the real staleness thresholds", () => {
    expect(documentation).toContain("INVENTORY_LIVE_WINDOW_MINUTES");
    expect(documentation).toContain("INVENTORY_STALE_AFTER_MINUTES");
  });

  test("explains that mirrored and manual items are never flagged", () => {
    expect(documentation).toContain("no heartbeat");
  });
});
