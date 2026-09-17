/*
 * Preloaded into the synthetic monitor's Firefox only (see
 * FIREFOX_NO_SYNC_LIBRARY_PATH in SyntheticBrowser.ts). The browser's profile
 * is created for one check and deleted after it, so nothing it writes needs to
 * survive a crash; syncing it only makes the browser wait for the disk.
 * fsync() and fdatasync() still reject a bad descriptor, as the real calls
 * would, and otherwise return success without flushing.
 */
#define _GNU_SOURCE
#include <fcntl.h>

static int is_open_descriptor(int fd) {
  return fcntl(fd, F_GETFD) != -1;
}

int fsync(int fd) {
  return is_open_descriptor(fd) ? 0 : -1;
}

int fdatasync(int fd) {
  return is_open_descriptor(fd) ? 0 : -1;
}
