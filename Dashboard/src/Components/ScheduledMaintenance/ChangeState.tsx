import OneUptimeDate from 'Common/Types/Date';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import Button, {
    ButtonSize,
    ButtonStyleType,
} from 'CommonUI/src/Components/Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import React, {
    useState,
    useEffect,
    FunctionComponent,
    ReactElement,
} from 'react';
import UserElement from '../User/User';

export enum StateType {
    Ongoing,
    Completed,
}

export interface ComponentProps {
    scheduledMaintenanceId: ObjectID;
    scheduledMaintenanceTimeline: Array<ScheduledMaintenanceStateTimeline>;
    stateType: StateType;
    onActionComplete: () => void;
}

const ChangeScheduledMaintenanceState: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isLoading, setIsLaoding] = useState<boolean>(false);
    const [scheduledMaintenanceTimeline, setScheduledMaintenanceTimeline] =
        useState<ScheduledMaintenanceStateTimeline | undefined>(undefined);

    useEffect(() => {
        for (const event of props.scheduledMaintenanceTimeline) {
            if (
                event.scheduledMaintenanceState &&
                (event.scheduledMaintenanceState.isOngoingState ||
                    event.scheduledMaintenanceState.isResolvedState) &&
                props.stateType === StateType.Ongoing &&
                event.id
            ) {
                setScheduledMaintenanceTimeline(event);
            }

            if (
                event.scheduledMaintenanceState &&
                event.scheduledMaintenanceState.isResolvedState &&
                props.stateType === StateType.Completed &&
                event.id
            ) {
                setScheduledMaintenanceTimeline(event);
            }
        }
    }, [props.scheduledMaintenanceTimeline]);

    if (
        scheduledMaintenanceTimeline &&
        scheduledMaintenanceTimeline.createdAt
    ) {
        return (
            <div>
                <UserElement
                    user={scheduledMaintenanceTimeline.createdByUser}
                    prefix="Changed by"
                />
                {OneUptimeDate.getDateAsLocalFormattedString(
                    scheduledMaintenanceTimeline.createdAt
                )}
            </div>
        );
    }

    return (
        <div className="-ml-3 mt-2">
            <Button
                isLoading={isLoading}
                buttonSize={ButtonSize.Small}
                title={
                    props.stateType === StateType.Ongoing
                        ? 'Mark as Ongoing'
                        : 'Mark as Complete'
                }
                icon={
                    props.stateType === StateType.Ongoing
                        ? IconProp.Circle
                        : IconProp.CheckCircle
                }
                buttonStyle={
                    props.stateType === StateType.Ongoing
                        ? ButtonStyleType.WARNING_OUTLINE
                        : ButtonStyleType.SUCCESS_OUTLINE
                }
                onClick={async () => {
                    setIsLaoding(true);
                    const projectId: ObjectID | undefined | null =
                        ProjectUtil.getCurrentProject()?.id;

                    if (!projectId) {
                        throw new BadDataException('ProjectId not found.');
                    }

                    const scheduledMaintenanceStates: ListResult<ScheduledMaintenanceState> =
                        await ModelAPI.getList<ScheduledMaintenanceState>(
                            ScheduledMaintenanceState,
                            {
                                projectId: projectId,
                            },
                            99,
                            0,
                            {
                                _id: true,
                                isResolvedState: true,
                                isOngoingState: true,
                                isScheduledState: true,
                            },
                            {},
                           
                        );

                    let stateId: ObjectID | null = null;

                    for (const state of scheduledMaintenanceStates.data) {
                        if (
                            props.stateType === StateType.Ongoing &&
                            state.isOngoingState
                        ) {
                            stateId = state.id;
                            break;
                        }

                        if (
                            props.stateType === StateType.Completed &&
                            state.isResolvedState
                        ) {
                            stateId = state.id;
                            break;
                        }
                    }

                    if (!stateId) {
                        throw new BadDataException(
                            'Scheduled Maintenance State not found.'
                        );
                    }

                    const scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline =
                        new ScheduledMaintenanceStateTimeline();
                    scheduledMaintenanceStateTimeline.projectId = projectId;
                    scheduledMaintenanceStateTimeline.scheduledMaintenanceId =
                        props.scheduledMaintenanceId;
                    scheduledMaintenanceStateTimeline.scheduledMaintenanceStateId =
                        stateId;

                    await ModelAPI.create(
                        scheduledMaintenanceStateTimeline,
                        ScheduledMaintenanceStateTimeline
                    );

                    props.onActionComplete();
                    setIsLaoding(false);
                }}
            />
        </div>
    );
};

export default ChangeScheduledMaintenanceState;
