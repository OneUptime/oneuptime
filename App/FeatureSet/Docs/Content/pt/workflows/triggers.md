# Gatilhos de workflow

Um trigger é o primeiro bloco em um workflow — ele decide quando o workflow roda. Todo workflow tem exatamente um trigger. Você escolhe entre quatro tipos.

## Manual

Execute o workflow sob demanda clicando em **Run Workflow** na página **Builder**, preenchendo os campos do trigger e confirmando com **Run Workflow Manually**. O trigger Manual recebe um payload JSON que o restante do workflow pode ler.

Bom para: automações de um clique para as quais você quer um botão, como "rotacionar esta chave" ou "enviar um alerta de teste."

**Saída**: o JSON que você colou, ou um objeto vazio se não colou nada.

## Schedule

Execute o workflow em um agendamento repetitivo usando uma expressão cron.

Bom para: limpeza noturna, sincronização por hora, relatórios semanais.

**Configuração**: uma expressão cron. Algumas comuns:

- `0 * * * *` — toda hora, na hora cheia.
- `*/5 * * * *` — a cada 5 minutos.
- `0 9 * * 1` — toda segunda-feira às 9h.

Se o sistema ficar brevemente indisponível, a execução é retomada assim que ele se recupera — você não precisa se preocupar com ciclos perdidos em interrupções curtas.

## Webhook

O OneUptime cria uma URL única. Qualquer coisa que atinja essa URL inicia o workflow. Os headers, os parâmetros de query e o body da requisição são passados adiante.

Bom para: receber dados no OneUptime vindos de outra ferramenta — callbacks de CI/CD, alertas de outro monitoramento, cadastros no seu CRM.

**Saída**:

- **Request Headers** — todos os headers da requisição recebida.
- **Request Query Params** — a query string interpretada.
- **Request Body** — o body interpretado (ou o texto bruto, se não for JSON).

A URL aceita tanto `GET` quanto `POST`. Quem chama recebe uma confirmação rápida — o workflow em si roda em segundo plano.

Trate a URL como uma senha. Qualquer pessoa que a tenha pode iniciar seu workflow.

## Triggers de eventos do OneUptime

Quase tudo no OneUptime — monitores, incidentes, alertas, manutenções programadas, páginas de status, políticas de plantão, times — pode disparar um workflow. Cada um oferece três eventos:

- **On Create** — dispara quando um novo é adicionado.
- **On Update** — dispara quando um é alterado.
- **On Delete** — dispara quando um é excluído.

É assim que você constrói "quando X acontecer no OneUptime, faça Y" sem precisar verificar coisas em um loop.

O registro completo é passado para o próximo bloco. Por exemplo, o trigger **Incident → On Create** passa o novo incidente, de forma que o próximo bloco pode ler seu título, descrição, severidade e qualquer outro campo.

### Eventos mais usados pelas equipes

- **Incident** — reaja quando um incidente é aberto, atualizado (reconhecido, resolvido) ou excluído.
- **Alert** — os mesmos três para alertas.
- **Monitor** — reaja quando um monitor é adicionado, editado ou removido.
- **Scheduled Maintenance** — anuncie uma janela de manutenção automaticamente quando ela for agendada.
- **Status Page Subscriber** — dê boas-vindas a quem se inscreve em uma página de status.
- **On-Call Duty Policy** — sincronize mudanças de escala com outro sistema de escalas.

Pesquise no painel **Add Trigger** pelo nome para encontrar o que você quer.

## Qual trigger devo usar?

| Se você quer…                     | Escolha                |
| ----------------------------------- | -------------------- |
| Clicar em um botão para rodar o workflow  | **Manual**          |
| Rodar em um agendamento repetitivo         | **Schedule**        |
| Fazer outro sistema enviar dados    | **Webhook**         |
| Reagir a algo dentro do OneUptime | **OneUptime event** |

Um workflow só pode ter um trigger. Se você precisa de duas formas de iniciar a mesma automação, construa a lógica compartilhada em um workflow e chame-a a partir de dois workflows "wrapper" simples, usando o componente **Execute Workflow**.

## Onde ler a seguir

- [Componentes de workflow](/docs/workflows/components) — as ações que você adiciona depois do trigger.
- [Variáveis de workflow](/docs/workflows/variables) — lendo a saída do trigger em blocos posteriores.
- [Execuções e registros de workflow](/docs/workflows/runs-and-logs) — confirmando que seu trigger disparou.
