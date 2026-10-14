import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  Argument,
  ArgumentShownWhen,
  ComponentInputType,
  ComponentType,
  Port,
  ReturnValue,
} from "./../Component";
import {
  PAGE_ARGUMENT_IDS,
  PAGE_ERROR_PORT_ID,
  PAGE_IN_PORT_ID,
  PAGE_RETURN_VALUE_IDS,
  PAGE_SUCCESS_PORT_ID,
  PageAbout,
} from "./OnCallPageSettings";

/*
 * THE PAGE STEPS: page people from a workflow.
 *
 *   Page Users                 the people it names
 *   Page a Team                every member of a team
 *   Page Whoever Is On Call    the person on call in a schedule right now
 *   Page an On-Call Policy     a policy, with its escalation rules
 *
 * One step for each thing a person looks for, each with one who-to-page
 * setting, rather than one step with four. Behind an If / Else or a
 * Switch / Case, that is "page somebody when...".
 *
 * A page is about something: a title and a message, which become a new
 * alert, or an incident or alert that is already there. Each person is
 * paged through their own On-Call Rules - call, SMS, push, email - and
 * acknowledging the page acknowledges the alert or the incident
 * (Server/Services/OnCallPageService does the paging).
 *
 * The first three page directly, with no on-call policy behind the page:
 * everybody at once, and no escalation. The fourth starts a policy, which
 * escalates and repeats as the policy says.
 */

// The step category these belong to, and its name in the Add Component panel.
export const ON_CALL_COMPONENT_CATEGORY: string = "On-Call";

/*
 * Every step gets settings, ports and return values of its own - never one
 * object shared between steps - so nothing that changes one step's can
 * reach another's.
 */

// When the settings of a page about something new are shown.
const getNewAlertOnly: () => ArgumentShownWhen = (): ArgumentShownWhen => {
  return {
    argumentId: PAGE_ARGUMENT_IDS.about,
    values: [PageAbout.NewAlert],
    // An empty Page About stands for a new alert.
    includesEmpty: true,
  };
};

/*
 * What the page is about. The same on all four steps, after who to page:
 * the choice, then only the settings that go with it.
 */
const getAboutArguments: () => Array<Argument> = (): Array<Argument> => {
  return [
    {
      id: PAGE_ARGUMENT_IDS.about,
      name: "Page About",
      description:
        "What the page is about. The people paged are told this, and acknowledging the page acknowledges it.",
      type: ComponentInputType.Choice,
      // An empty one is a new alert, so there is always a choice made.
      required: false,
      choices: [
        {
          value: PageAbout.NewAlert,
          label: "A new alert",
          description:
            "Write a title and a message. OneUptime creates an alert from them.",
        },
        {
          value: PageAbout.Incident,
          label: "An incident",
          description:
            "An incident that is already there, such as the one that started this workflow.",
        },
        {
          value: PageAbout.Alert,
          label: "An alert",
          description:
            "An alert that is already there, such as the one that started this workflow.",
        },
      ],
    },
    {
      id: PAGE_ARGUMENT_IDS.title,
      name: "Title",
      description:
        "What the page says, in a few words. It becomes the new alert's title.",
      type: ComponentInputType.Text,
      required: true,
      placeholder: "Database CPU is above 90%",
      shownWhen: getNewAlertOnly(),
    },
    {
      id: PAGE_ARGUMENT_IDS.message,
      name: "Message",
      description:
        "More about it: what happened and what to do. It becomes the new alert's description, so Markdown works.",
      type: ComponentInputType.LongText,
      required: false,
      placeholder: "Queries are queueing on db-primary.",
      shownWhen: getNewAlertOnly(),
    },
    {
      id: PAGE_ARGUMENT_IDS.incidentId,
      name: "Incident ID",
      description:
        "The incident to page about. Usually the ID of the incident that started this workflow.",
      type: ComponentInputType.Text,
      required: true,
      placeholder: "Pick a value with { } or paste an ID",
      shownWhen: {
        argumentId: PAGE_ARGUMENT_IDS.about,
        values: [PageAbout.Incident],
      },
    },
    {
      id: PAGE_ARGUMENT_IDS.alertId,
      name: "Alert ID",
      description:
        "The alert to page about. Usually the ID of the alert that started this workflow.",
      type: ComponentInputType.Text,
      required: true,
      placeholder: "Pick a value with { } or paste an ID",
      shownWhen: {
        argumentId: PAGE_ARGUMENT_IDS.about,
        values: [PageAbout.Alert],
      },
    },
    {
      id: PAGE_ARGUMENT_IDS.alertSeverity,
      name: "Severity",
      description:
        "How severe the new alert is. Each person is paged by their own On-Call Rules for that severity. Left empty, it is the project's most severe.",
      type: ComponentInputType.AlertSeveritySelect,
      required: false,
      // What an empty list stands for, in the list itself.
      placeholder: "The project's most severe",
      isAdvanced: true,
      shownWhen: getNewAlertOnly(),
    },
  ];
};

