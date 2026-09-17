import RunCron from "../../Utils/Cron";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import OnCallReadinessService, {
  ReadinessStatus,
  ReadinessSummary,
  UserReadiness,
} from "Common/Server/Services/OnCallReadinessService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import URL from "Common/Types/API/URL";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_WEEK } from "Common/Utils/CronTime";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";

/*
 * The weekly "who is on call and still cannot be paged?" digest.
 *
 * Everything else built for on-call readiness is reactive or on-demand: the
 * fallback rescues a page at the moment it would otherwise be dropped, and the
 * On-Call > Readiness page answers the question for whoever thinks to ask it.
 * Nobody thinks to ask it. A responder who joins with no verified notification
 * method is invisible until the night they are paged and nothing happens, and
 * the whole point of an escalation policy is that the person relying on it is
 * asleep. This job is the one thing in the system that goes and tells somebody
 * without being asked.
 *
 * It is deliberately small in what it decides. OnCallReadinessService already
 * resolves the responder set (direct users, team members, schedule layers,
 * overrides), works out per-user status, and writes the human sentences; this
 * job's entire job is to choose WHO gets told, WHEN, and - the part that
 * decides whether it is read at all - WHETHER THERE IS ANYTHING WORTH SAYING.
 *
 * Silence is a feature, not an omission. There is no "all clear" mail here: a
 * weekly message that is almost always "everything is fine" trains its
 * recipients to filter it, and the one week it says something different is the
 * week it lands in an unread folder. If a project's on-call responders are all
 * reachable, this job sends its owners nothing at all, and an email from it
 * therefore always means something is wrong.
 */

const JOB_NAME: string = "OnCallDutyPolicy:WeeklyReadinessDigest";

/*
 * How many responders each section of the mail names before it stops and points
 * at the readiness page.
 *
 * A project that has just switched SMS off, or has just imported a hundred
 * people who have verified nothing, produces a list that no mail client renders
 * usefully and no human reads to the end of. The cap is not about size for its
 * own sake: an email that opens with twenty names and "…and 180 more" says
 * "this is systemic, go and look at the page", which is the correct action,
 * whereas two hundred names says nothing at all. The count is always stated in
 * full even when the list is cut, so the cap can never make a problem look
 * smaller than it is.
 */
const MAX_RESPONDERS_LISTED_PER_SECTION: number = 20;

/* The finished mail for one project, or null when the project has nothing wrong. */
interface ProjectDigest {
  subject: string;
  messageHtml: string;
}

/*
 * Weekly, and runOnStartup deliberately FALSE.
 *
 * runOnStartup would email every project owner in the instance on every worker
 * boot - which is to say on every deploy, every crash-loop and every scale-up.
 * A nagging digest is worse than no digest: the first thing an owner does with
 * an email that arrives three times during a rollout is write a filter rule for
 * it, and that filter rule is still there the week the digest has something
 * urgent to say.
 *
 * No single-flight lock here, unlike the severity backfill next door. That job
 * needs one because it also gets enqueued BY NAME from two services and its
 * writes are check-then-create; this one is dispatched only by the repeatable
 * schedule, which BullMQ hands to exactly one worker, and it writes nothing to
 * the database at all. The worst a duplicate run could do is send the digest
 * twice, which is a nuisance rather than a corruption.
 */
RunCron(
  JOB_NAME,
  { schedule: EVERY_WEEK, runOnStartup: false },
  async (): Promise<void> => {
    await sendWeeklyReadinessDigests();
  },
);

type SendWeeklyReadinessDigestsFunction = () => Promise<void>;

const sendWeeklyReadinessDigests: SendWeeklyReadinessDigestsFunction =
  async (): Promise<void> => {
    const projects: Array<Project> = await findProjectsWithOnCallPolicies();

    if (projects.length === 0) {
      return;
    }

    logger.debug(
      `${JOB_NAME}: checking on-call readiness for ${projects.length} project(s) with at least one on-call policy`,
      { service: "workers" },
    );

    for (const project of projects) {
      /*
       * One project's bad data - a policy pointing at a deleted schedule, a
       * readiness read that throws - must not stop every other project's owners
       * being told. A project that fails is logged and skipped; the next weekly
       * run tries it again.
       */
      try {
        await sendDigestForProject(project);
      } catch (err) {
        logger.error(
          `${JOB_NAME}: failed to build or send the readiness digest for project ${project.id?.toString()}`,
        );
        logger.error(err);
      }
    }
  };

type FindProjectsWithOnCallPoliciesFunction = () => Promise<Array<Project>>;

