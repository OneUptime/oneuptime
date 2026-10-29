# Tráfego de rede (NetFlow, IPFIX e sFlow)

Roteadores, firewalls e switches podem descrever o tráfego que passa por eles como **registros de fluxo**: quem falou com quem, por qual protocolo e quais portas, por quais interfaces e com quantos bytes. Aponte essa exportação para uma sonda do OneUptime e as páginas de **Tráfego** mostram para onde vai o seu tráfego: os endereços, conversas, aplicações e interfaces mais ativos, em qualquer intervalo de tempo.

Há uma página de Tráfego em três lugares:

- **Rede** -> **Tráfego**: toda a rede, os fluxos de cada dispositivo em uma página, e cada endereço que envia fluxos sem ainda ser um dispositivo.
- A página de **Tráfego** de um site: os dispositivos desse site.
- A aba **Tráfego** de um dispositivo: esse dispositivo, com suas interfaces. As capturas de pacotes executadas na sonda do dispositivo aparecem abaixo dos fluxos, para quando você precisar dos próprios pacotes.

Um parque Cisco Meraki também pode ser lido sem exportar nada: conecte o painel do Meraki, e as páginas de Tráfego mostram os uplinks, as aplicações e os clientes dos seus appliances como o Meraki os relata. Veja [Cisco Meraki sem NetFlow](#cisco-meraki-sem-netflow).

## O que a página de Tráfego mostra

- Quatro números para o intervalo: **Tráfego** (bytes), a taxa **Média** e de **Pico**, e **Fluxos** (quantos registros de fluxo os dispositivos enviaram).
- **Tráfego ao longo do tempo**, em bits por segundo. Arraste sobre o gráfico para ampliar um trecho; clique duas vezes nele, ou use **Redefinir zoom**, para voltar.
- **Principais origens** e **Principais destinos**: os dez endereços que mais enviaram e mais receberam.
- **Principais aplicações**: o tráfego por protocolo e porta de serviço, com o nome do serviço que costuma estar nessa porta (HTTPS é a porta TCP 443).
- **Principais interfaces** na página de um dispositivo: o que entrou e saiu por cada interface, com o nome e a velocidade da varredura SNMP do dispositivo. **Principais dispositivos** na página de um site e na da rede.
- **Principais conversas**: os dez pares de endereços mais ativos, desenhados como um diagrama dos emissores para os receptores, ou como uma lista.

Clique em qualquer linha - um endereço, uma aplicação, uma interface, um dispositivo, uma faixa do diagrama - e a página inteira se restringe a esse tráfego. Uma etiqueta acima da página diz a que ela está restrita; clique no x para ampliá-la de novo. **Encontrar um nome ou um endereço IP** restringe a página ao tráfego para ou de um endereço: digite o endereço, ou parte do nome dele, e escolha-o se vários corresponderem. O intervalo de tempo e os filtros ficam no endereço da página, então um link abre exatamente a mesma visualização.

Um endereço que o OneUptime conhece aparece pelo nome, com o endereço ao lado. Veja [Nomes no lugar de endereços](#nomes-no-lugar-de-endereços).

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

Esses 6.000 datagramas por minuto são compartilhados por todos os dispositivos que exportam para a sonda. Com centenas de dispositivos, aumente `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` ou distribua os dispositivos entre várias sondas: os datagramas acima do limite são descartados, e o log da sonda diz quantos (veja [Solução de problemas](#solução-de-problemas)). Um parque Meraki não precisa de nenhuma exportação: veja [Cisco Meraki sem NetFlow](#cisco-meraki-sem-netflow).

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

Para ler cada site sem configurar cada MX, conecte o painel do Meraki em vez disso: veja [Cisco Meraki sem NetFlow](#cisco-meraki-sem-netflow). O tráfego dele não tem conversas, então os dois se complementam bem.

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

## Cisco Meraki sem NetFlow

Um parque Meraki tem um segundo caminho, sem nada para configurar nos dispositivos e sem sonda no meio: o OneUptime lê o tráfego da organização pela API do painel do Meraki. Ele serve para centenas ou milhares de sites, onde configurar NetFlow em cada MX é a parte difícil.

Em **Rede** -> **Tráfego**, escolha **Conectar o Meraki**:

1. **Chave de API.** Crie uma no painel do Meraki em **Organization** > **API & Webhooks** > **API keys and access**. A chave de um administrador somente leitura basta. O OneUptime a guarda criptografada, nunca mais a mostra e só a envia para a API do painel do Meraki da região da chave. Se você entra no Meraki por outro endereço que não dashboard.meraki.com, escolha a **Região do painel** em **Mais campos**: o painel do Canadá, da China, da Índia ou o painel FedRAMP dos Estados Unidos.
2. **Organização.** A chave é testada assim que a etapa abre: as organizações que ela pode ler são listadas e, para a que você escolher, o diálogo conta as redes e os appliances MX e Z que uma leitura vai cobrir, antes de qualquer coisa ser salva.

A primeira leitura começa em até um minuto e traz o último dia. A partir daí, as páginas de Tráfego têm um seletor **Flows** | **Meraki** no cabeçalho: uma página com registros de fluxo abre neles, como antes, e uma página só com tráfego do Meraki abre no Meraki.

| Na página | O que o Meraki relata | Com que frequência é lido |
| --- | --- | --- |
| Os quatro números, o gráfico, **Principais redes** e **Uplinks** | O uso dos uplinks de cada appliance MX e Z (wan1, wan2, cellular), para toda a organização em uma única chamada | A cada 5 minutos por padrão, até a cada hora, em janelas de cinco minutos |
| **Principais aplicações** e **Principais destinos** | As análises de tráfego de cada rede | A cada duas horas: o Meraki as soma em duas horas ou mais |
| **Principais clientes** | Os clientes de cada rede e o que usaram | A cada duas horas, com as aplicações |

Um clique em uma rede restringe a página a ela e lista os seus uplinks. O tráfego de um appliance pertence ao dispositivo dele no OneUptime quando um dispositivo tem o número de série ou o endereço MAC do appliance: aí ele também aparece nas páginas de Tráfego desse dispositivo e do seu site. O tráfego de um appliance que não é um dispositivo no OneUptime aparece na página da rede.

Cada leitura também lista os dispositivos da organização. Um dispositivo Meraki que é um dispositivo de rede no OneUptime obtém do painel o que a sua própria consulta deixa vazio: o número de série, o modelo, o firmware, o endereço MAC e o resto ([Atributos de ativo dos dispositivos de rede](/docs/inventory/cmdb-sync#atributos-de-ativo-dos-dispositivos-de-rede)). A linha da conexão os conta, e o cartão **Inventário** do dispositivo diz, em uma linha própria, quando o Meraki foi lido.

O Meraki dá a cada organização 10 requisições de API por segundo, compartilhadas por todas as aplicações que a leem. O OneUptime usa no máximo 3, desacelera quando o Meraki pede e encerra uma leitura após 900 requisições ou 6 minutos; a próxima continua um minuto depois. Uma organização de 1.200 redes tem os seus uplinks lidos com uma chamada por janela, e as aplicações e os clientes das suas redes ao longo de algumas leituras.

As conexões aparecem no fim da página de Tráfego da rede, em **Meraki**, cada uma com o seu estado e o que a última leitura cobriu. Cada uma tem um botão para o próximo passo: **Ler agora** a lê na hora, **Ativar** a reativa quando está desativada, e **Atualizar a chave de API** substitui uma chave que o Meraki recusou, testando a nova chave antes de salvá-la. O menu dela tem **Editar** (o nome, com que frequência ler os uplinks, uma nova chave), **Desativar** e **Excluir**. Uma leitura que falha diz por quê, ali e acima do tráfego: uma chave recusada, uma chave que não consegue ler a organização, o Meraki pedindo ao OneUptime que desacelere, ou redes com a análise de tráfego desligada. Acima do tráfego, **Revisar** leva à conexão. Só os proprietários e os administradores do projeto podem conectar o Meraki e alterar ou ler uma conexão.

A API do painel do Meraki relata totais, nunca quem falou com quem, então o lado do Meraki não tem conversas. Para vê-las, envie também NetFlow dos appliances MX ([Cisco Meraki MX e Z](#cisco-meraki-mx-e-z)): a página passa a ter os dois, a um seletor de distância.

## Endereços que ainda não são dispositivos

Os fluxos podem chegar antes de o dispositivo que os envia ser adicionado ao OneUptime. Na sua própria sonda eles são guardados, e a página de Tráfego da rede lista o endereço deles em **Emissores de fluxos**, marcado como **Ainda não é um dispositivo**:

- **Adicionar como dispositivo** abre Adicionar dispositivo com o endereço e a sonda já preenchidos. Os fluxos que já chegaram ficam na página da rede; os novos vão para o dispositivo.
- **É um dos meus dispositivos** adiciona o endereço aos **Outros endereços** de um dispositivo: use quando um dispositivo que você já adicionou envia de outro endereço, como uma loopback. Os fluxos dele vão para esse dispositivo a partir do próximo minuto.

Vários dispositivos atrás de um mesmo endereço NAT compartilham esse endereço, então os fluxos deles vão para o único dispositivo que o tem.

## Nomes no lugar de endereços

Onde quer que uma página de Tráfego liste um endereço - as listas principais, as duas visualizações de **Principais conversas**, as etiquetas, **Encontrar** -, ela mostra primeiro o nome do endereço quando o OneUptime conhece um, com o endereço ao lado: `mumbai-fs01` acima de `10.18.167.35`. Um endereço que nada nomeia aparece como ele mesmo. Sob o ponteiro, um nome cortado aparece inteiro.

Um nome vem da primeira destas fontes que nomeia o endereço:

| Ordem | De onde vem o nome | O que nomeia o endereço |
| ----- | ------------------ | ----------------------- |
| 1 | **Nomes de endereço** | Um nome que alguém deu a este endereço em **Rede** -> **Configurações** -> **Nomes de endereço** |
| 2 | Dispositivos de rede | Um dispositivo consultado no endereço, ou que o lista em **Outros endereços** |
| 3 | Hosts | Um host cujo agente informa o endereço |
| 4 | Recursos de nuvem | Um recurso de nuvem para o qual sua conta de nuvem lista o endereço |
| 5 | Kubernetes | Um nó que tem o endereço, depois um pod (um pod na rede do próprio nó tem o endereço do nó) |
| 6 | DNS | O nome DNS reverso do endereço, consultado pela sonda que recebeu os fluxos |

Um registro só nomeia o tráfego de uma época em que existia: um host visto pela primeira vez depois do intervalo, ou um pod que sumiu antes dele, não nomeia o tráfego desse intervalo. Um nome que alguém deu a uma sub-rede - `10.18.167.0/24` é “Escritório de Mumbai” - aparece ao lado de cada endereço dela, nunca no lugar do nome do próprio endereço; onde sub-redes com nome se sobrepõem, aparece a mais estreita.

### Um endereço

Clique em um endereço, ou encontre-o, e a página se restringe a ele, com um cartão acima dos números que diz quem ele é: o nome, de onde vem o nome, o endereço com um botão para copiá-lo e a sub-rede com nome em que ele está. O cartão oferece o próximo passo:

- **Abrir o host**, **Abrir o dispositivo** ou **Abrir o recurso de nuvem**, quando o nome é desse registro. Mude o nome lá.
- **Dar nome a este endereço**, quando nada o nomeia ou só o DNS. O endereço já vem preenchido; amplie-o para uma sub-rede, como `10.18.167.0/24`, para nomear a sub-rede inteira.
- **Editar nas configurações**, quando o nome é um nome de endereço. Abre **Nomes de endereço**, onde o nome é alterado.

**Dar nome a este endereço** é para quem pode adicionar dispositivos de rede, e **Editar nas configurações**, para quem pode alterá-los. Todos que podem lê-los veem os nomes.

### Nomes de endereço

**Rede** -> **Configurações** -> **Nomes de endereço** lista os nomes que as pessoas deram a endereços e sub-redes que nada mais nomeia: o gateway VPN de um parceiro, um endpoint SaaS, o Wi-Fi de visitantes. **Criar: Nome de endereço** pede o nome e um endereço IP (`10.0.0.5`, `2001:db8::5`) ou uma sub-rede (`10.18.167.0/24`). Uma sub-rede é guardada como o primeiro endereço e o comprimento, então `10.18.167.35/24` é salva como `10.18.167.0/24`. Cada endereço ou sub-rede tem um só nome.

### Nomes DNS vindos da sonda

Os nomes DNS são consultados pela sonda que recebeu os fluxos, no resolvedor que o host dela usa: dentro da sua rede, onde os endereços privados têm nomes. A sonda só guarda um nome quando os próprios registros A ou AAAA do nome apontam de volta para o endereço; assim, um registro reverso antigo ou forjado não nomeia nada, e um nome do arquivo hosts do host da sonda é usado como está. Ela envia os nomes com os fluxos, e eles são guardados com os fluxos: um intervalo mostra os nomes que os endereços dele tinham na época.

As consultas nunca seguram os fluxos. Os endereços mais ativos são consultados primeiro, no máximo 300 por minuto e oito de cada vez; um nome é guardado por uma hora, um endereço sem nome por 30 minutos, e uma consulta que falhou é repetida após 5 minutos. Endereços de loopback, link-local, multicast e broadcast nunca são consultados. As sondas globais de um OneUptime hospedado, compartilhadas por todas as contas, consultam só endereços públicos; suas próprias sondas, e as da sua própria instalação do OneUptime, consultam também os privados.

| Variável                            | O que faz                                                           | Padrão  |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_FLOW_NAME_LOOKUP_ENABLED      | Defina como `false` para parar de consultar no DNS os endereços dos fluxos | true |
| PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE  | Endereços consultados por minuto; `0` para as consultas             | 300     |
| PROBE_FLOW_NAME_DNS_SERVERS         | Servidores DNS a consultar no lugar do resolvedor do host, como `10.0.0.53, 10.0.0.54:5353` | nenhum |

## Como ler os números

- **Amostragem.** Um dispositivo que amostra - o sFlow sempre amostra, e NetFlow ou IPFIX podem amostrar - informa um pacote a cada N. A sonda multiplica as contagens por N, então a página mostra estimativas, e diz isso abaixo dos quatro números. Elas são precisas para muito tráfego e aproximadas para poucos pacotes.
- **Contado duas vezes.** O tráfego que passa por dois dispositivos exportadores é informado por ambos. A página de um dispositivo o conta uma vez; a página de um site ou da rede o conta uma vez por dispositivo que o informou.
- **Aplicações.** Uma aplicação é o protocolo e a porta de serviço, com o nome do serviço que costuma estar nessa porta. Não é uma inspeção profunda de pacotes: HTTPS na porta 9443 aparece como porta TCP 9443. A porta efêmera do cliente fica de fora, então mil conexões de navegador para um servidor são uma única aplicação.
- **Pico** é a taxa da fatia mais ativa do gráfico, então um intervalo mais curto, com fatias mais curtas, mostra um pico mais acentuado. **Média** são os bytes no intervalo inteiro.
- **Tempo.** Um fluxo conta na fatia em que começou. Um download longo é informado como vários fluxos, um para cada minuto que dura; por isso o tempo limite ativo dos dispositivos deve ser de 60 segundos.

## O que não está incluído

- **Alertas sobre fluxos.** Ainda não há um monitor baseado em fluxos. Para alertar sobre um link sobrecarregado, use os alertas de utilização de interface do [monitor de dispositivos de rede](/docs/monitor/network-device-monitor), que leem SNMP.
- **Nomes de aplicações além da porta.** Não há inspeção profunda de pacotes, e os nomes de aplicações do Cisco NBAR não são lidos.
- **Conversas pela API do painel do Meraki.** Ela relata totais, não quem falou com quem: envie também NetFlow dos appliances MX para ver as conversas.
- **Detecção de anomalias** no tráfego.
- **Nomes de interfaces a partir dos registros de fluxo.** Os nomes e velocidades das interfaces vêm da varredura SNMP do dispositivo; um dispositivo que não é varrido mostra números de interface.

## Solução de problemas

Se a página de Tráfego ainda mostra os passos de configuração:

- **A sonda está recebendo alguma coisa?** A página de Tráfego da rede lista em **Emissores de fluxos** cada endereço que enviou fluxos na última hora. Se o dispositivo estiver lá como **Ainda não é um dispositivo**, ele envia de um endereço que não é o nome do host dele: adicione esse endereço aos **Outros endereços** dele.
- **Firewalls e Docker.** Permita UDP 2055, 4739 e 6343 do dispositivo para a sonda, e publique as portas se a sonda rodar no Docker.
- **O log da sonda.** Uma vez por minuto a sonda registra o que não conseguiu ler: datagramas em um formato não suportado (NetFlow v1, v6, v7 ou v8, ou sFlow anterior à versão 5), datagramas malformados, dados aguardando um modelo e datagramas descartados acima de `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`.
- **Modelos.** NetFlow v9 e IPFIX enviam a estrutura dos seus registros como modelos. A sonda guarda por até 10 minutos os dados que chegam antes do seu modelo; configure o dispositivo para enviar os modelos a cada 60 segundos, para que a página se preencha em até um minuto.
- **Uma sonda global.** Um dispositivo consultado por uma sonda global não consegue enviar fluxos para ela a partir de uma rede privada. Execute uma sonda personalizada na rede do dispositivo e escolha-a nas configurações do dispositivo.

Se um endereço não mostra nenhum nome:

- **Dê um nome a ele.** Clique no endereço e depois em **Dar nome a este endereço** no cartão acima dos números.
- **Os nomes DNS dele.** O registro A ou AAAA do próprio nome precisa apontar de volta para o endereço; um registro reverso sozinho não basta. Um nome adicionado ao DNS nomeia os fluxos que chegam depois dele.
- **O resolvedor da sonda.** Se o host da sonda não enxerga seu DNS interno, defina `PROBE_FLOW_NAME_DNS_SERVERS` com um servidor DNS que tenha suas zonas reversas.

Se uma conexão do Meraki diz que não consegue ler:

- **A chave é recusada.** Copie-a de novo do painel do Meraki e confira a **Região do painel**: uma chave só lê o painel em que foi criada. Cole a nova chave com **Atualizar a chave de API** na conexão.
- **A chave não consegue ler a organização.** Ative o acesso à API da organização em **Organization** > **API & Webhooks**, ou use a chave de um dos seus administradores.
- **Nenhuma aplicação em algumas redes.** A análise de tráfego delas está desligada: ligue-a em **Network-wide** > **General** > **Traffic analysis**.
- **O Meraki pediu ao OneUptime que desacelerasse.** Outras aplicações estão usando o orçamento de API da organização. O OneUptime lê mais devagar e continua.
- **Este OneUptime não alcança a API.** Permita HTTPS (porta 443) dos servidores do OneUptime para `api.meraki.com`, ou o host de API da sua região.
