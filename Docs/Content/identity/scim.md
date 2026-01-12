# SCIM (System for Cross-domain Identity Management)

OneUptime supports SCIM v2.0 protocol for automated user provisioning and deprovisioning. SCIM enables identity providers (IdPs) like Azure AD, Okta, and other enterprise identity systems to automatically manage user access to OneUptime projects and status pages.

## Overview

SCIM integration provides the following benefits:

- **Automated User Provisioning**: Automatically create users in OneUptime when they're assigned in your IdP
- **Automated User Deprovisioning**: Automatically remove users from OneUptime when they're unassigned in your IdP
- **User Attribute Synchronization**: Keep user information synchronized between your IdP and OneUptime
- **Centralized Access Management**: Manage OneUptime access from your existing identity management system

## SCIM for Projects

Project SCIM allows identity providers to manage team members within OneUptime projects.

### Setting Up Project SCIM

1. **Navigate to Project Settings**
   - Go to your OneUptime project
   - Navigate to **Project Settings** > **Team** > **SCIM**

2. **Configure SCIM Settings**
   - Enable **Auto Provision Users** to automatically add users when they're assigned in your IdP
   - Enable **Auto Deprovision Users** to automatically remove users when they're unassigned in your IdP
   - Select the **Default Teams** that new users should be added to
   - Copy the **SCIM Base URL** and **Bearer Token** for your IdP configuration

3. **Configure Your Identity Provider**
   - Use the SCIM Base URL: `https://oneuptime.com/scim/v2/{scimId}`
   - Configure bearer token authentication with the provided token
   - Map user attributes (email is required)

### Project SCIM Endpoints

- **Service Provider Config**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /scim/v2/{scimId}/Users`
- **Get User**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /scim/v2/{scimId}/Users`
- **Update User**: `PUT /scim/v2/{scimId}/Users/{userId}` or `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **List Groups**: `GET /scim/v2/{scimId}/Groups`
- **Get Group**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Create Group**: `POST /scim/v2/{scimId}/Groups`
- **Update Group**: `PUT /scim/v2/{scimId}/Groups/{groupId}` or `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Delete Group**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### Project SCIM User Lifecycle

1. **User Assignment in IdP**: When a user is assigned to OneUptime in your IdP
2. **SCIM Provisioning**: IdP calls OneUptime SCIM API to create the user
3. **Team Membership**: User is automatically added to configured default teams
4. **Access Granted**: User can now access the OneUptime project
5. **User Unassignment**: When user is unassigned in IdP
6. **SCIM Deprovisioning**: IdP calls OneUptime SCIM API to remove the user
7. **Access Revoked**: User loses access to the project

## SCIM for Status Pages

Status Page SCIM allows identity providers to manage subscribers to private status pages.

### Setting Up Status Page SCIM

1. **Navigate to Status Page Settings**
   - Go to your OneUptime status page
   - Navigate to **Status Page Settings** > **Private Users** > **SCIM**

2. **Configure SCIM Settings**
   - Enable **Auto Provision Users** to automatically add subscribers when they're assigned in your IdP
   - Enable **Auto Deprovision Users** to automatically remove subscribers when they're unassigned in your IdP
   - Copy the **SCIM Base URL** and **Bearer Token** for your IdP configuration

3. **Configure Your Identity Provider**
   - Use the SCIM Base URL: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - Configure bearer token authentication with the provided token
   - Map user attributes (email is required)

### Status Page SCIM Endpoints

- **Service Provider Config**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /status-page-scim/v2/{scimId}/Users`
- **Get User**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /status-page-scim/v2/{scimId}/Users`
- **Update User**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` or `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Status Page SCIM User Lifecycle

1. **User Assignment in IdP**: When a user is assigned to OneUptime Status Page in your IdP
2. **SCIM Provisioning**: IdP calls OneUptime SCIM API to create the subscriber
3. **Access Granted**: User can now access the private status page
4. **User Unassignment**: When user is unassigned in IdP
5. **SCIM Deprovisioning**: IdP calls OneUptime SCIM API to remove the subscriber
6. **Access Revoked**: User loses access to the status page

## Identity Provider Configuration

### Microsoft Entra ID (formerly Azure AD)

Microsoft Entra ID provides enterprise-grade identity management with robust SCIM provisioning capabilities. Follow these detailed steps to configure SCIM provisioning with OneUptime.

#### Prerequisites

- Microsoft Entra ID tenant with Premium P1 or P2 license (required for automatic provisioning)
- OneUptime account with Scale plan or higher
- Admin access to both Microsoft Entra ID and OneUptime

#### Step 1: Get SCIM Configuration from OneUptime

1. Log in to your OneUptime dashboard
2. Navigate to **Project Settings** > **Team** > **SCIM**
3. Click **Create SCIM Configuration**
4. Enter a friendly name (e.g., "Microsoft Entra ID Provisioning")
5. Configure the following options:
   - **Auto Provision Users**: Enable to automatically create users
   - **Auto Deprovision Users**: Enable to automatically remove users
   - **Default Teams**: Select teams that new users should be added to
   - **Enable Push Groups**: Enable if you want to manage team membership via Entra ID groups
