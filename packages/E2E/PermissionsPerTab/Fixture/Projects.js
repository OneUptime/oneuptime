/*
 * The fixture's person and their three projects. Read by the server (the
 * permissions it answers with, the labels it lists) and by the pages (the
 * project a tab picks, as the Dashboard's App.tsx does).
 *
 * The person is Project Owner of Acme Production and Viewer of Beta
 * Staging and Gamma Sandbox: Acme's Labels page offers Create Label and
 * every label's Edit, and its Danger Zone the Delete Project button; the
 * others lock them, saying which permission they need. Every record is
 * fabricated.
 */

const PERSON = {
  id: "8f000000-0000-4000-8000-000000000001",
  name: "Ada Lovelace",
  // What every signed-in person holds, whatever their teams say.
  globalPermissions: ["Public", "User", "CurrentUser"],
};

const OWNED_PROJECT = {
  id: "8f100000-0000-4000-8000-000000000001",
  name: "Acme Production",
  // The defaults every member holds, and the Owners team's role.
  permissions: ["CurrentUser", "UnAuthorizedSsoUser", "ProjectUser", "ProjectOwner"],
};

const VIEWED_PROJECT = {
  id: "8f200000-0000-4000-8000-000000000001",
  name: "Beta Staging",
  permissions: ["CurrentUser", "UnAuthorizedSsoUser", "ProjectUser", "Viewer"],
};

// A project the person is a Viewer of too, which no tab has opened yet.
const NEW_PROJECT = {
  id: "8f300000-0000-4000-8000-000000000001",
  name: "Gamma Sandbox",
  permissions: ["CurrentUser", "UnAuthorizedSsoUser", "ProjectUser", "Viewer"],
};

const PROJECTS = [OWNED_PROJECT, VIEWED_PROJECT, NEW_PROJECT];

const LABELS = {
  [OWNED_PROJECT.id]: [
    {
      id: "8f110000-0000-4000-8000-000000000001",
      name: "payments",
      description: "Everything that takes money",
      color: "#2563eb",
    },
    {
      id: "8f110000-0000-4000-8000-000000000002",
      name: "eu-west",
      description: "Resources in the EU-West region",
      color: "#16a34a",
    },
  ],
  [VIEWED_PROJECT.id]: [
    {
      id: "8f210000-0000-4000-8000-000000000001",
      name: "staging-only",
      description: "Resources that never reach production",
      color: "#d97706",
    },
  ],
  [NEW_PROJECT.id]: [
    {
      id: "8f310000-0000-4000-8000-000000000001",
      name: "experiments",
      description: "Things being tried out",
      color: "#7c3aed",
    },
  ],
};

function projectOf(id) {
  const wanted = (id || "").toString().trim().toLowerCase();

  return (
    PROJECTS.find((project) => {
      return project.id === wanted;
    }) || null
  );
}

function labelsOf(project) {
  return LABELS[project.id] || [];
}

module.exports = {
  PERSON,
  OWNED_PROJECT,
  VIEWED_PROJECT,
  NEW_PROJECT,
  PROJECTS,
  projectOf,
  labelsOf,
};
