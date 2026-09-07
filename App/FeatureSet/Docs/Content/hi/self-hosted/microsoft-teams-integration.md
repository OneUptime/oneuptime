# Microsoft Teams Integration

अपने self-hosted OneUptime instance के साथ Microsoft Teams integrate करने के लिए, आपको Azure App Registration configure करना और आवश्यक environment variables सेट अप करने होंगे।

## पूर्व आवश्यकताएं

- Azure Account - [https://azure.com](https://azure.com) पर जाकर बना सकते हैं
- आपके OneUptime server configuration तक पहुंच

### निजी नेटवर्क पर डिप्लॉयमेंट

OneUptime अपने Teams इंटीग्रेशन के लिए Azure Bot उपयोग करता है। Incoming Webhook या Teams Workflow URL इस बॉट के मैसेजिंग एंडपॉइंट की जगह नहीं लेता। Microsoft स्वयं होस्ट किए गए बॉट के लिए [सार्वजनिक रूप से पहुंच योग्य HTTPS एंडपॉइंट](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) आवश्यक बताता है। निजी IP पता, आंतरिक DNS नाम या किसी कर्मचारी का VPN कनेक्शन Azure Bot Service को OneUptime तक पहुंच नहीं देता।

सेटअप जारी रखने से पहले [इंटीग्रेशन के लिए निजी नेटवर्क एक्सेस](/docs/self-hosted/integration-network-access) के निर्देश अपनाएं। उस गाइड में सार्वजनिक DNS, विश्वसनीय TLS, निजी डिप्लॉयमेंट तक फ़ॉरवर्ड करने वाली रिवर्स प्रॉक्सी, फ़ायरवॉल नियम और सत्यापन शामिल हैं। Teams के लिए `/api/microsoft-bot/messages` प्रकाशित करें और चरण 4 में Azure Bot का **Messaging endpoint** उस पूरे सार्वजनिक HTTPS URL पर सेट करें। `/api` प्रीफ़िक्स, अनुरोध की बॉडी और `Authorization` हेडर बनाए रखें। अनुरोधों को बॉट के प्रमाणीकरण से सत्यापित होने दें; इंटरैक्टिव प्रॉक्सी लॉगिन या ब्राउज़र चैलेंज Microsoft की डिलीवरी रोकता है।

App registration के रीडायरेक्ट `/api/microsoft-teams/auth` और `/api/microsoft-teams/admin-consent/callback` उपयोगकर्ता के ब्राउज़र के माध्यम से वापस आते हैं। उस ब्राउज़र को OneUptime तक पहुंच चाहिए, जैसे कॉर्पोरेट नेटवर्क या VPN से। बॉट संदेश और कार्ड क्रियाएं Microsoft के सर्वर से आती हैं और उनके लिए अलग से पहुंच योग्य ingress आवश्यक है। केवल आउटबाउंड अलर्ट डिलीवरी से इनबाउंड कनेक्टिविटी सत्यापित नहीं होती।

डेवलपमेंट के लिए Microsoft की [Teams परीक्षण गाइड](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug) स्थानीय सेवा को टनल से उपलब्ध कराने का तरीका बताती है। OneUptime ingress पर फ़ॉरवर्ड करें और Microsoft के उदाहरण पथ `/api/messages` के बजाय `/api/microsoft-bot/messages` उपयोग करें। सार्वजनिक टनल URL बदलने पर Azure Bot एंडपॉइंट अपडेट करें, और प्रोडक्शन में स्थिर ingress उपयोग करें।

Azure Bot Private Endpoint इस Teams ingress का विकल्प नहीं है। Microsoft के [नेटवर्क आइसोलेशन निर्देश](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) Direct Line आइसोलेशन का वर्णन करते हैं और बताते हैं कि सार्वजनिक नेटवर्क एक्सेस बंद करने से Teams चैनल की कॉन्फ़िगरेशन हट जाती है।

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

`ChannelMessage.Send` केवल delegated permission है; [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend) में इसका application permission विकल्प नहीं है। इसे ऊपर दी गई delegated सूची में रखें।

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

1. project **सेटिंग्स** > **वर्कस्पेस** > **Microsoft Teams** पर जाएं
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
