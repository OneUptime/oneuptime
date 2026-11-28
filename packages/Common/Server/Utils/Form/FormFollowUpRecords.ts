import AlertInternalNoteService from "../../Services/AlertInternalNoteService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import IncidentInternalNoteService from "../../Services/IncidentInternalNoteService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import ScheduledMaintenanceInternalNoteService from "../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../Services/ScheduledMaintenanceStateService";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PublicFormRequestState } from "../../../Types/Form/FormFollowUp";
import FormTargetType from "../../../Types/Form/FormTargetType";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE RECORDS A FOLLOW-UP IS ABOUT (Common/Types/Form/FormFollowUp): an
 * incident, an alert or a scheduled maintenance event, each read and
 * written through its own services, so the rules of the record - who may
 * read it, private incidents, label grants - are the rules of its
 * follow-up conversation too.
 *
 *  - findReadable / findUpdatable read the record as the caller: null, or a
 *    NotAuthorized refusal, for somebody who may not read it - or edit it.
 *  - assertMayReadNotes reads the record's private notes as the caller, and
 *    throws the services' refusal for somebody who may not: the
 *    conversation is on those notes.
 *  - addNoteAs writes a private note as the caller - a responder's reply -
 *    held to every rule a note written on the record's page is.
 *  - readFacts reads, as root, what the people following the request are
 *    told about the record: its state's name and color, whether it is
 *    over, and its number - or null once the record is gone.
 *
 * Keyed by FormTargetType, so a new target is a compile error here until it
 * says how its records are read.
 */

export interface FormFollowUpRecordKind {
  findReadable: (data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }) => Promise<{ id?: ObjectID | null | undefined } | null>;
  findUpdatable: (data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }) => Promise<{ id?: ObjectID | null | undefined } | null>;
  assertMayReadNotes: (data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }) => Promise<void>;
  addNoteAs: (data: {
    id: ObjectID;
    projectId: ObjectID;
    note: string;
    props: DatabaseCommonInteractionProps;
  }) => Promise<void>;
  readFacts: (id: ObjectID) => Promise<FormFollowUpRecordFacts | null>;
}

/*
 * What the people following a request are told about its record: its
 * state, and its number as the project shows it ("INC-42").
 */
export interface FormFollowUpRecordFacts {
  state: PublicFormRequestState | null;
  reference?: string | undefined;
}

// A record's number as the project shows it: its prefixed number, else #n.
const getReference: (data: {
  withPrefix?: string | undefined;
  number?: number | undefined;
}) => string | undefined = (data: {
  withPrefix?: string | undefined;
  number?: number | undefined;
}): string | undefined => {
  const withPrefix: string = (data.withPrefix || "").trim();

  if (withPrefix) {
    return withPrefix;
  }

  return typeof data.number === "number" ? `#${data.number}` : undefined;
};

type StateLike = {
  name?: string | undefined;
  color?: { toString(): string } | undefined;
};

// A colour the request's page may draw, as a state's colour is kept.
const STATE_COLOR: RegExp = /^#[0-9a-f]{6}$/i;

// A state as the people following the request read it.
const toRequestState: (data: {
  state: StateLike | undefined;
  isClosed: boolean;
}) => PublicFormRequestState | null = (data: {
  state: StateLike | undefined;
  isClosed: boolean;
}): PublicFormRequestState | null => {
  const name: string = (data.state?.name || "").trim();

  if (!name) {
    return null;
  }

  const state: PublicFormRequestState = {
    name: name,
    isClosed: data.isClosed,
  };

  const color: string = data.state?.color ? data.state.color.toString() : "";

  if (STATE_COLOR.test(color)) {
    state.color = color.toLowerCase();
  }

  return state;
};

