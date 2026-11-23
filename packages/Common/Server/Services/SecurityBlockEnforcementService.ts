import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityBlockEnforcement";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import { SecurityBlockEnforcementState } from "../../Types/SecurityBlocklist/SecurityBlockEnforcement";

/*
 * Where each block is enforced (#10338): one row per block and destination,
 * written by the reconciler alone (SecurityBlocklistReconciler) and read by
 * whoever reads the blocklist. Nobody else writes one - the model gives no
 * role a write - so nothing here checks a person's write.
 */

// The most rows one read of a project's enforcement returns.
export const SECURITY_BLOCK_ENFORCEMENT_READ_LIMIT: number = 20000;

const ENFORCEMENT_SELECT: {
  _id: true;
  projectId: true;
  securityBlockId: true;
  destinationKey: true;
  destinationName: true;
  provider: true;
  connectionId: true;
  state: true;
  appliedAt: true;
  lastConfirmedAt: true;
  providerRef: true;
  error: true;
  errorReason: true;
  failedAttempts: true;
  retryAt: true;
} = {
  _id: true,
  projectId: true,
  securityBlockId: true,
  destinationKey: true,
  destinationName: true,
  provider: true,
  connectionId: true,
  state: true,
  appliedAt: true,
  lastConfirmedAt: true,
  providerRef: true,
  error: true,
  errorReason: true,
  failedAttempts: true,
  retryAt: true,
};

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The reconciler's rows name only blocks it read itself: refusing one
   * would lose what a destination holds.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /*
   * The rows the reconciler works on for a project: every row not yet
   * removed, and every row of the blocks in force (a destination that comes
   * back after it was gone has its rows of them brought back).
   */
  @CaptureSpan()
  public async findForReconcile(data: {
    projectId: ObjectID;
    activeBlockIds: Array<ObjectID>;
  }): Promise<Array<Model>> {
    const [unsettled, ofActive]: [Array<Model>, Array<Model>] =
      await Promise.all([
        this.findBy({
          query: {
            projectId: data.projectId,
            state: QueryHelper.notEquals(SecurityBlockEnforcementState.Removed),
          },
          select: ENFORCEMENT_SELECT,
          skip: 0,
          limit: SECURITY_BLOCK_ENFORCEMENT_READ_LIMIT,
          props: { isRoot: true },
        }),
        data.activeBlockIds.length === 0
          ? Promise.resolve([])
          : this.findBy({
              query: {
                projectId: data.projectId,
                securityBlockId: QueryHelper.any(data.activeBlockIds),
                state: SecurityBlockEnforcementState.Removed,
              },
              select: ENFORCEMENT_SELECT,
              skip: 0,
              limit: SECURITY_BLOCK_ENFORCEMENT_READ_LIMIT,
              props: { isRoot: true },
            }),
      ]);

    return [...unsettled, ...ofActive];
  }

  // A block's rows, as a page or a step reads where it is enforced.
  @CaptureSpan()
  public async findForBlocks(data: {
    projectId: ObjectID;
    securityBlockIds: Array<ObjectID>;
  }): Promise<Array<Model>> {
    if (data.securityBlockIds.length === 0) {
      return [];
    }

    return await this.findBy({
      query: {
        projectId: data.projectId,
        securityBlockId: QueryHelper.any(data.securityBlockIds),
      },
      select: ENFORCEMENT_SELECT,
      skip: 0,
      limit: SECURITY_BLOCK_ENFORCEMENT_READ_LIMIT,
      props: { isRoot: true },
    });
  }
}

export default new Service();
