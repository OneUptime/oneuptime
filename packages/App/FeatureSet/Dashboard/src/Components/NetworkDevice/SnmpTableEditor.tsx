import SnmpTableEditorUtil from "./SnmpTableEditorUtil";
import {
  SnmpTableColumn,
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableValueType,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil, {
  DEFAULT_SNMP_TABLE_MAX_ROWS,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Input from "Common/UI/Components/Input/Input";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  value: Array<SnmpTableDefinition>;
  onChange: (value: Array<SnmpTableDefinition>) => void;
  // Offer "Add a vendor's tables" above the list.
  showVendorPrefill?: boolean | undefined;
}

const KIND_LABELS: Record<SnmpTableKind, string> = {
  [SnmpTableKind.Generic]: translationKey("Generic"),
  [SnmpTableKind.VpnTunnel]: translationKey("VPN tunnels"),
  [SnmpTableKind.WifiRadio]: translationKey("Wi-Fi radios"),
  [SnmpTableKind.WifiSsid]: translationKey("Wi-Fi SSIDs"),
  [SnmpTableKind.WifiAccessPoint]: translationKey("Wi-Fi access points"),
  [SnmpTableKind.RoutingAdjacency]: translationKey("Routing neighbours"),
  [SnmpTableKind.Hardware]: translationKey("Hardware"),
};

const ROLE_LABELS: Record<SnmpTableColumnRole, string> = {
  [SnmpTableColumnRole.Status]: translationKey("Status"),
  [SnmpTableColumnRole.Band]: translationKey("Wi-Fi band"),
  [SnmpTableColumnRole.Channel]: translationKey("Wi-Fi channel"),
  [SnmpTableColumnRole.ChannelWidth]: translationKey("Channel width"),
  [SnmpTableColumnRole.TxPower]: translationKey("Transmit power"),
  [SnmpTableColumnRole.Clients]: translationKey("Clients"),
  [SnmpTableColumnRole.NoiseFloor]: translationKey("Noise floor"),
  [SnmpTableColumnRole.Utilization]: translationKey("Utilization"),
  [SnmpTableColumnRole.Ssid]: translationKey("SSID"),
};

const NO_ROLE: string = "__none__";

/*
 * Edits a list of SNMP table definitions: the tables a template or a device
 * walks. Each table names its columns by OID; optional columns name each
 * row; enumerations get value labels and the values that mean "healthy".
 *
 * Free-text fields that are parsed (value labels, healthy values, row-name
 * columns) keep the operator's raw text as a draft, so a half-typed
 * "1=active, 0=" is not reformatted out from under the cursor.
 */
const SnmpTableEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [tables, setTables] = useState<Array<SnmpTableDefinition>>(
    props.value || [],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setTables(props.value || []);
  }, [props.value]);

  const commit: (next: Array<SnmpTableDefinition>) => void = (
    next: Array<SnmpTableDefinition>,
  ): void => {
    setTables(next);
    props.onChange(next);
  };

  // Structural edits shift indexes, so drafts keyed by index are dropped.
  const commitStructural: (next: Array<SnmpTableDefinition>) => void = (
    next: Array<SnmpTableDefinition>,
  ): void => {
    setDrafts({});
    commit(next);
  };

  const updateTable: (
    tableIndex: number,
    patch: Partial<SnmpTableDefinition>,
  ) => void = (
    tableIndex: number,
    patch: Partial<SnmpTableDefinition>,
  ): void => {
    commit(
      tables.map((table: SnmpTableDefinition, index: number) => {
        return index === tableIndex ? { ...table, ...patch } : table;
      }),
    );
  };

  const updateColumn: (
    tableIndex: number,
    columnIndex: number,
    patch: Partial<SnmpTableColumn>,
  ) => void = (
    tableIndex: number,
    columnIndex: number,
    patch: Partial<SnmpTableColumn>,
  ): void => {
    const table: SnmpTableDefinition | undefined = tables[tableIndex];

    if (!table) {
      return;
    }

    updateTable(tableIndex, {
      columns: table.columns.map((column: SnmpTableColumn, index: number) => {
        return index === columnIndex ? { ...column, ...patch } : column;
      }),
    });
  };

  const setDraft: (key: string, text: string) => void = (
    key: string,
    text: string,
  ): void => {
    setDrafts({ ...drafts, [key]: text });
  };

  const vendorOptions: Array<DropdownOption> = SnmpVendorTemplateUtil.getAll()
    .filter((template: SnmpVendorTemplate): boolean => {
      return Boolean(template.tables && template.tables.length > 0);
    })
    .map((template: SnmpVendorTemplate): DropdownOption => {
      return { label: template.label, value: template.id };
    });

  const kindOptions: Array<DropdownOption> = Object.values(SnmpTableKind).map(
    (kind: SnmpTableKind): DropdownOption => {
      return {
        label: translator.translateText(KIND_LABELS[kind]) || KIND_LABELS[kind],
        value: kind,
      };
    },
  );

  const roleOptions: Array<DropdownOption> = [
    { label: translator.translateText("No role") || "No role", value: NO_ROLE },
    ...Object.values(SnmpTableColumnRole).map(
      (role: SnmpTableColumnRole): DropdownOption => {
        return {
          label:
            translator.translateText(ROLE_LABELS[role]) || ROLE_LABELS[role],
          value: role,
        };
      },
    ),
  ];

  const valueTypeOptions: Array<DropdownOption> = [
    {
      label:
        translator.translateText("Read numbers where present") ||
        "Read numbers where present",
      value: SnmpTableValueType.Number,
    },
    {
      label: translator.translateText("Text only") || "Text only",
      value: SnmpTableValueType.Text,
    },
  ];

  return (
    <div className="space-y-4">
      {props.showVendorPrefill ? (
        <div>
          <FieldLabelElement
            title="Add a Vendor's Tables"
            description="Optional. Adds the tables a vendor template ships - IPsec tunnels, Wi-Fi radios, fabric neighbours, fans, power supplies - so you start from known-good column OIDs. Tables already in the list are kept."
            required={false}
          />
          <Dropdown
            options={vendorOptions}
            value={undefined}
            dataTestId="snmp-table-vendor-prefill"
            placeholder="Add a vendor's tables…"
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (!value || Array.isArray(value)) {
                return;
              }

              commitStructural(
                SnmpVendorTemplateUtil.mergeTables(tables, value.toString()),
              );
            }}
          />
        </div>
      ) : (
        <></>
      )}

      {tables.map(
        (table: SnmpTableDefinition, tableIndex: number): ReactElement => {
          const error: string | undefined =
            SnmpTableEditorUtil.getTableError(table);
          const derivedKey: string = SnmpTableListUtil.normalizeKey(
            table.key || table.name,
          );

          return (
            <div
              key={tableIndex}
              data-testid={`snmp-table-${tableIndex}`}
              className={`space-y-3 rounded-md border bg-gray-50 p-3${
                error ? " border-red-300" : ""
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Input
                    initialValue={table.name}
                    dataTestId={`snmp-table-${tableIndex}-name`}
                    placeholder="Table name (e.g., IPsec Tunnels)"
                    onChange={(value: string) => {
                      updateTable(tableIndex, { name: value });
                    }}
                  />
                </div>
                <Button
                  buttonStyle={ButtonStyleType.ICON}
                  icon={IconProp.Trash}
                  dataTestId={`snmp-table-${tableIndex}-remove`}
                  onClick={() => {
                    commitStructural(
                      tables.filter(
                        (_: SnmpTableDefinition, index: number): boolean => {
                          return index !== tableIndex;
                        },
                      ),
                    );
                  }}
                />
              </div>

              {error ? (
                <p
                  role="alert"
                  data-testid={`snmp-table-${tableIndex}-error`}
                  className="text-sm text-red-600"
                >
                  {error}
                </p>
              ) : (
                <></>
              )}

              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <Input
                  initialValue={table.key}
                  dataTestId={`snmp-table-${tableIndex}-key`}
                  placeholder={
                    derivedKey
                      ? translator.translateTemplate("Key (default {{key}})", {
                          key: derivedKey,
                        })
                      : translator.translateText("Key (optional)")
                  }
                  onChange={(value: string) => {
                    updateTable(tableIndex, { key: value });
                  }}
                />
                <Dropdown
                  options={kindOptions}
                  dataTestId={`snmp-table-${tableIndex}-kind`}
                  value={kindOptions.find((option: DropdownOption) => {
                    return (
                      option.value === SnmpTableListUtil.parseKind(table.kind)
                    );
                  })}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (value && !Array.isArray(value)) {
                      updateTable(tableIndex, {
                        kind: SnmpTableListUtil.parseKind(value.toString()),
                      });
                    }
                  }}
                />
                <Input
                  initialValue={table.maxRows ? `${table.maxRows}` : ""}
                  dataTestId={`snmp-table-${tableIndex}-max-rows`}
                  placeholder={translator.translateTemplate(
                    "Row limit (default {{max}})",
                    { max: DEFAULT_SNMP_TABLE_MAX_ROWS },
                  )}
                  onChange={(value: string) => {
                    const parsed: number = parseInt(value, 10);
                    updateTable(tableIndex, {
                      maxRows: Number.isFinite(parsed) ? parsed : undefined,
                    });
                  }}
                />
              </div>

              <Input
                initialValue={
                  drafts[`${tableIndex}.labels`] ??
                  SnmpTableEditorUtil.formatList(table.rowLabelColumnOids)
                }
                dataTestId={`snmp-table-${tableIndex}-row-labels`}
                placeholder="Columns that name each row (OIDs, comma-separated, optional)"
                onChange={(value: string) => {
                  setDraft(`${tableIndex}.labels`, value);
                  updateTable(tableIndex, {
                    rowLabelColumnOids: SnmpTableEditorUtil.parseList(value),
                  });
                }}
              />

              {table.rowIndexIsText ? (
                <p
                  className="text-xs text-gray-500"
                  data-testid={`snmp-table-${tableIndex}-index-is-text`}
                >
                  {translator.translateText(
                    "The vendor indexes this table by name: rows without a name column are named by their index, read as text.",
                  )}
                </p>
              ) : (
                <></>
              )}

              <div className="space-y-2">
                {table.columns.map(
                  (
                    column: SnmpTableColumn,
                    columnIndex: number,
                  ): ReactElement => {
                    const draftKey: string = `${tableIndex}.${columnIndex}`;

                    return (
                      <div
                        key={columnIndex}
                        data-testid={`snmp-table-${tableIndex}-column-${columnIndex}`}
                        className="space-y-2 rounded border border-gray-200 bg-white p-2"
                      >
                        <div className="flex items-start gap-2">
                          <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-3">
                            <Input
                              initialValue={column.oid}
                              dataTestId={`snmp-table-${tableIndex}-column-${columnIndex}-oid`}
                              placeholder="Column OID (e.g., 1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9)"
                              onChange={(value: string) => {
                                updateColumn(tableIndex, columnIndex, {
                                  oid: value,
                                });
                              }}
                            />
                            <Input
                              initialValue={column.name}
                              dataTestId={`snmp-table-${tableIndex}-column-${columnIndex}-name`}
                              placeholder="Column name (e.g., Status)"
                              onChange={(value: string) => {
                                updateColumn(tableIndex, columnIndex, {
                                  name: value,
                                });
                              }}
                            />
                            <Input
                              initialValue={column.unit || ""}
                              dataTestId={`snmp-table-${tableIndex}-column-${columnIndex}-unit`}
                              placeholder="Unit (optional, e.g., dBm)"
                              onChange={(value: string) => {
                                updateColumn(tableIndex, columnIndex, {
                                  unit: value || undefined,
                                });
                              }}
                            />
                          </div>
                          <Button
                            buttonStyle={ButtonStyleType.ICON}
                            icon={IconProp.Trash}
                            dataTestId={`snmp-table-${tableIndex}-column-${columnIndex}-remove`}
                            onClick={() => {
                              commitStructural(
                                tables.map(
                                  (
                                    candidate: SnmpTableDefinition,
                                    index: number,
                                  ): SnmpTableDefinition => {
                                    return index === tableIndex
                                      ? {
                                          ...candidate,
                                          columns: candidate.columns.filter(
                                            (
                                              _: SnmpTableColumn,
                                              i: number,
                                            ): boolean => {
                                              return i !== columnIndex;
                                            },
                                          ),
                                        }
                                      : candidate;
                                  },
                                ),
                              );
                            }}
                          />
                        </div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          <Dropdown
                            options={roleOptions}
                            dataTestId={`snmp-table-${tableIndex}-column-${columnIndex}-role`}
                            value={roleOptions.find(
                              (option: DropdownOption) => {
                                return (
                                  option.value === (column.role || NO_ROLE)
                                );
                              },
                            )}
                            onChange={(
                              value:
                                | DropdownValue
                                | Array<DropdownValue>
                                | null,
                            ) => {
                              if (!value || Array.isArray(value)) {
                                return;
                              }
                              updateColumn(tableIndex, columnIndex, {
                                role:
                                  value.toString() === NO_ROLE
                                    ? undefined
                                    : (value.toString() as SnmpTableColumnRole),
                              });
                            }}
                          />
                          <Dropdown
                            options={valueTypeOptions}
                            dataTestId={`snmp-table-${tableIndex}-column-${columnIndex}-value-type`}
                            value={valueTypeOptions.find(
                              (option: DropdownOption) => {
                                return (
                                  option.value ===
                                  (column.valueType ||
                                    SnmpTableValueType.Number)
                                );
                              },
                            )}
                            onChange={(
                              value:
                                | DropdownValue
                                | Array<DropdownValue>
                                | null,
                            ) => {
                              if (!value || Array.isArray(value)) {
                                return;
                              }
                              updateColumn(tableIndex, columnIndex, {
                                valueType:
                                  value.toString() === SnmpTableValueType.Text
                                    ? SnmpTableValueType.Text
                                    : undefined,
                              });
                            }}
                          />
                          <Input
                            initialValue={
                              drafts[`${draftKey}.valueLabels`] ??
                              SnmpTableEditorUtil.formatValueLabels(
                                column.valueLabels,
                              )
                            }
                            dataTestId={`snmp-table-${tableIndex}-column-${columnIndex}-value-labels`}
                            placeholder="Value labels (optional, e.g., 0=inactive, 1=active)"
                            onChange={(value: string) => {
                              setDraft(`${draftKey}.valueLabels`, value);
                              updateColumn(tableIndex, columnIndex, {
                                valueLabels:
                                  SnmpTableEditorUtil.parseValueLabels(value),
                              });
                            }}
                          />
                          <Input
                            initialValue={
                              drafts[`${draftKey}.healthy`] ??
                              SnmpTableEditorUtil.formatList(
                                column.healthyValues,
                              )
                            }
                            dataTestId={`snmp-table-${tableIndex}-column-${columnIndex}-healthy`}
                            placeholder="Healthy values (optional, e.g., 1)"
                            onChange={(value: string) => {
                              setDraft(`${draftKey}.healthy`, value);
                              const healthyValues: Array<string> =
                                SnmpTableEditorUtil.parseList(value);
                              updateColumn(tableIndex, columnIndex, {
                                healthyValues:
                                  healthyValues.length > 0
                                    ? healthyValues
                                    : undefined,
                              });
                            }}
                          />
                        </div>
                        {SnmpTableEditorUtil.formatAdjustment(column) ? (
                          <p
                            className="text-xs text-gray-500"
                            data-testid={`snmp-table-${tableIndex}-column-${columnIndex}-adjustment`}
                          >
                            {translator.translateTemplate(
                              "Numbers in this column are read as {{formula}}: the vendor reports them in a unit of its own.",
                              {
                                formula:
                                  SnmpTableEditorUtil.formatAdjustment(
                                    column,
                                  ) || "",
                              },
                            )}
                          </p>
                        ) : (
                          <></>
                        )}
                      </div>
                    );
                  },
                )}
              </div>

              <Button
                title="Add Column"
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.OUTLINE}
                icon={IconProp.Add}
                dataTestId={`snmp-table-${tableIndex}-add-column`}
                onClick={() => {
                  commitStructural(
                    tables.map(
                      (
                        candidate: SnmpTableDefinition,
                        index: number,
                      ): SnmpTableDefinition => {
                        return index === tableIndex
                          ? {
                              ...candidate,
                              columns: [
                                ...candidate.columns,
                                { oid: "", name: "" },
                              ],
                            }
                          : candidate;
                      },
                    ),
                  );
                }}
              />
            </div>
          );
        },
      )}

      <Button
        title="Add Table"
        buttonSize={ButtonSize.Small}
        buttonStyle={ButtonStyleType.OUTLINE}
        icon={IconProp.Add}
        dataTestId="snmp-table-add"
        onClick={() => {
          commitStructural([
            ...tables,
            { key: "", name: "", columns: [{ oid: "", name: "" }] },
          ]);
        }}
      />
    </div>
  );
};

export default SnmpTableEditor;
