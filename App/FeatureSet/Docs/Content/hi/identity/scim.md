# SCIM (System for Cross-domain Identity Management)

OneUptime स्वचालित user provisioning और deprovisioning के लिए SCIM v2.0 protocol का समर्थन करता है। SCIM, Azure AD, Okta और अन्य enterprise identity systems जैसे identity providers (IdPs) को OneUptime projects और status pages तक user access स्वचालित रूप से प्रबंधित करने में सक्षम बनाता है।

## Overview

SCIM integration निम्नलिखित लाभ प्रदान करता है:

- **स्वचालित User Provisioning**: जब users आपके IdP में assign होते हैं तो OneUptime में स्वचालित रूप से बनाएं
- **स्वचालित User Deprovisioning**: जब users आपके IdP में unassign होते हैं तो OneUptime से स्वचालित रूप से हटाएं
- **User Attribute Synchronization**: आपके IdP और OneUptime के बीच user जानकारी synchronized रखें
- **Centralized Access Management**: अपने मौजूदा identity management system से OneUptime access प्रबंधित करें

## Projects के लिए SCIM

Project SCIM, identity providers को OneUptime projects के भीतर team members प्रबंधित करने की अनुमति देता है।

### Project SCIM सेट अप करना

1. **Project Settings पर जाएं**
   - अपने OneUptime project पर जाएं
   - **Project Settings** > **Team** > **SCIM** पर जाएं

2. **SCIM Settings Configure करें**
   - IdP में assign होने पर users स्वचालित रूप से जोड़ने के लिए **Auto Provision Users** सक्षम करें
   - IdP में unassign होने पर users स्वचालित रूप से हटाने के लिए **Auto Deprovision Users** सक्षम करें
   - **Default Teams** चुनें जिनमें नए users जोड़े जाने चाहिए
   - अपने IdP configuration के लिए **SCIM Base URL** और **Bearer Token** copy करें

3. **अपना Identity Provider Configure करें**
   - SCIM Base URL उपयोग करें: `https://oneuptime.com/scim/v2/{scimId}`
   - provided token के साथ bearer token authentication configure करें
   - user attributes map करें (email आवश्यक है)

### Project SCIM Endpoints

- **Service Provider Config**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /scim/v2/{scimId}/Users`
- **Get User**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /scim/v2/{scimId}/Users`
- **Update User**: `PUT /scim/v2/{scimId}/Users/{userId}` या `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **List Groups**: `GET /scim/v2/{scimId}/Groups`
- **Get Group**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Create Group**: `POST /scim/v2/{scimId}/Groups`
- **Update Group**: `PUT /scim/v2/{scimId}/Groups/{groupId}` या `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Delete Group**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### Project SCIM User Lifecycle

1. **IdP में User Assignment**: जब कोई user आपके IdP में OneUptime को assign होता है
2. **SCIM Provisioning**: IdP user बनाने के लिए OneUptime SCIM API को call करता है
3. **Team Membership**: User configured default teams में स्वचालित रूप से जोड़ा जाता है
4. **Access Granted**: User अब OneUptime project access कर सकता है
5. **User Unassignment**: जब user IdP में unassign होता है
6. **SCIM Deprovisioning**: IdP user हटाने के लिए OneUptime SCIM API को call करता है
7. **Access Revoked**: User project तक पहुंच खो देता है

## Status Pages के लिए SCIM

Status Page SCIM, identity providers को private status pages के subscribers प्रबंधित करने की अनुमति देता है।

### Status Page SCIM सेट अप करना

1. **Status Page Settings पर जाएं**
   - अपने OneUptime status page पर जाएं
   - **Status Page Settings** > **Private Users** > **SCIM** पर जाएं

2. **SCIM Settings Configure करें**
   - IdP में assign होने पर subscribers स्वचालित रूप से जोड़ने के लिए **Auto Provision Users** सक्षम करें
   - IdP में unassign होने पर subscribers स्वचालित रूप से हटाने के लिए **Auto Deprovision Users** सक्षम करें
   - अपने IdP configuration के लिए **SCIM Base URL** और **Bearer Token** copy करें

