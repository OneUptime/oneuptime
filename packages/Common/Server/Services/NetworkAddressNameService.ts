import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/NetworkAddressName";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import { NetworkAddressNameUtil } from "../../Types/NetFlow/NetworkAddressName";
import ObjectID from "../../Types/ObjectID";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../Utils/NetworkTraffic/NetworkAddressBlock";

/*
 * Address Names (Network > Settings, and "Name this address" on a Traffic
 * page): checked and written one way when saved, so what is stored is what
 * a page can match.
 *
 *   - The address is one IP address or a subnet, kept as
 *     NetworkAddressBlockUtil writes it ("2001:DB8::5" is "2001:db8::5",
 *     "10.18.167.35/24" is "10.18.167.0/24"). Anything else - a host name,
 *     a range with a dash, a port - is refused with what to write instead.
 *   - The name is one line of text (NetworkAddressNameUtil.cleanName).
 *   - Each address or subnet is named once in a project; a second name for
 *     it says which name it already has.
 */

export const ADDRESS_NAME_ADDRESS_REQUIRED_MESSAGE: string =
  "Enter the IP address or subnet to name, like 10.0.0.5 or 10.18.167.0/24.";

export const ADDRESS_NAME_ADDRESS_INVALID_MESSAGE: string =
  "That is not an IP address or a subnet. Enter one address, like 10.0.0.5 or 2001:db8::5, or a subnet, like 10.18.167.0/24.";

export const ADDRESS_NAME_NAME_REQUIRED_MESSAGE: string =
  "Enter a name for the address.";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  // An address or subnet as it is kept, or a 400 that says what to write.
  public static readAddress(value: unknown): string {
    if (value === undefined || value === null || value === "") {
      throw new BadDataException(ADDRESS_NAME_ADDRESS_REQUIRED_MESSAGE);
    }

    const block: NetworkAddressBlock | null =
      NetworkAddressBlockUtil.parse(value);

    if (!block) {
      throw new BadDataException(ADDRESS_NAME_ADDRESS_INVALID_MESSAGE);
    }

    return block.text;
  }

  // A name as it is kept, or a 400.
  public static readName(value: unknown): string {
    const name: string | null = NetworkAddressNameUtil.cleanName(value);

    if (!name) {
      throw new BadDataException(ADDRESS_NAME_NAME_REQUIRED_MESSAGE);
    }

    return name;
  }

  /*
   * A second name for an address the project already named, refused with
   * the name it has - read as root, so the answer is the same for whoever
   * asks (the unique check after this one would refuse it anyway, with a
   * sentence that says less).
   */
  private async assertNotNamedYet(data: {
    projectId: ObjectID | undefined;
    address: string;
    exceptId?: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      return;
    }

    const existing: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        address: data.address,
      },
      select: {
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      existing &&
      (!data.exceptId ||
        existing.id?.toString() !== data.exceptId.toString())
    ) {
      throw new BadDataException(
        `${data.address} already has a name: ${existing.name || ""}. Change that one instead.`,
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.address = Service.readAddress(createBy.data.address);
    createBy.data.name = Service.readName(createBy.data.name);

    await this.assertNotNamedYet({
      projectId: createBy.data.projectId || createBy.props.tenantId,
      address: createBy.data.address,
    });

    return { createBy, carryForward: null };
  }

  /*
   * An edit is checked the way a new name is. Only what it changes: the
   * address it moves to must not be named already (the row it moves from
   * is the only one allowed to hold it).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Record<string, unknown> = (updateBy.data || {}) as Record<
      string,
      unknown
    >;

    if (Object.prototype.hasOwnProperty.call(data, "name")) {
      data["name"] = Service.readName(data["name"]);
    }

    if (Object.prototype.hasOwnProperty.call(data, "address")) {
      const address: string = Service.readAddress(data["address"]);
      data["address"] = address;

      const query: Record<string, unknown> = (updateBy.query || {}) as Record<
        string,
        unknown
      >;
      const id: unknown = query["_id"];

      await this.assertNotNamedYet({
        projectId: updateBy.props.tenantId,
        address: address,
        exceptId:
          id instanceof ObjectID
            ? id
            : typeof id === "string" && ObjectID.isValidUUID(id)
              ? new ObjectID(id)
              : undefined,
      });
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
