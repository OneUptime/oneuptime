# Guia de Instalação para Android

Instale o OneUptime como um aplicativo nativo no seu dispositivo Android para a melhor experiência de monitoramento.

## Métodos de Instalação

### Método 1: Navegador Chrome (Recomendado)

1. **Abrir o OneUptime no Chrome**
   - Inicie o Google Chrome no seu dispositivo Android
   - Navegue para a URL da sua instância do OneUptime
   - Aguarde a página carregar completamente

2. **Prompt de Instalação**
   - Procure o banner "Adicionar à Tela Inicial" na parte inferior
   - Toque em "Instalar" ou "Adicionar à Tela Inicial"
   - Se não ver o prompt, toque no menu de três pontos (⋮) no canto superior direito

3. **Instalação Manual via Menu**
   - Toque no menu do Chrome (três pontos)
   - Selecione "Adicionar à Tela Inicial" ou "Instalar Aplicativo"
   - Personalize o nome do aplicativo se desejar
   - Toque em "Adicionar" para confirmar

4. **Iniciar o Aplicativo**
   - Encontre o ícone do OneUptime na sua tela inicial ou gaveta de aplicativos
   - Toque para iniciar o aplicativo em modo de tela cheia

### Método 2: Samsung Internet

1. **Abrir o OneUptime**
   - Inicie o navegador Samsung Internet
   - Vá para a sua instância do OneUptime
   - Aguarde o carregamento completo da página

2. **Adicionar à Tela Inicial**
   - Toque no botão de menu (três linhas)
   - Selecione "Adicionar página a" → "Tela inicial"
   - Insira o nome do aplicativo e toque em "Adicionar"

3. **Iniciar**
   - Encontre o ícone do aplicativo na sua tela inicial
   - Toque para abrir o OneUptime no modo de aplicativo

### Método 3: Firefox

1. **Abrir o OneUptime**
   - Inicie o navegador Firefox
   - Navegue para a sua URL do OneUptime
   - Permita que a página carregue completamente

2. **Instalar**
   - Toque no menu de três pontos
   - Selecione "Instalar" (se disponível)
   - Ou selecione "Adicionar à Tela Inicial"
   - Confirme a instalação

### Opções de Personalização

### Nome do Aplicativo
- Durante a instalação, você pode personalizar o nome do aplicativo
- Padrão: "OneUptime"
- Recomendado: Mantenha como "OneUptime" ou adicione o nome da sua empresa

### Configurações de Notificação
1. **Conceder Permissões**
   - Permita notificações quando solicitado
   - Vá para Configurações → Aplicativos → OneUptime → Notificações
   - Habilite todas as categorias de notificação para a melhor experiência

2. **Personalizar Alertas**
   - Configure quais incidentes acionam notificações
   - Defina níveis de prioridade de notificação
   - Escolha preferências de som e vibração

## Solução de Problemas

### Problemas de Instalação

**"Adicionar à Tela Inicial" não aparecendo:**
```
1. Limpe o cache e os cookies do navegador
2. Certifique-se de estar em HTTPS (conexão segura)
3. Aguarde 2-3 minutos na página antes de procurar o prompt
4. Verifique se os requisitos de PWA são atendidos na sua instância do OneUptime
```

**Instalação falha:**
```
1. Libere espaço de armazenamento (precisa de pelo menos 50MB)
2. Atualize seu navegador para a versão mais recente
3. Reinicie o navegador e tente novamente
4. Tente um navegador diferente (Chrome recomendado)
```

**Ícone do aplicativo não aparece:**
```
1. Verifique a tela inicial e a gaveta de aplicativos
2. Procure na seção "Adicionados recentemente" dos aplicativos
3. Pesquise por "OneUptime" na gaveta de aplicativos
4. Reinstale se necessário
```

### Problemas de Notificação

**Não está recebendo notificações:**
```
1. Verifique as permissões de notificação:
   - Configurações → Aplicativos → OneUptime → Permissões → Notificações
2. Certifique-se de que as notificações estão habilitadas no painel do OneUptime
3. Verifique as configurações de Não Perturbe
4. Verifique se as configurações de otimização de bateria não bloqueiam o OneUptime
```

**Notificações atrasadas:**
```
1. Desabilite a otimização de bateria para o OneUptime:
   - Configurações → Aplicativos → OneUptime → Bateria → Otimizar uso de bateria
2. Permita atividade em segundo plano
3. Verifique as configurações de economia de dados
```

## Desinstalação

### Remover Aplicativo
1. **Pressione e segure** o ícone do OneUptime na tela inicial
2. Selecione **"Desinstalar"** ou arraste para a lixeira
3. Confirme a remoção

### Método Alternativo
1. Vá para **Configurações → Aplicativos**
2. Encontre **"OneUptime"**
3. Toque em **"Desinstalar"**
4. Confirme a remoção

### Limpar Dados
- Desinstalar remove todos os dados em cache
- Os dados da sua conta no OneUptime permanecem seguros no servidor
- A reinstalação exigirá novo login

## Configuração Avançada

### Opções do Desenvolvedor
Para usuários avançados que desejam inspecionar o PWA:
1. Habilite as Opções do Desenvolvedor no Android
2. Conecte-se ao computador com ADB
3. Use o Chrome DevTools para depuração remota

### Configuração de Rede
- Configure VPN se acessar a instância interna do OneUptime
- Configure as configurações de proxy se exigido pela sua organização
- Certifique-se de que o firewall permita recursos PWA

## Atualizações

O PWA do OneUptime é atualizado automaticamente:
- **Atualizações Automáticas**: O aplicativo é atualizado quando você visita enquanto está online
- **Sem Atualizações Manuais**: Ao contrário dos aplicativos de loja, nenhuma ação do usuário é necessária
- **Atualizações Instantâneas**: Novos recursos disponíveis imediatamente
- **Rollback Seguro**: Atualizações com problemas podem ser revertidas rapidamente

## Melhores Práticas

### Para Desempenho Ideal
1. **Primeiro Lançamento**: Sempre online para a configuração inicial
2. **Uso Regular**: Abra o aplicativo regularmente para manter o cache atualizado
3. **Gerenciamento de Armazenamento**: Mantenha espaço livre suficiente
4. **Rede**: Use Wi-Fi para a instalação inicial e atualizações importantes

### Recomendações de Segurança
1. **Somente HTTPS**: Instale apenas de instâncias seguras do OneUptime
2. **URLs Oficiais**: Verifique se você está instalando da URL oficial do OneUptime da sua organização
3. **Permissões**: Conceda apenas as permissões necessárias
4. **Atualizações**: Mantenha seu Android OS e navegadores atualizados
