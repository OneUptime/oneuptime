import Route from 'Common/Types/API/Route';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ModelDelete from 'CommonUI/src/Components/ModelDelete/ModelDelete';
import ObjectID from 'Common/Types/ObjectID';
import OnCallDutySchedule from 'Model/Models/OnCallDutyPolicySchedule';

const OnCallScheduleDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <ModelDelete
                modelType={OnCallDutySchedule}
                modelId={modelId}
                onDeleteSuccess={() => {
                    Navigation.navigate(
                        RouteMap[PageMap.ON_CALL_DUTY] as Route
                    );
                }}
            />
        </Fragment>
    );
};

export default OnCallScheduleDelete;
