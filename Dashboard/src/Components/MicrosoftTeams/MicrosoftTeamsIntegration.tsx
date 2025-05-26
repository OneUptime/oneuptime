import React, { Fragment, FunctionComponent, ReactElement, useEffect, useState } from 'react';
import Card, { CardButtonSchema } from 'CommonUI/src/Components/Card/Card';
import ButtonStyleType from 'CommonUI/src/Components/Button/ButtonStyleType';
import IconProp from 'CommonUI/src/Types/Icon/IconProp';
import Navigation from 'CommonUI/src/Utils/Navigation';
import URL from 'Common/Types/API/URL';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import Link from 'CommonUI/src/Components/Link/Link'; 
import Route from 'Common/Types/API/Route';
import ObjectID from 'Common/Types/ObjectID';
import { JSONObject } from 'Common/Types/JSON';
import { PromiseVoidFunction, VoidFunction } from 'Common/Types/FunctionTypes';
import WorkspaceType from 'Common/Types/Workspace/WorkspaceType';

import ProjectUtil from 'CommonUI/src/Utils/Project';
import UserUtil from 'CommonUI/src/Utils/User';
import API from 'CommonUI/src/Utils/API/API'; 
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';

import WorkspaceProjectAuthToken from 'Model/Models/WorkspaceProjectAuthToken';
import WorkspaceUserAuthToken from 'Model/Models/WorkspaceUserAuthToken';

import { APP_API_URL, MS_TEAMS_APP_CLIENT_ID } from 'CommonUI/src/Config'; 
import MicrosoftTeamsIntegrationDocumentation from './MicrosoftTeamsIntegrationDocumentation'; // Import the documentation component
import { ModelField } from 'CommonUI/src/Components/Forms/ModelForm';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import ModelFormModal from 'CommonUI/src/Components/ModelFormModal/ModelFormModal';

export type MicrosoftTeamsMiscData = {
    tenantName?: string; 
    tenantId?: string; 
    botServiceUrl?: string; 
    botAppId?: string; 
    botObjectId?: string; 
    oneUptimeUserIdInitiated?: string; 
};

export type MicrosoftTeamsUserMiscData = {
    teamsUserId?: string;
    teamsTenantId?: string;
    teamsUserEmail?: string;
    teamsUserName?: string;
    idToken?: string; 
};


export interface ComponentProps {
    onConnected: VoidFunction;
    onDisconnected: VoidFunction;
}

