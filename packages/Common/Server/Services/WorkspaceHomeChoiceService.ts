import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/WorkspaceHomeChoice";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import QueryHelper from "../Types/Database/QueryHelper";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Which project a person's Slack or Microsoft Teams Home opens on, in a
 * workspace connected to several projects (WorkspaceHomeChoice): the one of
 * theirs they chose last. Only the server reads and writes it, as
 * OneUptime; WorkspaceHomeProject is what the Homes call.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Records that the chat account chose `projectId` for its Home, at `at`
   * (now): its row of that project is written again, or made. Two choices
   * of the same project at once write one row - the second finds the
   * first's.
   */
  @CaptureSpan()
  public async recordChoice(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    workspaceUserId: string;
    at?: Date | undefined;
  }): Promise<void> {
    const chosenAt: Date = data.at || OneUptimeDate.getCurrentDate();

    const existing: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        workspaceUserId: data.workspaceUserId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existing?.id) {
      await this.updateOneById({
        id: existing.id,
        data: {
          chosenAt: chosenAt,
        },
        props: {
          isRoot: true,
        },
      });
      return;
    }

    const choice: Model = new Model();
    choice.projectId = data.projectId;
    choice.workspaceType = data.workspaceType;
    choice.workspaceUserId = data.workspaceUserId;
    choice.chosenAt = chosenAt;

    try {
      await this.create({
        data: choice,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      /*
       * The same choice, made a moment earlier, wrote the row first: it
       * says the same.
       */
      if (!PostgresErrorTranslator.isUniqueViolation(err)) {
        throw err;
      }
    }
  }

  /*
   * The project of `projectIds` the chat account chose last for its Home;
   * null when it chose none of them. Reads one row.
   */
  @CaptureSpan()
  public async findLastChosenProject(data: {
    workspaceType: WorkspaceType;
    workspaceUserId: string;
    projectIds: Array<ObjectID>;
  }): Promise<ObjectID | null> {
    if (!data.workspaceUserId || data.projectIds.length === 0) {
      return null;
    }

    const choices: Array<Model> = await this.findBy({
      query: {
        workspaceType: data.workspaceType,
        workspaceUserId: data.workspaceUserId,
        projectId: QueryHelper.any(data.projectIds),
      },
      select: {
        projectId: true,
        chosenAt: true,
      },
      sort: {
        chosenAt: SortOrder.Descending,
      },
      limit: 1,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return choices[0]?.projectId || null;
  }
}

export default new Service();
