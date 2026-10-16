import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import WorkspaceChannelMembers from "../Utils/Workspace/WorkspaceChannelMembers";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import WorkspaceChannelLinkUtil, {
  WorkspaceChannelRecordType,
} from "../../Types/Workspace/WorkspaceChannelLink";
import WorkspaceChannelMembersUtil, {
  WORKSPACE_CHANNEL_ADD_MAX_TEAMS,
  WORKSPACE_CHANNEL_ADD_MAX_USERS,
  WORKSPACE_CHANNEL_MEMBERS_ADD_PATH,
  WORKSPACE_CHANNEL_MEMBERS_ROUTE,
  WorkspaceChannelAddAnswer,
  WorkspaceRecordChannels,
} from "../../Types/Workspace/WorkspaceChannelMembers";

/*
 * WHO IS IN A RECORD'S OWN CHANNEL, AND ADDING PEOPLE TO IT
 * (WorkspaceChannelMembers).
 *
 * GET /workspace-channel-members/<record type>/<record id>
 *   The record's Slack and Microsoft Teams channels, the people in each and
 *   whether the caller is one of them, and whether the caller may add
 *   people: { canAddPeople, channels: [...] }. For whoever can read the
 *   record - it is read with their own permissions first.
 *
 * POST /workspace-channel-members/<record type>/<record id>/add
 *   { channelId, userIds?, teamIds? }: adds those people, and everybody in
 *   those teams, to one of the record's own Slack channels, and answers for
 *   each: { channelState?, results: [{ userId, name, outcome }] }. For a
 *   signed-in member of the project who may edit the record.
 */
const router: ExpressRouter = Express.getRouter();

// The record type and id in the path, checked before anything is read.
const readRecord: (req: ExpressRequest) => {
  recordType: WorkspaceChannelRecordType;
  recordId: ObjectID;
} = (
  req: ExpressRequest,
): { recordType: WorkspaceChannelRecordType; recordId: ObjectID } => {
  const recordType: unknown = req.params["recordType"];

  if (!WorkspaceChannelLinkUtil.isRecordType(recordType)) {
    throw new BadDataException(
      `Unknown record type. Use one of: ${Object.values(
        WorkspaceChannelRecordType,
      ).join(", ")}.`,
    );
  }

  const recordIdText: string = String(req.params["recordId"] || "");

  if (!ObjectID.isValidUUID(recordIdText)) {
    throw new BadDataException("The record id is not a valid id.");
  }

  return { recordType: recordType, recordId: new ObjectID(recordIdText) };
};

// A list of ids in the body: each must be an id, and there may be `max` of them.
const readIds: (data: {
  body: JSONObject;
  key: string;
  max: number;
}) => Array<ObjectID> = (data: {
  body: JSONObject;
  key: string;
  max: number;
}): Array<ObjectID> => {
  const value: unknown = data.body[data.key];

  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new BadDataException(`${data.key} must be a list of ids.`);
  }

  if (value.length > data.max) {
    throw new BadDataException(
      `${data.key} may name at most ${data.max} at a time.`,
    );
  }

  return value.map((item: unknown): ObjectID => {
    if (typeof item !== "string" || !ObjectID.isValidUUID(item)) {
      throw new BadDataException(`${data.key} must be a list of ids.`);
    }

    return new ObjectID(item);
  });
};

router.get(
  `${WORKSPACE_CHANNEL_MEMBERS_ROUTE}/:recordType/:recordId`,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      CommonAPI.assertTenantScoped(props);

      const record: {
        recordType: WorkspaceChannelRecordType;
        recordId: ObjectID;
      } = readRecord(req);

      const answer: WorkspaceRecordChannels = await WorkspaceChannelMembers.read(
        {
          recordType: record.recordType,
          recordId: record.recordId,
          props: props,
        },
      );

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        WorkspaceChannelMembersUtil.channelsToJSON(answer),
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  `${WORKSPACE_CHANNEL_MEMBERS_ROUTE}/:recordType/:recordId/${WORKSPACE_CHANNEL_MEMBERS_ADD_PATH}`,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      // A person adds people: the feed says who.
      CommonAPI.assertAuthenticatedProjectMember(props);

      const record: {
        recordType: WorkspaceChannelRecordType;
        recordId: ObjectID;
      } = readRecord(req);

      const body: JSONObject =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as JSONObject)
          : {};

      const channelId: unknown = body["channelId"];

      if (typeof channelId !== "string" || !channelId.trim()) {
        throw new BadDataException("channelId is required.");
      }

      const userIds: Array<ObjectID> = readIds({
        body: body,
        key: "userIds",
        max: WORKSPACE_CHANNEL_ADD_MAX_USERS,
      });
      const teamIds: Array<ObjectID> = readIds({
        body: body,
        key: "teamIds",
        max: WORKSPACE_CHANNEL_ADD_MAX_TEAMS,
      });

      if (userIds.length === 0 && teamIds.length === 0) {
        throw new BadDataException("Name at least one person or team to add.");
      }

      const answer: WorkspaceChannelAddAnswer = await WorkspaceChannelMembers.add(
        {
          recordType: record.recordType,
          recordId: record.recordId,
          props: props,
          channelId: channelId.trim(),
          userIds: userIds,
          teamIds: teamIds,
        },
      );

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        WorkspaceChannelMembersUtil.addAnswerToJSON(answer),
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
