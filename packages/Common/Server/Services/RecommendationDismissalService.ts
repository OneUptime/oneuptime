import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import RecommendationType from "../../Types/Recommendation/RecommendationType";
import Model from "../../Models/DatabaseModels/RecommendationDismissal";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * `recommendationType` is a string column rather than a Postgres enum (the
   * codebase keeps enums in TypeScript so adding a member needs no migration),
   * which means nothing below this point would reject a typo. A dismissal
   * written under "monitor" instead of "Monitor" is silently invisible: the
   * page filters on the enum value, finds nothing, and the card the user
   * dismissed simply reappears with no error anywhere. Validating at the write
   * boundary is the only place that failure is still cheap.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const recommendationType: string | undefined =
      createBy.data.recommendationType;

    if (!recommendationType) {
      throw new BadDataException("Recommendation type is required.");
    }

    const validTypes: Array<string> = Object.values(RecommendationType);

    if (!validTypes.includes(recommendationType)) {
      throw new BadDataException(
        `Invalid recommendation type: ${recommendationType}. Valid types are ${validTypes.join(
          ", ",
        )}.`,
      );
    }

    if (!createBy.data.recommendationId) {
      throw new BadDataException("Recommendation ID is required.");
    }

    return { createBy, carryForward: null };
  }
}

export default new Service();
