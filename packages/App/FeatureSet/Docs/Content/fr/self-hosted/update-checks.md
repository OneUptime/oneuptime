# Vérifications de mise à jour et de sécurité

Une fois par jour, un OneUptime auto-hébergé demande à GitHub si une version plus récente est sortie, et si un avis de sécurité publié par OneUptime concerne la version que vous exécutez. Lorsqu'un avis la concerne, vos administrateurs principaux sont invités à mettre à niveau. Cette page indique ce qu'envoie la vérification, ce que vous voyez et comment la désactiver.

:::cards
- [Ce qu'envoie la vérification](#ce-quenvoie-la-vérification): Deux questions publiques, et rien sur votre installation.
- [Ce que vous voyez](#ce-que-vous-voyez): Le pied de page, l'Admin Dashboard et un e-mail par avis.
- [Désactiver la vérification](#désactiver-la-vérification): Pour un réseau sans accès à Internet, ou pour utiliser un miroir.
:::

## Ce qu'envoie la vérification

Le worker envoie deux requêtes à l'API de GitHub (`api.github.com`), sans jeton :

| Requête | Ce qu'elle demande |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | Quelle est la dernière version de OneUptime |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | Quels avis de sécurité OneUptime a publiés, les versions concernées par chacun et la version qui le corrige |

Rien sur votre installation n'y figure : ni la version que vous exécutez, ni son adresse, ni quoi que ce soit sur vos utilisateurs, vos projets ou vos données de supervision. GitHub voit l'adresse IP publique de votre serveur, comme pour toute requête, et un `User-Agent` qui nomme OneUptime. C'est votre serveur qui détermine si un avis concerne votre version, et aucun navigateur n'appelle GitHub.

La vérification s'exécute au démarrage du worker, puis une fois par jour. Elle interroge de nouveau GitHub au plus toutes les 12 heures, et au plus une fois par heure après une requête qui a échoué.

## Ce que vous voyez

Seuls les administrateurs principaux sont prévenus. Ce sont eux qui peuvent mettre à niveau, et signaler à toute autre personne que le serveur exécute une version présentant une faille de sécurité connue reviendrait à désigner un serveur non corrigé.

- Une version plus récente ajoute **Mise à jour disponible** au pied de page du Dashboard et de l'Admin Dashboard. Un clic dessus ouvre le guide de mise à niveau.
- Un avis de sécurité publié qui concerne la version que vous exécutez y ajoute à la place **Mise à jour de sécurité**, en rouge.
- La première page de l'Admin Dashboard liste alors chaque avis : sa gravité, les versions qu'il concerne, la version qui le corrige et un lien vers l'avis sur GitHub. Elle indique aussi quand la vérification a lu les avis pour la dernière fois et, si la dernière vérification a échoué, pourquoi.
- Vos administrateurs principaux et l'E-mail de notification admin (**Paramètres** > **E-mails** dans l'Admin Dashboard) reçoivent un e-mail pour chaque avis qui concerne votre version, et jamais un second.

Tout cela disparaît dès que vous exécutez une version qu'aucun avis ne concerne. Pour mettre à niveau, voir [Mise à niveau](/docs/installation/upgrading).

## Désactiver la vérification

Sur un réseau sans accès à Internet, ou si votre serveur ne doit pas contacter GitHub, désactivez la vérification. Plus rien n'est alors affiché ni envoyé par e-mail.

:::tabs
@tab Kubernetes
```yaml
updateCheck:
  disabled: true
```
@tab Docker Compose
```bash
DISABLE_UPDATE_CHECK=true
```
Définissez cette valeur dans `config.env`, puis exécutez `npm start`.
:::

Pour vérifier plutôt auprès d'un miroir à l'intérieur de votre réseau, faites pointer la vérification vers lui. Le miroir doit répondre dans les formats de GitHub.

| Valeur Helm | Paramètre Docker Compose | Par défaut |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## Quand GitHub est injoignable

Sur un réseau sans accès à Internet, l'échec d'une requête est attendu et ne constitue pas une erreur. Le worker le journalise au niveau debug, conserve ce qu'il a lu en dernier et réessaie plus tard. L'Admin Dashboard indique quand les avis ont été lus pour la dernière fois, et pourquoi la dernière vérification a échoué : la limite de débit de GitHub, aucune route vers GitHub, un délai d'attente dépassé ou une réponse qui ne vient pas de GitHub.

## Étapes suivantes

:::cards
- [Mise à niveau](/docs/installation/upgrading): Passer à une version plus récente, une version majeure à la fois.
- [Architecture](/docs/self-hosted/architecture): Chaque connexion qu'établit un OneUptime auto-hébergé.
- [Derrière un VPN ou un pare-feu](/docs/self-hosted/behind-a-firewall): Ce qui atteint votre serveur depuis l'extérieur.
:::
