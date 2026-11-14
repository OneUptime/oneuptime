#!/usr/bin/perl
# A process whose PID in this KinD node is the same as in the host's root PID
# namespace, for the agent eBPF e2e (run.sh; README.md, "kind and k3s").
#
# A KinD node is a container with a PID namespace of its own. The chart's
# profiler pods run with hostPID, which on kind is the node's namespace: the
# kernel hands the profiler a sample's root-namespace PID, and the profiler
# looks that number up in the node's /proc. On a real node the two numbers are
# one; on kind they never are, so the chart's profiler resolves none of the
# node's processes, and on arm64 it drops the samples it cannot resolve.
#
# clone3 with set_tid (Linux 5.5) picks a child's PID in each PID namespace it
# is in. Run in the apps node by `docker exec` -- root of a privileged
# container in the host's user namespace, as KinD nodes are -- it starts one
# process whose PID is the same in the node and in the host's root namespace,
# which the chart's profiler on that node resolves as it resolves every process
# on a real node. The process is the node's own shell in a busy loop at the
# lowest priority (nice 19), so it takes only CPU time nothing else wants.
#
# Usage: perl same-pid.pl <seconds> <file>
# Writes "samePid=<pid>" to <file> once the process runs, or "error=<why>".
# Stops it after <seconds> unless it has been stopped already, and then adds
# "ended=<how>": "signal 15" when run.sh stopped it, "exit 127" when the
# shell could not be started, "after <seconds>s" when its time ran out.

use strict;
use warnings;
use POSIX ();

my ($seconds, $file) = @ARGV;
die "usage: perl same-pid.pl <seconds> <file>\n"
  unless defined $file && $seconds =~ /^\d+$/;

sub report {
    my (@lines) = @_;
    open(my $out, '>', "$file.tmp") or die "$file.tmp: $!\n";
    print {$out} map { "$_\n" } @lines;
    close($out) or die "$file.tmp: $!\n";
    rename("$file.tmp", $file) or die "$file: $!\n";
}

# One number on every architecture: the system call table is shared from 424 on.
my $SYS_clone3 = 435;

open(my $max, '<', '/proc/sys/kernel/pid_max') or die "pid_max: $!\n";
chomp(my $pid_max = <$max>);
close($max);

for my $attempt (1 .. 64) {
    # A number from the top half of the range. One in use in either
    # namespace makes clone3 fail with EEXIST, and another is tried.
    my $pid = int($pid_max / 2) + int(rand($pid_max / 2 - 1));
    # set_tid: the PID in the child's own namespace (the node's) first, then
    # in its parent (the host's root namespace).
    my $set_tid = pack('l2', $pid, $pid);
    my $args = pack(
        'Q11',
        0,                                      # flags
        0, 0, 0,                                # pidfd, child_tid, parent_tid
        POSIX::SIGCHLD(),                       # exit_signal
        0, 0, 0,                                # stack, stack_size, tls
        unpack('Q', pack('p', $set_tid)), 2,    # set_tid, set_tid_size
        0                                       # cgroup
    );
    my $child = syscall($SYS_clone3, $args, length($args));
    if ($child == 0) {
        # nice and sh each replace this process: the loop keeps its PID.
        exec('nice', '-n', '19', 'sh', '-c', 'while :; do :; done') or POSIX::_exit(127);
    }
    if ($child > 0) {
        report("samePid=$child");
        my $deadline = time() + $seconds;
        my $ended;
        while (!defined($ended) && time() < $deadline) {
            if (waitpid($child, POSIX::WNOHANG()) == $child) {
                $ended = ($? & 127) ? 'signal ' . ($? & 127) : 'exit ' . ($? >> 8);
            } else {
                sleep(1);
            }
        }
        if (!defined($ended)) {
            kill('KILL', $child);
            waitpid($child, 0);
            $ended = "after ${seconds}s";
        }
        report("samePid=$child", "ended=$ended");
        exit(0);
    }
    next if $! == POSIX::EEXIST();
    report("error=clone3: $!");
    exit(1);
}
report('error=no PID was free in both namespaces after 64 tries');
exit(1);
