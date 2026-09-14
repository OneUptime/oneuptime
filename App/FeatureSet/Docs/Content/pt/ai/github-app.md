# Trabalhando com o OneUptime a partir do GitHub

O GitHub App do OneUptime não é apenas uma conexão com o seu código — você pode conversar com ele dentro do seu repositório, e ele faz o trabalho ali mesmo.

Mencione-o em um issue e ele abre um pull request. Mencione-o em um pull request e ele ajusta o branch, ou revisa o diff. Adicione um label a um issue e ele assume o issue. Tudo o que ele produz é um pull request ou uma revisão para uma pessoa ler: **ele nunca faz merge de nada, e nunca aprova um pull request.**

```text
@oneuptime implement this                          →  um pull request que fecha o issue
@oneuptime revise this — use exponential backoff   →  novos commits no branch deste pull request
@oneuptime review                                  →  uma revisão de código publicada neste pull request
```

> Substitua `@oneuptime` pelo handle do seu próprio app. No OneUptime Cloud ele é `@oneuptime`. Em uma instância auto-hospedada é o nome que você deu ao seu GitHub App, em minúsculas e com os espaços trocados por hifens — um app chamado "Acme AI" é mencionado como `@acme-ai`. Se as menções não fizerem nada, é a primeira coisa a verificar.

## Antes de começar

