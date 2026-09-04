# 0004 — Pipeline linéaire, contrats typés, portes déterministes

**Date** : 2026-09-04 · **Statut** : acceptée

## Contexte

La mode est aux essaims d'agents qui se parlent. C'est spectaculaire, difficile à déboguer, et cher. Le pilote doit pouvoir lire ce qui s'est passé en 15 minutes par semaine.

## Décision

- Les agents **ne se parlent pas**. Ils lisent et produisent des artefacts typés (`src/schemas.ts`) ; l'orchestrateur (`src/run.ts`, sans IA) transporte et décide.
- L'analyste et le relecteur rendent du JSON sous schéma (sortie structurée forcée par le SDK, revalidée en code).
- Tout ce qui se vérifie en code se vérifie en code : `dotnet build`, `dotnet test`, motifs de triche. Ces portes **priment** sur l'avis du relecteur.
- L'IA n'intervient que là où il faut du jugement ; l'inventaire et l'éclaireur sont du code pur.

## Conséquences

- Chaque étape est testable isolément ; un rôle, un modèle ou un prompt se remplace sans toucher aux autres.
- Le coût se lit par étape ; les boucles sont explicites (migrateur ↔ relecteur, plafonnées).
- On ajoutera de l'orchestration riche (Microsoft Agent Framework, v1) quand un rapport montrera une limite réelle du pipeline linéaire, pas avant.
