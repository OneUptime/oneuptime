# Microsoft Teams Integration

अपने self-hosted OneUptime instance के साथ Microsoft Teams integrate करने के लिए, आपको Azure App Registration configure करना और आवश्यक environment variables सेट अप करने होंगे।

## पूर्व आवश्यकताएं

- Azure Account - [https://azure.com](https://azure.com) पर जाकर बना सकते हैं
- आपके OneUptime server configuration तक पहुंच

## नेटवर्क एक्सेस

OneUptime अपने Teams इंटीग्रेशन के लिए Azure Bot उपयोग करता है। Incoming Webhook या Teams Workflow URL इस बॉट के मैसेजिंग एंडपॉइंट की जगह नहीं लेता। Microsoft स्वयं होस्ट किए गए बॉट के लिए [सार्वजनिक रूप से पहुंच योग्य HTTPS एंडपॉइंट](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) आवश्यक बताता है। निजी IP पता, आंतरिक DNS नाम या किसी कर्मचारी का VPN कनेक्शन Azure Bot Service को OneUptime तक पहुंच नहीं देता।

| सुविधा | OneUptime से प्रदाता तक | प्रदाता से OneUptime तक |
| --- | --- | --- |
| Teams सूचनाएं | Microsoft API तक HTTPS | बातचीत की खोज सहित पूरे बॉट इंटीग्रेशन के लिए आवश्यक |
| Teams कमांड, कार्ड बटन, चैट इंस्टॉलेशन इवेंट | HTTPS | `POST /api/microsoft-bot/messages` |

App registration के रीडायरेक्ट `/api/microsoft-teams/auth` और `/api/microsoft-teams/admin-consent/callback` उपयोगकर्ता के ब्राउज़र के माध्यम से वापस आते हैं। उस ब्राउज़र को OneUptime तक पहुंच चाहिए, जैसे कॉर्पोरेट नेटवर्क या VPN से। बॉट संदेश और कार्ड क्रियाएं Microsoft के सर्वर से आती हैं और उनके लिए अलग से पहुंच योग्य ingress आवश्यक है। केवल आउटबाउंड अलर्ट डिलीवरी से इनबाउंड कनेक्टिविटी सत्यापित नहीं होती।

### प्रोडक्शन: निजी डिप्लॉयमेंट के लिए गेटवे प्रकाशित करें

1. **होस्टनेम चुनें**, जैसे `oneuptime.example.com`। इंटरनेट से उपलब्ध गेटवे की ओर इंगित करने वाले सार्वजनिक DNS रिकॉर्ड प्रकाशित करें। प्रदाता निजी IP पते और केवल आंतरिक DNS नामों तक नहीं पहुंच सकते। split DNS के साथ कर्मचारी उसी होस्टनेम को निजी ingress पर रिज़ॉल्व कर सकते हैं और VPN पर डैशबोर्ड उपयोग करना जारी रख सकते हैं। निजी ingress को भी उस होस्टनेम के लिए मान्य प्रमाणपत्र के साथ HTTPS प्रदान करना चाहिए।

2. **गेटवे को OneUptime से जोड़ें।** उसे निजी ingress तक रूट वाले DMZ में रखें, या अपने site-to-site VPN/private link से जुड़े सार्वजनिक गेटवे का उपयोग करें। अपस्ट्रीम सेवा पोर्ट पर गेटवे से ingress तक ट्रैफ़िक की अनुमति दें। Kubernetes/Portainer में केवल निजी `ClusterIP` सेवा पर्याप्त नहीं है: गेटवे के लिए ingress/controller या कोई अन्य पहुंच योग्य अपस्ट्रीम आवश्यक है। डेटाबेस और अन्य आंतरिक सेवाएं निजी रखें।

3. **पोर्ट 443 पर HTTPS टर्मिनेट करें**, और सार्वजनिक रूप से विश्वसनीय प्रमाणपत्र तथा पूरी इंटरमीडिएट प्रमाणपत्र श्रृंखला उपयोग करें। गेटवे पर इनबाउंड TCP 443 की अनुमति दें। केवल प्रमाणपत्र लगाने या DNS बदलने से निजी अपस्ट्रीम तक रूट नहीं बनता।

4. केवल `/api/microsoft-bot/messages` प्रकाशित करें और चरण 4 में इस पूरे सार्वजनिक HTTPS URL को Azure Bot का मैसेजिंग एंडपॉइंट बनाएं। OneUptime के Bot Framework एडाप्टर को अनुरोध प्राप्त करके उनका प्रमाणीकरण करना चाहिए। मेथड, पथ, क्वेरी स्ट्रिंग, बॉडी और प्रमाणीकरण हेडर (`Authorization`) बनाए रखें। सार्वजनिक `Host` सुरक्षित रखें और विश्वसनीय `X-Forwarded-Host` तथा `X-Forwarded-Proto: https` हेडर सेट करें। रीडायरेक्ट न जोड़ें।

5. इन पथों को ब्राउज़र SSO, CAPTCHA और प्रॉक्सी लॉगिन पेजों से छूट दें। OneUptime का प्रमाणीकरण चालू रखें। मूल सर्वर तक पहुंच केवल गेटवे और अधिकृत आंतरिक क्लाइंट को दें; लॉग में टोकन छिपाएं।

6. **OneUptime का कैनोनिकल URL सेट करें**:

   Docker Compose में, `config.env` के अंदर:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm/Portainer मान:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   उदाहरण की जगह अपना डोमेन रखें। ये सेटिंग URL बनाती हैं; DNS, TLS या फ़ायरवॉल नियम नहीं बनातीं। Compose कॉन्फ़िगरेशन या Helm अपडेट लागू करें और एप्लिकेशन के पुनः आरंभ होने की प्रतीक्षा करें। होस्टनाम बदलने पर Azure Bot एंडपॉइंट और ऐप पंजीकरण के रीडायरेक्ट URI अपडेट करें, फिर Teams मैनिफ़ेस्ट दोबारा डाउनलोड और अपलोड करें।

[निजी नेटवर्क एक्सेस सेटिंग](/docs/self-hosted/private-network-access) आंतरिक सेवाओं को भेजे जाने वाले OneUptime के आउटबाउंड अनुरोध नियंत्रित करती हैं। `ALLOW_PRIVATE_NETWORK_WEBHOOKS` चालू करने से Teams की OneUptime तक पहुंच नहीं बनती।

### आउटबाउंड एक्सेस और IP प्रतिबंध

OneUptime एप्लिकेशन से DNS रिज़ॉल्यूशन और आउटबाउंड HTTPS (TCP 443) की अनुमति दें। Teams `graph.microsoft.com`, `login.microsoftonline.com`, Bot Framework प्रमाणीकरण/चैनल एंडपॉइंट और बातचीत के connector service URL उपयोग करता है। [Microsoft का फ़ायरवॉल मार्गदर्शन](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) अपनाएं और परीक्षण के दौरान अवरुद्ध ट्रैफ़िक जांचें; ये उदाहरण डोमेन की पूरी सूची नहीं हैं। कमर्शियल क्लाउड का फ़ॉलबैक कनेक्टर `https://smba.trafficmanager.net/teams/` है; किसी बातचीत का सर्विस URL अलग हो सकता है।

Microsoft स्थिर इनबाउंड Bot Framework IP अनुमति-सूचियों का समर्थन नहीं करता, क्योंकि पते बदलते हैं। Teams क्लाइंट की मीडिया रेंज बॉट वेबहुक के स्रोत पते नहीं हैं। Bot Framework प्रमाणीकरण चालू रखें।

### परीक्षण और इनबाउंड एक्सेस के बिना डिप्लॉयमेंट

अपने VPN से बाहर के नेटवर्क पर सार्वजनिक DNS और TLS सत्यापित करें, फिर Teams रूट जांचें:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

OneUptime के वर्तमान संस्करणों में `Allow: POST` के साथ `405 Method Not Allowed` मिलना चाहिए। इससे पुष्टि होती है कि GET रूट तक पहुंचा, लेकिन यह प्रमाण नहीं है कि प्रमाणित बॉट POST काम करेगा। पुराने संस्करण OneUptime का JSON 404 लौटा सकते हैं; प्रतिक्रिया की बॉडी और प्रॉक्सी लॉग जांचें। TLS त्रुटियां, टाइमआउट या प्रॉक्सी का HTML त्रुटि पेज प्रमाणपत्र या रूटिंग की समस्या बताते हैं।

Teams कनेक्ट करें, परीक्षण सूचना भेजें, बॉट को संदेश दें और कार्ड बटन दबाएं। OneUptime में कार्रवाई की पुष्टि करें और Microsoft डायग्नोस्टिक्स की तुलना गेटवे व एप्लिकेशन लॉग से करें। सूचना की डिलीवरी प्रमाणित इनबाउंड POST की पुष्टि नहीं करती।

डेवलपमेंट के लिए Microsoft की [Teams परीक्षण गाइड](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams) स्थानीय सेवा को टनल से उपलब्ध कराने का तरीका बताती है। OneUptime ingress पर फ़ॉरवर्ड करें और Microsoft के उदाहरण पथ `/api/messages` के बजाय `/api/microsoft-bot/messages` उपयोग करें। सार्वजनिक टनल URL बदलने पर Azure Bot एंडपॉइंट अपडेट करें, और प्रोडक्शन में स्थिर ingress उपयोग करें। OneUptime में संबंधित होस्टनाम भी सेट करें। परीक्षण के बाद टनल बंद करें; वह भी इनबाउंड एक्सेस देता है।

यदि सभी इनबाउंड कनेक्शन प्रतिबंधित हैं, तो पूरा Teams एकीकरण काम नहीं करेगा: कमांड, कार्ड कार्रवाइयां और बातचीत की खोज इन पर निर्भर हैं। पूरी तरह डिस्कनेक्ट इंस्टॉलेशन Teams इस्तेमाल नहीं कर सकता।

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
