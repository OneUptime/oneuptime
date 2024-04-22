import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
import PageComponentProps from '../../PageComponentProps';
import BaseModel from 'Common/Models/BaseModel';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import { ShowAs } from 'CommonUI/src/Components/ModelTable/BaseModelTable';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import UserElement from '../../../Components/User/User';
import User from 'Model/Models/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import AlignItem from 'CommonUI/src/Types/AlignItem';
import { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import IconProp from 'Common/Types/Icon/IconProp';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import BasicFormModal from 'CommonUI/src/Components/FormModal/BasicFormModal';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import ScheduledMaintenanceNoteTemplate from 'Model/Models/ScheduledMaintenanceNoteTemplate';
import OneUptimeDate from 'Common/Types/Date';
import CheckboxViewer from 'CommonUI/src/Components/Checkbox/CheckboxViewer';
import ProjectUser from '../../../Utils/ProjectUser';

const PublicNote: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [
        scheduledMaintenanceNoteTemplates,
        setScheduledMaintenanceNoteTemplates,
    ] = useState<Array<ScheduledMaintenanceNoteTemplate>>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [
        showScheduledMaintenanceNoteTemplateModal,
        setShowScheduledMaintenanceNoteTemplateModal,
    ] = useState<boolean>(false);
    const [
        initialValuesForScheduledMaintenance,
        setInitialValuesForScheduledMaintenance,
    ] = useState<JSONObject>({});

    const fetchScheduledMaintenanceNoteTemplate: (
        id: ObjectID
    ) => Promise<void> = async (id: ObjectID): Promise<void> => {
        setError('');
        setIsLoading(true);

        try {
            //fetch scheduledMaintenance template

            const scheduledMaintenanceNoteTemplate: ScheduledMaintenanceNoteTemplate | null =
                await ModelAPI.getItem<ScheduledMaintenanceNoteTemplate>({
                    modelType: ScheduledMaintenanceNoteTemplate,
                    id,
                    select: {
                        note: true,
                    },
                });

            if (scheduledMaintenanceNoteTemplate) {
                const initialValue: JSONObject = {
                    ...BaseModel.toJSONObject(
                        scheduledMaintenanceNoteTemplate,
                        ScheduledMaintenanceNoteTemplate
                    ),
                };

                setInitialValuesForScheduledMaintenance(initialValue);
            }
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
        setShowScheduledMaintenanceNoteTemplateModal(false);
    };

    const fetchScheduledMaintenanceNoteTemplates: () => Promise<void> =
        async (): Promise<void> => {
            setError('');
            setIsLoading(true);
            setInitialValuesForScheduledMaintenance({});

            try {
                const listResult: ListResult<ScheduledMaintenanceNoteTemplate> =
                    await ModelAPI.getList<ScheduledMaintenanceNoteTemplate>({
                        modelType: ScheduledMaintenanceNoteTemplate,
                        query: {},
                        limit: LIMIT_PER_PROJECT,
                        skip: 0,
                        select: {
                            templateName: true,
                            _id: true,
                        },
                        sort: {},
                    });

                setScheduledMaintenanceNoteTemplates(listResult.data);
            } catch (err) {
                setError(API.getFriendlyMessage(err));
            }

            setIsLoading(false);
        };

    return (
        <Fragment>
            <ModelTable<ScheduledMaintenancePublicNote>
                modelType={ScheduledMaintenancePublicNote}
                id="table-scheduled-maintenance-internal-note"
                name="Scheduled Maintenance Events > Public Notes"
                isDeleteable={true}
                createEditModalWidth={ModalWidth.Large}
                isCreateable={true}
                isEditable={true}
                showViewIdButton={true}
                showCreateForm={
                    Object.keys(initialValuesForScheduledMaintenance).length > 0
                }
                createInitialValues={initialValuesForScheduledMaintenance}
                isViewable={false}
                query={{
                    scheduledMaintenanceId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: ScheduledMaintenancePublicNote
                ): Promise<ScheduledMaintenancePublicNote> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.scheduledMaintenanceId = modelId;
                    item.projectId = new ObjectID(props.currentProject._id);
                    return Promise.resolve(item);
                }}
                cardProps={{
                    title: 'Public Notes',
                    buttons: [
                        {
                            title: 'Create from Template',
                            icon: IconProp.Template,
                            buttonStyle: ButtonStyleType.OUTLINE,
                            onClick: async (): Promise<void> => {
                                setShowScheduledMaintenanceNoteTemplateModal(
                                    true
                                );
                                await fetchScheduledMaintenanceNoteTemplates();
                            },
                        },
                    ],
                    description:
                        'Here are public notes for this scheduled maintenance. This will show up on the status page.',
                }}
                noItemsMessage={
                    'No public notes created for this scheduled maintenance so far.'
                }
                formFields={[
                    {
                        field: {
                            note: true,
                        },
                        title: 'Public Scheduled Maintenance Note',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                        description:
                            'This note is visible on your Status Page. This is in Markdown.',
                    },
                    {
                        field: {
                            shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
                                true,
                        },

                        title: 'Notify Status Page Subscribers',
                        stepId: 'more',
                        description:
                            'Should status page subscribers be notified?',
                        fieldType: FormFieldSchemaType.Checkbox,
                        defaultValue: true,
                        required: false,
                    },
                    {
                        field: {
                            postedAt: true,
                        },
                        title: 'Posted At',
                        fieldType: FormFieldSchemaType.DateTime,
                        required: true,
                        description:
                            'This is the date and time this note was posted. This is in ' +
                            OneUptimeDate.getCurrentTimezoneString() +
                            '.',
                        defaultValue: OneUptimeDate.getCurrentDate(),
                    },
                ]}
                showRefreshButton={true}
                showAs={ShowAs.List}
                viewPageRoute={Navigation.getCurrentRoute()}
                filters={[
                    {
                        field: {
                            createdByUser: true,
                        },
                        type: FieldType.Entity,
                        title: 'Created By',
                        filterEntityType: User,
                        fetchFilterDropdownOptions: async () => {
                            return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                                DashboardNavigation.getProjectId()!
                            );
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                    },
                    {
                        field: {
                            note: true,
                        },
                        type: FieldType.Text,
                        title: 'Note',
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        type: FieldType.Date,
                        title: 'Created At',
                    },
                ]}
                columns={[
                    {
                        field: {
                            createdByUser: {
                                name: true,
                                email: true,
                                profilePictureId: true,
                            },
                        },
                        title: '',

                        type: FieldType.Entity,

                        getElement: (
                            item: ScheduledMaintenancePublicNote
                        ): ReactElement => {
                            return (
                                <UserElement
                                    user={item['createdByUser']}
                                    suffix={'wrote'}
                                    usernameClassName={
                                        'text-base text-gray-900'
                                    }
                                    suffixClassName={
                                        'text-base text-gray-500 mt-1'
                                    }
                                />
                            );
                        },
                    },
                    {
                        field: {
                            postedAt: true,
                        },

                        alignItem: AlignItem.Right,
                        title: '',
                        type: FieldType.DateTime,
                        contentClassName:
                            'mt-1 whitespace-nowrap text-sm text-gray-600 sm:mt-0 sm:ml-3 text-right',
                    },
                    {
                        field: {
                            note: true,
                        },

                        title: '',
                        type: FieldType.Markdown,
                        contentClassName:
                            '-mt-3 space-y-6 text-sm text-gray-800',
                        colSpan: 2,
                    },
                    {
                        field: {
                            shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
                                true,
                        },
                        title: '',
                        type: FieldType.Boolean,
                        colSpan: 2,
                        getElement: (
                            item: ScheduledMaintenancePublicNote
                        ): ReactElement => {
                            return (
                                <div className="-mt-5">
                                    <CheckboxViewer
                                        isChecked={
                                            item[
                                                'shouldStatusPageSubscribersBeNotifiedOnNoteCreated'
                                            ] as boolean
                                        }
                                        text={
                                            item[
                                                'shouldStatusPageSubscribersBeNotifiedOnNoteCreated'
                                            ]
                                                ? 'Status Page Subscribers Notified'
                                                : 'Status Page Subscribers Not Notified'
                                        }
                                    />{' '}
                                </div>
                            );
                        },
                    },
                ]}
            />

            {scheduledMaintenanceNoteTemplates.length === 0 &&
            showScheduledMaintenanceNoteTemplateModal &&
            !isLoading ? (
                <ConfirmModal
                    title={`No ScheduledMaintenance Note Templates`}
                    description={`No scheduled maintenance note templates have been created yet. You can create these in Project Settings > Scheduled Maintenance > Note Templates.`}
                    submitButtonText={'Close'}
                    onSubmit={() => {
                        return setShowScheduledMaintenanceNoteTemplateModal(
                            false
                        );
                    }}
                />
            ) : (
                <></>
            )}

            {error ? (
                <ConfirmModal
                    title={`Error`}
                    description={`${error}`}
                    submitButtonText={'Close'}
                    onSubmit={() => {
                        return setError('');
                    }}
                />
            ) : (
                <></>
            )}

            {showScheduledMaintenanceNoteTemplateModal &&
            scheduledMaintenanceNoteTemplates.length > 0 ? (
                <BasicFormModal<JSONObject>
                    title="Create Note from Template"
                    isLoading={isLoading}
                    submitButtonText="Create from Template"
                    onClose={() => {
                        setShowScheduledMaintenanceNoteTemplateModal(false);
                        setIsLoading(false);
                    }}
                    onSubmit={async (data: JSONObject) => {
                        await fetchScheduledMaintenanceNoteTemplate(
                            data[
                                'scheduledMaintenanceNoteTemplateId'
                            ] as ObjectID
                        );
                    }}
                    formProps={{
                        initialValues: {},
                        fields: [
                            {
                                field: {
                                    scheduledMaintenanceNoteTemplateId: true,
                                },
                                title: 'Select Note Template',
                                description:
                                    'Select a template to create a note from.',
                                fieldType: FormFieldSchemaType.Dropdown,
                                dropdownOptions:
                                    DropdownUtil.getDropdownOptionsFromEntityArray(
                                        {
                                            array: scheduledMaintenanceNoteTemplates,
                                            labelField: 'templateName',
                                            valueField: '_id',
                                        }
                                    ),
                                required: true,
                                placeholder: 'Select Template',
                            },
                        ],
                    }}
                />
            ) : (
                <> </>
            )}
        </Fragment>
    );
};

export default PublicNote;
