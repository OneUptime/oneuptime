/*
 * The global Runner's JavaScript sandbox launcher: starts one JavaScript
 * step's process as a user of its own, nothing of the Runner's own.
 *
 * The Runner's image installs it setuid root, owned root:node with mode
 * 4750, so the Runner's group alone may run it (packages/Runner/
 * Dockerfile.tpl). It needs root for one thing: to switch the step's
 * process to the step's user. Everything else it does as the user that ran
 * it, or as the step's user.
 *
 *   javascript-sandbox check
 *       Exits 0 when it can switch a process to a sandbox user, 71 when the
 *       container does not let it (no-new-privileges, allowPrivilegeEscalation
 *       false, SETUID or SETGID dropped, or the file lost its setuid bit).
 *
 *   javascript-sandbox run <uid> <program> [arguments...]
 *       Runs <program> as <uid> (and the group of the same number), in a
 *       session of its own, with no supplementary group, no privilege it
 *       could ever regain (no_new_privs), core dumps and file writes off,
 *       standard input, output, error, the result channel (fd 3) and the
 *       HTTP channel (fd 4) only,
 *       in /, with an environment of only the names ALLOWED_ENVIRONMENT
 *       lists. The step's process is killed when this process ends
 *       (PR_SET_PDEATHSIG), and this process, which gives up root and keeps
 *       the user that ran it as its real user (hold_step), ends when that
 *       user's process does. So the Runner ends a step by ending this
 *       process, which it may signal.
 *       Exits with the program's exit code, or 128 + the signal that ended it.
 *
 *   javascript-sandbox reap <uid>
 *       Kills every process <uid> still has in this PID namespace, as <uid>:
 *       what an ended step left behind, before the Runner gives <uid> to
 *       another step.
 *
 * <uid> must lie in [SANDBOX_IDENTITY_MIN, SANDBOX_IDENTITY_MAX]
 * (packages/Runner/Utils/JavaScriptSandbox/SandboxIdentity.ts has the same
 * range). A caller whose own user or group lies in it is refused: a step's
 * process must never start another.
 *
 * Exit codes: 64 usage, 65 a user outside the range, 66 a refused caller,
 * 70 an internal failure, 71 no privilege to switch users.
 */

#define _GNU_SOURCE

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define SANDBOX_IDENTITY_MIN 61000UL
#define SANDBOX_IDENTITY_MAX 64999UL

#define EXIT_USAGE 64
#define EXIT_IDENTITY_OUT_OF_RANGE 65
#define EXIT_REFUSED_CALLER 66
#define EXIT_INTERNAL 70
#define EXIT_NO_PRIVILEGE 71

/* fds 0, 1 and 2, the result channel and the HTTP channel. */
#define FIRST_FD_TO_CLOSE 5

/* Threads count as processes here, and Node runs about a dozen. */
#define SANDBOX_PROCESS_LIMIT 256
#define SANDBOX_OPEN_FILE_LIMIT 1024

#define REAP_ROUNDS 3

extern char **environ;

/*
 * The only names the step's process is given, taken from this process's own
 * environment, which the Runner builds for it. Nothing that tells Node to
 * load code (NODE_OPTIONS), and none of the Runner's settings or keys.
 */
static const char *const ALLOWED_ENVIRONMENT[] = {
    "PATH",          "NODE_PATH",     "NODE_ENV", "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE", "SSL_CERT_DIR",  "TZ",       "LANG",
    "LC_ALL",        NULL,
};

#define MAX_ENVIRONMENT_ENTRIES 16

static int is_sandbox_identity(unsigned long value) {
  return value >= SANDBOX_IDENTITY_MIN && value <= SANDBOX_IDENTITY_MAX;
}

/* A user number written as digits only, within the range; 0 otherwise. */
static unsigned long parse_identity(const char *text) {
  unsigned long value = 0;
  size_t length = strlen(text);

  if (length == 0 || length > 5) {
    return 0;
  }

  for (size_t index = 0; index < length; index++) {
    if (text[index] < '0' || text[index] > '9') {
      return 0;
    }
    value = value * 10 + (unsigned long)(text[index] - '0');
  }

  return is_sandbox_identity(value) ? value : 0;
}

/*
 * The whole switch: no supplementary groups, then the group's real,
 * effective and saved ids, then the user's, then proof that each took and
 * that root cannot be regained. 0 on success.
 */
static int switch_identity(unsigned long identity) {
  uid_t uid = (uid_t)identity;
  gid_t gid = (gid_t)identity;
  uid_t ruid, euid, suid;
  gid_t rgid, egid, sgid;

  if (setgroups(0, NULL) != 0) {
    return -1;
  }
  if (setresgid(gid, gid, gid) != 0) {
    return -1;
  }
  if (setresuid(uid, uid, uid) != 0) {
    return -1;
  }
  if (getresuid(&ruid, &euid, &suid) != 0 || ruid != uid || euid != uid ||
      suid != uid) {
    return -1;
  }
  if (getresgid(&rgid, &egid, &sgid) != 0 || rgid != gid || egid != gid ||
      sgid != gid) {
    return -1;
  }
  if (getgroups(0, NULL) != 0) {
    return -1;
  }
  if (setresuid(0, 0, 0) == 0) {
    return -1;
  }

  return 0;
}

