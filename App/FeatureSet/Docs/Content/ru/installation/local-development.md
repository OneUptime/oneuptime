# Локальная разработка

Для локальной разработки необходимо использовать файл docker-compose.dev.yml.

Вам необходимо убедиться, что у вас установлено:

- Docker и Docker Compose.
- Node.js и NPM.

```
# Клонируйте репозиторий и перейдите в него.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Скопируйте config.example.env в config.env
cp config.example.env config.env

# Поскольку это среда разработки, вам не нужно редактировать значения в config.env. Вы можете, но это необязательно.
npm run dev
```
