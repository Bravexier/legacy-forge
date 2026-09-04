# legacy-forge

**Une flotte d'agents IA qui modernise du code .NET Framework vers .NET moderne — en autonomie, sous budget, avec des preuves.**

> *English TL;DR — legacy-forge is an open-source, agent-based pipeline that takes a public .NET Framework repository, plans the migration to modern .NET, executes it on a branch, tests it, adversarially reviews it, and opens a pull request on a fork — with every run's cost, transcript and verdict published on a dashboard. It is built and operated as a "pilot + agents" project: the human decides, the agents execute.*

[![CI](https://github.com/bravexier/legacy-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/bravexier/legacy-forge/actions/workflows/ci.yml)
[![Tableau de bord](https://img.shields.io/badge/runs-tableau%20de%20bord-blue)](./runs/README.md)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-green)](./LICENSE)

## Ce que ça fait

On donne l'URL d'un dépôt GitHub public encore sur .NET Framework. La forge :

1. **inventorie** la solution (déterministe : projets, cibles, packages, bloquants) ;
2. fait produire par un **analyste** un plan de migration structuré — ou un refus motivé quand la migration automatique n'a pas de sens (ASP.NET WebForms, par exemple) ;
3. fait exécuter le plan par un **migrateur** sur une branche, avec une boucle build → corrige serrée ;
4. fait **tester** le résultat : les tests existants, ou des tests de fumée écrits par un **testeur** ;
5. fait relire le diff complet par un **relecteur** adversarial, doublé de contrôles anti-triche en code ;
6. publie le tout : rapport, coût, transcripts, et une pull request **sur un fork** (jamais chez les mainteneurs sans qu'ils le demandent).

```
  URL GitHub ──► clone ──► inventaire ──► ANALYSTE ──► plan.json
                                              │
                        ┌─────────────────────┘ migrable ?
                        ▼
                  MIGRATEUR ──► dotnet build (porte) ──► TESTEUR ──► dotnet test (porte)
                        ▲                                                   │
                        │ mustFix                                           ▼
                        └────────────────────────────────────────── RELECTEUR + anti-triche
                                                                            │ approuvé
                                                                            ▼
                                             report.md · tableau de bord · PR sur le fork
```

Tout ce qui décide est du code lisible (`src/run.ts`) ; tout ce qui juge est un agent avec une fiche de poste (`agents/*.md`), un budget, une liste d'outils et une sortie structurée.

## Pourquoi

Microsoft a retiré son .NET Upgrade Assistant gratuit au profit d'une fonction payante de GitHub Copilot que beaucoup de développeurs jugent en retrait ([devclass, nov. 2025](https://www.devclass.com/development/2025/11/20/copilot-net-modernization-tool-a-huge-downgrade-devs-say-and-no-longer-free/1725515)). Des milliers d'applications tournent encore sur .NET Framework 4.x. Et la vraie question que se posent les équipes n'est pas « est-ce qu'une IA peut migrer du code ? » mais **« est-ce qu'on peut lui faire confiance, à quel prix, et comment le savoir ? »**. La forge est une réponse expérimentale et publique à cette question : chaque run laisse un rapport, un coût et un verdict.

Ce dépôt est aussi un **journal d'apprentissage** : il est construit et opéré par un développeur .NET qui pilote des agents, sans écrire l'essentiel du code à la main. Les décisions sont dans [`docs/decisions/`](./docs/decisions/), le journal dans [`docs/JOURNAL.md`](./docs/JOURNAL.md), le rituel de pilotage dans [`docs/PILOT-GUIDE.md`](./docs/PILOT-GUIDE.md).

## Garde-fous

| Risque | Réponse |
|---|---|
| Un agent qui tourne en rond et brûle des jetons | budget en dollars **et** en tours par étape, coupure côté SDK (`src/config.ts`) |
| Un agent qui « triche » pour faire passer le build | relecteur adversarial + contrôles déterministes : tests supprimés/ignorés, `NoWarn`, pragmas, `NotImplementedException`, fichiers .cs supprimés → run refusé quoi qu'en dise l'IA (`src/stages/review.ts`) |
| Un agent qui fait des dégâts hors périmètre | liste blanche d'outils par rôle, liste noire globale (`git push`, `curl`, `sudo`, web), pas d'accès réseau depuis les agents |
| Un résultat qu'on croit sur parole | l'orchestrateur recompile et relance les tests lui-même ; un run sans preuve d'exécution n'est jamais `success` |
| Une PR qui dérange des mainteneurs | fork sous le compte de la forge, PR sur le fork ; proposition amont uniquement sur issue ouverte |
| Un banc d'essai qui triche | les portages humains présents dans un dépôt sont retirés de la copie de travail (`exclude`) |

## Évaluation

`benchmark/targets.json` est un jeu de cibles publiques figées, avec un résultat attendu. `forge bench` les fait tourner et le tableau de bord ([`runs/README.md`](./runs/README.md)) donne **taux de réussite** et **coût** — c'est ce qu'on regarde avant et après chaque changement de prompt, de modèle ou de garde-fou. Le premier niveau de la forge est [eShopModernizing](https://github.com/dotnet-architecture/eShopModernizing), les applications « legacy » de Microsoft (MVC, WebForms, WCF + WinForms). Les niveaux suivants sont de vraies applications ([Greenshot](https://github.com/greenshot/greenshot), [Chocolatey CLI](https://github.com/chocolatey/choco)). L'éclaireur (`forge scout`) en propose d'autres chaque semaine.

## Coûts

Un run est plafonné (15 $ par défaut, réglable), chaque étape aussi. Le coût réel de chaque run est dans son rapport et dans le tableau de bord. Les modèles sont choisis par rôle (`FORGE_MODEL_WORKER`, `FORGE_MODEL_REVIEWER`) : le relecteur peut être plus cher que le migrateur, c'est lui qui protège la qualité.

## Lancer

Tout tourne sur GitHub Actions, rien à installer :

- **Migrate** (à la demande) : onglet *Actions* → *Migrate* → *Run workflow* → une URL ou un identifiant de cible. Rapport dans le résumé du job, dans `runs/`, et PR sur le fork si `FORGE_TOKEN` est configuré.
- **Bench** (à la demande, planifiable) : toutes les cibles activées.
- **Scout** (chaque lundi) : met à jour `benchmark/CANDIDATES.md`.

Secrets attendus : `ANTHROPIC_API_KEY` (obligatoire pour les runs réels) et `FORGE_TOKEN` (PAT GitHub avec droits `repo` et `workflow` : fork, push, PR ; sans lui, la branche reste en artefact). Voir [`docs/SETUP.md`](./docs/SETUP.md).

En local (Node 22, .NET 8 SDK) :

```bash
npm ci && npm run build
FORGE_DRY_RUN=1 node dist/index.js run --id eshop-mvc      # pipeline complet sans appel au modèle
ANTHROPIC_API_KEY=... node dist/index.js run https://github.com/dotnet-architecture/eShopModernizing/tree/main/eShopLegacyMVCSolution --solution eShopLegacyMVC.sln --exclude eShopPorted
node dist/index.js inventory ./chemin/vers/une/solution     # l'inventaire déterministe seul
```

## Structure

```
agents/      fiches de poste des rôles (system prompts)
src/         harnais (agent.ts), orchestrateur (run.ts), étapes (stages/), portes dotnet, rapports, éclaireur
benchmark/   cibles figées + candidats de l'éclaireur
runs/        un dossier par run : rapport, plan, verdicts (transcripts en artefacts CI)
docs/        architecture, guide du pilote, feuille de route, décisions, journal
```

## Feuille de route

Semaine 1 : cockpit v0 (ce dépôt), premier run réel sur `eshop-mvc`. Semaines 2-4 : relecteur sur modèle distinct, validation sur runner Windows, tableau de bord publié (GitHub Pages), traces OpenTelemetry vers Langfuse, second niveau du banc d'essai. Mois 2-3 : couche d'orchestration en C# avec Microsoft Agent Framework, MCP entre orchestrateur et agents, article et démo vidéo. Détail dans [`docs/ROADMAP.md`](./docs/ROADMAP.md).

## Licence

MIT. Les dépôts migrés gardent leur licence et leurs attributions.
