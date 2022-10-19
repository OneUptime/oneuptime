import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable, {
    ShowTableAs,
} from 'CommonUI/src/Components/ModelTable/ModelTable';
import IncidentState from 'Model/Models/IncidentState';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import Color from 'Common/Types/Color';
import SortOrder from 'Common/Types/Database/SortOrder';
import BadDataException from 'Common/Types/Exception/BadDataException';

const IncidentsPage: FunctionComponent<PageComponentProps> = (
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
                    title: 'Incident State',
                    to: RouteMap[PageMap.SETTINGS_INCIDENTS_STATE] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<IncidentState>
                modelType={IncidentState}
                id="incident-state-table"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Disc,
                    title: 'Incident State',
                    description:
                        'Incidents have multiple states like - created, acknowledged and resolved. You can more states help you manage incidents here.',
                }}
                sortBy="order"
                sortOrder={SortOrder.Ascending}
                onBeforeDelete={(item: IncidentState) => {
                    if (item.isCreatedState) {
                        throw new BadDataException(
                            'This incident cannot be deleted because its the created incident state of for this project. Created, Acknowledged, Resolved incident states cannot be deleted.'
                        );
                    }

                    if (item.isAcknowledgedState) {
                        throw new BadDataException(
                            'This incident cannot be deleted because its the acknowledged incident state of for this project. Created, Acknowledged, Resolved incident states cannot be deleted.'
                        );
                    }

                    if (item.isResolvedState) {
                        throw new BadDataException(
                            'This incident cannot be deleted because its the resolved incident state of for this project. Created, Acknowledged, Resolved incident states cannot be deleted.'
                        );
                    }

                    return item;
                }}
                selectMoreFields={{
                    color: true,
                    isCreatedState: true,
                    isAcknowledgedState: true,
                    isResolvedState: true,
                    order: true,
                }}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
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
                    },
                ]}
                noItemsMessage={'No incident state found.'}
                viewPageRoute={props.pageRoute}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Investigating',
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
                            'This incident state happens when the incident is investigated',
                    },
                    {
                        field: {
                            color: true,
                        },
                        title: 'Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: true,
                        placeholder:
                            'Please select color for this incident state.',
                    },
                ]}
                showRefreshButton={true}
                showTableAs={ShowTableAs.OrderedStatesList}
                orderedStatesListProps={{
                    titleField: 'name',
                    descriptionField: 'description',
                    orderField: 'order',
                    shouldAddItemInTheEnd: true,
                }}
            />
        </Page>
    );
};

export default IncidentsPage;
