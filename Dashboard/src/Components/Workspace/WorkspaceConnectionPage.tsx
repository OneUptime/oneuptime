import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import WorkspaceType from 'Common/Types/Workspace/WorkspaceType';
import NotificationRuleEventType from 'Common/Types/Workspace/NotificationRules/EventType';
import IconProp from 'Common/Types/Icon/IconProp';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';

import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import WorkspaceNotificationRuleTable from './WorkspaceNotificationRulesTable'; // Assuming this path

import WorkspaceUtil from '../../Utils/Workspace/Workspace'; // Adjust path as needed
import API from 'CommonUI/src/Utils/API/API'; // Adjust path as needed
import { Exception } from 'Common/Types/Exception/Exception'; // Adjust path as needed
import Navigation from 'CommonUI/src/Utils/Navigation'; // For EmptyState button navigation
import RouteMap, { RouteUtil } from '../../Utils/RouteMap'; // For EmptyState button navigation
import ObjectID from 'Common/Types/ObjectID'; // For EmptyState button navigation

export interface WorkspaceConnectionPageProps {
    workspaceType: WorkspaceType;
    eventType: NotificationRuleEventType;
    icon: IconProp;
    workspaceName: string;
    eventDisplayName: string; // e.g., "alert", "incident"
    // This will be used as the title for the WorkspaceNotificationRuleTable
    tableTitle: string; 
    // This will be used as the description for the WorkspaceNotificationRuleTable
    tableDescription: string; 
    // Description for EmptyState when not connected
    descriptionWhenNotConnected: string; 
}

const WorkspaceConnectionPage: FunctionComponent<WorkspaceConnectionPageProps> = (
    props: WorkspaceConnectionPageProps
): ReactElement => {
    const [isWorkspaceConnected, setIsWorkspaceConnected] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const loadItems: PromiseVoidFunction = async (): Promise<void> => {
        try {
            setError(null);
            setIsLoading(true);
            const connected: boolean = await WorkspaceUtil.isWorkspaceConnected(props.workspaceType);
            setIsWorkspaceConnected(connected);
        } catch (err) {
            setError(API.getFriendlyMessage(err as Exception));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadItems().catch(() => {
            setError(`Error loading ${props.workspaceName} connection status.`);
        });
    }, [props.workspaceType]); // Reload if workspaceType changes (though unlikely for this component instance)

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage message={error} />;
    }

    const getIntegrationSettingsRoute = (): Route | null => {
        if (props.workspaceType === WorkspaceType.MicrosoftTeams) {
            return RouteMap.SettingsMicrosoftTeamsIntegration;
        }
        if (props.workspaceType === WorkspaceType.Slack) {
            return RouteMap.SettingsSlackIntegration;
        }
        // Add other workspace types here if needed
        return null;
    }

    return (
        <div>
            {isWorkspaceConnected ? (
                <WorkspaceNotificationRuleTable
                    workspaceType={props.workspaceType}
                    eventType={props.eventType}
                    title={props.tableTitle.replace('{{eventDisplayName}}', props.eventDisplayName).replace('{{workspaceName}}', props.workspaceName)}
                    description={props.tableDescription.replace('{{eventDisplayName}}', props.eventDisplayName).replace('{{workspaceName}}', props.workspaceName)}
                />
            ) : (
                <EmptyState
                    id={`${props.workspaceType}-${props.eventDisplayName}-connection-empty-state`}
                    icon={props.icon}
                    title={`${props.workspaceName} is not connected`}
                    description={props.descriptionWhenNotConnected
                        .replace('{{workspaceName}}', props.workspaceName)
                        .replace('{{eventDisplayName}}', props.eventDisplayName)}
                    buttonText={`Connect to ${props.workspaceName}`}
                    onButtonClicked={() => {
                        const projectId: string | undefined = Navigation.getParamByName("projectId");
                        const integrationRoute: Route | null = getIntegrationSettingsRoute();

                        if (projectId && integrationRoute) {
                             Navigation.navigate(
                                RouteUtil.populateRouteParams(
                                    integrationRoute,
                                    new ObjectID(projectId)
                                )
                            );
                        } else if (!projectId) {
                            setError("Project ID not found in URL. Cannot navigate to settings.");
                        } else {
                            setError(`Integration settings route not defined for ${props.workspaceName}.`);
                        }
                    }}
                />
            )}
        </div>
    );
};

export default WorkspaceConnectionPage;