/*
 * The launcher, while the step runs: the caller's group, the caller's user
 * as its real user and the step's user as its effective and saved one, and
 * no capability (a change of user away from root clears them all). With the
 * caller's real user the caller may signal it; with the step's effective
 * user its death may signal the step: the kernel sends the parent-death
 * signal with the dying parent's own credentials, and a launcher back to the
 * caller's user alone would have no right to signal the step's.
 */
static int hold_step(uid_t caller_uid, gid_t caller_gid,
                     unsigned long identity) {
  uid_t step_uid = (uid_t)identity;
  uid_t ruid, euid, suid;

  if (setresgid(caller_gid, caller_gid, caller_gid) != 0) {
    return -1;
  }
  if (setresuid(caller_uid, step_uid, step_uid) != 0) {
    return -1;
  }
  if (getresuid(&ruid, &euid, &suid) != 0 || ruid != caller_uid ||
      euid != step_uid || suid != step_uid) {
    return -1;
  }

  return 0;
}

static int set_limit(int resource, rlim_t value) {
  struct rlimit limit;
  limit.rlim_cur = value;
  limit.rlim_max = value;
  return setrlimit(resource, &limit);
}

static int set_sandbox_limits(void) {
  if (set_limit(RLIMIT_CORE, 0) != 0) {
    return -1;
  }
  /* No file it writes may hold a byte. Pipes are not files. */
  if (set_limit(RLIMIT_FSIZE, 0) != 0) {
    return -1;
  }
  if (set_limit(RLIMIT_NPROC, SANDBOX_PROCESS_LIMIT) != 0) {
    return -1;
  }
  if (set_limit(RLIMIT_NOFILE, SANDBOX_OPEN_FILE_LIMIT) != 0) {
    return -1;
  }
  return 0;
}

/*
 * Every fd from first up. close_range(2) where the kernel has it (5.9+);
 * otherwise each fd /proc/self/fd lists, so none above any limit survives.
 */
static void close_fds_from(int first) {
  DIR *directory;
  struct dirent *entry;

  if (close_range((unsigned int)first, ~0U, 0) == 0) {
    return;
  }

  directory = opendir("/proc/self/fd");

  if (directory == NULL) {
    for (int fd = first; fd < 65536; fd++) {
      (void)close(fd);
    }
    return;
  }

  while ((entry = readdir(directory)) != NULL) {
    char *end = NULL;
    long fd = strtol(entry->d_name, &end, 10);

    if (end != entry->d_name && *end == '\0' && fd >= first &&
        fd != dirfd(directory)) {
      (void)close((int)fd);
    }
  }

  (void)closedir(directory);
}

static int is_allowed_name(const char *entry) {
  for (size_t index = 0; ALLOWED_ENVIRONMENT[index] != NULL; index++) {
    size_t length = strlen(ALLOWED_ENVIRONMENT[index]);

    if (strncmp(entry, ALLOWED_ENVIRONMENT[index], length) == 0 &&
        entry[length] == '=') {
      return 1;
    }
  }
  return 0;
}

/* The allowed names this process was given; the rest is left behind. */
static void build_environment(char **out) {
  size_t count = 0;

  for (char **entry = environ; entry != NULL && *entry != NULL; entry++) {
    if (count >= MAX_ENVIRONMENT_ENTRIES - 1) {
      break;
    }
    if (is_allowed_name(*entry)) {
      out[count++] = *entry;
    }
  }

  out[count] = NULL;
}

/* Every standard stream on /dev/null, and nothing else open. */
static void detach_streams(void) {
  int null_fd = open("/dev/null", O_RDWR | O_CLOEXEC);

  if (null_fd >= 0) {
    (void)dup2(null_fd, STDIN_FILENO);
    (void)dup2(null_fd, STDOUT_FILENO);
    (void)dup2(null_fd, STDERR_FILENO);
    if (null_fd > STDERR_FILENO) {
      (void)close(null_fd);
    }
  }

  close_fds_from(STDERR_FILENO + 1);
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
  if (WIFSIGNALED(status)) {
    return 128 + WTERMSIG(status);
  }
  return EXIT_INTERNAL;
}

static int check(void) {
  pid_t child = fork();

  if (child < 0) {
    return EXIT_INTERNAL;
  }

  if (child == 0) {
    _exit(switch_identity(SANDBOX_IDENTITY_MIN) == 0 ? 0 : EXIT_NO_PRIVILEGE);
  }

  return wait_for(child);
}

