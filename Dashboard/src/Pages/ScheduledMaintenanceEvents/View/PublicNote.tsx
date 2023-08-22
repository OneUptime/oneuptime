import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import ModelTable, {
    ShowTableAs,
} from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import UserElement from '../../../Components/User/User';
import User from 'Model/Models/User';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Navigation from 'CommonUI/src/Utils/Navigation';
import AlignItem from 'CommonUI/src/Types/AlignItem';
import { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import IconProp from 'Common/Types/Icon/IconProp';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import BasicFormModal from 'CommonUI/src/Components/FormModal/BasicFormModal';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import ScheduledMaintenanceNoteTemplate from 'Model/Models/ScheduledMaintenanceNoteTemplate';

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
                await ModelAPI.getItem<ScheduledMaintenanceNoteTemplate>(
                    ScheduledMaintenanceNoteTemplate,
                    id,
                    {
                        note: true,
                    }
                );

            if (scheduledMaintenanceNoteTemplate) {
                const initialValue: JSONObject = {
                    ...JSONFunctions.toJSONObject(
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
                    await ModelAPI.getList<ScheduledMaintenanceNoteTemplate>(
                        ScheduledMaintenanceNoteTemplate,
                        {},
                        LIMIT_PER_PROJECT,
                        0,
                        {
                            templateName: true,
                            _id: true,
                        },
                        {}
                    );

                setScheduledMaintenanceNoteTemplates(listResult.data);
            } catch (err) {
                setError(API.getFriendlyMessage(err));
            }

            setIsLoading(false);
        };

    return (
        <ModelPage
            title="Scheduled Event"
            modelType={ScheduledMaintenance}
            modelId={modelId}
            modelNameField="title"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Scheduled Maintenance Events',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Scheduled Maintenance Event',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Public Notes',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE
                        ] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
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
                ]}
                showRefreshButton={true}
                showTableAs={ShowTableAs.List}
                viewPageRoute={Navigation.getCurrentRoute()}
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
                        isFilterable: true,

                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <UserElement
                                    user={
                                        JSONFunctions.fromJSON(
                                            item['createdByUser'] as JSONObject,
                                            User
                                        ) as User
                                    }
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
                            createdAt: true,
                        },
                        isFilterable: true,
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
                        isFilterable: true,
                        title: '',
                        type: FieldType.Markdown,
                        contentClassName:
                            '-mt-3 space-y-6 text-sm text-gray-800',
                        colSpan: 2,
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
        </ModelPage>
    );
};

export default PublicNote;
