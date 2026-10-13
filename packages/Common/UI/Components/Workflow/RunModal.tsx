import { ButtonStyleType } from "../Button/Button";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import ConfirmModal from "../Modal/ConfirmModal";
import SideOver from "../SideOver/SideOver";
import RunForm, { RUN_WORKFLOW_SUBMIT_TITLE } from "./RunForm";
import { getRunRecordLabel } from "./RunRecordField";
import { LoadRunRecordsFunction } from "./RunRecordSource";
import { getRunValues } from "./RunValues";
import { WorkflowRunPanelTestRunNote } from "./WorkflowTestRun";
import { JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { NodeDataProp, NodeType } from "../../../Types/Workflow/Component";
import {
  RUN_RECORD_ARGUMENT_ID,
  RunRecordEvent,
  RunRecordOption,
  RunRecordTriggerInfo,
  getRunRecordTriggerInfo,
} from "../../../Types/Workflow/RunRecord";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The Run Workflow panel's words. It used to say "You can run this workflow
 * manually. This can be helpful to test the workflow." and ask "Are you sure
 * you want to run this workflow manually?" - neither said what a run does.
 * A run from here is a real run: every step runs for real, test run or not,
 * so the confirmation says so, and names the record a record trigger runs
 * with.
 */
export const RunModalCopy: {
  readonly description: string;
  readonly confirmTitle: string;
  readonly confirmRunsForReal: string;
  readonly confirmCreated: string;
  readonly confirmUpdated: string;
  readonly confirmDeleted: string;
} = {
  description: translationKey(
    "Start a run now, from the trigger, with the values you choose.",
  ),
  confirmTitle: translationKey("Run this workflow now?"),
  confirmRunsForReal: translationKey(
    "Every step runs for real: anything it sends, writes or deletes actually happens.",
  ),
  confirmCreated: translationKey(
    "It runs as if {{record}} had just been created. Every step runs for real: anything it sends, writes or deletes actually happens.",
  ),
  confirmUpdated: translationKey(
    "It runs as if {{record}} had just been updated. Every step runs for real: anything it sends, writes or deletes actually happens.",
  ),
  confirmDeleted: translationKey(
    "It runs as if {{record}} had just been deleted, but nothing is deleted. Every step runs for real: anything it sends, writes or deletes actually happens.",
  ),
};

type GetConfirmDescriptionFunction = (data: {
  translator: Translator;
  recordTrigger: RunRecordTriggerInfo | null;
  // The record picked, or what was typed for it.
  record: string;
}) => string;

/** What the confirmation says the run does. */
export const getRunConfirmDescription: GetConfirmDescriptionFunction = (data: {
  translator: Translator;
  recordTrigger: RunRecordTriggerInfo | null;
  record: string;
}): string => {
  if (!data.recordTrigger || !data.record) {
    return data.translator.translateText(RunModalCopy.confirmRunsForReal) || "";
  }

  const template: string =
    data.recordTrigger.event === RunRecordEvent.Created
      ? RunModalCopy.confirmCreated
      : data.recordTrigger.event === RunRecordEvent.Updated
        ? RunModalCopy.confirmUpdated
        : RunModalCopy.confirmDeleted;

  return data.translator.translateTemplate(template, { record: data.record });
};

export interface ComponentProps {
  onClose: () => void;
  onRun: (trigger: NodeDataProp) => void;
  trigger: NodeDataProp;
  /*
   * The workflow being run. A record trigger's record is looked up in its
   * project, by number or name (RunRecordField).
   */
  workflowId?: ObjectID | undefined;
  /*
   * The workflow is turned off, so this run will be a test run: the panel
   * says so before anything runs, and that its steps run for real all the
   * same (WorkflowTestRun).
   */
  isTestRun?: boolean | undefined;
  // Where a record trigger's records come from; the server unless a test says otherwise.
  loadRunRecords?: LoadRunRecordsFunction | undefined;
}

const RunModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [component, setComponent] = useState<NodeDataProp>(props.trigger);
  const [hasFormValidationErrors, setHasFormValidationErrors] =
    useState<boolean>(false);
  const [showRunConfirmation, setShowRunConfirmation] =
    useState<boolean>(false);
  const [pickedRecord, setPickedRecord] = useState<RunRecordOption | null>(
    null,
  );

  const [showFormValidationErrors, setShowFormValidationErrors] =
    useState<boolean>(false);

  const recordTrigger: RunRecordTriggerInfo | null = props.workflowId
    ? getRunRecordTriggerInfo(component.metadata)
    : null;

  /*
   * The record as the confirmation names it: the one picked, or what was
   * typed for it (a number, looked up when the run starts).
   */
  const typedRecord: JSONValue | undefined =
    component.arguments?.[RUN_RECORD_ARGUMENT_ID];
  const recordName: string =
    pickedRecord && pickedRecord.id === typedRecord
      ? getRunRecordLabel(pickedRecord)
      : typeof typedRecord === "string"
        ? typedRecord.trim()
        : "";

  return (
    <SideOver
      title={"Run Workflow"}
      description={RunModalCopy.description}
      onClose={props.onClose}
      submitButtonDisabled={component.nodeType === NodeType.PlaceholderNode}
      submitButtonText={RUN_WORKFLOW_SUBMIT_TITLE}
      onSubmit={() => {
        if (hasFormValidationErrors) {
          setShowFormValidationErrors(true);
        } else {
          setShowRunConfirmation(true);
        }
      }}
    >
      <>
        {props.isTestRun && (
          <div className="mt-3">
            <WorkflowRunPanelTestRunNote />
          </div>
        )}

        {showRunConfirmation && (
          <ConfirmModal
            title={RunModalCopy.confirmTitle}
            description={getRunConfirmDescription({
              translator: translator,
              recordTrigger: recordTrigger,
              record: recordName,
            })}
            onClose={() => {
              setShowRunConfirmation(false);
            }}
            submitButtonText={"Run"}
            onSubmit={() => {
              setShowRunConfirmation(false);

              /*
               * Sent the way the trigger receives its values for real: the
               * JSON typed into the panel as JSON (RunValues).
               */
              props.onRun({
                ...component,
                arguments: getRunValues(component),
              });
              props.onClose();
            }}
            submitButtonType={ButtonStyleType.PRIMARY}
          />
        )}

        {showFormValidationErrors && (
          <ConfirmModal
            title={`Please fix errors`}
            description={`There are some validation errors on the form. Please fix them before you run the workflow.`}
            submitButtonText={"Close"}
            onSubmit={() => {
              setShowFormValidationErrors(false);
            }}
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}

        {component.nodeType === NodeType.Node && (
          <RunForm
            component={component}
            workflowId={props.workflowId}
            loadRunRecords={props.loadRunRecords}
            onRunRecordChange={(record: RunRecordOption | null) => {
              setPickedRecord(record);
            }}
            onFormChange={(component: NodeDataProp) => {
              setComponent({ ...component });
            }}
            onHasFormValidationErrors={(value: boolean) => {
              setHasFormValidationErrors(value);
            }}
          />
        )}

        {component.nodeType === NodeType.PlaceholderNode && (
          <ErrorMessage message="No trigger added. Please add a trigger in order to run this workflow" />
        )}
      </>
    </SideOver>
  );
};

export default RunModal;
