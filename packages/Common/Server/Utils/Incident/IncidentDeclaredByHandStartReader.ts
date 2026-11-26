import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Project from "../../../Models/DatabaseModels/Project";
import BadDataException from "../../../Types/Exception/BadDataException";
import IncidentDeclaredByHandStart, {
  INCIDENT_DECLARED_BY_HAND_KEY,
} from "../../../Types/Incident/IncidentDeclaredByHandStart";
import ObjectID from "../../../Types/ObjectID";
import { StartingStage, StartingState } from "../../../Utils/StartingStage";
import IncidentStateService from "../../Services/IncidentStateService";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";

/*
 * THE SERVER'S SIDE OF "START INCIDENTS DECLARED BY HAND ACKNOWLEDGED"
 * (#11137, Common/Types/Incident/IncidentDeclaredByHandStart).
 *
 * IncidentService.onBeforeCreate asks it for an incident one of OneUptime's
 * declare forms sends (miscDataProps[INCIDENT_DECLARED_BY_HAND_KEY]) when
 * nothing else names where the incident starts - no state picked, none from
 * its template. With the project's switch on and no on-call policy to page,
 * the answer is the project's acknowledged state; otherwise there is none,
 * and the incident starts in the created state, as every incident does.
 *
 * Declaring never waits on, or fails over, the switch: a project or a state
 * list that cannot be read starts the incident in the created state, which
 * pages as it always did.
 */

export interface IncidentDeclaredByHandStartingState {
  incidentStateId: ObjectID;
  stage: StartingStage;
}

export default class IncidentDeclaredByHandStartReader {
  /*
   * miscDataProps[INCIDENT_DECLARED_BY_HAND_KEY] on an incident create:
   * true or false, and absent or null for a create no declare form sent.
   * Anything else is refused, before the incident number is taken.
   */
  public static readDeclaredByHand(value: unknown): boolean {
    if (value === undefined || value === null) {
      return false;
    }

    if (typeof value !== "boolean") {
      throw new BadDataException(
        `${INCIDENT_DECLARED_BY_HAND_KEY} must be true or false.`,
      );
    }

    return value;
  }

  /*
   * Whether the project starts incidents declared by hand acknowledged. Read
   * as OneUptime: the project's choice decides it, whoever declares. A
   * project that cannot be read is off.
   */
  public static async isOn(projectId: ObjectID): Promise<boolean> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          startIncidentsDeclaredByHandAcknowledged: true,
        },
        props: {
          isRoot: true,
        },
      });

      return IncidentDeclaredByHandStart.isOn(project);
    } catch (err) {
      logger.warn(
        "Could not read whether the project starts incidents declared by hand acknowledged; the incident starts in the created state, as before.",
        {
          projectId: projectId.toString(),
        },
      );
      logger.warn(err, { projectId: projectId.toString() });
      return false;
    }
  }

  /*
   * Where an incident declared by hand starts when nothing names a state for
   * it: the project's acknowledged state, with the stage it places the
   * incident in, when the switch is on and the incident pages none of
   * `onCallPolicies` (the create's, as it stands with its template's). Null
   * when it starts as every incident does - in the created state.
   */
  public static async getStartingState(data: {
    projectId: ObjectID;
    onCallPolicies: unknown;
  }): Promise<IncidentDeclaredByHandStartingState | null> {
    const onCallPolicyCount: number =
      IncidentDeclaredByHandStart.countOnCallPolicies(data.onCallPolicies);

    // Paging somebody: they acknowledge it, so the switch is not even read.
    if (onCallPolicyCount > 0) {
      return null;
    }

    const isSwitchOn: boolean = await this.isOn(data.projectId);

    if (
      !IncidentDeclaredByHandStart.startsAcknowledged({
        isSwitchOn: isSwitchOn,
        hasStartingState: false,
        onCallPolicyCount: onCallPolicyCount,
      })
    ) {
      return null;
    }

    try {
      const acknowledgedState: IncidentState | null =
        await IncidentStateService.findAcknowledgedIncidentState(
          data.projectId,
        );

      if (!acknowledgedState || !acknowledgedState.id) {
        return null;
      }

      /*
       * Placed as any state an incident starts in is (StartingStage), so it
       * pages nobody for the reason an incident declared acknowledged on
       * purpose does.
       */
      const start: StartingState | null =
        await IncidentStateService.getStartingState({
          projectId: data.projectId,
          incidentStateId: acknowledgedState.id,
        });

      if (!start) {
        return null;
      }

      return {
        incidentStateId: acknowledgedState.id,
        stage: start.stage,
      };
    } catch (err) {
      logger.warn(
        "Could not read the project's acknowledged incident state; the incident declared by hand starts in the created state.",
        {
          projectId: data.projectId.toString(),
        },
      );
      logger.warn(err, { projectId: data.projectId.toString() });
      return null;
    }
  }
}
