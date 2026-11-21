# Cloudflare

Importe para os eventos de segurança do OneUptime o que o firewall da [Cloudflare](https://www.cloudflare.com) fez na borda: as requisições que as regras WAF gerenciadas e personalizadas, a limitação de taxa, as IP Access Rules, o gerenciamento de bots e a proteção DDoS HTTP dela bloquearam, desafiaram ou registraram. Cada uma fica ao lado das requisições do seu próprio app, então um caso diz o que a Cloudflare parou e o que ainda chegou ao seu app. O OneUptime as lê com um token de API que só pode ler, e não muda nada na Cloudflare a menos que você ative o bloqueio, que aplica ali a sua lista de bloqueio.

:::cards
- [Configurar a conexão](#configurar-a-conexão): Um token de API com duas permissões de leitura, e o formulário da conexão.
- [O que é importado](#o-que-é-importado): Quais eventos, e como cada um vira um evento de segurança.
- [Como a consulta funciona](#como-a-consulta-funciona): A janela que cada consulta lê, e por que ela se sobrepõe em 10 minutos.
- [Bloquear endereços na Cloudflare](#bloquear-endereços-na-cloudflare): Sua lista de bloqueio, aplicada por duas listas de IP e uma regra personalizada por lista.
- [Solução de problemas](#solução-de-problemas): O que cada erro significa e o que mudar.
:::

## Como funciona

```mermaid title="De uma requisição tratada pela Cloudflare a um evento de segurança"
flowchart TB
    edge["O firewall da<br/>Cloudflare trata<br/>uma requisição"] --> poll["O OneUptime consulta<br/>no intervalo<br/>da conexão"]
    poll --> zones["Ele lê os eventos<br/>de firewall de cada<br/>zona desde a<br/>última vez"]
    zones --> event["Cada um é salvo<br/>como evento<br/>HTTP Activity"]
```

A cada minuto, o OneUptime consulta cada conexão habilitada cujo intervalo de consulta já passou. Uma consulta lista as zonas da conta, lê no nó settings da GraphQL Analytics API o que o plano de cada zona permite, e lê os eventos de firewall de cada zona desde a última consulta no conjunto de dados `firewallEventsAdaptive` ([Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)), dos mais antigos aos mais novos. Cada evento é salvo como evento [OCSF](https://schema.ocsf.io/) HTTP Activity.

## Antes de começar

- No OneUptime, a função Proprietário do projeto, Administrador do projeto ou Administrador de segurança. As funções Membro de segurança e Visualizador de segurança veem as conexões e o histórico de execuções delas, mas não podem alterá-las.
- Um usuário da Cloudflare que possa criar tokens de API para as zonas da conta.
- Zonas cujo tráfego passa pela Cloudflare: os registros DNS delas estão em proxy.
- HTTPS de saída do app e dos workers do OneUptime para `api.cloudflare.com`.

## Configurar a conexão

A conexão lê com um [token de API](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), nunca com uma Global API Key: um token é limitado à conta e às zonas dela, e você pode revogá-lo sozinho. Ele precisa de duas [permissões](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), ambas somente leitura:

| Permissão | O que o OneUptime lê com ela |
| --- | --- |
| `Zone > Zone > Read` | As zonas, com suas contas e planos. |
| `Zone > Analytics > Read` | Os eventos de firewall de cada zona, pela GraphQL Analytics API. |

:::steps
### Criar um token de API

1. No painel da Cloudflare, abra **My Profile → API Tokens**, selecione **Create Token** e escolha **Create Custom Token**.
2. Chame-o de `oneuptime-security-events`. Em **Permissions**, adicione `Zone > Zone > Read` e `Zone > Analytics > Read`.
3. Em **Zone Resources**, inclua todas as zonas da conta, ou as zonas a importar.
4. Selecione **Continue to summary**, depois **Create Token**, e copie o token. A Cloudflare o mostra uma única vez.

### Adicionar a conexão no OneUptime

Abra **Produtos → Eventos de segurança → Conexões** (`/dashboard/{projectId}/security-events/connections`), clique em **Adicionar conexão**, escolha **Cloudflare** em **Segurança em nuvem** e clique em **Próximo**. Cole o token em **Token de API**. O OneUptime então lista as contas e zonas que o token pode ler: escolha a **Conta**, e em **Zonas** deixe **Todas as zonas**, ou escolha as zonas a importar.

### Testar antes de salvar

Clique em **Testar estas configurações** em **Testar antes de salvar**. O teste verifica cada permissão com os valores do formulário, nomeia a que falta e não salva nada. Depois clique em **Próximo**, dê à conexão um **Nome** e crie-a.
:::

| Configuração | O que informar |
| --- | --- |
| **Conta** | A conta da Cloudflare a ler, escolhida entre as contas que seu token de API lê. Um token que lê uma única conta a escolhe para você. |
| **Zonas** | Opcional. Vazio lê todas as zonas ativas da conta, incluindo as adicionadas depois. Uma conexão lê no máximo 50 zonas. |
| **Token de API** | Só o token, sem `Bearer`. Ele é criptografado, nunca retornado pela API e nunca mostrado de novo. Substitua-o com **Atualizar credenciais** na conexão. |

A etapa **Consulta periódica** também tem uma **Descrição** opcional, o **Intervalo de consulta (minutos)**, um número inteiro de `1` a `1440` que começa em `5`, e **Habilitado**, que começa ligado. Os eventos da Cloudflare são requisições, não alertas, então o formulário não pergunta **Abrir casos a partir de**: os casos vêm das regras de detecção que os leem.

### O acesso de escrita é uma escolha à parte

Esta conexão não muda nada na Cloudflare até você ativar o bloqueio, na linha dela. Só então o OneUptime pede permissões de escrita, e as verifica antes de bloquear qualquer coisa: [Bloquear endereços na Cloudflare](#bloquear-endereços-na-cloudflare) nomeia cada uma e para que serve. Adicione-as ao token só quando ativar o bloqueio.

## O que é importado

Cada evento tem o fornecedor `Cloudflare` e o produto `Cloudflare WAF`, e é um evento HTTP Activity (`4002`).

| Campo da Cloudflare | No evento de segurança |
| --- | --- |
| `clientIP` | O IP principal, e `client.address` |
| `clientRequestHTTPHost`, `clientRequestPath`, `clientRequestQuery` | O host de destino, o recurso de destino (o caminho e a query), e `url.original` |
| `clientRequestHTTPMethodName`, `userAgent` | A atividade, `http.request.method` e `user_agent.original` |
| `action` | O status, e `oneuptime.edge.action` |
| `source`, `ruleId`, `description` | O ID da regra, o nome da regra, e `cloudflare.source` |
| `rayName`, `clientCountryName`, `clientAsn` | `cloudflare.ray_id`, `cloudflare.client.country` e `cloudflare.client.asn` |
| `sampleInterval` | `oneuptime.edge.sample_interval` |

| O que a Cloudflare fez | Status | `oneuptime.edge.action` | Resultado da requisição | Gravidade |
| --- | --- | --- | --- | --- |
| Bloqueou, fechou a conexão, ou um desafio falhou | Blocked, ou Dropped para uma conexão fechada | `blocked` | Rejected | Low |
| Respondeu com um desafio gerenciado, JS ou interativo | Challenge | `challenged` | Rejected | Low |
| Um desafio aprovado, ou um visitante que já tinha passado em um | Allowed | `passed-challenge` | Nenhum | Informational |
| Registrou e deixou passar | Logged | `logged` | O código de status da origem | Medium; High quando a origem falhou; Low quando ela recusou a requisição |
| Deixou passar por uma regra skip ou allow sua | Allowed | `let-through` | O código de status da origem | Como uma requisição registrada |

Uma requisição que uma das suas próprias regras skip ou allow deixou passar só é importada quando carrega um ataque (injeção de SQL, travessia de diretórios ou uma busca Log4Shell), ou quando o WAF attack score da Cloudflare a considera um. O resto é tráfego que você permite de propósito, como seus monitores: cada execução o conta e o deixa de fora.

A Cloudflare amostra os eventos de uma zona movimentada. Cada evento mantém seu intervalo de amostragem, o número de requisições parecidas que ele representa, e cada contagem que o OneUptime faz com eles diz *cerca de*.

Os eventos aparecem em Eventos, em Campanhas (requisições de ataque por endereço), no risco de entidades e nas regras de detecção. Um caso sobre um endereço mostra, em **Na borda** no impacto dele, o que a Cloudflare fez com as requisições do endereço ao lado do que chegou ao seu app. As regras da Cloudflare da biblioteca os leem como são importados aqui: muitas correspondências de regras gerenciadas de um endereço, um endereço que passou em um desafio e depois enviou ataques, e um ataque que a Cloudflare deixou passar e que chegou ao seu app.

## Limites dos planos

Todo plano tem eventos de firewall pela API. **What each zone's plan gives**, em **Testar conexão**, lê na Cloudflare os limites próprios de cada zona.

| Plano | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Eventos de firewall mantidos | 31 dias | 31 dias | 31 dias | 31 dias |
| Consulta mais longa | 30 dias | 30 dias | 30 dias | 31 dias |

O Logpush da Cloudflare também pode enviar eventos de firewall, em todo plano desde 30 de setembro de 2026, cobrado por uso. Esta conexão consulta em vez disso, então não precisa de nada além das duas permissões de leitura.

## Como a consulta funciona

- **Os eventos são lidos pelo momento em que aconteceram na borda.** Os dados de análise da Cloudflare podem ser consultados um ou dois minutos depois da requisição.
- **A primeira consulta olha 24 horas para trás**, para que uma nova conexão mostre logo os eventos recentes dela.
- **Cada consulta seguinte começa 10 minutos antes do cursor salvo**, então um evento que a Cloudflare torna legível com atraso é lido na consulta seguinte, e as duplicatas são descartadas pelo Ray ID de cada evento dentro do projeto.
- **Uma consulta lê no máximo 24 horas além do cursor.** Uma conexão cujo cursor ficou para trás se atualiza em uma série de janelas de 24 horas.
- **As zonas são lidas em turnos**, uma página de até 2.000 eventos cada, então uma zona movimentada não pode esgotar uma consulta antes que uma tranquila seja lida.
- **Os limites de taxa da Cloudflare são respeitados.** A Cloudflare permite 1.200 requisições REST e 300 consultas GraphQL em cinco minutos. Um `429` que pede para esperar 30 segundos ou menos é aguardado e pedido de novo; um mais longo para a consulta, e a seguinte continua.
- **Uma zona que o token não pode ler não segura nada.** As outras zonas são importadas, a execução é **Parcial**, e o aviso dela nomeia a zona. Dê ao token `Zone > Analytics > Read` lá, depois use **Importar este intervalo de tempo** para recuperar a janela.
- **Uma execução com falha não muda nada.** Depois de um erro de rede, ou de um status de erro da Cloudflare, o cursor e o tamanho da janela ficam como estavam, e a consulta seguinte lê a mesma janela de novo. A única exceção é uma requisição que excedeu o tempo limite: o cursor fica, mas a janela seguinte tem a metade do tamanho, já que uma janela pesada demais para responder a tempo excederia o tempo limite em toda tentativa.

### Quando uma janela contém mais do que uma consulta consegue ler

Uma consulta envia no máximo 120 requisições, lê no máximo 20.000 eventos e para depois de 4 minutos. Os eventos são lidos dos mais antigos aos mais novos, então quando um orçamento para uma consulta, a execução é **Parcial** e a consulta seguinte retoma a partir do evento mais antigo até o qual as zonas não terminadas foram lidas. Quando nem toda zona pôde ser lida uma vez, o OneUptime encurta a janela em vez disso:

1. **Estreitar.** A consulta seguinte lê uma janela com a metade do tamanho, a partir do mesmo ponto inicial, e corta pela metade de novo até que uma janela seja lida por completo, até um minuto. O aviso da execução diz isso: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Eventos já importados da janela mais longa são ignorados como duplicatas.
2. **Voltar a crescer.** Depois que uma janela é lida por inteiro, o cursor vai para o fim dela, e a janela seguinte volta a ter o dobro do tamanho, até 24 horas.
3. **Passar de um único minuto.** Se mesmo um minuto contiver mais do que uma consulta pode ler, a consulta passa dele, para que eventos mais novos continuem chegando. A execução continua **Parcial**, e **Último erro** diz `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importe esse minuto com **Importar este intervalo de tempo** para recuperar o que uma execução consegue ler.

Mudar o **Intervalo de consulta (minutos)** não muda nada disso: ele decide com que frequência uma consulta começa, não onde a janela dela começa.

### Executar, pré-visualizar e importar sob demanda

Clique em **Diagnóstico** em uma conexão para ver as execuções recentes dela e trabalhar com ela manualmente. Quem pode alterar a conexão pode iniciar essas ações; quem pode vê-la pode ler o histórico.

- **Executar agora** inicia uma consulta na hora, com o cursor de sempre, mesmo quando a conexão não está **Habilitado**.
- **Prévia de eventos do firewall** lê um intervalo de tempo de até 7 dias e não importa nada.
- **Importar este intervalo de tempo** importa um intervalo de até 7 dias, depois que você confirma, sem mover o cursor. Eventos já importados são ignorados. A Cloudflare mantém 31 dias de eventos de firewall.
- **Copiar diagnóstico** em uma execução copia o relatório dela para o suporte. Ele nunca inclui credenciais.

## Testar conexão

**Testar conexão** na linha de uma conexão, e **Testar estas configurações** no formulário, rodam no processo da API, não em um worker em segundo plano, para que um teste responda mesmo quando o problema são os workers. Ele faz estas verificações, em ordem:

| Verificação | O que ela verifica |
| --- | --- |
| **Configuração** | O token, a conta e as zonas estão bem formados. Nada é contatado quando isto falha. |
| **Verify the API token** | A Cloudflare aceita o token, de um usuário ou da própria conta, e ele está ativo. Um que expira em até 14 dias é um aviso. |
| **List the zones** | O token tem `Zone > Zone > Read`: ele lista as zonas da conta, e cada zona escolhida. |
| **Read firewall events** | O token tem `Zone > Analytics > Read` em cada zona. Uma falha nomeia as zonas em que ela falta. |
| **What each zone's plan gives** | Por quanto tempo o plano de cada zona mantém os eventos de firewall, e quanto uma consulta pode cobrir. Uma zona cujo plano não tem nenhum é um aviso. |
| **Firewall events available to import** | Cerca de quantos eventos as últimas 24 horas e os últimos 7 dias contêm. Nenhum é um aviso. |
| **Background workers**, **Poll scheduler**, **Security event storage** | O lado do próprio OneUptime: um processo pega os jobs da fila Worker, o job de consulta roda a cada minuto e o armazenamento de eventos de segurança responde. |
| **Consulta agendada** | Para uma conexão salva: a consulta está ativada, nenhuma execução está presa esperando um worker e as consultas rodam no horário. |

Cada requisição de um teste tem um prazo de 20 segundos. Um teste nunca importa nada nem move o cursor, e cada verificação que falha diz o que mudar.

## Bloquear endereços na Cloudflare

Com o bloqueio ativado, a Cloudflare aplica a [lista de bloqueio](/docs/telemetry/security-cases#lista-de-bloqueio) do seu projeto. Cada endereço que você bloqueia entra em menos de um minuto em uma lista de IP da sua conta da Cloudflare, e em cada zona uma regra personalizada por lista bloqueia os endereços que ela contém ou lhes aplica um desafio. Na **Lista de bloqueio**, **Aplicado por** nomeia a Cloudflare para cada bloqueio que o OneUptime leu de volta da Cloudflare; um bloqueio que não é lido de volta em 10 minutos não é aplicado ali.

O bloqueio precisa de permissões de escrita no token de API da conexão:

| Permissão | O que o OneUptime faz com ela |
| --- | --- |
| `Account > Account Filter Lists > Edit` | Cria suas duas listas, e adiciona e remove os endereços delas. |
| `Zone > Zone WAF > Edit`, em cada zona onde bloquear | Adiciona suas regras personalizadas, e lê as da própria zona. |
| `Account > Account Firewall Access Rules > Edit` | Adiciona e remove IP Access Rules, em um plano sem uma lista ou uma regra personalizada sobrando. |

:::steps
### Dar permissões de escrita ao token

Na Cloudflare, abra **My Profile → API Tokens**, edite o token da conexão e adicione as permissões acima. Ou crie um token que as tenha, junto com as duas permissões de leitura.

### Ativar o bloqueio

Na linha da conexão, selecione **Bloquear endereços**. Cole um token novo em **Novo token de API**, ou deixe vazio para manter o atual, e em **Zonas** deixe **Todas as zonas**, ou escolha as zonas onde bloquear. **Verificar permissões** pergunta à Cloudflare se o token tem cada permissão, e não muda nada. **Ativar bloqueio** ativa o bloqueio só quando todas as verificações passam, e o OneUptime configura a Cloudflare em menos de um minuto.
:::

Enquanto o bloqueio está ativado, **Testar conexão** executa as mesmas verificações: **How blocking is set up**, **Edit the lists**, **Edit custom rules in each zone** e, onde IP Access Rules são usadas, **Edit IP Access Rules**.

### O que o OneUptime adiciona à Cloudflare

| Na Cloudflare | O que é |
| --- | --- |
| As listas `oneuptime_block` e `oneuptime_challenge` | Duas listas de IP na conta, uma para bloqueios e outra para desafios. A descrição delas nomeia o seu projeto do OneUptime. |
| Uma regra personalizada por lista, em cada zona | `(ip.src in $oneuptime_block)` com a ação Block, e `(ip.src in $oneuptime_challenge)` com a ação Managed Challenge. A descrição delas diz que o OneUptime as gerencia. |
| Um item de lista por bloqueio | O comentário dele nomeia o caso e quando o bloqueio termina, como `OneUptime case CASE-42 until 2026-11-21 10:42 UTC`. |

Cada regra fica em primeiro lugar entre as regras personalizadas da zona, então roda antes das suas: uma regra Skip sua não consegue deixar passar um endereço bloqueado. Quando suas regras Skip deixam passar endereços, como os dos seus monitores ou de um parceiro, **Estado do bloqueio** os nomeia. **Proteger estes endereços** os adiciona a **Entidades protegidas**, que ninguém pode bloquear.

### Limites do plano para o bloqueio

| Plano | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Listas na conta | 1 | 10 | 10 | 1.000 |
| Itens de lista na conta | 10.000 | 10.000 | 10.000 | 500.000 |
| Regras personalizadas em uma zona | 5 | 20 | 100 | 1.000 |

Suas próprias listas e regras também contam. Quando você ativa o bloqueio, cada ação pega uma lista, e uma regra em cada zona, onde o plano as tem sobrando, Block primeiro; onde não, pega IP Access Rules. Em um plano Free cuja única lista está livre, os bloqueios pegam a lista e os desafios, IP Access Rules. Uma conta comporta 50.000 IP Access Rules, cada uma um endereço, um intervalo IPv4 de /16 ou /24, ou um intervalo IPv6 de /32, /48 ou /64: um bloqueio de outro intervalo não é aplicado ali, e a **Lista de bloqueio** diz por quê. **How blocking is set up** diz o que cada ação pega, e por quê.

### Quando alguém muda uma regra

O OneUptime lê de volta suas listas e regras a cada 3 minutos, e nunca desfaz uma mudança que alguém fez na Cloudflare. Uma regra desativada, excluída ou alterada lá aparece na linha da conexão e em **Estado do bloqueio**, com a zona dela, e a **Lista de bloqueio** mostra os bloqueios da regra dessa zona como não aplicados na Cloudflare. **Restaurar** configura a regra de novo. Enquanto **Zonas** for **Todas as zonas**, uma zona adicionada depois à conta é configurada sozinha.

### Desativar o bloqueio

**Desativar bloqueio** pergunta se deve remover da Cloudflare as listas e regras do OneUptime, com **Remover as listas e regras do OneUptime da Cloudflare** selecionado. A remoção tira as regras do OneUptime, as duas listas dele e as IP Access Rules que ele adicionou, encontradas pelos nomes, referências e notas que ele lhes deu, e nada mais. Se mantidas, ficam na Cloudflare e continuam bloqueando o que contêm. Uma conexão que bloqueia endereços não pode ser excluída: desative o bloqueio primeiro, e exclua-a quando a remoção terminar.

## Solução de problemas

O **Último erro** da conexão guarda a mensagem de erro completa, com as credenciais ocultadas. Quando uma conexão tem um erro, selecione **Ver erro** na coluna **Ações** dela para lê-lo, e **Copiar erro** na caixa de diálogo para copiá-lo. Cada mensagem nomeia a requisição que falhou e cita o motivo dado pela Cloudflare.

:::details O último erro diz `Invalid API Token (1000)`
A Cloudflare não conhece o token: ele foi excluído, renovado ou nunca colado inteiro. Uma Global API Key é recusada antes de ser enviada. Crie um token como acima, e salve-o com **Atualizar credenciais**.
:::

:::details O último erro diz `Unauthorized to access requested resource (9109)`
O token não pode listar as zonas. Dê a ele `Zone > Zone > Read`, com as zonas a importar em **Zone Resources**.
:::

:::details O último erro diz `cannot read the analytics of`
Falta ao token `Zone > Analytics > Read` nas zonas que a mensagem nomeia. Adicione-a lá, depois use **Importar este intervalo de tempo** para recuperar o que não foi importado.
:::

:::details O último erro diz `rate limit`
Outra coisa que usa o mesmo usuário da Cloudflare esgotou a cota dele. A consulta continua sozinha quando os cinco minutos passam; dê ao OneUptime um token de um usuário próprio para manter a cota separada.
:::

:::details Último erro diz `did not complete`
A requisição não teve resposta: um tempo limite, um nome que não resolve ou um endereço recusado. Verifique se o app e os workers do OneUptime conseguem alcançar `api.cloudflare.com`, por qualquer proxy que você use.
:::

:::details Um caso mostra as ações da Cloudflare, mas nenhuma requisição do endereço no seu app
Atrás da Cloudflare, as requisições do seu app vêm dos endereços da Cloudflare, e o endereço do visitante é o último que a Cloudflare acrescenta a `X-Forwarded-For`. Registre esse cabeçalho (`http.request.header.x-forwarded-for`) e o endereço da própria conexão (`network.peer.address`) nos seus traces. Enquanto esta conexão existir, o OneUptime confia nos endereços da Cloudflare como proxy, então lê o visitante no cabeçalho e associa as requisições do seu app ao endereço sobre o qual a Cloudflare agiu. Um `client.address` que o seu app copia de `CF-Connecting-IP` não é considerado confiável: qualquer um que chegue diretamente ao seu app pode enviar esse cabeçalho.
:::

:::details O estado do bloqueio diz `already exists in this Cloudflare account`
Outro projeto do OneUptime, ou uma pessoa, criou uma lista chamada `oneuptime_block` ou `oneuptime_challenge`, e o OneUptime nunca muda uma lista que ele não criou para este projeto. Renomeie ou exclua essa lista na Cloudflare, ou desative o bloqueio no projeto que a criou. O OneUptime configura o bloqueio de novo em até 5 minutos.
:::

:::details O teste passa, mas Last Polled é Never
O job de consulta nunca rodou. Leia as verificações **Background workers** e **Poll scheduler**. Em uma instalação auto-hospedada, a causa comum é `DISABLE_QUEUE_WORKERS=true` no aplicativo, sem um deployment separado de workers que pegue os jobs: defina como `false`, ou rode o deployment de workers (Helm: `worker.enabled: true`, que é `false` por padrão).
:::

## Próximos passos

:::cards
- [Eventos de segurança](/docs/telemetry/security-events): Pesquise, correlacione e alerte sobre o que você importa.
- [Casos de segurança](/docs/telemetry/security-cases): Veja o que a Cloudflare fez ao lado do que chegou ao seu app.
- [Visão geral das integrações](/docs/integrations/index): As outras ferramentas que você pode conectar.
:::
