#!/usr/bin/env python3
"""Extract the strongest 12-second highlights from the user's character music.

Sources stay untouched in Google Drive. Outputs are normalized, short-faded MP3
loops used by the Web Audio selection soundtrack.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path


def _default_source() -> Path:
    """伴奏來源夾。優先讀環境變數 HF_DRIVE_BGM，否則自動找 Google Drive 掛載點。

    刻意不寫死帳號路徑（本專案是公開 repo，不放個人信箱）。素材夾 2026-08-12 由
    「英雄旅途」改名為「英雄命運抽（heroes fate)」，兩個名字都試。
    """
    env = os.environ.get("HF_DRIVE_BGM")
    if env:
        return Path(env)
    for mount in sorted(Path.home().glob("Library/CloudStorage/GoogleDrive-*/我的雲端硬碟")):
        for folder in ("英雄命運抽（heroes fate)", "英雄旅途"):
            candidate = mount / folder / "伴奏"
            if candidate.is_dir():
                return candidate
    return Path("伴奏")  # 交由呼叫端報錯，或用 --source 指定


DEFAULT_SOURCE = _default_source()
PROJECT_ROOT = Path(__file__).resolve().parents[1]
HIGHLIGHT_SECONDS = 12.0

# hero id: (source folder, generated MP4 filename, highlight start seconds)
HERO_TRACKS = {
    "knight": ("皇家騎士", "gemini_generated_video_D719BBB9.mp4", 17.00),
    "paladin": ("聖騎士", "gemini_generated_video_92C226E0.mp4", 16.50),
    "ranger": ("精靈弓箭手", "gemini_generated_video_6457C965.mp4", 9.00),
    "orc_archer": ("幽靈射手", "gemini_generated_video_86C62E46.mp4", 17.25),
    "axeman": ("斧頭男", "gemini_generated_video_1C7668E5.mp4", 17.00),
    "amazon": ("女狂戰士", "gemini_generated_video_C7BBCCBC.mp4", 2.00),
    "dark_fighter": ("賽亞人", "gemini_generated_video_7A2098E4.mp4", 17.00),
    "assassin": ("暗影刺客 (1)", "gemini_generated_video_CE0F384A.mp4", 16.00),
    "archmage": ("大法師", "gemini_generated_video_09B573B9.mp4", 17.00),
    "dark_mage": ("魔靈召喚師", "gemini_generated_video_0DC8B2D6.mp4", 15.00),
    "dark_elf": ("巫毒薩滿", "gemini_generated_video_05314A7B.mp4", 17.00),
    "monk": ("憎侶", "gemini_generated_video_0D6F0787.mp4", 12.00),
    "princess": ("皇家公主", "gemini_generated_video_1A3EC0E8.mp4", 5.50),
    "dragon_knight": ("龍騎士", "gemini_generated_video_CAE914DB.mp4", 13.00),
}


def render_highlight(source: Path, start: float, output: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    audio_filter = (
        "afade=t=in:st=0:d=0.18,"
        "afade=t=out:st=11.72:d=0.28,"
        "loudnorm=I=-14:TP=-1.5:LRA=7"
    )
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{start:.2f}",
            "-i",
            str(source),
            "-t",
            f"{HIGHLIGHT_SECONDS:.2f}",
            "-vn",
            "-af",
            audio_filter,
            "-ar",
            "44100",
            "-ac",
            "2",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "96k",
            str(output),
        ],
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found")

    render_highlight(
        args.source_root / "開始遊戲選單伴奏",
        17.00,
        PROJECT_ROOT / "assets/audio/bgm/home_custom.mp3",
    )
    for hero_id, (folder, filename, start) in HERO_TRACKS.items():
        render_highlight(
            args.source_root / "角色選擇伴奏" / folder / filename,
            start,
            PROJECT_ROOT / f"assets/audio/heroes/bgm/{hero_id}.mp3",
        )
        print(f"{hero_id}: {start:.2f}s–{start + HIGHLIGHT_SECONDS:.2f}s")


if __name__ == "__main__":
    main()
