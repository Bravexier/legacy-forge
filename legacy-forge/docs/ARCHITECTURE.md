# Architecture

## Trois couches

| Couche | Rôle | Où |
|---|---|---|
| **Orchestration** | Enchaîne les étapes, tient le budget, décide de reboucler, écrit les rapports. Déterministe. | `src/run.ts`, `src/bench.ts`, `src/report.ts` |
| **Agents** | Un rôle = une fiche de poste + des outils + un budget + une sortie attendue. C'est là qu'il y a du jugement. | `agents/*.md`, `src/agent.ts`, `src/stages/*` |
| **Portes** | Ce qui se vérifie en code se vérifie en code : build, tests, motifs de triche, inventaire. | `src/dotnet.ts`, `src/inventory.ts`, `src/stages/review.ts` (cheatChecks) |

Principe : **l'IA seulement là où il faut du jugement**. Lister des `.csproj` est du parsing ; décider si une solution WebForms est migrable est du jugement ; vérifier que le build passe est une commande.

## Un run, pas à pas

1. `runs/<horodatage>-<cible>/` est créé ; `work/` reçoit un clone peu profond du dépôt à la référence demandée ; les dossiers `exclude` sont supprimés et le commit de base est noté.
2. **Inventaire** (`inventory.ts`) : solutions, projets, cible, format SDK ou non, packages (PackageReference, packages.config, références d'assemblies), classification (MVC, Web API, WebForms, WCF, WinForms, WPF, console, bibliothèque, test), lignes de code, bloquants.
3. **Analyste** (lecture seule, sortie JSON `MigrationPlan`) : complète l'inventaire, décide `migratable`, écrit la stratégie ordonnée avec risques. Si non migrable → `declined`, fin du run.
4. Branche `forge/<cible>-<tfm>`. Puis, jusqu'à `maxReviewLoops + 1` fois :
   - **Migrateur** (lecture/écriture/bash) exécute le plan (et les `mustFix` de la boucle précédente), commit par étape.
   - **Porte build** : l'orchestrateur lance `dotnet build`. KO → le relecteur diagnostique, on reboucle.
   - **Testeur** : `dotnet test` s'il y a des tests ; sinon l'agent testeur écrit des tests de fumée xUnit, puis `dotnet test`.
   - **Relecteur** (lecture seule, sortie JSON `ReviewVerdict`) lit le diff, le plan, les résultats. Les contrôles anti-triche déterministes s'ajoutent à son verdict et priment.
   - Approuvé → `success` ; sinon ses `mustFix` repartent vers le migrateur.
5. **Publication** : fork sous le compte de la forge, push de la branche, PR sur le fork. Sans token : artefact seulement.
6. `report.json` + `report.md` dans le dossier du run ; `runs/README.md` régénéré.

## Contrat entre agents

Les agents ne se parlent pas : ils lisent et écrivent des artefacts typés (`src/schemas.ts`), et l'orchestrateur transporte. Ça permet de remplacer un rôle, son modèle ou son prompt sans toucher aux autres, et de tester chaque étape isolément.

## Budget

- Par étape : `maxBudgetUsd` et `maxTurns` (`src/config.ts`). Le SDK coupe la session quand l'un des deux est atteint (`subtype: error_max_budget_usd` / `error_max_turns` dans le rapport).
- Par run : `FORGE_RUN_BUDGET_USD`. Chaque étape reçoit `min(budget de l'étape, reste du run)`.
- Le plafond mensuel côté console Anthropic est le filet de sécurité final.

## Observabilité (v0)

- `forge.log` : le journal de l'orchestrateur, en JSONL.
- `<rôle>-<boucle>.jsonl` : le transcript intégral de chaque agent (messages, appels d'outils, résultats, usage).
- `build-*.log`, `tests-*.json`, `diff-*.patch`, `verdict-*.json`, `plan.json`, `inventory.json` : les preuves.
- Les rapports sont versionnés ; les transcripts restent en artefacts CI (volumineux, et ils contiennent du code tiers).

v1 : traces OpenTelemetry (spans par étape et par appel d'outil) exportées vers Langfuse, pour comparer des runs entre eux autrement qu'à la main.

## Hébergement

GitHub Actions. Les agents et les portes tournent sur `ubuntu-latest` (le SDK .NET 8 compile les projets `net8.0-windows` avec `EnableWindowsTargeting`, sans pouvoir les exécuter). La validation d'exécution des cibles Windows (WinForms, WPF, tests dépendants de Windows) est prévue sur `windows-latest` en second job — voir la feuille de route.

## Sécurité

- Les agents n'ont ni réseau ni `git push` ni `sudo` (liste noire globale dans `src/agent.ts`) ; ils travaillent dans un clone jetable.
- `permissionMode: bypassPermissions` est assumé : en CI, personne ne répond aux demandes de permission. La liste blanche d'outils et la liste noire remplacent l'humain.
- Les secrets ne traversent jamais les agents : `FORGE_TOKEN` n'est utilisé que par l'orchestrateur pour fork/push/PR.
- Aucun code privé n'entre dans la forge : seulement des dépôts publics sous licence libre.

## Ce qui n'est pas encore là (et pourquoi c'est volontaire)

- Pas de couche multi-agents « conversationnelle » (agents qui se répondent) : le pipeline linéaire avec contrats typés est plus lisible, plus testable et moins cher. On ajoutera de l'orchestration riche (Microsoft Agent Framework) quand une vraie limite du pipeline linéaire apparaîtra dans les rapports.
- Pas de RAG ni de mémoire entre runs : chaque run repart de zéro pour rester reproductible. Une mémoire de « recettes de migration » est une candidate sérieuse pour la v1, mesurée sur le bench.
- Pas de parallélisme : le budget se lit mieux en séquentiel.
