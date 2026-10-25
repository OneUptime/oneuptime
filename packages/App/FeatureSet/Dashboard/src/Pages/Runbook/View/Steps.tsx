import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import CodeType from "Common/Types/Code/CodeType";
import Navigation from "Common/UI/Utils/Navigation";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import RunnerPicker from "../../../Components/Runner/RunnerPicker";
import RunbookVariablePicker from "../../../Components/Runbook/Steps/RunbookVariablePicker";
import RunbookVariableChips from "../../../Components/Runbook/Steps/RunbookVariableChips";
import SshTargetInput from "../../../Components/Runbook/Steps/SshTargetInput";
import UnknownVariablesNote from "../../../Components/Runbook/Steps/UnknownVariablesNote";
import RunbookVariableChoicesLoader, {
  NO_RUNBOOK_VARIABLE_CHOICES,
  RunbookVariableChoices,
  getUnknownVariableReferences,
} from "../../../Components/Runbook/Steps/RunbookVariableChoices";
import {
  CONTINUE_ON_FAILURE_DESCRIPTION,
  CONTINUE_ON_FAILURE_TITLE,
  HTTP_HEADERS_TITLE,
  KUBECONFIG_TITLE,
  KUBECTL_EXAMPLES,
  LEGACY_KUBERNETES_STEP_NOTICE,
  LEGACY_SSH_STEP_NOTICE,
  MANUAL_INSTRUCTIONS_TITLE,
  NEEDS_APPROVAL_LABEL,
  NO_LONGER_RUNS_LABEL,
  NO_PASSPHRASE_LABEL,
  REQUIRE_APPROVAL_DESCRIPTION,
  REQUIRE_APPROVAL_TITLE,
  RUNNER_OWN_KUBECONFIG_LABEL,
  SSH_EXAMPLES,
  SSH_PASSPHRASE_TITLE,
  SSH_TARGET_HELP,
  SSH_PORT_TITLE,
  SSH_SIGN_IN_TITLE,
  ScriptExample,
  SshTarget,
  applyStepConfigChange,
  convertLegacyCredentialStep,
  formatSshTarget,
  getFirstCommand,
  getStepMoreFieldsItems,
  isHttpBodyShown,
  isLegacyCredentialStep,
  isRunnerStep,
  readStepsForEditor,
  setStepRequiresApproval,
} from "../../../Components/Runbook/Steps/RunbookStepEditorModel";
import { stepRequiresApprovalBeforeRunning } from "Common/Types/Runbook/RunbookStepApproval";
import RunnerChoicesLoader, {
  RunnerChoices,
} from "../../../Components/Runner/RunnerChoices";
import {
  RunnerPickerModel,
  RunnerPickerOutcome,
  RunnerSummary,
  buildRunnerPickerModel,
  getRunnerSummary,
} from "../../../Components/Runner/RunnerPickerModel";
import {
  getRunnerLiveStatusLabel,
  RunnerLiveStatus,
} from "Common/Types/Runner/RunnerLiveStatus";
import useTranslateValue, {
  UseTranslateValueResult,
} from "Common/UI/Utils/Translation";
import useRefreshRunnerChoicesOnFocus from "../../../Components/Runner/useRefreshRunnerChoicesOnFocus";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import {
  AIStepConfig,
  BashStepConfig,
  HttpRequestMethod,
  HttpRequestStepConfig,
  JavaScriptStepConfig,
  KubernetesStepConfig,
  RunbookStep,
  SSHStepConfig,
} from "Common/Types/Runbook/RunbookStep";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import StepTimeoutInput from "Common/UI/Components/Runbook/StepTimeoutInput";
import {
  AGENT_CLAIM_TIMEOUT_BOUNDS,
  STEP_EXECUTION_TIMEOUT_BOUNDS,
  TimeoutBounds,
} from "Common/Types/Runbook/RunbookStepTimeout";
import { GLOBAL_RUNNER_STEP_EXECUTION_TIMEOUT_BOUNDS } from "Common/Types/Runner/GlobalRunnerWork";
import UUID from "Common/Utils/UUID";
import { useAsyncEffect } from "use-async-effect";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  Droppable,
  DroppableProvided,
  DropResult,
} from "react-beautiful-dnd";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { useUnsavedChanges } from "Common/UI/Utils/NewVersion/UnsavedChanges";
import {
  composedValue,
  TemplateValue,
  translateTemplate,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

/*
 * The timeout fields shared by every step that is dispatched to a Runner.
 */
interface RunnerExecutedStepTimeouts {
  timeoutInMs?: number | undefined;
  claimTimeoutInMs?: number | undefined;
}

/*
 * A provider an AI step can be pinned to. Mirrors the non-secret shape that
 * POST /ai-chat/providers returns — the project's own providers plus the
 * global ones, which is exactly the set the server will accept on a run.
 */
interface LlmProviderOption {
  id: string;
  name: string;
  llmType: string | null;
  modelName: string | null;
  isDefault: boolean;
}

// The empty value stands for "no pin" — use whatever the project defaults to.
const PROJECT_DEFAULT_PROVIDER_VALUE: string = "";

const HTTP_METHODS: HttpRequestMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
];

const HTTP_METHOD_OPTIONS: Array<DropdownOption> = HTTP_METHODS.map(
  (m: HttpRequestMethod) => {
    return { value: m, label: m };
  },
);

interface StepTypeMeta {
  type: RunbookStepType;
  label: string;
  shortLabel: string;
  description: string;
  icon: IconProp;
  // Tailwind classes (background tint + ring + icon color).
  bg: string;
  ring: string;
  iconColor: string;
  numberBg: string;
  borderL: string;
}

const STEP_TYPE_META: Record<RunbookStepType, StepTypeMeta> = {
  [RunbookStepType.Manual]: {
    type: RunbookStepType.Manual,
    label: "Manual checklist step",
    shortLabel: "Manual",
    description: "Pause the run and wait for someone to tick it off.",
    icon: IconProp.Check,
    bg: "bg-indigo-50",
    ring: "ring-indigo-100",
    iconColor: "text-indigo-600",
    numberBg: "bg-indigo-600",
    borderL: "border-l-indigo-500",
  },
  [RunbookStepType.JavaScript]: {
    type: RunbookStepType.JavaScript,
    label: "JavaScript",
    shortLabel: "JavaScript",
    description: "Run JavaScript in a sandbox and use what it returns.",
    icon: IconProp.Code,
    bg: "bg-amber-50",
    ring: "ring-amber-100",
    iconColor: "text-amber-600",
    numberBg: "bg-amber-500",
    borderL: "border-l-amber-500",
  },
  [RunbookStepType.HttpRequest]: {
    type: RunbookStepType.HttpRequest,
    label: "HTTP request",
    shortLabel: "HTTP",
    description: "Call an external API — PagerDuty, Slack, your own service.",
    icon: IconProp.Globe,
    bg: "bg-sky-50",
    ring: "ring-sky-100",
    iconColor: "text-sky-600",
    numberBg: "bg-sky-600",
    borderL: "border-l-sky-500",
  },
  [RunbookStepType.Bash]: {
    type: RunbookStepType.Bash,
    label: "Bash script",
    shortLabel: "Bash",
    description: "Run a shell command on one of your Runners.",
    icon: IconProp.Terminal,
    bg: "bg-slate-50",
    ring: "ring-slate-200",
    iconColor: "text-slate-600",
    numberBg: "bg-slate-700",
    borderL: "border-l-slate-500",
  },
  [RunbookStepType.SSH]: {
    type: RunbookStepType.SSH,
    label: "SSH script",
    shortLabel: "SSH",
    description: "Sign in to a machine and run a bash script there.",
    icon: IconProp.Terminal,
    bg: "bg-emerald-50",
    ring: "ring-emerald-100",
    iconColor: "text-emerald-600",
    numberBg: "bg-emerald-600",
    borderL: "border-l-emerald-500",
  },
  /*
   * A kubectl script: the step type keeps its stored name, Kubernetes. It
   * used to restart or scale one workload from two dropdowns; it takes the
   * kubectl commands themselves now.
   */
  [RunbookStepType.Kubernetes]: {
    type: RunbookStepType.Kubernetes,
    label: "kubectl script",
    shortLabel: "kubectl",
    description: "Run kubectl commands against a cluster.",
    icon: IconProp.Cube,
    bg: "bg-blue-50",
    ring: "ring-blue-100",
    iconColor: "text-blue-600",
    numberBg: "bg-blue-600",
    borderL: "border-l-blue-500",
  },
  [RunbookStepType.AI]: {
    type: RunbookStepType.AI,
    label: "AI step",
    shortLabel: "AI",
    description:
      "Ask AI to analyze, summarize or decide — using the trigger and earlier step results.",
    icon: IconProp.Sparkles,
    bg: "bg-violet-50",
    ring: "ring-violet-100",
    iconColor: "text-violet-600",
    numberBg: "bg-violet-600",
    borderL: "border-l-violet-500",
  },
  /*
   * Only OneUptime AI composes kubectl steps (investigations and
   * remediations on a cluster's AI page); they are not authored in runbooks,
   * so this entry renders one that already exists and is never offered by
   * the step picker (see ALL_STEP_TYPES).
   */
  [RunbookStepType.Kubectl]: {
    type: RunbookStepType.Kubectl,
    label: "kubectl command",
    shortLabel: "kubectl",
    description:
      "A single kubectl command OneUptime AI composed for a cluster. Not authored in runbooks.",
    icon: IconProp.Cube,
    bg: "bg-cyan-50",
    ring: "ring-cyan-100",
    iconColor: "text-cyan-600",
    numberBg: "bg-cyan-600",
    borderL: "border-l-cyan-500",
  },
  /*
   * Same for a command OneUptime AI composed for an infrastructure
   * resource's AI agent (Docker, Proxmox, VMware, Ceph, a database, a
   * host): rendered when one exists, never offered by the step picker.
   */
  [RunbookStepType.ResourceCommand]: {
    type: RunbookStepType.ResourceCommand,
    label: "Resource command",
    shortLabel: "AI agent",
    description:
      "A single command OneUptime AI composed for an infrastructure resource's AI agent. Not authored in runbooks.",
    icon: IconProp.Server,
    bg: "bg-teal-50",
    ring: "ring-teal-100",
    iconColor: "text-teal-600",
    numberBg: "bg-teal-600",
    borderL: "border-l-teal-500",
  },
};

