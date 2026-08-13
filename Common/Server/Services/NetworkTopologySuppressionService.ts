import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/NetworkTopologySuppression";
import { OnCreate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import LIMIT_MAX from "../../Types/Database/LimitMax";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Hiding a node twice is a no-op the UI should not have to guard against —
   * a second click, two people on the same map — so a duplicate is rejected
   * rather than quietly creating a second row that would then need deleting
   * twice to restore the node.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const nodeKey: string | undefined = createBy.data.nodeKey?.trim();

    if (!nodeKey) {
      throw new BadDataException("Node key is required.");
    }

    createBy.data.nodeKey = nodeKey;

    if (!createBy.data.projectId) {
      throw new BadDataException("Project ID is required.");
    }

    const existing: Model | null = await this.findOneBy({
      query: {
        projectId: createBy.data.projectId,
        nodeKey: nodeKey,
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (existing) {
      throw new BadDataException("This node is already hidden from the map.");
    }

    return { createBy, carryForward: null };
  }

  /*
   * The node keys hidden in a project, for the topology builder. Returns a
   * Set so the builder's per-node lookup stays O(1).
   */
  @CaptureSpan()
  public async getSuppressedNodeKeys(data: {
    projectId: Model["projectId"];
  }): Promise<Set<string>> {
    if (!data.projectId) {
      return new Set<string>();
    }

    const rows: Array<Model> = await this.findBy({
      query: { projectId: data.projectId },
      select: { nodeKey: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    return new Set<string>(
      rows
        .map((row: Model) => {
          return row.nodeKey || "";
        })
        .filter((key: string) => {
          return key.length > 0;
        }),
    );
  }
}

export default new Service();
