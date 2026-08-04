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
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookCredential from "Common/Models/DatabaseModels/RunbookCredential";
import RunbookCredentialType from "Common/Types/Runbook/RunbookCredentialType";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerLiveStatus, {
  getRunnerLiveStatus,
  getRunnerLiveStatusLabel,
} from "Common/Types/Runner/RunnerLiveStatus";
import useTranslateValue, {
  UseTranslateValueResult,
} from "Common/UI/Utils/Translation";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  AIStepConfig,
  BashStepConfig,
  HttpRequestMethod,
  HttpRequestStepConfig,
  JavaScriptStepConfig,
  KubernetesAction,
  KubernetesStepConfig,
  KubernetesWorkloadKind,
  RunbookStep,
  SSHStepConfig,
} from "Common/Types/Runbook/RunbookStep";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import StepTimeoutInput from "Common/UI/Components/Runbook/StepTimeoutInput";
import {
  AGENT_CLAIM_TIMEOUT_BOUNDS,
  STEP_EXECUTION_TIMEOUT_BOUNDS,
} from "Common/Types/Runbook/RunbookStepTimeout";
import UUID from "Common/Utils/UUID";
import { useAsyncEffect } from "use-async-effect";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
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

interface AgentOption {
  id: string;
  name: string;
  liveStatus: RunnerLiveStatus;
}

/*
 * The timeout fields shared by every step that is dispatched to a Runner.
 */
interface RunnerExecutedStepTimeouts {
  timeoutInMs?: number | undefined;
  claimTimeoutInMs?: number | undefined;
}

interface CredentialOption {
  id: string;
  name: string;
  credentialType: RunbookCredentialType;
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
    description: "Run a sandboxed JS snippet. Capture output and return value.",
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
    description: "Run a shell command on the agent.",
    icon: IconProp.Terminal,
    bg: "bg-slate-50",
    ring: "ring-slate-200",
    iconColor: "text-slate-600",
    numberBg: "bg-slate-700",
    borderL: "border-l-slate-500",
  },
  [RunbookStepType.SSH]: {
    type: RunbookStepType.SSH,
    label: "SSH command",
    shortLabel: "SSH",
    description:
      "Run a command on a remote host, using a stored SSH credential.",
    icon: IconProp.Terminal,
    bg: "bg-emerald-50",
    ring: "ring-emerald-100",
    iconColor: "text-emerald-600",
    numberBg: "bg-emerald-600",
    borderL: "border-l-emerald-500",
  },
  [RunbookStepType.Kubernetes]: {
    type: RunbookStepType.Kubernetes,
    label: "Kubernetes action",
    shortLabel: "Kubernetes",
    description: "Restart or scale a workload in a cluster.",
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
};

const ALL_STEP_TYPES: RunbookStepType[] = [
  RunbookStepType.Manual,
  RunbookStepType.JavaScript,
  RunbookStepType.HttpRequest,
  RunbookStepType.Bash,
  RunbookStepType.SSH,
  RunbookStepType.Kubernetes,
  RunbookStepType.AI,
];

interface ScriptExample {
  label: string;
  description: string;
  code: string;
}

/*
 * JavaScript runs inside an isolated-vm sandbox on the agent.
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
 * Bash runs via \`bash -c "<script>"\` on the agent's machine.
 * Standard shell tools (curl, jq, grep, awk, etc.) are available
 * if they are installed on the agent. Output is capped at 50 KB.
 */
const BASH_EXAMPLES: Array<ScriptExample> = [
  {
    label: "Hello world",
    description: "Echo a message and exit cleanly.",
    code: `echo "Runbook step running on $(hostname) at $(date -Iseconds)"`,
  },
  {
    label: "Check disk usage",
    description: "Report disk usage on the agent host.",
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
  echo "Log file $LOG not found on this agent"
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
                  credentialId: "",
                  command: "",
                  agentId: "",
                } as SSHStepConfig)
              : type === RunbookStepType.Kubernetes
                ? ({
                    credentialId: "",
                    action: KubernetesAction.RestartWorkload,
                    workloadKind: KubernetesWorkloadKind.Deployment,
                    namespace: "default",
                    workloadName: "",
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
    base.requireApproval = false;
  }
  return base;
}

