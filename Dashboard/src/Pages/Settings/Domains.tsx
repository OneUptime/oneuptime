import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Domain from "Model/Models/Domain";
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import { JSONObject } from 'Common/Types/JSON';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import ObjectID from 'Common/Types/ObjectID';

const Domains: FunctionComponent<PageComponentProps> = (
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
                    title: 'Domains',
                    to: RouteMap[PageMap.SETTINGS_DOMAINS] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<Domain>
                modelType={Domain}
                query={{
                    projectId: props.currentProject?._id,
                }}
                id="domains-table"
                isDeleteable={true}
                isEditable={false}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Globe,
                    title: 'Domains',
                    description:
                        'Please list the domains you own here. This will help you to connect them to Status Page.',
                }}
                noItemsMessage={'No domains found.'}
                viewPageRoute={props.pageRoute}
                actionButtons={[
                    {
                        title: 'Verify Domain',
                        buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
                        icon: IconProp.Check,
                        isVisible: (item: JSONObject): boolean => {
                            if (item['isVerified']) {
                                return false; 
                            }

                            return true;
                        },
                        onClick: async (
                            item: JSONObject,
                            onCompleteAction: Function,
                            onError: (err: Error) => void
                        ) => {
                            try {
                                // verify domain.
                                await ModelAPI.updateById(
                                    Domain,
                                    new ObjectID(
                                        item['_id']
                                            ? item['_id'].toString()
                                            : ''
                                    ),
                                    {
                                        isVerified: true,
                                    },
                                    undefined,
                                );

                                
                                onCompleteAction();
                                
                            } catch (err) {
                                
                                onCompleteAction();
                                onError(err as Error);
                            }
                        },
                    },
                ]}
                formFields={[
                    {
                        field: {
                            domain: true,
                        },
                        title: 'Domain',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'acme-inc.com',
                        validation: {
                            minLength: 2,
                        },
                    }
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                columns={[
                    {
                        field: {
                            domain: true,
                        },
                        title: 'Domain',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            isVerified: true,
                        },
                        title: 'Verified',
                        type: FieldType.Boolean,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default Domains;
