# Le banc d'essai

`targets.json` est le jeu d'évaluation de la forge : des dépôts publics, figés sur une référence git, avec un résultat attendu. On le fait tourner régulièrement (`forge bench`) pour mesurer **taux de réussite** et **coût** à chaque changement de prompt, de modèle ou de garde-fou. Sans ça, on ne saurait pas si une modification améliore ou dégrade la flotte : on aurait une impression.

## Règles

- Une cible = un dépôt public sous licence libre, une référence git précise, un dossier de solution, un résultat attendu (`expected.migratable`).
- `exclude` retire de la copie de travail tout ce qui servirait d'antisèche (portage humain, branches de migration). Les agents ne doivent réussir que par eux-mêmes.
- `enabled: false` pour les cibles chères ou pas encore à portée ; on les active par décision du pilote, jamais par défaut.
- On n'ajoute une cible qu'après l'avoir fait tourner une fois à la main (`forge run --id <id>`) et lu le rapport.

## Échelle de difficulté

| Niveau | Profil | Exemple |
|---|---|---|
| 1 | Bibliothèque ou console, < 100 fichiers, pas de framework web | — |
| 2 | Web MVC/API ou WinForms simple, un ou deux projets | `eshop-mvc` |
| 3 | Plusieurs projets, WCF ou UI Windows, quelques dépendances tierces | `eshop-ntier` |
| 4 | Grosse application réelle, plugins, build spécifique | `greenshot` |
| 5 | Application système avec hébergement de runtime, compatibilité ascendante forte | `chocolatey` |

## Candidats

`CANDIDATES.md` et `candidates.json` sont produits par l'éclaireur (`forge scout`) : un classement de dépôts publics encore sur .NET Framework. Promouvoir un candidat en cible est une décision du pilote.
