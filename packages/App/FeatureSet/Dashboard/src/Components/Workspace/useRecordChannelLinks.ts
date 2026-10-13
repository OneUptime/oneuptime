import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import WorkspaceChannelLinkUtil, {
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "Common/Types/Workspace/WorkspaceChannelLink";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";
import { EventPanelAction } from "../EventView/EventStatusPanel";
import {
  ChannelLinkGroup,
  getChannelLinkGroups,
  getChannelLinkLabel,
  getChannelLinkRecheckDelay,
  getChannelLinkRoute,
} from "./ChannelLinks";

/*
 * The record's channel links, from the server. An answer that is not a
 * success throws, so the hook can tell "no channel" from "could not ask".
 */
export async function fetchChannelLinks(data: {
  recordType: WorkspaceChannelRecordType;
  recordId: ObjectID;
}): Promise<Array<WorkspaceChannelLink>> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        getChannelLinkRoute(data),
      ),
      data: {},
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  return WorkspaceChannelLinkUtil.fromJSONArray(
    (response.jsonData as JSONObject | undefined)?.["links"],
  );
}

interface LoadedLinks {
  recordKey: string;
  links: Array<WorkspaceChannelLink>;
}

/*
 * The links to a record's own Slack and Microsoft Teams channels (see
 * ChannelLinks). Empty until they load, when there are none, and when they
 * cannot be read - the button is a shortcut, so a failure hides it rather
 * than putting an error in the page's header.
 */
export default function useRecordChannelLinks(data: {
  recordType: WorkspaceChannelRecordType;
  recordId: ObjectID;
  // When the record started, once the page knows (getChannelLinkRecheckDelay).
  recordStartedAt?: Date | undefined;
}): Array<WorkspaceChannelLink> {
  const recordKey: string = `${data.recordType}:${data.recordId.toString()}`;
  const [loaded, setLoaded] = useState<LoadedLinks | null>(null);
  const [recheck, setRecheck] = useState<{ recordKey: string; count: number }>({
    recordKey,
    count: 0,
  });

  const attempt: number = recheck.recordKey === recordKey ? recheck.count : 0;

  useEffect(() => {
    let isCurrent: boolean = true;

    fetchChannelLinks({
      recordType: data.recordType,
      recordId: data.recordId,
    })
      .then((links: Array<WorkspaceChannelLink>) => {
        if (isCurrent) {
          setLoaded({ recordKey, links });
        }
      })
      .catch(() => {
        if (isCurrent) {
          setLoaded({ recordKey, links: [] });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [recordKey, attempt]);

  const links: Array<WorkspaceChannelLink> =
    loaded && loaded.recordKey === recordKey ? loaded.links : [];
  const hasLoaded: boolean = Boolean(loaded && loaded.recordKey === recordKey);
  const recordStartedAtTime: number | undefined =
    data.recordStartedAt?.getTime();

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }

    const delay: number | null = getChannelLinkRecheckDelay({
      recordStartedAt:
        recordStartedAtTime === undefined
          ? undefined
          : new Date(recordStartedAtTime),
      now: new Date(),
      linkCount: links.length,
      attempt: attempt,
    });

    if (delay === null) {
      return;
    }

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setRecheck({ recordKey, count: attempt + 1 });
    }, delay);

    return () => {
      clearTimeout(timeout);
    };
  }, [hasLoaded, links.length, attempt, recordKey, recordStartedAtTime]);

  return links;
}

const openInNewTab: (url: string) => void = (url: string): void => {
  window.open(url, "_blank", "noopener,noreferrer");
};

/*
 * The header's Open in Slack / Open in Microsoft Teams buttons: one per
 * workspace the record has a channel in. A button opens its channel in a new
 * tab, so the page stays where the responder left it; a workspace with
 * several channels lists them in a menu under its button.
 */
export function getOpenInChatActions(
  links: Array<WorkspaceChannelLink>,
): Array<EventPanelAction> {
  return getChannelLinkGroups(links).map(
    (group: ChannelLinkGroup): EventPanelAction => {
      const onlyLink: WorkspaceChannelLink | undefined =
        group.links.length === 1 ? group.links[0] : undefined;

      return {
        id:
          group.workspaceType === WorkspaceType.Slack
            ? "open-in-slack"
            : "open-in-microsoft-teams",
        label: group.label,
        icon: group.icon,
        href: onlyLink?.url,
        tooltip: onlyLink ? getChannelLinkLabel(onlyLink) : undefined,
        onClick: () => {
          if (onlyLink) {
            openInNewTab(onlyLink.url);
          }
        },
        menuItems:
          group.links.length > 1
            ? group.links.map((link: WorkspaceChannelLink) => {
                return {
                  id: link.url,
                  label: getChannelLinkLabel(link),
                  onClick: () => {
                    openInNewTab(link.url);
                  },
                };
              })
            : undefined,
      };
    },
  );
}
