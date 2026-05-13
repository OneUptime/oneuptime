# Monitor de Site

O monitoramento de site permite monitorar a disponibilidade, o desempenho e a resposta de qualquer site ou página web. O OneUptime periodicamente envia requisições HTTP para a URL do seu site e verifica se ele responde corretamente.

## Visão Geral

Os monitores de site verificam suas páginas web fazendo requisições HTTP e avaliando as respostas. Isso permite que você:

- Monitore o tempo de atividade e a disponibilidade do site
- Rastreie os tempos de resposta e o desempenho
- Verifique códigos de status HTTP
- Verifique cabeçalhos de resposta
- Detecte tempo de inatividade antes dos seus usuários

## Criando um Monitor de Site

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Website** como o tipo de monitor
4. Insira a URL do site que deseja monitorar
5. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### URL do Site

Insira a URL completa do site que deseja monitorar, incluindo o protocolo (ex.: `https://example.com`).

### Espaços Reservados Dinâmicos de URL

Ao monitorar URLs atrás de CDNs ou proxies de cache, o monitor pode receber uma resposta em cache em vez de atingir o servidor de origem. Para quebrar o cache em cada verificação, você pode usar espaços reservados dinâmicos de URL que são substituídos por um valor único em cada requisição de monitoramento.

#### Espaços Reservados Suportados

| Espaço Reservado | Descrição | Valor de Exemplo |
|-------------|-------------|---------------|
| `{{timestamp}}` | Substituído pelo timestamp Unix atual (segundos) | `1719500000` |
| `{{random}}` | Substituído por uma string única aleatória | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Exemplo

Configure a URL do seu monitor com um espaço reservado:

```
https://example.com/health?cb={{timestamp}}
```

Em cada verificação de monitoramento, a URL se torna:

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

Você também pode usar `{{random}}` para uma string única em cada requisição:

```
https://example.com/health?nocache={{random}}
```

### Opções Avançadas

#### Não Seguir Redirecionamentos

Por padrão, o OneUptime segue redirecionamentos HTTP (301, 302, etc.). Habilite esta opção se quiser monitorar a própria resposta de redirecionamento em vez do destino final.

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando seu site é considerado online, degradado ou offline com base em:

- **Código de Status de Resposta** - Verificar se o código de status HTTP corresponde aos valores esperados (ex.: 200, 301)
- **Tempo de Resposta** - Monitorar se o tempo de resposta excede um limite
- **Corpo de Resposta** - Verificar se o corpo de resposta contém ou corresponde a conteúdo específico
- **Cabeçalhos de Resposta** - Verificar se cabeçalhos de resposta específicos estão presentes ou correspondem aos valores esperados
