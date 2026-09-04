# Les rôles

Chaque fichier est le *system prompt* d'un rôle : sa fiche de poste. C'est ici que le pilote agit le plus souvent — un mot changé dans une fiche de poste change le comportement de toute la flotte au run suivant.

| Rôle | Fichier | Outils | Sortie | Ce qu'on attend de lui |
|---|---|---|---|---|
| Éclaireur | (code, pas d'IA) `src/scout.ts` | API GitHub | `benchmark/CANDIDATES.md` | Trouver et classer des cibles |
| Analyste | `analyst.md` | lecture seule | `plan.json` (schéma strict) | Décider si et comment migrer |
| Migrateur | `migrator.md` | lecture/écriture + bash | commits sur la branche | Exécuter le plan jusqu'au build vert |
| Testeur | `tester.md` | lecture/écriture + bash | projet de tests + `dotnet test` | Produire des preuves |
| Relecteur | `reviewer.md` | lecture seule | `verdict.json` (schéma strict) | Chercher la triche, noter, exiger |

Les prompts sont en anglais volontairement : c'est la langue dans laquelle les modèles sont le plus fiables sur du code, et celle des dépôts qu'ils lisent. La documentation destinée aux humains est en français.

## Règles communes (appliquées par le harnais, pas par les prompts)

- budget en dollars et en tours par étape (`src/config.ts`) ;
- liste blanche d'outils par rôle, liste noire globale (`src/agent.ts`) : pas de `git push`, pas de réseau, pas de `sudo` ;
- sortie structurée obligatoire pour l'analyste et le relecteur ;
- contrôles anti-triche déterministes qui priment sur l'avis du relecteur (`src/stages/review.ts`).
