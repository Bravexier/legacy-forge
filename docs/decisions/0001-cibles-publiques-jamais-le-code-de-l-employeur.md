# 0001 — Cibles publiques, jamais le code de l'employeur

**Date** : 2026-09-04 · **Statut** : acceptée

## Contexte

Le pilote est salarié : son code professionnel est dans un dépôt privé et il n'a pas le droit de l'extraire. Le projet doit pourtant travailler sur du vrai code .NET Framework.

## Décision

La forge ne traite que des dépôts **publics sous licence libre**. Aucun code, nom, schéma ou configuration provenant d'un employeur n'entre dans ce dépôt, dans un run, ni dans une conversation avec un agent. Le premier banc d'essai est [eShopModernizing](https://github.com/dotnet-architecture/eShopModernizing) (MIT, archivé donc figé), puis de vraies applications open source (Greenshot, Chocolatey).

## Conséquences

- Tout est démontrable en public : le résultat se montre en direct, pas en mots.
- Les licences des cibles sont respectées : forks, attributions conservées, PR sur le fork, proposition amont seulement sur issue ouverte.
- Si un jour la forge sert à des tiers, ce sera hors du périmètre d'activité de tout employeur du pilote (obligation de loyauté).
