import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import ModelPermission from "../../Types/Database/Permissions/Index";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import { applyAlertSelfPrivacyFilter } from "./AlertPrivacyFilter";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Whether a caller may change the state of a set of alerts - acknowledge
 * them, say - when that change is going to be written for them as root.
 *
 * Changing an alert's state from its own page takes two writes as the caller:
 * a new AlertStateTimeline row (table and column permissions only), and then
 * the alert's currentAlertStateId, which is an Alert UPDATE and so is narrowed
 * by the caller's label scope, Owned scope and alert privacy. Being able to
 * read an alert is not enough: a Viewer who is also an AlertMember for one
 * label can read every alert but change the state of only some. A root write
 * skips both, so this checks both, for every alert, before anything is
 * written - the same rule the Microsoft Teams acknowledge action applies to
 * one alert.
 */
export default class AlertStateChangeAuthorization {
  @CaptureSpan()
  public static async assertCanChangeStateOfAlerts(data: {
    projectId: ObjectID;
    alertIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot || data.alertIds.length === 0) {
      return;
    }

    const probe: AlertStateTimeline = new AlertStateTimeline();
    probe.projectId = data.projectId;
    probe.alertId = data.alertIds[0]!;
    probe.alertStateId = ObjectID.generate();

    ModelPermission.checkCreatePermissions(
      AlertStateTimeline,
      probe,
      data.props,
    );

    const alertQuery: Query<Alert> = {
      _id: QueryHelper.any(data.alertIds),
      projectId: data.projectId,
    };

    /*
     * Labelled block and allow rules are decided per record, from the
     * record's labels.
     */
    const alerts: Array<Alert> = await AlertService.findBy({
      query: alertQuery,
      select: {
        _id: true,
        labels: {
          _id: true,
          name: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const alert of alerts) {
      await ModelPermission.checkUpdatePermissionByModel({
        modelType: Alert,
        fetchModelWithAccessControlIds: async (): Promise<Alert> => {
          return alert;
        },
        props: data.props,
      });
    }

    /*
     * The caller's own update scope (labels, Owned, privacy) as a query:
     * every alert must still be in it.
     */
    const permittedQuery: Query<Alert> =
      await ModelPermission.checkUpdateQueryPermissions(
        Alert,
        alertQuery,
        {
          currentAlertStateId: ObjectID.getZeroObjectID(),
        },
        data.props,
      );

    const permittedAlerts: Array<Alert> = await AlertService.findBy({
      query: applyAlertSelfPrivacyFilter(permittedQuery, data.props),
      select: {
        _id: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const permittedIds: Set<string> = new Set(
      permittedAlerts.map((alert: Alert): string => {
        return alert._id?.toString().toLowerCase() || "";
      }),
    );

    const allPermitted: boolean = data.alertIds.every(
      (alertId: ObjectID): boolean => {
        return permittedIds.has(alertId.toString().toLowerCase());
      },
    );

    if (!allPermitted) {
      throw new NotAuthorizedException(
        "You do not have permission to change the state of one or more of these alerts.",
      );
    }
  }
}
