# Local AI with vLLM

OneUptime's AI features (AI Agent, incident/exception AI) talk to LLM providers
configured in the dashboard. Any OpenAI-compatible endpoint works via a custom
Base URL. This chart can optionally run [vLLM](https://docs.vllm.ai) — a
production-grade, OpenAI-compatible inference server — **inside your cluster**, so
those features use your own GPUs and no data leaves your infrastructure.

## Requirements

vLLM is **disabled by default**. It requires:

- NVIDIA GPU nodes with the
  [NVIDIA device plugin](https://github.com/NVIDIA/k8s-device-plugin) or
  [GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/index.html)
  installed. The official vLLM image is a CUDA build and cannot run on CPU-only
  nodes.

## Enable it

```yaml
vllm:
  enabled: true
  # HuggingFace model id to serve. Default is small (~3GB), Apache-2.0 and not gated.
  model: Qwen/Qwen2.5-1.5B-Instruct
  # Optional: protect the endpoint; use the same value as the API Key in the dashboard.
  apiKey: my-secret-key
  # Schedule onto your GPU nodes if they are tainted:
  # nodeSelector: { nvidia.com/gpu.present: "true" }
  # tolerations: [{ key: nvidia.com/gpu, operator: Exists, effect: NoSchedule }]
  # runtimeClassName: nvidia   # if your cluster uses the GPU Operator's runtime class
```

For gated models (e.g. `meta-llama/*`), set `vllm.huggingFace.token` (or point
`vllm.huggingFace.existingSecret` at a secret you manage). If the model does not
fit your GPU's memory at its full context window, cap it with
`vllm.extraArgs: ["--max-model-len=8192"]`.

## Automatic provider registration

When enabled, vLLM is **registered automatically as a Global LLM Provider** at
startup (`vllm.globalProvider.enabled`, default `true`), so AI features work for
all projects with no dashboard setup. It appears under **AI Agents > LLM
Providers** as "OneUptime AI" (configurable via `vllm.globalProvider.name` and
`vllm.globalProvider.description`).

The registration is declarative:

- Disabling `vllm.globalProvider.enabled` (or `vllm.enabled`) removes the
  auto-registered provider on the next deploy.
- Manual edits to its env-managed fields (name, description, type, model, base
  URL, API key) in the Admin Dashboard are overwritten. Other fields — such as
  the token cost used for AI-credit billing — are left alone.

Two caveats:

- Project-scoped AI Agents cannot use global providers (they need a
  project-specific LLM Provider).
- On installs with `billing.enabled: true`, global providers are subject to
  AI-credit balance checks.

## Wire it up manually instead

Set `vllm.globalProvider.enabled: false` and go to **AI Agents > LLM Providers >
Create LLM Provider**:

- **LLM Provider**: `OpenAI Compatible`
- **Base URL**: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`
- **Model Name**: the value of `vllm.servedModelName`, or the full HuggingFace
  model id if unset
- **API Key**: the value of `vllm.apiKey`; leave blank if you did not set one
  (vLLM is keyless by default)

## Scaling & upgrades

- The first startup downloads the model, which can take a while; the pod reports
  `Running` but not `Ready` until the model is loaded (the startup probe allows
  ~40 minutes). Weights are cached on a per-replica PVC (`vllm.persistence`), so
  restarts are much faster.
- `vllm.replicaCount: N` runs N independent copies of the model (each needs its
  own GPU and cache volume), load-balanced by the service. Cross-pod tensor
  parallelism is not supported; for multi-GPU inference in a single pod use
  `vllm.extraArgs: ["--tensor-parallel-size=2"]` with a matching
  `nvidia.com/gpu` limit.
- With one replica, a pod restart (e.g. a `helm upgrade` that changes the image
  tag) means LLM downtime until the model is reloaded.

## Day-2 operations

Smoke tests, changing models, and GPU scheduling: see the
[vLLM ops guide](../../../Docs/Vllm.md).
