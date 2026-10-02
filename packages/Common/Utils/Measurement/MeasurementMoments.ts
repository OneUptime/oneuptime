import AlertMeasurementAnchorType from "../../Types/Alerts/AlertMeasurementAnchorType";
import AlertStateRole from "../../Types/Alerts/AlertStateRole";
import IconProp from "../../Types/Icon/IconProp";
import IncidentMeasurementAnchorType from "../../Types/Incident/IncidentMeasurementAnchorType";
import IncidentStateRole from "../../Types/Incident/IncidentStateRole";
import MeasurementOccurrence from "../../Types/Measurement/MeasurementOccurrence";
import ScheduledMaintenanceMeasurementAnchorType from "../../Types/ScheduledMaintenance/ScheduledMaintenanceMeasurementAnchorType";
import ScheduledMaintenanceStateRole from "../../Types/ScheduledMaintenance/ScheduledMaintenanceStateRole";

/*
 * Measurements, the way a person thinks about them.
 *
 * A measurement is the time between two moments in an incident, an alert or
 * a scheduled maintenance event - "time to acknowledge" is the time from
 * when an incident is declared to when someone acknowledges it. The API
 * stores each end as an anchor: a type ("Declared At", "State Role
 * Entered", "Timeline Start", ...) and, for some types, a state role or a
 * state. That is exact, and it is not how anybody says it: the settings
 * form asked people to pick an "Anchor Type" of "State Role Entered" and
 * then a role of "Acknowledged" to say "when the incident is acknowledged".
 *
 * So the form offers moments instead - one item per thing a measurement
 * can start or end at, in plain words - and this module is where a moment
 * and the stored anchor are turned into each other. It is pure, shared by
 * the dashboard (the form, the list) and the tests that hold the two in
 * step:
 *
 *   - every anchor type and every state role of a domain is a moment, so
 *     every measurement the API can hold can be shown and edited;
 *   - anchor types that are the same instant by construction show as one
 *     moment ("Timeline Start" is when an incident is declared - the
 *     server's validator treats the two as the same point too);
 *   - the ready-made measurements (presets) are written in moments.
 */

export enum MeasurementDomain {
  Incident = "Incident",
  Alert = "Alert",
  ScheduledMaintenance = "ScheduledMaintenance",
}

export interface MeasurementMoment {
  /*
   * What a form holds for the moment: the anchor type, or for a state role
   * the anchor type and the role ("State Role Entered:Acknowledged").
   */
  value: string;
  // The anchor it is stored as.
  anchorType: string;
  stateRole?: string | undefined;
  /*
   * Reads after "Starts when" and "Ends when": "The incident is declared".
   */
  label: string;
  /*
   * The moment in a word or two, for the list of measurements, where a
   * measurement reads "Declared → Acknowledged".
   */
  shortLabel: string;
  // Where the moment comes from, in a line.
  description: string;
  /*
   * The moment is a state the user picks from the project's own states
   * (State Entered), asked for separately.
   */
  isPickedState?: boolean | undefined;
  /*
   * Other anchor types that are this same instant. A measurement saved with
   * one of them shows as this moment, and is left saved as it was until
   * someone picks another.
   */
  aliasAnchorTypes?: Array<string> | undefined;
}

// Joins a role anchor's type and its role into one moment value.
export const MEASUREMENT_MOMENT_ROLE_SEPARATOR: string = ":";

/*
 * The same in the three anchor type enums (IncidentMeasurementAnchorType,
 * AlertMeasurementAnchorType, ScheduledMaintenanceMeasurementAnchorType).
 */
const STATE_ROLE_ENTERED: string =
  IncidentMeasurementAnchorType.StateRoleEntered;

type RoleMomentValueFunction = (role: string) => string;

const roleMomentValue: RoleMomentValueFunction = (role: string): string => {
  return `${STATE_ROLE_ENTERED}${MEASUREMENT_MOMENT_ROLE_SEPARATOR}${role}`;
};

