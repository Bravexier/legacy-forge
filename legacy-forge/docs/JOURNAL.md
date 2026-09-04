# Journal de bord

Une entrée par décision de pilotage : la date, ce qu'on a changé, pourquoi, et ce qu'on mesure. C'est la matière première du récit final.

## 2026-09-04 — Naissance du cockpit v0

**Contexte.** Objectif du projet : apprendre à créer et opérer des agents IA qui font un vrai travail, sur un problème que les équipes .NET connaissent : la modernisation de code .NET Framework. Contraintes : 2 à 3 heures de pilotage par semaine, aucun code privé (le code de l'employeur reste chez l'employeur), tout en public.

**Décisions du jour** (détail dans `decisions/`) :

1. Le travail à faire est la migration de dépôts **publics** .NET Framework → .NET moderne ; le banc d'essai commence par les applications legacy de Microsoft (eShopModernizing).
2. v0 en TypeScript sur le Claude Agent SDK ; la couche d'orchestration C# (Microsoft Agent Framework) viendra en phase 2, quand le pipeline linéaire aura montré ses limites.
3. Hébergement GitHub Actions : rien sur le poste du pilote, transcripts en artefacts, rapports versionnés.
4. Pipeline linéaire avec contrats typés entre agents, portes déterministes (build, tests, anti-triche) qui priment sur les avis des agents.
5. L'IA seulement là où il faut du jugement : inventaire et éclaireur en code pur.

**Première mesure, avant même le premier run.** Un test de câblage du harnais (un agent, une consigne d'un mot, aucun outil utilisé) a coûté **0,15 $** : ~37 000 jetons de mise en cache du prompt système et des définitions d'outils. Autrement dit, chaque session d'agent a un coût fixe de l'ordre de 0,15 $ avant de faire quoi que ce soit, et un run à quatre étapes et deux boucles en paie huit fois. Deux conséquences immédiates, appliquées dans le cockpit v0 : les rôles ne reçoivent que les outils dont ils ont besoin (`tools` restreint par rôle, pas seulement `allowedTools`), et les budgets par étape sont lus en gardant ce fixe en tête. Le même test a montré que le SDK émet le résultat d'une session coupée par le budget **puis** lève une erreur : le harnais garde le résultat et journalise l'erreur, sinon un dépassement de budget aurait planté le run au lieu d'être un état normal.

**À mesurer au premier run réel** : coût total, coût par étape, nombre de boucles, verdict du relecteur, et surtout : le migrateur a-t-il tenté un raccourci ?

**Prochaine décision attendue** : après lecture du transcript du premier run, une modification de la fiche de poste du migrateur ou de l'analyste.
