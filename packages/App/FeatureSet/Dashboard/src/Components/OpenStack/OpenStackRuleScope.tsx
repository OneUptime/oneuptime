import {
  OpenStackRuleScopeColumns,
  isOpenStackRuleScoped,
} from "Common/Types/OpenStack/OpenStackScopedRule";
import type Field from "Common/UI/Components/Forms/Types/Field";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import type SelectFormFields from "Common/UI/Types/SelectEntityField";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE PROJECT OR DOMAIN AN OPENSTACK CLOUD RULE IS ON.
 *
 * Not among the rule's match conditions: those are about the cloud, and are drawn as one
 * builder that takes over whatever is on its step. A rule's own page reads these from its
 * form, as it does every other field. A project's page and the Domains page fill them in,
 * so a person only types an ID to write such a rule by hand.
 */

export function getOpenStackRuleScopeFields<TEntity>(
  stepId: "owners" | "labels",
): Array<Field<TEntity>> {
  const section: FormFieldCollapsibleSection<TEntity> = {
    id: "openstack-rule-scope",
    title: "One project or domain",
    description:
      "Set one and this rule adds nothing to the cloud. It adds to each alert and incident that reaches that project or domain instead, on the clouds its conditions allow. Leave both empty for a rule on whole clouds.",
  };

  return [
    {
      field: {
        openStackProjectId: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "OpenStack Project ID",
      description:
        "Keystone's ID for the project, shown on the project's page. A rename breaks nothing.",
      stepId,
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "f3a1c0d2e4b64f7c8a9d0e1f2a3b4c5d",
      collapsibleSection: section,
    },
    {
      field: {
        openStackDomainId: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "OpenStack Domain ID",
      description:
        "Keystone's ID for the domain, shown on the Domains page. Every cloud has one called default, so name the cloud under Match too.",
      stepId,
      fieldType: FormFieldSchemaType.Text,
      required: false,
      /*
       * The default domain's ID in Keystone, in every language (isPlaceholderIdentifier):
       * German read it "Normal" and Spanish "predeterminado", IDs no cloud has (#7663).
       */
      placeholder: "default",
      isPlaceholderIdentifier: true,
      collapsibleSection: section,
    },
  ];
}

// In a table of rules, which of them are about whole clouds and which about one part.
const OpenStackRuleScopeText: FunctionComponent<{
  rule: OpenStackRuleScopeColumns;
}> = (props: { rule: OpenStackRuleScopeColumns }): ReactElement => {
  const translator: Translator = useTranslator();
  const { rule } = props;

  if (!isOpenStackRuleScoped(rule)) {
    return (
      <span className="text-sm text-gray-500">
        {translator.translateText("Whole clouds")}
      </span>
    );
  }

  return (
    <span className="text-sm text-gray-900">
      {rule.openStackProjectId ? (
        <span className="block">
          {translator.translateText("Project")}{" "}
          <bdi className="font-mono">{rule.openStackProjectId}</bdi>
        </span>
      ) : null}
      {rule.openStackDomainId ? (
        <span className="block">
          {translator.translateText("Domain")}{" "}
          <bdi className="font-mono">{rule.openStackDomainId}</bdi>
        </span>
      ) : null}
    </span>
  );
};

export default OpenStackRuleScopeText;
