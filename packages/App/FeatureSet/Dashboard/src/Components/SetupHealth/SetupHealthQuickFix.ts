import {
  getProjectNotificationChannel,
  ProjectNotificationChannel,
} from "../NotificationMethods/ProjectNotificationChannelsCopy";
import ProjectNotificationChannelsStore, {
  canChangeProjectNotificationChannels,
} from "../NotificationMethods/ProjectNotificationChannels";
import AlertOnCallRule from "Common/Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Project from "Common/Models/DatabaseModels/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { withPlainSpaces } from "Common/Types/NoBreakSpaces";
import ObjectID from "Common/Types/ObjectID";
import { RULE_NAME_MAX_LENGTH } from "Common/Types/OnCallDutyPolicy/EveryNewEventRules";
import {
  SetupHealthCheck,
  SetupHealthEventKind,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthRecordKind,
} from "Common/Types/SetupHealth/SetupHealth";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  SharedNameFacts,
  getSharedNameFacts,
  getSharedNameSelect,
} from "Common/UI/Utils/SharedNameOptions";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * ONE-CLICK FIXES (#7299): a finding put right from its own row, after a
 * dialog that says exactly what will change.
 *
 * #6812 left them for the two findings people fix most, once
 * setup_health/fix_opened said which. Those counts are in OneUptime Cloud's
 * product analytics, which nothing here can read, so the two are the ones
 * most projects meet, and each is a change that is safe to make and is
 * taken back where it is made:
 *
 *   - SMS, phone calls, WhatsApp or Telegram switched off while pages use
 *     it (channel_off): every new project starts with all four off. The fix
 *     turns the project's switch on, as Notification Channels does - for a
 *     Project Owner, a Billing Admin or someone with Manage Billing, who
 *     may flip it there (canChangeProjectNotificationChannels). Turned off
 *     there again, it is as it was.
 *   - A monitor whose incidents or alerts page nobody, in a project with an
 *     on-call policy (monitor_pages_nobody): the fix creates one on-call
 *     rule that pages the policy picked for that monitor's new incidents
 *     (or alerts) - nothing else is matched, and no rule is changed. For
 *     someone who may create on-call rules of that kind; turned off or
 *     deleted in On-Call Rules, it is gone.
 *
 * Everyone else keeps the link to the page that fixes it, as before. React
 * free, so the tests read the words and the requests themselves.
 */

export enum SetupHealthQuickFixKind {
  TurnOnChannel = "turn_on_channel",
  CreateOnCallRule = "create_on_call_rule",
}

// The channels a project switches on and off, by the page channel a finding names.
const SWITCHED_CHANNELS: ReadonlyArray<string> = Object.values(
  ProjectNotificationChannel,
);

/*
 * Which one-click fix a finding has, whoever looks at it; null for one that
 * has none. A monitor that pages nobody in a project with no on-call policy
 * yet is a suggestion whose fix is the on-call guided setup, which makes the
 * first policy: there is no policy to page.
 */
export function getSetupHealthQuickFixKind(
  finding: Pick<
    SetupHealthFinding,
    "check" | "subject" | "fix" | "level" | "record"
  >,
): SetupHealthQuickFixKind | null {
  if (
    finding.check === SetupHealthCheck.ChannelOff &&
    SWITCHED_CHANNELS.includes(finding.subject)
  ) {
    return SetupHealthQuickFixKind.TurnOnChannel;
  }

  if (
    finding.check === SetupHealthCheck.MonitorPagesNobody &&
    finding.level !== SetupHealthLevel.Suggestion &&
    finding.record.kind === SetupHealthRecordKind.Monitor &&
    Boolean(finding.record.id) &&
    (finding.fix === SetupHealthFix.IncidentOnCallRules ||
      finding.fix === SetupHealthFix.AlertOnCallRules)
  ) {
    return SetupHealthQuickFixKind.CreateOnCallRule;
  }

  return null;
}

// Whether the rule pages for the monitor's alerts, rather than its incidents.
export function isAlertRuleFix(
  finding: Pick<SetupHealthFinding, "subject" | "fix">,
): boolean {
  return (
    finding.subject === SetupHealthEventKind.Alert ||
    finding.fix === SetupHealthFix.AlertOnCallRules
  );
}

/*
 * Whether the person looking may apply the finding's one-click fix, as the
 * server would decide: never while their permissions are on their way.
 */
export function canApplySetupHealthQuickFix(
  finding: Pick<
    SetupHealthFinding,
    "check" | "subject" | "fix" | "level" | "record"
  >,
): boolean {
  switch (getSetupHealthQuickFixKind(finding)) {
    case SetupHealthQuickFixKind.TurnOnChannel:
      return canChangeProjectNotificationChannels([
        finding.subject as ProjectNotificationChannel,
      ]);
    case SetupHealthQuickFixKind.CreateOnCallRule:
      return (
        PermissionGate.check(
          isAlertRuleFix(finding)
            ? new AlertOnCallRule()
            : new IncidentOnCallRule(),
          ModelAction.Create,
        ).isAllowed &&
        PermissionGate.check(new OnCallDutyPolicy(), ModelAction.Read).isAllowed
      );
    default:
      return false;
  }
}

/*
 * TURNING A CHANNEL ON: the button, and what the dialog says will change.
 * One whole sentence per channel, so each language can give the channel its
 * own gender and number.
 */
export const TURN_ON_CHANNEL_WORDS: Readonly<
  Record<ProjectNotificationChannel, { button: string; whatChanges: string }>
> = {
  [ProjectNotificationChannel.SMS]: {
    button: translationKey("Turn On SMS"),
    whatChanges: translationKey(
      "SMS will be on for everyone in this project, so pages that use it are sent.",
    ),
  },
  [ProjectNotificationChannel.Call]: {
    button: translationKey("Turn On Phone Calls"),
    whatChanges: translationKey(
      "Phone calls will be on for everyone in this project, so pages that use them are made.",
    ),
  },
  [ProjectNotificationChannel.WhatsApp]: {
    button: translationKey("Turn On WhatsApp"),
    whatChanges: translationKey(
      "WhatsApp will be on for everyone in this project, so pages that use it are sent.",
    ),
  },
  [ProjectNotificationChannel.Telegram]: {
    button: translationKey("Turn On Telegram"),
    whatChanges: translationKey(
      "Telegram will be on for everyone in this project, so pages that use it are sent.",
    ),
  },
};

// Where the switch is, and that it is taken back there.
export const TURN_ON_CHANNEL_UNDO: string = translationKey(
  "The switch is in Project Settings → Notifications → Notification Channels, where it can be turned off again.",
);

// What a channel costs, said wherever its switch is (the Notification Channels card's note).
export function getTurnOnChannelBalanceNote(
  channel: ProjectNotificationChannel,
): string {
  return getProjectNotificationChannel(channel).balanceNote;
}

/*
 * CREATING A MONITOR'S ON-CALL RULE: the button, the sentence of what it
 * will do once a policy is picked, and where the rule is taken back.
 */
export const CREATE_ON_CALL_RULE_WORDS: Readonly<{
  button: string;
  policyLabel: string;
  noPolicy: string;
  whatChanges: Readonly<Record<SetupHealthEventKind, string>>;
  undo: Readonly<Record<SetupHealthEventKind, string>>;
  ruleName: string;
}> = {
  button: translationKey("Create On-Call Rule"),
  policyLabel: translationKey("On-Call Policy"),
  noPolicy: translationKey("No on-call policies yet."),
  whatChanges: {
    [SetupHealthEventKind.Incident]: translationKey(
      "Every new incident of {{monitor}} will page on-call policy {{policy}}.",
    ),
    [SetupHealthEventKind.Alert]: translationKey(
      "Every new alert of {{monitor}} will page on-call policy {{policy}}.",
    ),
  },
  undo: {
    [SetupHealthEventKind.Incident]: translationKey(
      "The rule is in Incidents → Rules → On-Call Rules, where it can be turned off or deleted.",
    ),
    [SetupHealthEventKind.Alert]: translationKey(
      "The rule is in Alerts → Rules → On-Call Rules, where it can be turned off or deleted.",
    ),
  },
  // The rule's name, in the language of the person who makes it (#7995).
  ruleName: translationKey("Page {{policy}} for {{monitor}}"),
};

export function getEventKind(
  finding: Pick<SetupHealthFinding, "subject" | "fix">,
): SetupHealthEventKind {
  return isAlertRuleFix(finding)
    ? SetupHealthEventKind.Alert
    : SetupHealthEventKind.Incident;
}

const ELLIPSIS: string = "…";

// A name, cut to `room` characters with "…" when it is longer.
function cutName(name: string, room: number): string {
  const characters: Array<string> = Array.from(name);

  if (characters.length <= room) {
    return name;
  }

  return `${characters
    .slice(0, Math.max(0, room - ELLIPSIS.length))
    .join("")
    .trimEnd()}${ELLIPSIS}`;
}

/*
 * "Page Primary for Checkout API", in the language of the person who makes
 * it, cut to what a rule's Name column holds: the names give way, each
 * ending in "…", so the words around them stay whole. Plain spaces: a
 * stored value, not a line a page draws (withPlainSpaces).
 */
export function getOnCallRuleName(data: {
  policyName: string;
  monitorName: string;
  translator: Translator;
}): string {
  const make: (policy: string, monitor: string) => string = (
    policy: string,
    monitor: string,
  ): string => {
    return withPlainSpaces(
      data.translator.translateTemplate(CREATE_ON_CALL_RULE_WORDS.ruleName, {
        policy: policy,
        monitor: monitor,
      }),
    );
  };

  const policy: string = data.policyName.replace(/\s+/g, " ").trim();
  const monitor: string = data.monitorName.replace(/\s+/g, " ").trim();
  const full: string = make(policy, monitor);

  if (Array.from(full).length <= RULE_NAME_MAX_LENGTH) {
    return full;
  }

  // The room the two names share: what the words around them leave.
  const around: number = Array.from(make("", "")).length;
  const room: number = Math.max(2, RULE_NAME_MAX_LENGTH - around);
  const policyRoom: number = Math.max(
    1,
    Math.min(Array.from(policy).length, Math.floor(room / 2)),
  );
  const monitorRoom: number = Math.max(1, room - policyRoom);

  return Array.from(
    make(cutName(policy, policyRoom), cutName(monitor, monitorRoom)),
  )
    .slice(0, RULE_NAME_MAX_LENGTH)
    .join("");
}

export interface SetupHealthPolicyChoice {
  id: string;
  name: string;
  // What tells it from another policy of its name (#10064).
  sharedName?: SharedNameFacts | undefined;
}

function currentProjectId(): ObjectID {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    throw new Error("No project is selected.");
  }

  return projectId;
}

