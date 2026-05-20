# Configuração e segurança

Esta página reúne as configurações e limites de segurança que vale conhecer antes de apontar um workflow para o tráfego de produção.

## Habilitar / desabilitar

Todo workflow tem uma flag **isEnabled** em **Settings**. Workflows desabilitados nunca disparam — eventos de modelo, webhooks e execuções agendadas são ignorados. Workflows novos nascem desabilitados.

Trate isso como seu interruptor de "pronto para produção":

1. Construa o workflow.
2. Clique em **Run Manually** com um payload representativo.
3. Cheque **Logs** — confirme que cada nó tomou a porta esperada.
4. Ligue **isEnabled**.

Desabilitar um workflow não afeta execuções já em andamento; apenas impede que novas sejam criadas.

## Propriedade e rótulos

- **Owners** — usuários e equipes listados como owners recebem acesso baseado em permissão e (opcionalmente) notificações quando o workflow falha. Configure em **Settings → Owners**.
- **Labels** — tags muitos-para-muitos para organizar workflows. Filtre a lista de workflows por rótulo. Útil quando um projeto tem dezenas de workflows organizados por equipe, por integração ou por ambiente.
- **Label rules** — em **Workflows → Settings → Label Rules**, aplique rótulos automaticamente em workflows novos com base em correspondências regex no nome ou descrição.
- **Owner rules** — em **Workflows → Settings → Owner Rules**, atribua owners automaticamente a workflows novos.

## Segredos

Variáveis globais podem ser marcadas como **secret**. O valor é criptografado em repouso, write-only na interface após salvar e redigido dos logs de execução (substituído por `[REDACTED]`).

Use variáveis secretas para:

- Chaves de API para integrações de saída.
- Tokens bearer.
- Chaves de assinatura de webhook.
- Qualquer valor que um atacante com acesso de leitura a um workflow não deveria ver.

Não cole um segredo direto no argumento de um componente — referências como `Authorization: Bearer eyJh...` aparecem no JSON do workflow e nos logs de execução em texto claro. Referencie `{{variable.MY_SECRET}}` em vez disso.

## Timeout de execução

Cada execução tem uma duração máxima. Se uma execução não terminou dentro do timeout, ela é marcada como `Timeout` e qualquer componente em andamento é cancelado. O padrão é generoso (minutos, não segundos) — veja a configuração de ambiente do worker para o valor exato na sua instalação.

A maioria dos componentes tem seus próprios timeouts por chamada dentro do timeout de execução — por exemplo, o componente API desiste de uma requisição de saída travada bem antes da execução inteira.

## Limite de recursão

O componente **Execute Workflow** permite que um workflow chame outro. Para impedir loops descontrolados onde A chama B chama A indefinidamente, o worker rastreia a cadeia de chamadas e interrompe uma cadeia que excede uma profundidade fixa (tipicamente um número pequeno como 5). A execução terminada é marcada como `Error` com uma mensagem clara sobre o limite de recursão.

Se você tem uma necessidade legítima de uma cadeia longa (por exemplo, um caminhamento recursivo em pastas que processa um nível por execução), refatore para um único workflow que itera internamente via **Custom Code** — esse padrão não está sujeito ao limite da cadeia.

## Segurança de webhooks

Gatilhos webhook expõem uma URL HTTPS única. Qualquer um que descobrir a URL pode chamá-la. Para se defender contra chamadores acidentais ou maliciosos:

- Trate a URL como um segredo compartilhado. Não a cole em chat público ou comite em repositório público.
- Para workflows de alto valor, peça ao sistema chamador para incluir um segredo compartilhado como cabeçalho (por exemplo, `X-Webhook-Token`) e valide-o em um nó **Conditions** antes de fazer qualquer coisa destrutiva. Defina o token esperado como variável global secreta.
- Para workflows de altíssimo valor, prefira um gatilho de evento de modelo e um passo de importação manual em vez de um webhook público.

## Saída de rede

Os componentes API e outros estilo HTTP enviam requisições a partir da rede do Workflow Worker do OneUptime. Se você auto-hospeda o OneUptime, a rede de saída do worker é sua responsabilidade — garanta que ela consegue alcançar as APIs de terceiros que você chama. Se você usa o OneUptime Cloud, nossa faixa de IPs de saída é publicada em [IP Addresses](/docs/configuration/ip-addresses) para que você possa autorizar no lado receptor.

## Permissões

Workflows são recursos de primeira classe sujeitos ao controle de acesso baseado em função no nível do projeto:

- `CreateWorkflow`, `ReadWorkflow`, `EditWorkflow`, `DeleteWorkflow` — as quatro permissões CRUD em modelos de workflow.
- `RunWorkflow` — necessária para clicar em **Run Manually** ou despachar um workflow via API.
- `ReadWorkflowLog` — necessária para visualizar a página **Execuções e registros**.
- `ReadWorkflowVariable`, `CreateWorkflowVariable`, `EditWorkflowVariable`, `DeleteWorkflowVariable` — controle sobre a lista de variáveis globais.

A maioria dos engenheiros deveria ter create/edit/read em workflows, mas não em variáveis. Reserve o acesso de edição de variáveis para as pessoas que gerenciam os segredos do projeto.

## Cotas

O OneUptime Cloud limita o número de execuções por mês por projeto nos planos menores. O limite é mostrado em **Project Settings → Billing**. Quando você atinge esse limite, novos gatilhos são rejeitados (e registrados com um motivo de "quota exceeded" no workflow afetado) até o próximo ciclo de cobrança. Instalações auto-hospedadas não estão sujeitas a uma cota.

## Em que workflows *não* são bons

Alguns padrões em que você deve recorrer a uma ferramenta diferente:

- **Computação de longa duração** — workflows são orientados para colar sistemas, não para processar grandes datasets. Rode o trabalho pesado na sua própria infraestrutura e use um workflow para disparar.
- **Workflows com estado que se estendem por minutos/horas** — uma única execução deveria terminar rapidamente. Se você precisa de "faça a coisa A, espere duas horas, então faça a coisa B", modele a espera como um agendador externo que faz post de volta em um gatilho webhook.
- **Resposta a incidentes passo a passo com checkpoints humanos** — é para isso que servem os [Runbooks](/docs/runbooks/index). Use um workflow se não há humano no laço; use um runbook se há.

## O que ler a seguir

- [Visão geral dos workflows](/docs/workflows/index) — o mapa conceitual.
- [Componentes](/docs/workflows/components) — detalhes de argumentos para cada ação.
- [Runbooks](/docs/runbooks/index) — quando usar um runbook em vez disso.