const INCIDENT_MOMENTS: Array<MeasurementMoment> = [
  {
    value: IncidentMeasurementAnchorType.DeclaredAt,
    anchorType: IncidentMeasurementAnchorType.DeclaredAt,
    label: "The incident is declared",
    shortLabel: "Declared",
    description:
      "When the incident started in OneUptime: when it was created, unless someone set an earlier time.",
    aliasAnchorTypes: [IncidentMeasurementAnchorType.TimelineStart],
  },
  {
    value: roleMomentValue(IncidentStateRole.Acknowledged),
    anchorType: IncidentMeasurementAnchorType.StateRoleEntered,
    stateRole: IncidentStateRole.Acknowledged,
    label: "The incident is acknowledged",
    shortLabel: "Acknowledged",
    description: "When it reaches your acknowledged state.",
  },
  {
    value: roleMomentValue(IncidentStateRole.Resolved),
    anchorType: IncidentMeasurementAnchorType.StateRoleEntered,
    stateRole: IncidentStateRole.Resolved,
    label: "The incident is resolved",
    shortLabel: "Resolved",
    description: "When it reaches your resolved state.",
  },
  {
    value: IncidentMeasurementAnchorType.PostmortemPostedAt,
    anchorType: IncidentMeasurementAnchorType.PostmortemPostedAt,
    label: "The postmortem is published",
    shortLabel: "Postmortem published",
    description: "When the incident's postmortem is published.",
  },
  {
    value: IncidentMeasurementAnchorType.StateEntered,
    anchorType: IncidentMeasurementAnchorType.StateEntered,
    label: "The incident enters a state you pick",
    shortLabel: "A state",
    description: "Any of your incident states, such as Investigating.",
    isPickedState: true,
  },
  {
    value: IncidentMeasurementAnchorType.ImpactStartedAt,
    anchorType: IncidentMeasurementAnchorType.ImpactStartedAt,
    label: "Impact starts",
    shortLabel: "Impact started",
    description:
      "When customers were first affected. It is recorded on each incident, for example by an incident form that asks for it. Until it is, the measurement has no value.",
  },
  {
    value: roleMomentValue(IncidentStateRole.Created),
    anchorType: IncidentMeasurementAnchorType.StateRoleEntered,
    stateRole: IncidentStateRole.Created,
    label: "The incident enters its first state",
    shortLabel: "First state",
    description:
      "When it reaches the state new incidents start in, such as Identified.",
  },
  {
    value: IncidentMeasurementAnchorType.CreatedAt,
    anchorType: IncidentMeasurementAnchorType.CreatedAt,
    label: "The incident is created in OneUptime",
    shortLabel: "Created",
    description: "Usually the same moment it is declared.",
  },
];

const ALERT_MOMENTS: Array<MeasurementMoment> = [
  {
    value: AlertMeasurementAnchorType.CreatedAt,
    anchorType: AlertMeasurementAnchorType.CreatedAt,
    label: "The alert is created",
    shortLabel: "Created",
    description: "When the alert was raised.",
    aliasAnchorTypes: [AlertMeasurementAnchorType.TimelineStart],
  },
  {
    value: roleMomentValue(AlertStateRole.Acknowledged),
    anchorType: AlertMeasurementAnchorType.StateRoleEntered,
    stateRole: AlertStateRole.Acknowledged,
    label: "The alert is acknowledged",
    shortLabel: "Acknowledged",
    description: "When it reaches your acknowledged state.",
  },
  {
    value: roleMomentValue(AlertStateRole.Resolved),
    anchorType: AlertMeasurementAnchorType.StateRoleEntered,
    stateRole: AlertStateRole.Resolved,
    label: "The alert is resolved",
    shortLabel: "Resolved",
    description: "When it reaches your resolved state.",
  },
  {
    value: AlertMeasurementAnchorType.StateEntered,
    anchorType: AlertMeasurementAnchorType.StateEntered,
    label: "The alert enters a state you pick",
    shortLabel: "A state",
    description: "Any of your alert states.",
    isPickedState: true,
  },
  {
    value: AlertMeasurementAnchorType.ImpactStartedAt,
    anchorType: AlertMeasurementAnchorType.ImpactStartedAt,
    label: "Impact starts",
    shortLabel: "Impact started",
    description:
      "When customers were first affected. It is recorded on each alert through the API. Until it is, the measurement has no value.",
  },
  {
    value: roleMomentValue(AlertStateRole.Created),
    anchorType: AlertMeasurementAnchorType.StateRoleEntered,
    stateRole: AlertStateRole.Created,
    label: "The alert enters its first state",
    shortLabel: "First state",
    description:
      "When it reaches the state new alerts start in, such as Identified.",
  },
];

