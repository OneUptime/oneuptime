# Tráfego de rede (NetFlow, IPFIX e sFlow)

Roteadores, firewalls e switches podem descrever o tráfego que passa por eles como **registros de fluxo**: quem falou com quem, por qual protocolo e quais portas, por quais interfaces e com quantos bytes. Aponte essa exportação para uma sonda do OneUptime e as páginas de **Tráfego** mostram para onde vai o seu tráfego: os endereços, conversas, aplicações e interfaces mais ativos, em qualquer intervalo de tempo.

Há uma página de Tráfego em três lugares:

- **Rede** -> **Tráfego**: toda a rede, os fluxos de cada dispositivo em uma página, e cada endereço que envia fluxos sem ainda ser um dispositivo.
- A página de **Tráfego** de um site: os dispositivos desse site.
- A aba **Tráfego** de um dispositivo: esse dispositivo, com suas interfaces. As capturas de pacotes executadas na sonda do dispositivo aparecem abaixo dos fluxos, para quando você precisar dos próprios pacotes.

## O que a página de Tráfego mostra

- Quatro números para o intervalo: **Tráfego** (bytes), a taxa **Média** e de **Pico**, e **Fluxos** (quantos registros de fluxo os dispositivos enviaram).
- **Tráfego ao longo do tempo**, em bits por segundo. Arraste sobre o gráfico para ampliar um trecho; clique duas vezes nele, ou use **Redefinir zoom**, para voltar.
- **Principais origens** e **Principais destinos**: os dez endereços que mais enviaram e mais receberam.
- **Principais aplicações**: o tráfego por protocolo e porta de serviço, com o nome do serviço que costuma estar nessa porta (HTTPS é a porta TCP 443).
- **Principais interfaces** na página de um dispositivo: o que entrou e saiu por cada interface, com o nome e a velocidade da varredura SNMP do dispositivo. **Principais dispositivos** na página de um site e na da rede.
- **Principais conversas**: os dez pares de endereços mais ativos, desenhados como um diagrama dos emissores para os receptores, ou como uma lista.

Clique em qualquer linha - um endereço, uma aplicação, uma interface, um dispositivo, uma faixa do diagrama - e a página inteira se restringe a esse tráfego. Uma etiqueta acima da página diz a que ela está restrita; clique no x para ampliá-la de novo. **Encontrar um endereço IP** restringe a página ao tráfego para ou de um endereço. O intervalo de tempo e os filtros ficam no endereço da página, então um link abre exatamente a mesma visualização.

## Como os fluxos chegam aqui

Cada sonda executa um coletor de fluxos. Ele escuta em três portas UDP, e cada porta lê todos os formatos:

| Porta    | Normalmente usada para      |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

A sonda decodifica os registros, multiplica de volta as contagens amostradas pela taxa de amostragem, soma os registros de uma mesma conversa a cada poucos segundos e os envia ao OneUptime. Cada registro é associado a um dispositivo pelo endereço de onde o dispositivo o envia - no sFlow, o endereço do agente no datagrama:

1. um dispositivo consultado pela sonda cujo nome do host é esse endereço (ou resolve para ele), ou que o lista em **Outros endereços** na sua página de **Configurações**;
2. na sua própria sonda (personalizada), qualquer dispositivo do projeto com esse endereço como nome do host ou entre seus outros endereços;
3. caso contrário, na sua própria sonda, os fluxos são guardados para a página de Tráfego da rede, em **Emissores de fluxos**, até você dizer a qual dispositivo pertencem. Uma sonda global os descarta.

Os fluxos são guardados por 30 dias, e uma página mostra no máximo 31 dias.

## Configuração

