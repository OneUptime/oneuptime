import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useMemo, useState } from "react";
import {
  InviteTeam,
  findDefaultInviteTeam,
} from "../../Utils/DefaultInviteTeam";

/*
 * A NEW SINGLE SIGN-ON PROVIDER STARTS ON THE PROJECT'S MEMBERS TEAM.
 *
 * Someone who signs in with a project's SSO provider for the first time
 * joins the provider's teams; with none, the sign-in stops at "No teams
 * added". So the provider form asked for teams, required, with nothing
 * picked - a permissions decision before anything could be saved. Most
 * people signing in are there to do the everyday work, which is what the
 * project's members team is for, so the form starts on it: the same team
 * Invite User starts on (Utils/DefaultInviteTeam), and only one the person
 * filling in the form may hand on. The picker shows it and it can be
 * changed like any other value.
 *
 * Looked up once, when the page opens, so the Create dialog normally opens
 * with it picked. A lookup that fails or is slow only means the dialog
 * opens with nothing picked, as before.
 */

export type GetDefaultSsoTeamsInitialValuesFunction = <TEntity>(
  team: InviteTeam | null,
) => FormValues<TEntity> | undefined;

// What a provider's Create form starts with: the team, or nothing.
export const getDefaultSsoTeamsInitialValues: GetDefaultSsoTeamsInitialValuesFunction =
  <TEntity>(team: InviteTeam | null): FormValues<TEntity> | undefined => {
    if (!team || !team.id) {
      return undefined;
    }

    return { teams: [team.id] } as unknown as FormValues<TEntity>;
  };

export type UseDefaultSsoTeamsInitialValuesFunction = <TEntity>() =>
  | FormValues<TEntity>
  | undefined;

// For a provider table's createInitialValues.
export const useDefaultSsoTeamsInitialValues: UseDefaultSsoTeamsInitialValuesFunction =
  <TEntity>(): FormValues<TEntity> | undefined => {
    const [team, setTeam] = useState<InviteTeam | null>(null);

    useEffect(() => {
      let isMounted: boolean = true;
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      findDefaultInviteTeam({ projectId })
        .then((found: InviteTeam | null) => {
          if (isMounted) {
            setTeam(found);
          }
        })
        .catch(() => {
          // Never throws; nothing is picked if it somehow does.
        });

      return () => {
        isMounted = false;
      };
    }, []);

    // One object per lookup, so re-renders hand the form the same.
    return useMemo((): FormValues<TEntity> | undefined => {
      return getDefaultSsoTeamsInitialValues<TEntity>(team);
    }, [team]);
  };

export default useDefaultSsoTeamsInitialValues;
