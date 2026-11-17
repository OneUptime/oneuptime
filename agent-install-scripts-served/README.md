# agent-install-scripts-served: screenshots

The UI review of PR #5455 (agent install scripts served by OneUptime itself).
Every shot is the real Dashboard component, bundled with the Dashboard's own
esbuild config into a scratch harness (Inter, the Tailwind runtime with the
reading-direction plugin, the API answered with fixtures) and shot at 2x in
headless Chromium. The guides sit beside a stand-in for the side menu, as
`Page` lays a product page out, so a code block is as wide as it is in the
product: about 95 characters at 1280 pixels, 65 at 1024.

Names end in `-github` (before #5455: the command downloads from GitHub's
master branch, as in the maintainer's screenshot), `-before` (master with
#5455) or `-after` (this PR). The ingestion key is a picked key (a uuid), as
the key picker hands it to the guide.

## The setup guides' "Install the agent" step

- `proxmox-install-1280-*.png`: the Proxmox guide's step 3, the surface of the
  maintainer's screenshot. Before, the run line ran past the code block: the
  key and `bash install.sh` sat behind a sideways scroll. After, each value is
  on a line of its own, every line but the last ending in a backslash, so the
  whole command reads; a shell joins the lines into the same command.
- `proxmox-install-selfhosted-1280-*.png`: the same on a self-hosted
  OneUptime (`https://oneuptime.internal.acme-corp.example:8443`). Before, not
  even the start of the key showed.
- `proxmox-install-1024-*.png`, `proxmox-install-390-after.png`: beside the
  side menu at 1024, and on a phone.
- `proxmox-install-{dark,de,fa}-1280-after.png`: dark, German and Persian.
- `database-install-1280-*.png`, `storage-install-1280-*.png`: the Database
  and Storage Array guides, whose run lines carry the most values.
- `swarm-compose-1280-*.png`: the Docker Swarm guide's Docker Compose step.
  The files download under their own names (`curl -fsSLO`), as every other
  agent's do, so each line fits; the sentence that repeated the step's
  description is gone.

## The upgrade dialog (the sign beside an outdated agent version)

- `upgrade-storage-1280-*.png`: before, the download wrapped and left
  `install.sh` alone at the start of a line, where it read as a command of its
  own. After, each line of a wrapped command is drawn on its own and the rest
  of a line that wraps is indented under it.
- `upgrade-proxmox-390-*.png`, `upgrade-proxmox-selfhosted-1280-*.png`: an
  address wraps after a slash of its path (`https://oneuptime.com/`
  `install/proxmox-agent`), not mid-word (`.../ins` `tall/...`).
- `upgrade-swarm-compose-de-390-*.png`: German on a phone. A step title that
  wraps continues at the text's own line height instead of one 36px line a
  row.
- `upgrade-storage-{dark-1280,fa-390}-after.png`: dark, and Persian on a phone.

## The Host AI agent page (AI, then AI agent, with no agent connected)

- `aiagent-installer-390-*.png`, `aiagent-installer-fa-390-after.png`,
  `aiagent-installer-dark-1280-after.png`: the installer block. The command
  wraps line by line; the URL and the host's name in "It asks for..." are
  values of their own: whole, and in Persian with their brackets on the right
  side (before: "(prod-" at a line's end, "web-01)" on the next).
- `aiagent-variables-1280-*.png`: the variables table under "Install it
  yourself with Docker Compose". Before, its values broke mid-word to a
  column a few letters wide ("from ." / "env", "(empt" / "y)").

## Reviewed, unchanged

- `connection-card-{1280,390}-after.png`: a disconnected Proxmox cluster's
  "This cluster stopped sending data" card, step "Run the diagnostic script".
- `host-ai-topic-1280-after.png`: the Host guide's Advanced topic "Add the
  OneUptime AI agent".
