# Migrar do Pingdom

**Importar de outra ferramenta** traz suas verificações de disponibilidade do Pingdom para o OneUptime em poucos minutos. Com um token de API do Pingdom somente leitura, o OneUptime lê suas verificações, mostra o que encontrou e cria o que você marcar. Nada muda no Pingdom.

:::cards
- [Importe sua conta](#importe-sua-conta-do-pingdom): Crie um token, leia sua conta e marque o que trazer.
- [O que é trazido](#o-que-é-trazido): Que monitor do OneUptime cada verificação do Pingdom vira.
- [Conclua a troca](#conclua-a-troca): O que fazer quando a importação terminar.
:::

## Como funciona

```mermaid title="De um token de API do Pingdom a um relatório"
flowchart TB
    key["Token de API<br/>somente leitura"] --> read["O OneUptime lê<br/>sua conta do Pingdom"]
    read --> preview["Você vê o que foi encontrado<br/>e marca o que trazer"]
    preview --> import["A importação roda<br/>em segundo plano"]
    import --> report["Um relatório leva a<br/>cada registro criado"]
```

- **A chave é usada uma vez.** Ela fica criptografada enquanto o OneUptime lê sua conta e é excluída assim que a leitura termina, tenha funcionado ou não. Nunca é mostrada de novo nem gravada em um log.
- **O OneUptime só lê.** Ele chama apenas a API do Pingdom: `api.pingdom.com`. O Pingdom desconta cada requisição da cota do token, então o OneUptime só lê as configurações de uma verificação quando ela tem alguma, uma requisição de cada vez. Quando o Pingdom pede para ir mais devagar, ele espera e tenta de novo.
- **Nada é criado até você iniciar a importação.** A pré-visualização mostra, para cada item, se ele é novo, se já está no OneUptime (e é usado como está), se foi trazido por uma importação anterior ou por que não pode ser trazido.
- **Executá-la de novo nunca cria nada em dobro.** O OneUptime lembra o que cada importação trouxe, pelo ID do Pingdom. Execute de novo depois de adicionar verificações no Pingdom, e só os novos são criados.

## Antes de começar

- **Um projeto do OneUptime e o direito de criar o que você traz.** Proprietários e administradores do projeto podem trazer tudo. Outros papéis também podem executar uma importação e trazer os tipos de registro que podem criar. O resto aparece como não trazido, com o motivo.
- **Um token de API do Pingdom com Read access.** A importação nunca grava no Pingdom.
- **Uma forma de pagamento, no OneUptime Cloud.** Monitores que fazem verificações são cobrados conforme o uso, mesmo no plano Free, então adicione uma em **Configurações do projeto** > **Cobrança** antes de importar. Sem ela, esses monitores aparecem como não trazidos.

## Importe sua conta do Pingdom

:::steps
### Crie um token de API no Pingdom
No My Pingdom, abra **Settings** > **Pingdom API** e selecione **Add API token**. Dê a ele o nome `OneUptime import`, escolha **Read access** e copie o token.

### Abra a página de importação
No OneUptime, vá em **Configurações do projeto** > **Importar de outra ferramenta** e selecione **Pingdom**.

### Conecte o Pingdom
Cole o token em **Chave de API do Pingdom** e selecione **Ler minha conta do Pingdom**. Uma conta grande leva alguns minutos, e você pode sair da página enquanto ela é lida.

### Marque o que trazer
A pré-visualização lista o que foi encontrado, com uma seção por tipo. Tudo o que seria criado começa marcado, exceto verificações pausadas no Pingdom, que são trazidas pausadas se você as marcar. Abaixo de cada item, o OneUptime diz o que não será trazido exatamente como era.

### Inicie a importação
Selecione **Iniciar importação**. A importação roda em segundo plano: você pode sair da página, e o relatório espera por você lá.
:::

O relatório conta o que foi criado e não trazido, e lista cada item com um link para o registro em que ele se transformou, falhas primeiro. As importações anteriores aparecem em **Importações anteriores** na mesma página.

## O que é trazido

| No Pingdom | No OneUptime | Como |
| --- | --- | --- |
| Uptime checks | Monitores | Cada verificação vira um monitor do mesmo tipo, com o mesmo endereço, intervalo e o texto que uma página deve, ou não deve, conter. |

- **Verificações HTTP** viram monitores de site, ou monitores de API quando enviam dados ou cabeçalhos.
- **Verificações de ping e TCP** viram monitores de ping e de porta. **Verificações SMTP, POP3 e IMAP** viram monitores de porta na porta delas: o OneUptime verifica se a porta responde, não a conversa de e-mail.
- **Verificações DNS** viram monitores DNS que perguntam ao mesmo servidor de nomes.
- **Verificações de certificado.** Uma verificação HTTP que trata um certificado prestes a expirar como queda ganha também um monitor de certificado SSL, com o nome dela, que avisa com os mesmos dias de antecedência.

Cada monitor é verificado pelas sondas do seu projeto, como um que você mesmo cria. Um intervalo que o OneUptime não oferece vira o mais próximo que ele oferece, e um tempo limite de mais de um minuto vira um minuto. A pré-visualização avisa quando algum dos dois muda.

## O que não é trazido

- **O histórico de disponibilidade, os tempos de resposta e os incidentes.** O OneUptime começa a verificar quando a importação termina.
- **Os contatos de alerta e as integrações.** Escolha quem é avisado no OneUptime, como descrito em [Conclua a troca](#conclua-a-troca).
- **Senhas, e cabeçalhos que podem conter um segredo.** Um monitor que faz login, ou que envia um cabeçalho `Authorization`, de cookie ou de token, é trazido sem ele: adicione-o com um [segredo de monitor](/docs/monitor/monitor-secrets).
- **Verificações UDP, HTTP personalizadas e de transação.** O OneUptime não tem monitor que faça o mesmo, e a pré-visualização nomeia cada uma. Um [monitor sintético](/docs/monitor/synthetic-monitor) pode percorrer uma página como uma verificação de transação faz.
- **O endereço que uma verificação DNS espera.** Adicione-o como critério no OneUptime.
- **Janelas de manutenção.** A pré-visualização as conta: planeje-as como manutenção programada no OneUptime.

## Limites

Uma importação cria no máximo 2.000 registros, e no máximo 1.000 monitores. O que passar de um limite aparece como não trazido. Execute a importação de novo para trazer o restante.

No OneUptime Cloud, monitores que fazem verificações precisam de uma forma de pagamento, e o que não cabe no seu plano aparece como não trazido, com o que precisa.

Uma pré-visualização é guardada por um dia. Só a pessoa que leu a conta pode marcar itens e iniciá-la. Proprietários e administradores do projeto veem o progresso e o relatório de cada importação.

## Conclua a troca

:::steps
### Confira seus monitores
Abra cada um em **Monitores** e confira os primeiros resultados. Um monitor de heartbeat tem um novo endereço: aponte para ele a tarefa que o chama.

### Escolha quem é avisado
Adicione proprietários aos seus monitores, ou uma política de plantão em **Plantão** > **Políticas de plantão** aos incidentes que eles abrem, para que as pessoas certas saibam quando algo cair.

### Desative as verificações no Pingdom
Quando o OneUptime verificar as mesmas coisas, pause as verificações no Pingdom para ninguém ser avisado duas vezes.
:::

## Solução de problemas

:::details O Pingdom não aceitou a chave de API
Confira se você copiou o token inteiro e se ele é um token da API 3.1 criado em **Pingdom API** com **Read access**. Depois selecione **Tentar novamente**.
:::

:::details Um monitor aparece como não trazido
Ele diz o motivo: um tipo de monitor que o OneUptime não tem, um endereço que o OneUptime não consegue ler, ou um projeto sem espaço ou sem forma de pagamento para ele. Um monitor que o OneUptime já executa, com o mesmo nome, tipo e endereço, é usado como está.
:::

:::details Alguns itens não podem ser marcados
Cada um diz o motivo: um nome que o projeto já tem, algo que uma importação anterior trouxe, ou um registro que você não tem permissão para criar ou que seu plano não inclui.
:::

## Próximos passos

:::cards
- [Monitor de site](/docs/monitor/website-monitor): O que um monitor de site verifica, e como.
- [Monitor de porta](/docs/monitor/port-monitor): O que um monitor de porta verifica, e como.
- [Migrar do StatusCake](/docs/moving-to-oneuptime/statuscake): Traga suas verificações do StatusCake.
:::
