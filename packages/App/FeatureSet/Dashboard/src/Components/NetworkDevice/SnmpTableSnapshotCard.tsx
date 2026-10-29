import {
  SnmpTableFailureReason,
  SnmpTableKind,
  SnmpTableSnapshot,
  SnmpTableSnapshotCell,
  SnmpTableSnapshotColumn,
  SnmpTableSnapshotRow,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import OneUptimeDate from "Common/Types/Date";
import { FIRST_PROBE_VERSION_WITH_SNMP_TABLES } from "Common/Types/Probe/ProbeCapability";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";

export interface ComponentProps {
  snapshot: SnmpTableSnapshot;
}

// A value that already carries its unit, such as "80MHz" or "45%".
const ENDS_WITH_UNIT: RegExp = /[a-z%]$/i;

/*
 * Column names and values up to this long stay on one line - "TX Power",
 * "2.4 GHz", "20 dBm" or "active" never stack over two - and a narrow
 * screen scrolls the table sideways. Longer text (a description, a long
 * column name a table was given) wraps in a column of its own width.
 */
const ONE_LINE_VALUE_LENGTH: number = 24;

// What each table kind is, in a few words, for the card's description.
const KIND_DESCRIPTIONS: Record<SnmpTableKind, string> = {
  [SnmpTableKind.Generic]: translationKey("Rows walked from the device."),
  [SnmpTableKind.WifiRadio]: translationKey("One row per Wi-Fi radio."),
  [SnmpTableKind.WifiSsid]: translationKey("One row per SSID."),
  [SnmpTableKind.WifiAccessPoint]: translationKey(
    "One row per access point the controller manages.",
  ),
  [SnmpTableKind.VpnTunnel]: translationKey("One row per VPN tunnel."),
  [SnmpTableKind.RoutingAdjacency]: translationKey(
    "One row per routing neighbour.",
  ),
  [SnmpTableKind.Hardware]: translationKey("One row per hardware component."),
};

/*
 * One walked SNMP table as the device last reported it: every row, every
 * column, and - for status columns that declare their healthy values - a
 * green or red mark, so a down tunnel or a failed fan stands out without
 * anyone writing a criteria first.
 */
const SnmpTableSnapshotCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const snapshot: SnmpTableSnapshot = props.snapshot;

  /*
   * The walked table's columns as wide as a person makes them (Common's
   * Table/ColumnResize), after each row's index: one set of widths for
   * each table a device is walked for.
   */
  const snapshotColumns: ResizableColumns = useResizableColumns({
    tableKey: `snmp-table-snapshot.${snapshot.name}`,
    columns: snapshot.columns.map(
      (
        column: SnmpTableSnapshotColumn,
        index: number,
      ): { id: string; cellNumber: number } => {
        return { id: column.oid, cellNumber: index + 2 };
      },
    ),
  });

  const unhealthyRowCount: number = snapshot.rows.filter(
    (row: SnmpTableSnapshotRow): boolean => {
      return Object.values(row.cells || {}).some(
        (cell: SnmpTableSnapshotCell): boolean => {
          return cell.isHealthy === false;
        },
      );
    },
  ).length;

  const kindDescription: string =
    KIND_DESCRIPTIONS[snapshot.kind] ||
    KIND_DESCRIPTIONS[SnmpTableKind.Generic];

  const descriptionParts: Array<string> = [
    translator.translateText(kindDescription) || kindDescription,
  ];

  if (snapshot.collectedAt) {
    descriptionParts.push(
      translator.translateTemplate("Collected {{time}}.", {
        time: OneUptimeDate.fromNow(new Date(snapshot.collectedAt)),
      }),
    );
  }

  /*
   * Rows the walk read and left out of the table: an SSID table's networks
   * the access point runs for itself (UniFi's mesh link and adoption
   * network) and interfaces that broadcast none.
   */
  const leftOutRowCount: number = snapshot.leftOutRowCount || 0;

  /*
   * An SSID table whose rows were all the device's own: it answered with
   * rows, and none is a network people join. Saying "the device returned no
   * rows - check the SNMP view" would send its owner the wrong way.
   */
  const ownNetworksOnly: boolean =
    SnmpTableListUtil.showsOnlyOwnNetworks(snapshot);

  /*
   * Why the last walk read nothing, in the words that fit what is left:
   * the rows from an earlier walk, or none at all. A probe that answered
   * without walking the table is told apart from a walk that failed - the
   * fix is updating the probe, not the device.
   */
  const getFailureText: () => string | undefined = (): string | undefined => {
    if (!snapshot.failureCause) {
      return undefined;
    }

    // An earlier walk read rows, even when every one of them was left out.
    const hasRows: boolean = snapshot.rows.length > 0 || leftOutRowCount > 0;

    if (
      snapshot.failureReason === SnmpTableFailureReason.ProbeDidNotWalkTables
    ) {
      return hasRows
        ? translator.translateTemplate(
            "The probe that polls this device answered its last poll without walking this table, so these are the rows from the last walk that read it. Probes released before version {{version}} do not walk SNMP tables: update the probe to the latest version.",
            { version: FIRST_PROBE_VERSION_WITH_SNMP_TABLES },
          )
        : translator.translateTemplate(
            "The probe that polls this device answered its last poll without walking this table. Probes released before version {{version}} do not walk SNMP tables: update the probe to the latest version, and the rows appear after its next poll.",
            { version: FIRST_PROBE_VERSION_WITH_SNMP_TABLES },
          );
    }

    return hasRows
      ? translator.translateTemplate(
          "The last walk of this table failed, so these are the rows from the walk before it: {{cause}}",
          { cause: snapshot.failureCause },
        )
      : translator.translateTemplate(
          "This table could not be walked, and no earlier walk read it: {{cause}}",
          { cause: snapshot.failureCause },
        );
  };

  const failureText: string | undefined = getFailureText();

  type RenderCellFunction = (
    column: SnmpTableSnapshotColumn,
    cell: SnmpTableSnapshotCell | undefined,
  ) => ReactElement;

  const renderCell: RenderCellFunction = (
    column: SnmpTableSnapshotColumn,
    cell: SnmpTableSnapshotCell | undefined,
  ): ReactElement => {
    if (!cell || cell.display === "") {
      return <span className="text-gray-400">—</span>;
    }

    const text: string =
      column.unit &&
      cell.numeric !== undefined &&
      !ENDS_WITH_UNIT.test(cell.display)
        ? `${cell.display} ${column.unit}`
        : cell.display;

    if (cell.isHealthy === undefined) {
      return <span className="text-gray-900">{text}</span>;
    }

    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            cell.isHealthy ? "bg-emerald-500" : "bg-red-500"
          }`}
        ></span>
        <span
          className={
            cell.isHealthy ? "text-gray-900" : "font-medium text-red-700"
          }
        >
          {text}
        </span>
      </span>
    );
  };

  return (
    <Card title={snapshot.name} description={descriptionParts.join(" ")}>
      <div data-testid={`snmp-table-${snapshot.key}`}>
        {failureText ? (
          <Alert
            type={AlertType.WARNING}
            className="mb-3"
            dataTestId={`snmp-table-${snapshot.key}-failure`}
            title={failureText}
          />
        ) : (
          <></>
        )}

        {unhealthyRowCount > 0 ? (
          <p className="mb-3 text-sm font-medium text-red-700">
            {translator.translatePlural(
              {
                one: "{{count}} row is not healthy.",
                other: "{{count}} rows are not healthy.",
              },
              unhealthyRowCount,
            )}
          </p>
        ) : (
          <></>
        )}

        {snapshot.rows.length === 0 ? (
          ownNetworksOnly ? (
            <p
              className="py-6 text-center text-sm text-gray-500"
              data-testid={`snmp-table-${snapshot.key}-no-rows`}
            >
              {translator.translateText(
                "The device reports no SSIDs. Networks it runs for itself, such as a wireless mesh link, are not listed.",
              )}
            </p>
          ) : failureText || snapshot.isTruncated ? (
            /*
             * Nothing was read, so nothing was returned: the alert above
             * says why, and "the device returned no rows" would be wrong.
             * So would it for a walk cut short before a row it keeps: the
             * note below says more rows exist.
             */
            <></>
          ) : (
            <p
              className="py-6 text-center text-sm text-gray-500"
              data-testid={`snmp-table-${snapshot.key}-no-rows`}
            >
              {translator.translateText(
                "The device returned no rows for this table. Check that it implements these columns, and that the SNMP view your credentials use includes them.",
              )}
            </p>
          )
        ) : (
          <div className="overflow-x-auto">
            {snapshotColumns.styles}
            <table
              className={`${snapshotColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200 text-sm`}
              {...snapshotColumns.tableAttributes}
            >
              <thead>
                <tr>
                  <th className="whitespace-nowrap py-2 pr-4 text-left font-medium text-gray-500">
                    {translator.translateText("Row")}
                  </th>
                  {snapshot.columns.map(
                    (column: SnmpTableSnapshotColumn): ReactElement => {
                      return (
                        <ResizableHeaderCell
                          key={column.oid}
                          title={column.oid}
                          className={`py-2 pr-4 text-left font-medium text-gray-500 ${
                            column.name.length > ONE_LINE_VALUE_LENGTH
                              ? "min-w-[8rem]"
                              : "whitespace-nowrap"
                          }`}
                          resize={snapshotColumns.getResize(
                            column.oid,
                            column.name,
                            ColumnWidthKind.Text,
                          )}
                        >
                          <span>{column.name}</span>
                        </ResizableHeaderCell>
                      );
                    },
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {snapshot.rows.map(
                  (row: SnmpTableSnapshotRow): ReactElement => {
                    return (
                      <tr key={row.index}>
                        <td
                          className="min-w-[10rem] py-2 pr-4 font-medium text-gray-900 [overflow-wrap:anywhere]"
                          title={translator.translateTemplate(
                            "Row index {{index}}",
                            { index: row.index },
                          )}
                        >
                          {row.label}
                        </td>
                        {snapshot.columns.map(
                          (column: SnmpTableSnapshotColumn): ReactElement => {
                            const cell: SnmpTableSnapshotCell | undefined =
                              row.cells[column.oid];

                            return (
                              <td
                                key={column.oid}
                                className={`py-2 pr-4 ${
                                  (cell?.display || "").length >
                                  ONE_LINE_VALUE_LENGTH
                                    ? "min-w-[12rem]"
                                    : "whitespace-nowrap"
                                }`}
                              >
                                {renderCell(column, cell)}
                              </td>
                            );
                          },
                        )}
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        )}

        {snapshot.isTruncated ? (
          <p className="mt-3 text-xs text-gray-500">
            {translator.translateText(
              "More rows exist than this table keeps. Raise its row limit in the table definition to see them.",
            )}
          </p>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default SnmpTableSnapshotCard;
