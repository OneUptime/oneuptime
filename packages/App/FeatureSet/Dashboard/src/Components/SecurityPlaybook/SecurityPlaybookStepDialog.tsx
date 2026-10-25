import {
  CONNECTION_FIELD_BY_PROVIDER,
  STEP_ACTION_KEY,
  formValuesToStep,
  getNewStepFormValues,
  isApprovalSwitchOffered,
  stepToFormValues,
} from "./SecurityPlaybookStepForm";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IconProp from "Common/Types/Icon/IconProp";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "Common/Types/SecurityCase/SecurityCaseVerdict";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import { SecurityCaseValueLists } from "../SecurityCase/SecurityCaseValues";
import {
  getSecurityCasePriorityOptions,
  getSecurityCaseStatusOptions,
} from "../SecurityCase/SecurityCaseValueOptions";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SECURITY_PLAYBOOK_ACTION_CATEGORIES,
  SecurityPlaybookActionCategory,
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
  isSecurityPlaybookActionType,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  DefenderIsolationType,
  ENTITY_ACTIVITY_LOOKBACK_MAX_HOURS,
  ENTITY_ACTIVITY_LOOKBACK_MIN_HOURS,
  SecurityPlaybookStep,
  TURN_OFF_CONTAINMENT_APPROVAL_PERMISSIONS,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import Icon from "Common/UI/Components/Icon/Icon";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { SECURITY_CASE_TEMPLATE_PLACEHOLDERS } from "Common/Utils/SecurityCase/SecurityCaseMarkdown";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "Common/UI/Components/CardSelect/CardSelect";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { PeoplePickerKind } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useRef,
  useState,
} from "react";

export interface PlaybookConnectionOption {
  id: string;
  name: string;
  provider: SecurityEventConnectorProvider;
}

export interface ComponentProps {
  // Undefined: a new step, which starts by picking what it does.
  step?: SecurityPlaybookStep | undefined;
  // Where the step sits (or will sit) in the playbook, for its messages.
  index: number;
  connections: Array<PlaybookConnectionOption>;
  // The project's case priorities and statuses, which the case steps set.
  caseValues: SecurityCaseValueLists;
  onClose: () => void;
  onSubmit: (step: SecurityPlaybookStep) => Promise<void>;
}

// Every action as a card, grouped the way a response goes.
export function getActionCardGroups(): Array<CardSelectOptionGroup> {
  return SECURITY_PLAYBOOK_ACTION_CATEGORIES.map(
    (category: SecurityPlaybookActionCategory): CardSelectOptionGroup => {
      return {
        label: category,
        options: SECURITY_PLAYBOOK_ACTIONS.filter(
          (action: SecurityPlaybookActionDefinition): boolean => {
            return action.category === category;
          },
        ).map((action: SecurityPlaybookActionDefinition): CardSelectOption => {
          return {
            value: action.type,
            title: action.title,
            description: action.description,
            icon: action.icon,
          };
        }),
      };
    },
  );
}

/*
 * The placeholders a note or message may use, under its field: written as
 * code, so they are never taken for a translation's own placeholders.
 */
const PlaceholderHelp: FunctionComponent<{ lead: string }> = (props: {
  lead: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span className="block">
      <span>{translator.translateText(props.lead)}</span>
      <span className="mt-1 flex flex-wrap gap-1">
        {SECURITY_CASE_TEMPLATE_PLACEHOLDERS.map(
          (item: {
            placeholder: string;
            description: string;
          }): ReactElement => {
            return (
              <code
                key={item.placeholder}
                title={translator.translateText(item.description)}
                className="rounded bg-gray-100 px-1 py-0.5 text-[11px] text-gray-700"
              >
                {item.placeholder}
              </code>
            );
          },
        )}
      </span>
    </span>
  );
};

function isAction(
  values: FormValues<JSONObject>,
  ...actions: Array<SecurityPlaybookActionType>
): boolean {
  return actions.includes(
    values[STEP_ACTION_KEY] as SecurityPlaybookActionType,
  );
}

// The form key of the note a containment step shows in place of the toggle.
export const CONTAINMENT_APPROVAL_NOTE_KEY: string = "containmentApprovalNote";

/*
 * Needs Approval, for somebody who may not turn it off on a containment
 * step: what it is set to, and who can change it.
 */
