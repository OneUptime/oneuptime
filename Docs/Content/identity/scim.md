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
- **List Users**: `GET /scim/v2/{scimId}/Users`
- **Get User**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /scim/v2/{scimId}/Users`
- **Update User**: `PUT /scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /scim/v2/{scimId}/Users/{userId}`

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
- **List Users**: `GET /status-page-scim/v2/{scimId}/Users`
- **Get User**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /status-page-scim/v2/{scimId}/Users`
- **Update User**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Status Page SCIM User Lifecycle

1. **User Assignment in IdP**: When a user is assigned to OneUptime Status Page in your IdP
2. **SCIM Provisioning**: IdP calls OneUptime SCIM API to create the subscriber
3. **Access Granted**: User can now access the private status page
4. **User Unassignment**: When user is unassigned in IdP
5. **SCIM Deprovisioning**: IdP calls OneUptime SCIM API to remove the subscriber
6. **Access Revoked**: User loses access to the status page

## Identity Provider Configuration

### Azure Active Directory (Azure AD)

1. **Add OneUptime from Azure AD Gallery**
   - In Azure AD, go to **Enterprise Applications** > **New Application**
   - Add a **Non-gallery application**

2. **Configure SCIM Settings**
   - In the OneUptime application, go to **Provisioning**
   - Set **Provisioning Mode** to **Automatic**
   - Enter the **Tenant URL** (SCIM Base URL from OneUptime)
   - Enter the **Secret Token** (Bearer Token from OneUptime)
   - Test the connection and save

3. **Configure Attribute Mappings**
   - Map Azure AD attributes to OneUptime SCIM attributes
   - Ensure `userPrincipalName` or `mail` is mapped to `userName`
   - Configure any additional attribute mappings as needed

4. **Assign Users**
   - Go to **Users and groups** and assign users to the OneUptime application
   - Users will be automatically provisioned to OneUptime

### Okta

1. **SSO Application**
   - You should already have the Okta application from the SSO integration you might have completed. If you do not, then please check out SSO Readme to create a new Okta App.

2. **Configure SCIM Settings**
   - In the application settings (General Tab), go to **Provisioning**, select SAML and click on Save. **Proviosning** tab should now be enabled.
   - Set **SCIM connector base URL** to the OneUptime SCIM Base URL
   - Set **Unique identifier field for users** to `userName`
   - Enter the **Bearer Token** in the authentication header

3. **Configure Attribute Mappings**
   - Map Okta user attributes to SCIM attributes
   - Ensure `email` is mapped to `userName`
   - Configure additional mappings as needed

4. **Assign Users**
   - Assign users to the OneUptime application
   - Users will be automatically provisioned to OneUptime

