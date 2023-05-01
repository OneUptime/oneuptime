import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Probe from 'Model/Models/Probe';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import Color from 'Common/Types/Color';
import IconProp from 'Common/Types/Icon/IconProp';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';

const ProbePage: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {

    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS] as Route
                    ),
                },
                {
                    title: 'Probes',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_PROBES] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<Probe>
                modelType={Probe}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                id="probes-table"
                name="Settings > Probes"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Signal,
                    title: 'Custom Probes',
                    description:
                        'Custom Probes help you monitor internal resources that is behind your firewall.',
                }}
                noItemsMessage={'No probes found.'}
                viewPageRoute={Navigation.getCurrentRoute()}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'internal-probe',
                        validation: {
                            minLength: 2,
                        },
                    },
                    
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder:
                            'This probe is to monitor all the internal services.',
                    },
                    {
                        field: {
                            iconFile: true,
                        },
                        title: 'Probe Logo',
                        fieldType: FormFieldSchemaType.ImageFile,
                        required: false,
                        placeholder: 'Upload logo',
                    },
                    
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                
                columns={[
                    {
                        field: {
                            _id: true,
                        },
                        title: 'Probe ID',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                        isFilterable: true,

                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <Pill
                                    color={item['color'] as Color}
                                    text={item['name'] as string}
                                />
                            );
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default ProbePage;
