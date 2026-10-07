import {
  SnmpTableKind,
  SnmpTableSnapshot,
  SnmpTableSnapshotCell,
  SnmpTableSnapshotColumn,
  SnmpTableSnapshotRow,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import OneUptimeDate from "Common/Types/Date";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  snapshot: SnmpTableSnapshot;
}

// A value that already carries its unit, such as "80MHz" or "45%".
const ENDS_WITH_UNIT: RegExp = /[a-z%]$/i;

// What each table kind is, in a few words, for the card's description.
const KIND_DESCRIPTIONS: Record<SnmpTableKind, string> = {
  [SnmpTableKind.Generic]: translationKey("Rows walked from the device."),
  [SnmpTableKind.WifiRadio]: translationKey("One row per Wi-Fi radio."),
  [SnmpTableKind.WifiSsid]: translationKey("One row per SSID."),
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
        {snapshot.failureCause ? (
          <Alert
            type={AlertType.WARNING}
            className="mb-3"
            title={translator.translateTemplate(
              "The last walk of this table failed, so these are the rows from the walk before it: {{cause}}",
              { cause: snapshot.failureCause },
            )}
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
          <p className="py-6 text-center text-sm text-gray-500">
            {translator.translateText(
              "The device returned no rows for this table. Check that it implements these columns, and that the SNMP view your credentials use includes them.",
            )}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr>
                  <th className="py-2 pr-4 text-left font-medium text-gray-500">
                    {translator.translateText("Row")}
                  </th>
                  {snapshot.columns.map(
                    (column: SnmpTableSnapshotColumn): ReactElement => {
                      return (
                        <th
                          key={column.oid}
                          title={column.oid}
                          className="py-2 pr-4 text-left font-medium text-gray-500"
                        >
                          {column.name}
                        </th>
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
                          className="py-2 pr-4 font-medium text-gray-900"
                          title={translator.translateTemplate(
                            "Row index {{index}}",
                            { index: row.index },
                          )}
                        >
                          {row.label}
                        </td>
                        {snapshot.columns.map(
                          (column: SnmpTableSnapshotColumn): ReactElement => {
                            return (
                              <td key={column.oid} className="py-2 pr-4">
                                {renderCell(column, row.cells[column.oid])}
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
