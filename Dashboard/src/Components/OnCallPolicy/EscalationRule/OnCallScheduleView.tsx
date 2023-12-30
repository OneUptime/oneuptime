import React, { FunctionComponent, ReactElement, useState } from 'react';
import ObjectID from 'Common/Types/ObjectID';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import OnCallDutyPolicyEscalationRuleSchedule from 'Model/Models/OnCallDutyPolicyEscalationRuleSchedule';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import useAsyncEffect from 'use-async-effect';
import API from 'CommonUI/src/Utils/API/API';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import SchedulesElement from '../../OnCallDutySchedule/SchedulesElement';
import OnCallDutyPolicySchedule from 'Model/Models/OnCallDutyPolicySchedule';

export interface ComponentProps {
    escalationRuleId: ObjectID;
}

const OnCallDutyScheduleView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [schedules, setSchedules] = useState<Array<OnCallDutyPolicySchedule>>(
        []
    );

    const [isLoading, setIsLoading] = useState<boolean>(false);

    const [error, setError] = useState<string>('');

    useAsyncEffect(async () => {
        try {
            setIsLoading(true);

            const onCallSchedules: ListResult<OnCallDutyPolicyEscalationRuleSchedule> =
                await ModelAPI.getList({
                    modelType: OnCallDutyPolicyEscalationRuleSchedule,
                    query: {
                        onCallDutyPolicyEscalationRuleId:
                            props.escalationRuleId,
                    },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    select: {
                        onCallDutyPolicySchedule: {
                            name: true,
                        },
                    },
                    sort: {},
                });

            const schedules: Array<OnCallDutyPolicySchedule> =
                onCallSchedules.data.map(
                    (onCallUser: OnCallDutyPolicyEscalationRuleSchedule) => {
                        return onCallUser.onCallDutyPolicySchedule!;
                    }
                );

            setSchedules(schedules);
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

    return <SchedulesElement schedules={schedules} />;
};

export default OnCallDutyScheduleView;
