import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import IconProp from 'Common/Types/Icon/IconProp';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ProjectSmtpConfig from 'Model/Models/ProjectSmtpConfig';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import ProjectSMTPConfig from '../../../Components/ProjectSMTPConfig/ProjectSMTPConfig';
import PlaceholderText from 'CommonUI/src/Components/Detail/PlaceholderText';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="Status Page"
            modelType={StatusPage}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        {modelId}
                    ),
                },
                {
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        {modelId}
                    ),
                },
                {
                    title: 'View Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        {modelId}
                    ),
                },
                {
                    title: 'Custom SMTP',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW_CUSTOM_SMTP] as Route,
                        {modelId}
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <CardModelDetail<StatusPage>
                name="Status Page > Email > Subscriber"
                cardProps={{
                    title: 'Custom SMTP',
                    description:
                        'Custom SMTP settings for this status page. This will be used to send emails to subscribers.',
                    icon: IconProp.Email,
                }}
                editButtonText={'Edit SMTP'}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            smtpConfig: true,
                        },
                        title: 'Custom SMTP Config',
                        description:
                            'Select SMTP Config to use for this status page to send email to subscribers. You can add SMTP Config in Project Settings > Custom SMTP.',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: ProjectSmtpConfig,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'SMTP Config',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                smtpConfig: {
                                    name: true,
                                },
                            },
                            title: 'Custom SMTP Config',
                            type: FieldType.Entity,
                            getElement: (item: JSONObject): ReactElement => {
                                if (item['smtpConfig']) {
                                    return (
                                        <ProjectSMTPConfig
                                            smtpConfig={
                                                item[
                                                    'smtpConfig'
                                                ] as ProjectSmtpConfig
                                            }
                                        />
                                    );
                                }
                                return (
                                    <PlaceholderText
                                        text="No Custom SMTP Config selected so far
                                    for this status page."
                                    />
                                );
                            },
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </ModelPage>
    );
};

export default StatusPageDelete;
