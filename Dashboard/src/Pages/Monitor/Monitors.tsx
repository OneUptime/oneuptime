import Route from 'Common/Types/API/Route';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import MonitorTable from '../../Components/Monitor/MonitorTable';
import DashboardNavigation from '../../Utils/Navigation';
import Banner from 'CommonUI/src/Components/Banner/Banner';
import URL from 'Common/Types/API/URL';

const MonitorPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
    return (
        <Fragment>
            <Banner
                openInNewTab={true}
                title="Monitoring Demo"
                description="Watch this video which will help monitor any resource you have with OneUptime"
                link={URL.fromString('https://youtu.be/_fQ_F4EisBQ')}
            />
            <MonitorTable
                viewPageRoute={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITORS] as Route
                )}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
            />
        </Fragment>
    );
};

export default MonitorPage;
