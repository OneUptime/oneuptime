# Développement local

Pour le développement local, vous devez utiliser le fichier docker-compose.dev.yml.

Vous devez vous assurer d'avoir :
- Docker et Docker Compose installés.
- Node.js et NPM installés.

```
# Cloner ce dépôt et accéder au répertoire.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copier config.example.env vers config.env
cp config.example.env config.env

# Puisque c'est pour le développement, vous n'avez pas besoin de modifier les valeurs dans config.env. Vous pouvez le faire, mais c'est facultatif.
npm run dev
```
