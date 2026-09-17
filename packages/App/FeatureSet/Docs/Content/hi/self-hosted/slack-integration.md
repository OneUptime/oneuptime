# Slack इंटीग्रेशन

नोटिफिकेशन भेजने और इंसिडेंट कार्रवाइयों, कमांड तथा संदेश इवेंट का उपयोग करने के लिए अपने सेल्फ-होस्टेड OneUptime प्रोजेक्ट को Slack से जोड़ें।

## सेटअप

1. नीचे बताए अनुसार OneUptime होस्टनाम और HTTPS सेट करें। **Settings > Slack Integration** से बना हुआ ऐप मैनिफेस्ट कॉपी करें। यह `https://your-oneuptime-domain.com/api/slack/app-manifest` पर भी उपलब्ध है।
2. अपने डिप्लॉयमेंट के मैनिफेस्ट से वर्कस्पेस में [Slack ऐप बनाएँ](https://api.slack.com/apps), ताकि URL आपके होस्टनाम से मेल खाएँ।
3. ऐप के **Basic Information** से **Client ID**, **Client Secret** और **Signing Secret** को Docker Compose के `config.env` में कॉपी करें:

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Helm में ये मान सेट करें:

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. कॉन्फ़िगरेशन लागू करें और OneUptime के रीस्टार्ट का इंतज़ार करें। साइनिंग सीक्रेट सेट करने से पहले Events URL की जाँच विफल हुई हो तो अब दोबारा करें।
5. **Settings > Slack Integration** पर लौटें, **Connect to Slack** चुनें और ऐप को अनुमति दें। उपयोगकर्ता पहचान वाली कार्रवाइयों के लिए OneUptime में अपना निजी Slack अकाउंट भी जोड़ें।

## सेल्फ-होस्टेड डिप्लॉयमेंट के लिए नेटवर्क एक्सेस

### ट्रैफ़िक की दिशा और एंडपॉइंट

| ट्रैफ़िक | आवश्यक एक्सेस |
| --- | --- |
| OneUptime → Slack | DNS और TCP 443 पर आउटबाउंड HTTPS: Web API तथा OAuth टोकन एक्सचेंज के लिए `slack.com`; कमांड के जवाब और इस्तेमाल किए जाने वाले इनकमिंग वेबहुक नोटिफिकेशन के लिए `hooks.slack.com` |
| Slack → OneUptime | पूर्ण इंटीग्रेशन के लिए नीचे दिए चार POST रूट पर TCP 443 का सार्वजनिक HTTPS |
| उपयोगकर्ता का ब्राउज़र → OneUptime | डैशबोर्ड और OAuth रीडायरेक्ट `/api/slack/auth/:projectId/:userId` तथा `/api/slack/auth/:projectId/:userId/user`; ये उपयोगकर्ता के VPN से उपलब्ध रह सकते हैं |

ये आउटबाउंड डोमेन OneUptime इंटीग्रेशन के हैं, Slack क्लाइंट या सभी सुविधाओं की पूरी अनुमति सूची नहीं। Slack का *इनकमिंग वेबहुक* Slack पर होस्ट होता है और OneUptime उसे अनुरोध भेजता है; यह आपके सर्वर का इनबाउंड एंडपॉइंट नहीं है। [इनकमिंग वेबहुक गाइड](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/) देखें।

इन प्रोवाइडर कॉलबैक को ingress के माध्यम से OneUptime एप्लिकेशन तक फ़ॉरवर्ड करें:

| मेथड और पाथ | उद्देश्य |
| --- | --- |
| `POST /api/slack/events` | Events API सत्यापन, प्रतिक्रियाएँ, मेंशन और संदेश |
| `POST /api/slack/interactive` | बटन, शॉर्टकट, मोडल सबमिशन, `/incident` और `/maintenance` |
| `POST /api/slack/options-load` | इंटरैक्टिव मेन्यू के विकल्पों के अनुरोध |
| `POST /api/slack/command` | `/oneuptime` कमांड |

OAuth में [ब्राउज़र रीडायरेक्ट के बाद सर्वर पर टोकन एक्सचेंज](https://docs.slack.dev/authentication/installing-with-oauth/) होता है। मैनिफेस्ट `/api/slack/auth` को प्रीफ़िक्स के रूप में दर्ज करता है; अनुमति के दौरान OneUptime प्रोजेक्ट और उपयोगकर्ता पाथ जोड़ता है। केवल ब्राउज़र एक्सेस से Slack इवेंट या बटन की कार्रवाइयाँ नहीं भेज सकता।

### निजी डिप्लॉयमेंट और कॉलबैक सुरक्षा

सार्वजनिक DNS और ऐसा गेटवे उपयोग करें जिसमें सार्वजनिक रूप से विश्वसनीय HTTPS प्रमाणपत्र, पूरी प्रमाणपत्र श्रृंखला और OneUptime ingress तक निजी रूट हो। इनबाउंड TCP 443 की अनुमति दें और केवल ऊपर दिए प्रोवाइडर POST कॉलबैक प्रकाशित करें। निजी `ClusterIP`, आंतरिक DNS या कर्मचारी VPN अपने आप प्रोवाइडर को एक्सेस नहीं देते। स्प्लिट DNS से उसी होस्टनाम पर डैशबोर्ड और ब्राउज़र OAuth रूट निजी रखे जा सकते हैं।

`config.env` में `HOST=oneuptime.example.com` और `HTTP_PROTOCOL=https`, या Helm में `host: oneuptime.example.com` और `httpProtocol: https` सेट करें। बदलाव लागू करके रीस्टार्ट का इंतज़ार करें। ये मान URL बनाते हैं; DNS, TLS या फ़ायरवॉल नियम अपने आप नहीं बनाते। होस्टनाम बदलने पर Slack मैनिफेस्ट दोबारा बनाएँ और अपडेट करें।

मेथड, पाथ, क्वेरी स्ट्रिंग, मूल बॉडी, `Content-Type`, `X-Slack-Signature` और `X-Slack-Request-Timestamp` सुरक्षित रखें। विश्वसनीय प्रॉक्सी हेडर से सार्वजनिक होस्ट और HTTPS स्कीम बनाए रखें। कॉलबैक को ब्राउज़र SSO, CAPTCHA और प्रॉक्सी लॉगिन से छूट दें, लेकिन OneUptime की हस्ताक्षर और टाइमस्टैम्प जाँच जारी रखें। सर्वर घड़ी सिंक्रोनाइज़ करें। सोर्स IP की जाँच [Slack हस्ताक्षर सत्यापन](https://docs.slack.dev/authentication/verifying-requests-from-slack/) की जगह नहीं लेती।

### एक्सेस की जाँच और सीमाएँ

**Event Subscriptions** में Events Request URL सत्यापित करें: Slack [POST चैलेंज भेजता है और TLS जाँचता है](https://docs.slack.dev/apis/events-api/using-http-request-urls/)। फिर परीक्षण नोटिफिकेशन भेजें, स्लैश कमांड चलाएँ, इंसिडेंट बटन दबाएँ और सब्सक्राइब किया इवेंट उत्पन्न करें। गेटवे और OneUptime लॉग देखें, लेकिन सीक्रेट दर्ज न करें। Slack जल्दी पुष्टि चाहता है, जिसमें [इंटरैक्शन का तीन सेकंड में जवाब](https://docs.slack.dev/interactivity/handling-user-interaction/) शामिल है। ब्राउज़र GET या सफल आउटबाउंड संदेश POST कॉलबैक सत्यापित नहीं करता।

सभी इनबाउंड कनेक्शन बंद होने पर पहले से अधिकृत ऐप आउटबाउंड HTTPS से संदेश भेज सकता है, लेकिन इवेंट, बटन, शॉर्टकट और कमांड काम नहीं करते। OneUptime मैनिफेस्ट HTTP कॉलबैक उपयोग करता है और Socket Mode बंद रखता है; Slack Socket Mode चालू करना समर्थित विकल्प नहीं है। [निजी नेटवर्क एक्सेस सेटिंग](/docs/self-hosted/private-network-access) निजी गंतव्यों के आउटबाउंड अनुरोध नियंत्रित करती है, कॉलबैक प्रकाशित नहीं करती।
