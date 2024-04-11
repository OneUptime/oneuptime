import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPagePrivateUser from 'Model/Models/StatusPagePrivateUser';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Green, Yellow } from 'Common/Types/BrandColors';
import Navigation from 'CommonUI/src/Utils/Navigation';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <ModelTable<StatusPagePrivateUser>
                modelType={StatusPagePrivateUser}
                id="status-page-group"
                name="Status Page > Private Users"
                isDeleteable={true}
                showViewIdButton={true}
                isCreateable={true}
                isViewable={false}
                query={{
                    statusPageId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: StatusPagePrivateUser
                ): Promise<StatusPagePrivateUser> => {
                    item.statusPageId = modelId;
                    item.projectId = DashboardNavigation.getProjectId()!;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    title: 'Private Users',
                    description:
                        'Here are a list of private users for this status page.',
                }}
                noItemsMessage={
                    'No private users created for this status page.'
                }
                formFields={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        fieldType: FormFieldSchemaType.Email,
                        required: true,
                        placeholder: 'user@company.com',
                    },
                ]}
                showRefreshButton={true}
                filters={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        type: FieldType.Email,
                    },
                ]}
                columns={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        type: FieldType.Email,
                    },
                    {
                        field: {
                            password: true,
                        },
                        title: 'Status',
                        type: FieldType.Password,

                        getElement: (item: JSONObject): ReactElement => {
                            if (item['password']) {
                                return (
                                    <Pill color={Green} text={'Signed up'} />
                                );
                            }
                            return <Pill color={Yellow} text={'Invite Sent'} />;
                        },
                    },
                ]}
            />
        </Fragment>
    );
};

export default StatusPageDelete;
