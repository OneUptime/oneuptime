import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

interface TeamItem {
  id: string;
  name: string;
}

interface ChannelItem {
  id: string;
  name: string;
}

const MicrosoftTeamsChannelsCard: FunctionComponent = (): ReactElement => {
  const [teams, setTeams] = useState<Array<TeamItem>>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [channels, setChannels] = useState<Array<ChannelItem>>([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState<boolean>(true);
  const [isLoadingChannels, setIsLoadingChannels] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const loadChannels: (teamId: string) => Promise<void> = async (
    teamId: string,
  ): Promise<void> => {
    if (!teamId) {
      setChannels([]);
      return;
    }

    try {
      setError("");
      setIsLoadingChannels(true);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute(
            `/microsoft-teams/channels?teamId=${encodeURIComponent(teamId)}`,
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data as JSONObject;
      const list: Array<ChannelItem> = (
        (data["channels"] as Array<JSONObject>) || []
      )
        .map((channel: JSONObject) => {
          return {
            id: (channel["id"] as string) || "",
            name: (channel["name"] as string) || "",
          };
        })
        .filter((channel: ChannelItem) => {
          return Boolean(channel.id && channel.name);
        });

      setChannels(list);
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoadingChannels(false);
    }
  };

  const loadTeams: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError("");
      setIsLoadingTeams(true);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute("/microsoft-teams/teams"),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data as JSONObject;
      const list: Array<TeamItem> = ((data["teams"] as Array<JSONObject>) || [])
        .map((team: JSONObject) => {
          return {
            id: (team["id"] as string) || "",
            name: (team["name"] as string) || "",
          };
        })
        .filter((team: TeamItem) => {
          return Boolean(team.id && team.name);
        })
        .sort((a: TeamItem, b: TeamItem) => {
          return a.name.localeCompare(b.name);
        });

      setTeams(list);

      // Auto-select the first team so the card is useful with no clicks.
      if (list.length > 0 && list[0]) {
        setSelectedTeamId(list[0].id);
        await loadChannels(list[0].id);
      }
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoadingTeams(false);
    }
  };

  useEffect(() => {
    loadTeams().catch((err: Exception) => {
      setError(API.getFriendlyErrorMessage(err));
    });
  }, []);

  const teamOptions: Array<DropdownOption> = teams.map((team: TeamItem) => {
    return {
      label: team.name,
      value: team.id,
    };
  });

  const selectedTeamOption: DropdownOption | undefined = teamOptions.find(
    (option: DropdownOption) => {
      return option.value === selectedTeamId;
    },
  );

  return (
    <Card
      title="Microsoft Teams Channels"
      description="Browse the channels OneUptime can see in your teams. Use these names when a notification rule posts to an existing channel."
      buttons={[
        {
          title: "Refresh Channels",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Refresh,
          isLoading: isLoadingChannels,
          onClick: () => {
            loadChannels(selectedTeamId).catch((err: Exception) => {
              setError(API.getFriendlyErrorMessage(err));
            });
          },
        },
      ]}
    >
      <div className="mt-2">
        {isLoadingTeams && <ComponentLoader />}

        {!isLoadingTeams && error && <ErrorMessage message={error} />}

        {!isLoadingTeams && !error && teams.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <Icon
                icon={IconProp.Hashtag}
                size={SizeProp.Large}
                thick={ThickProp.Thick}
                className="h-6 w-6"
              />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-gray-900">
              No teams found
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              Grant admin consent and make sure your Microsoft Teams tenant has
              at least one team, then refresh.
            </p>
          </div>
        )}

        {!isLoadingTeams && !error && teams.length > 0 && (
          <div className="space-y-4">
            <div className="max-w-md">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Team
              </label>
              <Dropdown
                options={teamOptions}
                value={selectedTeamOption}
                placeholder="Select a team"
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  const teamId: string = (value as string) || "";
                  setSelectedTeamId(teamId);
                  loadChannels(teamId).catch((err: Exception) => {
                    setError(API.getFriendlyErrorMessage(err));
                  });
                }}
              />
            </div>

            {isLoadingChannels && <ComponentLoader />}

            {!isLoadingChannels && channels.length === 0 && selectedTeamId && (
              <div className="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center text-sm text-gray-500">
                No channels found in this team.
              </div>
            )}

            {!isLoadingChannels && channels.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm text-gray-600">
                  Channels ({channels.length})
                </div>
                <div className="max-h-96 overflow-y-auto pr-1">
                  <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 overflow-hidden bg-white">
                    {channels.map((channel: ChannelItem) => {
                      return (
                        <li
                          key={channel.id}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                        >
                          <div className="h-9 w-9 flex flex-none items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                            <Icon
                              icon={IconProp.Hashtag}
                              size={SizeProp.Large}
                              thick={ThickProp.Thick}
                              className="h-5 w-5"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-gray-900 truncate">
                              {channel.name}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <p className="text-xs text-gray-500">
                  Notifications post to channels in teams where the OneUptime
                  app is installed. Private channels require the OneUptime bot
                  to be a member.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default MicrosoftTeamsChannelsCard;
