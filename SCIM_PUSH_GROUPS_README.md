# SCIM Push Groups Implementation

This document describes the SCIM (System for Cross-domain Identity Management) push groups functionality implemented in OneUptime. This feature allows identity providers (IdPs) to automatically manage groups/teams and their memberships in OneUptime projects.

## Overview

SCIM push groups enables bidirectional synchronization of group structures between your identity provider and OneUptime. This includes:

- **Group Creation**: IdPs can create new teams in OneUptime
- **Group Updates**: Modify group names and memberships
- **Group Deletion**: Remove teams when deleted in the IdP
- **Membership Management**: Add/remove users from groups
- **Bulk Operations**: Handle multiple group operations efficiently

## Prerequisites

1. **SCIM Configuration**: A valid SCIM configuration must exist for the project
2. **Bearer Token**: Valid SCIM bearer token for authentication
3. **Project Access**: Users must exist in the project before being added to groups
4. **Permissions**: Appropriate team permissions must be configured

## API Endpoints

### Base URL
```
https://your-oneuptime-instance.com/scim/v2/{scimId}/
```

Replace `{scimId}` with your project's SCIM configuration ID.

### Authentication
All requests require Bearer token authentication:
```
Authorization: Bearer {your-scim-bearer-token}
```

## Group Operations

### List Groups
**GET** `/scim/v2/{scimId}/Groups`

Lists all teams in the project as SCIM groups.

**Query Parameters:**
- `filter` - SCIM filter expression (e.g., `displayName eq "Developers"`)
- `startIndex` - Starting index for pagination (default: 1)
- `count` - Number of results per page (default: 100, max: 200)

**Example Request:**
```bash
curl -X GET \
  "https://your-oneuptime-instance.com/scim/v2/{scimId}/Groups" \
  -H "Authorization: Bearer {your-token}" \
  -H "Content-Type: application/json"
```

**Example Response:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 3,
  "startIndex": 1,
  "itemsPerPage": 3,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      "id": "507c7f79bcf86cd7994f6c0e",
      "displayName": "Developers",
      "members": [
        {
          "value": "507c7f79bcf86cd7994f6c0f",
          "display": "john.doe@example.com",
          "$ref": "/scim/v2/{scimId}/Users/507c7f79bcf86cd7994f6c0f"
        }
      ],
      "meta": {
        "resourceType": "Group",
        "created": "2025-01-15T10:30:00Z",
        "lastModified": "2025-01-15T10:30:00Z",
        "location": "/scim/v2/{scimId}/Groups/507c7f79bcf86cd7994f6c0e"
      }
    }
  ]
}
```

### Get Single Group
**GET** `/scim/v2/{scimId}/Groups/{groupId}`

Retrieves detailed information about a specific group including all members.

**Example Request:**
```bash
curl -X GET \
  "https://your-oneuptime-instance.com/scim/v2/{scimId}/Groups/507c7f79bcf86cd7994f6c0e" \
  -H "Authorization: Bearer {your-token}" \
  -H "Content-Type: application/json"
```

### Create Group
**POST** `/scim/v2/{scimId}/Groups`

Creates a new team in the project.

**Request Body:**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "New Team",
  "members": [
    {
      "value": "507c7f79bcf86cd7994f6c0f",
      "display": "john.doe@example.com"
    }
  ]
}
```

**Example Request:**
```bash
curl -X POST \
  "https://your-oneuptime-instance.com/scim/v2/{scimId}/Groups" \
  -H "Authorization: Bearer {your-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    "displayName": "New Team",
    "members": [
      {
        "value": "507c7f79bcf86cd7994f6c0f",
        "display": "john.doe@example.com"
      }
    ]
  }'
```

**Response (201 Created):**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "507c7f79bcf86cd7994f6c10",
  "displayName": "New Team",
  "members": [
    {
      "value": "507c7f79bcf86cd7994f6c0f",
      "display": "john.doe@example.com",
      "$ref": "/scim/v2/{scimId}/Users/507c7f79bcf86cd7994f6c0f"
    }
  ],
  "meta": {
    "resourceType": "Group",
    "created": "2025-01-15T11:00:00Z",
    "lastModified": "2025-01-15T11:00:00Z",
    "location": "/scim/v2/{scimId}/Groups/507c7f79bcf86cd7994f6c10"
  }
}
```

### Update Group (Full Replacement)
**PUT** `/scim/v2/{scimId}/Groups/{groupId}`

Replaces the entire group, including name and all memberships.

**Request Body:**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Updated Team Name",
  "members": [
    {
      "value": "507c7f79bcf86cd7994f6c0f",
      "display": "john.doe@example.com"
    },
    {
      "value": "507c7f79bcf86cd7994f6c11",
      "display": "jane.smith@example.com"
    }
  ]
}
```

