import UserElement from '../User/User';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import OneUptimeDate from 'Common/Types/Date';
import BadDataException from 'Common/Types/Exception/BadDataException';
import IconProp from 'Common/Types/Icon/IconProp';
import ObjectID from 'Common/Types/ObjectID';
import Button, {
    ButtonSize,
    ButtonStyleType,
} from 'CommonUI/src/Components/Button/Button';
import { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelFormModal from 'CommonUI/src/Components/ModelFormModal/ModelFormModal';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

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
    const [scheduledMaintenanceTimeline, setScheduledMaintenanceTimeline] =
        useState<ScheduledMaintenanceStateTimeline | undefined>(undefined);

    const [showModal, setShowModal] = useState<boolean>(false);

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
                    setShowModal(true);
                }}
            />

            {showModal && (
                <ModelFormModal
                    modelType={ScheduledMaintenanceStateTimeline}
                    name={
                        props.stateType === StateType.Ongoing
                            ? 'Mark as Ongoing'
                            : 'Mark as Complete'
                    }
                    title={
                        props.stateType === StateType.Ongoing
                            ? 'Mark as Ongoing'
                            : 'Mark as Complete'
                    }
                    description={
                        props.stateType === StateType.Ongoing
                            ? 'Mark this scheduled maintenance as ongoing.'
                            : 'Mark this scheduled maintenance as complete.'
                    }
                    onClose={() => {
                        setShowModal(false);
                    }}
                    submitButtonText="Save"
                    onBeforeCreate={async (
                        model: ScheduledMaintenanceStateTimeline
                    ) => {
                        const projectId: ObjectID | undefined | null =
                            ProjectUtil.getCurrentProject()?.id;

                        if (!projectId) {
                            throw new BadDataException('ProjectId not found.');
                        }

                        const scheduledMaintenanceStates: ListResult<ScheduledMaintenanceState> =
                            await ModelAPI.getList<ScheduledMaintenanceState>({
                                modelType: ScheduledMaintenanceState,
                                query: {
                                    projectId: projectId,
                                },
                                limit: LIMIT_PER_PROJECT,
                                skip: 0,
                                select: {
                                    _id: true,
                                    isResolvedState: true,
                                    isOngoingState: true,
                                    isScheduledState: true,
                                },
                                sort: {},
                            });

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

                        model.projectId = projectId;
                        model.scheduledMaintenanceId =
                            props.scheduledMaintenanceId;
                        model.scheduledMaintenanceStateId = stateId;

                        return model;
                    }}
                    onSuccess={() => {
                        setShowModal(false);
                        props.onActionComplete();
                    }}
                    formProps={{
                        name: 'create-scheduled-maintenance-state-timeline',
                        modelType: ScheduledMaintenanceStateTimeline,
                        id: 'create-scheduled-maintenance-state-timeline',
                        fields: [
                            {
                                field: {
                                    publicNote: true,
                                } as any,
                                fieldType: FormFieldSchemaType.Markdown,
                                description:
                                    'Post a public note about this state change to the status page.',
                                title: 'Public Note',
                                required: false,
                                overrideFieldKey: 'publicNote',
                                showEvenIfPermissionDoesNotExist: true,
                            },
                            {
                                field: {
                                    shouldStatusPageSubscribersBeNotified: true,
                                },
                                fieldType: FormFieldSchemaType.Checkbox,
                                description:
                                    'Notify subscribers of this state change.',
                                title: 'Notify Status Page Subscribers',
                                required: false,
                                defaultValue: true,
                            },
                        ],
                        formType: FormType.Create,
                    }}
                />
            )}
        </div>
    );
};

export default ChangeScheduledMaintenanceState;
