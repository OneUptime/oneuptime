import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import IconProp from "Common/Types/Icon/IconProp";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import ObjectID from "Common/Types/ObjectID";
import SnmpScanConfigUtil, {
  DiscoveryScanSnmpConfig,
  MAX_SNMP_CONFIGS_PER_SCAN,
} from "Common/Utils/NetworkDiscovery/SnmpScanConfigUtil";
import {
  SNMP_VERSION_DROPDOWN_OPTIONS,
  SNMP_V3_AUTH_PROTOCOL_DROPDOWN_OPTIONS,
  SNMP_V3_PRIV_PROTOCOL_DROPDOWN_OPTIONS,
  SNMP_V3_SECURITY_LEVEL_DROPDOWN_OPTIONS,
  SnmpDropdownOption,
  isSnmpV3,
  isSnmpV3WithAuth,
  isSnmpV3WithPriv,
} from "../../Pages/NetworkDevice/SnmpConfigFormFields";

/*
 * "Add SNMP Config" — the discovery scan's ordered list of credential sets.
 *
 * A subnet is rarely one credential. Access switches on v2c with one
 * community, the core on v3, a vendor block on a community of its own: a scan
 * carrying a single credential set silently missed everything speaking
 * anything else, and the operator's only workaround was one scan per
 * credential (OneUptime issue #3458).
 *
 * WHY THIS IS A COMPONENT AND NOT MORE Fields
 *
 * The rest of this form is declared as flat `Field` objects, and the SNMP
 * block used to be nine of them from getSnmpConfigFormFields(). A `Field`
 * describes ONE value at ONE key, so a repeated block cannot be expressed that
 * way at all — the same reason monitor criteria and the device's health-OID
 * list are custom components. This renders under a single
 * FormFieldSchemaType.CustomComponent field bound to the `snmpConfigs` column.
 *
 * The labels, the dropdown options and the v3 reveal chain all come from
 * SnmpConfigFormFields — the module the NetworkDevice forms still build their
 * flat fields from — so the two editors ask for the same things in the same
 * words and cannot drift. The VALIDATION comes from SnmpScanConfigUtil, which
 * the server enforces with, so the sentence shown here is the sentence the API
 * would have returned.
 */

export interface ComponentProps {
  /*
   * The stored list. Arrives as `""` rather than `[]` from an untouched
   * create form — see FormField.tsx, which falls back to an empty string for
   * every CustomComponent — so it is typed loosely and normalized below.
   */
  initialValue?: Array<DiscoveryScanSnmpConfig> | string | undefined;
  onChange?: ((value: Array<DiscoveryScanSnmpConfig>) => void) | undefined;
  error?: string | undefined;
}

/*
 * A card the operator has not filled in yet. V2c with no community is exactly
 * what the old single-config form defaulted to, and "public" is a real answer
 * for discovery rather than a placeholder — so a scan created by clicking
 * straight through still sweeps the way it always did.
 */
export function buildEmptySnmpConfig(): DiscoveryScanSnmpConfig {
  return {
    id: ObjectID.generate().toString(),
    snmpVersion: "V2c",
  };
}

/*
 * What the editor should start from.
 *
 * Exported and pure so the seeding behaviour can be tested without a DOM: a
 * create form has no value at all (FormField hands over `""`), an edit form
 * has the stored list, and a scan saved before this column existed has an
 * empty one — which must become a single card rather than an empty editor with
 * nothing to type into.
 */
export function toEditableConfigs(
  value: Array<DiscoveryScanSnmpConfig> | string | undefined | null,
): Array<DiscoveryScanSnmpConfig> {
  if (!Array.isArray(value) || value.length === 0) {
    return [buildEmptySnmpConfig()];
  }

  /*
   * Ids are minted here for anything stored without one, so that deleting a
   * card can never be ambiguous about WHICH card and so React's keys are
   * stable across a reorder. The server mints them too; this covers a row
   * written before it did.
   */
  return value.map((config: DiscoveryScanSnmpConfig) => {
    return config.id
      ? config
      : { ...config, id: ObjectID.generate().toString() };
  });
}

// Every field the editor can write, so the update helper stays type-safe.
type EditableConfigKey = keyof DiscoveryScanSnmpConfig;

const SnmpConfigListEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [configs, setConfigs] = useState<Array<DiscoveryScanSnmpConfig>>(() => {
    return toEditableConfigs(props.initialValue);
  });

  /*
   * The form only learns a CustomComponent's value when the component reports
   * one. Validation.validate skips every rule for a key that is not present in
   * the form values, so without this first report a create form would run NO
   * validation on the credential list at all — and would post a scan with no
   * `snmpConfigs` at all, silently falling back to the flattened columns the
   * operator never saw.
   *
   * Reported once, from an effect rather than during render, and guarded by a
   * ref so a re-render from the parent's own setState cannot loop.
   */
  const hasReportedInitialValue: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    if (hasReportedInitialValue.current) {
      return;
    }

    hasReportedInitialValue.current = true;
    props.onChange?.(configs);
    /*
     * Empty deps deliberately: this runs once, on mount. `configs` and
     * `props.onChange` are intentionally not dependencies — re-reporting on
     * every change is what `update()` below does, and the ref makes a second
     * run a no-op anyway.
     */
  }, []);

  /*
   * Adopt a stored list that arrives AFTER this editor mounted.
   *
   * ModelForm renders the form immediately and fetches the row it is editing in
   * the background, so on the Edit dialog this component's first render sees no
   * value at all and seeds a blank card. Without this the operator would then be
   * shown — and would save — an empty credential set in place of the one the
   * scan actually has. The same reason SnmpOidEditor resyncs from its props.
   *
   * Guarded three ways so it can only ever ADD what the form knows and never
   * take away what the operator has typed:
   *   - a non-list value (the empty string FormField supplies for an untouched
   *     CustomComponent) is ignored, so the seeded card survives on a create
   *     form;
   *   - an empty list is ignored for the same reason;
   *   - a list that already matches what is on screen is ignored, which is
   *     every render caused by this editor's own onChange — without that check
   *     each keystroke would round-trip through the form and re-seed the
   *     inputs.
   */
  useEffect(() => {
    const incoming: Array<DiscoveryScanSnmpConfig> | undefined = Array.isArray(
      props.initialValue,
    )
      ? props.initialValue
      : undefined;

    if (!incoming || incoming.length === 0) {
      return;
    }

    const adopted: Array<DiscoveryScanSnmpConfig> = toEditableConfigs(incoming);

    if (JSON.stringify(adopted) === JSON.stringify(configs)) {
      return;
    }

    setConfigs(adopted);
    /*
     * Keyed on the incoming value alone. `configs` is read inside but is
     * deliberately not a dependency: it changes on every keystroke, and
     * re-running this then would compare the list against itself for nothing.
     * The JSON check above is what makes reading a stale `configs` harmless —
     * the worst case is one redundant adoption of a list that already matches.
     */
  }, [props.initialValue]);

  const update: (next: Array<DiscoveryScanSnmpConfig>) => void = (
    next: Array<DiscoveryScanSnmpConfig>,
  ): void => {
    setConfigs(next);
    props.onChange?.(next);
  };

  const updateField: (
    index: number,
    key: EditableConfigKey,
    value: string,
  ) => void = (index: number, key: EditableConfigKey, value: string): void => {
    const next: Array<DiscoveryScanSnmpConfig> = [...configs];

    /*
     * The port is the one numeric field. Left as a raw string when it is not
     * a clean integer so the operator can see what they typed and the shared
     * validator can complain about it — coercing "16x" to NaN here would
     * silently blank the box instead.
     */
    if (key === "snmpPort") {
      const trimmed: string = value.trim();
      const parsed: number = Number(trimmed);

      next[index] = {
        ...next[index]!,
        snmpPort:
          trimmed === "" || !isFinite(parsed)
            ? undefined
            : (parsed as unknown as number),
      };
    } else {
      next[index] = { ...next[index]!, [key]: value };
    }

    update(next);
  };

  const addConfig: () => void = (): void => {
    if (configs.length >= MAX_SNMP_CONFIGS_PER_SCAN) {
      return;
    }

    update([...configs, buildEmptySnmpConfig()]);
  };

  const removeConfig: (index: number) => void = (index: number): void => {
    /*
     * Never below one. A scan with no credentials has nothing to ask the
     * subnet, and an empty editor gives the operator no box to start from —
     * so the last card's delete button is not rendered at all rather than
     * rendered and refused.
     */
    if (configs.length <= 1) {
      return;
    }

    update(
      configs.filter((_config: DiscoveryScanSnmpConfig, i: number) => {
        return i !== index;
      }),
    );
  };

  /*
   * Order is meaningful — the sweep tries the list in order and stops at the
   * first credential that answers — so it has to be changeable without
   * deleting and retyping a card.
   */
  const moveConfig: (index: number, offset: number) => void = (
    index: number,
    offset: number,
  ): void => {
    const target: number = index + offset;

    if (target < 0 || target >= configs.length) {
      return;
    }

    const next: Array<DiscoveryScanSnmpConfig> = [...configs];
    const moved: DiscoveryScanSnmpConfig = next[index]!;
    next[index] = next[target]!;
    next[target] = moved;

    update(next);
  };

  const toDropdownOption: (
    options: Array<SnmpDropdownOption>,
    value: string | undefined,
  ) => DropdownOption | undefined = (
    options: Array<SnmpDropdownOption>,
    value: string | undefined,
  ): DropdownOption | undefined => {
    if (!value) {
      return undefined;
    }

    return options.find((option: SnmpDropdownOption) => {
      return option.value === value;
    });
  };

  const renderDropdown: (data: {
    index: number;
    field: EditableConfigKey;
    options: Array<SnmpDropdownOption>;
    value: string | undefined;
    placeholder: string;
  }) => ReactElement = (data: {
    index: number;
    field: EditableConfigKey;
    options: Array<SnmpDropdownOption>;
    value: string | undefined;
    placeholder: string;
  }): ReactElement => {
    return (
      <Dropdown
        options={data.options}
        initialValue={toDropdownOption(data.options, data.value)}
        value={toDropdownOption(data.options, data.value)}
        placeholder={data.placeholder}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          updateField(data.index, data.field, value ? value.toString() : "");
        }}
      />
    );
  };

  return (
    <div data-testid="snmp-config-list-editor">
      <FieldLabelElement
        title="SNMP Configs"
        description={
          "Credential sets tried against every host in the range, in order, until one answers. " +
          "Add one per group of devices that share a version and community or v3 user - mixed subnets are normal. " +
          "Each extra config costs another SNMP timeout on every address that answers nothing, so keep the list to what the range actually contains."
        }
        required={true}
      />

      <div className="space-y-4 mt-3">
        {configs.map((config: DiscoveryScanSnmpConfig, index: number) => {
          const isV3: boolean = isSnmpV3(config);
          const isV3WithAuth: boolean = isSnmpV3WithAuth(config);
          const isV3WithPriv: boolean = isSnmpV3WithPriv(config);

          return (
            <div
              key={config.id || index}
              className="p-4 border rounded-md bg-gray-50 space-y-3"
              data-testid={`snmp-config-card-${index}`}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-900">
                  {SnmpScanConfigUtil.getConfigLabel(config, index)}
                </div>
                <div className="flex space-x-1">
                  {index > 0 && (
                    <Button
                      title="Move up"
                      buttonStyle={ButtonStyleType.ICON}
                      icon={IconProp.ChevronUp}
                      dataTestId={`snmp-config-move-up-${index}`}
                      onClick={() => {
                        moveConfig(index, -1);
                      }}
                    />
                  )}
                  {index < configs.length - 1 && (
                    <Button
                      title="Move down"
                      buttonStyle={ButtonStyleType.ICON}
                      icon={IconProp.ChevronDown}
                      dataTestId={`snmp-config-move-down-${index}`}
                      onClick={() => {
                        moveConfig(index, 1);
                      }}
                    />
                  )}
                  {configs.length > 1 && (
                    <Button
                      title="Remove"
                      buttonStyle={ButtonStyleType.ICON}
                      icon={IconProp.Trash}
                      dataTestId={`snmp-config-remove-${index}`}
                      onClick={() => {
                        removeConfig(index);
                      }}
                    />
                  )}
                </div>
              </div>

              <div>
                <FieldLabelElement title="Name" required={false} />
                <Input
                  initialValue={config.name || ""}
                  placeholder="Core switches"
                  onChange={(value: string) => {
                    updateField(index, "name", value);
                  }}
                />
              </div>

              <div>
                <FieldLabelElement title="SNMP Version" required={true} />
                {renderDropdown({
                  index: index,
                  field: "snmpVersion",
                  options: SNMP_VERSION_DROPDOWN_OPTIONS,
                  value: config.snmpVersion,
                  placeholder: "V2c",
                })}
              </div>

              {!isV3 && (
                <div>
                  <FieldLabelElement
                    title="SNMP Community String"
                    description="Tried against every host in the range. Defaults to public when left empty."
                    required={false}
                  />
                  <Input
                    type={InputType.PASSWORD}
                    initialValue={config.snmpCommunityString || ""}
                    placeholder="public"
                    onChange={(value: string) => {
                      updateField(index, "snmpCommunityString", value);
                    }}
                  />
                </div>
              )}

              {isV3 && (
                <div>
                  <FieldLabelElement
                    title="SNMP v3 Security Level"
                    description="How much of the SNMP v3 exchange is authenticated/encrypted."
                    required={true}
                  />
                  {renderDropdown({
                    index: index,
                    field: "snmpV3SecurityLevel",
                    options: SNMP_V3_SECURITY_LEVEL_DROPDOWN_OPTIONS,
                    value: config.snmpV3SecurityLevel,
                    placeholder: "Auth, Priv",
                  })}
                </div>
              )}

              {isV3 && (
                <div>
                  <FieldLabelElement
                    title="SNMP v3 Username"
                    description="The SNMP v3 security name (user) configured on the device."
                    required={true}
                  />
                  <Input
                    initialValue={config.snmpV3Username || ""}
                    placeholder="monitoring"
                    onChange={(value: string) => {
                      updateField(index, "snmpV3Username", value);
                    }}
                  />
                </div>
              )}

              {isV3WithAuth && (
                <div>
                  <FieldLabelElement
                    title="SNMP v3 Authentication Protocol"
                    required={true}
                  />
                  {renderDropdown({
                    index: index,
                    field: "snmpV3AuthProtocol",
                    options: SNMP_V3_AUTH_PROTOCOL_DROPDOWN_OPTIONS,
                    value: config.snmpV3AuthProtocol,
                    placeholder: "SHA",
                  })}
                </div>
              )}

              {isV3WithAuth && (
                <div>
                  <FieldLabelElement
                    title="SNMP v3 Authentication Key"
                    required={true}
                  />
                  {/*
                   * A masked input that round-trips its value, exactly like the
                   * EncryptedText field type the flat SNMP form uses. NOT
                   * hashed: the probe has to be able to read the real key back.
                   */}
                  <Input
                    type={InputType.PASSWORD}
                    initialValue={config.snmpV3AuthKey || ""}
                    placeholder="authentication passphrase"
                    onChange={(value: string) => {
                      updateField(index, "snmpV3AuthKey", value);
                    }}
                  />
                </div>
              )}

              {isV3WithPriv && (
                <div>
                  <FieldLabelElement
                    title="SNMP v3 Privacy Protocol"
                    required={true}
                  />
                  {renderDropdown({
                    index: index,
                    field: "snmpV3PrivProtocol",
                    options: SNMP_V3_PRIV_PROTOCOL_DROPDOWN_OPTIONS,
                    value: config.snmpV3PrivProtocol,
                    placeholder: "AES",
                  })}
                </div>
              )}

              {isV3WithPriv && (
                <div>
                  <FieldLabelElement
                    title="SNMP v3 Privacy Key"
                    required={true}
                  />
                  <Input
                    type={InputType.PASSWORD}
                    initialValue={config.snmpV3PrivKey || ""}
                    placeholder="privacy passphrase"
                    onChange={(value: string) => {
                      updateField(index, "snmpV3PrivKey", value);
                    }}
                  />
                </div>
              )}

              <div>
                <FieldLabelElement
                  title="SNMP Port"
                  description="UDP port the agent listens on. Defaults to 161."
                  required={false}
                />
                <Input
                  type={InputType.NUMBER}
                  initialValue={
                    config.snmpPort === undefined || config.snmpPort === null
                      ? ""
                      : String(config.snmpPort)
                  }
                  placeholder="161"
                  onChange={(value: string) => {
                    updateField(index, "snmpPort", value);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        <Button
          title="Add SNMP Config"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.Add}
          disabled={configs.length >= MAX_SNMP_CONFIGS_PER_SCAN}
          dataTestId="add-snmp-config"
          onClick={addConfig}
        />
        {configs.length >= MAX_SNMP_CONFIGS_PER_SCAN && (
          <div className="mt-2 text-xs text-gray-500">
            {`A scan can try at most ${MAX_SNMP_CONFIGS_PER_SCAN} SNMP configs. Split the range into more scans if you need more.`}
          </div>
        )}
      </div>

      {props.error && (
        <div className="mt-2 text-sm text-red-400">{props.error}</div>
      )}
    </div>
  );
};

export default SnmpConfigListEditor;
