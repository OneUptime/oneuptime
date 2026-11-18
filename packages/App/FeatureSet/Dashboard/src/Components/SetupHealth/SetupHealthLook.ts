import { SetupHealthVerdictKind } from "./SetupHealthWords";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SetupHealthCheck,
  SetupHealthFinding,
  SetupHealthLevel,
  SetupHealthRecordKind,
} from "Common/Types/SetupHealth/SetupHealth";
import { WhoIsToldServerChannel } from "Common/Types/Monitor/WhoIsTold";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import {
  ICON_COLOR_CLASSES,
  IconColorClasses,
} from "Common/UI/Components/Navbar/NavBarMenuModal";

/*
 * HOW SETUP HEALTH LOOKS (#6812, #8135): the colours of each level and of
 * the verdict the page opens with, and the icon of each finding - the kind
 * of record it is about, in its product's own icon, so a long list is
 * scanned by what is broken (a monitor, a policy, a person) before it is
 * read. Kept apart from the words, and pure, for the tests.
 */

export interface SetupHealthVerdictLook {
  // The band behind the verdict.
  bandClassName: string;
  // The disc behind its icon.
  discClassName: string;
  icon: IconProp;
}

/*
 * The verdict's colour follows the worst level with findings, as Home's
 * headline follows the worst thing open (ProjectHealthCard): red when
 * pages will not arrive, amber for gaps worth fixing, green with nothing
 * to fix.
 */
export const VERDICT_LOOK: Readonly<
  Record<SetupHealthVerdictKind, SetupHealthVerdictLook>
> = {
  [SetupHealthVerdictKind.PagesWillNotArrive]: {
    bandClassName: "bg-red-50",
    discClassName: "bg-red-600",
    icon: IconProp.BellSlash,
  },
  [SetupHealthVerdictKind.WorthFixing]: {
    bandClassName: "bg-amber-50",
    discClassName: "bg-amber-500",
    icon: IconProp.Wrench,
  },
  [SetupHealthVerdictKind.NothingToFix]: {
    bandClassName: "bg-emerald-50",
    discClassName: "bg-emerald-500",
    icon: IconProp.ShieldCheck,
  },
};

export interface SetupHealthLevelLook {
  // The box behind a finding's icon (Home's "Your project" rows draw theirs so).
  iconBox: IconColorClasses;
  // The count beside the level's title.
  countClassName: string;
}

export const LEVEL_LOOK: Readonly<
  Record<SetupHealthLevel, SetupHealthLevelLook>
