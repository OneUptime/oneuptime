### vLLM Ops

The chart can run an opt-in [vLLM](https://docs.vllm.ai) server (`vllm.enabled: true`) that serves local models over an OpenAI-compatible API for OneUptime's AI features. See "Local models with vLLM" in the [chart README](../Public/oneuptime/README.md) for enabling and connecting it. This page covers day-2 operations. Commands below assume the release is named `oneuptime` and installed in the `default` namespace.

### Smoke test the endpoint

```bash
kubectl port-forward --namespace default svc/oneuptime-vllm 8000:8000
```

```bash
# List served models (add -H "Authorization: Bearer <vllm.apiKey>" if you set an API key)
curl http://localhost:8000/v1/models

# Test a completion
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "Qwen/Qwen2.5-1.5B-Instruct", "messages": [{"role": "user", "content": "Say hello"}]}'
```

The `model` field must match `vllm.servedModelName` (or the full HuggingFace id from `vllm.model` if unset).

### Watch the model load

The pod is `Running` but not `Ready` while the model downloads and loads (the startup probe allows ~40 minutes). Follow progress with:

```bash
kubectl logs --namespace default oneuptime-vllm-0 -f
```

If the pod stays `Pending`, check the scheduling events with `kubectl describe pod --namespace default oneuptime-vllm-0`:

- `Insufficient nvidia.com/gpu` — no node can satisfy the GPU request. Check that GPU nodes exist, the NVIDIA device plugin (or GPU Operator) is installed, and `vllm.nodeSelector`/`vllm.tolerations` match your GPU nodes.
- `pod has unbound immediate PersistentVolumeClaims` — the `data-oneuptime-vllm-0` cache PVC cannot bind, typically because the cluster has no default StorageClass. Set `vllm.persistence.storageClass` (or `global.storageClass`) to an existing StorageClass, or set `vllm.persistence.enabled: false` to fall back to a node-disk emptyDir.

### Change the served model

Set `vllm.model` (and optionally `vllm.servedModelName`) and run `helm upgrade`. The pod restarts and downloads the new model into the same cache volume. Remember to update the Model Name in the OneUptime LLM Provider settings to match.

For gated models (e.g. `meta-llama/*`), set a HuggingFace token:

```yaml
vllm:
  huggingFace:
    token: hf_xxx
    # or reference a secret you manage:
    # existingSecret:
    #   name: my-hf-secret
    #   key: token
```

### Fix startup OOM on small GPUs

vLLM allocates the KV cache for the model's full context window at startup. If the pod crash-loops with a CUDA out-of-memory error, cap the context length or reduce the GPU memory fraction:

```yaml
vllm:
  extraArgs:
    - "--max-model-len=8192"
    - "--gpu-memory-utilization=0.85"
```

### Reclaim or resize the model cache

Each replica has its own PVC (named `data-oneuptime-vllm-<ordinal>`) holding model weights and compile caches. It is safe to delete when the pod is gone — weights re-download on next start:

```bash
kubectl delete pvc --namespace default data-oneuptime-vllm-0
```

Kubernetes forbids changing a StatefulSet's `volumeClaimTemplates`, so editing `vllm.persistence.size` (or `.storageClass`, or toggling `.enabled`) after install makes the API server reject the StatefulSet update and the `helm upgrade` fail. To resize:

```bash
# 1. Expand each existing PVC directly (the storage class must have allowVolumeExpansion):
kubectl patch pvc --namespace default data-oneuptime-vllm-0 \
  -p '{"spec":{"resources":{"requests":{"storage":"100Gi"}}}}'

# 2. Set vllm.persistence.size to the same value in your Helm values, then
#    recreate the StatefulSet without deleting pods or PVCs, and upgrade:
kubectl delete statefulset --namespace default oneuptime-vllm --cascade=orphan
helm upgrade ...
```

Also note that rotating `vllm.apiKey` or `vllm.huggingFace.token` via `helm upgrade` restarts the pods automatically (the pod template carries a checksum of the chart-managed secret), but rotating a key inside an externally managed secret (`existingApiKeySecret`/`huggingFace.existingSecret`) does not — run `kubectl rollout restart statefulset oneuptime-vllm` after rotating those.

### Read the API key

If `vllm.apiKey` was set (and no existing secret referenced), it is stored in a chart-managed secret:

```bash
echo $(kubectl get secret --namespace default oneuptime-vllm -o jsonpath="{.data.api-key}" | base64 -d)
```