### Update Group (Partial)
**PATCH** `/scim/v2/{scimId}/Groups/{groupId}`

Performs partial updates to group memberships or name.

**Add Members:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [
        {
          "value": "507c7f79bcf86cd7994f6c11",
          "display": "jane.smith@example.com"
        }
      ]
    }
  ]
}
```

**Remove Members:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "remove",
      "path": "members",
      "value": [
        {
          "value": "507c7f79bcf86cd7994f6c0f",
          "display": "john.doe@example.com"
        }
      ]
    }
  ]
}
```

**Replace All Members:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "members",
      "value": [
        {
          "value": "507c7f79bcf86cd7994f6c11",
          "display": "jane.smith@example.com"
        }
      ]
    }
  ]
}
```

**Update Group Name:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "displayName",
      "value": "New Team Name"
    }
  ]
}
```

**Example PATCH Request:**
```bash
curl -X PATCH \
  "https://your-oneuptime-instance.com/scim/v2/{scimId}/Groups/507c7f79bcf86cd7994f6c10" \
  -H "Authorization: Bearer {your-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [
      {
        "op": "add",
        "path": "members",
        "value": [
          {
            "value": "507c7f79bcf86cd7994f6c11",
            "display": "jane.smith@example.com"
          }
        ]
      }
    ]
  }'
```

### Delete Group
**DELETE** `/scim/v2/{scimId}/Groups/{groupId}`

Removes a group and all its memberships.

**Example Request:**
```bash
curl -X DELETE \
  "https://your-oneuptime-instance.com/scim/v2/{scimId}/Groups/507c7f79bcf86cd7994f6c10" \
  -H "Authorization: Bearer {your-token}"
```

**Response (204 No Content)**

## Testing Guide

### Manual Testing with cURL

1. **Setup Test Data:**
   - Create a project with SCIM enabled
   - Note the SCIM ID and bearer token
   - Create some test users in the project

2. **Test Group Creation:**
   ```bash
   # Create a new group
   curl -X POST \
     "https://your-oneuptime-instance.com/scim/v2/{scimId}/Groups" \
     -H "Authorization: Bearer {your-token}" \
     -H "Content-Type: application/json" \
     -d '{
       "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
       "displayName": "Test Team",
       "members": []
     }'
   ```

3. **Test Group Listing:**
   ```bash
   # List all groups
   curl -X GET \
     "https://your-oneuptime-instance.com/scim/v2/{scimId}/Groups" \
     -H "Authorization: Bearer {your-token}"
   ```

4. **Test Membership Management:**
   ```bash
   # Add a member to the group
   curl -X PATCH \
     "https://your-oneuptime-instance.com/scim/v2/{scimId}/Groups/{groupId}" \
     -H "Authorization: Bearer {your-token}" \
     -H "Content-Type: application/json" \
     -d '{
       "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
       "Operations": [
         {
           "op": "add",
           "path": "members",
           "value": [
             {
               "value": "{userId}",
               "display": "user@example.com"
             }
           ]
         }
       ]
     }'
   ```

## Testing with Identity Providers

### Testing Checklist

Before going to production, test the following scenarios:

1. **User Provisioning:**
   - [ ] Create user in IdP → User appears in OneUptime
   - [ ] Update user attributes in IdP → Changes sync to OneUptime
   - [ ] Deactivate user in IdP → User removed from OneUptime

2. **Group Provisioning:**
   - [ ] Create group in IdP → Group appears in OneUptime
   - [ ] Add user to group in IdP → User added to team in OneUptime
   - [ ] Remove user from group in IdP → User removed from team in OneUptime
   - [ ] Delete group in IdP → Group removed from OneUptime

3. **Bulk Operations:**
   - [ ] Bulk user creation
   - [ ] Bulk group membership updates
   - [ ] Large group synchronization

4. **Error Handling:**
   - [ ] Invalid user data
   - [ ] Duplicate group names
   - [ ] Permission restrictions
   - [ ] Network connectivity issues

### Provider-Specific Testing Notes

#### Azure AD Testing
- Use **Provisioning Logs** in Azure AD to monitor sync status
- Check **Audit Logs** for detailed operation history
- Test with **On-demand provisioning** for individual users/groups

#### Okta Testing
- Use **Provisioning** → **View Logs** to monitor operations
- Check **System Log** for detailed SCIM API calls
- Test with **Push Groups** configuration for selective group sync

#### OneLogin Testing
- Monitor **Provisioning** tab for sync status
- Check **Logs** section for operation details
- Test with different user lifecycle events

### Performance Testing

1. **Load Testing:**
   - Test with 100+ users and groups
   - Monitor API response times
   - Check for rate limiting

2. **Concurrent Operations:**
   - Multiple group membership changes simultaneously
   - Bulk user provisioning
   - Mixed create/update/delete operations

