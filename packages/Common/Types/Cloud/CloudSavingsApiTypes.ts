import { CloudProvider } from "./CloudPlatform";
import {
  CloudEnvironmentSource,
  CloudResourceEnvironment,
} from "./CloudResourceEnvironment";
import {
  CloudSavingsActionKind,
  CloudSavingsActionStatus,
  CloudSavingsActionUndo,
  CloudSavingsActionsAccess,
  CloudSavingsNotOffered,
} from "./CloudSavingsAction";

/*
 * THE SAVINGS ROUTES (#11010), shared by the server (CloudSavingsAPI) and
 * the Dashboard (CloudSavingsApi), so a route and what it answers are
 * written once.
 */
export const CLOUD_SAVINGS_API_ROUTES: {
  offer: string;
  apply: string;
  approve: (id: string) => string;
  dismiss: (id: string) => string;
  undo: (id: string) => string;
  fixInCode: string;
  summary: string;
  schedulePreview: (id: string) => string;
} = {
  offer: "/cloud-savings/offer",
  apply: "/cloud-savings/apply",
  approve: (id: string): string => {
    return `/cloud-savings/action/${id}/approve`;
  },
  dismiss: (id: string): string => {
    return `/cloud-savings/action/${id}/dismiss`;
  },
  undo: (id: string): string => {
    return `/cloud-savings/action/${id}/undo`;
  },
  fixInCode: "/cloud-savings/fix-in-code",
  summary: "/cloud-savings/summary",
  schedulePreview: (id: string): string => {
    return `/cloud-savings/schedule/${id}/preview`;
  },
};

/*
 * Why a saving's change cannot be made from here now, beyond what the
 * saving itself is (CloudSavingsNotOffered): its account's connection.
 * Sent by the API: a wire contract.
 */
export enum CloudSavingsConnectionState {
  // The connection lets OneUptime make this change.
  Ready = "Ready",
  // The account was found through no cloud connection.
  NoConnection = "NoConnection",
  // Its connection is gone or turned off.
  ConnectionOff = "ConnectionOff",
  // Savings actions are off on the connection.
  SavingsActionsOff = "SavingsActionsOff",
  // Savings actions are on, but not resizing.
  ResizeNotGranted = "ResizeNotGranted",
}

export interface CloudSavingsPerson {
  userId: string;
  name: string;
}

export interface CloudSavingsTeam {
  teamId: string;
  name: string;
}

/*
 * A resource declared in infrastructure code: the change is better made
 * there, by a pull request, so the next deploy does not undo it.
 */
export interface CloudSavingsDeclaredCode {
  // "Terraform", "CloudFormation stack \"web\""...
  managedAs: string;
  // The repository OneUptime would open the pull request in, when it found one.
  codeRepositoryId?: string | undefined;
  codeRepositoryName?: string | undefined;
}

/*
 * What pressing Apply on a saving would do, as its dialog says it: the
 * change, what it saves, whether it can be undone, who must approve it,
 * and whether the person asking may - or why it cannot be made from here.
 */
export interface CloudSavingsOffer {
  cloudCostRecommendationId: string;
  provider: CloudProvider;
  resourceName: string;
  resourceId: string;
  resourceType: string;
  region: string;
  cloudResourceId?: string | undefined;
  monthlySavings: number;
  currency: string;
  // The change, when the saving is one OneUptime makes.
  kind?: CloudSavingsActionKind | undefined;
  from?: string | undefined;
  to?: string | undefined;
  restarts?: boolean | undefined;
  // A deleted disk: a final snapshot offered (ticked by default), or always taken.
  finalSnapshot?: "offered" | "always" | undefined;
  // How it is undone with the final snapshot taken (or with none needed).
  undo?: CloudSavingsActionUndo | undefined;
  // Why it is not a change OneUptime makes.
  notOffered?: CloudSavingsNotOffered | undefined;
  // A commitment: where it is bought.
  purchaseUrl?: string | undefined;
  connectionState: CloudSavingsConnectionState;
  // The connection to open to turn Savings actions on, for a person who may.
  cloudConnectionId?: string | undefined;
  savingsActionsAccess?: CloudSavingsActionsAccess | undefined;
  environment: CloudResourceEnvironment;
  environmentSource: CloudEnvironmentSource;
  // Who may approve: its owners, or - for a resource nobody owns - the project's admins.
  owners: Array<CloudSavingsPerson>;
  ownerTeams: Array<CloudSavingsTeam>;
  approvedBy: "owners" | "admins";
  // Whether the person asking may approve it, so it runs at once.
  canApprove: boolean;
  // Whether the person asking may ask for it at all.
  canRequest: boolean;
  // Two people approve it: it cannot be undone, and the project asks two.
  needsTwoApprovals: boolean;
  declaredInCode?: CloudSavingsDeclaredCode | undefined;
  // A change of this saving already waiting or under way.
  openActionId?: string | undefined;
  openActionStatus?: CloudSavingsActionStatus | undefined;
}

// What an apply, approve, dismiss or undo came to.
export interface CloudSavingsActionResult {
  actionId: string;
  status: CloudSavingsActionStatus;
  // A first approval was recorded; a second person's is still needed.
  waitsForSecondApproval?: boolean | undefined;
  summary?: string | undefined;
}

export interface CloudSavingsFixInCodeResult {
  // The AI run that opens the pull request.
  aiRunId: string;
  codeRepositoryName: string;
}

/*
 * PROVED BY THE BILL: what the Savings page's strip shows - what changes
 * saved this month as the bill shows it, never as estimated - and what
 * waits for the person reading.
 */
export interface CloudSavingsSummary {
  currency: string;
  // Realised this month so far: what the bill shows the changes saved since the 1st.
  savedThisMonth: number;
  // The changes whose saving the bill shows, and those still being read.
  realisedCount: number;
  measuringCount: number;
  // Estimated a month by the changes in effect, for the changes not read yet.
  promisedMonthly: number;
  // Hours off-hours schedules stopped resources for this month.
  scheduledHoursThisMonth: number;
  // Changes made, undone or failed, of every kind but a schedule's stops.
  changesCount: number;
  // Changes waiting for an approval, and those the reader may approve.
  waitingCount: number;
  waitingForYouCount: number;
}

// What an off-hours schedule picks now, and what it leaves alone and why.
export enum CloudOffHoursSkipReason {
  Production = "Production",
  EnvironmentNotKnown = "EnvironmentNotKnown",
  SavingsActionsOff = "SavingsActionsOff",
  NotScheduledKind = "NotScheduledKind",
}

export interface CloudOffHoursPreviewResource {
  cloudResourceId: string;
  name: string;
  resourceType: string;
  provider: CloudProvider;
  environment: CloudResourceEnvironment;
  // Why the schedule leaves it running; absent when it stops it.
  skipReason?: CloudOffHoursSkipReason | undefined;
}

export interface CloudOffHoursPreview {
  resources: Array<CloudOffHoursPreviewResource>;
  // Whether the resources run now, and when that next changes.
  runningNow: boolean;
  nextChangeAt?: string | undefined;
  // Read up to this many resources; more were matched than shown.
  isCapped: boolean;
}
