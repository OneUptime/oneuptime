import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { WorkspaceChannelRecordType } from "Common/Types/Workspace/WorkspaceChannelLink";
import WorkspaceChannelMembersUtil, {
  WorkspaceChannelAddAnswer,
  WorkspaceRecordChannels,
} from "Common/Types/Workspace/WorkspaceChannelMembers";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useCallback, useEffect, useState } from "react";

/*
 * The record's channels and the people in them, from the server
 * (WorkspaceChannelMembersAPI), and adding people to one. An answer that is
 * not a success throws, so the card can tell "nobody" from "could not ask".
 */
export async function fetchRecordChannelMembers(data: {
  recordType: WorkspaceChannelRecordType;
  recordId: ObjectID;
}): Promise<WorkspaceRecordChannels> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        WorkspaceChannelMembersUtil.getRoute(data),
      ),
      data: {},
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  return WorkspaceChannelMembersUtil.channelsFromJSON(response.jsonData);
}

// Has the OneUptime app invite people - and teams' people - into a channel.
export async function addPeopleToRecordChannel(data: {
  recordType: WorkspaceChannelRecordType;
  recordId: ObjectID;
  channelId: string;
  userIds?: Array<string> | undefined;
  teamIds?: Array<string> | undefined;
}): Promise<WorkspaceChannelAddAnswer> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        WorkspaceChannelMembersUtil.getAddRoute(data),
      ),
      data: {
        channelId: data.channelId,
        userIds: data.userIds || [],
        teamIds: data.teamIds || [],
      },
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  return WorkspaceChannelMembersUtil.addAnswerFromJSON(response.jsonData);
}

export interface RecordChannelMembersState {
  answer: WorkspaceRecordChannels | null;
  // The first read has not answered yet.
  isLoading: boolean;
  error: string;
  refresh: () => void;
}

/*
 * The card's data. It is read when the card first shows, again whenever
 * `readKey` changes (the record got another channel), and on refresh() -
 * after people were added. A refresh keeps the last answer on screen until
 * the new one arrives. Nothing is read while `isEnabled` is false: a record
 * without a channel of its own - most of them - costs the page no request.
 */
export default function useRecordChannelMembers(data: {
  recordType: WorkspaceChannelRecordType;
  recordId: ObjectID;
  readKey: string;
  isEnabled: boolean;
}): RecordChannelMembersState {
  const recordKey: string = `${data.recordType}:${data.recordId.toString()}`;
  const [loaded, setLoaded] = useState<{
    recordKey: string;
    answer: WorkspaceRecordChannels | null;
    error: string;
  } | null>(null);
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    if (!data.isEnabled) {
      return;
    }

    let isCurrent: boolean = true;

    fetchRecordChannelMembers({
      recordType: data.recordType,
      recordId: data.recordId,
    })
      .then((answer: WorkspaceRecordChannels) => {
        if (isCurrent) {
          setLoaded({ recordKey, answer, error: "" });
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setLoaded({
            recordKey,
            answer: null,
            error: API.getFriendlyMessage(err),
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [recordKey, data.readKey, data.isEnabled, attempt]);

  const refresh: () => void = useCallback((): void => {
    setAttempt((current: number) => {
      return current + 1;
    });
  }, []);

  const isCurrentRecord: boolean = Boolean(
    loaded && loaded.recordKey === recordKey,
  );

  return {
    answer: isCurrentRecord ? loaded!.answer : null,
    isLoading: !isCurrentRecord,
    error: isCurrentRecord ? loaded!.error : "",
    refresh: refresh,
  };
}
