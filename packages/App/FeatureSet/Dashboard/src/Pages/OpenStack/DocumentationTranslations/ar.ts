import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The OpenStack setup guide in Arabic (#8341): each piece of the English
 * guide's markdown (Pages/OpenStack/Utils/DocumentationMarkdown.ts) and its
 * Arabic. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Arabic words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "With `enable_prometheus` on in `/etc/kolla/globals.yml`, which Kolla-Ansible leaves off until you set it, it runs Prometheus, Alertmanager and an exporter for each thing under the cloud, and ships no alert rules. This guide reads what those run rather than starting a second copy.":
    "عند تشغيل `enable_prometheus` في `/etc/kolla/globals.yml`، وهو ما يتركه Kolla-Ansible متوقفًا حتى تضبطه، يشغّل Prometheus وAlertmanager ومُصدِّرًا لكل مكوّن تحت السحابة، ولا يأتي بأي قواعد تنبيه. يقرأ هذا الدليل ما تشغّله هذه بدلًا من بدء نسخة ثانية.",
  "**How far this guide has been tested:** Its paths and ports were read from Kolla-Ansible's own source. Its commands were then run on a real all-in-one at stable/2026.1 with Open vSwitch, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, without Docker, on Kolla-Ansible's own exporter and on your own at the pinned version and at 1.7.0, the agent's exporter on the Infrastructure only credential, the targets read from its real prometheus.yml, and the logs profile. With Memcached really stopped there, its Alertmanager posted a firing webhook and then a resolved one, and what it posted, sent to a running OneUptime, opened one incident on the right cloud and on no other, and resolved it. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**إلى أي حد اختُبر هذا الدليل:** قُرئت مساراته ومنافذه من الشيفرة المصدرية لـ Kolla-Ansible نفسه. ثم شُغّلت أوامره على all-in-one حقيقي بإصدار stable/2026.1 مع Open vSwitch، مع بديل لـ OneUptime يحتفظ بما أرسله الوكيل: الوكيل ببيانات اعتماد العرض الكامل، دون Docker، على مُصدِّر Kolla-Ansible نفسه وعلى مُصدِّرك أنت بالإصدار المثبّت وبالإصدار 1.7.0، ومُصدِّر الوكيل ببيانات اعتماد البنية التحتية فقط، والأهداف المقروءة من ملف prometheus.yml الحقيقي الخاص به، وملف تعريف السجلات. وعندما أُوقف Memcached هناك فعلًا، أرسل Alertmanager الخاص به إشعار Webhook بالإطلاق ثم آخر بالحل، وما أرسله، حين وصل إلى OneUptime قيد التشغيل، فتح حادثة واحدة على السحابة الصحيحة دون غيرها، ثم حلّها. أوصل كلٌّ من الوكيل والمسبار نظام DevStack حقيقيًا إلى OneUptime قيد التشغيل، مرورًا بإيقاف nova-compute وإعادته، لكن ليس من هذه الأداة.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent (or `bash install.sh --without-docker`, under Advanced)":
    "Docker Engine 20.10+ مع إضافة Docker Compose v2، على الجهاز الذي سيشغّل الوكيل (أو `bash install.sh --without-docker`، ضمن متقدم)",
  "A machine outside the cloud it watches: an agent inside a failed cloud goes quiet with it":
    "جهاز خارج السحابة التي يراقبها: الوكيل داخل سحابة متعطلة يصمت معها",
  "That machine can reach Keystone and every service's API":
    "يستطيع ذلك الجهاز الوصول إلى Keystone وإلى واجهة API لكل خدمة",
  "The `openstack` command line, as someone who can create the credential below":
    "سطر أوامر `openstack`، بصفة شخص يستطيع إنشاء بيانات الاعتماد أدناه",
  "An alert that fires becomes an incident, with on-call and status pages from the first hour, and it resolves when the alert does. There is nothing to install.":
    "يصبح التنبيه الذي ينطلق حادثة، مع المناوبة وصفحات الحالة منذ الساعة الأولى، ويُحلّ عندما يُحلّ التنبيه. لا يوجد ما يلزم تثبيته.",
  "1. In OneUptime, make an Incoming Request monitor as [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) says, and copy its **Heartbeat URL**. That is the `<secret key>` address below.":
    "1. في OneUptime، أنشئ مراقبًا من نوع طلب وارد كما يشرح [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor)، وانسخ **عنوان URL لنبضات القلب** الخاص به. هذا هو العنوان الذي يحتوي على `<secret key>` أدناه.",
  "2. Open the monitor's **Overview → Linked Resources** and add the OpenStack cloud `my-openstack-cloud`. Each incident is then on that cloud's **Incidents** page, so each cloud's Alertmanager needs a monitor of its own. The cloud shows up in that list once its first data arrives, so do this after the steps below, or add the cloud under **OpenStack → All Clouds** first.":
    "2. افتح **نظرة عامة ← الموارد المرتبطة** في المراقب وأضف سحابة OpenStack المسماة `my-openstack-cloud`. عندئذٍ تظهر كل حادثة في صفحة **الحوادث** لتلك السحابة، لذا يحتاج Alertmanager كل سحابة إلى مراقب خاص به. تظهر السحابة في تلك القائمة بمجرد وصول بياناتها الأولى، لذا افعل هذا بعد الخطوات أدناه، أو أضف السحابة أولًا ضمن **OpenStack ← كل السحابات**.",
  "Then, on the host you deploy from, write `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, which Kolla-Ansible reads in place of its own, and apply it:":
    "ثم، على المضيف الذي تنشر منه، اكتب `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`، الذي يقرؤه Kolla-Ansible بدلًا من ملفه، وطبّقه:",
  "- Log in as an admin with `source /etc/kolla/admin-openrc.sh`, which `kolla-ansible post-deploy` writes.":
    "- سجّل الدخول بصفة مسؤول باستخدام `source /etc/kolla/admin-openrc.sh`، الذي يكتبه `kolla-ansible post-deploy`.",
  "- **Full view** needs one change, to Cinder. Kolla-Ansible's templates already set `service_type` under `[keystone_authtoken]` on Nova, Neutron, Glance and Placement, but its Cinder says `volume` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Add `service_type = block-storage` under `[keystone_authtoken]` in `/etc/kolla/config/cinder.conf`, then run `kolla-ansible reconfigure -i <inventory> --tags cinder`.":
    "- يحتاج **عرض كامل** إلى تغيير واحد في Cinder. تضبط قوالب Kolla-Ansible بالفعل `service_type` تحت `[keystone_authtoken]` في Nova وNeutron وGlance وPlacement، لكن Cinder الخاص به يقول `volume` وكتالوجه يقول `block-storage`، ويرفض keystonemiddleware بيانات الاعتماد المقيدة بقواعد الوصول بالرمز `401` ما لم يتطابق الاثنان. أضف `service_type = block-storage` تحت `[keystone_authtoken]` في `/etc/kolla/config/cinder.conf`، ثم شغّل `kolla-ansible reconfigure -i <inventory> --tags cinder`.",
  "- **Infrastructure only** takes its overrides at `/etc/kolla/config/nova/policy.yaml`, and the same for `neutron`, `keystone` and `placement`, merged with anything already there. Apply them with `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.":
    "- يأخذ **البنية التحتية فقط** تجاوزاته في `/etc/kolla/config/nova/policy.yaml`، وكذلك لـ `neutron` و`keystone` و`placement`، مدموجة مع أي شيء موجود هناك. طبّقها باستخدام `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.",
  "**Recommended.** The agent sees everything it reads: services, hypervisors, every project's instances, volumes, networks and routers, and `cinder-volume` and `cinder-scheduler` state and storage pools, which only this level sees. It leaves out Keystone's users and groups, on purpose.":
    "**موصى به.** يرى الوكيل كل ما يقرؤه: الخدمات، والمشرفين الافتراضيين، ومثيلات كل مشروع ووحدات تخزينه وشبكاته وموجّهاته، وحالة `cinder-volume` و`cinder-scheduler` وتجمّعات التخزين، التي لا يراها إلا هذا المستوى. ويستبعد عمدًا مستخدمي Keystone ومجموعاته.",
  "This is an application credential on an account with `admin` on a project of its own, limited by access rules to the exact `GET` calls the agent makes, so it cannot write: on every release we record, every read answered `200` and every write `401`. As an admin, make the project and the account:":
    "هذه بيانات اعتماد تطبيق لحساب لديه `admin` على مشروع خاص به، مقيدة بقواعد الوصول بطلبات `GET` التي يجريها الوكيل بالضبط، لذا لا تستطيع الكتابة: في كل إصدار نسجّله، أجابت كل قراءة بالرمز `200` وكل كتابة بالرمز `401`. بصفتك مسؤولًا، أنشئ المشروع والحساب:",
  "Then, logged in as that account on that project, make the credential. An access rule is matched against the path the service sees, and a service behind a path prefix refuses the shipped rules with a `401`, so these commands fit them to this cloud from its catalog first:":
    "ثم، وأنت مسجّل الدخول بذلك الحساب على ذلك المشروع، أنشئ بيانات الاعتماد. تُطابَق قاعدة الوصول مع المسار الذي تراه الخدمة، والخدمة الموجودة خلف بادئة مسار ترفض القواعد المرفقة بالرمز `401`، لذا تكيّف هذه الأوامر القواعد أولًا مع هذه السحابة من كتالوجها:",
  "- Copy the `id` and the `secret` it prints: the secret is shown only once.":
    "- انسخ `id` و`secret` اللذين يطبعهما: لا يُعرض السر إلا مرة واحدة.",
  "- Never add `--unrestricted`, which would let it make more credentials.":
    "- لا تضف `--unrestricted` أبدًا، فهو يتيح لها إنشاء مزيد من بيانات الاعتماد.",
  "- Access rules work only where each service sets `service_type` in its `[keystone_authtoken]` section and has been restarted since: `compute`, `network`, `block-storage` (the rules also carry `volume` and `volumev3`, for a Cinder configured that way), `image` and `placement`. Keystone needs nothing. Without that, the services refuse the credential with a `401`.":
    "- لا تعمل قواعد الوصول إلا حيث تضبط كل خدمة `service_type` في قسم `[keystone_authtoken]` الخاص بها وأُعيد تشغيلها منذ ذلك الحين: `compute` و`network` و`block-storage` (تحمل القواعد أيضًا `volume` و`volumev3`، لنظام Cinder المضبوط بهذه الطريقة) و`image` و`placement`. لا يحتاج Keystone إلى شيء. ومن دون ذلك، ترفض الخدمات بيانات الاعتماد بالرمز `401`.",
  "- If you won't change that, leave out `--access-rules`. That makes a plain admin application credential, which can write as well as read, so keep it as safe as an admin password.":
    "- إن لم تكن ستغيّر ذلك، فاحذف `--access-rules`. ينتج عن ذلك بيانات اعتماد تطبيق عادية لمسؤول، تستطيع الكتابة كما تستطيع القراءة، لذا احفظها بأمان كلمة مرور المسؤول.",
  "- It stops working when it expires. To replace it, make the second credential before you delete the first.":
    "- تتوقف عن العمل عند انتهاء صلاحيتها. لاستبدالها، أنشئ بيانات الاعتماد الثانية قبل حذف الأولى.",
  "No admin. The agent sees all of Keystone's projects, domains, services and endpoints, all of Nova including every project's instances, all of Placement, and Neutron's agents and address pools. Volumes, snapshots, networks, subnets, routers, floating IPs and ports appear only for the projects the role is assigned on, so on a project that holds nothing just the shared and external ones, and OneUptime can't see the others.":
    "دون مسؤول. يرى الوكيل كل مشاريع Keystone ونطاقاته وخدماته ونقاط نهايته، وكل Nova بما فيه مثيلات كل مشروع، وكل Placement، ووكلاء Neutron وتجمّعات عناوينه. لا تظهر وحدات التخزين واللقطات والشبكات والشبكات الفرعية والموجّهات وعناوين IP العائمة والمنافذ إلا للمشاريع المسندة إليها الدور، لذا على مشروع لا يحوي شيئًا لا يظهر إلا المشترك والخارجي منها، ولا يستطيع OneUptime رؤية البقية.",
  "It does not see `cinder-volume` or `cinder-scheduler` state or storage pools: Cinder's own code asks for an admin there, after policy has already passed, so no override opens them, and only **Full view** sees them.":
    "لا يرى حالة `cinder-volume` أو `cinder-scheduler` ولا تجمّعات التخزين: فشيفرة Cinder نفسها تطلب مسؤولًا هناك، بعد أن تكون السياسة قد سمحت بالفعل، لذا لا يفتحها أي تجاوز، ولا يراها إلا **عرض كامل**.",
  "This is a role of its own, `oneuptime_monitoring`, with the policy overrides the agent ships, on a project of its own that holds nothing and has zero quota. Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes. With nothing to touch and no quota to make anything with, there is nothing for it to write: on every release we record, every write answered `403`, or `409` and `413` from quota. As an admin, make the role, the project and an account:":
    "هذا دور مستقل، `oneuptime_monitoring`، مع تجاوزات السياسة التي يأتي بها الوكيل، على مشروع خاص به لا يحوي شيئًا وحصته صفر. وحيث يكون `enforce_new_defaults` متوقفًا في Cinder، وهو الإعداد الافتراضي لـ Cinder نفسه، يستطيع أي دور على مشروع إنشاء وحدات التخزين لذلك المشروع. ومع عدم وجود ما يُمسّ ولا حصة يُنشأ بها شيء، لا يوجد ما يكتبه: في كل إصدار نسجّله، أجابت كل كتابة بالرمز `403`، أو بالرمزين `409` و`413` بسبب الحصة. بصفتك مسؤولًا، أنشئ الدور والمشروع وحسابًا:",
  "Download the overrides, and merge each, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config. That is `/etc/nova/policy.yaml` and so on, unless your deployment says otherwise. Each override keeps the service's default and adds the role. oslo.policy notices a changed file on its own, so nothing restarts:":
    "نزّل التجاوزات، وادمج كلًّا منها، على كل وحدة تحكم، في الملف الذي يسمّيه `[oslo_policy] policy_file` في إعدادات تلك الخدمة. وهو `/etc/nova/policy.yaml` وهكذا، ما لم يقل نشرك غير ذلك. يحتفظ كل تجاوز بالإعداد الافتراضي للخدمة ويضيف الدور. يلاحظ oslo.policy الملف المتغيّر من تلقاء نفسه، لذا لا يُعاد تشغيل أي شيء:",
  "**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.":
    "**لإزالة التجاوزات مجددًا، أفرغ الملف (`{}`) ولا تحذفه أبدًا.** في Flamingo (2025.2) وEpoxy (2025.1)، يُطلق oslo.policy خطأً عند كل فحص بمجرد اختفاء ملف سياسة قرأه، فتفشل تلك الخدمة في كل طلب. وعندما تكون الخدمة Keystone، تتوقف عن التحقق من الرموز المميزة وتجيب السحابة كلها بالرمز `503`. إن كان ذلك قد حدث بالفعل، فأعد تشغيل الخدمة.",
  "Then, logged in as that account on that project, make the credential and copy the `id` and the `secret` it prints:":
    "ثم، وأنت مسجّل الدخول بذلك الحساب على ذلك المشروع، أنشئ بيانات الاعتماد وانسخ `id` و`secret` اللذين يطبعهما:",
  "Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. `troubleshoot.sh` warns when the credential's project holds things.":
    "إسناد الدور على مشروع حقيقي لرؤية وحدات تخزينه وموجّهاته يتيح للحساب أيضًا الكتابة هناك، على سحابة يكون فيها `enforce_new_defaults` متوقفًا في Cinder. يحذّر `troubleshoot.sh` عندما يحوي مشروع بيانات الاعتماد شيئًا.",
  "For a team watching its own part of a cloud someone else runs. The agent sees one project's volumes, networks and routers, and no infrastructure: no hypervisors, services or storage pools.":
    "لفريق يراقب جزءه الخاص من سحابة يديرها شخص آخر. يرى الوكيل وحدات تخزين مشروع واحد وشبكاته وموجّهاته، ولا يرى أي بنية تحتية: لا مشرفين افتراضيين ولا خدمات ولا تجمّعات تخزين.",
  "Through the agent it shows no instances at all: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.":
    "عبر الوكيل لا يعرض هذا المستوى أي مثيلات على الإطلاق: يطلب المُصدِّر من Nova خوادم كل المشاريع، فيرفض Nova القارئ العادي، وتفشل تلك القراءة بأكملها. لا يستطيع سرد مثيلات مشروع واحد إلا مسبار OneUptime يجمع البيانات دون هذا الوكيل.",
  "This is the plain `reader` role. Give an account the role on the project:":
    "هذا هو الدور العادي `reader`. امنح حسابًا هذا الدور على المشروع:",
  "Neutron and Cinder answer a reader with its own project and no error, so these lists look complete, and hold only that project.":
    "يجيب Neutron وCinder القارئ بمشروعه الخاص ودون خطأ، لذا تبدو هذه القوائم كاملة، وهي لا تحوي إلا ذلك المشروع.",
  "It may be able to write. On a cloud where Cinder has `enforce_new_defaults` off, which is Cinder's own default, plain `reader` can create volumes in its project too. On Epoxy, Flamingo and Gazpacho it did, and on Hibiscus it was refused, because DevStack only turns `enforce_new_defaults` on there.":
    "قد تتمكن من الكتابة. على سحابة يكون فيها `enforce_new_defaults` متوقفًا في Cinder، وهو الإعداد الافتراضي لـ Cinder نفسه، يستطيع `reader` العادي أيضًا إنشاء وحدات تخزين في مشروعه. حدث ذلك على Epoxy وFlamingo وGazpacho، ورُفض على Hibiscus، لأن DevStack لا يشغّل `enforce_new_defaults` إلا هناك.",
  "No credential and nothing new to run: the agent reads the exporter Kolla-Ansible already runs, through its internal VIP on `9198`. Skip the install's credential questions by giving it the address:":
    "لا بيانات اعتماد ولا شيء جديد للتشغيل: يقرأ الوكيل المُصدِّر الذي يشغّله Kolla-Ansible بالفعل، عبر عنوان VIP الداخلي الخاص به على `9198`. تجاوز أسئلة بيانات الاعتماد في التثبيت بإعطائه العنوان:",
  "Kolla-Ansible pins exporter 1.7.0 and runs it without `--multi-cloud`, so it has no `/probe`: the agent asks it for everything at once, every 2 minutes, on top of Kolla-Ansible's own Prometheus asking every minute. Its answer also says less. On five real clouds, the pages went without:":
    "يثبّت Kolla-Ansible المُصدِّر على الإصدار 1.7.0 ويشغّله دون `--multi-cloud`، لذا ليس لديه `/probe`: يطلب منه الوكيل كل شيء دفعة واحدة، كل دقيقتين، فوق Prometheus الخاص بـ Kolla-Ansible الذي يسأل كل دقيقة. كما أن إجابته تقول أقل. على خمس سحابات حقيقية، افتقدت الصفحات ما يلي:",
  "| Goes without | Because | What it costs |":
    "| ما ينقص | السبب | ما يكلّفه |",
  "| Everything of Cinder's | It asks the catalog for `volumev3`, and finds no such thing where Cinder registers as `block-storage` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, `cinder-volume` or `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |":
    "| كل ما يخص Cinder | يطلب `volumev3` من الكتالوج، ولا يجد شيئًا كهذا حيث يُسجَّل Cinder باسم `block-storage` | تبقى **وحدات التخزين** و**تجمّعات التخزين** فارغة، ولا يوجد في **الخدمات** أي Block Storage API ولا `cinder-volume` ولا `cinder-scheduler`. وتبقى **Block Storage API Down** و**Block Storage Service Down** و**Storage Pool Warning** و**Storage Pool Critical** و**Volumes in Error** و**Volume Stuck** صامتة |",
  "| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |":
    "| عدد المثيلات التي يحملها المشرف الافتراضي، ومجموعاته | تفشل قائمة المشرفين الافتراضيين في Nova عند أحدث إصدار فرعي، وهو ما يطلبه Kolla-Ansible | هذان في **المشرفون الافتراضيون**، وما يقول المضيف المفقود إنه يأخذه معه. تبقى وحدات vCPU والذاكرة والقرص الخاصة به ظاهرة: فهي تأتي من Placement |",
  "| Domains | It has no such series | **Domains** stays empty |":
    "| النطاقات | ليس لديه سلسلة كهذه | تبقى **النطاقات** فارغة |",
  "| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to `active` goes unnoticed |":
    "| حالة الصورة ورؤيتها وتاريخ إنشائها | ليس لديه تسميات كهذه | تلك الأعمدة في **الصور**. ويبقى **Image Stuck** صامتًا، فتمرّ الصورة العالقة في طريقها إلى `active` دون أن يلاحظها أحد |",
  "| A network's MTU | It has no such label | That line on a network's page |":
    "| قيمة MTU للشبكة | ليس لديه تسمية كهذه | ذلك السطر في صفحة الشبكة |",
  "If you need those, use one of the other tabs and the agent's own exporter. You can change your mind later: a cloud keeps its name whichever reads it.":
    "إن احتجت إلى هذه، فاستخدم إحدى علامات التبويب الأخرى ومُصدِّر الوكيل نفسه. يمكنك تغيير رأيك لاحقًا: تحتفظ السحابة باسمها أيًّا كان ما يقرؤها.",
  "The script asks for:": "يطلب البرنامج النصي:",
  "- **OneUptime URL and ingestion key**, both shown in step 1. Pick a key there to have them filled in here.":
    "- **عنوان URL لـ OneUptime ومفتاح الاستيعاب**، وكلاهما ظاهر في الخطوة 1. اختر مفتاحًا هناك لتُملأ هنا.",
  "- **Cloud name**: how the cloud appears in OneUptime. Keep it stable: a new name registers a new cloud.":
    "- **اسم السحابة**: الاسم الذي تظهر به السحابة في OneUptime. أبقه ثابتًا: الاسم الجديد يسجّل سحابة جديدة.",
  "- **Keystone auth URL**, such as `https://keystone.example.com:5000/v3`.":
    "- **عنوان URL للمصادقة في Keystone**، مثل `https://keystone.example.com:5000/v3`.",
  "- **Region names**, comma-separated (`RegionOne` if you have one).":
    "- **أسماء المناطق**، مفصولة بفواصل (`RegionOne` إن كانت لديك منطقة واحدة).",
  "- **Application credential**: the ID and secret from the previous step. Neither is echoed to the screen, and neither goes on a command line.":
    "- **بيانات اعتماد التطبيق**: المعرّف والسر من الخطوة السابقة. لا يُعرض أيٌّ منهما على الشاشة، ولا يوضع أيٌّ منهما في سطر أوامر.",
  "- **Private CA file**, only if the cloud's certificate comes from its own certificate authority.":
    "- **ملف المرجع المصدّق الخاص**، فقط إن كانت شهادة السحابة صادرة عن مرجع تصديق خاص بها.",
  "It checks the credential with Keystone before it installs anything, installs to `/opt/oneuptime-openstack-agent` (or to `oneuptime-openstack-agent` in your home folder if you have no rights on `/opt`, and it says which), writes a `.env` file and a `clouds.yaml` only their owner can read, and starts everything with Docker Compose. Running it again reuses all of that instead of asking again, so it is also how you upgrade.":
    "يتحقق من بيانات الاعتماد لدى Keystone قبل تثبيت أي شيء، ويثبّت في `/opt/oneuptime-openstack-agent` (أو في `oneuptime-openstack-agent` داخل مجلدك الرئيسي إن لم تكن لديك صلاحيات على `/opt`، ويخبرك أيهما)، ويكتب ملف `.env` وملف `clouds.yaml` لا يقرؤهما إلا مالكهما، ويشغّل كل شيء باستخدام Docker Compose. تشغيله مرة أخرى يعيد استخدام كل ذلك بدلًا من السؤال مجددًا، لذا فهو أيضًا طريقة الترقية.",
  "`docker compose ps` lists the collector (`oneuptime-openstack-agent`), the bundled exporter (`oneuptime-openstack-exporter`) and the OneUptime AI agent (`oneuptime-openstack-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cloud then appears in the **OpenStack** section by itself. Give it about five minutes to fill in: compute, network, volume and Placement are read every 2 minutes, identity and images every 5.":
    "يسرد `docker compose ps` المجمّع (`oneuptime-openstack-agent`) والمُصدِّر المرفق (`oneuptime-openstack-exporter`) ووكيل الذكاء الاصطناعي من OneUptime (`oneuptime-openstack-ai-agent`). في سجلات المجمّع، ابحث عن `Everything is ready. Begin running and processing data.` ثم تظهر السحابة من تلقاء نفسها في قسم **OpenStack**. امنحها نحو خمس دقائق لتمتلئ: تُقرأ الحوسبة والشبكة ووحدات التخزين وPlacement كل دقيقتين، والهوية والصور كل 5 دقائق.",
  "On the host that runs Kolla-Ansible's Prometheus, this reads its targets from the file Kolla-Ansible rendered, and prints them as settings for the agent:":
    "على المضيف الذي يشغّل Prometheus الخاص بـ Kolla-Ansible، يقرأ هذا أهدافه من الملف الذي أنشأه Kolla-Ansible، ويطبعها إعداداتٍ للوكيل:",
  "Add what it prints to the agent's `.env`, then run `docker compose up -d` in the agent's folder. Each exporter listens on the API network, so the agent's machine needs a route there. The cloud's **Control Plane** card then says how each one is, and says plainly which ones are not watched.":
    "أضف ما يطبعه إلى ملف `.env` الخاص بالوكيل، ثم شغّل `docker compose up -d` في مجلد الوكيل. يستمع كل مُصدِّر على شبكة واجهات API، لذا يحتاج جهاز الوكيل إلى مسار إليها. عندئذٍ تبيّن بطاقة **مستوى التحكم** للسحابة حال كل واحد منها، وتقول صراحة أيها غير مراقَب.",
  "| Reads | Port | Setting |": "| ما يقرؤه | المنفذ | الإعداد |",
  "| RabbitMQ's Prometheus plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |":
    "| إضافة Prometheus في RabbitMQ | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |",
  "| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |":
    "| mysqld_exporter، لـ MariaDB | `9104` | `OPENSTACK_MARIADB_TARGETS` |",
  "| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |":
    "| memcached_exporter، لـ Memcached | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |",
  "| HAProxy's own exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |":
    "| المُصدِّر الخاص بـ HAProxy نفسه | `9101` | `OPENSTACK_HAPROXY_TARGETS` |",
  "| openstack-network-exporter, for OVN and Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |":
    "| openstack-network-exporter، لـ OVN وOpen vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |",
  "| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |":
    "| prometheus-libvirt-exporter، لـ libvirt | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |",
  "- **OVN's databases:** Kolla-Ansible runs openstack-network-exporter from 2026.1, on compute and network nodes only, and an OVN database is read from the host it runs on. If your control nodes are neither, add them under `[prometheus-openstack-network-exporter:children]` in your inventory and reconfigure, or the Northbound and Southbound databases read as not watched.":
    "- **قواعد بيانات OVN:** يشغّل Kolla-Ansible أداة openstack-network-exporter بدءًا من 2026.1، على عقد الحوسبة والشبكة فقط، وتُقرأ قاعدة بيانات OVN من المضيف الذي تعمل عليه. إن لم تكن عقد التحكم لديك أيًّا منهما، فأضفها تحت `[prometheus-openstack-network-exporter:children]` في قائمة الجرد لديك وأعد الضبط، وإلا ظهرت قاعدتا بيانات Northbound وSouthbound غير مراقَبتين.",
  "- **Before 2026.1** there is no network exporter, so OVN and Open vSwitch read as not watched.":
    "- **قبل 2026.1** لا يوجد مُصدِّر للشبكة، لذا يظهر OVN وOpen vSwitch غير مراقَبين.",
  "The agent's logs profile runs on each node, and reads Kolla-Ansible's files. It is what joins a line to the cloud's pages:":
    "يعمل ملف تعريف السجلات الخاص بالوكيل على كل عقدة، ويقرأ ملفات Kolla-Ansible. وهو ما يربط السطر بصفحات السحابة:",
  "Kolla's own Fluentd can forward too, with an output in `/etc/kolla/config/fluentd/output/*.conf` as [Fluentd](/docs/telemetry/fluentd) describes, but those records reach **Logs** under a service's name, and not the cloud's pages.":
    "يستطيع Fluentd الخاص بـ Kolla أيضًا التمرير، بمخرج في `/etc/kolla/config/fluentd/output/*.conf` كما يصف [Fluentd](/docs/telemetry/fluentd)، لكن تلك السجلات تصل إلى **السجلات** باسم خدمة، لا إلى صفحات السحابة.",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from `/var/log/kolla`.":
    "يكتب كلٌّ منهما في سجل الخدمة نفسها، دون أي مستهلك على الناقل. يقرؤها OneUptime من هناك بمجرد تشغيل **العثور على الأحداث الأمنية في سجلاتك** ضمن **الأحداث الأمنية ← الاتصالات**. ويقرأ ملف تعريف السجلات الخاص بالوكيل كليهما من `/var/log/kolla`.",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.":
    "يرسل هذا سطرًا عن كل تسجيل دخول، يقرؤه **OpenStack admin credential used from a new address**. لإرسال محاولات الدخول الفاشلة فقط، أضف `identity.authenticate.success` إلى `notification_opt_out`، فيقرأ هذا الكشف عندئذٍ ما رآه مرشّح التدقيق.",
  "For who did what through Nova, Neutron, Cinder and Glance, the audit filter needs a setting, which goes in every service's config at once:":
    "لمعرفة من فعل ماذا عبر Nova وNeutron وCinder وGlance، يحتاج مرشّح التدقيق إلى إعداد يوضع في إعدادات كل الخدمات دفعة واحدة:",
  "It also needs a paste file, and Kolla-Ansible's config tasks copy no paste file for these services. Put yours on each API host, and mount it over the one in the image with `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` and `glance_api_extra_volumes` in `globals.yml`. pyCADF's map files are in `/var/lib/kolla/venv/etc/pycadf` in the image. [Who did what](/docs/telemetry/openstack#who-did-what) has the filter's lines.":
    "ويحتاج أيضًا إلى ملف paste، ولا تنسخ مهام الإعداد في Kolla-Ansible أي ملف paste لهذه الخدمات. ضع ملفك على كل مضيف API، وركّبه فوق الملف الموجود في الصورة باستخدام `nova_api_extra_volumes` و`neutron_server_extra_volumes` و`cinder_api_extra_volumes` و`glance_api_extra_volumes` في `globals.yml`. توجد ملفات الربط الخاصة بـ pyCADF في `/var/lib/kolla/venv/etc/pycadf` داخل الصورة. أسطر المرشّح موجودة في [من فعل ماذا](/docs/telemetry/openstack#who-did-what).",
  "OpenStack's `reader` role is scoped to a project everywhere except Keystone and Ironic, and hypervisors, services, agents, pools and Placement default to admin. A policy override can't open all-project lists in Cinder or Neutron, because they scope those lists in code, and Cinder's own code keeps its services and storage pools for an admin. So what a credential can read depends on which level you choose. This is what five real clouds answered, on Epoxy, Flamingo, Gazpacho (OVN and OVS) and Hibiscus:":
    "دور `reader` في OpenStack محصور في مشروع واحد في كل مكان عدا Keystone وIronic، والمشرفون الافتراضيون والخدمات والوكلاء والتجمّعات وPlacement مقصورة افتراضيًا على المسؤول. لا يستطيع تجاوز السياسة فتح قوائم كل المشاريع في Cinder أو Neutron، لأنهما يحصران تلك القوائم في الشيفرة، وشيفرة Cinder نفسها تحتفظ بخدماته وتجمّعات تخزينه للمسؤول. لذا فما تستطيع بيانات الاعتماد قراءته يتوقف على المستوى الذي تختاره. هذا ما أجابت به خمس سحابات حقيقية، على Epoxy وFlamingo وGazpacho (OVN وOVS) وHibiscus:",
  "| Read | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |":
    "| القراءة | المستوى 1: عرض كامل | المستوى 2: البنية التحتية فقط | المستوى 3: عرض المشروع |",
  "| Keystone: projects | all | all | refused |":
    "| Keystone: المشاريع | الكل | الكل | مرفوض |",
  "| Keystone: domains | all | all | refused |":
    "| Keystone: النطاقات | الكل | الكل | مرفوض |",
  "| Keystone: regions | all | what anyone sees | what anyone sees |":
    "| Keystone: المناطق | الكل | ما يراه الجميع | ما يراه الجميع |",
  "| Keystone: services | all | all | refused |":
    "| Keystone: الخدمات | الكل | الكل | مرفوض |",
  "| Keystone: endpoints | all | all | refused |":
    "| Keystone: نقاط النهاية | الكل | الكل | مرفوض |",
  "| Nova: servers, all projects | all | all | refused |":
    "| Nova: الخوادم، كل المشاريع | الكل | الكل | مرفوض |",
  "| Nova: services | all | all | refused |":
    "| Nova: الخدمات | الكل | الكل | مرفوض |",
  "| Nova: hypervisors | all | all | refused |":
    "| Nova: المشرفون الافتراضيون | الكل | الكل | مرفوض |",
  "| Nova: aggregates | all | all | refused |":
    "| Nova: المجموعات | الكل | الكل | مرفوض |",
  "| Nova: availability zones, detail | all | all | refused |":
    "| Nova: مناطق التوفر، بالتفصيل | الكل | الكل | مرفوض |",
  "| Nova: flavors | all | what anyone sees | what anyone sees |":
    "| Nova: النكهات | الكل | ما يراه الجميع | ما يراه الجميع |",
  "| Nova: usage per project | all | all | refused |":
    "| Nova: الاستخدام لكل مشروع | الكل | الكل | مرفوض |",
  "| Placement: resource providers | all | all | refused |":
    "| Placement: مزوّدو الموارد | الكل | الكل | مرفوض |",
  "| Neutron: agents | all | all | nothing |":
    "| Neutron: الوكلاء | الكل | الكل | لا شيء |",
  "| Neutron: networks | all | own project only | own project only |":
    "| Neutron: الشبكات | الكل | مشروعه فقط | مشروعه فقط |",
  "| Neutron: subnets | all | own project only | own project only |":
    "| Neutron: الشبكات الفرعية | الكل | مشروعه فقط | مشروعه فقط |",
  "| Neutron: routers | all | own project only | own project only |":
    "| Neutron: الموجّهات | الكل | مشروعه فقط | مشروعه فقط |",
  "| Neutron: floating IPs | all | own project only | own project only |":
    "| Neutron: عناوين IP العائمة | الكل | مشروعه فقط | مشروعه فقط |",
  "| Neutron: IP availabilities | all | all | nothing |":
    "| Neutron: توفر عناوين IP | الكل | الكل | لا شيء |",
  "| Neutron: security groups | all | 409, expected | own project only |":
    "| Neutron: مجموعات الأمان | الكل | 409، متوقَّع | مشروعه فقط |",
  "| Neutron: ports | all | own project only | own project only |":
    "| Neutron: المنافذ | الكل | مشروعه فقط | مشروعه فقط |",
  "| Neutron: quotas | all | refused | refused |":
    "| Neutron: الحصص | الكل | مرفوض | مرفوض |",
  "| Cinder: volumes, all projects | all | own project only | own project only |":
    "| Cinder: وحدات التخزين، كل المشاريع | الكل | مشروعه فقط | مشروعه فقط |",
  "| Cinder: services | all | refused | refused |":
    "| Cinder: الخدمات | الكل | مرفوض | مرفوض |",
  "| Cinder: pools | all | refused | refused |":
    "| Cinder: التجمّعات | الكل | مرفوض | مرفوض |",
  "| Cinder: snapshots, all projects | all | own project only | own project only |":
    "| Cinder: اللقطات، كل المشاريع | الكل | مشروعه فقط | مشروعه فقط |",
  "| Cinder: backups, all projects | all | none recorded | none recorded |":
    "| Cinder: النسخ الاحتياطية، كل المشاريع | الكل | لم يُسجَّل شيء | لم يُسجَّل شيء |",
  "| Cinder: volume types | all | what anyone sees | what anyone sees |":
    "| Cinder: أنواع وحدات التخزين | الكل | ما يراه الجميع | ما يراه الجميع |",
  "| Glance: images | all | what anyone sees | what anyone sees |":
    "| Glance: الصور | الكل | ما يراه الجميع | ما يراه الجميع |",
  "- **all**: the same rows an admin saw.":
    "- **الكل**: الصفوف نفسها التي رآها المسؤول.",
  "- **own project only**: that project's rows, and anything shared or external. On a project that holds nothing, that is just the shared and external ones.":
    "- **مشروعه فقط**: صفوف ذلك المشروع، وكل ما هو مشترك أو خارجي. على مشروع لا يحوي شيئًا، لا يكون ذلك إلا المشترك والخارجي.",
  "- **refused**: a `401` or a `403`.": "- **مرفوض**: رمز `401` أو `403`.",
  "- **what anyone sees**: every credential saw every row, on clouds that hold only public flavors, volume types and images. A private one in another project takes **Full view**.":
    "- **ما يراه الجميع**: رأت كل بيانات اعتماد كل صف، على سحابات لا تحوي إلا نكهات وأنواع وحدات تخزين وصورًا عامة. والعنصر الخاص في مشروع آخر يحتاج إلى **عرض كامل**.",
  "- **nothing**: a `200` with no rows, on a project that has networks too. It looks like it worked, and it did not.":
    "- **لا شيء**: رمز `200` دون صفوف، على مشروع فيه شبكات أيضًا. يبدو أنه نجح، ولم ينجح.",
  "- **none recorded**: a `200` with no rows where an admin saw none either, so there was nothing to tell by.":
    "- **لم يُسجَّل شيء**: رمز `200` دون صفوف حيث لم يرَ المسؤول شيئًا أيضًا، فلم يكن هناك ما يُستدل به.",
  "- **409, expected**: Neutron tries to create the project's default security group when it lists them, and zero quota does not let it, so it answers `409 Quota exceeded`. That is harmless, and nothing to fix.":
    "- **409، متوقَّع**: يحاول Neutron إنشاء مجموعة الأمان الافتراضية للمشروع عند سرد المجموعات، والحصة الصفرية لا تسمح بذلك، فيجيب بالرمز `409 Quota exceeded`. هذا غير ضار، ولا يوجد ما يلزم إصلاحه.",
  "A list a credential can't read looks empty here: `troubleshoot.sh` says what this credential can read, and what each gap costs.":
    "تبدو القائمة التي لا تستطيع بيانات الاعتماد قراءتها فارغة هنا: يبيّن `troubleshoot.sh` ما تستطيع بيانات الاعتماد هذه قراءته، وما تكلّفه كل ثغرة.",
  "Monitoring must never be what takes a cloud down, so the agent is gentle by default:":
    "يجب ألا تكون المراقبة أبدًا هي ما يُسقط السحابة، لذا يعمل الوكيل افتراضيًا برفق:",
  "| Reads | Every | Gives |": "| ما يقرؤه | كل | ما يقدّمه |",
  "| **Compute (Nova)** | 2 minutes | Services, hypervisors, instances and flavors |":
    "| **الحوسبة (Nova)** | دقيقتين | الخدمات والمشرفون الافتراضيون والمثيلات والنكهات |",
  "| **Placement** | 2 minutes | What each hypervisor can promise, and has promised |":
    "| **Placement** | دقيقتين | ما يستطيع كل مشرف افتراضي أن يعد به، وما وعد به |",
  "| **Networking (Neutron)** | 2 minutes | Agents, networks, subnets, address use, routers and floating IPs |":
    "| **الشبكات (Neutron)** | دقيقتين | الوكلاء والشبكات والشبكات الفرعية واستخدام العناوين والموجّهات وعناوين IP العائمة |",
  "| **Block Storage (Cinder)** | 2 minutes | Services, volumes, snapshots and storage pools |":
    "| **التخزين الكتلي (Cinder)** | دقيقتين | الخدمات ووحدات التخزين واللقطات وتجمّعات التخزين |",
  "| **Identity (Keystone)** | 5 minutes | Projects and domains |":
    "| **الهوية (Keystone)** | 5 دقائق | المشاريع والنطاقات |",
  "| **Images (Glance)** | 5 minutes | Images |":
    "| **الصور (Glance)** | 5 دقائق | الصور |",
  "- Each service is read on its own, so a failing Nova costs only Nova's numbers, and the rest keep reporting.":
    "- تُقرأ كل خدمة على حدة، لذا لا يكلّف تعطّل Nova إلا أرقام Nova، ويواصل الباقي الإبلاغ.",
  "- A read never outlasts its interval, so a slow one never stacks on the next.":
    "- لا تستغرق القراءة أبدًا أطول من فترتها، لذا لا تتراكم القراءة البطيئة أبدًا فوق التالية.",
  "- Each project's quotas are off. To turn them on, run the installer again with `OPENSTACK_COLLECT_QUOTAS=true`: a second exporter reads them once an hour, at four calls per project per region. Neutron's quotas answer only **Full view**.":
    "- حصص كل مشروع متوقفة. لتشغيلها، شغّل برنامج التثبيت مرة أخرى مع `OPENSTACK_COLLECT_QUOTAS=true`: يقرؤها مُصدِّر ثانٍ مرة كل ساعة، بأربعة طلبات لكل مشروع في كل منطقة. لا تجيب حصص Neutron إلا **عرض كامل**.",
  "- Nova's own quota lists and usage per server are off. To turn one on, delete its `--disable-metric` line from the exporter's `command` in `docker-compose.yml`. The cost is one call per project per scrape.":
    "- قوائم الحصص الخاصة بـ Nova والاستخدام لكل خادم متوقفة. لتشغيل أحدها، احذف سطر `--disable-metric` الخاص به من `command` المُصدِّر في `docker-compose.yml`. والكلفة طلب واحد لكل مشروع في كل جمع.",
  "- The per-port series are off: listing every port with an admin credential can saturate Neutron on a large cloud.":
    "- السلاسل الخاصة بكل منفذ متوقفة: سرد كل منفذ ببيانات اعتماد مسؤول قد يُشبع Neutron على سحابة كبيرة.",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Give the install script every region's name. It writes one `clouds.yaml` entry for each. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "السحابة هي Keystone واحد، مهما كان عدد مناطقها، ووكيل واحد يقرؤها كلها. أعطِ برنامج التثبيت النصي اسم كل منطقة. يكتب إدخالًا واحدًا في `clouds.yaml` لكل منها. يجب أن يحمل كل إدخال اسم منطقته: يضع المجمّع ذلك الاسم على سلاسل المُصدِّر باسم `openstack.region.name`، لأن السلاسل لا تقول من أي منطقة هي. عندئذٍ تُصفّى كل قائمة في OneUptime حسب المنطقة.",
  "Regions with a Keystone of their own are separate clouds to OneUptime: run one agent for each.":
    "المناطق التي لها Keystone خاص بها سحابات منفصلة بالنسبة إلى OneUptime: شغّل وكيلًا واحدًا لكل منها.",
  "**[Very Large OpenStack Clouds](/docs/telemetry/openstack-very-large-clouds)** has what each size costs and how each of these works.":
    "**[سحابات OpenStack الكبيرة جدًا](/docs/telemetry/openstack-very-large-clouds)** يشرح ما يكلّفه كل حجم وكيف يعمل كل من هذه الخيارات.",
  "**Past 5,000 instances, summary mode.** The cloud keeps a row for every part and counts per hypervisor, project and status, and its series per instance and per volume stop. It gives up the history of each settled instance's and volume's status, and a chart or a monitor over those series. An instance or volume in a state an alert watches keeps its series, so every alert template goes on working. To keep them for some, choose their projects under **Real usage per instance** on the cloud's **Settings** page.":
    "**بعد 5,000 مثيل، وضع الملخّص.** تحتفظ السحابة بصف لكل جزء وبأعداد لكل مشرف افتراضي ومشروع وحالة، وتتوقف سلاسلها لكل مثيل ولكل وحدة تخزين. وتتخلى عن سجل حالة كل مثيل ووحدة تخزين استقرّا، وعن أي مخطط أو مراقب على تلك السلاسل. يحتفظ المثيل أو وحدة التخزين في حالة يراقبها تنبيه بسلاسله، لذا يستمر كل قالب تنبيه في العمل. للاحتفاظ بها لبعضها، اختر مشاريعها ضمن **الاستخدام الفعلي لكل مثيل** في صفحة **الإعدادات** للسحابة.",
  "**Sharing a cloud between agents.** Run one agent per region, or per service for the largest clouds, each with the same `OPENSTACK_CLOUD_NAME`. A region and a service belong to one agent, and Keystone to one agent for the whole cloud, or their series arrive twice. List an agent's regions in `OPENSTACK_EXPORTER_CLOUDS`, and its services in `OPENSTACK_AGENT_SERVICES`, such as `compute|placement`.":
    "**تقاسم السحابة بين عدة وكلاء.** شغّل وكيلًا واحدًا لكل منطقة، أو لكل خدمة في أكبر السحابات، كلٌّ منها بقيمة `OPENSTACK_CLOUD_NAME` نفسها. تنتمي المنطقة والخدمة إلى وكيل واحد، وKeystone إلى وكيل واحد للسحابة كلها، وإلا وصلت سلاسلها مرتين. اسرد مناطق الوكيل في `OPENSTACK_EXPORTER_CLOUDS`، وخدماته في `OPENSTACK_AGENT_SERVICES`، مثل `compute|placement`.",
  "**Past 1,500 hypervisors or 100,000 instances, the database path.** The agent can read the cloud's databases rather than its APIs, which at that size cannot be read in a scrape's time. It asks for a read-only account on each service's database, a route to them from this machine, and one exporter per region and Nova cell. It reads the same series, but for whether each Nova worker is alive and how full each storage pool is, which it still reads from the API, and it cannot say whether an API answers. It has not yet been run against a real database.":
    "**بعد 1,500 مشرف افتراضي أو 100,000 مثيل، مسار قاعدة البيانات.** يستطيع الوكيل قراءة قواعد بيانات السحابة بدلًا من واجهات API الخاصة بها، التي لا يمكن قراءتها عند هذا الحجم في زمن جمع واحد. ويحتاج إلى حساب للقراءة فقط على قاعدة بيانات كل خدمة، ومسار إليها من هذا الجهاز، ومُصدِّر واحد لكل منطقة وخلية Nova. يقرأ السلاسل نفسها، باستثناء ما إذا كان كل عامل Nova حيًّا ومدى امتلاء كل تجمّع تخزين، وهو ما يظل يقرؤه من واجهة API، ولا يستطيع معرفة ما إذا كانت واجهة API تجيب. لم يُشغَّل بعد على قاعدة بيانات حقيقية.",
  "The install script writes these to `/opt/oneuptime-openstack-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`.":
    "يكتب برنامج التثبيت النصي هذه القيم في `/opt/oneuptime-openstack-agent/.env`. بعد تغيير أيٍّ منها، طبّقه باستخدام `docker compose up -d` في `/opt/oneuptime-openstack-agent`.",
  "| Variable | Required | Description |": "| المتغير | مطلوب | الوصف |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | نعم | عنوان URL لمثيل OneUptime الخاص بك (مثل `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key: the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | نعم | مفتاح استيعاب القياس عن بُعد: المفتاح المختار في الخطوة 1 |",
  "| `OPENSTACK_CLOUD_NAME` | Yes | The cloud's name in OneUptime, stamped on every metric as the `openstack.cloud.name` resource attribute. Keep it stable: changing it registers a new cloud |":
    "| `OPENSTACK_CLOUD_NAME` | نعم | اسم السحابة في OneUptime، يوضع على كل مقياس بوصفه سمة المورد `openstack.cloud.name`. أبقه ثابتًا: تغييره يسجّل سحابة جديدة |",
  "| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The `clouds.yaml` entries to read, one per region and named for the region, in square brackets: `[RegionOne,RegionTwo]` |":
    "| `OPENSTACK_EXPORTER_CLOUDS` | نعم | إدخالات `clouds.yaml` المراد قراءتها، إدخال لكل منطقة باسم المنطقة، بين أقواس مربعة: `[RegionOne,RegionTwo]` |",
  "| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |":
    "| `OPENSTACK_AUTH_URL` | المُصدِّر المرفق | عنوان URL للمصادقة في Keystone. يُضاف `/v3` إن كان ناقصًا |",
  "| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port` of your own exporter, with no scheme. Leave it out for the bundled one |":
    "| `OPENSTACK_EXPORTER_ADDRESS` | لا | `host:port` للمُصدِّر الخاص بك، دون مخطط. اتركه فارغًا للمُصدِّر المرفق |",
  "| `OPENSTACK_QUOTA_CLOUDS` | No | The `clouds.yaml` entries to read each project's quotas from, once an hour. The install script sets it when run with `OPENSTACK_COLLECT_QUOTAS=true` |":
    "| `OPENSTACK_QUOTA_CLOUDS` | لا | إدخالات `clouds.yaml` التي تُقرأ منها حصص كل مشروع، مرة كل ساعة. يضبطه برنامج التثبيت النصي عند تشغيله مع `OPENSTACK_COLLECT_QUOTAS=true` |",
  "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | No | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | لا | `host:port` للمُصدِّر الذي يقرؤها. اتركه فارغًا للمُصدِّر المرفق |",
  "| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml` (default: `65532:65532`) |":
    "| `OPENSTACK_EXPORTER_USER` | لا | قيمة `uid:gid` التي تعمل بها حاوية المُصدِّر، والتي يجب أن تملك `clouds.yaml` (الافتراضي: `65532:65532`) |",
  "| `OPENSTACK_CA_FILE` | No | A PEM file with the certificate authority of a cloud that has its own |":
    "| `OPENSTACK_CA_FILE` | لا | ملف PEM فيه مرجع التصديق لسحابة لها مرجعها الخاص |",
  "| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter, and `openstack-ai-agent` the OneUptime AI agent |":
    "| `COMPOSE_PROFILES` | المُصدِّر المرفق | يبدأ `openstack-exporter` المُصدِّر المرفق، ويبدأ `openstack-ai-agent` وكيل الذكاء الاصطناعي من OneUptime |",
  "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | No | An exporter already running without `--multi-cloud`, such as Kolla-Ansible's: `[10.0.0.254:9198]`. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it |":
    "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | لا | مُصدِّر يعمل بالفعل دون `--multi-cloud`، مثل مُصدِّر Kolla-Ansible: `[10.0.0.254:9198]`. اضبط معه `OPENSTACK_EXPORTER_CLOUDS=[]` |",
  "| `OPENSTACK_RABBITMQ_TARGETS` | No | RabbitMQ's Prometheus plugin on each node: `[10.0.0.11:15692,10.0.0.12:15692]` |":
    "| `OPENSTACK_RABBITMQ_TARGETS` | لا | إضافة Prometheus في RabbitMQ على كل عقدة: `[10.0.0.11:15692,10.0.0.12:15692]` |",
  "| `OPENSTACK_MARIADB_TARGETS` | No | mysqld_exporter beside each MariaDB node, usually on `9104` |":
    "| `OPENSTACK_MARIADB_TARGETS` | لا | mysqld_exporter بجوار كل عقدة MariaDB، عادةً على `9104` |",
  "| `OPENSTACK_MEMCACHED_TARGETS` | No | memcached_exporter beside each Memcached, usually on `9150` |":
    "| `OPENSTACK_MEMCACHED_TARGETS` | لا | memcached_exporter بجوار كل Memcached، عادةً على `9150` |",
  "| `OPENSTACK_HAPROXY_TARGETS` | No | HAProxy's own Prometheus exporter |":
    "| `OPENSTACK_HAPROXY_TARGETS` | لا | مُصدِّر Prometheus الخاص بـ HAProxy نفسه |",
  "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | No | openstack-network-exporter on each node, for OVN and Open vSwitch, usually on `1981` |":
    "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | لا | openstack-network-exporter على كل عقدة، لـ OVN وOpen vSwitch، عادةً على `1981` |",
  "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | No | prometheus-libvirt-exporter on each compute node, usually on `9177`, for whether libvirt answers and nothing per instance |":
    "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | لا | prometheus-libvirt-exporter على كل عقدة حوسبة، عادةً على `9177`، لمعرفة ما إذا كان libvirt يجيب، ولا شيء لكل مثيل |",
  "| `OPENSTACK_CONTROL_PLANE_REGION` | No | The region of a target above that does not say its own. A target can: `RegionTwo@10.1.0.11:15692` |":
    "| `OPENSTACK_CONTROL_PLANE_REGION` | لا | منطقة هدف مما سبق لا يذكر منطقته. ويمكن للهدف أن يذكرها: `RegionTwo@10.1.0.11:15692` |",
  "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | No | The same exporter, for what each instance is really doing. Per-instance series multiply fast |":
    "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | لا | المُصدِّر نفسه، لمعرفة ما يفعله كل مثيل فعلًا. تتضاعف السلاسل الخاصة بكل مثيل بسرعة |",
  "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | No | Ceilometer's exporter on each compute node, usually on `9101`, for the same |":
    "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | لا | مُصدِّر Ceilometer على كل عقدة حوسبة، عادةً على `9101`، للغرض نفسه |",
  "`clouds.yaml` alone holds the credential.":
    "لا يحمل بيانات الاعتماد إلا `clouds.yaml`.",
  "Only the largest clouds need these, and none is asked for:":
    "لا تحتاج إلى هذه إلا أكبر السحابات، ولا يُسأل عن أي منها:",
  "| Variable | Description |": "| المتغير | الوصف |",
  "| `OPENSTACK_AGENT_SERVICES` | Which services this agent reads, as a pattern: `compute\\|placement` here and the rest on a second agent. Every service by default. No two agents should read one service of one region |":
    "| `OPENSTACK_AGENT_SERVICES` | الخدمات التي يقرؤها هذا الوكيل، بصيغة نمط: `compute\\|placement` هنا والباقي على وكيل ثانٍ. كل الخدمات افتراضيًا. يجب ألا يقرأ وكيلان الخدمة نفسها في منطقة واحدة |",
  "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | The memory the collector may use, in MiB (default: `512`). It holds a whole scrape, so raise this past tens of thousands of instances |":
    "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | الذاكرة التي يمكن للمجمّع استخدامها، بوحدة MiB (الافتراضي: `512`). فهو يحتفظ بجمع كامل، لذا ارفعها بعد عشرات الآلاف من المثيلات |",
  "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | Reading each service's database rather than its API, with a read-only account: where that exporter answers. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it, or every series arrives twice |":
    "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | قراءة قاعدة بيانات كل خدمة بدلًا من واجهة API الخاصة بها، بحساب للقراءة فقط: حيث يجيب ذلك المُصدِّر. اضبط معه `OPENSTACK_EXPORTER_CLOUDS=[]`، وإلا وصلت كل سلسلة مرتين |",
  "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | The database of each service it reads, as `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. One left empty is a service it leaves alone. Each holds a password, and `.env` is readable by its owner alone |":
    "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | قاعدة بيانات كل خدمة يقرؤها، بصيغة `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. ما يُترك فارغًا خدمةٌ لا يمسّها. يحمل كلٌّ منها كلمة مرور، ولا يقرأ `.env` إلا مالكه |",
  "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | What Nova adds to a host's name to make a hypervisor's, such as `.example.org`, so an instance finds the hypervisor it runs on |":
    "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | ما يضيفه Nova إلى اسم المضيف ليصنع اسم المشرف الافتراضي، مثل `.example.org`، كي يجد المثيل المشرف الافتراضي الذي يعمل عليه |",
  "| `OPENSTACK_WORKER_STATE_CLOUDS` | The `clouds.yaml` entries to read from Nova's and Cinder's APIs what their databases cannot say: whether each worker is alive, and how full each pool is |":
    "| `OPENSTACK_WORKER_STATE_CLOUDS` | إدخالات `clouds.yaml` لقراءة ما لا تستطيع قواعد بيانات Nova وCinder قوله من واجهات API الخاصة بهما: ما إذا كان كل عامل حيًّا، ومدى امتلاء كل تجمّع |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` للمُصدِّر الذي يقرؤها. اتركه فارغًا للمُصدِّر المرفق |",
  "| `OPENSTACK_QUOTA_CLOUDS` | The `clouds.yaml` entries to read each project's quotas from, once an hour. Empty reads none, and `OPENSTACK_COLLECT_QUOTAS=true` in the install script fills it in |":
    "| `OPENSTACK_QUOTA_CLOUDS` | إدخالات `clouds.yaml` التي تُقرأ منها حصص كل مشروع، مرة كل ساعة. إن كان فارغًا فلا يقرأ شيئًا، ويملؤه `OPENSTACK_COLLECT_QUOTAS=true` في برنامج التثبيت النصي |",
  "The OneUptime AI agent reads the credential in `clouds.yaml` unless these say otherwise, and none is asked for:":
    "يقرأ وكيل الذكاء الاصطناعي من OneUptime بيانات الاعتماد في `clouds.yaml` ما لم تقل هذه غير ذلك، ولا يُسأل عن أي منها:",
  "| `ONEUPTIME_AI_INVESTIGATION` | `false` stops OneUptime AI investigating this cloud with the agent |":
    "| `ONEUPTIME_AI_INVESTIGATION` | تمنع القيمة `false` ميزة OneUptime AI من التحقيق في هذه السحابة بالوكيل |",
  "| `OPENSTACK_AI_CLOUDS_FILE` | The `clouds.yaml` it mounts. `/dev/null` when it has a credential of its own and there is no such file beside it |":
    "| `OPENSTACK_AI_CLOUDS_FILE` | ملف `clouds.yaml` الذي يركّبه. القيمة `/dev/null` عندما تكون له بيانات اعتماد خاصة ولا يوجد ملف كهذا بجواره |",
  "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | The entry of `clouds.yaml` to use, when it is not the first of `OPENSTACK_EXPORTER_CLOUDS` |":
    "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | إدخال `clouds.yaml` المراد استخدامه، حين لا يكون الأول في `OPENSTACK_EXPORTER_CLOUDS` |",
  "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | A credential of its own, used instead of `clouds.yaml`'s. Set both, with `OPENSTACK_AUTH_URL` |":
    "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | بيانات اعتماد خاصة به، تُستخدم بدلًا من بيانات `clouds.yaml`. اضبط كليهما، مع `OPENSTACK_AUTH_URL` |",
  "| `OPENSTACK_AUTH_URL` | The Keystone a credential of its own logs in to |":
    "| `OPENSTACK_AUTH_URL` | خدمة Keystone التي تسجّل بيانات الاعتماد الخاصة الدخول إليها |",
  "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | The region a command reads when it names none, which endpoints it uses (`public`, `internal` or `admin`), and a certificate authority. `clouds.yaml` says these unless they do |":
    "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | المنطقة التي يقرؤها الأمر حين لا يسمّي منطقة، ونقاط النهاية التي يستخدمها (`public` أو `internal` أو `admin`)، ومرجع تصديق. يحدد `clouds.yaml` هذه ما لم تحددها هي |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | The name it registers under, when it is not `OPENSTACK_CLOUD_NAME` |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | الاسم الذي يُسجَّل به، حين لا يكون `OPENSTACK_CLOUD_NAME` |",
  "| `LOG_LEVEL` | How much it logs |": "| `LOG_LEVEL` | مقدار ما يسجّله |",
  "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | Off until set: let it make changes, through a credential of their own. The OpenStack guide says how to make it with the least it needs |":
    "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | متوقفة حتى تُضبط: تتيح له إجراء تغييرات، عبر بيانات اعتماد خاصة بها. يشرح دليل OpenStack كيفية إنشائها بأقل ما تحتاج إليه |",
  "| `ONEUPTIME_AI_FIXES` | How AI may apply a fix: off, ask-for-approval, automatic or bypass-approval. Empty: fixes stay off until someone chooses on this page |":
    "| `ONEUPTIME_AI_FIXES` | الطريقة التي يمكن للذكاء الاصطناعي أن يطبّق بها إصلاحًا: off أو ask-for-approval أو automatic أو bypass-approval. فارغ: تبقى الإصلاحات متوقفة حتى يختار أحد في هذه الصفحة |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | What is never touched, whatever else is set and whoever approves it: `project:ID`, `host:NAME` or `instance:ID`, separated by commas |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | ما لا يُمسّ أبدًا، أيًّا كان ما ضُبط غيره وأيًّا كان من يوافق عليه: `project:ID` أو `host:NAME` أو `instance:ID`، مفصولة بفواصل |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | Where changes may land, written the same way. Empty: anywhere that is not protected |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | المواضع التي يمكن أن تقع فيها التغييرات، مكتوبة بالطريقة نفسها. فارغ: أي موضع غير محمي |",
  "Set `OPENSTACK_EXPORTER_ADDRESS` as you run the install script, such as `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. The bundled exporter then never starts, and no Keystone URL or credential is asked for.":
    "اضبط `OPENSTACK_EXPORTER_ADDRESS` عند تشغيل برنامج التثبيت النصي، مثل `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. عندئذٍ لا يبدأ المُصدِّر المرفق أبدًا، ولا يُطلب أي عنوان URL لـ Keystone ولا بيانات اعتماد.",
  "Your exporter must run with `--multi-cloud`, and its `clouds.yaml` needs an entry named for each region. Turn off what the bundled one turns off: see **What the agent collects, and what it costs your cloud**. Use an address the agent's container can reach: `localhost` inside the container is the container itself.":
    "يجب أن يعمل مُصدِّرك مع `--multi-cloud`، ويحتاج ملف `clouds.yaml` الخاص به إلى إدخال باسم كل منطقة. أوقف ما يوقفه المُصدِّر المرفق: انظر **ما يجمعه الوكيل، وما يكلّفه لسحابتك**. استخدم عنوانًا تستطيع حاوية الوكيل الوصول إليه: `localhost` داخل الحاوية هو الحاوية نفسها.",
  "**Started without `--multi-cloud`?** Kolla-Ansible's is, and Canonical's charm. It has no `/probe`, so set `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` instead of the address above, with `OPENSTACK_EXPORTER_CLOUDS=[]` and `OPENSTACK_CONTROL_PLANE_REGION`. It is then asked for everything at once, every 2 minutes.":
    "**بدأ دون `--multi-cloud`؟** مُصدِّر Kolla-Ansible كذلك، وكذلك charm من Canonical. ليس لديه `/probe`، لذا اضبط `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` بدلًا من العنوان أعلاه، مع `OPENSTACK_EXPORTER_CLOUDS=[]` و`OPENSTACK_CONTROL_PLANE_REGION`. عندئذٍ يُطلب منه كل شيء دفعة واحدة، كل دقيقتين.",
  "**On exporter 1.7.0,** which Kolla-Ansible pins, it answers either way, and the pages go without what it does not say. On five real clouds that was:":
    "**على المُصدِّر 1.7.0،** الذي يثبّته Kolla-Ansible، يجيب في الحالتين، وتفتقد الصفحات ما لا يقوله. على خمس سحابات حقيقية كان ذلك:",
  "Give the install script the file when it asks for a private CA file. It copies it to `ca.pem`, and names it in `clouds.yaml`.":
    "أعطِ برنامج التثبيت النصي الملف عندما يطلب ملف مرجع مصدّق خاص. ينسخه إلى `ca.pem`، ويذكره في `clouds.yaml`.",
  "On Linux (x86_64 or arm64) with systemd 235 or later and glibc 2.34 or later (not RHEL 8), the install script can run the same collector and exporter releases as systemd services instead:":
    "على Linux (x86_64 أو arm64) مع systemd 235 أو أحدث وglibc 2.34 أو أحدث (ليس RHEL 8)، يستطيع برنامج التثبيت النصي تشغيل إصدارات المجمّع والمُصدِّر نفسها بوصفها خدمات systemd بدلًا من ذلك:",
  "Moving off a Docker install? Run `docker compose down` first, or every metric arrives twice. Running the script again stays whichever it was, so `sudo bash install.sh` is the upgrade.":
    "هل تنتقل من تثبيت Docker؟ شغّل `docker compose down` أولًا، وإلا وصل كل مقياس مرتين. تشغيل البرنامج النصي مرة أخرى يبقي الطريقة التي كان عليها، لذا فإن `sudo bash install.sh` هو الترقية.",
  "The `resource` processor in `otel-collector-config.yaml` stamps every metric with the cloud's name. OneUptime registers the cloud from that attribute, and every page and monitor scopes on it. The two deletes keep OneUptime from registering a Service named after the scrape job, so keep them if you customize the file:":
    "يضع المعالج `resource` في `otel-collector-config.yaml` اسم السحابة على كل مقياس. يسجّل OneUptime السحابة من تلك السمة، وتُحصر كل صفحة وكل مراقب بها. يمنع الحذفان OneUptime من تسجيل خدمة باسم مهمة الجمع، لذا أبقهما إن خصّصت الملف:",
  "The whole file is on this OneUptime:":
    "الملف كاملًا موجود على OneUptime هذا:",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cloud: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `openstack.cloud.name`:":
    "تصبح أي سمة مورد تبدأ بالبادئة `oneuptime.label.` تسمية مشروع على السحابة: `oneuptime.label.<dimension>=<value>` هي التسمية `<dimension>:<value>`. أضفها إلى المعالج `resource` في `otel-collector-config.yaml`، بجوار `openstack.cloud.name`:",
  "Then restart the collector so it reads the new config:":
    "ثم أعد تشغيل المجمّع ليقرأ الإعدادات الجديدة:",
  "The cloud shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "تظهر السحابة موسومة بـ `team:platform` و`env:production`. تُطابَق التسميات دون تمييز بين الأحرف الكبيرة والصغيرة، لذا يُعاد استخدام تسمية `Production` الموجودة؛ ولا يزيل الوكيل أبدًا التسميات المضافة في واجهة OneUptime.",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` and `clouds.yaml` (nothing is asked again), downloads the latest files (a file you edited is kept next to the new one as `<file>.bak.<timestamp>`), pulls the images and recreates the agent with them:":
    "**الترقية.** الصور مثبّتة في `docker-compose.yml` وإعداداتها ملف بجوارها، لذا لا يكفي السحب وحده لتقديم الوكيل. شغّل برنامج التثبيت النصي مرة أخرى. يعيد استخدام كل قيمة في ملفي `.env` و`clouds.yaml` الموجودين لديك (لا يُسأل عن شيء مرة أخرى)، وينزّل أحدث الملفات (يُحتفظ بالملف الذي عدّلته بجوار الجديد باسم `<file>.bak.<timestamp>`)، ويسحب الصور ويعيد إنشاء الوكيل بها:",
  "The config reports the collector version it pins as the cloud's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "تُبلغ الإعدادات عن إصدار المجمّع الذي تثبّته بوصفه **إصدار الوكيل** للسحابة. وحين يثبّت OneUptime هذا إصدارًا أحدث، تفتح علامة تحذير بجواره هذه الأوامر.",
  "**Uninstall** the agent:": "**إلغاء التثبيت** للوكيل:",
  "Then delete `/opt/oneuptime-openstack-agent`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "ثم احذف `/opt/oneuptime-openstack-agent`، الذي يحمل بيانات الاعتماد، وبيانات اعتماد التطبيق نفسها: `openstack application credential delete oneuptime-agent`.",
  "`troubleshoot.sh` checks the whole chain, from DNS and TLS to Keystone, each service in the catalog and your ingestion key, and says what this credential can read and what each gap costs.":
    "يفحص `troubleshoot.sh` السلسلة كلها، من DNS وTLS إلى Keystone، وكل خدمة في الكتالوج ومفتاح الاستيعاب الخاص بك، ويبيّن ما تستطيع بيانات الاعتماد هذه قراءته وما تكلّفه كل ثغرة.",
  "It needs `sudo` to read `clouds.yaml`, or it skips the credential checks. It ends with a verdict naming the most likely cause.":
    "يحتاج إلى `sudo` لقراءة `clouds.yaml`، وإلا تخطّى فحوص بيانات الاعتماد. وينتهي بحكم يسمّي السبب الأرجح.",
  "1. Check that the agent is running (in `/opt/oneuptime-openstack-agent`): `docker compose ps`":
    "1. تحقّق من أن الوكيل يعمل (في `/opt/oneuptime-openstack-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-openstack-agent | grep -i error`":
    "2. افحص سجلات الوكيل بحثًا عن أخطاء: `docker compose logs oneuptime-openstack-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. تحقّق من صحة عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. تأكد من أن جهاز الوكيل يستطيع الوصول إلى مثيل OneUptime عبر الشبكة.",
  "A **Project view** credential can't read them, and neither can a role without the policy overrides: Nova, Neutron and Placement keep them for admins by default. Use **Full view**, or **Infrastructure only** with the files in `access/policy` merged into the file each service's `[oslo_policy] policy_file` names. `troubleshoot.sh` says which reads were refused.":
    "لا تستطيع بيانات اعتماد **عرض المشروع** قراءتها، ولا يستطيع ذلك دور دون تجاوزات السياسة: يحتفظ Nova وNeutron وPlacement بها للمسؤولين افتراضيًا. استخدم **عرض كامل**، أو **البنية التحتية فقط** مع دمج ملفات `access/policy` في الملف الذي يسمّيه `[oslo_policy] policy_file` لكل خدمة. يبيّن `troubleshoot.sh` أي القراءات رُفضت.",
  "Only **Full view** sees `cinder-volume` and `cinder-scheduler` state and storage pools. Cinder's own code answers anything else with `403 User does not have admin privileges`, after policy has already passed, so no override opens them.":
    "لا يرى حالة `cinder-volume` و`cinder-scheduler` وتجمّعات التخزين إلا **عرض كامل**. تجيب شيفرة Cinder نفسها أي شيء آخر بالرمز `403 User does not have admin privileges`، بعد أن تكون السياسة قد سمحت بالفعل، لذا لا يفتحها أي تجاوز.",
  "Neutron and Cinder answer anything but an admin with `200` and only its own project, which looks like it worked. Seeing every project takes **Full view**. With **Infrastructure only**, they appear for the projects the role is assigned on, and a role on a real project can also write there on many clouds.":
    "يجيب Neutron وCinder أي شيء عدا المسؤول بالرمز `200` وبمشروعه الخاص فقط، وهو ما يبدو نجاحًا. رؤية كل مشروع تتطلب **عرض كامل**. ومع **البنية التحتية فقط**، تظهر للمشاريع المسندة إليها الدور، ويستطيع الدور على مشروع حقيقي أيضًا الكتابة هناك على كثير من السحابات.",
  "A **Project view** credential shows no instances through the agent: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. **Full view** and **Infrastructure only** both see every project's instances.":
    "لا تعرض بيانات اعتماد **عرض المشروع** أي مثيلات عبر الوكيل: يطلب المُصدِّر من Nova خوادم كل المشاريع، فيرفض Nova القارئ العادي، وتفشل تلك القراءة بأكملها. يرى كلٌّ من **عرض كامل** و**البنية التحتية فقط** مثيلات كل مشروع.",
  "That is expected with **Infrastructure only**, and harmless. Neutron tries to create a project's default security group when it lists them, and a project with zero quota cannot hold one. There is nothing to fix.":
    "هذا متوقَّع مع **البنية التحتية فقط**، وغير ضار. يحاول Neutron إنشاء مجموعة الأمان الافتراضية لمشروع عند سرد المجموعات، والمشروع ذو الحصة الصفرية لا يستطيع أن يحوي واحدة. لا يوجد ما يلزم إصلاحه.",
  "On Flamingo and Epoxy, oslo.policy raises on every check once a policy file it has read is gone, and when the service is Keystone the whole cloud answers `503`. Restart the service. To take the overrides off, empty the file (`{}`) and never delete it.":
    "في Flamingo وEpoxy، يُطلق oslo.policy خطأً عند كل فحص بمجرد اختفاء ملف سياسة قرأه، وعندما تكون الخدمة Keystone تجيب السحابة كلها بالرمز `503`. أعد تشغيل الخدمة. لإزالة التجاوزات، أفرغ الملف (`{}`) ولا تحذفه أبدًا.",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "يقرأ الوكيل كل خدمة على حدة، لذا لا تكلّف الخدمة المتعطلة إلا أرقامها. اعرف لماذا لا يستطيع المُصدِّر قراءتها (في `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. تعرض صفحة **الخدمات** واجهة API تلك بالحالة `down`. وبيانات الاعتماد ذات قواعد الوصول المنشأة من نسخة أقدم من القواعد تفعل ذلك أيضًا على Swift، وعلى Octavia خلف مسار: أنشئ بيانات جديدة، كما يشرح **عرض كامل**.",
  "The services are refusing a credential limited by access rules. A service behind a path prefix refuses the shipped rules: fit them to this cloud with `access-rules-for-cloud.py`, as **Full view** does. And each service needs `service_type` set for keystonemiddleware, and a restart:":
    "ترفض الخدمات بيانات الاعتماد المقيدة بقواعد الوصول. ترفض الخدمة الموجودة خلف بادئة مسار القواعد المرفقة: كيّفها مع هذه السحابة باستخدام `access-rules-for-cloud.py`، كما يشرح **عرض كامل**. وتحتاج كل خدمة إلى ضبط `service_type` لـ keystonemiddleware، وإلى إعادة تشغيل:",
  "If you won't change that, create the credential without `--access-rules`, knowing it can write.":
    "إن لم تكن ستغيّر ذلك، فأنشئ بيانات الاعتماد دون `--access-rules`، وأنت تعلم أنها تستطيع الكتابة.",
  "The exporter runs as uid 65532, and `clouds.yaml` is readable by its owner alone. Give the file to that user, or set `OPENSTACK_EXPORTER_USER` in `.env` to the file owner's `uid:gid`, and apply it with `docker compose up -d`.":
    "يعمل المُصدِّر بالمعرّف uid 65532، ولا يقرأ `clouds.yaml` إلا مالكه. اجعل ذلك المستخدم مالكًا للملف، أو اضبط `OPENSTACK_EXPORTER_USER` في `.env` على قيمة `uid:gid` لمالك الملف، وطبّق ذلك باستخدام `docker compose up -d`.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "تأتي هوية السحابة من `OPENSTACK_CLOUD_NAME`، الذي يوضع على كل مقياس باسم `openstack.cloud.name`. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في `/opt/oneuptime-openstack-agent`. الاسم الجديد يسجّل سحابة جديدة.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "تأتي هوية السحابة من `OPENSTACK_CLOUD_NAME`، الذي يوضع على كل مقياس باسم `openstack.cloud.name`. هذه السحابة هي **`cloud-1`**. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في `/opt/oneuptime-openstack-agent`. الاسم الجديد يسجّل سحابة جديدة.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent":
    "Docker Engine 20.10+ مع إضافة Docker Compose v2، على الجهاز الذي سيشغّل الوكيل",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "نزّل `docker-compose.yml` و`otel-collector-config.yaml` من OneUptime هذا إلى مجلد جديد:",
  "Create a `clouds.yaml` file next to them, with the credential from the previous step. It needs one entry per region, each named for its region, because the exporter's series do not say which region they are from:":
    "أنشئ ملف `clouds.yaml` بجوارهما، ببيانات الاعتماد من الخطوة السابقة. يحتاج إلى إدخال لكل منطقة، يحمل كلٌّ منها اسم منطقته، لأن سلاسل المُصدِّر لا تقول من أي منطقة هي:",
  "Create a `.env` file next to them too:": "أنشئ ملف `.env` بجوارهما أيضًا:",
  "- Replace `my-openstack-cloud` with a name for this cloud, such as `prod-eu`. It is how the cloud appears in OneUptime, so keep it stable: a new name registers a new cloud.":
    "- استبدل `my-openstack-cloud` باسم لهذه السحابة، مثل `prod-eu`. بهذا الاسم تظهر السحابة في OneUptime، لذا أبقه ثابتًا: الاسم الجديد يسجّل سحابة جديدة.",
  "- List every region in `OPENSTACK_EXPORTER_CLOUDS`, in square brackets, such as `[RegionOne,RegionTwo]`.":
    "- اسرد كل منطقة في `OPENSTACK_EXPORTER_CLOUDS`، بين أقواس مربعة، مثل `[RegionOne,RegionTwo]`.",
  "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` starts the bundled exporter, which reads the cloud with `clouds.yaml`, and the OneUptime AI agent, which reads it with the same file while OneUptime AI investigates.":
    "- يبدأ `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` المُصدِّر المرفق، الذي يقرأ السحابة باستخدام `clouds.yaml`، ووكيل الذكاء الاصطناعي من OneUptime، الذي يقرؤها بالملف نفسه بينما يحقّق OneUptime AI.",
  "Both files hold secrets, so keep them to their owner. The exporter runs as uid 65532, and must be the one account that can read `clouds.yaml`. Then start the agent:":
    "يحمل كلا الملفين أسرارًا، لذا اقصرهما على مالكهما. يعمل المُصدِّر بالمعرّف uid 65532، ويجب أن يكون الحساب الوحيد الذي يستطيع قراءة `clouds.yaml`. ثم شغّل الوكيل:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Add one `clouds.yaml` entry per region, and list them all in `OPENSTACK_EXPORTER_CLOUDS`. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "السحابة هي Keystone واحد، مهما كان عدد مناطقها، ووكيل واحد يقرؤها كلها. أضف إدخالًا واحدًا في `clouds.yaml` لكل منطقة، واسردها كلها في `OPENSTACK_EXPORTER_CLOUDS`. يجب أن يحمل كل إدخال اسم منطقته: يضع المجمّع ذلك الاسم على سلاسل المُصدِّر باسم `openstack.region.name`، لأن السلاسل لا تقول من أي منطقة هي. عندئذٍ تُصفّى كل قائمة في OneUptime حسب المنطقة.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "يقرأ الوكيل هذه القيم من ملف `.env` بجوار `docker-compose.yml`. بعد تغيير أيٍّ منها، طبّقه باستخدام `docker compose up -d` في المجلد الذي فيه `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter, as `host:port` with no scheme: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. The bundled exporter then never starts.":
    "احذف `COMPOSE_PROFILES` من `.env` ووجّه الوكيل إلى مُصدِّرك، بصيغة `host:port` دون مخطط: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. عندئذٍ لا يبدأ المُصدِّر المرفق أبدًا.",
  "Put the file next to `docker-compose.yml` as `ca.pem`, set `OPENSTACK_CA_FILE=./ca.pem` in `.env`, and add `cacert: /etc/openstack/ca.pem` to each entry of `clouds.yaml`.":
    "ضع الملف بجوار `docker-compose.yml` باسم `ca.pem`، واضبط `OPENSTACK_CA_FILE=./ca.pem` في `.env`، وأضف `cacert: /etc/openstack/ca.pem` إلى كل إدخال في `clouds.yaml`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "شغّل هذه الأوامر في مجلد الوكيل، وهو المجلد الذي فيه `docker-compose.yml`.",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `clouds.yaml` stay, and a change you made to either file has to be made again:":
    "**الترقية.** الصور مثبّتة في `docker-compose.yml` وإعداداتها ملف بجوارها، لذا لا يكفي السحب وحده لتقديم الوكيل. نزّل الملفين مرة أخرى؛ يبقى ملفا `.env` و`clouds.yaml` لديك، ويجب أن تعيد أي تغيير أجريته على أيٍّ من الملفين المنزّلين:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "ثم اسحب الصور وأعد إنشاء الوكيل، ليقرأ المجمّع إعداداته الجديدة:",
  "Then delete the folder with `docker-compose.yml`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "ثم احذف المجلد الذي فيه `docker-compose.yml`، الذي يحمل بيانات الاعتماد، وبيانات اعتماد التطبيق نفسها: `openstack application credential delete oneuptime-agent`.",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. تحقّق من أن الوكيل يعمل (في مجلد الوكيل): `docker compose ps`",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in the agent's folder): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "يقرأ الوكيل كل خدمة على حدة، لذا لا تكلّف الخدمة المتعطلة إلا أرقامها. اعرف لماذا لا يستطيع المُصدِّر قراءتها (في مجلد الوكيل): `docker compose logs oneuptime-openstack-exporter`. تعرض صفحة **الخدمات** واجهة API تلك بالحالة `down`. وبيانات الاعتماد ذات قواعد الوصول المنشأة من نسخة أقدم من القواعد تفعل ذلك أيضًا على Swift، وعلى Octavia خلف مسار: أنشئ بيانات جديدة، كما يشرح **عرض كامل**.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "تأتي هوية السحابة من `OPENSTACK_CLOUD_NAME`، الذي يوضع على كل مقياس باسم `openstack.cloud.name`. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في المجلد الذي فيه `docker-compose.yml`. الاسم الجديد يسجّل سحابة جديدة.",
  "- This installs the agent for **`cloud-1`**. Keep `OPENSTACK_CLOUD_NAME` exactly as it is, or the data registers as a new cloud.":
    "- يثبّت هذا الوكيل للسحابة **`cloud-1`**. أبقِ `OPENSTACK_CLOUD_NAME` كما هو تمامًا، وإلا سُجّلت البيانات سحابةً جديدة.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "تأتي هوية السحابة من `OPENSTACK_CLOUD_NAME`، الذي يوضع على كل مقياس باسم `openstack.cloud.name`. هذه السحابة هي **`cloud-1`**. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في المجلد الذي فيه `docker-compose.yml`. الاسم الجديد يسجّل سحابة جديدة.",
  "OpenStack-Ansible keeps its services' logs in journald and runs no Prometheus of its own, so the agent is the way in, and the logs have a path of their own.":
    "يحفظ OpenStack-Ansible سجلات خدماته في journald ولا يشغّل Prometheus خاصًا به، لذا فالوكيل هو طريق الدخول، وللسجلات مسارها الخاص.",
  "**How far this guide has been tested:** Its paths and variables were read from OpenStack-Ansible's own source and docs. Its commands were then run on a real all-in-one at stable/2026.1, in LXC containers, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, the agent's exporter on the Infrastructure only credential with its policy overrides, the RabbitMQ and HAProxy settings with the agent reading each, and the logs profile on the journal. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**إلى أي حد اختُبر هذا الدليل:** قُرئت مساراته ومتغيراته من الشيفرة المصدرية والتوثيق الخاصين بـ OpenStack-Ansible نفسه. ثم شُغّلت أوامره على all-in-one حقيقي بإصدار stable/2026.1، في حاويات LXC، مع بديل لـ OneUptime يحتفظ بما أرسله الوكيل: الوكيل ببيانات اعتماد العرض الكامل، ومُصدِّر الوكيل ببيانات اعتماد البنية التحتية فقط مع تجاوزات سياستها، وإعدادات RabbitMQ وHAProxy مع قراءة الوكيل لكلٍّ منها، وملف تعريف السجلات على journal. أوصل كلٌّ من الوكيل والمسبار نظام DevStack حقيقيًا إلى OneUptime قيد التشغيل، مرورًا بإيقاف nova-compute وإعادته، لكن ليس من هذه الأداة.",
  "- Log in as an admin from the utility container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, then `. ~/openrc`. It has no `curl`, which the commands below use, so run `apt-get install -y curl` there first.":
    "- سجّل الدخول بصفة مسؤول من حاوية utility: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`، ثم `. ~/openrc`. ليس فيها `curl`، الذي تستخدمه الأوامر أدناه، لذا شغّل `apt-get install -y curl` هناك أولًا.",
  "- **Full view** needs one change, to Cinder. OpenStack-Ansible's roles already set `service_type` under `[keystone_authtoken]`, but its Cinder says `volumev3` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Set `service_type: block-storage` under `keystone_authtoken` in `cinder_cinder_conf_overrides` in `/etc/openstack_deploy/user_variables.yml`, then run `openstack-ansible openstack.osa.cinder --tags cinder-config`.":
    "- يحتاج **عرض كامل** إلى تغيير واحد في Cinder. تضبط أدوار OpenStack-Ansible بالفعل `service_type` تحت `[keystone_authtoken]`، لكن Cinder الخاص به يقول `volumev3` وكتالوجه يقول `block-storage`، ويرفض keystonemiddleware بيانات الاعتماد المقيدة بقواعد الوصول بالرمز `401` ما لم يتطابق الاثنان. اضبط `service_type: block-storage` تحت `keystone_authtoken` في `cinder_cinder_conf_overrides` في `/etc/openstack_deploy/user_variables.yml`، ثم شغّل `openstack-ansible openstack.osa.cinder --tags cinder-config`.",
  "- **Infrastructure only** takes its overrides as `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` and `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Apply each with its own playbook and tag, such as `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Taking one out later leaves an empty file behind rather than none, so nothing fails.":
    "- يأخذ **البنية التحتية فقط** تجاوزاته بصيغة `nova_policy_overrides` و`neutron_policy_overrides` و`keystone_policy_overrides` و`placement_policy_overrides` في `/etc/openstack_deploy/user_variables.yml`. طبّق كلًّا منها بدليل التشغيل والوسم الخاصين به، مثل `openstack-ansible openstack.osa.nova --tags nova-policy-override`. وإزالة أحدها لاحقًا تترك ملفًا فارغًا بدلًا من لا شيء، لذا لا يفشل شيء.",
  "- **RabbitMQ:** turn on its Prometheus plugin, then name each container's address on `15692` as `OPENSTACK_RABBITMQ_TARGETS` in the agent's `.env`:":
    "- **RabbitMQ:** شغّل إضافة Prometheus الخاصة به، ثم اذكر عنوان كل حاوية على `15692` بوصفه `OPENSTACK_RABBITMQ_TARGETS` في ملف `.env` الخاص بالوكيل:",
  "- **HAProxy:** its exporter is off, and its stats listener is on `127.0.0.1` with TLS, which the agent cannot read. Turn it on where the agent can, then name that address on `1936` as `OPENSTACK_HAPROXY_TARGETS`:":
    "- **HAProxy:** مُصدِّره متوقف، ومستمع الإحصاءات الخاص به على `127.0.0.1` مع TLS، وهو ما لا يستطيع الوكيل قراءته. شغّله حيث يستطيع الوكيل قراءته، ثم اذكر ذلك العنوان على `1936` بوصفه `OPENSTACK_HAPROXY_TARGETS`:",
  "- **MariaDB and Memcached:** OpenStack-Ansible ships no exporter for either. Run [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) and [memcached_exporter](https://github.com/prometheus/memcached_exporter) yourself and name them as `OPENSTACK_MARIADB_TARGETS` and `OPENSTACK_MEMCACHED_TARGETS`, or leave them out: the cloud's **Control Plane** card then says they are not watched, rather than that they are fine.":
    "- **MariaDB وMemcached:** لا يأتي OpenStack-Ansible بمُصدِّر لأيٍّ منهما. شغّل [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) و[memcached_exporter](https://github.com/prometheus/memcached_exporter) بنفسك واذكرهما بوصفهما `OPENSTACK_MARIADB_TARGETS` و`OPENSTACK_MEMCACHED_TARGETS`، أو اتركهما: عندئذٍ تقول بطاقة **مستوى التحكم** للسحابة إنهما غير مراقَبين، بدلًا من أنهما سليمان.",
  "This runs the agent's logs profile as a systemd service, and reads `/var/log/journal/`, where OpenStack-Ansible's containers' journals arrive.":
    "يشغّل هذا ملف تعريف السجلات الخاص بالوكيل بوصفه خدمة systemd، ويقرأ `/var/log/journal/`، حيث تصل سجلات journal لحاويات OpenStack-Ansible.",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from the journal.":
    "يكتب كلٌّ منهما في سجل الخدمة نفسها، دون أي مستهلك على الناقل. يقرؤها OneUptime من هناك بمجرد تشغيل **العثور على الأحداث الأمنية في سجلاتك** ضمن **الأحداث الأمنية ← الاتصالات**. ويقرأ ملف تعريف السجلات الخاص بالوكيل كليهما من journal.",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw. A second value of `notification_opt_out` goes in as a YAML set, as [its config_template](https://docs.openstack.org/ansible-config_template/latest/) writes a repeated key.":
    "يرسل هذا سطرًا عن كل تسجيل دخول، يقرؤه **OpenStack admin credential used from a new address**. لإرسال محاولات الدخول الفاشلة فقط، أضف `identity.authenticate.success` إلى `notification_opt_out`، فيقرأ هذا الكشف عندئذٍ ما رآه مرشّح التدقيق. وتُدخَل قيمة ثانية لـ `notification_opt_out` بوصفها مجموعة YAML، كما يكتب [قالب config_template الخاص به](https://docs.openstack.org/ansible-config_template/latest/) المفتاح المكرر.",
  "For who did what through Nova, Neutron, Cinder and Glance, each API takes the filter's setting in its conf overrides, and the filter in its paste overrides, with `audit` right after `authtoken` and the context filter that follows it in each pipeline. Nova's, and the same in `neutron_neutron_conf_overrides` and `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` and `cinder_api_paste_ini_overrides`, and `glance_glance_api_conf_overrides` and `glance_glance_api_paste_ini_overrides`:":
    "لمعرفة من فعل ماذا عبر Nova وNeutron وCinder وGlance، تأخذ كل واجهة API إعداد المرشّح في تجاوزات conf الخاصة بها، والمرشّح نفسه في تجاوزات paste الخاصة بها، مع وضع `audit` مباشرة بعد `authtoken` ومرشّح السياق الذي يليه في كل مسار معالجة. هذه تجاوزات Nova، والأمر نفسه في `neutron_neutron_conf_overrides` و`neutron_api_paste_ini_overrides`، و`cinder_cinder_conf_overrides` و`cinder_api_paste_ini_overrides`، و`glance_glance_api_conf_overrides` و`glance_glance_api_paste_ini_overrides`:",
  "OpenStack-Helm offers charts for Prometheus, Alertmanager and exporters, and whether they are running is up to you. Its control plane runs in Kubernetes, so a probe reads the APIs and the Kubernetes agent sees the pods.":
    "يقدّم OpenStack-Helm مخططات Helm لـ Prometheus وAlertmanager والمُصدِّرات، وتشغيلها من عدمه يعود إليك. يعمل مستوى التحكم الخاص به في Kubernetes، لذا يقرأ المسبار واجهات API ويرى وكيل Kubernetes الحاويات الجماعية.",
  "**How far this guide has been tested:** Its chart values were read from OpenStack-Helm's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**إلى أي حد اختُبر هذا الدليل:** قُرئت قيم مخططاته من الشيفرة المصدرية لـ OpenStack-Helm نفسه. لم يُتّبع من بدايته إلى نهايته على نشر حقيقي بهذه الأداة. أوصل كلٌّ من الوكيل والمسبار نظام DevStack حقيقيًا إلى OneUptime قيد التشغيل، مرورًا بإيقاف nova-compute وإعادته، لكن ليس من هذه الأداة. اختُبر المسبار ووكيل Kubernetes كلٌّ على حدة، لا معًا على هذه الأداة.",
  "Then add the receiver under `conf.alertmanager` in the chart's values, and send your route to it:":
    "ثم أضف جهة الاستقبال تحت `conf.alertmanager` في قيم المخطط، ووجّه مسارك إليها:",
  "Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. [OpenStack Without an Agent](/docs/telemetry/openstack-agentless) says what each level of access reads, and the connection test says what yours can. The agent also works from any machine with a route to the APIs: choose **Not sure, or something else** above for its steps.":
    "افتح **OpenStack ← كل السحابات**، وانقر **ربط السحابة**، وأعطه عنوان Keystone وبيانات اعتماد تطبيق والمسبار المراد استخدامه. لا يتحدث المسبار مع السحابة إلا عبر HTTPS. يبيّن [OpenStack دون وكيل](/docs/telemetry/openstack-agentless) ما يقرؤه كل مستوى وصول، ويبيّن اختبار الاتصال ما يستطيع مستواك قراءته. ويعمل الوكيل أيضًا من أي جهاز له مسار إلى واجهات API: اختر **غير متأكد، أو شيء آخر** أعلاه لخطواته.",
  "Follow **Kubernetes → Documentation** for this cluster. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "اتبع **Kubernetes ← التوثيق** لهذه المجموعة العنقودية. عندئذٍ تصل حاوياته الجماعية وسجلاتها وعقدها إلى صفحات Kubernetes، وتُراقَب خدمات OpenStack بينها هناك.",
  "To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:":
    "لعرض سجلات تلك الخدمات في صفحة **السجلات** لهذه السحابة أيضًا، كل تتبّع مكدس سجلًا واحدًا، سمِّ السحابة في قيم الوكيل، مع مساحات الأسماء التي تعمل فيها خدماتها:",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.":
    "يكتب كلٌّ منهما في سجل الخدمة نفسها، دون أي مستهلك على الناقل. يقرؤها OneUptime من هناك بمجرد تشغيل **العثور على الأحداث الأمنية في سجلاتك** ضمن **الأحداث الأمنية ← الاتصالات**. ويقرأ وكيل Kubernetes كليهما من سجلات الحاويات الجماعية، مع السحابة المسماة في قيمه.",
  "A chart's `logging.conf` keeps the root logger at `WARNING`, and the log driver writes under a logger of its own, so without one for it nothing is written. A list in values replaces the chart's, so `keys` holds what the chart's has, plus this:":
    "يُبقي ملف `logging.conf` في المخطط المسجّل الجذر على `WARNING`، ويكتب برنامج تشغيل السجلات تحت مسجّل خاص به، لذا لا يُكتب شيء دون مسجّل له. القائمة في القيم تحل محل قائمة المخطط، لذا يحوي `keys` ما تحويه قائمة المخطط، إضافةً إلى هذا:",
  "For who did what through Nova, Neutron and Cinder, their charts' `conf.paste` already has the audit filter in each pipeline, and it needs telling where to write. Each needs the same logger, in `conf.logging`. Glance's chart has the map, and neither the filter nor a place for it in its pipelines: add both to its `conf.paste`.":
    "لمعرفة من فعل ماذا عبر Nova وNeutron وCinder، يحوي `conf.paste` في مخططاتها مرشّح التدقيق بالفعل في كل مسار معالجة، ويلزم إخباره أين يكتب. يحتاج كلٌّ منها إلى المسجّل نفسه، في `conf.logging`. ولدى مخطط Glance ملف الربط، لكن ليس لديه المرشّح ولا مكان له في مسارات معالجته: أضف كليهما إلى `conf.paste` الخاص به.",
  "Atmosphere runs kube-prometheus-stack with its own alert rules, and Loki with Vector for logs. Forward its alerts first, then a probe reads the APIs and the Kubernetes agent sees the pods.":
    "يشغّل Atmosphere حزمة kube-prometheus-stack بقواعد تنبيه خاصة بها، وLoki مع Vector للسجلات. مرّر تنبيهاته أولًا، ثم يقرأ المسبار واجهات API ويرى وكيل Kubernetes الحاويات الجماعية.",
  "**How far this guide has been tested:** Its configuration was read from Atmosphere's own docs and source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**إلى أي حد اختُبر هذا الدليل:** قُرئت إعداداته من التوثيق والشيفرة المصدرية الخاصين بـ Atmosphere نفسه. لم يُتّبع من بدايته إلى نهايته على نشر حقيقي بهذه الأداة. أوصل كلٌّ من الوكيل والمسبار نظام DevStack حقيقيًا إلى OneUptime قيد التشغيل، مرورًا بإيقاف nova-compute وإعادته، لكن ليس من هذه الأداة. اختُبر المسبار ووكيل Kubernetes كلٌّ على حدة، لا معًا على هذه الأداة.",
  "Then add the receiver to your Atmosphere configuration, beside whichever receivers you already have, and deploy it:":
    "ثم أضف جهة الاستقبال إلى إعدادات Atmosphere لديك، بجوار أي جهات استقبال لديك بالفعل، وانشرها:",
  "For who did what through Nova, Neutron and Cinder, the charts Atmosphere deploys already have the audit filter in each pipeline, and it needs telling where to write, in `nova_helm_values`, `neutron_helm_values` and `cinder_helm_values`. Glance's chart has neither the filter nor a place for it in its pipelines: add both to its `conf.paste`, in `glance_helm_values`.":
    "لمعرفة من فعل ماذا عبر Nova وNeutron وCinder، تحوي المخططات التي ينشرها Atmosphere مرشّح التدقيق بالفعل في كل مسار معالجة، ويلزم إخباره أين يكتب، في `nova_helm_values` و`neutron_helm_values` و`cinder_helm_values`. وليس لدى مخطط Glance المرشّح ولا مكان له في مسارات معالجته: أضف كليهما إلى `conf.paste` الخاص به، في `glance_helm_values`.",
  "Sunbeam can deploy the Canonical Observability Stack, with `sunbeam enable observability embedded`. Canonical also has an `openstack-exporter` charm, which the agent can read if you run it.":
    "يستطيع Sunbeam نشر Canonical Observability Stack، باستخدام `sunbeam enable observability embedded`. ولدى Canonical أيضًا charm باسم `openstack-exporter`، يستطيع الوكيل قراءته إن شغّلته.",
  "**How far this guide has been tested:** Its commands were read from Canonical's docs and its charms' source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. Nothing here has been run on Sunbeam, and Sunbeam's own docs do not mention the exporter charm.":
    "**إلى أي حد اختُبر هذا الدليل:** قُرئت أوامره من توثيق Canonical والشيفرة المصدرية لحزم charm الخاصة بها. لم يُتّبع من بدايته إلى نهايته على نشر حقيقي بهذه الأداة. أوصل كلٌّ من الوكيل والمسبار نظام DevStack حقيقيًا إلى OneUptime قيد التشغيل، مرورًا بإيقاف nova-compute وإعادته، لكن ليس من هذه الأداة. لم يُشغَّل شيء هنا على Sunbeam، ولا يذكر توثيق Sunbeam نفسه حزمة charm الخاصة بالمُصدِّر.",
  "Then give the stack's Alertmanager a configuration with the receiver in it:":
    "ثم أعطِ Alertmanager الخاص بالحزمة إعدادات فيها جهة الاستقبال:",
  "If you run Canonical's `openstack-exporter` charm, the agent can read it with no credential of its own. It answers one cloud on `/metrics`, on port `9180` unless you changed its `port` setting. Find its address with `juju status openstack-exporter`:":
    "إن كنت تشغّل charm المسمى `openstack-exporter` من Canonical، يستطيع الوكيل قراءته دون بيانات اعتماد خاصة به. يجيب عن سحابة واحدة على `/metrics`، على المنفذ `9180` ما لم تغيّر إعداد `port` الخاص به. اعثر على عنوانه باستخدام `juju status openstack-exporter`:",
  "Which series it says depends on the exporter release in its snap, which was not recorded here: `bash troubleshoot.sh` says whether it reads the cloud.":
    "تعتمد السلاسل التي يقدّمها على إصدار المُصدِّر في حزمة snap الخاصة به، وهو ما لم يُسجَّل هنا: يبيّن `bash troubleshoot.sh` ما إذا كان يقرأ السحابة.",
  "With observability on, the stack's Loki holds the services' logs. OneUptime has no way to read Loki, and the agent's logs profile has not been tried on Sunbeam's charms, so nothing here collects them yet.":
    "مع تشغيل قابلية المراقبة، يحتفظ Loki الخاص بالحزمة بسجلات الخدمات. ليس لدى OneUptime طريقة لقراءة Loki، ولم يُجرَّب ملف تعريف السجلات الخاص بالوكيل على حزم charm الخاصة بـ Sunbeam، لذا لا يجمعها شيء هنا بعد.",
  "Sunbeam's charms write each service's configuration from their own templates, and its Keystone charm has no setting for where notifications go. So neither Keystone's audit trail nor the audit filter can be turned on from outside the charm, and nothing here reaches Security Events.":
    "تكتب حزم charm الخاصة بـ Sunbeam إعدادات كل خدمة من قوالبها الخاصة، وليس لدى charm الخاص بـ Keystone إعداد لوجهة الإشعارات. لذا لا يمكن تشغيل سجل تدقيق Keystone ولا مرشّح التدقيق من خارج charm، ولا يصل شيء هنا إلى الأحداث الأمنية.",
  "Its Telemetry Operator runs Ceilometer's Prometheus exporter and a monitoring stack with Alertmanager on OpenShift. The Kubernetes agent's OpenShift preset watches the control plane, and Ceilometer's exporter says what the compute nodes are doing.":
    "يشغّل Telemetry Operator الخاص به مُصدِّر Prometheus الخاص بـ Ceilometer وحزمة مراقبة مع Alertmanager على OpenShift. ويراقب الإعداد المسبق لـ OpenShift في وكيل Kubernetes مستوى التحكم، ويبيّن مُصدِّر Ceilometer ما تفعله عقد الحوسبة.",
  "**How far this guide has been tested:** Its resources were read from the Telemetry Operator's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The OpenShift preset and Ceilometer's exporter were each tested on their own, not together on this tool.":
    "**إلى أي حد اختُبر هذا الدليل:** قُرئت موارده من الشيفرة المصدرية لـ Telemetry Operator نفسه. لم يُتّبع من بدايته إلى نهايته على نشر حقيقي بهذه الأداة. أوصل كلٌّ من الوكيل والمسبار نظام DevStack حقيقيًا إلى OneUptime قيد التشغيل، مرورًا بإيقاف nova-compute وإعادته، لكن ليس من هذه الأداة. اختُبر الإعداد المسبق لـ OpenShift ومُصدِّر Ceilometer كلٌّ على حدة، لا معًا على هذه الأداة.",
  "Then apply a receiver the monitoring stack picks up:":
    "ثم طبّق جهة استقبال تلتقطها حزمة المراقبة:",
  "Follow **Kubernetes → Documentation** for this cluster, with **Red Hat OpenShift** picked, which sets `preset=openshift`. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "اتبع **Kubernetes ← التوثيق** لهذه المجموعة العنقودية، مع اختيار **Red Hat OpenShift**، الذي يضبط `preset=openshift`. عندئذٍ تصل حاوياته الجماعية وسجلاتها وعقدها إلى صفحات Kubernetes، وتُراقَب خدمات OpenStack بينها هناك.",
  "A probe says what is allocated, not what is busy. To read real usage, run the agent on a machine that can reach the compute nodes, with `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` naming each node on Ceilometer's port, `9101`.":
    "يبيّن المسبار ما هو مخصّص، لا ما هو مشغول. لقراءة الاستخدام الفعلي، شغّل الوكيل على جهاز يستطيع الوصول إلى عقد الحوسبة، مع `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` الذي يسمّي كل عقدة على منفذ Ceilometer، وهو `9101`.",
  "For who did what through Nova and Neutron, each takes the filter's setting in its `customServiceConfig`, and its paste file in `defaultConfigOverwrite`. Cinder's and Glance's operators take no paste file, so nothing here reaches them.":
    "لمعرفة من فعل ماذا عبر Nova وNeutron، يأخذ كلٌّ منهما إعداد المرشّح في `customServiceConfig` الخاص به، وملف paste الخاص به في `defaultConfigOverwrite`. لا تقبل مشغّلات Cinder وGlance أي ملف paste، لذا لا يصل إليهما شيء هنا.",
  "StackLight already watches OpenStack's services, MariaDB, Memcached, RabbitMQ and libvirt, with its own alert rules. Forward its alerts first, then a probe reads the APIs.":
    "يراقب StackLight بالفعل خدمات OpenStack وMariaDB وMemcached وRabbitMQ وlibvirt، بقواعد تنبيه خاصة به. مرّر تنبيهاته أولًا، ثم يقرأ المسبار واجهات API.",
  "**How far this guide has been tested:** Its settings were read from Mirantis's docs, whose examples show other receivers rather than a webhook. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**إلى أي حد اختُبر هذا الدليل:** قُرئت إعداداته من توثيق Mirantis، الذي تعرض أمثلته جهات استقبال أخرى بدلًا من Webhook. لم يُتّبع من بدايته إلى نهايته على نشر حقيقي بهذه الأداة. أوصل كلٌّ من الوكيل والمسبار نظام DevStack حقيقيًا إلى OneUptime قيد التشغيل، مرورًا بإيقاف nova-compute وإعادته، لكن ليس من هذه الأداة.",
  "Then add the receiver and its route to your StackLight values:":
    "ثم أضف جهة الاستقبال ومسارها إلى قيم StackLight لديك:",
  "For who did what through Nova, Neutron, Cinder and Glance, MOSK has a setting of its own, with the audit filter already in place. With the log driver, each service writes to its standard output, and the Kubernetes agent reads that from the pods' logs, with the cloud named in its values. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "لمعرفة من فعل ماذا عبر Nova وNeutron وCinder وGlance، لدى MOSK إعداد خاص به، ومرشّح التدقيق في مكانه بالفعل. ومع برنامج تشغيل السجلات، تكتب كل خدمة إلى مخرجها القياسي، ويقرأ وكيل Kubernetes ذلك من سجلات الحاويات الجماعية، مع السحابة المسماة في قيمه. يكتب كلٌّ منهما في سجل الخدمة نفسها، دون أي مستهلك على الناقل. يقرؤها OneUptime من هناك بمجرد تشغيل **العثور على الأحداث الأمنية في سجلاتك** ضمن **الأحداث الأمنية ← الاتصالات**.",
  "That setting does not cover Keystone. Its own audit trail takes `spec:services`, which Mirantis does not validate and takes no responsibility for, so weigh this with your support contract:":
    "لا يشمل ذلك الإعداد Keystone. يأخذ سجل التدقيق الخاص به `spec:services`، الذي لا تتحقق منه Mirantis ولا تتحمل أي مسؤولية عنه، لذا وازن هذا مع عقد الدعم لديك:",
  "Keystone's audit trail says who signed in and who changed what in Keystone, and the audit filter says who did what through Nova, Neutron, Cinder and Glance. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "يبيّن سجل تدقيق Keystone من سجّل الدخول ومن غيّر ماذا في Keystone، ويبيّن مرشّح التدقيق من فعل ماذا عبر Nova وNeutron وCinder وGlance. يكتب كلٌّ منهما في سجل الخدمة نفسها، دون أي مستهلك على الناقل. يقرؤها OneUptime من هناك بمجرد تشغيل **العثور على الأحداث الأمنية في سجلاتك** ضمن **الأحداث الأمنية ← الاتصالات**.",
  "The audit filter goes in each API's paste file, right after `authtoken` and the context filter that follows it in each pipeline, with the map file pyCADF ships for that service, in `etc/pycadf` under the Python environment the service runs in. Not at the end of a pipeline: Neutron's `extensions` filter answers its routers and security groups, and the filter would never see them.":
    "يوضع مرشّح التدقيق في ملف paste لكل واجهة API، مباشرة بعد `authtoken` ومرشّح السياق الذي يليه في كل مسار معالجة، مع ملف الربط الذي يأتي به pyCADF لتلك الخدمة، في `etc/pycadf` ضمن بيئة Python التي تعمل فيها الخدمة. لا في نهاية مسار المعالجة: فمرشّح `extensions` في Neutron يجيب عن موجّهاته ومجموعات الأمان الخاصة به، ولن يراها مرشّح التدقيق أبدًا.",
  "[Who did what](/docs/telemetry/openstack#who-did-what) says what reaches Security Events, and [each tool's guide](/docs/telemetry/openstack-deployment-tools) says where these go on it.":
    "يبيّن [من فعل ماذا](/docs/telemetry/openstack#who-did-what) ما يصل إلى الأحداث الأمنية، ويبيّن [دليل كل أداة](/docs/telemetry/openstack-deployment-tools) أين توضع هذه عليها.",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | لا | اسم حاوية المجمّع (الافتراضي: `oneuptime-openstack-agent`). يحتاج وكيل سحابة ثانية على الجهاز نفسه إلى أسماء خاصة به: يسمّي برنامج التثبيت النصي حاويات الوكيل الجديد باسم مجلده ما لم تضبطها بنفسك، ويحتفظ بها عند تشغيل البرنامج النصي مجددًا |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). The install script names a second cloud's bundled exporter after its collector (`oneuptime-openstack-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | لا | اسم حاوية المُصدِّر المرفق (الافتراضي: `oneuptime-openstack-exporter`). يسمّي برنامج التثبيت النصي المُصدِّر المرفق لسحابة ثانية باسم مجمّعه (`oneuptime-openstack-exporter-cloud2` بجوار `oneuptime-openstack-agent-cloud2`) ما لم تضبطه بنفسك، ويحتفظ به عند تشغيل البرنامج النصي مجددًا |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). The install script names a second cloud's quota exporter after its collector (`oneuptime-openstack-quota-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | لا | اسم حاوية مُصدِّر الحصص (الافتراضي: `oneuptime-openstack-quota-exporter`). يسمّي برنامج التثبيت النصي مُصدِّر الحصص لسحابة ثانية باسم مجمّعه (`oneuptime-openstack-quota-exporter-cloud2` بجوار `oneuptime-openstack-agent-cloud2`) ما لم تضبطه بنفسك، ويحتفظ به عند تشغيل البرنامج النصي مجددًا |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). The install script names a second cloud's database exporter after its collector (`oneuptime-openstack-database-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | لا | اسم حاوية مُصدِّر قاعدة البيانات (الافتراضي: `oneuptime-openstack-database-exporter`). يسمّي برنامج التثبيت النصي مُصدِّر قاعدة البيانات لسحابة ثانية باسم مجمّعه (`oneuptime-openstack-database-exporter-cloud2` بجوار `oneuptime-openstack-agent-cloud2`) ما لم تضبطه بنفسك، ويحتفظ به عند تشغيل البرنامج النصي مجددًا |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). The install script names a second cloud's worker state exporter after its collector (`oneuptime-openstack-worker-state-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | لا | اسم حاوية مُصدِّر حالة العمّال (الافتراضي: `oneuptime-openstack-worker-state-exporter`). يسمّي برنامج التثبيت النصي مُصدِّر حالة العمّال لسحابة ثانية باسم مجمّعه (`oneuptime-openstack-worker-state-exporter-cloud2` بجوار `oneuptime-openstack-agent-cloud2`) ما لم تضبطه بنفسك، ويحتفظ به عند تشغيل البرنامج النصي مجددًا |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). The install script names a second cloud's AI agent after its collector (`oneuptime-openstack-ai-agent-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | لا | اسم حاوية وكيل الذكاء الاصطناعي (الافتراضي: `oneuptime-openstack-ai-agent`). يسمّي برنامج التثبيت النصي وكيل الذكاء الاصطناعي لسحابة ثانية باسم مجمّعه (`oneuptime-openstack-ai-agent-cloud2` بجوار `oneuptime-openstack-agent-cloud2`) ما لم تضبطه بنفسك، ويحتفظ به عند تشغيل البرنامج النصي مجددًا |",
  "One agent reads one cloud. For a second cloud, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "يقرأ الوكيل الواحد سحابة واحدة. ولسحابة ثانية، ثبّت وكيلًا ثانيًا في مجلد خاص به، مع أسماء حاويات خاصة به، إذ لا يمكن لحاويتين أن تتشاركا اسمًا:",
  "The script names the containers after the folder, such as `oneuptime-openstack-agent-cloud2`, unless you set their variables, such as `OPENSTACK_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "يسمّي البرنامج النصي الحاويات باسم المجلد، مثل `oneuptime-openstack-agent-cloud2`، ما لم تضبط متغيراتها، مثل `OPENSTACK_AGENT_CONTAINER_NAME`. ويحتفظ بالأسماء في ملف `.env` الخاص بذلك الوكيل، لذا فإن تشغيل البرنامج النصي مجددًا بقيمة `INSTALL_DIR` نفسها لترقية الوكيل يُبقي عليها، والوكيل الذي عدّلت `container_name` الخاص به يومًا في `docker-compose.yml` يحتفظ بذلك الاسم.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "امنح كل مجلد اسمًا خاصًا به: يسمّي Docker Compose المشروع باسم مجلده وحده، لذا يرفض البرنامج النصي مجلدًا يحمل اسم مجلد آخر يشغّل وكيلًا في مكان آخر. مرّر المجلد إلى البرنامج النصي للتشخيص باستخدام `-d`.",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | لا | اسم حاوية المجمّع (الافتراضي: `oneuptime-openstack-agent`). يحتاج وكيل سحابة ثانية على الجهاز نفسه إلى اسم خاص به |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | لا | اسم حاوية المُصدِّر المرفق (الافتراضي: `oneuptime-openstack-exporter`). يحتاج وكيل سحابة ثانية على الجهاز نفسه إلى اسم خاص به |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | لا | اسم حاوية مُصدِّر الحصص (الافتراضي: `oneuptime-openstack-quota-exporter`). يحتاج وكيل سحابة ثانية على الجهاز نفسه إلى اسم خاص به |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | لا | اسم حاوية مُصدِّر قاعدة البيانات (الافتراضي: `oneuptime-openstack-database-exporter`). يحتاج وكيل سحابة ثانية على الجهاز نفسه إلى اسم خاص به |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | لا | اسم حاوية مُصدِّر حالة العمّال (الافتراضي: `oneuptime-openstack-worker-state-exporter`). يحتاج وكيل سحابة ثانية على الجهاز نفسه إلى اسم خاص به |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | لا | اسم حاوية وكيل الذكاء الاصطناعي (الافتراضي: `oneuptime-openstack-ai-agent`). يحتاج وكيل سحابة ثانية على الجهاز نفسه إلى اسم خاص به |",
  "One agent reads one cloud. For a second cloud, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "يقرأ الوكيل الواحد سحابة واحدة. ولسحابة ثانية، أعدّ وكيلًا ثانيًا في مجلد خاص به، مع أسماء حاويات خاصة به، إذ لا يمكن لحاويتين أن تتشاركا اسمًا. اضبطها في ملف `.env` الخاص بذلك الوكيل:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "امنح كل مجلد اسمًا خاصًا به: يسمّي Docker Compose المشروع باسم مجلده وحده، لذا فإن مجلدًا ثانيًا بالاسم نفسه سيستبدل حاويات الوكيل الأول. لا تضع الأسماء في `docker-compose.yml`، الذي تستبدله الترقية.",
};

export default TRANSLATION;
