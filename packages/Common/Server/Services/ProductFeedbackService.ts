import AIConversationMessageService from "./AIConversationMessageService";
import AlertService from "./AlertService";
import AlertStateService from "./AlertStateService";
import DatabaseService from "./DatabaseService";
import GlobalConfigService from "./GlobalConfigService";
import IncidentService from "./IncidentService";
import IncidentStateService from "./IncidentStateService";
import UserService from "./UserService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import QueryHelper from "../Types/Database/QueryHelper";
import { getToolProducts } from "../Utils/AI/Toolbox/ToolProducts";
import AIConversationMessage, {
  AIConversationMessageFeedback,
} from "../../Models/DatabaseModels/AIConversationMessage";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import Model from "../../Models/DatabaseModels/ProductFeedback";
import AIChatMessageRole from "../../Types/AI/AIChatMessageRole";
import { AIChatCitation } from "../../Types/AI/AIChatTypes";
import {
  ASK_AI_RATED_DOWN_SCAN_LIMIT,
  ASK_AI_RATINGS_DAYS,
  AskAiProjectRatings,
  AskAiSource,
  AskAiSourceCount,
  countAskAiSources,
  getAskAiAnswerSources,
} from "../../Types/AI/AskAiRatings";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  ASK_AI_QUESTION_PREVIEW_LENGTH,
  ASK_AI_RATED_DOWN_LIST_SIZE,
  AskAiRatedDownAnswer,
  AskAiRatingsSummary,
  DocsFeedbackReason,
  FeedbackQuestionDecision,
  PRODUCT_FEEDBACK_DETAILS_WINDOW_MINUTES,
  PRODUCT_FEEDBACK_RETENTION_IN_DAYS,
  PRODUCT_FEEDBACK_SUMMARY_DAYS,
  ProductFeedbackAdminSummary,
  ProductFeedbackKind,
  ProductFeedbackListItem,
  ProductFeedbackListPage,
  ProductFeedbackSettings,
  ProductFeedbackSubmission,
  decideFeedbackQuestion,
  getGiveFeedbackDestination,
  isDocsFeedbackReason,
  readAskedQuestions,
  summarizeDocsPageFeedback,
  summarizeProductFeedback,
  withAskedQuestion,
} from "../../Types/ProductFeedback/ProductFeedback";

/*
 * WHAT PEOPLE TELL ONEUPTIME, KEPT ON THIS SERVER (issue #6832). The rules
 * are in Types/ProductFeedback/ProductFeedback; ProductFeedbackAPI serves
 * them over HTTP. Everything here reads and writes as root: the routes'
 * own checks are the gate.
 *
 *   - getSettings: whether the server asks (GlobalConfig.
 *     disableProductFeedback), whether it asks this person
 *     (User.disableFeedbackQuestions), and where Give feedback goes
 *     (GiveFeedbackDestination: by GlobalConfig.adminNotificationEmail on a
 *     self-hosted server, #8893).
 *   - ask: whether to ask a question now (decideFeedbackQuestion), and if
 *     so, writes down on the person's record that it was asked.
 *   - submit / addDetails: keep an answer, then the words written after it.
 *   - isDocsFeedbackKept / keepDocsAnswer: "Was this page helpful?" on the
 *     docs, kept only where a master admin switched it on (#7209).
 *   - getAdminSummary / getAdminList / deleteAnswer: the Admin Dashboard's
 *     Feedback page; a master admin may delete an answer (#7366).
 *   - getProjectAskAiRatings: how a project's Ask AI answers were rated,
 *     for its owners and admins, without anyone's words (#7365).
 *
 * An answer is kept PRODUCT_FEEDBACK_RETENTION_IN_DAYS (#7366): the daily
 * HardDelete:HardDeleteOlderItemsInDatabase job deletes the older ones, a
 * batch at a time (Utils/Retention/OlderRowsPurge), by the window this
 * service sets.
 */