/**
 * Every project that has at least one on-call duty policy, with its name.
 *
 * "At least one policy" is the right filter rather than "every project": a
 * project with no on-call policy has no responders to be unreachable, and
 * mailing its owners about on-call readiness would be a mail about a feature
 * they have not switched on.
 *
 * Both reads go through findAllBy, which PAGES until the table is exhausted.
 * That is not incidental tidiness - it is the same defect this whole workstream
 * exists to remove. A plain findBy stops at its limit, and a project whose
 * policy row falls off the end of that page is a project whose unreachable
 * responders are reported to nobody, which is indistinguishable from a project
 * that is fine. The same reasoning is why OnCallReadinessService pages every
 * read behind the responder set it returns.
 *
 * Looking the projects up (rather than carrying projectIds forward from the
 * policies) also drops soft-deleted projects on the floor for free: a deleted
 * project's rows are excluded by the base service, so its owners are not mailed
 * about an on-call setup that no longer exists.
 */
const findProjectsWithOnCallPolicies: FindProjectsWithOnCallPoliciesFunction =
  async (): Promise<Array<Project>> => {
    const policies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findAllBy({
        query: {},
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

    const projectIdByString: Map<string, ObjectID> = new Map<
      string,
      ObjectID
    >();

    for (const policy of policies) {
      if (!policy.projectId) {
        continue;
      }

      projectIdByString.set(policy.projectId.toString(), policy.projectId);
    }

    if (projectIdByString.size === 0) {
      return [];
    }

    return await ProjectService.findAllBy({
      query: {
        _id: new Includes(Array.from(projectIdByString.values())),
      },
      select: {
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });
  };

type SendDigestForProjectFunction = (project: Project) => Promise<void>;

const sendDigestForProject: SendDigestForProjectFunction = async (
  project: Project,
): Promise<void> => {
  const projectId: ObjectID | null | undefined = project.id;

  if (!projectId) {
    return;
  }

  const summary: ReadinessSummary =
    await OnCallReadinessService.getReadinessForProject(projectId);

  const notReachable: Array<UserReadiness> = sortByName(
    summary.users.filter((user: UserReadiness): boolean => {
      return user.status === ReadinessStatus.NotReachable;
    }),
  );

  const partiallyReady: Array<UserReadiness> = sortByName(
    summary.users.filter((user: UserReadiness): boolean => {
      return user.status === ReadinessStatus.PartiallyReady;
    }),
  );

  if (notReachable.length === 0 && partiallyReady.length === 0) {
    /*
     * Nothing to say, so nothing is said - see the essay at the top of this
     * file. The one thing worth a log line is a summary that reached this
     * branch while ADMITTING it is incomplete: "we found no problems" and "we
     * could not finish looking" are the same silence to an owner, and only this
     * log distinguishes them afterwards. It is a warning rather than an email
     * because an owner cannot act on "the readiness read hit a page ceiling",
     * whereas whoever is reading worker logs about a very large project can.
     */
    if (summary.isTruncated) {
      logger.warn(
        `${JOB_NAME}: readiness for project ${projectId.toString()} was TRUNCATED and reported no unreachable responders. That "all clear" is not trustworthy - responders may have been dropped by a truncated read - but no digest was sent because none can be named.`,
      );

      return;
    }

    logger.debug(
      `${JOB_NAME}: every on-call responder in project ${projectId.toString()} is reachable; sending no digest`,
      { service: "workers" },
    );

    return;
  }

  /*
   * Check for owners BEFORE building the mail, and log loudly when there are
   * none.
   *
   * ProjectService.getOwners returns [] when no team in the project holds the
   * ProjectOwner permission, and sendEmailToProjectOwners then returns without
   * sending and without complaining. That silence is exactly the failure this
   * job exists to prevent, one level up: the last-resort warning about
   * responders nobody can page would itself reach nobody, and nothing anywhere
   * would record that it had not. So the empty case is stated in the log, with
   * the counts, so it is visible to whoever is looking at the instance even
   * though it is invisible to the project.
   *
   * This does cost a second getOwners read, because sendEmailToProjectOwners
   * resolves the owners again itself. That is one small query per unhealthy
   * project per WEEK, and the alternative - reimplementing the send loop here
   * to avoid it - would duplicate the mail-service plumbing and the per-owner
   * error handling that already live in ProjectService.
   */
  const owners: Array<User> = await ProjectService.getOwners(projectId);

  if (owners.length === 0) {
    logger.error(
      `${JOB_NAME}: project ${projectId.toString()} has ${notReachable.length} responder(s) who cannot be paged and ${partiallyReady.length} with gaps, but NO team in the project holds the ProjectOwner permission, so there is nobody to send the readiness digest to.`,
    );

    return;
  }

  const digest: ProjectDigest = buildProjectDigest({
    projectName: project.name?.toString() || "your project",
    notReachable: notReachable,
    partiallyReady: partiallyReady,
    isFallbackEnabled: summary.isFallbackEnabled,
    isTruncated: summary.isTruncated,
    readinessLink: (await getReadinessLinkInDashboard(projectId)).toString(),
  });

  await ProjectService.sendEmailToProjectOwners(
    projectId,
    digest.subject,
    digest.messageHtml,
  );

  logger.debug(
    `${JOB_NAME}: sent the on-call readiness digest for project ${projectId.toString()} to ${owners.length} owner(s): ${notReachable.length} unreachable, ${partiallyReady.length} with gaps`,
    { service: "workers" },
  );
};

type GetReadinessLinkInDashboardFunction = (
  projectId: ObjectID,
) => Promise<URL>;

/*
 * The project-wide On-Call > Readiness page, which is where every sentence in
 * this mail is expanded into a per-user, per-severity grid. The digest names
 * names on purpose, but the fix always happens on that page, so the link is the
 * one thing in the mail that must never be wrong.
 */
const getReadinessLinkInDashboard: GetReadinessLinkInDashboardFunction = async (
  projectId: ObjectID,
): Promise<URL> => {
  const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

  return URL.fromString(dashboardUrl.toString()).addRoute(
    `/${projectId.toString()}/on-call-duty/readiness`,
  );
};

type SortByNameFunction = (users: Array<UserReadiness>) => Array<UserReadiness>;

/*
 * Stable, alphabetical order, so a project whose situation has not changed gets
 * a digest that LOOKS identical week to week. An owner skimming the second
 * week's mail is comparing it against their memory of the first; a list that
 * reshuffles itself because the underlying read came back in a different order
 * hides the one new name in it.
 */
const sortByName: SortByNameFunction = (
  users: Array<UserReadiness>,
): Array<UserReadiness> => {
  return [...users].sort((a: UserReadiness, b: UserReadiness): number => {
    return a.userName.localeCompare(b.userName);
  });
};

type BuildProjectDigestFunction = (data: {
  projectName: string;
  notReachable: Array<UserReadiness>;
  partiallyReady: Array<UserReadiness>;
  isFallbackEnabled: boolean;
  isTruncated: boolean;
  readinessLink: string;
}) => ProjectDigest;

/**
 * The mail itself: subject line and message body.
 *
 * Pure, and exported, because this is the part with the interesting decisions
 * in it - what is said, in what order, and how much of it - and a pure function
 * of its inputs can be asserted on directly rather than through a mail service
 * spy.
 *
 * The two halves are escaped DIFFERENTLY, and the difference matters:
 *
 *   - The MESSAGE is interpolated into ProjectService.sendEmailToProjectOwners,
 *     which hands it to SimpleMessage.hbs where it is rendered through a triple
 *     stache - i.e. as RAW HTML. Responder names, their login emails, the
 *     project name and the reason sentences are all ultimately user-controlled
 *     strings, so every one of them goes through escapeHtml on the way in. A
 *     user called `<script>` must read as a strange name, not execute.
 *   - The SUBJECT is rendered through {{title}}, which Handlebars escapes on its
 *     own, and is also used verbatim as the SMTP subject header. Escaping it
 *     here would double-escape the first and corrupt the second, so raw values
 *     belong in the subject and escaped values belong in the body only.
 */
const buildProjectDigest: BuildProjectDigestFunction = (data: {
  projectName: string;
  notReachable: Array<UserReadiness>;
  partiallyReady: Array<UserReadiness>;
  isFallbackEnabled: boolean;
  isTruncated: boolean;
  readinessLink: string;
}): ProjectDigest => {
  const escapedProjectName: string = escapeHtml(data.projectName);
  const escapedLink: string = escapeHtml(data.readinessLink);

  const lines: Array<string> = [];

  /*
   * Open by saying what the mail is and, just as importantly, what its silence
   * means. An owner who knows they only hear from this when something is broken
   * reads the next paragraph differently from one who assumes it is a routine
   * report.
   */
  lines.push(
    `This is the weekly on-call readiness check for ${escapedProjectName}. It lists people who are on an on-call policy and cannot be paged the way the policy assumes. You only get this email when there is something in it - a week with nothing wrong is a week with no email.`,
  );

  if (data.notReachable.length > 0) {
    lines.push(
      [
        `<b>Cannot be paged at all (${data.notReachable.length})</b>`,
        `Nothing reaches these people. If one of them is the only responder on an escalation level, a page that gets that far reaches nobody.`,
        renderResponderList(data.notReachable),
      ].join("<br/>"),
    );
  }

  if (data.partiallyReady.length > 0) {
    /*
     * What "a gap" MEANS depends on a project setting, so the sentence that
     * describes it has to read the setting. With the fallback on, an uncovered
     * severity still reaches the responder on some verified channel - untidy,
     * but not silent. With it off, the same gap drops the page entirely. Those
     * are different problems with different urgency and they must not share a
     * sentence.
     */
    lines.push(
      [
        `<b>Reachable, but with gaps (${data.partiallyReady.length})</b>`,
        data.isFallbackEnabled
          ? `These people have no notification rule for some of what could page them. Those pages fall back to whatever they have verified, which ignores everything they configured about how and when they want to be reached.`
          : `This project has the on-call notification fallback switched OFF, so a page with no matching rule is not delivered on another channel - it is dropped. For these people, the gaps below are silent pages.`,
        renderResponderList(data.partiallyReady),
      ].join("<br/>"),
    );
  }

  if (data.isTruncated) {
    /*
     * An incomplete answer that does not admit it is incomplete is worse than
     * no answer, because the reader closes the mail believing they have seen
     * the whole list.
     */
    lines.push(
      `<b>This check did not finish reading the project.</b> At least one of the reads behind it hit its page ceiling, so there may be responders with problems who are not named above.`,
    );
  }

  lines.push(
    `The full picture, per person and per severity, is on the readiness page: <a href="${escapedLink}">${escapedLink}</a>`,
  );

  /*
   * The subject leads with the count that decides whether this is opened today
   * or on Thursday. "Cannot be paged" outranks "has gaps": one is an outage
   * waiting for an incident, the other is a page arriving on the wrong channel.
   */
  const subject: string =
    data.notReachable.length > 0
      ? `[Action Required] ${data.notReachable.length} on-call ${pluralizeResponder(data.notReachable.length)} in ${data.projectName} cannot be paged`
      : `${data.partiallyReady.length} on-call ${pluralizeResponder(data.partiallyReady.length)} in ${data.projectName} ${data.partiallyReady.length === 1 ? "has" : "have"} gaps in their notification rules`;

  return {
    subject: subject,
    messageHtml: lines.join("<br/><br/>"),
  };
};

type RenderResponderListFunction = (users: Array<UserReadiness>) => string;

/*
 * One line per responder: who they are, and the specific missing thing.
 *
 * The reasons come from OnCallReadinessService.buildReasons and are already
 * sentences an admin can act on ("No rules for Sev1, Sev2 incidents - pages
 * fall back to Email"), so they are passed through rather than re-worded here.
 * Two surfaces describing the same defect in two different vocabularies is how
 * an operator ends up believing they are two different defects.
 */
const renderResponderList: RenderResponderListFunction = (
  users: Array<UserReadiness>,
): string => {
  const shown: Array<UserReadiness> = users.slice(
    0,
    MAX_RESPONDERS_LISTED_PER_SECTION,
  );

  const lines: Array<string> = shown.map((user: UserReadiness): string => {
    const name: string = escapeHtml(user.userName);
    const email: string = user.userEmail
      ? ` (${escapeHtml(user.userEmail)})`
      : "";
    const reasons: string = user.reasons
      .map((reason: string): string => {
        return escapeHtml(reason);
      })
      .join("; ");

    return `&bull; <b>${name}</b>${email}${reasons ? ` &mdash; ${reasons}` : ""}`;
  });

  const remaining: number = users.length - shown.length;

  if (remaining > 0) {
    lines.push(
      `&bull; …and ${remaining} more. The readiness page lists all of them.`,
    );
  }

  return lines.join("<br/>");
};

type PluralizeResponderFunction = (count: number) => string;

const pluralizeResponder: PluralizeResponderFunction = (
  count: number,
): string => {
  return count === 1 ? "responder" : "responders";
};

type EscapeHtmlFunction = (value: string) => string;

/*
 * The message body is rendered as raw HTML by SimpleMessage.hbs, so everything
 * interpolated into it is escaped here first. Deliberately a local copy rather
 * than a shared import: the identical function in
 * OnCallNotificationAlertingService is private to that service, and an escape
 * routine is small enough that duplicating it costs less than the coupling of
 * exporting one.
 */
const escapeHtml: EscapeHtmlFunction = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

export {
  JOB_NAME,
  MAX_RESPONDERS_LISTED_PER_SECTION,
  buildProjectDigest,
  findProjectsWithOnCallPolicies,
  sendDigestForProject,
  sendWeeklyReadinessDigests,
};
export type { ProjectDigest };
