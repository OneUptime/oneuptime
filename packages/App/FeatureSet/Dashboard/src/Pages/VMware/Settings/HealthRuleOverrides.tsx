import VMwareHealthRuleOverrideModal from "../../../Components/VMware/HealthRules/VMwareHealthRuleOverrideModal";
import {
  VMWARE_HEALTH_RULE_SCOPE_WORDS,
  VMwareHealthRuleValueText,
  VMwareHealthRuleWords,
  getVMwareHealthRuleValueText,
  getVMwareHealthRuleWords,
} from "../Utils/VMwareHealthRuleWords";
import { useVMwareHealthRuleBook } from "../Utils/VMwareHealthRulesStore";
import VMwareHealthRuleOverride from "Common/Models/DatabaseModels/VMwareHealthRuleOverride";
import IconProp from "Common/Types/Icon/IconProp";
import {
  VMWARE_HEALTH_RULE_SCOPE_RULES,
  VMwareHealthRuleBook,
  VMwareHealthRuleScope,
  readVMwareHealthRuleOverrideValue,
} from "Common/Types/VMware/VMwareHealthRuleOverrides";
import { VMwareHealthRuleKey } from "Common/Types/VMware/VMwareHealthRules";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { LABEL_WITH_COLON } from "Common/UI/Utils/LabelWithColon";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * VMware > Settings > Health Rules > Overrides (#11469): the vCenters,
 * clusters, ESXi hosts and VMs with rules of their own, each row saying
 * where it applies - what it is, and in which vCenter - and what it
 * changes, rule by rule, in the words of the cards above it. Everything
 * else about a part is the project's rules. Add Override and Edit open one
 * dialog (VMwareHealthRuleOverrideModal); Delete gives the part back to the
 * broader rules.
 */

export const VMWARE_HEALTH_RULE_OVERRIDES_TABLE_ID: string =
  "vmware-health-rule-overrides";

const CARD_TITLE: string = translationKey("Overrides");
const CARD_DESCRIPTION: string = translationKey(
  "Rules of their own for a vCenter, cluster, ESXi host or VM, such as a lab vCenter or a cluster meant to run hot. The most specific one wins.",
);
const NO_OVERRIDES: string = translationKey(
  "No overrides yet. Every vCenter is judged by the rules above.",
);
const IN_VCENTER: string = translationKey("vCenter {{name}}");
const COVERS: Readonly<Record<VMwareHealthRuleScope, string>> = {
  [VMwareHealthRuleScope.VCenter]: translationKey(
    "Everything in the vCenter",
  ),
  [VMwareHealthRuleScope.Cluster]: translationKey(
    "The cluster, its hosts, their VMs and its resource pools",
  ),
  [VMwareHealthRuleScope.Host]: translationKey("The host and its VMs"),
  [VMwareHealthRuleScope.VirtualMachine]: translationKey("This VM"),
};

export interface ComponentProps {
  // Told when an override was added, changed or deleted.
  onChanged: () => void;
}

const VMwareHealthRuleOverridesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [editing, setEditing] = useState<
    { override?: VMwareHealthRuleOverride | undefined } | null
  >(null);
  const [refreshToggle, setRefreshToggle] = useState<string>("0");
  // Read again once a change made the page forget it.
  const book: VMwareHealthRuleBook = useVMwareHealthRuleBook(refreshToggle);

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

  const changed: () => void = (): void => {
    setEditing(null);
    // The page forgets the book first, so the read that follows is new.
    props.onChanged();
    setRefreshToggle((toggle: string): string => {
      return String(Number(toggle) + 1);
    });
  };

  return (
    <Fragment>
      <ModelTable<VMwareHealthRuleOverride>
        modelType={VMwareHealthRuleOverride}
        id={VMWARE_HEALTH_RULE_OVERRIDES_TABLE_ID}
        userPreferencesKey={VMWARE_HEALTH_RULE_OVERRIDES_TABLE_ID}
        name="VMware Health Rule Overrides"
        singularName="Override"
        pluralName="Overrides"
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        createVerb="Add"
        onCreateClick={() => {
          setEditing({});
        }}
        onItemDeleted={() => {
          changed();
        }}
        refreshToggle={refreshToggle}
        query={{ projectId: ProjectUtil.getCurrentProjectId()! }}
        sortBy="createdAt"
        noItemsMessage={NO_OVERRIDES}
        filters={[]}
        cardProps={{
          title: CARD_TITLE,
          description: CARD_DESCRIPTION,
        }}
        actionButtons={[
          {
            title: "Edit",
            icon: IconProp.Edit,
            buttonStyleType: ButtonStyleType.HOVER_PRIMARY_OUTLINE,
            onClick: async (
              item: VMwareHealthRuleOverride,
              onCompleteAction: () => void,
            ) => {
              setEditing({ override: item });
              onCompleteAction();
            },
          },
        ]}
        selectMoreFields={{
          vmwareVCenterId: true,
          resourceExternalId: true,
          resourceName: true,
          datacenterName: true,
          clusterName: true,
          hostName: true,
          rules: true,
          vmwareVCenter: { name: true },
        }}
        columns={[
          {
            field: { scope: true },
            title: "Applies To",
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: VMwareHealthRuleOverride): ReactElement => {
              const scope: VMwareHealthRuleScope =
                (item.scope as VMwareHealthRuleScope) ||
                VMwareHealthRuleScope.VCenter;
              const vcenterName: string =
                item.vmwareVCenter?.name || item.vmwareVCenterId?.toString() || "";
              const where: Array<string> = [
                item.clusterName && scope !== VMwareHealthRuleScope.Cluster
                  ? item.clusterName
                  : "",
                item.datacenterName || "",
              ].filter(Boolean);
              return (
                <div
                  className="flex flex-col"
                  data-testid="vmware-health-rule-override-applies-to"
                >
                  <span className="text-sm font-medium text-gray-900">
                    {tx(VMWARE_HEALTH_RULE_SCOPE_WORDS[scope])}
                    {item.resourceName ? (
                      <bdi className="ms-1">{item.resourceName}</bdi>
                    ) : (
                      <></>
                    )}
                  </span>
                  <span className="text-xs text-gray-500">
                    {[
                      ...where,
                      translator.translateTemplate(IN_VCENTER, {
                        name: vcenterName,
                      }),
                    ].join(" · ")}
                  </span>
                  <span className="text-xs text-gray-500">
                    {tx(COVERS[scope])}
                  </span>
                </div>
              );
            },
          },
          {
            field: { rules: true },
            title: "Changes",
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: VMwareHealthRuleOverride): ReactElement => {
              const scope: VMwareHealthRuleScope =
                (item.scope as VMwareHealthRuleScope) ||
                VMwareHealthRuleScope.VCenter;
              const lines: Array<ReactElement> = [];
              for (const key of VMWARE_HEALTH_RULE_SCOPE_RULES[scope]) {
                const read: { isSet: boolean; value: number | null } =
                  readVMwareHealthRuleOverrideValue(
                    key,
                    (item.rules || {})[key as VMwareHealthRuleKey],
                  );
                if (!read.isSet) {
                  continue;
                }
                const words: VMwareHealthRuleWords =
                  getVMwareHealthRuleWords(key);
                lines.push(
                  <li key={key} data-testid={`vmware-health-rule-change-${key}`}>
                    <span className="text-gray-500">{tx(words.group)}</span>
                    {" · "}
                    {translator.translateTemplate(LABEL_WITH_COLON, {
                      label: tx(words.label),
                    })}{" "}
                    <span className="font-medium text-gray-900">
                      {valueText(
                        getVMwareHealthRuleValueText(key, read.value),
                      )}
                    </span>
                  </li>,
                );
              }
              return (
                <ul className="space-y-1 text-sm text-gray-700">{lines}</ul>
              );
            },
          },
        ]}
      />

      {editing ? (
        <VMwareHealthRuleOverrideModal
          override={editing.override}
          book={book}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={changed}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default VMwareHealthRuleOverridesCard;
