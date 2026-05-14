# Guia de Instalação para macOS

Instale o OneUptime como um aplicativo de desktop nativo no macOS para monitoramento e gerenciamento de incidentes perfeitos.

## Métodos de Instalação

### Método 1: Safari (Recomendado para macOS)

O Safari fornece excelente integração de PWA com recursos nativos do macOS.

1. **Abrir o OneUptime no Safari**
   - Inicie o navegador Safari
   - Navegue para a URL da sua instância do OneUptime
   - Faça login na sua conta do OneUptime
   - Aguarde a página carregar completamente

2. **Instalar PWA**
   - Clique em **Arquivo** na barra de menus
   - Selecione **"Adicionar ao Dock"** (macOS Sonoma+)
   - Ou procure o **ícone de instalação** na barra de endereços
   - Alternativamente: **Arquivo** → **"Adicionar à Tela Inicial"** (macOS mais antigo)

3. **Personalizar Instalação**
   - **Nome do Aplicativo**: Modifique se desejar (padrão: OneUptime)
   - **Dock**: Escolha adicionar ao Dock
   - **Launchpad**: Adicione ao Launchpad para fácil acesso

4. **Iniciar Aplicativo**
   - Encontre o OneUptime no Dock, Launchpad ou pasta Aplicativos
   - Clique para iniciar em uma janela dedicada
   - O aplicativo é executado independentemente do navegador Safari

### Método 2: Google Chrome

O Chrome oferece suporte robusto a PWA com excelente integração de área de trabalho.

1. **Abrir o OneUptime no Chrome**
   - Inicie o Google Chrome
   - Vá para a sua instância do OneUptime
   - Certifique-se de estar conectado
   - Permita o carregamento completo da página

2. **Instalar via Menu**
   - Procure o **ícone de instalação** (⊞) na barra de endereços
   - Clique em **"Instalar OneUptime"**
   - Ou use **menu do Chrome** → **Mais ferramentas** → **Criar atalho**

3. **Opções de Instalação**
   - Marque **"Abrir como janela"** para experiência de aplicativo nativo
   - Personalize o nome do aplicativo se necessário
   - Clique em **"Instalar"** ou **"Criar"**

4. **Acessar Aplicativo**
   - Encontre o OneUptime na pasta Aplicativos
   - Ou acesse via pesquisa Spotlight
   - Fixe no Dock para acesso rápido

### Método 3: Microsoft Edge

O Edge fornece bom suporte a PWA com boa integração com macOS.

1. **Abrir o OneUptime no Edge**
   - Inicie o Microsoft Edge
   - Navegue para a URL do OneUptime
   - Conclua o processo de login

2. **Instalar Aplicativo**
   - Clique no **menu de três pontos** → **Aplicativos** → **Instalar este site como aplicativo**
   - Ou procure o prompt de instalação na barra de endereços
   - Personalize o nome do aplicativo se desejar
   - Clique em **"Instalar"**

### Opções de Personalização

### Dock e Launchpad
1. **Posição no Dock**: Arraste o OneUptime para a posição preferida no Dock
2. **Tamanho no Dock**: Redimensione o ícone nas preferências do Dock
3. **Organização do Launchpad**: Crie pasta de aplicativos de monitoramento
4. **Notificações de Emblema**: Mostrar contagem de incidentes no ícone do Dock

### Barra de Menus e Notificações
1. **Central de Notificações**
   - Preferências do Sistema → Notificações → OneUptime
   - Configure estilos de alerta e entrega
   - Defina níveis de prioridade para diferentes tipos de incidentes

2. **Integração com a Barra de Menus**
   - Barra de menus nativa para PWAs do Safari
   - Itens de menu personalizados para ações frequentes
   - Atalhos de teclado para tarefas comuns

## Solução de Problemas

### Problemas de Instalação

**"Adicionar ao Dock" não disponível no Safari:**
```
Soluções:
1. Certifique-se de ter macOS Sonoma (14.0) ou posterior
2. Atualize o Safari para a versão mais recente
3. Tente a alternativa: Arquivo → Adicionar à Tela Inicial
4. Limpe o cache do Safari e tente novamente
5. Use Chrome ou Edge como alternativa
```

**O PWA não instala ou trava:**
```
Soluções:
1. Verifique a compatibilidade da versão do macOS
2. Certifique-se de ter espaço em disco suficiente (100MB+)
3. Atualize o navegador para a versão mais recente
4. Limpe o cache e os cookies do navegador
5. Desabilite temporariamente as extensões do navegador
6. Reinicie o Mac e tente a instalação novamente
```

