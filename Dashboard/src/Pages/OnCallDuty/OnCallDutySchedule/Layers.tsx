import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Layers from '../../../Components/OnCallPolicy/OnCallScheduleLayer/Layers';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import Banner from 'CommonUI/src/Components/Banner/Banner';
import URL from 'Common/Types/API/URL';

const OnCallScheduleDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <Banner
                openInNewTab={true}
                title="Learn how on-call policy works"
                description="Watch this video to learn how to build effective on-call policies for your team."
                link={URL.fromString('https://youtu.be/HzhKmCryYdc')}
            />
            <Layers
                onCallDutyPolicyScheduleId={modelId}
                projectId={ProjectUtil.getCurrentProjectId()!}
            />
        </Fragment>
    );
};

export default OnCallScheduleDelete;
