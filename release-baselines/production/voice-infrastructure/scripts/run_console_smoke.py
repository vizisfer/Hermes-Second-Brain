#!/usr/bin/env python3
"""Kısa, sessiz LiveKit Agent + Gemini Live oturum açılış testi."""
import fcntl
import os
import pty
import select
import shlex
import signal
import struct
import subprocess
import termios
import time
from pathlib import Path

HOME = Path.home()
PROFILE = os.environ.get("HERMES_PROFILE", "voice-infrastructure-bot")
HERMES = HOME / ".local/bin/hermes"
LK = HOME / ".local/bin/lk"
PROJECT = Path(__file__).resolve().parents[1]


def descendant_pids(root_pid):
    children = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            rest = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            parent = int(rest[1])
            children.setdefault(parent, []).append(int(entry.name))
        except (OSError, ValueError, IndexError):
            continue
    result, pending = [], list(children.get(root_pid, []))
    while pending:
        pid = pending.pop()
        result.append(pid)
        pending.extend(children.get(pid, []))
    return result


def is_running(pid):
    try:
        status = (Path(f"/proc/{pid}") / "status").read_text()
        state = next(line.split()[1] for line in status.splitlines() if line.startswith("State:"))
        return state != "Z"
    except (OSError, StopIteration, IndexError):
        return False


base_env = {
    "HOME": str(HOME),
    "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
    "LANG": os.environ.get("LANG", "C.UTF-8"),
}
if os.environ.get("HERMES_HOME"):
    base_env["HERMES_HOME"] = os.environ["HERMES_HOME"]

path_result = subprocess.run(
    [str(HERMES), "-p", PROFILE, "config", "env-path"],
    capture_output=True, text=True, env=base_env, timeout=8, check=True,
)
env_file = Path(path_result.stdout.strip())
if not env_file.is_absolute():
    raise SystemExit("Hermes env path is not absolute; test not started")

allowed = {
    "GOOGLE_API_KEY", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
    "VOICE_PROVIDER", "GEMINI_LIVE_MODEL", "GEMINI_LIVE_LANGUAGE", "GEMINI_LIVE_VOICE",
}
for line in env_file.read_text(encoding="utf-8").splitlines():
    text = line.strip()
    if not text or text.startswith("#") or "=" not in text:
        continue
    key, raw = text.split("=", 1)
    if key in allowed:
        parts = shlex.split(raw)
        base_env[key] = parts[0] if parts else ""
base_env.update({
    "HERMES_PROFILE": PROFILE,
    "VOICE_AUTO_GREETING": "false",
    "HERMES_STATUS_TOOL": "false",
})
required = ("GOOGLE_API_KEY", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")
if any(not base_env.get(k) for k in required):
    raise SystemExit("Required test configuration missing; values withheld")

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 28, 120, 0, 0))
proc = subprocess.Popen(
    [str(LK), "agent", "console", "--text", "src/agent.mjs"],
    cwd=PROJECT, env=base_env, stdin=slave, stdout=slave, stderr=slave,
    start_new_session=True, close_fds=True,
)
os.close(slave)
os.set_blocking(master, False)
chunks = []
start = time.monotonic()
ready_marker = b"Voice session ready provider=Gemini model=gemini-3.8-live"
ready = False
try:
    while time.monotonic() - start < 35:
        readable, _, _ = select.select([master], [], [], 0.25)
        if readable:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            chunks.append(data)
            if ready_marker in b"".join(chunks):
                ready = True
                time.sleep(0.8)
                break
        if proc.poll() is not None:
            break
finally:
    spawned = descendant_pids(proc.pid)
    for pid in reversed(spawned):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    for pid in spawned:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        pass
    try:
        while True:
            if not select.select([master], [], [], 0.1)[0]:
                break
            chunks.append(os.read(master, 65536))
    except OSError:
        pass
    os.close(master)

log = b"".join(chunks).decode("utf-8", errors="replace").lower()
remaining = [pid for pid in spawned if is_running(pid)]
print("LiveKit local console reached model-ready marker:", "yes" if ready else "no")
print("Gemini prompt/audio sent:", "no")
print("Credential/auth rejection marker:", "yes" if any(s in log for s in ("401 unauthorized", "403 forbidden", "authentication failed")) else "no")
print("Console and spawned worker processes stopped:", "yes" if proc.poll() is not None and not remaining else "no")
if not ready or remaining:
    raise SystemExit(1)
