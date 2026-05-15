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
import RunbookAgent, {
  RunbookAgentConnectionStatus,
} from "Common/Models/DatabaseModels/RunbookAgent";
import { JSONArray } from "Common/Types/JSON";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  BashStepConfig,
  HttpRequestMethod,
  HttpRequestStepConfig,
  JavaScriptStepConfig,
  RunbookStep,
} from "Common/Types/Runbook/RunbookStep";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
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
  connected: boolean;
}

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
};

const ALL_STEP_TYPES: RunbookStepType[] = [
  RunbookStepType.Manual,
  RunbookStepType.JavaScript,
  RunbookStepType.HttpRequest,
  RunbookStepType.Bash,
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
  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>(
    {},
  );

  useAsyncEffect(async () => {
    try {
      const [runbook, agentList] = await Promise.all([
        ModelAPI.getItem<Runbook>({
          modelType: Runbook,
          id: modelId,
          select: { steps: true },
          requestOptions: {},
        }),
        ModelAPI.getList<RunbookAgent>({
          modelType: RunbookAgent,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          select: {
            _id: true,
            name: true,
            connectionStatus: true,
          },
          sort: { name: SortOrder.Ascending },
          limit: LIMIT_MAX,
          skip: 0,
        }),
      ]);

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

      const result: ListResult<RunbookAgent> = agentList;
      setAgents(
        result.data.map((a: RunbookAgent): AgentOption => {
          return {
            id: a._id?.toString() || "",
            name: a.name || "Unnamed agent",
            connected:
              (a.connectionStatus as unknown as string) ===
              RunbookAgentConnectionStatus.Connected,
          };
        }),
      );
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
        label: `${a.name} ${a.connected ? "· connected" : "· disconnected"}`,
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
          Runbook Agent
        </label>
        {agents.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No Runbook Agents in this project yet. Create one under{" "}
            <strong>Runbooks &rsaquo; Agents</strong>, then come back to pick it
            here.
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-w-4xl mx-auto">
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
                                                  the selected Runbook Agent in
                                                  your own infrastructure. The
                                                  step waits until this agent
                                                  claims the job, or fails after
                                                  the claim timeout.
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
                                                capture output. Default timeout
                                                30s. No filesystem, network, or
                                                process access.
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
                                                  Runbook Agent in your own
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
