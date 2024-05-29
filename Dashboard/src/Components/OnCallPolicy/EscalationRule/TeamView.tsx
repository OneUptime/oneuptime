import TeamsElement from '../../Team/TeamsElement';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import ObjectID from 'Common/Types/ObjectID';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import API from 'CommonUI/src/Utils/API/API';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import OnCallDutyPolicyEscalationRuleTeam from 'Model/Models/OnCallDutyPolicyEscalationRuleTeam';
import Team from 'Model/Models/Team';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import useAsyncEffect from 'use-async-effect';

export interface ComponentProps {
    escalationRuleId: ObjectID;
}

const TeamView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [teams, setTeams] = useState<Array<Team>>([]);

    const [isLoading, setIsLoading] = useState<boolean>(false);

    const [error, setError] = useState<string>('');

    useAsyncEffect(async () => {
        try {
            setIsLoading(true);

            const onCallTeams: ListResult<OnCallDutyPolicyEscalationRuleTeam> =
                await ModelAPI.getList({
                    modelType: OnCallDutyPolicyEscalationRuleTeam,
                    query: {
                        onCallDutyPolicyEscalationRuleId:
                            props.escalationRuleId,
                    },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    select: {
                        team: {
                            name: true,
                        },
                    },
                    sort: {},
                });

            const teams: Array<Team> = onCallTeams.data.map(
                (onCallUser: OnCallDutyPolicyEscalationRuleTeam) => {
                    return onCallUser.team!;
                }
            );

            setTeams(teams);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    }, []);

    if (isLoading) {
        return (
            <div className="flex justify-center w-full">
                <ComponentLoader />
            </div>
        );
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return <TeamsElement teams={teams} />;
};

export default TeamView;
