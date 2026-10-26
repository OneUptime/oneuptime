# Eventos de rede (syslog e traps SNMP)

Roteadores, firewalls, switches e pontos de acesso dizem no syslog o que acontece com eles: um link caiu, um túnel foi interrompido, um firewall fez failover, alguém fez login. Cada fabricante diz isso do seu jeito. Aponte o syslog deles para uma sonda do OneUptime, e as páginas de **Eventos** mostram o que aconteceu com as mesmas palavras, seja qual for o fabricante do dispositivo, e avisam você quando acontecer de novo.

Há uma página de Eventos em dois lugares:

- **Rede** -> **Eventos**: a rede inteira, os eventos de todos os dispositivos em uma única página, e cada endereço que envia syslog sem ser ainda um dispositivo.
- A aba **Eventos** de um dispositivo: o que esse dispositivo relatou.

## O que a página de Eventos mostra

- Os eventos do intervalo de tempo, do mais recente para o mais antigo. Cada linha diz o que aconteceu, em qual dispositivo, com o quê - a interface, o túnel, o gateway - e nas palavras do próprio dispositivo.
- **Problemas**, **Recuperações** e **Informativos**, cada um com quantos há no intervalo de tempo. Clique em um para ver só esses.
- O seletor **Todos os eventos** e, na página da rede, o seletor **All devices** restringem ainda mais a lista. O intervalo de tempo e os filtros ficam no endereço da página, então um link abre exatamente a mesma visualização.
- Clique em um evento para abri-lo: quando aconteceu, do que se trata, a mensagem como o dispositivo a enviou, e cada atributo que o OneUptime leu nela.
- **Criar alerta** oferece os alertas que a maioria das redes quer, e **Criar alerta para este evento** cria um para o evento que você abriu. Veja [Alertas](#alertas).

Um evento é um log. Tudo o que está na página de Eventos também pode ser pesquisado, colocado em gráficos e usado para alertas em **Registros**: um evento é um log cujo atributo `event.domain` é `network`, com o que aconteceu em `event.name`.

## O que o OneUptime lê

O syslog nos formatos RFC 3164 e RFC 5424 e o Common Event Format (CEF) são lidos de qualquer produto. Além disso, o OneUptime sabe o que estes produtos escrevem:

| Fabricante | Produtos | Eventos que lê | Atributos |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | Interfaces, Dispositivos, Alta disponibilidade, VPN, Roteamento, Hardware, Comutação, Logins | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | Interfaces, Dispositivos, Alta disponibilidade, VPN, WAN, Logins | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | Interfaces, Dispositivos, Alta disponibilidade, VPN, WAN, Hardware, Logins | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | Interfaces, Dispositivos, Alta disponibilidade, Roteamento, Hardware, Comutação, Logins | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | Interfaces, Roteamento | `extreme.*` |
| HPE Aruba Networking | AOS-CX | Interfaces, Hardware | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | Interfaces | `aruba.*` |
| MikroTik | RouterOS | Interfaces, Dispositivos, Logins | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | Dispositivos, VPN, Wi-Fi | `cambium.*` |
| Ubiquiti | UniFi Network | Dispositivos, WAN, Comutação, Logins, Wi-Fi | `cef.*` |
| Qualquer | Dispositivos baseados em Linux (kernel, hostapd, OpenSSH, Dropbear) | Interfaces, Logins, Wi-Fi | - |

Uma mensagem em um desses formatos tem seus próprios campos guardados como atributos sob o prefixo da última coluna, então `con_name="HQ-Branch1"` em um firewall Sophos é o atributo `sophos.con_name`. Uma mensagem CEF de qualquer outro produto tem o cabeçalho e os campos de extensão guardados sob `cef.*`. Uma mensagem que o OneUptime não consegue situar ainda é guardada como log, com o cabeçalho syslog lido; você mesmo pode dar nome aos eventos dela, veja [Seus próprios eventos](#seus-próprios-eventos).

Os traps SNMP padrão são lidos como os mesmos eventos: `linkDown` e `linkUp` viram **Interface inativa** e **Interface ativa**, `coldStart` e `warmStart` viram **Dispositivo reiniciado**.

## Os eventos

Cada mensagem que o OneUptime reconhece é guardada com um destes nomes em `event.name`, seja qual for o fabricante do dispositivo:

| Evento | `event.name` | Tipo | Sobre |
| --- | --- | --- | --- |
| Interface inativa | `interface.down` | Problema | `network.interface.name` |
| Interface ativa | `interface.up` | Recuperação | `network.interface.name` |
| Porta desligada pelo switch | `interface.error_disabled` | Problema | `network.interface.name` |
| Dispositivo reiniciado | `device.reboot` | Problema | - |
| Configuração alterada | `device.config_change` | Informativos | `user.name` |
| Dispositivo offline | `device.offline` | Problema | - |
| Dispositivo online | `device.online` | Recuperação | - |
| Failover | `ha.failover` | Problema | `ha.role` |
| Estado de alta disponibilidade alterado | `ha.state_change` | Informativos | `ha.role` |
| Par de alta disponibilidade inativo | `ha.peer_down` | Problema | `ha.peer` |
| Par de alta disponibilidade ativo | `ha.peer_up` | Recuperação | `ha.peer` |
| Túnel VPN inativo | `vpn.tunnel_down` | Problema | `vpn.tunnel.name` |
| Túnel VPN ativo | `vpn.tunnel_up` | Recuperação | `vpn.tunnel.name` |
| Vizinho de roteamento inativo | `routing.neighbor_down` | Problema | `network.peer.address` |
| Vizinho de roteamento ativo | `routing.neighbor_up` | Recuperação | `network.peer.address` |
| Gateway inativo | `gateway.down` | Problema | `network.gateway.name` |
| Gateway ativo | `gateway.up` | Recuperação | `network.gateway.name` |
| Failover de WAN | `wan.failover` | Problema | `network.gateway.name` |
| Link SD-WAN abaixo do seu SLA | `sdwan.sla_not_met` | Problema | `network.gateway.name` |
| Link SD-WAN de volta ao seu SLA | `sdwan.sla_met` | Recuperação | `network.gateway.name` |
| Ventoinha com falha | `hardware.fan_failed` | Problema | `hw.name` |
| Ventoinha funcionando novamente | `hardware.fan_ok` | Recuperação | `hw.name` |
| Fonte de alimentação com falha | `hardware.power_supply_failed` | Problema | `hw.name` |
| Fonte de alimentação funcionando novamente | `hardware.power_supply_ok` | Recuperação | `hw.name` |
| Temperatura alta demais | `hardware.temperature_high` | Problema | - |
| Loop detectado | `loop.detected` | Problema | `network.interface.name` |
| Mudança na topologia de spanning tree | `stp.topology_change` | Informativos | - |
| Falha de PoE | `poe.fault` | Problema | `network.interface.name` |
| Falha no login | `auth.login_failed` | Problema | `user.name` |
| Login efetuado | `auth.login_success` | Informativos | `user.name` |
| Cliente Wi-Fi conectado | `wireless.client_connected` | Informativos | `client.mac` |
| Cliente Wi-Fi desconectado | `wireless.client_disconnected` | Informativos | `client.mac` |

A última coluna é o atributo que diz do que o evento trata. Nem todo produto relata todos os eventos: um switch não tem túneis VPN, e o syslog de um produto só diz o que diz.

Cada evento também traz:

| Atributo | O que contém |
| --- | --- |
| `event.domain` | `network`, em todo evento de rede |
| `event.kind` | `problem`, `recovery` ou `info` |
| `event.category` | `interface`, `device`, `ha`, `vpn`, `routing`, `wan`, `hardware`, `switching`, `security` ou `wireless`, nos eventos acima |
| `event.device` | Qual dispositivo: o nome dele no OneUptime, senão o nome que ele dá a si mesmo, senão o endereço dele |
| `event.message` | O que o dispositivo disse, nas próprias palavras |
| `syslog.vendor`, `syslog.parser` | No formato de quem a mensagem foi lida |

## Como os eventos chegam aqui

Toda sonda escuta syslog na porta 5140, por UDP e por TCP. Por TCP uma mensagem é uma linha, ou vem precedida do seu comprimento, como descreve a RFC 6587. A sonda encaminha ao OneUptime o que ouve a cada poucos segundos, e o OneUptime associa cada mensagem a um dispositivo pelo endereço de onde ela veio:

1. um dispositivo consultado pela sonda cujo nome do host é esse endereço (ou resolve para ele), ou que o lista em **Outros endereços** na sua página de **Configurações**;
2. na sua própria sonda (personalizada), qualquer dispositivo do projeto com esse endereço, ou com o nome do host que a mensagem traz quando exatamente um dispositivo tem esse nome;
3. caso contrário, na sua própria sonda, a mensagem é guardada para a página de Eventos da rede, em **Enviando syslog, ainda não é um dispositivo**, até você dizer a qual dispositivo ela pertence. Uma sonda global a descarta.

Uma linha de um endereço desconhecido que não tem prioridade syslog e não é um evento é tomada por ruído e descartada.

Um controlador fala pelos dispositivos que gerencia: um console UniFi relata sobre seus pontos de acesso e switches. Quando uma mensagem de um dispositivo nomeia outro dispositivo pelo endereço MAC, pelo número de série, pelo endereço ou pelo nome que o controlador lhe dá, o evento vai para esse dispositivo, e o log guarda em `syslog.relay.name` o nome do controlador que o repassou.

Um log é guardado no horário em que a sonda o recebeu. Uma mensagem que ficou retida - o timestamp dela está no formato RFC 5424, que indica o fuso horário, e tem mais de 5 minutos - mantém o horário do dispositivo, até 7 dias atrás. Qualquer outro timestamp a mais de 5 minutos do relógio da sonda não é aceito: o log é guardado no horário em que foi recebido, e o horário do dispositivo fica em `syslog.deviceTime`.

O syslog que você envia para [o endpoint de syslog](/docs/telemetry/syslog) por HTTPS é lido pelos mesmos analisadores. Lá uma mensagem vira um evento de rede quando está no formato próprio de um fabricante de rede, ou quando nomeia um dos seus dispositivos de rede pelo endereço MAC, número de série, endereço ou nome do host; as linhas de `sshd` de um servidor continuam sendo logs comuns.

## Configuração

1. **Use uma sonda na rede do dispositivo.** O syslog é enviado pelos seus dispositivos, então eles precisam de uma [sonda personalizada](/docs/probe/custom-probe) que consigam alcançar. Uma sonda global na internet pública não o receberá.
2. **Deixe o syslog chegar à sonda.** Permita a porta 5140, UDP ou TCP, dos dispositivos para a sonda. Uma sonda no Docker iniciada com a rede do host (`--network host`), como mostra a página da sonda personalizada, o recebe como está; sem a rede do host, publique a porta com `-p 5140:5140/udp -p 5140:5140/tcp`. Para um dispositivo que só consegue enviar para a porta 514, publique-a como `-p 514:5140/udp`, ou defina `PROBE_SYSLOG_RECEIVER_PORT=514` em uma sonda com a rede do host.
3. **Defina a sonda como servidor syslog do dispositivo.** Os comandos para dispositivos comuns estão abaixo. A página de **Eventos** mostra os mesmos passos até a primeira mensagem chegar, e então vira a lista por conta própria.
4. **Verifique o endereço do dispositivo.** As mensagens são associadas pelo endereço de onde o dispositivo envia. Se ele envia de uma loopback ou de uma interface de gerenciamento que não é o nome do host dele, adicione esse endereço aos **Outros endereços** do dispositivo.

O receptor de syslog vem ativado por padrão. As configurações dele são variáveis de ambiente da sonda:

| Variável | O que faz | Padrão |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | Defina como `false` para desativar o receptor de syslog | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | A porta, para UDP e TCP | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | Mensagens encaminhadas por minuto, somando todos os dispositivos | `600` |

Passado o limite, a sonda ainda encaminha as mensagens que lê como eventos de rede, até outro tanto, para que uma enxurrada de linhas rotineiras não tire o lugar daquela que diz que um link caiu. Uma sonda mais antiga que este recurso só escuta quando é iniciada com `PROBE_SYSLOG_RECEIVER_ENABLED=true`, e só por UDP: atualize-a.

### Cisco IOS, IOS XE e NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

A segunda linha envia as mensagens informativas e tudo o que é mais grave: mudanças de link, reinicializações e logins estão entre elas. No NX-OS a linha é `logging server <probe-address> 6 port 5140 use-vrf management`.

### Sophos Firewall

1. Na administração web do firewall, abra **System services** > **Log settings** e, em **Syslog servers**, escolha **Add**.
2. Informe o endereço IP da sonda e a porta `5140`, e defina o nível de severidade como **Information**. Qualquer um dos dois formatos de log que o firewall oferece é lido.
3. De volta a **Log settings**, marque o novo servidor para os logs a enviar: pelo menos os eventos do sistema, e **SD-WAN** para mudanças de SLA. Os logs de tráfego do firewall são muitos, então deixe-os de fora, a menos que você os queira.

### Fortinet FortiGate

```text
config log syslogd setting
    set status enable
    set server "<probe-address>"
    set port 5140
    set mode udp
    set format default
end
```

O FortiGate envia o que as configurações de log dele selecionam. Os logs de eventos trazem os túneis, os links e os failovers; os logs de tráfego são muitos, então deixe-os de fora, a menos que você os queira.

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

Troque `VR-Default` pelo roteador virtual pelo qual se chega à sonda.

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

No AOS-CX, acrescente `vrf mgmt` à linha quando se chega à sonda pela porta de gerenciamento. No AOS-Switch a linha é `logging <probe-address> udp 5140`.

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

A primeira linha aponta a ação remota embutida do roteador para a sonda; as outras escolhem o que ele envia. Deixe o formato de log remoto como está.

### Ubiquiti UniFi

1. No UniFi Network, abra **Integration** > **System Logging / SIEM** e selecione **SIEM Server** como destino.
2. Informe o endereço IP da sonda e a porta `5140`, e escolha as categorias de log a exportar.

O console relata sobre os pontos de acesso e os switches que gerencia. Os eventos chegam à página de cada dispositivo quando o dispositivo está no OneUptime com o endereço MAC dele, e à do console caso contrário.

### Cambium Networks

1. No cnMaestro ou na interface web do ponto de acesso, abra as configurações do sistema e encontre os servidores syslog.
2. Informe o endereço IP da sonda como servidor syslog, com a porta `5140` onde o formulário pedir uma porta, e defina a severidade do syslog como **Info**.

Onde não há porta para definir, o ponto de acesso envia para a porta 514: publique ali a porta da sonda, como mostra o passo 2 de [Configuração](#configuração).

### Outros dispositivos

Adicione um servidor syslog remoto no dispositivo: o endereço IP da sonda, porta 5140, por UDP ou TCP, enviando as mensagens informativas e tudo o que é mais grave. Um dispositivo cujo formato o OneUptime não conhece ainda tem suas mensagens guardadas, e você mesmo pode dar nome aos eventos dele.

## Alertas

**Criar alerta**, em uma página de Eventos, lista os alertas que a maioria das redes quer. Cada um abre **Criar monitor** já preenchido, onde você pode mudar qualquer coisa antes de salvar:

| Alerta | Avisa você quando | Um alerta por | Fecha quando |
| --- | --- | --- | --- |
| Um túnel VPN cai | `vpn.tunnel_down` | dispositivo e túnel | `vpn.tunnel_up` para esse túnel |
| Um firewall ou switch faz failover | `ha.failover` | dispositivo | passam 5 minutos sem outro |
| Um link WAN cai | `gateway.down` | dispositivo e gateway | `gateway.up` para esse gateway |
| Um vizinho de roteamento cai | `routing.neighbor_down` | dispositivo e vizinho | `routing.neighbor_up` para esse vizinho |
| Um dispositivo reinicia | `device.reboot` | dispositivo | passam 5 minutos sem outro |
| O hardware falha | um ventilador, uma fonte de alimentação ou a temperatura | dispositivo e componente | o mesmo componente é relatado funcionando de novo |
| Uma interface cai | `interface.down` | dispositivo e interface | `interface.up` para essa interface |
| Alguém continua falhando ao fazer login | mais de 10 `auth.login_failed` em 5 minutos | dispositivo | passam 5 minutos com 10 ou menos |

Cada um é um [monitor de logs](/docs/monitor/logs-monitor) que conta o evento nos últimos 5 minutos, com **Group by Attributes** definido para que cada túnel, gateway ou interface tenha seu próprio alerta, e com **Resolvido por atributos** definido para o evento que diz que o problema acabou. Um alerta assim fica aberto até esse evento chegar para o mesmo dispositivo e o mesmo túnel, demore o quanto demorar; veja [Resolvido por um log](/docs/monitor/logs-monitor#resolvido-por-um-log). O OneUptime não lê nenhum evento que diga que uma temperatura voltou ao normal, então um alerta de temperatura fica aberto até você resolvê-lo.

A partir da aba **Eventos** de um dispositivo, os monitores observam só esse dispositivo. Para qualquer outro evento, abra um na página de Eventos e clique em **Criar alerta para este evento**. Para enviar um alerta a algum lugar, ou para acionar alguém de plantão, adicione ao monitor uma política de plantão ou um workflow, como em qualquer outro.

## Endereços que ainda não são dispositivos

O syslog pode chegar antes de o dispositivo que o envia ser adicionado ao OneUptime. Na sua própria sonda ele é guardado, os eventos dele ficam na página de Eventos da rede com o nome que o dispositivo dá a si mesmo, e o endereço dele é listado em **Enviando syslog, ainda não é um dispositivo**:

- **Adicionar como dispositivo** abre **Adicionar dispositivo** com o endereço e a sonda já preenchidos. As mensagens que já chegaram ficam na página da rede; as novas vão para o dispositivo.
- **É um dos meus dispositivos** adiciona o endereço aos **Outros endereços** de um dispositivo: use quando um dispositivo que você já adicionou envia de outro endereço, como uma loopback. As mensagens dele vão para esse dispositivo a partir do minuto seguinte.

Vários dispositivos atrás de um mesmo endereço NAT compartilham esse endereço, então as mensagens deles vão para o único dispositivo que o tem, a menos que uma mensagem nomeie o próprio dispositivo.

## Seus próprios eventos

Um dispositivo cujo formato o OneUptime não conhece, ou um evento que ele não lê, pede um [pipeline de registros](/docs/telemetry/log-pipelines):

1. Crie um pipeline cujo filtro corresponda aos logs do dispositivo, como `attributes.networkDevice.name = 'rack-ups'`.
2. Adicione um **Grok Parser** ou um **Key=Value Parser** para extrair da mensagem os campos de que você precisa.
3. Adicione um **Processador de categorias** com **Atributo de Destino** `event.name`, e uma regra por evento. Dê a cada uma um nome como os dos eventos acima, em minúsculas com pontos ou sublinhados: `ups.on_battery`.

Um log de um dispositivo de rede que traz um nome assim vira um evento de rede: ele fica nas páginas de Eventos, e **Criar alerta para este evento** funciona nele. Para dizer do que ele trata, adicione um **Remapeador de atributos** que copie o seu campo para um dos atributos da tabela de eventos, como `hw.name`. A menos que o seu pipeline defina `event.kind` como `problem` ou `recovery`, o evento é listado em **Informativos**. Uma regra com o nome de um evento embutido, como `interface.down`, produz o evento embutido, com o tipo e os alertas dele.

Um pipeline pertence ao seu projeto. Para usar um em outro projeto, crie-o lá com os mesmos processadores.

## O que não está incluído

- **Syslog sobre TLS** (RFC 5425). A sonda aceita UDP e TCP sem criptografia; mantenha o caminho entre os dispositivos e a sonda em uma rede em que você confia.
- **Compartilhar analisadores entre projetos.** Um pipeline ainda não pode ser exportado e importado.
- **Eventos de traps SNMP além dos quatro padrão.** Os traps próprios de um fabricante são guardados como logs, e os alertas sobre eles são criados com o critério **SNMP Trap Received (Trap OID)** do [monitor de dispositivos de rede](/docs/monitor/network-device-monitor).
- **Switches Cambium cnMatrix, controladores de mobilidade Aruba e FortiGate em modo CEF.** As mensagens deles são guardadas e pesquisáveis; ainda não se leem eventos nelas.
- **Um acompanhamento ao vivo.** A página de Eventos mostra o que tinha chegado quando foi aberta; use o botão de atualizar dela, ou o acompanhamento ao vivo de **Registros**.

## Solução de problemas

Se uma página de Eventos ainda mostra os passos de configuração:

- **A sonda está recebendo alguma coisa?** A página de Eventos da rede lista em **Enviando syslog, ainda não é um dispositivo** cada endereço que enviou syslog no intervalo de tempo. Se o dispositivo estiver lá, ele envia de um endereço que não é o nome do host dele: adicione esse endereço aos **Outros endereços** dele.
- **Firewalls e Docker.** Permita a porta 5140 do dispositivo para a sonda, e publique a porta se a sonda rodar no Docker. Muitos dispositivos enviam para a porta 514 se nada lhes for dito.
- **O log da sonda.** Ao iniciar, a sonda registra no log a porta em que escuta, ou que não conseguiu abri-la. Quando descarta mensagens acima de `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`, registra quantas, uma vez por minuto.
- **Uma sonda global.** Um dispositivo consultado por uma sonda global não consegue enviar syslog para ela a partir de uma rede privada. Execute uma sonda personalizada na rede do dispositivo e escolha-a nas configurações do dispositivo.
- **Chegam mensagens, mas nenhum evento.** A página diz isso, e cada mensagem está na aba **Registros** do dispositivo. Verifique se o dispositivo envia as mensagens informativas, não só os erros, e se o produto é um dos que estão em [O que o OneUptime lê](#o-que-o-oneuptime-lê); caso contrário, dê nome aos eventos dele em um pipeline de registros.
