import VMwareHealthRuleOverride from "Common/Models/DatabaseModels/VMwareHealthRuleOverride";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import ObjectID from "Common/Types/ObjectID";
import {
  VMWARE_HEALTH_RULE_SCOPES,
  VMWARE_HEALTH_RULE_SCOPE_KIND,
  VMWARE_HEALTH_RULE_VCENTER_PART_KIND,
  VMwareHealthRuleBook,
  VMwareHealthRuleOverrideEntry,
  VMwareHealthRuleOverrideRules,
  VMwareHealthRulePart,
  VMwareHealthRuleScope,
  getVMwareHealthRuleOverrideRulesRefusal,
  readVMwareHealthRuleOverrideValue,
  resolveVMwareHealthRules,
} from "Common/Types/VMware/VMwareHealthRuleOverrides";
import {
  VMwareHealthRuleKey,
  VMwareHealthRules,
  isVMwareHealthPeriodRuleKey,
} from "Common/Types/VMware/VMwareHealthRules";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  VMWARE_HEALTH_RULE_SCOPE_WORDS,
  VMwareHealthRuleValueText,
  VMwareHealthRuleWords,
  getVMwareHealthRuleValueText,
  getVMwareHealthRuleWords,
  getVMwareHealthRuleWordsForScope,
} from "../../../Pages/VMware/Utils/VMwareHealthRuleWords";

/*
 * A vCenter's, a cluster's, an ESXi host's or a VM's own health rules
 * (#11469), made or changed in one short dialog:
 *
 *   - where they apply: a vCenter, then the whole of it or one of its
 *     clusters, hosts or VMs - picked by name, searched on the server, so a
 *     vCenter of thousands of VMs is never listed whole. A rule made from a
 *     part's own page, or one being edited, says where instead;
 *   - the rules it changes, one row each: a rule its scope judges, its value,
 *     or Off for a threshold, and what it replaces ("Instead of: Above 90%")
 *     - the project's rule, or a broader override's - so nobody wonders what
 *     a part would be judged by without it. Rules it does not hold are
 *     inherited.
 *
 * The server checks what is saved the same way (VMwareHealthRuleOverride
 * Service): the part is in the vCenter, and each rule is one its scope may
 * set, at a value the rule can take.
 */

export const VMWARE_HEALTH_RULE_OVERRIDE_MODAL_TEST_ID: string =
  "vmware-health-rule-override-modal";

const TITLE_ADD: string = translationKey("Add Override");
const TITLE_EDIT: string = translationKey("Edit Override");
const LABEL_VCENTER: string = translationKey("vCenter");
const LABEL_APPLIES_TO: string = translationKey("Applies To");
const LABEL_PART: string = translationKey("Which One");
const LABEL_RULES: string = translationKey("Rules");
const PLACEHOLDER_VCENTER: string = translationKey("Choose a vCenter");
const PLACEHOLDER_PART: string = translationKey("Search by name");
const PLACEHOLDER_RULE: string = translationKey("Choose a rule");
const ADD_RULE: string = translationKey("Add Rule");
const REMOVE_RULE: string = translationKey("Remove Rule");
const OFF_SWITCH: string = translationKey("Off");
const INSTEAD_OF: string = translationKey("Instead of: {{value}}");
const NO_RULES_YET: string = translationKey(
  "Add the rules this one changes. Every other rule stays as it is.",
);
const ERROR_NO_VCENTER: string = translationKey("Choose a vCenter.");
const ERROR_NO_PART: string = translationKey(
  "Choose which one the rules apply to.",
);
const ERROR_NO_RULE: string = translationKey(
  "Add at least one rule, or close without saving.",
);
const ERROR_PICK_RULE: string = translationKey(
  "Choose a rule for every row, or remove the row.",
);
const ERROR_VALUE: string = translationKey(
  "Enter a whole number for every rule, or turn it off.",
);
const SAVED: string = translationKey("Override saved");
const SAVE_CHANGES: string = translationKey("Save Changes");

