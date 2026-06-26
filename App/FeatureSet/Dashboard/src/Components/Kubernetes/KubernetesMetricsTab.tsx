/*
 * Re-export stub. The component is product-agnostic and has been
 * promoted to Components/Infrastructure/ResourceMetricsTab.tsx so the
 * Proxmox / Ceph detail pages can share it. This file keeps existing
 * Kubernetes imports working unchanged.
 */
export * from "../Infrastructure/ResourceMetricsTab";
export { default } from "../Infrastructure/ResourceMetricsTab";