const SCHEDULED_MAINTENANCE_MOMENTS: Array<MeasurementMoment> = [
  {
    value: ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt,
    anchorType: ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt,
    label: "The maintenance is scheduled to start",
    shortLabel: "Scheduled start",
    description: "The start time planned on the event.",
  },
  {
    value: ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt,
    anchorType: ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt,
    label: "The maintenance is scheduled to end",
    shortLabel: "Scheduled end",
    description: "The end time planned on the event.",
  },
  {
    value: roleMomentValue(ScheduledMaintenanceStateRole.Ongoing),
    anchorType: ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
    stateRole: ScheduledMaintenanceStateRole.Ongoing,
    label: "The maintenance starts",
    shortLabel: "Started",
    description: "When the event reaches your ongoing state.",
  },
  {
    value: roleMomentValue(ScheduledMaintenanceStateRole.Ended),
    anchorType: ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
    stateRole: ScheduledMaintenanceStateRole.Ended,
    label: "The maintenance ends",
    shortLabel: "Ended",
    description: "When the event reaches your ended state.",
  },
  {
    value: roleMomentValue(ScheduledMaintenanceStateRole.Resolved),
    anchorType: ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
    stateRole: ScheduledMaintenanceStateRole.Resolved,
    label: "The maintenance is completed",
    shortLabel: "Completed",
    description: "When the event reaches your completed state.",
  },
  {
    value: ScheduledMaintenanceMeasurementAnchorType.StateEntered,
    anchorType: ScheduledMaintenanceMeasurementAnchorType.StateEntered,
    label: "The event enters a state you pick",
    shortLabel: "A state",
    description: "Any of your scheduled maintenance states.",
    isPickedState: true,
  },
  {
    value: roleMomentValue(ScheduledMaintenanceStateRole.Scheduled),
    anchorType: ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
    stateRole: ScheduledMaintenanceStateRole.Scheduled,
    label: "The event enters its scheduled state",
    shortLabel: "Scheduled",
    description: "When the event reaches your scheduled state.",
  },
  {
    value: ScheduledMaintenanceMeasurementAnchorType.CreatedAt,
    anchorType: ScheduledMaintenanceMeasurementAnchorType.CreatedAt,
    label: "The event is created in OneUptime",
    shortLabel: "Created",
    description: "When the event was added.",
    aliasAnchorTypes: [ScheduledMaintenanceMeasurementAnchorType.TimelineStart],
  },
];

const MOMENTS_BY_DOMAIN: Record<MeasurementDomain, Array<MeasurementMoment>> = {
  [MeasurementDomain.Incident]: INCIDENT_MOMENTS,
  [MeasurementDomain.Alert]: ALERT_MOMENTS,
  [MeasurementDomain.ScheduledMaintenance]: SCHEDULED_MAINTENANCE_MOMENTS,
};

export type GetMeasurementMomentsFunction = (
  domain: MeasurementDomain,
) => Array<MeasurementMoment>;

/**
 * The moments a measurement of this domain can start or end at, in the
 * order a form lists them: the common ones first.
 */
export const getMeasurementMoments: GetMeasurementMomentsFunction = (
  domain: MeasurementDomain,
): Array<MeasurementMoment> => {
  return MOMENTS_BY_DOMAIN[domain];
};

export type GetMeasurementMomentFunction = (data: {
  domain: MeasurementDomain;
  value: string | null | undefined;
}) => MeasurementMoment | null;

/**
 * The moment a form value stands for, or null.
 */
export const getMeasurementMoment: GetMeasurementMomentFunction = (data: {
  domain: MeasurementDomain;
  value: string | null | undefined;
}): MeasurementMoment | null => {
  if (!data.value) {
    return null;
  }

  return (
    getMeasurementMoments(data.domain).find(
      (moment: MeasurementMoment): boolean => {
        return moment.value === data.value;
      },
    ) || null
  );
};

