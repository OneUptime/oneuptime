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
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
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
  },
};

const ALL_STEP_TYPES: RunbookStepType[] = [
  RunbookStepType.Manual,
  RunbookStepType.JavaScript,
  RunbookStepType.HttpRequest,
  RunbookStepType.Bash,
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
            script:
              "// Return a value to capture it on the execution.\nreturn 'ok';",
            agentId: "",
          } as JavaScriptStepConfig)
        : type === RunbookStepType.HttpRequest
          ? ({
              url: "https://",
              method: "GET",
            } as HttpRequestStepConfig)
          : type === RunbookStepType.Bash
            ? ({ script: "echo hello", agentId: "" } as BashStepConfig)
            : {},
  };
  if (isAutomatedStep(type)) {
    base.continueOnFailure = false;
    base.requireApproval = false;
  }
  return base;
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
      loaded.forEach((s: RunbookStep, idx: number) => {
        s.order = idx;
        if (!s.id) {
          s.id = UUID.generate();
        }
      });
      setSteps(loaded);

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

  const move: (idx: number, dir: -1 | 1) => void = (
    idx: number,
    dir: -1 | 1,
  ): void => {
    setSteps((prev: RunbookStep[]) => {
      const target: number = idx + dir;
      if (target < 0 || target >= prev.length) {
        return prev;
      }
      const copy: RunbookStep[] = [...prev];
      const tmp: RunbookStep = copy[idx]!;
      copy[idx] = copy[target]!;
      copy[target] = tmp;
      copy.forEach((s: RunbookStep, i: number) => {
        s.order = i;
      });
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
      return [...prev, newStep(type, prev.length)];
    });
    markDirty();
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

  const renderAgentPicker: (args: {
    currentAgentId: string;
    onChange: (id: string) => void;
    helperText: ReactElement;
  }) => ReactElement = (args: {
    currentAgentId: string;
    onChange: (id: string) => void;
    helperText: ReactElement;
  }): ReactElement => {
    const currentSelected: AgentOption | undefined = agents.find(
      (a: AgentOption) => {
        return a.id === args.currentAgentId;
      },
    );
    const hasStaleSelection: boolean = Boolean(
      args.currentAgentId && !currentSelected,
    );
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
          <select
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={args.currentAgentId || ""}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              args.onChange(e.target.value);
            }}
          >
            <option value="">— Select an agent —</option>
            {hasStaleSelection && (
              <option value={args.currentAgentId}>
                Unknown agent ({args.currentAgentId})
              </option>
            )}
            {agents.map((a: AgentOption) => {
              return (
                <option key={a.id} value={a.id}>
                  {a.name} {a.connected ? "· connected" : "· disconnected"}
                </option>
              );
            })}
          </select>
        )}
        <p className="text-xs text-gray-500 mt-1.5">{args.helperText}</p>
      </div>
    );
  };

  const addMenu: ReactElement = (
    <MoreMenu text="Add Step" menuIcon={IconProp.Add}>
      {ALL_STEP_TYPES.map((t: RunbookStepType) => {
        const meta: StepTypeMeta = STEP_TYPE_META[t];
        return (
          <MoreMenuItem
            key={t}
            text={meta.label}
            icon={meta.icon}
            onClick={() => {
              return add(t);
            }}
          />
        );
      })}
    </MoreMenu>
  );

  return (
    <Fragment>
      <Card
        title="Runbook Steps"
        description="Ordered list of steps to run. Manual steps pause the runbook until a responder ticks them off; automated steps run inline."
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

            {steps.map((step: RunbookStep, idx: number) => {
              const meta: StepTypeMeta = STEP_TYPE_META[step.type];
              return (
                <div
                  key={step.id}
                  className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
                >
                  <div className="flex items-start gap-4 px-5 py-4">
                    <div
                      className={`flex-shrink-0 h-9 w-9 rounded-full ${meta.numberBg} text-white text-sm font-semibold flex items-center justify-center mt-0.5`}
                    >
                      {idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${meta.bg} ${meta.iconColor} ring-1 ring-inset ${meta.ring}`}
                        >
                          <Icon
                            icon={meta.icon}
                            size={SizeProp.Smaller}
                            className={meta.iconColor}
                          />
                          {meta.shortLabel}
                        </span>
                      </div>
                      <Input
                        value={step.title}
                        onChange={(v: string) => {
                          return updateStep(idx, { title: v });
                        }}
                        placeholder="What does this step do?"
                        className="block w-full border-0 bg-transparent p-0 text-base font-semibold text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
                      />
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1">
                      <Button
                        icon={IconProp.ChevronUp}
                        buttonStyle={ButtonStyleType.ICON}
                        buttonSize={ButtonSize.Small}
                        onClick={() => {
                          return move(idx, -1);
                        }}
                        disabled={idx === 0}
                      />
                      <Button
                        icon={IconProp.ChevronDown}
                        buttonStyle={ButtonStyleType.ICON}
                        buttonSize={ButtonSize.Small}
                        onClick={() => {
                          return move(idx, 1);
                        }}
                        disabled={idx === steps.length - 1}
                      />
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

                  <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/50">
                    <div className="flex flex-col gap-4">
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
                            return updateStep(idx, { description: v });
                          }}
                          placeholder={
                            step.type === RunbookStepType.Manual
                              ? "Instructions the responder will see when they reach this step. Markdown is supported."
                              : "Optional notes about what this step does. Markdown is supported."
                          }
                        />
                      </div>

                      {step.type === RunbookStepType.JavaScript && (
                        <div className="flex flex-col gap-3">
                          {renderAgentPicker({
                            currentAgentId:
                              (step.config as JavaScriptStepConfig).agentId ||
                              "",
                            onChange: (id: string) => {
                              updateConfig(idx, { agentId: id });
                            },
                            helperText: (
                              <>
                                JavaScript runs sandboxed on the selected
                                Runbook Agent in your own infrastructure. The
                                step waits until this agent claims the job, or
                                fails after the claim timeout.
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
                                  (step.config as JavaScriptStepConfig)
                                    .script || ""
                                }
                                onChange={(v: string) => {
                                  return updateConfig(idx, { script: v });
                                }}
                              />
                            </div>
                            <p className="text-xs text-gray-500 mt-1.5">
                              Sandboxed via <code>isolated-vm</code> on the
                              agent. Use <code>return value</code> to capture
                              output. Default timeout 30s.
                            </p>
                          </div>
                        </div>
                      )}

                      {step.type === RunbookStepType.HttpRequest && (
                        <div className="flex flex-col gap-3">
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <div className="md:col-span-1">
                              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                Method
                              </label>
                              <select
                                className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                value={
                                  (step.config as HttpRequestStepConfig)
                                    .method || "GET"
                                }
                                onChange={(
                                  e: React.ChangeEvent<HTMLSelectElement>,
                                ) => {
                                  updateConfig(idx, {
                                    method: e.target.value as HttpRequestMethod,
                                  });
                                }}
                              >
                                {HTTP_METHODS.map((m: HttpRequestMethod) => {
                                  return (
                                    <option key={m} value={m}>
                                      {m}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                            <div className="md:col-span-3">
                              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                URL
                              </label>
                              <Input
                                value={
                                  (step.config as HttpRequestStepConfig).url ||
                                  ""
                                }
                                onChange={(v: string) => {
                                  return updateConfig(idx, { url: v });
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
                                  (step.config as HttpRequestStepConfig)
                                    .headersJson || ""
                                }
                                onChange={(v: string) => {
                                  return updateConfig(idx, { headersJson: v });
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
                                  (step.config as HttpRequestStepConfig).body ||
                                  ""
                                }
                                onChange={(v: string) => {
                                  return updateConfig(idx, { body: v });
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
                              (step.config as BashStepConfig).agentId || "",
                            onChange: (id: string) => {
                              updateConfig(idx, { agentId: id });
                            },
                            helperText: (
                              <>
                                Bash runs on the selected Runbook Agent in your
                                own infrastructure. The step waits until this
                                agent claims the job, or fails after the claim
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
                                  (step.config as BashStepConfig).script || ""
                                }
                                onChange={(v: string) => {
                                  return updateConfig(idx, { script: v });
                                }}
                              />
                            </div>
                            <p className="text-xs text-gray-500 mt-1.5">
                              Output is capped at 50&nbsp;KB. The script may not
                              run if the selected agent is offline.
                            </p>
                          </div>
                        </div>
                      )}

                      {isAutomatedStep(step.type) && (
                        <div className="flex flex-col gap-3 pt-1">
                          <Toggle
                            title="Continue on failure"
                            description="If this step fails, continue to the next step instead of stopping the runbook."
                            value={Boolean(step.continueOnFailure)}
                            onChange={(v: boolean) => {
                              return updateStep(idx, { continueOnFailure: v });
                            }}
                          />
                          <Toggle
                            title="Require approval before running the next step"
                            description="After this step completes, pause the runbook and wait for a user to approve before running the next step."
                            value={Boolean(step.requireApproval)}
                            onChange={(v: boolean) => {
                              return updateStep(idx, { requireApproval: v });
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

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
                icon={IconProp.Check}
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
