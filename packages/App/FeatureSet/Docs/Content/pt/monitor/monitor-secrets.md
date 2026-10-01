# Segredos de Monitor

Você pode usar segredos para armazenar informações sensíveis que deseja usar em suas verificações de monitoramento. Os segredos são criptografados e armazenados com segurança.

### Adicionando um segredo

Para adicionar um segredo, vá para Painel do OneUptime -> Monitores -> Configurações -> Segredos -> Criar Segredo de Monitor.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

Dê um nome e um valor ao segredo e, em seguida, escolha na etapa **Acesso** quais monitores podem usá-lo. Neste caso, adicionamos um segredo `ApiKey`.

**Observe**: Os segredos são criptografados e armazenados com segurança. O valor nunca é exibido novamente depois de salvo — nem na tabela, nem no formulário de edição, nem pela API. Se você perder o valor, precisará obtê-lo na origem e defini-lo de novo. Para rotacionar um segredo, use o botão **Atualizar Valor do Segredo** na linha dele; não é preciso excluir e recriar.

### Escolher quais monitores podem usar um segredo

Cada segredo tem uma destas três opções de acesso:

- **Todos os monitores**: todos os monitores do projeto podem usar o segredo, incluindo os que você criar depois. Use esta opção para uma credencial compartilhada por muitos monitores.
- **Monitores específicos**: somente os monitores que você escolher podem usar o segredo. Esta é a opção padrão, e os segredos criados antes da existência dessas opções funcionam assim.
- **Monitores com rótulos**: monitores que têm pelo menos um dos rótulos escolhidos podem usar o segredo. Adicionar um desses rótulos a um monitor dá acesso a ele, e remover o rótulo retira o acesso na próxima vez que o monitor for executado.

Você pode mudar a opção a qualquer momento com **Editar** na linha do segredo. Somente a lista da opção escolhida é mantida: mudar para **Todos os monitores** esvazia as listas de monitores e de rótulos do segredo, e alternar entre **Monitores específicos** e **Monitores com rótulos** esvazia a lista que você deixou.

Um segredo nunca fica disponível para monitores de outro projeto.

Qualquer pessoa que possa editar um monitor com acesso a um segredo pode enviar esse segredo para qualquer destino ao qual o monitor se conecte. Com **Todos os monitores**, isso inclui qualquer pessoa que possa criar ou editar monitores no projeto. Com **Monitores com rótulos**, inclui também qualquer pessoa que possa adicionar um desses rótulos a um monitor.

Na API, a opção de acesso é o campo `monitorAccess`: `All Monitors`, `Specific Monitors` ou `Monitors With Labels`. Os campos `monitors` e `labels` contêm as listas. Um segredo criado sem `monitorAccess` recebe `Specific Monitors`.

### Usando um segredo

Você pode usar segredos nos seguintes tipos de monitoramento:

- API (em cabeçalhos de requisição, corpo de requisição e URL)
- Site, IP, Porta, Ping, Certificado SSL (na URL)
- Monitor Sintético, Monitor de Código Personalizado (no código)
- Monitor SNMP (em string de comunidade, chave de autenticação SNMPv3 e chave privada)

![Using Secret](/docs/static/images/UsingMonitorSecret.png)

Para usar um segredo, adicione `{{monitorSecrets.SECRET_NAME}}` no campo onde deseja usar o segredo. Por exemplo, neste caso adicionamos `{{monitorSecrets.ApiKey}}` no campo Request Header.

Os segredos são injetados na probe antes que os scripts do Monitor Sintético ou de Código Personalizado sejam executados, então referências como `{{monitorSecrets.ApiKey}}` resolvem para o valor decriptografado dentro do script em execução.

Se um monitor fizer referência a um segredo que não pode usar, a referência fica como está e não é substituída pelo valor.

Ao testar um monitor antes de salvá-lo, somente os segredos disponíveis para **Todos os monitores** são preenchidos, porque um monitor novo não está em nenhuma lista e ainda não tem rótulos. Depois que o monitor for salvo, os testes usam todos os segredos aos quais ele tem acesso.
