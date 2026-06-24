# Guia de Instalação para Linux

Instale o OneUptime como um aplicativo de desktop em distribuições Linux para monitoramento abrangente e gerenciamento de incidentes.

## Métodos de Instalação

### Método 1: Google Chrome/Chromium (Recomendado)

O Chrome e o Chromium fornecem a melhor experiência de PWA no Linux com integração nativa de área de trabalho.

#### Etapas de Instalação do PWA:

1. **Abrir o OneUptime no Chrome/Chromium**

   - Inicie seu navegador
   - Navegue para a URL da sua instância do OneUptime
   - Faça login na sua conta do OneUptime
   - Aguarde o carregamento completo da página

2. **Instalar PWA**

   - Procure o **ícone de instalação** (⊞) na barra de endereços
   - Clique em **"Instalar OneUptime"**
   - Ou use o **menu do Chrome** (⋮) → **Mais ferramentas** → **Criar atalho**

3. **Opções de Instalação**

   - Marque **"Abrir como janela"** para experiência de aplicativo nativo
   - Personalize o nome do aplicativo se desejar
   - Escolha a criação do atalho na área de trabalho
   - Clique em **"Instalar"** ou **"Criar"**

4. **Iniciar Aplicativo**
   - Encontre o OneUptime no iniciador de aplicativos
   - Ou use o atalho da área de trabalho
   - O aplicativo abre em uma janela dedicada

### Método 2: Firefox

O Firefox suporta instalação de PWA no Linux com integração básica de área de trabalho.

1. **Instalação de PWA**:
   - Abra o OneUptime no Firefox
   - Procure o banner ou prompt de instalação
   - Clique em **"Instalar"** quando disponível
   - Nota: Integração de área de trabalho limitada em comparação com o Chrome

### Método 3: Microsoft Edge

O Edge está disponível no Linux e fornece bom suporte a PWA.

1. **Instalar PWA**: Siga os mesmos passos do método Chrome

## Atualizações e Manutenção

### Atualizações Automáticas

O PWA do OneUptime é atualizado automaticamente:

- As atualizações são aplicadas quando o navegador atualiza o aplicativo
- Atualizações críticas de segurança implantadas imediatamente
- Nenhuma intervenção manual necessária

## Desinstalação

### Remoção Específica do Navegador

```bash
# Gerenciamento de PWA do Chrome
google-chrome chrome://apps/

# Remover todos os dados do navegador relacionados ao OneUptime
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```

## Atualizações e Manutenção

### Atualizações Automáticas

O PWA do OneUptime é atualizado automaticamente:

- As atualizações são aplicadas quando o navegador atualiza o aplicativo
- Atualizações críticas de segurança implantadas imediatamente
- Nenhuma intervenção manual necessária