export default class SetupHealthQuickFixApi {
  /*
   * Turns one of the project's notification channels on, as its switch on
   * Notification Channels does, and tells every list on screen.
   */
  public static async turnOnChannel(
    channel: ProjectNotificationChannel,
  ): Promise<void> {
    const projectId: ObjectID = currentProjectId();

    await ModelAPI.updateById<Project>({
      modelType: Project,
      id: projectId,
      data: { [getProjectNotificationChannel(channel).column]: true },
    });

    ProjectNotificationChannelsStore.recordChannel(projectId, channel, true);
  }

  // The on-call policies a rule may page: the ones in service, by name.
  public static async getPolicies(): Promise<Array<SetupHealthPolicyChoice>> {
    const result: ListResult<OnCallDutyPolicy> =
      await ModelAPI.getList<OnCallDutyPolicy>({
        modelType: OnCallDutyPolicy,
        query: { isArchived: false },
        select: {
          _id: true,
          name: true,
          ...getSharedNameSelect(OnCallDutyPolicy),
        },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    return result.data
      .filter((policy: OnCallDutyPolicy): boolean => {
        return Boolean(policy.id || policy._id);
      })
      .map((policy: OnCallDutyPolicy): SetupHealthPolicyChoice => {
        return {
          id: (policy.id || policy._id)!.toString(),
          name: policy.name?.toString() || "",
          sharedName: getSharedNameFacts(policy),
        };
      });
  }

  /*
   * One on-call rule, on: the monitor's new incidents (or alerts) page the
   * policy. Nothing else is matched by it, and no other rule is changed.
   */
  public static async createOnCallRule(data: {
    eventKind: SetupHealthEventKind;
    monitorId: string;
    monitorName: string;
    policy: SetupHealthPolicyChoice;
    translator: Translator;
  }): Promise<void> {
    const monitor: Monitor = new Monitor();
    monitor._id = data.monitorId;

    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = data.policy.id;

    const name: string = getOnCallRuleName({
      policyName: data.policy.name,
      monitorName: data.monitorName,
      translator: data.translator,
    });

    if (data.eventKind === SetupHealthEventKind.Alert) {
      const rule: AlertOnCallRule = new AlertOnCallRule();
      rule.projectId = currentProjectId();
      rule.name = name;
      rule.isEnabled = true;
      rule.monitors = [monitor];
      rule.onCallDutyPolicies = [policy];

      await ModelAPI.create<AlertOnCallRule>({
        model: rule,
        modelType: AlertOnCallRule,
      });

      return;
    }

    const rule: IncidentOnCallRule = new IncidentOnCallRule();
    rule.projectId = currentProjectId();
    rule.name = name;
    rule.isEnabled = true;
    rule.monitors = [monitor];
    rule.onCallDutyPolicies = [policy];

    await ModelAPI.create<IncidentOnCallRule>({
      model: rule,
      modelType: IncidentOnCallRule,
    });
  }
}
