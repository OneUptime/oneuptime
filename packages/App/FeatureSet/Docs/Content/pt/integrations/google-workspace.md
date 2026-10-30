# Google Workspace

Importe os logs de auditoria do [Google Workspace](https://workspace.google.com) para os eventos de segurança do OneUptime: os logins e o que o Google sinalizou neles, as mudanças dos administradores, os aplicativos que receberam acesso a dados, o logon único, as configurações de segurança das próprias contas e, se quiser, os arquivos compartilhados fora da organização ou baixados no Google Drive. Lá você os pesquisa ao lado dos seus logs, traces e métricas, correlaciona-os com todas as outras fontes e aciona o plantão para os que importam. O OneUptime os lê com uma conta de serviço que age como um dos seus administradores, e não muda nada no Google Workspace.

:::cards
- [Configurar a conexão](#configurar-a-conexão): Uma conta de serviço, a delegação em todo o domínio e o formulário da conexão.
- [O que é importado](#o-que-é-importado): Quais atividades, e como cada uma vira um evento de segurança.
- [Como a consulta funciona](#como-a-consulta-funciona): A janela que cada consulta lê, e por que ela se sobrepõe 2 horas à anterior.
- [Solução de problemas](#solução-de-problemas): O que cada erro significa e o que mudar.
:::

## Como funciona

```mermaid title="De uma atividade do Google Workspace a um evento de segurança"
flowchart TB
    gws["O Google Workspace<br/>registra uma<br/>atividade"] --> poll["O OneUptime consulta<br/>no intervalo da<br/>conexão"]
    poll --> token["A conta de serviço<br/>age como o seu<br/>administrador"]
    token --> list["Lista as atividades<br/>de cada log desde<br/>a última vez"]
    list --> event["Cada um é salvo<br/>como evento OCSF<br/>do seu tipo"]
```

A cada minuto, o OneUptime consulta cada conexão habilitada cujo intervalo de consulta já passou. Uma consulta entra como a sua conta de serviço em nome do administrador que você indica, e lista as atividades de cada log de auditoria desde a última consulta ([Activities: list](https://developers.google.com/admin-sdk/reports/reference/rest/v1/activities/list)): administração, logins, tokens OAuth, SAML, segurança das contas e, quando a opção **Atividade do Drive** está ativada, o Drive. Cada evento de uma atividade é salvo como um evento [OCSF](https://schema.ocsf.io/): um login como um evento Authentication, uma função de administrador atribuída como um evento User Access Management, um login que o Google sinalizou como um Detection Finding.

## Antes de começar

- No OneUptime, a função Project Owner, Project Admin ou Security Admin. As funções Security Member e Security Viewer veem as conexões e o histórico de execuções delas, mas não podem alterá-las.
- Um superadministrador do Google Workspace, para permitir a delegação em todo o domínio, e um administrador como o qual a conta de serviço age, com o privilégio Reports. Um superadministrador tem esse privilégio.
- Um projeto do Google Cloud em que você possa criar uma conta de serviço e ativar a Admin SDK API.
- Para a atividade do Drive, uma edição com o log de auditoria do Drive, como Business Standard, Business Plus, Enterprise ou Education.
- HTTPS de saída do aplicativo e dos workers do OneUptime para `oauth2.googleapis.com` e `admin.googleapis.com`.

## Configurar a conexão

A conexão entra com a chave de uma conta de serviço e a [delegação em todo o domínio](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority), com um único escopo somente leitura: `https://www.googleapis.com/auth/admin.reports.audit.readonly`.

:::steps
### Criar uma conta de serviço e uma chave

1. No [console do Google Cloud](https://console.cloud.google.com), escolha um projeto, abra **APIs & Services → Library**, encontre **Admin SDK API** e selecione **Enable**.
2. Abra **IAM & Admin → Service accounts → Create service account**, dê o nome `oneuptime-security-events` e selecione **Done**. Ela não precisa de nenhuma função no projeto.
3. Abra a conta de serviço e copie o **Unique ID** dela, o ID do cliente que a delegação nomeia. Na guia **Keys**, selecione **Add key → Create new key → JSON**, e guarde o arquivo: ele é a chave.

### Permitir a delegação em todo o domínio

1. No [Google Admin Console](https://admin.google.com), como superadministrador, abra **Security → Access and data control → API controls → Manage domain-wide delegation** e selecione **Add new**.
2. Informe o **Unique ID** da conta de serviço como **Client ID**, e `https://www.googleapis.com/auth/admin.reports.audit.readonly` como o único **OAuth scope**. Selecione **Authorize**. O Google pode levar alguns minutos para aplicá-lo.

### Adicionar a conexão no OneUptime

Abra **Produtos → Security Events → Conexões** (`/dashboard/{projectId}/security-events/connections`), clique em **Adicionar conexão**, escolha **Google Workspace** em **Identidade** e clique em **Próximo**. Informe o **Administrator email**, clique em **Próximo** e cole o conteúdo do arquivo da chave em **JSON da conta de serviço**. Na etapa **Consulta periódica**, ative **Atividade do Drive** para ler também o Drive.

### Testar antes de salvar

Clique em **Testar estas configurações** em **Testar antes de salvar**. O teste entra e lê os logs de login e de administração com os valores do formulário, e não salva nada, então uma delegação que falta aparece antes de a conexão existir. Depois clique em **Próximo**, dê à conexão um **Nome** e crie-a.
:::

| Configuração | O que informar |
| --- | --- |
| **Administrator email** | O endereço do administrador como o qual a conta de serviço age, como `admin@example.com`. Ele precisa ter o privilégio Reports. |
| **Atividade do Drive** | Opcional, desativada por padrão. Ativada, cada consulta também lê os compartilhamentos e downloads do Drive. |
| **JSON da conta de serviço** | O arquivo da chave inteiro, que contém `client_email` e `private_key`. Ele é criptografado, nunca devolvido pela API e nunca mais mostrado. Substitua-o com **Atualizar credenciais** na conexão. |

A etapa **Consulta periódica** também tem uma **Descrição** opcional, o **Intervalo de consulta (minutos)**, um número inteiro de `1` a `1440` que começa em `5`, e **Habilitado**, que começa ativado.

## O que é importado

Todo evento tem o fornecedor `Google` e o produto `Google Workspace`. Uma atividade que contém vários eventos vira um evento de segurança para cada um, e todo evento mantém os campos da atividade e os seus próprios, como `event.name`, `event.type` e `parameters.<name>`, para que uma regra os leia pelos nomes do Google.

| Log | Eventos | Classe OCSF | Severidade |
| --- | --- | --- | --- |
| Logins (`login`) | `login_success`, `login_failure` com o motivo dele, `login_challenge`. Um logout é lido mas não importado. | Authentication (`3002`) | Informational; Low para uma falha; Medium quando o Google o marca como `is_suspicious` |
| Detecções do Google (`login`) | `suspicious_login` e as variantes dele, `gov_attack_warning`, `account_disabled_hijacked` e as outras contas que o Google desativou | Detection Finding (`2004`) | Medium; High para um ataque apoiado por um governo, uma conta sequestrada ou uma senha vazada |
| Administração (`admin`) | Privilégios e funções de administrador concedidos ou revogados, delegação em todo o domínio, usuários criados, excluídos ou suspensos, verificação em duas etapas desativada, membros de grupos, configurações | User Access Management (`3005`), Account Change (`3001`), Group Management (`3006`), Entity Management (`3004`) | Medium para um poder concedido; Low para um usuário excluído ou uma verificação em duas etapas desativada |
| Tokens OAuth (`token`) | Um aplicativo que recebeu acesso aos dados de alguém, com os escopos dele, ou que perdeu esse acesso | Authorize Session (`3003`) | Informational |
| SAML (`saml`) | Logon único em um aplicativo | Authentication (`3002`) | Low para uma falha |
| Segurança das contas (`user_accounts`) | Mudanças na verificação em duas etapas, na senha e na recuperação | Account Change (`3001`) | Low quando enfraquece a conta |
| Drive (`drive`), com a opção ativada | `change_user_access`, `change_document_visibility`, `change_document_access_scope`, `change_acl_editors`, `download` | File Hosting Activity (`6006`) | Low para um arquivo compartilhado fora do domínio do proprietário ou aberto a um link |

As regras da biblioteca para o Google Workspace os leem como são importados aqui, como as de um login que o Google sinalizou, privilégios de administrador concedidos e um arquivo tornado público no Drive.

## Como a consulta funciona

- **As atividades são lidas pelo momento em que aconteceram.** A Reports API não tem outro horário pelo qual listá-las, e o Google documenta que os logs dele chegam com minutos a horas de atraso.
- **A primeira consulta olha 24 horas para trás**, para que uma nova conexão mostre logo as atividades recentes dela.
- **Cada consulta seguinte começa 120 minutos antes do cursor salvo**, então uma atividade que o Google torna legível com até 2 horas de atraso é lida na consulta seguinte, e as duplicatas são descartadas pelo ID de cada evento dentro do projeto. Uma que chega depois disso não é lida pela consulta: importe o intervalo de tempo dela em **Diagnóstico**.
- **Uma consulta lê no máximo 24 horas além do cursor.** Uma conexão cujo cursor ficou para trás se atualiza em uma série de janelas de 24 horas.
- **O Drive é lido um evento por vez**, já que o Drive registra cada arquivo que alguém abre. Quando o Google recusa o log do Drive, a execução avisa, e os outros logs continuam sendo importados.
- **Uma execução que falha não muda nada.** Depois de um erro de rede, ou de um status de erro do Google, o cursor e o tamanho da janela ficam como estavam, e a consulta seguinte relê a mesma janela. A única exceção é uma requisição que expirou: o cursor fica, mas a janela seguinte tem a metade do tamanho, porque uma janela pesada demais para ser respondida a tempo expiraria em toda tentativa.

### Quando uma janela contém mais do que uma consulta consegue ler

Cada log tem um orçamento próprio, em páginas de 1.000 atividades: 10 para os logins, 5 cada para administração, tokens OAuth e SAML, 3 para a segurança das contas, e 4 para cada evento do Drive. Uma consulta para depois de 4 minutos. Quando um orçamento para um log antes do fim da janela dele, a execução fica **Parcial**, e o aviso dela nomeia o log e o orçamento. O Google lista primeiro as atividades mais novas, então o OneUptime encurta a janela em vez de mover o cursor para além de atividades que nunca alcançou:

1. **Reduzir.** A consulta seguinte lê uma janela com a metade do tamanho, a partir do mesmo ponto de partida, e continua dividindo pela metade até que uma janela seja lida por inteiro, até um minuto. O aviso da execução diz isso: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` As atividades já importadas da janela mais longa são puladas como duplicatas.
2. **Voltar a crescer.** Depois que uma janela é lida por inteiro, o cursor vai para o fim dela, e a janela seguinte volta a ter o dobro do tamanho, até 24 horas.
3. **Passar de um único minuto.** Se até um minuto contém mais do que uma consulta consegue ler, a consulta passa dele, para que as atividades mais novas continuem chegando. A execução continua **Parcial**, e **Último erro** mostra `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importe esse minuto com **Import this time range** para recuperar o que uma execução consegue ler.

Mudar o **Intervalo de consulta (minutos)** não muda nada disso: ele decide com que frequência uma consulta começa, não onde a janela dela começa.

### Executar, pré-visualizar e importar sob demanda

Clique em **Diagnóstico** em uma conexão para ver as execuções recentes dela e trabalhar com ela manualmente. Quem pode alterar a conexão pode iniciar essas ações; quem pode vê-la pode ler o histórico.

- **Executar agora** inicia uma consulta na hora, com o cursor de sempre, mesmo quando a conexão não está **Habilitado**.
- **Preview audit events** lê um intervalo de tempo de até 7 dias e não importa nada.
- **Import this time range** importa um intervalo de até 7 dias, depois que você confirma, sem mover o cursor. As atividades já importadas são puladas. O Google guarda 6 meses de logs de auditoria.
- **Copy diagnostics** em uma execução copia o relatório dela para o suporte. Ele nunca inclui credenciais.

## Testar conexão

**Testar conexão** na linha de uma conexão, e **Testar estas configurações** no formulário, rodam no processo da API, não em um worker em segundo plano, para que um teste responda mesmo quando o problema são os workers. Ele faz estas verificações, em ordem:

| Verificação | O que ela verifica |
| --- | --- |
| **Configuração** | O endereço do administrador e a chave estão bem formados. Nada é contatado quando isso falha. |
| **Authenticate with Google** | O Google deixa a conta de serviço agir como o administrador: a delegação em todo o domínio está configurada. |
| **Read the audit logs** | Os logs de login e de administração das últimas 24 horas podem ser lidos. |
| **Read Drive activity** | Só com a opção ativada: o log do Drive pode ser lido. |
| **Activities available to import** | Quantas atividades de login e de administração as últimas 24 horas contêm, no máximo 1.000 de cada, então `1000+` significa mais. Nenhuma é um aviso. |
| **Background workers**, **Poll scheduler**, **Security event storage** | O lado do próprio OneUptime: um processo pega os jobs da fila Worker, o job de consulta roda a cada minuto e o armazenamento de eventos de segurança responde. |
| **Scheduled polling** | Para uma conexão salva: a consulta está ativada, nenhuma execução está presa esperando um worker e as consultas rodam no horário. |

Cada requisição de um teste tem um prazo de 20 segundos. Um teste nunca importa nada nem move o cursor, e cada verificação que falha diz o que mudar.

## Solução de problemas

O **Último erro** da conexão guarda a mensagem de erro completa, com as credenciais ocultadas. Quando uma conexão tem um erro, selecione **Ver erro** na coluna **Ações** dela para lê-lo, e **Copiar erro** na caixa de diálogo para copiá-lo. Toda mensagem começa com `Google Workspace`, depois nomeia a requisição que falhou, e cita o próprio motivo do Google.

:::details Último erro diz `token request failed`
- `unauthorized_client`: a conta de serviço não tem delegação em todo o domínio para o escopo. Adicione o **Unique ID** dela com `https://www.googleapis.com/auth/admin.reports.audit.readonly` em **Manage domain-wide delegation**.
- `invalid_grant` com `Invalid email or User ID`: o **Administrator email** não é um usuário deste Google Workspace.
- `invalid_grant` com `Invalid JWT Signature`: a chave foi excluída ou desativada. Crie uma nova chave e salve-a com **Atualizar credenciais**.
:::

:::details Último erro diz `activities request failed (HTTP 403)`
- Motivo `SERVICE_DISABLED` ou `accessNotConfigured`: a Admin SDK API está desativada no projeto da conta de serviço. Ative-a e teste de novo em alguns minutos.
- Motivo `forbidden`: falta ao administrador o privilégio Reports. Atribua-o em **Account → Admin roles** no Google Admin Console, ou indique um superadministrador.
:::

:::details A atividade do Drive não é lida
O log do Drive precisa de uma edição que o tenha, e de um administrador com o privilégio Reports. Cada execução avisa `Drive activity was not read`, e os outros logs continuam sendo importados. Desative **Atividade do Drive** quando a sua edição não tiver log do Drive.
:::

:::details Último erro diz `did not complete`
A requisição não teve resposta: um tempo esgotado, um nome que não resolve ou um endereço recusado. Verifique se o aplicativo e os workers do OneUptime conseguem alcançar `oauth2.googleapis.com` e `admin.googleapis.com`, através de qualquer proxy que você use.
:::

:::details O teste passa, mas Last Polled é Never
O job de consulta nunca rodou. Leia as verificações **Background workers** e **Poll scheduler**. Em uma instalação auto-hospedada, a causa comum é `DISABLE_QUEUE_WORKERS=true` no aplicativo, sem um deployment separado de workers que pegue os jobs: defina como `false`, ou rode o deployment de workers (Helm: `worker.enabled: true`, que é `false` por padrão).
:::

## Próximos passos

:::cards
- [Eventos de segurança](/docs/telemetry/security-events): Pesquise, correlacione e alerte sobre o que você importa.
- [Microsoft Entra ID](/docs/integrations/microsoft-entra-id): Importe os logins e as mudanças de diretório da Microsoft.
- [Google SecOps](/docs/integrations/google-secops): Traga também as detecções do Google SecOps.
- [Visão geral das integrações](/docs/integrations/index): As outras ferramentas que você pode conectar.
:::
