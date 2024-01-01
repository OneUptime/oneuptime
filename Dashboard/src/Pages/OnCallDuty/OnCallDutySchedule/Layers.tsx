import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import OnCallDutySchedule from 'Model/Models/OnCallDutyPolicySchedule';
import Layers from '../../../Components/OnCallPolicy/OnCallScheduleLayer/Layers';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import Banner from 'CommonUI/src/Components/Banner/Banner';
import URL from 'Common/Types/API/URL';

const OnCallScheduleDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="On-Call Schedule"
            modelType={OnCallDutySchedule}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'On-Call Schedule',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View On-Call Schedule',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Layers',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS
                        ] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
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
        </ModelPage>
    );
};

export default OnCallScheduleDelete;
