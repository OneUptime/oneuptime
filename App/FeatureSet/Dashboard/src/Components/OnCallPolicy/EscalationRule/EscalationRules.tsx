import ProjectUser from "../../../Utils/ProjectUser";
import EscalationSummary, {
  EscalationLevelSummary,
  EscalationResponder,
} from "./EscalationSummary";
import Route from "Common/Types/API/Route";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import Image from "Common/UI/Components/Image/Image";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import BlankProfilePic from "Common/UI/Images/users/blank-profile.svg";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import {
  READINESS_STATUS_NOT_REACHABLE,
  ReadinessDeliveryContext,
  ReadinessSummaryWire,
  UserReadinessWire,
  getStatusConsequence,
  parseReadinessSummary,
} from "../Readiness/ReadinessTypes";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

export interface ComponentProps {
  onCallDutyPolicyId: ObjectID;
  projectId: ObjectID;
}

/*
 * The join rows for a single escalation rule. We keep the whole join row (not
 * just the entity) so we have both the entity to render AND the join-row id,
 * which is what we delete when a responder is removed during an edit.
 */
export interface RuleMembers {
  userJoins: Array<OnCallDutyPolicyEscalationRuleUser>;
  teamJoins: Array<OnCallDutyPolicyEscalationRuleTeam>;
  scheduleJoins: Array<OnCallDutyPolicyEscalationRuleSchedule>;
}

export type MembersByRuleId = Record<string, RuleMembers>;

/*
 * The selected responder ids captured live from the edit form, keyed by the
 * override-field name used in the form.
 */
interface SelectedMembers {
  users: Array<string>;
  teams: Array<string>;
  onCallSchedules: Array<string>;
}

// Prefill values for the edit form's member multi-selects.
interface MemberDefaults {
  users: Array<DropdownOption>;
  teams: Array<DropdownOption>;
  onCallSchedules: Array<DropdownOption>;
}

export const emptyRuleMembers: () => RuleMembers = (): RuleMembers => {
  return { userJoins: [], teamJoins: [], scheduleJoins: [] };
};

/*
 * One entry of a form multi-select value, flattened.
 *
 * `label` is only ever populated when the form handed us option envelopes
 * rather than bare ids, so it is optional on purpose: it is a nicety for the
 * warning copy (naming the person the admin just picked before their readiness
 * row has arrived), never the identity of anything.
 */
export interface SelectedOption {
  id: string;
  label: string;
}

/*
 * Normalizes a form multi-select value (which may be an array of ids, or an
 * array of { value, label } option envelopes when seeded as a default) into
 * id/label pairs.
 */
export const toSelectedOptions: (value: unknown) => Array<SelectedOption> = (
  value: unknown,
): Array<SelectedOption> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const options: Array<SelectedOption> = [];
  for (const item of value) {
    if (item === null || item === undefined) {
      continue;
    }
    if (
      typeof item === "object" &&
      "value" in (item as Record<string, unknown>)
    ) {
      const envelope: Record<string, unknown> = item as Record<string, unknown>;
      const inner: unknown = envelope["value"];
      if (inner !== null && inner !== undefined) {
        const label: unknown = envelope["label"];
        options.push({
          id: String(inner),
          label:
            label === null || label === undefined ? "" : String(label).trim(),
        });
      }
    } else {
      options.push({ id: String(item), label: "" });
    }
  }
  return options;
};

/*
 * The ids alone, for the join-row reconciliation that does not care about copy.
 * The form's onChange keeps the id/label pairs as well now - the warning needs
 * the label to name a team - so this reduces a selection that has already been
 * flattened rather than re-reading the raw form value.
 */
const toIds: (options: Array<SelectedOption>) => Array<string> = (
  options: Array<SelectedOption>,
): Array<string> => {
  return options.map((option: SelectedOption): string => {
    return option.id;
  });
};

// Turns a raw minutes value into a compact human-readable string, e.g. "1 hr 30 min".
const formatMinutes: (minutes: number | undefined | null) => string = (
  minutes: number | undefined | null,
): string => {
  if (!minutes || minutes <= 0) {
    return "immediately";
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours: number = Math.floor(minutes / 60);
  const remainingMinutes: number = minutes % 60;

  if (remainingMinutes === 0) {
    return hours === 1 ? "1 hr" : `${hours} hrs`;
  }

  return `${hours} hr ${remainingMinutes} min`;
};

const RULE_FORM_STEPS: Array<{ title: string; id: string }> = [
  { title: "Overview", id: "overview" },
  { title: "Notify", id: "notification" },
  { title: "Escalation", id: "escalation" },
];

/*
 * ADD-RESPONDER PREVENTION.
 *
 * Everything below exists to answer one question at one moment: an admin has
 * just picked a person out of the Users dropdown and is about to press Save -
 * can that person actually be paged?
 *
 * WHY HERE AND NOT ON A DASHBOARD. The readiness page and the dots on the
 * responder chips both report a problem that already exists, on a screen the
 * admin who created it may never open. The dropdown is where the problem is
 * MADE, and it is the only place where the fix costs nothing: unpick the name,
 * or send them a reminder and add them anyway. A warning that arrives later is
 * a warning somebody else has to act on.
 *
 * WHY THE PER-USER ROUTE AND NOT THE POLICY SUMMARY. The summary behind the
 * chips describes the policy's CURRENT responder set. The person being added is
 * by definition not in it yet, so asking it about them returns nothing at all -
 * which renders identically to "they are fine". The per-user route was built
 * for exactly this call site and deliberately does not require its subject to
 * be on any policy.
 */
const READINESS_USER_ROUTE: (userId: string) => string = (
  userId: string,
): string => {
  return `/on-call-readiness/user/${userId}`;
};

/*
 * The reminder this warning offers, and the reason it is worth offering at all:
 * a notification method lives on the responder's own account and only they can
 * verify it, so telling them IS the fix. The admin's alternative is to remember
 * to message somebody after they close this modal.
 *
 * The endpoint takes a LIST of user ids and answers with one outcome per user
 * rather than a bare success, and this surface passes exactly one id and reads
 * exactly one outcome back. It does not collapse that outcome into a tick: a
 * reminder that was throttled, or that went to somebody who is not a member of
 * the project, has not reached anybody, and an admin who is shown a tick for it
 * leaves believing a person was told.
 */
const SETUP_REMINDER_ROUTE: string = "/on-call-readiness/send-setup-reminder";

/* The outcome the server reports for a user it actually mailed. */
const SETUP_REMINDER_OUTCOME_SENT: string = "Sent";

/*
 * The delivery context the copy below is written against.
 *
 * getStatusConsequence takes this because a PartiallyReady responder's pages are
 * either caught by the project's notification fallback or dropped, and only the
 * project can say which. This surface renders NOTHING for a PartiallyReady
 * responder (see getRespondersToWarnAbout), so the value here is never consulted
 * on the branch that would need it: a NotReachable responder either has no
 * verified method at all, or has methods only on channels the project has
 * switched off, and the fallback cannot deliver on either. Stating the default
 * explicitly - rather than threading a project flag this modal never loads - is
 * what keeps that reasoning visible if the filter ever widens.
 */
const NOT_REACHABLE_DELIVERY_CONTEXT: ReadinessDeliveryContext = {
  isFallbackEnabled: true,
};

/*
 * What a readiness lookup for one just-picked responder produced.
 *
 * "unavailable" is a first-class state rather than an error to swallow. If the
 * lookup fails we know nothing about this person, and rendering nothing would
 * say "they are fine" in the same visual language a genuinely ready responder
 * uses. Saying "we could not check" is less useful and strictly more honest.
 */
export type ResponderCheckState = "checking" | "checked" | "unavailable";

export interface AddedResponderCheck {
  userId: string;
  /*
   * What to call this person in the copy. Seeded from the dropdown option so a
   * name is on screen while the lookup is in flight, then upgraded to the
   * readiness row's own name once it arrives.
   */
  label: string;
  state: ResponderCheckState;
  readiness: UserReadinessWire | null;
  /*
   * How this person got onto the rule, when it was not by being picked. A
   * responder reached through a team or a schedule is somebody the admin never
   * named, so a warning that just says "Alex Chen cannot be paged" reads as a
   * non-sequitur - they did not add Alex, they added Payments. Null for a direct
   * pick, where the name in the warning is the name they just chose.
   */
  via?: ResponderGroupSource | null;
}

/*
 * TEAMS AND SCHEDULES - the way responders are usually added.
 *
 * The first cut of this guard inspected `currentValues["users"]` and nothing
 * else, which meant it checked the LEAST common path. Escalation rules are
 * mostly built out of teams and schedules; picking individuals by hand is the
 * exception. So adding an unreachable person the usual way - through the team
 * they belong to - produced a modal that said nothing at all, which is worse
 * than having no guard: a guard that is silent when it does not know teaches
 * the reader that silence means everything is fine.
 *
 * Expanding them here mirrors what OnCallReadinessService.resolveResponders does
 * server-side, and mirrors it deliberately:
 *
 *   - A team expands to EVERY member row, with no hasAcceptedInvitation filter,
 *     because TeamMemberService.getUsersInTeam does not filter either. Somebody
 *     who never accepted their invite still gets paged, so they still have to be
 *     checked.
 *   - A schedule expands to its whole layer roster, not to whoever happens to be
 *     on call at this instant. A person in next week's rotation with no way to
 *     be reached is a page that will be missed next week.
 *
 * Any divergence from that server-side expansion would put this modal's silence
 * and the runtime's behaviour out of step, which is the failure mode the
 * readiness feature exists to remove rather than to reproduce.
 */
export type ResponderGroupKind = "team" | "schedule";

export interface ResponderGroupSource {
  kind: ResponderGroupKind;
  /*
   * The group's name, taken from the form's own dropdown option. Empty when the
   * form handed over bare ids, in which case the copy falls back to "a team" /
   * "a schedule" rather than inventing one.
   */
  label: string;
}

/*
 * "unavailable" carries the same weight here as it does on a per-user check. If
 * a team's membership cannot be read, the people inside it have not been
 * checked, and the modal has to say so - otherwise adding that team renders
 * exactly like adding a team full of reachable people.
 */
export type ResponderGroupState = "resolving" | "resolved" | "unavailable";

export interface ResponderGroupResolution {
  /** `team:<id>` or `schedule:<id>`. Unique across both kinds. */
  key: string;
  kind: ResponderGroupKind;
  id: string;
  label: string;
  state: ResponderGroupState;
  /** The users inside. Empty unless `state` is "resolved". */
  members: Array<SelectedOption>;
}

export const getResponderGroupKey: (
  kind: ResponderGroupKind,
  id: string,
) => string = (kind: ResponderGroupKind, id: string): string => {
  return `${kind}:${id}`;
};

/*
 * How many just-added responders this modal will look up, and why there is a
 * ceiling at all.
 *
 * Each check is its own request to the per-user readiness route. That was fine
 * when the only way into this list was picking names by hand - nobody picks
 * forty - but a team expands to its whole membership, so an admin attaching a
 * 300-person team would otherwise fire 300 requests out of a modal.
 *
 * The overflow is REPORTED rather than dropped. Checking the first twenty-five
 * and rendering nothing about the rest would be the same lie this whole change
 * is removing, one order of magnitude quieter: the reader would take a clean
 * modal as "everybody here can be paged". So the block says how many were not
 * checked and where to go and see.
 */
export const MAX_RESPONDERS_TO_CHECK: number = 25;

/*
 * What to call a group in the copy. Never a bare id: an admin who reads
 * "cba1f3e2-... could not be checked" learns nothing they can act on.
 */
export const getResponderGroupName: (
  group: Pick<ResponderGroupResolution, "kind" | "label">,
) => string = (group: Pick<ResponderGroupResolution, "kind" | "label">) => {
  if (group.label) {
    return group.label;
  }

  return group.kind === "team" ? "a team" : "a schedule";
};

/**
 * One responder worth a readiness lookup, and the reason they are in the list.
 */
export interface AddedResponder {
  userId: string;
  label: string;
  via: ResponderGroupSource | null;
}

/*
 * "skipped" is deliberately not folded into either "sent" or "failed".
 *
 * A throttled reminder did not go out and nothing is broken; a reminder for
 * somebody who is not a member of this project did not go out and something is.
 * Both are the server declining to send, and both leave the responder untold -
 * which is the fact the admin has to walk away with, whichever of the two it
 * was.
 */
export type SetupReminderState =
  | "idle"
  | "sending"
  | "sent"
  | "skipped"
  | "failed";

export interface SetupReminderStatus {
  state: SetupReminderState;
  /* The server's own sentence. Never replaced with a generic apology. */
  message: string;
}

/*
 * Reads the per-user readiness route's response.
 *
 * The one-row wrapper is deliberate. ReadinessTypes exports a parser for a
 * SUMMARY and keeps its per-user reader private, and the per-user route
 * serialises exactly the row a summary carries inside `users`. Wrapping is how
 * this file reuses that parser verbatim instead of hand-rolling a second reader
 * of the same payload - the silent drift ReadinessTypes' own header comment
 * exists to prevent.
 */
export const parseUserReadinessPayload: (
  json: JSONObject,
) => UserReadinessWire | null = (
  json: JSONObject,
): UserReadinessWire | null => {
  const summary: ReadinessSummaryWire = parseReadinessSummary({
    users: [json],
  } as JSONObject);

  const readiness: UserReadinessWire | undefined = summary.users[0];

  /*
   * A row with no user id is not a row. The parser is deliberately forgiving -
   * it fills defaults rather than throwing - so a body this surface cannot
   * understand comes back as a responder with an empty id and a defaulted
   * PartiallyReady status, which this warning would then quietly decline to
   * mention. Refusing it here is what turns that into a visible "we could not
   * check" instead.
   */
  if (!readiness || !readiness.userId) {
    return null;
  }

  return readiness;
};

/*
 * Turns the reminder endpoint's per-user array into this responder's status.
 *
 * A 200 whose `results` say nothing about the user we asked about is NOT a
 * send. It is the one shape that could quietly become a green tick over a
 * reminder that never left the building, so it is reported as a failure with the
 * only honest sentence available: we do not know.
 */
export const readSetupReminderStatus: (
  json: JSONObject,
  userId: string,
) => SetupReminderStatus = (
  json: JSONObject,
  userId: string,
): SetupReminderStatus => {
  const rawResults: unknown = json["results"];
  const results: Array<unknown> = Array.isArray(rawResults) ? rawResults : [];

  for (const entry of results) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const result: Record<string, unknown> = entry as Record<string, unknown>;

    if (String(result["userId"] || "") !== userId) {
      continue;
    }

    const outcome: string = String(result["outcome"] || "");
    const message: string = String(result["message"] || "");

    if (outcome === SETUP_REMINDER_OUTCOME_SENT) {
      return { state: "sent", message: message };
    }

    /*
     * Every non-Sent outcome carries the server's own explanation, and it is
     * rendered verbatim rather than mapped onto local copy. There are four of
     * them today and a build that has never heard of the fifth still shows the
     * reader a true sentence about what happened.
     */
    return {
      state: outcome === "Failed" ? "failed" : "skipped",
      message:
        message || `The server reported "${outcome}" without an explanation.`,
    };
  }

  return {
    state: "failed",
    message: "The server did not report an outcome for this reminder.",
  };
};

