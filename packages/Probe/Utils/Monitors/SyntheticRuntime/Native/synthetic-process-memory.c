/*
 * Reports the proportional set size (PSS) of synthetic worker processes to the
 * probe's memory watchdog (PROCESS_MEMORY_HELPER_PATH in ProcessTreeMemory.ts).
 *
 *   synthetic-process-memory <uid> <gid> <pid>...
 *
 * prints one line per pid, in order: "<pid> <pss in kB>", or "<pid> -" when
 * that process's PSS cannot be read (it exited, or the kernel refused).
 *
 * Chromium runs a check as a dozen processes that each map the same browser
 * binary, and the same shared-memory buffers twice. Summing their VmRSS counts
 * those pages once per process -- about 100 MB per renderer -- so an ordinary
 * check could read 1.6 GB while holding 0.9 GB. PSS divides every shared page
 * among the processes that map it, so the tree's PSS adds up to what it holds.
 *
 * /proc/<pid>/smaps_rollup is where PSS lives, and the kernel opens it only
 * for a reader whose filesystem ids match the target's ids, or that holds
 * CAP_SYS_PTRACE over it. The probe supervisor is root without CAP_SYS_PTRACE
 * and every check runs under its own uid, so the supervisor cannot read the
 * file itself. It starts this helper, which switches its effective ids to the
 * check's (see switch_effective_identity) with the CAP_SETUID and CAP_SETGID
 * the supervisor already holds, and reads it from there. Nothing the helper
 * prints depends on anything the check controls except the kernel's own
 * accounting.
 *
 * A process can still make its PSS unreadable -- PR_SET_DUMPABLE 0 is enough
 * -- so "-" is expected, and the watchdog counts such a process at its full
 * VmRSS. Hiding a process's PSS can therefore only raise the total.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/fsuid.h>
#include <unistd.h>

#define MAX_PIDS 4096
#define ROLLUP_BUFFER_BYTES 16384

enum {
  EXIT_USAGE = 2,
  EXIT_IDENTITY = 3,
  EXIT_OUTPUT = 4,
};

/* A positive decimal no larger than max, with nothing around it. */
static int parse_positive(const char *text, unsigned long max,
                          unsigned long *value) {
  char *end = NULL;
  unsigned long parsed;

  if (text[0] < '0' || text[0] > '9') {
    return -1;
  }

  errno = 0;
  parsed = strtoul(text, &end, 10);
  if (errno != 0 || end == text || *end != '\0' || parsed < 1 ||
      parsed > max) {
    return -1;
  }

  *value = parsed;
  return 0;
}

/*
 * The PSS line of a smaps_rollup, in kB. "Pss:" only at the start of a line,
 * so Pss_Anon, Pss_File and friends never match.
 */
static int parse_pss(const char *rollup, unsigned long long *pss_kb) {
  const char *line = rollup;

  while (line != NULL && *line != '\0') {
    if (strncmp(line, "Pss:", 4) == 0) {
      const char *cursor = line + 4;
      char *end = NULL;
      unsigned long long parsed;

      while (*cursor == ' ' || *cursor == '\t') {
        cursor++;
      }
      if (*cursor < '0' || *cursor > '9') {
        return -1;
      }

      errno = 0;
      parsed = strtoull(cursor, &end, 10);
      if (errno != 0 || end == cursor || strncmp(end, " kB", 3) != 0) {
        return -1;
      }

      *pss_kb = parsed;
      return 0;
    }

    line = strchr(line, '\n');
    if (line != NULL) {
      line++;
    }
  }

  return -1;
}

static int read_pss(unsigned long pid, unsigned long long *pss_kb) {
  char path[64];
  char rollup[ROLLUP_BUFFER_BYTES];
  size_t length = 0;
  int fd;

  if (snprintf(path, sizeof(path), "/proc/%lu/smaps_rollup", pid) >=
      (int)sizeof(path)) {
    return -1;
  }

  fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) {
    return -1;
  }

  while (length < sizeof(rollup) - 1) {
    ssize_t count = read(fd, rollup + length, sizeof(rollup) - 1 - length);
    if (count < 0) {
      if (errno == EINTR) {
        continue;
      }
      close(fd);
      return -1;
    }
    if (count == 0) {
      break;
    }
    length += (size_t)count;
  }

  close(fd);
  rollup[length] = '\0';
  return parse_pss(rollup, pss_kb);
}

/*
 * Only the effective ids change; the real and saved ids stay root. That is
 * what lets the helper in and keeps the measured processes out:
 *
 * - The kernel lets a reader open another process's smaps_rollup when the
 *   reader's fsuid/fsgid equal that process's uids and gids (the effective
 *   ids set the filesystem ids too). A Chromium sandbox process is also
 *   non-dumpable and lives in a user namespace the check created, so the
 *   reader must also hold CAP_SYS_PTRACE there -- which the kernel grants to
 *   a process whose effective uid owns that namespace. An fsuid switch alone
 *   reads an unsandboxed Chromium but not a sandboxed one.
 * - A process may signal another only when its real or effective uid is the
 *   other's real or saved uid, and may ptrace it only with the same uid in
 *   all three. Both stay root here, so the check cannot do either.
 */
static int switch_effective_identity(uid_t uid, gid_t gid) {
  uid_t real_uid;
  uid_t effective_uid;
  uid_t saved_uid;
  gid_t real_gid;
  gid_t effective_gid;
  gid_t saved_gid;

  if (setresgid((gid_t)-1, gid, (gid_t)-1) != 0 ||
      setresuid((uid_t)-1, uid, (uid_t)-1) != 0) {
    return -1;
  }

  if (getresuid(&real_uid, &effective_uid, &saved_uid) != 0 ||
      getresgid(&real_gid, &effective_gid, &saved_gid) != 0) {
    return -1;
  }

  if (effective_uid != uid || effective_gid != gid ||
      (uid_t)setfsuid((uid_t)-1) != uid ||
      (gid_t)setfsgid((gid_t)-1) != gid) {
    return -1;
  }

  return 0;
}

int main(int argc, char **argv) {
  unsigned long uid;
  unsigned long gid;
  int index;

  if (argc < 4 || argc - 3 > MAX_PIDS ||
      parse_positive(argv[1], 0xfffffffeUL, &uid) != 0 ||
      parse_positive(argv[2], 0xfffffffeUL, &gid) != 0) {
    fprintf(stderr, "usage: %s <uid> <gid> <pid>...\n", argv[0]);
    return EXIT_USAGE;
  }

  for (index = 3; index < argc; index++) {
    unsigned long pid;
    if (parse_positive(argv[index], 0x3fffffffUL, &pid) != 0) {
      fprintf(stderr, "invalid pid: %s\n", argv[index]);
      return EXIT_USAGE;
    }
  }

  if (switch_effective_identity((uid_t)uid, (gid_t)gid) != 0) {
    fprintf(stderr, "could not switch the effective identity to %lu:%lu\n",
            uid, gid);
    return EXIT_IDENTITY;
  }

  for (index = 3; index < argc; index++) {
    unsigned long pid = strtoul(argv[index], NULL, 10);
    unsigned long long pss_kb;

    if (read_pss(pid, &pss_kb) == 0) {
      printf("%lu %llu\n", pid, pss_kb);
    } else {
      printf("%lu -\n", pid);
    }
  }

  if (fflush(stdout) != 0 || ferror(stdout)) {
    return EXIT_OUTPUT;
  }

  return 0;
}