3. **Large Dataset Testing:**
   - Organizations with 1000+ users
   - Complex group hierarchies
   - Frequent membership changes

#### Azure Active Directory

1. **Configure Azure AD Enterprise Application:**
   - Go to Azure AD → Enterprise Applications
   - Select your OneUptime SCIM application
   - Go to Provisioning → Provisioning

2. **Set Group Provisioning:**
   - Enable group provisioning
   - Configure group attribute mappings
   - Test the connection

3. **Assign Groups:**
   - Go to Users and groups
   - Assign groups to the application
   - Monitor provisioning logs

#### Okta

1. **Create or Configure OneUptime Application:**
   - In Okta Admin Console, go to **Applications** → **Applications**
   - Click **Create App Integration**
   - Choose **SAML 2.0** or **SWA** (for SCIM provisioning)
   - Configure basic SAML settings if using SAML

2. **Enable SCIM Provisioning:**
   - In your OneUptime application, go to **Provisioning** tab
   - Click **Configure API Integration**
   - Check **Enable API integration**
   - Enter the **Base URL**: `https://your-oneuptime-instance.com/scim/v2/{scimId}`
   - Enter the **API Token**: Your SCIM bearer token
   - Click **Test API Credentials** to verify the connection
   - Save the configuration

3. **Configure Provisioning Settings:**
   - Go to **Provisioning** → **To App**
   - Enable the following options:
     - **Create Users**
     - **Update User Attributes**
     - **Deactivate Users**
     - **Create Groups** (for push groups)
     - **Update Group Memberships** (for push groups)

4. **Configure Attribute Mappings:**
   - Go to **Provisioning** → **Attribute Mappings**
   - For Users:
     - Map `userName` to `email`
     - Map `givenName` to `firstName`
     - Map `familyName` to `lastName`
     - Map `displayName` to `displayName`
   - For Groups:
     - Map `displayName` to `name`

5. **Configure Group Provisioning:**
   - Go to **Provisioning** → **To App** → **Group Memberships**
   - Select **Push Groups** to specify which groups to provision
   - Choose groups from your Okta directory to push to OneUptime
   - Configure group attribute mappings

6. **Assign Users and Groups:**
   - Go to **Assignments** tab
   - Assign users and groups to the OneUptime application
   - Users and groups will be automatically provisioned to OneUptime

7. **Monitor Provisioning:**
   - Go to **Provisioning** → **View Logs**
   - Monitor import and export operations
   - Check for any provisioning errors
   - Review group membership synchronization

**Example Okta SCIM Configuration:**
```
Base URL: https://your-oneuptime-instance.com/scim/v2/your-scim-id
API Token: your-bearer-token
Unique identifier field for users: userName
Supported provisioning actions:
- Create Users ✓
- Update User Attributes ✓
- Deactivate Users ✓
- Create Groups ✓
- Update Group Memberships ✓
```

#### OneLogin

1. **Create Custom Connector:**
   - In OneLogin Admin, go to **Applications** → **Add App**
   - Search for "SCIM" or create a custom connector
   - Configure basic application settings

2. **Configure SCIM Settings:**
   - Go to **Configuration** tab
   - Set **SCIM Base URL**: `https://your-oneuptime-instance.com/scim/v2/{scimId}`
   - Set **SCIM Bearer Token**: Your SCIM bearer token
   - Enable SCIM provisioning

3. **Configure Provisioning:**
   - Go to **Provisioning** tab
   - Enable **Create user**, **Delete user**, **Update user**
   - Enable **Create group**, **Delete group**, **Update group membership**
   - Configure attribute mappings for users and groups

4. **Map Attributes:**
   - **User Attributes:**
     - External ID → `id`
     - Username → `userName`
     - Email → `emails[primary]`
     - First Name → `name.givenName`
     - Last Name → `name.familyName`
   - **Group Attributes:**
     - Group Name → `displayName`
     - Group Members → `members`

#### JumpCloud

1. **Create SCIM Application:**
   - In JumpCloud Admin, go to **SSO Applications**
   - Create a new custom SCIM application
   - Configure basic settings

2. **Configure SCIM Integration:**
   - Set **SCIM URL**: `https://your-oneuptime-instance.com/scim/v2/{scimId}`
   - Set **Token**: Your SCIM bearer token
   - Enable group provisioning

3. **Configure Attribute Mappings:**
   - **User Mappings:**
     - `userName` → `email`
     - `name.givenName` → `firstname`
     - `name.familyName` → `lastname`
     - `displayName` → `displayname`
   - **Group Mappings:**
     - `displayName` → `name`
     - `members` → `members`

#### Generic SCIM 2.0 Provider

For any SCIM 2.0 compliant identity provider:

1. **Basic Configuration:**
   - **SCIM Base URL**: `https://your-oneuptime-instance.com/scim/v2/{scimId}`
   - **Authentication**: Bearer Token
   - **Token**: Your SCIM bearer token

