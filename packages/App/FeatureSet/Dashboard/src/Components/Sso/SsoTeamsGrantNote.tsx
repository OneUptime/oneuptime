import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  SsoProviderTeamsFooterFunction,
  readSsoFormValue,
} from "Common/UI/Components/Sso/SsoProviderFormFields";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  SsoTeamGrant,
  fetchSsoTeamGrants,
  getTeamsBeyondGrant,
} from "./SsoTeamGrants";

/*
 * Under a project SSO provider's Teams field: the picked teams the server
 * would refuse to save, named, the moment they are picked (see
 * SsoTeamGrants). Says nothing while every picked team is one the person
 * could invite someone to, while the teams are still being read, or when
 * they cannot be read.
 */

export const SSO_TEAMS_GRANT_NOTE_TEST_ID: string = "sso-teams-grant-note";

export interface ComponentProps {
  // What the Teams field holds now.
  selectedTeams: unknown;
}

const SsoTeamsGrantNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [grants, setGrants] = useState<Array<SsoTeamGrant> | null>(null);

  useEffect(() => {
    let isMounted: boolean = true;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    fetchSsoTeamGrants({ projectId })
      .then((found: Array<SsoTeamGrant>) => {
        if (isMounted) {
          setGrants(found);
        }
      })
      .catch(() => {
        // Nothing is said; the server explains its refusal on Save.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const teamNames: Array<string> = getTeamsBeyondGrant({
    selectedTeams: props.selectedTeams,
    grants,
  });

  if (teamNames.length === 0) {
    return <></>;
  }

  return (
    <p
      role="note"
      data-testid={SSO_TEAMS_GRANT_NOTE_TEST_ID}
      className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <Icon icon={IconProp.Alert} className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {translator.translatePlural(
          {
            one: "You can't add people to {{teams}} through this provider: it gives more access than you have. Choose teams you could invite someone to, or ask a project owner to save this provider.",
            other:
              "You can't add people to {{teams}} through this provider: they give more access than you have. Choose teams you could invite someone to, or ask a project owner to save this provider.",
          },
          teamNames.length,
          { teams: teamNames.join(", ") },
        )}
      </span>
    </p>
  );
};

/*
 * A provider form's getTeamsFooterElement: the note, for what Teams holds
 * now.
 */
export const getSsoTeamsGrantNote: SsoProviderTeamsFooterFunction = (
  values: unknown,
): ReactElement => {
  return (
    <SsoTeamsGrantNote selectedTeams={readSsoFormValue(values, "teams")} />
  );
};

export default SsoTeamsGrantNote;
