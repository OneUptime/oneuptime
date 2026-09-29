import PageComponentProps from "../../../PageComponentProps";
import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import {
  AI_AGENT_FIXES_OFF_HINT,
  AI_AGENT_OTHER_RELEASE_TEXT,
  AI_AGENT_PAGE_SUBTITLE,
  AI_AGENT_PAGE_TITLE,
  AI_AGENT_READY_TEXT,
  AI_AGENT_STATUS_POLL_INTERVAL_MS,
  ASK_PROJECT_ADMIN_TEXT,
  AiAgentCardCommand,
  AiAgentGapAction,
  AiAgentStatusPill,
  canSwitchToAiAgent,
  describeAiAgentWriteAccess,
  getAiAgentCardCommand,
  getAiAgentGapAction,
  getAiAgentMetaParts,
  getAiAgentPodNamespace,
  getAiAgentStateSentence,
  getAiAgentStatusPill,
  getAiAgentSummary,
  getAttentionGaps,
  getAutomaticInvestigation,
  getAutomaticInvestigationConfirmation,
  getAutomaticInvestigationLine,
  getAutomaticInvestigationTurnOnChanges,
  getRefusedRegistrationWarning,
  isAdvancedRunnerTarget,
  parseStatus,
  shouldShowWriteAccessCommands,
} from "../../Utils/KubernetesAiAgentStatus";
import {
  AiAgentHelmCommands,
  getAiAgentClusterWideCommandNote,
  getAiAgentHelmCommands,
  getAiAgentLogsCommand,
  getAiAgentScopedCommandNote,
  getAiAgentWriteDisclosure,
} from "../../Utils/KubernetesAiAccessSetup";
import {
  KubernetesAiAccessConfirmation,
  KubernetesAiAccessOfferedFields,
  KubernetesAiAccessSavedSettings,
  KubernetesAiAccessSettingsFormValues,
  KubernetesAiCredentialDirectoryEntry,
  KubernetesAiCredentialRunner,
  KubernetesAiRunnerDirectoryEntry,
  REMEDIATION_MODE_LABELS,
  REMEDIATION_MODE_SHORT_NAMES,
  REMEDIATION_MODE_SUMMARIES,
  buildKubernetesAiCredentialDirectory,
  buildKubernetesAiCredentialOptions,
  buildKubernetesAiRunnerDirectory,
  buildKubernetesAiRunnerOptions,
  capitalizeFirst,
  getAllowlistInEffect,
  getKubectlAllowlistRemovalOnlyError,
  getKubernetesAiAccessAdminPermissionTitles,
  getKubernetesAiAccessBindingError,
  getKubernetesAiAccessChosenRunnerId,
  getKubernetesAiAccessConfirmation,
  getKubernetesAiAccessLooseningChanges,
  getKubernetesAiAccessOfferedFields,
  getKubernetesAiAccessSettingsChanges,
  getKubernetesAiAccessSettingsInitialValues,
  getKubernetesAiAccessSubmittedFields,
  getKubernetesAiCredentialFieldDescription,
  getRemediationModeFieldDescription,
  isAllowlistFieldShown,
  isRemediationModeOpenToEveryEditor,
  readKubernetesAiAccessSavedSettings,
  readRemediationMode,
  validateKubectlAllowlistText,
} from "../../Utils/KubernetesAiAccessSettings";
import {
  KubernetesAiAccessEditCapabilities,
  canChangeProjectAiSettings,
  canConfigureUnattendedKubernetesAiAccess,
  canPickKubernetesRunner,
  canResetKubernetesAiAgent,
  getAccessTestPermissionGate,
  getAccessTestPermissionMessage,
  getAccessTestPermissionRequirement,
  getKubernetesAiAccessEditCapabilities,
  getKubernetesCredentialPermissionTitles,
  getKubernetesRunnerPermissionTitles,
} from "../../Utils/KubernetesAiAccessPermissions";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import Color from "Common/Types/Color";
import { Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import {
  KubernetesAiAccessGap,
  KubernetesAiAgentSummary,
  KubernetesAiAutomaticInvestigationSettings,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import RunbookCredentialType from "Common/Types/Runbook/RunbookCredentialType";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Project from "Common/Models/DatabaseModels/Project";
import RunbookCredential from "Common/Models/DatabaseModels/RunbookCredential";
import Runner from "Common/Models/DatabaseModels/Runner";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate, useParams } from "react-router-dom";

/*
 * The cluster's AI agent page (AI → Agent): whether OneUptime AI can reach
 * this cluster and what it may do there, in three cards at most —
 *
 *  A. "Kubernetes AI agent": the connection, with the one command that
 *     fixes a missing or offline agent, a connection test, and the admin
 *     actions (reset the agent; move an advanced Runner binding over to it).
 *  B. "Needs attention": the server's gaps, only when there are any. The
 *     page never builds a readiness checklist of its own.
 *  C. "What AI may do": investigation and fixes, the write-access command
 *     when fixes need it, and the project's automatic-investigation line.
 *
 * What AI did on the cluster lives on the AI Insights page (AI → Insights).
 */

interface AccessTestResult {
  ok: boolean;
  message: string;
  results: Array<{
    command: string;
    succeeded: boolean;
    exitCode: number | null;
    output: string;
    errorMessage: string | null;
  }>;
}

// The confirmations the page asks for before an action.
type PendingConfirmation = "reset" | "switch" | "automatic_investigation";

const PILL_COLORS: Record<AiAgentStatusPill["tone"], Color> = {
  success: Green500,
  danger: Red500,
  neutral: Gray500,
};

function useClusterId(): ObjectID {
  const { id } = useParams();
  /*
   * Memoized on the string it was read from: a fresh ObjectID every render
   * would recreate fetchStatus (which depends on it) and re-run the load
   * effect after every state update — an unbounded loop of status
   * requests, each answer triggering the next.
   */
  return useMemo((): ObjectID => {
    return new ObjectID(id || "");
  }, [id]);
}

/*
 * ":id/ai" was the cluster's one AI page before the AI section had two.
 * Old links, bookmarks and server messages that point there land on the
 * AI agent page.
 */
export const KubernetesClusterViewAiRedirect: FunctionComponent =
  (): ReactElement => {
    const clusterId: ObjectID = useClusterId();

    return (
      <Navigate
        replace={true}
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT] as Route,
          { modelId: clusterId },
        ).toString()}
      />
    );
  };