/*
 * The step types a runbook author may add. Kubectl and ResourceCommand are
 * deliberately absent: only OneUptime AI composes them.
 */
const ALL_STEP_TYPES: RunbookStepType[] = [
  RunbookStepType.Manual,
  RunbookStepType.JavaScript,
  RunbookStepType.HttpRequest,
  RunbookStepType.Bash,
  RunbookStepType.SSH,
  RunbookStepType.Kubernetes,
  RunbookStepType.AI,
];

/*
 * JavaScript runs inside an isolated-vm sandbox on the step's Runner.
 * No fs / network / process access — pure compute only. Use console.log()
 * and `return value` to surface results on the execution.
 */
const JAVASCRIPT_EXAMPLES: Array<ScriptExample> = [
  {
    label: "Hello world",
    description: "Log a message and return a value.",
    code: `// Log lines appear on the execution. Return a value to capture it.
console.log('Runbook step running');
return 'ok';`,
  },
  {
    label: "Compute & return JSON",
    description: "Transform data and return a structured result.",
    code: `const now = new Date().toISOString();
const result = {
  acknowledgedAt: now,
  severity: 'high',
  notes: 'Auto-acknowledged by runbook',
};
console.log('Result:', JSON.stringify(result));
return result;`,
  },
  {
    label: "Branch on a condition",
    description: "Throw to fail the step, or return to succeed.",
    code: `const random = Math.random();
console.log('Random value:', random);

if (random < 0.1) {
  // Throwing fails the step. The error message is captured.
  throw new Error('Random check failed below threshold');
}

return { status: 'healthy', value: random };`,
  },
];

/*
 * Bash runs via \`bash -c "<script>"\` on the Runner's machine.
 * Standard shell tools (curl, jq, grep, awk, etc.) are available
 * if they are installed on the Runner. Output is capped at 50 KB.
 */
const BASH_EXAMPLES: Array<ScriptExample> = [
  {
    label: "Hello world",
    description: "Echo a message and exit cleanly.",
    code: `echo "Runbook step running on $(hostname) at $(date -Iseconds)"`,
  },
  {
    label: "Check disk usage",
    description: "Report disk usage on the Runner's host.",
    code: `df -h | head -5
echo "---"
echo "Top 5 largest files in /var/log:"
du -ah /var/log 2>/dev/null | sort -hr | head -5 || true`,
  },
  {
    label: "Call an API with curl",
    description: "Hit a health endpoint, fail if non-2xx.",
    code: `set -euo pipefail
URL="https://api.example.com/health"
HTTP_CODE=$(curl -s -o /tmp/resp.txt -w "%{http_code}" "$URL")
echo "HTTP $HTTP_CODE"
cat /tmp/resp.txt

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Health check failed"
  exit 1
fi`,
  },
  {
    label: "Tail a log file",
    description: "Surface the last lines of an application log.",
    code: `LOG=/var/log/app.log
if [[ -f "$LOG" ]]; then
  echo "Last 50 lines of $LOG:"
  tail -n 50 "$LOG"
else
  echo "Log file $LOG not found on this Runner"
  exit 1
fi`,
  },
];

/*
 * AI prompts run on the OneUptime Worker via the project's LLM provider.
 * The response becomes the step output on the execution timeline.
 */
const AI_PROMPT_EXAMPLES: Array<ScriptExample> = [
  {
    label: "Summarize the incident",
    description: "Digest the triggering incident for responders.",
    code: `Summarize what we know about the triggering incident so far: impact, timeline, and current state. End with the single most useful next diagnostic action.`,
  },
  {
    label: "Analyze previous steps",
    description: "Review earlier step output before remediation.",
    code: `Review the output of the previous steps. State what they reveal, whether anything looks abnormal, and whether it is safe to proceed with the remediation steps that follow. Answer PROCEED or INVESTIGATE first, then explain.`,
  },
  {
    label: "Draft a status update",
    description: "Draft a public status-page update.",
    code: `Draft a short, calm status-page update about the triggering incident. Stick to confirmed facts; do not speculate about root cause. Two sentences maximum.`,
  },
];

function isAutomatedStep(type: RunbookStepType): boolean {
  return type !== RunbookStepType.Manual;
}

function newStep(type: RunbookStepType, order: number): RunbookStep {
  const meta: StepTypeMeta = STEP_TYPE_META[type];
  const base: RunbookStep = {
    id: UUID.generate(),
    order,
    type,
    title: meta.label,
    description: "",
    config:
      type === RunbookStepType.JavaScript
        ? ({
            script: JAVASCRIPT_EXAMPLES[0]!.code,
            agentId: "",
          } as JavaScriptStepConfig)
        : type === RunbookStepType.HttpRequest
          ? ({
              url: "https://",
              method: "GET",
            } as HttpRequestStepConfig)
          : type === RunbookStepType.Bash
            ? ({
                script: BASH_EXAMPLES[0]!.code,
                agentId: "",
              } as BashStepConfig)
            : type === RunbookStepType.SSH
              ? ({
                  host: "",
                  username: "",
                  signIn: "",
                  script: SSH_EXAMPLES[0]!.code,
                  agentId: "",
                } as SSHStepConfig)
              : type === RunbookStepType.Kubernetes
                ? ({
                    kubeconfig: "",
                    script: KUBECTL_EXAMPLES[0]!.code,
                    agentId: "",
                  } as KubernetesStepConfig)
                : type === RunbookStepType.AI
                  ? ({
                      prompt: AI_PROMPT_EXAMPLES[0]!.code,
                      includePreviousStepContext: true,
                      includeTriggerContext: true,
                    } as AIStepConfig)
                  : {},
  };
  if (isAutomatedStep(type)) {
    base.continueOnFailure = false;
    base.requireApprovalBeforeRunning = false;
  }
  return base;
}

/*
 * The Runner a folded step names, as the line under its title says it: the
 * global choice in the reader's words, or the project Runner's own name.
 */
function runnerSummaryValue(runner: RunnerSummary): TemplateValue {
  if (!runner.isGlobal) {
    return runner.name;
  }

  return composedValue((translator: Translator): string => {
    return translator.translateText(runner.name) || runner.name;
  });
}

/*
 * The line under a folded step's title. A step that runs on a Runner says
 * what it runs on - "JavaScript on Global Runner", "Bash script on
 * prod-eu-west-1", "SSH to deploy@10.0.4.21 from prod-bastion" - or that
 * it still needs a Runner, so the list reads where every step runs without
 * opening one (`runner` is undefined while the step cannot run as it is:
 * see getRunnerSummary).
 */
function summarizeStep(
  step: RunbookStep,
  runner: RunnerSummary | undefined,
): string {
  if (step.type === RunbookStepType.HttpRequest) {
    const cfg: HttpRequestStepConfig = step.config as HttpRequestStepConfig;
    const method: string = cfg.method || "GET";
    const url: string = cfg.url || "https://";
    return `${method} ${url}`;
  }
  if (step.type === RunbookStepType.JavaScript) {
    return runner
      ? translateTemplate("JavaScript on {{runner}}", {
          runner: runnerSummaryValue(runner),
        })
      : translateTemplate("JavaScript, needs a Runner");
  }
  if (step.type === RunbookStepType.Bash) {
    return runner
      ? translateTemplate("Bash script on {{runner}}", {
          runner: runnerSummaryValue(runner),
        })
      : translateTemplate("Bash script, needs a Runner");
  }
  if (step.type === RunbookStepType.SSH) {
    const cfg: SSHStepConfig = step.config as SSHStepConfig;

    if (isLegacyCredentialStep(step)) {
      return translateTemplate("SSH with a runbook credential");
    }

    const target: string =
      formatSshTarget({ username: cfg.username, host: cfg.host }) || "?";

    return runner
      ? translateTemplate("SSH to {{target}} from {{runner}}", {
          target,
          runner: runnerSummaryValue(runner),
        })
      : translateTemplate("SSH to {{target}}, needs a Runner", { target });
  }
  if (step.type === RunbookStepType.Kubernetes) {
    const cfg: KubernetesStepConfig = step.config as KubernetesStepConfig;

    if (isLegacyCredentialStep(step)) {
      return translateTemplate("Kubernetes action with a runbook credential");
    }

    const command: string = getFirstCommand(cfg.script);

    if (!runner) {
      return translateTemplate("kubectl script, needs a Runner");
    }

    return command
      ? translateTemplate("{{command}} · on {{runner}}", {
          command,
          runner: runnerSummaryValue(runner),
        })
      : translateTemplate("kubectl script on {{runner}}", {
          runner: runnerSummaryValue(runner),
        });
  }
  if (step.type === RunbookStepType.AI) {
    const cfg: AIStepConfig = step.config as AIStepConfig;
    const firstLine: string = (cfg.prompt || "").split("\n")[0] || "";
    return firstLine
      ? translateTemplate("AI: {{prompt}}", {
          prompt: `${firstLine.slice(0, 80)}${firstLine.length > 80 ? "…" : ""}`,
        })
      : translateTemplate("AI prompt");
  }
  return translateTemplate("Manual checklist item");
}