/*
 * Asks the server whether one just-picked responder can be paged.
 *
 * It never rejects. Every failure - a transport error, a 4xx, a 200 whose body
 * this build cannot read - becomes an "unavailable" check, because the caller is
 * a render and the only thing it could do with a thrown error is drop the
 * responder from the list, which renders exactly as "they are fine".
 */
export const fetchResponderCheck: (params: {
  userId: string;
  label: string;
}) => Promise<AddedResponderCheck> = async (params: {
  userId: string;
  label: string;
}): Promise<AddedResponderCheck> => {
  try {
    const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
      READINESS_USER_ROUTE(params.userId),
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: url,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const readiness: UserReadinessWire | null = parseUserReadinessPayload(
      response.data,
    );

    return {
      userId: params.userId,
      label: params.label,
      /*
       * A 200 with a body we cannot read is not a readiness answer. Calling it
       * "checked" would render nothing, which on this surface is
       * indistinguishable from "they are fine".
       */
      state: readiness ? "checked" : "unavailable",
      readiness: readiness,
    };
  } catch {
    return {
      userId: params.userId,
      label: params.label,
      state: "unavailable",
      readiness: null,
    };
  }
};

/*
 * Sends one setup reminder and reports what the server said happened.
 *
 * There is no optimistic "sent" anywhere in here. The point of the control is
 * that an admin can leave the modal believing a specific person was told, and
 * claiming that on the strength of a request whose answer we have not read is
 * the failure the button on the readiness page spent two phases disabled to
 * avoid.
 */
export const requestSetupReminder: (
  userId: string,
) => Promise<SetupReminderStatus> = async (
  userId: string,
): Promise<SetupReminderStatus> => {
  try {
    const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
      SETUP_REMINDER_ROUTE,
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: url,
        data: { userIds: [userId] },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    /*
     * A 200 is not the answer; the per-user outcome inside it is. The endpoint
     * answers 200 for a batch in which nothing was sent at all.
     */
    return readSetupReminderStatus(response.data, userId);
  } catch (err) {
    return { state: "failed", message: API.getFriendlyMessage(err) };
  }
};

/*
 * The ids that are genuinely NEW to this rule, in the order they were picked.
 *
 * The edit form opens pre-populated with the rule's current responders, so
 * without the baseline every open of the modal would re-accuse everybody who was
 * already there of being unreachable - a warning nobody caused and nobody can
 * act on from that modal. Warning only about what this admin just did is what
 * keeps the block worth reading.
 */
export const getAddedUserIds: (
  selectedUserIds: Array<string>,
  baselineUserIds: Array<string>,
) => Array<string> = (
  selectedUserIds: Array<string>,
  baselineUserIds: Array<string>,
): Array<string> => {
  const baseline: Set<string> = new Set(baselineUserIds);
  const seen: Set<string> = new Set();
  const added: Array<string> = [];

  for (const userId of selectedUserIds) {
    if (!userId || baseline.has(userId) || seen.has(userId)) {
      continue;
    }

    seen.add(userId);
    added.push(userId);
  }

  return added;
};

/*
 * One entry per user. A schedule with the same person on three layers is one
 * person to warn about, not three identical red blocks.
 */
const dedupeSelectedOptions: (
  options: Array<SelectedOption>,
) => Array<SelectedOption> = (
  options: Array<SelectedOption>,
): Array<SelectedOption> => {
  const seen: Set<string> = new Set<string>();
  const unique: Array<SelectedOption> = [];

  for (const option of options) {
    if (!option.id || seen.has(option.id)) {
      continue;
    }

    seen.add(option.id);
    unique.push(option);
  }

  return unique;
};

/*
 * A team's membership, read the way the runtime reads it.
 *
 * Never rejects, for the same reason fetchResponderCheck does not: the caller is
 * a render, and the only thing it could do with a thrown error is drop the group
 * - which renders as "everybody in that team is fine".
 *
 * `hasAcceptedInvitation` is deliberately absent from the query. See the comment
 * on ResponderGroupKind: the runtime pages members who never accepted, so this
 * has to check them.
 */
export const fetchTeamMembers: (params: {
  teamId: string;
  label: string;
  projectId: ObjectID;
}) => Promise<ResponderGroupResolution> = async (params: {
  teamId: string;
  label: string;
  projectId: ObjectID;
}): Promise<ResponderGroupResolution> => {
  const resolution: ResponderGroupResolution = {
    key: getResponderGroupKey("team", params.teamId),
    kind: "team",
    id: params.teamId,
    label: params.label,
    state: "unavailable",
    members: [],
  };

  try {
    const members: ListResult<TeamMember> = await ModelAPI.getList<TeamMember>({
      modelType: TeamMember,
      query: {
        teamId: new ObjectID(params.teamId),
        projectId: params.projectId,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        user: {
          _id: true,
          name: true,
          email: true,
        },
      },
      sort: {},
    });

    return {
      ...resolution,
      state: "resolved",
      members: dedupeSelectedOptions(
        members.data.map((member: TeamMember): SelectedOption => {
          return {
            id: member.user?.id?.toString() || "",
            label:
              member.user?.name?.toString() ||
              member.user?.email?.toString() ||
              "",
          };
        }),
      ),
    };
  } catch {
    return resolution;
  }
};

/*
 * A schedule's roster: every layer user, not whoever is on call right now.
 * Readiness is a property of the rotation, not of this instant.
 */
export const fetchScheduleUsers: (params: {
  scheduleId: string;
  label: string;
  projectId: ObjectID;
}) => Promise<ResponderGroupResolution> = async (params: {
  scheduleId: string;
  label: string;
  projectId: ObjectID;
}): Promise<ResponderGroupResolution> => {
  const resolution: ResponderGroupResolution = {
    key: getResponderGroupKey("schedule", params.scheduleId),
    kind: "schedule",
    id: params.scheduleId,
    label: params.label,
    state: "unavailable",
    members: [],
  };

  try {
    const layerUsers: ListResult<OnCallDutyPolicyScheduleLayerUser> =
      await ModelAPI.getList<OnCallDutyPolicyScheduleLayerUser>({
        modelType: OnCallDutyPolicyScheduleLayerUser,
        query: {
          onCallDutyPolicyScheduleId: new ObjectID(params.scheduleId),
          projectId: params.projectId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          user: {
            _id: true,
            name: true,
            email: true,
          },
        },
        sort: {},
      });

    return {
      ...resolution,
      state: "resolved",
      members: dedupeSelectedOptions(
        layerUsers.data.map(
          (layerUser: OnCallDutyPolicyScheduleLayerUser): SelectedOption => {
            return {
              id: layerUser.user?.id?.toString() || "",
              label:
                layerUser.user?.name?.toString() ||
                layerUser.user?.email?.toString() ||
                "",
            };
          },
        ),
      ),
    };
  } catch {
    return resolution;
  }
};

/*
 * EVERYBODY this admin has just put on the rule, however they did it.
 *
 * Three rules decide what comes out, and each of them exists to stop a specific
 * false warning:
 *
 *   1. The baseline is not just the rule's direct users - it is every user the
 *      rule ALREADY reached, including through the teams and schedules it opened
 *      with. Without that, adding a second team that shares one member with an
 *      existing team accuses the admin of adding somebody who was already being
 *      paged by this rule.
 *
 *   2. A user is reported ONCE, by the first route that reached them. Somebody
 *      picked directly and also present in a newly-added team is one person, and
 *      the direct pick is the one the admin will recognise.
 *
 *   3. A group that has not resolved contributes NOBODY - not silently, but by
 *      leaving the group in a non-resolved state that the warning block renders
 *      on its own. An unresolved BASELINE group also subtracts nobody, which can
 *      only over-warn; that is the safe direction, since the cost is a redundant
 *      red block rather than a missed one.
 */
