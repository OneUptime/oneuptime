import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import StatusPagePreviewLink from './StatusPagePreviewLink';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam(1)?.toString().substring(1) || ''
    );

    return (
        <Page
            title={'Status Page'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Subscriber Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS
                        ] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <StatusPagePreviewLink modelId={modelId} />
            <CardModelDetail<StatusPage>
                cardProps={{
                    title: 'Subscriber Settings',
                    description: 'Subscriber settings for this status page.',
                    icon: IconProp.Settings,
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            enableSubscribers: true,
                        },
                        title: 'Enable Subscribers',
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: false,
                        placeholder:
                            'Can subscribers subscribe to this status page?',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                enableSubscribers: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Enable Subscribers',
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </Page>
    );
};

export default StatusPageDelete;
