# Feuille de route

Chaque étape se mesure sur le banc d'essai : taux de réussite, coût moyen, et ce qu'on a appris.

## Semaine 1 — cockpit v0 ✔ (ce dépôt)

- Harnais d'agent, orchestrateur linéaire, quatre rôles, portes build/tests, contrôles anti-triche.
- Banc d'essai niveau 1-2 (eShop MVC, eShop WebForms en test d'honnêteté).
- Workflows : CI (dry run), Migrate, Bench, Scout.
- **À faire par le pilote** : secrets, premier run réel sur `eshop-mvc`, première lecture de transcript.

## Semaines 2-4 — fiabiliser et mesurer

- Relecteur sur un modèle distinct du migrateur (mesurer : taux de triche détectée, coût).
- Validation sur `windows-latest` : job qui récupère la branche du fork, `dotnet build` + `dotnet test`, et fusionne le résultat au rapport. Activer `eshop-ntier`.
- Tableau de bord publié (GitHub Pages) avec courbes taux/coût par cible et par semaine.
- Traces OpenTelemetry → Langfuse (spans par étape et par appel d'outil).
- Éclaireur enrichi : promotion semi-automatique de candidats niveau 1-2 vers le bench (le pilote valide).
- Trois fiches de poste révisées à partir des transcripts (une décision par semaine, journal à l'appui).

## Mois 2-3 — élargir et raconter

- Couche d'orchestration en C# avec Microsoft Agent Framework : workflow graphe (analyste → migrateur → testeur → relecteur), checkpoints, OpenTelemetry natif ; les agents Claude restent les exécutants, exposés en MCP. Objectif : montrer les deux mondes (.NET et Anthropic) qui coopèrent proprement.
- Mémoire de recettes : les `MIGRATION_NOTES.md` des runs réussis deviennent une base consultable par l'analyste (mesurer l'effet sur le coût et le taux).
- Cibles niveau 4 (Greenshot), puis 5 (Chocolatey) si le niveau 3 est répétable.
- Article « journal de bord » (ce qu'on a appris à piloter des agents, chiffres à l'appui) et démo vidéo : une URL collée, une PR trente minutes plus tard, le tableau de bord derrière.

## Plus tard, si le bench le justifie

- Réécriture assistée WebForms → Razor Pages (c'est une autre catégorie de problème, à traiter comme telle).
- Service à la demande pour des tiers (hors périmètre de tout employeur du pilote).
