import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Label from 'Model/Models/Label';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import LabelsElement from '../../../Components/Label/Labels';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Monitor from 'Model/Models/Monitor';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import Color from 'Common/Types/Color';

const MonitorView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam()?.toString().substring(1) || ''
    );

    return (
        <Page
            title={'Monitors'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route, modelId)
                },
                {
                    title: 'Monitors',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.MONITORS] as Route, modelId),
                },
                {
                    title: 'View Monitor',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.MONITOR_VIEW] as Route, modelId),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId}/>}
        >
            {/* Monitor View  */}
            <CardModelDetail
                cardProps={{
                    title: 'Monitor Details',
                    description: "Here's more details for this monitor.",
                    icon: IconProp.Activity,
                }}
                
                isEditable={true}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Monitor Name',
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
                        placeholder: 'Description',
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels (Optional)',
                        description:
                            'Team members with access to these labels will only be able to access this monitor. This is optional and an advanced feature.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Label,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Labels',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 2,
                    modelType: Monitor,
                    id: 'model-detail-monitors',
                    fields: [
                        {
                            field: {
                                name: true,
                            },
                            title: 'Monitor Name',
                        },
                        {
                            field: {
                                currentMonitorStatus: {
                                    color: true,
                                    name: true,
                                },
                            },
                            title: 'Current Status',
                            type: FieldType.Text,
                            getElement: (item: JSONObject): ReactElement => {
                                if (!item['currentMonitorStatus']) {
                                    throw new BadDataException(
                                        'Monitor Status not found'
                                    );
                                }
    
                                return (
                                    <Statusbubble
                                        color={
                                            (
                                                item[
                                                    'currentMonitorStatus'
                                                ] as JSONObject
                                            )['color'] as Color
                                        }
                                        text={
                                            (
                                                item[
                                                    'currentMonitorStatus'
                                                ] as JSONObject
                                            )['name'] as string
                                        }
                                    />
                                );
                            },
                        },
                        {
                            field: {
                                monitorType: true,
                            },
                            title: 'Monitor Type',

                        },
                        {
                            field: {
                                labels: {
                                    name: true,
                                    color: true,
                                },
                            },
                            title: 'Labels',
                            type: FieldType.Text,
                            getElement: (item: JSONObject): ReactElement => {
                                return (
                                    <LabelsElement
                                        labels={
                                            Label.fromJSON(
                                                (item['labels'] as JSONArray) || [],
                                                Label
                                            ) as Array<Label>
                                        }
                                    />
                                );
                            },
                        },
                        {
                            field: {
                                description: true,
                            },
                            title: 'Description',
                        },
                        
                    ],
                    modelId: modelId,
                }}
            />

            
        </Page>
    );
};

export default MonitorView;
