import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  READINESS_STATUS_NOT_REACHABLE,
  READINESS_STATUS_PARTIALLY_READY,
  ReadinessCoverageCellWire,
  ReadinessDeliveryContext,
  ReadinessIndex,
  ReadinessMethodWire,
  UserReadinessWire,
  findReadinessForResponder,
  getCoverageCellLabel,
  getCoverageGaps,
  getStatusConsequence,
  getVerifiedMethods,
} from "../Readiness/ReadinessTypes";

/*
 * THE READINESS WARNING, ON THE PAGE RATHER THAN IN THE MODAL.
 *
 * The first version of this warning lived inside the add/edit escalation rule
 * modal: it looked up every responder the admin had just picked and printed a
 * red block under the form. It was wrong twice over.
 *
 * It was wrong about TIMING. The modal is open for the few seconds somebody is
 * building a level. Whether a responder can be paged is a property of that
 * responder's account, and it changes when they verify a phone or delete an
 * email - not when a rule is edited. A warning that is only visible while a
 * form is open is a warning that is absent for the 99.99% of the policy's life
 * when the mistake is actually costing pages, and present exactly once, at the
 * moment somebody is busy typing something else.
 *
 * It was wrong about SIZE. A modal footer is the least valuable space on the
 * screen and the block had to fit in it, so it grew a red slab per responder
 * with a button in it, pushed the Save button below the fold, and re-issued a
 * readiness lookup per keystroke-driven re-render.
 *
 * So it moved here: a LABEL on the escalation level it belongs to, which stays
 * on the page for as long as the problem does, and a modal behind it that has
 * the room to name every person, say what happens to their pages, and offer the
 * one fix an administrator can actually apply from here - a setup reminder to
 * the person themselves.
 *
 * The rules the label obeys are the ones this feature has obeyed everywhere:
 *
 *   - RED IS RESERVED for the state that actually loses pages. A responder with
 *     rule gaps on a project with the notification fallback ON still gets paged,
 *     just with default timing, and lighting up every level of every policy for
 *     that is how a warning stops being read. When the fallback is OFF those
 *     same gaps are dropped pages, and then - and only then - the label appears
 *     in amber.
 *   - AN UNKNOWN IS NOT AN ACCUSATION. A responder the readiness answer did not
 *     cover, or a team whose membership could not be read, renders grey and says
 *     "not checked" rather than either accusing them or - far worse - rendering
 *     nothing, which on this surface reads as "everybody here is fine".
 *   - NOTHING HERE BLOCKS ANYTHING. There is no gate on saving, no disabled
 *     button. It is a statement of fact with a fix attached.
 */

/*
 * ---------------------------------------------------------------------------
 * RESOLVING WHO A LEVEL ACTUALLY REACHES
 * ---------------------------------------------------------------------------
 *
 * An escalation level names users, teams and schedules. The readiness payload is
 * per-USER and says nothing about which level, team or layer a person was
 * reached through, so attributing a broken responder to the level that reaches
 * them means expanding the containers client-side.
 *
 * The expansion mirrors OnCallReadinessService.resolveResponders deliberately:
 *
 *   - a team expands to EVERY member row, with no hasAcceptedInvitation filter,
 *     because TeamMemberService.getUsersInTeam does not filter either. Somebody
 *     who never accepted their invite still gets paged, so they still count.
 *   - a schedule expands to its whole layer roster, not to whoever is on call at
 *     this instant. A person in next week's rotation who cannot be reached is a
 *     page that will be missed next week.
 *
 * Divergence from that expansion would put this label and the runtime out of
 * step, which is the failure the readiness feature exists to remove rather than
 * to reproduce.
 */
export type ResponderGroupKind = "team" | "schedule";

export interface ResponderGroupRef {
  kind: ResponderGroupKind;
  id: string;
  /*
   * The group's own name, off the join row. Empty is survivable - the copy falls
   * back to "a team" / "a schedule" - but never an id: an admin who reads
   * "cba1f3e2-... could not be checked" learns nothing they can act on.
   */
  label: string;
}

/** One person inside a group, or named directly on a level. */
export interface ResponderRef {
  userId: string;
  label: string;
}

/*
 * "unavailable" is a first-class state rather than an error to swallow. If a
 * team's membership cannot be read then the people inside it have NOT been
 * checked, and rendering nothing would make that team look exactly like a team
 * full of reachable people.
 */
export type ResponderGroupState = "resolving" | "resolved" | "unavailable";

export interface ResponderGroupResolution extends ResponderGroupRef {
  /** `team:<id>` or `schedule:<id>`. Unique across both kinds. */
  key: string;
  state: ResponderGroupState;
  /** The users inside. Empty unless `state` is "resolved". */
  members: Array<ResponderRef>;
}

export type ResponderGroupResolutions = Record<
  string,
  ResponderGroupResolution
>;

export const getResponderGroupKey: (
  kind: ResponderGroupKind,
  id: string,
) => string = (kind: ResponderGroupKind, id: string): string => {
  return `${kind}:${id}`;
};

// What to call a group in the copy. Never a bare id.
export const getResponderGroupName: (
  group: Pick<ResponderGroupRef, "kind" | "label">,
) => string = (group: Pick<ResponderGroupRef, "kind" | "label">): string => {
  if (group.label) {
    return group.label;
  }

  return group.kind === "team" ? "a team" : "a schedule";
};

/*
 * One entry per user. A schedule with the same person on three layers is one
 * person, not three identical rows.
 */
