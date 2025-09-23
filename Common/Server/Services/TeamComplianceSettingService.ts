import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TeamComplianceSetting";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class TeamComplianceSettingService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // Check if a compliance setting with the same teamId and ruleType already exists
    const existingSetting: Model | null = await this.findOneBy({
      query: {
        teamId: createBy.data.teamId!,
        ruleType: createBy.data.ruleType!,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
      },
    });

    if (existingSetting) {
      throw new BadDataException(
        `A compliance setting for rule type "${createBy.data.ruleType}" already exists for this team.`,
      );
    }

    return { createBy, carryForward: null };
  }
}

export default new TeamComplianceSettingService();