function parseAccessTestResult(data: JSONObject): AccessTestResult {
  return {
    ok: data["ok"] === true,
    message: String(data["message"] || ""),
    results: ((data["results"] as JSONArray) || []).map(
      (row: unknown): AccessTestResult["results"][number] => {
        const item: JSONObject = (row || {}) as JSONObject;
        return {
          command: String(item["command"] || ""),
          succeeded: item["succeeded"] === true,
          exitCode:
            typeof item["exitCode"] === "number"
              ? (item["exitCode"] as number)
              : null,
          output: String(item["output"] || ""),
          errorMessage:
            typeof item["errorMessage"] === "string"
              ? (item["errorMessage"] as string)
              : null,
        };
      },
    ),
  };
}

function AdminPermissionNote(): ReactElement {
  return (
    <p
      className="text-xs leading-5 text-gray-500"
      data-testid="kubernetes-ai-access-admin-note"
    >
      Turning fixes on or up, adding allowlist patterns, or choosing a Runner
      needs one of these permissions:{" "}
      {getKubernetesAiAccessAdminPermissionTitles().join(", ")}. You can still
      turn investigation on or off, lower fixes and remove allowlist patterns.
    </p>
  );
}

/*
 * What an allowlist entry is, in KubectlPolicy's words: matched word by
 * word, the verb (and the subcommand of rollout, set or create) written
 * out rather than `*`, more than one word, and never promoting a drain, a
 * taint, a patch of a node or a protected-namespace write.
 */
const ALLOWLIST_FIELD_DESCRIPTION: string =
  'Optional. One pattern per line: a riskier kubectl command that matches a pattern also runs without approval. Patterns are compared word by word — * matches exactly one word, and flags must be written out; a leading "kubectl" is optional — for example: kubectl set image deployment/web * -n web. Write the verb (and the subcommand of rollout, set or create) out, never as *, and use more than one word. A wildcard for the object or the namespace pre-approves a whole class of changes, and saving one asks you to confirm. Destructive commands, node drains, taints and patches, and the protected namespaces never run unattended.';

