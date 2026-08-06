# Segredos de Monitor

Você pode usar segredos para armazenar informações sensíveis que deseja usar em suas verificações de monitoramento. Os segredos são criptografados e armazenados com segurança.

### Adicionando um segredo

Para adicionar um segredo, vá para Painel do OneUptime -> Monitores -> Configurações -> Segredos -> Criar Segredo de Monitor.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

Você pode selecionar quais monitores têm acesso ao segredo. Neste caso, adicionamos o segredo `ApiKey` e selecionamos monitores para ter acesso a ele.

**Observe**: Os segredos são criptografados e armazenados com segurança. O valor nunca é exibido novamente depois de salvo — nem na tabela, nem no formulário de edição, nem pela API. Se você perder o valor, precisará obtê-lo na origem e defini-lo de novo. Para rotacionar um segredo, use o botão **Update Secret Value** na linha dele; não é preciso excluir e recriar.

### Usando um segredo

Você pode usar segredos nos seguintes tipos de monitoramento:

- API (em cabeçalhos de requisição, corpo de requisição e URL)
- Site, IP, Porta, Ping, Certificado SSL (na URL)
- Monitor Sintético, Monitor de Código Personalizado (no código)
- Monitor SNMP (em string de comunidade, chave de autenticação SNMPv3 e chave privada)

![Using Secret](/docs/static/images/UsingMonitorSecret.png)

Para usar um segredo, adicione `{{monitorSecrets.SECRET_NAME}}` no campo onde deseja usar o segredo. Por exemplo, neste caso adicionamos `{{monitorSecrets.ApiKey}}` no campo Request Header.

Os segredos são injetados na probe antes que os scripts do Monitor Sintético ou de Código Personalizado sejam executados, então referências como `{{monitorSecrets.ApiKey}}` resolvem para o valor decriptografado dentro do script em execução.

### Permissões de Segredos de Monitor

Você pode selecionar quais monitores têm acesso ao segredo. Você também pode atualizar as permissões a qualquer momento. Portanto, se quiser adicionar um novo monitor para ter acesso ao segredo, pode fazê-lo atualizando as permissões.
