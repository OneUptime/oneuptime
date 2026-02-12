import React, { FunctionComponent, ReactElement, useEffect } from "react";
import Modal from "Common/UI/Components/Modal/Modal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dictionary from "Common/UI/Components/Dictionary/Dictionary";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import { HOME_URL } from "Common/UI/Config";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  projectAuthTokenId: ObjectID;
  onClose: VoidFunction;
}

const SlackChannelCacheModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [isSaving, setIsSaving] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [channelCache, setChannelCache] = React.useState<{
    [channelName: string]: string;
  }>({});

  const loadChannels: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(undefined);

      // Trigger server to cache and return channel cache
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get({
          url: URL.fromString(
            `${HOME_URL.toString()}/api/slack/get-all-channels`,
          ).addQueryParam("workspaceProjectAuthTokenId", props.projectAuthTokenId.toString()),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const cacheObj: JSONObject = response.data || {};
      const newChannelCache: { [channelName: string]: string } = {};

      Object.keys(cacheObj).forEach((key: string) => {
        const value: any = (cacheObj as any)[key];
        // value may be either {id, name} or just {id}. Prefer id
        const id: string =
          (value?.id as string) || (value as any)?.toString?.() || "";
        newChannelCache[key] = id;
      });

      setChannelCache(newChannelCache);
    } catch (e: unknown) {
      setError(API.getFriendlyErrorMessage(e as Exception));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChannels().catch((e: unknown) => {
      setError(API.getFriendlyErrorMessage(e as Exception));
    });
  }, []);

  const onSave: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsSaving(true);
      setError(undefined);

      // Build channelCache shape compatible with SlackMiscData
      const channelCacheObj: SlackMiscData["channelCache"] = {} as any;
      Object.keys(channelCache).forEach((channelName: string) => {
        const channelId: string = channelCache[channelName] || "";
        if (channelName.trim() && channelId.trim()) {
          (channelCacheObj as any)[channelName.trim().toLowerCase()] = {
            id: channelId.trim(),
            name: channelName.trim(),
            lastUpdated: new Date().toISOString(),
          };
        }
      });

      // Merge into miscData (preserve existing fields)
      const existing: WorkspaceProjectAuthToken | null = await ModelAPI.getItem(
        {
          modelType: WorkspaceProjectAuthToken,
          id: props.projectAuthTokenId,
          select: { miscData: true },
        },
      );

      const newMisc: SlackMiscData = {
        ...(existing?.miscData as SlackMiscData),
        channelCache: channelCacheObj,
      } as SlackMiscData;

      await ModelAPI.updateById<WorkspaceProjectAuthToken>({
        modelType: WorkspaceProjectAuthToken,
        id: props.projectAuthTokenId,
        data: { miscData: newMisc as unknown as JSONObject },
      });

      props.onClose();
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title="Slack Channels"
      description={`View and edit the cached list of Slack channels for this workspace. Add, edit, or delete entries.`}
      onClose={props.onClose}
      onSubmit={onSave}
      submitButtonText="Save Changes"
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      isBodyLoading={isLoading}
      isLoading={isSaving}
      error={error}
    >
      <div className="space-y-4">
        <div className="text-sm text-gray-600">
          Channel name is the key (e.g., #general without the #). Value is the
          Slack channel ID.
        </div>

        <Dictionary
          initialValue={channelCache}
          onChange={(value: { [key: string]: string | boolean | number }) => {
            setChannelCache(value as { [channelName: string]: string });
          }}
          keyPlaceholder="incident-updates"
          valuePlaceholder="C0123456789"
          addButtonSuffix="Channel"
        />

        <div className="text-xs text-gray-400">
          Note: Saving will overwrite the current channel list with the entries
          above.
        </div>
      </div>
    </Modal>
  );
};

export default SlackChannelCacheModal;