// What a new override is for, when it is made from a part's own page.
export interface VMwareHealthRuleOverrideTarget {
  vmwareVCenterId: ObjectID;
  scope: VMwareHealthRuleScope;
  resourceExternalId?: string | null | undefined;
  resourceName?: string | null | undefined;
}

export interface ComponentProps {
  // The override to change; left out, a new one.
  override?: VMwareHealthRuleOverride | undefined;
  // Where a new one applies, when that is known already.
  target?: VMwareHealthRuleOverrideTarget | undefined;
  // The project's rules and its other overrides, for what each rule replaces.
  book: VMwareHealthRuleBook;
  onClose: () => void;
  onSaved: () => void;
}

interface RuleRow {
  id: number;
  key: VMwareHealthRuleKey | null;
  value: string;
  isOff: boolean;
}

interface PartChoice {
  externalId: string;
  name: string;
  datacenterName: string | null;
  clusterName: string | null;
  hostName: string | null;
}

let nextRowId: number = 1;

function toRows(rules: VMwareHealthRuleOverrideRules | undefined): Array<RuleRow> {
  const rows: Array<RuleRow> = [];
  for (const [key, value] of Object.entries(rules || {})) {
    if (value === undefined) {
      continue;
    }
    rows.push({
      id: nextRowId++,
      key: key as VMwareHealthRuleKey,
      value: value === null ? "" : String(value),
      isOff: value === null,
    });
  }
  return rows;
}

// The rows as the override's rules, or why they are not yet.
export function getVMwareHealthRuleOverrideRulesFromRows(
  rows: Array<{ key: VMwareHealthRuleKey | null; value: string; isOff: boolean }>,
): { rules: VMwareHealthRuleOverrideRules; error: string | null } {
  const rules: VMwareHealthRuleOverrideRules = {};
  if (rows.length === 0) {
    return { rules, error: ERROR_NO_RULE };
  }
  for (const row of rows) {
    if (!row.key) {
      return { rules, error: ERROR_PICK_RULE };
    }
    if (row.isOff && !isVMwareHealthPeriodRuleKey(row.key)) {
      rules[row.key] = null;
      continue;
    }
    const text: string = row.value.trim();
    const number: number = Number(text);
    if (!text || !Number.isInteger(number)) {
      return { rules, error: ERROR_VALUE };
    }
    rules[row.key] = number;
  }
  return { rules, error: null };
}

// The part an override of a scope is about, as the rules resolve it.
function partOf(data: {
  vmwareVCenterId: string;
  scope: VMwareHealthRuleScope;
  part: PartChoice | null;
}): VMwareHealthRulePart {
  const kind: VMwareResourceKind | null =
    VMWARE_HEALTH_RULE_SCOPE_KIND[data.scope];
  if (!kind || !data.part) {
    return {
      kind: VMWARE_HEALTH_RULE_VCENTER_PART_KIND,
      vmwareVCenterId: data.vmwareVCenterId,
    };
  }
  return {
    vmwareVCenterId: data.vmwareVCenterId,
    kind: kind,
    externalId: data.part.externalId,
    name: data.part.name,
    datacenterName: data.part.datacenterName,
    clusterName:
      data.part.clusterName ||
      (kind === VMwareResourceKind.Cluster ? data.part.name : null),
    hostName:
      data.part.hostName ||
      (kind === VMwareResourceKind.Host ? data.part.name : null),
  };
}

const VMwareHealthRuleOverrideModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isEdit: boolean = Boolean(props.override);
  const fixedVCenterId: string | null =
    props.override?.vmwareVCenterId?.toString() ||
    props.target?.vmwareVCenterId.toString() ||
    null;
  const fixedScope: VMwareHealthRuleScope | null =
    (props.override?.scope as VMwareHealthRuleScope | undefined) ||
    props.target?.scope ||
    null;
  const fixedPart: PartChoice | null =
    props.override?.resourceExternalId || props.target?.resourceExternalId
      ? {
          externalId:
            props.override?.resourceExternalId ||
            props.target?.resourceExternalId ||
            "",
          name:
            props.override?.resourceName ||
            props.target?.resourceName ||
            props.override?.resourceExternalId ||
            props.target?.resourceExternalId ||
            "",
          datacenterName: props.override?.datacenterName || null,
          clusterName: props.override?.clusterName || null,
          hostName: props.override?.hostName || null,
        }
      : null;
  const isWhereFixed: boolean = isEdit || Boolean(props.target);

  const [vcenterId, setVCenterId] = useState<string | null>(fixedVCenterId);
  const [scope, setScope] = useState<VMwareHealthRuleScope>(
    fixedScope || VMwareHealthRuleScope.VCenter,
  );
  const [part, setPart] = useState<PartChoice | null>(fixedPart);
  const [rows, setRows] = useState<Array<RuleRow>>(() => {
    return toRows(props.override?.rules);
  });
  const [vcenters, setVCenters] = useState<Array<DropdownOption>>([]);
  const [parts, setParts] = useState<Array<PartChoice>>([]);
  const [partSearch, setPartSearch] = useState<string>("");
  const [isLoadingParts, setIsLoadingParts] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [fieldError, setFieldError] = useState<string>("");

  // The project's vCenters, by name.
  useEffect(() => {
    if (isWhereFixed && fixedVCenterId) {
      return;
    }
    let cancelled: boolean = false;
    ModelAPI.getList<VMwareVCenter>({
      modelType: VMwareVCenter,
      query: { projectId: ProjectUtil.getCurrentProjectId()! },
      select: { _id: true, name: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: { name: SortOrder.Ascending },
    })
      .then((result: ListResult<VMwareVCenter>): void => {
        if (cancelled) {
          return;
        }
        setVCenters(
          result.data.map((vcenter: VMwareVCenter): DropdownOption => {
            return {
              value: vcenter.id?.toString() || "",
              label: vcenter.name || vcenter.id?.toString() || "",
              isUserContent: true,
            };
          }),
        );
      })
      .catch((err: unknown): void => {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The vCenter's clusters, hosts or VMs that match what is typed.
  useEffect(() => {
    const kind: VMwareResourceKind | null = VMWARE_HEALTH_RULE_SCOPE_KIND[scope];
    if (isWhereFixed || !vcenterId || !kind) {
      setParts([]);
      return;
    }
    let cancelled: boolean = false;
    setIsLoadingParts(true);
    const query: Record<string, unknown> = {
      vmwareVCenterId: new ObjectID(vcenterId),
      kind: kind,
    };
    if (partSearch.trim()) {
      query["name"] = new Search(partSearch.trim());
    }
    if (kind === VMwareResourceKind.VirtualMachine) {
      query["isTemplate"] = false;
    }
    ModelAPI.getList<VMwareResource>({
      modelType: VMwareResource,
      query: query,
      select: {
        externalId: true,
        name: true,
        datacenterName: true,
        clusterName: true,
        hostName: true,
      },
      limit: 50,
      skip: 0,
      sort: { name: SortOrder.Ascending },
    })
      .then((result: ListResult<VMwareResource>): void => {
        if (cancelled) {
          return;
        }
        setParts(
          result.data
            .filter((row: VMwareResource): boolean => {
              return Boolean(row.externalId);
            })
            .map((row: VMwareResource): PartChoice => {
              return {
                externalId: row.externalId!,
                name: row.name || row.externalId!,
                datacenterName: row.datacenterName || null,
                clusterName: row.clusterName || null,
                hostName: row.hostName || null,
              };
            }),
        );
      })
      .catch((err: unknown): void => {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally((): void => {
        if (!cancelled) {
          setIsLoadingParts(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [vcenterId, scope, partSearch]);

  /*
   * What each rule would be without this override: the project's, or a
   * broader override's (a host's is its cluster's or its vCenter's).
   */
  const inherited: VMwareHealthRules | null = useMemo(() => {
    if (!vcenterId) {
      return null;
    }
    const ownId: string | undefined = props.override?.id?.toString();
    const others: VMwareHealthRuleBook = {
      project: props.book.project,
      overrides: props.book.overrides.filter(
        (override: VMwareHealthRuleOverrideEntry): boolean => {
          return !ownId || override.id !== ownId;
        },
      ),
    };
    return resolveVMwareHealthRules(
      others,
      partOf({ vmwareVCenterId: vcenterId, scope, part }),
    );
  }, [vcenterId, scope, part, props.book]);

  const ruleWords: Array<VMwareHealthRuleWords> =
    getVMwareHealthRuleWordsForScope(scope);

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const valueText: (value: VMwareHealthRuleValueText) => string = (
    value: VMwareHealthRuleValueText,
  ): string => {
    if (!value.values) {
      return tx(value.text);
    }
    const values: Record<string, string> = {};
    for (const [name, number] of Object.entries(value.values)) {
      values[name] = translator.formatNumber(number);
    }
    return translator.translateTemplate(value.text, values);
  };

  // A rule picker's choices, grouped by card, the rules other rows hold left out.
  const ruleOptions: (row: RuleRow) => Array<DropdownOptionGroup> = (
    row: RuleRow,
  ): Array<DropdownOptionGroup> => {
    const taken: Set<string> = new Set(
      rows
        .filter((other: RuleRow): boolean => {
          return other.id !== row.id && Boolean(other.key);
        })
        .map((other: RuleRow): string => {
          return other.key!;
        }),
    );
    const groups: Map<string, Array<DropdownOption>> = new Map();
    for (const words of ruleWords) {
      if (taken.has(words.key)) {
        continue;
      }
      const options: Array<DropdownOption> = groups.get(words.group) || [];
      options.push({ value: words.key, label: words.label });
      groups.set(words.group, options);
    }
    return Array.from(groups.entries()).map(
      ([group, options]: [string, Array<DropdownOption>]): DropdownOptionGroup => {
        return { label: group, options };
      },
    );
  };

  const updateRow: (id: number, change: Partial<RuleRow>) => void = (
    id: number,
    change: Partial<RuleRow>,
  ): void => {
    setRows((current: Array<RuleRow>): Array<RuleRow> => {
      return current.map((row: RuleRow): RuleRow => {
        return row.id === id ? { ...row, ...change } : row;
      });
    });
    setFieldError("");
  };

  const save: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setFieldError("");

    if (!vcenterId) {
      setFieldError(ERROR_NO_VCENTER);
      return;
    }
    if (VMWARE_HEALTH_RULE_SCOPE_KIND[scope] && !part) {
      setFieldError(ERROR_NO_PART);
      return;
    }
    const read: { rules: VMwareHealthRuleOverrideRules; error: string | null } =
      getVMwareHealthRuleOverrideRulesFromRows(rows);
    if (read.error) {
      setFieldError(read.error);
      return;
    }
    const refusal: string | null = getVMwareHealthRuleOverrideRulesRefusal(
      scope,
      read.rules,
    );
    if (refusal) {
      setFieldError(refusal);
      return;
    }

    setIsSaving(true);
    try {
      if (props.override?.id) {
        await ModelAPI.updateById<VMwareHealthRuleOverride>({
          modelType: VMwareHealthRuleOverride,
          id: props.override.id,
          data: { rules: read.rules },
        });
      } else {
        const override: VMwareHealthRuleOverride =
          new VMwareHealthRuleOverride();
        override.projectId = ProjectUtil.getCurrentProjectId()!;
        override.vmwareVCenterId = new ObjectID(vcenterId);
        override.scope = scope;
        if (part) {
          override.resourceExternalId = part.externalId;
        }
        override.rules = read.rules;
        await ModelAPI.create<VMwareHealthRuleOverride>({
          model: override,
          modelType: VMwareHealthRuleOverride,
        });
      }
      Toast.success(tx(SAVED));
      props.onSaved();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const scopeOptions: Array<DropdownOption> = VMWARE_HEALTH_RULE_SCOPES.map(
    (each: VMwareHealthRuleScope): DropdownOption => {
      return { value: each, label: VMWARE_HEALTH_RULE_SCOPE_WORDS[each] };
    },
  );

  const partOptions: Array<DropdownOption> = parts.map(
    (choice: PartChoice): DropdownOption => {
      // Where it sits, under its name: two parts can share one.
      const where: string = [
        choice.clusterName || choice.hostName,
        choice.datacenterName,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        value: choice.externalId,
        label: choice.name,
        ...(where ? { description: where } : {}),
        isUserContent: true,
      };
    },
  );

  const where: ReactElement = isWhereFixed ? (
    <p
      className="text-sm text-gray-700"
      data-testid="vmware-health-rule-override-where"
    >
      <span className="font-medium">
        {tx(VMWARE_HEALTH_RULE_SCOPE_WORDS[scope])}
      </span>
      {part ? <bdi className="ms-1">{part.name}</bdi> : <></>}
    </p>
  ) : (
    <div className="space-y-4">
      <div>
        <label
          className="mb-1 block text-sm font-medium text-gray-700"
          htmlFor="vmware-health-rule-override-vcenter"
        >
          {tx(LABEL_VCENTER)}
        </label>
        <Dropdown
          inputId="vmware-health-rule-override-vcenter"
          dataTestId="vmware-health-rule-override-vcenter"
          options={vcenters}
          placeholder={PLACEHOLDER_VCENTER}
          isClearable={false}
          value={vcenters.find((option: DropdownOption): boolean => {
            return option.value === vcenterId;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            setVCenterId(value ? String(value) : null);
            setPart(null);
            setFieldError("");
          }}
        />
      </div>
      <div>
        <label
          className="mb-1 block text-sm font-medium text-gray-700"
          htmlFor="vmware-health-rule-override-scope"
        >
          {tx(LABEL_APPLIES_TO)}
        </label>
        <Dropdown
          inputId="vmware-health-rule-override-scope"
          dataTestId="vmware-health-rule-override-scope"
          options={scopeOptions}
          isClearable={false}
          value={scopeOptions.find((option: DropdownOption): boolean => {
            return option.value === scope;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const next: VMwareHealthRuleScope =
              (value as VMwareHealthRuleScope) || VMwareHealthRuleScope.VCenter;
            setScope(next);
            setPart(null);
            // A rule the new scope does not judge goes.
            const allowed: Set<string> = new Set(
              getVMwareHealthRuleWordsForScope(next).map(
                (words: VMwareHealthRuleWords): string => {
                  return words.key;
                },
              ),
            );
            setRows((current: Array<RuleRow>): Array<RuleRow> => {
              return current.filter((row: RuleRow): boolean => {
                return !row.key || allowed.has(row.key);
              });
            });
            setFieldError("");
          }}
        />
      </div>
      {VMWARE_HEALTH_RULE_SCOPE_KIND[scope] ? (
        <div>
          <label
            className="mb-1 block text-sm font-medium text-gray-700"
            htmlFor="vmware-health-rule-override-part"
          >
            {tx(LABEL_PART)}
          </label>
          <Dropdown
            inputId="vmware-health-rule-override-part"
            dataTestId="vmware-health-rule-override-part"
            options={partOptions}
            placeholder={PLACEHOLDER_PART}
            isLoading={isLoadingParts}
            disabled={!vcenterId}
            value={
              part
                ? {
                    value: part.externalId,
                    label: part.name,
                    isUserContent: true,
                  }
                : undefined
            }
            onSearchTextChange={(text: string) => {
              setPartSearch(text);
            }}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setPart(
                parts.find((choice: PartChoice): boolean => {
                  return choice.externalId === value;
                }) || null,
              );
              setFieldError("");
            }}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  return (
    <Modal
      title={isEdit ? TITLE_EDIT : TITLE_ADD}
      modalWidth={ModalWidth.Medium}
      submitButtonText={isEdit ? SAVE_CHANGES : TITLE_ADD}
      isLoading={isSaving}
      error={error || undefined}
      onClose={props.onClose}
      onSubmit={() => {
        save().catch(() => {
          // save() says its own failures.
        });
      }}
    >
      <div
        className="space-y-6"
        data-testid={VMWARE_HEALTH_RULE_OVERRIDE_MODAL_TEST_ID}
      >
        {where}

        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">
            {tx(LABEL_RULES)}
          </p>
          {rows.length === 0 ? (
            <p className="mb-3 text-sm text-gray-500">{tx(NO_RULES_YET)}</p>
          ) : (
            <></>
          )}
          <ul className="space-y-3">
            {rows.map((row: RuleRow, index: number): ReactElement => {
              const words: VMwareHealthRuleWords | null = row.key
                ? getVMwareHealthRuleWords(row.key)
                : null;
              const isPeriod: boolean = row.key
                ? isVMwareHealthPeriodRuleKey(row.key)
                : false;
              const replaced: string | null =
                row.key && inherited
                  ? valueText(
                      getVMwareHealthRuleValueText(
                        row.key,
                        readVMwareHealthRuleOverrideValue(
                          row.key,
                          inherited[row.key],
                        ).value,
                      ),
                    )
                  : null;
              return (
                <li
                  key={row.id}
                  className="rounded-md border border-gray-200 p-3"
                  data-testid={`vmware-health-rule-override-row-${index}`}
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-[14rem] flex-1">
                      <Dropdown
                        dataTestId={`vmware-health-rule-override-row-${index}-rule`}
                        ariaLabel={PLACEHOLDER_RULE}
                        options={ruleOptions(row)}
                        placeholder={PLACEHOLDER_RULE}
                        isClearable={false}
                        value={
                          words
                            ? { value: words.key, label: words.label }
                            : undefined
                        }
                        onChange={(
                          value: DropdownValue | Array<DropdownValue> | null,
                        ) => {
                          updateRow(row.id, {
                            key: (value as VMwareHealthRuleKey) || null,
                            isOff: false,
                          });
                        }}
                      />
                    </div>
                    <div className="w-32">
                      <Input
                        type={InputType.NUMBER}
                        dataTestId={`vmware-health-rule-override-row-${index}-value`}
                        ariaLabel={words ? words.label : PLACEHOLDER_RULE}
                        value={row.value}
                        disabled={row.isOff}
                        placeholder={isPeriod ? "0" : ""}
                        onChange={(value: string) => {
                          updateRow(row.id, { value: value });
                        }}
                      />
                    </div>
                    {words && !isPeriod ? (
                      <Toggle
                        dataTestId={`vmware-health-rule-override-row-${index}-off`}
                        title={OFF_SWITCH}
                        value={row.isOff}
                        onChange={(value: boolean) => {
                          updateRow(row.id, { isOff: value });
                        }}
                      />
                    ) : (
                      <></>
                    )}
                    <Button
                      title={REMOVE_RULE}
                      icon={IconProp.Trash}
                      buttonStyle={ButtonStyleType.ICON}
                      dataTestId={`vmware-health-rule-override-row-${index}-remove`}
                      onClick={() => {
                        setRows((current: Array<RuleRow>): Array<RuleRow> => {
                          return current.filter((other: RuleRow): boolean => {
                            return other.id !== row.id;
                          });
                        });
                      }}
                    />
                  </div>
                  {words ? (
                    <p className="mt-2 text-xs text-gray-500">
                      <span className="font-medium">{tx(words.group)}</span>
                      {replaced ? (
                        <span className="ms-2">
                          {translator.translateTemplate(INSTEAD_OF, {
                            value: replaced,
                          })}
                        </span>
                      ) : (
                        <></>
                      )}
                    </p>
                  ) : (
                    <></>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <Button
              title={ADD_RULE}
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.OUTLINE}
              dataTestId="vmware-health-rule-override-add-rule"
              disabled={rows.length >= ruleWords.length}
              onClick={() => {
                setRows((current: Array<RuleRow>): Array<RuleRow> => {
                  return [
                    ...current,
                    { id: nextRowId++, key: null, value: "", isOff: false },
                  ];
                });
                setFieldError("");
              }}
            />
          </div>
          {fieldError ? (
            <FieldError
              message={tx(fieldError)}
              className="mt-2"
              id="vmware-health-rule-override-error"
            />
          ) : (
            <></>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default VMwareHealthRuleOverrideModal;