> = {
  [SetupHealthLevel.PagesWillNotArrive]: {
    iconBox: ICON_COLOR_CLASSES["red"]!,
    countClassName: "bg-red-50 text-red-700 ring-red-200",
  },
  [SetupHealthLevel.WorthFixing]: {
    iconBox: ICON_COLOR_CLASSES["amber"]!,
    countClassName: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  [SetupHealthLevel.Suggestion]: {
    iconBox: ICON_COLOR_CLASSES["gray"]!,
    countClassName: "bg-gray-50 text-gray-700 ring-gray-200",
  },
};

// A dismissed finding's box: grey, whatever its level.
export const DISMISSED_ICON_BOX: IconColorClasses = ICON_COLOR_CLASSES["gray"]!;

/*
 * The line at the top of a record's page (#7297): a panel in its level's
 * colour, as the policy summary's "No responders are assigned" is, so it
 * reads as something to act on before the record's details.
 */
export const RECORD_LINE_LOOK: Readonly<Record<SetupHealthLevel, string>> = {
  [SetupHealthLevel.PagesWillNotArrive]: "border-red-200 bg-red-50",
  [SetupHealthLevel.WorthFixing]: "border-amber-200 bg-amber-50",
  [SetupHealthLevel.Suggestion]: "border-gray-200 bg-gray-50",
};

/*
 * Each check's icon: the icon of the product its record lives in - a
 * monitor's globe, an on-call policy's phone, a status page's window - or of
 * what is switched off. A status page's own icon in the menus is a check
 * mark, which on a row that says something is wrong would read as "fine".
 */
export const CHECK_ICONS: Readonly<Record<SetupHealthCheck, IconProp>> = {
  [SetupHealthCheck.MonitorTellsNobody]: IconProp.AltGlobe,
  [SetupHealthCheck.MonitorPagesNobody]: IconProp.AltGlobe,
  [SetupHealthCheck.MonitorAlertsPageNobody]: IconProp.AltGlobe,
  [SetupHealthCheck.PolicyHasNoEscalationRules]: IconProp.Call,
  [SetupHealthCheck.PolicyReachesNobody]: IconProp.Call,
  [SetupHealthCheck.ResponderCannotBePaged]: IconProp.User,
  // A phone method the project asks people on call for (#7449).
  [SetupHealthCheck.ResponderHasNoPhone]: IconProp.DevicePhoneMobile,
  [SetupHealthCheck.ChannelOff]: IconProp.BellSlash,
  [SetupHealthCheck.NoBalance]: IconProp.Billing,
  [SetupHealthCheck.ServerCannotSend]: IconProp.Email,
  // An owner the Created email never reaches (#9371): who is emailed.
  [SetupHealthCheck.OwnerNotEmailed]: IconProp.Email,
  [SetupHealthCheck.PolicyNotRun]: IconProp.Call,
  [SetupHealthCheck.ScheduleHasNobodyOnCall]: IconProp.Calendar,
  [SetupHealthCheck.LowBalance]: IconProp.Billing,
  [SetupHealthCheck.MonitorNotChecked]: IconProp.AltGlobe,
  [SetupHealthCheck.MonitorOffForLong]: IconProp.AltGlobe,
  [SetupHealthCheck.StatusPageShowsNoMonitor]: IconProp.Window,
  [SetupHealthCheck.StatusPageDomainNotVerified]: IconProp.Link,
  // A padlock: what a browser shows, or does not, for a certificate.
  [SetupHealthCheck.StatusPageDomainCertificateFailed]: IconProp.Lock,
  [SetupHealthCheck.OneOwner]: IconProp.Team,
  [SetupHealthCheck.WorkspaceNotUsed]: IconProp.Chat,
  [SetupHealthCheck.TelemetryNotWatched]: IconProp.Logs,
  [SetupHealthCheck.IngestionKeyNeverUsed]: IconProp.Key,
};

// What the server cannot send: an email, an SMS, a call.
const SERVER_CHANNEL_ICONS: Readonly<Record<WhoIsToldServerChannel, IconProp>> =
  {
    [WhoIsToldServerChannel.Email]: IconProp.Email,
    [WhoIsToldServerChannel.SMS]: IconProp.SMS,
    [WhoIsToldServerChannel.Call]: IconProp.Phone,
  };

// A chat workspace by its own logo, as the side menus draw it.
const WORKSPACE_ICONS: Readonly<Record<WorkspaceType, IconProp>> = {
  [WorkspaceType.Slack]: IconProp.Slack,
  [WorkspaceType.MicrosoftTeams]: IconProp.MicrosoftTeams,
  [WorkspaceType.Mattermost]: IconProp.Mattermost,
};

export function getSetupHealthFindingIcon(
  finding: Pick<SetupHealthFinding, "check" | "subject">,
): IconProp {
  if (finding.check === SetupHealthCheck.ServerCannotSend) {
    return (
      SERVER_CHANNEL_ICONS[finding.subject as WhoIsToldServerChannel] ||
      CHECK_ICONS[finding.check]
    );
  }

  if (finding.check === SetupHealthCheck.WorkspaceNotUsed) {
    return (
      WORKSPACE_ICONS[finding.subject as WorkspaceType] ||
      CHECK_ICONS[finding.check]
    );
  }

  return CHECK_ICONS[finding.check] || IconProp.Alert;
}

// A record a finding reaches (SetupHealthFinding.related), by its kind.
export const RECORD_ICONS: Readonly<Record<SetupHealthRecordKind, IconProp>> = {
  [SetupHealthRecordKind.Monitor]: IconProp.AltGlobe,
  [SetupHealthRecordKind.OnCallDutyPolicy]: IconProp.Call,
  [SetupHealthRecordKind.OnCallDutyPolicySchedule]: IconProp.Calendar,
  [SetupHealthRecordKind.User]: IconProp.User,
  [SetupHealthRecordKind.StatusPage]: IconProp.Window,
  [SetupHealthRecordKind.StatusPageDomain]: IconProp.Link,
  [SetupHealthRecordKind.TelemetryIngestionKey]: IconProp.Key,
  [SetupHealthRecordKind.Project]: IconProp.Folder,
  [SetupHealthRecordKind.Team]: IconProp.Team,
  [SetupHealthRecordKind.IncidentOwnerRule]: IconProp.User,
  [SetupHealthRecordKind.AlertOwnerRule]: IconProp.User,
};
