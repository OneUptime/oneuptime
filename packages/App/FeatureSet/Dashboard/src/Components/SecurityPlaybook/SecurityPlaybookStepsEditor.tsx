import SecurityPlaybookStepDialog, {
  PlaybookConnectionOption,
} from "./SecurityPlaybookStepDialog";
import {
  describeRunIf,
  getStepDeleteBlock,
  getStepMoveBlock,
  moveStep,
} from "./SecurityPlaybookStepForm";
import {
  StepNameLookup,
  summarizeSecurityPlaybookStep,
} from "./SecurityPlaybookStepSummary";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityPlaybookActionDefinition,
  getSecurityPlaybookAction,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  SECURITY_PLAYBOOK_MAX_STEPS,
  SecurityPlaybookStep,
  assertSecurityPlaybookStepConditions,
  doesStepNeedApproval,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { SecurityCaseValueLists } from "../SecurityCase/SecurityCaseValues";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  steps: Array<SecurityPlaybookStep>;
  lookup: StepNameLookup;
  connections: Array<PlaybookConnectionOption>;
  // The project's case priorities and statuses, which the case steps set.
  caseValues: SecurityCaseValueLists;
  canEdit: boolean;
  disabledReason?: string | undefined;
  // Saves the whole list; throws the server's message when it is refused.
  onSave: (steps: Array<SecurityPlaybookStep>) => Promise<void>;
}

type StepDialog =
  | { kind: "add" }
  | { kind: "edit"; index: number }
  | { kind: "delete"; index: number }
  | null;

const Flag: FunctionComponent<{
  icon: IconProp;
  text: string;
  // Words already in the reader's language, put together from translated parts.
  isTranslated?: boolean | undefined;
  dataTestId?: string | undefined;
}> = (props: {
  icon: IconProp;
  text: string;
  isTranslated?: boolean | undefined;
  dataTestId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600"
      data-testid={props.dataTestId}
    >
      <Icon icon={props.icon} className="h-3 w-3 flex-shrink-0" />
      {props.isTranslated ? props.text : translator.translateText(props.text)}
    </span>
  );
};

/*
 * The whole list as it would be saved, held to the branching rule first: a
 * step that waits on another waits only on one before it, on a result it
 * can have. The server holds it to the same rule.
 */
function checkConditions(steps: Array<SecurityPlaybookStep>): void {
  assertSecurityPlaybookStepConditions(steps);
}

/*
 * A playbook's steps, in the order they run, as a column of cards joined by
 * a line - the run goes down it. Each step can be changed, moved, or
 * removed; every change saves the whole list, which the server checks as it
 * saves (a step that names a channel of nothing, a connection of another
 * product).
 */
const SecurityPlaybookStepsEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [dialog, setDialog] = useState<StepDialog>(null);
  const [error, setError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const save: (steps: Array<SecurityPlaybookStep>) => Promise<void> = async (
    steps: Array<SecurityPlaybookStep>,
  ): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      checkConditions(steps);
      await props.onSave(steps);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setIsSaving(false);
  };

  const isFull: boolean = props.steps.length >= SECURITY_PLAYBOOK_MAX_STEPS;

  return (
    <Card
      title="Steps"
      description="What the playbook does, top to bottom. Each step runs once the one before it is done; a step that needs approval waits on the case until someone approves it."
      buttons={[
        {
          title: "Add Step",
          phoneTitle: "Add",
          icon: IconProp.Add,
          buttonStyle: ButtonStyleType.NORMAL,
          disabled: !props.canEdit || isFull || isSaving,
          tooltip: !props.canEdit
            ? props.disabledReason
            : isFull
              ? translator.translateText("A playbook has at most 25 steps.")
              : undefined,
          onClick: () => {
            setError("");
            setDialog({ kind: "add" });
          },
        },
      ]}
    >
      <div>
        {error ? (
          <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : (
          <></>
        )}

        {props.steps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center">
            <Icon
              icon={IconProp.Bolt}
              className="mx-auto h-6 w-6 text-gray-400"
            />
            <p className="mt-2 text-sm font-medium text-gray-900">
              {translator.translateText("This playbook has no steps yet.")}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {translator.translateText(
                "Add what should happen to a case: assign it, check its entities against threat intel, tell a channel, page on-call, or contain a host.",
              )}
            </p>
            <div className="mt-4 flex justify-center">
              <Button
                title="Add the First Step"
                icon={IconProp.Add}
                buttonStyle={ButtonStyleType.PRIMARY}
                disabled={!props.canEdit}
                tooltip={props.canEdit ? undefined : props.disabledReason}
                onClick={() => {
                  setDialog({ kind: "add" });
                }}
              />
            </div>
          </div>
        ) : (
          <ol className="relative">
            {props.steps.map(
              (step: SecurityPlaybookStep, index: number): ReactElement => {
                const definition: SecurityPlaybookActionDefinition | undefined =
                  getSecurityPlaybookAction(step.action);
                const summary: string = summarizeSecurityPlaybookStep(
                  step,
                  props.lookup,
                  translator,
                );
                const isLast: boolean = index === props.steps.length - 1;
                const needsApproval: boolean = doesStepNeedApproval(step);
                // A containment step a Security Admin let run without approval.
                const runsUnapproved: boolean = Boolean(
                  definition?.isDisruptive && !needsApproval,
                );
                // When it runs, if not always: "Only if step 1 found a known-bad entity".
                const runIf: string = describeRunIf({
                  step,
                  steps: props.steps,
                  translator,
                });
                const moveUpBlock: string | undefined = getStepMoveBlock({
                  steps: props.steps,
                  index,
                  direction: -1,
                  translator,
                });
                const moveDownBlock: string | undefined = getStepMoveBlock({
                  steps: props.steps,
                  index,
                  direction: 1,
                  translator,
                });
                const deleteBlock: string | undefined = getStepDeleteBlock({
                  steps: props.steps,
                  index,
                  translator,
                });

                return (
                  <li
                    key={step.id}
                    className="relative flex gap-4 pb-4 last:pb-0"
                    data-testid={`security-playbook-step-${index}`}
                  >
                    {!isLast ? (
                      <span
                        className="absolute left-[17px] top-10 h-[calc(100%-2.5rem)] w-px bg-gray-200"
                        aria-hidden="true"
                      />
                    ) : (
                      <></>
                    )}
                    <span className="relative z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600">
                      <Icon
                        icon={definition?.icon || IconProp.Circle}
                        className="h-4 w-4"
                      />
                    </span>
                    <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900">
                            <span className="mr-1.5 text-gray-400">
                              {index + 1}.
                            </span>
                            {translator.translateText(
                              definition?.title || step.action,
                            )}
                          </p>
                          {summary ? (
                            <p className="mt-0.5 truncate text-sm text-gray-600">
                              {summary}
                            </p>
                          ) : (
                            <></>
                          )}
                          {needsApproval ||
                          runsUnapproved ||
                          runIf ||
                          step.continueOnFailure ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {runIf ? (
                                <Flag
                                  icon={IconProp.Condition}
                                  text={runIf}
                                  isTranslated={true}
                                  dataTestId={`security-playbook-step-${index}-run-if`}
                                />
                              ) : (
                                <></>
                              )}
                              {needsApproval ? (
                                <Flag
                                  icon={IconProp.Lock}
                                  text="Needs approval"
                                />
                              ) : (
                                <></>
                              )}
                              {runsUnapproved ? (
                                <Flag
                                  icon={IconProp.LockOpen}
                                  text="Runs without approval"
                                />
                              ) : (
                                <></>
                              )}
                              {step.continueOnFailure ? (
                                <Flag
                                  icon={IconProp.ChevronRight}
                                  text="Carries on if it fails"
                                />
                              ) : (
                                <></>
                              )}
                            </div>
                          ) : (
                            <></>
                          )}
                        </div>
                        <MoreMenu
                          ariaLabel={translator.translateTemplate(
                            "Step {{number}} actions",
                            { number: index + 1 },
                          )}
                          isDisabled={!props.canEdit || isSaving}
                        >
                          {[
                            <MoreMenuItem
                              key="edit"
                              icon={IconProp.Edit}
                              text="Edit Step"
                              onClick={() => {
                                setError("");
                                setDialog({ kind: "edit", index });
                              }}
                            />,
                            <MoreMenuItem
                              key="up"
                              icon={IconProp.ChevronUp}
                              text="Move Up"
                              isDisabled={index === 0 || Boolean(moveUpBlock)}
                              tooltip={moveUpBlock}
                              onClick={() => {
                                void save(moveStep(props.steps, index, -1));
                              }}
                            />,
                            <MoreMenuItem
                              key="down"
                              icon={IconProp.ChevronDown}
                              text="Move Down"
                              isDisabled={isLast || Boolean(moveDownBlock)}
                              tooltip={moveDownBlock}
                              onClick={() => {
                                void save(moveStep(props.steps, index, 1));
                              }}
                            />,
                            <MoreMenuItem
                              key="delete"
                              icon={IconProp.Trash}
                              text="Delete Step"
                              isDestructive={true}
                              isDisabled={Boolean(deleteBlock)}
                              tooltip={deleteBlock}
                              onClick={() => {
                                setDialog({ kind: "delete", index });
                              }}
                            />,
                          ]}
                        </MoreMenu>
                      </div>
                    </div>
                  </li>
                );
              },
            )}
          </ol>
        )}
      </div>

      {dialog && (dialog.kind === "add" || dialog.kind === "edit") ? (
        <SecurityPlaybookStepDialog
          step={dialog.kind === "edit" ? props.steps[dialog.index] : undefined}
          index={dialog.kind === "edit" ? dialog.index : props.steps.length}
          earlierSteps={
            dialog.kind === "edit"
              ? props.steps.slice(0, dialog.index)
              : props.steps
          }
          connections={props.connections}
          caseValues={props.caseValues}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={async (step: SecurityPlaybookStep) => {
            const steps: Array<SecurityPlaybookStep> =
              dialog.kind === "edit"
                ? props.steps.map(
                    (existing: SecurityPlaybookStep, index: number) => {
                      return index === dialog.index ? step : existing;
                    },
                  )
                : [...props.steps, step];

            // Thrown to the dialog, which shows the reason and stays open.
            checkConditions(steps);
            await props.onSave(steps);
            setDialog(null);
          }}
        />
      ) : (
        <></>
      )}

      {dialog && dialog.kind === "delete" ? (
        <ConfirmModal
          title="Delete Step"
          description={translator.translateTemplate(
            "Step {{number}} ({{title}}) is removed from the playbook. Runs already under way keep the steps they started with.",
            {
              number: dialog.index + 1,
              title:
                translator.translateText(
                  getSecurityPlaybookAction(props.steps[dialog.index]?.action)
                    ?.title || "",
                ) || "",
            },
          )}
          submitButtonText="Delete Step"
          submitButtonType={ButtonStyleType.DANGER}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={() => {
            const index: number = dialog.index;
            setDialog(null);
            void save(
              props.steps.filter(
                (_step: SecurityPlaybookStep, stepIndex: number): boolean => {
                  return stepIndex !== index;
                },
              ),
            );
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default SecurityPlaybookStepsEditor;