interface SettingsModalProps {
  clusterId: ObjectID;
  capabilities: KubernetesAiAccessEditCapabilities;
  // The cluster is bound to a Runner outside the chart (see isAdvancedRunnerTarget).
  isAdvancedBinding: boolean;
  // The cluster has a Kubernetes AI agent row (status.aiAgent).
  hasAiAgent: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/*
 * The "What AI may do" Change modal. Not a ModelForm: a ModelForm submits
 * every field it shows, so an editor who only switched investigation off
 * would re-send the unchanged fixes mode and allowlist — writes the server
 * refuses unless they hold the admin set. This form sends only what
 * changed, offers what the user may do (every cluster editor may tighten;
 * only the admin set may loosen), validates the allowlist as patterns, and
 * asks before a save that lets riskier changes run unattended. The Runner
 * and credential pickers exist only for a cluster already bound to a
 * Runner outside the chart.
 */
const AiAccessSettingsModal: FunctionComponent<SettingsModalProps> = (
  props: SettingsModalProps,
): ReactElement => {
  const [saved, setSaved] = useState<KubernetesAiAccessSavedSettings | null>(
    null,
  );
  const [runners, setRunners] = useState<Array<Runner>>([]);
  const [credentials, setCredentials] = useState<Array<RunbookCredential>>([]);
  const [isRunnerPickerAvailable, setIsRunnerPickerAvailable] =
    useState<boolean>(false);
  const [isCredentialPickerAvailable, setIsCredentialPickerAvailable] =
    useState<boolean>(false);
  // The Runner the form has chosen; the credential options follow it.
  const [chosenRunnerId, setChosenRunnerId] = useState<string | null>(null);
  const [pickerErrors, setPickerErrors] = useState<Array<string>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [pendingSave, setPendingSave] = useState<{
    changes: JSONObject;
    confirmation: KubernetesAiAccessConfirmation;
  } | null>(null);
  const formRef: MutableRefObject<any> = useRef<any>(null);
  // Blocks a second save while one is in flight (double click, Enter + click).
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const canConfigureUnattended: boolean =
    props.capabilities.canConfigureUnattended;
  const canPickRunner: boolean =
    props.isAdvancedBinding && props.capabilities.canPickRunner;
  const canPickCredential: boolean =
    props.isAdvancedBinding && props.capabilities.canPickCredential;

  useEffect(() => {
    let isMounted: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      let settings: KubernetesAiAccessSavedSettings;

      try {
        const cluster: KubernetesCluster | null =
          await ModelAPI.getItem<KubernetesCluster>({
            modelType: KubernetesCluster,
            id: props.clusterId,
            select: {
              _id: true,
              isAiInvestigationEnabled: true,
              aiRemediationMode: true,
              aiKubectlCommandAllowlist: true,
              aiAccessRunnerId: true,
              aiAccessCredentialId: true,
              // Names only: the ids come from the FK columns above.
              aiAccessRunner: { name: true },
              aiAccessCredential: { name: true },
            },
          });

        if (!cluster) {
          throw new Error(
            "Could not read this cluster's AI settings. It may have been deleted, or you may no longer have access to it.",
          );
        }

        settings = readKubernetesAiAccessSavedSettings(cluster);
      } catch (err) {
        if (isMounted) {
          setLoadError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
        return;
      }

      /*
       * Each picker loads on its own: one list failing must not take the
       * other picker — or the rest of the form — down with it. A picker
       * whose list failed is left out, which leaves its binding as it is.
       */
      const errors: Array<string> = [];

      const loadRunners: () => Promise<Array<Runner> | null> =
        async (): Promise<Array<Runner> | null> => {
          if (!canPickRunner) {
            return null;
          }
          try {
            const result: ListResult<Runner> = await ModelAPI.getList<Runner>({
              modelType: Runner,
              query: {},
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: {
                _id: true,
                name: true,
                canRunAiCommands: true,
                // The posture: which rows the Kubernetes agent chart installed.
                hostInfo: true,
              },
              sort: { name: SortOrder.Ascending },
            });
            return result.data || [];
          } catch (err) {
            errors.push(
              `The Runner list could not be loaded, so the Runner binding is left as it is: ${API.getFriendlyMessage(err)}`,
            );
            return null;
          }
        };

      const loadCredentials: () => Promise<Array<RunbookCredential> | null> =
        async (): Promise<Array<RunbookCredential> | null> => {
          if (!canPickCredential) {
            return null;
          }
          try {
            const result: ListResult<RunbookCredential> =
              await ModelAPI.getList<RunbookCredential>({
                modelType: RunbookCredential,
                query: { credentialType: RunbookCredentialType.Kubernetes },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                select: {
                  _id: true,
                  name: true,
                  credentialType: true,
                  // Which Runners may use each one: the picker follows the Runner.
                  runners: { _id: true },
                },
                sort: { name: SortOrder.Ascending },
              });
            return result.data || [];
          } catch (err) {
            errors.push(
              `The credential list could not be loaded, so the credential binding is left as it is: ${API.getFriendlyMessage(err)}`,
            );
            return null;
          }
        };

      const [runnerRows, credentialRows]: [
        Array<Runner> | null,
        Array<RunbookCredential> | null,
      ] = await Promise.all([loadRunners(), loadCredentials()]);

      if (!isMounted) {
        return;
      }

      setSaved(settings);
      setChosenRunnerId(settings.aiAccessRunnerId);
      setRunners(runnerRows || []);
      setIsRunnerPickerAvailable(runnerRows !== null);
      setCredentials(credentialRows || []);
      setIsCredentialPickerAvailable(credentialRows !== null);
      setPickerErrors(errors);
      setIsLoading(false);
    };

    load().catch(() => {
      // handled inside load
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const offered: KubernetesAiAccessOfferedFields | null = useMemo(() => {
    if (!saved) {
      return null;
    }

    return getKubernetesAiAccessOfferedFields({
      saved,
      canConfigureUnattended,
      isRunnerPickerAvailable,
      isCredentialPickerAvailable,
      isAdvancedBinding: props.isAdvancedBinding,
      hasAiAgent: props.hasAiAgent,
    });
  }, [
    saved,
    canConfigureUnattended,
    isRunnerPickerAvailable,
    isCredentialPickerAvailable,
    props.isAdvancedBinding,
    props.hasAiAgent,
  ]);

  const runnerDirectory: Record<string, KubernetesAiRunnerDirectoryEntry> =
    useMemo(() => {
      return buildKubernetesAiRunnerDirectory(runners);
    }, [runners]);

  const credentialDirectory: Record<
    string,
    KubernetesAiCredentialDirectoryEntry
  > = useMemo(() => {
    return buildKubernetesAiCredentialDirectory(credentials);
  }, [credentials]);

  const runnerOptions: Array<DropdownOption> = useMemo(() => {
    if (!saved) {
      return [];
    }

    return buildKubernetesAiRunnerOptions({
      runners,
      boundRunnerId: saved.aiAccessRunnerId,
      boundRunnerName: saved.aiAccessRunnerName,
    });
  }, [saved, runners]);

  const chosenRunner: KubernetesAiCredentialRunner = useMemo(() => {
    if (!chosenRunnerId) {
      return { id: null, name: null };
    }

    return {
      id: chosenRunnerId,
      name:
        runnerDirectory[chosenRunnerId]?.name ||
        (chosenRunnerId === saved?.aiAccessRunnerId
          ? saved.aiAccessRunnerName
          : null),
      isAgent: runnerDirectory[chosenRunnerId]?.isAgent,
    };
  }, [chosenRunnerId, runnerDirectory, saved]);

  /*
   * Built once everything has loaded — BasicForm reads its initial values
   * once, on the first render in which the fields exist — and again when
   * the chosen Runner changes, so the credential options follow it.
   */
  const fields: Fields<KubernetesAiAccessSettingsFormValues> = useMemo(() => {
    if (!saved || !offered) {
      return [];
    }

    // Without the admin set, every mode at or below the saved one.
    const modes: Array<KubernetesAiRemediationMode> = canConfigureUnattended
      ? Object.values(KubernetesAiRemediationMode)
      : Object.values(KubernetesAiRemediationMode).filter(
          (mode: KubernetesAiRemediationMode): boolean => {
            return isRemediationModeOpenToEveryEditor(
              mode,
              saved.aiRemediationMode,
            );
          },
        );

    const result: Fields<KubernetesAiAccessSettingsFormValues> = [
      {
        field: { isAiInvestigationEnabled: true },
        title: "Investigate with kubectl",
        description:
          "Read-only: get, describe, logs, events, top. An investigation never changes the cluster.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        dataTestId: "ai-investigation-field",
      },
      {
        field: { aiRemediationMode: true },
        title: "Fixes",
        description: getRemediationModeFieldDescription(),
        fieldType: FormFieldSchemaType.Dropdown,
        required: true,
        dataTestId: "ai-remediation-mode-field",
        dropdownOptions: modes.map(
          (mode: KubernetesAiRemediationMode): DropdownOption => {
            return {
              value: mode,
              label:
                !canConfigureUnattended &&
                mode === saved.aiRemediationMode &&
                mode !== KubernetesAiRemediationMode.Disabled
                  ? `${REMEDIATION_MODE_LABELS[mode]} (current)`
                  : REMEDIATION_MODE_LABELS[mode],
            };
          },
        ),
      },
    ];

    if (offered.allowlist) {
      result.push({
        field: { kubectlAllowlistText: true },
        title: "kubectl allowlist",
        description: offered.allowlistRemoveOnly
          ? `You can remove patterns or clear the list; adding or changing one needs one of these permissions: ${getKubernetesAiAccessAdminPermissionTitles().join(", ")}. ${ALLOWLIST_FIELD_DESCRIPTION}`
          : ALLOWLIST_FIELD_DESCRIPTION,
        fieldType: FormFieldSchemaType.LongText,
        required: false,
        placeholder: "kubectl set image deployment/web * -n web",
        dataTestId: "kubectl-allowlist-field",
        showIf: isAllowlistFieldShown,
        customValidation: (
          values: FormValues<KubernetesAiAccessSettingsFormValues>,
        ): string | null => {
          return (
            validateKubectlAllowlistText(values.kubectlAllowlistText) ||
            (offered.allowlistRemoveOnly
              ? getKubectlAllowlistRemovalOnlyError({
                  text: values.kubectlAllowlistText,
                  storedValue: saved.aiKubectlCommandAllowlist,
                })
              : null)
          );
        },
      });
    }

    if (offered.runner) {
      result.push({
        field: { aiAccessRunnerId: true },
        title: "Runner",
        description:
          "The Runner OneUptime AI uses to run kubectl on this cluster. Only Runners with “Runs AI Remediation Commands” on are listed. Leave it empty to use the cluster's Kubernetes AI agent.",
        fieldType: FormFieldSchemaType.Dropdown,
        required: false,
        placeholder: "None — use the Kubernetes AI agent",
        dataTestId: "ai-access-runner-field",
        dropdownOptions: runnerOptions,
      });
    } else if (offered.runnerClear) {
      result.push({
        field: { clearAiAccessRunner: true },
        title: "Unbind the Runner",
        description: `Bound now: ${saved.aiAccessRunnerName || "a Runner"}. ${
          props.hasAiAgent
            ? "Unbinding moves this cluster to its Kubernetes AI agent."
            : "Unbinding stops OneUptime AI from running kubectl on this cluster until it has an AI agent."
        } Choosing a Runner needs permission to read Runners (one of: ${getKubernetesRunnerPermissionTitles().join(", ")}).`,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        dataTestId: "ai-access-clear-runner-field",
      });
    }

    if (offered.credential) {
      result.push({
        field: { aiAccessCredentialId: true },
        title: "Kubernetes credential",
        description: getKubernetesAiCredentialFieldDescription(chosenRunner),
        fieldType: FormFieldSchemaType.Dropdown,
        required: false,
        placeholder: "No credential",
        dataTestId: "ai-access-credential-field",
        dropdownOptions: buildKubernetesAiCredentialOptions({
          credentials,
          boundCredentialId: saved.aiAccessCredentialId,
          boundCredentialName: saved.aiAccessCredentialName,
          runner: chosenRunner,
        }),
      });
    } else if (offered.credentialClear) {
      result.push({
        field: { clearAiAccessCredential: true },
        title: "Unbind the Kubernetes credential",
        description: `Bound now: ${
          saved.aiAccessCredentialName || "a Kubernetes credential"
        }. A Runner outside the cluster cannot reach it without one. Choosing a credential needs permission to read Runner credentials (one of: ${getKubernetesCredentialPermissionTitles().join(", ")}).`,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        dataTestId: "ai-access-clear-credential-field",
      });
    }

    return result;
  }, [saved, offered, runnerOptions, credentials, chosenRunner]);

  const initialValues: FormValues<KubernetesAiAccessSettingsFormValues> =
    useMemo(() => {
      return saved ? getKubernetesAiAccessSettingsInitialValues(saved) : {};
    }, [saved]);

  const save: (changes: JSONObject) => Promise<void> = async (
    changes: JSONObject,
  ): Promise<void> => {
    if (isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError("");

    try {
      await ModelAPI.updateById<KubernetesCluster>({
        modelType: KubernetesCluster,
        id: props.clusterId,
        data: changes,
      });
    } catch (err) {
      isSavingRef.current = false;
      setIsSaving(false);
      setSaveError(API.getFriendlyMessage(err));
      return;
    }

    isSavingRef.current = false;
    props.onSaved();
  };

  const onSubmit: (
    values: FormValues<KubernetesAiAccessSettingsFormValues>,
  ) => void = (values: FormValues<KubernetesAiAccessSettingsFormValues>) => {
    if (!saved || !offered || isSavingRef.current) {
      return;
    }

    setSaveError("");

    const changes: JSONObject = getKubernetesAiAccessSettingsChanges({
      saved,
      values,
      offered: getKubernetesAiAccessSubmittedFields({ offered, values }),
    });

    if (Object.keys(changes).length === 0) {
      // Nothing changed; there is nothing to write.
      props.onClose();
      return;
    }

    if (!canConfigureUnattended) {
      const loosening: Array<string> = getKubernetesAiAccessLooseningChanges({
        saved,
        changes,
        hasAiAgent: props.hasAiAgent,
      });
      if (loosening.length > 0) {
        setSaveError(
          `${capitalizeFirst(loosening.join(", "))} needs one of these permissions: ${getKubernetesAiAccessAdminPermissionTitles().join(", ")}.`,
        );
        return;
      }
    }

    const bindingError: string | null = getKubernetesAiAccessBindingError({
      saved,
      changes,
      runners: runnerDirectory,
      credentials: credentialDirectory,
    });

    if (bindingError) {
      setSaveError(bindingError);
      return;
    }

    const confirmation: KubernetesAiAccessConfirmation | null =
      getKubernetesAiAccessConfirmation({ saved, changes });

    if (confirmation) {
      setPendingSave({ changes, confirmation });
      return;
    }

    save(changes).catch(() => {
      // handled inside save
    });
  };

  const notes: Array<ReactElement> = [];

  if (!canConfigureUnattended) {
    notes.push(<AdminPermissionNote key="admin" />);
  } else if (props.isAdvancedBinding) {
    if (!props.capabilities.canPickRunner) {
      notes.push(
        <p
          key="runner"
          className="text-xs leading-5 text-gray-500"
          data-testid="kubernetes-runner-picker-permission-note"
        >
          The Runner picker is not shown: choosing a Runner needs permission to
          read Runners (one of:{" "}
          {getKubernetesRunnerPermissionTitles().join(", ")}).
        </p>,
      );
    }
    if (!props.capabilities.canPickCredential) {
      notes.push(
        <p
          key="credential"
          className="text-xs leading-5 text-gray-500"
          data-testid="kubernetes-credential-picker-permission-note"
        >
          The credential picker is not shown: choosing a credential needs
          permission to read Runner credentials (one of:{" "}
          {getKubernetesCredentialPermissionTitles().join(", ")}).
        </p>,
      );
    }
  }

  return (
    <>
      <Modal
        title="Change what AI may do"
        submitButtonText="Save"
        submitButtonType={ButtonType.Submit}
        modalWidth={ModalWidth.Medium}
        isLoading={isSaving}
        disableSubmitButton={isLoading || !saved || isSaving}
        onClose={props.onClose}
        onSubmit={() => {
          formRef.current?.submitForm();
        }}
      >
        <div className="space-y-4">
          {notes.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              {notes}
            </div>
          ) : (
            <></>
          )}

          {pickerErrors.map((message: string): ReactElement => {
            return (
              <Alert key={message} type={AlertType.WARNING} title={message} />
            );
          })}

          {loadError ? (
            <ErrorMessage message={loadError} />
          ) : isLoading || !saved || !offered ? (
            <ComponentLoader />
          ) : (
            <BasicForm
              ref={formRef}
              id="kubernetes-cluster-ai-access-form"
              name="Change what AI may do"
              fields={fields}
              initialValues={initialValues}
              hideSubmitButton={true}
              footer={<></>}
              onChange={(
                values: FormValues<KubernetesAiAccessSettingsFormValues>,
              ) => {
                const runnerId: string | null =
                  getKubernetesAiAccessChosenRunnerId({
                    saved,
                    values,
                    offered,
                  });
                setChosenRunnerId((previous: string | null): string | null => {
                  return previous === runnerId ? previous : runnerId;
                });
              }}
              onSubmit={onSubmit}
            />
          )}

          {saveError ? (
            <Alert
              type={AlertType.DANGER}
              strongTitle="Could not save"
              title={saveError}
              dataTestId="ai-access-save-error"
            />
          ) : (
            <></>
          )}
        </div>
      </Modal>

      {pendingSave ? (
        <ConfirmModal
          title={pendingSave.confirmation.title}
          description={pendingSave.confirmation.description}
          submitButtonText="Confirm and save"
          submitButtonType={ButtonStyleType.DANGER}
          onClose={() => {
            setPendingSave(null);
          }}
          onSubmit={() => {
            const changes: JSONObject = pendingSave.changes;
            setPendingSave(null);
            save(changes).catch(() => {
              // handled inside save
            });
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

function SettingRow(props: {
  label: string;
  children: ReactElement | string;
  dataTestId: string;
}): ReactElement {
  return (
    <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-gray-500">{props.label}</dt>
      <dd
        className="text-sm text-gray-900 sm:col-span-2"
        data-testid={props.dataTestId}
      >
        {props.children}
      </dd>
    </div>
  );
}

const KubernetesClusterAiAgent: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = useClusterId();

  const [status, setStatus] = useState<KubernetesClusterAiAccessStatus | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  /*
   * The last status request's failure. Fatal only while there is no status
   * to show: once the page has one, a failed background poll keeps the last
   * good status on screen — with an open Change modal and test results —
   * and reports the failure inline instead. A later successful poll clears
   * it.
   */
  const [error, setError] = useState<string>("");
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<AccessTestResult | null>(null);
  const [testError, setTestError] = useState<string>("");
  const [refresher, setRefresher] = useState<boolean>(false);
  const [isEditingSettings, setIsEditingSettings] = useState<boolean>(false);
  /*
   * What the Change modal offers, read when it opens. Kept in state so a
   * status poll re-rendering the page cannot rebuild the open form.
   */
  const [editCapabilities, setEditCapabilities] =
    useState<KubernetesAiAccessEditCapabilities | null>(null);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const [isActing, setIsActing] = useState<boolean>(false);
  const [confirmationError, setConfirmationError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [actionNotice, setActionNotice] = useState<string>("");
  const isTestingRef: MutableRefObject<boolean> = useRef<boolean>(false);
  const isActingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const fetchStatus: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/kubernetes-cluster/ai-access/status",
            ),
            data: { clusterId: modelId.toString() },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const parsed: KubernetesClusterAiAccessStatus | null = parseStatus(
          response.data,
        );

        if (!parsed) {
          throw new Error(
            "The server returned an AI agent status this page cannot read.",
          );
        }

        setStatus(parsed);
        setError("");
      } catch (err) {
        // Keep whatever is already on screen; the render decides.
        setError(API.getFriendlyMessage(err));
      }
      setIsLoading(false);
    }, [modelId]);

  useEffect(() => {
    fetchStatus().catch(() => {
      // handled inside fetchStatus
    });
  }, [fetchStatus, refresher]);

  // The agent heartbeats every 30 seconds; keep the page honest.
  useEffect(() => {
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      fetchStatus().catch(() => {
        // handled inside fetchStatus
      });
    }, AI_AGENT_STATUS_POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [fetchStatus]);

  const refresh: () => void = (): void => {
    setRefresher((value: boolean) => {
      return !value;
    });
  };

  const runTest: () => Promise<void> = async (): Promise<void> => {
    if (isTestingRef.current) {
      return;
    }
    isTestingRef.current = true;
    setIsTesting(true);
    setTestError("");
    setTestResult(null);
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/kubernetes-cluster/ai-access/test",
          ),
          data: { clusterId: modelId.toString() },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data as JSONObject;
      setTestResult(parseAccessTestResult(data));
      const refreshed: KubernetesClusterAiAccessStatus | null = parseStatus(
        data["status"],
      );
      if (refreshed) {
        setStatus(refreshed);
      }
    } catch (err) {
      /*
       * A permission refusal is about RUNNING the test. The route shares
       * its check with the settings writes, and the server's sentence
       * talks about changing AI access — which this user did not try.
       */
      setTestError(
        err instanceof HTTPErrorResponse &&
          err.statusCode === ExceptionCode.NotAuthorizedException
          ? getAccessTestPermissionMessage()
          : API.getFriendlyMessage(err),
      );
    }
    isTestingRef.current = false;
    setIsTesting(false);
  };

  /*
   * One page action at a time (reset, switch, a gap's one-click fix, the
   * automatic-investigation opt-in). A confirmed action reports a failure
   * inside its dialog; an unconfirmed one on the page.
   */
  const runPageAction: (data: {
    run: () => Promise<void>;
    notice: string;
    isConfirmed: boolean;
  }) => Promise<void> = async (data: {
    run: () => Promise<void>;
    notice: string;
    isConfirmed: boolean;
  }): Promise<void> => {
    if (isActingRef.current) {
      return;
    }
    isActingRef.current = true;
    setIsActing(true);
    setActionError("");
    setActionNotice("");
    setConfirmationError("");

    try {
      await data.run();
      setPendingConfirmation(null);
      setActionNotice(data.notice);
      refresh();
    } catch (err) {
      if (data.isConfirmed) {
        setConfirmationError(API.getFriendlyMessage(err));
      } else {
        setActionError(API.getFriendlyMessage(err));
      }
    }

    isActingRef.current = false;
    setIsActing(false);
  };

  const postClusterAction: (route: string) => Promise<void> = async (
    route: string,
  ): Promise<void> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(route),
        data: { clusterId: modelId.toString() },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }
  };

  const updateCluster: (data: JSONObject) => Promise<void> = async (
    data: JSONObject,
  ): Promise<void> => {
    await ModelAPI.updateById<KubernetesCluster>({
      modelType: KubernetesCluster,
      id: modelId,
      data,
    });
  };

  // Shown in every state, like the AI Insights page's heading.
  const heading: ReactElement = (
    <div className="mb-5" data-testid="ai-agent-page-heading">
      <h2 className="text-lg font-semibold text-gray-900">
        {AI_AGENT_PAGE_TITLE}
      </h2>
      <p className="mt-1 text-sm text-gray-500">{AI_AGENT_PAGE_SUBTITLE}</p>
    </div>
  );

  if (isLoading) {
    return (
      <Fragment>
        {heading}
        <PageLoader isVisible={true} />
      </Fragment>
    );
  }

  // Nothing to show yet: the first load failed, so the error is the page.
  if (!status) {
    return (
      <Fragment>
        {heading}
        <ErrorMessage message={error || "Could not load the AI agent."} />
      </Fragment>
    );
  }

  /*
   * Read after the status has loaded: the permission snapshot arrives on
   * API response headers, so checking it during the first paint of a fresh
   * session would hide affordances the user actually has.
   */
  const settingsGate: PermissionGateResult = PermissionGate.check(
    new KubernetesCluster(),
    ModelAction.Update,
  );
  const testGate: PermissionGateResult = getAccessTestPermissionGate();
  const canConfigureUnattended: boolean =
    canConfigureUnattendedKubernetesAiAccess();
  const canChangeProjectSettings: boolean = canChangeProjectAiSettings();

  const aiAgent: KubernetesAiAgentSummary | null = getAiAgentSummary(status);
  const pill: AiAgentStatusPill = getAiAgentStatusPill(status);
  const command: AiAgentCardCommand = getAiAgentCardCommand(status);
  const helmCommands: AiAgentHelmCommands = getAiAgentHelmCommands();
  const metaParts: Array<string> = getAiAgentMetaParts(status);
  const refusedWarning: string | null = getRefusedRegistrationWarning(aiAgent);
  const attentionGaps: Array<KubernetesAiAccessGap> = getAttentionGaps(status);
  const isAdvanced: boolean = isAdvancedRunnerTarget(status);
  const hasTarget: boolean = status.runner !== null;
  const remediationMode: KubernetesAiRemediationMode = readRemediationMode(
    status.remediationMode,
  );
  const allowlistInEffect: Array<string> = getAllowlistInEffect(
    status.kubectlAllowlist,
  );
  const automaticInvestigation: KubernetesAiAutomaticInvestigationSettings | null =
    getAutomaticInvestigation(status);
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const projectName: string =
    props.currentProject?.name ||
    ProjectUtil.getCurrentProject()?.name ||
    "this project";
  const lastCheckedAt: string = status.evaluatedAt
    ? OneUptimeDate.getDateAsFormattedString(
        OneUptimeDate.fromString(status.evaluatedAt),
      )
    : "";

  const renderAsk: () => ReactElement = (): ReactElement => {
    return (
      <p
        className="text-xs font-medium text-gray-500"
        data-testid="ai-agent-gap-ask"
      >
        {ASK_PROJECT_ADMIN_TEXT}
      </p>
    );
  };

  const renderSettingsLink: (
    pageMap: PageMap,
    title: string,
  ) => ReactElement = (pageMap: PageMap, title: string): ReactElement => {
    return (
      <Link
        to={RouteUtil.populateRouteParams(RouteMap[pageMap] as Route)}
        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
      >
        <span>{title}</span>
        <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
      </Link>
    );
  };

  const renderGapAction: (gap: KubernetesAiAccessGap) => ReactElement = (
    gap: KubernetesAiAccessGap,
  ): ReactElement => {
    const action: AiAgentGapAction | null = getAiAgentGapAction(gap, status);

    switch (action) {
      case "turn_on_investigation":
        return settingsGate.isAllowed ? (
          <Button
            title="Turn on"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            isLoading={isActing}
            disabled={isActing}
            dataTestId="ai-agent-gap-turn-on-investigation"
            onClick={() => {
              runPageAction({
                run: async (): Promise<void> => {
                  await updateCluster({ isAiInvestigationEnabled: true });
                },
                notice: "AI may now investigate this cluster with kubectl.",
                isConfirmed: false,
              }).catch(() => {
                // handled inside runPageAction
              });
            }}
          />
        ) : (
          renderAsk()
        );
      case "open_ai_features":
        return canChangeProjectSettings
          ? renderSettingsLink(PageMap.SETTINGS_AI_FEATURES, "Open AI Features")
          : renderAsk();
      case "open_llm_providers":
        return canChangeProjectSettings
          ? renderSettingsLink(
              PageMap.SETTINGS_AI_LLM_PROVIDERS,
              "Open LLM Providers",
            )
          : renderAsk();
      case "open_ai_credits":
        return canChangeProjectSettings
          ? renderSettingsLink(PageMap.SETTINGS_AI_CREDITS, "Open AI Credits")
          : renderAsk();
      case "view_runner":
        return status.runner && canPickKubernetesRunner() ? (
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_RUNNER_VIEW] as Route,
              { modelId: new ObjectID(status.runner.id) },
            )}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            <span>View Runner</span>
            <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
          </Link>
        ) : (
          renderAsk()
        );
      case "test_connection":
        return testGate.isAllowed ? (
          <Button
            title="Test connection"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            isLoading={isTesting}
            disabled={isTesting}
            onClick={() => {
              runTest().catch(() => {
                // handled inside runTest
              });
            }}
          />
        ) : (
          renderAsk()
        );
      default:
        return <></>;
    }
  };

