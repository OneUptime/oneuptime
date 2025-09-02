/**
 * Microsoft Teams Permission Configuration and Validation
 *
 * This file contains the complete list of Microsoft Graph API permissions
 * required for OneUptime's Microsoft Teams integration, along with utilities
 * to validate and debug permission issues.
 */

// Delegated permissions required for user context operations
export const REQUIRED_DELEGATED_PERMISSIONS: Array<string> = [
  "openid", // Sign users in - required for ID token
  "profile", // View users' basic profile
  "email", // View users' email address
  "offline_access", // Maintain access to data (refresh tokens)
  "User.Read", // Sign in and read user profile
  "Team.ReadBasic.All", // Read the names and descriptions of teams
  "Channel.ReadBasic.All", // Read the names and descriptions of channels
  "ChannelMessage.Send", // Send channel messages
  "TeamMember.ReadWrite.All", // Add and remove members from teams
  "Teamwork.Read.All", // Read organizational teamwork settings
];

// Application permissions required for bot/app context operations
export const REQUIRED_APPLICATION_PERMISSIONS: Array<string> = [
  "Channel.Create", // Create channels
  "Channel.Delete.All", // Delete channels
  "Channel.ReadBasic.All", // Read the names and descriptions of all channels
  "ChannelMember.Read.All", // Read the members of all channels
  "ChannelMember.ReadWrite.All", // Add and remove members from all channels
  "ChannelMessage.Read.All", // Read all channel messages
  "ChannelMessage.UpdatePolicyViolation.All", // Flag channel messages for violating policy
  "ChatMessage.Read.All", // Read all chat messages
  "Team.ReadBasic.All", // Get a list of all teams
  "TeamMember.Read.All", // Read the members of all teams
  "TeamMember.ReadWrite.All", // Add and remove members from all teams
  "Teamwork.Migrate.All", // Create chat and channel messages with anyone's identity and with any timestamp
  "Teamwork.Read.All", // Read organizational teamwork settings
];

// Permission descriptions for documentation and debugging
export const PERMISSION_DESCRIPTIONS: { [key: string]: string } = {
  // Delegated permissions
  openid:
    "Returns an id_token so we can read tenant id - required for OAuth flow",
  profile: "Basic user profile claims - required for user identification",
  email:
    "View users' email address - used for user notifications and identification",
  offline_access: "Required for refresh tokens - enables long-term access",
  "User.Read": "Basic profile access - required by most Microsoft sign-ins",
  "Team.ReadBasic.All":
    "Read the names and descriptions of teams - enables team discovery",
  "Channel.ReadBasic.All":
    "Read the names and descriptions of channels - enables channel discovery",
  "ChannelMessage.Send": "Send channel messages as the signed-in user",
  "TeamMember.ReadWrite.All":
    "Add and remove members from teams - enables user management",
  "Teamwork.Read.All":
    "Read organizational teamwork settings - provides additional context",

  // Application permissions
  "Channel.Create":
    "Create channels - enables automatic channel creation for incidents",
  "Channel.Delete.All":
    "Delete channels - enables cleanup and archival operations",
  "ChannelMember.Read.All":
    "Read the members of all channels - enables membership verification",
  "ChannelMember.ReadWrite.All":
    "Add and remove members from all channels - enables automated user management",
  "ChannelMessage.Read.All":
    "Read all channel messages - enables message monitoring and context",
  "ChannelMessage.UpdatePolicyViolation.All":
    "Flag channel messages for violating policy - compliance feature",
  "ChatMessage.Read.All":
    "Read all chat messages - enables direct message monitoring",
  "Team.ReadBasic.All.App":
    "Get a list of all teams - enables team discovery for app operations",
  "TeamMember.Read.All":
    "Read the members of all teams - enables team membership verification",
  "TeamMember.ReadWrite.All.App":
    "Add and remove members from all teams - enables automated team management",
  "Teamwork.Migrate.All":
    "Create chat and channel messages with anyone's identity and with any timestamp - REQUIRED for Import API operations",
  "Teamwork.Read.All.App":
    "Read organizational teamwork settings - provides organizational context",
};

