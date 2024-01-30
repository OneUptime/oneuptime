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
import IncidentState from 'Model/Models/IncidentState';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import React, {
    useState,
    useEffect,
    FunctionComponent,
    ReactElement,
} from 'react';
import UserElement from '../User/User';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import ModelFormModal from 'CommonUI/src/Components/ModelFormModal/ModelFormModal';

export enum IncidentType {
    Ack,
    Resolve,
}

export interface ComponentProps {
    incidentId: ObjectID;
    incidentTimeline: Array<IncidentStateTimeline>;
    incidentType: IncidentType;
    onActionComplete: () => void;
}

const ChangeIncidentState: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [incidentTimeline, setIncidentTimeline] = useState<
        IncidentStateTimeline | undefined
    >(undefined);

    const [showModal, setShowModal] = useState<boolean>(false);

    useEffect(() => {
        for (const event of props.incidentTimeline) {
            if (
                event.incidentState &&
                (event.incidentState.isAcknowledgedState ||
                    event.incidentState.isResolvedState) &&
                props.incidentType === IncidentType.Ack &&
                event.id
            ) {
                setIncidentTimeline(event);
            }

            if (
                event.incidentState &&
                event.incidentState.isResolvedState &&
                props.incidentType === IncidentType.Resolve &&
                event.id
            ) {
                setIncidentTimeline(event);
            }
        }
    }, [props.incidentTimeline]);

    if (incidentTimeline && incidentTimeline.createdAt) {
        return (
            <div>
                {incidentTimeline.createdByUser && (
                    <UserElement user={incidentTimeline.createdByUser} />
                )}
                {!incidentTimeline.createdByUser && (
                    <p>
                        {props.incidentType === IncidentType.Ack
                            ? 'Acknowledged'
                            : 'Resolved'}{' '}
                        by OneUptime
                    </p>
                )}
                {OneUptimeDate.getDateAsLocalFormattedString(
                    incidentTimeline.createdAt
                )}
            </div>
        );
    }

    return (
        <div className="-ml-3 mt-1">
            <Button
                buttonSize={ButtonSize.Small}
                title={
                    props.incidentType === IncidentType.Ack
                        ? 'Acknowledge Incident'
                        : 'Resolve Incident'
                }
                icon={
                    props.incidentType === IncidentType.Ack
                        ? IconProp.Circle
                        : IconProp.CheckCircle
                }
                buttonStyle={
                    props.incidentType === IncidentType.Ack
                        ? ButtonStyleType.WARNING_OUTLINE
                        : ButtonStyleType.SUCCESS_OUTLINE
                }
                onClick={async () => {
                    setShowModal(true);
                }}
            />

            {showModal && (
                <ModelFormModal
                    modelType={IncidentStateTimeline}
                    name={
                        props.incidentType === IncidentType.Ack
                            ? 'Acknowledge Incident'
                            : 'Resolve Incident'
                    }
                    title={
                        props.incidentType === IncidentType.Ack
                            ? 'Acknowledge Incident'
                            : 'Resolve Incident'
                    }
                    description={
                        props.incidentType === IncidentType.Ack
                            ? 'Mark this incident as acknowledged.'
                            : 'Mark this incident as resolved.'
                    }
                    onClose={() => {
                        setShowModal(false);
                    }}
                    submitButtonText="Save"
                    onBeforeCreate={async (model: IncidentStateTimeline) => {
                        const projectId: ObjectID | undefined | null =
                            ProjectUtil.getCurrentProject()?.id;

                        if (!projectId) {
                            throw new BadDataException('ProjectId not found.');
                        }

                        const incidentStates: ListResult<IncidentState> =
                            await ModelAPI.getList<IncidentState>({
                                modelType: IncidentState,
                                query: {
                                    projectId: projectId,
                                },
                                limit: 99,
                                skip: 0,
                                select: {
                                    _id: true,
                                    isResolvedState: true,
                                    isAcknowledgedState: true,
                                    isCreatedState: true,
                                },
                                sort: {},
                                requestOptions: {},
                            });

                        let stateId: ObjectID | null = null;

                        for (const state of incidentStates.data) {
                            if (
                                props.incidentType === IncidentType.Ack &&
                                state.isAcknowledgedState
                            ) {
                                stateId = state.id;
                                break;
                            }

                            if (
                                props.incidentType === IncidentType.Resolve &&
                                state.isResolvedState
                            ) {
                                stateId = state.id;
                                break;
                            }
                        }

                        if (!stateId) {
                            throw new BadDataException(
                                'Incident State not found.'
                            );
                        }

                        model.projectId = projectId;
                        model.incidentId = props.incidentId;
                        model.incidentStateId = stateId;

                        return model;
                    }}
                    onSuccess={() => {
                        setShowModal(false);
                        props.onActionComplete();
                    }}
                    formProps={{
                        name: 'create-scheduled-maintenance-state-timeline',
                        modelType: IncidentStateTimeline,
                        id: 'create-scheduled-maintenance-state-timeline',
                        fields: [
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

export default ChangeIncidentState;
