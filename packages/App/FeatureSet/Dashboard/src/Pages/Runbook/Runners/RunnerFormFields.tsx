import { isKubernetesAgentRunnerRow } from "../../Kubernetes/Utils/KubernetesAgentRunner";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import Runner from "Common/Models/DatabaseModels/Runner";
import { KUBERNETES_AGENT_RUNNER_NAME_PREFIX } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import Field from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/*
 * The Runner create / edit form, shared by the Runner list and the Runner
 * detail page - both walk the same two steps - and what it leaves out on
 * a Runner the Kubernetes agent chart installed.
 *
 * RunnerService refuses, for any non-root write:
 * - renaming a row whose name carries the "kubernetes-agent/" marker, and
 *   naming any row into that prefix (both case-insensitively);
 * - turning on "Runs Runbooks" or "Runs AI Code Fixes" on a kubernetes-
 *   agent row — by name marker OR agent posture
 *   (RunnerService.isKubernetesAgentRunnerRow).
 * A form that posted those fields would only ever be refused, so on such a
 * row they are not in the form at all — nothing is posted for them — and
 * the form says why in one line. The rest (description, "Runs AI
 * Remediation Commands", labels) stays editable. Import-clean: no RouteMap
 * or Navigation, so it can be tested without a browser.
 */

// What the form reads off the row it edits.
export interface RunnerFormRow {
  name?: unknown;
  hostInfo?: unknown;
}

// What the form leaves out for the row it edits.
export interface RunnerFormRestrictions {
  // The name carries the kubernetes-agent marker: renaming is refused.
  isNameLocked: boolean;
  // A kubernetes-agent row: "Runs Runbooks" / "Runs AI Code Fixes" are refused.
  areShellCapabilitiesLocked: boolean;
}

export const NO_RUNNER_FORM_RESTRICTIONS: RunnerFormRestrictions = {
  isNameLocked: false,
  areShellCapabilitiesLocked: false,
};

export function getRunnerFormRestrictions(
  row: RunnerFormRow | null | undefined,
): RunnerFormRestrictions {
  if (!row) {
    return NO_RUNNER_FORM_RESTRICTIONS;
  }

  return {
    isNameLocked: isKubernetesAgentRunnerRow({ name: row.name }),
    areShellCapabilitiesLocked: isKubernetesAgentRunnerRow(row),
  };
}

/*
 * The chart no longer installs this Runner: the Kubernetes AI agent (its
 * own identity, never a Runner row) replaced it, and the server refuses the
 * legacy Runner's registration while that agent is online. Said on every
 * kubernetes-agent row so an operator knows the row is on its way out and
 * what retires it.
 */
export const KUBERNETES_AGENT_RUNNER_SUPERSEDED_NOTE: string =
  "It is superseded by the Kubernetes AI agent — upgrade the Kubernetes agent chart; this Runner can be deleted once the AI agent is connected.";

/*
 * The note the form shows on a kubernetes-agent row: what it is, exactly
 * what it left out, and that the Kubernetes AI agent supersedes it. Null
 * when nothing is left out.
 */
export function getKubernetesAgentRunnerFormNote(
  restrictions: RunnerFormRestrictions,
): string | null {
  const locked: Array<string> = [];

  if (restrictions.isNameLocked) {
    locked.push("renamed");
  }

  if (restrictions.areShellCapabilitiesLocked) {
    locked.push("given “Runs Runbooks” or “Runs AI Code Fixes”");
  }

  if (locked.length === 0) {
    return null;
  }

  return `This is the in-cluster Runner the Kubernetes agent chart installed. It runs kubectl for its own cluster only, so it cannot be ${locked.join(
    " or ",
  )} — OneUptime refuses those changes, so they are not offered here. ${KUBERNETES_AGENT_RUNNER_SUPERSEDED_NOTE}`;
}

/*
 * Why a Runner name cannot be saved, or null. The "kubernetes-agent/"
 * prefix is reserved for the Runners the chart registers (compared
 * case-insensitively, as the server compares it): a Runner created or
 * renamed into it would be adopted by the next registration for that
 * cluster name, so RunnerService refuses it.
 */