3. **अपना Identity Provider Configure करें**
   - SCIM Base URL उपयोग करें: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - provided token के साथ bearer token authentication configure करें
   - user attributes map करें (email आवश्यक है)

### Status Page SCIM Endpoints

- **Service Provider Config**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /status-page-scim/v2/{scimId}/Users`
- **Get User**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /status-page-scim/v2/{scimId}/Users`
- **Update User**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` या `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Status Page SCIM User Lifecycle

1. **IdP में User Assignment**: जब कोई user आपके IdP में OneUptime Status Page को assign होता है
2. **SCIM Provisioning**: IdP subscriber बनाने के लिए OneUptime SCIM API को call करता है
3. **Access Granted**: User अब private status page access कर सकता है
4. **User Unassignment**: जब user IdP में unassign होता है
5. **SCIM Deprovisioning**: IdP subscriber हटाने के लिए OneUptime SCIM API को call करता है
6. **Access Revoked**: User status page तक पहुंच खो देता है

## Identity Provider Configuration

### Microsoft Entra ID (पूर्व में Azure AD)

Microsoft Entra ID robust SCIM provisioning capabilities के साथ enterprise-grade identity management प्रदान करता है। OneUptime के साथ SCIM provisioning configure करने के लिए इन विस्तृत steps का पालन करें।

#### पूर्व आवश्यकताएं

- Microsoft Entra ID tenant Premium P1 या P2 license के साथ (स्वचालित provisioning के लिए आवश्यक)
- Scale plan या उच्चतर के साथ OneUptime account
- Microsoft Entra ID और OneUptime दोनों तक Admin access

#### चरण 1: OneUptime से SCIM Configuration प्राप्त करें

1. अपने OneUptime dashboard में लॉग इन करें
2. **Project Settings** > **Team** > **SCIM** पर जाएं
3. **Create SCIM Configuration** पर क्लिक करें
4. एक friendly नाम दर्ज करें (जैसे "Microsoft Entra ID Provisioning")
5. निम्नलिखित options configure करें:
   - **Auto Provision Users**: users स्वचालित रूप से बनाने के लिए सक्षम करें
   - **Auto Deprovision Users**: users स्वचालित रूप से हटाने के लिए सक्षम करें
   - **Default Teams**: वे teams चुनें जिनमें नए users जोड़े जाने चाहिए
   - **Enable Push Groups**: यदि आप Entra ID groups के माध्यम से team membership प्रबंधित करना चाहते हैं तो सक्षम करें
6. configuration सहेजें
7. **SCIM Base URL** और **Bearer Token** copy करें - आपको Entra ID के लिए इनकी आवश्यकता होगी

#### चरण 2: Microsoft Entra ID में Enterprise Application बनाएं

