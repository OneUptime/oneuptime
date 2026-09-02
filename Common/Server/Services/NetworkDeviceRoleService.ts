import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/NetworkDeviceRole";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import { buildUniqueDeviceRoleKey } from "../../Utils/NetworkDevice/DeviceRoleKeyUtil";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Every role gets its stable key here, and only here.
   *
   * The key is not a form field - an operator names a role, they do not name
   * its identifier - and it must never change afterwards, because it is what
   * the SNMP classifier's answer and every stored topology payload match
   * against. Deriving it at create time is therefore the whole of its
   * lifecycle: the column's ColumnAccessControl grants create and update to
   * nobody, so the API cannot set or move it either.
   *
   * The seeders pass an explicit key so the eleven built-in roles keep the
   * exact identifiers the classifier emits ("wirelessAccessPoint" from
   * "Wireless AP", which no derivation would produce). Anything else derives
   * one from the name, de-duplicated against the keys the project already
   * holds.
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.key) {
      const projectId: ObjectID | undefined =
        createBy.data.projectId || createBy.props.tenantId || undefined;

      if (!projectId) {
        throw new BadDataException(
          "Project ID is required to create a network device role.",
        );
      }

      createBy.data.key = buildUniqueDeviceRoleKey(
        createBy.data.name || "",
        await this.getKeysInProject(projectId),
      );
    }

    return {
      createBy: createBy,
      carryForward: undefined,
    };
  }

  /**
   * Every role key already in use in this project, for uniqueness checks.
   *
   * Read as root: a member who may create a role must get a key that does not
   * collide with one they are not allowed to see, and a partial view of the
   * project's keys would hand them a duplicate the database then rejects.
   */
  public async getKeysInProject(projectId: ObjectID): Promise<Set<string>> {
    const existing: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
      },
      select: {
        key: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    const keys: Set<string> = new Set<string>();

    for (const role of existing) {
      if (role.key) {
        keys.add(role.key);
      }
    }

    return keys;
  }
}

export default new Service();