// Categories for permission organization
export const PERMISSION_CATEGORIES: {
  AUTHENTICATION: string[];
  TEAM_ACCESS: string[];
  CHANNEL_ACCESS: string[];
  MESSAGING: string[];
  ADVANCED: string[];
} = {
  AUTHENTICATION: ["openid", "profile", "email", "offline_access", "User.Read"],
  TEAM_ACCESS: [
    "Team.ReadBasic.All",
    "TeamMember.Read.All",
    "TeamMember.ReadWrite.All",
  ],
  CHANNEL_ACCESS: [
    "Channel.ReadBasic.All",
    "Channel.Create",
    "Channel.Delete.All",
    "ChannelMember.Read.All",
    "ChannelMember.ReadWrite.All",
  ],
  MESSAGING: [
    "ChannelMessage.Send",
    "ChannelMessage.Read.All",
    "ChannelMessage.UpdatePolicyViolation.All",
    "ChatMessage.Read.All",
  ],
  ADVANCED: ["Teamwork.Read.All", "Teamwork.Migrate.All"],
};

/**
 * Decodes a JWT token to extract the roles/scopes
 * @param token - JWT access token
 * @returns Decoded token payload
 */
export function decodeJWTToken(token: string): any {
  try {
    const parts: string[] = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }

    const payloadPart: string | undefined = parts[1];
    if (!payloadPart) {
      throw new Error("Missing token payload");
    }

    const payload: Record<string, unknown> = JSON.parse(
      Buffer.from(payloadPart, "base64").toString(),
    );
    return payload;
  } catch (error) {
    throw new Error(`Failed to decode JWT: ${(error as Error).message}`);
  }
}

/**
 * Validates that an application token has all required permissions
 * @param token - Application access token
 * @returns Validation result with missing permissions
 */
export function validateApplicationTokenPermissions(token: string): {
  isValid: boolean;
  hasRoles: Array<string>;
  missingRoles: Array<string>;
  extraRoles: Array<string>;
} {
  try {
    const payload: Record<string, unknown> = decodeJWTToken(token);
    const tokenRoles: Array<string> = (payload["roles"] as Array<string>) || [];

    const missingRoles: Array<string> = REQUIRED_APPLICATION_PERMISSIONS.filter(
      (permission: string) => {
        return !tokenRoles.includes(permission);
      },
    );

    const extraRoles: Array<string> = tokenRoles.filter(
      (role: string) => {
        return (
          !REQUIRED_APPLICATION_PERMISSIONS.includes(role) &&
          !role.startsWith("Directory.") && // Exclude common directory roles
          !role.startsWith("Application.")
        );
      }, // Exclude application management roles
    );

    return {
      isValid: missingRoles.length === 0,
      hasRoles: tokenRoles,
      missingRoles,
      extraRoles,
    };
  } catch {
    return {
      isValid: false,
      hasRoles: [],
      missingRoles: REQUIRED_APPLICATION_PERMISSIONS,
      extraRoles: [],
    };
  }
}

/**
 * Validates that a delegated token has required scopes
 * @param token - Delegated access token
 * @returns Validation result with missing scopes
 */
export function validateDelegatedTokenPermissions(token: string): {
  isValid: boolean;
  hasScopes: Array<string>;
  missingScopes: Array<string>;
} {
  try {
    const payload: Record<string, unknown> = decodeJWTToken(token);
    const tokenScopes: Array<string> = (
      (payload["scp"] as string) ||
      (payload["scope"] as string) ||
      ""
    )
      .split(" ")
      .filter(Boolean);

    const missingScopes: Array<string> = REQUIRED_DELEGATED_PERMISSIONS.filter(
      (permission: string) => {
        return !tokenScopes.includes(permission);
      },
    );

    return {
      isValid: missingScopes.length === 0,
      hasScopes: tokenScopes,
      missingScopes,
    };
  } catch {
    return {
      isValid: false,
      hasScopes: [],
      missingScopes: REQUIRED_DELEGATED_PERMISSIONS,
    };
  }
}