static int reap(unsigned long identity) {
  pid_t child = fork();

  if (child < 0) {
    return EXIT_INTERNAL;
  }

  if (child == 0) {
    struct timespec pause = {0, 5 * 1000 * 1000};

    if (switch_identity(identity) != 0) {
      _exit(EXIT_NO_PRIVILEGE);
    }

    /*
     * As the step's user, every process that user has here, and only those:
     * kill(-1) reaches the processes the caller may signal, and never the
     * caller itself. It answers success whenever any other process exists,
     * signalled or not, so it says nothing of what is left: a few rounds
     * catch a process forked during the one before, and the Runner then
     * reads /proc for anything still alive (SandboxIdentityPool.release).
     */
    for (int round = 0; round < REAP_ROUNDS; round++) {
      (void)kill(-1, SIGKILL);
      (void)nanosleep(&pause, NULL);
    }

    _exit(0);
  }

  return wait_for(child);
}

static int run(unsigned long identity, char **program_argv) {
  uid_t caller_uid = getuid();
  gid_t caller_gid = getgid();
  pid_t runner = getppid();
  pid_t launcher = getpid();
  pid_t child;
  int ready[2];
  char ready_byte = 'r';

  if (program_argv[0] == NULL || program_argv[0][0] != '/') {
    return EXIT_USAGE;
  }

  /*
   * The step's process waits on this until the launcher holds the step's
   * user (hold_step): only from then on would the launcher's death kill it.
   */
  if (pipe2(ready, O_CLOEXEC) != 0) {
    return EXIT_INTERNAL;
  }

  child = fork();

  if (child < 0) {
    return EXIT_INTERNAL;
  }

  if (child == 0) {
    char *environment[MAX_ENVIRONMENT_ENTRIES];
    char byte = 0;
    ssize_t count;

    (void)close(ready[1]);

    if (setsid() < 0) {
      _exit(EXIT_INTERNAL);
    }
    if (switch_identity(identity) != 0) {
      _exit(EXIT_NO_PRIVILEGE);
    }
    /*
     * After the switch: a change of user clears the parent-death signal.
     * And if the launcher ended before it was set, end now.
     */
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) != 0) {
      _exit(EXIT_INTERNAL);
    }
    if (getppid() != launcher) {
      _exit(EXIT_INTERNAL);
    }

    do {
      count = read(ready[0], &byte, 1);
    } while (count < 0 && errno == EINTR);

    /* The launcher ended before it could take the step with it. */
    if (count != 1 || getppid() != launcher) {
      _exit(EXIT_INTERNAL);
    }
    (void)close(ready[0]);

    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
      _exit(EXIT_INTERNAL);
    }
    if (set_sandbox_limits() != 0) {
      _exit(EXIT_INTERNAL);
    }

    close_fds_from(FIRST_FD_TO_CLOSE);

    if (chdir("/") != 0) {
      _exit(EXIT_INTERNAL);
    }

    (void)umask(077);
    build_environment(environment);
    execve(program_argv[0], program_argv, environment);
    _exit(EXIT_INTERNAL);
  }

  (void)close(ready[0]);

  /*
   * The launcher gives up root and holds the step's user (hold_step), so
   * the user that ran it may end it, and its end ends the step's process;
   * and it ends when that user's process ends. Then it lets the step go on.
   * Its copies of the step's streams are closed, so the Runner reads the end
   * of the step's output when the step's process closes it.
   */
  if (hold_step(caller_uid, caller_gid, identity) != 0) {
    (void)kill(child, SIGKILL);
    (void)wait_for(child);
    return EXIT_INTERNAL;
  }
  if (prctl(PR_SET_PDEATHSIG, SIGKILL) != 0 || getppid() != runner) {
    return EXIT_INTERNAL;
  }

  if (write(ready[1], &ready_byte, 1) != 1) {
    return EXIT_INTERNAL;
  }
  (void)close(ready[1]);

  detach_streams();

  return wait_for(child);
}

int main(int argc, char **argv) {
  unsigned long identity;

  if (is_sandbox_identity((unsigned long)getuid()) ||
      is_sandbox_identity((unsigned long)getgid())) {
    return EXIT_REFUSED_CALLER;
  }

  if (argc == 2 && strcmp(argv[1], "check") == 0) {
    return check();
  }

  if (argc == 3 && strcmp(argv[1], "reap") == 0) {
    identity = parse_identity(argv[2]);
    return identity == 0 ? EXIT_IDENTITY_OUT_OF_RANGE : reap(identity);
  }

  if (argc >= 4 && strcmp(argv[1], "run") == 0) {
    identity = parse_identity(argv[2]);
    return identity == 0 ? EXIT_IDENTITY_OUT_OF_RANGE : run(identity, argv + 3);
  }

  return EXIT_USAGE;
}
