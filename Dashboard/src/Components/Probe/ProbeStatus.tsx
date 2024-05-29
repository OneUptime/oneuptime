import { Green, Red } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';
import { JSONObject } from 'Common/Types/JSON';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import Probe from 'Model/Models/Probe';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    probe: Probe | JSONObject;
}

const ProbeStatusElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (
        props.probe &&
        props.probe['lastAlive'] &&
        OneUptimeDate.getNumberOfMinutesBetweenDates(
            OneUptimeDate.fromString(props.probe['lastAlive'] as string),
            OneUptimeDate.getCurrentDate()
        ) < 5
    ) {
        return (
            <Statusbubble
                text={'Connected'}
                color={Green}
                shouldAnimate={true}
            />
        );
    }

    return (
        <Statusbubble text={'Disconnected'} color={Red} shouldAnimate={false} />
    );
};

export default ProbeStatusElement;