export const getAddedResponders: (params: {
  selectedUsers: Array<SelectedOption>;
  baselineUserIds: Array<string>;
  addedGroups: Array<ResponderGroupResolution>;
  baselineGroups: Array<ResponderGroupResolution>;
}) => Array<AddedResponder> = (params: {
  selectedUsers: Array<SelectedOption>;
  baselineUserIds: Array<string>;
  addedGroups: Array<ResponderGroupResolution>;
  baselineGroups: Array<ResponderGroupResolution>;
}): Array<AddedResponder> => {
  const alreadyOnTheRule: Set<string> = new Set<string>(params.baselineUserIds);

  for (const group of params.baselineGroups) {
    if (group.state !== "resolved") {
      continue;
    }

    for (const member of group.members) {
      alreadyOnTheRule.add(member.id);
    }
  }

  const reported: Set<string> = new Set<string>();
  const added: Array<AddedResponder> = [];

  const consider: (
    userId: string,
    label: string,
    via: ResponderGroupSource | null,
  ) => void = (
    userId: string,
    label: string,
    via: ResponderGroupSource | null,
  ): void => {
    if (!userId || alreadyOnTheRule.has(userId) || reported.has(userId)) {
      return;
    }

    reported.add(userId);
    added.push({ userId: userId, label: label, via: via });
  };

  for (const option of params.selectedUsers) {
    consider(option.id, option.label, null);
  }

  for (const group of params.addedGroups) {
    if (group.state !== "resolved") {
      continue;
    }

    for (const member of group.members) {
      consider(member.id, member.label, {
        kind: group.kind,
        label: group.label,
      });
    }
  }

  return added;
};

/*
 * Which of the just-added responders this surface actually says something about.
 *
 * NotReachable and only NotReachable, plus the two states where we do not know.
 * PartiallyReady is deliberately silent here: on a project with the fallback on
 * - the default - those pages still arrive, just with default timing, and a
 * modal that lights up amber for most of a project's responders every time
 * anybody is added is a modal whose warning gets clicked through on reflex. Red
 * is reserved for the state that actually loses the page, which is the only way
 * the block keeps meaning something when it does appear.
 */
export const getRespondersToWarnAbout: (
  checks: Array<AddedResponderCheck>,
) => Array<AddedResponderCheck> = (
  checks: Array<AddedResponderCheck>,
): Array<AddedResponderCheck> => {
  return checks.filter((check: AddedResponderCheck): boolean => {
    if (check.state !== "checked") {
      return true;
    }

    return (
      Boolean(check.readiness) &&
      check.readiness!.status === READINESS_STATUS_NOT_REACHABLE
    );
  });
};

// The name to use in copy: the readiness row's, the dropdown's, or neither.
export const getResponderDisplayName: (check: AddedResponderCheck) => string = (
  check: AddedResponderCheck,
): string => {
  if (check.readiness) {
    const fromReadiness: string =
      check.readiness.userName || check.readiness.userEmail || "";

    if (fromReadiness) {
      return fromReadiness;
    }
  }

  return check.label || "This responder";
};

/*
 * Why this person is being talked about at all.
 *
 * An admin who added the Payments team did not add Alex; they have to be told
 * where Alex came from or the warning looks like it is about somebody else's
 * change. Empty for a direct pick, where the answer is "you just chose them".
 */
export const getResponderSourceSuffix: (
  check: AddedResponderCheck,
) => string = (check: AddedResponderCheck): string => {
  if (!check.via) {
    return "";
  }

  const name: string = getResponderGroupName(check.via);

  return check.via.kind === "team" ? ` (a member of ${name})` : ` (on ${name})`;
};

export interface AddResponderWarningProps {
  checks: Array<AddedResponderCheck>;
  reminders: Record<string, SetupReminderStatus>;
  onSendReminder: (userId: string) => void;
  /*
   * The teams and schedules just added to this rule, so the block can speak
   * about the ones it could not open. Optional: a surface with no groups to
   * report passes nothing, and the block behaves exactly as it did before they
   * existed.
   */
  groups?: Array<ResponderGroupResolution> | undefined;
  /*
   * Responders that were added but not looked up, because the selection went
   * past MAX_RESPONDERS_TO_CHECK. Stated on screen rather than swallowed - see
   * that constant.
   */
  uncheckedCount?: number | undefined;
}

/*
 * The groups worth a line of their own: the ones whose members have NOT been
 * checked. A resolved group says nothing here - its members are already in
 * `checks`, individually, which is a far more useful thing to read than "the
 * Payments team was expanded".
 */
export const getGroupsToWarnAbout: (
  groups: Array<ResponderGroupResolution>,
) => Array<ResponderGroupResolution> = (
  groups: Array<ResponderGroupResolution>,
): Array<ResponderGroupResolution> => {
  return groups.filter((group: ResponderGroupResolution): boolean => {
    return group.state !== "resolved";
  });
};

/*
 * The inline block under the add/edit form.
 *
 * Presentational on purpose - it holds no fetching and no state - because the
 * properties worth testing here are the ones a reader sees: that an unreachable
 * responder is named and told what happens to their pages, that a failed lookup
 * says so rather than staying quiet, that the reminder is offered only when it
 * can actually be sent, and that nothing here ever prevents a save.
 */
export const AddResponderWarning: FunctionComponent<
  AddResponderWarningProps
