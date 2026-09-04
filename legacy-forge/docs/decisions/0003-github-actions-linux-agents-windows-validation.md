# 0003 — GitHub Actions ; agents sur Linux, validation sur Windows

**Date** : 2026-09-04 · **Statut** : acceptée

## Contexte

Rien ne doit tourner sur le poste du pilote (il n'a ni le temps ni l'envie d'administrer un serveur). Les cibles sont parfois Windows (WinForms, WPF). Un dépôt public a des minutes GitHub Actions gratuites, y compris des runners Windows.

## Décision

- Les workflows GitHub Actions sont l'unique hébergement : Migrate (à la demande), Bench (à la demande, planifiable par décision explicite), Scout (hebdomadaire), CI (dry run à chaque push).
- Les agents et les portes tournent sur `ubuntu-latest` : moins cher, plus rapide, et le SDK .NET y compile les projets `net8.0-windows` (`EnableWindowsTargeting`).
- La validation d'exécution des cibles Windows se fait dans un second job sur `windows-latest` (v1), à partir de la branche poussée sur le fork.
- Rapports versionnés dans le dépôt ; transcripts, diffs et logs en artefacts (90 jours).

## Conséquences

- Zéro infrastructure, zéro coût fixe ; seul le coût des jetons reste.
- Un run est plafonné à 6 h par job (limite GitHub) : un plafond de plus, bienvenu.
- Le bench n'est pas planifié par défaut : activer le `schedule` est une décision de budget du pilote.
