import { ButtonStyleType } from "../Button/Button";
import EmptyState from "../EmptyState/EmptyState";
import ConfirmModal from "../Modal/ConfirmModal";
import SideOver from "../SideOver/SideOver";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import RunForm, { RUN_WORKFLOW_SUBMIT_TITLE, RunFormHandle } from "./RunForm";
import { getRunRecordLabel } from "./RunRecordField";
import { LoadRunRecordsFunction } from "./RunRecordSource";
import { getRunValues } from "./RunValues";
import { WORKFLOW_ADD_TRIGGER_TITLE } from "./WorkflowAddButton";
import { WorkflowRunPanelTestRunNote } from "./WorkflowTestRun";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { NodeDataProp, NodeType } from "../../../Types/Workflow/Component";
import {
  RUN_RECORD_ARGUMENT_ID,
  RunRecordEvent,
  RunRecordOption,
  RunRecordTriggerInfo,
  getRunRecordTriggerInfo,
  withRunRecordEvent,
} from "../../../Types/Workflow/RunRecord";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

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
  readonly noTriggerTitle: string;
  readonly noTriggerDescription: string;
  readonly noTriggerViewOnlyDescription: string;
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
  /*
   * Run Workflow on a workflow with no trigger. A run starts from the
   * trigger, so the panel has nothing to run: it says so and offers the
   * one thing to do, Add Trigger, which opens the panel the toolbar's
   * button and the dashed card open. It used to show a red "No trigger
   * added. Please add a trigger in order to run this workflow" over a
   * disabled Run button. Someone who may not change the workflow is told
   * whom to ask instead. The panel's own description - start a run "from
   * the trigger, with the values you choose" - is left out while there is
   * no trigger: the empty state says what a run starts from.
   */
  noTriggerTitle: translationKey("This workflow has no trigger yet"),
  noTriggerDescription: translationKey(
    "A run starts from the workflow's trigger. Add one, then run the workflow from here.",
  ),
  noTriggerViewOnlyDescription: translationKey(
    "A run starts from the workflow's trigger. Ask someone who can edit this workflow to add one.",
  ),
};

type GetConfirmTemplateFunction = (
  recordTrigger: RunRecordTriggerInfo | null,
  // The record picked, or what was typed for it.
  record: string,
) => string;

/*
 * The sentence the confirmation says: the one that names the record, by what
 * the trigger makes of it, or the plain one when there is no record to name.
 */
export const getRunConfirmTemplate: GetConfirmTemplateFunction = (
  recordTrigger: RunRecordTriggerInfo | null,
  record: string,
): string => {
  if (!recordTrigger || !record) {
    return RunModalCopy.confirmRunsForReal;
  }

  /*
   * On Create or Update says what its What Happened asks
   * (RunRecord.withRunRecordEvent): created until it is asked.
   */
  return recordTrigger.event === RunRecordEvent.Deleted
    ? RunModalCopy.confirmDeleted
    : recordTrigger.event === RunRecordEvent.Updated
      ? RunModalCopy.confirmUpdated
      : RunModalCopy.confirmCreated;
};

type GetConfirmDescriptionFunction = (data: {
  translator: Translator;
  recordTrigger: RunRecordTriggerInfo | null;
  // The record picked, or what was typed for it.
  record: string;
}) => string;

/** What the confirmation says the run does, as text. */
export const getRunConfirmDescription: GetConfirmDescriptionFunction = (data: {
  translator: Translator;
  recordTrigger: RunRecordTriggerInfo | null;
  record: string;
}): string => {
  return data.translator.translateTemplate(
    getRunConfirmTemplate(data.recordTrigger, data.record),
    { record: data.record },
  );
};

export interface RunConfirmDescriptionProps {
  recordTrigger: RunRecordTriggerInfo | null;
  // The record picked, or what was typed for it.
  record: string;
}

/*
 * The same sentence as the confirmation draws it, with the record standing
 * out. A record's name is a sentence of its own - "INC-8 · Database is down"
 * - and set in the same weight as the words around it the two ran together:
 * "It runs as if INC-8 · Database is down had just been updated." read as
 * though the database had been updated. In bold, where the name starts and
 * ends is seen before it is read, however long the name is.
 */
export const RunConfirmDescription: FunctionComponent<
  RunConfirmDescriptionProps