**Aplicativo não aparece em Aplicativos:**
```
Soluções:
1. Verifique o Launchpad para o ícone do OneUptime
2. Pesquise com o Spotlight (⌘+Espaço)
3. Procure na seção de gerenciamento de PWA do navegador
4. Tente reinstalar com um navegador diferente
5. Verifique se foi instalado com um nome diferente
```

### Problemas de Notificação

**Notificações do macOS não estão funcionando:**
```
Soluções:
1. Preferências do Sistema → Notificações → OneUptime
2. Habilite "Permitir notificações"
3. Defina o estilo de alerta apropriado (banners/alertas)
4. Verifique as configurações de Não Perturbe
5. Verifique as configurações de notificação do OneUptime
6. Conceda permissões de notificação quando solicitado
```

## Desinstalação

### Remoção Completa
1. **Método da Pasta Aplicativos**
   - Abra a pasta Aplicativos
   - Encontre o OneUptime
   - Arraste para a Lixeira ou clique com o botão direito → Mover para a Lixeira

2. **Método do Dock**
   - Clique com o botão direito no OneUptime no Dock
   - Selecione "Opções" → "Remover do Dock"
   - Em seguida, exclua da pasta Aplicativos

3. **Gerenciamento de PWA do Navegador**
   - **Chrome**: chrome://apps/ → Encontre o OneUptime → Remover
   - **Edge**: edge://apps/ → Encontre o OneUptime → Desinstalar
   - **Safari**: Sem página de gerenciamento dedicada

### Desinstalação Limpa
Remova todos os dados associados:

```bash
# Limpar dados PWA do Safari (dados gerais de sites)
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# Limpar dados PWA do Chrome
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# Limpar dados PWA do Edge
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## Atualizações e Manutenção

### Atualizações Automáticas
- O PWA do OneUptime é atualizado automaticamente quando online
- Não são necessárias atualizações da App Store
- Novos recursos disponíveis imediatamente
- Atualizações críticas aplicadas instantaneamente

### Processo de Atualização Manual
Force a atualização do aplicativo:
1. **PWAs do Safari**: Atualize dentro do navegador Safari
2. **PWAs do Chrome**: Clique com o botão direito no aplicativo → Recarregar ou ⌘+R
3. **Atualização Completa**: Feche o aplicativo, reabra o navegador, visite o OneUptime

### Programação de Manutenção
Manutenção regular para desempenho ideal:

**Semanalmente:**
- Reinicie o aplicativo OneUptime
- Limpe o cache do navegador se estiver com problemas
- Verifique se há atualizações do macOS

**Mensalmente:**
- Revise o uso do armazenamento e limpe se necessário
- Atualize os navegadores se não estiverem atualizando automaticamente
- Verifique se as configurações de notificação ainda funcionam

## Integração com Recursos do macOS

### Integração com o Aplicativo Atalhos
Crie atalhos personalizados para o OneUptime:
1. Abra o aplicativo **Atalhos**
2. Crie um **Novo Atalho**
3. Adicione a ação **"Abrir Aplicativo"**
4. Selecione **OneUptime**
5. Adicione à Siri para ativação por voz

### Integração com o Automator
Automatize tarefas do OneUptime:
1. Inicie o **Automator**
2. Crie um **Aplicativo** ou **Fluxo de Trabalho**
3. Adicione a ação **"Iniciar Aplicativo"**
4. Selecione o PWA do OneUptime
5. Adicione etapas de automação adicionais

### Integração com o Terminal
Gerencie o OneUptime pelo Terminal:

```bash
# Criar alias para inicialização rápida do OneUptime
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# Função para verificar se o OneUptime está em execução
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime está em execução"
    else
        echo "OneUptime não está em execução"
    fi
}
```

## Segurança e Privacidade

### Recursos de Segurança do macOS
1. **Gatekeeper**: Certifique-se de que as instalações de PWA são de fontes confiáveis
2. **System Integrity Protection**: Protege os arquivos do sistema
3. **FileVault**: Criptografe o disco para proteção de dados
4. **Keychain**: Armazenamento seguro de credenciais

### Considerações de Privacidade
1. **Serviços de Localização**: Configure se necessário para monitoramento
2. **Câmera/Microfone**: Conceda permissões conforme necessário
3. **Gravação de Tela**: Pode ser necessário para certos recursos de monitoramento
4. **Acesso à Rede**: Certifique-se de que a configuração do firewall seja adequada

### Melhores Práticas
1. **Atualizações Regulares**: Mantenha o macOS e os navegadores atualizados
2. **Autenticação Forte**: Use Touch ID/Face ID quando disponível
3. **Segurança de Rede**: Use VPN para acesso remoto de monitoramento
4. **Backup de Dados**: Backups regulares do Time Machine incluem dados do PWA
5. **Revisão de Permissões**: Revise regularmente as permissões concedidas
