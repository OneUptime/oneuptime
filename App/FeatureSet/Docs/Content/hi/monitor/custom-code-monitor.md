# Custom Code Monitor

Custom Code Monitor आपको अपने applications monitor करने के लिए custom scripts लिखने की अनुमति देता है। आप इस feature का उपयोग अपने applications को उस तरीके से monitor करने के लिए कर सकते हैं जो मौजूदा monitors के साथ संभव नहीं है। उदाहरण के लिए, आपके पास multi-step API requests हो सकती हैं। 

#### उदाहरण

निम्नलिखित उदाहरण दिखाता है कि Custom Code Monitor कैसे उपयोग करें:

```javascript
// आप axios module उपयोग कर सकते हैं।

await axios.get('https://api.example.com/');

// Axios Documentation यहाँ: https://axios-http.com/docs/intro

return {
    data: 'Hello World' // यहाँ कोई भी data return करें जो आप चाहते हैं। 
};
```


### Monitor Secrets का उपयोग

#### एक secret जोड़ना

secret जोड़ने के लिए, कृपया OneUptime Dashboard -> Project Settings -> Monitor Secrets -> Create Monitor Secret पर जाएं।

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

आप चुन सकते हैं कि कौन से monitors को secret तक पहुंच हो। इस मामले में हमने `ApiKey` secret जोड़ा और monitors को उस तक पहुंच देने के लिए चुना।

**कृपया ध्यान दें**: Secrets encrypted और सुरक्षित रूप से संग्रहीत होते हैं। यदि आप secret खो देते हैं, तो आपको एक नया secret बनाना होगा। Save होने के बाद आप secret देख या अपडेट नहीं कर सकते। 

#### एक secret का उपयोग

script में Monitor Secrets उपयोग करने के लिए, आप script के context में `monitorSecrets` object उपयोग कर सकते हैं। आप इसे उन secrets तक पहुंचने के लिए उपयोग कर सकते हैं जो आपने monitor में जोड़े हैं।

```javascript
// यदि आपका secret string type का है तो आपको इसे quotes में wrap करना होगा
let stringSecret = '{{monitorSecrets.StringSecret}}';

// यदि आपका secret number या boolean type का है तो आप इसे directly उपयोग कर सकते हैं
let numberSecret = {{monitorSecrets.NumberSecret}};

// यदि आपका secret boolean type का है तो आप इसे directly उपयोग कर सकते हैं
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// आप console log भी कर सकते हैं यह देखने के लिए कि secrets सही तरीके से fetch हो रहे हैं
console.log(stringSecret); 
```


### Custom Metrics

आप `oneuptime.captureMetric()` function का उपयोग करके अपने script से custom metrics capture कर सकते हैं। ये metrics OneUptime में संग्रहीत होती हैं और Metric Explorer का उपयोग करके dashboards पर chart की जा सकती हैं।

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (string, आवश्यक): metric name (जैसे `"api.response.time"`)। इसे automatically `custom.monitor.` prefix के साथ संग्रहीत किया जाएगा।
- `value` (number, आवश्यक): numeric metric value।
- `attributes` (object, वैकल्पिक): अतिरिक्त context के लिए Key-value pairs।

#### उदाहरण

```javascript
const response = await axios.get('https://api.example.com/health');

// एक simple metric capture करें
oneuptime.captureMetric('api.response.time', response.data.latency);

// attributes के साथ metric capture करें
oneuptime.captureMetric('api.queue.depth', response.data.queueDepth, {
    region: 'us-east-1',
    environment: 'production'
});

return {
    data: response.data
};
```

capture होने के बाद, ये metrics `custom.monitor.api.response.time` जैसे नामों से Metric Explorer में दिखाई देती हैं। आप उन्हें dashboard charts में जोड़ सकते हैं, alerts सेट अप कर सकते हैं और monitor, probe, या आपके द्वारा प्रदान की गई किसी भी custom attributes से filter कर सकते हैं।

**सीमाएं:**
- प्रति script execution अधिकतम 100 metrics।
- Metric names 200 characters तक सीमित।
- Values numeric होनी चाहिए।

### Script में उपलब्ध Modules
- `axios`: आप इस module का उपयोग HTTP requests करने के लिए कर सकते हैं। यह browser और Node.js के लिए एक promise-based HTTP client है।
- `crypto`: आप इस module का उपयोग cryptographic operations करने के लिए कर सकते हैं। यह एक built-in Node.js module है जो OpenSSL के hash, HMAC, cipher, decipher, sign और verify functions के wrappers का एक set प्रदान करता है।
- `console.log`: आप इस module का उपयोग console में data log करने के लिए कर सकते हैं। यह debugging के लिए उपयोगी है।
- `oneuptime.captureMetric`: आप इसका उपयोग अपने script से custom metrics capture करने के लिए कर सकते हैं। ऊपर Custom Metrics section देखें।
- `http`: आप इस module का उपयोग HTTP requests करने के लिए कर सकते हैं। यह एक built-in Node.js module है जो HTTP client और server प्रदान करता है।
- `https`: आप इस module का उपयोग HTTPS requests करने के लिए कर सकते हैं। यह एक built-in Node.js module है जो HTTPS client और server प्रदान करता है।

### ध्यान देने योग्य बातें

- आप `console.log` का उपयोग console में data log करने के लिए कर सकते हैं। यह monitor के logs section में उपलब्ध होगा (Probes > View Logs)।
- आप `return` statement का उपयोग करके script से data return कर सकते हैं। 
- यह एक JavaScript script है, इसलिए आप script में सभी JavaScript features उपयोग कर सकते हैं।
- Script का Timeout 2 minutes है। यदि script 2 minutes से अधिक लेती है, तो इसे terminate कर दिया जाएगा।
