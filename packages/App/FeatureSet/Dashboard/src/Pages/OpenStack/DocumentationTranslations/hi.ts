import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The OpenStack setup guide in Hindi (#8341): each piece of the English
 * guide's markdown (Pages/OpenStack/Utils/DocumentationMarkdown.ts) and its
 * Hindi. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Hindi words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "With `enable_prometheus` on in `/etc/kolla/globals.yml`, which Kolla-Ansible leaves off until you set it, it runs Prometheus, Alertmanager and an exporter for each thing under the cloud, and ships no alert rules. This guide reads what those run rather than starting a second copy.":
    "`/etc/kolla/globals.yml` में `enable_prometheus` चालू होने पर, जिसे Kolla-Ansible तब तक बंद रखता है जब तक आप इसे सेट न करें, यह Prometheus, Alertmanager और क्लाउड के नीचे हर घटक के लिए एक एक्सपोर्टर चलाता है, और कोई अलर्ट नियम साथ नहीं देता। यह गाइड दूसरी प्रति शुरू करने के बजाय वही पढ़ती है जो ये चलाते हैं।",
  "**How far this guide has been tested:** Its paths and ports were read from Kolla-Ansible's own source. Its commands were then run on a real all-in-one at stable/2026.1 with Open vSwitch, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, without Docker, on Kolla-Ansible's own exporter and on your own at the pinned version and at 1.7.0, the agent's exporter on the Infrastructure only credential, the targets read from its real prometheus.yml, and the logs profile. With Memcached really stopped there, its Alertmanager posted a firing webhook and then a resolved one, and what it posted, sent to a running OneUptime, opened one incident on the right cloud and on no other, and resolved it. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**यह गाइड कहाँ तक परखी गई है:** इसके पाथ और पोर्ट Kolla-Ansible के अपने सोर्स से पढ़े गए। फिर इसकी कमांड stable/2026.1 और Open vSwitch वाले एक असली all-in-one पर चलाई गईं, OneUptime की जगह एक ऐसे विकल्प के साथ जो एजेंट का भेजा सब कुछ रखता था: पूर्ण दृश्य क्रेडेंशियल पर एजेंट, Docker के बिना, Kolla-Ansible के अपने एक्सपोर्टर पर और पिन किए गए संस्करण व 1.7.0 पर आपके अपने एक्सपोर्टर पर, केवल इन्फ्रास्ट्रक्चर क्रेडेंशियल पर एजेंट का एक्सपोर्टर, उसकी असली prometheus.yml से पढ़े गए टारगेट, और लॉग प्रोफ़ाइल। वहाँ Memcached को सचमुच रोकने पर उसके Alertmanager ने पहले फ़ायर होने वाला और फिर हल होने वाला webhook भेजा, और जो उसने भेजा, उसे चालू OneUptime को भेजने पर सही क्लाउड पर, और किसी दूसरे पर नहीं, एक घटना खुली और हल हो गई। एजेंट और एक प्रोब, दोनों ने अलग-अलग एक असली DevStack को रुके हुए nova-compute से होकर और वापस, एक चालू OneUptime तक पूरा पहुँचाया है, लेकिन इस टूल से नहीं।",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent (or `bash install.sh --without-docker`, under Advanced)":
    "एजेंट चलाने वाली मशीन पर Docker Engine 20.10+ और Docker Compose v2 प्लगइन (या उन्नत में `bash install.sh --without-docker`)",
  "A machine outside the cloud it watches: an agent inside a failed cloud goes quiet with it":
    "जिस क्लाउड की निगरानी करनी है उसके बाहर की एक मशीन: विफल क्लाउड के अंदर का एजेंट उसी के साथ चुप हो जाता है",
  "That machine can reach Keystone and every service's API":
    "वह मशीन Keystone और हर सेवा के API तक पहुँच सकती है",
  "The `openstack` command line, as someone who can create the credential below":
    "`openstack` कमांड लाइन, ऐसे व्यक्ति के रूप में जो नीचे दिया क्रेडेंशियल बना सके",
  "An alert that fires becomes an incident, with on-call and status pages from the first hour, and it resolves when the alert does. There is nothing to install.":
    "फ़ायर होने वाला अलर्ट एक घटना बन जाता है, पहले घंटे से ऑन-कॉल और स्थिति पृष्ठों के साथ, और अलर्ट हल होने पर वह भी हल हो जाती है। इंस्टॉल करने के लिए कुछ नहीं है।",
  "1. In OneUptime, make an Incoming Request monitor as [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) says, and copy its **Heartbeat URL**. That is the `<secret key>` address below.":
    "1. OneUptime में, [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) में बताए अनुसार एक इनकमिंग अनुरोध मॉनिटर बनाएँ, और उसका **Heartbeat URL** कॉपी करें। यही नीचे `<secret key>` वाला पता है।",
  "2. Open the monitor's **Overview → Linked Resources** and add the OpenStack cloud `my-openstack-cloud`. Each incident is then on that cloud's **Incidents** page, so each cloud's Alertmanager needs a monitor of its own. The cloud shows up in that list once its first data arrives, so do this after the steps below, or add the cloud under **OpenStack → All Clouds** first.":
    "2. मॉनिटर का **अवलोकन → लिंक किए गए संसाधन** खोलें और OpenStack क्लाउड `my-openstack-cloud` जोड़ें। तब हर घटना उस क्लाउड के **घटनाएं** पृष्ठ पर होती है, इसलिए हर क्लाउड के Alertmanager को अपना अलग मॉनिटर चाहिए। क्लाउड उस सूची में तभी दिखता है जब उसका पहला डेटा आता है, इसलिए यह नीचे के चरणों के बाद करें, या पहले **OpenStack → सभी क्लाउड** में क्लाउड जोड़ें।",
  "Then, on the host you deploy from, write `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, which Kolla-Ansible reads in place of its own, and apply it:":
    "फिर, जिस होस्ट से आप तैनात करते हैं उस पर `/etc/kolla/config/prometheus/prometheus-alertmanager.yml` लिखें, जिसे Kolla-Ansible अपनी फ़ाइल की जगह पढ़ता है, और उसे लागू करें:",
  "- Log in as an admin with `source /etc/kolla/admin-openrc.sh`, which `kolla-ansible post-deploy` writes.":
    "- `source /etc/kolla/admin-openrc.sh` से एडमिन के रूप में लॉग इन करें, जिसे `kolla-ansible post-deploy` लिखता है।",
  "- **Full view** needs one change, to Cinder. Kolla-Ansible's templates already set `service_type` under `[keystone_authtoken]` on Nova, Neutron, Glance and Placement, but its Cinder says `volume` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Add `service_type = block-storage` under `[keystone_authtoken]` in `/etc/kolla/config/cinder.conf`, then run `kolla-ansible reconfigure -i <inventory> --tags cinder`.":
    "- **पूर्ण दृश्य** को Cinder में एक बदलाव चाहिए। Kolla-Ansible के टेम्पलेट Nova, Neutron, Glance और Placement पर `[keystone_authtoken]` के नीचे `service_type` पहले से सेट करते हैं, लेकिन उसका Cinder `volume` कहता है और उसका कैटलॉग `block-storage` कहता है, और जब तक दोनों मेल न खाएँ, keystonemiddleware एक्सेस नियमों से सीमित क्रेडेंशियल को `401` से अस्वीकार करता है। `/etc/kolla/config/cinder.conf` में `[keystone_authtoken]` के नीचे `service_type = block-storage` जोड़ें, फिर `kolla-ansible reconfigure -i <inventory> --tags cinder` चलाएँ।",
  "- **Infrastructure only** takes its overrides at `/etc/kolla/config/nova/policy.yaml`, and the same for `neutron`, `keystone` and `placement`, merged with anything already there. Apply them with `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.":
    "- **केवल इन्फ्रास्ट्रक्चर** अपने ओवरराइड `/etc/kolla/config/nova/policy.yaml` पर लेता है, और `neutron`, `keystone` और `placement` के लिए भी यही, वहाँ पहले से मौजूद चीज़ों के साथ मिलाकर। उन्हें `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement` से लागू करें।",
  "**Recommended.** The agent sees everything it reads: services, hypervisors, every project's instances, volumes, networks and routers, and `cinder-volume` and `cinder-scheduler` state and storage pools, which only this level sees. It leaves out Keystone's users and groups, on purpose.":
    "**सुझाया गया।** एजेंट वह सब देखता है जो वह पढ़ता है: सेवाएँ, हाइपरवाइज़र, हर प्रोजेक्ट के इंस्टेंस, वॉल्यूम, नेटवर्क और राउटर, और `cinder-volume` व `cinder-scheduler` की स्थिति और स्टोरेज पूल, जिन्हें केवल यही स्तर देखता है। यह Keystone के उपयोगकर्ताओं और समूहों को जान-बूझकर छोड़ देता है।",
  "This is an application credential on an account with `admin` on a project of its own, limited by access rules to the exact `GET` calls the agent makes, so it cannot write: on every release we record, every read answered `200` and every write `401`. As an admin, make the project and the account:":
    "यह अपने अलग प्रोजेक्ट पर `admin` वाले खाते का एक एप्लिकेशन क्रेडेंशियल है, जिसे एक्सेस नियम ठीक उन्हीं `GET` कॉल तक सीमित रखते हैं जो एजेंट करता है, इसलिए यह लिख नहीं सकता: हमारे दर्ज किए हर रिलीज़ पर हर पढ़ने का जवाब `200` और हर लिखने का `401` रहा। एडमिन के रूप में प्रोजेक्ट और खाता बनाएँ:",
  "Then, logged in as that account on that project, make the credential. An access rule is matched against the path the service sees, and a service behind a path prefix refuses the shipped rules with a `401`, so these commands fit them to this cloud from its catalog first:":
    "फिर, उस प्रोजेक्ट पर उस खाते से लॉग इन रहते हुए, क्रेडेंशियल बनाएँ। एक्सेस नियम का मिलान उस पाथ से होता है जो सेवा देखती है, और पाथ प्रीफ़िक्स के पीछे की सेवा साथ आए नियमों को `401` से अस्वीकार करती है, इसलिए ये कमांड पहले उसके कैटलॉग से नियमों को इस क्लाउड के अनुसार ढालती हैं:",
  "- Copy the `id` and the `secret` it prints: the secret is shown only once.":
    "- यह जो `id` और `secret` प्रिंट करता है उन्हें कॉपी करें: secret केवल एक बार दिखाया जाता है।",
  "- Never add `--unrestricted`, which would let it make more credentials.":
    "- `--unrestricted` कभी न जोड़ें, वरना यह क्रेडेंशियल और क्रेडेंशियल बना सकेगा।",
  "- Access rules work only where each service sets `service_type` in its `[keystone_authtoken]` section and has been restarted since: `compute`, `network`, `block-storage` (the rules also carry `volume` and `volumev3`, for a Cinder configured that way), `image` and `placement`. Keystone needs nothing. Without that, the services refuse the credential with a `401`.":
    "- एक्सेस नियम वहीं काम करते हैं जहाँ हर सेवा अपने `[keystone_authtoken]` सेक्शन में `service_type` सेट करती है और तब से रीस्टार्ट हुई है: `compute`, `network`, `block-storage` (ऐसे कॉन्फ़िगर किए गए Cinder के लिए नियमों में `volume` और `volumev3` भी हैं), `image` और `placement`। Keystone को कुछ नहीं चाहिए। इसके बिना सेवाएँ क्रेडेंशियल को `401` से अस्वीकार करती हैं।",
  "- If you won't change that, leave out `--access-rules`. That makes a plain admin application credential, which can write as well as read, so keep it as safe as an admin password.":
    "- अगर आप इसे नहीं बदलेंगे, तो `--access-rules` छोड़ दें। इससे एक सामान्य एडमिन एप्लिकेशन क्रेडेंशियल बनता है, जो पढ़ने के साथ लिख भी सकता है, इसलिए इसे एडमिन पासवर्ड जितना सुरक्षित रखें।",
  "- It stops working when it expires. To replace it, make the second credential before you delete the first.":
    "- समय सीमा खत्म होने पर यह काम करना बंद कर देता है। इसे बदलने के लिए पहला हटाने से पहले दूसरा क्रेडेंशियल बनाएँ।",
  "No admin. The agent sees all of Keystone's projects, domains, services and endpoints, all of Nova including every project's instances, all of Placement, and Neutron's agents and address pools. Volumes, snapshots, networks, subnets, routers, floating IPs and ports appear only for the projects the role is assigned on, so on a project that holds nothing just the shared and external ones, and OneUptime can't see the others.":
    "कोई एडमिन नहीं। एजेंट Keystone के सभी प्रोजेक्ट, डोमेन, सेवाएँ और एंडपॉइंट, हर प्रोजेक्ट के इंस्टेंस सहित पूरा Nova, पूरा Placement, और Neutron के एजेंट और पता पूल देखता है। वॉल्यूम, स्नैपशॉट, नेटवर्क, सबनेट, राउटर, फ़्लोटिंग IP और पोर्ट केवल उन्हीं प्रोजेक्ट के लिए दिखते हैं जिन पर भूमिका दी गई है, इसलिए खाली प्रोजेक्ट पर सिर्फ़ साझा और बाहरी वाले, और बाकी OneUptime नहीं देख सकता।",
  "It does not see `cinder-volume` or `cinder-scheduler` state or storage pools: Cinder's own code asks for an admin there, after policy has already passed, so no override opens them, and only **Full view** sees them.":
    "यह `cinder-volume` या `cinder-scheduler` की स्थिति या स्टोरेज पूल नहीं देखता: नीति के पास करने के बाद भी Cinder का अपना कोड वहाँ एडमिन माँगता है, इसलिए कोई ओवरराइड उन्हें नहीं खोलता, और उन्हें केवल **पूर्ण दृश्य** देखता है।",
  "This is a role of its own, `oneuptime_monitoring`, with the policy overrides the agent ships, on a project of its own that holds nothing and has zero quota. Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes. With nothing to touch and no quota to make anything with, there is nothing for it to write: on every release we record, every write answered `403`, or `409` and `413` from quota. As an admin, make the role, the project and an account:":
    "यह अपनी अलग भूमिका `oneuptime_monitoring` है, एजेंट के साथ आने वाले नीति ओवरराइड के साथ, अपने ऐसे प्रोजेक्ट पर जिसमें कुछ नहीं है और कोटा शून्य है। जहाँ Cinder में `enforce_new_defaults` बंद है, जो Cinder का अपना डिफ़ॉल्ट है, वहाँ किसी प्रोजेक्ट पर कोई भी भूमिका उस प्रोजेक्ट के वॉल्यूम बना सकती है। छूने को कुछ नहीं और कुछ बनाने के लिए कोटा नहीं, इसलिए इसके पास लिखने को कुछ नहीं: हमारे दर्ज किए हर रिलीज़ पर हर लिखने का जवाब `403` रहा, या कोटा से `409` और `413`। एडमिन के रूप में भूमिका, प्रोजेक्ट और एक खाता बनाएँ:",
  "Download the overrides, and merge each, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config. That is `/etc/nova/policy.yaml` and so on, unless your deployment says otherwise. Each override keeps the service's default and adds the role. oslo.policy notices a changed file on its own, so nothing restarts:":
    "ओवरराइड डाउनलोड करें, और हर कंट्रोलर पर हर एक को उस फ़ाइल में मिलाएँ जिसका नाम उस सेवा के कॉन्फ़िग में `[oslo_policy] policy_file` देता है। जब तक आपकी तैनाती कुछ और न कहे, वह `/etc/nova/policy.yaml` वगैरह है। हर ओवरराइड सेवा का डिफ़ॉल्ट रखता है और भूमिका जोड़ता है। oslo.policy बदली हुई फ़ाइल को खुद पहचान लेता है, इसलिए कुछ भी रीस्टार्ट नहीं होता:",
  "**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.":
    "**ओवरराइड फिर से हटाने के लिए फ़ाइल को खाली करें (`{}`) और उसे कभी न हटाएँ।** Flamingo (2025.2) और Epoxy (2025.1) पर, एक बार पढ़ी गई नीति फ़ाइल के गायब होते ही oslo.policy हर जाँच पर त्रुटि देता है, इसलिए वह सेवा हर अनुरोध में विफल होती है। जब वह सेवा Keystone हो, तो वह टोकन सत्यापित करना बंद कर देती है और पूरा क्लाउड `503` लौटाता है। अगर ऐसा हो चुका है, तो सेवा रीस्टार्ट करें।",
  "Then, logged in as that account on that project, make the credential and copy the `id` and the `secret` it prints:":
    "फिर, उस प्रोजेक्ट पर उस खाते से लॉग इन रहते हुए, क्रेडेंशियल बनाएँ और यह जो `id` और `secret` प्रिंट करता है उन्हें कॉपी करें:",
  "Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. `troubleshoot.sh` warns when the credential's project holds things.":
    "किसी असली प्रोजेक्ट के वॉल्यूम और राउटर देखने के लिए उस पर भूमिका देने से खाता वहाँ लिख भी सकता है, ऐसे क्लाउड पर जहाँ Cinder में `enforce_new_defaults` बंद है। जब क्रेडेंशियल के प्रोजेक्ट में कुछ होता है, तो `troubleshoot.sh` चेतावनी देता है।",
  "For a team watching its own part of a cloud someone else runs. The agent sees one project's volumes, networks and routers, and no infrastructure: no hypervisors, services or storage pools.":
    "उस टीम के लिए जो किसी और के चलाए क्लाउड के अपने हिस्से की निगरानी करती है। एजेंट एक प्रोजेक्ट के वॉल्यूम, नेटवर्क और राउटर देखता है, और कोई इन्फ्रास्ट्रक्चर नहीं: न हाइपरवाइज़र, न सेवाएँ, न स्टोरेज पूल।",
  "Through the agent it shows no instances at all: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.":
    "एजेंट के ज़रिए यह स्तर कोई भी इंस्टेंस नहीं दिखाता: एक्सपोर्टर Nova से सभी प्रोजेक्ट के सर्वर माँगता है, Nova एक सामान्य रीडर को अस्वीकार करता है, और वह पूरा पढ़ना विफल हो जाता है। केवल एक OneUptime प्रोब, जो इस एजेंट के बिना एकत्र करता है, एक प्रोजेक्ट के इंस्टेंस सूचीबद्ध कर सकता है।",
  "This is the plain `reader` role. Give an account the role on the project:":
    "यह सामान्य `reader` भूमिका है। किसी खाते को प्रोजेक्ट पर यह भूमिका दें:",
  "Neutron and Cinder answer a reader with its own project and no error, so these lists look complete, and hold only that project.":
    "Neutron और Cinder एक रीडर को उसके अपने प्रोजेक्ट के साथ और बिना त्रुटि के जवाब देते हैं, इसलिए ये सूचियाँ पूरी दिखती हैं, और उनमें केवल वही प्रोजेक्ट होता है।",
  "It may be able to write. On a cloud where Cinder has `enforce_new_defaults` off, which is Cinder's own default, plain `reader` can create volumes in its project too. On Epoxy, Flamingo and Gazpacho it did, and on Hibiscus it was refused, because DevStack only turns `enforce_new_defaults` on there.":
    "यह लिख भी सकता है। ऐसे क्लाउड पर जहाँ Cinder में `enforce_new_defaults` बंद है, जो Cinder का अपना डिफ़ॉल्ट है, सामान्य `reader` भी अपने प्रोजेक्ट में वॉल्यूम बना सकता है। Epoxy, Flamingo और Gazpacho पर ऐसा हुआ, और Hibiscus पर इसे अस्वीकार किया गया, क्योंकि DevStack केवल वहीं `enforce_new_defaults` चालू करता है।",
  "No credential and nothing new to run: the agent reads the exporter Kolla-Ansible already runs, through its internal VIP on `9198`. Skip the install's credential questions by giving it the address:":
    "न क्रेडेंशियल, न चलाने को कुछ नया: एजेंट उस एक्सपोर्टर को पढ़ता है जिसे Kolla-Ansible पहले से चलाता है, `9198` पर उसके आंतरिक VIP के ज़रिए। इंस्टॉल को पता देकर उसके क्रेडेंशियल वाले सवाल छोड़ें:",
  "Kolla-Ansible pins exporter 1.7.0 and runs it without `--multi-cloud`, so it has no `/probe`: the agent asks it for everything at once, every 2 minutes, on top of Kolla-Ansible's own Prometheus asking every minute. Its answer also says less. On five real clouds, the pages went without:":
    "Kolla-Ansible एक्सपोर्टर 1.7.0 पिन करता है और उसे `--multi-cloud` के बिना चलाता है, इसलिए उसमें `/probe` नहीं है: एजेंट उससे हर 2 मिनट में सब कुछ एक साथ माँगता है, Kolla-Ansible के अपने Prometheus के हर मिनट पूछने के ऊपर से। उसके जवाब में जानकारी भी कम होती है। पाँच असली क्लाउड पर पृष्ठों में ये चीज़ें नहीं थीं:",
  "| Goes without | Because | What it costs |":
    "| किसके बिना | क्योंकि | इसकी कीमत |",
  "| Everything of Cinder's | It asks the catalog for `volumev3`, and finds no such thing where Cinder registers as `block-storage` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, `cinder-volume` or `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |":
    "| Cinder का सब कुछ | यह कैटलॉग से `volumev3` माँगता है, और जहाँ Cinder `block-storage` के रूप में दर्ज होता है वहाँ ऐसा कुछ नहीं मिलता | **वॉल्यूम** और **स्टोरेज पूल** खाली रहते हैं, और **सेवाएं** में कोई Block Storage API, `cinder-volume` या `cinder-scheduler` नहीं होता। **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** और **Volume Stuck** चुप रहते हैं |",
  "| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |":
    "| एक हाइपरवाइज़र में कितने इंस्टेंस हैं, और उसके एग्रीगेट | Nova की हाइपरवाइज़र सूची सबसे नए माइक्रोवर्ज़न पर विफल होती है, जिसे Kolla-Ansible माँगता है | **हाइपरवाइज़र** पर ये दोनों, और खोया हुआ होस्ट अपने साथ क्या ले जाने की बात कहता है। उसके vCPU, मेमोरी और डिस्क अब भी दिखते हैं: वे Placement से आते हैं |",
  "| Domains | It has no such series | **Domains** stays empty |":
    "| डोमेन | इसमें ऐसी कोई सीरीज़ नहीं है | **डोमेन** खाली रहता है |",
  "| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to `active` goes unnoticed |":
    "| किसी इमेज की स्थिति, दृश्यता और बनने की तारीख | इसमें ऐसे कोई लेबल नहीं हैं | **इमेज** पर वे कॉलम। **Image Stuck** चुप रहता है, इसलिए `active` की ओर जाते हुए अटकी इमेज पर ध्यान नहीं जाता |",
  "| A network's MTU | It has no such label | That line on a network's page |":
    "| किसी नेटवर्क का MTU | इसमें ऐसा कोई लेबल नहीं है | किसी नेटवर्क के पृष्ठ पर वह पंक्ति |",
  "If you need those, use one of the other tabs and the agent's own exporter. You can change your mind later: a cloud keeps its name whichever reads it.":
    "अगर आपको ये चाहिए, तो दूसरे टैब में से एक और एजेंट का अपना एक्सपोर्टर इस्तेमाल करें। आप बाद में अपना मन बदल सकते हैं: क्लाउड को जो भी पढ़े, उसका नाम वही रहता है।",
  "The script asks for:": "स्क्रिप्ट ये पूछती है:",
  "- **OneUptime URL and ingestion key**, both shown in step 1. Pick a key there to have them filled in here.":
    "- **OneUptime URL और इंजेशन कुंजी**, दोनों चरण 1 में दिखते हैं। उन्हें यहाँ भरवाने के लिए वहाँ एक कुंजी चुनें।",
  "- **Cloud name**: how the cloud appears in OneUptime. Keep it stable: a new name registers a new cloud.":
    "- **क्लाउड का नाम**: OneUptime में क्लाउड कैसे दिखता है। इसे स्थिर रखें: नया नाम एक नया क्लाउड दर्ज करता है।",
  "- **Keystone auth URL**, such as `https://keystone.example.com:5000/v3`.":
    "- **Keystone auth URL**, जैसे `https://keystone.example.com:5000/v3`।",
  "- **Region names**, comma-separated (`RegionOne` if you have one).":
    "- **क्षेत्रों के नाम**, कॉमा से अलग (एक हो तो `RegionOne`)।",
  "- **Application credential**: the ID and secret from the previous step. Neither is echoed to the screen, and neither goes on a command line.":
    "- **एप्लिकेशन क्रेडेंशियल**: पिछले चरण की ID और secret। दोनों में से कोई भी स्क्रीन पर नहीं दिखता, और कोई भी कमांड लाइन पर नहीं जाता।",
  "- **Private CA file**, only if the cloud's certificate comes from its own certificate authority.":
    "- **निजी CA फ़ाइल**, केवल तब जब क्लाउड का प्रमाणपत्र उसके अपने प्रमाणपत्र प्राधिकरण से आता हो।",
  "It checks the credential with Keystone before it installs anything, installs to `/opt/oneuptime-openstack-agent` (or to `oneuptime-openstack-agent` in your home folder if you have no rights on `/opt`, and it says which), writes a `.env` file and a `clouds.yaml` only their owner can read, and starts everything with Docker Compose. Running it again reuses all of that instead of asking again, so it is also how you upgrade.":
    "यह कुछ भी इंस्टॉल करने से पहले Keystone से क्रेडेंशियल जाँचती है, `/opt/oneuptime-openstack-agent` में इंस्टॉल करती है (या अगर `/opt` पर आपके अधिकार नहीं हैं तो आपके होम फ़ोल्डर में `oneuptime-openstack-agent` में, और बताती है कि कहाँ), एक `.env` फ़ाइल और एक `clouds.yaml` लिखती है जिन्हें केवल उनका मालिक पढ़ सकता है, और Docker Compose से सब कुछ शुरू करती है। इसे फिर से चलाने पर यह दोबारा पूछने के बजाय यह सब दोबारा इस्तेमाल करती है, इसलिए अपग्रेड भी ऐसे ही होता है।",
  "`docker compose ps` lists the collector (`oneuptime-openstack-agent`), the bundled exporter (`oneuptime-openstack-exporter`) and the OneUptime AI agent (`oneuptime-openstack-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cloud then appears in the **OpenStack** section by itself. Give it about five minutes to fill in: compute, network, volume and Placement are read every 2 minutes, identity and images every 5.":
    "`docker compose ps` कलेक्टर (`oneuptime-openstack-agent`), साथ आए एक्सपोर्टर (`oneuptime-openstack-exporter`) और OneUptime AI एजेंट (`oneuptime-openstack-ai-agent`) को सूचीबद्ध करता है। कलेक्टर के लॉग में `Everything is ready. Begin running and processing data.` खोजें। फिर क्लाउड अपने आप **OpenStack** सेक्शन में दिखता है। इसे भरने के लिए लगभग पाँच मिनट दें: compute, नेटवर्क, वॉल्यूम और Placement हर 2 मिनट में पढ़े जाते हैं, identity और इमेज हर 5 में।",
  "On the host that runs Kolla-Ansible's Prometheus, this reads its targets from the file Kolla-Ansible rendered, and prints them as settings for the agent:":
    "जिस होस्ट पर Kolla-Ansible का Prometheus चलता है, उस पर यह Kolla-Ansible की बनाई फ़ाइल से उसके टारगेट पढ़ता है, और उन्हें एजेंट के लिए सेटिंग के रूप में प्रिंट करता है:",
  "Add what it prints to the agent's `.env`, then run `docker compose up -d` in the agent's folder. Each exporter listens on the API network, so the agent's machine needs a route there. The cloud's **Control Plane** card then says how each one is, and says plainly which ones are not watched.":
    "यह जो प्रिंट करे उसे एजेंट की `.env` में जोड़ें, फिर एजेंट के फ़ोल्डर में `docker compose up -d` चलाएँ। हर एक्सपोर्टर API नेटवर्क पर सुनता है, इसलिए एजेंट की मशीन को वहाँ तक रूट चाहिए। तब क्लाउड का **कंट्रोल प्लेन** कार्ड बताता है कि हर एक कैसा है, और साफ़ बताता है कि किनकी निगरानी नहीं हो रही।",
  "| Reads | Port | Setting |": "| क्या पढ़ता है | पोर्ट | सेटिंग |",
  "| RabbitMQ's Prometheus plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |":
    "| RabbitMQ का Prometheus प्लगइन | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |",
  "| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |":
    "| mysqld_exporter, MariaDB के लिए | `9104` | `OPENSTACK_MARIADB_TARGETS` |",
  "| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |":
    "| memcached_exporter, Memcached के लिए | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |",
  "| HAProxy's own exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |":
    "| HAProxy का अपना एक्सपोर्टर | `9101` | `OPENSTACK_HAPROXY_TARGETS` |",
  "| openstack-network-exporter, for OVN and Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |":
    "| openstack-network-exporter, OVN और Open vSwitch के लिए | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |",
  "| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |":
    "| prometheus-libvirt-exporter, libvirt के लिए | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |",
  "- **OVN's databases:** Kolla-Ansible runs openstack-network-exporter from 2026.1, on compute and network nodes only, and an OVN database is read from the host it runs on. If your control nodes are neither, add them under `[prometheus-openstack-network-exporter:children]` in your inventory and reconfigure, or the Northbound and Southbound databases read as not watched.":
    "- **OVN के डेटाबेस:** Kolla-Ansible 2026.1 से openstack-network-exporter केवल कंप्यूट और नेटवर्क नोड पर चलाता है, और OVN डेटाबेस उसी होस्ट से पढ़ा जाता है जिस पर वह चलता है। अगर आपके कंट्रोल नोड इनमें से कोई नहीं हैं, तो उन्हें अपनी इन्वेंटरी में `[prometheus-openstack-network-exporter:children]` के नीचे जोड़ें और फिर से कॉन्फ़िगर करें, वरना Northbound और Southbound डेटाबेस निगरानी में नहीं के रूप में दिखते हैं।",
  "- **Before 2026.1** there is no network exporter, so OVN and Open vSwitch read as not watched.":
    "- **2026.1 से पहले** कोई नेटवर्क एक्सपोर्टर नहीं है, इसलिए OVN और Open vSwitch निगरानी में नहीं के रूप में दिखते हैं।",
  "The agent's logs profile runs on each node, and reads Kolla-Ansible's files. It is what joins a line to the cloud's pages:":
    "एजेंट की लॉग प्रोफ़ाइल हर नोड पर चलती है, और Kolla-Ansible की फ़ाइलें पढ़ती है। यही किसी पंक्ति को क्लाउड के पृष्ठों से जोड़ती है:",
  "Kolla's own Fluentd can forward too, with an output in `/etc/kolla/config/fluentd/output/*.conf` as [Fluentd](/docs/telemetry/fluentd) describes, but those records reach **Logs** under a service's name, and not the cloud's pages.":
    "Kolla का अपना Fluentd भी आगे भेज सकता है, `/etc/kolla/config/fluentd/output/*.conf` में एक आउटपुट के साथ, जैसा [Fluentd](/docs/telemetry/fluentd) बताता है, लेकिन वे रिकॉर्ड किसी सेवा के नाम से **लॉग** तक पहुँचते हैं, क्लाउड के पृष्ठों तक नहीं।",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from `/var/log/kolla`.":
    "दोनों सेवा के अपने लॉग में लिखते हैं, बस पर कोई उपभोक्ता नहीं होता। **सुरक्षा इवेंट → कनेक्शन** में **अपने लॉग में सुरक्षा इवेंट खोजें** चालू होते ही OneUptime उन्हें वहीं से पढ़ता है। एजेंट की लॉग प्रोफ़ाइल दोनों को `/var/log/kolla` से पढ़ती है।",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.":
    "यह हर लॉगिन के लिए एक पंक्ति भेजता है, जिसे **OpenStack admin credential used from a new address** पढ़ता है। केवल असफल लॉगिन भेजने के लिए `notification_opt_out` में `identity.authenticate.success` जोड़ें; तब वह पहचान वही पढ़ती है जो ऑडिट फ़िल्टर ने देखा।",
  "For who did what through Nova, Neutron, Cinder and Glance, the audit filter needs a setting, which goes in every service's config at once:":
    "Nova, Neutron, Cinder और Glance के ज़रिए किसने क्या किया, यह जानने के लिए ऑडिट फ़िल्टर को एक सेटिंग चाहिए, जो एक साथ हर सेवा के कॉन्फ़िग में जाती है:",
  "It also needs a paste file, and Kolla-Ansible's config tasks copy no paste file for these services. Put yours on each API host, and mount it over the one in the image with `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` and `glance_api_extra_volumes` in `globals.yml`. pyCADF's map files are in `/var/lib/kolla/venv/etc/pycadf` in the image. [Who did what](/docs/telemetry/openstack#who-did-what) has the filter's lines.":
    "इसे एक paste फ़ाइल भी चाहिए, और Kolla-Ansible के कॉन्फ़िग कार्य इन सेवाओं के लिए कोई paste फ़ाइल कॉपी नहीं करते। अपनी फ़ाइल हर API होस्ट पर रखें, और उसे `globals.yml` में `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` और `glance_api_extra_volumes` से इमेज में मौजूद फ़ाइल के ऊपर माउंट करें। pyCADF की मैप फ़ाइलें इमेज में `/var/lib/kolla/venv/etc/pycadf` में हैं। फ़िल्टर की पंक्तियाँ [किसने क्या किया](/docs/telemetry/openstack#who-did-what) में हैं।",
  "OpenStack's `reader` role is scoped to a project everywhere except Keystone and Ironic, and hypervisors, services, agents, pools and Placement default to admin. A policy override can't open all-project lists in Cinder or Neutron, because they scope those lists in code, and Cinder's own code keeps its services and storage pools for an admin. So what a credential can read depends on which level you choose. This is what five real clouds answered, on Epoxy, Flamingo, Gazpacho (OVN and OVS) and Hibiscus:":
    "OpenStack की `reader` भूमिका Keystone और Ironic को छोड़कर हर जगह एक प्रोजेक्ट तक सीमित है, और हाइपरवाइज़र, सेवाएँ, एजेंट, पूल और Placement डिफ़ॉल्ट रूप से एडमिन के लिए हैं। नीति ओवरराइड Cinder या Neutron में सभी प्रोजेक्ट की सूचियाँ नहीं खोल सकता, क्योंकि वे इन सूचियों को कोड में सीमित करते हैं, और Cinder का अपना कोड अपनी सेवाएँ और स्टोरेज पूल एडमिन के लिए रखता है। इसलिए क्रेडेंशियल क्या पढ़ सकता है, यह इस पर निर्भर करता है कि आप कौन-सा स्तर चुनते हैं। Epoxy, Flamingo, Gazpacho (OVN और OVS) और Hibiscus पर पाँच असली क्लाउड ने यह जवाब दिया:",
  "| Read | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |":
    "| पढ़ना | स्तर 1: पूर्ण दृश्य | स्तर 2: केवल इन्फ्रास्ट्रक्चर | स्तर 3: प्रोजेक्ट दृश्य |",
  "| Keystone: projects | all | all | refused |":
    "| Keystone: प्रोजेक्ट | सब | सब | अस्वीकृत |",
  "| Keystone: domains | all | all | refused |":
    "| Keystone: डोमेन | सब | सब | अस्वीकृत |",
  "| Keystone: regions | all | what anyone sees | what anyone sees |":
    "| Keystone: क्षेत्र | सब | जो सभी देखते हैं | जो सभी देखते हैं |",
  "| Keystone: services | all | all | refused |":
    "| Keystone: सेवाएँ | सब | सब | अस्वीकृत |",
  "| Keystone: endpoints | all | all | refused |":
    "| Keystone: एंडपॉइंट | सब | सब | अस्वीकृत |",
  "| Nova: servers, all projects | all | all | refused |":
    "| Nova: सर्वर, सभी प्रोजेक्ट | सब | सब | अस्वीकृत |",
  "| Nova: services | all | all | refused |":
    "| Nova: सेवाएँ | सब | सब | अस्वीकृत |",
  "| Nova: hypervisors | all | all | refused |":
    "| Nova: हाइपरवाइज़र | सब | सब | अस्वीकृत |",
  "| Nova: aggregates | all | all | refused |":
    "| Nova: एग्रीगेट | सब | सब | अस्वीकृत |",
  "| Nova: availability zones, detail | all | all | refused |":
    "| Nova: उपलब्धता क्षेत्र, विवरण | सब | सब | अस्वीकृत |",
  "| Nova: flavors | all | what anyone sees | what anyone sees |":
    "| Nova: फ़्लेवर | सब | जो सभी देखते हैं | जो सभी देखते हैं |",
  "| Nova: usage per project | all | all | refused |":
    "| Nova: प्रति प्रोजेक्ट उपयोग | सब | सब | अस्वीकृत |",
  "| Placement: resource providers | all | all | refused |":
    "| Placement: संसाधन प्रदाता | सब | सब | अस्वीकृत |",
  "| Neutron: agents | all | all | nothing |":
    "| Neutron: एजेंट | सब | सब | कुछ नहीं |",
  "| Neutron: networks | all | own project only | own project only |":
    "| Neutron: नेटवर्क | सब | केवल अपना प्रोजेक्ट | केवल अपना प्रोजेक्ट |",
  "| Neutron: subnets | all | own project only | own project only |":
    "| Neutron: सबनेट | सब | केवल अपना प्रोजेक्ट | केवल अपना प्रोजेक्ट |",
  "| Neutron: routers | all | own project only | own project only |":
    "| Neutron: राउटर | सब | केवल अपना प्रोजेक्ट | केवल अपना प्रोजेक्ट |",
  "| Neutron: floating IPs | all | own project only | own project only |":
    "| Neutron: फ़्लोटिंग IP | सब | केवल अपना प्रोजेक्ट | केवल अपना प्रोजेक्ट |",
  "| Neutron: IP availabilities | all | all | nothing |":
    "| Neutron: IP उपलब्धता | सब | सब | कुछ नहीं |",
  "| Neutron: security groups | all | 409, expected | own project only |":
    "| Neutron: सुरक्षा समूह | सब | 409, अपेक्षित | केवल अपना प्रोजेक्ट |",
  "| Neutron: ports | all | own project only | own project only |":
    "| Neutron: पोर्ट | सब | केवल अपना प्रोजेक्ट | केवल अपना प्रोजेक्ट |",
  "| Neutron: quotas | all | refused | refused |":
    "| Neutron: कोटा | सब | अस्वीकृत | अस्वीकृत |",
  "| Cinder: volumes, all projects | all | own project only | own project only |":
    "| Cinder: वॉल्यूम, सभी प्रोजेक्ट | सब | केवल अपना प्रोजेक्ट | केवल अपना प्रोजेक्ट |",
  "| Cinder: services | all | refused | refused |":
    "| Cinder: सेवाएँ | सब | अस्वीकृत | अस्वीकृत |",
  "| Cinder: pools | all | refused | refused |":
    "| Cinder: पूल | सब | अस्वीकृत | अस्वीकृत |",
  "| Cinder: snapshots, all projects | all | own project only | own project only |":
    "| Cinder: स्नैपशॉट, सभी प्रोजेक्ट | सब | केवल अपना प्रोजेक्ट | केवल अपना प्रोजेक्ट |",
  "| Cinder: backups, all projects | all | none recorded | none recorded |":
    "| Cinder: बैकअप, सभी प्रोजेक्ट | सब | कुछ दर्ज नहीं | कुछ दर्ज नहीं |",
  "| Cinder: volume types | all | what anyone sees | what anyone sees |":
    "| Cinder: वॉल्यूम प्रकार | सब | जो सभी देखते हैं | जो सभी देखते हैं |",
  "| Glance: images | all | what anyone sees | what anyone sees |":
    "| Glance: इमेज | सब | जो सभी देखते हैं | जो सभी देखते हैं |",
  "- **all**: the same rows an admin saw.":
    "- **सब**: वही पंक्तियाँ जो एक एडमिन ने देखीं।",
  "- **own project only**: that project's rows, and anything shared or external. On a project that holds nothing, that is just the shared and external ones.":
    "- **केवल अपना प्रोजेक्ट**: उस प्रोजेक्ट की पंक्तियाँ, और जो कुछ भी साझा या बाहरी है। खाली प्रोजेक्ट पर ये केवल साझा और बाहरी वाले हैं।",
  "- **refused**: a `401` or a `403`.": "- **अस्वीकृत**: एक `401` या एक `403`।",
  "- **what anyone sees**: every credential saw every row, on clouds that hold only public flavors, volume types and images. A private one in another project takes **Full view**.":
    "- **जो सभी देखते हैं**: हर क्रेडेंशियल ने हर पंक्ति देखी, ऐसे क्लाउड पर जिनमें केवल सार्वजनिक फ़्लेवर, वॉल्यूम प्रकार और इमेज हैं। किसी दूसरे प्रोजेक्ट की निजी चीज़ के लिए **पूर्ण दृश्य** चाहिए।",
  "- **nothing**: a `200` with no rows, on a project that has networks too. It looks like it worked, and it did not.":
    "- **कुछ नहीं**: बिना पंक्तियों वाला `200`, ऐसे प्रोजेक्ट पर जिसमें नेटवर्क भी हैं। ऐसा लगता है कि यह काम कर गया, पर ऐसा नहीं हुआ।",
  "- **none recorded**: a `200` with no rows where an admin saw none either, so there was nothing to tell by.":
    "- **कुछ दर्ज नहीं**: बिना पंक्तियों वाला `200` जहाँ एडमिन ने भी कुछ नहीं देखा, इसलिए फ़र्क़ बताने के लिए कुछ नहीं था।",
  "- **409, expected**: Neutron tries to create the project's default security group when it lists them, and zero quota does not let it, so it answers `409 Quota exceeded`. That is harmless, and nothing to fix.":
    "- **409, अपेक्षित**: सूची बनाते समय Neutron प्रोजेक्ट का डिफ़ॉल्ट सुरक्षा समूह बनाने की कोशिश करता है, और शून्य कोटा ऐसा करने नहीं देता, इसलिए यह `409 Quota exceeded` लौटाता है। यह हानिरहित है, और ठीक करने को कुछ नहीं है।",
  "A list a credential can't read looks empty here: `troubleshoot.sh` says what this credential can read, and what each gap costs.":
    "जिस सूची को क्रेडेंशियल पढ़ नहीं सकता वह यहाँ खाली दिखती है: `troubleshoot.sh` बताता है कि यह क्रेडेंशियल क्या पढ़ सकता है, और हर कमी की क्या कीमत है।",
  "Monitoring must never be what takes a cloud down, so the agent is gentle by default:":
    "निगरानी कभी भी क्लाउड को गिराने की वजह नहीं बननी चाहिए, इसलिए एजेंट डिफ़ॉल्ट रूप से नरमी से काम करता है:",
  "| Reads | Every | Gives |": "| क्या पढ़ता है | हर | क्या देता है |",
  "| **Compute (Nova)** | 2 minutes | Services, hypervisors, instances and flavors |":
    "| **Compute (Nova)** | 2 मिनट | सेवाएँ, हाइपरवाइज़र, इंस्टेंस और फ़्लेवर |",
  "| **Placement** | 2 minutes | What each hypervisor can promise, and has promised |":
    "| **Placement** | 2 मिनट | हर हाइपरवाइज़र क्या वादा कर सकता है, और क्या कर चुका है |",
  "| **Networking (Neutron)** | 2 minutes | Agents, networks, subnets, address use, routers and floating IPs |":
    "| **नेटवर्किंग (Neutron)** | 2 मिनट | एजेंट, नेटवर्क, सबनेट, पता उपयोग, राउटर और फ़्लोटिंग IP |",
  "| **Block Storage (Cinder)** | 2 minutes | Services, volumes, snapshots and storage pools |":
    "| **ब्लॉक स्टोरेज (Cinder)** | 2 मिनट | सेवाएँ, वॉल्यूम, स्नैपशॉट और स्टोरेज पूल |",
  "| **Identity (Keystone)** | 5 minutes | Projects and domains |":
    "| **पहचान (Keystone)** | 5 मिनट | प्रोजेक्ट और डोमेन |",
  "| **Images (Glance)** | 5 minutes | Images |":
    "| **इमेज (Glance)** | 5 मिनट | इमेज |",
  "- Each service is read on its own, so a failing Nova costs only Nova's numbers, and the rest keep reporting.":
    "- हर सेवा अलग से पढ़ी जाती है, इसलिए विफल होता Nova केवल Nova के आँकड़ों की कीमत लेता है, और बाकी रिपोर्ट करते रहते हैं।",
  "- A read never outlasts its interval, so a slow one never stacks on the next.":
    "- कोई पढ़ना अपने अंतराल से ज़्यादा नहीं चलता, इसलिए धीमा पढ़ना अगले के ऊपर कभी नहीं जमा होता।",
  "- Each project's quotas are off. To turn them on, run the installer again with `OPENSTACK_COLLECT_QUOTAS=true`: a second exporter reads them once an hour, at four calls per project per region. Neutron's quotas answer only **Full view**.":
    "- हर प्रोजेक्ट के कोटा बंद हैं। उन्हें चालू करने के लिए इंस्टॉलर को `OPENSTACK_COLLECT_QUOTAS=true` के साथ फिर से चलाएँ: एक दूसरा एक्सपोर्टर उन्हें घंटे में एक बार पढ़ता है, हर क्षेत्र में हर प्रोजेक्ट के लिए चार कॉल पर। Neutron के कोटा केवल **पूर्ण दृश्य** को जवाब देते हैं।",
  "- Nova's own quota lists and usage per server are off. To turn one on, delete its `--disable-metric` line from the exporter's `command` in `docker-compose.yml`. The cost is one call per project per scrape.":
    "- Nova की अपनी कोटा सूचियाँ और प्रति सर्वर उपयोग बंद हैं। किसी एक को चालू करने के लिए `docker-compose.yml` में एक्सपोर्टर के `command` से उसकी `--disable-metric` पंक्ति हटाएँ। कीमत हर स्क्रेप में प्रति प्रोजेक्ट एक कॉल है।",
  "- The per-port series are off: listing every port with an admin credential can saturate Neutron on a large cloud.":
    "- प्रति पोर्ट सीरीज़ बंद हैं: एडमिन क्रेडेंशियल से हर पोर्ट की सूची बनाना बड़े क्लाउड पर Neutron को भर सकता है।",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Give the install script every region's name. It writes one `clouds.yaml` entry for each. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "एक क्लाउड एक Keystone है, उसके कितने भी क्षेत्र हों, और एक एजेंट उन सबको पढ़ता है। इंस्टॉल स्क्रिप्ट को हर क्षेत्र का नाम दें। यह हर एक के लिए एक `clouds.yaml` प्रविष्टि लिखती है। हर प्रविष्टि का नाम उसके क्षेत्र पर होना चाहिए: कलेक्टर वह नाम एक्सपोर्टर की सीरीज़ पर `openstack.region.name` के रूप में लगाता है, क्योंकि सीरीज़ यह नहीं बतातीं कि वे किस क्षेत्र से हैं। तब OneUptime की हर सूची क्षेत्र के अनुसार फ़िल्टर होती है।",
  "Regions with a Keystone of their own are separate clouds to OneUptime: run one agent for each.":
    "अपने अलग Keystone वाले क्षेत्र OneUptime के लिए अलग क्लाउड हैं: हर एक के लिए एक एजेंट चलाएँ।",
  "**[Very Large OpenStack Clouds](/docs/telemetry/openstack-very-large-clouds)** has what each size costs and how each of these works.":
    "**[बहुत बड़े OpenStack क्लाउड](/docs/telemetry/openstack-very-large-clouds)** में बताया है कि हर आकार की क्या कीमत है और इनमें से हर एक कैसे काम करता है।",
  "**Past 5,000 instances, summary mode.** The cloud keeps a row for every part and counts per hypervisor, project and status, and its series per instance and per volume stop. It gives up the history of each settled instance's and volume's status, and a chart or a monitor over those series. An instance or volume in a state an alert watches keeps its series, so every alert template goes on working. To keep them for some, choose their projects under **Real usage per instance** on the cloud's **Settings** page.":
    "**5,000 इंस्टेंस से ऊपर, सारांश मोड।** क्लाउड हर हिस्से के लिए एक पंक्ति और हाइपरवाइज़र, प्रोजेक्ट और स्थिति के अनुसार गिनती रखता है, और प्रति इंस्टेंस और प्रति वॉल्यूम उसकी सीरीज़ रुक जाती हैं। यह हर स्थिर हो चुके इंस्टेंस और वॉल्यूम की स्थिति का इतिहास छोड़ देता है, और उन सीरीज़ पर कोई चार्ट या मॉनिटर भी। ऐसी स्थिति में इंस्टेंस या वॉल्यूम जिस पर कोई अलर्ट नज़र रखता है, अपनी सीरीज़ रखता है, इसलिए हर अलर्ट टेम्पलेट काम करता रहता है। कुछ के लिए इन्हें रखने के लिए, क्लाउड के **सेटिंग्स** पृष्ठ पर **प्रति इंस्टेंस असली उपयोग** के नीचे उनके प्रोजेक्ट चुनें।",
  "**Sharing a cloud between agents.** Run one agent per region, or per service for the largest clouds, each with the same `OPENSTACK_CLOUD_NAME`. A region and a service belong to one agent, and Keystone to one agent for the whole cloud, or their series arrive twice. List an agent's regions in `OPENSTACK_EXPORTER_CLOUDS`, and its services in `OPENSTACK_AGENT_SERVICES`, such as `compute|placement`.":
    "**एक क्लाउड को कई एजेंटों में बाँटना।** हर क्षेत्र के लिए एक एजेंट चलाएँ, या सबसे बड़े क्लाउड के लिए हर सेवा के लिए एक, हर एक में एक ही `OPENSTACK_CLOUD_NAME` के साथ। एक क्षेत्र और एक सेवा एक ही एजेंट की होती है, और Keystone पूरे क्लाउड के लिए एक एजेंट का, वरना उनकी सीरीज़ दो बार आती हैं। किसी एजेंट के क्षेत्र `OPENSTACK_EXPORTER_CLOUDS` में सूचीबद्ध करें, और उसकी सेवाएँ `OPENSTACK_AGENT_SERVICES` में, जैसे `compute|placement`।",
  "**Past 1,500 hypervisors or 100,000 instances, the database path.** The agent can read the cloud's databases rather than its APIs, which at that size cannot be read in a scrape's time. It asks for a read-only account on each service's database, a route to them from this machine, and one exporter per region and Nova cell. It reads the same series, but for whether each Nova worker is alive and how full each storage pool is, which it still reads from the API, and it cannot say whether an API answers. It has not yet been run against a real database.":
    "**1,500 हाइपरवाइज़र या 100,000 इंस्टेंस से ऊपर, डेटाबेस का रास्ता।** एजेंट क्लाउड के API के बजाय उसके डेटाबेस पढ़ सकता है, जिन्हें उस आकार पर एक स्क्रेप के समय में पढ़ा नहीं जा सकता। इसे हर सेवा के डेटाबेस पर केवल-पढ़ने वाला खाता, इस मशीन से उन तक रूट, और हर क्षेत्र और Nova सेल के लिए एक एक्सपोर्टर चाहिए। यह वही सीरीज़ पढ़ता है, सिवाय इसके कि हर Nova वर्कर ज़िंदा है या नहीं और हर स्टोरेज पूल कितना भरा है, जिन्हें यह अब भी API से पढ़ता है, और यह नहीं बता सकता कि कोई API जवाब देता है या नहीं। इसे अभी तक किसी असली डेटाबेस पर नहीं चलाया गया है।",
  "The install script writes these to `/opt/oneuptime-openstack-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`.":
    "इंस्टॉल स्क्रिप्ट इन्हें `/opt/oneuptime-openstack-agent/.env` में लिखती है। किसी एक को बदलने के बाद उसे `/opt/oneuptime-openstack-agent` में `docker compose up -d` से लागू करें।",
  "| Variable | Required | Description |": "| वेरिएबल | ज़रूरी | विवरण |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | हाँ | आपके OneUptime इंस्टेंस का URL (जैसे `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key: the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | हाँ | टेलीमेट्री इंजेशन कुंजी: चरण 1 में चुनी गई कुंजी |",
  "| `OPENSTACK_CLOUD_NAME` | Yes | The cloud's name in OneUptime, stamped on every metric as the `openstack.cloud.name` resource attribute. Keep it stable: changing it registers a new cloud |":
    "| `OPENSTACK_CLOUD_NAME` | हाँ | OneUptime में क्लाउड का नाम, हर मेट्रिक पर संसाधन एट्रिब्यूट `openstack.cloud.name` के रूप में लगाया जाता है। इसे स्थिर रखें: इसे बदलने से एक नया क्लाउड दर्ज होता है |",
  "| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The `clouds.yaml` entries to read, one per region and named for the region, in square brackets: `[RegionOne,RegionTwo]` |":
    "| `OPENSTACK_EXPORTER_CLOUDS` | हाँ | पढ़ी जाने वाली `clouds.yaml` प्रविष्टियाँ, हर क्षेत्र के लिए एक और उसी के नाम पर, वर्गाकार कोष्ठकों में: `[RegionOne,RegionTwo]` |",
  "| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |":
    "| `OPENSTACK_AUTH_URL` | साथ आया एक्सपोर्टर | Keystone auth URL। अगर `/v3` नहीं है तो जोड़ दिया जाता है |",
  "| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port` of your own exporter, with no scheme. Leave it out for the bundled one |":
    "| `OPENSTACK_EXPORTER_ADDRESS` | नहीं | आपके अपने एक्सपोर्टर का `host:port`, बिना स्कीम के। साथ आए एक्सपोर्टर के लिए इसे छोड़ दें |",
  "| `OPENSTACK_QUOTA_CLOUDS` | No | The `clouds.yaml` entries to read each project's quotas from, once an hour. The install script sets it when run with `OPENSTACK_COLLECT_QUOTAS=true` |":
    "| `OPENSTACK_QUOTA_CLOUDS` | नहीं | `clouds.yaml` की वे प्रविष्टियाँ जिनसे हर प्रोजेक्ट का कोटा घंटे में एक बार पढ़ा जाता है। `OPENSTACK_COLLECT_QUOTAS=true` के साथ चलाने पर इंस्टॉल स्क्रिप्ट इसे सेट करती है |",
  "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | No | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | नहीं | उन्हें पढ़ने वाले एक्सपोर्टर का `host:port`। साथ आए एक्सपोर्टर के लिए इसे छोड़ दें |",
  "| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml` (default: `65532:65532`) |":
    "| `OPENSTACK_EXPORTER_USER` | नहीं | वह `uid:gid` जिससे एक्सपोर्टर का कंटेनर चलता है, जिसका `clouds.yaml` पर स्वामित्व होना चाहिए (डिफ़ॉल्ट: `65532:65532`) |",
  "| `OPENSTACK_CA_FILE` | No | A PEM file with the certificate authority of a cloud that has its own |":
    "| `OPENSTACK_CA_FILE` | नहीं | अपने प्रमाणपत्र प्राधिकरण वाले क्लाउड के प्रमाणपत्र प्राधिकरण की PEM फ़ाइल |",
  "| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter, and `openstack-ai-agent` the OneUptime AI agent |":
    "| `COMPOSE_PROFILES` | साथ आया एक्सपोर्टर | `openstack-exporter` साथ आए एक्सपोर्टर को शुरू करता है, और `openstack-ai-agent` OneUptime AI एजेंट को |",
  "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | No | An exporter already running without `--multi-cloud`, such as Kolla-Ansible's: `[10.0.0.254:9198]`. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it |":
    "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | नहीं | पहले से `--multi-cloud` के बिना चल रहा एक्सपोर्टर, जैसे Kolla-Ansible का: `[10.0.0.254:9198]`। इसके साथ `OPENSTACK_EXPORTER_CLOUDS=[]` सेट करें |",
  "| `OPENSTACK_RABBITMQ_TARGETS` | No | RabbitMQ's Prometheus plugin on each node: `[10.0.0.11:15692,10.0.0.12:15692]` |":
    "| `OPENSTACK_RABBITMQ_TARGETS` | नहीं | हर नोड पर RabbitMQ का Prometheus प्लगइन: `[10.0.0.11:15692,10.0.0.12:15692]` |",
  "| `OPENSTACK_MARIADB_TARGETS` | No | mysqld_exporter beside each MariaDB node, usually on `9104` |":
    "| `OPENSTACK_MARIADB_TARGETS` | नहीं | हर MariaDB नोड के बगल में mysqld_exporter, आमतौर पर `9104` पर |",
  "| `OPENSTACK_MEMCACHED_TARGETS` | No | memcached_exporter beside each Memcached, usually on `9150` |":
    "| `OPENSTACK_MEMCACHED_TARGETS` | नहीं | हर Memcached के बगल में memcached_exporter, आमतौर पर `9150` पर |",
  "| `OPENSTACK_HAPROXY_TARGETS` | No | HAProxy's own Prometheus exporter |":
    "| `OPENSTACK_HAPROXY_TARGETS` | नहीं | HAProxy का अपना Prometheus एक्सपोर्टर |",
  "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | No | openstack-network-exporter on each node, for OVN and Open vSwitch, usually on `1981` |":
    "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | नहीं | हर नोड पर openstack-network-exporter, OVN और Open vSwitch के लिए, आमतौर पर `1981` पर |",
  "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | No | prometheus-libvirt-exporter on each compute node, usually on `9177`, for whether libvirt answers and nothing per instance |":
    "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | नहीं | हर कंप्यूट नोड पर prometheus-libvirt-exporter, आमतौर पर `9177` पर, यह जानने के लिए कि libvirt जवाब देता है या नहीं, और प्रति इंस्टेंस कुछ नहीं |",
  "| `OPENSTACK_CONTROL_PLANE_REGION` | No | The region of a target above that does not say its own. A target can: `RegionTwo@10.1.0.11:15692` |":
    "| `OPENSTACK_CONTROL_PLANE_REGION` | नहीं | ऊपर के किसी ऐसे टारगेट का क्षेत्र जो अपना क्षेत्र नहीं बताता। टारगेट बता सकता है: `RegionTwo@10.1.0.11:15692` |",
  "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | No | The same exporter, for what each instance is really doing. Per-instance series multiply fast |":
    "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | नहीं | वही एक्सपोर्टर, यह जानने के लिए कि हर इंस्टेंस असल में क्या कर रहा है। प्रति इंस्टेंस सीरीज़ तेज़ी से बढ़ती हैं |",
  "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | No | Ceilometer's exporter on each compute node, usually on `9101`, for the same |":
    "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | नहीं | हर कंप्यूट नोड पर Ceilometer का एक्सपोर्टर, आमतौर पर `9101` पर, उसी के लिए |",
  "`clouds.yaml` alone holds the credential.":
    "केवल `clouds.yaml` में क्रेडेंशियल होता है।",
  "Only the largest clouds need these, and none is asked for:":
    "इनकी ज़रूरत केवल सबसे बड़े क्लाउड को होती है, और इनमें से कोई भी पूछा नहीं जाता:",
  "| Variable | Description |": "| वेरिएबल | विवरण |",
  "| `OPENSTACK_AGENT_SERVICES` | Which services this agent reads, as a pattern: `compute\\|placement` here and the rest on a second agent. Every service by default. No two agents should read one service of one region |":
    "| `OPENSTACK_AGENT_SERVICES` | यह एजेंट कौन-सी सेवाएँ पढ़ता है, एक पैटर्न के रूप में: यहाँ `compute\\|placement` और बाकी दूसरे एजेंट पर। डिफ़ॉल्ट रूप से हर सेवा। किसी क्षेत्र की एक सेवा को दो एजेंट नहीं पढ़ने चाहिए |",
  "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | The memory the collector may use, in MiB (default: `512`). It holds a whole scrape, so raise this past tens of thousands of instances |":
    "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | कलेक्टर कितनी मेमोरी इस्तेमाल कर सकता है, MiB में (डिफ़ॉल्ट: `512`)। यह पूरा एक स्क्रेप रखता है, इसलिए दसियों हज़ार इंस्टेंस से ऊपर इसे बढ़ाएँ |",
  "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | Reading each service's database rather than its API, with a read-only account: where that exporter answers. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it, or every series arrives twice |":
    "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | केवल-पढ़ने वाले खाते से हर सेवा के API के बजाय उसका डेटाबेस पढ़ना: वह एक्सपोर्टर कहाँ जवाब देता है। इसके साथ `OPENSTACK_EXPORTER_CLOUDS=[]` सेट करें, वरना हर सीरीज़ दो बार आती है |",
  "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | The database of each service it reads, as `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. One left empty is a service it leaves alone. Each holds a password, and `.env` is readable by its owner alone |":
    "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | यह जिन सेवाओं को पढ़ता है उनमें से हर एक का डेटाबेस, `mysql+pymysql://oneuptime:secret@db.example:3306/nova` के रूप में। जो खाली छोड़ा गया है वह ऐसी सेवा है जिसे यह नहीं छूता। हर एक में पासवर्ड है, और `.env` केवल उसका मालिक पढ़ सकता है |",
  "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | What Nova adds to a host's name to make a hypervisor's, such as `.example.org`, so an instance finds the hypervisor it runs on |":
    "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | Nova होस्ट के नाम में जो जोड़कर हाइपरवाइज़र का नाम बनाता है, जैसे `.example.org`, ताकि इंस्टेंस वह हाइपरवाइज़र ढूँढ सके जिस पर वह चलता है |",
  "| `OPENSTACK_WORKER_STATE_CLOUDS` | The `clouds.yaml` entries to read from Nova's and Cinder's APIs what their databases cannot say: whether each worker is alive, and how full each pool is |":
    "| `OPENSTACK_WORKER_STATE_CLOUDS` | `clouds.yaml` की वे प्रविष्टियाँ जिनसे Nova और Cinder के API से वह पढ़ा जाता है जो उनके डेटाबेस नहीं बता सकते: हर वर्कर ज़िंदा है या नहीं, और हर पूल कितना भरा है |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | उन्हें पढ़ने वाले एक्सपोर्टर का `host:port`। साथ आए एक्सपोर्टर के लिए इसे छोड़ दें |",
  "| `OPENSTACK_QUOTA_CLOUDS` | The `clouds.yaml` entries to read each project's quotas from, once an hour. Empty reads none, and `OPENSTACK_COLLECT_QUOTAS=true` in the install script fills it in |":
    "| `OPENSTACK_QUOTA_CLOUDS` | `clouds.yaml` की वे प्रविष्टियाँ जिनसे हर प्रोजेक्ट का कोटा घंटे में एक बार पढ़ा जाता है। खाली होने पर कोई नहीं पढ़ता, और इंस्टॉल स्क्रिप्ट में `OPENSTACK_COLLECT_QUOTAS=true` इसे भर देता है |",
  "The OneUptime AI agent reads the credential in `clouds.yaml` unless these say otherwise, and none is asked for:":
    "OneUptime AI एजेंट `clouds.yaml` का क्रेडेंशियल पढ़ता है, जब तक ये कुछ और न कहें, और इनमें से कोई भी पूछा नहीं जाता:",
  "| `ONEUPTIME_AI_INVESTIGATION` | `false` stops OneUptime AI investigating this cloud with the agent |":
    "| `ONEUPTIME_AI_INVESTIGATION` | `false` OneUptime AI को एजेंट से इस क्लाउड की जाँच करने से रोकता है |",
  "| `OPENSTACK_AI_CLOUDS_FILE` | The `clouds.yaml` it mounts. `/dev/null` when it has a credential of its own and there is no such file beside it |":
    "| `OPENSTACK_AI_CLOUDS_FILE` | वह `clouds.yaml` जिसे यह माउंट करता है। `/dev/null` जब इसके पास अपना क्रेडेंशियल हो और इसके बगल में ऐसी कोई फ़ाइल न हो |",
  "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | The entry of `clouds.yaml` to use, when it is not the first of `OPENSTACK_EXPORTER_CLOUDS` |":
    "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | इस्तेमाल करने के लिए `clouds.yaml` की प्रविष्टि, जब वह `OPENSTACK_EXPORTER_CLOUDS` की पहली न हो |",
  "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | A credential of its own, used instead of `clouds.yaml`'s. Set both, with `OPENSTACK_AUTH_URL` |":
    "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | इसका अपना क्रेडेंशियल, जो `clouds.yaml` वाले के बजाय इस्तेमाल होता है। दोनों सेट करें, `OPENSTACK_AUTH_URL` के साथ |",
  "| `OPENSTACK_AUTH_URL` | The Keystone a credential of its own logs in to |":
    "| `OPENSTACK_AUTH_URL` | वह Keystone जिसमें अपना क्रेडेंशियल लॉग इन करता है |",
  "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | The region a command reads when it names none, which endpoints it uses (`public`, `internal` or `admin`), and a certificate authority. `clouds.yaml` says these unless they do |":
    "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | कोई कमांड क्षेत्र का नाम न दे तो वह कौन-सा क्षेत्र पढ़ती है, यह कौन-से एंडपॉइंट इस्तेमाल करता है (`public`, `internal` या `admin`), और एक प्रमाणपत्र प्राधिकरण। जब तक ये न बताएँ, `clouds.yaml` इन्हें बताता है |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | The name it registers under, when it is not `OPENSTACK_CLOUD_NAME` |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | वह नाम जिससे यह दर्ज होता है, जब वह `OPENSTACK_CLOUD_NAME` न हो |",
  "| `LOG_LEVEL` | How much it logs |":
    "| `LOG_LEVEL` | यह कितना लॉग करता है |",
  "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | Off until set: let it make changes, through a credential of their own. The OpenStack guide says how to make it with the least it needs |":
    "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | सेट होने तक बंद: इसे अपने अलग क्रेडेंशियल से बदलाव करने देते हैं। OpenStack गाइड बताती है कि इसे न्यूनतम ज़रूरी अधिकारों के साथ कैसे बनाएँ |",
  "| `ONEUPTIME_AI_FIXES` | How AI may apply a fix: off, ask-for-approval, automatic or bypass-approval. Empty: fixes stay off until someone chooses on this page |":
    "| `ONEUPTIME_AI_FIXES` | AI कोई सुधार कैसे लागू कर सकता है: off, ask-for-approval, automatic या bypass-approval। खाली: जब तक कोई इस पृष्ठ पर न चुने, सुधार बंद रहते हैं |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | What is never touched, whatever else is set and whoever approves it: `project:ID`, `host:NAME` or `instance:ID`, separated by commas |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | जिसे कभी नहीं छुआ जाता, चाहे और कुछ भी सेट हो और कोई भी मंज़ूरी दे: `project:ID`, `host:NAME` या `instance:ID`, कॉमा से अलग |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | Where changes may land, written the same way. Empty: anywhere that is not protected |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | बदलाव कहाँ हो सकते हैं, उसी तरह लिखा गया। खाली: हर वह जगह जो सुरक्षित नहीं है |",
  "Set `OPENSTACK_EXPORTER_ADDRESS` as you run the install script, such as `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. The bundled exporter then never starts, and no Keystone URL or credential is asked for.":
    "इंस्टॉल स्क्रिप्ट चलाते समय `OPENSTACK_EXPORTER_ADDRESS` सेट करें, जैसे `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`। तब साथ आया एक्सपोर्टर कभी शुरू नहीं होता, और न कोई Keystone URL पूछा जाता है न कोई क्रेडेंशियल।",
  "Your exporter must run with `--multi-cloud`, and its `clouds.yaml` needs an entry named for each region. Turn off what the bundled one turns off: see **What the agent collects, and what it costs your cloud**. Use an address the agent's container can reach: `localhost` inside the container is the container itself.":
    "आपका एक्सपोर्टर `--multi-cloud` के साथ चलना चाहिए, और उसके `clouds.yaml` में हर क्षेत्र के नाम पर एक प्रविष्टि चाहिए। जो साथ आया एक्सपोर्टर बंद करता है उसे बंद करें: देखें **एजेंट क्या एकत्र करता है, और इसकी आपके क्लाउड को क्या कीमत चुकानी पड़ती है**। ऐसा पता इस्तेमाल करें जिस तक एजेंट का कंटेनर पहुँच सके: कंटेनर के अंदर `localhost` खुद वही कंटेनर है।",
  "**Started without `--multi-cloud`?** Kolla-Ansible's is, and Canonical's charm. It has no `/probe`, so set `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` instead of the address above, with `OPENSTACK_EXPORTER_CLOUDS=[]` and `OPENSTACK_CONTROL_PLANE_REGION`. It is then asked for everything at once, every 2 minutes.":
    "**`--multi-cloud` के बिना शुरू किया?** Kolla-Ansible का ऐसा ही है, और Canonical का charm भी। इसमें `/probe` नहीं है, इसलिए ऊपर के पते के बजाय `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` सेट करें, `OPENSTACK_EXPORTER_CLOUDS=[]` और `OPENSTACK_CONTROL_PLANE_REGION` के साथ। तब इससे हर 2 मिनट में सब कुछ एक साथ माँगा जाता है।",
  "**On exporter 1.7.0,** which Kolla-Ansible pins, it answers either way, and the pages go without what it does not say. On five real clouds that was:":
    "**एक्सपोर्टर 1.7.0 पर,** जिसे Kolla-Ansible पिन करता है, यह दोनों तरह से जवाब देता है, और पृष्ठों में वह नहीं होता जो यह नहीं बताता। पाँच असली क्लाउड पर यह था:",
  "Give the install script the file when it asks for a private CA file. It copies it to `ca.pem`, and names it in `clouds.yaml`.":
    "जब इंस्टॉल स्क्रिप्ट निजी CA फ़ाइल माँगे, तो उसे फ़ाइल दें। यह उसे `ca.pem` में कॉपी करती है, और `clouds.yaml` में उसका नाम देती है।",
  "On Linux (x86_64 or arm64) with systemd 235 or later and glibc 2.34 or later (not RHEL 8), the install script can run the same collector and exporter releases as systemd services instead:":
    "systemd 235 या बाद वाले और glibc 2.34 या बाद वाले Linux (x86_64 या arm64) पर (RHEL 8 नहीं), इंस्टॉल स्क्रिप्ट उन्हीं कलेक्टर और एक्सपोर्टर रिलीज़ को इसके बजाय systemd सेवाओं के रूप में चला सकती है:",
  "Moving off a Docker install? Run `docker compose down` first, or every metric arrives twice. Running the script again stays whichever it was, so `sudo bash install.sh` is the upgrade.":
    "Docker इंस्टॉल से हट रहे हैं? पहले `docker compose down` चलाएँ, वरना हर मेट्रिक दो बार आती है। स्क्रिप्ट फिर से चलाने पर जो तरीका था वही रहता है, इसलिए `sudo bash install.sh` ही अपग्रेड है।",
  "The `resource` processor in `otel-collector-config.yaml` stamps every metric with the cloud's name. OneUptime registers the cloud from that attribute, and every page and monitor scopes on it. The two deletes keep OneUptime from registering a Service named after the scrape job, so keep them if you customize the file:":
    "`otel-collector-config.yaml` में `resource` प्रोसेसर हर मेट्रिक पर क्लाउड का नाम लगाता है। OneUptime उसी एट्रिब्यूट से क्लाउड दर्ज करता है, और हर पृष्ठ और मॉनिटर उसी पर सीमित होता है। दोनों डिलीट OneUptime को स्क्रेप जॉब के नाम पर कोई सेवा दर्ज करने से रोकते हैं, इसलिए फ़ाइल को कस्टमाइज़ करें तो इन्हें रखें:",
  "The whole file is on this OneUptime:": "पूरी फ़ाइल इस OneUptime पर है:",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cloud: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `openstack.cloud.name`:":
    "`oneuptime.label.` उपसर्ग वाला कोई भी संसाधन एट्रिब्यूट क्लाउड पर एक प्रोजेक्ट लेबल बन जाता है: `oneuptime.label.<dimension>=<value>` लेबल `<dimension>:<value>` है। इन्हें `otel-collector-config.yaml` में `resource` प्रोसेसर में `openstack.cloud.name` के बगल में जोड़ें:",
  "Then restart the collector so it reads the new config:":
    "फिर कलेक्टर को रीस्टार्ट करें ताकि वह नया कॉन्फ़िग पढ़े:",
  "The cloud shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "क्लाउड `team:platform` और `env:production` टैग के साथ दिखता है। लेबल बड़े-छोटे अक्षरों का भेद किए बिना मिलाए जाते हैं, इसलिए मौजूदा `Production` लेबल दोबारा इस्तेमाल होता है; OneUptime UI में जोड़े गए लेबल एजेंट कभी नहीं हटाता।",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` and `clouds.yaml` (nothing is asked again), downloads the latest files (a file you edited is kept next to the new one as `<file>.bak.<timestamp>`), pulls the images and recreates the agent with them:":
    "**अपग्रेड।** इमेज `docker-compose.yml` में पिन हैं और उसका कॉन्फ़िग उसके बगल की एक फ़ाइल है, इसलिए केवल pull करने से एजेंट आगे नहीं बढ़ता। इंस्टॉल स्क्रिप्ट फिर से चलाएँ। यह आपकी मौजूदा `.env` और `clouds.yaml` का हर मान दोबारा इस्तेमाल करती है (कुछ भी दोबारा नहीं पूछा जाता), नवीनतम फ़ाइलें डाउनलोड करती है (आपकी बदली हुई फ़ाइल नई फ़ाइल के बगल में `<file>.bak.<timestamp>` के रूप में रखी जाती है), इमेज pull करती है और उनसे एजेंट को फिर से बनाती है:",
  "The config reports the collector version it pins as the cloud's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "कॉन्फ़िग अपने पिन किए कलेक्टर संस्करण को क्लाउड के **एजेंट संस्करण** के रूप में बताता है। जब यह OneUptime कोई नया संस्करण पिन करता है, तो उसके बगल का चेतावनी चिह्न ये कमांड खोलता है।",
  "**Uninstall** the agent:": "एजेंट को **अनइंस्टॉल करें**:",
  "Then delete `/opt/oneuptime-openstack-agent`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "फिर `/opt/oneuptime-openstack-agent` हटाएँ, जिसमें क्रेडेंशियल है, और खुद एप्लिकेशन क्रेडेंशियल भी: `openstack application credential delete oneuptime-agent`।",
  "`troubleshoot.sh` checks the whole chain, from DNS and TLS to Keystone, each service in the catalog and your ingestion key, and says what this credential can read and what each gap costs.":
    "`troubleshoot.sh` पूरी कड़ी जाँचता है, DNS और TLS से Keystone तक, कैटलॉग की हर सेवा और आपकी इंजेशन कुंजी तक, और बताता है कि यह क्रेडेंशियल क्या पढ़ सकता है और हर कमी की क्या कीमत है।",
  "It needs `sudo` to read `clouds.yaml`, or it skips the credential checks. It ends with a verdict naming the most likely cause.":
    "इसे `clouds.yaml` पढ़ने के लिए `sudo` चाहिए, वरना यह क्रेडेंशियल की जाँच छोड़ देता है। अंत में यह सबसे संभावित कारण बताने वाला निष्कर्ष देता है।",
  "1. Check that the agent is running (in `/opt/oneuptime-openstack-agent`): `docker compose ps`":
    "1. जाँचें कि एजेंट चल रहा है (`/opt/oneuptime-openstack-agent` में): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-openstack-agent | grep -i error`":
    "2. एजेंट के लॉग में त्रुटियाँ जाँचें: `docker compose logs oneuptime-openstack-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. पुष्टि करें कि आपका OneUptime URL और इंजेशन कुंजी सही हैं।",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. पक्का करें कि एजेंट की मशीन नेटवर्क पर OneUptime इंस्टेंस तक पहुँच सकती है।",
  "A **Project view** credential can't read them, and neither can a role without the policy overrides: Nova, Neutron and Placement keep them for admins by default. Use **Full view**, or **Infrastructure only** with the files in `access/policy` merged into the file each service's `[oslo_policy] policy_file` names. `troubleshoot.sh` says which reads were refused.":
    "**प्रोजेक्ट दृश्य** क्रेडेंशियल इन्हें नहीं पढ़ सकता, और न ही नीति ओवरराइड के बिना कोई भूमिका: Nova, Neutron और Placement इन्हें डिफ़ॉल्ट रूप से एडमिन के लिए रखते हैं। **पूर्ण दृश्य** इस्तेमाल करें, या **केवल इन्फ्रास्ट्रक्चर** के साथ `access/policy` की फ़ाइलों को उस फ़ाइल में मिलाकर जिसका नाम हर सेवा का `[oslo_policy] policy_file` देता है। `troubleshoot.sh` बताता है कि कौन-से पढ़ने अस्वीकार हुए।",
  "Only **Full view** sees `cinder-volume` and `cinder-scheduler` state and storage pools. Cinder's own code answers anything else with `403 User does not have admin privileges`, after policy has already passed, so no override opens them.":
    "`cinder-volume` और `cinder-scheduler` की स्थिति और स्टोरेज पूल केवल **पूर्ण दृश्य** देखता है। नीति के पास करने के बाद भी Cinder का अपना कोड बाकी सबको `403 User does not have admin privileges` से जवाब देता है, इसलिए कोई ओवरराइड उन्हें नहीं खोलता।",
  "Neutron and Cinder answer anything but an admin with `200` and only its own project, which looks like it worked. Seeing every project takes **Full view**. With **Infrastructure only**, they appear for the projects the role is assigned on, and a role on a real project can also write there on many clouds.":
    "Neutron और Cinder एडमिन के अलावा किसी को भी `200` और केवल उसके अपने प्रोजेक्ट से जवाब देते हैं, जिससे लगता है कि यह काम कर गया। हर प्रोजेक्ट देखने के लिए **पूर्ण दृश्य** चाहिए। **केवल इन्फ्रास्ट्रक्चर** के साथ, वे उन प्रोजेक्ट के लिए दिखते हैं जिन पर भूमिका दी गई है, और कई क्लाउड पर किसी असली प्रोजेक्ट पर दी गई भूमिका वहाँ लिख भी सकती है।",
  "A **Project view** credential shows no instances through the agent: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. **Full view** and **Infrastructure only** both see every project's instances.":
    "**प्रोजेक्ट दृश्य** क्रेडेंशियल एजेंट के ज़रिए कोई इंस्टेंस नहीं दिखाता: एक्सपोर्टर Nova से सभी प्रोजेक्ट के सर्वर माँगता है, Nova एक सामान्य रीडर को अस्वीकार करता है, और वह पूरा पढ़ना विफल हो जाता है। **पूर्ण दृश्य** और **केवल इन्फ्रास्ट्रक्चर** दोनों हर प्रोजेक्ट के इंस्टेंस देखते हैं।",
  "That is expected with **Infrastructure only**, and harmless. Neutron tries to create a project's default security group when it lists them, and a project with zero quota cannot hold one. There is nothing to fix.":
    "**केवल इन्फ्रास्ट्रक्चर** के साथ यह अपेक्षित है, और हानिरहित। सूची बनाते समय Neutron किसी प्रोजेक्ट का डिफ़ॉल्ट सुरक्षा समूह बनाने की कोशिश करता है, और शून्य कोटा वाला प्रोजेक्ट उसे नहीं रख सकता। ठीक करने को कुछ नहीं है।",
  "On Flamingo and Epoxy, oslo.policy raises on every check once a policy file it has read is gone, and when the service is Keystone the whole cloud answers `503`. Restart the service. To take the overrides off, empty the file (`{}`) and never delete it.":
    "Flamingo और Epoxy पर, एक बार पढ़ी गई नीति फ़ाइल के गायब होते ही oslo.policy हर जाँच पर त्रुटि देता है, और जब वह सेवा Keystone हो तो पूरा क्लाउड `503` लौटाता है। सेवा रीस्टार्ट करें। ओवरराइड हटाने के लिए फ़ाइल को खाली करें (`{}`) और उसे कभी न हटाएँ।",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "एजेंट हर सेवा को अलग से पढ़ता है, इसलिए विफल होती सेवा केवल अपने आँकड़ों की कीमत लेती है। देखें कि एक्सपोर्टर उसे क्यों नहीं पढ़ पा रहा (`/opt/oneuptime-openstack-agent` में): `docker compose logs oneuptime-openstack-exporter`। **सेवाएं** पृष्ठ उस API को `down` दिखाता है। नियमों की पुरानी प्रति से बना एक्सेस-नियम क्रेडेंशियल Swift पर, और पाथ के पीछे के Octavia पर भी यही करता है: नया बनाएँ, जैसा **पूर्ण दृश्य** में बताया गया है।",
  "The services are refusing a credential limited by access rules. A service behind a path prefix refuses the shipped rules: fit them to this cloud with `access-rules-for-cloud.py`, as **Full view** does. And each service needs `service_type` set for keystonemiddleware, and a restart:":
    "सेवाएँ एक्सेस नियमों से सीमित क्रेडेंशियल को अस्वीकार कर रही हैं। पाथ प्रीफ़िक्स के पीछे की सेवा साथ आए नियमों को अस्वीकार करती है: उन्हें `access-rules-for-cloud.py` से इस क्लाउड के अनुसार ढालें, जैसा **पूर्ण दृश्य** में बताया गया है। और हर सेवा को keystonemiddleware के लिए `service_type` सेट करना और एक रीस्टार्ट चाहिए:",
  "If you won't change that, create the credential without `--access-rules`, knowing it can write.":
    "अगर आप इसे नहीं बदलेंगे, तो `--access-rules` के बिना क्रेडेंशियल बनाएँ, यह जानते हुए कि यह लिख सकता है।",
  "The exporter runs as uid 65532, and `clouds.yaml` is readable by its owner alone. Give the file to that user, or set `OPENSTACK_EXPORTER_USER` in `.env` to the file owner's `uid:gid`, and apply it with `docker compose up -d`.":
    "एक्सपोर्टर uid 65532 के रूप में चलता है, और `clouds.yaml` केवल उसका मालिक पढ़ सकता है। फ़ाइल उस उपयोगकर्ता को सौंपें, या `.env` में `OPENSTACK_EXPORTER_USER` को फ़ाइल के मालिक के `uid:gid` पर सेट करें, और इसे `docker compose up -d` से लागू करें।",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "क्लाउड की पहचान `OPENSTACK_CLOUD_NAME` से आती है, जो हर मेट्रिक पर `openstack.cloud.name` के रूप में लगाया जाता है। इसे `.env` में ठीक करें और `/opt/oneuptime-openstack-agent` में `docker compose up -d` से लागू करें। नया नाम एक नया क्लाउड दर्ज करता है।",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "क्लाउड की पहचान `OPENSTACK_CLOUD_NAME` से आती है, जो हर मेट्रिक पर `openstack.cloud.name` के रूप में लगाया जाता है। यह क्लाउड **`cloud-1`** है। इसे `.env` में ठीक करें और `/opt/oneuptime-openstack-agent` में `docker compose up -d` से लागू करें। नया नाम एक नया क्लाउड दर्ज करता है।",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent":
    "एजेंट चलाने वाली मशीन पर Docker Engine 20.10+ और Docker Compose v2 प्लगइन",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "इस OneUptime से `docker-compose.yml` और `otel-collector-config.yaml` एक नए फ़ोल्डर में डाउनलोड करें:",
  "Create a `clouds.yaml` file next to them, with the credential from the previous step. It needs one entry per region, each named for its region, because the exporter's series do not say which region they are from:":
    "उनके बगल में पिछले चरण के क्रेडेंशियल के साथ एक `clouds.yaml` फ़ाइल बनाएँ। इसमें हर क्षेत्र के लिए एक प्रविष्टि चाहिए, हर एक उसके क्षेत्र के नाम पर, क्योंकि एक्सपोर्टर की सीरीज़ यह नहीं बतातीं कि वे किस क्षेत्र से हैं:",
  "Create a `.env` file next to them too:":
    "उनके बगल में एक `.env` फ़ाइल भी बनाएँ:",
  "- Replace `my-openstack-cloud` with a name for this cloud, such as `prod-eu`. It is how the cloud appears in OneUptime, so keep it stable: a new name registers a new cloud.":
    "- `my-openstack-cloud` को इस क्लाउड के नाम से बदलें, जैसे `prod-eu`। OneUptime में क्लाउड इसी तरह दिखता है, इसलिए इसे स्थिर रखें: नया नाम एक नया क्लाउड दर्ज करता है।",
  "- List every region in `OPENSTACK_EXPORTER_CLOUDS`, in square brackets, such as `[RegionOne,RegionTwo]`.":
    "- हर क्षेत्र को `OPENSTACK_EXPORTER_CLOUDS` में वर्गाकार कोष्ठकों में सूचीबद्ध करें, जैसे `[RegionOne,RegionTwo]`।",
  "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` starts the bundled exporter, which reads the cloud with `clouds.yaml`, and the OneUptime AI agent, which reads it with the same file while OneUptime AI investigates.":
    "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` साथ आए एक्सपोर्टर को शुरू करता है, जो क्लाउड को `clouds.yaml` से पढ़ता है, और OneUptime AI एजेंट को, जो OneUptime AI की जाँच के दौरान उसे उसी फ़ाइल से पढ़ता है।",
  "Both files hold secrets, so keep them to their owner. The exporter runs as uid 65532, and must be the one account that can read `clouds.yaml`. Then start the agent:":
    "दोनों फ़ाइलों में गोपनीय जानकारी है, इसलिए इन्हें केवल उनके मालिक तक रखें। एक्सपोर्टर uid 65532 के रूप में चलता है, और उसे ही अकेला खाता होना चाहिए जो `clouds.yaml` पढ़ सके। फिर एजेंट शुरू करें:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Add one `clouds.yaml` entry per region, and list them all in `OPENSTACK_EXPORTER_CLOUDS`. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "एक क्लाउड एक Keystone है, उसके कितने भी क्षेत्र हों, और एक एजेंट उन सबको पढ़ता है। हर क्षेत्र के लिए एक `clouds.yaml` प्रविष्टि जोड़ें, और उन सबको `OPENSTACK_EXPORTER_CLOUDS` में सूचीबद्ध करें। हर प्रविष्टि का नाम उसके क्षेत्र पर होना चाहिए: कलेक्टर वह नाम एक्सपोर्टर की सीरीज़ पर `openstack.region.name` के रूप में लगाता है, क्योंकि सीरीज़ यह नहीं बतातीं कि वे किस क्षेत्र से हैं। तब OneUptime की हर सूची क्षेत्र के अनुसार फ़िल्टर होती है।",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "एजेंट इन्हें `docker-compose.yml` के बगल वाली `.env` फ़ाइल से पढ़ता है। किसी एक को बदलने के बाद उसे `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से लागू करें।",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter, as `host:port` with no scheme: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. The bundled exporter then never starts.":
    "`.env` से `COMPOSE_PROFILES` हटा दें और एजेंट को अपने एक्सपोर्टर की ओर इंगित करें, बिना स्कीम के `host:port` के रूप में: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`। तब साथ आया एक्सपोर्टर कभी शुरू नहीं होता।",
  "Put the file next to `docker-compose.yml` as `ca.pem`, set `OPENSTACK_CA_FILE=./ca.pem` in `.env`, and add `cacert: /etc/openstack/ca.pem` to each entry of `clouds.yaml`.":
    "फ़ाइल को `docker-compose.yml` के बगल में `ca.pem` के रूप में रखें, `.env` में `OPENSTACK_CA_FILE=./ca.pem` सेट करें, और `clouds.yaml` की हर प्रविष्टि में `cacert: /etc/openstack/ca.pem` जोड़ें।",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "इन्हें एजेंट के फ़ोल्डर में चलाएँ, जिसमें `docker-compose.yml` है।",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `clouds.yaml` stay, and a change you made to either file has to be made again:":
    "**अपग्रेड।** इमेज `docker-compose.yml` में पिन हैं और उसका कॉन्फ़िग उसके बगल की एक फ़ाइल है, इसलिए केवल pull करने से एजेंट आगे नहीं बढ़ता। दोनों फ़ाइलें फिर से डाउनलोड करें; आपकी `.env` और `clouds.yaml` बनी रहती हैं, और दोनों में से किसी डाउनलोड की गई फ़ाइल में किया गया बदलाव फिर से करना होगा:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "फिर इमेज pull करें और एजेंट को फिर से बनाएँ, ताकि कलेक्टर अपना नया कॉन्फ़िग पढ़े:",
  "Then delete the folder with `docker-compose.yml`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "फिर `docker-compose.yml` वाला फ़ोल्डर हटाएँ, जिसमें क्रेडेंशियल है, और खुद एप्लिकेशन क्रेडेंशियल भी: `openstack application credential delete oneuptime-agent`।",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. जाँचें कि एजेंट चल रहा है (एजेंट के फ़ोल्डर में): `docker compose ps`",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in the agent's folder): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "एजेंट हर सेवा को अलग से पढ़ता है, इसलिए विफल होती सेवा केवल अपने आँकड़ों की कीमत लेती है। देखें कि एक्सपोर्टर उसे क्यों नहीं पढ़ पा रहा (एजेंट के फ़ोल्डर में): `docker compose logs oneuptime-openstack-exporter`। **सेवाएं** पृष्ठ उस API को `down` दिखाता है। नियमों की पुरानी प्रति से बना एक्सेस-नियम क्रेडेंशियल Swift पर, और पाथ के पीछे के Octavia पर भी यही करता है: नया बनाएँ, जैसा **पूर्ण दृश्य** में बताया गया है।",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "क्लाउड की पहचान `OPENSTACK_CLOUD_NAME` से आती है, जो हर मेट्रिक पर `openstack.cloud.name` के रूप में लगाया जाता है। इसे `.env` में ठीक करें और `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से लागू करें। नया नाम एक नया क्लाउड दर्ज करता है।",
  "- This installs the agent for **`cloud-1`**. Keep `OPENSTACK_CLOUD_NAME` exactly as it is, or the data registers as a new cloud.":
    "- यह **`cloud-1`** के लिए एजेंट इंस्टॉल करता है। `OPENSTACK_CLOUD_NAME` को ठीक वैसा ही रखें, वरना डेटा एक नए क्लाउड के रूप में दर्ज होता है।",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "क्लाउड की पहचान `OPENSTACK_CLOUD_NAME` से आती है, जो हर मेट्रिक पर `openstack.cloud.name` के रूप में लगाया जाता है। यह क्लाउड **`cloud-1`** है। इसे `.env` में ठीक करें और `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से लागू करें। नया नाम एक नया क्लाउड दर्ज करता है।",
  "OpenStack-Ansible keeps its services' logs in journald and runs no Prometheus of its own, so the agent is the way in, and the logs have a path of their own.":
    "OpenStack-Ansible अपनी सेवाओं के लॉग journald में रखता है और अपना कोई Prometheus नहीं चलाता, इसलिए एजेंट ही अंदर जाने का रास्ता है, और लॉग का अपना अलग रास्ता है।",
  "**How far this guide has been tested:** Its paths and variables were read from OpenStack-Ansible's own source and docs. Its commands were then run on a real all-in-one at stable/2026.1, in LXC containers, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, the agent's exporter on the Infrastructure only credential with its policy overrides, the RabbitMQ and HAProxy settings with the agent reading each, and the logs profile on the journal. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**यह गाइड कहाँ तक परखी गई है:** इसके पाथ और वेरिएबल OpenStack-Ansible के अपने सोर्स और दस्तावेज़ों से पढ़े गए। फिर इसकी कमांड stable/2026.1 पर, LXC कंटेनरों में, एक असली all-in-one पर चलाई गईं, OneUptime की जगह एक ऐसे विकल्प के साथ जो एजेंट का भेजा सब कुछ रखता था: पूर्ण दृश्य क्रेडेंशियल पर एजेंट, अपने नीति ओवरराइड के साथ केवल इन्फ्रास्ट्रक्चर क्रेडेंशियल पर एजेंट का एक्सपोर्टर, RabbitMQ और HAProxy की सेटिंग जिनमें से हर एक को एजेंट ने पढ़ा, और journal पर लॉग प्रोफ़ाइल। एजेंट और एक प्रोब, दोनों ने अलग-अलग एक असली DevStack को रुके हुए nova-compute से होकर और वापस, एक चालू OneUptime तक पूरा पहुँचाया है, लेकिन इस टूल से नहीं।",
  "- Log in as an admin from the utility container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, then `. ~/openrc`. It has no `curl`, which the commands below use, so run `apt-get install -y curl` there first.":
    "- utility कंटेनर से एडमिन के रूप में लॉग इन करें: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, फिर `. ~/openrc`। इसमें `curl` नहीं है, जिसे नीचे की कमांड इस्तेमाल करती हैं, इसलिए पहले वहाँ `apt-get install -y curl` चलाएँ।",
  "- **Full view** needs one change, to Cinder. OpenStack-Ansible's roles already set `service_type` under `[keystone_authtoken]`, but its Cinder says `volumev3` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Set `service_type: block-storage` under `keystone_authtoken` in `cinder_cinder_conf_overrides` in `/etc/openstack_deploy/user_variables.yml`, then run `openstack-ansible openstack.osa.cinder --tags cinder-config`.":
    "- **पूर्ण दृश्य** को Cinder में एक बदलाव चाहिए। OpenStack-Ansible की भूमिकाएँ `[keystone_authtoken]` के नीचे `service_type` पहले से सेट करती हैं, लेकिन उसका Cinder `volumev3` कहता है और उसका कैटलॉग `block-storage` कहता है, और जब तक दोनों मेल न खाएँ, keystonemiddleware एक्सेस नियमों से सीमित क्रेडेंशियल को `401` से अस्वीकार करता है। `/etc/openstack_deploy/user_variables.yml` में `cinder_cinder_conf_overrides` के अंदर `keystone_authtoken` के नीचे `service_type: block-storage` सेट करें, फिर `openstack-ansible openstack.osa.cinder --tags cinder-config` चलाएँ।",
  "- **Infrastructure only** takes its overrides as `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` and `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Apply each with its own playbook and tag, such as `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Taking one out later leaves an empty file behind rather than none, so nothing fails.":
    "- **केवल इन्फ्रास्ट्रक्चर** अपने ओवरराइड `/etc/openstack_deploy/user_variables.yml` में `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` और `placement_policy_overrides` के रूप में लेता है। हर एक को उसकी अपनी playbook और टैग से लागू करें, जैसे `openstack-ansible openstack.osa.nova --tags nova-policy-override`। बाद में किसी एक को हटाने पर कोई फ़ाइल न रहने के बजाय एक खाली फ़ाइल रह जाती है, इसलिए कुछ भी विफल नहीं होता।",
  "- **RabbitMQ:** turn on its Prometheus plugin, then name each container's address on `15692` as `OPENSTACK_RABBITMQ_TARGETS` in the agent's `.env`:":
    "- **RabbitMQ:** इसका Prometheus प्लगइन चालू करें, फिर एजेंट की `.env` में हर कंटेनर का `15692` पर पता `OPENSTACK_RABBITMQ_TARGETS` के रूप में दें:",
  "- **HAProxy:** its exporter is off, and its stats listener is on `127.0.0.1` with TLS, which the agent cannot read. Turn it on where the agent can, then name that address on `1936` as `OPENSTACK_HAPROXY_TARGETS`:":
    "- **HAProxy:** इसका एक्सपोर्टर बंद है, और इसका stats लिसनर TLS के साथ `127.0.0.1` पर है, जिसे एजेंट नहीं पढ़ सकता। इसे वहाँ चालू करें जहाँ एजेंट पढ़ सके, फिर `1936` पर वह पता `OPENSTACK_HAPROXY_TARGETS` के रूप में दें:",
  "- **MariaDB and Memcached:** OpenStack-Ansible ships no exporter for either. Run [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) and [memcached_exporter](https://github.com/prometheus/memcached_exporter) yourself and name them as `OPENSTACK_MARIADB_TARGETS` and `OPENSTACK_MEMCACHED_TARGETS`, or leave them out: the cloud's **Control Plane** card then says they are not watched, rather than that they are fine.":
    "- **MariaDB और Memcached:** OpenStack-Ansible इनमें से किसी के लिए भी एक्सपोर्टर नहीं देता। [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) और [memcached_exporter](https://github.com/prometheus/memcached_exporter) खुद चलाएँ और उन्हें `OPENSTACK_MARIADB_TARGETS` और `OPENSTACK_MEMCACHED_TARGETS` के रूप में दें, या उन्हें छोड़ दें: तब क्लाउड का **कंट्रोल प्लेन** कार्ड बताता है कि उनकी निगरानी नहीं हो रही, न कि वे ठीक हैं।",
  "This runs the agent's logs profile as a systemd service, and reads `/var/log/journal/`, where OpenStack-Ansible's containers' journals arrive.":
    "यह एजेंट की लॉग प्रोफ़ाइल को systemd सेवा के रूप में चलाता है, और `/var/log/journal/` पढ़ता है, जहाँ OpenStack-Ansible के कंटेनरों के journal पहुँचते हैं।",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from the journal.":
    "दोनों सेवा के अपने लॉग में लिखते हैं, बस पर कोई उपभोक्ता नहीं होता। **सुरक्षा इवेंट → कनेक्शन** में **अपने लॉग में सुरक्षा इवेंट खोजें** चालू होते ही OneUptime उन्हें वहीं से पढ़ता है। एजेंट की लॉग प्रोफ़ाइल दोनों को journal से पढ़ती है।",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw. A second value of `notification_opt_out` goes in as a YAML set, as [its config_template](https://docs.openstack.org/ansible-config_template/latest/) writes a repeated key.":
    "यह हर लॉगिन के लिए एक पंक्ति भेजता है, जिसे **OpenStack admin credential used from a new address** पढ़ता है। केवल असफल लॉगिन भेजने के लिए `notification_opt_out` में `identity.authenticate.success` जोड़ें; तब वह पहचान वही पढ़ती है जो ऑडिट फ़िल्टर ने देखा। `notification_opt_out` का दूसरा मान एक YAML सेट के रूप में जाता है, जैसे [इसका config_template](https://docs.openstack.org/ansible-config_template/latest/) दोहराई गई कुंजी लिखता है।",
  "For who did what through Nova, Neutron, Cinder and Glance, each API takes the filter's setting in its conf overrides, and the filter in its paste overrides, with `audit` right after `authtoken` and the context filter that follows it in each pipeline. Nova's, and the same in `neutron_neutron_conf_overrides` and `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` and `cinder_api_paste_ini_overrides`, and `glance_glance_api_conf_overrides` and `glance_glance_api_paste_ini_overrides`:":
    "Nova, Neutron, Cinder और Glance के ज़रिए किसने क्या किया, यह जानने के लिए, हर API फ़िल्टर की सेटिंग अपने conf ओवरराइड में लेता है, और फ़िल्टर को अपने paste ओवरराइड में, हर पाइपलाइन में `audit` को `authtoken` और उसके बाद आने वाले संदर्भ फ़िल्टर के ठीक बाद रखते हुए। यह Nova का है, और यही `neutron_neutron_conf_overrides` और `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` और `cinder_api_paste_ini_overrides`, और `glance_glance_api_conf_overrides` और `glance_glance_api_paste_ini_overrides` में:",
  "OpenStack-Helm offers charts for Prometheus, Alertmanager and exporters, and whether they are running is up to you. Its control plane runs in Kubernetes, so a probe reads the APIs and the Kubernetes agent sees the pods.":
    "OpenStack-Helm Prometheus, Alertmanager और एक्सपोर्टर के लिए चार्ट देता है, और वे चलें या नहीं, यह आप पर है। इसका कंट्रोल प्लेन Kubernetes में चलता है, इसलिए एक प्रोब API पढ़ता है और Kubernetes एजेंट पॉड देखता है।",
  "**How far this guide has been tested:** Its chart values were read from OpenStack-Helm's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**यह गाइड कहाँ तक परखी गई है:** इसके चार्ट मान OpenStack-Helm के अपने सोर्स से पढ़े गए। इसे इस टूल की किसी असली तैनाती पर शुरू से अंत तक नहीं चलाया गया है। एजेंट और एक प्रोब, दोनों ने अलग-अलग एक असली DevStack को रुके हुए nova-compute से होकर और वापस, एक चालू OneUptime तक पूरा पहुँचाया है, लेकिन इस टूल से नहीं। प्रोब और Kubernetes एजेंट को अलग-अलग परखा गया, इस टूल पर एक साथ नहीं।",
  "Then add the receiver under `conf.alertmanager` in the chart's values, and send your route to it:":
    "फिर चार्ट के मानों में `conf.alertmanager` के नीचे रिसीवर जोड़ें, और अपना रूट उसकी ओर भेजें:",
  "Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. [OpenStack Without an Agent](/docs/telemetry/openstack-agentless) says what each level of access reads, and the connection test says what yours can. The agent also works from any machine with a route to the APIs: choose **Not sure, or something else** above for its steps.":
    "**OpenStack → सभी क्लाउड** खोलें, **क्लाउड कनेक्ट करें** पर क्लिक करें, और इसे Keystone का पता, एक एप्लिकेशन क्रेडेंशियल और इस्तेमाल करने वाला प्रोब दें। प्रोब क्लाउड से केवल HTTPS में बात करता है। [एजेंट के बिना OpenStack](/docs/telemetry/openstack-agentless) बताता है कि हर एक्सेस स्तर क्या पढ़ता है, और कनेक्शन टेस्ट बताता है कि आपका क्या पढ़ सकता है। एजेंट API तक रूट वाली किसी भी मशीन से भी काम करता है: इसके चरणों के लिए ऊपर **निश्चित नहीं, या कुछ और** चुनें।",
  "Follow **Kubernetes → Documentation** for this cluster. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "इस क्लस्टर के लिए **Kubernetes → दस्तावेज़ीकरण** का पालन करें। तब इसके पॉड, उनके लॉग और उनके नोड Kubernetes पृष्ठों तक पहुँचते हैं, और उनमें शामिल OpenStack सेवाओं की निगरानी वहीं होती है।",
  "To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:":
    "उन सेवाओं के लॉग इस क्लाउड के **लॉग** पृष्ठ पर भी पाने के लिए, हर स्टैक ट्रेस एक रिकॉर्ड के रूप में, एजेंट के मानों में क्लाउड का नाम दें, उन नेमस्पेस के साथ जिनमें इसकी सेवाएँ चलती हैं:",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.":
    "दोनों सेवा के अपने लॉग में लिखते हैं, बस पर कोई उपभोक्ता नहीं होता। **सुरक्षा इवेंट → कनेक्शन** में **अपने लॉग में सुरक्षा इवेंट खोजें** चालू होते ही OneUptime उन्हें वहीं से पढ़ता है। Kubernetes एजेंट दोनों को पॉड के लॉग से पढ़ता है, अपने मानों में दिए गए क्लाउड के नाम के साथ।",
  "A chart's `logging.conf` keeps the root logger at `WARNING`, and the log driver writes under a logger of its own, so without one for it nothing is written. A list in values replaces the chart's, so `keys` holds what the chart's has, plus this:":
    "चार्ट की `logging.conf` रूट लॉगर को `WARNING` पर रखती है, और लॉग ड्राइवर अपने अलग लॉगर के तहत लिखता है, इसलिए उसके लिए लॉगर के बिना कुछ नहीं लिखा जाता। मानों में दी गई सूची चार्ट की सूची की जगह ले लेती है, इसलिए `keys` में वह सब होता है जो चार्ट की सूची में है, साथ में यह:",
  "For who did what through Nova, Neutron and Cinder, their charts' `conf.paste` already has the audit filter in each pipeline, and it needs telling where to write. Each needs the same logger, in `conf.logging`. Glance's chart has the map, and neither the filter nor a place for it in its pipelines: add both to its `conf.paste`.":
    "Nova, Neutron और Cinder के ज़रिए किसने क्या किया, यह जानने के लिए, उनके चार्ट के `conf.paste` में हर पाइपलाइन में ऑडिट फ़िल्टर पहले से है, और उसे बताना होता है कि कहाँ लिखे। हर एक को `conf.logging` में वही लॉगर चाहिए। Glance के चार्ट में मैप है, पर न फ़िल्टर है न उसकी पाइपलाइनों में उसकी जगह: दोनों को उसके `conf.paste` में जोड़ें।",
  "Atmosphere runs kube-prometheus-stack with its own alert rules, and Loki with Vector for logs. Forward its alerts first, then a probe reads the APIs and the Kubernetes agent sees the pods.":
    "Atmosphere अपने अलर्ट नियमों के साथ kube-prometheus-stack चलाता है, और लॉग के लिए Vector के साथ Loki। पहले इसके अलर्ट आगे भेजें, फिर एक प्रोब API पढ़ता है और Kubernetes एजेंट पॉड देखता है।",
  "**How far this guide has been tested:** Its configuration was read from Atmosphere's own docs and source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**यह गाइड कहाँ तक परखी गई है:** इसका कॉन्फ़िगरेशन Atmosphere के अपने दस्तावेज़ों और सोर्स से पढ़ा गया। इसे इस टूल की किसी असली तैनाती पर शुरू से अंत तक नहीं चलाया गया है। एजेंट और एक प्रोब, दोनों ने अलग-अलग एक असली DevStack को रुके हुए nova-compute से होकर और वापस, एक चालू OneUptime तक पूरा पहुँचाया है, लेकिन इस टूल से नहीं। प्रोब और Kubernetes एजेंट को अलग-अलग परखा गया, इस टूल पर एक साथ नहीं।",
  "Then add the receiver to your Atmosphere configuration, beside whichever receivers you already have, and deploy it:":
    "फिर रिसीवर को अपने Atmosphere कॉन्फ़िगरेशन में जोड़ें, आपके पहले से मौजूद रिसीवरों के बगल में, और उसे तैनात करें:",
  "For who did what through Nova, Neutron and Cinder, the charts Atmosphere deploys already have the audit filter in each pipeline, and it needs telling where to write, in `nova_helm_values`, `neutron_helm_values` and `cinder_helm_values`. Glance's chart has neither the filter nor a place for it in its pipelines: add both to its `conf.paste`, in `glance_helm_values`.":
    "Nova, Neutron और Cinder के ज़रिए किसने क्या किया, यह जानने के लिए, Atmosphere जो चार्ट तैनात करता है उनमें हर पाइपलाइन में ऑडिट फ़िल्टर पहले से है, और उसे `nova_helm_values`, `neutron_helm_values` और `cinder_helm_values` में बताना होता है कि कहाँ लिखे। Glance के चार्ट में न फ़िल्टर है न उसकी पाइपलाइनों में उसकी जगह: दोनों को `glance_helm_values` में उसके `conf.paste` में जोड़ें।",
  "Sunbeam can deploy the Canonical Observability Stack, with `sunbeam enable observability embedded`. Canonical also has an `openstack-exporter` charm, which the agent can read if you run it.":
    "Sunbeam `sunbeam enable observability embedded` से Canonical Observability Stack तैनात कर सकता है। Canonical के पास एक `openstack-exporter` charm भी है, जिसे आप चलाएँ तो एजेंट पढ़ सकता है।",
  "**How far this guide has been tested:** Its commands were read from Canonical's docs and its charms' source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. Nothing here has been run on Sunbeam, and Sunbeam's own docs do not mention the exporter charm.":
    "**यह गाइड कहाँ तक परखी गई है:** इसकी कमांड Canonical के दस्तावेज़ों और उसके charm के सोर्स से पढ़ी गईं। इसे इस टूल की किसी असली तैनाती पर शुरू से अंत तक नहीं चलाया गया है। एजेंट और एक प्रोब, दोनों ने अलग-अलग एक असली DevStack को रुके हुए nova-compute से होकर और वापस, एक चालू OneUptime तक पूरा पहुँचाया है, लेकिन इस टूल से नहीं। यहाँ का कुछ भी Sunbeam पर नहीं चलाया गया है, और Sunbeam के अपने दस्तावेज़ एक्सपोर्टर charm का ज़िक्र नहीं करते।",
  "Then give the stack's Alertmanager a configuration with the receiver in it:":
    "फिर स्टैक के Alertmanager को ऐसा कॉन्फ़िगरेशन दें जिसमें रिसीवर हो:",
  "If you run Canonical's `openstack-exporter` charm, the agent can read it with no credential of its own. It answers one cloud on `/metrics`, on port `9180` unless you changed its `port` setting. Find its address with `juju status openstack-exporter`:":
    "अगर आप Canonical का `openstack-exporter` charm चलाते हैं, तो एजेंट उसे अपने किसी क्रेडेंशियल के बिना पढ़ सकता है। यह `/metrics` पर एक क्लाउड के लिए जवाब देता है, पोर्ट `9180` पर, जब तक आपने इसकी `port` सेटिंग नहीं बदली। इसका पता `juju status openstack-exporter` से खोजें:",
  "Which series it says depends on the exporter release in its snap, which was not recorded here: `bash troubleshoot.sh` says whether it reads the cloud.":
    "यह कौन-सी सीरीज़ देता है, यह इसके snap में मौजूद एक्सपोर्टर रिलीज़ पर निर्भर है, जो यहाँ दर्ज नहीं किया गया: `bash troubleshoot.sh` बताता है कि यह क्लाउड पढ़ता है या नहीं।",
  "With observability on, the stack's Loki holds the services' logs. OneUptime has no way to read Loki, and the agent's logs profile has not been tried on Sunbeam's charms, so nothing here collects them yet.":
    "observability चालू होने पर स्टैक का Loki सेवाओं के लॉग रखता है। OneUptime के पास Loki पढ़ने का कोई तरीका नहीं है, और एजेंट की लॉग प्रोफ़ाइल Sunbeam के charm पर आज़माई नहीं गई है, इसलिए यहाँ अभी कुछ भी उन्हें एकत्र नहीं करता।",
  "Sunbeam's charms write each service's configuration from their own templates, and its Keystone charm has no setting for where notifications go. So neither Keystone's audit trail nor the audit filter can be turned on from outside the charm, and nothing here reaches Security Events.":
    "Sunbeam के charm हर सेवा का कॉन्फ़िगरेशन अपने टेम्पलेट से लिखते हैं, और इसके Keystone charm में सूचनाएँ कहाँ जाएँ, इसकी कोई सेटिंग नहीं है। इसलिए न Keystone का ऑडिट ट्रेल और न ऑडिट फ़िल्टर charm के बाहर से चालू किया जा सकता है, और यहाँ से कुछ भी सुरक्षा इवेंट तक नहीं पहुँचता।",
  "Its Telemetry Operator runs Ceilometer's Prometheus exporter and a monitoring stack with Alertmanager on OpenShift. The Kubernetes agent's OpenShift preset watches the control plane, and Ceilometer's exporter says what the compute nodes are doing.":
    "इसका Telemetry Operator OpenShift पर Ceilometer का Prometheus एक्सपोर्टर और Alertmanager वाला एक मॉनिटरिंग स्टैक चलाता है। Kubernetes एजेंट का OpenShift प्रीसेट कंट्रोल प्लेन की निगरानी करता है, और Ceilometer का एक्सपोर्टर बताता है कि कंप्यूट नोड क्या कर रहे हैं।",
  "**How far this guide has been tested:** Its resources were read from the Telemetry Operator's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The OpenShift preset and Ceilometer's exporter were each tested on their own, not together on this tool.":
    "**यह गाइड कहाँ तक परखी गई है:** इसके संसाधन Telemetry Operator के अपने सोर्स से पढ़े गए। इसे इस टूल की किसी असली तैनाती पर शुरू से अंत तक नहीं चलाया गया है। एजेंट और एक प्रोब, दोनों ने अलग-अलग एक असली DevStack को रुके हुए nova-compute से होकर और वापस, एक चालू OneUptime तक पूरा पहुँचाया है, लेकिन इस टूल से नहीं। OpenShift प्रीसेट और Ceilometer के एक्सपोर्टर को अलग-अलग परखा गया, इस टूल पर एक साथ नहीं।",
  "Then apply a receiver the monitoring stack picks up:":
    "फिर ऐसा रिसीवर लागू करें जिसे मॉनिटरिंग स्टैक उठा ले:",
  "Follow **Kubernetes → Documentation** for this cluster, with **Red Hat OpenShift** picked, which sets `preset=openshift`. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "इस क्लस्टर के लिए **Kubernetes → दस्तावेज़ीकरण** का पालन करें, **Red Hat OpenShift** चुनकर, जो `preset=openshift` सेट करता है। तब इसके पॉड, उनके लॉग और उनके नोड Kubernetes पृष्ठों तक पहुँचते हैं, और उनमें शामिल OpenStack सेवाओं की निगरानी वहीं होती है।",
  "A probe says what is allocated, not what is busy. To read real usage, run the agent on a machine that can reach the compute nodes, with `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` naming each node on Ceilometer's port, `9101`.":
    "प्रोब बताता है कि क्या आवंटित है, यह नहीं कि क्या व्यस्त है। असली उपयोग पढ़ने के लिए, एजेंट को ऐसी मशीन पर चलाएँ जो कंप्यूट नोड तक पहुँच सके, `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` में हर नोड को Ceilometer के पोर्ट `9101` पर देते हुए।",
  "For who did what through Nova and Neutron, each takes the filter's setting in its `customServiceConfig`, and its paste file in `defaultConfigOverwrite`. Cinder's and Glance's operators take no paste file, so nothing here reaches them.":
    "Nova और Neutron के ज़रिए किसने क्या किया, यह जानने के लिए, हर एक फ़िल्टर की सेटिंग अपने `customServiceConfig` में लेता है, और अपनी paste फ़ाइल `defaultConfigOverwrite` में। Cinder और Glance के ऑपरेटर कोई paste फ़ाइल नहीं लेते, इसलिए यहाँ से कुछ भी उन तक नहीं पहुँचता।",
  "StackLight already watches OpenStack's services, MariaDB, Memcached, RabbitMQ and libvirt, with its own alert rules. Forward its alerts first, then a probe reads the APIs.":
    "StackLight अपने अलर्ट नियमों के साथ OpenStack की सेवाओं, MariaDB, Memcached, RabbitMQ और libvirt की पहले से निगरानी करता है। पहले इसके अलर्ट आगे भेजें, फिर एक प्रोब API पढ़ता है।",
  "**How far this guide has been tested:** Its settings were read from Mirantis's docs, whose examples show other receivers rather than a webhook. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**यह गाइड कहाँ तक परखी गई है:** इसकी सेटिंग Mirantis के दस्तावेज़ों से पढ़ी गईं, जिनके उदाहरण webhook के बजाय दूसरे रिसीवर दिखाते हैं। इसे इस टूल की किसी असली तैनाती पर शुरू से अंत तक नहीं चलाया गया है। एजेंट और एक प्रोब, दोनों ने अलग-अलग एक असली DevStack को रुके हुए nova-compute से होकर और वापस, एक चालू OneUptime तक पूरा पहुँचाया है, लेकिन इस टूल से नहीं।",
  "Then add the receiver and its route to your StackLight values:":
    "फिर रिसीवर और उसका रूट अपने StackLight मानों में जोड़ें:",
  "For who did what through Nova, Neutron, Cinder and Glance, MOSK has a setting of its own, with the audit filter already in place. With the log driver, each service writes to its standard output, and the Kubernetes agent reads that from the pods' logs, with the cloud named in its values. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "Nova, Neutron, Cinder और Glance के ज़रिए किसने क्या किया, यह जानने के लिए, MOSK की अपनी एक सेटिंग है, जिसमें ऑडिट फ़िल्टर पहले से मौजूद है। लॉग ड्राइवर के साथ हर सेवा अपने स्टैंडर्ड आउटपुट पर लिखती है, और Kubernetes एजेंट उसे पॉड के लॉग से पढ़ता है, अपने मानों में दिए गए क्लाउड के नाम के साथ। दोनों सेवा के अपने लॉग में लिखते हैं, बस पर कोई उपभोक्ता नहीं होता। **सुरक्षा इवेंट → कनेक्शन** में **अपने लॉग में सुरक्षा इवेंट खोजें** चालू होते ही OneUptime उन्हें वहीं से पढ़ता है।",
  "That setting does not cover Keystone. Its own audit trail takes `spec:services`, which Mirantis does not validate and takes no responsibility for, so weigh this with your support contract:":
    "वह सेटिंग Keystone को शामिल नहीं करती। इसका अपना ऑडिट ट्रेल `spec:services` लेता है, जिसे Mirantis सत्यापित नहीं करता और जिसकी कोई ज़िम्मेदारी नहीं लेता, इसलिए इसे अपने सपोर्ट अनुबंध के साथ तौलें:",
  "Keystone's audit trail says who signed in and who changed what in Keystone, and the audit filter says who did what through Nova, Neutron, Cinder and Glance. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "Keystone का ऑडिट ट्रेल बताता है कि किसने साइन इन किया और किसने Keystone में क्या बदला, और ऑडिट फ़िल्टर बताता है कि किसने Nova, Neutron, Cinder और Glance के ज़रिए क्या किया। दोनों सेवा के अपने लॉग में लिखते हैं, बस पर कोई उपभोक्ता नहीं होता। **सुरक्षा इवेंट → कनेक्शन** में **अपने लॉग में सुरक्षा इवेंट खोजें** चालू होते ही OneUptime उन्हें वहीं से पढ़ता है।",
  "The audit filter goes in each API's paste file, right after `authtoken` and the context filter that follows it in each pipeline, with the map file pyCADF ships for that service, in `etc/pycadf` under the Python environment the service runs in. Not at the end of a pipeline: Neutron's `extensions` filter answers its routers and security groups, and the filter would never see them.":
    "ऑडिट फ़िल्टर हर API की paste फ़ाइल में जाता है, हर पाइपलाइन में `authtoken` और उसके बाद आने वाले संदर्भ फ़िल्टर के ठीक बाद, उस मैप फ़ाइल के साथ जो pyCADF उस सेवा के लिए देता है, उस Python वातावरण के `etc/pycadf` में जिसमें सेवा चलती है। पाइपलाइन के अंत में नहीं: Neutron का `extensions` फ़िल्टर उसके राउटर और सुरक्षा समूहों का जवाब देता है, और ऑडिट फ़िल्टर उन्हें कभी नहीं देखेगा।",
  "[Who did what](/docs/telemetry/openstack#who-did-what) says what reaches Security Events, and [each tool's guide](/docs/telemetry/openstack-deployment-tools) says where these go on it.":
    "[किसने क्या किया](/docs/telemetry/openstack#who-did-what) बताता है कि सुरक्षा इवेंट तक क्या पहुँचता है, और [हर टूल की गाइड](/docs/telemetry/openstack-deployment-tools) बताती है कि उस पर ये कहाँ जाते हैं।",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | नहीं | कलेक्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-agent`)। उसी मशीन पर दूसरे क्लाउड के एजेंट को अपने अलग नाम चाहिए: अगर आप इन्हें सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट नए एजेंट के कंटेनरों के नाम उसके फ़ोल्डर पर रखती है, और स्क्रिप्ट फिर से चलाने पर उन्हें बनाए रखती है |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). The install script names a second cloud's bundled exporter after its collector (`oneuptime-openstack-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | नहीं | साथ आए एक्सपोर्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-exporter`)। अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट दूसरे क्लाउड के साथ आए एक्सपोर्टर का नाम उसके कलेक्टर के नाम पर रखती है (`oneuptime-openstack-exporter-cloud2`, `oneuptime-openstack-agent-cloud2` के बगल में), और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). The install script names a second cloud's quota exporter after its collector (`oneuptime-openstack-quota-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | नहीं | कोटा एक्सपोर्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-quota-exporter`)। अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट दूसरे क्लाउड के कोटा एक्सपोर्टर का नाम उसके कलेक्टर के नाम पर रखती है (`oneuptime-openstack-quota-exporter-cloud2`, `oneuptime-openstack-agent-cloud2` के बगल में), और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). The install script names a second cloud's database exporter after its collector (`oneuptime-openstack-database-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | नहीं | डेटाबेस एक्सपोर्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-database-exporter`)। अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट दूसरे क्लाउड के डेटाबेस एक्सपोर्टर का नाम उसके कलेक्टर के नाम पर रखती है (`oneuptime-openstack-database-exporter-cloud2`, `oneuptime-openstack-agent-cloud2` के बगल में), और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). The install script names a second cloud's worker state exporter after its collector (`oneuptime-openstack-worker-state-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | नहीं | वर्कर स्थिति एक्सपोर्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-worker-state-exporter`)। अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट दूसरे क्लाउड के वर्कर स्थिति एक्सपोर्टर का नाम उसके कलेक्टर के नाम पर रखती है (`oneuptime-openstack-worker-state-exporter-cloud2`, `oneuptime-openstack-agent-cloud2` के बगल में), और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). The install script names a second cloud's AI agent after its collector (`oneuptime-openstack-ai-agent-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | नहीं | AI एजेंट के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-ai-agent`)। अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट दूसरे क्लाउड के AI एजेंट का नाम उसके कलेक्टर के नाम पर रखती है (`oneuptime-openstack-ai-agent-cloud2`, `oneuptime-openstack-agent-cloud2` के बगल में), और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "One agent reads one cloud. For a second cloud, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "एक एजेंट एक क्लाउड पढ़ता है। दूसरे क्लाउड के लिए, दूसरा एजेंट उसके अपने फ़ोल्डर में, उसके अपने कंटेनर नामों के साथ इंस्टॉल करें — दो कंटेनर एक ही नाम नहीं रख सकते:",
  "The script names the containers after the folder, such as `oneuptime-openstack-agent-cloud2`, unless you set their variables, such as `OPENSTACK_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "अगर आप उनके वेरिएबल सेट नहीं करते, जैसे `OPENSTACK_AGENT_CONTAINER_NAME`, तो स्क्रिप्ट कंटेनरों के नाम फ़ोल्डर पर रखती है, जैसे `oneuptime-openstack-agent-cloud2`। स्क्रिप्ट ये नाम उस एजेंट की `.env` में सहेज लेती है, इसलिए एजेंट अपग्रेड करने के लिए उसी `INSTALL_DIR` के साथ स्क्रिप्ट फिर से चलाने पर भी नाम बने रहते हैं, और जिस एजेंट का `container_name` आपने कभी `docker-compose.yml` में बदला था, वह वही नाम रखता है।",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "हर फ़ोल्डर को अपना अलग नाम दें: Docker Compose किसी प्रोजेक्ट का नाम सिर्फ़ उसके फ़ोल्डर पर रखता है, इसलिए स्क्रिप्ट ऐसे फ़ोल्डर को अस्वीकार करती है जिसका नाम उस फ़ोल्डर जैसा हो जो पहले से कहीं और एजेंट चला रहा है। फ़ोल्डर को डायग्नोस्टिक स्क्रिप्ट को `-d` से दें।",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | नहीं | कलेक्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-agent`)। उसी मशीन पर दूसरे क्लाउड के एजेंट को अपना अलग नाम चाहिए |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | नहीं | साथ आए एक्सपोर्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-exporter`)। उसी मशीन पर दूसरे क्लाउड के एजेंट को अपना अलग नाम चाहिए |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | नहीं | कोटा एक्सपोर्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-quota-exporter`)। उसी मशीन पर दूसरे क्लाउड के एजेंट को अपना अलग नाम चाहिए |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | नहीं | डेटाबेस एक्सपोर्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-database-exporter`)। उसी मशीन पर दूसरे क्लाउड के एजेंट को अपना अलग नाम चाहिए |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | नहीं | वर्कर स्थिति एक्सपोर्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-worker-state-exporter`)। उसी मशीन पर दूसरे क्लाउड के एजेंट को अपना अलग नाम चाहिए |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | नहीं | AI एजेंट के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-openstack-ai-agent`)। उसी मशीन पर दूसरे क्लाउड के एजेंट को अपना अलग नाम चाहिए |",
  "One agent reads one cloud. For a second cloud, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "एक एजेंट एक क्लाउड पढ़ता है। दूसरे क्लाउड के लिए, दूसरा एजेंट उसके अपने फ़ोल्डर में, उसके अपने कंटेनर नामों के साथ सेट अप करें — दो कंटेनर एक ही नाम नहीं रख सकते। नाम उस एजेंट की `.env` में सेट करें:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "हर फ़ोल्डर को अपना अलग नाम दें: Docker Compose किसी प्रोजेक्ट का नाम सिर्फ़ उसके फ़ोल्डर पर रखता है, इसलिए उसी नाम का दूसरा फ़ोल्डर पहले एजेंट के कंटेनरों की जगह ले लेगा। नाम `docker-compose.yml` में न रखें, जिसे अपग्रेड बदल देता है।",
};

export default TRANSLATION;
