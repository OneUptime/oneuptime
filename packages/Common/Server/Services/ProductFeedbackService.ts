import AIConversationMessageService from "./AIConversationMessageService";
import AlertService from "./AlertService";
import AlertStateService from "./AlertStateService";
import DatabaseService from "./DatabaseService";
import GlobalConfigService from "./GlobalConfigService";
import IncidentService from "./IncidentService";
import IncidentStateService from "./IncidentStateService";
import ProjectService from "./ProjectService";
import UserService from "./UserService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import QueryHelper from "../Types/Database/QueryHelper";
import AIConversationMessage, {
  AIConversationMessageFeedback,
} from "../../Models/DatabaseModels/AIConversationMessage";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import Model from "../../Models/DatabaseModels/ProductFeedback";
import AIChatMessageRole from "../../Types/AI/AIChatMessageRole";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  ASK_AI_QUESTION_PREVIEW_LENGTH,
  ASK_AI_RATED_DOWN_LIST_SIZE,
  AskAiRatedDownAnswer,
  AskAiRatingsSummary,
  FeedbackQuestionDecision,
  PRODUCT_FEEDBACK_DETAILS_WINDOW_MINUTES,
  PRODUCT_FEEDBACK_SUMMARY_DAYS,
  ProductFeedbackAdminSummary,
  ProductFeedbackKind,
  ProductFeedbackListItem,
  ProductFeedbackListPage,
  ProductFeedbackSettings,
  ProductFeedbackSubmission,
  decideFeedbackQuestion,
  readAskedQuestions,
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
 *     disableProductFeedback) and whether it asks this person
 *     (User.disableFeedbackQuestions).
 *   - ask: whether to ask a question now (decideFeedbackQuestion), and if
 *     so, writes down on the person's record that it was asked.
 *   - submit / addDetails: keep an answer, then the words written after it.
 *   - getAdminSummary / getAdminList: the Admin Dashboard's Feedback page.
 */

// The most answers the summary reads: far more than its window holds.
export const PRODUCT_FEEDBACK_SUMMARY_MAX_ROWS: number = 10000;

const MS_PER_DAY: number = 24 * 60 * 60 * 1000;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  // Whether this server asks people at all: on unless a master admin turned it off.
  public async isServerOn(): Promise<boolean> {
    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: {
        disableProductFeedback: true,
      },
      props: {
        isRoot: true,
      },
    });

    return !config?.disableProductFeedback;
  }

  public async getSettings(userId: ObjectID): Promise<ProductFeedbackSettings> {
    const [isOn, user] = await Promise.all([
      this.isServerOn(),
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
      isOn: isOn,
      isAskingMe: isOn && !user?.disableFeedbackQuestions,
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
    const [isServerOn, user, isSampleProject] = await Promise.all([
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
      /*
       * Nothing is asked in a sample project (issue #6808): the first-week
       * check-in, the end of a guided setup, Was this clear? - none.
       */
      data.projectId
        ? ProjectService.isSampleProject(data.projectId)
        : Promise.resolve(false),
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
        isSampleProject: isSampleProject,
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

    return {
      sinceDays: PRODUCT_FEEDBACK_SUMMARY_DAYS,
      topics: summarizeProductFeedback(
        answers.map((answer: Model) => {
          return {
            kind: answer.kind as ProductFeedbackKind,
            topic: answer.topic || "",
            score: typeof answer.score === "number" ? answer.score : null,
            isPositive:
              typeof answer.isPositive === "boolean" ? answer.isPositive : null,
            hasDetails: Boolean(answer.details),
          };
        }),
      ),
      askAi: askAi,
    };
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

    const [helpful, notHelpful] = await Promise.all([
      AIConversationMessageService.countBy({
        query: {
          userFeedback: AIConversationMessageFeedback.Up,
          updatedAt: QueryHelper.greaterThanEqualTo(ratedSince),
        },
        props: {
          isRoot: true,
        },
      }),
      AIConversationMessageService.countBy({
        query: {
          userFeedback: AIConversationMessageFeedback.Down,
          updatedAt: QueryHelper.greaterThanEqualTo(ratedSince),
        },
        props: {
          isRoot: true,
        },
      }),
    ]);

    return {
      helpful: helpful.toNumber(),
      notHelpful: notHelpful.toNumber(),
      ratedDown: IsBillingEnabled
        ? null
        : await this.getAskAiRatedDownQuestions(ratedSince),
    };
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
