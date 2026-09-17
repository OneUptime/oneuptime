import Column from "../../../UI/Components/ModelTable/Column";
import { getExportKeysFromColumn } from "../../../UI/Components/ModelTable/ExportFromColumns";
import FieldType from "../../../UI/Components/Types/FieldType";
import Alert from "../../../Models/DatabaseModels/Alert";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import { describe, expect, test } from "@jest/globals";

describe("ModelTable ExportFromColumns", () => {
  describe("getExportKeysFromColumn", () => {
    test("it returns every field a column declares, not just the first", () => {
      /*
       * The alert "Affected Resources" cell renders five relations at once.
       * All five are selected, but the Table column's `key` only holds the
       * first, so the CSV export used to carry the hosts and drop the rest.
       */
      const column: Column<Alert> = {
        field: {
          hosts: { name: true },
          kubernetesClusters: { name: true },
          dockerHosts: { name: true },
          podmanHosts: { name: true },
          services: { name: true },
        },
        title: "Affected Resources",
        type: FieldType.EntityArray,
      };

      expect(
        getExportKeysFromColumn<Alert>({
          column: column,
          columnKey: "hosts",
        }),
      ).toEqual([
        "hosts",
        "kubernetesClusters",
        "dockerHosts",
        "podmanHosts",
        "services",
      ]);
    });

    test("it returns a single key for an ordinary column", () => {
      const column: Column<ProxmoxCluster> = {
        field: { name: true },
        title: "Name",
        type: FieldType.Text,
      };

      expect(
        getExportKeysFromColumn<ProxmoxCluster>({
          column: column,
          columnKey: "name",
        }),
      ).toEqual(["name"]);
    });

    test("it keeps the selectedProperty path the cell renders", () => {
      /*
       * columnKey already carries the "relation.property" path, and that is
       * the path the export has to read - not the bare relation.
       */
      const column: Column<Alert> = {
        field: { alertSeverity: { name: true } },
        selectedProperty: "name",
        title: "Severity",
        type: FieldType.Text,
      };

      expect(
        getExportKeysFromColumn<Alert>({
          column: column,
          columnKey: "alertSeverity.name",
        }),
      ).toEqual(["alertSeverity.name"]);
    });

    test("it drops secondary fields the user cannot read", () => {
      /*
       * Mirrors getSelectFromColumns: a field that was never selected because
       * of permissions is not on the row, so exporting it would only ever
       * produce an empty cell.
       */
      const column: Column<ProxmoxCluster> = {
        field: { nodeCount: true, onlineNodeCount: true },
        title: "Nodes",
        type: FieldType.Element,
      };

      expect(
        getExportKeysFromColumn<ProxmoxCluster>({
          column: column,
          columnKey: "nodeCount",
          hasPermissionToReadField: (field: string): boolean => {
            return field !== "onlineNodeCount";
          },
        }),
      ).toEqual(["nodeCount"]);
    });

    test("it keeps the primary field even when the permission check rejects it", () => {
      /*
       * The primary field is what the column sorts and renders by, and
       * BaseModelTable has already decided the column is visible by this
       * point. Only secondary fields are gated here.
       */
      const column: Column<ProxmoxCluster> = {
        field: { nodeCount: true, onlineNodeCount: true },
        title: "Nodes",
        type: FieldType.Element,
      };

      expect(
        getExportKeysFromColumn<ProxmoxCluster>({
          column: column,
          columnKey: "nodeCount",
          hasPermissionToReadField: (): boolean => {
            return false;
          },
        }),
      ).toEqual(["nodeCount"]);
    });

    test("it does not repeat the primary field when it is declared again", () => {
      const column: Column<ProxmoxCluster> = {
        field: { name: true, nodeCount: true },
        title: "Name",
        type: FieldType.Element,
      };

      expect(
        getExportKeysFromColumn<ProxmoxCluster>({
          column: column,
          columnKey: "name",
        }),
      ).toEqual(["name", "nodeCount"]);
    });

    test("it returns nothing for a column with no key", () => {
      const column: Column<ProxmoxCluster> = {
        field: {},
        title: "Actions",
        type: FieldType.Actions,
      };

      expect(
        getExportKeysFromColumn<ProxmoxCluster>({
          column: column,
          columnKey: null,
        }),
      ).toEqual([]);
    });
  });
});
