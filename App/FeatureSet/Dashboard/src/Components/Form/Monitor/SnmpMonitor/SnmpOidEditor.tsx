import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import SnmpOid, {
  SnmpOidTemplates,
} from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Input from "Common/UI/Components/Input/Input";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import IconProp from "Common/Types/Icon/IconProp";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";

export interface ComponentProps {
  value: Array<SnmpOid>;
  onChange: (value: Array<SnmpOid>) => void;
}

/*
 * What a row is telling the operator, if anything.
 *
 * `error` is what the server would refuse or silently drop on save, said in
 * the editor instead of in a toast after the save fails. `advisory` is never
 * a reason not to save — it is the "you already have this" warning that
 * issue #3507 is really about.
 *
 * The two are exclusive on purpose: a malformed OID has no meaningful
 * "already collected" answer, so an advisory under an error would just be
 * noise on top of the thing that has to be fixed first.
 */
interface OidRowIssue {
  error?: string | undefined;
  advisory?: string | undefined;
}

type GetRowIssuesFunction = (list: Array<SnmpOid>) => Array<OidRowIssue>;

/*
 * Mirrors SnmpOidListUtil.validateOidList rather than reimplementing it: the
 * server is still the source of truth and re-runs the whole thing on save.
 * This exists so the message names the row, arrives while the operator is
 * looking at it, and never blocks typing — "1.3.6.1.2." is a perfectly
 * normal thing to have on screen halfway through entering an OID, so a row
 * is judged only on what is currently in it, and a blank row (the "Add OID"
 * button's own artifact) is not judged at all.
 */
const getRowIssues: GetRowIssuesFunction = (
  list: Array<SnmpOid>,
): Array<OidRowIssue> => {
  const firstRowByOid: Map<string, number> = new Map();

  return list.map((entry: SnmpOid, index: number): OidRowIssue => {
    const normalized: string = SnmpOidListUtil.normalizeOid(entry.oid);

    if (!normalized) {
      return {};
    }

    if (!SnmpOidListUtil.isValidOid(normalized)) {
      return {
        error: `"${entry.oid}" is not a numeric OID. Use dotted numbers, for example 1.3.6.1.2.1.1.3.0.`,
      };
    }

    const firstRow: number | undefined = firstRowByOid.get(normalized);

    if (firstRow === undefined) {
      firstRowByOid.set(normalized, index);
    } else {
      return {
        error: `${normalized} is already on row ${
          firstRow + 1
        }. Only the first copy is kept when this is saved.`,
      };
    }

    /*
     * Advisory only, and deliberately so — an operator may still want an
     * undimensioned series for one specific port. getAlreadyCollectedBy
     * matches only the handful of columns the poll turns into a real
     * per-port series; broadening it would talk people out of the OIDs that
     * hand-typing is currently the only way to get.
     */
    const collectedBy: string | undefined =
      SnmpOidListUtil.getAlreadyCollectedBy(normalized);

    if (collectedBy) {
      return {
        advisory: `This is already collected as ${collectedBy}. Adding it here polls the device twice and charts one number with no port name attached.`,
      };
    }

    return {};
  });
};

const SnmpOidEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [oids, setOids] = useState<Array<SnmpOid>>(props.value || []);
  const [showTemplates, setShowTemplates] = useState<boolean>(false);

  useEffect(() => {
    setOids(props.value || []);
  }, [props.value]);

  const addOid: () => void = (): void => {
    const newOids: Array<SnmpOid> = [
      ...oids,
      { oid: "", name: "", description: "" },
    ];
    setOids(newOids);
    props.onChange(newOids);
  };

  const removeOid: (index: number) => void = (index: number): void => {
    const newOids: Array<SnmpOid> = oids.filter((_: SnmpOid, i: number) => {
      return i !== index;
    });
    setOids(newOids);
    props.onChange(newOids);
  };

  const updateOid: (
    index: number,
    field: keyof SnmpOid,
    value: string,
  ) => void = (index: number, field: keyof SnmpOid, value: string): void => {
    const newOids: Array<SnmpOid> = [...oids];
    newOids[index] = { ...newOids[index]!, [field]: value };
    setOids(newOids);
    props.onChange(newOids);
  };

  /*
   * Appending blind was how one click on a common OID that is already in the
   * list produced a duplicate the operator then had to find and delete —
   * SnmpVendorTemplateUtil.mergeOids has skipped what is already there since
   * it was written, and this path is the same gesture.
   *
   * Deduped by hand rather than through SnmpOidListUtil.mergeOidLists,
   * which drops every malformed row it is handed. That is right on the poll
   * path and wrong here: a half-typed OID is malformed for as long as the
   * operator is typing it, and applying a template must not delete the row
   * they are in the middle of.
   */
  const addTemplate: (template: SnmpOid) => void = (
    template: SnmpOid,
  ): void => {
    setShowTemplates(false);

    const normalized: string = SnmpOidListUtil.normalizeOid(template.oid);

    const isAlreadyInList: boolean = oids.some((entry: SnmpOid): boolean => {
      return SnmpOidListUtil.normalizeOid(entry.oid) === normalized;
    });

    if (isAlreadyInList) {
      return;
    }

    const newOids: Array<SnmpOid> = [...oids, { ...template, oid: normalized }];
    setOids(newOids);
    props.onChange(newOids);
  };

  const templateOptions: Array<DropdownOption> =
    SnmpOidTemplates.getCommonOids().map((template: SnmpOid) => {
      return {
        label: `${template.name} (${template.oid})`,
        value: template.oid,
      };
    });

  const rowIssues: Array<OidRowIssue> = getRowIssues(oids);

  return (
    <div>
      <FieldLabelElement
        title="OIDs to Monitor"
        description="Add the OIDs you want to query from the SNMP device"
        required={true}
      />

      {oids.length > 0 && (
        <div className="space-y-3 mt-3">
          {oids.map((oid: SnmpOid, index: number) => {
            const issue: OidRowIssue = rowIssues[index] || {};

            return (
              <div
                key={index}
                data-testid={`snmp-oid-row-${index}`}
                className="flex items-start space-x-2 p-3 border rounded-md bg-gray-50"
              >
                <div className="flex-1 space-y-2">
                  <Input
                    initialValue={oid.oid}
                    dataTestId={`snmp-oid-row-${index}-oid`}
                    error={issue.error}
                    placeholder="OID (e.g., 1.3.6.1.2.1.1.1.0)"
                    onChange={(value: string) => {
                      updateOid(index, "oid", value);
                    }}
                  />
                  {issue.error ? (
                    <p
                      data-testid={`snmp-oid-row-${index}-error`}
                      className="text-sm text-red-600"
                    >
                      {issue.error}
                    </p>
                  ) : (
                    <></>
                  )}
                  {issue.advisory ? (
                    <p
                      data-testid={`snmp-oid-row-${index}-advisory`}
                      className="text-sm text-amber-700"
                    >
                      {issue.advisory}
                    </p>
                  ) : (
                    <></>
                  )}
                  <div className="flex space-x-2">
                    <Input
                      initialValue={oid.name || ""}
                      dataTestId={`snmp-oid-row-${index}-name`}
                      placeholder="Name (optional)"
                      onChange={(value: string) => {
                        updateOid(index, "name", value);
                      }}
                    />
                    <Input
                      initialValue={oid.description || ""}
                      dataTestId={`snmp-oid-row-${index}-description`}
                      placeholder="Description (optional)"
                      onChange={(value: string) => {
                        updateOid(index, "description", value);
                      }}
                    />
                  </div>
                </div>
                <Button
                  buttonStyle={ButtonStyleType.ICON}
                  icon={IconProp.Trash}
                  dataTestId={`snmp-oid-remove-${index}`}
                  onClick={() => {
                    removeOid(index);
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex space-x-2">
        <Button
          title="Add OID"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          dataTestId="snmp-oid-add"
          onClick={addOid}
          icon={IconProp.Add}
        />
        <Button
          title="Add from Template"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          dataTestId="snmp-oid-add-from-template"
          onClick={() => {
            setShowTemplates(!showTemplates);
          }}
          icon={IconProp.Template}
        />
      </div>

      {showTemplates && (
        <div className="mt-3">
          <Dropdown
            options={templateOptions}
            dataTestId="snmp-oid-template-dropdown"
            placeholder="Select a common OID template..."
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (value) {
                const template: SnmpOid | undefined =
                  SnmpOidTemplates.getCommonOids().find((t: SnmpOid) => {
                    return t.oid === value.toString();
                  });
                if (template) {
                  addTemplate(template);
                }
              }
            }}
          />
        </div>
      )}
    </div>
  );
};

export default SnmpOidEditor;