6. Save the configuration
7. Copy the **SCIM Base URL** and **Bearer Token** - you'll need these for Entra ID

#### Step 2: Create Enterprise Application in Microsoft Entra ID

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com)
2. Navigate to **Identity** > **Applications** > **Enterprise applications**
3. Click **+ New application**
4. Click **+ Create your own application**
5. Enter a name (e.g., "OneUptime")
6. Select **Integrate any other application you don't find in the gallery (Non-gallery)**
7. Click **Create**

#### Step 3: Configure SCIM Provisioning

1. In your OneUptime enterprise application, go to **Provisioning**
2. Click **Get started**
3. Set **Provisioning Mode** to **Automatic**
4. Under **Admin Credentials**:
   - **Tenant URL**: Enter the SCIM Base URL from OneUptime (e.g., `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Secret Token**: Enter the Bearer Token from OneUptime
5. Click **Test Connection** to verify the configuration
6. Click **Save**

#### Step 4: Configure Attribute Mappings

1. In the Provisioning section, click **Mappings**
2. Click **Provision Azure Active Directory Users**
3. Configure the following attribute mappings:

| Azure AD Attribute | OneUptime SCIM Attribute | Required |
|-------------------|-------------------------|----------|
| `userPrincipalName` | `userName` | Yes |
| `mail` | `emails[type eq "work"].value` | Recommended |
| `displayName` | `displayName` | Recommended |
| `givenName` | `name.givenName` | Optional |
| `surname` | `name.familyName` | Optional |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | Recommended |

4. Remove any mappings that are not needed to simplify provisioning
5. Click **Save**

#### Step 5: Configure Group Provisioning (Optional)

If you enabled **Push Groups** in OneUptime:

1. Go back to **Mappings**
2. Click **Provision Azure Active Directory Groups**
3. Enable group provisioning by setting **Enabled** to **Yes**
4. Configure the following attribute mappings:

| Azure AD Attribute | OneUptime SCIM Attribute |
|-------------------|-------------------------|
| `displayName` | `displayName` |
| `members` | `members` |

5. Click **Save**

#### Step 6: Assign Users and Groups

1. In your OneUptime enterprise application, go to **Users and groups**
2. Click **+ Add user/group**
3. Select the users and/or groups you want to provision to OneUptime
4. Click **Assign**

#### Step 7: Start Provisioning

1. Go to **Provisioning** > **Overview**
2. Click **Start provisioning**
3. The initial provisioning cycle will begin (this may take up to 40 minutes for the first sync)
4. Monitor the **Provisioning logs** for any errors

#### Troubleshooting Microsoft Entra ID

- **Test Connection Fails**: Verify the SCIM Base URL includes `/api/identity` prefix and the Bearer Token is correct
- **Users Not Provisioning**: Check that users are assigned to the application and attribute mappings are correct
- **Provisioning Errors**: Review the Provisioning logs in Entra ID for specific error messages
- **Sync Delays**: Initial provisioning can take up to 40 minutes; subsequent syncs occur every 40 minutes

---

### Okta

Okta provides flexible identity management with excellent SCIM support. Follow these detailed steps to configure SCIM provisioning with OneUptime.

#### Prerequisites

- Okta tenant with provisioning capabilities (Lifecycle Management feature)
- OneUptime account with Scale plan or higher
- Admin access to both Okta and OneUptime

#### Step 1: Get SCIM Configuration from OneUptime

1. Log in to your OneUptime dashboard
2. Navigate to **Project Settings** > **Team** > **SCIM**
3. Click **Create SCIM Configuration**
4. Enter a friendly name (e.g., "Okta Provisioning")
5. Configure the following options:
   - **Auto Provision Users**: Enable to automatically create users
   - **Auto Deprovision Users**: Enable to automatically remove users
   - **Default Teams**: Select teams that new users should be added to
   - **Enable Push Groups**: Enable if you want to manage team membership via Okta groups
6. Save the configuration
7. Copy the **SCIM Base URL** and **Bearer Token** - you'll need these for Okta

#### Step 2: Create or Configure Okta Application

**If you have an existing SSO application:**
1. Sign in to your Okta Admin Console
2. Navigate to **Applications** > **Applications**
3. Find and select your existing OneUptime application

**If creating a new application:**
1. Sign in to your Okta Admin Console
2. Navigate to **Applications** > **Applications**
3. Click **Create App Integration**
4. Select **SAML 2.0** and click **Next**
5. Enter "OneUptime" as the App name
6. Complete the SAML configuration (refer to SSO documentation)
7. Click **Finish**

#### Step 3: Enable SCIM Provisioning

1. In your OneUptime application, go to the **General** tab
2. In the **App Settings** section, click **Edit**
3. Under **Provisioning**, select **SCIM**
4. Click **Save**
5. A new **Provisioning** tab will appear

#### Step 4: Configure SCIM Connection

1. Go to the **Provisioning** tab
2. Click **Integration** in the left sidebar
3. Click **Configure API Integration**
4. Check **Enable API integration**
5. Configure the following:
   - **SCIM connector base URL**: Enter the SCIM Base URL from OneUptime (e.g., `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Unique identifier field for users**: Enter `userName`
   - **Supported provisioning actions**: Select the actions you want to enable:
     - Import New Users and Profile Updates
     - Push New Users
     - Push Profile Updates
     - Push Groups (if using group-based provisioning)
   - **Authentication Mode**: Select **HTTP Header**
   - **Authorization**: Enter `Bearer {your-bearer-token}` (replace with actual token)
6. Click **Test API Credentials** to verify the connection
7. Click **Save**

#### Step 5: Configure Provisioning to App

1. In the **Provisioning** tab, click **To App** in the left sidebar
2. Click **Edit**
3. Enable the following options:
   - **Create Users**: Enable to provision new users
   - **Update User Attributes**: Enable to sync attribute changes
   - **Deactivate Users**: Enable to deprovision users when unassigned
4. Click **Save**

#### Step 6: Configure Attribute Mappings

1. Scroll down to **Attribute Mappings**
2. Verify or configure the following mappings:

| Okta Attribute | OneUptime SCIM Attribute | Direction |
|---------------|-------------------------|-----------|
| `userName` | `userName` | Okta to App |
| `user.email` | `emails[primary eq true].value` | Okta to App |
| `user.firstName` | `name.givenName` | Okta to App |
| `user.lastName` | `name.familyName` | Okta to App |
| `user.displayName` | `displayName` | Okta to App |

3. Remove any unnecessary mappings
4. Click **Save** if you made changes

#### Step 7: Configure Push Groups (Optional)

If you enabled **Push Groups** in OneUptime:

1. Go to the **Push Groups** tab
2. Click **+ Push Groups**
3. Select **Find groups by name** or **Find groups by rule**
4. Search for and select the groups you want to push
5. Click **Save**

#### Step 8: Assign Users

1. Go to the **Assignments** tab
2. Click **Assign** > **Assign to People** or **Assign to Groups**
3. Select the users or groups you want to provision
4. Click **Assign** for each selection
5. Click **Done**

#### Step 9: Verify Provisioning

1. Go to **Reports** > **System Log** in the Okta Admin Console
2. Filter for events related to your OneUptime application
3. Verify that provisioning events are successful
4. Check OneUptime to confirm users have been created

#### Troubleshooting Okta

- **API Credentials Test Fails**: Verify the SCIM Base URL and Bearer Token are correct
- **Users Not Provisioning**: Ensure users are assigned to the application and provisioning is enabled
- **Duplicate Users**: Ensure the `userName` attribute is unique and maps correctly to email
- **Group Push Failures**: Verify groups exist and have the correct membership
- **Error: 401 Unauthorized**: Regenerate the Bearer Token in OneUptime and update Okta

---

### Other Identity Providers

OneUptime's SCIM implementation follows the SCIM v2.0 specification and should work with any compliant identity provider. General configuration steps:

1. **SCIM Base URL**: `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (for projects) or `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (for status pages)
2. **Authentication**: HTTP Bearer Token
3. **Required User Attribute**: `userName` (must be a valid email address)
4. **Supported Operations**: GET, POST, PUT, PATCH, DELETE for Users and Groups

#### Supported SCIM Endpoints

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/ServiceProviderConfig` | GET | SCIM server capabilities |
| `/Schemas` | GET | Available resource schemas |
| `/ResourceTypes` | GET | Available resource types |
| `/Users` | GET, POST | List and create users |
| `/Users/{id}` | GET, PUT, PATCH, DELETE | Manage individual users |
| `/Groups` | GET, POST | List and create groups/teams (Project SCIM only) |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE | Manage individual groups (Project SCIM only) |

#### SCIM User Schema

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "user@example.com",
  "name": {
    "givenName": "John",
    "familyName": "Doe",
    "formatted": "John Doe"
  },
  "displayName": "John Doe",
  "emails": [
    {
      "value": "user@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "active": true
}
```

#### SCIM Group Schema

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    {
      "value": "user-id-here",
      "display": "user@example.com"
    }
  ]
}
```

## Frequently Asked Questions

### What happens when a user is deprovisioned?

When a user is deprovisioned (either by DELETE request or by setting `active: false`), they are removed from the teams configured in the SCIM settings. The user account itself remains in OneUptime but loses access to the project.

### Can I use SCIM without SSO?

Yes, SCIM and SSO are independent features. You can use SCIM for user provisioning while allowing users to log in with their OneUptime passwords or any other authentication method.

### How do I handle users who already exist in OneUptime?

When SCIM tries to create a user who already exists (matching by email), OneUptime will simply add them to the configured default teams rather than creating a duplicate user.

### What is the difference between default teams and push groups?

- **Default Teams**: All users provisioned via SCIM are added to the same predefined teams
- **Push Groups**: Team membership is managed by your identity provider, allowing different users to be in different teams based on IdP group membership

### How often does provisioning sync occur?

This depends on your identity provider:
- **Microsoft Entra ID**: Initial sync can take up to 40 minutes, subsequent syncs every 40 minutes
- **Okta**: Near real-time for most operations, with periodic full syncs

