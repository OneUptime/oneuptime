import DatabaseService from "./DatabaseService";
import NetworkDeviceService from "./NetworkDeviceService";
import NetworkSiteService from "./NetworkSiteService";
import Model from "../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import Query from "../Types/Database/Query";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import {
  SnmpCredentialCarrier,
  hasUsableCredentials,
} from "../../Utils/NetworkDevice/SnmpCredentialUtil";

/*
 * A profile is a row of credentials that other rows point at, and most of
 * what is interesting about it happens elsewhere: the poller resolves it
 * (device columns, then device profile, then site profile), the model's
 * column access control keeps its secrets from the roles that may not read
 * them, and DatabaseService encrypts those secrets at rest. There is no
 * fan-out on edit because nothing is copied out of a profile - a device
 * using one is walked with whatever the profile says at poll time.
 *
 * The service owns two things.
 *
 * THE NAME. It is unique per project and it is the label every device and
 * site listing shows for the profile it joins, so a trailing space must not
 * be what makes "Branch v2c" and "Branch v2c " two different profiles, and a
 * blank one must not get past the required check by being three spaces long.
 *
 * THE DELETE GUARD. Both foreign keys onto this table are ON DELETE SET NULL,
 * so deleting a profile that devices or sites still use does not fail - it
 * silently drops every one of them down the resolution order, and a device
 * whose site has no profile either goes from walked to ping-only on its next
 * poll with nothing anywhere to say why. Refuse instead, and say how many
 * devices and sites are in the way. Sites count separately from devices
 * because a site can hold the last reference to a profile while no device
 * points at it directly - that is exactly what "set it once per site" means.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * "Does this profile carry enough to open an SNMP session with?" -
   * delegated to the pure util so the poller can ask the same question of a
   * device row with the same function. Exposed here so a caller holding the
   * service does not have to know where the predicate lives.
   */
  public hasUsableCredentials(profile: SnmpCredentialCarrier): boolean {
    return hasUsableCredentials(profile);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.name = this.normalizeName(createBy.data.name);

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * `!== undefined` rather than a truthiness check: an update that does not
     * mention the name (a description edit, a rotated community string) must
     * leave it alone, while an update that sets it to "" or null is a blank
     * name and is refused the same way a blank create is.
     */
    if (updateBy.data.name !== undefined) {
      updateBy.data.name = this.normalizeName(updateBy.data.name);
    }

    return { updateBy, carryForward: null };
  }

  /*
   * Refuse to delete a profile that any device or any site still points at.
   *
   * Counting rather than keeping a rollup column is deliberate - a maintained
   * counter would make this row hot under every device create and rebind,
   * and NetworkDeviceOidTemplateService set the precedent for exactly this
   * guard. Both counts are always taken and both are always reported, so
   * the operator learns in one message everything that has to move before
   * the delete can go through, rather than clearing the devices and then
   * being told about the sites.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const profilesToDelete: Array<Model> = await this.findBy({
      /*
       * This hook runs BEFORE DatabaseService permission-checks the query, so
       * a raw isRoot read of deleteBy.query would hand back other tenants'
       * profiles. Re-apply the caller's tenant, exactly as NetworkSiteService
       * and NetworkDeviceOidTemplateService do for the same reason.
       */
      query: this.scopeQueryToCallerTenant(deleteBy.query, deleteBy.props),
      select: {
        _id: true,
        name: true,
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const profile of profilesToDelete) {
      if (!profile.id || !profile.projectId) {
        continue;
      }

      const [linkedDeviceCount, linkedSiteCount]: [number, number] =
        await Promise.all([
          this.countLinkedDevices({
            profileId: profile.id,
            projectId: profile.projectId,
          }),
          this.countLinkedSites({
            profileId: profile.id,
            projectId: profile.projectId,
          }),
        ]);

      if (linkedDeviceCount > 0 || linkedSiteCount > 0) {
        throw new BadDataException(
          `This SNMP Credential Profile is used by ${linkedDeviceCount} devices and ${linkedSiteCount} sites. Remove it from them first, or point them at another profile.`,
        );
      }
    }

    return { deleteBy, carryForward: null };
  }

  /**
   * How many devices point at this profile directly. Used by the delete
   * guard above and available to the profile page.
   *
   * Read as root, scoped to the profile's own project: the caller who may
   * delete a profile is not necessarily allowed to read every device, and a
   * partial count would let the delete through with devices still attached.
   */
  @CaptureSpan()
  public async countLinkedDevices(data: {
    profileId: ObjectID;
    projectId: ObjectID;
  }): Promise<number> {
    const count: PositiveNumber = await NetworkDeviceService.countBy({
      query: {
        projectId: data.projectId,
        snmpCredentialProfileId: data.profileId,
      },
      props: {
        isRoot: true,
      },
    });

    return count.toNumber();
  }

  /**
   * How many sites carry this profile as their default. Same shape and same
   * reasoning as countLinkedDevices.
   */
  @CaptureSpan()
  public async countLinkedSites(data: {
    profileId: ObjectID;
    projectId: ObjectID;
  }): Promise<number> {
    const count: PositiveNumber = await NetworkSiteService.countBy({
      query: {
        projectId: data.projectId,
        snmpCredentialProfileId: data.profileId,
      },
      props: {
        isRoot: true,
      },
    });

    return count.toNumber();
  }

  /*
   * See NetworkSiteService for the full explanation: hooks run before
   * ModelPermission scopes the caller's query, so anything a hook reads with
   * isRoot has to be re-scoped by hand or it spans projects.
   */
  private scopeQueryToCallerTenant(
    query: Query<Model>,
    props: DatabaseCommonInteractionProps,
  ): Query<Model> {
    if (props.isRoot || !props.tenantId) {
      return query;
    }

    return {
      ...query,
      projectId: props.tenantId,
    };
  }

  /*
   * The name as it will be stored, or a BadDataException. Only a plain string
   * is accepted: the column is also used as a label, and a raw SQL expression
   * (the other shape PartialEntity allows) has no business being one.
   */
  private normalizeName(name: unknown): string {
    if (typeof name !== "string") {
      throw new BadDataException("SNMP Credential Profile name is required.");
    }

    const trimmed: string = name.trim();

    if (!trimmed) {
      throw new BadDataException(
        "SNMP Credential Profile name cannot be blank.",
      );
    }

    return trimmed;
  }
}

export default new Service();
