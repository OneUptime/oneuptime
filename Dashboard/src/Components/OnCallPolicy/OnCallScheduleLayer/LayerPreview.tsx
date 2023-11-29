// import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
// import OnCallDutyPolicyScheduleLayerUser from 'Model/Models/OnCallDutyPolicyScheduleLayerUser';
import React, { FunctionComponent, ReactElement } from 'react';
import Calendar from 'CommonUI/src/Components/Calendar/Calendar';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';

export interface ComponentProps {
    // layer: OnCallDutyPolicyScheduleLayer;
    // layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
    id?: string | undefined;
}

const LayerPreview: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div id={props.id}>
            <FieldLabelElement
                required={true}
                title="Layer Preview"
                description="Here is a preview of who is on call and when."
            />
            <Calendar
                events={[
                    {
                        id: 0,
                        title: 'All Day Event very long title',
                        allDay: true,
                        start: new Date(2023, 11, 0),
                        end: new Date(2023, 11, 1),
                    },
                    {
                        id: 1,
                        title: 'Long Event',
                        start: new Date(2023, 11, 7),
                        end: new Date(2023, 11, 10),
                    },

                    {
                        id: 2,
                        title: 'DTS STARTS',
                        start: new Date(2016, 11, 13, 0, 0, 0),
                        end: new Date(2016, 11, 20, 0, 0, 0),
                    },
                ]}
            />
        </div>
    );
};

export default LayerPreview;
