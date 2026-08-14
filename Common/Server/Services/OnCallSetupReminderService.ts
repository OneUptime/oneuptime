import DatabaseConfig from "../DatabaseConfig";
import GlobalCache from "../Infrastructure/GlobalCache";
import BaseService from "./BaseService";
import MailService from "./MailService";
import OnCallReadinessService, {
  ReadinessCoverageCell,
  ReadinessStatus,
  UserReadiness,
} from "./OnCallReadinessService";
import ProjectService from "./ProjectService";
import TeamMemberService from "./TeamMemberService";
import InProcessMemo from "../Utils/InProcessMemo";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import Includes from "../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../Types/ObjectID";
import Project from "../../Models/DatabaseModels/Project";
import TeamMember from "../../Models/DatabaseModels/TeamMember";

/*
 * "Ask these responders to finish their notification setup" - the one action on
 * the readiness surfaces that reaches outside the product and touches a human.
 *
 * Phases 1-3 either rescue a page that was already going to be dropped or report
 * a gap after it exists. This is the only piece that tries to stop the gap being
 * there at all, and it works by mail because the fix is not the admin's to make:
 * notification methods and notification rules live on the responder's own user
 * record, and nobody - not an owner, not an admin - can add a phone number to
 * somebody else's account and verify it for them. The most an admin can do is
 * ask, so the product's job is to make the ask precise.
 *
 * PRECISE is the whole design. A generic "please check your on-call settings"
 * nag is indistinguishable from every other automated mail an engineer deletes
 * unread, and it teaches people that this sender is noise - which costs more
 * than it saves, because the next mail from this system may be a page. So every
 * reminder is built from that user's ACTUAL readiness, read fresh from
 * OnCallReadinessService: it names the channels they never verified, or the
 * severities with no rule, or the fact that nothing at all can reach them, and
 * it links to the settings page where that specific thing is fixed.
 *
 * Four properties this file exists to guarantee, each of which was a way to get
 * this wrong:
 *
 *   1. NEVER TRUST THE BODY. The caller hands over user ids. A user id is a user
 *      id whatever project it belongs to, and User is a GLOBAL model, so a
 *      request naming somebody in another project would otherwise mail a
 *      stranger about a project they have never heard of - with that project's
 *      name in it. Membership of the CALLER'S project is re-established here,
 *      inside the service that sends, not merely at the route.
 *
 *   2. ONE REMINDER PER (PROJECT, USER) PER 24 HOURS. Two admins looking at the
 *      same amber row, or one admin double-clicking, or a page storm driving
 *      somebody back to this screen every twenty minutes, must not become a mail
 *      storm. The window is claimed ATOMICALLY and cross-process (Redis SET NX),
 *      because a check-then-send would let two concurrent requests both observe
 *      "not reminded yet" and both send.
 *
 *   3. A BURNED WINDOW MUST BE EARNED. The claim happens BEFORE the send - that
 *      is what makes it a lock rather than a record - so a send that then fails
 *      would otherwise silence this person for a day over an SMTP blip. The
 *      claim is therefore RELEASED when the send fails, with a compare-and-
 *      delete so a release can only ever remove its own claim.
 *
 *   4. THE ANSWER IS PER USER, AND HONEST. "It worked" is not a truthful summary
 *      of eight sends where one address bounced and two were already reminded
 *      this morning. Every requested id comes back with its own outcome, and the
 *      UI is expected to say "5 sent, 2 skipped, 1 failed" rather than show a
 *      green tick. This service never reports Sent for a mail it did not
 *      observe leaving: MailService returns an HTTPErrorResponse rather than
 *      throwing for a non-200, so the status code is checked explicitly.
 */

/**
 * What happened to ONE requested user. Every one of these is a distinct thing
 * for the reader to do next, which is why they are not collapsed into a boolean:
 *
 *   Sent                  - the mail left. Nothing more to do.
 *   SkippedThrottled      - they were reminded inside the last 24h. Waiting is
 *                           the correct action; sending again is not.
 *   SkippedNotAMember     - the id is not in this project. Somebody is looking
 *                           at a stale list, or at the wrong project.
 *   SkippedNothingMissing - they are Ready. There is nothing to remind them of,
 *                           and a mail claiming otherwise would be a lie the
 *                           recipient can immediately check.
 *   Failed                - we tried and it did not go. Needs a human.
 */