> = (props: AddResponderWarningProps): ReactElement => {
  const toWarnAbout: Array<AddedResponderCheck> = getRespondersToWarnAbout(
    props.checks,
  );

  const groupsToWarnAbout: Array<ResponderGroupResolution> =
    getGroupsToWarnAbout(props.groups || []);

  const uncheckedCount: number = props.uncheckedCount || 0;

  if (
    toWarnAbout.length === 0 &&
    groupsToWarnAbout.length === 0 &&
    uncheckedCount === 0
  ) {
    return <></>;
  }

  const getReminderRow: (check: AddedResponderCheck) => ReactElement = (
    check: AddedResponderCheck,
  ): ReactElement => {
    const name: string = getResponderDisplayName(check);
    const status: SetupReminderStatus = props.reminders[check.userId] || {
      state: "idle",
      message: "",
    };

    /*
     * The one terminal state. Nothing else here claims a person was told,
     * because nothing else here means one was.
     */
    if (status.state === "sent") {
      return (
        <p
          data-testid="setup-reminder-sent"
          className="mt-2 text-xs font-medium text-green-700"
        >
          Setup reminder sent to {name}.
        </p>
      );
    }

    return (
      <div className="mt-2">
        <Button
          title={
            status.state === "sending" ? "Sending..." : "Send setup reminder"
          }
          icon={IconProp.SendMessage}
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          disabled={status.state === "sending"}
          onClick={() => {
            props.onSendReminder(check.userId);
          }}
        />
        {status.state === "skipped" || status.state === "failed" ? (
          /*
           * The server's sentence, and then the fallback that is always
           * available: this person can be asked directly. A warning whose only
           * offered fix has just failed has to leave the reader with something
           * they can still do.
           */
          <p
            data-testid="setup-reminder-not-sent"
            className="mt-1.5 text-xs font-medium text-red-700"
          >
            No reminder was sent. {status.message} Ask {name} to finish their
            notification setup in User Settings.
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  /*
   * A group whose membership could not be read, or is still being read.
   *
   * This block is what keeps the guard from lying by omission on the path
   * responders are usually added by. Adding a team whose members cannot be
   * listed used to render nothing at all - identical to adding a team of
   * perfectly reachable people.
   */
  const getGroupBlock: (group: ResponderGroupResolution) => ReactElement = (
    group: ResponderGroupResolution,
  ): ReactElement => {
    const name: string = getResponderGroupName(group);
    const noun: string = group.kind === "team" ? "team" : "schedule";

    if (group.state === "resolving") {
      return (
        <div
          key={group.key}
          data-testid="add-responder-group-checking"
          className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 ring-1 ring-inset ring-gray-200"
        >
          <Icon
            icon={IconProp.Clock}
            className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
          />
          <span>Checking who is in {name}...</span>
        </div>
      );
    }

    return (
      <div
        key={group.key}
        data-testid="add-responder-group-unknown"
        className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200"
      >
        <Icon
          icon={IconProp.Alert}
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
        />
        <span>
          We could not read who is in {name}, so nobody on that {noun} has been
          checked. Add it if you meant to, then confirm on On-Call &gt;
          Readiness.
        </span>
      </div>
    );
  };

  const getCheckBlock: (check: AddedResponderCheck) => ReactElement = (
    check: AddedResponderCheck,
  ): ReactElement => {
    const name: string = getResponderDisplayName(check);
    /*
     * Appended to the NAME rather than written as a separate sentence, so the
     * headline of a red block reads "Alex Chen (a member of Payments) cannot be
     * paged" - one statement the reader can act on, rather than a claim followed
     * by a footnote explaining who is being claimed about.
     */
    const source: string = getResponderSourceSuffix(check);

    if (check.state === "checking") {
      return (
        <div
          key={check.userId}
          data-testid="add-responder-checking"
          className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 ring-1 ring-inset ring-gray-200"
        >
          <Icon
            icon={IconProp.Clock}
            className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
          />
          <span>
            Checking whether {name}
            {source} can be paged...
          </span>
        </div>
      );
    }

    if (check.state === "unavailable" || !check.readiness) {
      return (
        <div
          key={check.userId}
          data-testid="add-responder-unknown"
          className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200"
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
          />
          <span>
            We could not check whether {name}
            {source} can be paged. Add them if you meant to, then confirm on
            On-Call &gt; Readiness.
          </span>
        </div>
      );
    }

    return (
      <div
        key={check.userId}
        data-testid="add-responder-unreachable"
        className="rounded-lg bg-red-50 px-3 py-2.5 ring-1 ring-inset ring-red-200"
      >
        <div className="flex items-start gap-2">
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-4 w-4 shrink-0 text-red-500"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-800">
              {name}
              {source} cannot be paged
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-red-700">
              {getStatusConsequence(
                check.readiness,
                NOT_REACHABLE_DELIVERY_CONTEXT,
                name,
              )}
            </p>
            {getReminderRow(check)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-4 space-y-2" data-testid="add-responder-warning">
      {toWarnAbout.map((check: AddedResponderCheck): ReactElement => {
        return getCheckBlock(check);
      })}
      {/*
       * Groups come after the people, because a named person who cannot be paged
       * is the more actionable of the two and should not be pushed below a
       * caveat about a team that merely failed to load.
       */}
      {groupsToWarnAbout.map(
        (group: ResponderGroupResolution): ReactElement => {
          return getGroupBlock(group);
        },
      )}
      {uncheckedCount > 0 && (
        <div
          data-testid="add-responder-unchecked-overflow"
          className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200"
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
          />
          <span>
            {uncheckedCount === 1
              ? "1 more responder was added and has not been checked."
              : `${uncheckedCount} more responders were added and have not been checked.`}{" "}
            Confirm on On-Call &gt; Readiness.
          </span>
        </div>
      )}
      {/*
       * Said out loud, every time. This is a confirmation and not a gate:
       * adding somebody who is halfway through verifying a phone is a normal
       * thing to do, and an admin who reads a red block without being told it
       * is advisory will assume the Save button is broken.
       */}
      <p className="text-xs text-gray-500">
        You can still add them - this is a warning, not a block.
      </p>
    </div>
  );
};

/*
 * ESCALATION-RULE DELETION IMPACT.
 *
 * What actually goes away when a level is deleted, counted rather than
 * gestured at. "Its notification targets will be removed" is true of every
 * delete and therefore tells an admin nothing about THIS one.
 */
export interface EscalationRuleDeletionImpact {
  userCount: number;
  teamCount: number;
  scheduleCount: number;
  /*
   * Users named on this level and on no other level of this policy. Deliberately
   * only DIRECTLY named users: team membership and schedule rosters are resolved
   * server-side and are not in this component's hands, so a name is listed here
   * only when the claim can be checked from what is on screen.
   */
  usersNamedNowhereElse: Array<string>;
  // True when this is the last level, i.e. the policy is about to notify no one.
  isLastRule: boolean;
}

export const getEscalationRuleDeletionImpact: (params: {
  ruleIdToDelete: string;
  ruleIds: Array<string>;
  membersByRuleId: MembersByRuleId;
}) => EscalationRuleDeletionImpact = (params: {
  ruleIdToDelete: string;
  ruleIds: Array<string>;
  membersByRuleId: MembersByRuleId;
}): EscalationRuleDeletionImpact => {
  const members: RuleMembers =
    params.membersByRuleId[params.ruleIdToDelete] || emptyRuleMembers();

  const namedElsewhere: Set<string> = new Set<string>();

  for (const ruleId of params.ruleIds) {
    if (ruleId === params.ruleIdToDelete) {
      continue;
    }

    const otherMembers: RuleMembers =
      params.membersByRuleId[ruleId] || emptyRuleMembers();

    for (const join of otherMembers.userJoins) {
      const userId: string | undefined = join.user?.id?.toString();

      if (userId) {
        namedElsewhere.add(userId);
      }
    }
  }

  const usersNamedNowhereElse: Array<string> = [];

  for (const join of members.userJoins) {
    const userId: string | undefined = join.user?.id?.toString();

    if (!userId || namedElsewhere.has(userId)) {
      continue;
    }

    usersNamedNowhereElse.push(
      join.user?.name?.toString() || join.user?.email?.toString() || "A user",
    );
  }

  return {
    userCount: members.userJoins.length,
    teamCount: members.teamJoins.length,
    scheduleCount: members.scheduleJoins.length,
    usersNamedNowhereElse: usersNamedNowhereElse,
    isLastRule: params.ruleIds.length <= 1,
  };
};

// "2 users, 1 team and 1 on-call schedule", or "" when the level notifies nobody.
const describeResponderCounts: (
  impact: EscalationRuleDeletionImpact,
) => string = (impact: EscalationRuleDeletionImpact): string => {
  const parts: Array<string> = [];

  if (impact.userCount > 0) {
    parts.push(
      `${impact.userCount} ${impact.userCount === 1 ? "user" : "users"}`,
    );
  }

  if (impact.teamCount > 0) {
    parts.push(
      `${impact.teamCount} ${impact.teamCount === 1 ? "team" : "teams"}`,
    );
  }

  if (impact.scheduleCount > 0) {
    parts.push(
      `${impact.scheduleCount} on-call ${
        impact.scheduleCount === 1 ? "schedule" : "schedules"
      }`,
    );
  }

  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0]!;
  }

  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
};

/*
 * The confirmation sentence for deleting one level. Every clause is a fact
 * derived from the rows already on screen, so there is no version of this
 * message that says "this may affect your coverage" and means nothing.
 */
export const describeEscalationRuleDeletion: (
  ruleName: string,
  impact: EscalationRuleDeletionImpact,
) => string = (
  ruleName: string,
  impact: EscalationRuleDeletionImpact,
): string => {
  const sentences: Array<string> = [];
  const responderSummary: string = describeResponderCounts(impact);

  if (responderSummary) {
    sentences.push(`"${ruleName}" notifies ${responderSummary}.`);
  } else {
    sentences.push(`"${ruleName}" currently notifies no one.`);
  }

  if (impact.isLastRule) {
    sentences.push(
      "This is the only escalation level on this policy. Deleting it leaves the policy with nobody to notify, so an incident routed here would page no one.",
    );
  }

  if (impact.usersNamedNowhereElse.length > 0) {
    const names: string = impact.usersNamedNowhereElse.join(", ");
    const isSingle: boolean = impact.usersNamedNowhereElse.length === 1;

    sentences.push(
      `${names} ${
        isSingle ? "is" : "are"
      } not named on any other level of this policy.`,
    );
  }

  sentences.push("This action cannot be undone.");

  return sentences.join(" ");
};

/*
 * getDefaultValue is typed to return a scalar, but a multi-select form value is
 * an array of option envelopes. The form assigns whatever we return verbatim,
 * so we cast to satisfy the type while returning the option array at runtime.
 */
const memberFieldDefault: (
  options: Array<DropdownOption>,
) => (item: FormValues<OnCallDutyEscalationRule>) => string = (
  options: Array<DropdownOption>,
): ((item: FormValues<OnCallDutyEscalationRule>) => string) => {
  return (() => {
    return options;
  }) as unknown as (item: FormValues<OnCallDutyEscalationRule>) => string;
};

/*
 * Builds the create/edit form fields. When memberDefaults is provided (edit
 * mode), the member multi-selects are pre-populated with the rule's current
 * responders via getDefaultValue.
 */
const buildRuleFormFields: (
  memberDefaults?: MemberDefaults,
) => Array<ModelField<OnCallDutyEscalationRule>> = (
  memberDefaults?: MemberDefaults,
): Array<ModelField<OnCallDutyEscalationRule>> => {
  return [
    {
      field: { name: true },
      stepId: "overview",
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "First Responders",
      description: "A short name to identify this escalation rule.",
    },
    {
      field: { description: true },
      stepId: "overview",
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Describe who this level notifies and why.",
      description: "An optional description for this escalation rule.",
    },
    {
      overrideField: { onCallSchedules: true },
      showEvenIfPermissionDoesNotExist: true,
      title: "On-Call Schedules",
      stepId: "notification",
      description:
        "On-call schedules to notify. The person currently on-call will be contacted.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: OnCallDutyPolicySchedule,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select on-call schedules",
      overrideFieldKey: "onCallSchedules",
      getDefaultValue: memberDefaults
        ? memberFieldDefault(memberDefaults.onCallSchedules)
        : undefined,
    },
    {
      overrideField: { teams: true },
      showEvenIfPermissionDoesNotExist: true,
      title: "Teams",
      stepId: "notification",
      description: "Every member of the selected teams will be notified.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Team,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select teams",
      overrideFieldKey: "teams",
      getDefaultValue: memberDefaults
        ? memberFieldDefault(memberDefaults.teams)
        : undefined,
    },
    {
      overrideField: { users: true },
      showEvenIfPermissionDoesNotExist: true,
      title: "Users",
      stepId: "notification",
      description: "Specific users to notify directly.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      fetchDropdownOptions: async () => {
        return await ProjectUser.fetchProjectUsersAsDropdownOptions(
          ProjectUtil.getCurrentProjectId()!,
        );
      },
      required: false,
      placeholder: "Select users",
      overrideFieldKey: "users",
      getDefaultValue: memberDefaults
        ? memberFieldDefault(memberDefaults.users)
        : undefined,
    },
    {
      field: { escalateAfterInMinutes: true },
      stepId: "escalation",
      title: "Escalate after (in minutes)",
      fieldType: FormFieldSchemaType.Number,
      placeholder: "30",
      required: true,
      description:
        "How long to wait for an acknowledgement before escalating to the next rule.",
    },
  ];
};

/*
 * Reconciles one join-table (users/teams/schedules) for a rule: creates rows
 * for newly-added responders and deletes rows for removed ones.
 */
const syncJoinType: <TJoin extends BaseModel>(config: {
  latestIds: Array<string>;
  joins: Array<TJoin>;
  getEntityId: (join: TJoin) => string | undefined;
  createOne: (entityId: string) => Promise<void>;
  modelType: { new (): TJoin };
}) => Promise<void> = async <TJoin extends BaseModel>(config: {
  latestIds: Array<string>;
  joins: Array<TJoin>;
  getEntityId: (join: TJoin) => string | undefined;
  createOne: (entityId: string) => Promise<void>;
  modelType: { new (): TJoin };
}): Promise<void> => {
  const originalIds: Set<string> = new Set(
    config.joins
      .map((join: TJoin) => {
        return config.getEntityId(join);
      })
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      }),
  );
  const latestIdSet: Set<string> = new Set(config.latestIds);

  for (const id of config.latestIds) {
    if (!originalIds.has(id)) {
      await config.createOne(id);
    }
  }

  for (const join of config.joins) {
    const entityId: string | undefined = config.getEntityId(join);
    if (entityId && !latestIdSet.has(entityId) && join.id) {
      await ModelAPI.deleteItem({ modelType: config.modelType, id: join.id });
    }
  }
};

const EscalationRules: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rules, setRules] = useState<Array<OnCallDutyEscalationRule>>([]);
  const [membersByRuleId, setMembersByRuleId] = useState<MembersByRuleId>({});

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // Repeat-policy config, surfaced in the escalation summary's terminator node.
  const [repeatEnabled, setRepeatEnabled] = useState<boolean>(false);
  const [repeatCount, setRepeatCount] = useState<number>(0);

  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [ruleToEdit, setRuleToEdit] = useState<OnCallDutyEscalationRule | null>(
    null,
  );
  const [ruleToDelete, setRuleToDelete] =
    useState<OnCallDutyEscalationRule | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [reorderingRuleId, setReorderingRuleId] = useState<string | null>(null);

  /*
   * The live responder selection captured from the edit form. Seeded to the
   * rule's current responders when the edit modal opens.
   */
  const editedMembersRef: React.MutableRefObject<SelectedMembers> =
    useRef<SelectedMembers>({ users: [], teams: [], onCallSchedules: [] });

  /*
   * Add-responder prevention state.
   *
   * `selectedUserOptions` mirrors the Users multi-select of whichever modal is
   * open, and unlike editedMembersRef it lives in state: the warning has to
   * re-render the moment a name is picked, which a ref cannot do. `baseline` is
   * the set the modal opened with, so the warning speaks only about what this
   * admin just added rather than re-litigating the rule's existing responders.
   */
  const [selectedUserOptions, setSelectedUserOptions] = useState<
    Array<SelectedOption>
  >([]);
  const [baselineUserIds, setBaselineUserIds] = useState<Array<string>>([]);
  /*
   * The teams and schedules of whichever modal is open, and the ones it opened
   * with. These live in state alongside the users for the reason the whole of
   * this change exists: a responder added through a team or a schedule is the
   * COMMON case, and a guard that only watched the Users field was silent
   * exactly when it mattered most.
   */
  const [selectedTeamOptions, setSelectedTeamOptions] = useState<
    Array<SelectedOption>
  >([]);
  const [selectedScheduleOptions, setSelectedScheduleOptions] = useState<
    Array<SelectedOption>
  >([]);
  const [baselineTeamIds, setBaselineTeamIds] = useState<Array<string>>([]);
  const [baselineScheduleIds, setBaselineScheduleIds] = useState<Array<string>>(
    [],
  );
  /*
   * Expanded group membership, keyed by `team:<id>` / `schedule:<id>`, for every
   * group in either the baseline or the selection. Cached across the life of the
   * modal so re-picking a team does not re-read it, and so the BASELINE groups
   * are resolved exactly once - which is what lets an admin add a second team
   * that overlaps an existing one without being accused of adding people the
   * rule already reached.
   */
  const [groupResolutions, setGroupResolutions] = useState<
    Record<string, ResponderGroupResolution>
  >({});
  const [responderChecks, setResponderChecks] = useState<
    Record<string, AddedResponderCheck>
  >({});
  const [reminderStatuses, setReminderStatuses] = useState<
    Record<string, SetupReminderStatus>
  >({});

  const loadData: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const rulesResult: ListResult<OnCallDutyEscalationRule> =
        await ModelAPI.getList<OnCallDutyEscalationRule>({
          modelType: OnCallDutyEscalationRule,
          query: {
            onCallDutyPolicyId: props.onCallDutyPolicyId,
            projectId: props.projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            description: true,
            escalateAfterInMinutes: true,
            order: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      /*
       * Repeat behavior, so the summary can describe what happens after the
       * final level with no acknowledgement.
       */
      const policy: OnCallDutyPolicy | null =
        await ModelAPI.getItem<OnCallDutyPolicy>({
          modelType: OnCallDutyPolicy,
          id: props.onCallDutyPolicyId,
          select: {
            repeatPolicyIfNoOneAcknowledges: true,
            repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
          },
        });
      setRepeatEnabled(Boolean(policy?.repeatPolicyIfNoOneAcknowledges));
      setRepeatCount(policy?.repeatPolicyIfNoOneAcknowledgesNoOfTimes || 0);

      const [userJoins, teamJoins, scheduleJoins]: [
        ListResult<OnCallDutyPolicyEscalationRuleUser>,
        ListResult<OnCallDutyPolicyEscalationRuleTeam>,
        ListResult<OnCallDutyPolicyEscalationRuleSchedule>,
      ] = await Promise.all([
        ModelAPI.getList<OnCallDutyPolicyEscalationRuleUser>({
          modelType: OnCallDutyPolicyEscalationRuleUser,
          query: { onCallDutyPolicyId: props.onCallDutyPolicyId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            onCallDutyPolicyEscalationRuleId: true,
            user: {
              _id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          sort: {},
        }),
        ModelAPI.getList<OnCallDutyPolicyEscalationRuleTeam>({
          modelType: OnCallDutyPolicyEscalationRuleTeam,
          query: { onCallDutyPolicyId: props.onCallDutyPolicyId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            onCallDutyPolicyEscalationRuleId: true,
            team: {
              _id: true,
              name: true,
            },
          },
          sort: {},
        }),
        ModelAPI.getList<OnCallDutyPolicyEscalationRuleSchedule>({
          modelType: OnCallDutyPolicyEscalationRuleSchedule,
          query: { onCallDutyPolicyId: props.onCallDutyPolicyId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            onCallDutyPolicyEscalationRuleId: true,
            onCallDutyPolicySchedule: {
              _id: true,
              name: true,
              /*
               * Whether the schedule has anybody on call right now. Already
               * persisted and refreshed every minute by the RefreshHandoffTime
               * worker, so reading it here is free — and without it the chip
               * below claims a schedule is a responder even when it would
               * currently page no one.
               */
              currentUserIdOnRoster: true,
            },
          },
          sort: {},
        }),
      ]);

      const members: MembersByRuleId = {};

      const ensureRule: (ruleId: string | undefined) => RuleMembers | null = (
        ruleId: string | undefined,
      ): RuleMembers | null => {
        if (!ruleId) {
          return null;
        }
        if (!members[ruleId]) {
          members[ruleId] = emptyRuleMembers();
        }
        return members[ruleId]!;
      };

      for (const join of userJoins.data) {
        const bucket: RuleMembers | null = ensureRule(
          join.onCallDutyPolicyEscalationRuleId?.toString(),
        );
        if (bucket && join.user) {
          bucket.userJoins.push(join);
        }
      }

      for (const join of teamJoins.data) {
        const bucket: RuleMembers | null = ensureRule(
          join.onCallDutyPolicyEscalationRuleId?.toString(),
        );
        if (bucket && join.team) {
          bucket.teamJoins.push(join);
        }
      }

      for (const join of scheduleJoins.data) {
        const bucket: RuleMembers | null = ensureRule(
          join.onCallDutyPolicyEscalationRuleId?.toString(),
        );
        if (bucket && join.onCallDutyPolicySchedule) {
          bucket.scheduleJoins.push(join);
        }
      }

      setRules(rulesResult.data);
      setMembersByRuleId(members);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    await loadData();
  }, []);

  /*
   * The ids this admin has added since the modal opened, memoised on the joined
   * id list rather than the array: the form hands us a fresh array on every
   * keystroke anywhere in the form, and a new array identity would restart the
   * readiness lookups while somebody is typing a rule name.
   */
  const addedUserIdsKey: string = selectedUserOptions
    .map((option: SelectedOption): string => {
      return option.id;
    })
    .join(",");
  const baselineKey: string = baselineUserIds.join(",");

  const selectedTeamKey: string = selectedTeamOptions
    .map((option: SelectedOption): string => {
      return option.id;
    })
    .join(",");
  const selectedScheduleKey: string = selectedScheduleOptions
    .map((option: SelectedOption): string => {
      return option.id;
    })
    .join(",");
  const baselineTeamKey: string = baselineTeamIds.join(",");
  const baselineScheduleKey: string = baselineScheduleIds.join(",");

  /*
   * Every group the modal has anything to do with - baseline and selection
   * together - because both have to be expanded: the selection to find who is
   * being ADDED, the baseline to know who was already there.
   */
  const groupsInPlay: Array<{
    kind: ResponderGroupKind;
    option: SelectedOption;
  }> = useMemo((): Array<{
    kind: ResponderGroupKind;
    option: SelectedOption;
  }> => {
    const all: Array<{ kind: ResponderGroupKind; option: SelectedOption }> = [];
    const seen: Set<string> = new Set<string>();

    const add: (kind: ResponderGroupKind, option: SelectedOption) => void = (
      kind: ResponderGroupKind,
      option: SelectedOption,
    ): void => {
      const key: string = getResponderGroupKey(kind, option.id);

      if (!option.id || seen.has(key)) {
        return;
      }

      seen.add(key);
      all.push({ kind: kind, option: option });
    };

    for (const option of selectedTeamOptions) {
      add("team", option);
    }

    for (const option of selectedScheduleOptions) {
      add("schedule", option);
    }

    /*
     * Baseline ids arrive without labels (they are ids off the join rows), which
     * is fine: a baseline group is never NAMED in the copy, it is only
     * subtracted.
     */
    for (const id of baselineTeamIds) {
      add("team", { id: id, label: "" });
    }

    for (const id of baselineScheduleIds) {
      add("schedule", { id: id, label: "" });
    }

    return all;
    /*
     * Keyed on the joined id lists rather than the arrays, for the same reason
     * the user selection is: the form hands over a fresh array on every
     * keystroke anywhere in the form.
     */
  }, [
    selectedTeamKey,
    selectedScheduleKey,
    baselineTeamKey,
    baselineScheduleKey,
  ]);

  /*
   * Expands every group exactly once.
   *
   * Written into state as "resolving" BEFORE the request goes out - the same
   * trick the per-user lookups use - which both puts the in-flight line on
   * screen and stops this effect re-issuing the read when the resulting state
   * change re-runs it.
   */
  useEffect(() => {
    const unresolved: Array<{
      kind: ResponderGroupKind;
      option: SelectedOption;
    }> = groupsInPlay.filter(
      (entry: {
        kind: ResponderGroupKind;
        option: SelectedOption;
      }): boolean => {
        return !groupResolutions[
          getResponderGroupKey(entry.kind, entry.option.id)
        ];
      },
    );

    if (unresolved.length === 0) {
      return;
    }

    setGroupResolutions(
      (previous: Record<string, ResponderGroupResolution>) => {
        const next: Record<string, ResponderGroupResolution> = { ...previous };

        for (const entry of unresolved) {
          const key: string = getResponderGroupKey(entry.kind, entry.option.id);

          next[key] = {
            key: key,
            kind: entry.kind,
            id: entry.option.id,
            label: entry.option.label,
            state: "resolving",
            members: [],
          };
        }

        return next;
      },
    );

    for (const entry of unresolved) {
      const key: string = getResponderGroupKey(entry.kind, entry.option.id);

      const request: Promise<ResponderGroupResolution> =
        entry.kind === "team"
          ? fetchTeamMembers({
              teamId: entry.option.id,
              label: entry.option.label,
              projectId: props.projectId,
            })
          : fetchScheduleUsers({
              scheduleId: entry.option.id,
              label: entry.option.label,
              projectId: props.projectId,
            });

      request
        .then((resolution: ResponderGroupResolution) => {
          setGroupResolutions(
            (previous: Record<string, ResponderGroupResolution>) => {
              return { ...previous, [key]: resolution };
            },
          );
        })
        .catch(() => {
          /*
           * Both fetchers route every failure into an "unavailable" resolution
           * and do not reject. The catch exists so a fire-and-forget promise
           * cannot log an unhandled rejection on a modal that is behaving
           * correctly.
           */
        });
    }
  }, [groupsInPlay, groupResolutions]);

  /*
   * The groups NEW to this rule, and the ones it opened with, as resolutions.
   * Split here rather than inside getAddedResponders so the warning block can be
   * handed exactly the added ones - a baseline team that fails to load is not
   * something this admin did and not something they can act on from here.
   */
  const groupResolutionsKey: string = Object.keys(groupResolutions)
    .sort()
    .map((key: string): string => {
      const group: ResponderGroupResolution = groupResolutions[key]!;

      return `${key}|${group.state}|${group.members
        .map((member: SelectedOption): string => {
          return member.id;
        })
        .join("~")}`;
    })
    .join(",");

  const addedGroups: Array<ResponderGroupResolution> =
    useMemo((): Array<ResponderGroupResolution> => {
      const baseline: Set<string> = new Set<string>([
        ...baselineTeamIds.map((id: string): string => {
          return getResponderGroupKey("team", id);
        }),
        ...baselineScheduleIds.map((id: string): string => {
          return getResponderGroupKey("schedule", id);
        }),
      ]);

      const added: Array<ResponderGroupResolution> = [];

      for (const entry of groupsInPlay) {
        const key: string = getResponderGroupKey(entry.kind, entry.option.id);

        if (baseline.has(key)) {
          continue;
        }

        const resolution: ResponderGroupResolution | undefined =
          groupResolutions[key];

        if (resolution) {
          added.push(resolution);
        }
      }

      return added;
    }, [
      groupsInPlay,
      groupResolutionsKey,
      baselineTeamKey,
      baselineScheduleKey,
    ]);

  const baselineGroups: Array<ResponderGroupResolution> =
    useMemo((): Array<ResponderGroupResolution> => {
      const keys: Array<string> = [
        ...baselineTeamIds.map((id: string): string => {
          return getResponderGroupKey("team", id);
        }),
        ...baselineScheduleIds.map((id: string): string => {
          return getResponderGroupKey("schedule", id);
        }),
      ];

      return keys
        .map((key: string): ResponderGroupResolution | undefined => {
          return groupResolutions[key];
        })
        .filter(
          (
            resolution: ResponderGroupResolution | undefined,
          ): resolution is ResponderGroupResolution => {
            return Boolean(resolution);
          },
        );
    }, [groupResolutionsKey, baselineTeamKey, baselineScheduleKey]);

  /*
   * Everybody this admin has just put on the rule, direct picks and group
   * members alike, deduped and attributed. This replaces the id-only list the
   * lookups used to run on - the attribution is what lets the warning say WHY
   * it is talking about somebody nobody picked.
   */
  const addedResponders: Array<AddedResponder> =
    useMemo((): Array<AddedResponder> => {
      return getAddedResponders({
        selectedUsers: selectedUserOptions,
        baselineUserIds: baselineKey ? baselineKey.split(",") : [],
        addedGroups: addedGroups,
        baselineGroups: baselineGroups,
      });
    }, [addedUserIdsKey, baselineKey, addedGroups, baselineGroups]);

  /*
   * The bounded slice that is actually looked up, and the count that is not.
   * See MAX_RESPONDERS_TO_CHECK: a team expands to its whole membership, so this
   * list is no longer bounded by what a person is willing to click.
   */
  const respondersToCheck: Array<AddedResponder> =
    useMemo((): Array<AddedResponder> => {
      return addedResponders.slice(0, MAX_RESPONDERS_TO_CHECK);
    }, [addedResponders]);

  const uncheckedResponderCount: number = Math.max(
    0,
    addedResponders.length - respondersToCheck.length,
  );

  /*
   * Looks up every newly-added responder exactly once.
   *
   * Each id is written into state as "checking" BEFORE its request goes out,
   * which is both what puts the in-flight line on screen and what stops this
   * effect from re-issuing the same lookup when it re-runs on the resulting
   * state change.
   */
  useEffect(() => {
    const unchecked: Array<AddedResponder> = respondersToCheck.filter(
      (responder: AddedResponder): boolean => {
        return !responderChecks[responder.userId];
      },
    );

    if (unchecked.length === 0) {
      return;
    }

    setResponderChecks((previous: Record<string, AddedResponderCheck>) => {
      const next: Record<string, AddedResponderCheck> = { ...previous };

      for (const responder of unchecked) {
        next[responder.userId] = {
          userId: responder.userId,
          label: responder.label,
          state: "checking",
          readiness: null,
          via: responder.via,
        };
      }

      return next;
    });

    for (const responder of unchecked) {
      fetchResponderCheck({
        userId: responder.userId,
        label: responder.label,
      })
        .then((check: AddedResponderCheck) => {
          setResponderChecks(
            (previous: Record<string, AddedResponderCheck>) => {
              /*
               * fetchResponderCheck knows nothing about teams and schedules, so
               * the attribution is re-attached here. Losing it would leave an
               * admin reading a red block about somebody they never picked with
               * no way to work out where they came from.
               */
              return {
                ...previous,
                [responder.userId]: { ...check, via: responder.via },
              };
            },
          );
        })
        .catch(() => {
          /*
           * fetchResponderCheck routes every failure into an "unavailable"
           * check and does not reject. The catch is here because an unhandled
           * rejection from a fire-and-forget promise would surface as a console
           * error on a modal that is behaving correctly.
           */
        });
    }
  }, [respondersToCheck, responderChecks]);

  /*
   * Sends the reminder, and reports what actually happened.
   *
   * There is no optimistic "sent" here: the point of this control is that an
   * admin can leave the modal believing a specific person was told. Claiming
   * that on the strength of a request we have not seen the answer to is the
   * failure the disabled button on the readiness page was protecting against.
   */
  const sendSetupReminder: (userId: string) => Promise<void> = async (
    userId: string,
  ): Promise<void> => {
    setReminderStatuses((previous: Record<string, SetupReminderStatus>) => {
      return { ...previous, [userId]: { state: "sending", message: "" } };
    });

    const status: SetupReminderStatus = await requestSetupReminder(userId);

    setReminderStatuses((previous: Record<string, SetupReminderStatus>) => {
      return { ...previous, [userId]: status };
    });
  };

  /*
   * Clears the warning when a modal opens or closes. Without this the block
   * would still be describing the person added to the PREVIOUS rule the next
   * time the modal opens.
   */
  const resetResponderWarning: (baseline: SelectedMembers) => void = (
    baseline: SelectedMembers,
  ): void => {
    setBaselineUserIds(baseline.users);
    setSelectedUserOptions(
      baseline.users.map((userId: string): SelectedOption => {
        return { id: userId, label: "" };
      }),
    );

    setBaselineTeamIds(baseline.teams);
    setSelectedTeamOptions(
      baseline.teams.map((teamId: string): SelectedOption => {
        return { id: teamId, label: "" };
      }),
    );

    setBaselineScheduleIds(baseline.onCallSchedules);
    setSelectedScheduleOptions(
      baseline.onCallSchedules.map((scheduleId: string): SelectedOption => {
        return { id: scheduleId, label: "" };
      }),
    );

    /*
     * The expansion cache is cleared with everything else. Team membership can
     * change between two opens of this modal, and a stale roster would either
     * hide somebody newly added to the team or accuse the admin of adding
     * somebody who has since left it.
     */
    setGroupResolutions({});
    setResponderChecks({});
    setReminderStatuses({});
  };

  const moveRule: (
    rule: OnCallDutyEscalationRule,
    targetOrder: number,
  ) => Promise<void> = async (
    rule: OnCallDutyEscalationRule,
    targetOrder: number,
  ): Promise<void> => {
    if (!rule.id) {
      return;
    }

    try {
      setReorderingRuleId(rule.id.toString());
      await ModelAPI.updateById({
        modelType: OnCallDutyEscalationRule,
        id: rule.id,
        data: {
          order: targetOrder,
        } as JSONObject,
      });
      await loadData();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setReorderingRuleId(null);
  };

  const confirmDelete: () => Promise<void> = async (): Promise<void> => {
    if (!ruleToDelete || !ruleToDelete.id) {
      return;
    }

    try {
      setIsDeleting(true);
      await ModelAPI.deleteItem({
        modelType: OnCallDutyEscalationRule,
        id: ruleToDelete.id,
      });
      setRuleToDelete(null);
      await loadData();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setRuleToDelete(null);
    }

    setIsDeleting(false);
  };

  /*
   * Reconciles the rule's responders against the edit form selection by
   * creating/deleting the relevant join rows.
   */
  const syncEditedMembers: (ruleId: ObjectID) => Promise<void> = async (
    ruleId: ObjectID,
  ): Promise<void> => {
    const original: RuleMembers =
      membersByRuleId[ruleId.toString()] || emptyRuleMembers();
    const latest: SelectedMembers = editedMembersRef.current;

    // On-call schedules
    await syncJoinType<OnCallDutyPolicyEscalationRuleSchedule>({
      latestIds: latest.onCallSchedules,
      joins: original.scheduleJoins,
      getEntityId: (join: OnCallDutyPolicyEscalationRuleSchedule) => {
        return join.onCallDutyPolicySchedule?.id?.toString();
      },
      modelType: OnCallDutyPolicyEscalationRuleSchedule,
      createOne: async (scheduleId: string) => {
        const model: OnCallDutyPolicyEscalationRuleSchedule =
          new OnCallDutyPolicyEscalationRuleSchedule();
        model.projectId = props.projectId;
        model.onCallDutyPolicyId = props.onCallDutyPolicyId;
        model.onCallDutyPolicyEscalationRuleId = ruleId;
        model.onCallDutyPolicyScheduleId = new ObjectID(scheduleId);
        await ModelAPI.create({
          modelType: OnCallDutyPolicyEscalationRuleSchedule,
          model: model,
        });
      },
    });

    // Teams
    await syncJoinType<OnCallDutyPolicyEscalationRuleTeam>({
      latestIds: latest.teams,
      joins: original.teamJoins,
      getEntityId: (join: OnCallDutyPolicyEscalationRuleTeam) => {
        return join.team?.id?.toString();
      },
      modelType: OnCallDutyPolicyEscalationRuleTeam,
      createOne: async (teamId: string) => {
        const model: OnCallDutyPolicyEscalationRuleTeam =
          new OnCallDutyPolicyEscalationRuleTeam();
        model.projectId = props.projectId;
        model.onCallDutyPolicyId = props.onCallDutyPolicyId;
        model.onCallDutyPolicyEscalationRuleId = ruleId;
        model.teamId = new ObjectID(teamId);
        await ModelAPI.create({
          modelType: OnCallDutyPolicyEscalationRuleTeam,
          model: model,
        });
      },
    });

    // Users
    await syncJoinType<OnCallDutyPolicyEscalationRuleUser>({
      latestIds: latest.users,
      joins: original.userJoins,
      getEntityId: (join: OnCallDutyPolicyEscalationRuleUser) => {
        return join.user?.id?.toString();
      },
      modelType: OnCallDutyPolicyEscalationRuleUser,
      createOne: async (userId: string) => {
        const model: OnCallDutyPolicyEscalationRuleUser =
          new OnCallDutyPolicyEscalationRuleUser();
        model.projectId = props.projectId;
        model.onCallDutyPolicyId = props.onCallDutyPolicyId;
        model.onCallDutyPolicyEscalationRuleId = ruleId;
        model.userId = new ObjectID(userId);
        await ModelAPI.create({
          modelType: OnCallDutyPolicyEscalationRuleUser,
          model: model,
        });
      },
    });
  };

  const getUserChip: (user: User) => ReactElement = (
    user: User,
  ): ReactElement => {
    const userId: ObjectID | null = user.id || null;
    const imageRoute: Route = userId
      ? UserUtil.getProfilePictureRoute(userId)
      : Route.fromString(`${BlankProfilePic}`);
    const name: string =
      user.name?.toString() || user.email?.toString() || "User";

    return (
      <span
        key={`user-${userId?.toString()}`}
        className="inline-flex items-center gap-2 rounded-full bg-white ring-1 ring-inset ring-gray-200 py-0.5 pl-0.5 pr-3 shadow-sm"
      >
        <Image
          className="h-6 w-6 rounded-full bg-gray-100 object-cover"
          imageUrl={imageRoute}
          alt={name}
        />
        <span className="text-sm font-medium text-gray-700">{name}</span>
      </span>
    );
  };

  const getTeamChip: (team: Team) => ReactElement = (
    team: Team,
  ): ReactElement => {
    return (
      <span
        key={`team-${team.id?.toString()}`}
        className="inline-flex items-center gap-2 rounded-full bg-white ring-1 ring-inset ring-gray-200 py-1 pl-1 pr-3 shadow-sm"
      >
        <span className="h-6 w-6 rounded-full bg-violet-100 flex items-center justify-center">
          <Icon icon={IconProp.Team} className="h-3.5 w-3.5 text-violet-600" />
        </span>
        <span className="text-sm font-medium text-gray-700">
          {team.name?.toString()}
        </span>
      </span>
    );
  };

  const getScheduleChip: (
    schedule: OnCallDutyPolicySchedule,
  ) => ReactElement = (schedule: OnCallDutyPolicySchedule): ReactElement => {
    /*
     * A schedule with nobody on call right now is listed as a responder but
     * would page no one. Rendering it identically to a healthy schedule makes
     * a broken escalation level look correctly configured.
     */
    const isUncovered: boolean = !schedule.currentUserIdOnRoster;

    return (
      <span
        key={`schedule-${schedule.id?.toString()}`}
        title={
          isUncovered
            ? "No one is currently on call in this schedule - this level would not notify anyone right now."
            : undefined
        }
        className={`inline-flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 shadow-sm ring-1 ring-inset ${
          isUncovered ? "ring-amber-300" : "ring-gray-200"
        }`}
      >
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full ${
            isUncovered ? "bg-amber-100" : "bg-indigo-100"
          }`}
        >
          <Icon
            icon={isUncovered ? IconProp.Alert : IconProp.Calendar}
            className={`h-3.5 w-3.5 ${
              isUncovered ? "text-amber-600" : "text-indigo-600"
            }`}
          />
        </span>
        <span className="text-sm font-medium text-gray-700">
          {schedule.name?.toString()}
        </span>
        {isUncovered && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            No one on call
          </span>
        )}
      </span>
    );
  };

  const getNotifiesSection: (members: RuleMembers) => ReactElement = (
    members: RuleMembers,
  ): ReactElement => {
    const schedules: Array<OnCallDutyPolicySchedule> = members.scheduleJoins
      .map((join: OnCallDutyPolicyEscalationRuleSchedule) => {
        return join.onCallDutyPolicySchedule;
      })
      .filter(
        (
          schedule: OnCallDutyPolicySchedule | undefined,
        ): schedule is OnCallDutyPolicySchedule => {
          return Boolean(schedule);
        },
      );
    const teams: Array<Team> = members.teamJoins
      .map((join: OnCallDutyPolicyEscalationRuleTeam) => {
        return join.team;
      })
      .filter((team: Team | undefined): team is Team => {
        return Boolean(team);
      });
    const users: Array<User> = members.userJoins
      .map((join: OnCallDutyPolicyEscalationRuleUser) => {
        return join.user;
      })
      .filter((user: User | undefined): user is User => {
        return Boolean(user);
      });

    const totalCount: number = users.length + teams.length + schedules.length;

    if (totalCount === 0) {
      return (
        <div className="inline-flex items-start gap-2 rounded-lg bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2 text-sm text-amber-800">
          <Icon
            icon={IconProp.Alert}
            className="h-4 w-4 text-amber-500 mt-0.5 shrink-0"
          />
          <span>
            No responders assigned. No one will be notified at this level — edit
            this rule to add responders.
          </span>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap gap-2">
        {schedules.map((schedule: OnCallDutyPolicySchedule) => {
          return getScheduleChip(schedule);
        })}
        {teams.map((team: Team) => {
          return getTeamChip(team);
        })}
        {users.map((user: User) => {
          return getUserChip(user);
        })}
      </div>
    );
  };

  type IconButtonProps = {
    icon: IconProp;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
  };

  const getIconButton: (buttonProps: IconButtonProps) => ReactElement = (
    buttonProps: IconButtonProps,
  ): ReactElement => {
    return (
      <Tooltip text={buttonProps.label}>
        <button
          type="button"
          aria-label={buttonProps.label}
          disabled={buttonProps.disabled}
          onClick={buttonProps.onClick}
          className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:pointer-events-none ${
            buttonProps.danger
              ? "text-gray-400 hover:text-red-600 hover:bg-red-50"
              : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          }`}
        >
          <Icon icon={buttonProps.icon} className="h-4 w-4" />
        </button>
      </Tooltip>
    );
  };

  /*
   * Opens the edit modal, seeding the live responder ref with the rule's
   * current responders so an untouched save is a no-op.
   */
  const openCreateModal: () => void = (): void => {
    /*
     * An empty baseline: on a rule that does not exist yet every picked user,
     * team and schedule is something this admin just added, so everybody they
     * reach is worth checking.
     */
    resetResponderWarning({ users: [], teams: [], onCallSchedules: [] });
    setShowCreateModal(true);
  };

  const openEditModal: (rule: OnCallDutyEscalationRule) => void = (
    rule: OnCallDutyEscalationRule,
  ): void => {
    const members: RuleMembers =
      membersByRuleId[rule.id?.toString() || ""] || emptyRuleMembers();

    editedMembersRef.current = {
      onCallSchedules: members.scheduleJoins
        .map((join: OnCallDutyPolicyEscalationRuleSchedule) => {
          return join.onCallDutyPolicySchedule?.id?.toString();
        })
        .filter((id: string | undefined): id is string => {
          return Boolean(id);
        }),
      teams: members.teamJoins
        .map((join: OnCallDutyPolicyEscalationRuleTeam) => {
          return join.team?.id?.toString();
        })
        .filter((id: string | undefined): id is string => {
          return Boolean(id);
        }),
      users: members.userJoins
        .map((join: OnCallDutyPolicyEscalationRuleUser) => {
          return join.user?.id?.toString();
        })
        .filter((id: string | undefined): id is string => {
          return Boolean(id);
        }),
    };

    /*
     * The rule's existing responders are the baseline, not additions - and that
     * now includes its teams and schedules, whose members are expanded and
     * subtracted too. An admin opening a rule that already contains an
     * unreachable person is not making the mistake this block is here to catch -
     * the readiness dot on their chip is - and accusing them of it every time
     * they open the modal is how a warning becomes wallpaper.
     */
    resetResponderWarning(editedMembersRef.current);

    setRuleToEdit(rule);
  };

  const getRuleCard: (
    rule: OnCallDutyEscalationRule,
    index: number,
  ) => ReactElement = (
    rule: OnCallDutyEscalationRule,
    index: number,
  ): ReactElement => {
    const ruleId: string = rule.id?.toString() || "";
    const members: RuleMembers = membersByRuleId[ruleId] || emptyRuleMembers();
    const isFirst: boolean = index === 0;
    const isLast: boolean = index === rules.length - 1;
    const isReordering: boolean = reorderingRuleId === ruleId;

    return (
      <div
        key={ruleId}
        className={`group rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:border-indigo-300 hover:shadow-md ${
          isReordering ? "opacity-60 pointer-events-none" : ""
        }`}
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-4">
            {/* Level badge */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-sm font-semibold text-white shadow-sm ring-1 ring-inset ring-indigo-700/20">
              {index + 1}
            </div>

            <div className="min-w-0 flex-1">
              {/* Header: name + escalation timing + actions */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-gray-900">
                      {rule.name?.toString() || `Escalation Level ${index + 1}`}
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
                      <Icon
                        icon={IconProp.Clock}
                        className="h-3 w-3 text-gray-400"
                      />
                      Escalates after{" "}
                      {formatMinutes(rule.escalateAfterInMinutes)}
                    </span>
                  </div>
                  {rule.description?.toString() ? (
                    <p className="mt-1 text-sm leading-relaxed text-gray-500">
                      {rule.description.toString()}
                    </p>
                  ) : (
                    <></>
                  )}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-0.5">
                  {getIconButton({
                    icon: IconProp.ArrowUp,
                    label: "Move up",
                    disabled: isFirst,
                    onClick: () => {
                      const previous: OnCallDutyEscalationRule | undefined =
                        rules[index - 1];
                      if (previous && previous.order !== undefined) {
                        moveRule(rule, previous.order).catch(() => {});
                      }
                    },
                  })}
                  {getIconButton({
                    icon: IconProp.ArrowDown,
                    label: "Move down",
                    disabled: isLast,
                    onClick: () => {
                      const next: OnCallDutyEscalationRule | undefined =
                        rules[index + 1];
                      if (next && next.order !== undefined) {
                        moveRule(rule, next.order).catch(() => {});
                      }
                    },
                  })}
                  {getIconButton({
                    icon: IconProp.Edit,
                    label: "Edit rule",
                    onClick: () => {
                      return openEditModal(rule);
                    },
                  })}
                  {getIconButton({
                    icon: IconProp.Trash,
                    label: "Delete rule",
                    danger: true,
                    onClick: () => {
                      return setRuleToDelete(rule);
                    },
                  })}
                </div>
              </div>

              {/* Notifies */}
              <div className="mt-4">
                <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Notifies
                </div>
                {getNotifiesSection(members)}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const getConnector: (rule: OnCallDutyEscalationRule) => ReactElement = (
    rule: OnCallDutyEscalationRule,
  ): ReactElement => {
    return (
      <div className="flex flex-col items-center py-1">
        <div className="h-3 w-px bg-gray-200" />
        <div className="my-1 inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
          <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 text-gray-400" />
          <span>
            If unacknowledged after{" "}
            <span className="font-semibold text-gray-900">
              {formatMinutes(rule.escalateAfterInMinutes)}
            </span>
            , escalate to the next level
          </span>
        </div>
        <Icon icon={IconProp.ChevronDown} className="h-4 w-4 text-gray-300" />
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="flex w-full justify-center py-16">
          <ComponentLoader />
        </div>
      );
    }

    if (error) {
      return <ErrorMessage message={error} onRefreshClick={loadData} />;
    }

    if (rules.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50">
          <EmptyState
            id="no-escalation-rules"
            icon={IconProp.Bell}
            title={"No escalation rules yet"}
            description={
              "Escalation rules decide who gets paged and how quickly the alert climbs the ladder when no one responds. Add your first rule to get started."
            }
            footer={
              <Button
                title="Add Escalation Rule"
                icon={IconProp.Add}
                buttonStyle={ButtonStyleType.PRIMARY}
                onClick={() => {
                  return openCreateModal();
                }}
              />
            }
          />
        </div>
      );
    }

    return (
      <div>
        {rules.map((rule: OnCallDutyEscalationRule, index: number) => {
          return (
            <Fragment key={rule.id?.toString() || index}>
              {getRuleCard(rule, index)}
              {index !== rules.length - 1 ? getConnector(rule) : <></>}
            </Fragment>
          );
        })}
      </div>
    );
  };

  /*
   * Prefill options for the edit modal's member multi-selects.
   *
   * MEMOISED, and that is load bearing rather than tidiness. ModelForm rebuilds
   * its whole field set - including re-running fetchDropdownOptions, which is a
   * network call for the project's user list - whenever the `fields` array it is
   * handed changes identity. This component now re-renders while the modal is
   * open (a responder is picked, a readiness lookup returns, a reminder is
   * sent), so a freshly-built array on every render would refetch the user
   * dropdown several times per selection and flicker the field the admin is
   * using. Both this and the two field arrays below are therefore keyed on the
   * things that genuinely change them.
   */
  const editRuleId: string = ruleToEdit?.id?.toString() || "";

  const editMemberDefaults: MemberDefaults | undefined = useMemo(():
    | MemberDefaults
    | undefined => {
    if (!editRuleId) {
      return undefined;
    }

    const members: RuleMembers =
      membersByRuleId[editRuleId] || emptyRuleMembers();

    return {
      onCallSchedules: members.scheduleJoins
        .filter((join: OnCallDutyPolicyEscalationRuleSchedule) => {
          return Boolean(join.onCallDutyPolicySchedule);
        })
        .map((join: OnCallDutyPolicyEscalationRuleSchedule) => {
          return {
            value: join.onCallDutyPolicySchedule!.id!.toString(),
            label:
              join.onCallDutyPolicySchedule!.name?.toString() ||
              "On-call schedule",
          };
        }),
      teams: members.teamJoins
        .filter((join: OnCallDutyPolicyEscalationRuleTeam) => {
          return Boolean(join.team);
        })
        .map((join: OnCallDutyPolicyEscalationRuleTeam) => {
          return {
            value: join.team!.id!.toString(),
            label: join.team!.name?.toString() || "Team",
          };
        }),
      users: members.userJoins
        .filter((join: OnCallDutyPolicyEscalationRuleUser) => {
          return Boolean(join.user);
        })
        .map((join: OnCallDutyPolicyEscalationRuleUser) => {
          return {
            value: join.user!.id!.toString(),
            label:
              join.user!.name?.toString() ||
              join.user!.email?.toString() ||
              "User",
          };
        }),
    };
  }, [editRuleId, membersByRuleId]);

  const createFormFields: Array<ModelField<OnCallDutyEscalationRule>> =
    useMemo((): Array<ModelField<OnCallDutyEscalationRule>> => {
      return buildRuleFormFields();
    }, []);

  const editFormFields: Array<ModelField<OnCallDutyEscalationRule>> =
    useMemo((): Array<ModelField<OnCallDutyEscalationRule>> => {
      return buildRuleFormFields(editMemberDefaults);
    }, [editMemberDefaults]);

  /*
   * The one onChange both modals share.
   *
   * The edit modal has always used it to keep editedMembersRef in step with the
   * form so an untouched save stays a no-op; the create modal had no onChange at
   * all. Both now also publish the user selection into state, which is what puts
   * the readiness warning on screen the moment somebody is picked. The ref is
   * still written directly rather than derived from that state because the save
   * path reads it synchronously inside onSuccess.
   */
  const onRuleFormChange: (
    values: FormValues<OnCallDutyEscalationRule>,
  ) => void = (values: FormValues<OnCallDutyEscalationRule>): void => {
    const currentValues: Record<string, unknown> = values as unknown as Record<
      string,
      unknown
    >;

    /*
     * Guarded on the ids actually changing. onChange fires for every keystroke
     * in every field of the form, and an unconditional setState would re-render
     * the modal on each one.
     */
    const publish: (
      selected: Array<SelectedOption>,
      setter: React.Dispatch<React.SetStateAction<Array<SelectedOption>>>,
    ) => void = (
      selected: Array<SelectedOption>,
      setter: React.Dispatch<React.SetStateAction<Array<SelectedOption>>>,
    ): void => {
      setter((previous: Array<SelectedOption>) => {
        const previousKey: string = previous
          .map((option: SelectedOption): string => {
            return option.id;
          })
          .join(",");
        const nextKey: string = selected
          .map((option: SelectedOption): string => {
            return option.id;
          })
          .join(",");

        return previousKey === nextKey ? previous : selected;
      });
    };

    /*
     * All three member fields are published into state now, not just Users.
     * Publishing only Users was the whole defect: teams and schedules went to
     * editedMembersRef, which is a ref and therefore invisible to the warning,
     * so adding an unreachable person the way people actually do it - through
     * the team they are in - warned about nothing at all.
     */
    if (currentValues["onCallSchedules"] !== undefined) {
      const selected: Array<SelectedOption> = toSelectedOptions(
        currentValues["onCallSchedules"],
      );

      editedMembersRef.current.onCallSchedules = toIds(selected);

      publish(selected, setSelectedScheduleOptions);
    }

    if (currentValues["teams"] !== undefined) {
      const selected: Array<SelectedOption> = toSelectedOptions(
        currentValues["teams"],
      );

      editedMembersRef.current.teams = toIds(selected);

      publish(selected, setSelectedTeamOptions);
    }

    if (currentValues["users"] !== undefined) {
      const selected: Array<SelectedOption> = toSelectedOptions(
        currentValues["users"],
      );

      editedMembersRef.current.users = toIds(selected);

      publish(selected, setSelectedUserOptions);
    }
  };

  // The warning block both modals hang under their form.
  const getAddResponderWarning: () => ReactElement = (): ReactElement => {
    return (
      <AddResponderWarning
        checks={respondersToCheck
          .map((responder: AddedResponder): AddedResponderCheck | undefined => {
            return responderChecks[responder.userId];
          })
          .filter(
            (
              check: AddedResponderCheck | undefined,
            ): check is AddedResponderCheck => {
              return Boolean(check);
            },
          )}
        groups={addedGroups}
        uncheckedCount={uncheckedResponderCount}
        reminders={reminderStatuses}
        onSendReminder={(userId: string) => {
          sendSetupReminder(userId).catch(() => {
            /*
             * sendSetupReminder writes every failure into the per-user reminder
             * status, which is what the block renders. Nothing is left to do.
             */
          });
        }}
      />
    );
  };

  /*
   * Flatten the loaded rules + join rows into the lightweight shape the
   * escalation summary renders. Recomputed on every render so the summary stays
   * in lockstep with add / edit / delete / reorder of the rules below it.
   */
  const summaryLevels: Array<EscalationLevelSummary> = rules.map(
    (rule: OnCallDutyEscalationRule, index: number): EscalationLevelSummary => {
      const members: RuleMembers =
        membersByRuleId[rule.id?.toString() || ""] || emptyRuleMembers();

      const responders: Array<EscalationResponder> = [];

      for (const join of members.scheduleJoins) {
        if (join.onCallDutyPolicySchedule) {
          responders.push({
            type: "schedule",
            label:
              join.onCallDutyPolicySchedule.name?.toString() ||
              "On-call schedule",
            isUncovered: !join.onCallDutyPolicySchedule.currentUserIdOnRoster,
          });
        }
      }
      for (const join of members.teamJoins) {
        if (join.team) {
          responders.push({
            type: "team",
            label: join.team.name?.toString() || "Team",
          });
        }
      }
      for (const join of members.userJoins) {
        if (join.user) {
          responders.push({
            type: "user",
            label:
              join.user.name?.toString() ||
              join.user.email?.toString() ||
              "User",
            /*
             * The id is what matches this chip to its readiness row. The label
             * alone would work right up until two responders share a display
             * name, at which point buildReadinessIndex refuses to guess and the
             * warning silently disappears from both of them — so it is carried
             * here even though the label is already present. The join query
             * selects user._id (see the userJoins ModelAPI.getList above), so
             * this is populated for every row that has a user at all.
             */
            userId: join.user.id ? join.user.id.toString() : undefined,
          });
        }
      }

      return {
        name: rule.name?.toString() || `Escalation Level ${index + 1}`,
        escalateAfterInMinutes: rule.escalateAfterInMinutes || 0,
        responders,
      };
    },
  );

  return (
    <Fragment>
      {!isLoading && !error && rules.length > 0 ? (
        <div className="mb-6">
          {/*
           * The policy id is what turns the readiness dots on: EscalationSummary
           * leaves its readiness hook idle without one, which is the state this
           * call site sat in — a summary that could never load readiness and
           * therefore could never draw a dot, on the one screen where an admin is
           * actually editing who gets paged.
           */}
          <EscalationSummary
            levels={summaryLevels}
            repeatEnabled={repeatEnabled}
            repeatCount={repeatCount}
            onCallDutyPolicyId={props.onCallDutyPolicyId}
          />
        </div>
      ) : (
        <></>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Escalation Rules
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
              Who gets notified when an incident is triggered, and how it climbs
              the ladder if no one responds.
            </p>
          </div>
          <div className="flex items-center gap-2 sm:shrink-0">
            <Button
              title="Refresh"
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                loadData().catch(() => {});
              }}
            />
            <Button
              title="Add Escalation Rule"
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.PRIMARY}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                return openCreateModal();
              }}
            />
          </div>
        </div>

        {/* Body */}
        <div className="p-6">{getBody()}</div>
      </div>

      {/* Create modal */}
      {showCreateModal ? (
        <ModelFormModal<OnCallDutyEscalationRule>
          title="Add Escalation Rule"
          name="Create Escalation Rule"
          description="Escalation rules determine who to contact, and when, once an incident is triggered."
          modalWidth={ModalWidth.Medium}
          modelType={OnCallDutyEscalationRule}
          submitButtonText="Create Rule"
          onClose={() => {
            return setShowCreateModal(false);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            loadData().catch(() => {});
          }}
          onBeforeCreate={(
            item: OnCallDutyEscalationRule,
          ): Promise<OnCallDutyEscalationRule> => {
            item.onCallDutyPolicyId = props.onCallDutyPolicyId;
            item.projectId = props.projectId;
            return Promise.resolve(item);
          }}
          footer={getAddResponderWarning()}
          formProps={{
            name: "Create Escalation Rule",
            modelType: OnCallDutyEscalationRule,
            id: "create-escalation-rule-form",
            formType: FormType.Create,
            steps: RULE_FORM_STEPS,
            fields: createFormFields,
            onChange: onRuleFormChange,
          }}
        />
      ) : (
        <></>
      )}

      {/* Edit modal */}
      {ruleToEdit ? (
        <ModelFormModal<OnCallDutyEscalationRule>
          title="Edit Escalation Rule"
          name="Edit Escalation Rule"
          description="Update the rule's details and change who it notifies."
          modalWidth={ModalWidth.Medium}
          modelType={OnCallDutyEscalationRule}
          modelIdToEdit={ruleToEdit.id!}
          submitButtonText="Save Changes"
          onClose={() => {
            return setRuleToEdit(null);
          }}
          onSuccess={() => {
            const editedRuleId: ObjectID | null | undefined = ruleToEdit?.id;
            setRuleToEdit(null);
            if (!editedRuleId) {
              loadData().catch(() => {});
              return;
            }
            // The rule's own fields are already saved; now reconcile responders.
            setIsLoading(true);
            syncEditedMembers(editedRuleId)
              .catch((err: Error) => {
                setError(API.getFriendlyMessage(err));
              })
              .finally(() => {
                loadData().catch(() => {});
              });
          }}
          footer={getAddResponderWarning()}
          formProps={{
            name: "Edit Escalation Rule",
            modelType: OnCallDutyEscalationRule,
            id: "edit-escalation-rule-form",
            formType: FormType.Update,
            steps: RULE_FORM_STEPS,
            fields: editFormFields,
            onChange: onRuleFormChange,
          }}
        />
      ) : (
        <></>
      )}

      {/* Delete confirmation */}
      {ruleToDelete ? (
        <ConfirmModal
          title="Delete Escalation Rule"
          /*
           * Counted, not gestured at. "Its notification targets will be removed"
           * is true of every escalation rule ever deleted and therefore says
           * nothing about this one; an admin cannot tell from it whether they
           * are about to remove a spare level or the only level that pages
           * anybody. Every clause of the replacement comes from rows already
           * loaded on this screen, so it costs no request and can always be
           * specific.
           */
          description={describeEscalationRuleDeletion(
            ruleToDelete.name?.toString() || "this escalation rule",
            getEscalationRuleDeletionImpact({
              ruleIdToDelete: ruleToDelete.id?.toString() || "",
              ruleIds: rules.map((rule: OnCallDutyEscalationRule): string => {
                return rule.id?.toString() || "";
              }),
              membersByRuleId: membersByRuleId,
            }),
          )}
          submitButtonText="Delete Rule"
          submitButtonType={ButtonStyleType.DANGER}
          closeButtonText="Cancel"
          isLoading={isDeleting}
          onSubmit={() => {
            confirmDelete().catch(() => {});
          }}
          onClose={() => {
            return setRuleToDelete(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default EscalationRules;
