import AppLink from "../AppLink/AppLink";
import { WORKFLOW_RUN_AS_PLACE } from "../Workflow/WorkflowRunAsCard";
import {
  CustomRoleDeleteWorkflows,
  CustomRoleDeleteWorkflowsCopy,
  NAMED_WORKFLOWS_LIMIT,
  WORKFLOWS_RUN_AS_DEFAULT_CHOICE,
  WorkflowRunningAsRole,
  getCustomRoleDeleteChoiceOptions,
  getCustomRoleDeleteMiscDataProps,
  loadCustomRoleDeleteWorkflows,
} from "./CustomRoleDeleteWorkflows";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { DeleteConfirmation } from "Common/UI/Components/ModelTable/BaseModelTable";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE WORKFLOWS A CUSTOM ROLE'S DELETE WOULD STOP (#9767), in its Delete
 * dialog, under the question: which workflows run as the role - each a link
 * to its Run As - that deleting it would stop them until someone changes
 * what they run as, and what they run as from now on. Default is picked to
 * begin with; the other roles offered are the ones the reader could give a
 * team. For a reader who may not edit workflows it says they can't delete
 * the role yet, and who can (`isBlocked`).
 */

// The id the choice's label names its picker by.
const CHOICE_INPUT_ID: string = "custom-role-delete-workflows-run-as";

// A workflow's Run As card: its Settings, opened at the card.
export const getWorkflowRunAsRoute: (workflowId: string) => Route = (
  workflowId: string,
): Route => {
  const settings: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.WORKFLOW_VIEW_SETTINGS] as Route,
    { modelId: workflowId },
  );

  return new Route(`${settings.toString()}#${WORKFLOW_RUN_AS_PLACE}`);
};

export interface ComponentProps {
  found: CustomRoleDeleteWorkflows;
  // The reader may not say what the workflows run as: no choice, only why.
  isBlocked?: boolean | undefined;
  // What they picked, as it changes: Default, or a role's id.
  onChoiceChange?: ((choice: string) => void) | undefined;
}

const CustomRoleDeleteWorkflowsChoice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [choice, setChoice] = useState<string>(WORKFLOWS_RUN_AS_DEFAULT_CHOICE);

  /*
   * Each opening of the dialog starts at Default, and says so: a choice
   * kept from an earlier opening is never what the delete sends.
   */
  useEffect(() => {
    props.onChoiceChange?.(WORKFLOWS_RUN_AS_DEFAULT_CHOICE);
  }, []);

  const workflows: Array<WorkflowRunningAsRole> = props.found.workflows;

  if (workflows.length === 0) {
    return <></>;
  }

  const named: Array<WorkflowRunningAsRole> = workflows.slice(
    0,
    NAMED_WORKFLOWS_LIMIT,
  );
  const more: number = workflows.length - named.length;
  const options: Array<DropdownOption> = getCustomRoleDeleteChoiceOptions(
    props.found.roles,
  );
  const picked: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === choice;
    },
  );

  return (
    <div className="space-y-3" data-testid="custom-role-delete-workflows">
      <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
        <p className="font-medium">
          {translator.translatePlural(
            CustomRoleDeleteWorkflowsCopy.heading,
            workflows.length,
          )}
        </p>
        <ul
          className="mt-2 space-y-1"
          data-testid="custom-role-delete-workflows-list"
        >
          {named.map((workflow: WorkflowRunningAsRole): ReactElement => {
            return (
              <li key={workflow.id} className="break-words">
                <AppLink
                  to={getWorkflowRunAsRoute(workflow.id)}
                  className="font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950"
                >
                  <IsolatedText text={workflow.name} />
                </AppLink>
              </li>
            );
          })}
          {more > 0 ? (
            <li className="text-amber-800">
              {translator.translatePlural(
                CustomRoleDeleteWorkflowsCopy.more,
                more,
              )}
            </li>
          ) : (
            <></>
          )}
        </ul>
        <p className="mt-2">
          {translator.translateText(
            props.isBlocked
              ? CustomRoleDeleteWorkflowsCopy.blocked
              : CustomRoleDeleteWorkflowsCopy.wouldStop,
          )}
        </p>
      </div>

      {props.isBlocked ? (
        <></>
      ) : (
        <div>
          <label
            htmlFor={CHOICE_INPUT_ID}
            className="block text-sm font-medium text-gray-900"
          >
            {translator.translateText(
              CustomRoleDeleteWorkflowsCopy.choiceLabel,
            )}
          </label>
          <div className="mt-1">
            <Dropdown
              inputId={CHOICE_INPUT_ID}
              dataTestId="custom-role-delete-workflows-run-as"
              options={options}
              value={picked}
              isClearable={false}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ): void => {
                const next: string = String(
                  value || WORKFLOWS_RUN_AS_DEFAULT_CHOICE,
                );
                setChoice(next);
                props.onChoiceChange?.(next);
              }}
            />
          </div>
          {props.found.roles.length > 0 ? (
            <p className="mt-1 text-sm text-gray-600">
              {translator.translateText(
                CustomRoleDeleteWorkflowsCopy.rolesHint,
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
      )}
    </div>
  );
};

/*
 * A list's Delete of a custom role (Teams > Settings > Roles), as the
 * shared table's dialog draws it: its question, then the workflows that
 * run as the role and what they run as instead, sent with the delete. A
 * reader who may not edit workflows is told why the role can't be deleted
 * yet, and offered only Close. A role no workflow they may read runs as is
 * asked about as before.
 */
export const getCustomRoleDeleteConfirmation: (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  // The dialog's question, with what deleting any custom role does.
  question: ReactElement;
}) => Promise<DeleteConfirmation> = async (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  question: ReactElement;
}): Promise<DeleteConfirmation> => {
  const found: CustomRoleDeleteWorkflows = await loadCustomRoleDeleteWorkflows({
    customRoleId: data.customRoleId,
    projectId: data.projectId,
  });

  if (found.workflows.length === 0) {
    return { description: data.question };
  }

  if (!found.canEditWorkflows) {
    return {
      description: (
        <CustomRoleDeleteWorkflowsChoice found={found} isBlocked={true} />
      ),
      isDeleteBlocked: true,
    };
  }

  // What the reader picks in the dialog, read as Delete is pressed.
  const choice: { current: string } = {
    current: WORKFLOWS_RUN_AS_DEFAULT_CHOICE,
  };

  return {
    description: data.question,
    details: (
      <CustomRoleDeleteWorkflowsChoice
        found={found}
        onChoiceChange={(next: string): void => {
          choice.current = next;
        }}
      />
    ),
    getMiscDataProps: (): JSONObject | undefined => {
      return getCustomRoleDeleteMiscDataProps(choice.current);
    },
  };
};

export default CustomRoleDeleteWorkflowsChoice;