1. **Use uma sonda na rede do dispositivo.** Os fluxos são datagramas UDP enviados pelos seus dispositivos, então precisam de uma [sonda personalizada](/docs/probe/custom-probe) que consigam alcançar. Uma sonda global na internet pública não os receberá.
2. **Deixe os datagramas chegarem à sonda.** Permita UDP 2055, 4739 e 6343 dos dispositivos para a sonda. Uma sonda no Docker iniciada com a rede do host (`--network host`), como mostra a página da sonda personalizada, os recebe como está; sem a rede do host, publique as portas com `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp`.
3. **Ative a exportação de fluxos no dispositivo** e envie-a para o endereço IP da sonda. Os comandos para dispositivos comuns estão abaixo. A aba **Tráfego** do dispositivo mostra os mesmos passos com as portas da sonda até o primeiro fluxo chegar.
4. **Verifique o endereço do dispositivo.** Os registros são associados pelo endereço de onde o dispositivo envia. Se ele envia de uma loopback ou de uma interface de gerenciamento que não é o nome do host dele, adicione esse endereço aos **Outros endereços** do dispositivo.

O coletor vem ativado por padrão. As configurações dele são variáveis de ambiente da sonda:

| Variável                            | O que faz                                                           | Padrão  |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | Defina como `false` para desativar o coletor de fluxos              | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | A porta do NetFlow; `0` deixa de escutar nela                       | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | A porta do IPFIX; `0` deixa de escutar nela                         | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | A porta do sFlow; `0` deixa de escutar nela                         | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | Datagramas aceitos por minuto, somando todos os dispositivos e portas | 6000    |

### Cisco IOS XE (Flexible NetFlow)

Exporta IPFIX para UDP 4739. Adicione a última linha a cada interface cujo tráfego você quer ver: medir o tráfego à medida que entra em cada interface conta cada conversa uma única vez.

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS (NetFlow v9)

Exporta NetFlow v9 para UDP 2055.

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS (sFlow)

Exporta sFlow para UDP 6343. O sFlow amostra um pacote a cada N (16384 aqui), e as páginas de Tráfego multiplicam as amostras de volta, então os números são estimativas.

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX e Z

Os appliances MX e os gateways de teletrabalho da série Z exportam NetFlow v9 a partir do painel do Meraki:

1. Abra **Network-wide** > **General** e encontre **Reporting**.
2. Defina **NetFlow traffic reporting** como **Enabled: send NetFlow traffic statistics**.
3. Digite o endereço IP da sonda como **NetFlow collector IP** e `2055` como **NetFlow collector port**, e salve.

Um MX ou Z só vê o tráfego que passa por ele. O tráfego que um switch mantém dentro de uma VLAN nunca chega até ele, então não está na exportação.

### Juniper (J-Flow inline)

Exporta IPFIX para UDP 4739 a partir de roteadores MX; use a FPC que carrega as interfaces que você amostra.

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

Exporta NetFlow v9 para UDP 2055. No FortiOS 7.2 e posteriores, o coletor é uma entrada em `config collectors` dentro de `config system netflow`.

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. Em **Device** > **Server Profiles** > **NetFlow**, adicione um perfil com o endereço IP da sonda e a porta `2055`, e defina o **Active Timeout** como 1 minuto.
2. Em **Network** > **Interfaces**, abra cada interface cujo tráfego você quer ver e escolha o perfil como o **NetFlow Profile** dela na aba **Advanced**.
3. Faça o commit.

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense e hosts Linux

No pfSense, instale o pacote **softflowd** e, em **Services** > **softflowd**, escolha as interfaces, digite o endereço IP da sonda e a porta `2055`, e escolha a versão 9 do NetFlow. Em um host Linux, execute o softflowd na interface cujo tráfego você quer ver:

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### Outros dispositivos

Envie NetFlow v5, NetFlow v9 ou IPFIX para o endereço IP da sonda em UDP 2055 (ou 4739), ou sFlow v5 em UDP 6343. Defina o tempo limite ativo dos fluxos do dispositivo para 60 segundos e, para NetFlow v9 e IPFIX, envie os modelos dele a cada 60 segundos. Os [guias de fabricantes de rede](/docs/monitor/network-vendor-guides) cobrem Sophos e Extreme Networks.

## Endereços que ainda não são dispositivos

Os fluxos podem chegar antes de o dispositivo que os envia ser adicionado ao OneUptime. Na sua própria sonda eles são guardados, e a página de Tráfego da rede lista o endereço deles em **Emissores de fluxos**, marcado como **Ainda não é um dispositivo**:

