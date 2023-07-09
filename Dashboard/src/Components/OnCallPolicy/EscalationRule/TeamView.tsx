import React, { FunctionComponent, ReactElement, useState } from 'react';
import ObjectID from 'Common/Types/ObjectID';
import Team from 'Model/Models/Team';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import OnCallDutyPolicyEscalationRuleTeam from 'Model/Models/OnCallDutyPolicyEscalationRuleTeam';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import useAsyncEffect from 'use-async-effect';
import API from 'CommonUI/src/Utils/API/API';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import TeamsElement from '../../Team/TeamsElement';

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
                await ModelAPI.getList(
                    OnCallDutyPolicyEscalationRuleTeam,
                    {
                        onCallDutyPolicyEscalationRuleId:
                            props.escalationRuleId,
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        team: {
                            name: true,
                        },
                    },
                    {}
                );

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
