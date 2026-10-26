# Inteligência de ameaças (STIX/TAXII)

Um feed de inteligência de ameaças traz para o OneUptime endereços IP, domínios, URLs, endereços de e-mail e hashes de arquivos maliciosos conhecidos, e avisa você quando os seus [eventos de segurança](/docs/telemetry/security-events) mencionam um deles. Um feed lê uma origem: uma lista de indicadores em um endereço https, como as listas gratuitas que o OneUptime adiciona com um clique, uma coleção TAXII 2.1 de indicadores STIX 2.1 do seu próprio servidor MISP, OpenCTI ou OpenTAXII ou de um fornecedor, ou os indicadores que o Google SecOps encontrou nos seus eventos.

:::cards
- [Adicione uma lista gratuita](#adicione-uma-lista-gratuita): Feodo Tracker, Emerging Threats e os nós de saída do Tor, com um clique.
- [Assine um feed](#assine-um-feed): O endereço de uma lista, uma coleção TAXII ou uma conexão do Google SecOps.
- [O que é ingerido](#o-que-é-ingerido): Os padrões de indicador que o OneUptime guarda, e por quanto tempo.
- [Como as correspondências são encontradas](#como-as-correspondências-são-encontradas): Marcadas na chegada dos eventos e comparadas a cada minuto.
- [Níveis de ameaça](#níveis-de-ameaça): Como a confiança de um indicador vira uma gravidade.
:::

## Como funciona

```mermaid title="De um feed a um alerta"
flowchart TB
    taxii["Uma lista, uma<br/>coleção TAXII<br/>ou Google SecOps"] -->|"Lidos no<br/>intervalo do feed"| indicators["Indicadores: IPs,<br/>domínios, URLs,<br/>e-mails, hashes"]
    events["Novos eventos<br/>de segurança"] --> tag["Marcados na chegada<br/>com atributos<br/>threat.*"]
    indicators --> tag
    indicators --> match["Comparados a cada<br/>minuto com os<br/>eventos recentes"]
    match --> act["Um caso, um alerta,<br/>um incidente opcional<br/>e um achado"]
```

## Antes de começar

- Para uma lista, um endereço `https` que baixe um arquivo de texto com um indicador por linha.
- Para um feed TAXII, um servidor TAXII 2.1 que publique objetos STIX 2.1 do tipo `indicator`, e o ID da coleção a consultar. Um feed TAXII faz login de forma anônima, com um token bearer ou com autenticação HTTP básica.
- Para um feed do Google SecOps, uma [conexão do Google SecOps](/docs/integrations/google-secops#configurar-o-conector-gerenciado) cuja conta de serviço possa pesquisar correspondências de indicadores: o papel `roles/chronicle.viewer` pode.
- Servidores que exigem um certificado de cliente TLS (TLS mútuo), como o CISA AIS, não são suportados. O servidor ATT&CK público da MITRE publica técnicas e grupos em vez de indicadores, então um feed apontado para ele fica vazio.
- Um papel que possa criar feeds: Project Owner, Project Admin, Security Admin ou Security Member. Security Viewer pode ler feeds e indicadores. Veja [Papéis](/docs/permissions/reference#funções).

## Adicione uma lista gratuita

O cartão **Listas gratuitas** em **Inteligência de ameaças** adiciona uma lista de bloqueio gratuita com um clique: clique em **Adicionar lista** em uma lista, e o OneUptime cria um feed que a baixa no cronograma da lista. Uma lista que o projeto já lê mostra **Adicionado**.

| Lista | Publicada por | Leitura | Confiança | Uma correspondência abre |
| --- | --- | --- | --- | --- |
| Servidores C2 de botnets do Feodo Tracker | abuse.ch | A cada hora | 90, Critical | Um caso e um alerta |
| Hosts comprometidos do Emerging Threats | Proofpoint Emerging Threats | Todo dia | 70, High | Um caso e um alerta |
| Nós de saída do Tor | The Tor Project | A cada hora | 30, Low | Um caso |

O bloco de cada lista leva aos seus termos: o Feodo Tracker é livre para qualquer uso (CC0), e a lista do Emerging Threats tem licença BSD. Um feed adicionado de uma lista é editado e excluído como qualquer outro.

## Assine um feed

:::steps
### Abra Threat Intel

Abra **Produtos → Security Events → Detecções → Inteligência de ameaças**.

### Crie o feed

Clique em **Criar: Feed de inteligência de ameaças** e escolha a **Origem** dele: **Lista de indicadores**, **Coleção TAXII** ou **Google SecOps**. A etapa seguinte pede só essa origem: a **URL da lista** de uma lista, o **Servidor TAXII** e o **Login** de uma coleção, ou a **Conexão do Google SecOps**. **Ao corresponder** vem por último. Os campos estão na tabela abaixo.

### Confira a primeira consulta

Em um ou dois minutos, a linha do feed mostra **Última consulta**, e **Resumo da última consulta** diz o que a consulta trouxe. Os indicadores aparecem na tabela **Indicadores**, abaixo dos feeds.
:::

| Campo | O que informar |
| --- | --- |
| **Origem** | De onde vêm os indicadores. É definida quando o feed é criado: um feed de outra origem é um feed novo. |
| **URL da lista** | Para uma lista: o endereço `https` de um arquivo de texto com um endereço IP, domínio, URL ou hash de arquivo por linha. |
| **Confiança** | Para uma lista: o quanto a lista é confiável, de 1 a 100. Cada indicador da lista recebe esse valor, e ele define o [nível de ameaça](#níveis-de-ameaça); vazio é Medium. |
| **Conexão do Google SecOps** | Para o Google SecOps: a conexão cuja chave lê os indicadores que o Google SecOps encontrou. **Conectar Google SecOps** abre **Conexões** quando não há nenhuma. |
| **URL raiz da API TAXII** | A raiz da API TAXII 2.1 do servidor, como `https://taxii.example.com/api1/`. As coleções ficam endereçadas abaixo dela. |
| **ID da coleção** | A coleção que publica os indicadores. |
| **Intervalo de consulta (minutos)** | Com que frequência ler a origem: de 1 a 1440 minutos, 60 por padrão. Uma lista é lida no máximo a cada 15 minutos. |
| **Confiança mínima** | Para uma coleção TAXII ou o Google SecOps: os indicadores com uma confiança menor são ignorados, de 0 a 100, e 0 guarda tudo. Indicadores sem confiança sempre passam. |
| **Login** | Como o OneUptime faz login: **Sem login** para uma coleção pública, **Token bearer** para um token do operador do servidor, ou **Usuário e senha** para autenticação HTTP básica. |
| **Token de API**, **Usuário de Basic Auth** e **Senha de Basic Auth** | Pedidos só para o login escolhido. |
| **Abrir um caso ao corresponder** | Ativado por padrão: cada evento que cita um indicador abre um [caso](/docs/telemetry/security-cases) sobre ele, ou entra no caso aberto que já trata dele. |
| **Alertas e incidentes** | **Criar um alerta** por padrão: cada indicador correspondente abre um alerta. |
| **Severidade do alerta** | A severidade de cada alerta que este feed abre. Deixe vazio para usar o nível de ameaça de cada indicador. |
| **Declarar um incidente** ou **Ambos** | Em **Alertas e incidentes**. Os incidentes acionam o escalonamento de plantão, os SLAs e as páginas de status, e para correspondências de indicadores os alertas costumam bastar. |
| **Severidade do incidente** | Como **Severidade do alerta**, para incidentes. |
| **Gravar Detection Finding ao corresponder** | Ativado por padrão: cada correspondência grava um achado no fluxo de eventos. |

Os tokens e as senhas de um feed TAXII são criptografados e nunca mais são exibidos depois de salvos. Para trocá-los, escolha **Atualizar credenciais** na linha do feed e depois **Token bearer**, **Usuário e senha** ou **Sem login**, que apaga o que está salvo: a sua escolha substitui o login do feed, então salvar um token apaga uma senha salva, e vice-versa.

### Como um feed é consultado

Cada consulta pede os objetos adicionados desde a anterior, pelo cursor TAXII `added_after`, e lê até 10 páginas de 500 objetos. Uma coleção grande, portanto, sincroniza ao longo de várias consultas: **Resumo da última consulta** diz quando ainda há páginas. Para terminar mais cedo uma grande primeira sincronização, diminua o **Intervalo de consulta (minutos)**, até 1, até ela se atualizar.

As consultas se identificam com o user agent `OneUptime/<version> (+https://oneuptime.com)`. Se o firewall do fornecedor responder `403`, peça a ele que o permita: muitos firewalls bloqueiam requisições que parecem um script sem nome.

Um feed desativado não é consultado nem comparado. Os indicadores que ele já tem continuam marcando eventos novos até expirarem.

### Como uma lista é lida

- Cada consulta baixa a lista inteira e a lê uma linha por vez: o primeiro valor de uma linha, até um espaço, tabulação, vírgula ou ponto e vírgula. Linhas que começam com `#`, `;` ou `//` são comentários, a porta depois de um endereço ou domínio é descartada, e um intervalo de endereços como `198.51.100.0/24` é ignorado.
- Um valor continua sendo um indicador ativo por 2 dias depois da consulta que o leu por último, e um valor que a lista remove deixa de corresponder na consulta seguinte. Uma lista que não mudou é gravada de novo uma vez por dia.
- Uma lista tem no máximo 50.000 indicadores. **Resumo da última consulta** diz quantos foram lidos, quantas linhas foram ignoradas e quantos ficaram de fora.
- O endereço precisa usar `https` e segue as mesmas regras de saída de uma conexão: no OneUptime Cloud, um endereço privado é recusado.

### Como o Google SecOps é lido

- Cada consulta lê as correspondências de indicadores que o Google SecOps registrou desde a consulta anterior, com os atributos da Mandiant: o domínio, endereço ou hash de arquivo correspondente, a confiança, a categoria e as campanhas e os atores a que ele está ligado. A primeira consulta lê os últimos 7 dias.
- Um indicador fica ativo por 30 dias depois que o Google SecOps o viu pela última vez, ou até a origem dele dizer que deixou de estar ativo, e um que um analista silenciou no Google SecOps deixa de corresponder aqui também.
- Uma correspondência que o Google SecOps marca como violação ativa é Critical, e uma de alta prioridade é no mínimo High.

## O que é ingerido

De uma coleção TAXII, o OneUptime guarda os objetos STIX do tipo `indicator` cujo padrão é uma igualdade simples sobre um destes tipos. Uma lista e o Google SecOps dão os mesmos tipos:

| Tipo | Padrão de exemplo |
| --- | --- |
| Endereço IPv4 (`ipv4-addr`) | `[ipv4-addr:value = '198.51.100.7']` |
| Endereço IPv6 (`ipv6-addr`) | `[ipv6-addr:value = '2001:db8::7']` |
| Nome de domínio (`domain-name`) | `[domain-name:value = 'evil.example']` |
| URL (`url`) | `[url:value = 'http://evil.example/payload']` |
| Endereço de e-mail (`email-addr`) | `[email-addr:value = 'billing@evil.example']` |
| Hash de arquivo, SHA-256 (`file-hash-sha256`) | `[file:hashes.'SHA-256' = 'e3b0…b855']` |
| Hash de arquivo, SHA-1 (`file-hash-sha1`) | `[file:hashes.'SHA-1' = 'da39…0709']` |
| Hash de arquivo, MD5 (`file-hash-md5`) | `[file:hashes.MD5 = 'd41d…427e']` |

Comparações unidas com `OR`, dentro de um `[...]` ou entre vários, servem, e cada valor vira um indicador próprio:

```text
[domain-name:value = 'evil.example' OR domain-name:value = 'evil2.example']
[ipv4-addr:value = '198.51.100.7'] OR [url:value = 'http://evil.example/x']
```

Qualquer outro padrão, com `AND`, `FOLLOWEDBY`, `NOT`, `LIKE`, `MATCHES`, um qualificador de tempo como `WITHIN` ou outro tipo de objeto, é ignorado por inteiro e contado como não suportado em **Resumo da última consulta**. Traduzir só uma parte de um padrão `AND` corresponderia a muito mais do que o autor do feed pretendia.

### Por quanto tempo um indicador fica ativo

- Um indicador corresponde do seu `valid_from` até o seu `valid_until`. Sem `valid_until`, ele fica ativo por 365 dias a partir de `valid_from`, e consultá-lo de novo não estende isso.
- Um indicador revogado, ou atualizado com um `valid_until` no passado, deixa de corresponder assim que a atualização é consultada. O mesmo vale para um valor que o fornecedor tira de um padrão atualizado.
- Os valores são guardados em minúsculas e comparados sem diferenciar maiúsculas.

A tabela **Indicadores** lista os indicadores como estão guardados, com um **Status** de **Ativo**, **Expirado** ou **Revogado**. Um indicador consultado de novo pode aparecer duas vezes por um tempo, e uma linha expirada ou revogada continua listada até a limpeza do armazenamento removê-la, até cerca de um mês depois de expirar. A comparação sempre verifica validade e revogação, então uma linha assim nunca corresponde.

## Como as correspondências são encontradas

### Marcados na chegada

Cada evento de segurança que chega, pela API de ingestão ou por uma conexão, é comparado com os seus indicadores ativos antes de ser salvo. Quando um dos observables dele (os IPs, hosts, domínios, hashes e usuários extraídos do evento) é igual ao valor de um indicador, o evento recebe estes atributos:

| Atributo | Valor |
| --- | --- |
| `threat.matched` | Sempre `"true"` em um evento marcado |
| `threat.indicator_id` | O ID do indicador STIX, ou `list` ou `google-secops` para essas origens |
| `threat.indicator_type` | O tipo do indicador, como `ipv4-addr` ou `file-hash-sha256` |
| `threat.indicator_value` | O valor correspondente, em minúsculas |
| `threat.feed` / `threat.feed_id` | O feed de onde veio o indicador |
| `threat.confidence` | A confiança STIX do indicador |
| `threat.match_count` | Quantos observables do evento corresponderam a um indicador |

Quando vários indicadores correspondem a um evento, o de maior confiança preenche esses valores. Eles são atributos comuns, então você pode pesquisá-los em **Eventos**, filtrar com eles os monitores de eventos de segurança e usá-los em regras de detecção:

```yaml title="threat-intel-logon.yml"
title: High-confidence indicator in a successful logon
level: critical
detection:
  selection:
    threat.matched: 'true'
    threat.confidence|gte: 80
    className: Authentication
    statusName: Success
  condition: selection
```

A marcação só conhece os indicadores que existem quando um evento chega: os eventos nunca são marcados de novo depois.

### Comparados a cada minuto

A cada minuto, os indicadores ativos de cada feed habilitado são comparados com os eventos cujo horário do evento cai desde a verificação anterior do feed. Isso pega a inteligência que chegou depois que um evento foi marcado.

- A primeira verificação cobre os últimos 15 minutos. Depois de uma queda, a próxima verificação recupera no máximo as últimas 24 horas.
- Cada janela é verificada uma vez. A inteligência que chega depois que a janela dela foi verificada só vale para eventos posteriores.
- Um evento que chega atrasado, com um horário anterior à verificação anterior, ainda é marcado na chegada, mas não é comparado.
- Cada verificação registra cada valor de indicador correspondente como um Detection Finding, até 10.000 por feed. Alertas, incidentes e casos abrem para os 100 valores vistos no maior número de eventos; o restante compartilha um caso sobre o feed, e o **Último erro de correspondência** do feed diz quantos corresponderam.

### O que uma correspondência faz

- Um alerta, com o título `[Threat Intel] <feed name> — <indicator value>`, um por feed e valor enquanto estiver aberto. Depois de resolvido, a próxima correspondência abre um novo. Os alertas não são resolvidos automaticamente.
- Um incidente, só com **Declarar um incidente** ou **Ambos** em **Alertas e incidentes**, deduplicado da mesma forma.
- Um achado de inteligência de ameaças, com **Gravar Detection Finding ao corresponder**: um evento `Detection Finding` (classe OCSF 2004) do produto `OneUptime Threat Intel`, com o nível de ameaça do indicador como gravidade e estes atributos:

| Atributo | Valor |
| --- | --- |
| `oneuptime.threat.feed_id` / `oneuptime.threat.feed_name` | O feed |
| `oneuptime.threat.indicator_id` | O ID do indicador STIX, ou `list` ou `google-secops` para essas origens |
| `oneuptime.threat.indicator_type` / `oneuptime.threat.indicator_value` | O que correspondeu |
| `oneuptime.threat.confidence` | A confiança do indicador |
| `oneuptime.threat.match_count` | Quantos eventos estão por trás deste achado |

Os próprios achados nunca são comparados, então uma correspondência não pode disparar outra.

## Níveis de ameaça

Os indicadores não têm nível Sigma: a `confidence` STIX deles define um nível de ameaça.

| Confiança do indicador | Nível de ameaça |
| --- | --- |
| De 90 a 100 | Critical |
| De 70 a 89 | High |
| De 40 a 69 | Medium |
| De 1 a 39 | Low |
| Sem pontuação (0 ou ausente) | Medium |

Um indicador sem pontuação conta como Medium: alguém ainda assim escolheu colocá-lo em um feed. O nível de ameaça é a gravidade do achado, e escolhe a severidade do alerta entre as severidades do seu projeto, nesta ordem:

1. A **Severidade do alerta** (ou **Severidade do incidente**) do feed, quando definida: ela vale para cada correspondência do feed.
2. A sua severidade com o nome do nível de ameaça, como High, sem diferenciar maiúsculas.
3. Por posição: Critical e High recebem a sua severidade mais alta, Medium e Low a mais baixa.

O nível de ameaça pertence a cada indicador, não ao feed, então um mesmo feed pode abrir um alerta Critical e um Low no mesmo minuto. **Confiança mínima** filtra pelo mesmo número: um mínimo de 70 guarda só os indicadores High e Critical, mais os sem pontuação, que sempre passam.

## Vigie as correspondências de um feed

A ação **Criar monitor** na linha de um feed abre um novo monitor de eventos de segurança que conta os achados do feed: classe de evento `Detection Finding`, filtrada pelo ID do feed em `oneuptime.threat.feed_id` (nunca pelo nome dele, que uma renomeação mudaria), na última hora. Use-o para uma rajada repentina de correspondências, ou para um feed normalmente movimentado que fica em silêncio.

## Retenção e cobrança

Os indicadores são configuração, não telemetria, e não são cobrados como dados ingeridos. Os achados que uma correspondência grava são eventos de segurança comuns, cobrados e mantidos como o resto: veja [Eventos de segurança](/docs/telemetry/security-events#retenção-e-cobrança).

## Solução de problemas

:::details Last Error aparece preenchido depois de uma consulta
`401` ou `403`: as credenciais estão erradas ou faltando; substitua-as com **Atualizar credenciais**. Um `403` também pode ser o firewall do fornecedor bloqueando o user agent. `404`: confira a **URL raiz da API TAXII**, que costuma terminar em um caminho como `/api1/`, e o **ID da coleção**. O erro some na próxima consulta bem-sucedida.
:::

:::details O feed é consultado, mas nenhum indicador aparece
Leia **Resumo da última consulta**. Nenhum objeto trazido: a coleção está vazia ou não publica indicadores. Padrões não suportados: o fornecedor usa recursos de padrão que esta página lista como ignorados. Abaixo da confiança mínima: diminua a **Confiança mínima**. Já inativos: o fornecedor enviou indicadores que já estavam revogados ou expirados.
:::

:::details Há indicadores, mas nada corresponde
A comparação confronta o valor de um indicador com os observables de um evento, não com cada campo: abra em **Eventos** um evento que você esperava que correspondesse e confira se os observables dele contêm o valor. Só correspondem os indicadores com o status **Ativo**. Se o **Status** do feed indicar **Falha na comparação**, **Ver erro** na linha dele mostra o motivo.
:::

:::details O Último erro de um feed de lista diz que o endereço respondeu com uma página web
A **URL da lista** abre uma página, como uma página de login ou de erro, e não a lista: abra-a em um navegador e copie o endereço do próprio arquivo. Uma lista cujo texto não tem nenhum endereço IP, domínio, URL ou hash de arquivo é recusada da mesma forma, e os indicadores do feed continuam como estavam.
:::

:::details O Último erro de um feed do Google SecOps diz HTTP 403
A conta de serviço da conexão não pode pesquisar correspondências de indicadores: conceda a ela `roles/chronicle.viewer`. Se a conexão foi excluída, o feed diz isso: edite-o e escolha outra **Conexão do Google SecOps**.
:::

:::details Uma correspondência não abriu um alerta
**Alertas e incidentes** está em **Declarar um incidente** ou **Nenhum**, ou ainda há um alerta aberto para o mesmo feed e valor, e as correspondências seguintes entram nele. Um projeto precisa de pelo menos uma severidade de alerta para que um feed abra alertas.
:::

## Próximos passos

:::cards
- [Eventos de segurança](/docs/telemetry/security-events): Envie eventos, pesquise-os e escreva regras de detecção.
- [Google SecOps](/docs/integrations/google-secops): Traga as detecções e os eventos do Chronicle.
- [Referência de permissões](/docs/permissions/reference): Os papéis de segurança, e o que cada um pode fazer.
:::
