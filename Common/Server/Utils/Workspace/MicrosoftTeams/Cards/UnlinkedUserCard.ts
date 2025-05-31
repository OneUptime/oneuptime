import { JSONObject } from '../../../../../Types/JSON';
import ObjectID from '../../../../../Types/ObjectID';
import URL from '../../../../../Types/API/URL'; // For URL construction
import { DASHBOARD_URL } from '../../../../Config'; // Assuming DASHBOARD_URL is the base

// Simulating Navigator.getBaseDashboardUrl for now if not directly available
// In a real scenario, this would come from a shared utility.
const getBaseDashboardUrlForProject = (projectId: ObjectID): URL => {
    // This is a placeholder. Replace with actual utility that constructs the correct base URL.
    // Example: return new URL(DASHBOARD_URL.toString()).addPath(projectId.toString());
    // For now, let's assume a simpler structure or that DASHBOARD_URL itself is sufficient
    // and the path is appended directly.
    return new URL(DASHBOARD_URL.toString()); 
};

export const getUnlinkedUserCard = (projectId: ObjectID): JSONObject => {
    const settingsPageUrl: string = getBaseDashboardUrlForProject(projectId)
        .addPath(projectId.toString()) // Some dashboards might have project ID in path first
        .addPath('/settings/teams-integration') // A hypothetical path to a user-specific Teams integration/linking page
        .toString();

    // A more direct link if the user settings page for Teams integration is known:
    // const userTeamsIntegrationSettingsUrl: string = getBaseDashboardUrlForProject(projectId)
    //     .addPath('/user-settings/teams-integration') // Or similar path
    //     .toString();
    // For now, linking to the main Teams integration page for the project. User might need to click "Connect my user account" there.

    return {
        type: "AdaptiveCard",
        version: "1.5", // Using a recent version
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        body: [
            {
                type: "TextBlock",
                text: "Account Not Linked",
                weight: "Bolder",
                size: "Medium",
                wrap: true,
            },
            {
                type: "TextBlock",
                text: "Your Microsoft Teams account is not linked to a OneUptime user in this project. To perform this action, please link your account first.",
                wrap: true,
            }
        ],
        actions: [
            {
                type: "Action.OpenUrl",
                title: "Link Account in OneUptime Settings",
                url: settingsPageUrl, // URL to OneUptime settings page where user can link their account
                // style: "positive" // Optional: style the button
            }
        ]
    };
};

export default getUnlinkedUserCard;