> = (props: RunConfirmDescriptionProps): ReactElement => {
  const translator: Translator = useTranslator();

  // No record to name: the plain sentence, which has no slot to fill.
  if (!props.recordTrigger || !props.record) {
    return (
      <>
        {getRunConfirmDescription({
          translator: translator,
          recordTrigger: props.recordTrigger,
          record: props.record,
        })}
      </>
    );
  }

  return (
    <TranslatedSentence
      template={getRunConfirmTemplate(props.recordTrigger, props.record)}
      slots={{
        record: (
          <strong
            className="font-semibold text-gray-900"
            data-testid="run-confirm-record"
          >
            {props.record}
          </strong>
        ),
      }}
    />
  );
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
  /*
   * Opens the Add Trigger panel, for a workflow with no trigger yet. Left
   * out for someone who may not change the workflow: the panel then says
   * who adds the trigger, and offers nothing.
   */
  onAddTrigger?: (() => void) | undefined;
}

const RunModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [component, setComponent] = useState<NodeDataProp>(props.trigger);
  const [hasFormValidationErrors, setHasFormValidationErrors] =
    useState<boolean>(false);
  const [showRunConfirmation, setShowRunConfirmation] =
    useState<boolean>(false);
  const [pickedRecord, setPickedRecord] = useState<RunRecordOption | null>(
    null,
  );

  const runFormRef: React.MutableRefObject<RunFormHandle | null> =
    useRef<RunFormHandle | null>(null);

  /*
   * What the run is for: On Create or Update's is whichever the panel's
   * What Happened asks, so the confirmation says created or updated.
   */
  const triggerInfo: RunRecordTriggerInfo | null = props.workflowId
    ? getRunRecordTriggerInfo(component.metadata)
    : null;
  const recordTrigger: RunRecordTriggerInfo | null = triggerInfo
    ? withRunRecordEvent(triggerInfo, component.arguments)
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

  /*
   * No trigger yet: nothing to run, so no run form and no Run Workflow. The
   * panel's one action is then Add Trigger - the footer's own button, the
   * one primary a dialog has - for someone who may add one; anyone else
   * gets Close alone.
   */
  const hasNoTrigger: boolean = component.nodeType === NodeType.PlaceholderNode;

  return (
    <SideOver
      title={"Run Workflow"}
      description={hasNoTrigger ? "" : RunModalCopy.description}
      onClose={props.onClose}
      submitButtonText={
        hasNoTrigger ? WORKFLOW_ADD_TRIGGER_TITLE : RUN_WORKFLOW_SUBMIT_TITLE
      }
      onSubmit={
        hasNoTrigger
          ? props.onAddTrigger
            ? () => {
                props.onAddTrigger?.();
              }
            : undefined
          : () => {
              if (hasFormValidationErrors) {
                /*
                 * Said where it is missing: each field shows its message and the
                 * first one gets the focus. A dialog used to say "Please fix
                 * errors" over a form that showed none.
                 */
                runFormRef.current?.showErrors();
              } else {
                setShowRunConfirmation(true);
              }
            }
      }
    >
      <>
        {/*
         * A test run is what a run would be while the workflow is off - said
         * only once there is a trigger to run from.
         */}
        {props.isTestRun && !hasNoTrigger && (
          <div className="mt-3">
            <WorkflowRunPanelTestRunNote />
          </div>
        )}

        {showRunConfirmation && (
          <ConfirmModal
            title={RunModalCopy.confirmTitle}
            description={
              <RunConfirmDescription
                recordTrigger={recordTrigger}
                record={recordName}
              />
            }
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

        {component.nodeType === NodeType.Node && (
          <RunForm
            ref={runFormRef}
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

        {hasNoTrigger && (
          <div data-testid="run-workflow-no-trigger">
            <EmptyState
              id="run-workflow-no-trigger"
              icon={IconProp.Bolt}
              title={RunModalCopy.noTriggerTitle}
              description={
                props.onAddTrigger
                  ? RunModalCopy.noTriggerDescription
                  : RunModalCopy.noTriggerViewOnlyDescription
              }
              paddingClassName="pt-10 pb-6"
            />
          </div>
        )}
      </>
    </SideOver>
  );
};

export default RunModal;