export enum SetupReminderOutcome {
  Sent = "Sent",
  SkippedThrottled = "SkippedThrottled",
  SkippedNotAMember = "SkippedNotAMember",
  SkippedNothingMissing = "SkippedNothingMissing",
  Failed = "Failed",
}

export interface SetupReminderUserResult {
  userId: ObjectID;
  outcome: SetupReminderOutcome;
  /**
   * One plain sentence for a human, safe to render as text. Deliberately NOT an
   * error object or a stack: this is shown to an admin who wants to know whether
   * to chase somebody, and "connect ECONNREFUSED 10.0.0.4:587" tells them
   * nothing they can act on.
   *
   * Names no user identifier of any kind. The caller already knows which user id
   * each result belongs to, and it has the name from the readiness payload it
   * was rendering when it picked them, so repeating an address here would only
   * widen what this endpoint discloses.
   */
  message: string;
}

export interface SetupReminderResult {
  projectId: ObjectID;
  /** Distinct users actually considered, which may be fewer than the ids sent. */
  requestedCount: number;
  sentCount: number;
  /** Every Skipped* outcome, of whatever kind. Broken out per user in `results`. */
  skippedCount: number;
  failedCount: number;
  results: Array<SetupReminderUserResult>;
}

/*
 * A ceiling on one request, REFUSED rather than clamped.
 *
 * This is a mail-sending endpoint reachable by any project member, so an
 * unbounded id list is a mail cannon with an HTTP interface. It is also a
 * fan-out of one HTTP call per recipient into the notification service, so a
 * five-thousand-id body would hold a request open for minutes.
 *
 * Refusing rather than truncating follows the same rule as the paging on the
 * readiness routes: a caller who asked to remind 900 people and is silently told
 * "done" about the first 250 has been actively misled about the other 650. The
 * error names the ceiling so the caller can split the list themselves.
 */
export const SETUP_REMINDER_MAX_RECIPIENTS: number = 250;

/*
 * The quiet period, in the two units the two throttle layers want it in.
 *
 * 24 hours is chosen to match OnCallNotificationAlertingService's window rather
 * than for any reason of its own: a responder with no rules is liable to receive
 * BOTH mails - the automatic "you were paged without a rule" one and this
 * deliberate "please set yourself up" one - and two systems reminding the same
 * person about the same gap on two different clocks is how a useful signal turns
 * into noise.
 */
const REMINDER_WINDOW_IN_SECONDS: number = 24 * 60 * 60;
const REMINDER_WINDOW_IN_MS: number = REMINDER_WINDOW_IN_SECONDS * 1000;

/*
 * The Redis namespace for the throttle. Distinct from anything the readiness
 * CACHE uses: a readiness cache entry is a performance detail that may be
 * dropped at any moment (the Recheck button does exactly that), whereas dropping
 * a throttle key re-arms a mail. Sharing a namespace would let a cache flush
 * become a mail storm.
 */
const REMINDER_THROTTLE_NAMESPACE: string = "oncall-setup-reminder";

/*
 * Bounded so the in-process half of the throttle cannot become a memory leak on
 * a large install. An evicted key costs at most one extra mail, and only when
 * Redis is also unavailable - the Redis fence is what actually enforces the
 * window.
 */
const THROTTLE_MAX_ENTRIES: number = 10_000;

/*
 * Dashboard user-settings path segments, duplicated from the Dashboard's
 * UserSettingsRoutePath.
 *
 * Common/Server cannot import App sources, which is why
 * OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard and
 * OnCallNotificationAlertingService both spell their routes out by hand too. The
 * duplication is a known cost; sending somebody a link to the wrong settings tab
 * is a worse one, because a reminder that lands on a page with nothing wrong on
 * it reads as "this system is confused" and gets ignored.
 */