const ContainmentApprovalNote: FunctionComponent<{ isOff: boolean }> = (props: {
  isOff: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
      <Icon icon={IconProp.Lock} className="mt-0.5 h-4 w-4 text-gray-400" />
      <span>
        {props.isOff
          ? translator.translateText(
              "Off: a Security Admin let this step run without approval. Only a Security Admin can change what it does.",
            )
          : translator.translateText(
              "On: a step that contains waits for someone to approve it on the case. Only a Security Admin can turn this off.",
            )}
      </span>
    </div>
  );
};

/*
 * The statuses Set status offers: every one but where each case starts,
 * nobody's archived ones (keeping the step's own).
 */
export function getStepStatusOptions(
  statuses: ReadonlyArray<SecurityCaseStatus>,
  keepId?: string | undefined,
): Array<DropdownOption> {
  const newStatus: SecurityCaseStatus | null =
    SecurityCaseStatuses.getStatusOfStage(statuses, SecurityCaseStage.New);

  return getSecurityCaseStatusOptions(
    statuses.filter((status: SecurityCaseStatus): boolean => {
      return !newStatus || status.id?.toString() !== newStatus.id?.toString();
    }),
    { keepId },
  );
}

function connectionOptions(
  connections: Array<PlaybookConnectionOption>,
  provider: SecurityEventConnectorProvider,
): Array<DropdownOption> {
  return connections
    .filter((connection: PlaybookConnectionOption): boolean => {
      return connection.provider === provider;
    })
    .map((connection: PlaybookConnectionOption): DropdownOption => {
      return { label: connection.name, value: connection.id };
    });
}

/*
 * The settings of every action, each shown only for its own: one dialog for
 * all of them, so adding a step is pick, fill, done. Needs Approval on a
 * containment step is a Security Admin's to turn off: anyone else sees what
 * it is set to, and the server holds them to it.
 */
