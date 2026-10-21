/*
 * Where an installation of OneUptime on a Vercel team stands
 * (VercelMarketplaceInstallation.status).
 *
 * Vercel asks to delete an installation when the team uninstalls OneUptime.
 * It then waits up to 24 hours for the final invoice: the installation is
 * DeletePending until OneUptime has deleted its projects, billed what they
 * used since the last invoice and told Vercel billing is finalized, and
 * Deleted after.
 */
enum VercelInstallationStatus {
  Active = "Active",
  DeletePending = "DeletePending",
  Deleted = "Deleted",
}

export default VercelInstallationStatus;
