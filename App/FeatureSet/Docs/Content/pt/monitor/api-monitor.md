# Monitor de API

O monitoramento de API permite monitorar a disponibilidade, o desempenho e a correção das suas APIs HTTP/REST. O OneUptime periodicamente envia requisições HTTP para seus endpoints de API e avalia as respostas com base nos critérios configurados.

## Visão Geral

Os monitores de API fazem requisições HTTP para seus endpoints e verificam as respostas. Isso permite que você:

- Monitore o tempo de atividade e a disponibilidade da API
- Rastreie os tempos de resposta e o desempenho
- Verifique códigos de status HTTP e corpos de resposta
- Valide cabeçalhos de resposta
- Teste diferentes métodos HTTP (GET, POST, PUT, DELETE, etc.)
- Envie cabeçalhos e corpos de requisição personalizados

## Criando um Monitor de API

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **API** como o tipo de monitor
4. Insira a URL da API e configure as definições da requisição
5. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### URL da API

Insira a URL completa do endpoint de API que deseja monitorar (ex.: `https://api.example.com/v1/health`).

### Espaços Reservados Dinâmicos de URL

Ao monitorar APIs atrás de CDNs ou proxies de cache, o monitor pode receber uma resposta em cache em vez de atingir o servidor de origem. Para quebrar o cache em cada verificação, você pode usar espaços reservados dinâmicos de URL que são substituídos por um valor único em cada requisição de monitoramento.

#### Espaços Reservados Suportados

| Espaço Reservado | Descrição | Valor de Exemplo |
|-------------|-------------|---------------|
| `{{timestamp}}` | Substituído pelo timestamp Unix atual (segundos) | `1719500000` |
| `{{random}}` | Substituído por uma string única aleatória | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Exemplo

Configure a URL do seu monitor com um espaço reservado:

```
https://api.example.com/health?cb={{timestamp}}
```

Em cada verificação de monitoramento, a URL se torna:

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

Você também pode usar `{{random}}` para uma string única em cada requisição:

```
https://api.example.com/health?nocache={{random}}
```

### Tipo de Requisição de API

Selecione o método HTTP para a requisição:

- **GET** (padrão)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### Opções Avançadas

#### Cabeçalhos de Requisição

Adicione cabeçalhos HTTP personalizados à requisição. Isso é útil para tokens de autenticação, especificações de tipo de conteúdo e outros cabeçalhos específicos de API.

Você pode usar [Segredos de Monitor](/docs/monitor/monitor-secrets) em valores de cabeçalho para armazenar com segurança dados sensíveis como chaves de API.

#### Corpo da Requisição (JSON)

Para requisições POST, PUT e PATCH, você pode especificar um corpo de requisição JSON. Você também pode usar [Segredos de Monitor](/docs/monitor/monitor-secrets) no corpo da requisição.

#### Não Seguir Redirecionamentos

Por padrão, o OneUptime segue redirecionamentos HTTP (301, 302, etc.). Habilite esta opção se quiser monitorar a própria resposta de redirecionamento em vez do destino final.

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** *(optional)* — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando sua API é considerada online, degradada ou offline com base em:

- **Código de Status de Resposta** - Verificar se o código de status HTTP corresponde aos valores esperados (ex.: 200, 201)
- **Tempo de Resposta** - Monitorar se o tempo de resposta excede um limite
- **Corpo de Resposta** - Verificar se o corpo de resposta contém ou corresponde a conteúdo específico
- **Cabeçalhos de Resposta** - Verificar se cabeçalhos de resposta específicos estão presentes ou correspondem aos valores esperados
- **Expressão JavaScript** - Escreva expressões personalizadas para avaliar a resposta. Consulte [Expressões JavaScript](/docs/monitor/javascript-expression) para detalhes.