export function getStepSettingsFields(
  connections: Array<PlaybookConnectionOption>,
  options: {
    mayTurnOffContainmentApproval: boolean;
    caseValues?: SecurityCaseValueLists | undefined;
    // The step's own priority and status ids, kept in the pickers if archived.
    step?: SecurityPlaybookStep | undefined;
  } = {
    mayTurnOffContainmentApproval: false,
  },
): Array<Field<JSONObject>> {
  const priorities: SecurityCaseValueLists["priorities"] =
    options.caseValues?.priorities || [];
  const statuses: SecurityCaseValueLists["statuses"] =
    options.caseValues?.statuses || [];
  const stepConfig: JSONObject = options.step?.config || {};
  const keep: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    const value: unknown = stepConfig[key];

    return typeof value === "string" && value ? value : undefined;
  };
  // A status that closes a case takes a verdict.
  const closesCase: (values: FormValues<JSONObject>) => boolean = (
    values: FormValues<JSONObject>,
  ): boolean => {
    return SecurityCaseStatuses.isClosed(
      statuses,
      values["statusId"] as string | undefined,
    );
  };

  const connectionField: (
    provider: SecurityEventConnectorProvider,
    actions: Array<SecurityPlaybookActionType>,
    description: string,
  ) => Field<JSONObject> = (
    provider: SecurityEventConnectorProvider,
    actions: Array<SecurityPlaybookActionType>,
    description: string,
  ): Field<JSONObject> => {
    const key: string =
      CONNECTION_FIELD_BY_PROVIDER[provider] || "connectionId";

    return {
      field: { [key]: true },
      title: "Connection",
      description: description,
      fieldType: FormFieldSchemaType.Dropdown,
      stepId: "settings",
      dropdownOptions: connectionOptions(connections, provider),
      placeholder: "Choose a connection",
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, ...actions);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, ...actions);
      },
    };
  };

  return [
    {
      field: { userId: true },
      title: "Person",
      description: "Optional. Who the case is assigned to.",
      fieldType: FormFieldSchemaType.PeoplePicker,
      stepId: "settings",
      peoplePicker: {
        kinds: [{ kind: PeoplePickerKind.User, valueKey: "userId" }],
        isSinglePick: true,
        addButtonText: translationKey("Choose someone"),
        searchPlaceholder: translationKey("Search by name or email…"),
        emptyText: translationKey("No project members"),
      },
      required: false,
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.AssignCase);
      },
    },
    {
      field: { teamId: true },
      title: "Team",
      description:
        "Optional. The team the case belongs to. Choose a person, a team, or both.",
      fieldType: FormFieldSchemaType.PeoplePicker,
      stepId: "settings",
      peoplePicker: {
        kinds: [{ kind: PeoplePickerKind.Team, valueKey: "teamId" }],
        isSinglePick: true,
        addButtonText: translationKey("Choose a team"),
        searchPlaceholder: translationKey("Search teams…"),
        emptyText: translationKey("No teams"),
      },
      required: false,
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.AssignCase);
      },
    },
    {
      field: { priorityId: true },
      title: "Priority",
      fieldType: FormFieldSchemaType.Dropdown,
      stepId: "settings",
      dropdownOptions: getSecurityCasePriorityOptions(priorities, {
        keepId: keep("priorityId"),
      }),
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.SetCasePriority);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.SetCasePriority);
      },
    },
    {
      field: { statusId: true },
      title: "Status",
      fieldType: FormFieldSchemaType.Dropdown,
      stepId: "settings",
      dropdownOptions: getStepStatusOptions(statuses, keep("statusId")),
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.SetCaseStatus);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.SetCaseStatus);
      },
    },
    {
      field: { verdict: true },
      title: "Verdict",
      description: "What the case is closed as.",
      fieldType: FormFieldSchemaType.Dropdown,
      stepId: "settings",
      dropdownOptions:
        DropdownUtil.getDropdownOptionsFromEnum(SecurityCaseVerdict),
      required: (values: FormValues<JSONObject>): boolean => {
        return (
          isAction(values, SecurityPlaybookActionType.SetCaseStatus) &&
          closesCase(values)
        );
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return (
          isAction(values, SecurityPlaybookActionType.SetCaseStatus) &&
          closesCase(values)
        );
      },
    },
    {
      field: { note: true },
      title: "Note",
      description: (
        <PlaceholderHelp lead="Markdown. These fill in from the case:" />
      ),
      fieldType: FormFieldSchemaType.Markdown,
      stepId: "settings",
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.AddCaseNote);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.AddCaseNote);
      },
    },
    {
      field: { labelIds: true },
      title: "Labels",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      stepId: "settings",
      dropdownModal: {
        type: Label,
        labelField: "name",
        valueField: "_id",
      },
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.AddCaseLabels);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.AddCaseLabels);
      },
    },
    {
      field: { raisePriorityToId: true },
      title: "On a Match, Raise Priority To",
      description:
        "Optional. When an entity is a known indicator, the case's priority rises to at least this.",
      fieldType: FormFieldSchemaType.Dropdown,
      stepId: "settings",
      dropdownOptions: getSecurityCasePriorityOptions(priorities, {
        keepId: keep("raisePriorityToId"),
      }),
      required: false,
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.CheckThreatIntel);
      },
    },
    {
      field: { lookbackInHours: true },
      title: "Look Back (Hours)",
      description:
        "How far back to count each entity's events: from 1 hour to 720 hours (30 days).",
      fieldType: FormFieldSchemaType.Number,
      stepId: "settings",
      validation: {
        minValue: ENTITY_ACTIVITY_LOOKBACK_MIN_HOURS,
        maxValue: ENTITY_ACTIVITY_LOOKBACK_MAX_HOURS,
      },
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(
          values,
          SecurityPlaybookActionType.LookUpEntityActivity,
        );
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(
          values,
          SecurityPlaybookActionType.LookUpEntityActivity,
        );
      },
    },
    {
      field: { emailRecipients: true },
      title: "Recipients",
      description: "The people, and the members of the teams, to email.",
      fieldType: FormFieldSchemaType.PeoplePicker,
      stepId: "settings",
      peoplePicker: {
        kinds: [
          { kind: PeoplePickerKind.User, valueKey: "userIds" },
          { kind: PeoplePickerKind.Team, valueKey: "teamIds" },
        ],
        addButtonText: translationKey("Add recipient"),
        searchPlaceholder: translationKey("Search people or teams..."),
        emptyText: translationKey("No people or teams available."),
      },
      required: false,
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.EmailPeople);
      },
    },
    {
      field: { channelName: true },
      title: "Channel",
      description: "The channel's name, without the #.",
      fieldType: FormFieldSchemaType.Text,
      stepId: "settings",
      placeholder: "security-alerts",
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(
          values,
          SecurityPlaybookActionType.PostToSlack,
          SecurityPlaybookActionType.PostToMicrosoftTeams,
        );
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(
          values,
          SecurityPlaybookActionType.PostToSlack,
          SecurityPlaybookActionType.PostToMicrosoftTeams,
        );
      },
    },
    {
      field: { microsoftTeamsTeamId: true },
      title: "Microsoft Teams Team ID",
      description:
        "The team the channel is in, by its ID: in Microsoft Teams, Get link to team, and copy the groupId from the link.",
      fieldType: FormFieldSchemaType.Text,
      stepId: "settings",
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(
          values,
          SecurityPlaybookActionType.PostToMicrosoftTeams,
        );
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(
          values,
          SecurityPlaybookActionType.PostToMicrosoftTeams,
        );
      },
    },
    {
      field: { message: true },
      title: "Message",
      description: (
        <PlaceholderHelp lead="Optional. Markdown; a summary of the case when empty. These fill in from the case:" />
      ),
      fieldType: FormFieldSchemaType.LongText,
      stepId: "settings",
      required: false,
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(
          values,
          SecurityPlaybookActionType.EmailPeople,
          SecurityPlaybookActionType.PostToSlack,
          SecurityPlaybookActionType.PostToMicrosoftTeams,
        );
      },
    },
    {
      field: { onCallPolicyId: true },
      title: "On-Call Policy",
      fieldType: FormFieldSchemaType.Dropdown,
      stepId: "settings",
      dropdownModal: {
        type: OnCallDutyPolicy,
        labelField: "name",
        valueField: "_id",
        sort: { name: SortOrder.Ascending },
      },
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.PageOnCall);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.PageOnCall);
      },
    },
    {
      field: { incidentSeverityId: true },
      title: "Incident Severity",
      fieldType: FormFieldSchemaType.Dropdown,
      stepId: "settings",
      dropdownModal: {
        type: IncidentSeverity,
        labelField: "name",
        valueField: "_id",
        sort: { order: SortOrder.Ascending },
      },
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.DeclareIncident);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.DeclareIncident);
      },
    },
    connectionField(
      SecurityEventConnectorProvider.OktaSystemLog,
      [
        SecurityPlaybookActionType.SuspendOktaUser,
        SecurityPlaybookActionType.EndOktaSessions,
        SecurityPlaybookActionType.UnsuspendOktaUser,
      ],
      translationKey(
        "The Okta connection to act through. Its API token needs permission to manage users. Add or test connections under Sources > Connections.",
      ),
    ),
    connectionField(
      SecurityEventConnectorProvider.CrowdStrikeFalcon,
      [
        SecurityPlaybookActionType.ContainCrowdStrikeHost,
        SecurityPlaybookActionType.LiftCrowdStrikeContainment,
      ],
      translationKey(
        "The CrowdStrike Falcon connection to act through. Its API client needs the Hosts write scope. Add or test connections under Sources > Connections.",
      ),
    ),
    connectionField(
      SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      [
        SecurityPlaybookActionType.IsolateDefenderDevice,
        SecurityPlaybookActionType.ReleaseDefenderDevice,
      ],
      translationKey(
        "The Microsoft Defender XDR connection to act through. Its app needs the Machine.Isolate permission. Add or test connections under Sources > Connections.",
      ),
    ),
    {
      field: { isolationType: true },
      title: "Isolation",
      description:
        "Full cuts the device off from everything but Defender; Selective keeps Outlook, Teams and Skype working.",
      fieldType: FormFieldSchemaType.Dropdown,
      stepId: "settings",
      dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
        DefenderIsolationType,
      ),
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(
          values,
          SecurityPlaybookActionType.IsolateDefenderDevice,
        );
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(
          values,
          SecurityPlaybookActionType.IsolateDefenderDevice,
        );
      },
    },
    {
      field: { url: true },
      title: "Webhook URL",
      description:
        "The case is posted to it as JSON, signed so the receiver can check it came from OneUptime.",
      fieldType: FormFieldSchemaType.URL,
      stepId: "settings",
      placeholder: "https://example.com/hooks/security",
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.SendWebhook);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.SendWebhook);
      },
    },
    {
      field: { workflowId: true },
      title: "Workflow",
      description:
        "A workflow that starts on a webhook. It receives the case as the webhook's body.",
      fieldType: FormFieldSchemaType.Dropdown,
      stepId: "settings",
      dropdownModal: {
        type: Workflow,
        labelField: "name",
        valueField: "_id",
        sort: { name: SortOrder.Ascending },
      },
      required: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.RunWorkflow);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isAction(values, SecurityPlaybookActionType.RunWorkflow);
      },
    },
    {
      field: { requiresApproval: true },
      title: "Needs Approval",
      description:
        "Someone other than whoever started the run must approve this step on the case. Containment steps always need it unless a Security Admin turns it off.",
      fieldType: FormFieldSchemaType.Toggle,
      stepId: "settings",
      required: false,
      showHorizontalRuleAbove: true,
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isApprovalSwitchOffered(
          values[STEP_ACTION_KEY],
          options.mayTurnOffContainmentApproval,
        );
      },
    },
    {
      field: { [CONTAINMENT_APPROVAL_NOTE_KEY]: true },
      title: "Needs Approval",
      fieldType: FormFieldSchemaType.CustomComponent,
      stepId: "settings",
      required: false,
      hideOptionalLabel: true,
      showHorizontalRuleAbove: true,
      showIf: (values: FormValues<JSONObject>): boolean => {
        return !isApprovalSwitchOffered(
          values[STEP_ACTION_KEY],
          options.mayTurnOffContainmentApproval,
        );
      },
      getCustomElement: (values: FormValues<JSONObject>): ReactElement => {
        return (
          <ContainmentApprovalNote
            isOff={values["requiresApproval"] === false}
          />
        );
      },
    },
    {
      field: { onlyIfThreatIntelMatched: true },
      title: "Only If Threat Intel Matched",
      description:
        "Skip this step unless an earlier Check Threat Intel step of the run found a known indicator.",
      fieldType: FormFieldSchemaType.Toggle,
      stepId: "settings",
      required: false,
    },
    {
      field: { continueOnFailure: true },
      title: "Carry On If It Fails",
      description:
        "Run the next step even if this one fails. Off: a failed step stops the run.",
      fieldType: FormFieldSchemaType.Toggle,
      stepId: "settings",
      required: false,
    },
  ];
}

