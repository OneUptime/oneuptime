import DatabaseService from "./DatabaseService";
import LabelService from "./LabelService";
import TeamService from "./TeamService";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TelemetryIngestAttributionSettings from "../Utils/Telemetry/TelemetryIngestAttributionSettings";
import TelemetryIngestionBudgetValidation from "../Utils/Telemetry/TelemetryIngestionBudgetValidation";
import Model from "../../Models/DatabaseModels/TelemetryIngestionTeamLabelBudget";
import Label from "../../Models/DatabaseModels/Label";
import Team from "../../Models/DatabaseModels/Team";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  TELEMETRY_INGESTION_BUDGET_COLUMNS,
  TELEMETRY_INGESTION_TEAM_LABEL_BUDGET_SIGNALS,
  TelemetryIngestionBudgetSignal,
} from "../../Types/Telemetry/TelemetryIngestionBudget";
import ObjectID from "../../Types/ObjectID";
import RelationValueUtil from "../Utils/Database/RelationValueUtil";

/*
 * A team's or a label's ingestion budget inside a project (issue #6386):
 * what may be saved, and the ingest caches told when it changes.
 *
 *   - It is a team's or a label's, never both and never neither, and the
 *     team or the label is the project's own.
 *   - Each daily budget is a number of GB above 0, or empty, and no more
 *     than the project's own (TelemetryIngestionBudgetValidation), read
 *     fresh, as a key's are.
 *   - Whose budget it is never changes (the columns take no update): a
 *     budget for another team is a new one.
 *
 * A change reaches the telemetry worker on this server at once, and on
 * every other within a minute (TelemetryIngestAttributionSettings).
 */
export const TEAM_LABEL_BUDGET_NEEDS_ONE_TARGET: string =
  "Choose a team or a label for the budget: one of them, not both.";
export const TEAM_LABEL_BUDGET_TEAM_NOT_IN_PROJECT: string =
  "That team is not in this project. Choose one of the project's teams.";
export const TEAM_LABEL_BUDGET_LABEL_NOT_IN_PROJECT: string =
  "That label is not in this project. Choose one of the project's labels.";
export const TEAM_LABEL_BUDGET_NEEDS_A_BUDGET: string =
  "Set a daily budget for at least one signal.";

// Whether a write leaves a daily budget set (its patch holds one).
const holdsDailyBudget: (data: Record<string, unknown>) => boolean = (
  data: Record<string, unknown>,
): boolean => {
  return TELEMETRY_INGESTION_TEAM_LABEL_BUDGET_SIGNALS.some(
    (signal: TelemetryIngestionBudgetSignal): boolean => {
      return (
        typeof data[
          TELEMETRY_INGESTION_BUDGET_COLUMNS[signal].dailyBudgetInGB
        ] === "number"
      );
    },
  );
};

