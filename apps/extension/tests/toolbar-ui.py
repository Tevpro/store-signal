"""Click StoreSignal through visible Chromium Extensions toolbar on a private Xvfb display.

Only a fresh OCR-confirmed menu entry is clicked. No permission APIs or CDP
browser-chrome input; the Chromium toolbar and menu receive actual X11 input.
"""
import csv
import io
import os
import subprocess
import tempfile
import time

if not os.environ.get("DISPLAY"):
    raise SystemExit("DISPLAY required; headed Chromium only")


def visible_words(image):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "x11grab",
                    "-video_size", "1280x900", "-i", os.environ["DISPLAY"],
                    "-frames:v", "1", "-y", image], check=True)
    output = subprocess.run(["tesseract", image, "stdout", "--psm", "11", "tsv"],
                            check=True, capture_output=True, text=True).stdout
    return [row for row in csv.DictReader(io.StringIO(output), delimiter="\t")
            if row.get("text", "").strip() and row["level"] == "5"]


with tempfile.TemporaryDirectory(prefix="storesignal-toolbar-") as tmp:
    image = os.path.join(tmp, "screen.png")
    subprocess.run(["xdotool", "mousemove", "1170", "62", "click", "1"], check=True)
    for _ in range(12):
        time.sleep(0.3)
        words = visible_words(image)
        visible = " ".join(row["text"] for row in words).lower()
        matches = [row for row in words if row["text"].lower() == "storesignal"]
        if "extensions" in visible and len(matches) == 1:
            row = matches[0]
            x = int(row["left"]) + int(row["width"]) // 2
            y = int(row["top"]) + int(row["height"]) // 2
            if not (850 < x < 1200 and 100 < y < 500):
                raise SystemExit(f"StoreSignal menu label outside toolbar menu: {x},{y}")
            subprocess.run(["xdotool", "mousemove", str(x), str(y), "click", "1"], check=True)
            print(f"Clicked visible Chromium Extensions > StoreSignal at {x},{y}; popup target must be verified separately", flush=True)
            break
    else:
        raise SystemExit("Visible Extensions menu with StoreSignal entry not verified")
