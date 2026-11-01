import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataSecurityCustomDataType";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { queueDataSecurityEvaluation } from "../Utils/DataSecurity/DataSecurityJobs";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { isDataCategory } from "../../Types/DataSecurity/DataCategory";
import { isDataSensitivity } from "../../Types/DataSecurity/DataSensitivity";
import {
  ScrubRuleCustomRegexCheck,
  ScrubRuleCustomRegexProblem,
} from "../../Types/Telemetry/ScrubRule";
import { describePatternProblemReason } from "../../Utils/LinearRegExp/PatternProblem";
import {
  ALL_CUSTOM_DATA_TYPE_VALIDATORS,
  checkCustomDataType,
  CustomDataTypeValidator,
} from "../../Utils/DataSecurity/CustomDataTypeDetector";

/*
 * A project's own data types. Each is checked when it is saved the way the
 * scanner will read it: a category and sensitivity it can carry, a checksum
 * the scanner knows, and a pattern that compiles, runs in linear time and
 * matches no empty text (checkCustomDataType) - or no pattern at all, with
 * field names to be found by. A change rescans nothing by itself, but the
 * stores' sensitivity is evaluated again with it.
 */

// The most keywords and field names one type carries.
export const MAX_CUSTOM_DATA_TYPE_WORDS: number = 50;

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public static describeProblem(check: ScrubRuleCustomRegexCheck): string {
    switch (check.problem) {
      case ScrubRuleCustomRegexProblem.Missing:
        return "Enter a pattern, or field names the data type is found by.";
      case ScrubRuleCustomRegexProblem.Invalid:
        return `The pattern is not a valid regular expression: ${check.reason || "it does not compile"}.`;
      case ScrubRuleCustomRegexProblem.CannotRun:
        // Each reason is a sentence of its own, full stop included.
        return check.cannotRunReason
          ? `This pattern ${describePatternProblemReason(check.cannotRunReason)}`
          : "This pattern cannot run in linear time.";
      case ScrubRuleCustomRegexProblem.MatchesEmptyText:
        return "The pattern matches empty text, so it would match everywhere. Make every part of it match at least one character.";
      default:
        return "The pattern cannot be used.";
    }
  }

  public static readWords(value: unknown, what: string): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    if (
      !Array.isArray(value) ||
      value.some((word: unknown) => {
        return typeof word !== "string";
      })
    ) {
      throw new BadDataException(`${what} must be a list of words.`);
    }

    const words: Array<string> = (value as Array<string>)
      .map((word: string) => {
        return word.trim().toLowerCase();
      })
      .filter((word: string) => {
        return word.length > 0;
      });

    if (words.length > MAX_CUSTOM_DATA_TYPE_WORDS) {
      throw new BadDataException(
        `${what} can hold at most ${MAX_CUSTOM_DATA_TYPE_WORDS} entries.`,
      );
    }

    return [...new Set(words)];
  }

  private static validate(data: Partial<Model>, isCreate: boolean): void {
    const values: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    if (isCreate || values["name"] !== undefined) {
      const name: string =
        typeof values["name"] === "string" ? values["name"].trim() : "";

      if (!name) {
        throw new BadDataException("Give the data type a name.");
      }

      values["name"] = name;
    }

    if (
      (isCreate || values["category"] !== undefined) &&
      !isDataCategory(values["category"])
    ) {
      throw new BadDataException("Choose the data type's category.");
    }

    if (
      (isCreate || values["sensitivity"] !== undefined) &&
      !isDataSensitivity(values["sensitivity"])
    ) {
      throw new BadDataException(
        "Choose a sensitivity: Restricted, Confidential, Internal or Public.",
      );
    }

    if (
      values["validator"] !== undefined &&
      !(ALL_CUSTOM_DATA_TYPE_VALIDATORS as ReadonlyArray<unknown>).includes(
        values["validator"],
      )
    ) {
      throw new BadDataException(
        "Choose a checksum: None, Luhn, Mod97 or Verhoeff.",
      );
    }

    if (values["keywords"] !== undefined) {
      values["keywords"] = Service.readWords(values["keywords"], "Keywords");
    }

    if (values["nameHints"] !== undefined) {
      values["nameHints"] = Service.readWords(
        values["nameHints"],
        "Field names",
      );
    }
  }

  private static checkPattern(data: {
    pattern?: string | null | undefined;
    nameHints?: Array<string> | null | undefined;
    validator?: string | null | undefined;
  }): void {
    const check: ScrubRuleCustomRegexCheck | null = checkCustomDataType({
      dataTypeId: "custom:check",
      pattern: data.pattern || undefined,
      nameHints: data.nameHints || [],
      validator:
        (data.validator as CustomDataTypeValidator | undefined) || undefined,
    });

    if (check) {
      throw new BadDataException(Service.describeProblem(check));
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    Service.validate(createBy.data, true);
    Service.checkPattern(createBy.data);

    return { createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId) {
      await queueDataSecurityEvaluation(createdItem.projectId);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: Partial<Model> = updateBy.data as unknown as Partial<Model>;

    Service.validate(data, false);

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        pattern: true,
        nameHints: true,
        validator: true,
      },
    );

    if (
      data.pattern !== undefined ||
      data.nameHints !== undefined ||
      data.validator !== undefined
    ) {
      for (const row of rows) {
        Service.checkPattern({
          pattern: data.pattern !== undefined ? data.pattern : row.pattern,
          nameHints:
            data.nameHints !== undefined ? data.nameHints : row.nameHints,
          validator:
            data.validator !== undefined ? data.validator : row.validator,
        });
      }
    }

    return {
      updateBy,
      carryForward: rows
        .map((row: Model): ObjectID | undefined => {
          return row.projectId;
        })
        .filter((projectId: ObjectID | undefined): projectId is ObjectID => {
          return Boolean(projectId);
        }),
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const seen: Set<string> = new Set();

    for (const projectId of (onUpdate.carryForward as
      | Array<ObjectID>
      | undefined) || []) {
      if (!seen.has(projectId.toString())) {
        seen.add(projectId.toString());
        await queueDataSecurityEvaluation(projectId);
      }
    }

    return onUpdate;
  }
}

export default new Service();
