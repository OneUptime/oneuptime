import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Workflow from 'Model/Models/Workflow';
import DuplicateModel from 'CommonUI/src/Components/DuplicateModel/DuplicateModel';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="Workflow"
            modelType={Workflow}
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
                    title: 'Workflows',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOWS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Workflow',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_VIEW_SETTINGS] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <DuplicateModel
                modelId={modelId}
                modelType={Workflow}
                fieldsToDuplicate={{
                    description: true,
                    graph: true,
                    isEnabled: true,
                    labels: true,
                }}
                navigateToOnSuccess={RouteUtil.populateRouteParams(
                    new Route(RouteMap[PageMap.WORKFLOWS]?.toString()).addRoute(
                        '/workflow'
                    )
                )}
                fieldsToChange={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'New Workflow Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'New Workflow Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                ]}
            />
        </ModelPage>
    );
};

export default Settings;