/*
 * Adds a step to a playbook or changes one. A new step starts with what it
 * does, picked from cards grouped the way a response goes; then its
 * settings. The step is checked against the same rules the server saves it
 * with, so a missing channel or connection is said here.
 */
const SecurityPlaybookStepDialog: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const pickedAction: MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(props.step?.action);
  const isNew: boolean = !props.step;
  const definition: SecurityPlaybookActionDefinition | undefined = props.step
    ? getSecurityPlaybookAction(props.step.action)
    : undefined;

  const actionField: Field<JSONObject> = {
    field: { [STEP_ACTION_KEY]: true },
    title: "What should this step do?",
    fieldType: FormFieldSchemaType.CardSelect,
    stepId: "action",
    cardSelectOptions: getActionCardGroups(),
    cardSelectSearchable: true,
    cardSelectSearchPlaceholder: "Search actions",
    required: true,
  };

  return (
    <BasicFormModal<JSONObject>
      title={isNew ? "Add Step" : `Edit Step ${props.index + 1}`}
      description={
        definition
          ? `${definition.title}: ${definition.description}`
          : "Pick what the step does, then fill in its settings."
      }
      modalWidth={ModalWidth.Large}
      submitButtonText={isNew ? "Add Step" : "Save Step"}
      isLoading={isLoading}
      error={error}
      onClose={props.onClose}
      formProps={{
        name: "security-playbook-step",
        initialValues: props.step
          ? stepToFormValues(props.step)
          : {
              requiresApproval: false,
              continueOnFailure: false,
              onlyIfThreatIntelMatched: false,
            },
        onChange: (
          values: FormValues<JSONObject>,
          setNewFormValues: (newValues: FormValues<JSONObject>) => void,
        ) => {
          const action: unknown = values[STEP_ACTION_KEY];

          // A newly picked action brings its own defaults: disruptive ones wait for approval.
          if (
            isNew &&
            typeof action === "string" &&
            action !== pickedAction.current &&
            isSecurityPlaybookActionType(action)
          ) {
            pickedAction.current = action;
            setNewFormValues({
              ...values,
              ...getNewStepFormValues(action),
            } as FormValues<JSONObject>);
          }
        },
        steps: isNew
          ? [
              { title: "Action", id: "action" },
              { title: "Settings", id: "settings" },
            ]
          : [{ title: "Settings", id: "settings" }],
        fields: [
          ...(isNew ? [actionField] : []),
          ...getStepSettingsFields(props.connections, {
            mayTurnOffContainmentApproval: PermissionGate.holdsAnyOf(
              TURN_OFF_CONTAINMENT_APPROVAL_PERMISSIONS,
            ),
            caseValues: props.caseValues,
            step: props.step,
          }),
        ],
      }}
      onSubmit={async (values: FormValues<JSONObject>) => {
        setError("");

        let step: SecurityPlaybookStep;

        try {
          step = formValuesToStep({
            values: values as JSONObject,
            stepId: props.step?.id,
            index: props.index,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          return;
        }

        setIsLoading(true);

        try {
          await props.onSubmit(step);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }

        setIsLoading(false);
      }}
    />
  );
};

export default SecurityPlaybookStepDialog;
