# Implantar o OneUptime completamente gratuito com Docker Compose

Se preferir hospedar o OneUptime no seu próprio servidor, você pode usar o Docker Compose para implantar uma instância de servidor único do OneUptime no Debian, Ubuntu ou RHEL. Esta opção oferece mais controle e personalização sobre sua instância, mas também requer mais habilidades técnicas e recursos para implantá-la e mantê-la.

#### Escolha Seus Requisitos de Sistema
Dependendo do seu uso e orçamento, você pode escolher entre diferentes requisitos de sistema para o seu servidor. Para desempenho ideal, sugerimos usar o OneUptime com:

- **Requisitos de Sistema Recomendados**
  - 16GB RAM
  - 8 Núcleos
  - 400 GB de Disco
  - Ubuntu 22.04
  - Docker e Docker Compose instalados
- **Homelab / Requisitos Mínimos**
  - Se você quiser executar o OneUptime para uso pessoal ou experimental em um ambiente doméstico (alguns dos nossos usuários até têm instalado em RaspberryPi), você pode usar os requisitos de homelab:
    - 8 GB RAM
    - 4 Núcleos
    - 20 GB de Disco
    - Docker e Docker Compose instalados


#### Pré-requisitos para Implantação em Servidor Único

Tutorial de instalação: [https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

Antes de iniciar o processo de implantação, certifique-se de ter:

- Um servidor executando Debian, Ubuntu ou derivado de RHEL
- Docker e Docker Compose instalados no seu servidor

Para instalar o OneUptime:

```
# Clone este repositório apenas com o branch release e entre no diretório.
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copie config.example.env para config.env
cp config.example.env config.env

# IMPORTANTE: Edite o arquivo config.env. Certifique-se de ter segredos aleatórios.

npm start
```

Se você não quiser usar npm ou não o tiver instalado, execute isso em vez disso:

```
# Leia variáveis de ambiente do arquivo config.env e execute docker compose up.
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# Use sudo se tiver problemas de permissão ao vincular portas.
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```


### Acessando o OneUptime

O OneUptime deve executar em: http://localhost. Você precisa registrar uma nova conta para a sua instância começar a usá-lo.

### Configurando Certificados TLS/SSL

O OneUptime **não** suporta a configuração de certificados SSL/TLS. Você precisa configurar certificados SSL/TLS por conta própria.

Se precisar usar certificados SSL/TLS, siga estas etapas:

1. Use um proxy reverso como Nginx ou Caddy.
2. Use o Let's Encrypt para provisionar os certificados.
3. Aponte o proxy reverso para o servidor do OneUptime.
4. Atualize as seguintes configurações:
   - Defina a variável de ambiente `HTTP_PROTOCOL` como `https`.
   - Altere a variável de ambiente `HOST` para o nome de domínio do servidor onde o proxy reverso está hospedado.

## Lista de Verificação de Prontidão para Produção

Idealmente, não implante o OneUptime em produção com docker-compose. Recomendamos fortemente o uso de Kubernetes. Há um helm chart disponível para o OneUptime [aqui](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

Se ainda quiser implantar o OneUptime em produção com docker-compose, considere o seguinte:

- **SSL/TLS**: Configure certificados SSL/TLS. O OneUptime não suporta a configuração de certificados SSL/TLS. Você precisa configurar os certificados SSL/TLS por conta própria. Consulte acima.
- **Segredos**: Certifique-se de ter segredos aleatórios no seu arquivo `config.env`. Há alguns segredos padrão nesse arquivo. Substitua-os por strings longas e aleatórias.
- **Backups**: Faça backup regularmente dos seus bancos de dados (Clickhouse, Postgres). O Redis é usado como cache e é stateless, podendo ser ignorado com segurança.
- **Atualizações**: Atualize o OneUptime regularmente. Lançamos atualizações diariamente. Recomendamos que você atualize o software pelo menos uma vez por semana se estiver executando em produção.

### Atualizando o OneUptime

Para atualizar:

```
git checkout release # Certifique-se de estar no branch release.
git pull
npm run update
```

### Considerações

- Na nossa configuração Docker, empregamos um driver de log local. O OneUptime, particularmente dentro dos contêineres de probe e ingest, gera uma quantidade substancial de logs. Para evitar que seu armazenamento fique cheio, é crucial limitar o armazenamento de log no Docker. Para instruções detalhadas sobre como fazer isso, consulte a documentação oficial do Docker [aqui](https://docs.docker.com/config/containers/logging/local/).


### Desinstalando o OneUptime

Para desinstalar o OneUptime, execute o seguinte comando:

```
npm run down
```

Isso irá parar e remover todos os contêineres, redes e volumes criados pelo OneUptime. Não removerá o arquivo `config.env` ou o repositório clonado.
