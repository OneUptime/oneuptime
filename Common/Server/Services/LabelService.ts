import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Color from "../../Types/Color";
import { BrightColors } from "../../Types/BrandColors";
import GlobalCache from "../Infrastructure/GlobalCache";
import Model from "../../Models/DatabaseModels/Label";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

const AUTO_LABEL_ID_CACHE_NAMESPACE: string = "auto-label-id";
const AUTO_LABEL_ID_CACHE_TTL_SECONDS: number = 24 * 60 * 60;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    let projectId: ObjectID | undefined = createBy.props.tenantId;

    if (createBy.props.isMasterAdmin || createBy.props.isRoot) {
      if (createBy.data.projectId) {
        projectId = createBy.data.projectId;
      }
    }

    if (!projectId) {
      throw new BadDataException("Project ID is required to create a label.");
    }

    let existingProjectWithSameNameCount: number = 0;

    existingProjectWithSameNameCount = (
      await this.countBy({
        query: {
          name: QueryHelper.findWithSameText(createBy.data.name!),
          projectId: projectId,
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    if (existingProjectWithSameNameCount > 0) {
      throw new BadDataException(
        "Label with the same name already exists in this project.",
      );
    }

    return Promise.resolve({ createBy, carryForward: null });
  }

  /**
   * Find existing labels by name (case-insensitive) or auto-create
   * them, returning the ObjectIDs in the same order as the input.
   * Used by the OTel ingest pipeline to promote
   * `oneuptime.label.<dim>=<val>` resource attributes into project
   * labels attached to the discovered host or service.
   *
   * Names are matched case-insensitively, so an OTel attribute of
   * `production` will resolve to a manually-created `Production`
   * label rather than spawning a duplicate. New labels are colored
   * deterministically from the BrightColors palette so re-creating
   * the same label across processes lands on the same color.
   *
   * Resolved IDs are cached per (project, name) for 24h, so the
   * common case (steady-state collector pushing the same labels
   * every batch) is a single in-memory lookup.
   */
  @CaptureSpan()
  public async findOrCreateLabelsByNames(data: {
    projectId: ObjectID;
    labelNames: Array<string>;
  }): Promise<Array<ObjectID>> {
    if (!data.labelNames || data.labelNames.length === 0) {
      return [];
    }

    const result: Array<ObjectID> = [];
    const seenInBatch: Set<string> = new Set();

    for (const rawName of data.labelNames) {
      const name: string = (rawName || "").trim();
      if (!name) {
        continue;
      }

      const dedupeKey: string = name.toLowerCase();
      if (seenInBatch.has(dedupeKey)) {
        continue;
      }
      seenInBatch.add(dedupeKey);

      const cacheKey: string = `${data.projectId.toString()}:${dedupeKey}`;
      let idStr: string | null = await GlobalCache.getString(
        AUTO_LABEL_ID_CACHE_NAMESPACE,
        cacheKey,
      );

      if (!idStr) {
        const id: ObjectID | null = await this.findOrCreateLabelByName(
          data.projectId,
          name,
        );
        if (!id) {
          continue;
        }
        idStr = id.toString();
        await GlobalCache.setString(
          AUTO_LABEL_ID_CACHE_NAMESPACE,
          cacheKey,
          idStr,
          { expiresInSeconds: AUTO_LABEL_ID_CACHE_TTL_SECONDS },
        );
      }

      result.push(new ObjectID(idStr));
    }

    return result;
  }

  private async findOrCreateLabelByName(
    projectId: ObjectID,
    name: string,
  ): Promise<ObjectID | null> {
    const existing: Model | null = await this.findOneBy({
      query: {
        projectId: projectId,
        name: QueryHelper.findWithSameText(name),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (existing?._id) {
      return new ObjectID(existing._id.toString());
    }

    try {
      const newLabel: Model = new Model();
      newLabel.projectId = projectId;
      newLabel.name = name;
      newLabel.color = pickColorForLabelName(name);

      const created: Model = await this.create({
        data: newLabel,
        props: { isRoot: true },
      });

      if (created._id) {
        return new ObjectID(created._id.toString());
      }
      return null;
    } catch {
      /*
       * Either two ingest workers raced to create the same label, or
       * a label with this name in a different case existed and the
       * onBeforeCreate dup-check rejected the insert. Re-resolve
       * case-insensitively so the caller still gets a valid id.
       */
      const refetched: Model | null = await this.findOneBy({
        query: {
          projectId: projectId,
          name: QueryHelper.findWithSameText(name),
        },
        select: { _id: true },
        props: { isRoot: true },
      });
      if (refetched?._id) {
        return new ObjectID(refetched._id.toString());
      }
      return null;
    }
  }
}

function pickColorForLabelName(name: string): Color {
  if (BrightColors.length === 0) {
    return Color.fromString("#3686be");
  }
  let hash: number = 0;
  for (let i: number = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const idx: number = Math.abs(hash) % BrightColors.length;
  return BrightColors[idx]!;
}

export default new Service();
