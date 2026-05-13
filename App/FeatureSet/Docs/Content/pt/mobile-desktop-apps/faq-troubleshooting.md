# Perguntas Frequentes e Solução de Problemas

Perguntas frequentes e soluções para Aplicativos Móveis e Desktop do OneUptime (PWA).

## Perguntas Frequentes Gerais

### O que é um Progressive Web App (PWA)?

Um Progressive Web App é um aplicativo web que usa tecnologias web modernas para oferecer experiências semelhantes a aplicativos. Os PWAs podem ser instalados diretamente dos navegadores sem lojas de aplicativos, funcionam offline, enviam notificações push e se integram ao sistema operacional do seu dispositivo.

### Por que o OneUptime não usa lojas de aplicativos tradicionais?

O OneUptime usa tecnologia PWA porque oferece várias vantagens:
- **Atualizações Instantâneas**: Sem esperar aprovação da loja de aplicativos ou atualizações manuais
- **Multiplataforma**: Uma única base de código funciona em todos os dispositivos
- **Sem Limites de Tamanho de Download**: Recursos completos sem restrições de tamanho
- **Distribuição Direta**: Instale diretamente da sua instância do OneUptime
- **Sempre Atualizado**: Os usuários sempre têm a versão mais recente
- **Segurança**: Mesmos benefícios de segurança que aplicativos web


### Quanto armazenamento o PWA do OneUptime usa?

- **Instalação Inicial**: 10-20MB
- **Crescimento do Cache**: 50-100MB com uso regular
- **Cache Máximo**: Tipicamente limitado a 200MB pelos navegadores
- **Limpeza Automática**: Os navegadores gerenciam automaticamente o armazenamento

### O PWA do OneUptime suporta notificações push?

Sim, o PWA do OneUptime suporta notificações push avançadas:
- **Alertas de Incidentes**: Notificações de incidentes em tempo real
- **Atualizações de Status**: Alertas de mudança de status do monitor
- **Gatilhos Personalizados**: Configure regras de notificação
- **Conteúdo Avançado**: Imagens, ações e informações detalhadas
- **Atualizações de Emblema**: Contagem de não lidos no ícone do aplicativo

## Perguntas Frequentes sobre Instalação

### Por que não vejo o botão "Instalar"?

Razões comuns e soluções:
1. **Compatibilidade do Navegador**: Use Chrome, Edge ou Safari
2. **HTTPS Necessário**: Certifique-se de que a instância do OneUptime usa HTTPS
3. **Requisitos de PWA**: O servidor deve atender aos requisitos de manifesto PWA
4. **Problemas de Cache**: Limpe o cache do navegador e recarregue
5. **Já Instalado**: O aplicativo pode já estar instalado
6. **Tempo de Espera**: Alguns navegadores precisam de 30+ segundos na página

### Posso instalar em múltiplos dispositivos?

Sim! Você pode instalar o PWA do OneUptime em:
- Dispositivos ilimitados por usuário
- Múltiplos navegadores no mesmo dispositivo
- Diferentes sistemas operacionais
- Dispositivos compartilhados/familiares (com contas separadas)

### Como atualizo o aplicativo instalado?

O PWA do OneUptime é atualizado automaticamente:
- **Atualizações Automáticas**: O aplicativo é atualizado quando você visita enquanto está online
- **Atualizações em Segundo Plano**: Atualizações são baixadas em segundo plano
- **Disponibilidade Imediata**: Novos recursos disponíveis instantaneamente
- **Sem Ação do Usuário**: Ao contrário dos aplicativos de loja, não são necessárias atualizações manuais

### Posso personalizar o nome do aplicativo durante a instalação?

Sim, durante a instalação você pode:
- Alterar o nome do aplicativo (padrão: "OneUptime")
- Adicionar o nome da sua organização
- Usar convenção de nomenclatura personalizada
- Modificar o rótulo do ícone (dependente da plataforma)

### Como desinstalo o PWA do OneUptime?

A desinstalação varia por plataforma:

**Android:**
- Pressione e segure o ícone do aplicativo → Desinstalar
- Configurações → Aplicativos → OneUptime → Desinstalar

**iOS:**
- Pressione e segure o ícone do aplicativo → Remover Aplicativo → Excluir Aplicativo

**Windows:**
- Configurações → Aplicativos → OneUptime → Desinstalar
- Clique com o botão direito no item do Menu Iniciar → Desinstalar

**macOS:**
- Arraste de Aplicativos para a Lixeira
- Clique com o botão direito no ícone do Dock → Remover

**Linux:**
- Remova do iniciador de aplicativos
- Exclua o arquivo .desktop


## Perguntas Frequentes sobre Notificações

### Por que não estou recebendo notificações?

Problemas comuns de notificação e correções:

**Verificar Permissões:**
```
1. Permissões de notificação do navegador habilitadas
2. Permissões de notificação do sistema operacional
3. Configurações de notificação do OneUptime configuradas
4. Modo Não Perturbe desabilitado
```

**Específico por Plataforma:**
- **Android**: Verifique as configurações de otimização de bateria
- **iOS**: Verifique as configurações de notificação no aplicativo Configurações
- **Windows**: Verifique as configurações de Assistência de Foco
- **macOS**: Verifique as permissões do centro de notificações
- **Linux**: Verifique o status do daemon de notificação

### Posso personalizar os sons de notificação?

Opções de personalização de notificação:
- **Sons do Sistema**: Use as configurações de som de notificação do OS
- **Configurações do Navegador**: Configure nas preferências de notificação do navegador
- **Configurações do OneUptime**: Defina preferências de notificação no painel
- **Níveis de Prioridade**: Configure diferentes sons para níveis de severidade

### Como desabilito notificações temporariamente?

Desabilitar notificações temporariamente:
- **Não Perturbe**: Habilite o modo DND do sistema
- **Configurações do Navegador**: Desabilite as notificações do site temporariamente
- **Painel do OneUptime**: Pause as notificações nas configurações
- **Modos de Foco**: Use os modos de foco/concentração do OS

## Perguntas Frequentes sobre Segurança

### O PWA do OneUptime é seguro?

Recursos e considerações de segurança:
- **Criptografia HTTPS**: Todos os dados transmitidos com segurança
- **Política de Mesma Origem**: Restrições de segurança do navegador se aplicam
- **Ambiente Sandboxed**: Executa no sandbox de segurança do navegador
- **Atualizações Regulares**: Patches de segurança aplicados automaticamente
- **Sem Acesso Root**: Acesso limitado ao sistema em comparação com aplicativos nativos


*Nota: Dados sensíveis são criptografados e seguem os padrões de segurança do navegador.*

### Posso usar o PWA do OneUptime em redes corporativas?

Considerações sobre redes corporativas:
- **Regras de Firewall**: Garanta acesso HTTPS (porta 443)
- **Configuração de Proxy**: Configure as configurações de proxy do navegador
- **Confiança de Certificado**: Instale certificados corporativos se necessário
- **Acesso VPN**: Use VPN para acesso remoto
- **Políticas de Segurança**: Cumpra os requisitos de segurança de TI

## Solução de Problemas

### Problemas de Instalação

**Problema**: O botão de instalação não aparece
```
Soluções:
1. Aguarde 30+ segundos na página do OneUptime
2. Atualize a página e aguarde novamente
3. Limpe o cache e os cookies do navegador
4. Tente um navegador diferente (Chrome/Edge recomendado)
5. Verifique a conexão HTTPS (verifique o ícone de cadeado)
6. Verifique se já está instalado
```

**Problema**: A instalação falha ou trava
```
Soluções:
1. Certifique-se de ter espaço de armazenamento suficiente (100MB+)
2. Feche outras abas e aplicativos do navegador
3. Atualize o navegador para a versão mais recente
4. Desabilite as extensões do navegador temporariamente
5. Tente a instalação no modo privado/anônimo
6. Reinicie o navegador e tente novamente
```

