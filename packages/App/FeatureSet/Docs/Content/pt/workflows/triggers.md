# Gatilhos

Um trigger é o primeiro bloco de um workflow — é ele que decide quando o workflow roda. Todo workflow tem exatamente um trigger, e você escolhe entre quatro tipos.

## Manual

Roda o workflow sob demanda: clique em **Executar fluxo de trabalho** na página **Construtor**, preencha os campos do trigger e confirme em **Run Workflow Manually**. O trigger Manual recebe um payload JSON que o restante do workflow pode ler.

Serve bem para: automações de um clique que merecem um botão, do tipo "rotacionar esta chave" ou "enviar um alerta de teste".

**Saída**: o JSON que você colou, ou um objeto vazio se você não colou nada.

## Schedule

Roda o workflow em um ciclo repetido, definido por uma expressão cron.

Serve bem para: limpeza noturna, sincronização de hora em hora, relatórios semanais.

**Configuração**: uma expressão cron. Algumas bem comuns:

- `0 * * * *` — de hora em hora, na hora cheia.
- `*/5 * * * *` — a cada 5 minutos.
- `0 9 * * 1` — toda segunda-feira às 9:00.

Se o sistema ficar brevemente indisponível, a execução é retomada assim que ele volta — você não precisa se preocupar com disparos perdidos em quedas curtas.

## Webhook

O OneUptime cria uma URL exclusiva. Qualquer chamada a essa URL inicia o workflow. Os cabeçalhos, os parâmetros de consulta e o corpo da requisição são repassados adiante.

Serve bem para: trazer dados de outra ferramenta para dentro do OneUptime — callbacks de CI/CD, alertas de outro monitoramento, cadastros no seu CRM.

**Saída**:

- **Request Headers** — todos os cabeçalhos da requisição recebida.
- **Request Query Params** — a query string já interpretada.
- **Request Body** — o corpo já interpretado (ou o texto bruto, se não for JSON).

A URL aceita tanto `GET` quanto `POST`. Quem chama recebe uma confirmação imediata — o workflow em si roda em segundo plano.

Trate essa URL como uma senha. Quem a tiver consegue iniciar o seu workflow.

## Gatilhos de eventos do OneUptime

Quase tudo no OneUptime — monitores, incidentes, alertas, manutenções programadas, páginas de status, políticas de plantão, equipes — pode disparar um workflow. Cada um oferece três eventos:

- **On Create** — dispara quando um novo é adicionado.
- **On Update** — dispara quando um é alterado.
- **On Delete** — dispara quando um é excluído.

É assim que você monta "quando X acontece no OneUptime, faça Y" sem precisar ficar consultando em loop.

O registro completo é passado ao bloco seguinte. O trigger **Incident → On Create**, por exemplo, entrega o incidente recém-criado, então o próximo bloco pode ler título, descrição, severidade e qualquer outro campo.

### Os eventos que as equipes mais usam

- **Incident** — reaja quando um incidente é aberto, atualizado (reconhecido, resolvido) ou excluído.
- **Alert** — os mesmos três, para alertas.
- **Monitor** — reaja quando um monitor é adicionado, editado ou removido.
- **Scheduled Maintenance** — anuncie automaticamente uma janela de manutenção assim que ela é agendada.
- **Status Page Subscriber** — dê boas-vindas a quem se inscreve em uma página de status.
- **On-Call Duty Policy** — sincronize mudanças de escala com outro sistema de plantão.

Busque pelo nome no painel **Add Trigger** para achar o que você quer.

## Qual trigger devo usar?

| Se você quer…                              | Escolha             |
| ----------------------------------- | ------------------- |
| Clicar em um botão para rodar o workflow  | **Manual**          |
| Rodar em um ciclo repetido         | **Schedule**        |
| Deixar outro sistema empurrar dados    | **Webhook**         |
| Reagir a algo dentro do OneUptime | **Evento do OneUptime** |

Um workflow só pode ter um trigger. Se você precisa de duas formas de iniciar a mesma automação, coloque a lógica compartilhada em um workflow e chame-o a partir de dois workflows "invólucro" bem finos, usando o componente **Execute Workflow**.

## Onde ler em seguida

- [Componentes de workflow](/docs/workflows/components) — as ações que você adiciona depois do trigger.
- [Variáveis de workflow](/docs/workflows/variables) — lendo a saída do trigger em blocos posteriores.
- [Execuções e registros de workflow](/docs/workflows/runs-and-logs) — confirmando que seu trigger disparou.
