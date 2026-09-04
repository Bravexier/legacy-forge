# 0002 — TypeScript pour la v0, C# / Microsoft Agent Framework pour l'orchestration v1

**Date** : 2026-09-04 · **Statut** : acceptée

## Contexte

Le pilote est développeur .NET. Le marché des « AI engineers » demande Python/TypeScript et les SDK d'agents ; les équipes .NET, elles, regardent Microsoft Agent Framework (1.0 en avril 2026, successeur de Semantic Kernel et AutoGen). Le moteur qui fait réellement le travail de code est le Claude Agent SDK (celui de Claude Code), disponible en TypeScript et Python.

## Décision

- **v0** : tout en TypeScript sur `@anthropic-ai/claude-agent-sdk`. Raisons : un seul langage pour avoir un pipeline complet en une semaine ; TypeScript se lit comme du C# pour le pilote ; le SDK y est de première classe (binaire Claude Code embarqué, sous-agents, MCP, budget, sortie structurée).
- **v1** : une couche d'orchestration en C# avec Microsoft Agent Framework (workflow graphe, checkpoints, OpenTelemetry natif) qui pilote les agents Claude exposés en MCP. Elle ne remplace pas le moteur, elle l'encadre.

## Conséquences

- Le pilote apprend le SDK d'agents dans un langage qu'il lit déjà, puis rapporte les mêmes concepts dans son écosystème.
- Le récit final montre les deux mondes qui coopèrent, ce qui parle aux deux types d'employeurs.
- Coût : deux runtimes à maintenir en v1. Accepté, parce que c'est précisément la situation des entreprises .NET qui adoptent des agents.
