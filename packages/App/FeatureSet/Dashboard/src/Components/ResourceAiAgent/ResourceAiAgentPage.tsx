import PageComponentProps from "../../Pages/PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  ResourceAiAgentDescriptor,
  ResourceAiModel,
} from "./ResourceAiAgentDescriptors";
import {
  RESOURCE_AI_ACCESS_RESET_AGENT_ROUTE,
  RESOURCE_AI_ACCESS_STATUS_ROUTE,
  RESOURCE_AI_ACCESS_TEST_ROUTE,
  RESOURCE_AI_AGENT_PAGE_TITLE,
  RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS,
  RESOURCE_AI_ASK_PROJECT_ADMIN_TEXT,
  ResourceAccessTestResult,
  ResourceAiAgentCardCommand,
  RESOURCE_AI_SETTINGS_SET_BY_TEXT,
  ResourceAiAgentGapAction,
  ResourceAiAgentMeta,
  ResourceAiAgentStatusPill,
  ResourceAiAttention,
  ResourceAiAttentionStep,
  getResourceAiAccessRequestBody,
  getResourceAiAgentCardCommand,
  getResourceAiAgentCardState,
  getResourceAiAgentInstallInvestigationText,
  getResourceAiAgentMeta,
  getResourceAiSettingsChoice,
  getResourceAiSettingsSource,
  getResourceAiAgentPageSubtitle,
  getResourceAiAgentReadyText,
  getResourceAiAgentStateSentence,
  getResourceAiAgentStatusPill,
  getResourceAiAttention,
  getResourceAiRefusedRegistrationWarning,
  parseResourceAccessTestResult,
  parseResourceAiAccessStatus,
  shouldShowResourceWriteAccessCommands,
} from "./ResourceAiAgentStatus";
import {
  ResourceAiAccessConfirmation,
  ResourceAiAccessOfferedFields,
  ResourceAiAccessSavedSettings,
  ResourceAiAccessSettingsFormValues,
  RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
  RESOURCE_REMEDIATION_MODE_SUMMARIES,
  capitalizeFirst,
  formatNameList,
  getEveryModeProtections,
  getResourceAiAccessAdminPermissionTitles,
  getResourceAiAccessConfirmation,
  getResourceAiAccessLooseningChanges,
  getResourceAiAccessOfferedFields,
  getResourceAiAccessSettingsChanges,
  getResourceAiAccessSettingsInitialValues,
  getResourceAiAccessSubmittedFields,
  getResourceAllowlistFieldDescription,
  getResourceAllowlistInEffect,
  getResourceAllowlistRemovalOnlyError,
  getResourceInvestigationOnSentence,
  getResourceRemediationModeOptionDescriptions,
  isResourceAllowlistFieldShown,
  isResourceRemediationModeOpenToEveryEditor,
  readResourceAiAccessSavedSettings,
  readResourceRemediationMode,
  validateResourceAllowlistText,
} from "./ResourceAiAccessSettingsUtil";
import {
  ResourceAiAgentInstall,
  ResourceAiAgentInstallVariable,
  ResourceAiAgentWriteAccessCommands,
  getResourceAiAgentInstall,
  getResourceAiAgentLogsCommand,
  getResourceAiAgentSettingsInstructions,
  getResourceAiAgentWriteAccessCommands,
  getResourceAiAgentWriteDisclosure,
} from "./ResourceAiAgentInstall";
import {
  canChangeProjectAiSettingsForResource,
  canConfigureUnattendedResourceAiAccess,
  canResetResourceAiAgent,
  getResourceAccessTestPermissionGate,
  getResourceAccessTestPermissionMessage,
  getResourceAccessTestPermissionRequirement,
  getResourceSettingsGate,
} from "./ResourceAiAccessPermissions";
import {
  AI_ACCESS_FIXES_ROW_TITLE,
  AI_ACCESS_INVESTIGATION_ROW_TITLE,
  AI_FIXES_MODE_ICONS,
  AI_FIXES_OFF_AGENT_SET_HINT,
  AgentAiSettingsChoice,
  formatAiAccessProtections,
  getAiAccessCardDescription,
  getAiFixesBadge,
  getAiFixesFieldDescription,
  getAiFixesModeCardTitle,
  getAiFixesOffHint,
  getAiInvestigationBadge,
  getAiInvestigationOffSentence,
} from "../AiAccess/AiAccessModes";
import {
  AiAccessActionPanel,
  AiAccessAllowlist,
  AiAccessHint,
  AiAccessPermissionNote,
  AiAccessProtections,
  AiAccessRow,
  AiAccessRows,
  AiAccessSetBy,
} from "../AiAccess/AiAccessRow";
import AgentAiSettingsModal from "../AiAccess/AgentAiSettingsModal";
import { AgentAiSettingsInstructions } from "../AiAccess/AgentAiSettingsInstructions";
import AgentVersion from "../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../Components/AgentVersion/AgentKind";
import { AiAgentAction, getAiAgentActions } from "../AiAccess/AiAgentActions";
import {
  AiAgentTestProgress,
  getAiAgentCardButtons,
} from "../AiAccess/AiAgentActionsMenu";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import Color from "Common/Types/Color";
import { Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import Select from "Common/Types/BaseDatabase/Select";
import {
  ResourceAiAccessStatus,
  ResourceAiAgentSummary,
  ResourceAiRemediationMode,
} from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
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
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  AgentAiSettingsSource,
  isAgentAiSettingsSourceAgent,
} from "Common/Types/AI/AgentAiSettings";
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
import { useParams } from "react-router-dom";
import {
  translatableTerm,
  translateTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * A resource's AI agent page (AI → AI agent): whether OneUptime AI can reach
 * this resource and what it may do there, in three cards at most — the
 * resource twin of Pages/Kubernetes/View/AI/Agent.tsx, driven by a
 * descriptor so one component serves every resource type:
 *
 *  A. "<Resource> AI agent": the connection, with the install instructions
 *     or the logs command where they are the next step. Its status sits in
 *     the header with one ⋯ beside it for the connection test and the admin
 *     action (reset the agent) - ../AiAccess/AiAgentActions.ts.
 *  B. "Needs attention": the server's gaps as ONE item, only when there
 *     are any — a headline saying what AI cannot do here, then one short
 *     step per gap with its action. The page never builds a readiness
 *     checklist of its own.
 *  C. "What AI may do": one row for investigation and one for fixes, each
 *     with a badge that says where it stands and one plain sentence (the
 *     rows are shared with the cluster page, ../AiAccess), and the write
 *     switch when fixes need it.
 *
 * What AI did on the resource lives on the AI Logs page (AI → Logs), and
 * what it learned there on the AI Insights page (AI → Insights).
 */

export interface ComponentProps extends PageComponentProps {
  descriptor: ResourceAiAgentDescriptor;
}

const PILL_COLORS: Record<ResourceAiAgentStatusPill["tone"], Color> = {
  success: Green500,
  danger: Red500,
  neutral: Gray500,
};

function useResourceId(): ObjectID {
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

async function postResourceAiAccess(data: {
  route: string;
  descriptor: ResourceAiAgentDescriptor;
  resourceId: ObjectID;
}): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(data.route),
      data: getResourceAiAccessRequestBody(
        data.descriptor,
        data.resourceId.toString(),
      ),
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

// What an editor without the admin set may change here, and what they may not.
function AdminPermissionNote(): ReactElement {
  return (
    <AiAccessPermissionNote
      canText={translationKey(
        "You can turn investigation on or off, lower fixes and remove allowlist entries.",
      )}
      cannotText={translateTemplate(
        "Turning fixes on or up, or adding allowlist entries, needs {{permissions}}.",
        {
          permissions: formatNameList(
            getResourceAiAccessAdminPermissionTitles(),
            translateTemplate("or"),
          ),
        },
      )}
      dataTestId="resource-ai-access-admin-note"
    />
  );
}

interface SettingsModalProps {
  descriptor: ResourceAiAgentDescriptor;
  resourceId: ObjectID;
  canConfigureUnattended: boolean;
  /*
   * The resource's AI agent sets investigation and fixes: the form edits the
   * command allowlist alone (the server refuses the rest).
   */
  isSetByAgent?: boolean | undefined;
  onClose: () => void;
  onSaved: () => void;
}

/*
 * The "What AI may do" Change modal. Not a ModelForm: a ModelForm submits
 * every field it shows, so an editor who only switched investigation off
 * would re-send the unchanged fixes mode and allowlist — writes the server
 * refuses unless they hold the admin set. This form sends only what
 * changed, offers what the user may do (every editor may tighten; only the
 * admin set may loosen), validates the allowlist with the resource type's
 * own command policy, and asks before a save that lets riskier changes run
 * unattended.
 */
const ResourceAiAccessSettingsModal: FunctionComponent<SettingsModalProps> = (
  props: SettingsModalProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [saved, setSaved] = useState<ResourceAiAccessSavedSettings | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [pendingSave, setPendingSave] = useState<{
    changes: JSONObject;
    confirmation: ResourceAiAccessConfirmation;
  } | null>(null);
  const formRef: MutableRefObject<any> = useRef<any>(null);
  // Blocks a second save while one is in flight (double click, Enter + click).
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const descriptor: ResourceAiAgentDescriptor = props.descriptor;
  const canConfigureUnattended: boolean = props.canConfigureUnattended;

  useEffect(() => {
    let isMounted: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const model: ResourceAiModel | null =
          await ModelAPI.getItem<ResourceAiModel>({
            modelType: descriptor.modelType,
            id: props.resourceId,
            select: {
              _id: true,
              isAiInvestigationEnabled: true,
              aiRemediationMode: true,
              aiCommandAllowlist: true,
            },
          });

        if (!model) {
          throw new Error(
            translator.translateTemplate(
              "Could not read this {{noun}}'s AI settings. It may have been deleted, or you may no longer have access to it.",
              { noun: translatableTerm(descriptor.noun) },
            ),
          );
        }

        if (isMounted) {
          setSaved(readResourceAiAccessSavedSettings(model));
          setIsLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setLoadError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
      }
    };

    load().catch(() => {
      // handled inside load
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const offered: ResourceAiAccessOfferedFields | null = useMemo(() => {
    if (!saved) {
      return null;
    }

    return getResourceAiAccessOfferedFields({
      saved,
      canConfigureUnattended,
      isSetByAgent: props.isSetByAgent,
    });
  }, [saved, canConfigureUnattended, props.isSetByAgent]);

  /*
   * Built once everything has loaded — BasicForm reads its initial values
   * once, on the first render in which the fields exist.
   */
  const fields: Fields<ResourceAiAccessSettingsFormValues> = useMemo(() => {
    if (!saved || !offered) {
      return [];
    }

    // Without the admin set, every mode at or below the saved one.
    const modes: Array<ResourceAiRemediationMode> = canConfigureUnattended
      ? Object.values(ResourceAiRemediationMode)
      : Object.values(ResourceAiRemediationMode).filter(
          (mode: ResourceAiRemediationMode): boolean => {
            return isResourceRemediationModeOpenToEveryEditor(
              mode,
              saved.aiRemediationMode,
            );
          },
        );
    const modeDescriptions: Record<ResourceAiRemediationMode, string> =
      getResourceRemediationModeOptionDescriptions(descriptor);

    const investigationAndFixes: Fields<ResourceAiAccessSettingsFormValues> = [
      {
        field: { isAiInvestigationEnabled: true },
        title: descriptor.investigateTitle,
        description: translator.translateTemplate(
          "Read-only: {{readExamples}}. An investigation never changes this {{noun}}.",
          {
            readExamples: descriptor.readExamples,
            noun: translatableTerm(descriptor.noun),
          },
        ),
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        dataTestId: "ai-investigation-field",
      },
      {
        // One card per mode, each saying what it does.
        field: { aiRemediationMode: true },
        title: AI_ACCESS_FIXES_ROW_TITLE,
        description: getAiFixesFieldDescription(descriptor.noun),
        fieldType: FormFieldSchemaType.CardSelect,
        cardSelectSingleColumn: true,
        required: true,
        dataTestId: "ai-remediation-mode-field",
        cardSelectOptions: modes.map(
          (mode: ResourceAiRemediationMode): CardSelectOption => {
            return {
              value: mode,
              title: getAiFixesModeCardTitle({
                mode,
                savedMode: saved.aiRemediationMode,
                shortNames: RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
              }),
              description: modeDescriptions[mode],
              icon: AI_FIXES_MODE_ICONS[mode],
            };
          },
        ),
      },
    ];

    // While the agent sets them, its .env changes them, not this form.
    const result: Fields<ResourceAiAccessSettingsFormValues> =
      offered.investigationAndFixes === false ? [] : investigationAndFixes;

    if (offered.allowlist) {
      result.push({
        field: { aiCommandAllowlistText: true },
        title: "Command allowlist",
        // Who may add entries is the admin note's, at the top of the modal.
        description: getResourceAllowlistFieldDescription(descriptor),
        fieldType: FormFieldSchemaType.LongText,
        required: false,
        placeholder: descriptor.allowlistPlaceholder,
        dataTestId: "ai-command-allowlist-field",
        showIf: isResourceAllowlistFieldShown,
        customValidation: (
          values: FormValues<ResourceAiAccessSettingsFormValues>,
        ): string | null => {
          return (
            validateResourceAllowlistText(
              descriptor.resourceType,
              values.aiCommandAllowlistText,
            ) ||
            (offered.allowlistRemoveOnly
              ? getResourceAllowlistRemovalOnlyError({
                  text: values.aiCommandAllowlistText,
                  storedValue: saved.aiCommandAllowlist,
                })
              : null)
          );
        },
      });
    }

    return result;
  }, [saved, offered]);

  const initialValues: FormValues<ResourceAiAccessSettingsFormValues> =
    useMemo(() => {
      return saved ? getResourceAiAccessSettingsInitialValues(saved) : {};
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
      await ModelAPI.updateById<ResourceAiModel>({
        modelType: descriptor.modelType,
        id: props.resourceId,
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
    values: FormValues<ResourceAiAccessSettingsFormValues>,
  ) => void = (values: FormValues<ResourceAiAccessSettingsFormValues>) => {
    if (!saved || !offered || isSavingRef.current) {
      return;
    }

    setSaveError("");

    const changes: JSONObject = getResourceAiAccessSettingsChanges({
      saved,
      values,
      offered: getResourceAiAccessSubmittedFields({ offered, values }),
    });

    if (Object.keys(changes).length === 0) {
      // Nothing changed; there is nothing to write.
      props.onClose();
      return;
    }

    if (!canConfigureUnattended) {
      const loosening: Array<string> = getResourceAiAccessLooseningChanges({
        saved,
        changes,
      });
      if (loosening.length > 0) {
        setSaveError(
          translator.translateTemplate(
            "{{changes}} needs one of these permissions: {{permissions}}.",
            {
              changes: capitalizeFirst(loosening.join(", ")),
              permissions:
                getResourceAiAccessAdminPermissionTitles().join(", "),
            },
          ),
        );
        return;
      }
    }

    const confirmation: ResourceAiAccessConfirmation | null =
      getResourceAiAccessConfirmation({ descriptor, saved, changes });

    if (confirmation) {
      setPendingSave({ changes, confirmation });
      return;
    }

    save(changes).catch(() => {
      // handled inside save
    });
  };

  return (
    <>
      <Modal
        title={
          props.isSetByAgent
            ? "Edit the command allowlist"
            : "Change what AI may do"
        }
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
          {!canConfigureUnattended && !props.isSetByAgent ? (
            <AdminPermissionNote />
          ) : (
            <></>
          )}

          {loadError ? (
            <ErrorMessage message={loadError} />
          ) : isLoading || !saved || !offered ? (
            <ComponentLoader />
          ) : (
            <BasicForm
              ref={formRef}
              id={`${descriptor.commandsTableId}-access-form`}
              name="Change what AI may do"
              fields={fields}
              initialValues={initialValues}
              hideSubmitButton={true}
              footer={<></>}
              onSubmit={onSubmit}
            />
          )}

          {saved ? (
            <AiAccessProtections
              protections={formatAiAccessProtections(
                getEveryModeProtections(descriptor),
              )}
            />
          ) : (
            <></>
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

/*
 * The install instructions: that AI investigations are on by default, so
 * the agent is the only step (said while the resource's investigation
 * switch is on — someone may have turned it off before installing), the
 * compose snippet, how to start it, and what it reads.
 */
function InstallInstructions(props: {
  install: ResourceAiAgentInstall;
  descriptor: ResourceAiAgentDescriptor;
  isInvestigationEnabled: boolean;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <div className="space-y-3" data-testid="ai-agent-install">
      {props.isInvestigationEnabled ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"
          data-testid="ai-agent-install-investigation"
        >
          <Icon
            icon={IconProp.MagnifyingGlass}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
          />
          <p className="text-xs leading-5 text-emerald-900">
            {getResourceAiAgentInstallInvestigationText(props.descriptor)}
          </p>
        </div>
      ) : (
        <></>
      )}
      <p className="text-xs text-gray-600" data-testid="ai-agent-install-where">
        {props.install.whereText}
      </p>
      <div data-testid="ai-agent-install-command">
        <CodeBlock language="yaml" code={props.install.composeSnippet} />
      </div>
      <p className="text-xs text-gray-600">
        {translator.translateText("Then start it:")}
      </p>
      <div data-testid="ai-agent-install-start">
        <CodeBlock language="bash" code={props.install.startCommand} />
      </div>
      {props.install.prerequisites.length > 0 ? (
        <ul
          className="list-disc space-y-1 pl-5 text-xs leading-5 text-gray-600"
          data-testid="ai-agent-install-prerequisites"
        >
          {props.install.prerequisites.map(
            (prerequisite: string): ReactElement => {
              return (
                <li key={prerequisite}>
                  {translator.translateText(prerequisite)}
                </li>
              );
            },
          )}
        </ul>
      ) : (
        <></>
      )}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table
          className="min-w-full divide-y divide-gray-200 text-xs"
          data-testid="ai-agent-install-variables"
        >
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-500">
                {translator.translateText("Variable")}
              </th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">
                {translator.translateText("Value")}
              </th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">
                {translator.translateText("What it does")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {props.install.variables.map(
              (variable: ResourceAiAgentInstallVariable): ReactElement => {
                return (
                  <tr
                    key={variable.name}
                    data-testid={`ai-agent-install-variable-${variable.name}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-800">
                      {variable.name}
                    </td>
                    <td className="break-all px-3 py-2 font-mono text-gray-800">
                      {variable.value}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {translator.translateText(variable.description)}
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The write switch, for an agent that runs read-only while fixes are on.
function WriteAccessInstructions(props: {
  descriptor: ResourceAiAgentDescriptor;
}): ReactElement {
  const translator: Translator = useTranslator();
  const commands: ResourceAiAgentWriteAccessCommands =
    getResourceAiAgentWriteAccessCommands(props.descriptor.resourceType);

  return (
    <AiAccessActionPanel
      title="Give the agent write access"
      dataTestId="ai-access-write-commands"
    >
      <p className="text-xs leading-5 text-gray-600">
        {translator.translateText(
          "The agent is read-only, so fixes cannot run yet.",
        )}
      </p>
      {commands.installerNote ? (
        <p
          className="text-xs leading-5 text-gray-600"
          data-testid="ai-access-write-installer-note"
        >
          {commands.installerNote}
        </p>
      ) : (
        <></>
      )}
      <p
        className="text-xs leading-5 text-gray-600"
        data-testid="ai-access-write-env-intro"
      >
        {commands.envIntro}
      </p>
      {commands.scopedEnv ? (
        <>
          <div data-testid="ai-access-write-scoped-env">
            <CodeBlock language="bash" code={commands.scopedEnv} />
          </div>
          {commands.scopedNote ? (
            <p
              className="text-xs leading-5 text-gray-500"
              data-testid="ai-access-write-scoped-note"
            >
              {commands.scopedNote}
            </p>
          ) : (
            <></>
          )}
          <p className="text-xs leading-5 text-gray-600">
            {translator.translateText("Or allow every target:")}
          </p>
        </>
      ) : (
        <></>
      )}
      <div data-testid="ai-access-write-all-env">
        <CodeBlock language="bash" code={commands.allTargetsEnv} />
      </div>
      <p className="text-xs leading-5 text-gray-600">
        {translator.translateText("Then restart the agent:")}
      </p>
      <div data-testid="ai-access-write-restart-command">
        <CodeBlock language="bash" code={commands.restartCommand} />
      </div>
      <p
        className="text-xs leading-5 text-gray-700"
        data-testid="ai-access-write-disclosure"
      >
        {getResourceAiAgentWriteDisclosure(props.descriptor.resourceType)}
      </p>
    </AiAccessActionPanel>
  );
}

const ResourceAiAgentPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const descriptor: ResourceAiAgentDescriptor = props.descriptor;
  const modelId: ObjectID = useResourceId();

  const [status, setStatus] = useState<ResourceAiAccessStatus | null>(null);
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
  const [testResult, setTestResult] = useState<ResourceAccessTestResult | null>(
    null,
  );
  const [testError, setTestError] = useState<string>("");
  const [refresher, setRefresher] = useState<boolean>(false);
  const [isEditingSettings, setIsEditingSettings] = useState<boolean>(false);
  /*
   * Whether the Change modal may loosen, read when it opens. Kept in state
   * so a status poll re-rendering the page cannot rebuild the open form.
   */
  const [editCanConfigureUnattended, setEditCanConfigureUnattended] =
    useState<boolean>(false);
  /*
   * The "Change what AI may do" dialog for settings the agent sets (or that
   * could move to it): open with what it should start on, or null.
   */
  const [agentSettingsDialog, setAgentSettingsDialog] = useState<{
    turnOnInvestigation: boolean;
  } | null>(null);
  const [isConfirmingReset, setIsConfirmingReset] = useState<boolean>(false);
  const [isActing, setIsActing] = useState<boolean>(false);
  const [confirmationError, setConfirmationError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [actionNotice, setActionNotice] = useState<string>("");
  // The identity the agent must register with, for the install instructions.
  const [identity, setIdentity] = useState<string | null>(null);
  const isTestingRef: MutableRefObject<boolean> = useRef<boolean>(false);
  const isActingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const fetchStatus: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const data: JSONObject = await postResourceAiAccess({
          route: RESOURCE_AI_ACCESS_STATUS_ROUTE,
          descriptor,
          resourceId: modelId,
        });

        const parsed: ResourceAiAccessStatus | null =
          parseResourceAiAccessStatus(data);

        if (!parsed) {
          throw new Error(
            translateTemplate(
              "The server returned an AI agent status this page cannot read.",
            ),
          );
        }

        setStatus(parsed);
        setError("");
      } catch (err) {
        // Keep whatever is already on screen; the render decides.
        setError(API.getFriendlyMessage(err));
      }
      setIsLoading(false);
    }, [modelId, descriptor]);

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
    }, RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [fetchStatus]);

  const needsInstall: boolean =
    status !== null && getResourceAiAgentCardState(status) === "not_installed";

  /*
   * The resource's identity (the name its collector reports), read once
   * the install instructions are shown, so they pin the agent to exactly
   * this resource. Failing to read it only leaves the instructions on the
   * collector's own variable.
   */
  useEffect(() => {
    if (!needsInstall || !descriptor.identityColumn) {
      return;
    }

    let isMounted: boolean = true;
    const column: string = descriptor.identityColumn;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const model: ResourceAiModel | null =
          await ModelAPI.getItem<ResourceAiModel>({
            modelType: descriptor.modelType,
            id: modelId,
            select: { _id: true, [column]: true } as Select<ResourceAiModel>,
          });
        const value: unknown = model
          ? (model as unknown as Record<string, unknown>)[column]
          : null;

        if (isMounted && typeof value === "string" && value.trim()) {
          setIdentity(value.trim());
        }
      } catch {
        // The instructions fall back to the collector's variable.
      }
    };

    load().catch(() => {
      // handled inside load
    });

    return () => {
      isMounted = false;
    };
  }, [needsInstall, modelId, descriptor]);

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
      const data: JSONObject = await postResourceAiAccess({
        route: RESOURCE_AI_ACCESS_TEST_ROUTE,
        descriptor,
        resourceId: modelId,
      });

      setTestResult(parseResourceAccessTestResult(data));
      const refreshed: ResourceAiAccessStatus | null =
        parseResourceAiAccessStatus(data["status"]);
      if (refreshed) {
        setStatus(refreshed);
      }
    } catch (err) {
      /*
       * A permission refusal is about RUNNING the test. The route shares
       * its check with the settings writes, and the server's sentence may
       * talk about changing AI access — which this user did not try.
       */
      setTestError(
        err instanceof HTTPErrorResponse &&
          err.statusCode === ExceptionCode.NotAuthorizedException
          ? getResourceAccessTestPermissionMessage(descriptor)
          : API.getFriendlyMessage(err),
      );
    }
    isTestingRef.current = false;
    setIsTesting(false);
  };

  /*
   * One page action at a time (reset, a gap's one-click fix). A confirmed
   * action reports a failure inside its dialog; an unconfirmed one on the
   * page.
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
      setIsConfirmingReset(false);
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

  const updateResource: (data: JSONObject) => Promise<void> = async (
    data: JSONObject,
  ): Promise<void> => {
    await ModelAPI.updateById<ResourceAiModel>({
      modelType: descriptor.modelType,
      id: modelId,
      data,
    });
  };

  // Shown in every state, like the AI Insights and AI Logs pages' headings.
  const heading: ReactElement = (
    <div className="mb-5" data-testid="ai-agent-page-heading">
      <h2 className="text-lg font-semibold text-gray-900">
        {translator.translateText(RESOURCE_AI_AGENT_PAGE_TITLE)}
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        {getResourceAiAgentPageSubtitle(descriptor)}
      </p>
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
  const settingsGate: PermissionGateResult =
    getResourceSettingsGate(descriptor);
  const testGate: PermissionGateResult =
    getResourceAccessTestPermissionGate(descriptor);
  const canChangeProjectSettings: boolean =
    canChangeProjectAiSettingsForResource();

  const agent: ResourceAiAgentSummary | null = status.agent;
  const pill: ResourceAiAgentStatusPill = getResourceAiAgentStatusPill(status);
  const command: ResourceAiAgentCardCommand =
    getResourceAiAgentCardCommand(status);
  const meta: ResourceAiAgentMeta = getResourceAiAgentMeta(status, descriptor);
  const isAgentVersionShown: boolean =
    meta.showsAgentVersion &&
    (Boolean(agent?.agentVersion) || Boolean(agent?.posture?.agentVersion));
  const aiSettingsSource: AgentAiSettingsSource =
    getResourceAiSettingsSource(status);
  const isSetByAgent: boolean = isAgentAiSettingsSourceAgent(aiSettingsSource);
  // Settings chosen here that could move to the agent's .env.
  const canMoveSettingsToAgent: boolean = !isSetByAgent && agent !== null;
  const currentChoice: AgentAiSettingsChoice =
    getResourceAiSettingsChoice(status);
  const refusedWarning: string | null = getResourceAiRefusedRegistrationWarning(
    agent,
    descriptor,
  );
  const attention: ResourceAiAttention | null = getResourceAiAttention(
    status,
    descriptor,
  );
  const hasAgent: boolean = agent !== null;
  const remediationMode: ResourceAiRemediationMode =
    readResourceRemediationMode(status.aiRemediationMode);
  const allowlistInEffect: Array<string> = getResourceAllowlistInEffect(
    status.aiCommandAllowlist,
  );
  const lastVerifiedAt: string = status.aiAccessLastVerifiedAt
    ? OneUptimeDate.getDateAsFormattedString(
        OneUptimeDate.fromString(status.aiAccessLastVerifiedAt),
      )
    : "";

  const renderAsk: () => ReactElement = (): ReactElement => {
    return (
      <p
        className="text-xs font-medium text-gray-500"
        data-testid="ai-agent-gap-ask"
      >
        {translator.translateText(RESOURCE_AI_ASK_PROJECT_ADMIN_TEXT)}
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

  const openAgentSettingsDialog: (turnOnInvestigation: boolean) => void = (
    turnOnInvestigation: boolean,
  ): void => {
    setAgentSettingsDialog({ turnOnInvestigation });
  };

  const renderStepAction: (
    action: ResourceAiAgentGapAction | null,
  ) => ReactElement = (
    action: ResourceAiAgentGapAction | null,
  ): ReactElement => {
    switch (action) {
      case "set_investigation_in_agent":
        // Instructions only: anyone who can see the page may read them.
        return (
          <Button
            title="Show how"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId="ai-agent-gap-show-investigation-command"
            onClick={() => {
              openAgentSettingsDialog(true);
            }}
          />
        );
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
                  await updateResource({ isAiInvestigationEnabled: true });
                },
                notice: translator.translateTemplate(
                  "AI may now investigate this {{noun}} with {{commands}}.",
                  {
                    noun: translatableTerm(descriptor.noun, {
                      inSentence: true,
                    }),
                    commands: translatableTerm(
                      descriptor.readOnlyCommandsPhrase,
                    ),
                  },
                ),
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
      case "test_connection":
        return testGate.isAllowed ? (
          <Button
            title="Test connection"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            isLoading={isTesting}
            disabled={isTesting}
            dataTestId="ai-agent-gap-test-connection"
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

  /*
   * The agent card's ⋯. There is nothing to test or reset before an agent
   * registered.
   */
  const agentActions: Array<AiAgentAction> = getAiAgentActions({
    testConnection: {
      hasTarget: hasAgent,
      gate: testGate,
      permissionRequirement:
        getResourceAccessTestPermissionRequirement(descriptor),
      isRunning: isTesting,
      onRun: (): void => {
        runTest().catch(() => {
          // handled inside runTest
        });
      },
    },
    resetAgent: {
      isOffered: hasAgent && canResetResourceAiAgent(),
      onClick: (): void => {
        setConfirmationError("");
        setIsConfirmingReset(true);
      },
    },
    isActing,
  });

  /*
   * While the agent sets investigation and fixes, Change shows how to change
   * them in the agent — instructions, so it is offered to everyone who can
   * see the page; the server refuses an edit here anyway.
   */
  const settingsButtons: Array<ReactElement> = isSetByAgent
    ? [
        <Button
          key="change"
          title="Change"
          icon={IconProp.Edit}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Normal}
          dataTestId="ai-access-change-button"
          onClick={() => {
            openAgentSettingsDialog(false);
          }}
        />,
      ]
    : settingsGate.isAllowed || settingsGate.disabledReason
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
              setEditCanConfigureUnattended(
                canConfigureUnattendedResourceAiAccess(),
              );
              setIsEditingSettings(true);
            }}
          />,
        ]
      : [];

  const install: ResourceAiAgentInstall | null =
    command === "install"
      ? getResourceAiAgentInstall({
          resourceType: descriptor.resourceType,
          resourceId: modelId.toString(),
          identity,
        })
      : null;

  return (
    <Fragment>
      {heading}

      {error ? (
        <Alert
          type={AlertType.WARNING}
          strongTitle="Could not refresh the AI agent status"
          title={translator.translateTemplate(
            "{{error}} Showing the last known status; this page retries on its own.",
            { error: error },
          )}
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
        title={descriptor.agentName}
        description={descriptor.agentCardDescription}
        rightElement={
          <span data-testid="ai-agent-status">
            <Pill
              text={pill.text}
              color={PILL_COLORS[pill.tone]}
              icon={pill.tone === "success" ? IconProp.Check : undefined}
            />
          </span>
        }
        buttons={getAiAgentCardButtons(agentActions)}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-900" data-testid="ai-agent-sentence">
            {getResourceAiAgentStateSentence(status, descriptor)}
          </p>

          {install ? (
            <InstallInstructions
              install={install}
              descriptor={descriptor}
              isInvestigationEnabled={status.isAiInvestigationEnabled}
            />
          ) : command === "logs" ? (
            <div data-testid="ai-agent-logs-command">
              <CodeBlock
                language="bash"
                code={getResourceAiAgentLogsCommand(descriptor.resourceType)}
              />
            </div>
          ) : (
            <></>
          )}

          {meta.lastSeen || isAgentVersionShown || meta.rest.length > 0 ? (
            <div className="text-xs text-gray-500" data-testid="ai-agent-meta">
              {[
                ...(meta.lastSeen
                  ? [<span key="last-seen">{meta.lastSeen}</span>]
                  : []),
                ...(isAgentVersionShown
                  ? [
                      <span key="agent-version" data-testid="ai-agent-version">
                        <TranslatedSentence
                          template="agent {{version}}"
                          slots={{
                            version: (
                              <AgentVersion
                                kind={AgentKind.ResourceAiAgent}
                                version={
                                  agent?.agentVersion ||
                                  agent?.posture?.agentVersion
                                }
                                upgradeGuideContext={{
                                  resourceType: descriptor.resourceType,
                                }}
                              />
                            ),
                          }}
                        />
                      </span>,
                    ]
                  : []),
                ...meta.rest.map((part: string): ReactElement => {
                  return <span key={part}>{part}</span>;
                }),
              ].map((part: ReactElement, index: number): ReactElement => {
                return (
                  <Fragment key={`meta-${index}`}>
                    {index > 0 ? " · " : ""}
                    {part}
                  </Fragment>
                );
              })}
            </div>
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
              <p className="text-sm text-emerald-900">
                {getResourceAiAgentReadyText(descriptor)}
              </p>
            </div>
          ) : (
            <></>
          )}

          {status.aiAccessLastError ? (
            <p
              className="text-xs text-rose-600"
              data-testid="ai-agent-last-error"
            >
              {lastVerifiedAt
                ? translator.translateTemplate(
                    "Last command error (last worked {{lastVerifiedAt}}): {{error}}",
                    {
                      lastVerifiedAt: lastVerifiedAt,
                      error: status.aiAccessLastError,
                    },
                  )
                : translator.translateTemplate(
                    "Last command error: {{error}}",
                    {
                      error: status.aiAccessLastError,
                    },
                  )}
            </p>
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

          {hasAgent && !testGate.isAllowed && testGate.disabledReason ? (
            <p
              className="text-xs text-gray-500"
              data-testid="ai-agent-test-permission-note"
            >
              {getResourceAccessTestPermissionRequirement(descriptor)}
            </p>
          ) : (
            <></>
          )}

          {isTesting ? <AiAgentTestProgress /> : <></>}

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
                  row: ResourceAccessTestResult["results"][number],
                  index: number,
                ): ReactElement => {
                  return (
                    <div
                      key={index}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                      data-testid="ai-agent-test-result-row"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-gray-800">
                          {row.command}
                        </span>
                        <Pill
                          text={
                            row.succeeded
                              ? "succeeded"
                              : row.exitCode !== null
                                ? translator.translateTemplate(
                                    "failed (exit {{exitCode}})",
                                    { exitCode: row.exitCode },
                                  )
                                : "failed"
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

      {attention ? (
        <Card title="Needs attention">
          <div
            className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3"
            data-testid="ai-agent-attention"
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
            />
            <div className="min-w-0 flex-1">
              <p
                className="text-sm font-medium text-gray-900"
                data-testid="ai-agent-attention-title"
              >
                {attention.title}
              </p>
              <ol className="mt-2 space-y-2" data-testid="ai-agent-gaps">
                {attention.steps.map(
                  (
                    step: ResourceAiAttentionStep,
                    index: number,
                  ): ReactElement => {
                    return (
                      <li
                        key={`${index}:${step.gap.code}`}
                        data-testid={`ai-agent-gap-${step.gap.code}`}
                        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="flex min-w-0 gap-2 text-sm text-gray-700">
                          {attention.steps.length > 1 ? (
                            <span
                              className="flex-shrink-0 tabular-nums text-gray-500"
                              data-testid="ai-agent-gap-number"
                            >
                              {index + 1}.
                            </span>
                          ) : (
                            <></>
                          )}
                          <span className="min-w-0">{step.text}</span>
                        </p>
                        <div className="flex-shrink-0 sm:pl-4">
                          {renderStepAction(step.action)}
                        </div>
                      </li>
                    );
                  },
                )}
              </ol>
            </div>
          </div>
        </Card>
      ) : (
        <></>
      )}

      <Card
        title="What AI may do"
        description={getAiAccessCardDescription(descriptor.noun)}
        buttons={settingsButtons}
      >
        {isSetByAgent || canMoveSettingsToAgent ? (
          <AiAccessSetBy
            text={translator.translateTemplate(
              RESOURCE_AI_SETTINGS_SET_BY_TEXT[aiSettingsSource],
              { agent: translatableTerm(descriptor.agentName) },
            )}
            isSetByAgent={isSetByAgent}
            actionText={
              isSetByAgent ? undefined : translator.translateText("Show how")
            }
            onAction={
              isSetByAgent
                ? undefined
                : () => {
                    openAgentSettingsDialog(false);
                  }
            }
            dataTestId="ai-access-set-by"
          />
        ) : (
          <></>
        )}
        <AiAccessRows>
          <AiAccessRow
            icon={IconProp.MagnifyingGlass}
            title={AI_ACCESS_INVESTIGATION_ROW_TITLE}
            badge={getAiInvestigationBadge(status.isAiInvestigationEnabled)}
            sentence={
              status.isAiInvestigationEnabled
                ? getResourceInvestigationOnSentence(descriptor)
                : getAiInvestigationOffSentence(descriptor.noun)
            }
            dataTestId="ai-access-investigation"
          />
          <AiAccessRow
            icon={IconProp.WrenchScrewdriver}
            title={AI_ACCESS_FIXES_ROW_TITLE}
            badge={getAiFixesBadge({
              mode: remediationMode,
              shortNames: RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
            })}
            sentence={RESOURCE_REMEDIATION_MODE_SUMMARIES[remediationMode]}
            dataTestId="ai-access-fixes"
          >
            {remediationMode === ResourceAiRemediationMode.Disabled ? (
              <AiAccessHint
                text={
                  isSetByAgent
                    ? translator.translateText(AI_FIXES_OFF_AGENT_SET_HINT) ||
                      AI_FIXES_OFF_AGENT_SET_HINT
                    : getAiFixesOffHint(
                        settingsGate.isAllowed &&
                          canConfigureUnattendedResourceAiAccess(),
                      )
                }
                dataTestId="ai-access-fixes-off-hint"
              />
            ) : null}
            {remediationMode === ResourceAiRemediationMode.Automatic ? (
              <AiAccessAllowlist
                title="Command allowlist"
                patterns={allowlistInEffect}
                dataTestId="ai-command-allowlist-in-effect"
                /*
                 * The allowlist stays OneUptime's: with the agent setting
                 * the modes, Change shows the agent's .env, so the list is
                 * edited from here.
                 */
                editText={
                  isSetByAgent &&
                  settingsGate.isAllowed &&
                  (canConfigureUnattendedResourceAiAccess() ||
                    allowlistInEffect.length > 0)
                    ? translator.translateText("Edit")
                    : undefined
                }
                onEdit={() => {
                  setEditCanConfigureUnattended(
                    canConfigureUnattendedResourceAiAccess(),
                  );
                  setIsEditingSettings(true);
                }}
              />
            ) : null}
            {shouldShowResourceWriteAccessCommands(status) ? (
              <WriteAccessInstructions descriptor={descriptor} />
            ) : null}
          </AiAccessRow>
        </AiAccessRows>
      </Card>

      {isEditingSettings ? (
        <ResourceAiAccessSettingsModal
          descriptor={descriptor}
          resourceId={modelId}
          canConfigureUnattended={editCanConfigureUnattended}
          isSetByAgent={isSetByAgent}
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

      {agentSettingsDialog ? (
        <AgentAiSettingsModal
          agentName={descriptor.agentName}
          source={aiSettingsSource}
          current={currentChoice}
          turnOnInvestigation={agentSettingsDialog.turnOnInvestigation}
          fixesShortNames={RESOURCE_REMEDIATION_MODE_SHORT_NAMES}
          fixesDescriptions={getResourceRemediationModeOptionDescriptions(
            descriptor,
          )}
          getInstructions={(
            choice: AgentAiSettingsChoice,
          ): AgentAiSettingsInstructions => {
            return getResourceAiAgentSettingsInstructions({
              resourceType: descriptor.resourceType,
              choice,
              doesAgentReportSettings: Boolean(agent?.posture?.aiSettings),
            });
          }}
          onClose={() => {
            setAgentSettingsDialog(null);
          }}
        />
      ) : (
        <></>
      )}

      {isConfirmingReset ? (
        <ConfirmModal
          title="Reset the AI agent?"
          description={translator.translateTemplate(
            "This revokes the {{agentName}}'s key. The agent registers again on its own within a few minutes. Use it if the agent moved or its key may have leaked.",
            { agentName: translatableTerm(descriptor.agentName) },
          )}
          submitButtonText="Reset agent"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isActing}
          error={confirmationError || undefined}
          onClose={() => {
            setIsConfirmingReset(false);
          }}
          onSubmit={() => {
            runPageAction({
              run: async (): Promise<void> => {
                await postResourceAiAccess({
                  route: RESOURCE_AI_ACCESS_RESET_AGENT_ROUTE,
                  descriptor,
                  resourceId: modelId,
                });
              },
              notice: translator.translateTemplate(
                "The {{agent}} was reset. It reconnects on its own within a few minutes.",
                { agent: translatableTerm(descriptor.agentName) },
              ),
              isConfirmed: true,
            }).catch(() => {
              // handled inside runPageAction
            });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default ResourceAiAgentPage;
