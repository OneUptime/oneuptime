# Gatilhos

Um gatilho é o primeiro bloco em um workflow — ele decide quando o workflow roda. Todo workflow tem exatamente um gatilho. Você escolhe entre quatro tipos.

## Manual

Execute o workflow sob demanda clicando em **Executar Manualmente** na página do workflow. Você pode colar um payload JSON que o resto do workflow consegue ler.

Bom para: automações de um clique para as quais você quer um botão, como "rotacionar esta chave" ou "enviar um alerta de teste."

**Saída**: o JSON que você colou ou um objeto vazio caso não tenha colado nada.

## Agendado

Execute o workflow em um agendamento recorrente usando uma expressão cron.

Bom para: limpezas noturnas, sincronizações horárias, relatórios semanais.

**Configuração**: uma expressão cron. Alguns exemplos comuns:

- `0 * * * *` — toda hora, no minuto zero.
- `*/5 * * * *` — a cada 5 minutos.
- `0 9 * * 1` — toda segunda às 9:00.

Se o sistema ficar brevemente indisponível, a execução é retomada assim que ele se recupera — você não precisa se preocupar com disparos perdidos em pequenas interrupções.

## Webhook

O OneUptime cria uma URL única. Qualquer requisição a essa URL inicia o workflow. Os cabeçalhos, parâmetros de consulta e o corpo da requisição são repassados.

Bom para: receber dados de outra ferramenta no OneUptime — callbacks de CI/CD, alertas de outros monitoramentos, cadastros no seu CRM.

**Saída**:

- **Cabeçalhos da Requisição** — todos os cabeçalhos da requisição recebida.
- **Parâmetros de Consulta** — a query string já analisada.
- **Corpo da Requisição** — o corpo analisado (ou o texto bruto se não for JSON).

A URL aceita tanto `GET` quanto `POST`. O chamador recebe uma confirmação rápida — o próprio workflow roda em segundo plano.

Trate a URL como uma senha. Quem tiver acesso a ela pode iniciar seu workflow.

## Gatilhos de eventos do OneUptime

Quase tudo no OneUptime — monitores, incidentes, alertas, manutenções programadas, páginas de status, políticas de plantão, equipes — pode disparar um workflow. Cada um oferece três eventos:

- **Na Criação** — dispara quando um novo é adicionado.
- **Na Atualização** — dispara quando um é alterado.
- **Na Exclusão** — dispara quando um é excluído.

É assim que você constrói "quando X acontecer no OneUptime, faça Y" sem precisar ficar verificando coisas em loop.

O registro completo é repassado ao próximo bloco. Por exemplo, o gatilho **Incidente → Na Criação** repassa o novo incidente, então o próximo bloco pode ler o título, a descrição, a severidade e qualquer outro campo.

### Eventos mais usados pelos times

- **Incidente** — reagir quando um incidente é aberto, atualizado (confirmado, resolvido) ou excluído.
- **Alerta** — os mesmos três para alertas.
- **Monitor** — reagir quando um monitor é adicionado, editado ou removido.
- **Manutenção Programada** — anunciar uma janela de manutenção automaticamente quando ela é agendada.
- **Inscrito em Página de Status** — dar boas-vindas a quem se inscreve em uma página de status.
- **Política de Plantão** — sincronizar mudanças de escala com outro sistema de escalas.

Busque pelo nome na paleta de gatilhos para encontrar o que você quer.

## Qual gatilho devo usar?

| Se você quer… | Escolha |
| --- | --- |
| Clicar em um botão para executar o workflow | **Manual** |
| Executar em um agendamento recorrente | **Agendado** |
| Ter outro sistema enviando dados | **Webhook** |
| Reagir a algo dentro do OneUptime | **Evento do OneUptime** |

Um workflow só pode ter um gatilho. Se você precisar de duas formas de iniciar a mesma automação, coloque a lógica compartilhada em um workflow e chame-a a partir de dois workflows "envoltórios" finos usando o componente **Executar Workflow**.

## O que ler em seguida

- [Componentes](/docs/workflows/components) — as ações que você adiciona depois do gatilho.
- [Variáveis](/docs/workflows/variables) — lendo a saída do gatilho a partir dos blocos seguintes.
- [Execuções e Registros](/docs/workflows/runs-and-logs) — confirmando que seu gatilho disparou.
