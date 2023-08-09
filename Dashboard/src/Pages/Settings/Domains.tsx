import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import Domain from 'Model/Models/Domain';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import { JSONObject } from 'Common/Types/JSON';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import ObjectID from 'Common/Types/ObjectID';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import API from 'CommonUI/src/Utils/API/API';

const Domains: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [showVerificationModal, setShowVerificationModal] =
        useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [currentVerificationDomain, setCurrentVerificationDomain] =
        useState<JSONObject | null>(null);
    const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
    const [isVerificationLoading, setIsVerificationLoading] =
        useState<boolean>(false);

    useEffect(() => {
        setError('');
    }, [showVerificationModal]);

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
                    title: 'Domains',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_DOMAINS] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<Domain>
                modelType={Domain}
                showViewIdButton={true}
                name="Settings > Domain"
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                id="domains-table"
                isDeleteable={true}
                isEditable={false}
                isCreateable={true}
                cardProps={{
                    title: 'Domains',
                    description:
                        'Please list the domains you own here. This will help you to connect them to Status Page.',
                }}
                refreshToggle={refreshToggle}
                noItemsMessage={'No domains found.'}
                viewPageRoute={Navigation.getCurrentRoute()}
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
                                setCurrentVerificationDomain(item);
                                setShowVerificationModal(true);

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
                        fieldType: FormFieldSchemaType.Domain,
                        required: true,
                        placeholder: 'acme-inc.com',
                        validation: {
                            minLength: 2,
                        },
                    },
                ]}
                selectMoreFields={{
                    domainVerificationText: true,
                }}
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
            {showVerificationModal && currentVerificationDomain ? (
                <ConfirmModal
                    title={`Verify ${currentVerificationDomain['domain']}`}
                    error={error}
                    description={
                        <div>
                            <span>
                                Please add TXT record to your domain. Details of
                                the TXT records are:
                            </span>
                            <br />
                            <br />
                            <span>
                                <b>Record Type: </b> TXT
                            </span>
                            <br />
                            <span>
                                <b>Name: </b> @ or{' '}
                                {currentVerificationDomain[
                                    'domain'
                                ]?.toString()}
                            </span>
                            <br />
                            <span>
                                <b>Content: </b>
                                {(currentVerificationDomain[
                                    'domainVerificationText'
                                ] as string) || ''}
                            </span>
                            <br />
                            <br />
                            <span>
                                Please note: Some domain changes might take 72
                                hours to propagate.
                            </span>
                        </div>
                    }
                    submitButtonText={'Verify Domain'}
                    onClose={() => {
                        setShowVerificationModal(false);
                        setError('');
                    }}
                    isLoading={isVerificationLoading}
                    onSubmit={async () => {
                        try {
                            setIsVerificationLoading(true);
                            setError('');
                            // verify domain.
                            await ModelAPI.updateById(
                                Domain,
                                new ObjectID(
                                    currentVerificationDomain['_id']
                                        ? currentVerificationDomain[
                                              '_id'
                                          ].toString()
                                        : ''
                                ),
                                {
                                    isVerified: true,
                                },
                                undefined
                            );
                            setIsVerificationLoading(false);
                            setShowVerificationModal(false);
                            setRefreshToggle(!refreshToggle);
                        } catch (err) {
                            setError(API.getFriendlyMessage(err));
                            setIsVerificationLoading(false);
                        }
                    }}
                />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Domains;
