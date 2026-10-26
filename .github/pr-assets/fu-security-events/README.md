# Security Events: Approvals, a case's Playbooks and the counted menu entries

Before and after frames for "'Waiting for Approval' is cut short beside its
count at 768-1023px" (the task doc's Security Events follow-ups, from #5134).

Rendered from the real Security Events layout and side menu in headless
Chromium at a 2x device pixel ratio, from the Security Operations offline
fixture (`packages/E2E/SecurityOperations`), with Inter, Tailwind and
`Theme.css`. 800px is a tablet's window, where the side menu is 224px wide
(768 to 1023px); 1280px a laptop's. The "before" frames are this branch with
the page's old name put back. Every record in them is made up.

A case's own menu had the same fault: its counted Playbook Runs entry was cut
short in ten languages, six of them (German, French, Spanish, Italian,
Portuguese and Dutch) even at 1280px. The entry is Playbooks now. The case
frames are CASE-142 from the same fixture, with the old name put back for
"before".

| File | Shows |
| --- | --- |
| `before-menu-800-en.png` | "Waiting for App..." cut short beside its count of 1, at 800px. |
| `after-menu-800-en.png` | "Approvals" whole beside its count. |
| `before-menu-800-de.png` | German "Wartet auf Genehmigung" cut short at 800px. |
| `after-menu-800-de.png` | "Genehmigungen" whole. ("Playbook-Ausführungen", which has no count, is still cut at this width: a follow-up.) |
| `before-menu-1280-de.png` | German cut short even at 1280px, beside the 256px menu. |
| `after-menu-1280-de.png` | Whole at 1280px. |
| `after-menu-800-en-dark.png` | Dark theme, 800px. |
| `after-menu-800-ja.png` | Japanese: 承認待ち, and Assigned to Me as 自分の担当 (自分に割り当て済み was cut by 2px). |
| `after-menu-800-fa.png` | Persian, right to left: تأییدها. |
| `after-menu-800-en-page.png` | The page at 800px: the breadcrumb and the card read Approvals; a held run keeps its Waiting for Approval status. |
| `before-case-menu-1280-de.png` | A case's menu in German at 1280px: "Playbook-Ausführu..." cut short beside its count of 1. |
| `after-case-menu-1280-de.png` | "Playbooks" whole beside its count. |
| `before-case-menu-1280-fr.png` | French at 1280px: "Exécutions de play..." cut short. |
| `after-case-menu-1280-fr.png` | "Playbooks" whole. |
| `after-case-menu-1280-en-page.png` | The case's page at 1280px: the breadcrumb and the card read Playbooks; the held run keeps its Waiting for Approval status. |