export type FindMeasurementMomentFunction = (data: {
  domain: MeasurementDomain;
  anchorType: string | null | undefined;
  stateRole?: string | null | undefined;
}) => MeasurementMoment | null;

/**
 * The moment a stored anchor is: its anchor type (or an alias of it) and,
 * for a role anchor, its role. Null when the anchor is not one of the
 * domain's - an anchor type of another domain, or a role the domain has not
 * got.
 */
export const findMeasurementMoment: FindMeasurementMomentFunction = (data: {
  domain: MeasurementDomain;
  anchorType: string | null | undefined;
  stateRole?: string | null | undefined;
}): MeasurementMoment | null => {
  if (!data.anchorType) {
    return null;
  }

  for (const moment of getMeasurementMoments(data.domain)) {
    const isSameAnchor: boolean =
      moment.anchorType === data.anchorType ||
      (moment.aliasAnchorTypes || []).includes(data.anchorType);

    if (!isSameAnchor) {
      continue;
    }

    if (moment.stateRole && moment.stateRole !== data.stateRole) {
      continue;
    }

    return moment;
  }

  return null;
};

export type GetMeasurementMomentValueFunction = (data: {
  domain: MeasurementDomain;
  anchorType: string | null | undefined;
  stateRole?: string | null | undefined;
}) => string | null;

/**
 * What a form shows for a stored anchor: its moment's value, or null when
 * the anchor is none of the domain's moments.
 */
export const getMeasurementMomentValue: GetMeasurementMomentValueFunction =
  (data: {
    domain: MeasurementDomain;
    anchorType: string | null | undefined;
    stateRole?: string | null | undefined;
  }): string | null => {
    return findMeasurementMoment(data)?.value || null;
  };

export interface MeasurementAnchor {
  anchorType: string;
  // Set for a role anchor; null for every other, so a stale role is cleared.
  stateRole: string | null;
}

export type GetMeasurementAnchorForMomentFunction = (data: {
  domain: MeasurementDomain;
  value: string | null | undefined;
}) => MeasurementAnchor | null;

/**
 * What a moment is stored as.
 */
export const getMeasurementAnchorForMoment: GetMeasurementAnchorForMomentFunction =
  (data: {
    domain: MeasurementDomain;
    value: string | null | undefined;
  }): MeasurementAnchor | null => {
    const moment: MeasurementMoment | null = getMeasurementMoment(data);

    if (!moment) {
      return null;
    }

    return {
      anchorType: moment.anchorType,
      stateRole: moment.stateRole || null,
    };
  };

export type IsMeasurementMomentFunction = (data: {
  domain: MeasurementDomain;
  value: string | null | undefined;
}) => boolean;

/**
 * Whether the moment is a state the user picks, so the form asks which.
 */
export const isPickedStateMeasurementMoment: IsMeasurementMomentFunction =
  (data: {
    domain: MeasurementDomain;
    value: string | null | undefined;
  }): boolean => {
    return Boolean(getMeasurementMoment(data)?.isPickedState);
  };

/**
 * Whether the moment is reaching a state - one that an incident can reach
 * more than once, when it is reopened - so whether the first or the last
 * time counts is a question worth asking.
 */
export const canMeasurementMomentRepeat: IsMeasurementMomentFunction = (data: {
  domain: MeasurementDomain;
  value: string | null | undefined;
}): boolean => {
  const moment: MeasurementMoment | null = getMeasurementMoment(data);

  return Boolean(moment && (moment.isPickedState || moment.stateRole));
};

/*
 * Where a measurement usually starts, so a new one the user sets up
 * themselves only has to be told where it ends.
 */
const DEFAULT_START_MOMENT: Record<MeasurementDomain, string> = {
  [MeasurementDomain.Incident]: IncidentMeasurementAnchorType.DeclaredAt,
  [MeasurementDomain.Alert]: AlertMeasurementAnchorType.CreatedAt,
  [MeasurementDomain.ScheduledMaintenance]:
    ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt,
};

