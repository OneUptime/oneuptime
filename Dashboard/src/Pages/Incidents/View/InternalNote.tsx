import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import IncidentInternalNote from 'Model/Models/IncidentInternalNote';
import ModelTable, {
    ShowTableAs,
} from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import UserElement from '../../../Components/User/User';
import User from 'Model/Models/User';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Navigation from 'CommonUI/src/Utils/Navigation';

const IncidentDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = DashboardNavigation.getProjectId()!;

    return (
        <Page
            title={'Incidents'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENTS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Incident',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENT_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Private Notes',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENT_INTERNAL_NOTE] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<IncidentInternalNote>
                modelType={IncidentInternalNote}
                id="table-incident-internal-note"
                name="Monitor > Internal Note"
                isDeleteable={true}
                isCreateable={true}
                isEditable={true}
                isViewable={false}
                query={{
                    incidentId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: IncidentInternalNote
                ): Promise<IncidentInternalNote> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.incidentId = modelId;
                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.Lock,
                    title: 'Private Notes',
                    description: 'Here are private notes for this incident.',
                }}
                noItemsMessage={
                    'No private notes created for this incident so far.'
                }
                formFields={[
                    {
                        field: {
                            note: true,
                        },
                        title: 'Private Incident Note',
                        description:
                            'This is in markdown. This note is private to your team members and is not visible to public.',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                        placeholder:
                            'Add a private note to this incident here.',
                    },
                ]}
                showRefreshButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                showTableAs={ShowTableAs.List}
                columns={[
                    {
                        field: {
                            note: true,
                        },
                        title: 'Note',
                        type: FieldType.Markdown,
                    },
                    {
                        field: {
                            createdByUser: {
                                name: true,
                                email: true,
                            },
                        },
                        title: 'Posted By',
                        type: FieldType.Entity,
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['createdByUser']) {
                                return (
                                    <UserElement
                                        user={
                                            JSONFunctions.fromJSON(
                                                item[
                                                    'createdByUser'
                                                ] as JSONObject,
                                                User
                                            ) as User
                                        }
                                    />
                                );
                            }

                            return <></>;
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Posted At',
                        type: FieldType.DateTime,
                    },
                ]}
            />
        </Page>
    );
};

export default IncidentDelete;
