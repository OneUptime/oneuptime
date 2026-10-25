import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { AnchoredFieldPopup } from "Common/UI/Types/UseAnchoredFieldPopup";
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
  useMemo,
  useState,
} from "react";
import { getOwnerKeys, OwnersChange, OwnersTarget } from "../Owners/AddOwners";
import AddOwnersPopup, {
  AddOwnersPlaceButton,
  AddOwnersTextButton,
  useAddOwnersPopup,
} from "../Owners/AddOwnersPopup";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import OwnersCell from "../ResourceOwners/OwnersCell";

export const POSTMORTEM_NO_OWNERS: string = translationKey("No owners yet.");

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
      entry.user.name?.toString() ||
      entry.user.email?.toString() ||
      ""
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

/*
 * The owners' Add owners: the incident's owner tables, and what to do once
 * an owner was added from its list.
 */
export interface PostmortemAddOwners {
  target: OwnersTarget;
  // After a pick: the page reads the incident's owners again.
  onOwnersChanged: (change: OwnersChange) => void;
}

export interface ComponentProps {
  owners: Array<ResourceOwnerEntry>;
  hasLoaded: boolean;
  /*
   * Offered to a reader who may add an owner to the incident: "Add owners"
   * beside "No owners yet.", or the empty place after the owners, each
   * opening the Add owners list right there - the incident's Owners page
   * stays where they are managed in full.
   */
  addOwners?: PostmortemAddOwners | undefined;
}

/*
 * Who owns the postmortem: the incident's owners, as avatars and by name.
 * With none, it says so. A reader who may add an owner adds one right here,
 * from the same list the incident's Owners page opens.
 */
const PostmortemOwners: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // One list for both places to add from; only one is ever drawn.
  const popup: AnchoredFieldPopup = useAddOwnersPopup(props.owners.length);
  const ownerKeys: Set<string> = useMemo((): Set<string> => {
    return getOwnerKeys(props.owners);
  }, [props.owners]);

  const addList: ReactElement = props.addOwners ? (
    <AddOwnersPopup
      popup={popup}
      target={props.addOwners.target}
      ownerKeys={ownerKeys}
      onOwnersChanged={props.addOwners.onOwnersChanged}
    />
  ) : (
    <></>
  );

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

  /*
   * The list is the fragment's second child whatever the line shows, so it
   * stays open, with what it said, as the first owner takes "No owners
   * yet."'s place.
   */
  if (props.owners.length === 0) {
    return (
      <>
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
          data-testid="postmortem-owners"
        >
          <span className="text-gray-500">
            {translator.translateText(POSTMORTEM_NO_OWNERS)}
          </span>
          {props.addOwners ? (
            <AddOwnersTextButton
              popup={popup}
              dataTestId="postmortem-add-owners"
            />
          ) : (
            <></>
          )}
        </div>
        {addList}
      </>
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
    <>
      <div
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        data-testid="postmortem-owners"
      >
        <OwnersCell owners={props.owners} maxVisible={NAMED_OWNERS} />
        <span className="min-w-0 truncate text-gray-700">{namesText}</span>
        {props.addOwners ? (
          <AddOwnersPlaceButton
            popup={popup}
            dataTestId="postmortem-add-more-owners"
          />
        ) : (
          <></>
        )}
      </div>
      {addList}
    </>
  );
};

export default PostmortemOwners;