2. **Required User Attributes:**
   ```json
   {
     "userName": "user@example.com",
     "name": {
       "givenName": "John",
       "familyName": "Doe"
     },
     "emails": [{
       "value": "user@example.com",
       "primary": true
     }],
     "active": true
   }
   ```

3. **Required Group Attributes:**
   ```json
   {
     "displayName": "Group Name",
     "members": [{
       "value": "user-id",
       "display": "user@example.com"
     }]
   }
   ```

4. **Supported Operations:**
   - User: CREATE, READ, UPDATE, DELETE
   - Group: CREATE, READ, UPDATE, DELETE
   - Membership: ADD, REMOVE, REPLACE

### Automated Testing

#### Unit Tests
```typescript
// Example test for group creation
describe('SCIM Group Creation', () => {
  it('should create a new group via SCIM', async () => {
    const response = await request(app)
      .post(`/scim/v2/${scimId}/Groups`)
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Test Group'
      });

    expect(response.status).toBe(201);
    expect(response.body.displayName).toBe('Test Group');
  });
});
```

#### Integration Tests
```typescript
// Example integration test
describe('SCIM Group Operations', () => {
  let groupId: string;

  it('should create, update, and delete a group', async () => {
    // Create group
    const createResponse = await request(app)
      .post(`/scim/v2/${scimId}/Groups`)
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Integration Test Group'
      });

    groupId = createResponse.body.id;

    // Update group
    await request(app)
      .patch(`/scim/v2/${scimId}/Groups/${groupId}`)
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{
          op: 'replace',
          path: 'displayName',
          value: 'Updated Group'
        }]
      });

    // Delete group
    await request(app)
      .delete(`/scim/v2/${scimId}/Groups/${groupId}`)
      .set('Authorization', `Bearer ${bearerToken}`)
      .expect(204);
  });
});
```

## Error Handling

### Common Error Responses

**400 Bad Request:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "400",
  "detail": "displayName is required"
}
```

**401 Unauthorized:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "401",
  "detail": "Invalid bearer token"
}
```

**403 Forbidden:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "403",
  "detail": "This group cannot be updated"
}
```

**404 Not Found:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "404",
  "detail": "Group not found or not part of this project"
}
```

**409 Conflict:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "409",
  "detail": "Group with this name already exists"
}
```

## Best Practices

1. **Test Thoroughly**: Always test in a development environment first
2. **Monitor Logs**: Check application logs for SCIM operation details
3. **Handle Rate Limits**: Implement appropriate delays between bulk operations
4. **Validate Data**: Ensure user IDs exist before adding to groups
5. **Backup Data**: Create backups before large-scale group operations
6. **Monitor Performance**: Watch for performance impact during bulk operations

## Troubleshooting

### Common Issues

1. **"User not found" errors:**
   - Ensure users exist in the project before adding to groups
   - Check user ID format (should be valid ObjectID)

2. **"Group cannot be updated" errors:**
   - Check team permissions in OneUptime
   - Verify the team is marked as editable

3. **Authentication failures:**
   - Verify bearer token is correct and not expired
   - Check SCIM configuration is active

4. **Performance issues:**
   - Use pagination for large group lists
   - Avoid bulk operations during peak hours

### Provider-Specific Troubleshooting

#### Azure AD Issues
- **Provisioning stuck**: Check Azure AD service health status
- **Attribute mapping errors**: Verify attribute mappings in provisioning configuration
- **Group not syncing**: Ensure group is assigned to the application

#### Okta Issues
- **API token errors**: Regenerate SCIM token in OneUptime and update in Okta
- **Group push failures**: Check group provisioning settings and assignments
- **Rate limiting**: Implement delays between bulk operations

#### OneLogin Issues
- **Connection failures**: Verify SCIM base URL and token
- **Attribute sync issues**: Check attribute mapping configuration
- **Group membership delays**: Allow time for provisioning cycles to complete

### Debug Mode

Enable debug logging to see detailed SCIM operation logs:
```bash
# Set log level to debug
export LOG_LEVEL=debug
```

## Support

For additional help:
- Check the [SCIM documentation](https://oneuptime.com/docs/identity/scim)
- Review application logs for detailed error information
- Contact OneUptime support with specific error messages and request details

## Version History

- **v1.0.0**: Initial implementation of SCIM push groups
  - Basic CRUD operations for groups
  - Membership management via PATCH
  - Integration with existing SCIM user functionality
  - Support for Azure AD and Okta integration
- **v1.0.1**: Enhanced documentation
  - Added comprehensive Okta configuration guide
  - Added OneLogin and JumpCloud integration steps
  - Added generic SCIM 2.0 provider configuration
  - Included testing checklists and troubleshooting guides
  - Added performance testing recommendations