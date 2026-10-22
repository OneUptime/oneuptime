import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import OwnersCell from "../ResourceOwners/OwnersCell";

export const POSTMORTEM_NO_OWNERS: string = translationKey("No owners yet.");
export const POSTMORTEM_ADD_OWNERS: string = translationKey("Add owners");
export const POSTMORTEM_CHANGE_OWNERS: string = translationKey("Change owners");

// The owners named beside the avatars, and how many more there are.
export const POSTMORTEM_MORE_OWNERS: PluralTemplate = {
  one: "{{names}} and {{count}} more owner",
  other: "{{names}} and {{count}} more owners",
};

// How many owners are named beside the avatars before "and N more".
const NAMED_OWNERS: number = 3;

// An owner's name, as the avatars' tooltips show it.
export const getOwnerName: (entry: ResourceOwnerEntry) => string = (
  entry: ResourceOwnerEntry,
): string => {
  if (entry.kind === "user") {
    return (
      entry.user.name?.toString() || entry.user.email?.toString() || ""
    ).trim();
  }

  return (entry.team.name?.toString() || "").trim();
};

/*
 * The incident's owners, read once for its Postmortem page: the people and
 * teams who own the incident own its postmortem. Best effort: owners that
 * cannot be read are not shown, and the rest of the page is unaffected.
 */
export function useIncidentOwners(data: {
  incidentId: ObjectID;
  refreshToken?: string | number | boolean | undefined;
}): { owners: Array<ResourceOwnerEntry>; hasLoaded: boolean } {
  const [owners, setOwners] = useState<Array<ResourceOwnerEntry>>([]);
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      setHasLoaded(true);
      return;
    }

    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const [users, teams]: [
          ListResult<IncidentOwnerUser>,
          ListResult<IncidentOwnerTeam>,
        ] = await Promise.all([
          ModelAPI.getList<IncidentOwnerUser>({
            modelType: IncidentOwnerUser,
            query: {
              incidentId: data.incidentId,
              projectId: projectId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              user: {
                _id: true,
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            sort: {},
          }),
          ModelAPI.getList<IncidentOwnerTeam>({
            modelType: IncidentOwnerTeam,
            query: {
              incidentId: data.incidentId,
              projectId: projectId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              team: {
                _id: true,
                name: true,
              },
            },
            sort: {},
          }),
        ]);

        const entries: Array<ResourceOwnerEntry> = [];

        for (const row of users.data) {
          if (row.user) {
            entries.push({ kind: "user", user: row.user });
          }
        }

        for (const row of teams.data) {
          if (row.team) {
            entries.push({ kind: "team", team: row.team });
          }
        }

        if (!isCancelled) {
          setOwners(entries);
        }
      } catch {
        if (!isCancelled) {
          setOwners([]);
        }
      }

      if (!isCancelled) {
        setHasLoaded(true);
      }
    };

    void load();

    return () => {
      isCancelled = true;
    };
  }, [data.incidentId.toString(), data.refreshToken]);

  return { owners, hasLoaded };
}

export interface ComponentProps {
  owners: Array<ResourceOwnerEntry>;
  hasLoaded: boolean;
}

/*
 * Who owns the postmortem: the incident's owners, as avatars and by name.
 * With none, it says so. The way to change them - the incident's Owners
 * page, where they are picked as everywhere else - is the link beside the
 * field's name (PostmortemSummary).
 */
const PostmortemOwners: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.hasLoaded) {
    return (
      <span
        className="text-sm text-gray-400"
        data-testid="postmortem-owners-loading"
      >
        {translator.translateText("Loading...")}
      </span>
    );
  }

  if (props.owners.length === 0) {
    return (
      <span
        className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        data-testid="postmortem-owners"
      >
        <span className="text-gray-500">
          {translator.translateText(POSTMORTEM_NO_OWNERS)}
        </span>
      </span>
    );
  }

  const names: Array<string> = props.owners
    .map(getOwnerName)
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  const named: Array<string> = names.slice(0, NAMED_OWNERS);
  const more: number = names.length - named.length;

  const namesText: string =
    more > 0
      ? translator.translatePlural(POSTMORTEM_MORE_OWNERS, more, {
          names: named.join(", "),
        })
      : named.join(", ");

  return (
    <span
      className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      data-testid="postmortem-owners"
    >
      <OwnersCell owners={props.owners} maxVisible={NAMED_OWNERS} />
      <span className="min-w-0 truncate text-gray-700">{namesText}</span>
    </span>
  );
};

export default PostmortemOwners;
