import MonitorsElement from '../../Components/Monitor/Monitors';
import DashboardNavigation from '../../Utils/Navigation';
import PageComponentProps from '../PageComponentProps';
import URL from 'Common/Types/API/URL';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import { ErrorFunction } from 'Common/Types/FunctionTypes';
import { JSONObject } from 'Common/Types/JSON';
import Banner from 'CommonUI/src/Components/Banner/Banner';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import BasicFormModal from 'CommonUI/src/Components/FormModal/BasicFormModal';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import API from 'CommonUI/src/Utils/API/API';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Monitor from 'Model/Models/Monitor';
import MonitorSecret from 'Model/Models/MonitorSecret';
import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';

const MonitorSecrets: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [currentlyEditingItem, setCurrentlyEditingItem] =
        useState<MonitorSecret | null>(null);

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');

    return (
        <Fragment>
            <Banner
                openInNewTab={true}
                title="How to use Monitor Secrets?"
                description="Learn how to use monitor secrets to store sensitive information like API keys, passwords, etc. that can be shared with monitors."
                link={URL.fromString(
                    'https://www.youtube.com/watch?v=V5eIpd_IPlU'
                )}
            />
            <ModelTable<MonitorSecret>
                modelType={MonitorSecret}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                id="monitor-secret-table"
                name="Settings > Monitor Secret"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                actionButtons={[
                    {
                        title: 'Update Secret Value',
                        buttonStyleType: ButtonStyleType.OUTLINE,
                        onClick: async (
                            item: MonitorSecret,
                            onCompleteAction: VoidFunction,
                            onError: ErrorFunction
                        ) => {
                            try {
                                setCurrentlyEditingItem(item);
                                onCompleteAction();
                            } catch (err) {
                                onCompleteAction();
                                onError(err as Error);
                            }
                        },
                    },
                ]}
                cardProps={{
                    title: 'Monitor Secrets',
                    description:
                        'Monitor secrets are used to store sensitive information like API keys, passwords, etc. that can be shared with monitors.',
                }}
                noItemsMessage={
                    'No monitor secret found. Click on the "Create" button to add a new monitor secret.'
                }
                viewPageRoute={Navigation.getCurrentRoute()}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Secret Name',
                        validation: {
                            minLength: 2,
                            noSpaces: true,
                            noNumbers: true,
                            noSpecialCharacters: true,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Secret Description',
                    },
                    {
                        field: {
                            secretValue: true,
                        },
                        title: 'Secret Value',
                        doNotShowWhenEditing: true, // Do not show this field when editing
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder:
                            'Secret Value (eg: API Key, Password, etc.)',
                    },
                    {
                        field: {
                            monitors: true,
                        },
                        title: 'Monitors which have access to this secret',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Monitor,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: true,
                        description:
                            'Whcih monitors should have access to this secret?',
                        placeholder: 'Select monitors',
                    },
                ]}
                sortBy="name"
                sortOrder={SortOrder.Ascending}
                showRefreshButton={true}
                filters={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            monitors: true,
                        },
                        title: 'Monitors which have access to this secret',
                        type: FieldType.EntityArray,

                        filterEntityType: Monitor,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                    },
                ]}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            monitors: {
                                name: true,
                                _id: true,
                                projectId: true,
                            },
                        },
                        title: 'Monitors which have access to this secret',
                        type: FieldType.EntityArray,

                        getElement: (item: MonitorSecret): ReactElement => {
                            return (
                                <MonitorsElement
                                    monitors={item['monitors'] || []}
                                />
                            );
                        },
                    },
                ]}
            />

            {currentlyEditingItem && (
                <BasicFormModal
                    title={'Update Secret Value'}
                    isLoading={isLoading}
                    error={error}
                    onClose={() => {
                        setError('');
                        setIsLoading(false);
                        return setCurrentlyEditingItem(null);
                    }}
                    onSubmit={async (data: JSONObject) => {
                        try {
                            setIsLoading(true);
                            setError('');

                            await ModelAPI.updateById<MonitorSecret>({
                                modelType: MonitorSecret,
                                id: currentlyEditingItem.id!,
                                data: {
                                    secretValue: data['secretValue'],
                                },
                            });

                            setCurrentlyEditingItem(null);
                        } catch (err) {
                            setError(API.getFriendlyMessage(err as Error));
                        }

                        setIsLoading(false);
                    }}
                    formProps={{
                        initialValues: {},
                        fields: [
                            {
                                field: {
                                    secretValue: true,
                                },
                                title: 'Secret Value',
                                description:
                                    'This value will be encrypted and stored securely. Once saved, this value cannot be retrieved.',
                                fieldType: FormFieldSchemaType.LongText,
                                required: true,
                                placeholder:
                                    'Secret Value (eg: API Key, Password, etc.)',
                            },
                        ],
                    }}
                />
            )}
        </Fragment>
    );
};

export default MonitorSecrets;
