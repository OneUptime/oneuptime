import {
  GROUPING_RULE_COPY,
  GroupingRuleKind,
  GroupingRuleTranslateFunction,
  getNewGroupingRuleValues,
} from "../../Utils/GroupingRule/GroupingRuleSetup";
import GroupingRuleTemplates from "./GroupingRuleTemplates";
import useGroupingRuleTranslate from "./GroupingRuleTranslate";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import React, { ReactElement, useState } from "react";

export interface GroupingRuleTableExtras<TBaseModel extends BaseModel> {
  // Changes when a template adds a rule, so the list fetches it.
  refreshToggle: string;
  // Opens the regular create form, for "Create Custom Rule".
  showCreateForm: boolean;
  onCreateEditModalClose: () => void;
  // What a blank rule starts as (see getNewGroupingRuleValues).
  createInitialValues: FormValues<TBaseModel>;
  // An empty list offers the templates instead of a bare "No rules yet".
  noItemsMessage: ReactElement;
  // "Create from Template", beside the create button.
  cardButtons: Array<CardButtonSchema>;
  // The page renders these beside the table.
  templatesModal: ReactElement;
  statusMessage: ReactElement;
}

/*
 * The parts of the Incident and Alert Grouping Rules pages that are not the
 * table's own: the templates (in place of an empty list, and in a dialog
 * from the card's header once there are rules), the blank rule's starting
 * values, and a status message for screen readers when a template adds a
 * rule. Each page keeps its own ModelTable, so the table and its form stay
 * readable where they are declared.
 */
export const useGroupingRuleTableExtras: <TBaseModel extends BaseModel>(data: {
  kind: GroupingRuleKind;
  modelType: { new (): TBaseModel };
}) => GroupingRuleTableExtras<TBaseModel> = <
  TBaseModel extends BaseModel,
>(data: {
  kind: GroupingRuleKind;
  modelType: { new (): TBaseModel };
}): GroupingRuleTableExtras<TBaseModel> => {
  const translate: GroupingRuleTranslateFunction = useGroupingRuleTranslate();
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [showTemplatesModal, setShowTemplatesModal] = useState<boolean>(false);
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [announcement, setAnnouncement] = useState<string>("");

  const onRuleAdded: (added: { name: string }) => void = (added: {
    name: string;
  }): void => {
    setShowTemplatesModal(false);
    setRefreshCount((count: number): number => {
      return count + 1;
    });
    setAnnouncement(
      translate(GROUPING_RULE_COPY.ruleAdded, { name: added.name }),
    );
  };

  const templatesButton: CardButtonSchema | null =
    PermissionGate.gateCardButton(
      {
        title: GROUPING_RULE_COPY.templatesModalTitle,
        buttonStyle: ButtonStyleType.OUTLINE,
        icon: IconProp.Template,
        onClick: (): void => {
          setShowTemplatesModal(true);
        },
      },
      new data.modelType(),
      ModelAction.Create,
    );

  return {
    refreshToggle: `grouping-rules-${refreshCount}`,
    showCreateForm: showCreateForm,
    onCreateEditModalClose: (): void => {
      setShowCreateForm(false);
    },
    createInitialValues: getNewGroupingRuleValues({
      kind: data.kind,
      translate,
    }) as FormValues<TBaseModel>,
    noItemsMessage: (
      <GroupingRuleTemplates<TBaseModel>
        kind={data.kind}
        modelType={data.modelType}
        showIntro={true}
        onRuleAdded={onRuleAdded}
        onCreateCustomRule={(): void => {
          setShowCreateForm(true);
        }}
      />
    ),
    cardButtons: templatesButton ? [templatesButton] : [],
    templatesModal: showTemplatesModal ? (
      <Modal
        title={GROUPING_RULE_COPY.templatesModalTitle}
        description={GROUPING_RULE_COPY.templatesModalDescription}
        modalWidth={ModalWidth.Large}
        onClose={(): void => {
          setShowTemplatesModal(false);
        }}
      >
        <GroupingRuleTemplates<TBaseModel>
          kind={data.kind}
          modelType={data.modelType}
          onRuleAdded={onRuleAdded}
        />
      </Modal>
    ) : (
      <></>
    ),
    statusMessage: (
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="grouping-rule-status"
      >
        {announcement}
      </div>
    ),
  };
};

export default useGroupingRuleTableExtras;
