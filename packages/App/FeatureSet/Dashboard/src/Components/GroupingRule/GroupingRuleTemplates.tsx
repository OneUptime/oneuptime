import {
  GROUPING_RULE_COPY,
  GROUPING_RULE_TEMPLATES,
  GroupingRuleKind,
  GroupingRuleTemplate,
  GroupingRuleTranslateFunction,
  GroupingRuleValues,
  getTemplateRuleValues,
} from "../../Utils/GroupingRule/GroupingRuleSetup";
import useGroupingRuleTranslate from "./GroupingRuleTranslate";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { ReactElement, useId, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  kind: GroupingRuleKind;
  modelType: { new (): TBaseModel };
  // The rule was saved; the list should show it.
  onRuleAdded: (data: { name: string }) => void;
  // Offers "Create Custom Rule", which opens the regular create form.
  onCreateCustomRule?: (() => void) | undefined;
  // The heading and the worked example, for a list with no rules yet.
  showIntro?: boolean | undefined;
}

/*
 * Ready-made grouping rules, each added in one click.
 *
 * A first rule used to mean a nine-step form. Each card here is a whole rule
 * - what it groups by and its time window - named for what it does, and
 * "Add Rule" saves it as it is: enabled, at the end of the list, matching
 * every new incident. It can be edited like any other rule afterwards.
 *
 * Shown in place of an empty list, and from the list's "Create from
 * Template" button once there are rules.
 */
const GroupingRuleTemplates: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const translate: GroupingRuleTranslateFunction = useGroupingRuleTranslate();
  const headingId: string = `grouping-rule-templates-${useId()}`;
  const [addingTemplateId, setAddingTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createGate: PermissionGateResult = PermissionGate.check(
    new props.modelType(),
    ModelAction.Create,
  );

  /*
   * No answer yet about permissions (or none to give) hides the actions
   * rather than offering a disabled button with no reason on it.
   */
  const showActions: boolean =
    createGate.isAllowed || Boolean(createGate.disabledReason);

  const addTemplate: (template: GroupingRuleTemplate) => Promise<void> = async (
    template: GroupingRuleTemplate,
  ): Promise<void> => {
    if (!createGate.isAllowed || addingTemplateId) {
      return;
    }

    setAddingTemplateId(template.id);
    setError(null);

    try {
      const values: GroupingRuleValues = getTemplateRuleValues({
        template,
        kind: props.kind,
        translate,
      });

      const rule: TBaseModel = new props.modelType();
      Object.assign(rule, values);

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (projectId) {
        (rule as unknown as GroupingRuleValues)["projectId"] = projectId;
      }

      await ModelAPI.create<TBaseModel>({
        model: rule,
        modelType: props.modelType,
      });

      setAddingTemplateId(null);
      props.onRuleAdded({ name: String(values["name"]) });
    } catch (err) {
      setAddingTemplateId(null);
      setError(API.getFriendlyMessage(err));
    }
  };

  return (
    <section
      className="mx-auto max-w-4xl text-left"
      aria-labelledby={props.showIntro ? headingId : undefined}
      data-testid="grouping-rule-templates"
    >
      {props.showIntro ? (
        <div className="mb-5 flex items-start gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50"
            aria-hidden="true"
          >
            <Icon
              icon={IconProp.SquareStack}
              className="h-5 w-5 text-indigo-600"
            />
          </div>
          <div className="min-w-0">
            <h3
              id={headingId}
              className="text-base font-semibold text-gray-900"
            >
              {translate(GROUPING_RULE_COPY.emptyStateTitle)}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              {translate(GROUPING_RULE_COPY.emptyStateExample[props.kind])}
            </p>
          </div>
        </div>
      ) : (
        <></>
      )}

      <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {GROUPING_RULE_TEMPLATES.map(
          (template: GroupingRuleTemplate): ReactElement => {
            const name: string = translate(template.name[props.kind]);
            const isAdding: boolean = addingTemplateId === template.id;

            return (
              <li
                key={template.id}
                className="flex flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                data-testid={`grouping-rule-template-${template.id}`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100"
                    aria-hidden="true"
                  >
                    <Icon
                      icon={template.icon}
                      className="h-5 w-5 text-gray-600"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-gray-900">
                      {name}
                    </h4>
                    <p className="mt-1 text-sm text-gray-600">
                      {translate(template.description[props.kind])}
                    </p>
                  </div>
                </div>
                {showActions ? (
                  <div className="mt-4 flex justify-end">
                    <Button
                      title={GROUPING_RULE_COPY.addRule}
                      ariaLabel={`${translate(GROUPING_RULE_COPY.addRule)}: ${name}`}
                      icon={IconProp.Add}
                      buttonStyle={ButtonStyleType.OUTLINE}
                      buttonSize={ButtonSize.Small}
                      isLoading={isAdding}
                      disabled={
                        !createGate.isAllowed || addingTemplateId !== null
                      }
                      tooltip={createGate.disabledReason}
                      dataTestId={`grouping-rule-template-${template.id}-add`}
                      onClick={(): void => {
                        void addTemplate(template);
                      }}
                    />
                  </div>
                ) : (
                  <></>
                )}
              </li>
            );
          },
        )}
      </ul>

      {error ? (
        <div className="mt-4" data-testid="grouping-rule-templates-error">
          <Alert type={AlertType.DANGER} title={error} />
        </div>
      ) : (
        <></>
      )}

      {props.onCreateCustomRule && showActions ? (
        <div className="mt-5 flex justify-center">
          <Button
            title={GROUPING_RULE_COPY.createCustomRule}
            icon={IconProp.AdjustmentHorizontal}
            buttonStyle={ButtonStyleType.NORMAL}
            disabled={!createGate.isAllowed}
            tooltip={createGate.disabledReason}
            dataTestId="grouping-rule-templates-create-custom"
            onClick={(): void => {
              if (createGate.isAllowed) {
                props.onCreateCustomRule?.();
              }
            }}
          />
        </div>
      ) : (
        <></>
      )}
    </section>
  );
};

export default GroupingRuleTemplates;
