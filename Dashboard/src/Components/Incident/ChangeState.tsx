import OneUptimeDate from 'Common/Types/Date';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import Button, { ButtonSize, ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import IncidentState from 'Model/Models/IncidentState';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import React, { FunctionComponent, ReactElement } from 'react';
import { useEffect } from 'react';
import { useState } from 'react';
import UserElement from '../User/User';

export enum IncidentType {
    Ack, Resolve
}

export interface ComponentProps {
    incidentId: ObjectID;
    incidentTimeline: Array<IncidentStateTimeline>;
    incidentType: IncidentType;
    onActionComplete: () => void; 
}

const ChangeIncidentState: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {

    const [isLoading, setIsLaoding] = useState<boolean>(false);
    const [incidentTimeline, setIncidentTimeline] = useState<IncidentStateTimeline | undefined>(undefined);

    useEffect(() => {
        for (const event of props.incidentTimeline) {

            if (event.incidentState && (event.incidentState.isAcknowledgedState || event.incidentState.isResolvedState) && props.incidentType === IncidentType.Ack && event.id) {
                setIncidentTimeline(event);
            }

            if (event.incidentState && event.incidentState.isResolvedState && props.incidentType === IncidentType.Resolve && event.id) {
                setIncidentTimeline(event);
            }

        } 
    }, [props.incidentTimeline]);


    if (incidentTimeline && incidentTimeline.createdByUser && incidentTimeline.createdAt) {
        return (<div>
            <UserElement user={incidentTimeline.createdByUser} />
            {OneUptimeDate.getDateAsLocalFormattedString(incidentTimeline.createdAt)}
        </div>)
    }


    return (
        <Button
            isLoading={isLoading}
            buttonSize={ButtonSize.Small}
            title={props.incidentType === IncidentType.Ack ? "Acknowledge Incident" : "Resolve Incident"}
            icon={props.incidentType === IncidentType.Ack ? IconProp.Circle : IconProp.CheckCircle}
            buttonStyle={props.incidentType === IncidentType.Ack ? ButtonStyleType.WARNING_OUTLINE : ButtonStyleType.SUCCESS_OUTLINE}
            onClick={async () => {
            setIsLaoding(true);
            const projectId: ObjectID | undefined | null = ProjectUtil.getCurrentProject()?.id; 

            if (!projectId) {
                throw new BadDataException("ProjectId not found.");
            }

            const incidentStates: ListResult<IncidentState> = await ModelAPI.getList<IncidentState>(IncidentState, {
                projectId: projectId,
            },
                99,
                0, {
                _id: true,
                isResolvedState: true,
                isAcknowledgedState: true,
                isCreatedState: true
            }, {}, {});

            let stateId: ObjectID | null = null;  

            for (const state of incidentStates.data) {
                if (props.incidentType === IncidentType.Ack && state.isAcknowledgedState) {
                    stateId = state.id; 
                    break; 
                }

                if (props.incidentType === IncidentType.Resolve && state.isResolvedState) {
                    stateId = state.id; 
                    break; 
                }
            }

            if (!stateId) {
                throw new BadDataException("Incident State not found.");
            }

            const incidentStateTimeline: IncidentStateTimeline = new IncidentStateTimeline();
            incidentStateTimeline.projectId = projectId; 
            incidentStateTimeline.incidentId = props.incidentId; 
            incidentStateTimeline.incidentStateId = stateId;

            await ModelAPI.create(incidentStateTimeline);

            props.onActionComplete();
            setIsLaoding(false);

        }} />
    )

};

export default ChangeIncidentState;
