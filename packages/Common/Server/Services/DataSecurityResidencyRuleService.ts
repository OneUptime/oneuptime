import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataSecurityResidencyRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { queueDataSecurityEvaluation } from "../Utils/DataSecurity/DataSecurityJobs";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { isDataCategory } from "../../Types/DataSecurity/DataCategory";

/*
 * Residency rules: data categories, optionally the countries whose people
 * they are about, and the regions the data may live in. Regions are written
 * the way clouds name them, with * for any characters ("eu-*", "europe-*",
 * "westeurope"); categories must be ones Data Security knows; countries are
 * ISO 3166-1 alpha-2 codes. A change queues the project's evaluation.
 */

export const MAX_RESIDENCY_REGIONS: number = 100;

const REGION_PATTERN: RegExp = /^[a-z0-9*][a-z0-9*-]{0,63}$/;
const COUNTRY_PATTERN: RegExp = /^[A-Z]{2}$/;

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public static readRegions(value: unknown): Array<string> {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadDataException(
        "Name at least one region the data may live in.",
      );
    }

    if (value.length > MAX_RESIDENCY_REGIONS) {
      throw new BadDataException(
        `A rule names at most ${MAX_RESIDENCY_REGIONS} regions.`,
      );
    }

    return value.map((region: unknown) => {
      const text: string =
        typeof region === "string" ? region.trim().toLowerCase() : "";

      if (!REGION_PATTERN.test(text)) {
        throw new BadDataException(
          `"${String(region)}" is not a region. Write regions as their cloud names them, such as eu-west-1, europe-west4 or westeurope; * matches any characters.`,
        );
      }

      return text;
    });
  }

  public static readCategories(value: unknown): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadDataException("Data categories must be a list.");
    }

    for (const category of value) {
      if (!isDataCategory(category)) {
        throw new BadDataException(
          `"${String(category)}" is not a data category Data Security knows.`,
        );
      }
    }

    return [...new Set(value as Array<string>)];
  }

  public static readCountries(value: unknown): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadDataException("Countries must be a list.");
    }

    return value.map((country: unknown) => {
      const code: string =
        typeof country === "string" ? country.trim().toUpperCase() : "";

      if (!COUNTRY_PATTERN.test(code)) {
        throw new BadDataException(
          `"${String(country)}" is not a two-letter country code, such as DE or IN.`,
        );
      }

      return code;
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.name?.trim()) {
      throw new BadDataException("Give the rule a name.");
    }

    createBy.data.name = createBy.data.name.trim();
    createBy.data.allowedRegions = Service.readRegions(
      createBy.data.allowedRegions,
    );
    createBy.data.dataCategories = Service.readCategories(
      createBy.data.dataCategories,
    );
    createBy.data.subjectCountries = Service.readCountries(
      createBy.data.subjectCountries,
    );

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

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (data["allowedRegions"] !== undefined) {
      data["allowedRegions"] = Service.readRegions(data["allowedRegions"]);
    }

    if (data["dataCategories"] !== undefined) {
      data["dataCategories"] = Service.readCategories(data["dataCategories"]);
    }

    if (data["subjectCountries"] !== undefined) {
      data["subjectCountries"] = Service.readCountries(
        data["subjectCountries"],
      );
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      { _id: true, projectId: true },
    );

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
