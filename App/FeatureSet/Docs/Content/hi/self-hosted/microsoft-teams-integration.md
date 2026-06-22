# Microsoft Teams Integration

अपने self-hosted OneUptime instance के साथ Microsoft Teams integrate करने के लिए, आपको Azure App Registration configure करना और आवश्यक environment variables सेट अप करने होंगे।

## पूर्व आवश्यकताएं

- Azure Account - [https://azure.com](https://azure.com) पर जाकर बना सकते हैं
- आपके OneUptime server configuration तक पहुंच

## Setup Instructions

### चरण 1: Azure App Registration बनाएं

1. [Azure Portal](https://portal.azure.com) पर जाएं
2. "App registrations" पर जाएं और "New registration" पर क्लिक करें
3. Registration form भरें:
   - **Name:** oneuptime
   - **Supported account types:** Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)
   - **Redirect URI:** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - कृपया यह भी जोड़ें: `https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. "Register" पर क्लिक करें
5. "Application (client) ID" नोट करें - आपको बाद में इसकी आवश्यकता होगी

### चरण 2: App Permissions Configure करें

1. अपने app registration में, "API permissions" पर जाएं
2. "Add a permission" पर क्लिक करें और "Microsoft Graph" चुनें

**Delegated Permissions जोड़ें** (signed-in user की ओर से act करते समय):

- **User.Read** - OAuth flow के दौरान authenticated user की profile जानकारी (display name, email) प्राप्त करने के लिए आवश्यक
- **Team.ReadBasic.All** - connect करने के लिए team चुनते समय user की member teams list करने के लिए आवश्यक
- **Channel.ReadBasic.All** - channel जानकारी पढ़ने और notification delivery के लिए teams में channels list करने के लिए आवश्यक
- **ChannelMessage.Send** - Teams channels को alert और incident notifications भेजने के लिए आवश्यक

**Application Permissions जोड़ें** (signed-in user के बिना app के रूप में act करते समय):

- **Team.ReadBasic.All** - admin consent grant होने के बाद organization में सभी teams list करने के लिए आवश्यक
- **Channel.ReadBasic.All** - channel existence verify करने और channel details retrieve करने के लिए आवश्यक
- **ChannelMessage.Send** - channels पर programmatically messages भेजने के लिए आवश्यक

3. अपने organization के लिए "Grant admin consent" पर क्लिक करें

### चरण 3: Client Secret बनाएं

1. अपने app registration में "Certificates & secrets" पर जाएं
2. "New client secret" पर क्लिक करें
3. एक description जोड़ें और expiration सेट करें (24 months recommend)
4. "Add" पर क्लिक करें और secret value तुरंत copy करें - आप इसे फिर नहीं देख पाएंगे

**महत्वपूर्ण:** Secret ID copy न करें, आपको secret VALUE चाहिए जो typically longer है।

### चरण 4: एक Bot Service बनाएं

1. Azure Portal में, "Azure Bot" पर जाएं और "Create" पर क्लिक करें
2. Bot creation form भरें:

   - **Bot handle:** oneuptime-bot
   - **Subscription:** आपका Azure subscription
   - **Resource group:** नया बनाएं या existing उपयोग करें
   - **Location:** अपने users के करीब एक location चुनें
   - **Pricing tier:** Testing के लिए F0 (Free) पर्याप्त है
   - पहले बनाए गए app registration से App (client) ID और Tenant ID उपयोग करें

3. "Review + create" और फिर "Create" पर क्लिक करें

4. Deploy होने के बाद, अपने bot resource पर जाएं और "Configuration" पर जाएं
5. "Messaging endpoint" को `https://your-oneuptime-domain.com/api/microsoft-bot/messages` पर सेट करें
6. Configuration save करें

### चरण 5: Bot में Microsoft Teams Channel जोड़ें

1. अपने Azure Bot resource में, "Channels" पर जाएं
2. "Microsoft Teams" खोजें और "Open" या "Add" पर क्लिक करें
3. Settings review करें
4. Teams channel enable करने के लिए "Save" पर क्लिक करें

### चरण 6: OneUptime Environment Variables Configure करें

#### Docker Compose

यदि आप Docker Compose उपयोग कर रहे हैं, तो इन environment variables को अपनी configuration में जोड़ें:

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes with Helm

यदि आप Kubernetes with Helm उपयोग कर रहे हैं, तो इन्हें अपनी `values.yaml` फ़ाइल में जोड़ें:

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
  tenantId: YOUR_MICROSOFT_TENANT_ID
```

**महत्वपूर्ण:** इन environment variables को add करने के बाद अपना OneUptime server restart करें ताकि वे effect में आएं।

### चरण 7: Teams App Manifest Upload करें

1. project **Settings** > **Integrations** > **Microsoft Teams** पर जाएं
2. वहाँ से Teams app manifest download करें
3. Microsoft Teams पर जाएं, sidebar में "Apps" पर क्लिक करें
4. नीचे "Manage your apps" पर क्लिक करें
5. "Upload a custom app" पर क्लिक करें
6. "Upload for me or my teams" चुनें
7. पहले download की गई manifest zip फ़ाइल upload करें

## समस्या निवारण

यदि आपको कोई समस्या आती है:

- सुनिश्चित करें कि आपके app में correct permissions granted हैं
- जांचें कि redirect URI exactly match करती है (अपने actual domain से `your-oneuptime-domain.com` बदलें)
- सत्यापित करें कि आपके environment variables सही तरीके से सेट हैं
- सुनिश्चित करें कि bot messaging endpoint internet से accessible है
- सत्यापित करें कि bot Teams channel के साथ ठीक से configured है
- जांचें कि Teams app manifest successfully upload हुआ है

## Support

हम इस integration को improve करना चाहते हैं, इसलिए feedback स्वागत है। कृपया हमें [hello@oneuptime.com](mailto:hello@oneuptime.com) पर भेजें