function summarizeStep(step: RunbookStep): string {
  if (step.type === RunbookStepType.HttpRequest) {
    const cfg: HttpRequestStepConfig = step.config as HttpRequestStepConfig;
    const method: string = cfg.method || "GET";
    const url: string = cfg.url || "https://";
    return `${method} ${url}`;
  }
  if (step.type === RunbookStepType.JavaScript) {
    return "Sandboxed JavaScript snippet";
  }
  if (step.type === RunbookStepType.Bash) {
    return "Bash script on agent";
  }
  if (step.type === RunbookStepType.SSH) {
    const cfg: SSHStepConfig = step.config as SSHStepConfig;
    const command: string = (cfg.command || "").split("\n")[0] || "";
    return command
      ? `SSH: ${command.slice(0, 80)}${command.length > 80 ? "…" : ""}`
      : "SSH command";
  }
  if (step.type === RunbookStepType.Kubernetes) {
    const cfg: KubernetesStepConfig = step.config as KubernetesStepConfig;
    const verb: string =
      cfg.action === KubernetesAction.ScaleWorkload
        ? `Scale to ${cfg.replicas ?? "?"}`
        : "Restart";
    return `${verb}: ${cfg.namespace || "?"}/${cfg.workloadName || "?"}`;
  }
  if (step.type === RunbookStepType.AI) {
    const cfg: AIStepConfig = step.config as AIStepConfig;
    const firstLine: string = (cfg.prompt || "").split("\n")[0] || "";
    return firstLine
      ? `AI: ${firstLine.slice(0, 80)}${firstLine.length > 80 ? "…" : ""}`
      : "AI prompt";
  }
  return "Manual checklist item";
}