const Steps: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [steps, setSteps] = useState<RunbookStep[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<boolean>(false);
  const [hasUnsaved, setHasUnsaved] = useState<boolean>(false);

  // Steps moved or edited and not saved yet: nothing reloads under them.
  useUnsavedChanges(hasUnsaved);

  /*
   * Who can run the steps: the project's own Runners, the global Runners
   * OneUptime runs for every project, and whether the project uses them.
   */
  const [runnerChoices, setRunnerChoices] = useState<RunnerChoices>({
    projectRunners: [],
    globalRunners: [],
    projectUsesGlobalRunners: true,
  });

  /*
   * A step with nothing to pick links to Runbooks -> Runners in a new tab:
   * the choices are read again when the person comes back, so a Runner
   * added there can be picked here at once.
   */
  useRefreshRunnerChoicesOnFocus(
    ProjectUtil.getCurrentProjectId(),
    setRunnerChoices,
  );

  // What a step that runs on a Runner runs on, as its picker shows it.
  const getStepRunnerModel: (step: RunbookStep) => RunnerPickerModel = (
    step: RunbookStep,
  ): RunnerPickerModel => {
    return buildRunnerPickerModel({
      stepType: step.type,
      currentRunnerId:
        (step.config as JavaScriptStepConfig | BashStepConfig).agentId || "",
      projectRunners: runnerChoices.projectRunners,
      globalRunners: runnerChoices.globalRunners,
      projectUsesGlobalRunners: runnerChoices.projectUsesGlobalRunners,
    });
  };

  /*
   * The variables the steps can name - the project's global ones and this
   * runbook's own - for the pickers of an SSH step's sign-in and a kubectl
   * step's kubeconfig, and the chips under each script. Read again when the
   * person comes back from a tab where they added one.
   */
  const [variableChoices, setVariableChoices] =
    useState<RunbookVariableChoices>(NO_RUNBOOK_VARIABLE_CHOICES);
  const [llmProviders, setLlmProviders] = useState<LlmProviderOption[]>([]);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    let isMounted: boolean = true;

    const onWindowFocus: () => void = (): void => {
      RunbookVariableChoicesLoader.load({ projectId, runbookId: modelId })
        .then((choices: RunbookVariableChoices) => {
          if (isMounted) {
            setVariableChoices(choices);
          }
        })
        .catch(() => {
          // The choices the page already has stand.
        });
    };

    window.addEventListener("focus", onWindowFocus);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [modelId.toString()]);

  const translator: Translator = useTranslator();
  const { translateString }: UseTranslateValueResult = useTranslateValue();

  /*
   * Where a step runs, as its folded More fields name it: "Runner: Global
   * Runner", "Runner: prod-eu-west-1", with how the Runner is doing when it
   * is not connected ("Runner: office-runner · Disconnected"), or "Runner:
   * None" while the step cannot run as it is - so nobody opens the fold to
   * learn it.
   */
  const getRunnerFoldedValue: (model: RunnerPickerModel) => string = (
    model: RunnerPickerModel,
  ): string => {
    const summary: RunnerSummary | undefined = getRunnerSummary(model);

    if (!summary) {
      return translator.translateText("None") || "None";
    }

    const name: string = summary.isGlobal
      ? translator.translateText(summary.name) || summary.name
      : summary.name;

    if (
      !summary.liveStatus ||
      summary.liveStatus === RunnerLiveStatus.Connected
    ) {
      return name;
    }

    const status: string = getRunnerLiveStatusLabel(summary.liveStatus);

    return `${name} · ${translateString(status) || status}`;
  };

  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>(
    {},
  );

  useAsyncEffect(async () => {
    try {
      const [runbook, loadedRunnerChoices, loadedVariableChoices] =
        await Promise.all([
          ModelAPI.getItem<Runbook>({
            modelType: Runbook,
            id: modelId,
            select: { steps: true },
            requestOptions: {},
          }),
          RunnerChoicesLoader.load(ProjectUtil.getCurrentProjectId()!),
          RunbookVariableChoicesLoader.load({
            projectId: ProjectUtil.getCurrentProjectId()!,
            runbookId: modelId,
          }),
        ]);

      setVariableChoices(loadedVariableChoices);

      /*
       * In the order they run, each with an id - and every approval on the
       * step it holds back, so a runbook an API client wrote with the old
       * "approval after this step" shows the way it runs.
       */
      const loaded: RunbookStep[] = readStepsForEditor(runbook?.steps);
      const initialCollapsed: Record<string, boolean> = {};
      loaded.forEach((s: RunbookStep) => {
        // Default existing steps to collapsed so the page is scannable.
        initialCollapsed[s.id] = true;
      });
      setSteps(loaded);
      setCollapsedState(initialCollapsed);

      setRunnerChoices(loadedRunnerChoices);

      /*
       * Providers are fetched outside the Promise.all above, and their
       * failure is swallowed on purpose: pinning a provider is optional, so
       * a project with no AI configured (or an endpoint that errors) must
       * still be able to edit every other kind of step. An empty list just
       * collapses the picker to "project default".
       */
      try {
        const providerResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString() + "/ai-chat/providers"),
            data: {},
            headers: ModelAPI.getCommonHeaders(),
          });

        if (!(providerResponse instanceof HTTPErrorResponse)) {
          const providerData: JSONObject = providerResponse.data as JSONObject;
          setLlmProviders(
            ((providerData["providers"] as JSONArray) || []).map(
              (provider: JSONObject): LlmProviderOption => {
                return {
                  id: (provider["id"] as string) || "",
                  name: (provider["name"] as string) || "Unnamed provider",
                  llmType: (provider["llmType"] as string) || null,
                  modelName: (provider["modelName"] as string) || null,
                  isDefault: Boolean(provider["isDefault"]),
                };
              },
            ),
          );
        }
      } catch {
        // Non-fatal — the picker falls back to "project default" only.
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const markDirty: () => void = (): void => {
    setHasUnsaved(true);
  };

  const toggleCollapsed: (id: string) => void = (id: string): void => {
    setCollapsedState((prev: Record<string, boolean>) => {
      return { ...prev, [id]: !prev[id] };
    });
  };

  const updateStep: (idx: number, patch: Partial<RunbookStep>) => void = (
    idx: number,
    patch: Partial<RunbookStep>,
  ): void => {
    setSteps((prev: RunbookStep[]) => {
      const copy: RunbookStep[] = [...prev];
      copy[idx] = { ...copy[idx]!, ...patch };
      return copy;
    });
    markDirty();
  };

  const updateConfig: (idx: number, patch: Record<string, unknown>) => void = (
    idx: number,
    patch: Record<string, unknown>,
  ): void => {
    setSteps((prev: RunbookStep[]) => {
      const copy: RunbookStep[] = [...prev];
      /*
       * A moved kubectl step whose script or kubeconfig changes loses the
       * action it kept for older Runners (applyStepConfigChange).
       */
      copy[idx] = applyStepConfigChange(copy[idx]!, patch);
      return copy;
    });
    markDirty();
  };

  const remove: (idx: number) => void = (idx: number): void => {
    setSteps((prev: RunbookStep[]) => {
      const copy: RunbookStep[] = prev
        .filter((_: RunbookStep, i: number) => {
          return i !== idx;
        })
        .map((s: RunbookStep, i: number) => {
          return { ...s, order: i };
        });
      return copy;
    });
    markDirty();
  };

  const add: (type: RunbookStepType) => void = (
    type: RunbookStepType,
  ): void => {
    setSteps((prev: RunbookStep[]) => {
      const created: RunbookStep = newStep(type, prev.length);
      // New steps start expanded so the user can fill them in.
      setCollapsedState((c: Record<string, boolean>) => {
        return { ...c, [created.id!]: false };
      });
      return [...prev, created];
    });
    markDirty();
  };

  const handleDragEnd: (result: DropResult) => void = (
    result: DropResult,
  ): void => {
    if (!result.destination) {
      return;
    }
    const sourceIndex: number = result.source.index;
    const destinationIndex: number = result.destination.index;
    if (sourceIndex === destinationIndex) {
      return;
    }
    setSteps((prev: RunbookStep[]) => {
      const copy: RunbookStep[] = [...prev];
      const [moved] = copy.splice(sourceIndex, 1);
      if (!moved) {
        return prev;
      }
      copy.splice(destinationIndex, 0, moved);
      copy.forEach((s: RunbookStep, i: number) => {
        s.order = i;
      });
      return copy;
    });
    markDirty();
  };

  // The examples under a script or a prompt: a label, then one chip each.
  const renderScriptExampleChips: (args: {
    examples: Array<ScriptExample>;
    onInsert: (code: string) => void;
  }) => ReactElement = (args: {
    examples: Array<ScriptExample>;
    onInsert: (code: string) => void;
  }): ReactElement => {
    return (
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Icon
            icon={IconProp.LightBulb}
            size={SizeProp.Smaller}
            className="text-gray-500"
          />
          <span className="text-xs font-medium text-gray-700">
            {translator.translateText("Examples — click to insert")}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {args.examples.map((ex: ScriptExample) => {
            return (
              <button
                key={ex.label}
                type="button"
                title={translator.translateText(ex.description)}
                onClick={() => {
                  args.onInsert(ex.code);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
              >
                <Icon
                  icon={IconProp.Add}
                  size={SizeProp.Smaller}
                  className="h-3 w-3"
                />
                {/* English constants, looked up as they are drawn. */}
                {translator.translateText(ex.label)}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  /*
   * The panel of helpers under a script or a prompt: its examples, and -
   * under a script - the variables it can use, as a second row of the same
   * panel, so the two read as one aid rather than two blocks stacked under
   * the editor.
   */
  const renderScriptHelpers: (args: {
    examples: Array<ScriptExample>;
    onInsert: (code: string) => void;
    variables?: ReactElement | undefined;
  }) => ReactElement = (args: {
    examples: Array<ScriptExample>;
    onInsert: (code: string) => void;
    variables?: ReactElement | undefined;
  }): ReactElement => {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
        {renderScriptExampleChips({
          examples: args.examples,
          onInsert: args.onInsert,
        })}
        {args.variables}
      </div>
    );
  };

  const save: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setError("");
    try {
      const normalized: RunbookStep[] = steps.map(
        (s: RunbookStep, i: number) => {
          return { ...s, order: i };
        },
      );
      await ModelAPI.updateById({
        modelType: Runbook,
        id: modelId,
        data: {
          steps: normalized as unknown as JSONArray,
        },
      });
      setHasUnsaved(false);
      setSuccess(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  /*
   * Which Runner runs a step: the one Runner picker (RunnerPicker), first
   * under the step's More fields. A step that picked none shows the
   * project's default Runner when the project has one, and otherwise -
   * for a JavaScript step - "Global Runner", the Runners OneUptime runs for
   * every project; a Bash, SSH or kubectl step with neither picks one of
   * the project's own, and the Global Runner is drawn as not open to it.
   */
  const renderAgentPicker: (args: {
    stepIndex: number;
    stepType: RunbookStepType;
    currentAgentId: string;
    onChange: (id: string) => void;
    helperText: ReactElement;
  }) => ReactElement = (args: {
    stepIndex: number;
    stepType: RunbookStepType;
    currentAgentId: string;
    onChange: (id: string) => void;
    helperText: ReactElement;
  }): ReactElement => {
    return (
      <RunnerPicker
        stepType={args.stepType}
        stepTypeName={STEP_TYPE_META[args.stepType].shortLabel}
        value={args.currentAgentId}
        onChange={args.onChange}
        choices={runnerChoices}
        ownRunnerHelperText={args.helperText}
        dataTestId={`runbook-step-${args.stepIndex}-runner`}
      />
    );
  };

  /*
   * Optional provider pin for an AI step. The first option is always "project
   * default", which writes an empty id — that is the pre-existing behaviour
   * and stays the default for every new step.
   *
   * A pinned provider that is no longer in the list (deleted, or moved to
   * another project) is surfaced as an explicit "unavailable" option rather
   * than silently reset to the default: the server FAILS such a step, so the
   * form has to show the responder the same broken state the run will hit.
   */
  const renderLlmProviderPicker: (args: {
    currentProviderId: string;
    onChange: (id: string) => void;
  }) => ReactElement = (args: {
    currentProviderId: string;
    onChange: (id: string) => void;
  }): ReactElement => {
    const defaultOption: DropdownOption = {
      value: PROJECT_DEFAULT_PROVIDER_VALUE,
      label: "Project default",
    };

    const providerOptions: Array<DropdownOption> = llmProviders.map(
      (provider: LlmProviderOption): DropdownOption => {
        const detail: string = [provider.llmType, provider.modelName]
          .filter(Boolean)
          .join(" · ");

        return {
          value: provider.id,
          label: `${provider.name}${detail ? ` (${detail})` : ""}${
            provider.isDefault ? " · default" : ""
          }`,
        };
      },
    );

    const knownOption: DropdownOption | undefined = providerOptions.find(
      (o: DropdownOption) => {
        return o.value === args.currentProviderId;
      },
    );

    const staleOption: DropdownOption | undefined =
      args.currentProviderId && !knownOption
        ? {
            value: args.currentProviderId,
            label: translator.translateTemplate(
              "Unavailable provider ({{id}})",
              { id: args.currentProviderId },
            ),
          }
        : undefined;

    const options: Array<DropdownOption> = [
      defaultOption,
      ...(staleOption ? [staleOption] : []),
      ...providerOptions,
    ];

    /*
     * Always set to something - the project default when nothing is pinned -
     * so the field is not marked optional and has nothing to clear: picking
     * the project default is how a pin is taken off.
     */
    return (
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">
          {translator.translateText("LLM provider")}
        </label>
        <Dropdown
          options={options}
          isClearable={false}
          value={staleOption || knownOption || defaultOption}
          placeholder="Project default"
          onChange={(
            value: DropdownValue | Array<DropdownValue> | null,
          ): void => {
            const id: string =
              value === null || value === undefined
                ? PROJECT_DEFAULT_PROVIDER_VALUE
                : Array.isArray(value)
                  ? String(value[0] ?? PROJECT_DEFAULT_PROVIDER_VALUE)
                  : String(value);
            args.onChange(id);
          }}
        />
        <p className="text-xs text-gray-500 mt-1.5">
          {staleOption ? (
            <span className="text-amber-700">
              {translator.translateText(
                "The provider pinned on this step is no longer available to this project, so the step will fail when it runs. Pick another provider, or switch back to the project default.",
              )}
            </span>
          ) : (
            <TranslatedSentence
              template="Leave this on {{projectDefault}} unless this step needs a specific model."
              slots={{
                projectDefault: (
                  <strong>{translator.translateText("Project default")}</strong>
                ),
              }}
            />
          )}
        </p>
      </div>
    );
  };

  /*
   * Bash and JavaScript are dispatched to a Runner, so they carry two
   * timeouts: how long the Worker waits for the Runner to pick the job up,
   * and how long the Runner lets the script run once it has.
   */
  const renderAgentTimeouts: (args: {
    idx: number;
    /*
     * Every Runner-executed step carries the same pair of timeouts, so this
     * asks for exactly those two fields rather than naming each config type —
     * a union would have to be widened for each new step type, and the helper
     * never reads anything else.
     */
    config: RunnerExecutedStepTimeouts;
    executionDescription: ReactElement;
    /*
     * The range the step really gets: a step on a global Runner is held to
     * 5 minutes (GLOBAL_RUNNER_STEP_EXECUTION_TIMEOUT_BOUNDS), so its field
     * says so and that a longer timeout is cut short when it runs.
     */
    executionBounds: TimeoutBounds;
  }) => ReactElement = (args: {
    idx: number;
    config: RunnerExecutedStepTimeouts;
    executionDescription: ReactElement;
    executionBounds: TimeoutBounds;
  }): ReactElement => {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <StepTimeoutInput
          label="Execution timeout"
          value={args.config.timeoutInMs}
          bounds={args.executionBounds}
          description={args.executionDescription}
          onChange={(timeoutInMs: number | undefined) => {
            updateConfig(args.idx, { timeoutInMs });
          }}
        />
        <StepTimeoutInput
          label="Claim timeout"
          value={args.config.claimTimeoutInMs}
          bounds={AGENT_CLAIM_TIMEOUT_BOUNDS}
          description={
            <>
              {translator.translateText(
                "How long to wait for the Runner to pick this step up before it times out. Allow for its poll cycle (5 seconds by default).",
              )}
            </>
          }
          onChange={(claimTimeoutInMs: number | undefined) => {
            updateConfig(args.idx, { claimTimeoutInMs });
          }}
        />
      </div>
    );
  };

  /*
   * A step's More fields: what most steps never change, folded under one
   * quiet line that names what is inside and what of it is set
   * (RunbookStepEditorModel.getStepMoreFieldsItems) - the maintainer asked
   * for the steps to "hide advanced options", and for the Runner to be one
   * of them: "have this runner drop down, hidden in More".
   *
   * A step that runs on a Runner names it first on that line, whatever it
   * is ("Runner: Global Runner"), so where the step runs is read without
   * opening anything. And a step that cannot run as it is - a Bash step
   * with no Runner of its own and no project default - starts with its
   * fold open: its Runner is the field to fill, and it is inside.
   */
  const renderMoreFields: (
    step: RunbookStep,
    idx: number,
    children: ReactNode,
  ) => ReactElement = (
    step: RunbookStep,
    idx: number,
    children: ReactNode,
  ): ReactElement => {
    const runnerModel: RunnerPickerModel | undefined =
      isRunnerStep(step.type) && !isLegacyCredentialStep(step)
        ? getStepRunnerModel(step)
        : undefined;

    return (
      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        items={getStepMoreFieldsItems(
          step,
          runnerModel ? { runner: getRunnerFoldedValue(runnerModel) } : {},
        )}
        defaultCollapsed={runnerModel ? runnerModel.willRun : true}
        dataTestId={`runbook-step-${idx}-more-fields`}
      >
        <div className="flex flex-col gap-4">{children}</div>
      </FoldedSection>
    );
  };

  /*
   * A step's description: on a Manual step, the instructions the responder
   * reads and follows, on the card; on any other step, notes about it,
   * under More fields.
   */
  const renderDescriptionField: (
    step: RunbookStep,
    idx: number,
  ) => ReactElement = (step: RunbookStep, idx: number): ReactElement => {
    const isManual: boolean = step.type === RunbookStepType.Manual;

    return (
      <div>
        <label
          htmlFor={`runbook-step-${idx}-description`}
          className="block text-xs font-medium text-gray-700 mb-1.5"
        >
          {translator.translateText(
            isManual ? MANUAL_INSTRUCTIONS_TITLE : "Description",
          )}
          <span className="ml-2 text-[10px] font-normal text-gray-400">
            {translator.translateText("Markdown supported")}
          </span>
        </label>
        <TextArea
          id={`runbook-step-${idx}-description`}
          value={step.description || ""}
          onChange={(v: string) => {
            return updateStep(idx, {
              description: v,
            });
          }}
          placeholder={
            isManual
              ? "What should the responder do or check? Markdown is supported."
              : "Optional notes about what this step does. Markdown is supported."
          }
        />
      </div>
    );
  };

  /*
   * The two switches every automated step has, first under its More fields:
   * whether the run stops before this step for someone to approve it, and
   * whether a failure stops the run.
   */
  const renderRunSwitches: (step: RunbookStep, idx: number) => ReactElement = (
    step: RunbookStep,
    idx: number,
  ): ReactElement => {
    return (
      <div className="flex flex-col gap-3">
        <Toggle
          title={REQUIRE_APPROVAL_TITLE}
          description={REQUIRE_APPROVAL_DESCRIPTION}
          value={stepRequiresApprovalBeforeRunning(step)}
          dataTestId={`runbook-step-${idx}-require-approval`}
          onChange={(v: boolean) => {
            setSteps((prev: RunbookStep[]) => {
              const copy: RunbookStep[] = [...prev];
              copy[idx] = setStepRequiresApproval(copy[idx]!, v);
              return copy;
            });
            markDirty();
          }}
        />
        <Toggle
          title={CONTINUE_ON_FAILURE_TITLE}
          description={CONTINUE_ON_FAILURE_DESCRIPTION}
          value={Boolean(step.continueOnFailure)}
          dataTestId={`runbook-step-${idx}-continue-on-failure`}
          onChange={(v: boolean) => {
            return updateStep(idx, {
              continueOnFailure: v,
            });
          }}
        />
      </div>
    );
  };

  // A script field with its line of help, its examples and the variables.
  const renderScriptField: (args: {
    id: string;
    label: string;
    type: CodeType;
    value: string;
    onChange: (value: string) => void;
    help: ReactNode;
    examples: Array<ScriptExample>;
  }) => ReactElement = (args: {
    id: string;
    label: string;
    type: CodeType;
    value: string;
    onChange: (value: string) => void;
    help: ReactNode;
    examples: Array<ScriptExample>;
  }): ReactElement => {
    return (
      <div>
        <label
          htmlFor={args.id}
          className="block text-xs font-medium text-gray-700 mb-1.5"
        >
          {translator.translateText(args.label)}
        </label>
        <CodeEditor
          id={args.id}
          type={args.type}
          value={args.value}
          onChange={args.onChange}
        />
        <p className="text-xs text-gray-500 mt-1.5">{args.help}</p>
        <UnknownVariablesNote
          references={getUnknownVariableReferences(variableChoices, [
            args.value,
          ])}
          dataTestId={`${args.id}-unknown-variables`}
        />
        <div className="mt-2">
          {renderScriptHelpers({
            examples: args.examples,
            onInsert: args.onChange,
            variables: (
              <RunbookVariableChips
                choices={variableChoices}
                dataTestId={`${args.id}-variables`}
              />
            ),
          })}
        </div>
      </div>
    );
  };

  /*
   * An SSH or Kubernetes step written with a runbook credential, through
   * the API (the data migrations rewrote every stored one): shown as it is
   * - it no longer runs, as runbook credentials were removed, which its
   * header says too - with one button that turns it into a script step.
   */
  const renderLegacyCredentialStep: (
    step: RunbookStep,
    idx: number,
  ) => ReactElement = (step: RunbookStep, idx: number): ReactElement => {
    return (
      <>
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid={`runbook-step-${idx}-legacy`}
        >
          <p>
            {translator.translateText(
              step.type === RunbookStepType.SSH
                ? LEGACY_SSH_STEP_NOTICE
                : LEGACY_KUBERNETES_STEP_NOTICE,
            )}
          </p>
          {/*
           * The button lines up with the sentence above it: Button keeps a
           * left margin of its own for a dialog's footer.
           */}
          <div className="mt-3 [&>button]:ml-0 [&>button]:md:ml-0">
            <Button
              title="Turn into a script step"
              icon={IconProp.Code}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              dataTestId={`runbook-step-${idx}-legacy-convert`}
              onClick={() => {
                setSteps((prev: RunbookStep[]) => {
                  const copy: RunbookStep[] = [...prev];
                  copy[idx] = convertLegacyCredentialStep(copy[idx]!);
                  return copy;
                });
                markDirty();
              }}
            />
          </div>
        </div>
        {renderMoreFields(
          step,
          idx,
          <>
            {renderRunSwitches(step, idx)}
            {renderDescriptionField(step, idx)}
            {renderAgentTimeouts({
              idx,
              config: step.config as SSHStepConfig,
              executionDescription: (
                <>
                  {translator.translateText(
                    "How long the Runner lets the step run before stopping it.",
                  )}
                </>
              ),
              executionBounds: STEP_EXECUTION_TIMEOUT_BOUNDS,
            })}
          </>,
        )}
      </>
    );
  };

  const renderJavaScriptBody: (
    step: RunbookStep,
    idx: number,
  ) => ReactElement = (step: RunbookStep, idx: number): ReactElement => {
    const config: JavaScriptStepConfig = step.config as JavaScriptStepConfig;

    return (
      <>
        {renderScriptField({
          id: `runbook-step-${idx}-javascript-script`,
          label: "Script",
          type: CodeType.JavaScript,
          value: config.script || "",
          onChange: (v: string) => {
            updateConfig(idx, { script: v });
          },
          help: (
            <TranslatedSentence
              template="Runs in an {{sandbox}} sandbox, with no file or process access. It can call public APIs with {{axios}}. Use {{returnValue}} to hand a result to the next steps."
              slots={{
                sandbox: <code>isolated-vm</code>,
                axios: <code>axios</code>,
                returnValue: <code>return value</code>,
              }}
            />
          ),
          examples: JAVASCRIPT_EXAMPLES,
        })}
        {renderMoreFields(
          step,
          idx,
          <>
            {renderAgentPicker({
              stepIndex: idx,
              stepType: RunbookStepType.JavaScript,
              currentAgentId: config.agentId || "",
              onChange: (id: string) => {
                updateConfig(idx, {
                  agentId: id,
                });
              },
              helperText: (
                <>
                  {translator.translateText(
                    "Runs on this Runner, in your own infrastructure.",
                  )}
                </>
              ),
            })}
            {renderRunSwitches(step, idx)}
            {renderDescriptionField(step, idx)}
            {renderAgentTimeouts({
              idx,
              config,
              executionDescription: (
                <>
                  {translator.translateText(
                    "How long the Runner lets the script run before stopping it.",
                  )}
                </>
              ),
              executionBounds:
                getStepRunnerModel(step).outcome ===
                RunnerPickerOutcome.GlobalRunner
                  ? GLOBAL_RUNNER_STEP_EXECUTION_TIMEOUT_BOUNDS
                  : STEP_EXECUTION_TIMEOUT_BOUNDS,
            })}
          </>,
        )}
      </>
    );
  };

  const renderHttpBody: (step: RunbookStep, idx: number) => ReactElement = (
    step: RunbookStep,
    idx: number,
  ): ReactElement => {
    const config: HttpRequestStepConfig = step.config as HttpRequestStepConfig;

    return (
      <>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              {translator.translateText("Method")}
            </label>
            <Dropdown
              options={HTTP_METHOD_OPTIONS}
              // A request always has a method: nothing to clear.
              isClearable={false}
              value={HTTP_METHOD_OPTIONS.find((o: DropdownOption) => {
                return o.value === (config.method || "GET");
              })}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ): void => {
                const method: HttpRequestMethod =
                  (Array.isArray(value)
                    ? (value[0] as HttpRequestMethod)
                    : (value as HttpRequestMethod)) || "GET";
                updateConfig(idx, {
                  method,
                });
              }}
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              {translator.translateText("URL")}
            </label>
            <Input
              value={config.url || ""}
              onChange={(v: string) => {
                return updateConfig(idx, {
                  url: v,
                });
              }}
              placeholder="https://api.example.com/incident"
            />
          </div>
        </div>
        {/*
         * The body a POST, PUT, PATCH or DELETE sends. A GET or HEAD sends
         * none, so it shows no Body - unless it has one, which it sends.
         */}
        {isHttpBodyShown(config) ? (
          <div>
            <label
              htmlFor={`runbook-step-${idx}-http-body`}
              className="block text-xs font-medium text-gray-700 mb-1.5"
            >
              {translator.translateText("Body")}
            </label>
            <CodeEditor
              id={`runbook-step-${idx}-http-body`}
              type={CodeType.JSON}
              value={config.body || ""}
              onChange={(v: string) => {
                return updateConfig(idx, {
                  body: v,
                });
              }}
              placeholder='{ "message": "..." }'
            />
          </div>
        ) : (
          <></>
        )}
        {renderMoreFields(
          step,
          idx,
          <>
            {renderRunSwitches(step, idx)}
            <div>
              <label
                htmlFor={`runbook-step-${idx}-http-headers`}
                className="block text-xs font-medium text-gray-700 mb-1.5"
              >
                {translator.translateText(HTTP_HEADERS_TITLE)}
              </label>
              <CodeEditor
                id={`runbook-step-${idx}-http-headers`}
                type={CodeType.JSON}
                value={config.headersJson || ""}
                onChange={(v: string) => {
                  return updateConfig(idx, {
                    headersJson: v,
                  });
                }}
                placeholder={'{ "Authorization": "Bearer ..." }'}
              />
            </div>
            {renderDescriptionField(step, idx)}
            {/*
             * Half the width, as every other step's timeouts are: a number
             * of seconds needs no more.
             */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <StepTimeoutInput
                label="Request timeout"
                value={config.timeoutInMs}
                bounds={STEP_EXECUTION_TIMEOUT_BOUNDS}
                description={
                  <>
                    {translator.translateText(
                      "How long to wait for the endpoint to respond before failing the step.",
                    )}
                  </>
                }
                onChange={(timeoutInMs: number | undefined) => {
                  updateConfig(idx, {
                    timeoutInMs,
                  });
                }}
              />
            </div>
          </>,
        )}
      </>
    );
  };

  const renderBashBody: (step: RunbookStep, idx: number) => ReactElement = (
    step: RunbookStep,
    idx: number,
  ): ReactElement => {
    const config: BashStepConfig = step.config as BashStepConfig;

    return (
      <>
        {renderScriptField({
          id: `runbook-step-${idx}-bash-script`,
          label: "Bash script",
          type: CodeType.Bash,
          value: config.script || "",
          onChange: (v: string) => {
            updateConfig(idx, { script: v });
          },
          help: (
            <TranslatedSentence
              template="Runs with {{command}} on the selected Runner. Output is capped at 50 KB, and a non-zero exit code fails the step."
              slots={{
                command: <code>bash -c</code>,
              }}
            />
          ),
          examples: BASH_EXAMPLES,
        })}
        {renderMoreFields(
          step,
          idx,
          <>
            {renderAgentPicker({
              stepIndex: idx,
              stepType: RunbookStepType.Bash,
              currentAgentId: config.agentId || "",
              onChange: (id: string) => {
                updateConfig(idx, {
                  agentId: id,
                });
              },
              helperText: (
                <>
                  {translator.translateText(
                    "Runs on this Runner, in your own infrastructure.",
                  )}
                </>
              ),
            })}
            {renderRunSwitches(step, idx)}
            {renderDescriptionField(step, idx)}
            {renderAgentTimeouts({
              idx,
              config,
              executionDescription: (
                <TranslatedSentence
                  template="How long the Runner lets the script run before stopping it with {{signal}}."
                  slots={{
                    signal: <code>SIGKILL</code>,
                  }}
                />
              ),
              executionBounds: STEP_EXECUTION_TIMEOUT_BOUNDS,
            })}
          </>,
        )}
      </>
    );
  };

  /*
   * SSH: the Runner that opens the connection, the machine (user@host), the
   * secret it signs in with and the bash script to run there. The port and
   * a key's passphrase wait under More fields.
   */
  const renderSshBody: (step: RunbookStep, idx: number) => ReactElement = (
    step: RunbookStep,
    idx: number,
  ): ReactElement => {
    if (isLegacyCredentialStep(step)) {
      return renderLegacyCredentialStep(step, idx);
    }

    const config: SSHStepConfig = step.config as SSHStepConfig;

    /*
     * The Runner the step runs on - its own pick, or the project's default -
     * which a secret it signs in with must let use it.
     */
    const runnerId: string = getStepRunnerModel(step).runnerId;

    return (
      <>
        <SshTargetInput
          host={config.host || ""}
          username={config.username || ""}
          helperText={SSH_TARGET_HELP}
          dataTestId={`runbook-step-${idx}-ssh-target`}
          onChange={(target: SshTarget) => {
            updateConfig(idx, {
              host: target.host,
              username: target.username,
            });
          }}
        />
        <UnknownVariablesNote
          references={getUnknownVariableReferences(variableChoices, [
            config.host || "",
            config.username || "",
          ])}
          dataTestId={`runbook-step-${idx}-ssh-target-unknown-variables`}
        />
        <RunbookVariablePicker
          label={SSH_SIGN_IN_TITLE}
          value={config.signIn || ""}
          choices={variableChoices}
          runnerId={runnerId}
          runbookId={modelId}
          dataTestId={`runbook-step-${idx}-ssh-sign-in`}
          helperText={translator.translateText(
            "The secret variable that holds the private key or the password. The step never holds it itself.",
          )}
          onChange={(reference: string) => {
            updateConfig(idx, { signIn: reference });
          }}
        />
        {renderScriptField({
          id: `runbook-step-${idx}-ssh-script`,
          label: "Bash script",
          type: CodeType.Bash,
          value: config.script || "",
          onChange: (v: string) => {
            updateConfig(idx, { script: v });
          },
          help: (
            <>
              {translator.translateText(
                "Runs with bash on the machine, as the user it signs in as. Output is capped at 50 KB, and a non-zero exit code fails the step.",
              )}
            </>
          ),
          examples: SSH_EXAMPLES,
        })}
        {renderMoreFields(
          step,
          idx,
          <>
            {renderAgentPicker({
              stepIndex: idx,
              stepType: RunbookStepType.SSH,
              currentAgentId: config.agentId || "",
              onChange: (id: string) => {
                updateConfig(idx, {
                  agentId: id,
                });
              },
              helperText: (
                <>
                  {translator.translateText(
                    "This Runner opens the SSH connection, so it must be able to reach the machine.",
                  )}
                </>
              ),
            })}
            {renderRunSwitches(step, idx)}
            <div className="max-w-xs">
              <label
                htmlFor={`runbook-step-${idx}-ssh-port`}
                className="block text-xs font-medium text-gray-700 mb-1.5"
              >
                {translator.translateText(SSH_PORT_TITLE)}
              </label>
              <Input
                id={`runbook-step-${idx}-ssh-port`}
                value={config.port ? String(config.port) : ""}
                placeholder="22"
                onChange={(v: string) => {
                  const parsed: number = parseInt(v, 10);
                  updateConfig(idx, {
                    port:
                      isNaN(parsed) || parsed <= 0
                        ? undefined
                        : Math.min(parsed, 65535),
                  });
                }}
              />
            </div>
            <RunbookVariablePicker
              label={SSH_PASSPHRASE_TITLE}
              value={config.passphrase || ""}
              choices={variableChoices}
              runnerId={runnerId}
              runbookId={modelId}
              noneLabel={NO_PASSPHRASE_LABEL}
              dataTestId={`runbook-step-${idx}-ssh-passphrase`}
              helperText={translator.translateText(
                "Only for a private key that has a passphrase.",
              )}
              onChange={(reference: string) => {
                updateConfig(idx, { passphrase: reference });
              }}
            />
            {renderDescriptionField(step, idx)}
            {renderAgentTimeouts({
              idx,
              config,
              executionDescription: (
                <>
                  {translator.translateText(
                    "Covers connecting, signing in and running the script together.",
                  )}
                </>
              ),
              executionBounds: STEP_EXECUTION_TIMEOUT_BOUNDS,
            })}
          </>,
        )}
      </>
    );
  };

  /*
   * kubectl: the Runner that runs it, the cluster's kubeconfig (or the
   * Runner's own access) and the script of kubectl commands.
   */
  const renderKubectlBody: (step: RunbookStep, idx: number) => ReactElement = (
    step: RunbookStep,
    idx: number,
  ): ReactElement => {
    if (isLegacyCredentialStep(step)) {
      return renderLegacyCredentialStep(step, idx);
    }

    const config: KubernetesStepConfig = step.config as KubernetesStepConfig;

    return (
      <>
        <RunbookVariablePicker
          label={KUBECONFIG_TITLE}
          value={config.kubeconfig || ""}
          choices={variableChoices}
          runnerId={getStepRunnerModel(step).runnerId}
          runbookId={modelId}
          noneLabel={RUNNER_OWN_KUBECONFIG_LABEL}
          dataTestId={`runbook-step-${idx}-kubeconfig`}
          helperText={
            config.kubeconfig
              ? translator.translateText(
                  "The secret variable that holds the cluster's kubeconfig. Give it access to only what your runbooks need.",
                )
              : translator.translateText(
                  "kubectl uses the Runner's own kubeconfig, or its service account when the Runner runs in the cluster.",
                )
          }
          onChange={(reference: string) => {
            updateConfig(idx, { kubeconfig: reference });
          }}
        />
        {renderScriptField({
          id: `runbook-step-${idx}-kubectl-script`,
          label: "Script",
          type: CodeType.Bash,
          value: config.script || "",
          onChange: (v: string) => {
            updateConfig(idx, { script: v });
          },
          help: (
            <TranslatedSentence
              template="kubectl commands, run with bash on the Runner with {{kubeconfig}} pointing at the cluster. Output is capped at 50 KB, and a non-zero exit code fails the step."
              slots={{
                kubeconfig: <code>KUBECONFIG</code>,
              }}
            />
          ),
          examples: KUBECTL_EXAMPLES,
        })}
        {renderMoreFields(
          step,
          idx,
          <>
            {renderAgentPicker({
              stepIndex: idx,
              stepType: RunbookStepType.Kubernetes,
              currentAgentId: config.agentId || "",
              onChange: (id: string) => {
                updateConfig(idx, {
                  agentId: id,
                });
              },
              helperText: (
                <>
                  {translator.translateText(
                    "This Runner runs kubectl, so it must be able to reach the cluster's API server.",
                  )}
                </>
              ),
            })}
            {renderRunSwitches(step, idx)}
            {renderDescriptionField(step, idx)}
            {renderAgentTimeouts({
              idx,
              config,
              executionDescription: (
                <TranslatedSentence
                  template="How long the Runner lets the script run before stopping it with {{signal}}."
                  slots={{
                    signal: <code>SIGKILL</code>,
                  }}
                />
              ),
              executionBounds: STEP_EXECUTION_TIMEOUT_BOUNDS,
            })}
          </>,
        )}
      </>
    );
  };

  const renderAiBody: (step: RunbookStep, idx: number) => ReactElement = (
    step: RunbookStep,
    idx: number,
  ): ReactElement => {
    const config: AIStepConfig = step.config as AIStepConfig;

    return (
      <>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            {translator.translateText("Prompt")}
          </label>
          <TextArea
            value={config.prompt || ""}
            onChange={(v: string) => {
              return updateConfig(idx, {
                prompt: v,
              });
            }}
            placeholder="What should the AI analyze, summarize or decide? Its response becomes this step's output."
          />
          <p className="text-xs text-gray-500 mt-1.5">
            {translator.translateText(
              "The AI's answer becomes this step's output. AI calls are metered like any other AI feature.",
            )}
          </p>
          <div className="mt-2">
            {renderScriptHelpers({
              examples: AI_PROMPT_EXAMPLES,
              onInsert: (code: string) => {
                updateConfig(idx, {
                  prompt: code,
                });
              },
            })}
          </div>
        </div>
        {renderMoreFields(
          step,
          idx,
          <>
            {renderRunSwitches(step, idx)}
            {renderLlmProviderPicker({
              currentProviderId: config.llmProviderId || "",
              onChange: (id: string): void => {
                updateConfig(idx, {
                  llmProviderId: id,
                });
              },
            })}
            <Toggle
              title="Include previous step context"
              description="Give the AI everything about the steps that ran before this one — title, type, status, output and errors."
              value={Boolean(config.includePreviousStepContext)}
              onChange={(v: boolean) => {
                return updateConfig(idx, {
                  includePreviousStepContext: v,
                });
              }}
            />
            <Toggle
              title="Include trigger context"
              description="Tell the AI what started this run, such as the linked incident. Private notes and chat messages are never included."
              value={Boolean(config.includeTriggerContext)}
              onChange={(v: boolean) => {
                return updateConfig(idx, {
                  includeTriggerContext: v,
                });
              }}
            />
            {renderDescriptionField(step, idx)}
          </>,
        )}
      </>
    );
  };

  /*
   * What a step shows when opened: its title, then what its type needs -
   * the rest of it folded under More fields.
   */
  const renderStepBody: (step: RunbookStep, idx: number) => ReactElement = (
    step: RunbookStep,
    idx: number,
  ): ReactElement => {
    const renderTypeFields: () => ReactNode = (): ReactNode => {
      switch (step.type) {
        case RunbookStepType.Manual:
          return renderDescriptionField(step, idx);
        case RunbookStepType.JavaScript:
          return renderJavaScriptBody(step, idx);
        case RunbookStepType.HttpRequest:
          return renderHttpBody(step, idx);
        case RunbookStepType.Bash:
          return renderBashBody(step, idx);
        case RunbookStepType.SSH:
          return renderSshBody(step, idx);
        case RunbookStepType.Kubernetes:
          return renderKubectlBody(step, idx);
        case RunbookStepType.AI:
          return renderAiBody(step, idx);
        default:
          return renderDescriptionField(step, idx);
      }
    };

    return (
      <div className="flex flex-col gap-4">
        <div>
          <label
            htmlFor={`runbook-step-${idx}-title`}
            className="block text-xs font-medium text-gray-700 mb-1.5"
          >
            {translator.translateText("Title")}
          </label>
          <Input
            id={`runbook-step-${idx}-title`}
            value={step.title}
            onChange={(v: string) => {
              return updateStep(idx, {
                title: v,
              });
            }}
            placeholder="What does this step do?"
          />
        </div>
        {renderTypeFields()}
      </div>
    );
  };

  const addMenu: ReactElement = (
    <Button
      title="Add Step"
      icon={IconProp.Add}
      buttonStyle={ButtonStyleType.NORMAL}
      onClick={() => {
        add(RunbookStepType.Manual);
      }}
    />
  );

  return (
    <Fragment>
      <Card
        title="Runbook Steps"
        description="Steps run in order. A manual step waits until someone ticks it off, and a step that needs approval until someone approves it. Drag a step to move it."
        rightElement={
          steps.length > 0 ? (
            <div className="flex items-center gap-2">
              {hasUnsaved ? (
                <span className="text-xs text-amber-600 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  {translator.translateText("Unsaved changes")}
                </span>
              ) : null}
              {addMenu}
            </div>
          ) : undefined
        }
      >
        <>
          <div className="flex flex-col gap-3">
            {steps.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10">
                <div className="text-center mb-6">
                  <div className="mx-auto h-12 w-12 rounded-full bg-white border border-gray-200 flex items-center justify-center mb-3">
                    <Icon
                      icon={IconProp.BookOpen}
                      size={SizeProp.Larger}
                      className="text-gray-400"
                    />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {translator.translateText("Start your runbook")}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {translator.translateText(
                      "Add the first step. You can reorder and edit at any time.",
                    )}
                  </p>
                </div>
                {/*
                 * Four to a row: the seven step types make two even rows
                 * (four and three) rather than five and an orphaned two,
                 * and each card's line wraps less.
                 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-w-5xl mx-auto">
                  {ALL_STEP_TYPES.map((t: RunbookStepType) => {
                    const meta: StepTypeMeta = STEP_TYPE_META[t];
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          return add(t);
                        }}
                        /*
                         * A column from the top: a button centres what it
                         * holds, so cards with a longer line had their icon
                         * higher than the others in the row.
                         */
                        className={`group flex flex-col items-start justify-start text-left rounded-lg border border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm transition p-4 focus:outline-none focus:ring-2 focus:ring-indigo-300`}
                      >
                        <div
                          className={`inline-flex items-center justify-center h-9 w-9 rounded-lg ${meta.bg} ring-1 ${meta.ring} mb-3`}
                        >
                          <Icon
                            icon={meta.icon}
                            size={SizeProp.Regular}
                            className={`h-5 w-5 ${meta.iconColor}`}
                          />
                        </div>
                        <div className="text-sm font-semibold text-gray-900">
                          {meta.shortLabel}
                        </div>
                        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                          {/*
                           * The step's name stays as the editor and the
                           * execution page name it, in English; what it
                           * does reads in the reader's language.
                           */}
                          {translator.translateText(meta.description)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="runbook-steps-list">
                {(droppableProvided: DroppableProvided) => {
                  return (
                    <div
                      ref={droppableProvided.innerRef}
                      {...droppableProvided.droppableProps}
                      className="flex flex-col gap-3"
                    >
                      {steps.map((step: RunbookStep, idx: number) => {
                        const meta: StepTypeMeta = STEP_TYPE_META[step.type];
                        const stepId: string = step.id || `step-${idx}`;
                        const isCollapsed: boolean =
                          collapsedState[stepId] !== false;
                        const summary: string = summarizeStep(
                          step,
                          step.type === RunbookStepType.JavaScript ||
                            step.type === RunbookStepType.Bash ||
                            step.type === RunbookStepType.SSH ||
                            step.type === RunbookStepType.Kubernetes
                            ? getRunnerSummary(getStepRunnerModel(step))
                            : undefined,
                        );
                        return (
                          <Draggable
                            draggableId={stepId}
                            index={idx}
                            key={stepId}
                          >
                            {(draggableProvided: DraggableProvided) => {
                              return (
                                <div
                                  ref={draggableProvided.innerRef}
                                  {...draggableProvided.draggableProps}
                                  className={`rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden border-l-4 ${meta.borderL}`}
                                >
                                  {/*
                                   * The step's header: its drag handle, the
                                   * button that opens and closes it, and its
                                   * Delete button, side by side. The header
                                   * used to be one role="button" holding the
                                   * other two, which a screen reader reads as
                                   * one control: the handle and Delete were
                                   * lost inside it. The open/close button
                                   * still answers a press anywhere on the
                                   * header (its ::after covers the header),
                                   * and the handle and Delete sit above that.
                                   */}
                                  <div
                                    data-testid="runbook-step-header"
                                    className="relative flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors sm:gap-3"
                                  >
                                    <div
                                      {...draggableProvided.dragHandleProps}
                                      className="relative z-10 flex-shrink-0 cursor-ns-resize text-gray-400 hover:text-gray-600"
                                      aria-label={translator.translateText(
                                        "Drag to reorder step",
                                      )}
                                      title={translator.translateText(
                                        "Drag to reorder",
                                      )}
                                    >
                                      <Icon
                                        icon={IconProp.GripVertical}
                                        className="w-4 h-4"
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      aria-expanded={!isCollapsed}
                                      onClick={() => {
                                        toggleCollapsed(stepId);
                                      }}
                                      className="flex min-w-0 flex-1 items-center gap-2 text-left after:absolute after:inset-0 focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-indigo-500 sm:gap-3"
                                    >
                                      <Icon
                                        icon={
                                          isCollapsed
                                            ? IconProp.ChevronRight
                                            : IconProp.ChevronDown
                                        }
                                        className="w-4 h-4 text-gray-500 flex-shrink-0"
                                      />
                                      <div
                                        className={`flex-shrink-0 h-7 w-7 rounded-full ${meta.numberBg} text-white text-xs font-semibold flex items-center justify-center`}
                                      >
                                        {idx + 1}
                                      </div>
                                      {/*
                                       * The step's type: its icon and name.
                                       * Not drawn on a phone, where the title
                                       * needs the room - the number's colour
                                       * and the line under the title say the
                                       * type there - but still read out by a
                                       * screen reader.
                                       */}
                                      <div
                                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${meta.bg} ${meta.iconColor} ring-1 ring-inset ${meta.ring} flex-shrink-0 max-sm:sr-only`}
                                        data-testid={`runbook-step-${idx}-type`}
                                      >
                                        <Icon
                                          icon={meta.icon}
                                          size={SizeProp.Smaller}
                                          className={meta.iconColor}
                                        />
                                        {meta.shortLabel}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-2 max-sm:items-start">
                                          {/*
                                           * One line, cut short, beside the
                                           * step's type; on a phone up to two,
                                           * so a title reads as more than its
                                           * first word.
                                           */}
                                          <div
                                            className="text-sm font-semibold text-gray-900 truncate max-sm:whitespace-normal max-sm:break-words max-sm:line-clamp-2"
                                            data-testid={`runbook-step-${idx}-title-text`}
                                          >
                                            {step.title || meta.label}
                                          </div>
                                          {/*
                                           * Where the run stops for a person
                                           * to approve: on the step it holds
                                           * back, open or folded - drawn as a
                                           * security playbook step says it.
                                           */}
                                          {stepRequiresApprovalBeforeRunning(
                                            step,
                                          ) ? (
                                            /*
                                             * A phone shows the lock alone,
                                             * so the title keeps its room;
                                             * the words stay for a screen
                                             * reader.
                                             */
                                            <div
                                              className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600"
                                              title={translator.translateText(
                                                NEEDS_APPROVAL_LABEL,
                                              )}
                                              data-testid={`runbook-step-${idx}-needs-approval`}
                                            >
                                              <Icon
                                                icon={IconProp.Lock}
                                                className="h-3 w-3"
                                              />
                                              <span className="max-sm:sr-only">
                                                {translator.translateText(
                                                  NEEDS_APPROVAL_LABEL,
                                                )}
                                              </span>
                                            </div>
                                          ) : (
                                            <></>
                                          )}
                                          {/*
                                           * A step written with a runbook
                                           * credential no longer runs: said
                                           * on the step, open or folded, so
                                           * a runbook that holds one never
                                           * reads as if every step runs. A
                                           * phone shows the sign alone, as
                                           * the approval lock does.
                                           */}
                                          {isLegacyCredentialStep(step) ? (
                                            <div
                                              className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
                                              title={translator.translateText(
                                                NO_LONGER_RUNS_LABEL,
                                              )}
                                              data-testid={`runbook-step-${idx}-no-longer-runs`}
                                            >
                                              <Icon
                                                icon={IconProp.Alert}
                                                className="h-3 w-3"
                                              />
                                              <span className="max-sm:sr-only">
                                                {translator.translateText(
                                                  NO_LONGER_RUNS_LABEL,
                                                )}
                                              </span>
                                            </div>
                                          ) : (
                                            <></>
                                          )}
                                        </div>
                                        {isCollapsed && (
                                          <div className="text-xs text-gray-500 truncate">
                                            {summary}
                                          </div>
                                        )}
                                      </div>
                                    </button>
                                    <div className="relative z-10 flex-shrink-0 flex items-center gap-1">
                                      <Button
                                        icon={IconProp.Trash}
                                        buttonStyle={ButtonStyleType.ICON}
                                        buttonSize={ButtonSize.Small}
                                        ariaLabel={translator.translateTemplate(
                                          "Delete {{itemName}}",
                                          {
                                            itemName: step.title || meta.label,
                                          },
                                        )}
                                        onClick={() => {
                                          return remove(idx);
                                        }}
                                      />
                                    </div>
                                  </div>

                                  <div
                                    className={`transition-all duration-200 ease-in-out overflow-hidden ${
                                      isCollapsed ? "max-h-0" : "max-h-[5000px]"
                                    }`}
                                  >
                                    <div className="border-t border-gray-100 px-5 py-4 bg-white">
                                      {renderStepBody(step, idx)}
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          </Draggable>
                        );
                      })}
                      {droppableProvided.placeholder}
                    </div>
                  );
                }}
              </Droppable>
            </DragDropContext>

            {steps.length > 0 && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 mt-1">
                <div className="text-xs font-medium text-gray-500 mb-3 text-center uppercase tracking-wide">
                  {translator.translateText("Add another step")}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {ALL_STEP_TYPES.map((t: RunbookStepType) => {
                    const meta: StepTypeMeta = STEP_TYPE_META[t];
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          return add(t);
                        }}
                        /*
                         * A column from the top, like the first step's
                         * cards: a button centres what it holds, so a card
                         * beside a taller one had its icon lower.
                         */
                        className={`group flex flex-col items-start justify-start text-left rounded-lg border border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm transition p-3 focus:outline-none focus:ring-2 focus:ring-indigo-300`}
                      >
                        <div
                          className={`inline-flex items-center justify-center h-8 w-8 rounded-lg ${meta.bg} ring-1 ${meta.ring} mb-2`}
                        >
                          <Icon
                            icon={meta.icon}
                            size={SizeProp.Regular}
                            className={`h-4 w-4 ${meta.iconColor}`}
                          />
                        </div>
                        <div className="text-sm font-semibold text-gray-900">
                          {meta.shortLabel}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                          {translator.translateText(meta.description)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {steps.length > 0 ? (
            <div className="mt-6 flex items-center justify-end gap-3">
              {hasUnsaved ? (
                <span className="text-xs text-amber-600 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  {translator.translateText("You have unsaved changes")}
                </span>
              ) : null}
              <Button
                title={isSaving ? "Saving..." : "Save Steps"}
                buttonStyle={ButtonStyleType.PRIMARY}
                onClick={() => {
                  void save();
                }}
                disabled={isSaving || !hasUnsaved}
              />
            </div>
          ) : null}
        </>
      </Card>

      {success && (
        <ConfirmModal
          title="Saved"
          description="Runbook steps saved successfully."
          submitButtonText="Got it"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setSuccess(false);
          }}
        />
      )}

      {error && (
        <ConfirmModal
          title="Could not save"
          description={error}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setError("");
          }}
        />
      )}
    </Fragment>
  );
};

export default Steps;
