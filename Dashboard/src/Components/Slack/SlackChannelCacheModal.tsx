import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
} from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon, {
  IconType,
  SizeProp,
  ThickProp,
} from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
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

type ChannelEntry = { name: string; id: string };

const SlackChannelCacheModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [isSaving, setIsSaving] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [rows, setRows] = React.useState<Array<ChannelEntry>>([]);

  const loadChannels: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(undefined);

      // Trigger server to cache and return channel cache
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get(
          URL.fromString(`${HOME_URL.toString()}/api/slack/get-all-channels`),
          ModelAPI.getCommonHeaders(),
        );

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const cacheObj: JSONObject = response.data || {};
      const newRows: Array<ChannelEntry> = Object.keys(cacheObj).map(
        (key: string) => {
          const value: any = (cacheObj as any)[key];
          // value may be either {id, name} or just {id}. Prefer id
          const id: string =
            (value?.id as string) || (value as any)?.toString?.() || "";
          return { name: key, id };
        },
      );
      // sort alphabetically by name
      newRows.sort((a: ChannelEntry, b: ChannelEntry) => {
        return a.name.localeCompare(b.name);
      });
      setRows(newRows);
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

  const addRow: () => void = (): void => {
    setRows((prev: Array<ChannelEntry>) => {
      return [{ name: "", id: "" }, ...prev];
    });
  };

  const updateRow: (
    index: number,
    field: keyof ChannelEntry,
    value: string,
  ) => void = (
    index: number,
    field: keyof ChannelEntry,
    value: string,
  ): void => {
    setRows((prev: Array<ChannelEntry>) => {
      const copy: Array<ChannelEntry> = [...prev];
      copy[index] = { ...copy[index], [field]: value } as ChannelEntry;
      return copy;
    });
  };

  const deleteRow: (index: number) => void = (index: number): void => {
    setRows((prev: Array<ChannelEntry>) => {
      return prev.filter((_: ChannelEntry, i: number) => {
        return i !== index;
      });
    });
  };

  const validationError: string | undefined = useMemo(() => {
    // Non-empty, unique names and ids
    const names: Set<string> = new Set<string>();
    const ids: Set<string> = new Set<string>();
    for (const r of rows) {
      const name: string = (r.name || "").trim();
      const id: string = (r.id || "").trim();
      if (!name || !id) {
        return "All rows must have a channel name and an ID.";
      }
      if (names.has(name)) {
        return `Duplicate channel name: ${name}`;
      }
      if (ids.has(id)) {
        return `Duplicate channel ID: ${id}`;
      }
      names.add(name);
      ids.add(id);
    }
    return undefined;
  }, [rows]);

  const onSave: () => Promise<void> = async (): Promise<void> => {
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      setIsSaving(true);
      setError(undefined);

      // Build channelCache shape compatible with SlackMiscData
      const channelCache: SlackMiscData["channelCache"] = {} as any;
      for (const r of rows) {
        (channelCache as any)[r.name.trim().toLowerCase()] = {
          id: r.id.trim(),
          name: r.name.trim(),
          lastUpdated: new Date().toISOString(),
        };
      }

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
        channelCache: channelCache,
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
      error={error || validationError}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Channel name is the key (e.g., #general without the #). Value is the
            Slack channel ID.
          </div>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none"
          >
            <Icon
              icon={IconProp.Add}
              size={SizeProp.Small}
              thick={ThickProp.Thick}
            />
            <span className="ml-2">Add Row</span>
          </button>
        </div>

        <div className="overflow-hidden rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Channel Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Channel ID
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-8 text-center text-sm text-gray-500"
                  >
                    No channels cached yet. Click &quot;Add Row&quot; to begin
                    or use &quot;View Channels&quot; to fetch from Slack.
                  </td>
                </tr>
              ) : (
                rows.map((row: ChannelEntry, idx: number) => {
                  return (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={row.name}
                          onChange={(
                            e: React.ChangeEvent<HTMLInputElement>,
                          ) => {
                            return updateRow(idx, "name", e.target.value);
                          }}
                          placeholder="incident-updates"
                          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={row.id}
                          onChange={(
                            e: React.ChangeEvent<HTMLInputElement>,
                          ) => {
                            return updateRow(idx, "id", e.target.value);
                          }}
                          placeholder="C0123456789"
                          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            return deleteRow(idx);
                          }}
                          className="inline-flex items-center rounded-md bg-white px-2 py-2 text-sm font-medium text-red-600 hover:bg-red-50 focus:outline-none"
                          title="Delete row"
                        >
                          <Icon icon={IconProp.Trash} size={SizeProp.Small} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-gray-400">
          Note: Saving will overwrite the current channel list with the rows
          above.
        </div>
      </div>
    </Modal>
  );
};

export default SlackChannelCacheModal;
