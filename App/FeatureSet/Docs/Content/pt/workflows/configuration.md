# Configuração e Segurança

Esta página cobre as configurações e limites de segurança que vale conhecer antes de apontar um workflow para o tráfego real.

## Ligando ou desligando um workflow

Todo workflow tem um interruptor **Ativado** nas **Configurações**. Quando está desligado, o workflow não roda — chamadas de webhook, horários agendados e eventos do OneUptime são todos ignorados. Workflows novos começam desativados.

Use esse interruptor como seu "tudo pronto para começar":

1. Construa o workflow.
2. Clique em **Executar Manualmente** com um payload realista.
3. Verifique os **Logs** — confirme se cada bloco seguiu o caminho esperado.
4. Vire **Ativado** para ligado.

Desligar um workflow não interrompe execuções já em andamento; apenas impede que novas comecem.

## Donos e etiquetas

- **Donos** — usuários e equipes listados como donos têm acesso ao workflow e podem optar por receber notificações quando ele falha. Defina em **Configurações → Donos**.
- **Etiquetas** — tags para agrupar workflows. A lista de workflows permite filtrar por etiqueta, o que torna um projeto cheio muito mais fácil de navegar. Útil quando você tem workflows organizados por equipe, integração ou ambiente.
- **Regras de etiqueta** — em **Workflows → Configurações → Regras de Etiqueta**, aplique etiquetas automaticamente a novos workflows com base em padrões de nome ou descrição.
- **Regras de dono** — em **Workflows → Configurações → Regras de Dono**, atribua donos automaticamente a novos workflows.

## Segredos

Marque uma variável global como **segredo** se ela contém algo sensível. O valor é criptografado, fica oculto na interface depois que você salva e oculto nos logs de execução (mostrado como `[REDACTED]`).

Use variáveis secretas para:

- Chaves de API de serviços externos.
- Tokens de autenticação.
- Chaves de assinatura de webhook.
- Qualquer coisa que você não queira que alguém com acesso de leitura veja.

Não cole um segredo diretamente em um bloco — valores como `Authorization: Bearer eyJh...` acabam visíveis no workflow e nos logs. Use `{{variable.MY_SECRET}}` em vez disso.

## Quanto tempo uma execução pode levar

Cada execução tem uma duração máxima. Se uma execução não terminar a tempo, é marcada como **Timeout** e o bloco em andamento é cancelado. O padrão é generoso — longo o suficiente para chamadas HTTP normais e cadeias de blocos.

Blocos individuais têm seus próprios limites de tempo dentro disso — por exemplo, um bloco API desiste de uma requisição externa travada bem antes que toda a execução o faça.

## Limite para chamar outros workflows

O componente **Executar Workflow** permite que um workflow chame outro. Para evitar loops acidentais onde o workflow A chama B que chama A de novo, há um limite de profundidade na cadeia. Uma execução que passa do limite termina com um erro claro.

Se você tem uma necessidade real de uma cadeia longa (como um job que processa um item por execução), geralmente é mais simples fazer um loop dentro de um único workflow usando **Código Customizado**.

## Segurança de webhooks

Gatilhos de webhook te dão uma URL única. Qualquer um que conheça a URL pode acessá-la. Para se proteger de chamadores acidentais ou indesejados:

- Trate a URL como uma senha. Não a compartilhe publicamente nem coloque em um repositório público.
- Para workflows sensíveis, peça ao sistema chamador que envie um token compartilhado como cabeçalho (como `X-Webhook-Token`) e verifique-o com um bloco **Condições** antes de fazer qualquer coisa importante. Salve o token esperado como uma variável secreta.
- Para workflows muito sensíveis, prefira um gatilho de evento do OneUptime e um passo de importação manual em vez de um webhook público.

## Acesso à rede de saída

Blocos de API e outros blocos HTTP fazem suas requisições a partir do OneUptime. Se você se auto-hospeda, garanta que sua instalação consiga alcançar os serviços que você está chamando. Se você usa o OneUptime Cloud, nossas faixas de IPs de saída estão listadas em [Endereços IP](/docs/configuration/ip-addresses) para que você possa liberá-las no outro lado.

## Permissões

Workflows respeitam o controle de acesso baseado em papéis do seu projeto. As permissões relevantes:

- **Criar / Ler / Editar / Excluir Workflow** — as permissões básicas sobre o próprio workflow.
- **Executar Workflow** — necessária para clicar em **Executar Manualmente** ou disparar um workflow via API.
- **Ler Log de Workflow** — necessária para visualizar execuções.
- **Ler / Criar / Editar / Excluir Variável de Workflow** — controle sobre a lista de variáveis globais.

A maioria das pessoas de engenharia deve ter criar/editar/ler em workflows, mas não em variáveis. Reserve o acesso de edição de variáveis para quem gerencia os segredos do seu projeto.

## Limites de plano

O OneUptime Cloud limita o número de execuções por mês em planos menores. Seu limite atual é mostrado em **Configurações do Projeto → Cobrança**. Quando você atinge o limite, novos disparos são rejeitados até o próximo ciclo de cobrança. Instalações auto-hospedadas não têm esse limite.

## Quando workflows não são a ferramenta certa

Alguns casos em que você deve buscar outra coisa:

- **Computação pesada ou grandes conjuntos de dados** — workflows são projetados para colar coisas leves, não para processamento numérico. Rode trabalhos pesados na sua própria infraestrutura e deixe um workflow disparar isso.
- **Processos longos que duram horas** — uma única execução é feita para terminar rapidamente. Se você precisa "fazer A, esperar duas horas, fazer B", use um agendador externo que envie um webhook de volta ao OneUptime quando for a hora.
- **Resposta a incidentes passo a passo com humanos no processo** — para isso existem os [Runbooks](/docs/runbooks/index). Workflows são para automação sem supervisão.

## O que ler em seguida

- [Visão geral dos workflows](/docs/workflows/index) — o panorama geral.
- [Componentes](/docs/workflows/components) — referência bloco a bloco.
- [Runbooks](/docs/runbooks/index) — quando usar um runbook em vez disso.