const getInPorts: () => Array<Port> = (): Array<Port> => {
  return [
    {
      title: "In",
      description: "Connect the step that runs before this page.",
      id: PAGE_IN_PORT_ID,
    },
  ];
};

const getRecordReturnValues: () => Array<ReturnValue> =
  (): Array<ReturnValue> => {
    return [
      {
        id: PAGE_RETURN_VALUE_IDS.alertId,
        name: "Alert ID",
        description:
          "The alert the page is about: the new one, or the one in Alert ID. Empty for a page about an incident.",
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: PAGE_RETURN_VALUE_IDS.incidentId,
        name: "Incident ID",
        description:
          "The incident the page is about. Empty for a page about an alert.",
        type: ComponentInputType.Text,
        required: false,
      },
    ];
  };

const getErrorReturnValue: () => ReturnValue = (): ReturnValue => {
  return {
    id: PAGE_RETURN_VALUE_IDS.error,
    name: "Error",
    description: "Why nobody was paged, when nobody was.",
    type: ComponentInputType.Text,
    required: false,
  };
};

// What a step that pages people directly hands on.
const getDirectPageReturnValues: () => Array<ReturnValue> =
  (): Array<ReturnValue> => {
    return [
      {
        id: PAGE_RETURN_VALUE_IDS.summary,
        name: "Summary",
        description:
          "Who was paged and who was not, in a sentence or two. Ready to post to a channel.",
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: PAGE_RETURN_VALUE_IDS.pagedUsers,
        name: "Paged Users",
        description:
          "The people paged, as a list. Each has an id, a name and an email.",
        type: ComponentInputType.JSONArray,
        required: false,
      },
      ...getRecordReturnValues(),
      getErrorReturnValue(),
    ];
  };

