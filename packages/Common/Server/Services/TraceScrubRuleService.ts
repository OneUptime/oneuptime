import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TraceScrubRule";
import CreateBy from "../Types/Database/CreateBy";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate } from "../Types/Database/Hooks";
import {
  TRACE_SCRUB_FIELDS,
  TRACE_SCRUB_PATTERN_TYPES,
} from "../../Types/Telemetry/ScrubRule";
import {
  ScrubRuleValidationOptions,
  validateScrubRuleCreate,
  validateScrubRuleUpdate,
} from "../Utils/ScrubRuleValidation";

const VALIDATION_OPTIONS: ScrubRuleValidationOptions = {
  recordNoun: "spans",
  patternTypes: TRACE_SCRUB_PATTERN_TYPES,
  fieldsToScrub: TRACE_SCRUB_FIELDS,
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A rule is refused unless ingest can scrub with it - a Custom Regex rule
   * with no pattern, or one that does not compile, scrubbed nothing while it
   * looked active. See Utils/ScrubRuleValidation.ts.
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    validateScrubRuleCreate(createBy.data, VALIDATION_OPTIONS);

    return { createBy, carryForward: null };
  }

  /*
   * An update is judged on the rows it matches, once the caller has passed
   * the permission checks and the query is narrowed to the rows they may
   * write - so the stored rows read to merge it over are never another
   * project's.
   */
  protected override async onBeforeUpdateUniqueCheck(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await validateScrubRuleUpdate<Model>({
      updateBy: updateBy,
      findRowsAndHoldUpdateToThem: async (
        select: Select<Model>,
      ): Promise<Array<Model>> => {
        return await this.findRowsAndHoldUpdateToThem(updateBy, select);
      },
      options: VALIDATION_OPTIONS,
    });
  }
}

export default new Service();
