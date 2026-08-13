import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/NetworkDeviceLink";
import NetworkDeviceService from "./NetworkDeviceService";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import { OnCreate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import LIMIT_MAX from "../../Types/Database/LimitMax";

// Both spellings of each end, for the same reason RelationIdUtil exists.
const FROM_DEVICE_KEYS: Array<string> = ["fromDeviceId", "fromDevice"];
const TO_DEVICE_KEYS: Array<string> = ["toDeviceId", "toDevice"];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Two guards, both about links that would be nonsense on the map:
   *
   *   - a device may not link to itself. The topology builder drops
   *     self-edges anyway (the same rule LLDP self-reports hit), so such a
   *     row would be invisible and permanently confusing.
   *   - both ends must belong to the creating project. The FKs only require
   *     the rows to exist, so without this a tenant could draw a line to
   *     another project's device and read its name off the map.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    const fromDeviceId: ObjectID | null = RelationIdUtil.read(
      data,
      FROM_DEVICE_KEYS,
    );
    const toDeviceId: ObjectID | null = RelationIdUtil.read(
      data,
      TO_DEVICE_KEYS,
    );

    if (!fromDeviceId || !toDeviceId) {
      throw new BadDataException("A link needs a device at each end.");
    }

    if (fromDeviceId.toString() === toDeviceId.toString()) {
      throw new BadDataException("A device cannot be linked to itself.");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Project ID is required.");
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        _id: QueryHelper.any([fromDeviceId.toString(), toDeviceId.toString()]),
        projectId: createBy.data.projectId,
      },
      select: { _id: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    if (devices.length !== 2) {
      throw new BadDataException(
        "Both devices must exist and belong to this project.",
      );
    }

    return { createBy, carryForward: null };
  }
}

export default new Service();