1. [Microsoft Entra admin center](https://entra.microsoft.com) में sign in करें
2. **Identity** > **Applications** > **Enterprise applications** पर जाएं
3. **+ New application** पर क्लिक करें
4. **+ Create your own application** पर क्लिक करें
5. एक नाम दर्ज करें (जैसे "OneUptime")
6. **Integrate any other application you don't find in the gallery (Non-gallery)** चुनें
7. **Create** पर क्लिक करें

#### चरण 3: SCIM Provisioning Configure करें

1. अपने OneUptime enterprise application में, **Provisioning** पर जाएं
2. **Get started** पर क्लिक करें
3. **Provisioning Mode** को **Automatic** पर सेट करें
4. **Admin Credentials** के अंतर्गत:
   - **Tenant URL**: OneUptime से SCIM Base URL दर्ज करें (जैसे `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Secret Token**: OneUptime से Bearer Token दर्ज करें
5. configuration सत्यापित करने के लिए **Test Connection** पर क्लिक करें
6. **Save** पर क्लिक करें

#### चरण 4: Attribute Mappings Configure करें

1. Provisioning section में, **Mappings** पर क्लिक करें
2. **Provision Azure Active Directory Users** पर क्लिक करें
3. निम्नलिखित attribute mappings configure करें:

| Azure AD Attribute | OneUptime SCIM Attribute | आवश्यक |
|-------------------|-------------------------|--------|
| `userPrincipalName` | `userName` | हाँ |
| `mail` | `emails[type eq "work"].value` | अनुशंसित |
| `displayName` | `displayName` | अनुशंसित |
| `givenName` | `name.givenName` | वैकल्पिक |
| `surname` | `name.familyName` | वैकल्पिक |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | अनुशंसित |

4. provisioning सरल बनाने के लिए जो mappings आवश्यक नहीं हैं उन्हें हटाएं
5. **Save** पर क्लिक करें

#### चरण 5: Group Provisioning Configure करें (वैकल्पिक)

यदि आपने OneUptime में **Push Groups** सक्षम किया है:

1. **Mappings** पर वापस जाएं
2. **Provision Azure Active Directory Groups** पर क्लिक करें
3. **Enabled** को **Yes** पर सेट करके group provisioning सक्षम करें
4. निम्नलिखित attribute mappings configure करें:

| Azure AD Attribute | OneUptime SCIM Attribute |
|-------------------|-------------------------|
| `displayName` | `displayName` |
| `members` | `members` |

5. **Save** पर क्लिक करें

#### चरण 6: Users और Groups Assign करें

1. अपने OneUptime enterprise application में, **Users and groups** पर जाएं
2. **+ Add user/group** पर क्लिक करें
3. वे users और/या groups चुनें जिन्हें आप OneUptime में provision करना चाहते हैं
4. **Assign** पर क्लिक करें

#### चरण 7: Provisioning शुरू करें

1. **Provisioning** > **Overview** पर जाएं
2. **Start provisioning** पर क्लिक करें
3. प्रारंभिक provisioning cycle शुरू होगा (पहले sync के लिए 40 मिनट तक लग सकते हैं)
4. किसी भी त्रुटि के लिए **Provisioning logs** monitor करें

#### Microsoft Entra ID के लिए समस्या निवारण

- **Test Connection Fails**: सत्यापित करें कि SCIM Base URL में `/api/identity` prefix है और Bearer Token सही है
- **Users Not Provisioning**: जांचें कि users application को assigned हैं और attribute mappings सही हैं
- **Provisioning Errors**: specific त्रुटि संदेशों के लिए Entra ID में Provisioning logs समीक्षा करें
- **Sync Delays**: प्रारंभिक provisioning में 40 मिनट तक लग सकते हैं; subsequent syncs हर 40 मिनट में होते हैं

---

### Okta

Okta उत्कृष्ट SCIM support के साथ flexible identity management प्रदान करता है। OneUptime के साथ SCIM provisioning configure करने के लिए इन विस्तृत steps का पालन करें।

#### पूर्व आवश्यकताएं

- provisioning capabilities के साथ Okta tenant (Lifecycle Management feature)
- Scale plan या उच्चतर के साथ OneUptime account
- Okta और OneUptime दोनों तक Admin access

#### चरण 1: OneUptime से SCIM Configuration प्राप्त करें

1. अपने OneUptime dashboard में लॉग इन करें
2. **Project Settings** > **Team** > **SCIM** पर जाएं
3. **Create SCIM Configuration** पर क्लिक करें
4. एक friendly नाम दर्ज करें (जैसे "Okta Provisioning")
5. निम्नलिखित options configure करें:
   - **Auto Provision Users**: users स्वचालित रूप से बनाने के लिए सक्षम करें
   - **Auto Deprovision Users**: users स्वचालित रूप से हटाने के लिए सक्षम करें
   - **Default Teams**: वे teams चुनें जिनमें नए users जोड़े जाने चाहिए
   - **Enable Push Groups**: यदि आप Okta groups के माध्यम से team membership प्रबंधित करना चाहते हैं तो सक्षम करें
6. configuration सहेजें
7. **SCIM Base URL** और **Bearer Token** copy करें - आपको Okta के लिए इनकी आवश्यकता होगी

#### चरण 2: Okta Application बनाएं या Configure करें

**यदि आपके पास एक मौजूदा SSO application है:**
1. अपने Okta Admin Console में sign in करें
2. **Applications** > **Applications** पर जाएं
3. अपना मौजूदा OneUptime application खोजें और चुनें

**यदि नया application बना रहे हैं:**
1. अपने Okta Admin Console में sign in करें
2. **Applications** > **Applications** पर जाएं
3. **Create App Integration** पर क्लिक करें
4. **SAML 2.0** चुनें और **Next** पर क्लिक करें
5. App name के रूप में "OneUptime" दर्ज करें
6. SAML configuration पूरी करें (SSO documentation देखें)
7. **Finish** पर क्लिक करें

#### चरण 3: SCIM Provisioning सक्षम करें

1. अपने OneUptime application में, **General** tab पर जाएं
2. **App Settings** section में, **Edit** पर क्लिक करें
3. **Provisioning** के अंतर्गत, **SCIM** चुनें
4. **Save** पर क्लिक करें
5. एक नया **Provisioning** tab प्रकट होगा

#### चरण 4: SCIM Connection Configure करें

1. **Provisioning** tab पर जाएं
2. बाईं sidebar में **Integration** पर क्लिक करें
3. **Configure API Integration** पर क्लिक करें
4. **Enable API integration** चेक करें
5. निम्नलिखित configure करें:
   - **SCIM connector base URL**: OneUptime से SCIM Base URL दर्ज करें (जैसे `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Unique identifier field for users**: `userName` दर्ज करें
   - **Supported provisioning actions**: वे actions चुनें जिन्हें आप सक्षम करना चाहते हैं:
     - Import New Users and Profile Updates
     - Push New Users
     - Push Profile Updates
     - Push Groups (यदि group-based provisioning उपयोग कर रहे हैं)
   - **Authentication Mode**: **HTTP Header** चुनें
   - **Authorization**: `Bearer {your-bearer-token}` दर्ज करें (actual token से बदलें)
6. connection सत्यापित करने के लिए **Test API Credentials** पर क्लिक करें
7. **Save** पर क्लिक करें

#### चरण 5: App के लिए Provisioning Configure करें

1. **Provisioning** tab में, बाईं sidebar में **To App** पर क्लिक करें
2. **Edit** पर क्लिक करें
3. निम्नलिखित options सक्षम करें:
   - **Create Users**: नए users provision करने के लिए सक्षम करें
   - **Update User Attributes**: attribute changes sync करने के लिए सक्षम करें
   - **Deactivate Users**: unassign होने पर users deprovision करने के लिए सक्षम करें
4. **Save** पर क्लिक करें

#### चरण 6: Attribute Mappings Configure करें

1. **Attribute Mappings** तक scroll करें
2. निम्नलिखित mappings सत्यापित या configure करें:

| Okta Attribute | OneUptime SCIM Attribute | Direction |
|---------------|-------------------------|-----------|
| `userName` | `userName` | Okta to App |
| `user.email` | `emails[primary eq true].value` | Okta to App |
| `user.firstName` | `name.givenName` | Okta to App |
| `user.lastName` | `name.familyName` | Okta to App |
| `user.displayName` | `displayName` | Okta to App |

3. अनावश्यक mappings हटाएं
4. यदि आपने changes किए हैं तो **Save** पर क्लिक करें

#### चरण 7: Push Groups Configure करें (वैकल्पिक)

यदि आपने OneUptime में **Push Groups** सक्षम किया है:

1. **Push Groups** tab पर जाएं
2. **+ Push Groups** पर क्लिक करें
3. **Find groups by name** या **Find groups by rule** चुनें
4. वे groups खोजें और चुनें जिन्हें आप push करना चाहते हैं
5. **Save** पर क्लिक करें

#### चरण 8: Users Assign करें

1. **Assignments** tab पर जाएं
2. **Assign** > **Assign to People** या **Assign to Groups** पर क्लिक करें
3. वे users या groups चुनें जिन्हें आप provision करना चाहते हैं
4. प्रत्येक selection के लिए **Assign** पर क्लिक करें
5. **Done** पर क्लिक करें

#### चरण 9: Provisioning सत्यापित करें

1. Okta Admin Console में **Reports** > **System Log** पर जाएं
2. अपने OneUptime application से संबंधित events के लिए filter करें
3. सत्यापित करें कि provisioning events सफल हैं
4. confirm करें कि users OneUptime में बनाए गए हैं

#### Okta के लिए समस्या निवारण

- **API Credentials Test Fails**: सत्यापित करें कि SCIM Base URL और Bearer Token सही हैं
- **Users Not Provisioning**: सुनिश्चित करें कि users application को assigned हैं और provisioning सक्षम है
- **Duplicate Users**: सुनिश्चित करें कि `userName` attribute unique है और email से सही map करता है
- **Group Push Failures**: सत्यापित करें कि groups मौजूद हैं और सही membership है
- **Error: 401 Unauthorized**: OneUptime में Bearer Token regenerate करें और Okta update करें

---

### अन्य Identity Providers

OneUptime का SCIM implementation, SCIM v2.0 specification का पालन करता है और किसी भी compliant identity provider के साथ काम करना चाहिए। सामान्य configuration steps:

1. **SCIM Base URL**: `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (projects के लिए) या `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (status pages के लिए)
2. **Authentication**: HTTP Bearer Token
3. **आवश्यक User Attribute**: `userName` (एक valid email address होना चाहिए)
4. **समर्थित Operations**: Users और Groups के लिए GET, POST, PUT, PATCH, DELETE

#### समर्थित SCIM Endpoints

| Endpoint | Methods | विवरण |
|----------|---------|-------|
| `/ServiceProviderConfig` | GET | SCIM server capabilities |
| `/Schemas` | GET | उपलब्ध resource schemas |
| `/ResourceTypes` | GET | उपलब्ध resource types |
| `/Users` | GET, POST | users सूचीबद्ध और बनाएं |
| `/Users/{id}` | GET, PUT, PATCH, DELETE | individual users प्रबंधित करें |
| `/Groups` | GET, POST | groups/teams सूचीबद्ध और बनाएं (Project SCIM only) |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE | individual groups प्रबंधित करें (Project SCIM only) |

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

## अक्सर पूछे जाने वाले प्रश्न

### जब कोई user deprovisioned होता है तो क्या होता है?

जब कोई user deprovisioned होता है (या तो DELETE request द्वारा या `active: false` सेट करके), वे SCIM settings में configured teams से हटा दिए जाते हैं। user account स्वयं OneUptime में बना रहता है लेकिन project तक पहुंच खो देता है।

### क्या मैं SSO के बिना SCIM उपयोग कर सकता हूं?

हाँ, SCIM और SSO स्वतंत्र features हैं। आप user provisioning के लिए SCIM उपयोग कर सकते हैं जबकि users को अपने OneUptime passwords या किसी अन्य authentication method से login करने की अनुमति दे सकते हैं।

### मैं उन users को कैसे handle करूं जो पहले से OneUptime में मौजूद हैं?

जब SCIM किसी ऐसे user को बनाने की कोशिश करता है जो पहले से मौजूद है (email से match करके), OneUptime duplicate user बनाने के बजाय उन्हें configured default teams में जोड़ देगा।

### Default teams और push groups में क्या अंतर है?

- **Default Teams**: SCIM के माध्यम से provisioned सभी users को एक ही predefined teams में जोड़ा जाता है
- **Push Groups**: Team membership आपके identity provider द्वारा प्रबंधित होती है, जिससे IdP group membership के आधार पर अलग-अलग users अलग-अलग teams में हो सकते हैं

### Provisioning sync कितनी बार होता है?

यह आपके identity provider पर निर्भर करता है:
- **Microsoft Entra ID**: प्रारंभिक sync में 40 मिनट तक लग सकते हैं; subsequent syncs हर 40 मिनट में
- **Okta**: अधिकांश operations के लिए near real-time, periodic full syncs के साथ