**Problema**: O aplicativo instala, mas não aparece
```
Soluções:
1. Verifique todos os locais de iniciadores de aplicativos
2. Pesquise por "OneUptime" na pesquisa do dispositivo
3. Procure na seção de gerenciamento de aplicativos do navegador
4. Aguarde 1-2 minutos para o sistema atualizar
5. Reinicie o dispositivo e verifique novamente
```

**Problema**: O aplicativo trava frequentemente
```
Soluções:
1. Atualize o navegador para a versão mais recente
2. Limpe todos os dados do navegador para o OneUptime
3. Desabilite as extensões do navegador
4. Verifique o espaço de armazenamento disponível
5. Reinicie o sistema operacional
6. Reinstale o PWA do OneUptime
```

**Problema**: Notificações push não estão funcionando
```
Soluções:
1. Verifique as permissões de notificação no navegador
2. Verifique as configurações de notificação do sistema
3. Teste com uma notificação simples primeiro
4. Limpe os dados de notificação e conceda permissões novamente
5. Verifique as configurações de Não Perturbe/modo de foco
6. Verifique a configuração de notificação do OneUptime
```

**Problema**: O aplicativo não sincroniza os dados mais recentes
```
Soluções:
1. Puxe para baixo para atualizar (mobile)
2. Pressione Ctrl+F5 (Windows/Linux) ou Cmd+R (Mac)
3. Feche e reabra o aplicativo
4. Limpe o cache do aplicativo e recarregue
5. Verifique a conectividade de rede
```

### Problemas Específicos da Plataforma

**Problemas no Android:**
```
Problema: Aplicativo não aparece na gaveta de aplicativos
Solução: Verifique a seção "Adicionados recentemente", pesquise na gaveta de aplicativos

Problema: Notificações atrasadas
Solução: Desabilite a otimização de bateria para o aplicativo do navegador

Problema: O aplicativo trava ao iniciar
Solução: Limpe os dados do aplicativo Chrome, reinicie o dispositivo
```

**Problemas no iOS:**
```
Problema: Não consigo adicionar à tela inicial
Solução: Use o navegador Safari, certifique-se de ter iOS 11.3+

Problema: Ícone do aplicativo ausente
Solução: Verifique todas as páginas da tela inicial e a Biblioteca de Aplicativos

Problema: Face ID não está funcionando
Solução: Habilite o Face ID para o Safari nas configurações
```

**Problemas no Windows:**
```
Problema: O aplicativo não aparece no Menu Iniciar
Solução: Pesquise o nome do aplicativo, verifique a lista de aplicativos instalados

Problema: Notificações não aparecendo
Solução: Verifique as configurações de notificação do Windows, habilite para o navegador

Problema: Problemas de dimensionamento da janela
Solução: Redimensione manualmente, o aplicativo lembrará as dimensões
```

**Problemas no macOS:**
```
Problema: Não consigo instalar via Safari
Solução: Atualize para macOS Sonoma+, use Arquivo → Adicionar ao Dock

Problema: Aplicativo não está na pasta Aplicativos
Solução: Verifique o Launchpad, use a pesquisa Spotlight

Problema: Notificações não estão funcionando
Solução: Verifique as Preferências do Sistema → Notificações
```

**Problemas no Linux:**
```
Problema: Opção de instalação PWA ausente
Solução: Use Chrome/Chromium, certifique-se de ter suporte ao ambiente de área de trabalho

Problema: Ícone não aparece no iniciador
Solução: Atualize o banco de dados da área de trabalho, verifique o arquivo .desktop

Problema: Notificações de áudio não estão funcionando
Solução: Verifique o PulseAudio, verifique as permissões de áudio do navegador
```

### Mensagens de Erro

**"This site cannot be installed"**
```
Causas:
- A instância do OneUptime não atende aos requisitos de PWA
- Manifesto de aplicativo web ausente ou inválido
- HTTPS não configurado corretamente
- O navegador não suporta instalação de PWA

Soluções:
- Entre em contato com o administrador para verificar a configuração do PWA
- Tente um navegador diferente
- Verifique o console do navegador para erros detalhados
```
