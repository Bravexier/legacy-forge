# Mise en place (une fois, dix minutes)

## 1. Pousser le dépôt

Le dépôt `bravexier/legacy-forge` existe, vide. Depuis le dossier décompressé de l'archive :

```bash
git init -b main
git add -A
git commit -m "forge: cockpit v0"
git remote add origin https://github.com/bravexier/legacy-forge.git
git push -u origin main
```

Le workflow **CI** se lance tout seul : typecheck, tests unitaires, et le pipeline en dry run (sans appel au modèle). Il doit être vert avant d'aller plus loin.

## 2. Les deux secrets

Dans le dépôt : *Settings → Secrets and variables → Actions → New repository secret*.

| Secret | Rôle | Comment l'obtenir |
|---|---|---|
| `ANTHROPIC_API_KEY` | Fait tourner les agents | [console.anthropic.com](https://console.anthropic.com) → *API keys*. **Mettre un plafond de dépense mensuel** dans *Limits* (par exemple 60 $) : c'est le vrai garde-fou, celui qui ne dépend d'aucun bug. |
| `FORGE_TOKEN` | Fork, push de branche, PR sur le fork, recherche de code pour l'éclaireur | GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained*. Portée : *All repositories* (il doit pouvoir créer des forks), permissions *Contents: read/write*, *Pull requests: read/write*, *Workflows: read/write*, *Metadata: read*. Expiration 90 jours (on le renouvellera : c'est une bonne habitude). |

Sans `FORGE_TOKEN`, tout fonctionne sauf la publication : la branche migrée reste dans l'artefact du run.

## 3. Premier run réel

*Actions → Migrate → Run workflow* avec les valeurs par défaut (`target_id = eshop-mvc`, budget 15 $, modèle `sonnet`). Compter 20 à 60 minutes. À la fin :

- le résumé du job affiche le rapport ;
- `runs/<id>/report.md` et le tableau de bord `runs/README.md` sont commités ;
- l'artefact du run contient les transcripts (`*.jsonl`), les diffs et les logs de build ;
- si `FORGE_TOKEN` est là et que le relecteur a approuvé : une PR sur `bravexier/eShopModernizing`.

## 4. Ce que le pilote fait ensuite

Lire le rapport, ouvrir un transcript, décider une chose. Le rituel est décrit dans [PILOT-GUIDE.md](./PILOT-GUIDE.md).

## En local (optionnel)

Node 22 et le SDK .NET 8. `npm ci && npm run build`, puis `FORGE_DRY_RUN=1 node dist/index.js run --id eshop-mvc`. Pour un run réel en local, exporter `ANTHROPIC_API_KEY`. Les transcripts et le code de travail restent dans `runs/<id>/` et ne sont pas versionnés.