const dedupeResponders: (
  responders: Array<ResponderRef>,
) => Array<ResponderRef> = (
  responders: Array<ResponderRef>,
): Array<ResponderRef> => {
  const seen: Set<string> = new Set<string>();
  const unique: Array<ResponderRef> = [];

  for (const responder of responders) {
    if (!responder.userId || seen.has(responder.userId)) {
      continue;
    }

    seen.add(responder.userId);
    unique.push(responder);
  }

  return unique;
};

/*
 * A team's membership, read the way the runtime reads it.
 *
 * Never rejects. The caller is a render, and the only thing it could do with a
 * thrown error is drop the group - which renders as "everybody in that team is
 * fine". An "unavailable" resolution is what turns that into a visible "we could
 * not check" instead.
 */
export const fetchTeamMembers: (params: {
  group: ResponderGroupRef;
  projectId: ObjectID;
}) => Promise<ResponderGroupResolution> = async (params: {
  group: ResponderGroupRef;
  projectId: ObjectID;
}): Promise<ResponderGroupResolution> => {
  const resolution: ResponderGroupResolution = {
    key: getResponderGroupKey("team", params.group.id),
    kind: "team",
    id: params.group.id,
    label: params.group.label,
    state: "unavailable",
    members: [],
  };

  try {
    const members: ListResult<TeamMember> = await ModelAPI.getList<TeamMember>({
      modelType: TeamMember,
      query: {
        teamId: new ObjectID(params.group.id),
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
      members: dedupeResponders(
        members.data.map((member: TeamMember): ResponderRef => {
          return {
            userId: member.user?.id?.toString() || "",
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
  group: ResponderGroupRef;
  projectId: ObjectID;
}) => Promise<ResponderGroupResolution> = async (params: {
  group: ResponderGroupRef;
  projectId: ObjectID;
}): Promise<ResponderGroupResolution> => {
  const resolution: ResponderGroupResolution = {
    key: getResponderGroupKey("schedule", params.group.id),
    kind: "schedule",
    id: params.group.id,
    label: params.group.label,
    state: "unavailable",
    members: [],
  };

  try {
    const layerUsers: ListResult<OnCallDutyPolicyScheduleLayerUser> =
      await ModelAPI.getList<OnCallDutyPolicyScheduleLayerUser>({
        modelType: OnCallDutyPolicyScheduleLayerUser,
        query: {
          onCallDutyPolicyScheduleId: new ObjectID(params.group.id),
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
      members: dedupeResponders(
        layerUsers.data.map(
          (layerUser: OnCallDutyPolicyScheduleLayerUser): ResponderRef => {
            return {
              userId: layerUser.user?.id?.toString() || "",
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

export const fetchResponderGroup: (params: {
  group: ResponderGroupRef;
  projectId: ObjectID;
}) => Promise<ResponderGroupResolution> = (params: {
  group: ResponderGroupRef;
  projectId: ObjectID;
}): Promise<ResponderGroupResolution> => {
  return params.group.kind === "team"
    ? fetchTeamMembers(params)
    : fetchScheduleUsers(params);
};

/*
 * Expands every team and schedule on the policy exactly once.
 *
 * Each group is written into state as "resolving" BEFORE its request goes out,
 * which does two jobs: it puts the in-flight state on screen, and it stops this
 * effect re-issuing the same read when the resulting state change re-runs it.
 *
 * `reloadToken` is how a caller says "the underlying data just changed": team
 * membership can change while this page is open, and a stale roster would either
 * hide somebody newly added to the team or accuse the level of reaching somebody
 * who has since left it.
 */
export const useResponderGroups: (params: {
  groups: Array<ResponderGroupRef>;
  projectId: ObjectID;
  reloadToken?: number | undefined;
}) => ResponderGroupResolutions = (params: {
  groups: Array<ResponderGroupRef>;
  projectId: ObjectID;
  reloadToken?: number | undefined;
}): ResponderGroupResolutions => {
  const [resolutions, setResolutions] = useState<ResponderGroupResolutions>({});

  /*
   * Keyed on the joined id list rather than the array. Callers rebuild the array
   * on every render (it is derived from loaded join rows), and a new array
   * identity would restart every expansion on every render.
   */
  const groupsKey: string = params.groups
    .map((group: ResponderGroupRef): string => {
      return getResponderGroupKey(group.kind, group.id);
    })
    .join(",");

  const projectIdString: string = params.projectId.toString();
  const reloadToken: number = params.reloadToken || 0;

  /*
   * The latest groups, read inside the effect rather than depended on. The
   * labels can change without the key changing (a team renamed), and that is not
   * worth re-reading a roster for.
   */
  const groupsRef: React.MutableRefObject<Array<ResponderGroupRef>> = useRef<
    Array<ResponderGroupRef>
  >(params.groups);
  groupsRef.current = params.groups;

  const isFirstRunRef: React.MutableRefObject<boolean> = useRef<boolean>(true);

  useEffect(() => {
    /*
     * Skipped on mount so a first render does not throw away the empty cache it
     * has not filled yet - which would be harmless but would also fire a second
     * render for nothing.
     */
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      return;
    }

    setResolutions({});
  }, [reloadToken, projectIdString]);

  useEffect(() => {
    const unresolved: Array<ResponderGroupRef> = groupsRef.current.filter(
      (group: ResponderGroupRef): boolean => {
        return (
          Boolean(group.id) &&
          !resolutions[getResponderGroupKey(group.kind, group.id)]
        );
      },
    );

    if (unresolved.length === 0) {
      return;
    }

    setResolutions((previous: ResponderGroupResolutions) => {
      const next: ResponderGroupResolutions = { ...previous };

      for (const group of unresolved) {
        const key: string = getResponderGroupKey(group.kind, group.id);

        next[key] = {
          key: key,
          kind: group.kind,
          id: group.id,
          label: group.label,
          state: "resolving",
          members: [],
        };
      }

      return next;
    });

    for (const group of unresolved) {
      const key: string = getResponderGroupKey(group.kind, group.id);

      fetchResponderGroup({
        group: group,
        projectId: new ObjectID(projectIdString),
      })
        .then((resolution: ResponderGroupResolution) => {
          setResolutions((previous: ResponderGroupResolutions) => {
            return { ...previous, [key]: resolution };
          });
        })
        .catch(() => {
          /*
           * Both fetchers route every failure into an "unavailable" resolution
           * and do not reject. The catch exists so a fire-and-forget promise
           * cannot log an unhandled rejection on a page that is behaving
           * correctly.
           */
        });
    }
  }, [groupsKey, projectIdString, resolutions]);

  return resolutions;
};

/*
 * ---------------------------------------------------------------------------
 * THE SETUP REMINDER
 * ---------------------------------------------------------------------------
 *
 * The one fix an administrator can apply from this screen. A notification method
 * lives on the responder's own account and only they can verify it, so telling
 * them IS the fix; the alternative is remembering to message somebody after
 * closing the page.
 *
 * The endpoint takes a LIST of user ids and answers with one outcome per user
 * rather than a bare success, and this surface reads those outcomes rather than
 * collapsing them into a tick. A reminder that was throttled, or that went to
 * somebody who is not a member of the project, has not reached anybody, and an
 * admin who is shown a tick for it leaves believing a person was told.
 */
const SETUP_REMINDER_ROUTE: string = "/on-call-readiness/send-setup-reminder";

/* The outcome the server reports for a user it actually mailed. */
const SETUP_REMINDER_OUTCOME_SENT: string = "Sent";

/*
 * WHAT A FAILED REQUEST IS ALLOWED TO CLAIM.
 *
 * "No reminder was sent" is not knowable from an arbitrary failure. Every path
 * that refuses this route - body validation, the permission gate, and the
 * service's own pre-flight checks - runs BEFORE any mail is sent, and
 * OnCallSetupReminderService reports per-recipient failures as outcomes inside a
 * 200. So a status code from the API application itself is proof nothing went
 * out, and only those codes earn the definite sentence.
 *
 * Deliberately absent: 500/502/503/504 (a proxy or a restart, possibly after the
 * mail left), 408 and transport failures (the request may have completed at the
 * server), and 429 (an edge rate limiter and the application are
 * indistinguishable from here). Being wrong in that direction is the expensive
 * one: it is how somebody presses the button again and reminds people twice.
 */
const DEFINITELY_NOT_SENT_STATUS_CODES: Array<number> = [400, 401, 403, 422];

/*
 * "skipped", "failed" and "unknown" are deliberately three states rather than
 * one.
 *
 * A throttled reminder did not go out and nothing is broken. A reminder for
 * somebody who is not a member of this project did not go out and something is.
 * A request that died mid-flight may have sent the mail and may not have, and
 * the only honest thing to render for it is that we do not know - a reader told
 * "not sent" presses the button again.
 */
export type SetupReminderState =
  | "idle"
  | "sending"
  | "sent"
  | "skipped"
  | "failed"
  | "unknown";

export interface SetupReminderStatus {
  state: SetupReminderState;
  /* The server's own sentence. Never replaced with a generic apology. */
  message: string;
}

export type SetupReminderStatuses = Record<string, SetupReminderStatus>;

/*
 * Turns the reminder endpoint's per-user array into a status per user asked
 * about.
 *
 * A 200 whose `results` say nothing about a user we asked about is NOT a send,
 * and it is not a definite failure either - it is the one shape that could
 * quietly become a green tick over a reminder that never left the building, so
 * it is reported as "unknown" with the only honest sentence available.
 */
export const readSetupReminderStatuses: (
  json: JSONObject,
  userIds: Array<string>,
) => SetupReminderStatuses = (
  json: JSONObject,
  userIds: Array<string>,
): SetupReminderStatuses => {
  const rawResults: unknown = json["results"];
  const results: Array<unknown> = Array.isArray(rawResults) ? rawResults : [];

  const byUserId: Record<string, SetupReminderStatus> = {};

  for (const entry of results) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const result: Record<string, unknown> = entry as Record<string, unknown>;
    const userId: string = String(result["userId"] || "");

    if (!userId) {
      continue;
    }

    const outcome: string = String(result["outcome"] || "");
    const message: string = String(result["message"] || "");

    if (outcome === SETUP_REMINDER_OUTCOME_SENT) {
      byUserId[userId] = { state: "sent", message: message };
      continue;
    }

    /*
     * Every non-Sent outcome carries the server's own explanation and it is
     * rendered verbatim rather than mapped onto local copy. There are five of
     * them today and a build that has never heard of the sixth still shows the
     * reader a true sentence about what happened.
     */
    byUserId[userId] = {
      state: outcome === "Failed" ? "failed" : "skipped",
      message:
        message || `The server reported "${outcome}" without an explanation.`,
    };
  }

  const statuses: SetupReminderStatuses = {};

  for (const userId of userIds) {
    statuses[userId] = byUserId[userId] || {
      state: "unknown",
      message: "The server did not report an outcome for this reminder.",
    };
  }

  return statuses;
};

/*
 * Sends reminders and reports what the server said happened to each one.
 *
 * There is no optimistic "sent" anywhere in here. The point of the control is
 * that an admin can leave this page believing specific people were told, and
 * claiming that on the strength of a request whose answer we have not read is
 * the failure the button on the readiness page spent two phases disabled to
 * avoid.
 */
export const requestSetupReminders: (
  userIds: Array<string>,
) => Promise<SetupReminderStatuses> = async (
  userIds: Array<string>,
): Promise<SetupReminderStatuses> => {
  try {
    const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
      SETUP_REMINDER_ROUTE,
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: url,
        data: { userIds: userIds },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse || response.isFailure()) {
      throw response;
    }

    /*
     * A 200 is not the answer; the per-user outcomes inside it are. The endpoint
     * answers 200 for a batch in which nothing was sent at all.
     */
    return readSetupReminderStatuses(response.data, userIds);
  } catch (err) {
    const message: string = API.getFriendlyMessage(err);

    /*
     * API.post RESOLVES with an HTTPErrorResponse for a non-2xx rather than
     * throwing, and the throw above re-raises it, so both shapes arrive here.
     * Anything that is not an HTTP response at all - a thrown TypeError, a
     * dropped connection - carries no status code and is unknown by definition.
     */
    const isNothingSentCertain: boolean =
      err instanceof HTTPResponse &&
      DEFINITELY_NOT_SENT_STATUS_CODES.includes(err.statusCode);

    const statuses: SetupReminderStatuses = {};

    for (const userId of userIds) {
      statuses[userId] = {
        state: isNothingSentCertain ? "failed" : "unknown",
        message: message,
      };
    }

    return statuses;
  }
};

export interface SetupReminderController {
  statuses: SetupReminderStatuses;
  isSending: boolean;
  send: (userIds: Array<string>) => void;
}

export const useSetupReminders: () => SetupReminderController =
  (): SetupReminderController => {
    const [statuses, setStatuses] = useState<SetupReminderStatuses>({});
    const [inFlight, setInFlight] = useState<number>(0);

    const send: (userIds: Array<string>) => void = useCallback(
      (userIds: Array<string>): void => {
        const toSend: Array<string> = userIds.filter(
          (userId: string): boolean => {
            return Boolean(userId);
          },
        );

        if (toSend.length === 0) {
          return;
        }

        setInFlight((current: number) => {
          return current + 1;
        });

        setStatuses((previous: SetupReminderStatuses) => {
          const next: SetupReminderStatuses = { ...previous };

          for (const userId of toSend) {
            next[userId] = { state: "sending", message: "" };
          }

          return next;
        });

        requestSetupReminders(toSend)
          .then((result: SetupReminderStatuses) => {
            setStatuses((previous: SetupReminderStatuses) => {
              return { ...previous, ...result };
            });
          })
          .catch(() => {
            /*
             * requestSetupReminders routes every failure into a per-user status
             * and does not reject; this catch only stops an unhandled rejection.
             */
          })
          .finally(() => {
            setInFlight((current: number) => {
              return Math.max(0, current - 1);
            });
          });
      },
      [],
    );

    return {
      statuses: statuses,
      isSending: inFlight > 0,
      send: send,
    };
  };

/*
 * ---------------------------------------------------------------------------
 * WHAT ONE ESCALATION LEVEL LOOKS LIKE
 * ---------------------------------------------------------------------------
 */

/** How a level reaches a person. A person reached two ways carries both. */
export interface ResponderVia {
  kind: "direct" | ResponderGroupKind;
  /* The group's name. Empty for a direct pick, where there is no container. */
  label: string;
}

export type ResponderIssueKind = "unreachable" | "gap" | "unchecked";

export interface ResponderIssue {
  userId: string;
  name: string;
  kind: ResponderIssueKind;
  /* Null only for "unchecked": there is no row to render for that person. */
  readiness: UserReadinessWire | null;
  via: Array<ResponderVia>;
}

export interface RuleReadinessReport {
  /** Cannot be paged at all. The state that actually loses pages. */
  unreachable: Array<ResponderIssue>;
  /** Reachable, but with at least one severity or rule type uncovered. */
  gaps: Array<ResponderIssue>;
  /** On this level, and outside the readiness answer this page holds. */
  unchecked: Array<ResponderIssue>;
  /** Teams and schedules whose membership could not be read at all. */
  unreadableGroups: Array<ResponderGroupRef>;
  /** True while at least one group is still being expanded. */
  isResolving: boolean;
  /** Distinct people this level is known to reach. */
  responderCount: number;
  /** How many of those have a readiness answer. */
  checkedCount: number;
}

export const EMPTY_RULE_READINESS_REPORT: RuleReadinessReport = {
  unreachable: [],
  gaps: [],
  unchecked: [],
  unreadableGroups: [],
  isResolving: false,
  responderCount: 0,
  checkedCount: 0,
};

/*
 * Everybody one level reaches, and what is wrong with them.
 *
 * Three rules decide what comes out:
 *
 *   1. A user is reported ONCE, however many doors they came in by, and every
 *      door is recorded on them. An admin who removes somebody from a team and
 *      finds them still being paged through a schedule has been failed by a
 *      surface that only named the first route it found.
 *   2. A group that has not resolved contributes NOBODY - not silently, but by
 *      being named in `unreadableGroups` (or by setting `isResolving`), because
 *      the alternative renders a team of unknown people exactly like a team of
 *      reachable ones.
 *   3. A responder with no readiness row is "unchecked" only when the answer is
 *      known to be incomplete. On a complete answer the server has simply not
 *      resolved them as a responder of this policy, and inventing a warning out
 *      of that would put a permanent grey badge on levels that are fine.
 */
export const buildRuleReadinessReport: (params: {
  directUsers: Array<ResponderRef>;
  groups: Array<ResponderGroupRef>;
  resolutions: ResponderGroupResolutions;
  index: ReadinessIndex;
  isTruncated: boolean;
}) => RuleReadinessReport = (params: {
  directUsers: Array<ResponderRef>;
  groups: Array<ResponderGroupRef>;
  resolutions: ResponderGroupResolutions;
  index: ReadinessIndex;
  isTruncated: boolean;
}): RuleReadinessReport => {
  interface Reached {
    userId: string;
    name: string;
    via: Array<ResponderVia>;
  }

  const reachedByUserId: Map<string, Reached> = new Map<string, Reached>();

  const reach: (responder: ResponderRef, via: ResponderVia) => void = (
    responder: ResponderRef,
    via: ResponderVia,
  ): void => {
    if (!responder.userId) {
      return;
    }

    const existing: Reached | undefined = reachedByUserId.get(responder.userId);

    if (!existing) {
      reachedByUserId.set(responder.userId, {
        userId: responder.userId,
        name: responder.label,
        via: [via],
      });

      return;
    }

    /* A better name from a second route is still a better name. */
    if (!existing.name && responder.label) {
      existing.name = responder.label;
    }

    const isDuplicateRoute: boolean = existing.via.some(
      (candidate: ResponderVia): boolean => {
        return candidate.kind === via.kind && candidate.label === via.label;
      },
    );

    if (!isDuplicateRoute) {
      existing.via.push(via);
    }
  };

  for (const user of params.directUsers) {
    reach(user, { kind: "direct", label: "" });
  }

  const unreadableGroups: Array<ResponderGroupRef> = [];
  let isResolving: boolean = false;

  for (const group of params.groups) {
    const resolution: ResponderGroupResolution | undefined =
      params.resolutions[getResponderGroupKey(group.kind, group.id)];

    if (!resolution || resolution.state === "resolving") {
      isResolving = true;
      continue;
    }

    if (resolution.state === "unavailable") {
      unreadableGroups.push(group);
      continue;
    }

    for (const member of resolution.members) {
      reach(member, { kind: group.kind, label: group.label });
    }
  }

  const unreachable: Array<ResponderIssue> = [];
  const gaps: Array<ResponderIssue> = [];
  const unchecked: Array<ResponderIssue> = [];
  let checkedCount: number = 0;

  for (const reached of Array.from(reachedByUserId.values())) {
    const readiness: UserReadinessWire | null = findReadinessForResponder(
      params.index,
      { userId: reached.userId, label: reached.name },
    );

    if (!readiness) {
      if (params.isTruncated) {
        unchecked.push({
          userId: reached.userId,
          name: reached.name || "This responder",
          kind: "unchecked",
          readiness: null,
          via: reached.via,
        });
      }

      continue;
    }

    checkedCount++;

    /*
     * The readiness row's own name wins over the join row's: it is the name the
     * rest of the readiness feature uses, and a person renamed since the join
     * row was written should be talked about by their current name.
     */
    const issue: ResponderIssue = {
      userId: reached.userId,
      name: readiness.userName || readiness.userEmail || reached.name,
      kind: "unreachable",
      readiness: readiness,
      via: reached.via,
    };

    if (readiness.status === READINESS_STATUS_NOT_REACHABLE) {
      unreachable.push(issue);
      continue;
    }

    if (readiness.status === READINESS_STATUS_PARTIALLY_READY) {
      gaps.push({ ...issue, kind: "gap" });
    }
  }

  const byName: (a: ResponderIssue, b: ResponderIssue) => number = (
    a: ResponderIssue,
    b: ResponderIssue,
  ): number => {
    return a.name.localeCompare(b.name);
  };

  return {
    unreachable: unreachable.sort(byName),
    gaps: gaps.sort(byName),
    unchecked: unchecked.sort(byName),
    unreadableGroups: unreadableGroups,
    isResolving: isResolving,
    responderCount: reachedByUserId.size,
    checkedCount: checkedCount,
  };
};

/*
 * How loud this level's label is allowed to be.
 *
 * "critical" is the state that loses pages. "warning" exists for exactly one
 * situation: a project with the notification fallback switched off, where a rule
 * gap is not a late page but no page at all. On a project with the fallback on -
 * the default, and almost every project - a gap still reaches the responder, and
 * a level that lights up for it would light up nearly always.
 */
export type RuleWarningLevel = "critical" | "warning" | "unknown" | "none";

export const getRuleWarningLevel: (
  report: RuleReadinessReport,
  delivery: ReadinessDeliveryContext,
) => RuleWarningLevel = (
  report: RuleReadinessReport,
  delivery: ReadinessDeliveryContext,
): RuleWarningLevel => {
  if (report.unreachable.length > 0) {
    return "critical";
  }

  if (!delivery.isFallbackEnabled && report.gaps.length > 0) {
    return "warning";
  }

  if (report.unchecked.length > 0 || report.unreadableGroups.length > 0) {
    return "unknown";
  }

  return "none";
};

// The pill's own words. Short enough to sit beside "Notifies" and still true.
export const getRuleWarningLabel: (
  report: RuleReadinessReport,
  delivery: ReadinessDeliveryContext,
) => string = (
  report: RuleReadinessReport,
  delivery: ReadinessDeliveryContext,
): string => {
  const level: RuleWarningLevel = getRuleWarningLevel(report, delivery);

  if (level === "critical") {
    return report.unreachable.length === 1
      ? "1 person can't be paged"
      : `${report.unreachable.length} people can't be paged`;
  }

  if (level === "warning") {
    return report.gaps.length === 1
      ? "1 person loses pages"
      : `${report.gaps.length} people lose pages`;
  }

  if (level === "unknown") {
    const uncheckedCount: number =
      report.unchecked.length + report.unreadableGroups.length;

    return uncheckedCount === 1
      ? "1 responder not checked"
      : `${uncheckedCount} responders not checked`;
  }

  return "";
};

/*
 * Why this person is being talked about at all.
 *
 * An admin who added the Payments team did not add Alex; they have to be told
 * where Alex came from, or a warning naming Alex looks like it is about somebody
 * else's change - and, more practically, removing Alex from the level means
 * finding the door they came in by.
 */
export const describeResponderVia: (via: Array<ResponderVia>) => string = (
  via: Array<ResponderVia>,
): string => {
  const parts: Array<string> = via.map((entry: ResponderVia): string => {
    if (entry.kind === "direct") {
      return "directly";
    }

    const name: string = getResponderGroupName({
      kind: entry.kind,
      label: entry.label,
    });

    return entry.kind === "team"
      ? `through the ${name} team`
      : `through the ${name} schedule`;
  });

  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return `Reached ${parts[0]}.`;
  }

  return `Reached ${parts.slice(0, -1).join(", ")} and ${
    parts[parts.length - 1]
  }.`;
};

/*
 * ---------------------------------------------------------------------------
 * THE LABEL
 * ---------------------------------------------------------------------------
 */

export interface RuleReadinessLabelProps {
  report: RuleReadinessReport;
  delivery: ReadinessDeliveryContext;
  /** The level this label belongs to, for the accessible name only. */
  ruleName: string;
  onClick: () => void;
}

const LABEL_TONES: Record<
  Exclude<RuleWarningLevel, "none">,
  { className: string; iconClassName: string; icon: IconProp }
> = {
  critical: {
    className:
      "bg-red-50 text-red-700 ring-red-200 hover:bg-red-100 hover:ring-red-300",
    iconClassName: "text-red-500",
    icon: IconProp.Alert,
  },
  warning: {
    className:
      "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100 hover:ring-amber-300",
    iconClassName: "text-amber-500",
    icon: IconProp.Alert,
  },
  unknown: {
    className:
      "bg-gray-50 text-gray-600 ring-gray-200 hover:bg-gray-100 hover:ring-gray-300",
    iconClassName: "text-gray-400",
    icon: IconProp.Info,
  },
};

/*
 * A button, not a badge with a tooltip.
 *
 * The thing an administrator needs after reading "2 people can't be paged" is
 * WHO, and a tooltip cannot hold two names, two consequence sentences and two
 * reminder buttons. It also cannot be reached from a keyboard, cannot be read by
 * a screen reader in any useful order, and vanishes the moment the pointer moves
 * towards it.
 */
export const RuleReadinessLabel: FunctionComponent<RuleReadinessLabelProps> = (
  props: RuleReadinessLabelProps,
): ReactElement => {
  const level: RuleWarningLevel = getRuleWarningLevel(
    props.report,
    props.delivery,
  );

  if (level === "none") {
    return <></>;
  }

  const tone: { className: string; iconClassName: string; icon: IconProp } =
    LABEL_TONES[level];
  const text: string = getRuleWarningLabel(props.report, props.delivery);

  return (
    <button
      type="button"
      data-testid="rule-readiness-label"
      data-warning-level={level}
      aria-label={`${text} on ${props.ruleName}. See who, and send a setup reminder.`}
      onClick={props.onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-colors ${tone.className}`}
    >
      <Icon icon={tone.icon} className={`h-3.5 w-3.5 ${tone.iconClassName}`} />
      {text}
      <Icon icon={IconProp.ChevronRight} className="h-3 w-3 opacity-70" />
    </button>
  );
};

/*
 * ---------------------------------------------------------------------------
 * THE DETAIL BEHIND IT
 * ---------------------------------------------------------------------------
 */

const getFirstName: (name: string) => string = (name: string): string => {
  return name.split(" ")[0] || name;
};

/* The reminder row for one responder: the offer, or what happened to it. */
const getReminderRow: (params: {
  issue: ResponderIssue;
  status: SetupReminderStatus;
  onSend: (userId: string) => void;
}) => ReactElement = (params: {
  issue: ResponderIssue;
  status: SetupReminderStatus;
  onSend: (userId: string) => void;
}): ReactElement => {
  const name: string = params.issue.name;

  /*
   * The one terminal state. Nothing else here claims a person was told, because
   * nothing else here means one was.
   */
  if (params.status.state === "sent") {
    /*
     * A span rather than a paragraph, because Icon renders a <div>: an HTML
     * parser closes an open <p> the moment it meets one, which leaves the icon
     * and the sentence as siblings OUTSIDE the green pill anywhere this markup
     * is parsed from a string rather than built by React.
     */
    return (
      <span
        data-testid="setup-reminder-sent"
        className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
      >
        <Icon icon={IconProp.CheckCircle} className="h-3.5 w-3.5" />
        Setup reminder sent to {name}.
      </span>
    );
  }

  return (
    <div className="mt-2.5">
      <Button
        title={
          params.status.state === "sending"
            ? "Sending..."
            : "Send setup reminder"
        }
        icon={IconProp.SendMessage}
        buttonStyle={ButtonStyleType.OUTLINE}
        buttonSize={ButtonSize.Small}
        disabled={params.status.state === "sending"}
        onClick={() => {
          params.onSend(params.issue.userId);
        }}
      />

      {params.status.state === "skipped" || params.status.state === "failed" ? (
        /*
         * The server's sentence, and then the fallback that is always available:
         * this person can be asked directly. A warning whose only offered fix has
         * just failed has to leave the reader with something they can still do.
         */
        <p
          data-testid="setup-reminder-not-sent"
          className="mt-2 text-xs font-medium leading-relaxed text-red-700"
        >
          No reminder was sent. {params.status.message} Ask {name} to finish
          their notification setup in User Settings.
        </p>
      ) : (
        <></>
      )}

      {params.status.state === "unknown" ? (
        /*
         * The state that exists so nobody presses the button twice. The request
         * died somewhere we cannot see, which is not the same as the mail not
         * having left.
         */
        <p
          data-testid="setup-reminder-unknown"
          className="mt-2 text-xs font-medium leading-relaxed text-amber-800"
        >
          We could not confirm whether a reminder reached {name}.{" "}
          {params.status.message} Check with {getFirstName(name)} before sending
          another.
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

const getMethodSummary: (readiness: UserReadinessWire) => ReactElement = (
  readiness: UserReadinessWire,
): ReactElement => {
  const verified: Array<ReadinessMethodWire> = getVerifiedMethods(readiness);

  if (verified.length === 0) {
    return (
      <p className="mt-1.5 text-xs text-gray-500">
        No verified notification method on their account.
      </p>
    );
  }

  return (
    <p className="mt-1.5 text-xs text-gray-500">
      Verified:{" "}
      {verified
        .map((method: ReadinessMethodWire): string => {
          return `${method.methodType} ${method.maskedIdentifier}`.trim();
        })
        .join(", ")}
      .
    </p>
  );
};

const getGapSummary: (readiness: UserReadinessWire) => ReactElement = (
  readiness: UserReadinessWire,
): ReactElement => {
  const gaps: Array<ReadinessCoverageCellWire> = getCoverageGaps(readiness);

  if (gaps.length === 0) {
    return <></>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {gaps.map(
        (cell: ReadinessCoverageCellWire, index: number): ReactElement => {
          return (
            <span
              key={`gap-${index}`}
              className="inline-flex items-center rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
            >
              {getCoverageCellLabel(cell)}
            </span>
          );
        },
      )}
    </div>
  );
};

export interface RuleReadinessDetailsProps {
  ruleName: string;
  report: RuleReadinessReport;
  delivery: ReadinessDeliveryContext;
  reminders: SetupReminderStatuses;
  onSendReminder: (userIds: Array<string>) => void;
  isSendingReminders: boolean;
  onClose: () => void;
}

/*
 * Everybody this level cannot page, why, and the one fix that can be applied
 * from here.
 *
 * Presentational on purpose - it holds no fetching and no state - because the
 * properties worth testing are the ones a reader sees: that every affected
 * person is NAMED, that the consequence for their pages is STATED, that where
 * they came from is stated too, that a reminder reports what the server said
 * rather than that a request was made, and that an incomplete answer admits it.
 */
export const RuleReadinessDetails: FunctionComponent<
  RuleReadinessDetailsProps
> = (props: RuleReadinessDetailsProps): ReactElement => {
  const report: RuleReadinessReport = props.report;

  /*
   * Everyone who has not already been told. The batch control exists because a
   * level that reaches a whole team of unverified accounts is one click, not
   * eight - and it must never re-send to somebody who has just been sent to.
   *
   * A send in flight is deliberately still "remindable" here: excluding it would
   * empty this list mid-send and take the button off the screen while the thing
   * it started is still running. It is disabled instead, which is the difference
   * between "working" and "gone".
   */
  const remindableUserIds: Array<string> = report.unreachable
    .filter((issue: ResponderIssue): boolean => {
      const status: SetupReminderStatus | undefined =
        props.reminders[issue.userId];

      return !status || status.state !== "sent";
    })
    .map((issue: ResponderIssue): string => {
      return issue.userId;
    });

  const getIssueRow: (params: {
    issue: ResponderIssue;
    tone: "critical" | "warning";
  }) => ReactElement = (params: {
    issue: ResponderIssue;
    tone: "critical" | "warning";
  }): ReactElement => {
    const issue: ResponderIssue = params.issue;
    const isCritical: boolean = params.tone === "critical";

    return (
      <div
        key={issue.userId}
        data-testid={
          isCritical ? "rule-responder-unreachable" : "rule-responder-gap"
        }
        className={`rounded-xl p-3.5 ring-1 ring-inset ${
          isCritical
            ? "bg-red-50/70 ring-red-200"
            : "bg-amber-50/70 ring-amber-200"
        }`}
      >
        <div className="flex items-start gap-2.5">
          <Icon
            icon={isCritical ? IconProp.BellSlash : IconProp.Alert}
            className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
              isCritical ? "text-red-500" : "text-amber-500"
            }`}
          />
          <div className="min-w-0 flex-1">
            <p
              className={`text-sm font-semibold ${
                isCritical ? "text-red-900" : "text-amber-900"
              }`}
            >
              {issue.name}
            </p>
            <p
              className={`mt-0.5 text-sm leading-relaxed ${
                isCritical ? "text-red-800" : "text-amber-900"
              }`}
            >
              {issue.readiness
                ? getStatusConsequence(
                    issue.readiness,
                    props.delivery,
                    issue.name,
                  )
                : ""}
            </p>
            {issue.via.length > 0 ? (
              <p className="mt-1 text-xs text-gray-600">
                {describeResponderVia(issue.via)}
              </p>
            ) : (
              <></>
            )}
            {issue.readiness && isCritical ? (
              getMethodSummary(issue.readiness)
            ) : (
              <></>
            )}
            {issue.readiness && !isCritical ? (
              getGapSummary(issue.readiness)
            ) : (
              <></>
            )}
            {isCritical
              ? getReminderRow({
                  issue: issue,
                  status: props.reminders[issue.userId] || {
                    state: "idle",
                    message: "",
                  },
                  onSend: (userId: string) => {
                    props.onSendReminder([userId]);
                  },
                })
              : null}
          </div>
        </div>
      </div>
    );
  };

  const getUncheckedSection: () => ReactElement = (): ReactElement => {
    if (
      report.unchecked.length === 0 &&
      report.unreadableGroups.length === 0 &&
      !report.isResolving
    ) {
      return <></>;
    }

    return (
      <div
        data-testid="rule-responder-unchecked"
        className="rounded-xl bg-gray-50 p-3.5 ring-1 ring-inset ring-gray-200"
      >
        <div className="flex items-start gap-2.5">
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-800">
              {report.isResolving
                ? "Still checking who this level reaches"
                : "Not checked"}
            </p>

            {report.unchecked.length > 0 ? (
              <p className="mt-0.5 text-sm leading-relaxed text-gray-600">
                The readiness answer for this policy does not cover{" "}
                {report.unchecked
                  .map((issue: ResponderIssue): string => {
                    return issue.name;
                  })
                  .join(", ")}
                , so they are unknown rather than ready. Open On-Call &gt;
                Readiness for the full list.
              </p>
            ) : (
              <></>
            )}

            {report.unreadableGroups.map(
              (group: ResponderGroupRef): ReactElement => {
                return (
                  <p
                    key={getResponderGroupKey(group.kind, group.id)}
                    className="mt-0.5 text-sm leading-relaxed text-gray-600"
                  >
                    We could not read who is in {getResponderGroupName(group)},
                    so nobody on that {group.kind} has been checked.
                  </p>
                );
              },
            )}

            {report.isResolving && report.unchecked.length === 0 ? (
              <p className="mt-0.5 text-sm leading-relaxed text-gray-600">
                Reading the teams and schedules this level notifies.
              </p>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>
    );
  };

  const isEverythingFine: boolean =
    report.unreachable.length === 0 &&
    report.gaps.length === 0 &&
    report.unchecked.length === 0 &&
    report.unreadableGroups.length === 0 &&
    !report.isResolving;

  return (
    <Modal
      title={props.ruleName}
      description={`Whether the ${report.responderCount} ${
        report.responderCount === 1 ? "person" : "people"
      } this level notifies can actually be paged.`}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      closeButtonText="Close"
      submitButtonText={
        remindableUserIds.length > 1
          ? `Remind all ${remindableUserIds.length}`
          : undefined
      }
      isLoading={props.isSendingReminders}
      disableSubmitButton={props.isSendingReminders}
      onSubmit={
        remindableUserIds.length > 1
          ? () => {
              props.onSendReminder(remindableUserIds);
            }
          : undefined
      }
    >
      <div className="space-y-4" data-testid="rule-readiness-details">
        {report.unreachable.length > 0 ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Cannot be paged
              </span>
              <span className="text-xs font-medium tabular-nums text-gray-500">
                {report.unreachable.length} of {report.responderCount}
              </span>
            </div>
            <div className="space-y-2.5">
              {report.unreachable.map((issue: ResponderIssue): ReactElement => {
                return getIssueRow({ issue: issue, tone: "critical" });
              })}
            </div>
            {/*
             * Said once, under the list, rather than repeated on every row: a
             * notification method lives on the responder's own account and only
             * they can verify it, which is precisely why the offered fix is a
             * nudge rather than an edit.
             */}
            <p className="mt-2.5 text-xs leading-relaxed text-gray-500">
              Only these people can add and verify a notification method on
              their own account, so the fix from here is a reminder rather than
              an edit.
            </p>
          </div>
        ) : (
          <></>
        )}

        {report.gaps.length > 0 ? (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              {props.delivery.isFallbackEnabled
                ? "Paged, but not the way they asked"
                : "Pages dropped - no fallback in this project"}
            </div>
            <div className="space-y-2.5">
              {report.gaps.map((issue: ResponderIssue): ReactElement => {
                return getIssueRow({ issue: issue, tone: "warning" });
              })}
            </div>
          </div>
        ) : (
          <></>
        )}

        {getUncheckedSection()}

        {isEverythingFine ? (
          <div
            data-testid="rule-readiness-all-clear"
            className="rounded-xl bg-emerald-50 p-3.5 ring-1 ring-inset ring-emerald-200"
          >
            <div className="flex items-start gap-2.5">
              <Icon
                icon={IconProp.CheckCircle}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500"
              />
              <p className="text-sm leading-relaxed text-emerald-800">
                Everyone this level notifies has a verified notification method
                and a rule for every severity and rule type.
              </p>
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};
