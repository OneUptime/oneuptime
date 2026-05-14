import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import CodeType from "Common/Types/Code/CodeType";
import Navigation from "Common/UI/Utils/Navigation";
import Card from "Common/UI/Components/Card/Card";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Input from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import { JSONArray } from "Common/Types/JSON";
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

const HTTP_METHODS: HttpRequestMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
];

function newStep(type: RunbookStepType, order: number): RunbookStep {
  const base: RunbookStep = {
    id: UUID.generate(),
    order,
    type,
    title:
      type === RunbookStepType.Manual
        ? "Manual step"
        : type === RunbookStepType.JavaScript
          ? "Run JavaScript"
          : type === RunbookStepType.HttpRequest
            ? "HTTP request"
            : "Run bash",
    description: "",
    continueOnFailure: false,
    config:
      type === RunbookStepType.JavaScript
        ? ({ script: "// return value;\nreturn 'ok';" } as JavaScriptStepConfig)
        : type === RunbookStepType.HttpRequest
          ? ({
              url: "https://",
              method: "GET",
            } as HttpRequestStepConfig)
          : type === RunbookStepType.Bash
            ? ({ script: "echo hello" } as BashStepConfig)
            : {},
  };
  return base;
}

function typeLabel(t: RunbookStepType): string {
  switch (t) {
    case RunbookStepType.Manual:
      return "Manual";
    case RunbookStepType.JavaScript:
      return "JavaScript";
    case RunbookStepType.HttpRequest:
      return "HTTP request";
    case RunbookStepType.Bash:
      return "Bash";
  }
}

const Steps: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [steps, setSteps] = useState<RunbookStep[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<boolean>(false);

  useAsyncEffect(async () => {
    try {
      const runbook: Runbook | null = await ModelAPI.getItem<Runbook>({
        modelType: Runbook,
        id: modelId,
        select: { steps: true },
        requestOptions: {},
      });

      const loaded: RunbookStep[] =
        (runbook?.steps as unknown as RunbookStep[]) || [];
      // Normalize order
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
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateStep: (idx: number, patch: Partial<RunbookStep>) => void = (
    idx: number,
    patch: Partial<RunbookStep>,
  ): void => {
    setSteps((prev: RunbookStep[]) => {
      const copy: RunbookStep[] = [...prev];
      copy[idx] = { ...copy[idx]!, ...patch };
      return copy;
    });
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
  };

  const add: (type: RunbookStepType) => void = (
    type: RunbookStepType,
  ): void => {
    setSteps((prev: RunbookStep[]) => {
      return [...prev, newStep(type, prev.length)];
    });
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

  return (
    <Fragment>
      <Card
        title="Runbook Steps"
        description="Ordered list of steps to run. Manual steps pause the runbook until a user ticks them off."
        buttons={[
          {
            title: "Add Manual",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Check,
            onClick: () => {
              return add(RunbookStepType.Manual);
            },
          },
          {
            title: "Add JavaScript",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Code,
            onClick: () => {
              return add(RunbookStepType.JavaScript);
            },
          },
          {
            title: "Add HTTP",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Globe,
            onClick: () => {
              return add(RunbookStepType.HttpRequest);
            },
          },
          {
            title: "Add Bash",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Terminal,
            onClick: () => {
              return add(RunbookStepType.Bash);
            },
          },
        ]}
      >
        <div className="flex flex-col gap-4">
          {steps.length === 0 && (
            <div className="text-sm text-gray-500">
              No steps yet. Use the buttons above to add one.
            </div>
          )}
          {steps.map((step: RunbookStep, idx: number) => {
            return (
              <div
                key={step.id}
                className="border border-gray-200 rounded-lg p-4 bg-gray-50"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-gray-700">
                    Step {idx + 1} · {typeLabel(step.type)}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      title="Up"
                      icon={IconProp.ChevronUp}
                      buttonStyle={ButtonStyleType.OUTLINE}
                      onClick={() => {
                        return move(idx, -1);
                      }}
                      disabled={idx === 0}
                    />
                    <Button
                      title="Down"
                      icon={IconProp.ChevronDown}
                      buttonStyle={ButtonStyleType.OUTLINE}
                      onClick={() => {
                        return move(idx, 1);
                      }}
                      disabled={idx === steps.length - 1}
                    />
                    <Button
                      title="Remove"
                      icon={IconProp.Trash}
                      buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                      onClick={() => {
                        return remove(idx);
                      }}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Title
                    </label>
                    <Input
                      value={step.title}
                      onChange={(v: string) => {
                        return updateStep(idx, { title: v });
                      }}
                      placeholder="What does this step do?"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Description
                    </label>
                    <TextArea
                      value={step.description || ""}
                      onChange={(v: string) => {
                        return updateStep(idx, { description: v });
                      }}
                      placeholder="Optional notes for the responder"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <Toggle
                      title="Continue on failure"
                      description="If this step fails, continue to the next step instead of stopping the runbook."
                      value={Boolean(step.continueOnFailure)}
                      onChange={(v: boolean) => {
                        return updateStep(idx, { continueOnFailure: v });
                      }}
                    />
                  </div>

                  {step.type === RunbookStepType.JavaScript && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Script
                      </label>
                      <CodeEditor
                        type={CodeType.JavaScript}
                        value={
                          (step.config as JavaScriptStepConfig).script || ""
                        }
                        onChange={(v: string) => {
                          return updateConfig(idx, { script: v });
                        }}
                      />
                    </div>
                  )}

                  {step.type === RunbookStepType.HttpRequest && (
                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <div className="md:col-span-1">
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Method
                          </label>
                          <select
                            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm"
                            value={
                              (step.config as HttpRequestStepConfig).method ||
                              "GET"
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
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            URL
                          </label>
                          <Input
                            value={
                              (step.config as HttpRequestStepConfig).url || ""
                            }
                            onChange={(v: string) => {
                              return updateConfig(idx, { url: v });
                            }}
                            placeholder="https://api.example.com/incident"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Headers (JSON)
                        </label>
                        <CodeEditor
                          type={CodeType.JSON}
                          value={
                            (step.config as HttpRequestStepConfig)
                              .headersJson || ""
                          }
                          onChange={(v: string) => {
                            return updateConfig(idx, { headersJson: v });
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Body
                        </label>
                        <CodeEditor
                          type={CodeType.JSON}
                          value={
                            (step.config as HttpRequestStepConfig).body || ""
                          }
                          onChange={(v: string) => {
                            return updateConfig(idx, { body: v });
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {step.type === RunbookStepType.Bash && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Bash script
                      </label>
                      <CodeEditor
                        type={CodeType.Text}
                        value={(step.config as BashStepConfig).script || ""}
                        onChange={(v: string) => {
                          return updateConfig(idx, { script: v });
                        }}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Bash steps require{" "}
                        <code>RUNBOOK_BASH_ENABLED=true</code> on the Worker.
                        Long-term these should run on a Probe agent rather than
                        the server.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end mt-4">
          <Button
            title={isSaving ? "Saving..." : "Save Steps"}
            buttonStyle={ButtonStyleType.PRIMARY}
            icon={IconProp.Check}
            onClick={() => {
              void save();
            }}
            disabled={isSaving}
          />
        </div>
      </Card>

      {success && (
        <ConfirmModal
          title="Saved"
          description="Runbook steps were saved successfully."
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setSuccess(false);
          }}
        />
      )}

      {error && (
        <ConfirmModal
          title="Error"
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
