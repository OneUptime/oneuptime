/*
 * The global Runner's JavaScript sandbox, off the network: runs one
 * JavaScript step's process so that it can open no network socket of any
 * kind.
 *
 * It needs no privilege and has none: the Runner's image installs it root's,
 * mode 0755, never setuid (packages/Runner/Dockerfile.tpl). The Runner runs
 * it in front of each step's worker - through the javascript-sandbox
 * launcher, as the step's own user, or by itself where the container does
 * not let the launcher switch users - and it turns the system calls below
 * into errors with a seccomp filter before it runs the worker. The step's
 * HTTP goes through the Runner instead (SandboxHttp), which sends it to
 * public addresses only. So code that got out of the step's isolate reaches
 * nothing by itself: not the app, a database or a cache on the cluster's or
 * Compose's network, not the Kubernetes API, not a cloud metadata endpoint,
 * not the internet.
 *
 *   - socket(2) and socketpair(2), for every family: no TCP, UDP, raw,
 *     netlink or Unix socket. The only sockets the step's process holds are
 *     the ones the Runner gave it, its standard streams and channels, each
 *     already connected to the Runner.
 *   - io_uring, which opens sockets without socket(2). Node.js tries it and
 *     goes on without it, so it is told the kernel does not have it.
 *   - ptrace(2), process_vm_readv(2), process_vm_writev(2) and
 *     pidfd_getfd(2), which reach into another process of the same user -
 *     the Runner's own, where the step runs as the Runner's user - and could
 *     use its connections.
 *   - any system call of another table (x32, i386 or 32-bit Arm), whose
 *     numbers a filter on this one's would not catch: the process is killed.
 *
 * A seccomp filter holds for the program it runs and every program that one
 * starts, and nothing lifts it: the kernel keeps it for the process's life,
 * and the no_new_privs it needs, set here, stays set across every exec.
 *
 *   javascript-sandbox-no-network check
 *       Exits 0 when a process here can be kept off the network this way,
 *       72 when the kernel or the container does not let it (no seccomp
 *       filters).
 *
 *   javascript-sandbox-no-network <program> [arguments...]
 *       Runs <program> (by its full path) under the filter, with this
 *       process's environment and open files. Exits 72 without running it
 *       when the filter cannot be set.
 *
 * Exit codes: 64 usage, 70 an internal failure, 72 no filter.
 */

#define _GNU_SOURCE

#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define EXIT_USAGE 64
#define EXIT_INTERNAL 70
#define EXIT_NO_FILTER 72

#if defined(__x86_64__)
#define SANDBOX_AUDIT_ARCH AUDIT_ARCH_X86_64
/* x32's calls are this architecture's, with this bit set in their number. */
#define X32_SYSCALL_BIT 0x40000000U
#elif defined(__aarch64__)
#define SANDBOX_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
#error "javascript-sandbox-no-network knows the system calls of x86_64 and aarch64 only"
#endif

extern char **environ;

/* The system call whose number is in the accumulator fails with this errno. */
#define REFUSE(number, error)                                                  \
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (number), 0, 1),                         \
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ((error) & SECCOMP_RET_DATA))

static struct sock_filter NO_NETWORK_FILTER[] = {
    /* Another architecture's table: killed. */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SANDBOX_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),

    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),

#if defined(X32_SYSCALL_BIT)
    BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, X32_SYSCALL_BIT, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
#endif

    /* No socket of any family. */
    REFUSE(__NR_socket, EACCES),
    REFUSE(__NR_socketpair, EACCES),

    /* No io_uring, which opens sockets without socket(2). */
    REFUSE(__NR_io_uring_setup, ENOSYS),
    REFUSE(__NR_io_uring_enter, ENOSYS),
    REFUSE(__NR_io_uring_register, ENOSYS),

    /* Nothing of another process's: its memory, or its open connections. */
    REFUSE(__NR_ptrace, EPERM),
    REFUSE(__NR_process_vm_readv, EPERM),
    REFUSE(__NR_process_vm_writev, EPERM),
    REFUSE(__NR_pidfd_getfd, EPERM),

    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
};

/*
 * The filter, on this process and everything it runs from now on. 0 on
 * success. no_new_privs first: without it, a process with no privilege may
 * set no filter.
 */
static int keep_off_network(void) {
  struct sock_fprog program;

  program.len = (unsigned short)(sizeof(NO_NETWORK_FILTER) /
                                 sizeof(NO_NETWORK_FILTER[0]));
  program.filter = NO_NETWORK_FILTER;

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    return -1;
  }
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) {
    return -1;
  }

  return 0;
}

static int wait_for(pid_t child) {
  int status = 0;

  while (waitpid(child, &status, 0) < 0) {
    if (errno != EINTR) {
      return EXIT_INTERNAL;
    }
  }

  if (WIFEXITED(status)) {
    return WEXITSTATUS(status);
  }
  return EXIT_INTERNAL;
}

/* Whether a socket is refused once the filter is set, in a child of its own. */
static int is_socket_refused(int family) {
  int fd;

  errno = 0;
  fd = socket(family, SOCK_STREAM | SOCK_CLOEXEC, 0);

  if (fd >= 0) {
    (void)close(fd);
    return 0;
  }

  return errno == EACCES;
}

static int check(void) {
  pid_t child = fork();

  if (child < 0) {
    return EXIT_INTERNAL;
  }

  if (child == 0) {
    if (keep_off_network() != 0) {
      _exit(EXIT_NO_FILTER);
    }
    if (!is_socket_refused(AF_INET) || !is_socket_refused(AF_INET6) ||
        !is_socket_refused(AF_UNIX)) {
      _exit(EXIT_NO_FILTER);
    }
    _exit(0);
  }

  return wait_for(child);
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "check") == 0) {
    return check();
  }

  /* A program by its full path only, never looked up on PATH. */
  if (argc < 2 || argv[1][0] != '/') {
    return EXIT_USAGE;
  }

  if (keep_off_network() != 0) {
    return EXIT_NO_FILTER;
  }

  execve(argv[1], argv + 1, environ);
  return EXIT_INTERNAL;
}