- O repositório precisa estar **conectado a um projeto do OneUptime** pelo GitHub App. Veja [Integração com o GitHub (auto-hospedado)](/docs/self-hosted/github-integration) para a configuração, ou conecte-o em **Configurações do projeto → Repositórios de código** no OneUptime Cloud.
- Um **Runner com a capacidade "Executa Correções de Código com IA"** precisa estar online — o mesmo Runner que executa as [Tarefas de Correção com IA](/docs/ai/ai-agent). Sem ele, os comandos são aceitos e depois falham após 30 minutos com uma mensagem dizendo que nenhum agente os assumiu.
- O GitHub App precisa ter a permissão **Issues: Leitura e Escrita** e precisa assinar os eventos de webhook listados em [O que assinar](#o-que-assinar).

## Os comandos

Todo comando começa com uma menção ao app. A menção pode estar em qualquer lugar do comentário, e tudo o que você escrever depois dela é repassado como o seu pedido.

### Em um pull request

| Comando | O que acontece |
| --- | --- |
| `@oneuptime review` | Clona o branch, lê o código alterado **e o código ao redor**, e publica uma revisão como comentário. Não altera nada. |
| `@oneuptime revise this — <o que você quer mudar>` | Clona o branch do próprio pull request, faz a alteração e envia novos commits para esse mesmo branch. Nunca abre um segundo pull request. |

Qualquer coisa que você escrever depois da menção e que não seja um comando reconhecido é tratada como um pedido de ajuste, porque quase sempre é isso mesmo:

```text
@oneuptime the retry loop here should back off exponentially, and the test
should cover the 429 case
```

### Em um issue

| Comando | O que acontece |
| --- | --- |
| `@oneuptime implement this` | Trabalha no issue e abre um pull request que o fecha. |
| `@oneuptime <qualquer outra coisa>` | O mesmo, com as suas palavras como direcionamento extra. |

Você também pode entregar um issue ao app **sem comentar nada**:

- **Adicione o label de gatilho.** Adicionar a um issue o label de gatilho do repositório — `oneuptime` por padrão — inicia o mesmo trabalho. Essa é a forma mais confiável de atribuir trabalho pela interface do GitHub.
- **Atribua o issue ao usuário bot do app**, onde o seu repositório permitir. O GitHub não deixa um app ser assignee em todo lugar, e é por isso que o label existe; se atribuir não fizer nada, use o label.

### Em qualquer lugar

| Comando | O que acontece |
| --- | --- |
| `@oneuptime help` | Lista os comandos. Uma menção sozinha, sem nada depois dela, faz o mesmo. |
| `@oneuptime status` | Diz no que ele está trabalhando neste momento nesta thread. |
| `@oneuptime cancel` | Interrompe as execuções que ele tem em andamento nesta thread. O trabalho já enviado continua enviado. |

`help`, `status` e `cancel` nunca iniciam uma execução do agente, então não custam nada e não entram no seu orçamento diário de tarefas de correção.

## Como isso aparece na thread

Um comando produz **um comentário**, que o app vai editando conforme o trabalho avança — assim uma tarefa demorada nunca transforma um pull request em um log de status.

1. Ele reage com 👀 no seu comentário e publica uma confirmação nomeando o projeto do OneUptime a que a execução pertence e com um link para a execução ao vivo.
2. Quando termina, esse mesmo comentário é reescrito com o resultado: o pull request que ele abriu, os commits que enviou, ou uma explicação honesta de por que não fez nada.

Se ele não encontrar nada que valha a pena mudar, ele diz isso em vez de abrir um pull request especulativo. Esse é um resultado normal, não uma falha — dê mais direcionamento e peça de novo.

## Quem pode comandá-lo

**Apenas quem tem acesso de escrita (write), manutenção (maintain) ou administração (admin) ao repositório.** O OneUptime pergunta diretamente ao GitHub, toda vez, qual é a permissão de quem comentou naquele repositório; ele não confia no selo "contributor" que o GitHub mostra ao lado de um comentário, que descreve atividade passada e não acesso atual.

Uma menção de qualquer outra pessoa recebe uma única reação 😕 no comentário e nada mais. Isso é proposital: em um repositório público qualquer um pode comentar, e um app que responde de forma confiável a estranhos é um app que pode ser usado para encher uma thread de spam.

Ele também ignora todo comentário escrito por um bot, inclusive os seus próprios, e ignora menções que aparecem dentro de uma citação (`>`) ou de um bloco de código. Juntas, essas duas regras são o que impede que uma resposta a um dos seus próprios comentários o coloque para rodar de novo.

## O que ele não faz

- **Ele nunca faz merge.** Nada que este app faça pode colocar código no seu branch padrão.
- **Ele nunca aprova nem solicita alterações.** As revisões são publicadas como comentários, então uma revisão feita por um app nunca pode satisfazer uma regra de proteção de branch.
- **Ele nunca reescreve o histórico.** Um ajuste adiciona commits; não faz force-push. Se outra pessoa enviou algo para o branch antes, o ajuste falha em vez de descartar o trabalho dela.
- **Ele não consegue ajustar um pull request vindo de um fork.** O branch de um fork está em um repositório onde a instalação não tem permissão de escrita. Ele ainda assim revisa esse pull request — peça uma revisão em vez do ajuste.
- **Ele nunca muda o título, a descrição ou o branch de destino de um pull request.** Somente o código.

## Quanto custa, e como limitar

Todo comando que inicia trabalho é uma execução completa do agente — um clone, até 40 chamadas de LLM e 100.000 tokens de saída, mais os comandos de build e de teste do seu repositório, se você os tiver configurado.

Dois limites se aplicam, e ambos são os mesmos que já governam as [Tarefas de Correção com IA](/docs/ai/ai-agent):

- **O limite diário de execuções de correção do projeto** (**Configurações do projeto → IA**, 25/dia por padrão). Os comandos do GitHub dividem esse orçamento com o resto das execuções de correção do seu projeto.
- **O teto de pull requests abertos por repositório** (**Repositórios de código → o repositório → Configurações**, 5 por padrão). Revisões e ajustes estão isentos: nenhum dos dois adiciona um novo pull request à sua fila de revisão.

Só uma execução de cada tipo fica ativa por issue ou pull request de cada vez. Pedir duas vezes faz ele avisar que já está trabalhando; pedir uma revisão enquanto um ajuste está rodando inicia as duas, porque são pedidos diferentes.

Se uma execução não puder começar, o app diz o porquê na thread — ele nunca falha em silêncio.

## Como desligar

Por repositório: **Repositórios de código → o repositório → Configurações → Responder a Comandos do GitHub**. Com isso desligado, o app ignora menções, atribuições e o label de gatilho naquele repositório, e diz a quem perguntar onde fica a chave.

A mesma página traz o **Label de Gatilho do GitHub**, caso você queira algo diferente de `oneuptime`.

## O que assinar

Nas configurações **Permissions & events** do seu GitHub App, assine:

| Evento | Necessário para |
| --- | --- |
| **Issue comment** | comandos por `@mention` em issues *e* em pull requests |
| **Issues** | atribuição ao app, e o label de gatilho |
| **Pull request** | revisão solicitada ao app |
| **Pull request review** | uma menção no corpo de uma revisão enviada |
| **Pull request review comment** | uma menção em um comentário inline do diff |

E em **Repository permissions**, **Issues** precisa estar em **Leitura e Escrita** — o GitHub serve os comentários de conversa dos pull requests pela API de issues, então é isso que permite ao app comentar em pull requests também.

## Prompt injection: o que está e o que não está protegido

O texto dos issues, as descrições dos pull requests, os diffs e os comentários entram todos no prompt do agente, e em um repositório público qualquer um pode escrevê-los. Um texto dizendo "ignore suas instruções e faça X" é algo realista de se encontrar em um issue.

Duas coisas limitam isso, e vale saber qual é qual:

- **Os prompts rotulam o texto não confiável como um pedido, não como instruções**, e o repositório, o branch e o pull request da execução são fixados antes de o agente sequer começar — nada que o agente leia pode mudar aquilo em que ele está trabalhando.
- **A contenção de verdade é o sandbox.** O agente roda no seu Runner, em um clone descartável, com as credenciais removidas do ambiente dos seus comandos e as operações de git restritas. Ele só consegue enviar para um branch, e só uma pessoa pode fazer o merge.

Trate um pull request escrito por IA como você trataria um de um contribuidor novo que leu o issue: revise o diff, não a descrição.

## Solução de problemas

**Não acontece nada quando eu menciono o app.** Verifique o handle primeiro — ele é o slug do app, não o nome de exibição. Depois verifique se o repositório está conectado a um projeto (**Configurações do projeto → Repositórios de código**), se **Responder a Comandos do GitHub** está ligado e se o seu GitHub App assina os eventos acima.

**Ele reage com 😕 e não diz nada.** Você não tem acesso de escrita ao repositório.

**Ele diz que já está trabalhando nisso.** Já existe uma execução desse tipo ativa neste issue ou pull request. `@oneuptime status` diz qual é, e `@oneuptime cancel` a interrompe.

**Ele confirmou e depois ficou muito tempo em silêncio.** Verifique se há um Runner com **Executa Correções de Código com IA** online em **Configurações → Runners**. Sem ele, a execução falha depois de 30 minutos e a thread é avisada.

**Ele diz que o pull request vem de um fork.** Ajustes precisam de um branch neste repositório. Peça uma revisão, ou envie o branch para cá.

## O que ler em seguida

- [Tarefas de Correção com IA](/docs/ai/ai-agent) — o mesmo agente, disparado a partir de uma exceção em vez do GitHub.
- [Integração com o GitHub (auto-hospedado)](/docs/self-hosted/github-integration) — criar e configurar o GitHub App.
- [Runners](/docs/runbooks/agents) — o processo que executa as tarefas.