export type GetDefaultMeasurementStartMomentFunction = (
  domain: MeasurementDomain,
) => MeasurementMoment;

export const getDefaultMeasurementStartMoment: GetDefaultMeasurementStartMomentFunction =
  (domain: MeasurementDomain): MeasurementMoment => {
    return getMeasurementMoment({
      domain,
      value: DEFAULT_START_MOMENT[domain],
    })!;
  };

/*
 * The list of measurements reads "Declared → Acknowledged". A state the
 * user picked reads as its name; one whose state has since been deleted
 * says so, as the measurement's status does.
 */
export const MEASUREMENT_DELETED_STATE_LABEL: string = "Deleted state";

/*
 * A reached state that counts the last time it was reached, not the first:
 * "Resolved (last time)". One template, so a language can put the words
 * where its grammar wants them.
 */
export const MEASUREMENT_LAST_TIME_TEMPLATE: string = "{{moment}} (last time)";

export interface MeasurementEndDescription {
  // The moment in a word or two: "Acknowledged", "Monitoring".
  label: string;
  /*
   * The label is the name of one of the project's own states - shown as it
   * is, never looked up in a language file.
   */
  isStateName: boolean;
  // The last time the state was reached counts, not the first.
  isLastTime: boolean;
}

export type DescribeMeasurementEndFunction = (data: {
  domain: MeasurementDomain;
  anchorType: string | null | undefined;
  stateRole?: string | null | undefined;
  // The picked state's name, when the end is a picked state.
  stateName?: string | null | undefined;
  occurrence?: string | null | undefined;
}) => MeasurementEndDescription | null;

/**
 * One end of a measurement, for the list of measurements. Null when the
 * stored anchor is none of the domain's moments.
 */
export const describeMeasurementEnd: DescribeMeasurementEndFunction = (data: {
  domain: MeasurementDomain;
  anchorType: string | null | undefined;
  stateRole?: string | null | undefined;
  stateName?: string | null | undefined;
  occurrence?: string | null | undefined;
}): MeasurementEndDescription | null => {
  const moment: MeasurementMoment | null = findMeasurementMoment(data);

  if (!moment) {
    return null;
  }

  const canRepeat: boolean = Boolean(moment.isPickedState || moment.stateRole);
  const stateName: string = (data.stateName || "").trim();
  const isStateName: boolean = Boolean(moment.isPickedState && stateName);

  let label: string = moment.shortLabel;

  if (isStateName) {
    label = stateName;
  } else if (moment.isPickedState) {
    label = MEASUREMENT_DELETED_STATE_LABEL;
  }

  return {
    label: label,
    isStateName: isStateName,
    isLastTime: canRepeat && data.occurrence === MeasurementOccurrence.Last,
  };
};

/*
 * A ready-made measurement: what "What do you want to measure?" offers, so
 * the common ones take a click. Picking one fills in the name, the
 * description and both ends.
 */
export interface MeasurementPreset {
  id: string;
  // The measurement's name, and the card's title.
  name: string;
  // The measurement's description, and the card's text.
  description: string;
  icon: IconProp;
  // Moment values. Absent on "Something else", which sets nothing.
  startMoment?: string | undefined;
  endMoment?: string | undefined;
}

export const CUSTOM_MEASUREMENT_PRESET_ID: string = "custom";

const CUSTOM_PRESET: MeasurementPreset = {
  id: CUSTOM_MEASUREMENT_PRESET_ID,
  name: "Something else",
  description: "Pick the start and the end yourself.",
  icon: IconProp.AdjustmentHorizontal,
};