- **Adicionar como dispositivo** abre Adicionar dispositivo com o endereço e a sonda já preenchidos. Os fluxos que já chegaram ficam na página da rede; os novos vão para o dispositivo.
- **É um dos meus dispositivos** adiciona o endereço aos **Outros endereços** de um dispositivo: use quando um dispositivo que você já adicionou envia de outro endereço, como uma loopback. Os fluxos dele vão para esse dispositivo a partir do próximo minuto.

Vários dispositivos atrás de um mesmo endereço NAT compartilham esse endereço, então os fluxos deles vão para o único dispositivo que o tem.

## Como ler os números

- **Amostragem.** Um dispositivo que amostra - o sFlow sempre amostra, e NetFlow ou IPFIX podem amostrar - informa um pacote a cada N. A sonda multiplica as contagens por N, então a página mostra estimativas, e diz isso abaixo dos quatro números. Elas são precisas para muito tráfego e aproximadas para poucos pacotes.
- **Contado duas vezes.** O tráfego que passa por dois dispositivos exportadores é informado por ambos. A página de um dispositivo o conta uma vez; a página de um site ou da rede o conta uma vez por dispositivo que o informou.
- **Aplicações.** Uma aplicação é o protocolo e a porta de serviço, com o nome do serviço que costuma estar nessa porta. Não é uma inspeção profunda de pacotes: HTTPS na porta 8443 aparece como porta TCP 8443. A porta efêmera do cliente fica de fora, então mil conexões de navegador para um servidor são uma única aplicação.
- **Pico** é a taxa da fatia mais ativa do gráfico, então um intervalo mais curto, com fatias mais curtas, mostra um pico mais acentuado. **Média** são os bytes no intervalo inteiro.
- **Tempo.** Um fluxo conta na fatia em que começou. Um download longo é informado como vários fluxos, um para cada minuto que dura; por isso o tempo limite ativo dos dispositivos deve ser de 60 segundos.

## O que não está incluído

- **Alertas sobre fluxos.** Ainda não há um monitor baseado em fluxos. Para alertar sobre um link sobrecarregado, use os alertas de utilização de interface do [monitor de dispositivos de rede](/docs/monitor/network-device-monitor), que leem SNMP.
- **Nomes de aplicações além da porta.** Não há inspeção profunda de pacotes, e os nomes de aplicações do Cisco NBAR não são lidos.
- **A API do painel do Meraki.** As análises de tráfego do Meraki não são importadas; os appliances MX e Z enviam NetFlow para a sonda em vez disso.
- **Detecção de anomalias** no tráfego.
- **Nomes de interfaces a partir dos registros de fluxo.** Os nomes e velocidades das interfaces vêm da varredura SNMP do dispositivo; um dispositivo que não é varrido mostra números de interface.

## Solução de problemas

Se a página de Tráfego ainda mostra os passos de configuração:

- **A sonda está recebendo alguma coisa?** A página de Tráfego da rede lista em **Emissores de fluxos** cada endereço que enviou fluxos na última hora. Se o dispositivo estiver lá como **Ainda não é um dispositivo**, ele envia de um endereço que não é o nome do host dele: adicione esse endereço aos **Outros endereços** dele.
- **Firewalls e Docker.** Permita UDP 2055, 4739 e 6343 do dispositivo para a sonda, e publique as portas se a sonda rodar no Docker.
- **O log da sonda.** Uma vez por minuto a sonda registra o que não conseguiu ler: datagramas em um formato não suportado (NetFlow v1, v6, v7 ou v8, ou sFlow anterior à versão 5), datagramas malformados, dados aguardando um modelo e datagramas descartados acima de `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`.
- **Modelos.** NetFlow v9 e IPFIX enviam a estrutura dos seus registros como modelos. A sonda guarda por até 10 minutos os dados que chegam antes do seu modelo; configure o dispositivo para enviar os modelos a cada 60 segundos, para que a página se preencha em até um minuto.
- **Uma sonda global.** Um dispositivo consultado por uma sonda global não consegue enviar fluxos para ela a partir de uma rede privada. Execute uma sonda personalizada na rede do dispositivo e escolha-a nas configurações do dispositivo.
