# Guide du pilote

La forge est conçue pour être **pilotée**, pas codée : le pilote décide, les agents exécutent. Ce guide décrit le rituel hebdomadaire (45 minutes) et ce qu'il faut savoir pour que chaque décision soit éclairée. C'est ici que se construit la compétence qui a de la valeur : faire tourner des agents de façon fiable, mesurable et économique.

## Le rituel (45 min, une fois par semaine)

1. **Le tableau de bord** (5 min) — [`runs/README.md`](../runs/README.md). Trois chiffres : taux de réussite, coût moyen par run, tendance depuis la semaine dernière. Si l'un des trois bouge, on veut savoir pourquoi avant de toucher à quoi que ce soit.
2. **Un rapport** (10 min) — le run le plus intéressant de la semaine : un échec, un coût anormal, ou le premier succès d'une nouvelle cible. Lire la table des étapes : où est parti l'argent, combien de tours, combien de boucles.
3. **Un transcript** (15 min) — ouvrir l'artefact du run, lire `migrator-0.jsonl` (ou le rôle qui a coûté le plus cher). On cherche : des boucles (le même build lancé dix fois sans changement entre deux), des détours (lecture de fichiers hors sujet), des raccourcis (voir la liste anti-triche), et les moments où l'agent a manqué d'information qu'on aurait pu lui donner dans sa fiche de poste.
4. **Une décision** (10 min) — une seule par semaine, notée dans [`JOURNAL.md`](./JOURNAL.md) avec sa raison et la mesure qu'on attend. Exemples : modifier une phrase d'une fiche de poste, changer un budget, activer une cible, changer le modèle d'un rôle, ajouter un contrôle anti-triche.
5. **Lancer** (5 min) — le run ou le bench qui mesurera l'effet de la décision.

Ce qu'on ne fait pas : deux changements en même temps (on ne saurait plus lequel a agi), un changement sans mesure derrière, un run sans lire le rapport.

## Les briques, expliquées au moment où on les pose

**Agent.** Un modèle de langage dans une boucle : il lit une instruction, choisit un outil (lire un fichier, lancer une commande, écrire), reçoit le résultat, recommence, jusqu'à rendre une réponse. Un *tour* = un aller-retour outil. Le harnais (`src/agent.ts`) fixe la fiche de poste, la liste d'outils, le budget, et enregistre tout.

**Fiche de poste (system prompt).** `agents/<rôle>.md`. C'est le levier principal du pilote. Une bonne fiche dit : la mission, ce qui compte, ce qui est interdit, à quoi ressemble « fini ». Une phrase ajoutée peut faire baisser le coût de 30 % ou faire disparaître une classe d'erreurs.

**Outils.** Lecture, écriture, bash, recherche. Chaque rôle n'a que ce dont il a besoin : l'analyste et le relecteur ne peuvent pas écrire. Réduire les outils réduit les dégâts possibles et souvent le coût.

**Budget.** Dollars et tours, par étape et par run. Quand il est atteint, le SDK coupe la session : l'agent ne finit pas sa phrase. C'est voulu : un agent qui n'a pas fini dans le budget n'aurait probablement pas fini du tout.

**Sortie structurée.** L'analyste et le relecteur rendent du JSON qui respecte un schéma (`src/schemas.ts`). Le code en aval n'a pas à « comprendre » de la prose, et un agent qui ne respecte pas le contrat est détecté immédiatement.

**Porte déterministe.** Un contrôle en code, pas en IA : `dotnet build`, `dotnet test`, les motifs de triche. On fait confiance à l'agent, puis on vérifie. Tout ce qui peut être vérifié par du code doit l'être par du code.

**Orchestrateur.** `src/run.ts`. Il enchaîne les étapes, tient le budget, décide de reboucler ou d'arrêter, écrit le rapport. Il ne contient aucune IA : il est lisible et testable.

**Transcript.** Le JSONL de chaque agent : chaque message, chaque appel d'outil, chaque résultat. C'est la boîte noire. Le lire est la compétence numéro un du pilote.

**Évaluation (bench).** Des cibles figées avec un résultat attendu. Sans elle, changer un prompt est de la superstition ; avec elle, c'est une expérience.

**Coût.** Chaque rapport donne les jetons et le prix par étape. Les postes de dépense typiques : le migrateur (il lit et écrit beaucoup), les boucles de relecture, les transcripts trop verbeux. Les leviers : fiche de poste plus précise, inventaire plus complet en entrée, modèle moins cher pour les rôles simples, budget plus serré.

## Les questions à se poser devant un échec

- L'agent avait-il l'information ? (Si non : la mettre dans le prompt d'entrée ou l'inventaire.)
- Avait-il l'outil ? (Si non : l'ajouter, à ce rôle seulement.)
- Avait-il le budget ? (Regarder `subtype` : `error_max_turns`, `error_max_budget_usd`.)
- A-t-il triché ? (Le relecteur et les contrôles disent quoi ; si un nouveau motif apparaît, l'ajouter au code.)
- Le plan était-il bon ? (Un mauvais plan coûte cher en aval : améliorer l'analyste avant le migrateur.)
- La cible est-elle simplement trop dure pour le niveau actuel ? (Alors la désactiver, et le noter.)

## Ce que le pilote raconte à la fin

Pas « j'ai fait tourner une IA », mais : « j'ai opéré une flotte d'agents sur N dépôts réels, avec un taux de réussite de X %, un coût moyen de Y $, et voilà les trois décisions qui ont le plus amélioré la fiabilité, avec les chiffres avant/après ». C'est ce récit, appuyé sur le journal et le tableau de bord, qui fait la différence.