const RECORD_KINDS: Record<FormTargetType, FormFollowUpRecordKind> = {
  [FormTargetType.Incident]: {
    findReadable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<Incident | null> => {
      return await IncidentService.findOneById({
        id: data.id,
        select: { _id: true },
        props: data.props,
      });
    },
    findUpdatable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<Incident | null> => {
      return await IncidentService.findOneUpdatableById({
        id: data.id,
        select: { _id: true },
        props: data.props,
      });
    },
    assertMayReadNotes: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<void> => {
      await IncidentInternalNoteService.findBy({
        query: { incidentId: data.id },
        select: { _id: true },
        limit: 1,
        skip: 0,
        props: data.props,
      });
    },
    addNoteAs: async (data: {
      id: ObjectID;
      projectId: ObjectID;
      note: string;
      props: DatabaseCommonInteractionProps;
    }): Promise<void> => {
      const note: IncidentInternalNote = new IncidentInternalNote();
      note.projectId = data.projectId;
      note.incidentId = data.id;
      note.note = data.note;

      await IncidentInternalNoteService.create({
        data: note,
        props: data.props,
      });
    },
    readFacts: async (
      id: ObjectID,
    ): Promise<FormFollowUpRecordFacts | null> => {
      const incident: Incident | null = await IncidentService.findOneById({
        id: id,
        select: {
          projectId: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          currentIncidentStateId: true,
          currentIncidentState: {
            name: true,
            color: true,
          },
        },
        props: { isRoot: true },
      });

      if (!incident) {
        return null;
      }

      // Resolved by the project's own rule, a state placed after Resolved too.
      const isClosed: boolean =
        incident.projectId && incident.currentIncidentStateId
          ? await IncidentStateService.isResolvedIncidentState({
              projectId: incident.projectId,
              incidentStateId: incident.currentIncidentStateId,
            })
          : false;

      return {
        state: toRequestState({
          state: incident.currentIncidentState,
          isClosed: isClosed,
        }),
        reference: getReference({
          withPrefix: incident.incidentNumberWithPrefix,
          number: incident.incidentNumber,
        }),
      };
    },
  },
  [FormTargetType.Alert]: {
    findReadable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<Alert | null> => {
      return await AlertService.findOneById({
        id: data.id,
        select: { _id: true },
        props: data.props,
      });
    },
    findUpdatable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<Alert | null> => {
      return await AlertService.findOneUpdatableById({
        id: data.id,
        select: { _id: true },
        props: data.props,
      });
    },
    assertMayReadNotes: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<void> => {
      await AlertInternalNoteService.findBy({
        query: { alertId: data.id },
        select: { _id: true },
        limit: 1,
        skip: 0,
        props: data.props,
      });
    },
    addNoteAs: async (data: {
      id: ObjectID;
      projectId: ObjectID;
      note: string;
      props: DatabaseCommonInteractionProps;
    }): Promise<void> => {
      const note: AlertInternalNote = new AlertInternalNote();
      note.projectId = data.projectId;
      note.alertId = data.id;
      note.note = data.note;

      await AlertInternalNoteService.create({
        data: note,
        props: data.props,
      });
    },
    readFacts: async (
      id: ObjectID,
    ): Promise<FormFollowUpRecordFacts | null> => {
      const alert: Alert | null = await AlertService.findOneById({
        id: id,
        select: {
          projectId: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
          currentAlertStateId: true,
          currentAlertState: {
            name: true,
            color: true,
          },
        },
        props: { isRoot: true },
      });

      if (!alert) {
        return null;
      }

      // Resolved by the project's own rule, a state placed after Resolved too.
      const isClosed: boolean =
        alert.projectId && alert.currentAlertStateId
          ? await AlertStateService.isResolvedAlertState({
              projectId: alert.projectId,
              alertStateId: alert.currentAlertStateId,
            })
          : false;

      return {
        state: toRequestState({
          state: alert.currentAlertState,
          isClosed: isClosed,
        }),
        reference: getReference({
          withPrefix: alert.alertNumberWithPrefix,
          number: alert.alertNumber,
        }),
      };
    },
  },
  [FormTargetType.ScheduledMaintenance]: {
    findReadable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<ScheduledMaintenance | null> => {
      return await ScheduledMaintenanceService.findOneById({
        id: data.id,
        select: { _id: true },
        props: data.props,
      });
    },
    findUpdatable: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<ScheduledMaintenance | null> => {
      return await ScheduledMaintenanceService.findOneUpdatableById({
        id: data.id,
        select: { _id: true },
        props: data.props,
      });
    },
    assertMayReadNotes: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<void> => {
      await ScheduledMaintenanceInternalNoteService.findBy({
        query: { scheduledMaintenanceId: data.id },
        select: { _id: true },
        limit: 1,
        skip: 0,
        props: data.props,
      });
    },
    addNoteAs: async (data: {
      id: ObjectID;
      projectId: ObjectID;
      note: string;
      props: DatabaseCommonInteractionProps;
    }): Promise<void> => {
      const note: ScheduledMaintenanceInternalNote =
        new ScheduledMaintenanceInternalNote();
      note.projectId = data.projectId;
      note.scheduledMaintenanceId = data.id;
      note.note = data.note;

      await ScheduledMaintenanceInternalNoteService.create({
        data: note,
        props: data.props,
      });
    },
    readFacts: async (
      id: ObjectID,
    ): Promise<FormFollowUpRecordFacts | null> => {
      const event: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneById({
          id: id,
          select: {
            projectId: true,
            scheduledMaintenanceNumber: true,
            scheduledMaintenanceNumberWithPrefix: true,
            currentScheduledMaintenanceStateId: true,
            currentScheduledMaintenanceState: {
              name: true,
              color: true,
            },
          },
          props: { isRoot: true },
        });

      if (!event) {
        return null;
      }

      /*
       * Over by the project's own rule (ScheduledMaintenanceStartUtil.
       * hasEnded): ended, completed, or a state of its own after Ended.
       */
      const stateId: ObjectID | undefined =
        event.currentScheduledMaintenanceStateId;
      const isClosed: boolean =
        event.projectId && stateId
          ? (
              await ScheduledMaintenanceStateService.getOverScheduledMaintenanceStateIds(
                event.projectId,
              )
            ).some((overId: ObjectID): boolean => {
              return overId.toString() === stateId.toString();
            })
          : false;

      return {
        state: toRequestState({
          state: event.currentScheduledMaintenanceState,
          isClosed: isClosed,
        }),
        reference: getReference({
          withPrefix: event.scheduledMaintenanceNumberWithPrefix,
          number: event.scheduledMaintenanceNumber,
        }),
      };
    },
  },
};

export type GetFormFollowUpRecordKindFunction = (
  recordType: FormTargetType,
) => FormFollowUpRecordKind;

export const getFormFollowUpRecordKind: GetFormFollowUpRecordKindFunction = (
  recordType: FormTargetType,
): FormFollowUpRecordKind => {
  return RECORD_KINDS[recordType];
};

export type IsFormFollowUpRecordTypeFunction = (
  value: unknown,
) => value is FormTargetType;

// A record type in a dashboard route's path: one of the form targets.
export const isFormFollowUpRecordType: IsFormFollowUpRecordTypeFunction = (
  value: unknown,
): value is FormTargetType => {
  return (
    typeof value === "string" &&
    (Object.values(FormTargetType) as Array<string>).includes(value)
  );
};
