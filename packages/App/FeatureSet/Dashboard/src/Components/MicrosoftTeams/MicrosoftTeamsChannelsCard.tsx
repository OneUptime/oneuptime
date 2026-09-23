import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
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
import API from "Common/UI/Utils/API/API";
import Exception from "Common/Types/Exception/Exception";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import SendTestNotificationButton from "../Workspace/SendTestNotificationButton";

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
  /*
   * The team `channels` was loaded for. selectedTeamId is what the dropdown
   * shows, which changes the moment a team is picked - before its channels
   * have arrived. Anything that has to name the team a listed channel is in
   * (the row key, the team a test is sent to) uses this instead.
   */
  const [channelsTeamId, setChannelsTeamId] = useState<string>("");
  const [isLoadingTeams, setIsLoadingTeams] = useState<boolean>(true);
  const [isLoadingChannels, setIsLoadingChannels] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [sendingTestCount, setSendingTestCount] = useState<number>(0);

  /*
   * Picking team B and then team C starts two loads, and nothing makes them
   * finish in order. If B's response lands last it would show B's channels
   * under a dropdown that says C. Only the most recent load may touch the
   * list, the error or the loading flag.
   *
   * Each load is identified by a sequence number rather than by its team id:
   * picking the same team twice (react-select fires onChange again for the
   * selected option), B -> C -> B, or Refresh Channels all start a second load
   * for the same team, and an older one of those must not end the loading
   * state or post its error over the newer one. A ref, not state, because each
   * load reads it after its await, long after the render that started it.
   */
  const latestChannelLoadIdRef: React.MutableRefObject<number> =
    useRef<number>(0);

  const loadChannels: (teamId: string) => Promise<void> = async (
    teamId: string,
  ): Promise<void> => {
    latestChannelLoadIdRef.current += 1;
    const loadId: number = latestChannelLoadIdRef.current;

    if (!teamId) {
      setChannels([]);
      setChannelsTeamId("");
      /*
       * A load still in flight for the previous team will now skip its own
       * cleanup (it is no longer the latest), so the spinner it started has
       * to be stopped here.
       */
      setIsLoadingChannels(false);
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

      if (latestChannelLoadIdRef.current !== loadId) {
        return;
      }

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
      setChannelsTeamId(teamId);
    } catch (err) {
      if (latestChannelLoadIdRef.current === loadId) {
        setError(API.getFriendlyErrorMessage(err as Exception));
      }
    } finally {
      if (latestChannelLoadIdRef.current === loadId) {
        setIsLoadingChannels(false);
      }
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

  type SendingTestChangeFunction = (isSending: boolean) => void;

  /*
   * Refreshing, or switching team, swaps the list for a loader, which
   * unmounts every row - and a row whose test is still in flight would then
   * have nowhere to show its result, so the user would never learn whether
   * it arrived. Both controls stay disabled until every test in flight has
   * settled. Clamped at zero so a stray extra "false" can never leave them
   * locked.
   */
  const onSendingTestChange: SendingTestChangeFunction = (
    isSending: boolean,
  ): void => {
    setSendingTestCount((count: number): number => {
      return Math.max(0, count + (isSending ? 1 : -1));
    });
  };

  return (
    <Card
      title="Microsoft Teams Channels"
      description="Browse the channels OneUptime can see in your teams. Use these names when a notification rule posts to an existing channel. Use Send Test to confirm OneUptime can post to a channel."
      buttons={[
        {
          title: "Refresh Channels",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Refresh,
          isLoading: isLoadingChannels,
          disabled: sendingTestCount > 0,
          tooltip:
            sendingTestCount > 0
              ? "Wait for the test notification to finish sending."
              : undefined,
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
                disabled={sendingTestCount > 0}
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
                        /*
                         * Keyed by team as well as channel. Each row holds the
                         * Sent / Failed result of its own test, and that
                         * result belongs to one team's channel. The list is
                         * replaced by a loader during every reload, which
                         * already starts each row fresh, so the composite key
                         * is defence in depth: React can never hand an old
                         * result to a row of another team with the same
                         * channel id.
                         */
                        <li
                          key={`${channelsTeamId}:${channel.id}`}
                          className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                        >
                          <div className="h-9 w-9 flex flex-none items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                            <Icon
                              icon={IconProp.Hashtag}
                              size={SizeProp.Large}
                              thick={ThickProp.Thick}
                              className="h-5 w-5"
                            />
                          </div>
                          {/*
                           * A floor rather than min-w-0: on a phone a name
                           * allowed to shrink to nothing gives the whole row
                           * to the Send Test control. With a floor the
                           * control wraps onto its own line instead.
                           */}
                          <div className="min-w-[8rem] flex-1">
                            <div className="font-medium text-gray-900 truncate">
                              {channel.name}
                            </div>
                          </div>
                          <SendTestNotificationButton
                            route="/microsoft-teams/channels/test"
                            requestBody={{
                              /*
                               * The team this list was loaded for, which is
                               * the team this channel is in - not the
                               * dropdown's value, which moves ahead of it.
                               */
                              teamId: channelsTeamId,
                              channelId: channel.id,
                            }}
                            destinationName={channel.name}
                            workspaceName="Microsoft Teams"
                            onSendingChange={onSendingTestChange}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
                {/*
                 * This list is everything Graph can SEE in the tenant, which is
                 * not the same as everything we can post to. Saying so here
                 * matters: a channel showing up looks like a working
                 * destination, and the usual reason a send then fails is that
                 * the team has a different OneUptime package installed (for
                 * example the one from the Teams store) rather than the
                 * manifest built for this deployment.
                 */}
                <p className="text-xs text-gray-500">
                  Every channel in your tenant is listed here, but notifications
                  only reach teams the OneUptime app has been added to — add it
                  from the team&apos;s &quot;...&quot; menu &gt; Manage team
                  &gt; Apps. Use the app manifest downloaded from this page;
                  another OneUptime package, such as the one in the Teams store,
                  will not accept messages from this instance. Private channels
                  also need the OneUptime bot added to the channel itself.
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