  const agentButtons: Array<ReactElement> = [];

  /*
   * There is nothing to test before anything can reach the cluster. Without
   * edit permission the button stays, locked, with the reason in its
   * tooltip; it is dropped only when there is nothing honest to say (the
   * permission snapshot has not landed).
   */
  if (hasTarget && (testGate.isAllowed || testGate.disabledReason)) {
    agentButtons.push(
      <Button
        key="test"
        title="Test connection"
        icon={IconProp.Play}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Normal}
        isLoading={isTesting}
        disabled={isTesting || !testGate.isAllowed}
        tooltip={
          testGate.isAllowed ? undefined : getAccessTestPermissionRequirement()
        }
        dataTestId="ai-agent-test-button"
        onClick={() => {
          if (!testGate.isAllowed || !hasTarget) {
            return;
          }
          runTest().catch(() => {
            // handled inside runTest
          });
        }}
      />,
    );
  }

  if (canSwitchToAiAgent(status) && canConfigureUnattended) {
    agentButtons.push(
      <Button
        key="switch"
        title="Switch to the AI agent"
        icon={IconProp.Refresh}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Normal}
        disabled={isActing}
        dataTestId="ai-agent-switch-button"
        onClick={() => {
          setConfirmationError("");
          setPendingConfirmation("switch");
        }}
      />,
    );
  }

  if (aiAgent && canResetKubernetesAiAgent()) {
    agentButtons.push(
      <Button
        key="reset"
        title="Reset agent"
        icon={IconProp.Refresh}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Normal}
        disabled={isActing}
        dataTestId="ai-agent-reset-button"
        onClick={() => {
          setConfirmationError("");
          setPendingConfirmation("reset");
        }}
      />,
    );
  }

  const settingsButtons: Array<ReactElement> =
    settingsGate.isAllowed || settingsGate.disabledReason
      ? [
          <Button
            key="change"
            title="Change"
            icon={IconProp.Edit}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Normal}
            disabled={!settingsGate.isAllowed}
            tooltip={settingsGate.disabledReason}
            dataTestId="ai-access-change-button"
            onClick={() => {
              if (!settingsGate.isAllowed) {
                return;
              }
              setEditCapabilities(getKubernetesAiAccessEditCapabilities());
              setIsEditingSettings(true);
            }}
          />,
        ]
      : [];

  const renderConfirmation: () => ReactElement = (): ReactElement => {
    if (pendingConfirmation === "reset") {
      return (
        <ConfirmModal
          title="Reset the AI agent?"
          description="This revokes the agent's key. The agent in your cluster registers again on its own within a few minutes. Use it if the agent moved or its key may have leaked."
          submitButtonText="Reset agent"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isActing}
          error={confirmationError || undefined}
          onClose={() => {
            setPendingConfirmation(null);
          }}
          onSubmit={() => {
            runPageAction({
              run: async (): Promise<void> => {
                await postClusterAction(
                  "/kubernetes-cluster/ai-access/reset-agent",
                );
              },
              notice:
                "The AI agent was reset. It reconnects on its own within a few minutes.",
              isConfirmed: true,
            }).catch(() => {
              // handled inside runPageAction
            });
          }}
        />
      );
    }

    if (pendingConfirmation === "switch") {
      const writeAccess: string | null = describeAiAgentWriteAccess(
        aiAgent?.posture,
      );
      return (
        <ConfirmModal
          title="Switch to the AI agent?"
          description={`AI stops using Runner "${status.runner?.name || ""}"${
            status.credentialName
              ? ` and credential "${status.credentialName}"`
              : ""
          } and runs kubectl through the Kubernetes AI agent in this cluster. What fixes may change is then set by the agent's access${
            writeAccess ? ` (${writeAccess})` : ""
          }.`}
          submitButtonText="Switch"
          isLoading={isActing}
          error={confirmationError || undefined}
          onClose={() => {
            setPendingConfirmation(null);
          }}
          onSubmit={() => {
            runPageAction({
              run: async (): Promise<void> => {
                await updateCluster({
                  aiAccessRunnerId: null,
                  aiAccessCredentialId: null,
                });
              },
              notice: "AI now reaches this cluster through its AI agent.",
              isConfirmed: true,
            }).catch(() => {
              // handled inside runPageAction
            });
          }}
        />
      );
    }

    if (
      pendingConfirmation === "automatic_investigation" &&
      automaticInvestigation
    ) {
      return (
        <ConfirmModal
          title="Turn on automatic investigation?"
          description={getAutomaticInvestigationConfirmation({
            settings: automaticInvestigation,
            projectName,
          })}
          submitButtonText="Turn on"
          isLoading={isActing}
          error={confirmationError || undefined}
          onClose={() => {
            setPendingConfirmation(null);
          }}
          onSubmit={() => {
            runPageAction({
              run: async (): Promise<void> => {
                if (!projectId) {
                  throw new Error("No project is selected.");
                }
                await ModelAPI.updateById<Project>({
                  modelType: Project,
                  id: projectId,
                  data: getAutomaticInvestigationTurnOnChanges(
                    automaticInvestigation,
                  ),
                });
              },
              notice: "Automatic investigation is on for this project.",
              isConfirmed: true,
            }).catch(() => {
              // handled inside runPageAction
            });
          }}
        >
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_AI] as Route,
            )}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            <span>Open settings</span>
            <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
          </Link>
        </ConfirmModal>
      );
    }

    return <></>;
  };

  return (
    <Fragment>
      {heading}

      {error ? (
        <Alert
          type={AlertType.WARNING}
          strongTitle="Could not refresh the AI agent status"
          title={`${error}${
            lastCheckedAt
              ? ` Showing the last status from ${lastCheckedAt}; this page retries on its own.`
              : " Showing the last known status; this page retries on its own."
          }`}
          dataTestId="ai-access-refresh-warning"
        />
      ) : (
        <></>
      )}

      {actionError ? (
        <Alert
          type={AlertType.DANGER}
          strongTitle="That did not work"
          title={actionError}
          dataTestId="ai-agent-action-error"
        />
      ) : (
        <></>
      )}

      {actionNotice ? (
        <Alert
          type={AlertType.SUCCESS}
          title={actionNotice}
          dataTestId="ai-agent-action-notice"
        />
      ) : (
        <></>
      )}

      <Card
        title="Kubernetes AI agent"
        description="The small pod in your cluster that runs kubectl for OneUptime AI."
        rightElement={
          <span data-testid="ai-agent-status">
            <Pill
              text={pill.text}
              color={PILL_COLORS[pill.tone]}
              icon={pill.tone === "success" ? IconProp.Check : undefined}
            />
          </span>
        }
        buttons={agentButtons}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-900" data-testid="ai-agent-sentence">
            {getAiAgentStateSentence(status)}
          </p>

          {command === "install" ? (
            <div className="space-y-2">
              <div data-testid="ai-agent-install-command">
                <CodeBlock language="bash" code={helmCommands.install} />
              </div>
              <p className="text-xs text-gray-500">
                {AI_AGENT_OTHER_RELEASE_TEXT}
              </p>
            </div>
          ) : command === "logs" ? (
            <div data-testid="ai-agent-logs-command">
              <CodeBlock
                language="bash"
                code={getAiAgentLogsCommand(getAiAgentPodNamespace(status))}
              />
            </div>
          ) : (
            <></>
          )}

          {metaParts.length > 0 ? (
            <p className="text-xs text-gray-500" data-testid="ai-agent-meta">
              {metaParts.join(" · ")}
            </p>
          ) : (
            <></>
          )}

          {status.isInvestigationReady ? (
            <div
              className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"
              data-testid="ai-agent-ready"
            >
              <Icon
                icon={IconProp.CheckCircle}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
              />
              <p className="text-sm text-emerald-900">{AI_AGENT_READY_TEXT}</p>
            </div>
          ) : (
            <></>
          )}

          {refusedWarning ? (
            <Alert
              type={AlertType.WARNING}
              title={refusedWarning}
              dataTestId="ai-agent-refused-registration"
            />
          ) : (
            <></>
          )}

          {hasTarget && !testGate.isAllowed && testGate.disabledReason ? (
            <p
              className="text-xs text-gray-500"
              data-testid="ai-agent-test-permission-note"
            >
              {getAccessTestPermissionRequirement()}
            </p>
          ) : (
            <></>
          )}

          {testError ? (
            <Alert
              type={AlertType.DANGER}
              strongTitle="The test could not run"
              title={testError}
              dataTestId="ai-agent-test-error"
            />
          ) : (
            <></>
          )}

          {testResult ? (
            <div className="space-y-3" data-testid="ai-agent-test-results">
              <Alert
                type={testResult.ok ? AlertType.SUCCESS : AlertType.WARNING}
                strongTitle={
                  testResult.ok
                    ? "The connection works"
                    : "The connection is not working yet"
                }
                title={testResult.message}
              />
              {testResult.results.map(
                (
                  row: AccessTestResult["results"][number],
                  index: number,
                ): ReactElement => {
                  return (
                    <div
                      key={index}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-gray-800">
                          {row.command}
                        </span>
                        <Pill
                          text={
                            row.succeeded
                              ? "succeeded"
                              : `failed${
                                  row.exitCode !== null
                                    ? ` (exit ${row.exitCode})`
                                    : ""
                                }`
                          }
                          color={row.succeeded ? Green500 : Red500}
                        />
                      </div>
                      {row.errorMessage ? (
                        <p className="mt-1 text-xs text-rose-600">
                          {row.errorMessage}
                        </p>
                      ) : (
                        <></>
                      )}
                      {row.output ? (
                        <pre className="mt-2 max-h-72 overflow-auto rounded border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800">
                          {row.output}
                        </pre>
                      ) : (
                        <></>
                      )}
                    </div>
                  );
                },
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {attentionGaps.length > 0 ? (
        <Card
          title="Needs attention"
          description="Each item stops OneUptime AI from doing part of its job on this cluster."
        >
          <ul className="space-y-2" data-testid="ai-agent-gaps">
            {attentionGaps.map((gap: KubernetesAiAccessGap): ReactElement => {
              return (
                <li
                  key={gap.code}
                  data-testid={`ai-agent-gap-${gap.code}`}
                  className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <Icon
                      icon={IconProp.Alert}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {gap.title}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-gray-700">
                        {gap.nextStep}
                      </p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 sm:pl-4">
                    {renderGapAction(gap)}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <></>
      )}

      <Card
        title="What AI may do"
        description="Changes apply to the next incident or alert."
        buttons={settingsButtons}
      >
        <div className="space-y-4">
          <dl className="space-y-3">
            <SettingRow
              label="Investigate with kubectl"
              dataTestId="ai-access-investigation-value"
            >
              {status.isInvestigationEnabled
                ? "Yes — read-only (get, describe, logs, events, top)"
                : "No — AI investigates with OneUptime data only"}
            </SettingRow>
            <SettingRow label="Fixes" dataTestId="ai-access-fixes-value">
              <span>
                <span className="font-medium">
                  {REMEDIATION_MODE_SHORT_NAMES[remediationMode]}
                </span>
                {" — "}
                {REMEDIATION_MODE_SUMMARIES[remediationMode]}
              </span>
            </SettingRow>
            {remediationMode === KubernetesAiRemediationMode.Automatic ? (
              <SettingRow
                label="kubectl allowlist"
                dataTestId="kubectl-allowlist-in-effect"
              >
                {allowlistInEffect.length > 0 ? (
                  <ul className="space-y-0.5">
                    {allowlistInEffect.map(
                      (pattern: string, index: number): ReactElement => {
                        return (
                          <li
                            key={`${index}:${pattern}`}
                            className="break-words font-mono text-xs text-gray-800"
                          >
                            {pattern}
                          </li>
                        );
                      },
                    )}
                  </ul>
                ) : (
                  "None"
                )}
              </SettingRow>
            ) : (
              <></>
            )}
          </dl>

          {remediationMode === KubernetesAiRemediationMode.Disabled ? (
            <p
              className="text-sm text-gray-600"
              data-testid="ai-access-fixes-off-hint"
            >
              {AI_AGENT_FIXES_OFF_HINT}
            </p>
          ) : (
            <></>
          )}

          {isAdvanced &&
          remediationMode !== KubernetesAiRemediationMode.Disabled ? (
            <p
              className="text-xs text-gray-500"
              data-testid="ai-access-credential-rbac-note"
            >
              What a fix may change is limited by the Runner&apos;s credential.
            </p>
          ) : (
            <></>
          )}

          {shouldShowWriteAccessCommands(status) ? (
            <div
              className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
              data-testid="ai-access-write-commands"
            >
              <p className="text-sm font-medium text-gray-900">
                Give the agent write access
              </p>
              <p className="text-xs leading-5 text-gray-600">
                The agent is read-only, so fixes cannot run yet. Recommended:
                allow only the namespaces AI may fix.
              </p>
              <div data-testid="ai-access-helm-remediation-scoped-command">
                <CodeBlock
                  language="bash"
                  code={helmCommands.enableRemediationScoped}
                />
              </div>
              <p
                className="text-xs leading-5 text-gray-500"
                data-testid="ai-access-helm-remediation-scoped-note"
              >
                {getAiAgentScopedCommandNote()}
              </p>
              <p className="text-xs leading-5 text-gray-600">
                Or allow the whole cluster:
              </p>
              <div data-testid="ai-access-helm-remediation-command">
                <CodeBlock
                  language="bash"
                  code={helmCommands.enableRemediation}
                />
              </div>
              <p
                className="text-xs leading-5 text-gray-500"
                data-testid="ai-access-helm-remediation-note"
              >
                {getAiAgentClusterWideCommandNote()}
              </p>
              <p
                className="text-xs leading-5 text-gray-700"
                data-testid="ai-access-write-disclosure"
              >
                {getAiAgentWriteDisclosure()}
              </p>
            </div>
          ) : (
            <></>
          )}

          {automaticInvestigation ? (
            <div
              className="flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid="ai-access-automatic-investigation"
            >
              <p className="text-xs text-gray-600">
                {getAutomaticInvestigationLine(automaticInvestigation)}
              </p>
              {automaticInvestigation.incidents &&
              automaticInvestigation.alerts ? (
                <></>
              ) : canChangeProjectSettings ? (
                <Button
                  title="Turn on"
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  disabled={isActing}
                  dataTestId="ai-access-automatic-investigation-turn-on"
                  onClick={() => {
                    setConfirmationError("");
                    setPendingConfirmation("automatic_investigation");
                  }}
                />
              ) : (
                <p
                  className="text-xs font-medium text-gray-500"
                  data-testid="ai-access-automatic-investigation-ask"
                >
                  {ASK_PROJECT_ADMIN_TEXT}
                </p>
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {isEditingSettings && editCapabilities ? (
        <AiAccessSettingsModal
          clusterId={modelId}
          capabilities={editCapabilities}
          isAdvancedBinding={isAdvanced}
          hasAiAgent={aiAgent !== null}
          onClose={() => {
            setIsEditingSettings(false);
          }}
          onSaved={() => {
            setIsEditingSettings(false);
            refresh();
          }}
        />
      ) : (
        <></>
      )}

      {renderConfirmation()}
    </Fragment>
  );
};

export default KubernetesClusterAiAgent;
