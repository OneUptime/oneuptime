package com.oneuptime.androidagent.dropbox

/**
 * DropBox entries as Android writes them. The ones under
 * src/test/resources/dropbox were captured on an Android 15 emulator (see
 * the README's "Testing on a device"); the ones here are written to AOSP's
 * formats (ActivityManagerService.addErrorToDropBox, BootReceiver, debuggerd)
 * for the cases an emulator does not produce on demand.
 */
object DropBoxFixtures {
    fun resource(name: String): String =
        requireNotNull(DropBoxFixtures::class.java.getResource("/dropbox/$name")) { "Missing test resource dropbox/$name" }.readText()

    const val JAVA_CRASH: String =
        "Process: com.example.kiosk\n" +
            "PID: 4321\n" +
            "UID: 10190\n" +
            "Frozen: false\n" +
            "Flags: 0x38c83e44\n" +
            "Package: com.example.kiosk v42 (4.2.0)\n" +
            "Foreground: Yes\n" +
            "Process-Runtime: 12804\n" +
            "Build: google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys\n" +
            "Crash-Handler: com.android.internal.os.RuntimeInit\$KillApplicationHandler\n" +
            "Loading-Progress: 1.0\n" +
            "Dropped-Count: 2\n" +
            "\n" +
            "java.lang.IllegalStateException: Card 4111111111111111 declined for jane@example.com\n" +
            "\tat com.example.kiosk.PaymentFlow.charge(PaymentFlow.kt:88)\n" +
            "\tat com.example.kiosk.MainActivity.onPay(MainActivity.kt:41)\n" +
            "\tat android.view.View.performClick(View.java:7659)\n" +
            "Caused by: java.io.IOException: terminal offline\n" +
            "\tat com.example.payments.Terminal.send(Terminal.java:12)\n" +
            "\t... 3 more\n" +
            "\n" +
            "--------- beginning of main\n" +
            "11-19 14:00:00.000  1000  1000 I SomeOtherApp: a line of someone else's\n"

    const val ANR: String =
        "Process: com.example.kiosk\n" +
            "PID: 4321\n" +
            "UID: 10190\n" +
            "Package: com.example.kiosk v42 (4.2.0)\n" +
            "Foreground: Yes\n" +
            "Activity: com.example.kiosk/.MainActivity\n" +
            "Subject: Input dispatching timed out (8b3b1a2 com.example.kiosk/com.example.kiosk.MainActivity is not responding. Waited 5001ms for KeyEvent)\n" +
            "Build: google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys\n" +
            "Loading-Progress: 1.0\n" +
            "Dropped-Count: 0\n" +
            "\n" +
            "CPU usage from 0ms to 7426ms later (2026-11-19 14:00:00.000 to 2026-11-19 14:00:07.426):\n" +
            "  93% 4321/com.example.kiosk: 90% user + 3% kernel / faults: 2 minor\n" +
            "\n" +
            "----- pid 4321 at 2026-11-19 14:00:01.123 -----\n" +
            "Cmd line: com.example.kiosk\n" +
            "\n" +
            "\"Signal Catcher\" daemon prio=10 tid=2 Runnable\n" +
            "  | group=\"system\" sCount=0 ucsCount=0 flags=0 obj=0x12c40258 self=0x7b1c\n" +
            "  at art::DumpCheckpoint\n" +
            "\n" +
            "\"main\" prio=5 tid=1 Sleeping\n" +
            "  | group=\"main\" sCount=1 ucsCount=0 flags=1 obj=0x72c9e5b8 self=0xb400\n" +
            "  | sysTid=4321 nice=-10 cgrp=top-app sched=0/0 handle=0x7f8\n" +
            "  at java.lang.Thread.sleep(Native method)\n" +
            "  - sleeping on <0x0a1b2c3d> (a java.lang.Object)\n" +
            "  at java.lang.Thread.sleep(Thread.java:450)\n" +
            "  at com.example.kiosk.MainActivity.onClick(MainActivity.kt:42)\n" +
            "  at android.view.View.performClick(View.java:7659)\n" +
            "\n" +
            "\"RenderThread\" prio=7 tid=15 Native\n" +
            "  at android.os.MessageQueue.nativePollOnce(Native method)\n"

