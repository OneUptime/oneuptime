import IncomingCallLogService from "./IncomingCallLogService";
import ProjectReferencesService from "./ProjectReferencesService";
import IncomingCallLog from "../../Models/DatabaseModels/IncomingCallLog";
import IncomingCallLogItem from "../../Models/DatabaseModels/IncomingCallLogItem";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends ProjectReferencesService<IncomingCallLogItem> {
  public constructor() {
    super(IncomingCallLogItem);
  }

  /*
   * Call log items are written by OneUptime while it routes an incoming call,
   * for the escalation rule and the person it is ringing - who may have left
   * the project since. Refusing one would break the call. A call log item
   * written by an API call is checked like any other write.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /*
   * AN ATTEMPT BELONGS TO THE POLICY ITS CALL BELONGS TO. Each attempt to
   * reach someone during a call is read with the incoming call policy whose
   * number took the call (IncomingCallLogItem's @OwnedThrough), so it names
   * that policy - the one its call names, read as OneUptime from the call it
   * is written for, whatever the write itself sent for it. An attempt is
   * never read with another policy than its call's.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<IncomingCallLogItem>,
  ): Promise<OnCreate<IncomingCallLogItem>> {
    await super.onBeforeCreate(createBy);

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    const incomingCallLogId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      ["incomingCallLogId", "incomingCallLog"],
      "Incoming Call Log",
    );

    const callLog: IncomingCallLog | null = incomingCallLogId
      ? await IncomingCallLogService.findOneById({
          id: incomingCallLogId,
          select: {
            incomingCallPolicyId: true,
          },
          props: {
            isRoot: true,
          },
        })
      : null;

    if (callLog?.incomingCallPolicyId) {
      RelationIdUtil.stamp(
        data,
        ["incomingCallPolicyId", "incomingCallPolicy"],
        callLog.incomingCallPolicyId,
      );
    } else {
      // No call to take it from: the write names no policy of its own either.
      RelationIdUtil.leaveOut(data, [
        "incomingCallPolicyId",
        "incomingCallPolicy",
      ]);
    }

    return { createBy, carryForward: null };
  }
}

export default new Service();
