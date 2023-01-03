import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Label from 'Model/Models/Label';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import Color from 'Common/Types/Color';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import DashboardNavigation from '../../Utils/Navigation';
const Labels: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Settings',
                    to: RouteMap[PageMap.SETTINGS] as Route,
                },
                {
                    title: 'Labels',
                    to: RouteMap[PageMap.SETTINGS_LABELS] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<Label>
                modelType={Label}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                id="labels-table"
                name="Settings > Labels"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Label,
                    title: 'Labels',
                    description:
                        'Labels help you categorize resources in your project and give granular permissions to access those resources to team members.',
                }}
                noItemsMessage={'No labels found.'}
                viewPageRoute={props.pageRoute}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'internal-service',
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
                            'This label is for all the internal services.',
                    },
                    {
                        field: {
                            color: true,
                        },
                        title: 'Label Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: true,
                        placeholder: 'Please select color for this label.',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                selectMoreFields={{
                    color: true,
                }}
                columns={[
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

export default Labels;
