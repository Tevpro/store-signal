"""Approve only the visible StoreSignal loopback optional-host prompt in Xvfb.

This drives the ordinary Chromium permission dialog by X11 pointer after OCR verifies
its exact identity and loopback host. It does NOT call chrome.permissions, CDP
permission APIs or preseed a profile. Run in a separate shell while headed probe waits.
"""
import csv
import io
import os
import subprocess
import tempfile
import time

if not os.environ.get("DISPLAY"):
    raise SystemExit("DISPLAY required")
with tempfile.TemporaryDirectory(prefix="storesignal-permission-") as tmp:
    image = os.path.join(tmp, "screen.png")
    for _ in range(60):
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "x11grab",
                        "-video_size", "1280x900", "-i", os.environ["DISPLAY"],
                        "-frames:v", "1", "-y", image], check=True)
        result = subprocess.run(["tesseract", image, "stdout", "--psm", "11", "tsv"],
                                check=True, capture_output=True, text=True)
        rows = list(csv.DictReader(io.StringIO(result.stdout), delimiter="\t"))
        words = [r for r in rows if r.get("text", "").strip() and int(r["level"]) == 5]
        visible = " ".join(r["text"] for r in words).lower()
        if ("storesignal" in visible and "requested additional permissions" in visible
                and "read and change your data on 127.0.0.1" in visible):
            allow = [r for r in words if r["text"].strip().lower() == "allow"]
            if len(allow) == 1:
                r = allow[0]
                x = int(r["left"]) + int(r["width"]) // 2
                y = int(r["top"]) + int(r["height"]) // 2
                subprocess.run(["xdotool", "mousemove", str(x), str(y), "click", "1"], check=True)
                print(f"Clicked visible Chromium StoreSignal loopback Allow UI at {x},{y}", flush=True)
                break
        time.sleep(1)
    else:
        raise SystemExit("No verified StoreSignal loopback permission dialog found")
