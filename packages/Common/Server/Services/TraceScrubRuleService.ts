import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TraceScrubRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import LIMIT_MAX from "../../Types/Database/LimitMax";
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
    validateScrubRuleCreate(
      {
        patternType: createBy.data.patternType,
        customRegex: createBy.data.customRegex,
        fieldsToScrub: createBy.data.fieldsToScrub,
      },
      VALIDATION_OPTIONS,
    );

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await validateScrubRuleUpdate({
      incoming: {
        patternType: updateBy.data.patternType,
        customRegex: updateBy.data.customRegex,
        fieldsToScrub: updateBy.data.fieldsToScrub,
      },
      findStoredRows: async (): Promise<Array<Model>> => {
        return await this.findBy({
          query: updateBy.query,
          skip: 0,
          limit: LIMIT_MAX,
          select: {
            _id: true,
            patternType: true,
            customRegex: true,
            fieldsToScrub: true,
          },
          props: {
            isRoot: true,
          },
        });
      },
      options: VALIDATION_OPTIONS,
    });

    return { updateBy, carryForward: null };
  }
}

export default new Service();