// The most answers the summary reads: far more than its window holds.
export const PRODUCT_FEEDBACK_SUMMARY_MAX_ROWS: number = 10000;

/*
 * How long a docs page's read of "keep docs answers" is remembered: every
 * docs page asks, and a master admin's switch reaches them within this.
 */
export const DOCS_FEEDBACK_SETTING_CACHE_MS: number = 30 * 1000;

// This server's feedback settings (getServerFeedbackSettings).
export interface ServerFeedbackSettings {
  isOn: boolean;
  adminNotificationEmail: string | null;
}

const MS_PER_DAY: number = 24 * 60 * 60 * 1000;

export class Service extends DatabaseService<Model> {
  private docsFeedbackSetting: InMemoryTTLCache<boolean> =
    new InMemoryTTLCache<boolean>(1);

  public constructor() {
    super(Model);
    // Kept a year, then deleted by the daily purge (#7366).
    this.hardDeleteItemsOlderThanInDays(
      "createdAt",
      PRODUCT_FEEDBACK_RETENTION_IN_DAYS,
    );
  }

  /*
   * This server's feedback settings, in one read: whether it asks people
   * at all (on unless a master admin turned it off), and its Admin
   * Notification Email, where a self-hosted server emails Give feedback
   * (GiveFeedbackEmail, #8893).
   */
  public async getServerFeedbackSettings(): Promise<ServerFeedbackSettings> {
    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: {
        disableProductFeedback: true,
        adminNotificationEmail: true,
      },
      props: {
        isRoot: true,
      },
    });

    return {
      isOn: !config?.disableProductFeedback,
      adminNotificationEmail: config?.adminNotificationEmail
        ? config.adminNotificationEmail.toString()
        : null,
    };
  }

  // Whether this server asks people at all: on unless a master admin turned it off.
  public async isServerOn(): Promise<boolean> {
    return (await this.getServerFeedbackSettings()).isOn;
  }

  /*
   * Whether the docs on this server keep "Was this page helpful?" answers
   * (GlobalConfig.keepDocsFeedback, #7209): off unless a master admin
   * switched it on. Every docs page asks, so the answer is remembered for
   * DOCS_FEEDBACK_SETTING_CACHE_MS; a read that fails is off, and is not
   * remembered.
   */
  public async isDocsFeedbackKept(): Promise<boolean> {
    const remembered: boolean | undefined =
      this.docsFeedbackSetting.get("kept");

    if (remembered !== undefined) {
      return remembered;
    }

    try {
      const config: GlobalConfig | null = await GlobalConfigService.findOneById(
        {
          id: ObjectID.getZeroObjectID(),
          select: {
            keepDocsFeedback: true,
          },
          props: {
            isRoot: true,
          },
        },
      );

      const isKept: boolean = config?.keepDocsFeedback === true;

      this.docsFeedbackSetting.set(
        "kept",
        isKept,
        DOCS_FEEDBACK_SETTING_CACHE_MS,
      );

      return isKept;
    } catch {
      return false;
    }
  }

  // Forgets the remembered docs setting: the next docs page reads it again.
  public forgetDocsFeedbackSetting(): void {
    this.docsFeedbackSetting.clear();
  }

  /*
   * Keeps a docs page's answer (Types/ProductFeedback/ProductFeedback's
   * toDocsFeedbackSubmission), only while the server keeps them: whether
   * it was kept. The docs server checks first; this checks again, so an
   * answer that arrives after the switch went off is dropped.
   */
  public async keepDocsAnswer(
    submission: ProductFeedbackSubmission,
  ): Promise<boolean> {
    if (
      submission.kind !== ProductFeedbackKind.DocsPage ||
      !(await this.isDocsFeedbackKept())
    ) {
      return false;
    }

    await this.submit(submission);

    return true;
  }

  public async getSettings(userId: ObjectID): Promise<ProductFeedbackSettings> {
    const [server, user] = await Promise.all([
      this.getServerFeedbackSettings(),
      UserService.findOneById({
        id: userId,
        select: {
          disableFeedbackQuestions: true,
        },
        props: {
          isRoot: true,
        },
      }),
    ]);

    return {
      isOn: server.isOn,
      isAskingMe: server.isOn && !user?.disableFeedbackQuestions,
      // Where Give feedback goes, for the dialog to say before it is sent.
      giveFeedbackGoesTo: getGiveFeedbackDestination({
        isOneUptimeCloud: IsBillingEnabled,
        adminNotificationEmail: server.adminNotificationEmail,
      }),
    };
  }

  /*
   * Whether the project has an open incident or alert: nobody is asked how
   * a setup went while something is down.
   */
  public async isProjectInIncident(projectId: ObjectID): Promise<boolean> {
    const [incidentStateIds, alertStateIds] = await Promise.all([
      IncidentStateService.getUnresolvedIncidentStateIds(projectId),
      AlertStateService.getUnresolvedAlertStateIds(projectId),
    ]);

    const [openIncidents, openAlerts] = await Promise.all([
      incidentStateIds.length > 0
        ? IncidentService.countBy({
            query: {
              projectId: projectId,
              currentIncidentStateId: QueryHelper.any(incidentStateIds),
            },
            limit: 1,
            props: {
              isRoot: true,
            },
          })
        : Promise.resolve(null),
      alertStateIds.length > 0
        ? AlertService.countBy({
            query: {
              projectId: projectId,
              currentAlertStateId: QueryHelper.any(alertStateIds),
            },
            limit: 1,
            props: {
              isRoot: true,
            },
          })
        : Promise.resolve(null),
    ]);

    return (
      (openIncidents?.toNumber() || 0) > 0 || (openAlerts?.toNumber() || 0) > 0
    );
  }

  /*
   * Whether to ask this person the question `key` now. When the answer is
   * to ask, the question is written down as asked on their record before
   * it is shown, so another tab or device does not ask it again.
   */
  public async ask(data: {
    userId: ObjectID;
    projectId: ObjectID | null;
    key: string;
    now: Date;
  }): Promise<FeedbackQuestionDecision> {
    const [isServerOn, user] = await Promise.all([
      this.isServerOn(),
      UserService.findOneById({
        id: data.userId,
        select: {
          disableFeedbackQuestions: true,
          feedbackQuestionsAsked: true,
        },
        props: {
          isRoot: true,
        },
      }),
    ]);

    const asked: Record<string, string> = readAskedQuestions(
      user?.feedbackQuestionsAsked || null,
    );

    const decide: (isIncidentOpen: boolean) => FeedbackQuestionDecision = (
      isIncidentOpen: boolean,
    ): FeedbackQuestionDecision => {
      return decideFeedbackQuestion({
        key: data.key,
        isServerOn: isServerOn,
        isPersonOn: Boolean(user) && !user?.disableFeedbackQuestions,
        asked: asked,
        isIncidentOpen: isIncidentOpen,
        now: data.now,
      });
    };

    let decision: FeedbackQuestionDecision = decide(false);

    // The incidents are read only when everything else says ask.
    if (
      decision === FeedbackQuestionDecision.Ask &&
      data.projectId &&
      (await this.isProjectInIncident(data.projectId))
    ) {
      decision = decide(true);
    }

    if (decision === FeedbackQuestionDecision.Ask) {
      await UserService.updateOneById({
        id: data.userId,
        data: {
          feedbackQuestionsAsked: withAskedQuestion({
            asked: asked,
            key: data.key,
            now: data.now,
          }) as JSONObject,
        } as never,
        props: {
          isRoot: true,
        },
      });
    }

    return decision;
  }

  // Keeps an answer: these fields and nothing else. Answers with its id.
  public async submit(
    submission: ProductFeedbackSubmission,
  ): Promise<ObjectID> {
    const answer: Model = new Model();
    answer.kind = submission.kind;
    answer.topic = submission.topic;

    if (submission.score !== null) {
      answer.score = submission.score;
    }

    if (submission.isPositive !== null) {
      answer.isPositive = submission.isPositive;
    }

    if (submission.details !== null) {
      answer.details = submission.details;
    }

    // What went wrong with a docs page: only one of the page's own words.
    if (
      submission.kind === ProductFeedbackKind.DocsPage &&
      isDocsFeedbackReason(submission.reason)
    ) {
      answer.reason = submission.reason;
    }

    answer.page = submission.page;
    answer.productVersion = submission.version;

    const created: Model = await this.create({
      data: answer,
      props: {
        isRoot: true,
      },
    });

    return created.id!;
  }

  /*
   * The words written after a one-click answer ("What got in the way?",
   * "What is missing?"), added to it: only to an answer of a setup or the
   * check-in, given in the last PRODUCT_FEEDBACK_DETAILS_WINDOW_MINUTES,
   * that has no words yet. Its id is what proves it is the person's own:
   * only they were given it. Whether the words were added.
   */
  public async addDetails(data: {
    answerId: ObjectID;
    details: string;
    now: Date;
  }): Promise<boolean> {
    const answer: Model | null = await this.findOneById({
      id: data.answerId,
      select: {
        _id: true,
        kind: true,
        details: true,
        createdAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      !answer ||
      answer.details ||
      (answer.kind !== ProductFeedbackKind.SetupFlow &&
        answer.kind !== ProductFeedbackKind.CheckIn) ||
      !answer.createdAt ||
      data.now.getTime() - new Date(answer.createdAt).getTime() >
        PRODUCT_FEEDBACK_DETAILS_WINDOW_MINUTES * 60 * 1000
    ) {
      return false;
    }

    await this.updateOneById({
      id: data.answerId,
      data: {
        details: data.details,
      },
      props: {
        isRoot: true,
      },
    });

    return true;
  }

  // The answers of the last PRODUCT_FEEDBACK_SUMMARY_DAYS days, by question, and Ask AI's thumbs.
  public async getAdminSummary(
    now: Date,
  ): Promise<ProductFeedbackAdminSummary> {
    const since: Date = new Date(
      now.getTime() - PRODUCT_FEEDBACK_SUMMARY_DAYS * MS_PER_DAY,
    );

    const [answers, askAi] = await Promise.all([
      this.findBy({
        query: {
          createdAt: QueryHelper.greaterThanEqualTo(since),
        },
        select: {
          kind: true,
          topic: true,
          score: true,
          isPositive: true,
          details: true,
          reason: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: PRODUCT_FEEDBACK_SUMMARY_MAX_ROWS,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
      this.getAskAiRatings(since),
    ]);

    const isPositiveOf: (answer: Model) => boolean | null = (
      answer: Model,
    ): boolean | null => {
      return typeof answer.isPositive === "boolean" ? answer.isPositive : null;
    };

    return {
      sinceDays: PRODUCT_FEEDBACK_SUMMARY_DAYS,
      retentionInDays: PRODUCT_FEEDBACK_RETENTION_IN_DAYS,
      topics: summarizeProductFeedback(
        answers.map((answer: Model) => {
          return {
            kind: answer.kind as ProductFeedbackKind,
            topic: answer.topic || "",
            score: typeof answer.score === "number" ? answer.score : null,
            isPositive: isPositiveOf(answer),
            hasDetails: Boolean(answer.details),
          };
        }),
      ),
      // "Was this page helpful?", by page (#7209).
      docsPages: summarizeDocsPageFeedback(
        answers
          .filter((answer: Model): boolean => {
            return answer.kind === ProductFeedbackKind.DocsPage;
          })
          .map((answer: Model) => {
            return {
              page: answer.topic || "",
              isHelpful: isPositiveOf(answer),
              reason: answer.reason || null,
            };
          }),
      ),
      askAi: askAi,
    };
  }

  /*
   * Deletes one answer for good, at once (#7366): a master admin's, from
   * Admin Dashboard > Feedback - what a person wrote may hold more than
   * they meant to say. Whether there was one to delete.
   */
  public async deleteAnswer(answerId: ObjectID): Promise<boolean> {
    const deleted: number = await this.hardDeleteBy({
      query: {
        _id: answerId.toString(),
      } as never,
      limit: 1,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return deleted > 0;
  }

  // One page of answers, newest first, of one kind or every kind.
  public async getAdminList(data: {
    kind: ProductFeedbackKind | null;
    skip: number;
    limit: number;
  }): Promise<ProductFeedbackListPage> {
    const query: JSONObject = data.kind ? { kind: data.kind } : {};

    const [answers, count] = await Promise.all([
      this.findBy({
        query: query as never,
        select: {
          _id: true,
          kind: true,
          topic: true,
          score: true,
          isPositive: true,
          details: true,
          reason: true,
          page: true,
          productVersion: true,
          createdAt: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        skip: data.skip,
        limit: data.limit,
        props: {
          isRoot: true,
        },
      }),
      this.countBy({
        query: query as never,
        props: {
          isRoot: true,
        },
      }),
    ]);

    return {
      items: answers.map((answer: Model): ProductFeedbackListItem => {
        return {
          id: answer.id?.toString() || "",
          kind: answer.kind as ProductFeedbackKind,
          topic: answer.topic || "",
          score: typeof answer.score === "number" ? answer.score : null,
          isPositive:
            typeof answer.isPositive === "boolean" ? answer.isPositive : null,
          details: answer.details || null,
          reason: isDocsFeedbackReason(answer.reason)
            ? (answer.reason as DocsFeedbackReason)
            : null,
          page: answer.page || "",
          version: answer.productVersion || "",
          createdAt: answer.createdAt
            ? new Date(answer.createdAt).toISOString()
            : "",
        };
      }),
      count: count.toNumber(),
    };
  }

  /*
   * Ask AI's thumbs since `since` (#6828 stored them on each answer). The
   * questions behind the answers rated down are listed only on a
   * self-hosted server: on OneUptime Cloud they are customers' questions
   * about their own projects, and the team reading this sees counts only.
   */
  public async getAskAiRatings(since: Date): Promise<AskAiRatingsSummary> {
    const ratedSince: Date = since;

    const [counts, ratedDownDrewOn] = await Promise.all([
      this.countAskAiRatings({ since: ratedSince, projectId: null }),
      this.getAskAiRatedDownSources({ since: ratedSince, projectId: null }),
    ]);

    return {
      helpful: counts.helpful,
      notHelpful: counts.notHelpful,
      ratedDown: IsBillingEnabled
        ? null
        : await this.getAskAiRatedDownQuestions(ratedSince),
      ratedDownDrewOn: ratedDownDrewOn,
    };
  }

  /*
   * How a project's Ask AI answers were rated in the last
   * ASK_AI_RATINGS_DAYS days, for its owners and admins (#7365): the
   * helpful and not helpful counts, and what the answers rated down drew
   * on - never a word of a question or an answer: each conversation is
   * private to the person who had it.
   */
  public async getProjectAskAiRatings(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<AskAiProjectRatings> {
    const since: Date = new Date(
      data.now.getTime() - ASK_AI_RATINGS_DAYS * MS_PER_DAY,
    );

    const [counts, ratedDownDrewOn] = await Promise.all([
      this.countAskAiRatings({ since: since, projectId: data.projectId }),
      this.getAskAiRatedDownSources({
        since: since,
        projectId: data.projectId,
      }),
    ]);

    return {
      sinceDays: ASK_AI_RATINGS_DAYS,
      helpful: counts.helpful,
      notHelpful: counts.notHelpful,
      ratedDownDrewOn: ratedDownDrewOn,
    };
  }

  // The thumbs up and down since `since`: one project's, or every one's.
  private async countAskAiRatings(data: {
    since: Date;
    projectId: ObjectID | null;
  }): Promise<{ helpful: number; notHelpful: number }> {
    const [helpful, notHelpful] = await Promise.all(
      [
        AIConversationMessageFeedback.Up,
        AIConversationMessageFeedback.Down,
      ].map((feedback: AIConversationMessageFeedback) => {
        return AIConversationMessageService.countBy({
          query: {
            userFeedback: feedback,
            updatedAt: QueryHelper.greaterThanEqualTo(data.since),
            ...(data.projectId ? { projectId: data.projectId } : {}),
          },
          props: {
            isRoot: true,
          },
        });
      }),
    );

    return {
      helpful: helpful?.toNumber() || 0,
      notHelpful: notHelpful?.toNumber() || 0,
    };
  }

  /*
   * What the latest ASK_AI_RATED_DOWN_SCAN_LIMIT answers rated down since
   * `since` drew on (Types/AI/AskAiRatings): read from the tool names of
   * their citations alone - no question, no answer and no tool's arguments
   * are read.
   */
  public async getAskAiRatedDownSources(data: {
    since: Date;
    projectId: ObjectID | null;
  }): Promise<Array<AskAiSourceCount>> {
    const ratedDown: Array<AIConversationMessage> =
      await AIConversationMessageService.findBy({
        query: {
          userFeedback: AIConversationMessageFeedback.Down,
          updatedAt: QueryHelper.greaterThanEqualTo(data.since),
          ...(data.projectId ? { projectId: data.projectId } : {}),
        },
        select: {
          _id: true,
          citations: true,
        },
        sort: {
          updatedAt: SortOrder.Descending,
        },
        limit: ASK_AI_RATED_DOWN_SCAN_LIMIT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return countAskAiSources(
      ratedDown.map((answer: AIConversationMessage): Array<AskAiSource> => {
        const citations: Array<AIChatCitation> = Array.isArray(answer.citations)
          ? answer.citations
          : [];

        return getAskAiAnswerSources({
          toolNames: citations.map((citation: AIChatCitation): string => {
            return typeof citation?.toolName === "string"
              ? citation.toolName
              : "";
          }),
          getToolProducts: getToolProducts,
        });
      }),
    );
  }

  // The latest answers rated down, each with the question asked just before it.
  public async getAskAiRatedDownQuestions(
    since: Date,
  ): Promise<Array<AskAiRatedDownAnswer>> {
    const ratedDown: Array<AIConversationMessage> =
      await AIConversationMessageService.findBy({
        query: {
          userFeedback: AIConversationMessageFeedback.Down,
          updatedAt: QueryHelper.greaterThanEqualTo(since),
        },
        select: {
          _id: true,
          conversationId: true,
          createdAt: true,
          updatedAt: true,
        },
        sort: {
          updatedAt: SortOrder.Descending,
        },
        limit: ASK_AI_RATED_DOWN_LIST_SIZE,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const answers: Array<AskAiRatedDownAnswer | null> = await Promise.all(
      ratedDown.map(
        async (
          answer: AIConversationMessage,
        ): Promise<AskAiRatedDownAnswer | null> => {
          if (!answer.conversationId || !answer.createdAt) {
            return null;
          }

          const question: AIConversationMessage | null =
            await AIConversationMessageService.findOneBy({
              query: {
                conversationId: answer.conversationId,
                role: AIChatMessageRole.User,
                createdAt: QueryHelper.lessThanEqualTo(answer.createdAt),
              },
              select: {
                contentInMarkdown: true,
              },
              sort: {
                createdAt: SortOrder.Descending,
              },
              props: {
                isRoot: true,
              },
            });

          const text: string = (question?.contentInMarkdown || "").trim();

          if (!text) {
            return null;
          }

          return {
            question: text.slice(0, ASK_AI_QUESTION_PREVIEW_LENGTH),
            ratedAt: new Date(
              answer.updatedAt || answer.createdAt,
            ).toISOString(),
          };
        },
      ),
    );

    return answers.filter(
      (answer: AskAiRatedDownAnswer | null): answer is AskAiRatedDownAnswer => {
        return answer !== null;
      },
    );
  }
}

export default new Service();
