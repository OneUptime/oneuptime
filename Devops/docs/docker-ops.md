# Docker Troubleshooting

### Error:

```
Docker | failed to solve with frontend dockerfile.v0: failed to create LLB definition: rpc error: code = Unknown desc
```

Solution:

Factory reset docker and then,

```
rm ~/.docker/config.json
```

### Error:

```
No such file or directory for /var/lib/docker/overlay2
```

Solution:

Remove node_modules from the Common, CommonServer, Model, CommonUI project.
