import OverviewCustomFields from "../../../Components/CustomFields/OverviewCustomFields";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import { BUILT_IN_TEAM_OWNERS_REASON } from "../../../Components/Team/BuiltInTeamOwners";
import UsedByCard from "../../../Components/UsedBy/UsedByCard";
import PageComponentProps from "../../PageComponentProps";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { UsedByRecordKind } from "Common/Types/UsedBy/UsedBy";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import Team from "Common/Models/DatabaseModels/Team";
import TeamCustomField from "Common/Models/DatabaseModels/TeamCustomField";
import TeamOwnerTeam from "Common/Models/DatabaseModels/TeamOwnerTeam";
import TeamOwnerUser from "Common/Models/DatabaseModels/TeamOwnerUser";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// What a team's owners do, under the Owners card's title.
export const TEAM_OWNERS_DESCRIPTION: string = translationKey(
  "People and teams who look after this team. With team permissions limited to the teams they own, they invite people to it, remove them, and change what it may do.",
);

export const TEAM_OWNERS_EMPTY_DESCRIPTION: string = translationKey(
  "Add a teammate or a team to look after who is in this team and what it may do.",
);

/*
 * Whether a team may have owners: every team but the two that come with
 * every project (isTeamEditable false). Null while it is read - neither
 * card is drawn until then - and true when it cannot be read: the Owners
 * card answers for itself, and the server refuses what it must.
 */
export const useTeamCanHaveOwners: (teamId: ObjectID) => boolean | null = (
  teamId: ObjectID,
): boolean | null => {
  const [canHaveOwners, setCanHaveOwners] = useState<boolean | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    setCanHaveOwners(null);

    ModelAPI.getItem<Team>({
      modelType: Team,
      id: teamId,
      select: {
        isTeamEditable: true,
      },
    })
      .then((team: Team | null) => {
        if (isCurrent) {
          setCanHaveOwners(team?.isTeamEditable !== false);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setCanHaveOwners(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [teamId.toString()]);

  return canHaveOwners;
};

const TeamViewIndex: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const canHaveOwners: boolean | null = useTeamCanHaveOwners(modelId);

  return (
    <Fragment>
      <CardModelDetail
        name="Team Details"
        cardProps={{
          title: "Team Details",
        }}
        videoLink={URL.fromString("https://youtu.be/TzmaTe4sbCI")}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Team Name",
            validation: {
              minLength: 2,
            },
            // Not the column's "Any friendly name of this object", written for the API.
            hideColumnDescription: true,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Team Description",
            hideColumnDescription: true,
          },
        ]}
        modelDetailProps={{
          modelType: Team,
          id: "model-detail-team",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Team ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: modelId,
        }}
      />

      {canHaveOwners === true && (
        <OwnersCard<TeamOwnerUser, TeamOwnerTeam>
          resourceId={modelId}
          resourceIdField="ownedTeamId"
          resourceDisplayName="team"
          ownerUserModelType={TeamOwnerUser}
          ownerTeamModelType={TeamOwnerTeam}
          description={TEAM_OWNERS_DESCRIPTION}
          emptyDescription={TEAM_OWNERS_EMPTY_DESCRIPTION}
        />
      )}

      {/*
       * Owners and Admin come with every project and have no owners: their
       * page says so where every other team lists its owners, in the
       * server's words (Components/Team/BuiltInTeamOwners).
       */}
      {canHaveOwners === false && (
        <Card
          title="Owners"
          description={BUILT_IN_TEAM_OWNERS_REASON}
          id="team-owners-built-in"
        />
      )}

      {/*
       * "Used by" (#6813): the on-call policies that page this team, and
       * the monitors, status pages, services, policies and schedules it
       * owns.
       */}
      <UsedByCard recordKind={UsedByRecordKind.Team} recordId={modelId} />

      <OverviewCustomFields
        modelId={modelId}
        modelType={Team}
        customFieldType={TeamCustomField}
        resourceName="Team"
      />
    </Fragment>
  );
};

export default TeamViewIndex;
