import { describe, expect, test } from "@jest/globals";
import {
  NETWORK_SITES_TABLE_ID,
  SITE_FACET_QUERY_FIELDS,
  SITE_PARENT_FACET_KEY,
  SITE_STATUS_FACET_KEY,
  SITE_TYPE_FACET_KEY,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteFacets";
import {
  DEVICE_INTERFACES_FACET_KEY,
  DEVICE_PROBE_FACET_KEY,
  DEVICE_SITE_FACET_KEY,
  DEVICE_STATUS_FACET_KEY,
  NETWORK_DEVICES_TABLE_ID,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceFacets";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";

/*
 * SiteFacets is the site list's facet vocabulary, and every string in it is a
 * wire format: the facet keys are the object keys of the snapshot mirrored into
 * the URL and stored in a saved TableView, and the table id is the namespace
 * that snapshot lives under. Renaming one silently drops the chips out of every
 * link already pasted into a ticket and out of every saved view, so the rename
 * has to be a conscious edit of this file.
 *
 * The query fields are the other half of the contract: they are the columns the
 * chips own, and the "Sites Without Data" tile depends on their exact spelling.
 */

const SITE_FACET_KEYS: Array<string> = [
  SITE_STATUS_FACET_KEY,
  SITE_TYPE_FACET_KEY,
  SITE_PARENT_FACET_KEY,
];

const DEVICE_FACET_KEYS: Array<string> = [
  DEVICE_STATUS_FACET_KEY,
  DEVICE_INTERFACES_FACET_KEY,
  DEVICE_SITE_FACET_KEY,
  DEVICE_PROBE_FACET_KEY,
];

describe("NETWORK_SITES_TABLE_ID", () => {
  /*
   * One string does three jobs — the table's `id`, its `userPreferencesKey` and
   * the prefix of the URL parameters its filter/facet/view state is written to.
   * Changing it orphans the stored column widths and every shared link at once.
   */
  test("is the namespace the site table's state is persisted under", () => {
    expect(NETWORK_SITES_TABLE_ID).toBe("network-sites-table");
  });

  /*
   * Both tables' parameters share one query string when a link carries state
   * for the page it came from as well as the page it lands on. A distinct prefix
   * is what keeps the site table from restoring the device table's chips.
   */
  test("is not the device table's namespace", () => {
    expect(NETWORK_SITES_TABLE_ID).not.toBe(NETWORK_DEVICES_TABLE_ID);
  });
});

describe("the site facet keys", () => {
  test("the wire values are stable", () => {
    expect(SITE_STATUS_FACET_KEY).toBe("siteStatus");
    expect(SITE_TYPE_FACET_KEY).toBe("siteType");
    expect(SITE_PARENT_FACET_KEY).toBe("siteParent");
  });

  /*
   * The keys index into one `facetSelections` map. Two chips sharing a key would
   * overwrite each other's selection, so the bar would show two chips and query
   * one.
   */
  test("there are three, and they are distinct", () => {
    expect(SITE_FACET_KEYS).toHaveLength(3);
    expect(new Set(SITE_FACET_KEYS).size).toBe(3);
  });

  /*
   * They travel as JSON object keys inside a query parameter. Anything needing
   * percent-escaping still round-trips, but it turns a shared link into
   * something nobody can read or hand-edit, so keep them URL-clean.
   */
  test("need no escaping to sit in a URL", () => {
    for (const key of SITE_FACET_KEYS) {
      expect(key.length).toBeGreaterThan(0);
      expect(encodeURIComponent(key)).toBe(key);
    }
  });
});

describe("SITE_FACET_QUERY_FIELDS", () => {
  /*
   * The column each chip owns, and so the columns the table's filter popup must
   * not also offer: BaseModelTable builds its request as
   * `{...props.query, ...columnFilterQuery}`, so a popup filter on a chip's
   * field replaces the chip's constraint outright while the chip carries on
   * claiming it applies.
   */
  test("names one column per chip", () => {
    expect(SITE_FACET_QUERY_FIELDS).toEqual({
      status: "currentMonitorStatusId",
      siteType: "networkSiteTypeId",
      parentSite: "parentSiteId",
    });
  });

  /*
   * All three are the foreign key rather than the relation it points at, and the
   * "is empty" operator is why: a site with no rolled-up status has no
   * MonitorStatus row to join against, so only the column can be asked for NULL
   * — and that NULL row set is exactly what the "Sites Without Data" tile
   * counts. Spelled as the relation, that tile's chip would ask an absent join
   * for a NULL and match nothing under a lit tile claiming a number.
   */
  test("every chip owns a foreign key column, never the relation", () => {
    for (const field of Object.values(SITE_FACET_QUERY_FIELDS)) {
      expect(field.endsWith("Id")).toBe(true);
    }

    const fields: Array<string> = Object.values(SITE_FACET_QUERY_FIELDS);

    for (const relation of [
      "currentMonitorStatus",
      "networkSiteType",
      "parentSite",
    ]) {
      expect(fields).not.toContain(relation);
    }
  });

  /*
   * Typed as `keyof NetworkSite` so a column that gets renamed in the model
   * fails the compile rather than reaching the API as an unknown field, and
   * checked against a live instance so a name that only exists in the type (a
   * relation getter, say) is caught too.
   */
  test("every field is a real NetworkSite column", () => {
    const columns: Array<keyof NetworkSite> = [
      "currentMonitorStatusId",
      "networkSiteTypeId",
      "parentSiteId",
    ];

    expect(Object.values(SITE_FACET_QUERY_FIELDS)).toEqual(columns);

    const site: NetworkSite = new NetworkSite();

    for (const column of columns) {
      expect(column in site).toBe(true);
    }
  });

  /*
   * Two chips over one column would survive the merge as an AND that can never
   * match — an empty table under two chips that each look satisfiable.
   */
  test("no two chips own the same column", () => {
    const fields: Array<string> = Object.values(SITE_FACET_QUERY_FIELDS);

    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe("the two lists' facet vocabularies", () => {
  /*
   * A link can carry both tables' state at once — the Sites page's "Unassigned
   * Devices" tile builds exactly such a link, and a saved view pasted between
   * pages does too. The keys are read out of a flat map per table, so a shared
   * key would let one page's chip restore itself on the other page's bar, where
   * no chip of that name exists to show it.
   */
  test("do not collide", () => {
    const allKeys: Array<string> = [...SITE_FACET_KEYS, ...DEVICE_FACET_KEYS];

    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  test("no site facet key is also a device facet key", () => {
    for (const key of SITE_FACET_KEYS) {
      expect(DEVICE_FACET_KEYS).not.toContain(key);
    }
  });
});