const NOTIFICATION_METHODS_PATH: string = "notification-methods";
const INCIDENT_RULES_PATH: string = "incident-on-call-rules";
const INCIDENT_EPISODE_RULES_PATH: string = "incident-episode-on-call-rules";
const ALERT_RULES_PATH: string = "alert-on-call-rules";
const ALERT_EPISODE_RULES_PATH: string = "alert-episode-on-call-rules";

/*
 * How many reason lines a reminder carries before it stops listing them.
 *
 * A project with eight incident severities and eight alert severities and a
 * responder with no rules at all produces one line per rule type, which is
 * short - but the reasons are generated prose and this is a mail nobody is
 * obliged to read. Anything past this is summarised rather than printed, so the
 * message stays scannable and the call to action stays above the fold.
 */
const MAX_REASON_LINES: number = 6;

/*
 * The outcome of trying to take the 24h window for one (project, user).
 *
 * Only two states, deliberately: a caller that cannot claim must not send, and a
 * caller that cannot reach Redis must still be able to (see claimReminderWindow
 * for why "cache is down" resolves to Claimed rather than to a third state the
 * send path would have to branch on).
 */
enum ThrottleClaim {
  Claimed = "Claimed",
  AlreadyReminded = "AlreadyReminded",
}

/** Everything one reminder needs, resolved once for the whole request. */
interface ReminderContext {
  projectId: ObjectID;
  projectName: string;
  dashboardUrl: URL;
}

export class OnCallSetupReminderService extends BaseService {
  /*
   * The in-process half of the throttle - an L1 in front of Redis, not a
   * replacement for it.
   *
   * Redis is what actually enforces "once per 24h", because it is the only layer
   * that is both atomic and shared. This map exists so that the common shape of
   * the mistake - one admin, one screen, several clicks - is answered without a
   * network round trip per recipient per click, and so that the feature degrades
   * to SOMETHING rather than to nothing when the cache is unreachable.
   */
  private localThrottle: InProcessMemo<boolean> = new InProcessMemo<boolean>({
    ttlInMs: REMINDER_WINDOW_IN_MS,
    maxEntries: THROTTLE_MAX_ENTRIES,
  });

