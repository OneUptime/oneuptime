import Team from "Common/Models/DatabaseModels/Team";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import TeamsElement from "./TeamsElement";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  teamIds: Array<ObjectID>;
}

const FetchTeams: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string>("");
  const [team, setTeam] = React.useState<Array<Team>>([]);

  const fetchTeam: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const team: ListResult<Team> = await ModelAPI.getList({
        modelType: Team,
        query: {
          _id: new Includes(props.teamIds),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          name: true,
          _id: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setTeam(team.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchTeam().catch((err: Exception) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <ComponentLoader />;
  }

  return <TeamsElement teams={team} />;
};

export default FetchTeams;
