import { formatNameList } from "../AiAccess/AiAccessModes";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { HeldPermissions } from "Common/Types/HeldPermissions";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import {
  PrivateRecordScope,
  PrivateRecordScopeContext,
} from "Common/UI/Utils/PrivateRecordScope";
import {
  composedValue,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import User from "Common/UI/Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * Why a change the reader's own permissions allow is locked on a private
 * record, after the lock's first sentence ("You do not have permission to
 * create this Incident Internal Note."): the record - named, since the
 * first sentence may name a part of it - is changed only with the
 * permissions of the teams that own it, and the reader's teams that own it
 * may not make this change. Their names are the teams'. One wording per
 * kind of record, for the languages that agree words with it.
 */
export interface PrivateRecordReasons {
  // One team of the reader's owns it: {{team}}.
  oneTeam: string;
  // Several do: {{teams}}, as a list.
  severalTeams: string;
  // None of theirs can be named.
  unnamedTeams: string;
}

export type PrivateRecordNoun = "incident" | "alert" | "episode";

export const PRIVATE_RECORD_REASONS: Readonly<
  Record<PrivateRecordNoun, PrivateRecordReasons>
> = {
  incident: {
    oneTeam: translationKey(
      "This incident is private, so it is changed only with the permissions of the teams that own it, and {{team}}, your team that owns it, may not do this.",
    ),
    severalTeams: translationKey(
      "This incident is private, so it is changed only with the permissions of the teams that own it, and {{teams}}, your teams that own it, may not do this.",
    ),
    unnamedTeams: translationKey(
      "This incident is private, so it is changed only with the permissions of the teams that own it, and your teams that own it may not do this.",
    ),
  },
  alert: {
    oneTeam: translationKey(
      "This alert is private, so it is changed only with the permissions of the teams that own it, and {{team}}, your team that owns it, may not do this.",
    ),
    severalTeams: translationKey(
      "This alert is private, so it is changed only with the permissions of the teams that own it, and {{teams}}, your teams that own it, may not do this.",
    ),
    unnamedTeams: translationKey(
      "This alert is private, so it is changed only with the permissions of the teams that own it, and your teams that own it may not do this.",
    ),
  },
  episode: {
    oneTeam: translationKey(
      "This episode is private, so it is changed only with the permissions of the teams that own it, and {{team}}, your team that owns it, may not do this.",
    ),
    severalTeams: translationKey(
      "This episode is private, so it is changed only with the permissions of the teams that own it, and {{teams}}, your teams that own it, may not do this.",
    ),
    unnamedTeams: translationKey(
      "This episode is private, so it is changed only with the permissions of the teams that own it, and your teams that own it may not do this.",
    ),
  },
};

// The word a kind of private record goes by, by its table.
export const getPrivateRecordNoun: (tableName: string) => PrivateRecordNoun = (
  tableName: string,
): PrivateRecordNoun => {
  if (tableName === "Alert") {
    return "alert";
  }

  if (tableName === "IncidentEpisode" || tableName === "AlertEpisode") {
    return "episode";
  }

  return "incident";
};

// Nothing held: what the record's gates read while who owns it is read.
const NOTHING_HELD: HeldPermissions = {
  allowed: [],
  allowedProjectWide: [],
  blocked: [],
  blockedForSomeLabels: [],
};

// How many owner teams a record's owners are read up to.
const OWNER_TEAMS_READ: number = 50;

// What the page reads of the record's owners.
export interface PrivateRecordOwners {
  isPrivate: boolean;
  isOwnedByReader: boolean;
  owningTeams: Array<{ id: string; name: string }>;
}

/*
 * The reason of a lock on a private record of the kind `tableName`, in the
 * reader's language: the owner teams the reader is on - known by the teams
 * their permissions are granted on - named, or the teams of theirs said
 * together when none is.
 */
export const getPrivateRecordReason: (data: {
  tableName: string;
  owningTeams: ReadonlyArray<{ id: string; name: string }>;
  readerTeamIds: ReadonlyArray<string>;
  translator: Translator;
}) => string = (data: {
  tableName: string;
  owningTeams: ReadonlyArray<{ id: string; name: string }>;
  readerTeamIds: ReadonlyArray<string>;
  translator: Translator;
}): string => {
  const reasons: PrivateRecordReasons =
    PRIVATE_RECORD_REASONS[getPrivateRecordNoun(data.tableName)];
  const readerTeams: Set<string> = new Set<string>(
    data.readerTeamIds.map((teamId: string): string => {
      return teamId.toLowerCase();
    }),
  );

  const names: Array<string> = [];

  for (const team of data.owningTeams) {
    const name: string = team.name.trim();

    if (
      name &&
      readerTeams.has(team.id.toLowerCase()) &&
      !names.includes(name)
    ) {
      names.push(name);
    }
  }

  if (names.length === 0) {
    return (
      data.translator.translateText(reasons.unnamedTeams) ||
      reasons.unnamedTeams
    );
  }

  if (names.length === 1) {
    return data.translator.translateTemplate(reasons.oneTeam, {
      team: names[0]!,
    });
  }

  return data.translator.translateTemplate(reasons.severalTeams, {
    teams: composedValue((sentence: Translator): string => {
      return formatNameList(names, "and", sentence);
    }),
  });
};

/*
 * THE SCOPE A PAGE OPEN ON A PRIVATE RECORD HANDS ITS GATES
 * (PrivateRecordScope): null while there is nothing to narrow - the record
 * is not private, the reader is named as its owner, or acts on every
 * private record - and, while its owners are being read, a scope that holds
 * nothing, so no gate of the record offers a change it may not make for the
 * moment that takes.
 */
export const getPrivateRecordScope: (data: {
  tableName: string;
  owners: PrivateRecordOwners | null | undefined;
  translator: Translator;
}) => PrivateRecordScope | null = (data: {
  tableName: string;
  owners: PrivateRecordOwners | null | undefined;
  translator: Translator;
}): PrivateRecordScope | null => {
  if (data.owners === null) {
    return null;
  }

  if (data.owners === undefined) {
    return { tableName: data.tableName, held: NOTHING_HELD, reason: "" };
  }

  const held: HeldPermissions | null = PermissionGate.getHeldOnPrivateRecord({
    isPrivate: data.owners.isPrivate,
    isOwnedByReader: data.owners.isOwnedByReader,
    owningTeamIds: data.owners.owningTeams.map(
      (team: { id: string }): string => {
        return team.id;
      },
    ),
  });

  if (!held) {
    return null;
  }

  return {
    tableName: data.tableName,
    held: held,
    reason: getPrivateRecordReason({
      tableName: data.tableName,
      owningTeams: data.owners.owningTeams,
      readerTeamIds: PermissionGate.getTeamIdsOfReader(),
      translator: data.translator,
    }),
  };
};

export interface ComponentProps {
  // The record's model (Incident, Alert or an episode) and id.
  modelType: { new (): BaseModel };
  modelId: ObjectID;
  // Its two owner tables, and the key their rows name the record by.
  ownerTeamModelType: { new (): BaseModel };
  ownerUserModelType: { new (): BaseModel };
  ownerKey: string;
  children: ReactElement;
}

/*
 * WHAT THE READER MAY DO ON A PRIVATE RECORD'S PAGES: the record's view
 * layout reads whether it is private and who owns it - three small reads,
 * for a private record only, and none for a reader who acts on every
 * private record - and hands every gate on its pages what the reader holds
 * on it (PrivateRecordScope). A read that fails leaves the gates as they
 * are: the server holds every change to the rule whatever they offer.
 */
const PrivateRecordScopeProvider: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const tableName: string = new props.modelType().tableName || "";
  const modelIdString: string = props.modelId.toString();

  // A reader who acts on every private record has nothing to read here.
  const actsOnEveryPrivateRecord: boolean =
    PermissionGate.getHeldOnPrivateRecord({
      isPrivate: true,
      isOwnedByReader: false,
      owningTeamIds: [],
    }) === null;

  // Undefined while being read; null when there is nothing to narrow.
  const [owners, setOwners] = useState<PrivateRecordOwners | null | undefined>(
    actsOnEveryPrivateRecord ? null : undefined,
  );

  useEffect(() => {
    if (actsOnEveryPrivateRecord || !ObjectID.isValidUUID(modelIdString)) {
      setOwners(null);
      return;
    }

    let isCurrent: boolean = true;

    setOwners(undefined);

    const read: () => Promise<PrivateRecordOwners | null> =
      async (): Promise<PrivateRecordOwners | null> => {
        const record: BaseModel | null = await ModelAPI.getItem({
          modelType: props.modelType,
          id: new ObjectID(modelIdString),
          select: { isPrivate: true } as never,
        });

        if (
          !record ||
          (record as unknown as { isPrivate?: unknown }).isPrivate !== true
        ) {
          return null;
        }

        const [teams, ownedByReader]: [ListResult<BaseModel>, number] =
          await Promise.all([
            ModelAPI.getList<BaseModel>({
              modelType: props.ownerTeamModelType,
              query: { [props.ownerKey]: new ObjectID(modelIdString) } as never,
              select: { teamId: true, team: { name: true } } as never,
              limit: OWNER_TEAMS_READ,
              skip: 0,
              sort: {},
            }),
            ModelAPI.count<BaseModel>({
              modelType: props.ownerUserModelType,
              query: {
                [props.ownerKey]: new ObjectID(modelIdString),
                userId: User.getUserId(),
              } as never,
            }),
          ]);

        return {
          isPrivate: true,
          isOwnedByReader: ownedByReader > 0,
          owningTeams: teams.data
            .map((row: BaseModel): { id: string; name: string } => {
              const values: {
                teamId?: unknown;
                team?: { name?: unknown } | undefined;
              } = row as unknown as {
                teamId?: unknown;
                team?: { name?: unknown } | undefined;
              };

              return {
                id: values.teamId ? String(values.teamId) : "",
                name:
                  typeof values.team?.name === "string" ? values.team.name : "",
              };
            })
            .filter((team: { id: string }): boolean => {
              return Boolean(team.id);
            }),
        };
      };

    read()
      .then((read: PrivateRecordOwners | null) => {
        if (isCurrent) {
          setOwners(read);
        }
      })
      .catch(() => {
        // The server holds every change to the rule: the gates stay as they are.
        if (isCurrent) {
          setOwners(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [modelIdString, actsOnEveryPrivateRecord]);

  /*
   * Worked out once the owners are read, when the permission snapshot has
   * landed with the reads - the same scope until they or the reader's
   * language change, so the gates that keep what they worked out keep it.
   */
  const scope: PrivateRecordScope | null = useMemo(() => {
    return getPrivateRecordScope({
      tableName: tableName,
      owners: owners,
      translator: translator,
    });
  }, [owners, tableName, translator.language]);

  return (
    <PrivateRecordScopeContext.Provider value={scope}>
      {props.children}
    </PrivateRecordScopeContext.Provider>
  );
};

export default PrivateRecordScopeProvider;