const Steps: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [steps, setSteps] = useState<RunbookStep[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<boolean>(false);
  const [hasUnsaved, setHasUnsaved] = useState<boolean>(false);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);
  const [llmProviders, setLlmProviders] = useState<LlmProviderOption[]>([]);

  const { translateString }: UseTranslateValueResult = useTranslateValue();

  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>(
    {},
  );

  useAsyncEffect(async () => {
    try {
      const [runbook, agentList, credentialList] = await Promise.all([
        ModelAPI.getItem<Runbook>({
          modelType: Runbook,
          id: modelId,
          select: { steps: true },
          requestOptions: {},
        }),
        ModelAPI.getList<Runner>({
          modelType: Runner,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          select: {
            _id: true,
            name: true,
            lastAlive: true,
          },
          sort: { name: SortOrder.Ascending },
          limit: LIMIT_MAX,
          skip: 0,
        }),
        ModelAPI.getList<RunbookCredential>({
          modelType: RunbookCredential,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          select: {
            _id: true,
            name: true,
            credentialType: true,
          },
          sort: { name: SortOrder.Ascending },
          limit: LIMIT_MAX,
          skip: 0,
        }),
      ]);

      setCredentials(
        credentialList.data.map((c: RunbookCredential): CredentialOption => {
          return {
            id: c._id?.toString() || "",
            name: c.name || "Unnamed credential",
            credentialType:
              (c.credentialType as RunbookCredentialType) ||
              RunbookCredentialType.SSH,
          };
        }),
      );

      const loaded: RunbookStep[] =
        (runbook?.steps as unknown as RunbookStep[]) || [];
      loaded.sort((a: RunbookStep, b: RunbookStep) => {
        return (a.order ?? 0) - (b.order ?? 0);
      });
      const initialCollapsed: Record<string, boolean> = {};
      loaded.forEach((s: RunbookStep, idx: number) => {
        s.order = idx;
        if (!s.id) {
          s.id = UUID.generate();
        }
        // Default existing steps to collapsed so the page is scannable.
        initialCollapsed[s.id] = true;
      });
      setSteps(loaded);
      setCollapsedState(initialCollapsed);

      const result: ListResult<Runner> = agentList;
      setAgents(
        result.data.map((a: Runner): AgentOption => {
          return {
            id: a._id?.toString() || "",
            name: a.name || "Unnamed Runner",
            liveStatus: getRunnerLiveStatus(a.lastAlive),
          };
        }),
      );

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
      const current: RunbookStep = copy[idx]!;
      copy[idx] = {
        ...current,
        config: {
          ...(current.config as Record<string, unknown>),
          ...patch,
        } as never,
      };
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

  const renderScriptExamples: (args: {
    examples: Array<ScriptExample>;
    onInsert: (code: string) => void;
  }) => ReactElement = (args: {
    examples: Array<ScriptExample>;
    onInsert: (code: string) => void;
  }): ReactElement => {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="flex items-center gap-1.5 mb-2">
          <Icon
            icon={IconProp.LightBulb}
            size={SizeProp.Smaller}
            className="text-gray-500"
          />
          <span className="text-xs font-medium text-gray-700">
            Examples — click to insert
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {args.examples.map((ex: ScriptExample) => {
            return (
              <button
                key={ex.label}
                type="button"
                title={ex.description}
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
                {ex.label}
              </button>
            );
          })}
        </div>
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

  const agentDropdownOptions: Array<DropdownOption> = agents.map(
    (a: AgentOption): DropdownOption => {
      return {
        value: a.id,
        /*
         * Dropdown translates an option label as one whole string, so the
         * composed "name · status" can never match a key. The status word is
         * therefore translated on its own and then joined — and it reuses the
         * same three labels the status bubble uses, which every locale
         * already carries.
         */
        label: `${a.name} · ${
          translateString(getRunnerLiveStatusLabel(a.liveStatus)) ||
          getRunnerLiveStatusLabel(a.liveStatus)
        }`,
      };
    },
  );

  const renderAgentPicker: (args: {
    currentAgentId: string;
    onChange: (id: string) => void;
    helperText: ReactElement;
  }) => ReactElement = (args: {
    currentAgentId: string;
    onChange: (id: string) => void;
    helperText: ReactElement;
  }): ReactElement => {
    const currentOption: DropdownOption | undefined = agentDropdownOptions.find(
      (o: DropdownOption) => {
        return o.value === args.currentAgentId;
      },
    );

    const options: Array<DropdownOption> = currentOption
      ? agentDropdownOptions
      : args.currentAgentId
        ? [
            {
              value: args.currentAgentId,
              label: `Unknown agent (${args.currentAgentId})`,
            },
            ...agentDropdownOptions,
          ]
        : agentDropdownOptions;

    const selectedOption: DropdownOption | undefined =
      currentOption ||
      (args.currentAgentId
        ? {
            value: args.currentAgentId,
            label: `Unknown agent (${args.currentAgentId})`,
          }
        : undefined);

    return (
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">
          Runner
        </label>
        {agents.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No Runners in this project yet. Create one under{" "}
            <strong>Settings &rsaquo; Runners</strong>, then come back to pick
            it here.
          </div>
        ) : (
          <Dropdown
            options={options}
            value={selectedOption}
            placeholder="— Select an agent —"
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              const id: string =
                value === null || value === undefined
                  ? ""
                  : Array.isArray(value)
                    ? String(value[0] ?? "")
                    : String(value);
              args.onChange(id);
            }}
          />
        )}
        <p className="text-xs text-gray-500 mt-1.5">{args.helperText}</p>
      </div>
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
            label: `Unavailable provider (${args.currentProviderId})`,
          }
        : undefined;

    const options: Array<DropdownOption> = [
      defaultOption,
      ...(staleOption ? [staleOption] : []),
      ...providerOptions,
    ];

    return (
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">
          LLM provider <span className="text-gray-400">(optional)</span>
        </label>
        <Dropdown
          options={options}
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
              The provider pinned on this step is no longer available to this
              project, so the step will fail when it runs. Pick another
              provider, or switch back to the project default.
            </span>
          ) : (
            <>
              Leave this on <strong>Project default</strong> unless this step
              needs a specific model — a cheaper one for routine triage, or a
              self-hosted one for data that should not leave your network.
              Changing the project default later moves every step still set to
              default; a pinned step stays where you put it.
            </>
          )}
        </p>
      </div>
    );
  };

  /*
   * SSH and Kubernetes steps name a credential rather than embedding one.
   * Only credentials of the right type are offered — an SSH step pointed at a
   * Kubernetes credential fails at execution time, in front of an incident.
   */
  const renderCredentialPicker: (args: {
    currentCredentialId: string;
    credentialType: RunbookCredentialType;
    onChange: (id: string) => void;
    helperText: ReactElement;
  }) => ReactElement = (args: {
    currentCredentialId: string;
    credentialType: RunbookCredentialType;
    onChange: (id: string) => void;
    helperText: ReactElement;
  }): ReactElement => {
    const usable: Array<CredentialOption> = credentials.filter(
      (c: CredentialOption) => {
        return c.credentialType === args.credentialType;
      },
    );

    const options: Array<DropdownOption> = usable.map(
      (c: CredentialOption): DropdownOption => {
        return { value: c.id, label: c.name };
      },
    );

    const selectedOption: DropdownOption | undefined =
      options.find((o: DropdownOption) => {
        return o.value === args.currentCredentialId;
      }) ||
      (args.currentCredentialId
        ? {
            value: args.currentCredentialId,
            label: `Unknown credential (${args.currentCredentialId})`,
          }
        : undefined);

    return (
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">
          Credential
        </label>
        {usable.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No {args.credentialType} credentials in this project yet. Create one
            under <strong>Settings &rsaquo; Credentials</strong>, assign it to
            the Runner that will use it, then come back and pick it here.
          </div>
        ) : (
          <Dropdown
            options={
              selectedOption &&
              !options.find((o: DropdownOption) => {
                return o.value === selectedOption.value;
              })
                ? [selectedOption, ...options]
                : options
            }
            value={selectedOption}
            placeholder="— Select a credential —"
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              const id: string =
                value === null || value === undefined
                  ? ""
                  : Array.isArray(value)
                    ? String(value[0] ?? "")
                    : String(value);
              args.onChange(id);
            }}
          />
        )}
        <p className="text-xs text-gray-500 mt-1.5">{args.helperText}</p>
      </div>
    );
  };

  /*
   * Bash and JavaScript are dispatched to an agent, so they carry two
   * timeouts: how long the Worker waits for an agent to pick the job up, and
   * how long the agent lets the script run once it has.
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
  }) => ReactElement = (args: {
    idx: number;
    config: RunnerExecutedStepTimeouts;
    executionDescription: ReactElement;
  }): ReactElement => {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <StepTimeoutInput
          label="Execution timeout"
          value={args.config.timeoutInMs}
          bounds={STEP_EXECUTION_TIMEOUT_BOUNDS}
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
              How long the Worker waits for the selected agent to pick this job
              up before failing the step as timed out. Leave room for at least
              one of the agent&rsquo;s poll cycles (5 seconds by default) and
              for any step already running on it &mdash; an agent runs one job
              at a time.
            </>
          }
          onChange={(claimTimeoutInMs: number | undefined) => {
            updateConfig(args.idx, { claimTimeoutInMs });
          }}
        />
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
        description="Ordered list of steps to run. Manual steps pause the runbook until a responder ticks them off; automated steps run inline. Drag steps to reorder."
        rightElement={
          steps.length > 0 ? (
            <div className="flex items-center gap-2">
              {hasUnsaved ? (
                <span className="text-xs text-amber-600 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  Unsaved changes
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
                    Start your runbook
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Add the first step. You can reorder and edit at any time.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 max-w-5xl mx-auto">
                  {ALL_STEP_TYPES.map((t: RunbookStepType) => {
                    const meta: StepTypeMeta = STEP_TYPE_META[t];
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          return add(t);
                        }}
                        className={`group text-left rounded-lg border border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm transition p-4 focus:outline-none focus:ring-2 focus:ring-indigo-300`}
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
                          {meta.description}
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
                        const summary: string = summarizeStep(step);
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
                                  <div
                                    className="flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                                    role="button"
                                    tabIndex={0}
                                    aria-expanded={!isCollapsed}
                                    onClick={() => {
                                      toggleCollapsed(stepId);
                                    }}
                                    onKeyDown={(e: React.KeyboardEvent) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        toggleCollapsed(stepId);
                                      }
                                    }}
                                  >
                                    <div
                                      {...draggableProvided.dragHandleProps}
                                      onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation();
                                      }}
                                      onKeyDown={(e: React.KeyboardEvent) => {
                                        e.stopPropagation();
                                      }}
                                      className="flex-shrink-0 cursor-ns-resize text-gray-400 hover:text-gray-600"
                                      aria-label="Drag to reorder step"
                                      title="Drag to reorder"
                                    >
                                      <Icon
                                        icon={IconProp.GripVertical}
                                        className="w-4 h-4"
                                      />
                                    </div>
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
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${meta.bg} ${meta.iconColor} ring-1 ring-inset ${meta.ring} flex-shrink-0`}
                                    >
                                      <Icon
                                        icon={meta.icon}
                                        size={SizeProp.Smaller}
                                        className={meta.iconColor}
                                      />
                                      {meta.shortLabel}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="text-sm font-semibold text-gray-900 truncate">
                                        {step.title || meta.label}
                                      </div>
                                      {isCollapsed && (
                                        <div className="text-xs text-gray-500 truncate">
                                          {summary}
                                        </div>
                                      )}
                                    </div>
                                    <div
                                      className="flex-shrink-0 flex items-center gap-1"
                                      onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation();
                                      }}
                                      onKeyDown={(e: React.KeyboardEvent) => {
                                        e.stopPropagation();
                                      }}
                                    >
                                      <Button
                                        icon={IconProp.Trash}
                                        buttonStyle={ButtonStyleType.ICON}
                                        buttonSize={ButtonSize.Small}
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
                                      <div className="flex flex-col gap-4">
                                        <div>
                                          <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                            Title
                                          </label>
                                          <Input
                                            value={step.title}
                                            onChange={(v: string) => {
                                              return updateStep(idx, {
                                                title: v,
                                              });
                                            }}
                                            placeholder="What does this step do?"
                                          />
                                        </div>

                                        <div>
                                          <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                            Description
                                            <span className="ml-2 text-[10px] font-normal text-gray-400">
                                              Markdown supported
                                            </span>
                                          </label>
                                          <TextArea
                                            value={step.description || ""}
                                            onChange={(v: string) => {
                                              return updateStep(idx, {
                                                description: v,
                                              });
                                            }}
                                            placeholder={
                                              step.type ===
                                              RunbookStepType.Manual
                                                ? "Instructions the responder will see when they reach this step. Markdown is supported."
                                                : "Optional notes about what this step does. Markdown is supported."
                                            }
                                          />
                                        </div>

                                        {step.type ===
                                          RunbookStepType.JavaScript && (
                                          <div className="flex flex-col gap-3">
                                            {renderAgentPicker({
                                              currentAgentId:
                                                (
                                                  step.config as JavaScriptStepConfig
                                                ).agentId || "",
                                              onChange: (id: string) => {
                                                updateConfig(idx, {
                                                  agentId: id,
                                                });
                                              },
                                              helperText: (
                                                <>
                                                  JavaScript runs sandboxed on
                                                  the selected Runner in your
                                                  own infrastructure. The step
                                                  waits until this agent claims
                                                  the job, or fails after the
                                                  claim timeout.
                                                </>
                                              ),
                                            })}
                                            <div>
                                              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                Script
                                              </label>
                                              <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
                                                <CodeEditor
                                                  type={CodeType.JavaScript}
                                                  value={
                                                    (
                                                      step.config as JavaScriptStepConfig
                                                    ).script || ""
                                                  }
                                                  onChange={(v: string) => {
                                                    return updateConfig(idx, {
                                                      script: v,
                                                    });
                                                  }}
                                                />
                                              </div>
                                              <p className="text-xs text-gray-500 mt-1.5">
                                                Sandboxed via{" "}
                                                <code>isolated-vm</code> on the
                                                agent. Use{" "}
                                                <code>return value</code> to
                                                capture output. No filesystem,
                                                network, or process access.
                                              </p>
                                              <div className="mt-2">
                                                {renderScriptExamples({
                                                  examples: JAVASCRIPT_EXAMPLES,
                                                  onInsert: (code: string) => {
                                                    updateConfig(idx, {
                                                      script: code,
                                                    });
                                                  },
                                                })}
                                              </div>
                                            </div>
                                            {renderAgentTimeouts({
                                              idx,
                                              config:
                                                step.config as JavaScriptStepConfig,
                                              executionDescription: (
                                                <>
                                                  How long the agent lets the
                                                  script run before tearing the
                                                  isolate down.
                                                </>
                                              ),
                                            })}
                                          </div>
                                        )}

                                        {step.type ===
                                          RunbookStepType.HttpRequest && (
                                          <div className="flex flex-col gap-3">
                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                              <div className="md:col-span-1">
                                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                  Method
                                                </label>
                                                <Dropdown
                                                  options={HTTP_METHOD_OPTIONS}
                                                  value={HTTP_METHOD_OPTIONS.find(
                                                    (o: DropdownOption) => {
                                                      return (
                                                        o.value ===
                                                        ((
                                                          step.config as HttpRequestStepConfig
                                                        ).method || "GET")
                                                      );
                                                    },
                                                  )}
                                                  onChange={(
                                                    value:
                                                      | DropdownValue
                                                      | Array<DropdownValue>
                                                      | null,
                                                  ): void => {
                                                    const method: HttpRequestMethod =
                                                      (Array.isArray(value)
                                                        ? (value[0] as HttpRequestMethod)
                                                        : (value as HttpRequestMethod)) ||
                                                      "GET";
                                                    updateConfig(idx, {
                                                      method,
                                                    });
                                                  }}
                                                />
                                              </div>
                                              <div className="md:col-span-3">
                                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                  URL
                                                </label>
                                                <Input
                                                  value={
                                                    (
                                                      step.config as HttpRequestStepConfig
                                                    ).url || ""
                                                  }
                                                  onChange={(v: string) => {
                                                    return updateConfig(idx, {
                                                      url: v,
                                                    });
                                                  }}
                                                  placeholder="https://api.example.com/incident"
                                                />
                                              </div>
                                            </div>
                                            <div>
                                              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                Headers (JSON)
                                              </label>
                                              <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
                                                <CodeEditor
                                                  type={CodeType.JSON}
                                                  value={
                                                    (
                                                      step.config as HttpRequestStepConfig
                                                    ).headersJson || ""
                                                  }
                                                  onChange={(v: string) => {
                                                    return updateConfig(idx, {
                                                      headersJson: v,
                                                    });
                                                  }}
                                                  placeholder={
                                                    '{ "Authorization": "Bearer ..." }'
                                                  }
                                                />
                                              </div>
                                            </div>
                                            <div>
                                              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                Body
                                              </label>
                                              <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
                                                <CodeEditor
                                                  type={CodeType.JSON}
                                                  value={
                                                    (
                                                      step.config as HttpRequestStepConfig
                                                    ).body || ""
                                                  }
                                                  onChange={(v: string) => {
                                                    return updateConfig(idx, {
                                                      body: v,
                                                    });
                                                  }}
                                                  placeholder='{ "message": "..." }'
                                                />
                                              </div>
                                            </div>
                                            <StepTimeoutInput
                                              label="Request timeout"
                                              value={
                                                (
                                                  step.config as HttpRequestStepConfig
                                                ).timeoutInMs
                                              }
                                              bounds={
                                                STEP_EXECUTION_TIMEOUT_BOUNDS
                                              }
                                              description={
                                                <>
                                                  How long to wait for the
                                                  endpoint to respond before
                                                  failing the step.
                                                </>
                                              }
                                              onChange={(
                                                timeoutInMs: number | undefined,
                                              ) => {
                                                updateConfig(idx, {
                                                  timeoutInMs,
                                                });
                                              }}
                                            />
                                          </div>
                                        )}

                                        {step.type === RunbookStepType.Bash && (
                                          <div className="flex flex-col gap-3">
                                            {renderAgentPicker({
                                              currentAgentId:
                                                (step.config as BashStepConfig)
                                                  .agentId || "",
                                              onChange: (id: string) => {
                                                updateConfig(idx, {
                                                  agentId: id,
                                                });
                                              },
                                              helperText: (
                                                <>
                                                  Bash runs on the selected
                                                  Runner in your own
                                                  infrastructure. The step waits
                                                  until this agent claims the
                                                  job, or fails after the claim
                                                  timeout.
                                                </>
                                              ),
                                            })}
                                            <div>
                                              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                Bash script
                                              </label>
                                              <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
                                                <CodeEditor
                                                  type={CodeType.Text}
                                                  value={
                                                    (
                                                      step.config as BashStepConfig
                                                    ).script || ""
                                                  }
                                                  onChange={(v: string) => {
                                                    return updateConfig(idx, {
                                                      script: v,
                                                    });
                                                  }}
                                                />
                                              </div>
                                              <p className="text-xs text-gray-500 mt-1.5">
                                                Runs via <code>bash -c</code> on
                                                the selected agent. Output is
                                                capped at 50&nbsp;KB. Non-zero
                                                exit codes fail the step.
                                              </p>
                                              <div className="mt-2">
                                                {renderScriptExamples({
                                                  examples: BASH_EXAMPLES,
                                                  onInsert: (code: string) => {
                                                    updateConfig(idx, {
                                                      script: code,
                                                    });
                                                  },
                                                })}
                                              </div>
                                            </div>
                                            {renderAgentTimeouts({
                                              idx,
                                              config:
                                                step.config as BashStepConfig,
                                              executionDescription: (
                                                <>
                                                  How long the agent lets the
                                                  script run before killing it
                                                  with <code>SIGKILL</code>.
                                                </>
                                              ),
                                            })}
                                          </div>
                                        )}

                                        {step.type === RunbookStepType.SSH && (
                                          <div className="flex flex-col gap-3">
                                            {renderAgentPicker({
                                              currentAgentId:
                                                (step.config as SSHStepConfig)
                                                  .agentId || "",
                                              onChange: (id: string) => {
                                                updateConfig(idx, {
                                                  agentId: id,
                                                });
                                              },
                                              helperText: (
                                                <>
                                                  This Runner opens the SSH
                                                  connection, so it must be able
                                                  to reach the host.
                                                </>
                                              ),
                                            })}
                                            {renderCredentialPicker({
                                              currentCredentialId:
                                                (step.config as SSHStepConfig)
                                                  .credentialId || "",
                                              credentialType:
                                                RunbookCredentialType.SSH,
                                              onChange: (id: string) => {
                                                updateConfig(idx, {
                                                  credentialId: id,
                                                });
                                              },
                                              helperText: (
                                                <>
                                                  The host, user and key. It
                                                  must be assigned to the Runner
                                                  above, or the step fails.
                                                </>
                                              ),
                                            })}
                                            <div>
                                              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                Command
                                              </label>
                                              <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
                                                <CodeEditor
                                                  type={CodeType.Text}
                                                  value={
                                                    (
                                                      step.config as SSHStepConfig
                                                    ).command || ""
                                                  }
                                                  onChange={(v: string) => {
                                                    return updateConfig(idx, {
                                                      command: v,
                                                    });
                                                  }}
                                                />
                                              </div>
                                              <p className="text-xs text-gray-500 mt-1.5">
                                                Runs on the remote host as the
                                                credential&rsquo;s user. Output
                                                is capped at 50&nbsp;KB and a
                                                non-zero exit code fails the
                                                step.
                                              </p>
                                            </div>
                                            {renderAgentTimeouts({
                                              idx,
                                              config:
                                                step.config as SSHStepConfig,
                                              executionDescription: (
                                                <>
                                                  Covers connecting,
                                                  authenticating and running the
                                                  command together.
                                                </>
                                              ),
                                            })}
                                          </div>
                                        )}

                                        {step.type ===
                                          RunbookStepType.Kubernetes && (
                                          <div className="flex flex-col gap-3">
                                            {renderAgentPicker({
                                              currentAgentId:
                                                (
                                                  step.config as KubernetesStepConfig
                                                ).agentId || "",
                                              onChange: (id: string) => {
                                                updateConfig(idx, {
                                                  agentId: id,
                                                });
                                              },
                                              helperText: (
                                                <>
                                                  This Runner calls the cluster
                                                  API server, so it must be able
                                                  to reach it.
                                                </>
                                              ),
                                            })}
                                            {renderCredentialPicker({
                                              currentCredentialId:
                                                (
                                                  step.config as KubernetesStepConfig
                                                ).credentialId || "",
                                              credentialType:
                                                RunbookCredentialType.Kubernetes,
                                              onChange: (id: string) => {
                                                updateConfig(idx, {
                                                  credentialId: id,
                                                });
                                              },
                                              helperText: (
                                                <>
                                                  The API server and service
                                                  account token. Bind that
                                                  account to a role allowing
                                                  only what your runbooks need.
                                                </>
                                              ),
                                            })}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                              <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                  Action
                                                </label>
                                                <Dropdown
                                                  options={[
                                                    {
                                                      value:
                                                        KubernetesAction.RestartWorkload,
                                                      label: "Restart workload",
                                                    },
                                                    {
                                                      value:
                                                        KubernetesAction.ScaleWorkload,
                                                      label: "Scale workload",
                                                    },
                                                  ]}
                                                  value={{
                                                    value:
                                                      (
                                                        step.config as KubernetesStepConfig
                                                      ).action ||
                                                      KubernetesAction.RestartWorkload,
                                                    label:
                                                      (
                                                        step.config as KubernetesStepConfig
                                                      ).action ===
                                                      KubernetesAction.ScaleWorkload
                                                        ? "Scale workload"
                                                        : "Restart workload",
                                                  }}
                                                  onChange={(
                                                    value:
                                                      | DropdownValue
                                                      | Array<DropdownValue>
                                                      | null,
                                                  ): void => {
                                                    updateConfig(idx, {
                                                      action: String(
                                                        value,
                                                      ) as KubernetesAction,
                                                    });
                                                  }}
                                                />
                                              </div>
                                              <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                  Workload kind
                                                </label>
                                                <Dropdown
                                                  options={[
                                                    {
                                                      value:
                                                        KubernetesWorkloadKind.Deployment,
                                                      label: "Deployment",
                                                    },
                                                    {
                                                      value:
                                                        KubernetesWorkloadKind.StatefulSet,
                                                      label: "StatefulSet",
                                                    },
                                                    {
                                                      value:
                                                        KubernetesWorkloadKind.DaemonSet,
                                                      label: "DaemonSet",
                                                    },
                                                  ]}
                                                  value={{
                                                    value:
                                                      (
                                                        step.config as KubernetesStepConfig
                                                      ).workloadKind ||
                                                      KubernetesWorkloadKind.Deployment,
                                                    label:
                                                      (
                                                        step.config as KubernetesStepConfig
                                                      ).workloadKind ||
                                                      KubernetesWorkloadKind.Deployment,
                                                  }}
                                                  onChange={(
                                                    value:
                                                      | DropdownValue
                                                      | Array<DropdownValue>
                                                      | null,
                                                  ): void => {
                                                    updateConfig(idx, {
                                                      workloadKind: String(
                                                        value,
                                                      ) as KubernetesWorkloadKind,
                                                    });
                                                  }}
                                                />
                                              </div>
                                              <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                  Namespace
                                                </label>
                                                <Input
                                                  value={
                                                    (
                                                      step.config as KubernetesStepConfig
                                                    ).namespace || ""
                                                  }
                                                  placeholder="default"
                                                  onChange={(v: string) => {
                                                    return updateConfig(idx, {
                                                      namespace: v,
                                                    });
                                                  }}
                                                />
                                              </div>
                                              <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                  Workload name
                                                </label>
                                                <Input
                                                  value={
                                                    (
                                                      step.config as KubernetesStepConfig
                                                    ).workloadName || ""
                                                  }
                                                  placeholder="checkout-api"
                                                  onChange={(v: string) => {
                                                    return updateConfig(idx, {
                                                      workloadName: v,
                                                    });
                                                  }}
                                                />
                                              </div>
                                            </div>
                                            {(
                                              step.config as KubernetesStepConfig
                                            ).action ===
                                              KubernetesAction.ScaleWorkload && (
                                              <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                  Replicas
                                                </label>
                                                <Input
                                                  value={String(
                                                    (
                                                      step.config as KubernetesStepConfig
                                                    ).replicas ?? "",
                                                  )}
                                                  placeholder="3"
                                                  onChange={(v: string) => {
                                                    const parsed: number =
                                                      parseInt(v, 10);
                                                    return updateConfig(idx, {
                                                      replicas: isNaN(parsed)
                                                        ? undefined
                                                        : Math.max(0, parsed),
                                                    });
                                                  }}
                                                />
                                                <p className="text-xs text-gray-500 mt-1.5">
                                                  Zero is allowed — draining a
                                                  workload is a remediation.
                                                  DaemonSets cannot be scaled.
                                                </p>
                                              </div>
                                            )}
                                            {renderAgentTimeouts({
                                              idx,
                                              config:
                                                step.config as KubernetesStepConfig,
                                              executionDescription: (
                                                <>
                                                  How long the Runner waits for
                                                  the API server to accept the
                                                  change.
                                                </>
                                              ),
                                            })}
                                          </div>
                                        )}

                                        {step.type === RunbookStepType.AI && (
                                          <div className="flex flex-col gap-3">
                                            <div>
                                              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                Prompt
                                              </label>
                                              <TextArea
                                                value={
                                                  (step.config as AIStepConfig)
                                                    .prompt || ""
                                                }
                                                onChange={(v: string) => {
                                                  return updateConfig(idx, {
                                                    prompt: v,
                                                  });
                                                }}
                                                placeholder="What should the AI analyze, summarize or decide? Its response becomes this step's output."
                                              />
                                              <p className="text-xs text-gray-500 mt-1.5">
                                                Runs on the LLM provider
                                                selected below (Settings
                                                &rsaquo; AI &rsaquo; LLM
                                                Providers). Calls are metered
                                                like any other AI feature. Pair
                                                with &ldquo;Require
                                                approval&rdquo; below to have a
                                                human review the AI&rsquo;s
                                                answer before the next step
                                                runs.
                                              </p>
                                              <div className="mt-2">
                                                {renderScriptExamples({
                                                  examples: AI_PROMPT_EXAMPLES,
                                                  onInsert: (code: string) => {
                                                    updateConfig(idx, {
                                                      prompt: code,
                                                    });
                                                  },
                                                })}
                                              </div>
                                            </div>
                                            {renderLlmProviderPicker({
                                              currentProviderId:
                                                (step.config as AIStepConfig)
                                                  .llmProviderId || "",
                                              onChange: (id: string): void => {
                                                updateConfig(idx, {
                                                  llmProviderId: id,
                                                });
                                              },
                                            })}
                                            <Toggle
                                              title="Include previous step context"
                                              description="Give the AI everything about the steps that ran before this one — title, type, status, output and errors."
                                              value={Boolean(
                                                (step.config as AIStepConfig)
                                                  .includePreviousStepContext,
                                              )}
                                              onChange={(v: boolean) => {
                                                return updateConfig(idx, {
                                                  includePreviousStepContext: v,
                                                });
                                              }}
                                            />
                                            <Toggle
                                              title="Include trigger context"
                                              description="Give the AI context about what started this run — the linked incident, alert or scheduled maintenance, or who ran it manually. Private internal notes and Slack/Teams messages are never included, because the AI's answer is stored on the execution, which anyone with runbook-read access can see."
                                              value={Boolean(
                                                (step.config as AIStepConfig)
                                                  .includeTriggerContext,
                                              )}
                                              onChange={(v: boolean) => {
                                                return updateConfig(idx, {
                                                  includeTriggerContext: v,
                                                });
                                              }}
                                            />
                                          </div>
                                        )}

                                        {isAutomatedStep(step.type) && (
                                          <div className="flex flex-col gap-3 pt-1">
                                            <Toggle
                                              title="Continue on failure"
                                              description="If this step fails, continue to the next step instead of stopping the runbook."
                                              value={Boolean(
                                                step.continueOnFailure,
                                              )}
                                              onChange={(v: boolean) => {
                                                return updateStep(idx, {
                                                  continueOnFailure: v,
                                                });
                                              }}
                                            />
                                            <Toggle
                                              title="Require approval before running the next step"
                                              description="After this step completes, pause the runbook and wait for a user to approve before running the next step."
                                              value={Boolean(
                                                step.requireApproval,
                                              )}
                                              onChange={(v: boolean) => {
                                                return updateStep(idx, {
                                                  requireApproval: v,
                                                });
                                              }}
                                            />
                                          </div>
                                        )}
                                      </div>
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
                  Add another step
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {ALL_STEP_TYPES.map((t: RunbookStepType) => {
                    const meta: StepTypeMeta = STEP_TYPE_META[t];
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          return add(t);
                        }}
                        className={`group text-left rounded-lg border border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm transition p-3 focus:outline-none focus:ring-2 focus:ring-indigo-300`}
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
                          {meta.description}
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
                  You have unsaved changes
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
