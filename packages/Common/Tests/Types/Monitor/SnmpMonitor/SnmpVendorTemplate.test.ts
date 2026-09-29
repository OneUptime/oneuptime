import SnmpOid from "../../../../Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
  SnmpVendorTemplates,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";

describe("SnmpVendorTemplateUtil", () => {
  describe("getAll", () => {
    test("returns every registered template", () => {
      expect(SnmpVendorTemplateUtil.getAll()).toBe(SnmpVendorTemplates);
      expect(SnmpVendorTemplateUtil.getAll().length).toBeGreaterThan(0);
    });

    test("every template has an id, label, description and at least one oid", () => {
      const seenIds: Set<string> = new Set<string>();

      for (const template of SnmpVendorTemplateUtil.getAll()) {
        expect(template.id.length).toBeGreaterThan(0);
        expect(template.label.length).toBeGreaterThan(0);
        expect(template.description.length).toBeGreaterThan(0);
        expect(template.oids.length).toBeGreaterThan(0);

        // Ids are unique so getById is unambiguous.
        expect(seenIds.has(template.id)).toBe(false);
        seenIds.add(template.id);

        // Each oid within a template carries an OID string.
        for (const oid of template.oids) {
          expect(oid.oid.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("getById", () => {
    test("returns the matching template", () => {
      const first: SnmpVendorTemplate = SnmpVendorTemplateUtil.getAll()[0]!;
      expect(SnmpVendorTemplateUtil.getById(first.id)).toBe(first);
    });

    test("returns undefined for an unknown id", () => {
      expect(SnmpVendorTemplateUtil.getById("does-not-exist")).toBeUndefined();
    });
  });

  describe("mergeOids", () => {
    test("returns the existing list unchanged for an unknown template id", () => {
      const existing: Array<SnmpOid> = [{ oid: "1.2.3", name: "custom" }];

      const merged: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
        existing,
        "does-not-exist",
      );

      expect(merged).toBe(existing);
    });

    test("appends all of a template's oids onto an empty list", () => {
      const template: SnmpVendorTemplate = SnmpVendorTemplateUtil.getAll()[0]!;

      const merged: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
        [],
        template.id,
      );

      expect(
        merged.map((o: SnmpOid) => {
          return o.oid;
        }),
      ).toEqual(
        template.oids.map((o: SnmpOid) => {
          return o.oid;
        }),
      );
    });

    test("does not duplicate an oid that already exists", () => {
      const template: SnmpVendorTemplate = SnmpVendorTemplateUtil.getAll()[0]!;
      const firstOid: SnmpOid = template.oids[0]!;

      const merged: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
        [{ oid: firstOid.oid, name: "already here" }],
        template.id,
      );

      const occurrences: number = merged.filter((o: SnmpOid) => {
        return o.oid === firstOid.oid;
      }).length;
      expect(occurrences).toBe(1);

      // The pre-existing entry is preserved (not overwritten by the template's).
      expect(merged[0]).toEqual({ oid: firstOid.oid, name: "already here" });

      // The merged list has one entry per distinct oid in existing ∪ template.
      expect(merged.length).toBe(template.oids.length);
    });

    test("is idempotent — applying the same template twice adds nothing new", () => {
      const template: SnmpVendorTemplate = SnmpVendorTemplateUtil.getAll()[0]!;

      const once: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
        [],
        template.id,
      );
      const twice: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
        once,
        template.id,
      );

      expect(
        twice.map((o: SnmpOid) => {
          return o.oid;
        }),
      ).toEqual(
        once.map((o: SnmpOid) => {
          return o.oid;
        }),
      );
    });

    test("preserves the caller's existing oids and appends only new ones", () => {
      const template: SnmpVendorTemplate = SnmpVendorTemplateUtil.getAll()[0]!;
      const custom: SnmpOid = { oid: "9.9.9.9", name: "custom metric" };

      const merged: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
        [custom],
        template.id,
      );

      // Existing custom oid stays first, template oids follow.
      expect(merged[0]).toEqual(custom);
      expect(merged.length).toBe(1 + template.oids.length);
      for (const oid of template.oids) {
        expect(
          merged.map((o: SnmpOid) => {
            return o.oid;
          }),
        ).toContain(oid.oid);
      }
    });

    test("does not mutate the input array", () => {
      const template: SnmpVendorTemplate = SnmpVendorTemplateUtil.getAll()[0]!;
      const existing: Array<SnmpOid> = [{ oid: "9.9.9.9" }];

      SnmpVendorTemplateUtil.mergeOids(existing, template.id);

      expect(existing).toEqual([{ oid: "9.9.9.9" }]);
    });
  });
});