  /**
   * Mail every named user about what is missing from their own on-call setup,
   * and report per user what actually happened.
   *
   * Throws only for a request that is wrong as a whole - no ids, too many ids, a
   * project that does not exist. Anything that is wrong about ONE user comes
   * back as that user's outcome, because a single departed team member on a list
   * of thirty must not cancel the other twenty-nine reminders. That asymmetry is
   * the entire reason this returns a per-user array rather than void.
   *
   * The caller is responsible for having established that the requester may act
   * on `projectId` at all; this service re-checks that each USER belongs to it,
   * which is the half the route cannot do without duplicating the readiness
   * read.
   */
  @CaptureSpan()
  public async sendSetupReminders(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
  }): Promise<SetupReminderResult> {
    /*
     * De-duplicated before anything else. A list with the same id twice is one
     * person, and the throttle would catch the second copy anyway - but it would
     * catch it as "skipped, reminded in the last 24 hours", which reads to an
     * admin as though somebody else had already got there rather than as their
     * own list containing a duplicate.
     */
    const requestedUserIds: Array<ObjectID> = this.distinctIds(data.userIds);

    if (requestedUserIds.length === 0) {
      throw new BadDataException(
        "Select at least one responder to send a setup reminder to.",
      );
    }

    if (requestedUserIds.length > SETUP_REMINDER_MAX_RECIPIENTS) {
      throw new BadDataException(
        `A setup reminder can be sent to at most ${SETUP_REMINDER_MAX_RECIPIENTS} responders at a time. Received ${requestedUserIds.length}. Send the rest in a second batch.`,
      );
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * The caller was already authorised against this project, so a missing row
     * here is not a permissions question - it is a project that has been deleted
     * underneath an open tab. Failing the whole request is right: every mail
     * this request would send names the project, and "your project" is not a
     * sentence worth mailing anybody.
     */
    if (!project) {
      throw new BadDataException("Project not found.");
    }

    /*
     * One batched readiness read for the whole set - the service's own contract
     * is that the query count does not grow with the number of users - and it is
     * ALSO the membership check for everyone it answers for: getReadinessForUsers
     * omits users who are not members of the project.
     */
    const readinessList: Array<UserReadiness> =
      await OnCallReadinessService.getReadinessForUsers(
        requestedUserIds,
        data.projectId,
      );

    const readinessByUserId: Map<string, UserReadiness> = new Map<
      string,
      UserReadiness
    >();

    for (const readiness of readinessList) {
      readinessByUserId.set(readiness.userId.toString(), readiness);
    }

    /*
     * Everyone the readiness read did not answer for. Usually empty, which is
     * why the follow-up query below is conditional: this is the only place the
     * two ways of getting nothing back are told apart, and they are told apart
     * because the two sentences an admin needs are completely different -
     * "that person is not in this project" is a list they should fix, and "we
     * could not work out what they are missing" is a bug they should report.
     */
    const unresolvedUserIds: Array<ObjectID> = requestedUserIds.filter(
      (userId: ObjectID): boolean => {
        return !readinessByUserId.has(userId.toString());
      },
    );

    const unresolvedButMemberIds: Set<string> = await this.findMembersAmong(
      data.projectId,
      unresolvedUserIds,
    );

    const context: ReminderContext = {
      projectId: data.projectId,
      projectName: project.name || "",
      dashboardUrl: await DatabaseConfig.getDashboardUrl(),
    };

    const results: Array<SetupReminderUserResult> = [];

    /*
     * Sequential rather than Promise.all, and that is a decision rather than an
     * oversight. Each iteration is a Redis round trip and an HTTP call into the
     * notification service; firing 250 of those at once is a self-inflicted
     * thundering herd against the mail path, on a request whose latency nobody
     * is watching a spinner for at millisecond resolution. Sequential also keeps
     * `results` in the caller's own order, so the UI can line outcomes up
     * against the rows the admin ticked.
     */
    for (const userId of requestedUserIds) {
      results.push(
        await this.remindOneUser({
          context: context,
          userId: userId,
          readiness: readinessByUserId.get(userId.toString()),
          isMemberWithoutReadiness: unresolvedButMemberIds.has(
            userId.toString(),
          ),
        }),
      );
    }

    return this.tally(data.projectId, requestedUserIds.length, results);
  }

  /*
   * One user, start to finish. Never throws: every failure is an outcome, so one
   * bad recipient cannot take the batch down with it.
   */
  private async remindOneUser(input: {
    context: ReminderContext;
    userId: ObjectID;
    readiness: UserReadiness | undefined;
    isMemberWithoutReadiness: boolean;
  }): Promise<SetupReminderUserResult> {
    const { context, userId, readiness, isMemberWithoutReadiness } = input;

    if (!readiness) {
      if (isMemberWithoutReadiness) {
        logger.error(
          `OnCallSetupReminderService: user ${userId.toString()} is a member of project ${context.projectId.toString()} but readiness could not be computed for them, so no setup reminder was sent.`,
        );

        return {
          userId: userId,
          outcome: SetupReminderOutcome.Failed,
          message:
            "We could not work out what this responder is missing, so nothing was sent.",
        };
      }

      return {
        userId: userId,
        outcome: SetupReminderOutcome.SkippedNotAMember,
        message:
          "Not a member of this project - no reminder was sent. Refresh the page; this list may be out of date.",
      };
    }

    /*
     * A Ready responder has nothing to be reminded of, and telling them
     * otherwise is not a harmless nudge: it is a mail from the on-call system
     * making a factual claim they can check in ten seconds and find false. Do
     * that twice and the next mail from this sender - which might be the one
     * that matters - has already been filed as noise.
     */
    if (readiness.status === ReadinessStatus.Ready) {
      return {
        userId: userId,
        outcome: SetupReminderOutcome.SkippedNothingMissing,
        message:
          "Already ready - nothing is missing, so there was nothing to remind them about.",
      };
    }

    /*
     * The account email, which is the only address we can reach somebody at
     * before they have set anything up - their notification methods are, by
     * definition, the thing that is missing. An account with no usable email is
     * a genuine dead end and is reported as one rather than quietly dropped.
     */
    if (!readiness.userEmail || !Email.isValid(readiness.userEmail)) {
      logger.error(
        `OnCallSetupReminderService: user ${userId.toString()} in project ${context.projectId.toString()} has no usable account email, so no setup reminder could be sent.`,
      );

      return {
        userId: userId,
        outcome: SetupReminderOutcome.Failed,
        message:
          "This responder has no usable account email address, so there is nowhere to send a reminder.",
      };
    }

    /*
     * A token unique to THIS attempt. It is what makes the release safe: a
     * compare-and-delete can then only ever remove the claim this attempt made,
     * so a slow failing send that releases after its window has already expired
     * and been re-taken by somebody else cannot delete the new holder's claim.
     */
    const token: string = ObjectID.generate().toString();

    const claim: ThrottleClaim = await this.claimReminderWindow({
      projectId: context.projectId,
      userId: userId,
      token: token,
    });

    if (claim === ThrottleClaim.AlreadyReminded) {
      return {
        userId: userId,
        outcome: SetupReminderOutcome.SkippedThrottled,
        message:
          "Already reminded in the last 24 hours - skipped so repeated clicks cannot turn into a mail storm.",
      };
    }

    try {
      const response: HTTPResponse<EmptyResponseData> =
        await MailService.sendMail(
          {
            toEmail: new Email(readiness.userEmail),
            templateType: EmailTemplateType.SimpleMessage,
            vars: this.buildTemplateVars(context, readiness),
            subject: this.buildSubject(context, readiness),
          },
          {
            projectId: context.projectId,
            userId: userId,
          },
        );

      /*
       * MailService goes through API.post, which RESOLVES with an
       * HTTPErrorResponse for a non-2xx rather than throwing - so a try/catch on
       * its own would report Sent for a mail the notification service refused.
       * That is precisely the "green tick over nothing" this phase exists to
       * remove, so the status is checked explicitly and a failure falls through
       * to the same release-and-report path as a thrown error.
       */
      if (response.isFailure()) {
        throw new Error(
          `The notification service answered ${response.statusCode}.`,
        );
      }

      /*
       * Stamped only after the send is known to have left. Stamping earlier
       * would make the local memo disagree with the Redis claim we are about to
       * release on failure, and this process would then refuse to retry for a
       * day over a mail that never went.
       */
      this.localThrottle.set(
        this.getThrottleKey(context.projectId, userId),
        true,
      );

      return {
        userId: userId,
        outcome: SetupReminderOutcome.Sent,
        message: "Reminder sent to their account email address.",
      };
    } catch (err: unknown) {
      logger.error(
        `OnCallSetupReminderService: failed to send a setup reminder to user ${userId.toString()} in project ${context.projectId.toString()}.`,
      );
      logger.error(err);

      /*
       * Give the window back. The claim was taken to stop a SECOND mail, and no
       * first mail happened - keeping it would silence this responder for a day
       * because of an SMTP hiccup, which is the failure mode of every throttle
       * that records intent instead of outcome.
       */
      await this.releaseReminderWindow({
        projectId: context.projectId,
        userId: userId,
        token: token,
      });

      return {
        userId: userId,
        outcome: SetupReminderOutcome.Failed,
        message:
          "We could not send this reminder. Nothing was delivered - try again, and check the notification settings for this install if it keeps failing.",
      };
    }
  }

  /*
   * Take the 24h window, atomically and across every pod.
   *
   * SET NX is what makes this a lock rather than a note. A GET-then-SET would
   * let two concurrent requests - two admins on the same screen, or one admin's
   * double-click arriving on two replicas - both observe "not reminded yet" and
   * both send, which is exactly the duplicate this exists to prevent and exactly
   * the race that is impossible to reproduce when somebody reports it.
   *
   * When the cache is unreachable this resolves to Claimed - it FAILS OPEN. The
   * alternative is refusing to send, and a feature that silently stops working
   * whenever Redis blips is worse than one that occasionally sends a second copy
   * of a mail somebody asked for: the local memo still catches the repeat click
   * that produced nearly all of the duplicates this guards against, and the cost
   * of being wrong is one extra email rather than a responder who never hears
   * that nothing can page them.
   */
  private async claimReminderWindow(data: {
    projectId: ObjectID;
    userId: ObjectID;
    token: string;
  }): Promise<ThrottleClaim> {
    const key: string = this.getThrottleKey(data.projectId, data.userId);

    if (this.localThrottle.get(key)) {
      return ThrottleClaim.AlreadyReminded;
    }

    try {
      const claimed: boolean = await GlobalCache.setStringIfNotExists(
        REMINDER_THROTTLE_NAMESPACE,
        key,
        data.token,
        {
          expiresInSeconds: REMINDER_WINDOW_IN_SECONDS,
        },
      );

      if (!claimed) {
        /*
         * Somebody else holds the window - another pod, or this one before a
         * restart. Recorded locally too so the rest of this batch, and the next
         * few clicks, are answered without a round trip each.
         *
         * The local TTL is deliberately the FULL window rather than whatever is
         * left of the Redis key's. It can therefore stay set for slightly longer
         * than the real quiet period, which errs towards one fewer mail - the
         * safe direction for a throttle, and invisible next to a 24h window.
         */
        this.localThrottle.set(key, true);
        return ThrottleClaim.AlreadyReminded;
      }

      return ThrottleClaim.Claimed;
    } catch (err: unknown) {
      logger.warn(
        `OnCallSetupReminderService: the shared cache is unavailable, so the 24h setup-reminder throttle for project ${data.projectId.toString()} is enforced within this process only. A duplicate reminder is possible across pods.`,
      );
      logger.warn(err);

      return ThrottleClaim.Claimed;
    }
  }

  /*
   * Hand the window back after a send that did not happen. Compare-and-delete,
   * so this can only ever remove the claim its own attempt made.
   *
   * Best effort by construction: the send has already failed and is already
   * being reported as failed, and a cache that cannot be reached to release a
   * key costs at most a 24h delay before this responder can be reminded again.
   * Turning that into a second error would replace an honest "failed" with an
   * exception nobody can act on.
   */
  private async releaseReminderWindow(data: {
    projectId: ObjectID;
    userId: ObjectID;
    token: string;
  }): Promise<void> {
    try {
      await GlobalCache.deleteKeyIfValue(
        REMINDER_THROTTLE_NAMESPACE,
        this.getThrottleKey(data.projectId, data.userId),
        data.token,
      );
    } catch (err: unknown) {
      logger.warn(
        `OnCallSetupReminderService: could not release the setup-reminder throttle for user ${data.userId.toString()} in project ${data.projectId.toString()} after a failed send. They cannot be reminded again for up to 24 hours.`,
      );
      logger.warn(err);
    }
  }

  /*
   * Which of these ids are members of the project after all.
   *
   * Only ever called with the ids the readiness read did NOT answer for, which
   * is normally none - so this is normally zero queries. Those ids are by
   * construction either non-members (no rows at all) or the rare member whose
   * User row has gone, so the result set is tiny and a single unpaged read is
   * safe here in a way it would not be for the whole requested set.
   *
   * TeamMember is the membership table for a project - even the creating owner
   * gets a row - so its absence is a definitive "not in this project".
   * Invitation state is deliberately not part of the query, matching
   * OnCallReadinessService and OnCallReadinessAPI: somebody with a pending
   * invitation can already be sitting on an escalation rule, and they are
   * exactly the person most likely to have set nothing up.
   */
  private async findMembersAmong(
    projectId: ObjectID,
    userIds: Array<ObjectID>,
  ): Promise<Set<string>> {
    const memberIds: Set<string> = new Set<string>();

    if (userIds.length === 0) {
      return memberIds;
    }

    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      select: {
        _id: true,
        userId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const membership of memberships) {
      if (membership.userId) {
        memberIds.add(membership.userId.toString());
      }
    }

    return memberIds;
  }

  /*
   * The subject line, which is most of whether this gets opened at all.
   *
   * Two of them, because the two statuses are two different messages: one person
   * cannot be paged at all and the other can, just not the way they asked. A
   * single subject covering both would have to be vague enough to describe
   * neither.
   *
   * NOT escaped. The subject is rendered through {{title}} in EmailTitle.hbs,
   * which Handlebars escapes for us, and the same string is used verbatim as the
   * SMTP subject header - escaping here would double-escape the first and
   * corrupt the second. Escaped values belong in the message body only.
   */
  private buildSubject(
    context: ReminderContext,
    readiness: UserReadiness,
  ): string {
    const projectName: string = context.projectName || "your project";

    if (readiness.status === ReadinessStatus.NotReachable) {
      return `Action needed: nothing can page you in ${projectName}`;
    }

    return `Finish your on-call notification setup in ${projectName}`;
  }

  /*
   * The Handlebars vars for SimpleMessage.hbs.
   *
   * SimpleMessage renders `message` through InfoBlock, which uses a TRIPLE
   * stache ({{{info}}}) - i.e. raw HTML, no escaping anywhere between here and
   * the recipient's inbox. Every value that came from a database column is
   * therefore escaped on the way in: the project name is typed by an admin, and
   * the reason sentences carry severity names typed by an admin too. The only
   * unescaped markup is the fixed structure this method writes itself.
   */
  private buildTemplateVars(
    context: ReminderContext,
    readiness: UserReadiness,
  ): Dictionary<string> {
    const subject: string = this.buildSubject(context, readiness);

    return {
      subject: subject,
      message: this.buildMessageHtml(context, readiness),
    };
  }

  private buildMessageHtml(
    context: ReminderContext,
    readiness: UserReadiness,
  ): string {
    const projectName: string = this.escapeHtml(
      context.projectName || "your project",
    );

    /*
     * Whether they are actually on a rotation right now changes the first
     * sentence, and the first sentence is the whole justification for the mail.
     * "You are on an on-call rotation and cannot be paged" is urgent and true
     * for a responder some policy reaches; said to somebody who is on no policy
     * at all it is simply false, and a reminder that opens with something the
     * reader knows to be untrue has spent its credibility in one line.
     */
    const isOnRotation: boolean = readiness.reachedVia.length > 0;

    const lines: Array<string> = [];

    if (readiness.status === ReadinessStatus.NotReachable) {
      lines.push(
        isOnRotation
          ? `You are on an on-call rotation in ${projectName}, and right now there is no way for us to page you. If an incident is routed to you, it reaches nobody and the escalation simply runs down.`
          : `You are a member of ${projectName} and can be added to an on-call rotation at any time. Right now there is no way for us to page you at all.`,
      );
    } else {
      lines.push(
        isOnRotation
          ? `You are on an on-call rotation in ${projectName}. We can reach you, but not for everything - some pages have no notification rule of yours to follow.`
          : `You are a member of ${projectName} and can be added to an on-call rotation at any time. Some pages would have no notification rule of yours to follow.`,
      );
    }

    lines.push(this.buildReasonListHtml(readiness));

    const settingsLink: string = this.escapeHtml(
      this.getSettingsLink(context, readiness).toString(),
    );

    lines.push(
      `Only you can change this - notification methods and on-call rules live on your own account, so nobody in ${projectName} can set them up for you: <a href="${settingsLink}">${settingsLink}</a>`,
    );

    lines.push(
      `An administrator of ${projectName} asked us to send you this. You will not get another copy for at least 24 hours.`,
    );

    return lines.join("<br/><br/>");
  }

  /*
   * The gap itself, as a list rather than a paragraph.
   *
   * These sentences are OnCallReadinessService's own `reasons`, verbatim, and
   * that is the point: the mail, the readiness table and the policy card all say
   * the same words about the same person, so an admin who forwards this to a
   * responder is not explaining a second vocabulary. Escaped one at a time,
   * because a reason embeds severity names an admin typed.
   */
  private buildReasonListHtml(readiness: UserReadiness): string {
    const reasons: Array<string> = readiness.reasons;

    if (reasons.length === 0) {
      /*
       * Not reachable from a non-Ready status today - every such status
       * produces at least one reason - but a mail with a "here is what is
       * missing" heading and nothing under it would be worse than a slightly
       * vaguer sentence, so the degenerate case gets prose instead of an empty
       * bullet list.
       */
      return `Your notification setup in this project is incomplete. Open your settings to see what is missing.`;
    }

    const shown: Array<string> = reasons.slice(0, MAX_REASON_LINES);

    const items: string = shown
      .map((reason: string): string => {
        return `<li>${this.escapeHtml(reason)}</li>`;
      })
      .join("");

    const remaining: number = reasons.length - shown.length;

    const more: string =
      remaining > 0
        ? `<li>and ${remaining} more, listed in your settings</li>`
        : "";

    return `Here is what is missing:<ul>${items}${more}</ul>`;
  }

  /*
   * The deep link, chosen by what is actually wrong.
   *
   * A responder nothing can reach needs Notification Methods - adding a rule
   * would change nothing while there is no verified channel to deliver it on.
   * A responder who IS reachable but has holes needs the on-call rules page for
   * the rule type of their first hole. Sending either of them to the other's
   * page produces a screen where nothing looks wrong, which is how a reminder
   * gets classified as a false alarm.
   */
  private getSettingsLink(
    context: ReminderContext,
    readiness: UserReadiness,
  ): URL {
    return URL.fromString(context.dashboardUrl.toString()).addRoute(
      `/${context.projectId.toString()}/user-settings/${this.getSettingsPath(readiness)}`,
    );
  }

  private getSettingsPath(readiness: UserReadiness): string {
    if (readiness.status === ReadinessStatus.NotReachable) {
      return NOTIFICATION_METHODS_PATH;
    }

    const firstGap: ReadinessCoverageCell | undefined = readiness.coverage.find(
      (cell: ReadinessCoverageCell): boolean => {
        return !cell.hasRule && !cell.isOptOut;
      },
    );

    if (!firstGap) {
      return NOTIFICATION_METHODS_PATH;
    }

    switch (firstGap.ruleType) {
      case NotificationRuleType.ON_CALL_EXECUTED_ALERT:
        return ALERT_RULES_PATH;
      case NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE:
        return ALERT_EPISODE_RULES_PATH;
      case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE:
        return INCIDENT_EPISODE_RULES_PATH;
      case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT:
      case NotificationRuleType.WHEN_USER_GOES_ON_CALL:
      case NotificationRuleType.WHEN_USER_GOES_OFF_CALL:
        return INCIDENT_RULES_PATH;
      default:
        /*
         * A rule type this build has not heard of. Notification Methods is the
         * one page that is relevant to every gap there could ever be, so an
         * unknown type degrades to "somewhere useful" rather than to a guess
         * about which settings tab it belongs on.
         */
        return NOTIFICATION_METHODS_PATH;
    }
  }

  private tally(
    projectId: ObjectID,
    requestedCount: number,
    results: Array<SetupReminderUserResult>,
  ): SetupReminderResult {
    let sentCount: number = 0;
    let skippedCount: number = 0;
    let failedCount: number = 0;

    for (const result of results) {
      if (result.outcome === SetupReminderOutcome.Sent) {
        sentCount++;
        continue;
      }

      if (result.outcome === SetupReminderOutcome.Failed) {
        failedCount++;
        continue;
      }

      skippedCount++;
    }

    return {
      projectId: projectId,
      requestedCount: requestedCount,
      sentCount: sentCount,
      skippedCount: skippedCount,
      failedCount: failedCount,
      results: results,
    };
  }

  private getThrottleKey(projectId: ObjectID, userId: ObjectID): string {
    return `${projectId.toString()}:${userId.toString()}`;
  }

  private distinctIds(ids: Array<ObjectID>): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const distinct: Array<ObjectID> = [];

    for (const id of ids) {
      const key: string = id.toString();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      distinct.push(id);
    }

    return distinct;
  }

  /*
   * The ONLY escaping between a database column and the recipient's inbox -
   * SimpleMessage.hbs renders the message through a triple stache, so nothing
   * downstream escapes anything. Identical to the one in
   * OnCallNotificationAlertingService, and deliberately kept as a private method
   * rather than shared: the two services must be independently auditable, and a
   * shared helper is a shared place for somebody to "improve" the rule for one
   * caller and silently change it for the other.
   */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

export default new OnCallSetupReminderService();
