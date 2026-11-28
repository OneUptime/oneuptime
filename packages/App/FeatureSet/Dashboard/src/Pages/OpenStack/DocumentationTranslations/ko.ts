import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The OpenStack setup guide in Korean (#8341): each piece of the English
 * guide's markdown (Pages/OpenStack/Utils/DocumentationMarkdown.ts) and its
 * Korean. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Korean words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "With `enable_prometheus` on in `/etc/kolla/globals.yml`, which Kolla-Ansible leaves off until you set it, it runs Prometheus, Alertmanager and an exporter for each thing under the cloud, and ships no alert rules. This guide reads what those run rather than starting a second copy.":
    "`/etc/kolla/globals.yml`에서 `enable_prometheus`를 켜면(Kolla-Ansible은 직접 설정하기 전까지 꺼 둡니다) Prometheus, Alertmanager, 그리고 클라우드 아래의 각 구성 요소를 위한 익스포터가 실행되며, 알림 규칙은 함께 제공되지 않습니다. 이 가이드는 두 번째 사본을 띄우는 대신 이들이 실행하는 것을 읽습니다.",
  "**How far this guide has been tested:** Its paths and ports were read from Kolla-Ansible's own source. Its commands were then run on a real all-in-one at stable/2026.1 with Open vSwitch, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, without Docker, on Kolla-Ansible's own exporter and on your own at the pinned version and at 1.7.0, the agent's exporter on the Infrastructure only credential, the targets read from its real prometheus.yml, and the logs profile. With Memcached really stopped there, its Alertmanager posted a firing webhook and then a resolved one, and what it posted, sent to a running OneUptime, opened one incident on the right cloud and on no other, and resolved it. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**이 가이드의 테스트 범위:** 경로와 포트는 Kolla-Ansible 자체 소스에서 읽었습니다. 그런 다음 명령을 stable/2026.1과 Open vSwitch로 구성한 실제 all-in-one에서, 에이전트가 보낸 내용을 보관하는 OneUptime 대역을 상대로 실행했습니다. 대상은 전체 보기 자격 증명을 쓴 에이전트(Docker 없이, Kolla-Ansible 자체 익스포터와, 고정 버전 및 1.7.0의 직접 운영하는 익스포터에서), 인프라 전용 자격 증명을 쓴 에이전트의 익스포터, 실제 prometheus.yml에서 읽은 대상, 그리고 로그 프로필입니다. 그곳에서 Memcached를 실제로 중지하자 Alertmanager가 발생 웹훅과 해결 웹훅을 차례로 보냈고, 이를 실행 중인 OneUptime으로 보내자 올바른 클라우드에만 인시던트가 하나 열렸다가 해결되었습니다. 에이전트와 프로브는 각각 실제 DevStack을 nova-compute 중지와 복구를 거쳐 실행 중인 OneUptime까지 끝까지 연결했지만, 이 도구에서 한 것은 아닙니다.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent (or `bash install.sh --without-docker`, under Advanced)":
    "에이전트를 실행할 머신의 Docker Engine 20.10 이상과 Docker Compose v2 플러그인(또는 고급 항목의 `bash install.sh --without-docker`)",
  "A machine outside the cloud it watches: an agent inside a failed cloud goes quiet with it":
    "감시하는 클라우드 바깥의 머신: 장애가 난 클라우드 안의 에이전트는 클라우드와 함께 조용해집니다",
  "That machine can reach Keystone and every service's API":
    "그 머신에서 Keystone과 각 서비스의 API에 연결할 수 있어야 합니다",
  "The `openstack` command line, as someone who can create the credential below":
    "아래 자격 증명을 만들 수 있는 사용자로 쓰는 `openstack` 명령줄",
  "An alert that fires becomes an incident, with on-call and status pages from the first hour, and it resolves when the alert does. There is nothing to install.":
    "발생한 경고는 인시던트가 되고, 첫 시간부터 온콜과 상태 페이지가 함께 동작하며, 경고가 해결되면 인시던트도 해결됩니다. 설치할 것은 없습니다.",
  "1. In OneUptime, make an Incoming Request monitor as [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) says, and copy its **Heartbeat URL**. That is the `<secret key>` address below.":
    "1. OneUptime에서 [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) 설명대로 수신 요청 모니터를 만들고, 그 **Heartbeat URL** 을 복사하세요. 이것이 아래의 `<secret key>`가 들어간 주소입니다.",
  "2. Open the monitor's **Overview → Linked Resources** and add the OpenStack cloud `my-openstack-cloud`. Each incident is then on that cloud's **Incidents** page, so each cloud's Alertmanager needs a monitor of its own. The cloud shows up in that list once its first data arrives, so do this after the steps below, or add the cloud under **OpenStack → All Clouds** first.":
    "2. 모니터의 **개요 → 연결된 리소스** 를 열고 OpenStack 클라우드 `my-openstack-cloud`를 추가하세요. 그러면 각 인시던트가 그 클라우드의 **인시던트** 페이지에 표시되므로, 클라우드마다 Alertmanager에 전용 모니터가 필요합니다. 클라우드는 첫 데이터가 도착하면 그 목록에 나타나므로, 아래 단계를 마친 뒤에 하거나 먼저 **OpenStack → 모든 클라우드** 에서 클라우드를 추가하세요.",
  "Then, on the host you deploy from, write `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, which Kolla-Ansible reads in place of its own, and apply it:":
    "그런 다음 배포를 실행하는 호스트에서 `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`을 작성하고(Kolla-Ansible은 자체 파일 대신 이 파일을 읽습니다) 적용하세요:",
  "- Log in as an admin with `source /etc/kolla/admin-openrc.sh`, which `kolla-ansible post-deploy` writes.":
    "- `source /etc/kolla/admin-openrc.sh`로 관리자로 로그인하세요. 이 파일은 `kolla-ansible post-deploy`가 작성합니다.",
  "- **Full view** needs one change, to Cinder. Kolla-Ansible's templates already set `service_type` under `[keystone_authtoken]` on Nova, Neutron, Glance and Placement, but its Cinder says `volume` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Add `service_type = block-storage` under `[keystone_authtoken]` in `/etc/kolla/config/cinder.conf`, then run `kolla-ansible reconfigure -i <inventory> --tags cinder`.":
    "- **전체 보기** 에는 Cinder에 대한 변경이 하나 필요합니다. Kolla-Ansible의 템플릿은 Nova, Neutron, Glance, Placement에서는 이미 `[keystone_authtoken]` 아래에 `service_type`을 설정하지만, 그 Cinder는 `volume`, 카탈로그는 `block-storage`라고 하며, 둘이 일치하지 않으면 keystonemiddleware는 액세스 규칙으로 제한된 자격 증명을 `401`로 거부합니다. `/etc/kolla/config/cinder.conf`의 `[keystone_authtoken]` 아래에 `service_type = block-storage`를 추가한 뒤 `kolla-ansible reconfigure -i <inventory> --tags cinder`를 실행하세요.",
  "- **Infrastructure only** takes its overrides at `/etc/kolla/config/nova/policy.yaml`, and the same for `neutron`, `keystone` and `placement`, merged with anything already there. Apply them with `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.":
    "- **인프라 전용** 은 재정의를 `/etc/kolla/config/nova/policy.yaml`에 두며, `neutron`, `keystone`, `placement`도 마찬가지이고, 이미 있는 내용과 병합합니다. `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`로 적용하세요.",
  "**Recommended.** The agent sees everything it reads: services, hypervisors, every project's instances, volumes, networks and routers, and `cinder-volume` and `cinder-scheduler` state and storage pools, which only this level sees. It leaves out Keystone's users and groups, on purpose.":
    "**권장.** 에이전트는 읽는 모든 것을 봅니다: 서비스, 하이퍼바이저, 모든 프로젝트의 인스턴스, 볼륨, 네트워크, 라우터, 그리고 이 수준만 볼 수 있는 `cinder-volume`과 `cinder-scheduler`의 상태와 스토리지 풀입니다. Keystone의 사용자와 그룹은 의도적으로 읽지 않습니다.",
  "This is an application credential on an account with `admin` on a project of its own, limited by access rules to the exact `GET` calls the agent makes, so it cannot write: on every release we record, every read answered `200` and every write `401`. As an admin, make the project and the account:":
    "이것은 전용 프로젝트에서 `admin` 권한을 가진 계정의 애플리케이션 자격 증명으로, 액세스 규칙에 따라 에이전트가 하는 `GET` 호출로만 제한되므로 쓰기를 할 수 없습니다: 기록한 모든 릴리스에서 모든 읽기는 `200`, 모든 쓰기는 `401`로 응답했습니다. 관리자로서 프로젝트와 계정을 만드세요:",
  "Then, logged in as that account on that project, make the credential. An access rule is matched against the path the service sees, and a service behind a path prefix refuses the shipped rules with a `401`, so these commands fit them to this cloud from its catalog first:":
    "그런 다음 그 프로젝트에 그 계정으로 로그인한 상태에서 자격 증명을 만드세요. 액세스 규칙은 서비스가 보는 경로와 비교되며, 경로 접두사 뒤에 있는 서비스는 제공된 규칙을 `401`로 거부하므로, 이 명령은 먼저 카탈로그를 바탕으로 규칙을 이 클라우드에 맞춥니다:",
  "- Copy the `id` and the `secret` it prints: the secret is shown only once.":
    "- 출력된 `id`와 `secret`을 복사하세요. secret은 한 번만 표시됩니다.",
  "- Never add `--unrestricted`, which would let it make more credentials.":
    "- `--unrestricted`는 절대 추가하지 마세요. 추가하면 이 자격 증명이 다른 자격 증명을 만들 수 있게 됩니다.",
  "- Access rules work only where each service sets `service_type` in its `[keystone_authtoken]` section and has been restarted since: `compute`, `network`, `block-storage` (the rules also carry `volume` and `volumev3`, for a Cinder configured that way), `image` and `placement`. Keystone needs nothing. Without that, the services refuse the credential with a `401`.":
    "- 액세스 규칙은 각 서비스가 `[keystone_authtoken]` 섹션에 `service_type`을 설정하고 그 뒤에 다시 시작된 경우에만 동작합니다: `compute`, `network`, `block-storage`(그렇게 구성된 Cinder를 위해 규칙에는 `volume`과 `volumev3`도 들어 있습니다), `image`, `placement`. Keystone에는 아무것도 필요 없습니다. 이것이 없으면 서비스는 자격 증명을 `401`로 거부합니다.",
  "- If you won't change that, leave out `--access-rules`. That makes a plain admin application credential, which can write as well as read, so keep it as safe as an admin password.":
    "- 이것을 바꾸지 않으려면 `--access-rules`를 빼세요. 그러면 읽기뿐 아니라 쓰기도 할 수 있는 일반 관리자 애플리케이션 자격 증명이 만들어지므로, 관리자 비밀번호만큼 안전하게 보관하세요.",
  "- It stops working when it expires. To replace it, make the second credential before you delete the first.":
    "- 만료되면 동작하지 않습니다. 교체하려면 기존 자격 증명을 삭제하기 전에 새 자격 증명을 만드세요.",
  "No admin. The agent sees all of Keystone's projects, domains, services and endpoints, all of Nova including every project's instances, all of Placement, and Neutron's agents and address pools. Volumes, snapshots, networks, subnets, routers, floating IPs and ports appear only for the projects the role is assigned on, so on a project that holds nothing just the shared and external ones, and OneUptime can't see the others.":
    "관리자 권한 없음. 에이전트는 Keystone의 모든 프로젝트, 도메인, 서비스, 엔드포인트, 모든 프로젝트의 인스턴스를 포함한 Nova 전체, Placement 전체, 그리고 Neutron의 에이전트와 주소 풀을 봅니다. 볼륨, 스냅샷, 네트워크, 서브넷, 라우터, Floating IP, 포트는 역할이 할당된 프로젝트에 대해서만 표시되므로, 빈 프로젝트에서는 공유 및 외부 항목만 보이고, 나머지는 OneUptime에서 볼 수 없습니다.",
  "It does not see `cinder-volume` or `cinder-scheduler` state or storage pools: Cinder's own code asks for an admin there, after policy has already passed, so no override opens them, and only **Full view** sees them.":
    "`cinder-volume`이나 `cinder-scheduler`의 상태와 스토리지 풀은 보지 못합니다: 정책을 통과한 뒤에 Cinder 자체 코드가 관리자를 요구하므로 어떤 재정의로도 열 수 없으며, 이를 보는 것은 **전체 보기** 뿐입니다.",
  "This is a role of its own, `oneuptime_monitoring`, with the policy overrides the agent ships, on a project of its own that holds nothing and has zero quota. Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes. With nothing to touch and no quota to make anything with, there is nothing for it to write: on every release we record, every write answered `403`, or `409` and `413` from quota. As an admin, make the role, the project and an account:":
    "이것은 에이전트가 제공하는 정책 재정의를 가진 전용 역할 `oneuptime_monitoring`으로, 아무것도 없고 할당량이 0인 전용 프로젝트에 있습니다. Cinder에서 `enforce_new_defaults`가 꺼져 있으면(이것이 Cinder 자체 기본값입니다) 프로젝트의 어떤 역할이든 그 프로젝트의 볼륨을 만들 수 있습니다. 건드릴 것도, 무언가를 만들 할당량도 없으므로 쓸 것이 없습니다: 기록한 모든 릴리스에서 모든 쓰기는 `403`, 또는 할당량 때문에 `409`와 `413`으로 응답했습니다. 관리자로서 역할, 프로젝트, 계정을 만드세요:",
  "Download the overrides, and merge each, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config. That is `/etc/nova/policy.yaml` and so on, unless your deployment says otherwise. Each override keeps the service's default and adds the role. oslo.policy notices a changed file on its own, so nothing restarts:":
    "재정의를 내려받아, 모든 컨트롤러에서 각 재정의를 해당 서비스 구성의 `[oslo_policy] policy_file`이 가리키는 파일에 병합하세요. 배포에서 따로 정하지 않았다면 `/etc/nova/policy.yaml` 등입니다. 각 재정의는 서비스의 기본값을 유지하고 역할을 추가합니다. oslo.policy는 바뀐 파일을 스스로 알아차리므로 아무것도 다시 시작하지 않습니다:",
  "**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.":
    "**재정의를 다시 없애려면 파일을 비우고(`{}`) 절대 삭제하지 마세요.** Flamingo(2025.2)와 Epoxy(2025.1)에서는 읽어 둔 정책 파일이 사라지면 oslo.policy가 모든 검사에서 오류를 내므로, 그 서비스는 모든 요청에 실패합니다. 그 서비스가 Keystone이면 토큰 검증을 멈추고 클라우드 전체가 `503`으로 응답합니다. 이미 그렇게 되었다면 서비스를 다시 시작하세요.",
  "Then, logged in as that account on that project, make the credential and copy the `id` and the `secret` it prints:":
    "그런 다음 그 프로젝트에 그 계정으로 로그인한 상태에서 자격 증명을 만들고, 출력된 `id`와 `secret`을 복사하세요:",
  "Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. `troubleshoot.sh` warns when the credential's project holds things.":
    "볼륨과 라우터를 보려고 실제 프로젝트에 역할을 주면, Cinder에서 `enforce_new_defaults`가 꺼진 클라우드에서는 그 계정이 그곳에 쓰기도 할 수 있습니다. 자격 증명의 프로젝트에 무언가 있으면 `troubleshoot.sh`가 경고합니다.",
  "For a team watching its own part of a cloud someone else runs. The agent sees one project's volumes, networks and routers, and no infrastructure: no hypervisors, services or storage pools.":
    "다른 사람이 운영하는 클라우드에서 자기 팀이 맡은 부분을 감시하는 팀을 위한 수준입니다. 에이전트는 한 프로젝트의 볼륨, 네트워크, 라우터만 보며, 인프라는 보지 않습니다: 하이퍼바이저, 서비스, 스토리지 풀은 보이지 않습니다.",
  "Through the agent it shows no instances at all: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.":
    "이 수준에서는 에이전트를 통해 인스턴스가 전혀 표시되지 않습니다: 익스포터가 Nova에 모든 프로젝트의 서버를 요청하는데, Nova가 일반 읽기 사용자를 거부하므로 그 읽기 전체가 실패합니다. 한 프로젝트의 인스턴스를 나열할 수 있는 것은 이 에이전트 없이 수집하는 OneUptime 프로브뿐입니다.",
  "This is the plain `reader` role. Give an account the role on the project:":
    "이것은 일반 `reader` 역할입니다. 프로젝트에서 계정에 역할을 부여하세요:",
  "Neutron and Cinder answer a reader with its own project and no error, so these lists look complete, and hold only that project.":
    "Neutron과 Cinder는 읽기 사용자에게 오류 없이 그 사용자의 프로젝트만 응답하므로, 이 목록은 완전해 보이지만 그 프로젝트만 담고 있습니다.",
  "It may be able to write. On a cloud where Cinder has `enforce_new_defaults` off, which is Cinder's own default, plain `reader` can create volumes in its project too. On Epoxy, Flamingo and Gazpacho it did, and on Hibiscus it was refused, because DevStack only turns `enforce_new_defaults` on there.":
    "쓰기가 가능할 수도 있습니다. Cinder에서 `enforce_new_defaults`가 꺼진 클라우드(이것이 Cinder 자체 기본값입니다)에서는 일반 `reader`도 자기 프로젝트에 볼륨을 만들 수 있습니다. Epoxy, Flamingo, Gazpacho에서는 만들어졌고 Hibiscus에서는 거부되었는데, DevStack이 그곳에서만 `enforce_new_defaults`를 켜기 때문입니다.",
  "No credential and nothing new to run: the agent reads the exporter Kolla-Ansible already runs, through its internal VIP on `9198`. Skip the install's credential questions by giving it the address:":
    "자격 증명도, 새로 실행할 것도 없습니다: 에이전트는 Kolla-Ansible이 이미 실행하는 익스포터를 `9198`의 내부 VIP를 통해 읽습니다. 설치할 때 주소를 넘기면 자격 증명 질문을 건너뜁니다:",
  "Kolla-Ansible pins exporter 1.7.0 and runs it without `--multi-cloud`, so it has no `/probe`: the agent asks it for everything at once, every 2 minutes, on top of Kolla-Ansible's own Prometheus asking every minute. Its answer also says less. On five real clouds, the pages went without:":
    "Kolla-Ansible은 익스포터를 1.7.0으로 고정하고 `--multi-cloud` 없이 실행하므로 `/probe`가 없습니다: 에이전트는 2분마다 모든 것을 한 번에 요청하며, 여기에 더해 Kolla-Ansible 자체 Prometheus도 1분마다 요청합니다. 응답에 담긴 정보도 더 적습니다. 실제 클라우드 다섯 곳에서 페이지에 빠진 것은 다음과 같습니다:",
  "| Goes without | Because | What it costs |": "| 빠지는 것 | 이유 | 영향 |",
  "| Everything of Cinder's | It asks the catalog for `volumev3`, and finds no such thing where Cinder registers as `block-storage` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, `cinder-volume` or `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |":
    "| Cinder의 모든 것 | 카탈로그에 `volumev3`를 요청하지만, Cinder가 `block-storage`로 등록된 곳에서는 찾지 못함 | **볼륨** 과 **스토리지 풀** 이 비어 있고, **서비스** 에 Block Storage API, `cinder-volume`, `cinder-scheduler`가 없음. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error**, **Volume Stuck** 이 발생하지 않음 |",
  "| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |":
    "| 하이퍼바이저가 담은 인스턴스 수와 그 집계 | Kolla-Ansible이 요청하는 최신 마이크로버전에서 Nova의 하이퍼바이저 목록이 실패함 | **하이퍼바이저** 의 그 두 항목과, 잃은 호스트가 함께 가져간다고 알리는 것. vCPU, 메모리, 디스크는 그대로 표시됨: Placement에서 가져옴 |",
  "| Domains | It has no such series | **Domains** stays empty |":
    "| 도메인 | 그런 시계열이 없음 | **도메인** 이 비어 있음 |",
  "| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to `active` goes unnoticed |":
    "| 이미지의 상태, 공개 범위, 생성 날짜 | 그런 레이블이 없음 | **이미지** 의 해당 열. **Image Stuck** 이 발생하지 않으므로 `active`로 가는 도중 멈춘 이미지를 알아채지 못함 |",
  "| A network's MTU | It has no such label | That line on a network's page |":
    "| 네트워크의 MTU | 그런 레이블이 없음 | 네트워크 페이지의 해당 줄 |",
  "If you need those, use one of the other tabs and the agent's own exporter. You can change your mind later: a cloud keeps its name whichever reads it.":
    "이것들이 필요하면 다른 탭 중 하나와 에이전트 자체 익스포터를 사용하세요. 나중에 바꿔도 됩니다: 무엇이 읽든 클라우드의 이름은 유지됩니다.",
  "The script asks for:": "스크립트는 다음을 묻습니다:",
  "- **OneUptime URL and ingestion key**, both shown in step 1. Pick a key there to have them filled in here.":
    "- **OneUptime URL과 수집 키**: 둘 다 1단계에 표시됩니다. 그곳에서 키를 선택하면 여기에 채워집니다.",
  "- **Cloud name**: how the cloud appears in OneUptime. Keep it stable: a new name registers a new cloud.":
    "- **클라우드 이름**: OneUptime에 클라우드가 표시되는 이름입니다. 바꾸지 마세요. 새 이름은 새 클라우드로 등록됩니다.",
  "- **Keystone auth URL**, such as `https://keystone.example.com:5000/v3`.":
    "- **Keystone 인증 URL**: 예: `https://keystone.example.com:5000/v3`.",
  "- **Region names**, comma-separated (`RegionOne` if you have one).":
    "- **리전 이름**: 쉼표로 구분합니다(리전이 하나라면 `RegionOne`).",
  "- **Application credential**: the ID and secret from the previous step. Neither is echoed to the screen, and neither goes on a command line.":
    "- **애플리케이션 자격 증명**: 이전 단계의 ID와 secret입니다. 둘 다 화면에 표시되지 않고, 명령줄에도 남지 않습니다.",
  "- **Private CA file**, only if the cloud's certificate comes from its own certificate authority.":
    "- **사설 CA 파일**: 클라우드 인증서를 자체 인증 기관에서 발급한 경우에만.",
  "It checks the credential with Keystone before it installs anything, installs to `/opt/oneuptime-openstack-agent` (or to `oneuptime-openstack-agent` in your home folder if you have no rights on `/opt`, and it says which), writes a `.env` file and a `clouds.yaml` only their owner can read, and starts everything with Docker Compose. Running it again reuses all of that instead of asking again, so it is also how you upgrade.":
    "무엇이든 설치하기 전에 Keystone에서 자격 증명을 확인하고, `/opt/oneuptime-openstack-agent`에 설치하며(`/opt`에 권한이 없으면 홈 폴더의 `oneuptime-openstack-agent`에 설치하고 어느 쪽인지 알려 줍니다), 소유자만 읽을 수 있는 `.env` 파일과 `clouds.yaml`을 작성하고, Docker Compose로 모두 시작합니다. 다시 실행하면 다시 묻지 않고 이 모든 것을 재사용하므로, 업그레이드도 이 방법으로 합니다.",
  "`docker compose ps` lists the collector (`oneuptime-openstack-agent`), the bundled exporter (`oneuptime-openstack-exporter`) and the OneUptime AI agent (`oneuptime-openstack-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cloud then appears in the **OpenStack** section by itself. Give it about five minutes to fill in: compute, network, volume and Placement are read every 2 minutes, identity and images every 5.":
    "`docker compose ps`는 컬렉터(`oneuptime-openstack-agent`), 번들 익스포터(`oneuptime-openstack-exporter`), OneUptime AI 에이전트(`oneuptime-openstack-ai-agent`)를 보여 줍니다. 컬렉터 로그에서 `Everything is ready. Begin running and processing data.`를 찾으세요. 그러면 클라우드가 **OpenStack** 섹션에 자동으로 나타납니다. 데이터가 채워지기까지 5분 정도 기다리세요: compute, 네트워크, 볼륨, Placement는 2분마다, identity와 이미지는 5분마다 읽습니다.",
  "On the host that runs Kolla-Ansible's Prometheus, this reads its targets from the file Kolla-Ansible rendered, and prints them as settings for the agent:":
    "Kolla-Ansible의 Prometheus를 실행하는 호스트에서, 이것은 Kolla-Ansible이 생성한 파일에서 대상을 읽어 에이전트용 설정으로 출력합니다:",
  "Add what it prints to the agent's `.env`, then run `docker compose up -d` in the agent's folder. Each exporter listens on the API network, so the agent's machine needs a route there. The cloud's **Control Plane** card then says how each one is, and says plainly which ones are not watched.":
    "출력된 내용을 에이전트의 `.env`에 추가한 뒤 에이전트 폴더에서 `docker compose up -d`를 실행하세요. 각 익스포터는 API 네트워크에서 수신 대기하므로, 에이전트 머신에 그곳으로 가는 경로가 필요합니다. 그러면 클라우드의 **컨트롤 플레인** 카드가 각 익스포터의 상태를 보여 주고, 감시하지 않는 것도 분명히 알려 줍니다.",
  "| Reads | Port | Setting |": "| 읽는 대상 | 포트 | 설정 |",
  "| RabbitMQ's Prometheus plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |":
    "| RabbitMQ의 Prometheus 플러그인 | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |",
  "| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |":
    "| mysqld_exporter(MariaDB용) | `9104` | `OPENSTACK_MARIADB_TARGETS` |",
  "| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |":
    "| memcached_exporter(Memcached용) | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |",
  "| HAProxy's own exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |":
    "| HAProxy 자체 익스포터 | `9101` | `OPENSTACK_HAPROXY_TARGETS` |",
  "| openstack-network-exporter, for OVN and Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |":
    "| openstack-network-exporter(OVN과 Open vSwitch용) | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |",
  "| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |":
    "| prometheus-libvirt-exporter(libvirt용) | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |",
  "- **OVN's databases:** Kolla-Ansible runs openstack-network-exporter from 2026.1, on compute and network nodes only, and an OVN database is read from the host it runs on. If your control nodes are neither, add them under `[prometheus-openstack-network-exporter:children]` in your inventory and reconfigure, or the Northbound and Southbound databases read as not watched.":
    "- **OVN의 데이터베이스:** Kolla-Ansible은 2026.1부터 컴퓨트 노드와 네트워크 노드에서만 openstack-network-exporter를 실행하며, OVN 데이터베이스는 그것이 실행되는 호스트에서 읽습니다. 컨트롤 노드가 둘 다 아니라면 인벤토리의 `[prometheus-openstack-network-exporter:children]`에 추가하고 다시 구성하세요. 그렇지 않으면 Northbound와 Southbound 데이터베이스가 감시되지 않음으로 표시됩니다.",
  "- **Before 2026.1** there is no network exporter, so OVN and Open vSwitch read as not watched.":
    "- **2026.1 이전** 에는 네트워크 익스포터가 없으므로 OVN과 Open vSwitch가 감시되지 않음으로 표시됩니다.",
  "The agent's logs profile runs on each node, and reads Kolla-Ansible's files. It is what joins a line to the cloud's pages:":
    "에이전트의 로그 프로필은 각 노드에서 실행되며 Kolla-Ansible의 파일을 읽습니다. 로그 줄을 클라우드 페이지에 연결하는 것이 바로 이것입니다:",
  "Kolla's own Fluentd can forward too, with an output in `/etc/kolla/config/fluentd/output/*.conf` as [Fluentd](/docs/telemetry/fluentd) describes, but those records reach **Logs** under a service's name, and not the cloud's pages.":
    "Kolla 자체 Fluentd도 [Fluentd](/docs/telemetry/fluentd) 설명대로 `/etc/kolla/config/fluentd/output/*.conf`에 출력을 두어 전달할 수 있지만, 그 레코드는 서비스 이름으로 **로그** 에 도착하며 클라우드 페이지에는 도착하지 않습니다.",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from `/var/log/kolla`.":
    "둘 다 서비스 자체 로그에 기록하며, 버스에는 소비자가 없습니다. **보안 이벤트 → 연결** 에서 **로그에서 보안 이벤트 찾기** 를 켜면 OneUptime이 그곳에서 이를 읽습니다. 에이전트의 로그 프로필은 둘 다 `/var/log/kolla`에서 읽습니다.",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.":
    "이렇게 하면 로그인마다 한 줄이 전송되고, 이를 **OpenStack admin credential used from a new address** 가 읽습니다. 실패한 로그인만 보내려면 `notification_opt_out`에 `identity.authenticate.success`를 추가하세요. 그러면 이 탐지는 감사 필터가 본 내용을 읽습니다.",
  "For who did what through Nova, Neutron, Cinder and Glance, the audit filter needs a setting, which goes in every service's config at once:":
    "Nova, Neutron, Cinder, Glance를 통해 누가 무엇을 했는지 알려면 감사 필터에 설정이 하나 필요하며, 이 설정은 모든 서비스의 구성에 한 번에 들어갑니다:",
  "It also needs a paste file, and Kolla-Ansible's config tasks copy no paste file for these services. Put yours on each API host, and mount it over the one in the image with `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` and `glance_api_extra_volumes` in `globals.yml`. pyCADF's map files are in `/var/lib/kolla/venv/etc/pycadf` in the image. [Who did what](/docs/telemetry/openstack#who-did-what) has the filter's lines.":
    "paste 파일도 필요한데, Kolla-Ansible의 구성 작업은 이 서비스들의 paste 파일을 복사하지 않습니다. 각 API 호스트에 직접 만든 파일을 두고, `globals.yml`의 `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes`, `glance_api_extra_volumes`로 이미지 안의 파일 위에 마운트하세요. pyCADF의 맵 파일은 이미지 안의 `/var/lib/kolla/venv/etc/pycadf`에 있습니다. 필터의 줄은 [누가 무엇을 했는지](/docs/telemetry/openstack#who-did-what)에 있습니다.",
  "OpenStack's `reader` role is scoped to a project everywhere except Keystone and Ironic, and hypervisors, services, agents, pools and Placement default to admin. A policy override can't open all-project lists in Cinder or Neutron, because they scope those lists in code, and Cinder's own code keeps its services and storage pools for an admin. So what a credential can read depends on which level you choose. This is what five real clouds answered, on Epoxy, Flamingo, Gazpacho (OVN and OVS) and Hibiscus:":
    "OpenStack의 `reader` 역할은 Keystone과 Ironic을 제외한 모든 곳에서 프로젝트 범위로 제한되며, 하이퍼바이저, 서비스, 에이전트, 풀, Placement는 기본적으로 관리자 전용입니다. Cinder와 Neutron은 코드에서 전체 프로젝트 목록의 범위를 제한하므로 정책 재정의로는 이를 열 수 없고, Cinder 자체 코드는 서비스와 스토리지 풀을 관리자에게만 허용합니다. 그래서 자격 증명이 읽을 수 있는 범위는 고르는 수준에 따라 달라집니다. Epoxy, Flamingo, Gazpacho(OVN과 OVS), Hibiscus의 실제 클라우드 다섯 곳이 응답한 결과는 다음과 같습니다:",
  "| Read | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |":
    "| 읽기 | 수준 1: 전체 보기 | 수준 2: 인프라 전용 | 수준 3: 프로젝트 보기 |",
  "| Keystone: projects | all | all | refused |":
    "| Keystone: 프로젝트 | 전체 | 전체 | 거부됨 |",
  "| Keystone: domains | all | all | refused |":
    "| Keystone: 도메인 | 전체 | 전체 | 거부됨 |",
  "| Keystone: regions | all | what anyone sees | what anyone sees |":
    "| Keystone: 리전 | 전체 | 누구나 보는 것 | 누구나 보는 것 |",
  "| Keystone: services | all | all | refused |":
    "| Keystone: 서비스 | 전체 | 전체 | 거부됨 |",
  "| Keystone: endpoints | all | all | refused |":
    "| Keystone: 엔드포인트 | 전체 | 전체 | 거부됨 |",
  "| Nova: servers, all projects | all | all | refused |":
    "| Nova: 서버, 모든 프로젝트 | 전체 | 전체 | 거부됨 |",
  "| Nova: services | all | all | refused |":
    "| Nova: 서비스 | 전체 | 전체 | 거부됨 |",
  "| Nova: hypervisors | all | all | refused |":
    "| Nova: 하이퍼바이저 | 전체 | 전체 | 거부됨 |",
  "| Nova: aggregates | all | all | refused |":
    "| Nova: 집계 | 전체 | 전체 | 거부됨 |",
  "| Nova: availability zones, detail | all | all | refused |":
    "| Nova: 가용 영역, 상세 | 전체 | 전체 | 거부됨 |",
  "| Nova: flavors | all | what anyone sees | what anyone sees |":
    "| Nova: 플레이버 | 전체 | 누구나 보는 것 | 누구나 보는 것 |",
  "| Nova: usage per project | all | all | refused |":
    "| Nova: 프로젝트별 사용량 | 전체 | 전체 | 거부됨 |",
  "| Placement: resource providers | all | all | refused |":
    "| Placement: 리소스 공급자 | 전체 | 전체 | 거부됨 |",
  "| Neutron: agents | all | all | nothing |":
    "| Neutron: 에이전트 | 전체 | 전체 | 없음 |",
  "| Neutron: networks | all | own project only | own project only |":
    "| Neutron: 네트워크 | 전체 | 자기 프로젝트만 | 자기 프로젝트만 |",
  "| Neutron: subnets | all | own project only | own project only |":
    "| Neutron: 서브넷 | 전체 | 자기 프로젝트만 | 자기 프로젝트만 |",
  "| Neutron: routers | all | own project only | own project only |":
    "| Neutron: 라우터 | 전체 | 자기 프로젝트만 | 자기 프로젝트만 |",
  "| Neutron: floating IPs | all | own project only | own project only |":
    "| Neutron: Floating IP | 전체 | 자기 프로젝트만 | 자기 프로젝트만 |",
  "| Neutron: IP availabilities | all | all | nothing |":
    "| Neutron: IP 가용성 | 전체 | 전체 | 없음 |",
  "| Neutron: security groups | all | 409, expected | own project only |":
    "| Neutron: 보안 그룹 | 전체 | 409, 예상됨 | 자기 프로젝트만 |",
  "| Neutron: ports | all | own project only | own project only |":
    "| Neutron: 포트 | 전체 | 자기 프로젝트만 | 자기 프로젝트만 |",
  "| Neutron: quotas | all | refused | refused |":
    "| Neutron: 할당량 | 전체 | 거부됨 | 거부됨 |",
  "| Cinder: volumes, all projects | all | own project only | own project only |":
    "| Cinder: 볼륨, 모든 프로젝트 | 전체 | 자기 프로젝트만 | 자기 프로젝트만 |",
  "| Cinder: services | all | refused | refused |":
    "| Cinder: 서비스 | 전체 | 거부됨 | 거부됨 |",
  "| Cinder: pools | all | refused | refused |":
    "| Cinder: 풀 | 전체 | 거부됨 | 거부됨 |",
  "| Cinder: snapshots, all projects | all | own project only | own project only |":
    "| Cinder: 스냅샷, 모든 프로젝트 | 전체 | 자기 프로젝트만 | 자기 프로젝트만 |",
  "| Cinder: backups, all projects | all | none recorded | none recorded |":
    "| Cinder: 백업, 모든 프로젝트 | 전체 | 기록 없음 | 기록 없음 |",
  "| Cinder: volume types | all | what anyone sees | what anyone sees |":
    "| Cinder: 볼륨 유형 | 전체 | 누구나 보는 것 | 누구나 보는 것 |",
  "| Glance: images | all | what anyone sees | what anyone sees |":
    "| Glance: 이미지 | 전체 | 누구나 보는 것 | 누구나 보는 것 |",
  "- **all**: the same rows an admin saw.":
    "- **전체**: 관리자가 본 것과 같은 행.",
  "- **own project only**: that project's rows, and anything shared or external. On a project that holds nothing, that is just the shared and external ones.":
    "- **자기 프로젝트만**: 그 프로젝트의 행과, 공유되거나 외부인 모든 것. 빈 프로젝트에서는 공유 및 외부 항목뿐입니다.",
  "- **refused**: a `401` or a `403`.": "- **거부됨**: `401` 또는 `403`.",
  "- **what anyone sees**: every credential saw every row, on clouds that hold only public flavors, volume types and images. A private one in another project takes **Full view**.":
    "- **누구나 보는 것**: 공개 플레이버, 볼륨 유형, 이미지만 있는 클라우드에서 모든 자격 증명이 모든 행을 보았습니다. 다른 프로젝트의 비공개 항목에는 **전체 보기** 가 필요합니다.",
  "- **nothing**: a `200` with no rows, on a project that has networks too. It looks like it worked, and it did not.":
    "- **없음**: 네트워크도 있는 프로젝트에서 행이 없는 `200`. 성공한 것처럼 보이지만 그렇지 않습니다.",
  "- **none recorded**: a `200` with no rows where an admin saw none either, so there was nothing to tell by.":
    "- **기록 없음**: 관리자도 아무것도 보지 못한 곳에서 행이 없는 `200`. 그래서 판단할 근거가 없었습니다.",
  "- **409, expected**: Neutron tries to create the project's default security group when it lists them, and zero quota does not let it, so it answers `409 Quota exceeded`. That is harmless, and nothing to fix.":
    "- **409, 예상됨**: Neutron은 보안 그룹을 나열할 때 프로젝트의 기본 보안 그룹을 만들려고 하는데, 할당량이 0이라 만들 수 없어 `409 Quota exceeded`로 응답합니다. 무해하며, 고칠 것은 없습니다.",
  "A list a credential can't read looks empty here: `troubleshoot.sh` says what this credential can read, and what each gap costs.":
    "자격 증명이 읽을 수 없는 목록은 여기서 비어 보입니다: `troubleshoot.sh`는 이 자격 증명이 읽을 수 있는 것과 각 공백의 영향을 알려 줍니다.",
  "Monitoring must never be what takes a cloud down, so the agent is gentle by default:":
    "모니터링이 클라우드를 다운시키는 원인이 되어서는 안 되므로, 에이전트는 기본적으로 부담을 적게 줍니다:",
  "| Reads | Every | Gives |": "| 읽는 대상 | 주기 | 얻는 것 |",
  "| **Compute (Nova)** | 2 minutes | Services, hypervisors, instances and flavors |":
    "| **Compute(Nova)** | 2분 | 서비스, 하이퍼바이저, 인스턴스, 플레이버 |",
  "| **Placement** | 2 minutes | What each hypervisor can promise, and has promised |":
    "| **Placement** | 2분 | 각 하이퍼바이저가 약속할 수 있는 양과 이미 약속한 양 |",
  "| **Networking (Neutron)** | 2 minutes | Agents, networks, subnets, address use, routers and floating IPs |":
    "| **네트워킹(Neutron)** | 2분 | 에이전트, 네트워크, 서브넷, 주소 사용량, 라우터, Floating IP |",
  "| **Block Storage (Cinder)** | 2 minutes | Services, volumes, snapshots and storage pools |":
    "| **블록 스토리지(Cinder)** | 2분 | 서비스, 볼륨, 스냅샷, 스토리지 풀 |",
  "| **Identity (Keystone)** | 5 minutes | Projects and domains |":
    "| **ID(Keystone)** | 5분 | 프로젝트와 도메인 |",
  "| **Images (Glance)** | 5 minutes | Images |":
    "| **이미지(Glance)** | 5분 | 이미지 |",
  "- Each service is read on its own, so a failing Nova costs only Nova's numbers, and the rest keep reporting.":
    "- 각 서비스는 따로 읽으므로, Nova가 실패해도 잃는 것은 Nova의 수치뿐이고 나머지는 계속 보고합니다.",
  "- A read never outlasts its interval, so a slow one never stacks on the next.":
    "- 읽기는 주기보다 오래 걸리지 않으므로, 느린 읽기가 다음 읽기에 쌓이지 않습니다.",
  "- Each project's quotas are off. To turn them on, run the installer again with `OPENSTACK_COLLECT_QUOTAS=true`: a second exporter reads them once an hour, at four calls per project per region. Neutron's quotas answer only **Full view**.":
    "- 각 프로젝트의 할당량은 꺼져 있습니다. 켜려면 `OPENSTACK_COLLECT_QUOTAS=true`로 설치 프로그램을 다시 실행하세요: 두 번째 익스포터가 한 시간에 한 번, 프로젝트와 리전마다 네 번 호출해 읽습니다. Neutron의 할당량은 **전체 보기** 에만 응답합니다.",
  "- Nova's own quota lists and usage per server are off. To turn one on, delete its `--disable-metric` line from the exporter's `command` in `docker-compose.yml`. The cost is one call per project per scrape.":
    "- Nova 자체의 할당량 목록과 서버별 사용량은 꺼져 있습니다. 하나를 켜려면 `docker-compose.yml`에 있는 익스포터 `command`에서 해당 `--disable-metric` 줄을 지우세요. 비용은 스크레이프마다 프로젝트당 한 번의 호출입니다.",
  "- The per-port series are off: listing every port with an admin credential can saturate Neutron on a large cloud.":
    "- 포트별 시계열은 꺼져 있습니다: 관리자 자격 증명으로 모든 포트를 나열하면 큰 클라우드에서는 Neutron이 포화될 수 있습니다.",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Give the install script every region's name. It writes one `clouds.yaml` entry for each. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "클라우드는 리전이 몇 개든 하나의 Keystone이며, 에이전트 하나가 모든 리전을 읽습니다. 설치 스크립트에 모든 리전의 이름을 넘기세요. 리전마다 `clouds.yaml` 항목을 하나씩 작성합니다. 각 항목에는 리전 이름을 붙여야 합니다: 시계열에는 어느 리전에서 왔는지가 없으므로, 컬렉터가 그 이름을 `openstack.region.name`으로 익스포터의 시계열에 붙입니다. 그러면 OneUptime의 모든 목록을 리전으로 필터링할 수 있습니다.",
  "Regions with a Keystone of their own are separate clouds to OneUptime: run one agent for each.":
    "자체 Keystone이 있는 리전은 OneUptime에서 별도의 클라우드입니다: 리전마다 에이전트를 하나씩 실행하세요.",
  "**[Very Large OpenStack Clouds](/docs/telemetry/openstack-very-large-clouds)** has what each size costs and how each of these works.":
    "규모별 비용과 각 방식의 동작은 **[매우 큰 OpenStack 클라우드](/docs/telemetry/openstack-very-large-clouds)** 에 있습니다.",
  "**Past 5,000 instances, summary mode.** The cloud keeps a row for every part and counts per hypervisor, project and status, and its series per instance and per volume stop. It gives up the history of each settled instance's and volume's status, and a chart or a monitor over those series. An instance or volume in a state an alert watches keeps its series, so every alert template goes on working. To keep them for some, choose their projects under **Real usage per instance** on the cloud's **Settings** page.":
    "**인스턴스 5,000개 이상: 요약 모드.** 클라우드는 모든 구성 요소의 행과 하이퍼바이저, 프로젝트, 상태별 개수를 유지하고, 인스턴스별 및 볼륨별 시계열은 멈춥니다. 안정된 인스턴스와 볼륨의 상태 기록, 그리고 그 시계열에 대한 차트나 모니터는 포기합니다. 경고가 감시하는 상태의 인스턴스나 볼륨은 시계열을 유지하므로 모든 경고 템플릿이 계속 동작합니다. 일부에 대해 유지하려면 클라우드의 **설정** 페이지에서 **인스턴스별 실제 사용량** 아래 해당 프로젝트를 선택하세요.",
  "**Sharing a cloud between agents.** Run one agent per region, or per service for the largest clouds, each with the same `OPENSTACK_CLOUD_NAME`. A region and a service belong to one agent, and Keystone to one agent for the whole cloud, or their series arrive twice. List an agent's regions in `OPENSTACK_EXPORTER_CLOUDS`, and its services in `OPENSTACK_AGENT_SERVICES`, such as `compute|placement`.":
    "**여러 에이전트로 클라우드 나누기.** 리전마다, 가장 큰 클라우드라면 서비스마다 에이전트를 하나씩 실행하고, 각각 같은 `OPENSTACK_CLOUD_NAME`을 설정합니다. 리전과 서비스는 한 에이전트에, Keystone은 클라우드 전체에서 한 에이전트에 속해야 하며, 그렇지 않으면 시계열이 두 번 도착합니다. 에이전트의 리전은 `OPENSTACK_EXPORTER_CLOUDS`에, 서비스는 `OPENSTACK_AGENT_SERVICES`에 나열하세요(예: `compute|placement`).",
  "**Past 1,500 hypervisors or 100,000 instances, the database path.** The agent can read the cloud's databases rather than its APIs, which at that size cannot be read in a scrape's time. It asks for a read-only account on each service's database, a route to them from this machine, and one exporter per region and Nova cell. It reads the same series, but for whether each Nova worker is alive and how full each storage pool is, which it still reads from the API, and it cannot say whether an API answers. It has not yet been run against a real database.":
    "**하이퍼바이저 1,500개 또는 인스턴스 100,000개 이상: 데이터베이스 경로.** 에이전트는 API 대신 클라우드의 데이터베이스를 읽을 수 있습니다. 이 규모에서는 API를 스크레이프 시간 안에 읽을 수 없기 때문입니다. 각 서비스 데이터베이스의 읽기 전용 계정, 이 머신에서 그곳으로 가는 경로, 리전과 Nova 셀마다 익스포터 하나가 필요합니다. 같은 시계열을 읽지만, 각 Nova 워커가 살아 있는지와 각 스토리지 풀이 얼마나 찼는지는 여전히 API에서 읽으며, API가 응답하는지는 알 수 없습니다. 아직 실제 데이터베이스에서 실행해 본 적은 없습니다.",
  "The install script writes these to `/opt/oneuptime-openstack-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`.":
    "설치 스크립트가 이 값들을 `/opt/oneuptime-openstack-agent/.env`에 작성합니다. 값을 바꾼 뒤에는 `/opt/oneuptime-openstack-agent`에서 `docker compose up -d`로 적용하세요.",
  "| Variable | Required | Description |": "| 변수 | 필수 | 설명 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 예 | OneUptime 인스턴스의 URL(예: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key: the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 예 | 텔레메트리 수집 키: 1단계에서 선택한 키 |",
  "| `OPENSTACK_CLOUD_NAME` | Yes | The cloud's name in OneUptime, stamped on every metric as the `openstack.cloud.name` resource attribute. Keep it stable: changing it registers a new cloud |":
    "| `OPENSTACK_CLOUD_NAME` | 예 | OneUptime에서의 클라우드 이름으로, 모든 메트릭에 리소스 속성 `openstack.cloud.name`으로 붙습니다. 바꾸지 마세요. 바꾸면 새 클라우드로 등록됩니다 |",
  "| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The `clouds.yaml` entries to read, one per region and named for the region, in square brackets: `[RegionOne,RegionTwo]` |":
    "| `OPENSTACK_EXPORTER_CLOUDS` | 예 | 읽을 `clouds.yaml` 항목으로, 리전마다 하나씩 리전 이름을 붙여 대괄호로 묶습니다: `[RegionOne,RegionTwo]` |",
  "| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |":
    "| `OPENSTACK_AUTH_URL` | 번들 익스포터 | Keystone 인증 URL. `/v3`가 없으면 붙입니다 |",
  "| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port` of your own exporter, with no scheme. Leave it out for the bundled one |":
    "| `OPENSTACK_EXPORTER_ADDRESS` | 아니요 | 직접 운영하는 익스포터의 `host:port`(스킴 없음). 번들 익스포터를 쓰려면 비워 두세요 |",
  "| `OPENSTACK_QUOTA_CLOUDS` | No | The `clouds.yaml` entries to read each project's quotas from, once an hour. The install script sets it when run with `OPENSTACK_COLLECT_QUOTAS=true` |":
    "| `OPENSTACK_QUOTA_CLOUDS` | 아니요 | 각 프로젝트의 할당량을 한 시간에 한 번 읽어 올 `clouds.yaml` 항목입니다. `OPENSTACK_COLLECT_QUOTAS=true`로 실행하면 설치 스크립트가 설정합니다 |",
  "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | No | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | 아니요 | 그것을 읽는 익스포터의 `host:port`. 번들 익스포터를 쓰려면 비워 두세요 |",
  "| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml` (default: `65532:65532`) |":
    "| `OPENSTACK_EXPORTER_USER` | 아니요 | 익스포터 컨테이너를 실행하는 `uid:gid`로, `clouds.yaml`의 소유자여야 합니다(기본값: `65532:65532`) |",
  "| `OPENSTACK_CA_FILE` | No | A PEM file with the certificate authority of a cloud that has its own |":
    "| `OPENSTACK_CA_FILE` | 아니요 | 자체 인증 기관이 있는 클라우드의 인증 기관을 담은 PEM 파일 |",
  "| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter, and `openstack-ai-agent` the OneUptime AI agent |":
    "| `COMPOSE_PROFILES` | 번들 익스포터 | `openstack-exporter`는 번들 익스포터를, `openstack-ai-agent`는 OneUptime AI 에이전트를 시작합니다 |",
  "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | No | An exporter already running without `--multi-cloud`, such as Kolla-Ansible's: `[10.0.0.254:9198]`. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it |":
    "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | 아니요 | 이미 `--multi-cloud` 없이 실행 중인 익스포터(예: Kolla-Ansible의 익스포터): `[10.0.0.254:9198]`. 함께 `OPENSTACK_EXPORTER_CLOUDS=[]`를 설정하세요 |",
  "| `OPENSTACK_RABBITMQ_TARGETS` | No | RabbitMQ's Prometheus plugin on each node: `[10.0.0.11:15692,10.0.0.12:15692]` |":
    "| `OPENSTACK_RABBITMQ_TARGETS` | 아니요 | 각 노드의 RabbitMQ Prometheus 플러그인: `[10.0.0.11:15692,10.0.0.12:15692]` |",
  "| `OPENSTACK_MARIADB_TARGETS` | No | mysqld_exporter beside each MariaDB node, usually on `9104` |":
    "| `OPENSTACK_MARIADB_TARGETS` | 아니요 | 각 MariaDB 노드 옆의 mysqld_exporter, 보통 `9104` |",
  "| `OPENSTACK_MEMCACHED_TARGETS` | No | memcached_exporter beside each Memcached, usually on `9150` |":
    "| `OPENSTACK_MEMCACHED_TARGETS` | 아니요 | 각 Memcached 옆의 memcached_exporter, 보통 `9150` |",
  "| `OPENSTACK_HAPROXY_TARGETS` | No | HAProxy's own Prometheus exporter |":
    "| `OPENSTACK_HAPROXY_TARGETS` | 아니요 | HAProxy 자체 Prometheus 익스포터 |",
  "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | No | openstack-network-exporter on each node, for OVN and Open vSwitch, usually on `1981` |":
    "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | 아니요 | 각 노드의 openstack-network-exporter(OVN과 Open vSwitch용), 보통 `1981` |",
  "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | No | prometheus-libvirt-exporter on each compute node, usually on `9177`, for whether libvirt answers and nothing per instance |":
    "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | 아니요 | 각 컴퓨트 노드의 prometheus-libvirt-exporter, 보통 `9177`. libvirt가 응답하는지만 보고, 인스턴스별 정보는 없습니다 |",
  "| `OPENSTACK_CONTROL_PLANE_REGION` | No | The region of a target above that does not say its own. A target can: `RegionTwo@10.1.0.11:15692` |":
    "| `OPENSTACK_CONTROL_PLANE_REGION` | 아니요 | 위 대상 중 자기 리전을 알리지 않는 대상의 리전. 대상에서 알릴 수도 있습니다: `RegionTwo@10.1.0.11:15692` |",
  "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | No | The same exporter, for what each instance is really doing. Per-instance series multiply fast |":
    "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | 아니요 | 같은 익스포터로, 각 인스턴스가 실제로 무엇을 하는지 읽습니다. 인스턴스별 시계열은 빠르게 늘어납니다 |",
  "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | No | Ceilometer's exporter on each compute node, usually on `9101`, for the same |":
    "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | 아니요 | 각 컴퓨트 노드의 Ceilometer 익스포터, 보통 `9101`. 용도는 같습니다 |",
  "`clouds.yaml` alone holds the credential.":
    "자격 증명은 `clouds.yaml`에만 있습니다.",
  "Only the largest clouds need these, and none is asked for:":
    "가장 큰 클라우드에만 필요하며, 어느 것도 묻지 않습니다:",
  "| Variable | Description |": "| 변수 | 설명 |",
  "| `OPENSTACK_AGENT_SERVICES` | Which services this agent reads, as a pattern: `compute\\|placement` here and the rest on a second agent. Every service by default. No two agents should read one service of one region |":
    "| `OPENSTACK_AGENT_SERVICES` | 이 에이전트가 읽는 서비스를 패턴으로 지정합니다: 여기서는 `compute\\|placement`, 나머지는 두 번째 에이전트에서. 기본값은 모든 서비스입니다. 한 리전의 한 서비스를 두 에이전트가 읽어서는 안 됩니다 |",
  "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | The memory the collector may use, in MiB (default: `512`). It holds a whole scrape, so raise this past tens of thousands of instances |":
    "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | 컬렉터가 쓸 수 있는 메모리(MiB, 기본값: `512`). 스크레이프 한 번을 통째로 담으므로, 인스턴스가 수만 개를 넘으면 올리세요 |",
  "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | Reading each service's database rather than its API, with a read-only account: where that exporter answers. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it, or every series arrives twice |":
    "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | API 대신 각 서비스의 데이터베이스를 읽기 전용 계정으로 읽을 때, 그 익스포터가 응답하는 곳. 함께 `OPENSTACK_EXPORTER_CLOUDS=[]`를 설정하세요. 그렇지 않으면 모든 시계열이 두 번 도착합니다 |",
  "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | The database of each service it reads, as `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. One left empty is a service it leaves alone. Each holds a password, and `.env` is readable by its owner alone |":
    "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | 읽을 각 서비스의 데이터베이스로, `mysql+pymysql://oneuptime:secret@db.example:3306/nova` 형식입니다. 비워 둔 것은 건드리지 않는 서비스입니다. 모두 비밀번호를 담고 있으며, `.env`는 소유자만 읽을 수 있습니다 |",
  "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | What Nova adds to a host's name to make a hypervisor's, such as `.example.org`, so an instance finds the hypervisor it runs on |":
    "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | Nova가 호스트 이름에 덧붙여 하이퍼바이저 이름을 만드는 부분(예: `.example.org`)으로, 인스턴스가 자신이 실행되는 하이퍼바이저를 찾게 합니다 |",
  "| `OPENSTACK_WORKER_STATE_CLOUDS` | The `clouds.yaml` entries to read from Nova's and Cinder's APIs what their databases cannot say: whether each worker is alive, and how full each pool is |":
    "| `OPENSTACK_WORKER_STATE_CLOUDS` | 데이터베이스로는 알 수 없는 것(각 워커가 살아 있는지, 각 풀이 얼마나 찼는지)을 Nova와 Cinder의 API에서 읽을 `clouds.yaml` 항목 |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | 그것을 읽는 익스포터의 `host:port`. 번들 익스포터를 쓰려면 비워 두세요 |",
  "| `OPENSTACK_QUOTA_CLOUDS` | The `clouds.yaml` entries to read each project's quotas from, once an hour. Empty reads none, and `OPENSTACK_COLLECT_QUOTAS=true` in the install script fills it in |":
    "| `OPENSTACK_QUOTA_CLOUDS` | 각 프로젝트의 할당량을 한 시간에 한 번 읽어 올 `clouds.yaml` 항목입니다. 비어 있으면 아무것도 읽지 않으며, 설치 스크립트의 `OPENSTACK_COLLECT_QUOTAS=true`가 값을 채웁니다 |",
  "The OneUptime AI agent reads the credential in `clouds.yaml` unless these say otherwise, and none is asked for:":
    "이 변수들로 달리 지정하지 않으면 OneUptime AI 에이전트는 `clouds.yaml`의 자격 증명을 읽으며, 어느 것도 묻지 않습니다:",
  "| `ONEUPTIME_AI_INVESTIGATION` | `false` stops OneUptime AI investigating this cloud with the agent |":
    "| `ONEUPTIME_AI_INVESTIGATION` | `false`로 하면 OneUptime AI가 에이전트로 이 클라우드를 조사하지 않습니다 |",
  "| `OPENSTACK_AI_CLOUDS_FILE` | The `clouds.yaml` it mounts. `/dev/null` when it has a credential of its own and there is no such file beside it |":
    "| `OPENSTACK_AI_CLOUDS_FILE` | 마운트할 `clouds.yaml`. 전용 자격 증명이 있고 옆에 그런 파일이 없으면 `/dev/null` |",
  "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | The entry of `clouds.yaml` to use, when it is not the first of `OPENSTACK_EXPORTER_CLOUDS` |":
    "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | 사용할 `clouds.yaml` 항목(`OPENSTACK_EXPORTER_CLOUDS`의 첫 항목이 아닐 때) |",
  "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | A credential of its own, used instead of `clouds.yaml`'s. Set both, with `OPENSTACK_AUTH_URL` |":
    "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | `clouds.yaml`의 자격 증명 대신 쓸 전용 자격 증명. `OPENSTACK_AUTH_URL`과 함께 둘 다 설정하세요 |",
  "| `OPENSTACK_AUTH_URL` | The Keystone a credential of its own logs in to |":
    "| `OPENSTACK_AUTH_URL` | 전용 자격 증명이 로그인하는 Keystone |",
  "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | The region a command reads when it names none, which endpoints it uses (`public`, `internal` or `admin`), and a certificate authority. `clouds.yaml` says these unless they do |":
    "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | 명령이 리전을 지정하지 않을 때 읽을 리전, 사용할 엔드포인트(`public`, `internal`, `admin`), 그리고 인증 기관. 이 변수들이 지정하지 않으면 `clouds.yaml`의 값을 씁니다 |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | The name it registers under, when it is not `OPENSTACK_CLOUD_NAME` |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | 등록할 때의 이름(`OPENSTACK_CLOUD_NAME`이 아닐 때) |",
  "| `LOG_LEVEL` | How much it logs |":
    "| `LOG_LEVEL` | 로그를 얼마나 자세히 남길지 |",
  "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | Off until set: let it make changes, through a credential of their own. The OpenStack guide says how to make it with the least it needs |":
    "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | 설정하기 전까지는 꺼짐: 전용 자격 증명을 통해 변경을 허용합니다. 꼭 필요한 권한만으로 만드는 방법은 OpenStack 가이드에 있습니다 |",
  "| `ONEUPTIME_AI_FIXES` | How AI may apply a fix: off, ask-for-approval, automatic or bypass-approval. Empty: fixes stay off until someone chooses on this page |":
    "| `ONEUPTIME_AI_FIXES` | AI가 수정을 적용하는 방식: off, ask-for-approval, automatic, bypass-approval. 비어 있으면: 누군가 이 페이지에서 고를 때까지 수정은 꺼져 있습니다 |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | What is never touched, whatever else is set and whoever approves it: `project:ID`, `host:NAME` or `instance:ID`, separated by commas |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | 다른 무엇을 설정하든, 누가 승인하든 절대 건드리지 않는 것: `project:ID`, `host:NAME`, `instance:ID`를 쉼표로 구분 |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | Where changes may land, written the same way. Empty: anywhere that is not protected |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | 변경이 적용될 수 있는 곳(같은 형식). 비어 있으면: 보호되지 않은 모든 곳 |",
  "Set `OPENSTACK_EXPORTER_ADDRESS` as you run the install script, such as `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. The bundled exporter then never starts, and no Keystone URL or credential is asked for.":
    "설치 스크립트를 실행할 때 `OPENSTACK_EXPORTER_ADDRESS`를 설정하세요(예: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`). 그러면 번들 익스포터는 시작되지 않고, Keystone URL이나 자격 증명도 묻지 않습니다.",
  "Your exporter must run with `--multi-cloud`, and its `clouds.yaml` needs an entry named for each region. Turn off what the bundled one turns off: see **What the agent collects, and what it costs your cloud**. Use an address the agent's container can reach: `localhost` inside the container is the container itself.":
    "직접 운영하는 익스포터는 `--multi-cloud`로 실행해야 하며, 그 `clouds.yaml`에는 리전마다 그 이름의 항목이 필요합니다. 번들 익스포터가 끄는 것은 끄세요: **에이전트가 수집하는 항목과 클라우드에 주는 부담** 을 참고하세요. 에이전트 컨테이너가 연결할 수 있는 주소를 쓰세요: 컨테이너 안의 `localhost`는 그 컨테이너 자신입니다.",
  "**Started without `--multi-cloud`?** Kolla-Ansible's is, and Canonical's charm. It has no `/probe`, so set `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` instead of the address above, with `OPENSTACK_EXPORTER_CLOUDS=[]` and `OPENSTACK_CONTROL_PLANE_REGION`. It is then asked for everything at once, every 2 minutes.":
    "**`--multi-cloud` 없이 시작했나요?** Kolla-Ansible의 익스포터와 Canonical의 charm이 그렇습니다. `/probe`가 없으므로 위의 주소 대신 `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`를 설정하고, `OPENSTACK_EXPORTER_CLOUDS=[]`와 `OPENSTACK_CONTROL_PLANE_REGION`도 함께 설정하세요. 그러면 2분마다 모든 것을 한 번에 요청받습니다.",
  "**On exporter 1.7.0,** which Kolla-Ansible pins, it answers either way, and the pages go without what it does not say. On five real clouds that was:":
    "**익스포터 1.7.0에서는,** (Kolla-Ansible이 고정하는 버전) 어느 방식으로든 응답하지만, 익스포터가 알려 주지 않는 것은 페이지에서 빠집니다. 실제 클라우드 다섯 곳에서는 다음과 같았습니다:",
  "Give the install script the file when it asks for a private CA file. It copies it to `ca.pem`, and names it in `clouds.yaml`.":
    "설치 스크립트가 사설 CA 파일을 물으면 그 파일을 넘기세요. 스크립트가 파일을 `ca.pem`으로 복사하고 `clouds.yaml`에 지정합니다.",
  "On Linux (x86_64 or arm64) with systemd 235 or later and glibc 2.34 or later (not RHEL 8), the install script can run the same collector and exporter releases as systemd services instead:":
    "systemd 235 이상과 glibc 2.34 이상의 Linux(x86_64 또는 arm64, RHEL 8 제외)에서는 설치 스크립트가 같은 릴리스의 컬렉터와 익스포터를 대신 systemd 서비스로 실행할 수 있습니다:",
  "Moving off a Docker install? Run `docker compose down` first, or every metric arrives twice. Running the script again stays whichever it was, so `sudo bash install.sh` is the upgrade.":
    "Docker 설치에서 옮기나요? 먼저 `docker compose down`을 실행하세요. 그렇지 않으면 모든 메트릭이 두 번 도착합니다. 스크립트를 다시 실행해도 방식은 그대로 유지되므로, `sudo bash install.sh`가 곧 업그레이드입니다.",
  "The `resource` processor in `otel-collector-config.yaml` stamps every metric with the cloud's name. OneUptime registers the cloud from that attribute, and every page and monitor scopes on it. The two deletes keep OneUptime from registering a Service named after the scrape job, so keep them if you customize the file:":
    "`otel-collector-config.yaml`의 `resource` 프로세서는 모든 메트릭에 클라우드 이름을 붙입니다. OneUptime은 그 속성으로 클라우드를 등록하고, 모든 페이지와 모니터가 그것으로 범위를 정합니다. 두 개의 삭제는 스크레이프 작업 이름으로 된 서비스가 OneUptime에 등록되지 않게 하므로, 파일을 사용자 지정하더라도 유지하세요:",
  "The whole file is on this OneUptime:":
    "전체 파일은 이 OneUptime에 있습니다:",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cloud: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `openstack.cloud.name`:":
    "`oneuptime.label.`로 시작하는 리소스 속성은 클라우드의 프로젝트 레이블이 됩니다: `oneuptime.label.<dimension>=<value>`는 레이블 `<dimension>:<value>`입니다. `otel-collector-config.yaml`의 `resource` 프로세서에서 `openstack.cloud.name` 옆에 추가하세요:",
  "Then restart the collector so it reads the new config:":
    "그런 다음 컬렉터가 새 구성을 읽도록 다시 시작합니다:",
  "The cloud shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "클라우드에는 `team:platform`과 `env:production` 태그가 붙어 표시됩니다. 레이블은 대소문자를 구분하지 않고 비교하므로 기존 `Production` 레이블이 재사용되며, OneUptime UI에서 추가한 레이블은 에이전트가 절대 제거하지 않습니다.",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` and `clouds.yaml` (nothing is asked again), downloads the latest files (a file you edited is kept next to the new one as `<file>.bak.<timestamp>`), pulls the images and recreates the agent with them:":
    "**업그레이드.** 이미지는 `docker-compose.yml`에 고정되어 있고 그 구성은 옆의 파일이므로, pull만으로는 에이전트가 새 버전이 되지 않습니다. 설치 스크립트를 다시 실행하세요. 기존 `.env`와 `clouds.yaml`의 모든 값을 재사용하고(다시 묻지 않습니다), 최신 파일을 내려받고(직접 수정한 파일은 새 파일 옆에 `<file>.bak.<timestamp>`로 남습니다), 이미지를 pull한 뒤 그 이미지로 에이전트를 다시 만듭니다:",
  "The config reports the collector version it pins as the cloud's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "구성은 고정한 컬렉터 버전을 클라우드의 **에이전트 버전** 으로 보고합니다. 이 OneUptime이 더 새 버전을 고정하면, 그 옆의 경고 표시가 이 명령을 엽니다.",
  "**Uninstall** the agent:": "에이전트 **제거**:",
  "Then delete `/opt/oneuptime-openstack-agent`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "그런 다음 자격 증명이 들어 있는 `/opt/oneuptime-openstack-agent`와 애플리케이션 자격 증명 자체를 삭제하세요: `openstack application credential delete oneuptime-agent`.",
  "`troubleshoot.sh` checks the whole chain, from DNS and TLS to Keystone, each service in the catalog and your ingestion key, and says what this credential can read and what each gap costs.":
    "`troubleshoot.sh`는 DNS와 TLS부터 Keystone, 카탈로그의 각 서비스, 수집 키까지 전체 경로를 확인하고, 이 자격 증명이 읽을 수 있는 것과 각 공백의 영향을 알려 줍니다.",
  "It needs `sudo` to read `clouds.yaml`, or it skips the credential checks. It ends with a verdict naming the most likely cause.":
    "`clouds.yaml`을 읽으려면 `sudo`가 필요하며, 없으면 자격 증명 검사를 건너뜁니다. 마지막에 가장 가능성 높은 원인을 꼽은 결론을 냅니다.",
  "1. Check that the agent is running (in `/opt/oneuptime-openstack-agent`): `docker compose ps`":
    "1. 에이전트가 실행 중인지 확인하세요(`/opt/oneuptime-openstack-agent`에서): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-openstack-agent | grep -i error`":
    "2. 에이전트 로그에서 오류를 확인하세요: `docker compose logs oneuptime-openstack-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. OneUptime URL과 수집 키가 올바른지 확인하세요.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 에이전트 머신이 네트워크를 통해 OneUptime 인스턴스에 연결할 수 있는지 확인하세요.",
  "A **Project view** credential can't read them, and neither can a role without the policy overrides: Nova, Neutron and Placement keep them for admins by default. Use **Full view**, or **Infrastructure only** with the files in `access/policy` merged into the file each service's `[oslo_policy] policy_file` names. `troubleshoot.sh` says which reads were refused.":
    "**프로젝트 보기** 자격 증명으로는 읽을 수 없고, 정책 재정의가 없는 역할로도 읽을 수 없습니다: Nova, Neutron, Placement는 기본적으로 이를 관리자에게만 허용합니다. **전체 보기** 를 쓰거나, `access/policy`의 파일을 각 서비스의 `[oslo_policy] policy_file`이 가리키는 파일에 병합한 뒤 **인프라 전용** 을 쓰세요. 어떤 읽기가 거부되었는지는 `troubleshoot.sh`가 알려 줍니다.",
  "Only **Full view** sees `cinder-volume` and `cinder-scheduler` state and storage pools. Cinder's own code answers anything else with `403 User does not have admin privileges`, after policy has already passed, so no override opens them.":
    "`cinder-volume`과 `cinder-scheduler`의 상태와 스토리지 풀을 보는 것은 **전체 보기** 뿐입니다. 정책을 통과한 뒤에 Cinder 자체 코드가 그 밖의 모든 것에 `403 User does not have admin privileges`로 응답하므로, 어떤 재정의로도 열 수 없습니다.",
  "Neutron and Cinder answer anything but an admin with `200` and only its own project, which looks like it worked. Seeing every project takes **Full view**. With **Infrastructure only**, they appear for the projects the role is assigned on, and a role on a real project can also write there on many clouds.":
    "Neutron과 Cinder는 관리자가 아닌 모든 것에 `200`과 자기 프로젝트만 응답하므로, 성공한 것처럼 보입니다. 모든 프로젝트를 보려면 **전체 보기** 가 필요합니다. **인프라 전용** 에서는 역할이 할당된 프로젝트에 대해 표시되며, 실제 프로젝트에 준 역할은 많은 클라우드에서 그곳에 쓰기도 할 수 있습니다.",
  "A **Project view** credential shows no instances through the agent: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. **Full view** and **Infrastructure only** both see every project's instances.":
    "**프로젝트 보기** 자격 증명은 에이전트를 통해 인스턴스를 하나도 보여 주지 않습니다: 익스포터가 Nova에 모든 프로젝트의 서버를 요청하는데, Nova가 일반 읽기 사용자를 거부하므로 그 읽기 전체가 실패합니다. **전체 보기** 와 **인프라 전용** 은 둘 다 모든 프로젝트의 인스턴스를 봅니다.",
  "That is expected with **Infrastructure only**, and harmless. Neutron tries to create a project's default security group when it lists them, and a project with zero quota cannot hold one. There is nothing to fix.":
    "**인프라 전용** 에서는 예상된 일이며 무해합니다. Neutron은 보안 그룹을 나열할 때 프로젝트의 기본 보안 그룹을 만들려고 하는데, 할당량이 0인 프로젝트에는 만들 수 없습니다. 고칠 것은 없습니다.",
  "On Flamingo and Epoxy, oslo.policy raises on every check once a policy file it has read is gone, and when the service is Keystone the whole cloud answers `503`. Restart the service. To take the overrides off, empty the file (`{}`) and never delete it.":
    "Flamingo와 Epoxy에서는 읽어 둔 정책 파일이 사라지면 oslo.policy가 모든 검사에서 오류를 내며, 그 서비스가 Keystone이면 클라우드 전체가 `503`으로 응답합니다. 서비스를 다시 시작하세요. 재정의를 없애려면 파일을 비우고(`{}`) 절대 삭제하지 마세요.",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "에이전트는 각 서비스를 따로 읽으므로, 실패한 서비스로 잃는 것은 그 서비스의 수치뿐입니다. 익스포터가 그 서비스를 읽지 못하는 이유를 확인하세요(`/opt/oneuptime-openstack-agent`에서): `docker compose logs oneuptime-openstack-exporter`. **서비스** 페이지에는 그 API가 `down`으로 표시됩니다. 오래된 규칙 사본으로 만든 액세스 규칙 자격 증명도 Swift와, 경로 뒤에 있는 Octavia에서 같은 문제를 일으킵니다: **전체 보기** 에서 설명한 대로 새로 만드세요.",
  "The services are refusing a credential limited by access rules. A service behind a path prefix refuses the shipped rules: fit them to this cloud with `access-rules-for-cloud.py`, as **Full view** does. And each service needs `service_type` set for keystonemiddleware, and a restart:":
    "서비스가 액세스 규칙으로 제한된 자격 증명을 거부하고 있습니다. 경로 접두사 뒤에 있는 서비스는 제공된 규칙을 거부합니다: **전체 보기** 에서 설명한 대로 `access-rules-for-cloud.py`로 규칙을 이 클라우드에 맞추세요. 또한 각 서비스에는 keystonemiddleware용 `service_type` 설정과 재시작이 필요합니다:",
  "If you won't change that, create the credential without `--access-rules`, knowing it can write.":
    "이것을 바꾸지 않으려면, 쓰기도 할 수 있다는 점을 알고 `--access-rules` 없이 자격 증명을 만드세요.",
  "The exporter runs as uid 65532, and `clouds.yaml` is readable by its owner alone. Give the file to that user, or set `OPENSTACK_EXPORTER_USER` in `.env` to the file owner's `uid:gid`, and apply it with `docker compose up -d`.":
    "익스포터는 uid 65532로 실행되고, `clouds.yaml`은 소유자만 읽을 수 있습니다. 파일을 그 사용자에게 넘기거나, `.env`에서 `OPENSTACK_EXPORTER_USER`를 파일 소유자의 `uid:gid`로 설정한 뒤 `docker compose up -d`로 적용하세요.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "클라우드의 정체성은 `OPENSTACK_CLOUD_NAME`에서 오며, 모든 메트릭에 `openstack.cloud.name`으로 붙습니다. `.env`에서 고친 뒤 `/opt/oneuptime-openstack-agent`에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클라우드로 등록됩니다.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "클라우드의 정체성은 `OPENSTACK_CLOUD_NAME`에서 오며, 모든 메트릭에 `openstack.cloud.name`으로 붙습니다. 이 클라우드는 **`cloud-1`** 입니다. `.env`에서 고친 뒤 `/opt/oneuptime-openstack-agent`에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클라우드로 등록됩니다.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent":
    "에이전트를 실행할 머신의 Docker Engine 20.10 이상과 Docker Compose v2 플러그인",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "이 OneUptime에서 `docker-compose.yml`과 `otel-collector-config.yaml`을 새 폴더로 내려받습니다:",
  "Create a `clouds.yaml` file next to them, with the credential from the previous step. It needs one entry per region, each named for its region, because the exporter's series do not say which region they are from:":
    "그 옆에 이전 단계의 자격 증명으로 `clouds.yaml` 파일을 만드세요. 익스포터의 시계열에는 어느 리전에서 왔는지가 없으므로, 리전마다 그 리전 이름을 붙인 항목이 하나씩 필요합니다:",
  "Create a `.env` file next to them too:": "그 옆에 `.env` 파일도 만드세요:",
  "- Replace `my-openstack-cloud` with a name for this cloud, such as `prod-eu`. It is how the cloud appears in OneUptime, so keep it stable: a new name registers a new cloud.":
    "- `my-openstack-cloud`를 이 클라우드의 이름(예: `prod-eu`)으로 바꾸세요. 이것이 OneUptime에서 클라우드가 표시되는 이름이므로 바꾸지 마세요. 새 이름은 새 클라우드로 등록됩니다.",
  "- List every region in `OPENSTACK_EXPORTER_CLOUDS`, in square brackets, such as `[RegionOne,RegionTwo]`.":
    "- `OPENSTACK_EXPORTER_CLOUDS`에 모든 리전을 대괄호로 묶어 나열하세요(예: `[RegionOne,RegionTwo]`).",
  "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` starts the bundled exporter, which reads the cloud with `clouds.yaml`, and the OneUptime AI agent, which reads it with the same file while OneUptime AI investigates.":
    "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent`는 `clouds.yaml`로 클라우드를 읽는 번들 익스포터와, OneUptime AI가 조사하는 동안 같은 파일로 클라우드를 읽는 OneUptime AI 에이전트를 시작합니다.",
  "Both files hold secrets, so keep them to their owner. The exporter runs as uid 65532, and must be the one account that can read `clouds.yaml`. Then start the agent:":
    "두 파일 모두 비밀 정보를 담고 있으므로 소유자만 읽게 하세요. 익스포터는 uid 65532로 실행되며, `clouds.yaml`을 읽을 수 있는 계정은 그것 하나여야 합니다. 그런 다음 에이전트를 시작하세요:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Add one `clouds.yaml` entry per region, and list them all in `OPENSTACK_EXPORTER_CLOUDS`. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "클라우드는 리전이 몇 개든 하나의 Keystone이며, 에이전트 하나가 모든 리전을 읽습니다. 리전마다 `clouds.yaml` 항목을 하나씩 추가하고, 모두 `OPENSTACK_EXPORTER_CLOUDS`에 나열하세요. 각 항목에는 리전 이름을 붙여야 합니다: 시계열에는 어느 리전에서 왔는지가 없으므로, 컬렉터가 그 이름을 `openstack.region.name`으로 익스포터의 시계열에 붙입니다. 그러면 OneUptime의 모든 목록을 리전으로 필터링할 수 있습니다.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "에이전트는 `docker-compose.yml` 옆의 `.env` 파일에서 이 값들을 읽습니다. 값을 바꾼 뒤에는 `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter, as `host:port` with no scheme: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. The bundled exporter then never starts.":
    "`.env`에서 `COMPOSE_PROFILES`를 빼고, 에이전트가 직접 운영하는 익스포터를 가리키게 하세요. 스킴 없는 `host:port`로 지정합니다: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. 그러면 번들 익스포터는 시작되지 않습니다.",
  "Put the file next to `docker-compose.yml` as `ca.pem`, set `OPENSTACK_CA_FILE=./ca.pem` in `.env`, and add `cacert: /etc/openstack/ca.pem` to each entry of `clouds.yaml`.":
    "파일을 `ca.pem`으로 `docker-compose.yml` 옆에 두고, `.env`에 `OPENSTACK_CA_FILE=./ca.pem`을 설정하고, `clouds.yaml`의 각 항목에 `cacert: /etc/openstack/ca.pem`을 추가하세요.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "에이전트 폴더, 즉 `docker-compose.yml`이 있는 폴더에서 다음을 실행하세요.",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `clouds.yaml` stay, and a change you made to either file has to be made again:":
    "**업그레이드.** 이미지는 `docker-compose.yml`에 고정되어 있고 그 구성은 옆의 파일이므로, pull만으로는 에이전트가 새 버전이 되지 않습니다. 두 파일을 다시 내려받으세요. `.env`와 `clouds.yaml`은 그대로 남지만, 내려받은 두 파일 중 어느 쪽에든 직접 한 변경은 다시 해야 합니다:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "그런 다음 이미지를 가져와 에이전트를 다시 만들어, 컬렉터가 새 구성을 읽게 합니다:",
  "Then delete the folder with `docker-compose.yml`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "그런 다음 자격 증명이 들어 있는 `docker-compose.yml` 폴더와 애플리케이션 자격 증명 자체를 삭제하세요: `openstack application credential delete oneuptime-agent`.",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. 에이전트가 실행 중인지 확인하세요(에이전트 폴더에서): `docker compose ps`",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in the agent's folder): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "에이전트는 각 서비스를 따로 읽으므로, 실패한 서비스로 잃는 것은 그 서비스의 수치뿐입니다. 익스포터가 그 서비스를 읽지 못하는 이유를 확인하세요(에이전트 폴더에서): `docker compose logs oneuptime-openstack-exporter`. **서비스** 페이지에는 그 API가 `down`으로 표시됩니다. 오래된 규칙 사본으로 만든 액세스 규칙 자격 증명도 Swift와, 경로 뒤에 있는 Octavia에서 같은 문제를 일으킵니다: **전체 보기** 에서 설명한 대로 새로 만드세요.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "클라우드의 정체성은 `OPENSTACK_CLOUD_NAME`에서 오며, 모든 메트릭에 `openstack.cloud.name`으로 붙습니다. `.env`에서 고친 뒤 `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클라우드로 등록됩니다.",
  "- This installs the agent for **`cloud-1`**. Keep `OPENSTACK_CLOUD_NAME` exactly as it is, or the data registers as a new cloud.":
    "- 이것은 **`cloud-1`** 클라우드용으로 에이전트를 설치합니다. `OPENSTACK_CLOUD_NAME`을 그대로 두세요. 그렇지 않으면 데이터가 새 클라우드로 등록됩니다.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "클라우드의 정체성은 `OPENSTACK_CLOUD_NAME`에서 오며, 모든 메트릭에 `openstack.cloud.name`으로 붙습니다. 이 클라우드는 **`cloud-1`** 입니다. `.env`에서 고친 뒤 `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클라우드로 등록됩니다.",
  "OpenStack-Ansible keeps its services' logs in journald and runs no Prometheus of its own, so the agent is the way in, and the logs have a path of their own.":
    "OpenStack-Ansible은 서비스 로그를 journald에 두고 자체 Prometheus를 실행하지 않으므로, 에이전트가 들어가는 길이 되고 로그에는 별도의 경로가 있습니다.",
  "**How far this guide has been tested:** Its paths and variables were read from OpenStack-Ansible's own source and docs. Its commands were then run on a real all-in-one at stable/2026.1, in LXC containers, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, the agent's exporter on the Infrastructure only credential with its policy overrides, the RabbitMQ and HAProxy settings with the agent reading each, and the logs profile on the journal. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**이 가이드의 테스트 범위:** 경로와 변수는 OpenStack-Ansible 자체 소스와 문서에서 읽었습니다. 그런 다음 명령을 LXC 컨테이너로 구성한 stable/2026.1의 실제 all-in-one에서, 에이전트가 보낸 내용을 보관하는 OneUptime 대역을 상대로 실행했습니다. 대상은 전체 보기 자격 증명을 쓴 에이전트, 인프라 전용 자격 증명과 그 정책 재정의를 쓴 에이전트의 익스포터, 에이전트가 각각 읽은 RabbitMQ와 HAProxy 설정, 그리고 journal의 로그 프로필입니다. 에이전트와 프로브는 각각 실제 DevStack을 nova-compute 중지와 복구를 거쳐 실행 중인 OneUptime까지 끝까지 연결했지만, 이 도구에서 한 것은 아닙니다.",
  "- Log in as an admin from the utility container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, then `. ~/openrc`. It has no `curl`, which the commands below use, so run `apt-get install -y curl` there first.":
    "- utility 컨테이너에서 관리자로 로그인하세요: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, 그다음 `. ~/openrc`. 이 컨테이너에는 아래 명령이 쓰는 `curl`이 없으므로, 먼저 그곳에서 `apt-get install -y curl`을 실행하세요.",
  "- **Full view** needs one change, to Cinder. OpenStack-Ansible's roles already set `service_type` under `[keystone_authtoken]`, but its Cinder says `volumev3` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Set `service_type: block-storage` under `keystone_authtoken` in `cinder_cinder_conf_overrides` in `/etc/openstack_deploy/user_variables.yml`, then run `openstack-ansible openstack.osa.cinder --tags cinder-config`.":
    "- **전체 보기** 에는 Cinder에 대한 변경이 하나 필요합니다. OpenStack-Ansible의 역할은 이미 `[keystone_authtoken]` 아래에 `service_type`을 설정하지만, 그 Cinder는 `volumev3`, 카탈로그는 `block-storage`라고 하며, 둘이 일치하지 않으면 keystonemiddleware는 액세스 규칙으로 제한된 자격 증명을 `401`로 거부합니다. `/etc/openstack_deploy/user_variables.yml`의 `cinder_cinder_conf_overrides`에서 `keystone_authtoken` 아래에 `service_type: block-storage`를 설정한 뒤 `openstack-ansible openstack.osa.cinder --tags cinder-config`를 실행하세요.",
  "- **Infrastructure only** takes its overrides as `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` and `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Apply each with its own playbook and tag, such as `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Taking one out later leaves an empty file behind rather than none, so nothing fails.":
    "- **인프라 전용** 은 재정의를 `/etc/openstack_deploy/user_variables.yml`의 `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides`, `placement_policy_overrides`로 받습니다. 각각 고유한 플레이북과 태그로 적용하세요(예: `openstack-ansible openstack.osa.nova --tags nova-policy-override`). 나중에 하나를 빼도 파일이 사라지는 대신 빈 파일이 남으므로 아무것도 실패하지 않습니다.",
  "- **RabbitMQ:** turn on its Prometheus plugin, then name each container's address on `15692` as `OPENSTACK_RABBITMQ_TARGETS` in the agent's `.env`:":
    "- **RabbitMQ:** Prometheus 플러그인을 켠 다음, 각 컨테이너의 `15692` 주소를 에이전트 `.env`의 `OPENSTACK_RABBITMQ_TARGETS`로 지정하세요:",
  "- **HAProxy:** its exporter is off, and its stats listener is on `127.0.0.1` with TLS, which the agent cannot read. Turn it on where the agent can, then name that address on `1936` as `OPENSTACK_HAPROXY_TARGETS`:":
    "- **HAProxy:** 익스포터는 꺼져 있고, 통계 리스너는 TLS가 적용된 `127.0.0.1`에 있어 에이전트가 읽을 수 없습니다. 에이전트가 읽을 수 있는 곳에서 켠 다음, 그 `1936` 주소를 `OPENSTACK_HAPROXY_TARGETS`로 지정하세요:",
  "- **MariaDB and Memcached:** OpenStack-Ansible ships no exporter for either. Run [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) and [memcached_exporter](https://github.com/prometheus/memcached_exporter) yourself and name them as `OPENSTACK_MARIADB_TARGETS` and `OPENSTACK_MEMCACHED_TARGETS`, or leave them out: the cloud's **Control Plane** card then says they are not watched, rather than that they are fine.":
    "- **MariaDB와 Memcached:** OpenStack-Ansible은 둘 다 익스포터를 제공하지 않습니다. [mysqld_exporter](https://github.com/prometheus/mysqld_exporter)와 [memcached_exporter](https://github.com/prometheus/memcached_exporter)를 직접 실행해 `OPENSTACK_MARIADB_TARGETS`와 `OPENSTACK_MEMCACHED_TARGETS`로 지정하거나, 생략하세요: 생략하면 클라우드의 **컨트롤 플레인** 카드에 정상이 아니라 감시되지 않음으로 표시됩니다.",
  "This runs the agent's logs profile as a systemd service, and reads `/var/log/journal/`, where OpenStack-Ansible's containers' journals arrive.":
    "이것은 에이전트의 로그 프로필을 systemd 서비스로 실행하며, OpenStack-Ansible 컨테이너의 journal이 도착하는 `/var/log/journal/`을 읽습니다.",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from the journal.":
    "둘 다 서비스 자체 로그에 기록하며, 버스에는 소비자가 없습니다. **보안 이벤트 → 연결** 에서 **로그에서 보안 이벤트 찾기** 를 켜면 OneUptime이 그곳에서 이를 읽습니다. 에이전트의 로그 프로필은 둘 다 journal에서 읽습니다.",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw. A second value of `notification_opt_out` goes in as a YAML set, as [its config_template](https://docs.openstack.org/ansible-config_template/latest/) writes a repeated key.":
    "이렇게 하면 로그인마다 한 줄이 전송되고, 이를 **OpenStack admin credential used from a new address** 가 읽습니다. 실패한 로그인만 보내려면 `notification_opt_out`에 `identity.authenticate.success`를 추가하세요. 그러면 이 탐지는 감사 필터가 본 내용을 읽습니다. `notification_opt_out`의 두 번째 값은 [그 config_template](https://docs.openstack.org/ansible-config_template/latest/)이 반복되는 키를 쓰는 방식대로 YAML 집합으로 넣습니다.",
  "For who did what through Nova, Neutron, Cinder and Glance, each API takes the filter's setting in its conf overrides, and the filter in its paste overrides, with `audit` right after `authtoken` and the context filter that follows it in each pipeline. Nova's, and the same in `neutron_neutron_conf_overrides` and `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` and `cinder_api_paste_ini_overrides`, and `glance_glance_api_conf_overrides` and `glance_glance_api_paste_ini_overrides`:":
    "Nova, Neutron, Cinder, Glance를 통해 누가 무엇을 했는지 알려면, 각 API의 conf 재정의에 필터 설정을, paste 재정의에 필터를 넣으며, 각 파이프라인에서 `audit`를 `authtoken`과 그 뒤를 잇는 컨텍스트 필터 바로 다음에 둡니다. 이것은 Nova의 예이며, `neutron_neutron_conf_overrides`와 `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides`와 `cinder_api_paste_ini_overrides`, `glance_glance_api_conf_overrides`와 `glance_glance_api_paste_ini_overrides`도 같습니다:",
  "OpenStack-Helm offers charts for Prometheus, Alertmanager and exporters, and whether they are running is up to you. Its control plane runs in Kubernetes, so a probe reads the APIs and the Kubernetes agent sees the pods.":
    "OpenStack-Helm은 Prometheus, Alertmanager, 익스포터용 차트를 제공하며, 이를 실행할지는 사용자에게 달려 있습니다. 컨트롤 플레인이 Kubernetes에서 실행되므로, 프로브가 API를 읽고 Kubernetes 에이전트가 파드를 봅니다.",
  "**How far this guide has been tested:** Its chart values were read from OpenStack-Helm's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**이 가이드의 테스트 범위:** 차트 값은 OpenStack-Helm 자체 소스에서 읽었습니다. 이 도구의 실제 배포에서 처음부터 끝까지 따라 해 본 적은 없습니다. 에이전트와 프로브는 각각 실제 DevStack을 nova-compute 중지와 복구를 거쳐 실행 중인 OneUptime까지 끝까지 연결했지만, 이 도구에서 한 것은 아닙니다. 프로브와 Kubernetes 에이전트는 각각 따로 테스트했으며, 이 도구에서 함께 테스트하지는 않았습니다.",
  "Then add the receiver under `conf.alertmanager` in the chart's values, and send your route to it:":
    "그런 다음 차트 값의 `conf.alertmanager` 아래에 리시버를 추가하고, 라우트를 그쪽으로 보내세요:",
  "Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. [OpenStack Without an Agent](/docs/telemetry/openstack-agentless) says what each level of access reads, and the connection test says what yours can. The agent also works from any machine with a route to the APIs: choose **Not sure, or something else** above for its steps.":
    "**OpenStack → 모든 클라우드** 를 열고 **클라우드 연결** 을 클릭한 뒤, Keystone 주소, 애플리케이션 자격 증명, 사용할 프로브를 지정하세요. 프로브는 클라우드와 HTTPS로만 통신합니다. 각 액세스 수준이 읽는 것은 [에이전트 없는 OpenStack](/docs/telemetry/openstack-agentless)에, 사용자의 수준이 읽을 수 있는 것은 연결 테스트에 나옵니다. 에이전트는 API로 가는 경로가 있는 어느 머신에서든 동작합니다: 그 단계를 보려면 위에서 **확실하지 않거나 다른 경우** 를 선택하세요.",
  "Follow **Kubernetes → Documentation** for this cluster. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "이 클러스터에 대해 **Kubernetes → 문서** 를 따르세요. 그러면 파드, 그 로그, 노드가 Kubernetes 페이지에 도착하고, 그중 OpenStack 서비스도 그곳에서 감시됩니다.",
  "To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:":
    "그 서비스들의 로그를 스택 트레이스마다 레코드 하나로 이 클라우드의 **로그** 페이지에도 표시하려면, 서비스가 실행되는 네임스페이스와 함께 에이전트 값에 클라우드를 지정하세요:",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.":
    "둘 다 서비스 자체 로그에 기록하며, 버스에는 소비자가 없습니다. **보안 이벤트 → 연결** 에서 **로그에서 보안 이벤트 찾기** 를 켜면 OneUptime이 그곳에서 이를 읽습니다. Kubernetes 에이전트는 값에 지정된 클라우드로서 둘 다 파드 로그에서 읽습니다.",
  "A chart's `logging.conf` keeps the root logger at `WARNING`, and the log driver writes under a logger of its own, so without one for it nothing is written. A list in values replaces the chart's, so `keys` holds what the chart's has, plus this:":
    "차트의 `logging.conf`는 루트 로거를 `WARNING`으로 유지하고, 로그 드라이버는 자체 로거로 기록하므로, 그 로거가 없으면 아무것도 기록되지 않습니다. 값에 쓴 목록은 차트의 목록을 대체하므로, `keys`에는 차트 목록의 내용에 더해 다음을 넣습니다:",
  "For who did what through Nova, Neutron and Cinder, their charts' `conf.paste` already has the audit filter in each pipeline, and it needs telling where to write. Each needs the same logger, in `conf.logging`. Glance's chart has the map, and neither the filter nor a place for it in its pipelines: add both to its `conf.paste`.":
    "Nova, Neutron, Cinder를 통해 누가 무엇을 했는지 알려면, 그 차트의 `conf.paste`에는 이미 각 파이프라인에 감사 필터가 있으므로 기록할 곳만 알려 주면 됩니다. 모두 `conf.logging`에 같은 로거가 필요합니다. Glance의 차트에는 맵은 있지만 필터도, 파이프라인 안의 그 자리도 없습니다: 둘 다 그 `conf.paste`에 추가하세요.",
  "Atmosphere runs kube-prometheus-stack with its own alert rules, and Loki with Vector for logs. Forward its alerts first, then a probe reads the APIs and the Kubernetes agent sees the pods.":
    "Atmosphere는 자체 알림 규칙이 있는 kube-prometheus-stack과, 로그용으로 Vector를 쓰는 Loki를 실행합니다. 먼저 그 알림을 전달한 뒤, 프로브가 API를 읽고 Kubernetes 에이전트가 파드를 봅니다.",
  "**How far this guide has been tested:** Its configuration was read from Atmosphere's own docs and source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**이 가이드의 테스트 범위:** 구성은 Atmosphere 자체 문서와 소스에서 읽었습니다. 이 도구의 실제 배포에서 처음부터 끝까지 따라 해 본 적은 없습니다. 에이전트와 프로브는 각각 실제 DevStack을 nova-compute 중지와 복구를 거쳐 실행 중인 OneUptime까지 끝까지 연결했지만, 이 도구에서 한 것은 아닙니다. 프로브와 Kubernetes 에이전트는 각각 따로 테스트했으며, 이 도구에서 함께 테스트하지는 않았습니다.",
  "Then add the receiver to your Atmosphere configuration, beside whichever receivers you already have, and deploy it:":
    "그런 다음 이미 있는 리시버 옆에 Atmosphere 구성으로 리시버를 추가하고 배포하세요:",
  "For who did what through Nova, Neutron and Cinder, the charts Atmosphere deploys already have the audit filter in each pipeline, and it needs telling where to write, in `nova_helm_values`, `neutron_helm_values` and `cinder_helm_values`. Glance's chart has neither the filter nor a place for it in its pipelines: add both to its `conf.paste`, in `glance_helm_values`.":
    "Nova, Neutron, Cinder를 통해 누가 무엇을 했는지 알려면, Atmosphere가 배포하는 차트에는 이미 각 파이프라인에 감사 필터가 있으므로, `nova_helm_values`, `neutron_helm_values`, `cinder_helm_values`에서 기록할 곳만 알려 주면 됩니다. Glance의 차트에는 필터도, 파이프라인 안의 그 자리도 없습니다: `glance_helm_values`에서 둘 다 그 `conf.paste`에 추가하세요.",
  "Sunbeam can deploy the Canonical Observability Stack, with `sunbeam enable observability embedded`. Canonical also has an `openstack-exporter` charm, which the agent can read if you run it.":
    "Sunbeam은 `sunbeam enable observability embedded`로 Canonical Observability Stack을 배포할 수 있습니다. Canonical에는 `openstack-exporter` charm도 있으며, 이를 실행하면 에이전트가 읽을 수 있습니다.",
  "**How far this guide has been tested:** Its commands were read from Canonical's docs and its charms' source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. Nothing here has been run on Sunbeam, and Sunbeam's own docs do not mention the exporter charm.":
    "**이 가이드의 테스트 범위:** 명령은 Canonical의 문서와 그 charm 소스에서 읽었습니다. 이 도구의 실제 배포에서 처음부터 끝까지 따라 해 본 적은 없습니다. 에이전트와 프로브는 각각 실제 DevStack을 nova-compute 중지와 복구를 거쳐 실행 중인 OneUptime까지 끝까지 연결했지만, 이 도구에서 한 것은 아닙니다. 여기 있는 것은 Sunbeam에서 하나도 실행해 보지 않았으며, Sunbeam 자체 문서는 익스포터 charm을 언급하지 않습니다.",
  "Then give the stack's Alertmanager a configuration with the receiver in it:":
    "그런 다음 스택의 Alertmanager에 리시버가 들어간 구성을 주세요:",
  "If you run Canonical's `openstack-exporter` charm, the agent can read it with no credential of its own. It answers one cloud on `/metrics`, on port `9180` unless you changed its `port` setting. Find its address with `juju status openstack-exporter`:":
    "Canonical의 `openstack-exporter` charm을 실행한다면, 에이전트는 전용 자격 증명 없이 그것을 읽을 수 있습니다. `port` 설정을 바꾸지 않았다면 포트 `9180`의 `/metrics`에서 클라우드 하나에 대해 응답합니다. 주소는 `juju status openstack-exporter`로 찾으세요:",
  "Which series it says depends on the exporter release in its snap, which was not recorded here: `bash troubleshoot.sh` says whether it reads the cloud.":
    "어떤 시계열을 내놓는지는 snap 안의 익스포터 릴리스에 따라 다른데, 여기서는 기록하지 않았습니다: 클라우드를 읽는지는 `bash troubleshoot.sh`가 알려 줍니다.",
  "With observability on, the stack's Loki holds the services' logs. OneUptime has no way to read Loki, and the agent's logs profile has not been tried on Sunbeam's charms, so nothing here collects them yet.":
    "observability를 켜면 서비스 로그는 스택의 Loki가 보관합니다. OneUptime에는 Loki를 읽을 방법이 없고, 에이전트의 로그 프로필은 Sunbeam의 charm에서 시험해 보지 않았으므로, 여기서는 아직 아무것도 그 로그를 수집하지 않습니다.",
  "Sunbeam's charms write each service's configuration from their own templates, and its Keystone charm has no setting for where notifications go. So neither Keystone's audit trail nor the audit filter can be turned on from outside the charm, and nothing here reaches Security Events.":
    "Sunbeam의 charm은 각 서비스의 구성을 자체 템플릿으로 작성하며, 그 Keystone charm에는 알림을 보낼 곳에 대한 설정이 없습니다. 그래서 Keystone의 감사 추적도, 감사 필터도 charm 밖에서는 켤 수 없고, 여기서 보안 이벤트에 도달하는 것은 없습니다.",
  "Its Telemetry Operator runs Ceilometer's Prometheus exporter and a monitoring stack with Alertmanager on OpenShift. The Kubernetes agent's OpenShift preset watches the control plane, and Ceilometer's exporter says what the compute nodes are doing.":
    "그 Telemetry Operator는 Ceilometer의 Prometheus 익스포터와 Alertmanager가 포함된 모니터링 스택을 OpenShift에서 실행합니다. Kubernetes 에이전트의 OpenShift 프리셋이 컨트롤 플레인을 감시하고, Ceilometer의 익스포터가 컴퓨트 노드가 무엇을 하는지 알려 줍니다.",
  "**How far this guide has been tested:** Its resources were read from the Telemetry Operator's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The OpenShift preset and Ceilometer's exporter were each tested on their own, not together on this tool.":
    "**이 가이드의 테스트 범위:** 리소스는 Telemetry Operator 자체 소스에서 읽었습니다. 이 도구의 실제 배포에서 처음부터 끝까지 따라 해 본 적은 없습니다. 에이전트와 프로브는 각각 실제 DevStack을 nova-compute 중지와 복구를 거쳐 실행 중인 OneUptime까지 끝까지 연결했지만, 이 도구에서 한 것은 아닙니다. OpenShift 프리셋과 Ceilometer의 익스포터는 각각 따로 테스트했으며, 이 도구에서 함께 테스트하지는 않았습니다.",
  "Then apply a receiver the monitoring stack picks up:":
    "그런 다음 모니터링 스택이 가져가는 리시버를 적용하세요:",
  "Follow **Kubernetes → Documentation** for this cluster, with **Red Hat OpenShift** picked, which sets `preset=openshift`. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "**Red Hat OpenShift** 를 선택해(`preset=openshift`가 설정됩니다) 이 클러스터에 대해 **Kubernetes → 문서** 를 따르세요. 그러면 파드, 그 로그, 노드가 Kubernetes 페이지에 도착하고, 그중 OpenStack 서비스도 그곳에서 감시됩니다.",
  "A probe says what is allocated, not what is busy. To read real usage, run the agent on a machine that can reach the compute nodes, with `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` naming each node on Ceilometer's port, `9101`.":
    "프로브는 할당된 양을 알려 줄 뿐, 실제로 쓰이는 양은 알려 주지 않습니다. 실제 사용량을 읽으려면 컴퓨트 노드에 연결할 수 있는 머신에서 에이전트를 실행하고, `OPENSTACK_CEILOMETER_EXPORTER_TARGETS`에 각 노드를 Ceilometer의 포트 `9101`로 지정하세요.",
  "For who did what through Nova and Neutron, each takes the filter's setting in its `customServiceConfig`, and its paste file in `defaultConfigOverwrite`. Cinder's and Glance's operators take no paste file, so nothing here reaches them.":
    "Nova와 Neutron를 통해 누가 무엇을 했는지 알려면, 각자의 `customServiceConfig`에 필터 설정을, `defaultConfigOverwrite`에 paste 파일을 넣습니다. Cinder와 Glance의 오퍼레이터는 paste 파일을 받지 않으므로, 여기서 그쪽에 도달하는 것은 없습니다.",
  "StackLight already watches OpenStack's services, MariaDB, Memcached, RabbitMQ and libvirt, with its own alert rules. Forward its alerts first, then a probe reads the APIs.":
    "StackLight는 자체 알림 규칙으로 OpenStack의 서비스, MariaDB, Memcached, RabbitMQ, libvirt를 이미 감시합니다. 먼저 그 알림을 전달한 뒤, 프로브가 API를 읽습니다.",
  "**How far this guide has been tested:** Its settings were read from Mirantis's docs, whose examples show other receivers rather than a webhook. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**이 가이드의 테스트 범위:** 설정은 Mirantis의 문서에서 읽었는데, 그 예시는 웹훅이 아닌 다른 리시버를 보여 줍니다. 이 도구의 실제 배포에서 처음부터 끝까지 따라 해 본 적은 없습니다. 에이전트와 프로브는 각각 실제 DevStack을 nova-compute 중지와 복구를 거쳐 실행 중인 OneUptime까지 끝까지 연결했지만, 이 도구에서 한 것은 아닙니다.",
  "Then add the receiver and its route to your StackLight values:":
    "그런 다음 StackLight 값에 리시버와 그 라우트를 추가하세요:",
  "For who did what through Nova, Neutron, Cinder and Glance, MOSK has a setting of its own, with the audit filter already in place. With the log driver, each service writes to its standard output, and the Kubernetes agent reads that from the pods' logs, with the cloud named in its values. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "Nova, Neutron, Cinder, Glance를 통해 누가 무엇을 했는지 알려면, MOSK에 전용 설정이 있으며, 감사 필터는 이미 들어가 있습니다. 로그 드라이버를 쓰면 각 서비스가 표준 출력에 기록하고, Kubernetes 에이전트가 값에 지정된 클라우드로서 그것을 파드 로그에서 읽습니다. 둘 다 서비스 자체 로그에 기록하며, 버스에는 소비자가 없습니다. **보안 이벤트 → 연결** 에서 **로그에서 보안 이벤트 찾기** 를 켜면 OneUptime이 그곳에서 이를 읽습니다.",
  "That setting does not cover Keystone. Its own audit trail takes `spec:services`, which Mirantis does not validate and takes no responsibility for, so weigh this with your support contract:":
    "그 설정은 Keystone을 다루지 않습니다. Keystone 자체 감사 추적에는 `spec:services`를 쓰는데, Mirantis는 이를 검증하지 않고 책임지지도 않으므로 지원 계약과 비교해 판단하세요:",
  "Keystone's audit trail says who signed in and who changed what in Keystone, and the audit filter says who did what through Nova, Neutron, Cinder and Glance. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "Keystone의 감사 추적은 누가 로그인했고 누가 Keystone에서 무엇을 바꿨는지 알려 주고, 감사 필터는 Nova, Neutron, Cinder, Glance를 통해 누가 무엇을 했는지 알려 줍니다. 둘 다 서비스 자체 로그에 기록하며, 버스에는 소비자가 없습니다. **보안 이벤트 → 연결** 에서 **로그에서 보안 이벤트 찾기** 를 켜면 OneUptime이 그곳에서 이를 읽습니다.",
  "The audit filter goes in each API's paste file, right after `authtoken` and the context filter that follows it in each pipeline, with the map file pyCADF ships for that service, in `etc/pycadf` under the Python environment the service runs in. Not at the end of a pipeline: Neutron's `extensions` filter answers its routers and security groups, and the filter would never see them.":
    "감사 필터는 각 API의 paste 파일에 넣되, 각 파이프라인에서 `authtoken`과 그 뒤를 잇는 컨텍스트 필터 바로 다음에, pyCADF가 그 서비스용으로 제공하는 맵 파일과 함께 넣습니다. 맵 파일은 서비스가 실행되는 Python 환경의 `etc/pycadf`에 있습니다. 파이프라인 끝에는 두지 마세요: Neutron의 `extensions` 필터가 라우터와 보안 그룹에 응답하므로, 감사 필터가 그것을 볼 수 없게 됩니다.",
  "[Who did what](/docs/telemetry/openstack#who-did-what) says what reaches Security Events, and [each tool's guide](/docs/telemetry/openstack-deployment-tools) says where these go on it.":
    "보안 이벤트에 도달하는 것은 [누가 무엇을 했는지](/docs/telemetry/openstack#who-did-what)에, 각 도구에서 이것들을 넣을 곳은 [각 도구의 가이드](/docs/telemetry/openstack-deployment-tools)에 있습니다.",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | 아니요 | 컬렉터의 컨테이너 이름(기본값: `oneuptime-openstack-agent`). 같은 머신에 있는 두 번째 클라우드의 에이전트에는 고유한 이름이 필요합니다. 설치 스크립트는 이 값을 설정하지 않으면 새 에이전트의 컨테이너 이름을 폴더 이름을 따서 짓고, 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). The install script names a second cloud's bundled exporter after its collector (`oneuptime-openstack-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | 아니요 | 번들 익스포터의 컨테이너 이름(기본값: `oneuptime-openstack-exporter`). 설치 스크립트는 이 값을 설정하지 않으면 두 번째 클라우드의 번들 익스포터 이름을 그 컬렉터 이름에 맞춰 짓고(`oneuptime-openstack-exporter-cloud2`, 컬렉터 `oneuptime-openstack-agent-cloud2`와 나란히), 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). The install script names a second cloud's quota exporter after its collector (`oneuptime-openstack-quota-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | 아니요 | 할당량 익스포터의 컨테이너 이름(기본값: `oneuptime-openstack-quota-exporter`). 설치 스크립트는 이 값을 설정하지 않으면 두 번째 클라우드의 할당량 익스포터 이름을 그 컬렉터 이름에 맞춰 짓고(`oneuptime-openstack-quota-exporter-cloud2`, 컬렉터 `oneuptime-openstack-agent-cloud2`와 나란히), 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). The install script names a second cloud's database exporter after its collector (`oneuptime-openstack-database-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | 아니요 | 데이터베이스 익스포터의 컨테이너 이름(기본값: `oneuptime-openstack-database-exporter`). 설치 스크립트는 이 값을 설정하지 않으면 두 번째 클라우드의 데이터베이스 익스포터 이름을 그 컬렉터 이름에 맞춰 짓고(`oneuptime-openstack-database-exporter-cloud2`, 컬렉터 `oneuptime-openstack-agent-cloud2`와 나란히), 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). The install script names a second cloud's worker state exporter after its collector (`oneuptime-openstack-worker-state-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | 아니요 | 워커 상태 익스포터의 컨테이너 이름(기본값: `oneuptime-openstack-worker-state-exporter`). 설치 스크립트는 이 값을 설정하지 않으면 두 번째 클라우드의 워커 상태 익스포터 이름을 그 컬렉터 이름에 맞춰 짓고(`oneuptime-openstack-worker-state-exporter-cloud2`, 컬렉터 `oneuptime-openstack-agent-cloud2`와 나란히), 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). The install script names a second cloud's AI agent after its collector (`oneuptime-openstack-ai-agent-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | 아니요 | AI 에이전트의 컨테이너 이름(기본값: `oneuptime-openstack-ai-agent`). 설치 스크립트는 이 값을 설정하지 않으면 두 번째 클라우드의 AI 에이전트 이름을 그 컬렉터 이름에 맞춰 짓고(`oneuptime-openstack-ai-agent-cloud2`, 컬렉터 `oneuptime-openstack-agent-cloud2`와 나란히), 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "One agent reads one cloud. For a second cloud, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "에이전트 하나는 클라우드 하나를 읽습니다. 두 번째 클라우드에는 별도 폴더에 고유한 컨테이너 이름으로 두 번째 에이전트를 설치하세요. 두 컨테이너는 이름을 공유할 수 없습니다:",
  "The script names the containers after the folder, such as `oneuptime-openstack-agent-cloud2`, unless you set their variables, such as `OPENSTACK_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "변수(예: `OPENSTACK_AGENT_CONTAINER_NAME`)를 설정하지 않으면 스크립트가 폴더 이름을 따서 컨테이너 이름을 짓습니다(예: `oneuptime-openstack-agent-cloud2`). 스크립트는 그 이름을 해당 에이전트의 `.env`에 보관하므로, 같은 `INSTALL_DIR`로 스크립트를 다시 실행해 에이전트를 업그레이드해도 이름이 유지되며, `docker-compose.yml`에서 `container_name`을 직접 수정한 적이 있는 에이전트도 그 이름을 유지합니다.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "폴더마다 고유한 이름을 붙이세요. Docker Compose는 폴더 이름만으로 프로젝트 이름을 짓기 때문에, 스크립트는 다른 곳에서 이미 에이전트를 실행 중인 폴더와 같은 이름의 폴더를 거부합니다. 진단 스크립트에는 `-d`로 폴더를 넘기세요.",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | 아니요 | 컬렉터의 컨테이너 이름(기본값: `oneuptime-openstack-agent`). 같은 머신에 있는 두 번째 클라우드의 에이전트에는 고유한 이름이 필요합니다 |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | 아니요 | 번들 익스포터의 컨테이너 이름(기본값: `oneuptime-openstack-exporter`). 같은 머신에 있는 두 번째 클라우드의 에이전트에는 고유한 이름이 필요합니다 |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | 아니요 | 할당량 익스포터의 컨테이너 이름(기본값: `oneuptime-openstack-quota-exporter`). 같은 머신에 있는 두 번째 클라우드의 에이전트에는 고유한 이름이 필요합니다 |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | 아니요 | 데이터베이스 익스포터의 컨테이너 이름(기본값: `oneuptime-openstack-database-exporter`). 같은 머신에 있는 두 번째 클라우드의 에이전트에는 고유한 이름이 필요합니다 |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | 아니요 | 워커 상태 익스포터의 컨테이너 이름(기본값: `oneuptime-openstack-worker-state-exporter`). 같은 머신에 있는 두 번째 클라우드의 에이전트에는 고유한 이름이 필요합니다 |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | 아니요 | AI 에이전트의 컨테이너 이름(기본값: `oneuptime-openstack-ai-agent`). 같은 머신에 있는 두 번째 클라우드의 에이전트에는 고유한 이름이 필요합니다 |",
  "One agent reads one cloud. For a second cloud, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "에이전트 하나는 클라우드 하나를 읽습니다. 두 번째 클라우드에는 별도 폴더에 고유한 컨테이너 이름으로 두 번째 에이전트를 구성하세요. 두 컨테이너는 이름을 공유할 수 없습니다. 이름은 그 에이전트의 `.env`에 설정하세요:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "폴더마다 고유한 이름을 붙이세요. Docker Compose는 폴더 이름만으로 프로젝트 이름을 짓기 때문에, 같은 이름의 두 번째 폴더는 첫 번째 에이전트의 컨테이너를 대체합니다. 이름은 `docker-compose.yml`에 넣지 마세요. 업그레이드가 이 파일을 대체합니다.",
};

export default TRANSLATION;
