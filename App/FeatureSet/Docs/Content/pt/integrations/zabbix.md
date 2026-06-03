# Integração com o Zabbix

O [Zabbix](https://www.zabbix.com) monitora seus servidores e rede; o OneUptime gerencia sua resposta a incidentes, plantão e páginas de status. Conecte os dois e cada problema do Zabbix vira automaticamente um incidente no OneUptime — para que as pessoas certas sejam acionadas e sua página de status se mantenha fiel.

Esta integração é de **entrada**: o Zabbix envia problemas para o OneUptime. Ela usa um **tipo de mídia webhook** no Zabbix de um lado e um **[Workflow](/docs/workflows/index)** do OneUptime do outro. Sem plugins, sem serviços extras.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## Como funciona

1. Um trigger do Zabbix muda para **PROBLEM**.
2. Uma **ação** do Zabbix instrui o tipo de mídia **OneUptime** a enviar o evento.
3. O script do tipo de mídia faz POST de um pequeno payload JSON para uma URL do workflow do OneUptime.
4. O workflow lê o payload e cria um incidente (e, opcionalmente, resolve-o quando o Zabbix se recupera).

## Pré-requisitos

- Um servidor Zabbix que você administra (este guia foi escrito para **Zabbix 6.0 LTS / 7.0 LTS**; o tipo de mídia webhook funciona da mesma forma no 5.0+).
- Seu servidor Zabbix deve conseguir alcançar sua instância do OneUptime via HTTPS.
- Um projeto no OneUptime onde você possa criar workflows.

## Parte 1 — Construa o workflow do OneUptime

Faça isso primeiro, pois você precisará da URL do webhook que ele gera.

1. Abra **Workflows → Create Workflow**. Nomeie-o como `Zabbix → Incidents` e abra a aba **Builder**.
2. Arraste um gatilho **Webhook** para o canvas. Clique nele e **copie a URL única** exibida. Guarde-a bem — qualquer pessoa com ela pode iniciar o workflow. Renomeie o bloco para `Zabbix` para que as variáveis fiquem mais legíveis.
3. Arraste um bloco **Conditions** para o canvas e conecte a saída do gatilho a ele. Configure:
   - **Valor à esquerda**: `{{Zabbix.Request Body.status}}`
   - **Operador**: `==`
   - **Valor à direita**: `1`  *(o Zabbix envia `1` para problema, `0` para recuperação)*
4. Arraste um bloco **Create Incident** e conecte-o à saída **Yes** do bloco Conditions. Preencha:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: escolha a severidade de incidente do OneUptime que desejar (você pode refiná-la depois com mais ramificações de Conditions que mapeiam severidades do Zabbix).
5. Salve. Deixe **Enabled** *desativado* por enquanto — você vai ativar após um teste.

> **Dica:** Colocar o `event_id` do Zabbix na descrição (ou em um rótulo do incidente) permite encontrar este incidente mais tarde, caso queira resolver automaticamente na recuperação. Veja [Resolvendo automaticamente](#resolvendo-automaticamente-opcional).

## Parte 2 — Configure o Zabbix

### Passo 1: Crie o tipo de mídia OneUptime

1. No Zabbix, vá em **Alerts → Media types** (em versões mais antigas: **Administration → Media types**).
2. Clique em **Create media type** e defina **Type** como **Webhook**.
3. **Name**: `OneUptime`.
4. Adicione estes **Parameters** (clique em *Add* para cada um). Eles mapeiam as [macros](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) do Zabbix em um payload limpo:

   | Nome | Valor |
   | --- | --- |
   | `url` | `{ALERT.SENDTO}` |
   | `event_id` | `{EVENT.ID}` |
   | `event_name` | `{EVENT.NAME}` |
   | `event_value` | `{EVENT.VALUE}` |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host` | `{HOST.NAME}` |
   | `event_date` | `{EVENT.DATE}` |
   | `event_time` | `{EVENT.TIME}` |

5. Cole isto no campo **Script**:

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader('Content-Type: application/json');

   var payload = {
     source: 'zabbix',
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw 'OneUptime responded with HTTP ' + request.getStatus() + ': ' + response;
   }

   return 'OK';
   ```

6. Clique na aba **Message templates** e adicione um template para **Problem** e **Problem recovery** (o corpo pode ficar vazio — o payload é montado no script). Isso é necessário para que o Zabbix use o tipo de mídia para esses tipos de evento.
7. Clique em **Add** para salvar o tipo de mídia.

### Passo 2: Crie um usuário para carregar o webhook

O Zabbix envia notificações *para um usuário*. Crie um dedicado para facilitar encontrar e desativar a integração.

1. Vá em **Users → Users → Create user**. Nomeie-o `OneUptime Webhook`, dê a ele um papel que possa receber notificações (ex.: **User role**) e adicione-o a um grupo de usuários.
2. Na aba **Media**, clique em **Add**:
   - **Type**: `OneUptime`
   - **Send to**: cole a **URL do webhook do workflow** copiada na Parte 1.
   - **When active** / severidades: deixe os padrões (ou restrinja às severidades que lhe interessam).
3. Clique em **Add** e depois em **Update**.

### Passo 3: Envie problemas para o OneUptime com uma ação

1. Vá em **Alerts → Actions → Trigger actions → Create action**.
2. **Name**: `Notify OneUptime`.
3. **Conditions** (opcional): restrinja — por exemplo, *Trigger severity >= Warning*. Deixe vazio para enviar tudo.
4. Na aba **Operations**, adicione uma operação que envie para **User: OneUptime Webhook** pelo tipo de mídia **OneUptime**.
5. Para resolver incidentes na recuperação depois, preencha também as **Recovery operations** com o mesmo usuário/mídia.
6. Clique em **Add** para salvar e certifique-se de que a ação está **Enabled**.

## Parte 3 — Teste

1. De volta ao workflow do OneUptime, ative **Enabled**.
2. No Zabbix, acione um problema de teste — por exemplo, abaixe temporariamente o limiar de um trigger ou use um item de teste que entre em estado de problema.
3. Abra a aba **Logs** do seu workflow. Você deve ver uma execução com o payload do Zabbix, o bloco Conditions seguindo o caminho **Yes** e o incidente sendo criado.
4. Verifique **Incidents** no OneUptime — seu problema do Zabbix agora é um incidente.

Se nada chegar, veja [Solução de problemas](#solução-de-problemas).

## Resolvendo automaticamente (opcional)

O workflow principal acima *abre* incidentes. Para também *fechá-los* quando o Zabbix se recupera:

1. Certifique-se de que sua ação do Zabbix tem **Recovery operations** configuradas (Passo 3 acima) para que eventos de recuperação também sejam enviados. Na recuperação, `status` chega como `0`.
2. No workflow, adicione uma segunda ramificação **Conditions**: valor à esquerda `{{Zabbix.Request Body.status}}`, operador `==`, valor à direita `0`.
3. Na saída **Yes**, adicione um bloco **Find Incident** que localize o incidente aberto criado anteriormente — combine com o `event_id` do Zabbix que você armazenou na descrição ou em um rótulo.
4. Conecte-o a um bloco **Update Incident** e mova o incidente para o seu estado *resolvido*.

Como a resolução depende de como você modela os estados de incidente no seu projeto, mantenha o caminho de **criação** como o núcleo confiável e adicione o caminho de resolução depois de confirmar que os eventos fluem corretamente. Veja [Componentes → Componentes de dados do OneUptime](/docs/workflows/components#oneuptime-data-components).

## Mapeando severidades do Zabbix (opcional)

As severidades do Zabbix (`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`) chegam como `{{Zabbix.Request Body.severity}}`. Para mapeá-las às severidades de incidente do OneUptime, adicione ramificações **Conditions** antes de **Create Incident** — por exemplo, roteie `Disaster` e `High` para um incidente "Crítico" e todo o resto para "Maior". Construa um bloco **Create Incident** por ramificação.

## Solução de problemas

**O workflow nunca roda.**
- Confirme que o interruptor **Enabled** do workflow está ativado.
- No servidor Zabbix, confirme que ele consegue alcançar a URL: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. Você deve receber uma confirmação rápida.
- Verifique **Reports → Action log** no Zabbix para erros de entrega.

**O Zabbix reporta um erro de script.**
- Abra o tipo de mídia e use **Test** para enviar um payload de amostra. O Zabbix exibe a saída do script ou o erro lançado.
- Uma resposta não-2xx do OneUptime é exposta pelo `throw` no script — verifique se a URL do workflow está exatamente correta.

**O incidente é criado, mas os campos estão vazios.**
- Abra a aba **Logs** do workflow e inspecione a saída do gatilho. Confirme que os nomes de campo em **Request Body** correspondem ao que você referencia (`name`, `host`, `severity`, `status`, `event_id`).
- Um campo ausente resolve para uma string vazia em vez de um erro — veja [Variáveis → Armadilhas](/docs/workflows/variables#gotchas).

**Tudo dispara duas vezes.**
- Você provavelmente tem tanto uma operação de problema quanto um passo de escalonamento enviando para a mesma mídia. Verifique os passos de **Operations** da ação.

## Notas de segurança

- Trate a URL do webhook do workflow como uma senha. Se ela vazar, exclua o gatilho e crie um novo para rotacionar a URL.
- Restrinja as condições da ação do Zabbix para encaminhar apenas as severidades que justificam um incidente.
- Se você executa o OneUptime auto-hospedado atrás de um firewall, permita que o IP de saída do seu servidor Zabbix o alcance via HTTPS.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — os padrões de entrada/saída.
- [Gatilho Webhook](/docs/workflows/triggers#webhook) — como a URL receptora funciona.
- [Componentes](/docs/workflows/components) — Conditions, Create Incident e mais.
- [Variáveis](/docs/workflows/variables) — lendo o payload do Zabbix nos blocos seguintes.