export function getReservedRunnerNameError(name: unknown): string | null {
  if (!isKubernetesAgentRunnerRow({ name })) {
    return null;
  }

  return `Runner names starting with "${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/" are reserved for the in-cluster Runners the Kubernetes agent chart registers. Choose another name.`;
}

/*
 * The form's steps, on the list and on the detail page. Every one of them
 * keeps a field on an agent row too: the description and the labels (folded
 * under Advanced on Runner), and Runs AI Remediation Commands, are never
 * left out.
 */
export const RUNNER_FORM_STEPS: Array<FormStep<Runner>> = [
  { title: "Runner", id: "runner" },
  { title: "Capabilities", id: "capabilities" },
];

export interface RunnerFormFieldOptions {
  // Put the fields on RUNNER_FORM_STEPS (runner, capabilities).
  withSteps: boolean;
  restrictions: RunnerFormRestrictions;
}

export function getRunnerFormFields(
  options: RunnerFormFieldOptions,
): Fields<Runner> {
  const note: string | null = getKubernetesAgentRunnerFormNote(
    options.restrictions,
  );

  function onStep(stepId: string): { stepId?: string | undefined } {
    return options.withSteps ? { stepId } : {};
  }

  const fields: Fields<Runner> = [];

  if (!options.restrictions.isNameLocked) {
    fields.push({
      field: { name: true },
      title: "Name",
      ...onStep("runner"),
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "prod-eu-runner",
      validation: { minLength: 2 },
      customValidation: (values: FormValues<Runner>): string | null => {
        return getReservedRunnerNameError(values.name);
      },
    });
  }

  const description: Field<Runner> = {
    field: { description: true },
    title: "Description",
    ...onStep("runner"),
    fieldType: FormFieldSchemaType.LongText,
    required: false,
    placeholder:
      "Runs inside the production EU cluster. Can reach internal services.",
  };

  if (note) {
    description.sectionTitle = "In-cluster Runner (Kubernetes agent)";
    description.sectionDescription = note;
  }

  fields.push(description);

  if (!options.restrictions.areShellCapabilitiesLocked) {
    fields.push(
      {
        field: { canRunRunbooks: true },
        title: "Runs Runbooks",
        ...onStep("capabilities"),
        description:
          "Let this Runner execute runbook Bash and JavaScript steps on the host it runs on. On by default — this is why most Runners are installed.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        defaultValue: true,
      },
      {
        field: { canRunCodeFixTasks: true },
        title: "Runs AI Code Fixes",
        ...onStep("capabilities"),
        description:
          "Let this Runner work in the code repositories connected to this project and open pull requests for review. Off by default; it needs a connected repository. The Runner picks this up on its next heartbeat — no restart needed.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        defaultValue: false,
      },
    );
  }

  fields.push(
    {
      field: { canRunAiCommands: true },
      title: "Runs AI Remediation Commands",
      ...onStep("capabilities"),
      description:
        "Let AI auto-remediation execute policy-checked commands on this Runner. Off by default — commands either match the rule's allowlist or wait for one-click human approval, and destructive commands are always refused. Takes effect on the Runner's next heartbeat, no restart needed.",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: false,
    },
    /*
     * On the Runner step, folded under Advanced after the description: the
     * last of that step's fields, as the capabilities follow on a step of
     * their own.
     */
    getLabelsFormField<Runner>(onStep("runner")),
  );

  return fields;
}

/*
 * The list page's form, which only creates: a Runner is edited in one
 * place, the Runner Details card on its own page (RunnerView), where the
 * form follows the row being edited. A new row is never an agent row, and
 * the name check refuses the reserved prefix, so this form is never
 * restricted.
 */
export function getRunnerCreateFormFields(): Fields<Runner> {
  return getRunnerFormFields({
    withSteps: true,
    restrictions: NO_RUNNER_FORM_RESTRICTIONS,
  });
}