const getDirectPageOutPorts: () => Array<Port> = (): Array<Port> => {
  return [
    {
      title: "Success",
      description: "Runs once at least one person is paged.",
      id: PAGE_SUCCESS_PORT_ID,
    },
    {
      title: "Error",
      description: "Runs when nobody was paged. Error says why.",
      id: PAGE_ERROR_PORT_ID,
    },
  ];
};

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.PageUsers,
    title: "Page Users",
    category: ON_CALL_COMPONENT_CATEGORY,
    description: "Pages the people you name, by their own on-call rules.",
    iconProp: IconProp.User,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: PAGE_ARGUMENT_IDS.users,
        name: "Users",
        description:
          "Who to page. Pick people of this project, or use a value from an earlier step: a user's ID or email address.",
        type: ComponentInputType.UserList,
        required: true,
      },
      ...getAboutArguments(),
    ],
    returnValues: getDirectPageReturnValues(),
    inPorts: getInPorts(),
    outPorts: getDirectPageOutPorts(),
  },
  {
    id: ComponentID.PageTeam,
    title: "Page a Team",
    category: ON_CALL_COMPONENT_CATEGORY,
    description: "Pages every member of a team, by their own on-call rules.",
    iconProp: IconProp.Team,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: PAGE_ARGUMENT_IDS.teams,
        name: "Teams",
        description:
          "Every member of each team is paged. Pick teams, or use a team's ID from an earlier step.",
        type: ComponentInputType.TeamList,
        required: true,
      },
      ...getAboutArguments(),
    ],
    returnValues: getDirectPageReturnValues(),
    inPorts: getInPorts(),
    outPorts: getDirectPageOutPorts(),
  },
  {
    id: ComponentID.PageOnCall,
    title: "Page Whoever Is On Call",
    category: ON_CALL_COMPONENT_CATEGORY,
    description: "Pages the person on call in a schedule right now.",
    iconProp: IconProp.Calendar,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: PAGE_ARGUMENT_IDS.onCallSchedules,
        name: "On-Call Schedules",
        description:
          "Whoever is on call in each schedule right now is paged. Pick schedules, or use a schedule's ID from an earlier step.",
        type: ComponentInputType.OnCallScheduleList,
        required: true,
      },
      ...getAboutArguments(),
    ],
    returnValues: getDirectPageReturnValues(),
    inPorts: getInPorts(),
    outPorts: getDirectPageOutPorts(),
  },
  {
    id: ComponentID.PageOnCallPolicy,
    title: "Page an On-Call Policy",
    category: ON_CALL_COMPONENT_CATEGORY,
    description: "Starts an on-call policy, with its escalation rules.",
    iconProp: IconProp.Call,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: PAGE_ARGUMENT_IDS.onCallPolicies,
        name: "On-Call Policies",
        description:
          "Each policy starts at its first escalation rule and pages as it always does. Pick policies, or use a policy's ID from an earlier step.",
        type: ComponentInputType.OnCallPolicyList,
        required: true,
      },
      ...getAboutArguments(),
    ],
    returnValues: [
      {
        id: PAGE_RETURN_VALUE_IDS.summary,
        name: "Summary",
        description:
          "Which policies started, in a sentence. Ready to post to a channel.",
        type: ComponentInputType.Text,
        required: false,
      },
      ...getRecordReturnValues(),
      getErrorReturnValue(),
    ],
    inPorts: getInPorts(),
    outPorts: [
      {
        title: "Success",
        description: "Runs once at least one policy has started.",
        id: PAGE_SUCCESS_PORT_ID,
      },
      {
        title: "Error",
        description: "Runs when no policy could be started. Error says why.",
        id: PAGE_ERROR_PORT_ID,
      },
    ],
  },
];

export default components;

/*
 * The who-to-page setting of each Page step: the setting's id, and the kind
 * of record its entries name.
 */
export enum PageTargetKind {
  User = "User",
  Team = "Team",
  OnCallSchedule = "OnCallSchedule",
  OnCallPolicy = "OnCallPolicy",
}

export interface PageStepTarget {
  argumentId: string;
  kind: PageTargetKind;
}

const PAGE_STEP_TARGETS: Record<string, PageStepTarget> = {
  [ComponentID.PageUsers]: {
    argumentId: PAGE_ARGUMENT_IDS.users,
    kind: PageTargetKind.User,
  },
  [ComponentID.PageTeam]: {
    argumentId: PAGE_ARGUMENT_IDS.teams,
    kind: PageTargetKind.Team,
  },
  [ComponentID.PageOnCall]: {
    argumentId: PAGE_ARGUMENT_IDS.onCallSchedules,
    kind: PageTargetKind.OnCallSchedule,
  },
  [ComponentID.PageOnCallPolicy]: {
    argumentId: PAGE_ARGUMENT_IDS.onCallPolicies,
    kind: PageTargetKind.OnCallPolicy,
  },
};

// The step's who-to-page setting, or null for a step that is not a Page step.
export function getPageStepTarget(
  metadataId: string | undefined | null,
): PageStepTarget | null {
  return (metadataId && PAGE_STEP_TARGETS[metadataId]) || null;
}

export function isPageStep(metadataId: string | undefined | null): boolean {
  return getPageStepTarget(metadataId) !== null;
}

// The kind of record each who-to-page input type lists.
const PAGE_TARGET_KIND_BY_INPUT_TYPE: Partial<
  Record<ComponentInputType, PageTargetKind>
> = {
  [ComponentInputType.UserList]: PageTargetKind.User,
  [ComponentInputType.TeamList]: PageTargetKind.Team,
  [ComponentInputType.OnCallScheduleList]: PageTargetKind.OnCallSchedule,
  [ComponentInputType.OnCallPolicyList]: PageTargetKind.OnCallPolicy,
};

export function getPageTargetKind(
  type: ComponentInputType,
): PageTargetKind | null {
  return PAGE_TARGET_KIND_BY_INPUT_TYPE[type] || null;
}
