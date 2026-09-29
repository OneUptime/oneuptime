import Columns from "../../../UI/Components/ModelTable/Columns";
import {
  getRelationSelectFromColumns,
  getSelectFromColumns,
} from "../../../UI/Components/ModelTable/SelectFromColumns";
import FieldType from "../../../UI/Components/Types/FieldType";
import Alert from "../../../Models/DatabaseModels/Alert";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

describe("ModelTable SelectFromColumns", () => {
  describe("getSelectFromColumns", () => {
    test("it selects every field a column declares, not just the first", () => {
      /*
       * Regression for OneUptime/oneuptime#2756: the Proxmox clusters list
       * rendered "0/3 online" for a fully online cluster because only the
       * first key of the column's field map was selected, leaving
       * onlineNodeCount undefined on every row.
       */
      const columns: Columns<ProxmoxCluster> = [
        {
          field: {
            nodeCount: true,
            onlineNodeCount: true,
          },
          title: "Nodes",
          type: FieldType.Element,
        },
      ];

      const select: Record<string, unknown> =
        getSelectFromColumns<ProxmoxCluster>({
          columns: columns,
          model: new ProxmoxCluster(),
        }) as Record<string, unknown>;

      expect(select["nodeCount"]).toBe(true);
      expect(select["onlineNodeCount"]).toBe(true);
    });

    test("it always selects _id", () => {
      const select: Record<string, unknown> =
        getSelectFromColumns<ProxmoxCluster>({
          columns: [],
          model: new ProxmoxCluster(),
        }) as Record<string, unknown>;

      expect(select["_id"]).toBe(true);
    });

    test("it merges fields across multiple columns", () => {
      const columns: Columns<ProxmoxCluster> = [
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
        },
        {
          field: { guestCount: true, storageCount: true },
          title: "Inventory",
          type: FieldType.Element,
        },
      ];

      const select: Record<string, unknown> =
        getSelectFromColumns<ProxmoxCluster>({
          columns: columns,
          model: new ProxmoxCluster(),
        }) as Record<string, unknown>;

      expect(select["name"]).toBe(true);
      expect(select["guestCount"]).toBe(true);
      expect(select["storageCount"]).toBe(true);
    });

    test("it skips columns that declare no field", () => {
      const columns: Columns<ProxmoxCluster> = [
        {
          field: undefined as never,
          title: "Actions",
          type: FieldType.Element,
        },
      ];

      const select: Record<string, unknown> =
        getSelectFromColumns<ProxmoxCluster>({
          columns: columns,
          model: new ProxmoxCluster(),
        }) as Record<string, unknown>;

      expect(Object.keys(select)).toEqual(["_id"]);
    });

    test("it throws when the primary field is not a column on the model", () => {
      const columns: Columns<ProxmoxCluster> = [
        {
          field: { notARealColumn: true } as never,
          title: "Nope",
          type: FieldType.Text,
        },
      ];

      expect(() => {
        return getSelectFromColumns<ProxmoxCluster>({
          columns: columns,
          model: new ProxmoxCluster(),
        });
      }).toThrow(BadDataException);
    });

    test("it ignores a non-column secondary field rather than blanking the page", () => {
      const columns: Columns<ProxmoxCluster> = [
        {
          field: { nodeCount: true, notARealColumn: true } as never,
          title: "Nodes",
          type: FieldType.Element,
        },
      ];

      const consoleError: jest.SpyInstance = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const select: Record<string, unknown> =
        getSelectFromColumns<ProxmoxCluster>({
          columns: columns,
          model: new ProxmoxCluster(),
        }) as Record<string, unknown>;

      expect(select["nodeCount"]).toBe(true);
      expect(select["notARealColumn"]).toBeUndefined();
      // It must not drop the field silently — that is how #2756 hid.
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    test("it drops a secondary field the user cannot read, so the API does not reject the whole request", () => {
      /*
       * checkSelectPermission throws NotAuthorizedException for the entire
       * request when the select names an unreadable column, so widening the
       * select must never add one.
       */
      const columns: Columns<ProxmoxCluster> = [
        {
          field: {
            nodeCount: true,
            onlineNodeCount: true,
          },
          title: "Nodes",
          type: FieldType.Element,
        },
      ];

      const select: Record<string, unknown> =
        getSelectFromColumns<ProxmoxCluster>({
          columns: columns,
          model: new ProxmoxCluster(),
          hasPermissionToReadField: (field: string): boolean => {
            return field !== "onlineNodeCount";
          },
        }) as Record<string, unknown>;

      expect(select["nodeCount"]).toBe(true);
      expect(select["onlineNodeCount"]).toBeUndefined();
    });

    test("it keeps the primary field even when the permission callback rejects it, preserving prior behaviour", () => {
      const columns: Columns<ProxmoxCluster> = [
        {
          field: { nodeCount: true, onlineNodeCount: true },
          title: "Nodes",
          type: FieldType.Element,
        },
      ];

      const select: Record<string, unknown> =
        getSelectFromColumns<ProxmoxCluster>({
          columns: columns,
          model: new ProxmoxCluster(),
          hasPermissionToReadField: (): boolean => {
            return false;
          },
        }) as Record<string, unknown>;

      expect(select["nodeCount"]).toBe(true);
      expect(select["onlineNodeCount"]).toBeUndefined();
    });
  });

  describe("getRelationSelectFromColumns", () => {
    test("it selects every relation a column declares, not just the first", () => {
      const columns: Columns<Alert> = [
        {
          field: {
            monitor: { name: true, _id: true },
            labels: { name: true, color: true },
          },
          title: "Resource",
          type: FieldType.Element,
        },
      ];

      const relationSelect: Record<string, unknown> =
        getRelationSelectFromColumns<Alert>({
          columns: columns,
          model: new Alert(),
        }) as Record<string, unknown>;

      expect(relationSelect["monitor"]).toEqual({ name: true, _id: true });
      expect(relationSelect["labels"]).toEqual({ name: true, color: true });
    });

    test("it leaves non-entity fields out of the relation select", () => {
      const columns: Columns<ProxmoxCluster> = [
        {
          field: {
            nodeCount: true,
            onlineNodeCount: true,
          },
          title: "Nodes",
          type: FieldType.Element,
        },
      ];

      const relationSelect: Record<string, unknown> =
        getRelationSelectFromColumns<ProxmoxCluster>({
          columns: columns,
          model: new ProxmoxCluster(),
        }) as Record<string, unknown>;

      expect(relationSelect).toEqual({});
    });

    test("it merges the same relation declared by two columns", () => {
      const columns: Columns<Alert> = [
        {
          field: { monitor: { name: true } },
          title: "Monitor",
          type: FieldType.Element,
        },
        {
          field: { monitor: { _id: true } },
          title: "Monitor Id",
          type: FieldType.Element,
        },
      ];

      const relationSelect: Record<string, unknown> =
        getRelationSelectFromColumns<Alert>({
          columns: columns,
          model: new Alert(),
        }) as Record<string, unknown>;

      expect(relationSelect["monitor"]).toEqual({ name: true, _id: true });
    });
  });
});
