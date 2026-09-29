import React, { FunctionComponent, ReactElement, useEffect } from "react";
import Modal from "Common/UI/Components/Modal/Modal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dictionary from "Common/UI/Components/Dictionary/Dictionary";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import { HOME_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
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
          ),
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

      /*
       * The server builds the stored cache from this name -> id map and
       * writes only the channel cache (miscData is not editable through
       * the CRUD API).
       */
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.put({
          url: URL.fromString(`${HOME_URL.toString()}/api/slack/channel-cache`),
          data: { channels: channelCache },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

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
          onChange={(value: { [key: string]: unknown }) => {
            /*
             * Slack channel cache is a flat string→string map; flatten
             * any incoming entries (operators are not enabled here).
             */
            const flattened: { [channelName: string]: string } = {};
            for (const key of Object.keys(value)) {
              const entry: unknown = value[key];
              if (entry === undefined || entry === null) {
                continue;
              }
              flattened[key] = String(entry);
            }
            setChannelCache(flattened);
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