/**
 * Generates a permission configuration checklist for Azure AD setup
 * @returns Formatted checklist string
 */
export function generatePermissionChecklist(): string {
  let checklist: string =
    "Microsoft Teams Integration - Azure AD Permission Checklist\n";
  checklist += "=".repeat(60) + "\n\n";

  checklist +=
    "DELEGATED PERMISSIONS (add these to 'API permissions' → 'Microsoft Graph' → 'Delegated permissions'):\n";
  checklist += "-".repeat(40) + "\n";
  REQUIRED_DELEGATED_PERMISSIONS.forEach((permission: string) => {
    checklist += `☐ ${permission}\n    ${PERMISSION_DESCRIPTIONS[permission] || "No description available"}\n\n`;
  });

  checklist +=
    "\nAPPLICATION PERMISSIONS (add these to 'API permissions' → 'Microsoft Graph' → 'Application permissions'):\n";
  checklist += "-".repeat(40) + "\n";
  REQUIRED_APPLICATION_PERMISSIONS.forEach((permission: string) => {
    checklist += `☐ ${permission}\n    ${PERMISSION_DESCRIPTIONS[permission] || "No description available"}\n\n`;
  });

  checklist += "\nIMPORTANT FINAL STEPS:\n";
  checklist += "-".repeat(40) + "\n";
  checklist += "☐ Click 'Grant admin consent for [your organization]'\n";
  checklist +=
    "☐ Verify all permissions show green checkmark (granted status)\n";
  checklist +=
    "☐ Generate client secret and copy the SECRET VALUE (not Secret ID)\n";
  checklist +=
    "☐ Copy Application (client) ID from app registration overview\n";
  checklist +=
    "☐ Configure OneUptime environment variables with client ID and secret\n";
  checklist += "☐ Restart OneUptime server to apply configuration\n";

  return checklist;
}

/**
 * Common permission troubleshooting scenarios
 */
export const TROUBLESHOOTING_GUIDE: {
  [key: string]: {
    title: string;
    causes: string[];
    solutions: string[];
  };
} = {
  "403_FORBIDDEN": {
    title: "403 Forbidden Error",
    causes: [
      "Admin consent not granted for application permissions",
      "Teams service not properly provisioned for the tenant",
      "Resource Specific Consent (RSC) required for specific operations",
      "Token doesn't include required roles/scopes",
    ],
    solutions: [
      "Re-grant admin consent in Azure Portal",
      "Wait 5-10 minutes after granting consent for permissions to propagate",
      "Check if RSC permissions are needed for Teams app manifest",
      "Validate token contains required roles using validateApplicationTokenPermissions()",
    ],
  },
  INVALID_CLIENT: {
    title: "Invalid Client Error",
    causes: [
      "Using Secret ID instead of Secret Value",
      "Client secret has expired",
      "Incorrect client ID configured",
    ],
    solutions: [
      "Use the full SECRET VALUE from Azure Portal (much longer than Secret ID)",
      "Generate new client secret if current one expired",
      "Verify Application (client) ID matches Azure registration",
    ],
  },
  TOKEN_VALIDATION: {
    title: "Token Validation Issues",
    causes: [
      "Missing required permissions in token",
      "Token issued for wrong resource/audience",
      "Cached token with old permissions",
    ],
    solutions: [
      "Use validateApplicationTokenPermissions() to check token roles",
      "Clear token cache and request new token",
      "Verify token audience is 'https://graph.microsoft.com'",
    ],
  },
};

export default {
  REQUIRED_DELEGATED_PERMISSIONS,
  REQUIRED_APPLICATION_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_CATEGORIES,
  validateApplicationTokenPermissions,
  validateDelegatedTokenPermissions,
  generatePermissionChecklist,
  TROUBLESHOOTING_GUIDE,
};