const MicrosoftTeamsIntegration: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [error, setError] = useState<ReactElement | string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isUserAccountConnected, setIsUserAccountConnected] = useState<boolean>(false);
    const [userAuthTokenId, setUserAuthTokenId] = useState<ObjectID | null>(null);
    const [projectAuthTokenId, setProjectAuthTokenId] = useState<ObjectID | null>(null);
    const [isProjectAccountConnected, setIsProjectAccountConnected] = useState<boolean>(false);
    const [isButtonLoading, setIsButtonLoading] = useState<boolean>(false);
    const [teamsTenantName, setTeamsTenantName] = useState<string | null>(null);
    const [showTenantNameModal, setShowTenantNameModal] = useState<boolean>(false);


    const loadItems: PromiseVoidFunction = async (): Promise<void> => {
        setIsLoading(true);
        setError(null); 

        try {
            const currentProjectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
            const currentUserId: ObjectID | null = UserUtil.getUserId();

            if (!currentProjectId) {
                setError(<ErrorMessage message="Project ID not found. Please select a project." />);
                setIsLoading(false);
                return;
            }
            if (!currentUserId) {
                setError(<ErrorMessage message="User ID not found. Please ensure you are logged in." />);
                setIsLoading(false);
                return;
            }

            setIsProjectAccountConnected(false);
            setProjectAuthTokenId(null);
            setTeamsTenantName(null);
            setIsUserAccountConnected(false);
            setUserAuthTokenId(null);

            const projectTokenResponse = await ModelAPI.getList<WorkspaceProjectAuthToken>({
                modelType: WorkspaceProjectAuthToken,
                query: {
                    projectId: currentProjectId,
                    workspaceType: WorkspaceType.MicrosoftTeams,
                },
                limit: 1,
                offset: 0,
                select: { _id: true, miscData: true },
                sort: {},
            });

            if (projectTokenResponse.data.length > 0 && projectTokenResponse.data[0]) {
                const token: WorkspaceProjectAuthToken = projectTokenResponse.data[0]!;
                setProjectAuthTokenId(token.id || null);
                setIsProjectAccountConnected(true);
                const miscData = token.miscData as MicrosoftTeamsMiscData | undefined;
                setTeamsTenantName(miscData?.tenantName || miscData?.tenantId || 'Connected Tenant');
                props.onConnected();
            } else {
                props.onDisconnected();
            }

            const userTokenResponse = await ModelAPI.getList<WorkspaceUserAuthToken>({
                modelType: WorkspaceUserAuthToken,
                query: {
                    projectId: currentProjectId, 
                    userId: currentUserId,
                    workspaceType: WorkspaceType.MicrosoftTeams,
                },
                limit: 1,
                offset: 0,
                select: { _id: true },
                sort: {},
            });

            if (userTokenResponse.data.length > 0 && userTokenResponse.data[0]) {
                const token: WorkspaceUserAuthToken = userTokenResponse.data[0]!;
                setUserAuthTokenId(token.id || null);
                setIsUserAccountConnected(true);
            }

        } catch (err) {
            setError(API.getFriendlyMessage(err as Error));
            props.onDisconnected();
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const errorMessageFromQuery: string | null = Navigation.getQueryStringByName('error_message') || Navigation.getQueryStringByName('error');
        const successMessageFromQuery: string | null = Navigation.getQueryStringByName('status'); 

        if (errorMessageFromQuery) {
            setError(<ErrorMessage message={decodeURIComponent(errorMessageFromQuery)} />);
        } else if (successMessageFromQuery && successMessageFromQuery.toLowerCase().includes('success')) {
            setError(null); 
            if(successMessageFromQuery === 'success_project_auth' && !teamsTenantName){
                // If project auth succeeded and we don't have tenant name yet, prompt for it
                // This case might happen if tenant name wasn't captured during auth flow
                // Or simply always ask after project auth to confirm/set a display name.
                // For now, let's assume tenantId is captured and used if tenantName is not available.
                // We can add a feature to "Edit Tenant Display Name" later if needed.
            }
        }
        
        Navigation.removeQueryString('error');
        Navigation.removeQueryString('status');
        Navigation.removeQueryString('error_message');
        Navigation.removeQueryString('userId'); 

        loadItems().catch((err) => {
            setError(API.getFriendlyMessage(err as Error));
        });
    }, []);


    const connectWithMicrosoftTeams = (): void => {
        if (!MS_TEAMS_APP_CLIENT_ID) {
            setError(<MicrosoftTeamsIntegrationDocumentation />);
            return;
        }

        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const userId: ObjectID | null = UserUtil.getUserId();

        if (!projectId || !userId) {
            setError(<ErrorMessage message="Project ID or User ID not found. Please ensure you are logged in and have selected a project." />);
            return;
        }
        
        setIsButtonLoading(true);

        let authUrl: string;
        const state: string = `${projectId.toString()}_${userId.toString()}_${Date.now()}`; // Basic state

        if (!isProjectAccountConnected) {
            // Initiate Project/Bot connection (Admin Consent Flow)
            // https://learn.microsoft.com/en-us/entra/identity-platform/v2-admin-consent
            const redirectUri: string = URL.fromString(APP_API_URL.toString()).addPath(`/msteams/auth/${projectId.toString()}/${userId.toString()}`).toString();
            authUrl = `https://login.microsoftonline.com/common/adminconsent?client_id=${MS_TEAMS_APP_CLIENT_ID}&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
        } else if (isProjectAccountConnected && !isUserAccountConnected) {
            // Initiate User connection (User Consent Flow for delegated permissions)
            const redirectUri: string = URL.fromString(APP_API_URL.toString()).addPath(`/msteams/auth/${projectId.toString()}/${userId.toString()}/user`).toString();
            const scopes: string = 'User.Read Chat.ReadWrite offline_access openid profile email'; // Delegated scopes
            authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MS_TEAMS_APP_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${encodeURIComponent(scopes)}&state=${state}`;
        } else {
            setIsButtonLoading(false);
            return; // Already connected or invalid state
        }
        
        Navigation.navigate(URL.fromString(authUrl));
    };

    const handleDisconnectUserAccount = async (): Promise<void> => {
        if (!userAuthTokenId) return;
        setIsButtonLoading(true);
        try {
            await ModelAPI.deleteItem<WorkspaceUserAuthToken>({
                modelType: WorkspaceUserAuthToken,
                id: userAuthTokenId,
            });
            setIsUserAccountConnected(false);
            setUserAuthTokenId(null);
            props.onDisconnected(); 
            await loadItems(); // Reload to reflect changes
        } catch (err) {
            setError(API.getFriendlyMessage(err as Error));
        }
        setIsButtonLoading(false);
    };

    const handleUninstallApp = async (): Promise<void> => {
        if (!projectAuthTokenId) return;
        setIsButtonLoading(true);
        try {
            await ModelAPI.deleteItem<WorkspaceProjectAuthToken>({
                modelType: WorkspaceProjectAuthToken,
                id: projectAuthTokenId,
            });
            // Also disconnect user if their token was tied to this project connection conceptually
            if(userAuthTokenId){
                await ModelAPI.deleteItem<WorkspaceUserAuthToken>({
                    modelType: WorkspaceUserAuthToken,
                    id: userAuthTokenId,
                });
            }
            setIsProjectAccountConnected(false);
            setProjectAuthTokenId(null);
            setTeamsTenantName(null);
            setIsUserAccountConnected(false);
            setUserAuthTokenId(null);
            props.onDisconnected();
            await loadItems(); // Reload to reflect changes
        } catch (err) {
            setError(API.getFriendlyMessage(err as Error));
        }
        setIsButtonLoading(false);
    };


    if (!MS_TEAMS_APP_CLIENT_ID) {
        return <MicrosoftTeamsIntegrationDocumentation />;
    }

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error && typeof error === 'string') {
        return <ErrorMessage message={error} />;
    }
    if (error && React.isValidElement(error)) {
        return error;
    }

    let cardTitle: string = "Connect with Microsoft Teams";
    let cardDescription: string = "Enable Microsoft Teams integration for your project to receive alerts and manage incidents directly from Teams.";
    const cardButtons: Array<CardButtonSchema> = [];

    if (isUserAccountConnected && isProjectAccountConnected) {
        cardTitle = `You are connected with ${teamsTenantName || 'your Microsoft Teams organization'}`;
        cardDescription = `Your OneUptime user account is linked, and the OneUptime app is integrated with ${teamsTenantName || 'your Microsoft Teams organization'}.`;
        cardButtons.push({
            title: "Disconnect my User Account",
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: handleDisconnectUserAccount,
            isLoading: isButtonLoading,
            icon: IconProp.Logout,
        });
         cardButtons.push({
            title: "Uninstall App from Teams",
            buttonStyle: ButtonStyleType.DANGER,
            onClick: handleUninstallApp,
            isLoading: isButtonLoading,
            icon: IconProp.Delete,
            confirmModal: {
                title: 'Confirm Uninstall',
                description: `Are you sure you want to uninstall the OneUptime app from ${teamsTenantName || 'your Teams organization'}? This will disconnect both the project and your user account.`,
                yesText: 'Uninstall',
                noText: 'Cancel',
                styleType: ButtonStyleType.DANGER,
            }
        });
    } else if (!isUserAccountConnected && isProjectAccountConnected) {
        cardTitle = `Connect your account to ${teamsTenantName || 'Microsoft Teams'}`;
        cardDescription = `The OneUptime app is installed in ${teamsTenantName || 'your Microsoft Teams organization'}, but your user account isn't linked. Connect your account to interact with OneUptime from Teams.`;
        cardButtons.push({
            title: "Connect my User Account",
            buttonStyle: ButtonStyleType.SUCCESS_OUTLINE,
            onClick: connectWithMicrosoftTeams,
            isLoading: isButtonLoading,
            icon: IconProp.Link,
        });
        cardButtons.push({
            title: "Uninstall App from Teams",
            buttonStyle: ButtonStyleType.DANGER,
            onClick: handleUninstallApp,
            isLoading: isButtonLoading,
            icon: IconProp.Delete,
             confirmModal: {
                title: 'Confirm Uninstall',
                description: `Are you sure you want to uninstall the OneUptime app from ${teamsTenantName || 'your Teams organization'}? This will disconnect the project.`,
                yesText: 'Uninstall',
                noText: 'Cancel',
                styleType: ButtonStyleType.DANGER,
            }
        });
    } else { // !isProjectAccountConnected
        cardTitle = "Connect with Microsoft Teams";
        cardDescription = "Integrate OneUptime with your Microsoft Teams organization to enable bot functionalities, receive alerts, and manage incidents from Teams.";
        cardButtons.push({
            title: "Connect with Microsoft Teams (Install App)",
            buttonStyle: ButtonStyleType.SUCCESS_OUTLINE,
            onClick: connectWithMicrosoftTeams,
            isLoading: isButtonLoading,
            icon: IconProp.Link,
        });
    }
    

    return (
        <Fragment>
            <Card
                title={cardTitle}
                description={cardDescription}
                buttons={cardButtons}
            >
                {/* Additional info or settings can go here */}
                {isProjectAccountConnected && (
                    <p className="text-sm text-gray-500 mt-4">
                        Connected to Microsoft Teams Tenant: <strong>{teamsTenantName || 'Unknown Tenant'}</strong>.
                        {projectAuthTokenId && ` (Integration ID: ${projectAuthTokenId.toString()})`}
                    </p>
                )}
                 {isUserAccountConnected && userAuthTokenId && (
                     <p className="text-sm text-gray-500 mt-1">
                        Your user account is linked.
                        {userAuthTokenId && ` (Link ID: ${userAuthTokenId.toString()})`}
                    </p>
                 )}
            </Card>

            {showTenantNameModal && projectAuthTokenId && (
                 <ModelFormModal<WorkspaceProjectAuthToken>
                    title="Set Teams Tenant Display Name"
                    modelType={WorkspaceProjectAuthToken}
                    modelIdToEdit={projectAuthTokenId}
                    onClose={() => { setShowTenantNameModal(false); }}
                    submitButtonText="Save Tenant Name"
                    onSuccess={async () => {
                        setShowTenantNameModal(false);
                        await loadItems(); // Refresh to show new name
                    }}
                    fields={[
                        {
                            field: {
                                miscData: true, // Targeting miscData
                            },
                            title: 'Microsoft Teams Tenant Display Name',
                            description: 'Provide a display name for the connected Microsoft Teams tenant (e.g., "Contoso Corp"). This helps identify the integration.',
                            fieldType: FormFieldSchemaType.Object,
                            objectFields: [ // Define sub-fields for miscData
                                {
                                    field: {
                                        tenantName: true // Path within miscData: miscData.tenantName
                                    },
                                    title: 'Tenant Display Name',
                                    fieldType: FormFieldSchemaType.Text,
                                    required: false,
                                    placeholder: 'Enter Tenant Display Name (e.g. Contoso Corp)'
                                }
                            ],
                            getActualDataFromFormData: (data: JSONObject): JSONObject => {
                                // We only care about tenantName within miscData
                                return { tenantName: (data['miscData'] as JSONObject)?.['tenantName'] || '' };
                            },
                            overrideField:{
                                miscData: FieldType.JSON, // Treat miscData as a JSON field for the form
                            }
                        } as ModelField<WorkspaceProjectAuthToken>,
                    ]}
                 />
            )}
        </Fragment>
    );
};

export default MicrosoftTeamsIntegration;
