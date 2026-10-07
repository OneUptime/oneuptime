import Alert from "../../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../../Types/ObjectID";
import AlertService from "../../../../Services/AlertService";
import IncidentService from "../../../../Services/IncidentService";
import ModelPermission from "../../../../Types/Database/Permissions/Index";
import Query from "../../../../Types/Database/Query";
import { applyAlertSelfPrivacyFilter } from "../../../Alert/AlertPrivacyFilter";
import { applyIncidentSelfPrivacyFilter } from "../../../Incident/IncidentPrivacyFilter";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsActionAuthorization {
  /*
   * A record the caller may not read is answered as missing by the update
   * check (NotFoundException); in a chat, missing and refused read the same
   * sentence, as a record that is not there at all does above.
   */
  private static async refuseAsUnchangeable(
    check: () => Promise<void>,
    refusal: string,
  ): Promise<void> {
    try {
      await check();
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotAuthorizedException(refusal);
      }

      throw error;
    }
  }

  @CaptureSpan()
  public static async assertCanUpdateIncident(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const incident: Incident | null = await IncidentService.findOneBy({
      query: {
        _id: data.incidentId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        // Whose record it is, for the checks below to see too.
        projectId: true,
        labels: {
          _id: true,
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new NotAuthorizedException(
        "You do not have permission to update this incident.",
      );
    }

    await MicrosoftTeamsActionAuthorization.refuseAsUnchangeable(
      async (): Promise<void> => {
        await ModelPermission.checkUpdatePermissionByModel({
          modelType: Incident,
          fetchModelWithAccessControlIds: async (): Promise<Incident> => {
            return incident;
          },
          props: data.props,
        });
      },
      "You do not have permission to update this incident.",
    );

    const permittedQuery: Query<Incident> =
      await ModelPermission.checkUpdateQueryPermissions(
        Incident,
        {
          _id: data.incidentId,
          projectId: data.projectId,
        },
        {
          currentIncidentStateId: ObjectID.getZeroObjectID(),
        },
        data.props,
      );

    const privacyScopedQuery: Query<Incident> = applyIncidentSelfPrivacyFilter(
      permittedQuery,
      data.props,
    );

    const permittedIncident: Incident | null = await IncidentService.findOneBy({
      query: privacyScopedQuery,
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!permittedIncident) {
      throw new NotAuthorizedException(
        "You do not have permission to update this incident.",
      );
    }
  }

  @CaptureSpan()
  public static async assertCanUpdateAlert(data: {
    alertId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const alert: Alert | null = await AlertService.findOneBy({
      query: {
        _id: data.alertId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        // Whose record it is, for the checks below to see too.
        projectId: true,
        labels: {
          _id: true,
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      throw new NotAuthorizedException(
        "You do not have permission to update this alert.",
      );
    }

    await MicrosoftTeamsActionAuthorization.refuseAsUnchangeable(
      async (): Promise<void> => {
        await ModelPermission.checkUpdatePermissionByModel({
          modelType: Alert,
          fetchModelWithAccessControlIds: async (): Promise<Alert> => {
            return alert;
          },
          props: data.props,
        });
      },
      "You do not have permission to update this alert.",
    );

    const permittedQuery: Query<Alert> =
      await ModelPermission.checkUpdateQueryPermissions(
        Alert,
        {
          _id: data.alertId,
          projectId: data.projectId,
        },
        {
          currentAlertStateId: ObjectID.getZeroObjectID(),
        },
        data.props,
      );

    const privacyScopedQuery: Query<Alert> = applyAlertSelfPrivacyFilter(
      permittedQuery,
      data.props,
    );

    const permittedAlert: Alert | null = await AlertService.findOneBy({
      query: privacyScopedQuery,
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!permittedAlert) {
      throw new NotAuthorizedException(
        "You do not have permission to update this alert.",
      );
    }
  }
}
