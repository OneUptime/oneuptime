# What the container runtime saw of each container in namespace $NS, for
# run.sh's not_ready: its state, what its main process is waiting in, and its
# last lines. A container can run, log nothing through `kubectl logs` and
# answer no exec probe while the events say little (k3s on ubuntu-26.04,
# #6184); the runtime and /proc still say what it is doing.
#
# Run on a node as root through node_sh, with NS and CRICTL (crictl, or
# "k3s crictl") set in front of this text. Plain sh, so a KinD node runs it too.
for id in $(${CRICTL} ps -a -q --label "io.kubernetes.pod.namespace=${NS}"); do
  echo "--- container ${id}"
  ${CRICTL} inspect --output go-template --template '{{.status.metadata.name}} {{.status.state}} exit={{.status.exitCode}} reason={{.status.reason}} pid={{.info.pid}}' "${id}" 2>&1
  echo
  pid="$(${CRICTL} inspect --output go-template --template '{{.info.pid}}' "${id}" 2>/dev/null)"
  if [ -n "${pid}" ] && [ "${pid}" != "0" ] && [ -d "/proc/${pid}" ]; then
    grep -E '^(Name|State):' "/proc/${pid}/status"
    echo "wchan: $(cat "/proc/${pid}/wchan" 2>/dev/null)"
    head -n 20 "/proc/${pid}/stack" 2>/dev/null
    ps -o pid,stat,wchan:32,args --ppid "${pid}" 2>&1
  fi
  echo "--- its last lines"
  ${CRICTL} logs --tail 50 "${id}" 2>&1
done
