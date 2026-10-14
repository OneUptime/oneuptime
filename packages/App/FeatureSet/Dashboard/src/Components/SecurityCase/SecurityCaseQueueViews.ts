import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseStatus, {
  OPEN_SECURITY_CASE_STATUSES,
} from "Common/Types/SecurityCase/SecurityCaseStatus";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The questions an analyst asks of the case queue, as views along its top.
 * Open is where a shift starts; Mine and Unassigned split it between "what
 * am I on" and "what has nobody picked up"; Closed is the record of what
 * was decided.
 *
 * React-free so each view's query is pinned in a plain test.
 */

export type SecurityCaseQueueViewKey =
  | "open"
  | "mine"
  | "unassigned"
  | "closed"
  | "all";

export interface SecurityCaseQueueView {
  key: SecurityCaseQueueViewKey;
  title: string;
  description: string;
  emptyMessage: string;
  icon: IconProp;
}

export const SECURITY_CASE_QUEUE_VIEWS: ReadonlyArray<SecurityCaseQueueView> = [
  {
    key: "open",
    title: translationKey("Open"),
    description: translationKey("Every case that is not closed."),
    emptyMessage: translationKey(
      "No open cases. New ones appear here as detections fire.",
    ),
    icon: IconProp.ShieldExclamation,
  },
  {
    key: "mine",
    title: translationKey("Assigned to Me"),
    description: translationKey("Open cases assigned to you."),
    emptyMessage: translationKey("No open cases are assigned to you."),
    icon: IconProp.User,
  },
  {
    key: "unassigned",
    title: translationKey("Unassigned"),
    description: translationKey("Open cases nobody has picked up yet."),
    emptyMessage: translationKey("Every open case has someone on it."),
    icon: IconProp.UserGroup,
  },
  {
    key: "closed",
    title: translationKey("Closed"),
    description: translationKey("Cases closed with a verdict."),
    emptyMessage: translationKey("No closed cases yet."),
    icon: IconProp.CheckCircle,
  },
  {
    key: "all",
    title: translationKey("All"),
    description: translationKey("Every case, open or closed."),
    emptyMessage: translationKey("No cases yet."),
    icon: IconProp.List,
  },
];

export function getSecurityCaseQueueQuery(
  view: SecurityCaseQueueViewKey,
  currentUserId: ObjectID | undefined,
): Query<SecurityCase> {
  const open: Query<SecurityCase> = {
    status: new Includes([...OPEN_SECURITY_CASE_STATUSES]),
  } as Query<SecurityCase>;

  switch (view) {
    case "open":
      return open;
    case "mine":
      return {
        ...open,
        // Nobody signed in reads as nobody's cases, not everybody's.
        assignedToUserId: currentUserId || ObjectID.getZeroObjectID(),
      } as Query<SecurityCase>;
    case "unassigned":
      return {
        ...open,
        assignedToUserId: new IsNull(),
      } as Query<SecurityCase>;
    case "closed":
      return { status: SecurityCaseStatus.Closed } as Query<SecurityCase>;
    case "all":
    default:
      return {};
  }
}