const PRESETS_BY_DOMAIN: Record<MeasurementDomain, Array<MeasurementPreset>> = {
  [MeasurementDomain.Incident]: [
    {
      id: "time-to-acknowledge",
      name: "Time to acknowledge",
      description:
        "From when an incident is declared until someone acknowledges it.",
      icon: IconProp.HandRaised,
      startMoment: IncidentMeasurementAnchorType.DeclaredAt,
      endMoment: roleMomentValue(IncidentStateRole.Acknowledged),
    },
    {
      id: "time-to-resolve",
      name: "Time to resolve",
      description: "From when an incident is declared until it is resolved.",
      icon: IconProp.CheckCircle,
      startMoment: IncidentMeasurementAnchorType.DeclaredAt,
      endMoment: roleMomentValue(IncidentStateRole.Resolved),
    },
    {
      id: "time-to-postmortem",
      name: "Time to postmortem",
      description:
        "From when an incident is resolved until its postmortem is published.",
      icon: IconProp.DocumentText,
      startMoment: roleMomentValue(IncidentStateRole.Resolved),
      endMoment: IncidentMeasurementAnchorType.PostmortemPostedAt,
    },
    CUSTOM_PRESET,
  ],
  [MeasurementDomain.Alert]: [
    {
      id: "time-to-acknowledge",
      name: "Time to acknowledge",
      description:
        "From when an alert is created until someone acknowledges it.",
      icon: IconProp.HandRaised,
      startMoment: AlertMeasurementAnchorType.CreatedAt,
      endMoment: roleMomentValue(AlertStateRole.Acknowledged),
    },
    {
      id: "time-to-resolve",
      name: "Time to resolve",
      description: "From when an alert is created until it is resolved.",
      icon: IconProp.CheckCircle,
      startMoment: AlertMeasurementAnchorType.CreatedAt,
      endMoment: roleMomentValue(AlertStateRole.Resolved),
    },
    CUSTOM_PRESET,
  ],
  [MeasurementDomain.ScheduledMaintenance]: [
    {
      id: "start-delay",
      name: "Start delay",
      description:
        "How late maintenance starts: from its scheduled start until it starts.",
      icon: IconProp.Clock,
      startMoment: ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt,
      endMoment: roleMomentValue(ScheduledMaintenanceStateRole.Ongoing),
    },
    {
      id: "overrun",
      name: "Overrun",
      description:
        "How long maintenance runs over: from its scheduled end until it ends.",
      icon: IconProp.ArrowTrendingUp,
      startMoment: ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt,
      endMoment: roleMomentValue(ScheduledMaintenanceStateRole.Ended),
    },
    {
      id: "maintenance-duration",
      name: "Maintenance duration",
      description:
        "How long maintenance really takes: from when it starts until it ends.",
      icon: IconProp.Time,
      startMoment: roleMomentValue(ScheduledMaintenanceStateRole.Ongoing),
      endMoment: roleMomentValue(ScheduledMaintenanceStateRole.Ended),
    },
    CUSTOM_PRESET,
  ],
};

export type GetMeasurementPresetsFunction = (
  domain: MeasurementDomain,
) => Array<MeasurementPreset>;

/**
 * The ready-made measurements of a domain, "Something else" last.
 */
export const getMeasurementPresets: GetMeasurementPresetsFunction = (
  domain: MeasurementDomain,
): Array<MeasurementPreset> => {
  return PRESETS_BY_DOMAIN[domain];
};

export type GetMeasurementPresetFunction = (data: {
  domain: MeasurementDomain;
  id: string | null | undefined;
}) => MeasurementPreset | null;

export const getMeasurementPreset: GetMeasurementPresetFunction = (data: {
  domain: MeasurementDomain;
  id: string | null | undefined;
}): MeasurementPreset | null => {
  return (
    getMeasurementPresets(data.domain).find(
      (preset: MeasurementPreset): boolean => {
        return preset.id === data.id;
      },
    ) || null
  );
};

/*
 * Every word this module puts on screen, for the locale files: each
 * moment's label, short label and description, and each preset's name and
 * description, of every domain.
 */
export const getMeasurementMomentsText: () => Array<string> =
  (): Array<string> => {
    const text: Set<string> = new Set<string>([
      MEASUREMENT_DELETED_STATE_LABEL,
      MEASUREMENT_LAST_TIME_TEMPLATE,
    ]);

    for (const domain of Object.values(MeasurementDomain)) {
      for (const moment of getMeasurementMoments(domain)) {
        text.add(moment.label);
        text.add(moment.shortLabel);
        text.add(moment.description);
      }

      for (const preset of getMeasurementPresets(domain)) {
        text.add(preset.name);
        text.add(preset.description);
      }
    }

    return Array.from(text);
  };
