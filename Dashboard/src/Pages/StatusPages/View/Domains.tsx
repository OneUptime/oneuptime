import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Domain from 'Model/Models/Domain';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import StatusPagePreviewLink from './StatusPagePreviewLink';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
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
                    title: 'Domains',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <StatusPagePreviewLink modelId={modelId} />
            <ModelTable<StatusPageDomain>
                modelType={StatusPageDomain}
                query={{
                    projectId: props.currentProject?._id,
                    statusPageId: modelId,
                }}
                id="domains-table"
                isDeleteable={true}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Globe,
                    title: 'Custom Domains',
                    description:
                        'Important: Please add status-page.oneuptime.com as your CNAME for these domains for this to work.',
                }}
                onBeforeCreate={(
                    item: StatusPageDomain
                ): Promise<StatusPageDomain> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.statusPageId = modelId;
                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                noItemsMessage={'No custom domains found.'}
                viewPageRoute={props.pageRoute}
                formFields={[
                    {
                        field: {
                            subdomain: true,
                        },
                        title: 'Subdomain',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'status',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            domain: true,
                        },
                        title: 'Domain',
                        description:
                            'Please select a verified domain from this list. If you do not see any domains in this list, please head over to settings to add some.',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: Domain,
                            labelField: 'domain',
                            valueField: '_id',
                        },
                        required: true,
                        placeholder: 'Select domain',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                columns={[
                    {
                        field: {
                            fullDomain: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default StatusPageDelete;