    // The native crash report ActivityManager files for an app, its headers then debuggerd's lines.
    const val NATIVE_CRASH: String =
        "Process: com.example.kiosk\n" +
            "PID: 4321\n" +
            "UID: 10190\n" +
            "Package: com.example.kiosk v42 (4.2.0)\n" +
            "Foreground: Yes\n" +
            "Build: google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys\n" +
            "Dropped-Count: 0\n" +
            "\n" +
            "*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***\n" +
            "Build fingerprint: 'google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys'\n" +
            "Revision: '0'\n" +
            "ABI: 'x86_64'\n" +
            "Timestamp: 2026-11-19 14:00:00.123456789+0000\n" +
            "Process uptime: 12s\n" +
            "Cmdline: com.example.kiosk\n" +
            "pid: 4321, tid: 4350, name: PrinterThread  >>> com.example.kiosk <<<\n" +
            "uid: 10190\n" +
            "signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000010\n" +
            "Cause: null pointer dereference\n" +
            "    rax 0000000000000000  rbx 00007b1c5a2e1000  rcx 0000000000000001  rdx 0000000000000010\n" +
            "\n" +
            "backtrace:\n" +
            "      #00 pc 000000000005a4c4  /data/app/~~Zh3x==/com.example.kiosk-Ab1==/lib/x86_64/libprinter.so (print_job(Job*)+52) (BuildId: 1a2b3c)\n" +
            "      #01 pc 0000000000039b70  /data/app/~~Zh3x==/com.example.kiosk-Ab1==/base.apk!libbridge.so (offset 0x1f000) (Java_com_example_Printer_print+40) (BuildId: 4d5e)\n" +
            "      #02 pc 00000000001d2b3a  /apex/com.android.art/lib64/libart.so (art_quick_generic_jni_trampoline+42) (BuildId: 9f8e)\n" +
            "\n" +
            "memory near rdx:\n" +
            "    0000000000000000 ................ ................  ................\n"

    // A tombstone of a system daemon: no app, only debuggerd's lines with the boot's headers.
    const val TOMBSTONE: String =
        "isPrevious: true\n" +
            "Build: google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys\n" +
            "Hardware: ranchu\n" +
            "Revision: 0\n" +
            "Bootloader: unknown\n" +
            "Radio: \n" +
            "Kernel: Linux version 6.6.30-android15 (build-user@build-host)\n" +
            "Dropped-Count: 0\n" +
            "\n" +
            "*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***\n" +
            "Build fingerprint: 'google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys'\n" +
            "ABI: 'x86_64'\n" +
            "Cmdline: /vendor/bin/hw/android.hardware.printer-service\n" +
            "pid: 812, tid: 812, name: printer-service  >>> /vendor/bin/hw/android.hardware.printer-service <<<\n" +
            "uid: 1000\n" +
            "signal 6 (SIGABRT), code -1 (SI_QUEUE), fault addr --------\n" +
            "Abort message: 'Check failed: fd >= 0 token=abc123 (fd=-1)'\n" +
            "backtrace:\n" +
            "      #00 pc 0000000000068c4f  /apex/com.android.runtime/lib64/bionic/libc.so (abort+191) (BuildId: aa)\n" +
            "      #01 pc 0000000000012345  /vendor/lib64/libprinterhal.so (PrinterHal::open()+77) (BuildId: bb)\n" +
            "\n" +
            "--- --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---\n" +
            "    #00 pc 0000000000000001  /system/lib64/other_thread.so\n"

    const val WATCHDOG: String =
        "Process: system_server\n" +
            "Subject: Blocked in handler on foreground thread (android.fg), Blocked in handler on display thread (android.display)\n" +
            "Build: google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys\n" +
            "Dropped-Count: 0\n" +
            "\n" +
            "\"main\" prio=5 tid=1 Native\n" +
            "  at android.os.MessageQueue.nativePollOnce(Native method)\n" +
            "\n" +
            "\"android.fg\" prio=5 tid=31 Blocked\n" +
            "  at com.android.server.am.ActivityManagerService.broadcastIntent(ActivityManagerService.java:15000)\n" +
            "  - waiting to lock <0x0b1c> held by thread 74\n" +
            "\n"

    const val SYSTEM_RESTART: String =
        "isPrevious: true\n" +
            "Build: google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys\n" +
            "Hardware: ranchu\n" +
            "\n"

    const val SYSTEM_BOOT: String =
        "isPrevious: true\n" +
            "Build: google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys\n" +
            "Hardware: ranchu\n" +
            "Kernel: Linux version 6.6.30-android15\n" +
            "\n"

    const val LAST_KERNEL_LOG: String =
        "isPrevious: true\n" +
            "Build: google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys\n" +
            "Hardware: ranchu\n" +
            "\n" +
            "[[TRUNCATED]]\n" +
            "[ 8812.110000] wlan0: deauthenticating from 00:11:22:33:44:55 by local choice (Reason: 3=DEAUTH_LEAVING)\n" +
            "[ 8812.200000] thermal thermal_zone0: critical temperature reached (105 C), shutting down\n" +
            "[ 8812.200100] Kernel panic - not syncing: Fatal exception in interrupt\n" +
            "[ 8812.200200] CPU: 2 PID: 0 Comm: swapper/2 Tainted: G W\n" +
            "\n" +
            "Boot info:\n" +
            "Last boot reason: kernel_panic\n"
}
