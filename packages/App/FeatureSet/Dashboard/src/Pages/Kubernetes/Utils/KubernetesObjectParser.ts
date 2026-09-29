/*
 * Re-export stub. The parsers have moved to Common/Types/Kubernetes/ so
 * the server-side telemetry ingest path can use the same code. This file
 * keeps existing imports under the Dashboard path working unchanged.
 */
export * from "Common/Types/Kubernetes/KubernetesObjectParser";
