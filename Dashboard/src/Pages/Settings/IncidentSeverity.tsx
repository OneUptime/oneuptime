import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable, {
    ShowTableAs,
} from 'CommonUI/src/Components/ModelTable/ModelTable';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import Color from 'Common/Types/Color';
import SortOrder from 'Common/Types/Database/SortOrder';
import Navigation from 'CommonUI/src/Utils/Navigation';
const IncidentSeverityPage: FunctionComponent<PageComponentProps> = (
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
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_INCIDENTS_STATE] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<IncidentSeverity>
                modelType={IncidentSeverity}
                id="incident-state-table"
                name="Settings > Incident Severity"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Error,
                    title: 'Incident Severity',
                    description:
                        'Alerts and incidents will be categorised according to their severity level using the following classifications: ',
                }}
                sortBy="order"
                sortOrder={SortOrder.Ascending}
                selectMoreFields={{
                    color: true,
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
                                    isMinimal={true}
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
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <div>
                                    <p>{`${item['description']}`}</p>
                                    <p className="text-xs text-gray-400">
                                        ID: {`${item['_id']}`}
                                    </p>
                                </div>
                            );
                        },
                    },
                ]}
                noItemsMessage={'No incident severity found.'}
                viewPageRoute={Navigation.getCurrentRoute()}
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

export default IncidentSeverityPage;