// Whether a patch clears every daily budget, so nothing would be left set.
const clearsEveryDailyBudget: (data: Record<string, unknown>) => boolean = (
  data: Record<string, unknown>,
): boolean => {
  return TELEMETRY_INGESTION_TEAM_LABEL_BUDGET_SIGNALS.every(
    (signal: TelemetryIngestionBudgetSignal): boolean => {
      const column: string =
        TELEMETRY_INGESTION_BUDGET_COLUMNS[signal].dailyBudgetInGB;

      return (
        Object.prototype.hasOwnProperty.call(data, column) &&
        data[column] === null
      );
    },
  );
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    if (!projectId) {
      throw new BadDataException(
        "A team or label budget needs the project it is in.",
      );
    }

    const teamId: ObjectID | null = this.readTargetId(data, "teamId", "team");
    const labelId: ObjectID | null = this.readTargetId(
      data,
      "labelId",
      "label",
    );

    if ((teamId && labelId) || (!teamId && !labelId)) {
      throw new BadDataException(TEAM_LABEL_BUDGET_NEEDS_ONE_TARGET);
    }

    await this.assertTargetInProject({
      projectId: new ObjectID(projectId.toString()),
      teamId: teamId,
      labelId: labelId,
    });

    TelemetryIngestionBudgetValidation.applyTeamLabelBudgetColumnRules(data);

    // A budget with none set would limit nothing.
    if (!holdsDailyBudget(data)) {
      throw new BadDataException(TEAM_LABEL_BUDGET_NEEDS_A_BUDGET);
    }

    await TelemetryIngestionBudgetValidation.assertTeamLabelBudgetsWithinProject(
      {
        projectId: new ObjectID(projectId.toString()),
        patch: data,
      },
    );

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    TelemetryIngestAttributionSettings.forgetProject(createdItem.projectId);
    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    // Whose budget it is never changes; the API refuses it, and so does this.
    for (const column of ["teamId", "team", "labelId", "label"]) {
      if (
        Object.prototype.hasOwnProperty.call(data, column) &&
        data[column] !== undefined
      ) {
        throw new BadDataException(
          "A budget's team or label cannot be changed. Delete it and add one for the other team or label.",
        );
      }
    }

    TelemetryIngestionBudgetValidation.applyTeamLabelBudgetColumnRules(data);

    // Clearing every budget leaves nothing to limit: delete it instead.
    if (clearsEveryDailyBudget(data)) {
      throw new BadDataException(TEAM_LABEL_BUDGET_NEEDS_A_BUDGET);
    }

    const budgets: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      { projectId: true },
    );
    const checked: Set<string> = new Set<string>();

    for (const budget of budgets) {
      if (!budget.projectId || checked.has(budget.projectId.toString())) {
        continue;
      }

      checked.add(budget.projectId.toString());

      await TelemetryIngestionBudgetValidation.assertTeamLabelBudgetsWithinProject(
        {
          projectId: budget.projectId,
          patch: data,
        },
      );
    }

    return { updateBy, carryForward: budgets };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    for (const budget of (onUpdate.carryForward as Array<Model> | null) || []) {
      TelemetryIngestAttributionSettings.forgetProject(budget.projectId);
    }

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * The budgets the delete removes, and the delete held to them: the
     * projects told once it is done are exactly those whose budgets went.
     */
    const budgets: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      { projectId: true },
    );

    return { deleteBy, carryForward: budgets };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    for (const budget of (onDelete.carryForward as Array<Model> | null) || []) {
      TelemetryIngestAttributionSettings.forgetProject(budget.projectId);
    }

    return onDelete;
  }

  // The team's or label's id a create names, by its id or its relation.
  private readTargetId(
    data: Record<string, unknown>,
    idColumn: string,
    relationColumn: string,
  ): ObjectID | null {
    const value: unknown =
      data[idColumn] !== undefined && data[idColumn] !== null
        ? data[idColumn]
        : data[relationColumn];

    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (value instanceof ObjectID) {
      return value;
    }

    const id: string | null = RelationValueUtil.getRelationId(value);

    if (!id) {
      return null;
    }

    if (!ObjectID.isValidUUID(id)) {
      throw new BadDataException(TEAM_LABEL_BUDGET_NEEDS_ONE_TARGET);
    }

    return new ObjectID(id);
  }

  private async assertTargetInProject(data: {
    projectId: ObjectID;
    teamId: ObjectID | null;
    labelId: ObjectID | null;
  }): Promise<void> {
    if (data.teamId) {
      const team: Team | null = await TeamService.findOneBy({
        query: { _id: data.teamId, projectId: data.projectId },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!team) {
        throw new BadDataException(TEAM_LABEL_BUDGET_TEAM_NOT_IN_PROJECT);
      }
    }

    if (data.labelId) {
      const label: Label | null = await LabelService.findOneBy({
        query: { _id: data.labelId, projectId: data.projectId },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!label) {
        throw new BadDataException(TEAM_LABEL_BUDGET_LABEL_NOT_IN_PROJECT);
      }
    }
  }
}

export default new Service();
