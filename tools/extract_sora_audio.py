#!/usr/bin/env python3
"""Extract and normalize the user's character Sora audio for the mobile game.

The current mobile videos intentionally have no audio track.  This tool creates
small, independently controlled MP3 cues from the original Google Drive clips,
and bakes in the game's 1.3x playback speed so audio remains synchronized.
"""

from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path


def _drive_root() -> Path:
    """素材夾位置。優先讀環境變數 HF_DRIVE_ROOT，否則自動找 Google Drive 掛載點。

    刻意不寫死帳號路徑（本專案是公開 repo，不放個人信箱）。素材夾 2026-08-12 由
    「英雄旅途」改名為「英雄命運抽（heroes fate)」，兩個名字都試。
    """
    env = os.environ.get("HF_DRIVE_ROOT")
    if env:
        return Path(env)
    for mount in sorted(Path.home().glob("Library/CloudStorage/GoogleDrive-*/我的雲端硬碟")):
        for folder in ("英雄命運抽（heroes fate)", "英雄旅途"):
            candidate = mount / folder / "角色圖"
            if candidate.is_dir():
                return candidate
    raise SystemExit(
        "找不到素材夾。請設環境變數 HF_DRIVE_ROOT 指向 Google Drive 的「角色圖」資料夾。"
    )


DRIVE_ROOT = _drive_root()

ATTACK = {
    "knight": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_85a35951-107b-46d7-b95a-de130a0c1349_generated_video.mp4",
    "paladin": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_98f11503-ff58-4b09-b051-dca8a7a84945_generated_video.mp4",
    "ranger": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_1587a5f2-7e7c-4870-814c-2ea1b357ff05_generated_video.mp4",
    "orc_archer": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_4fe31390-c6d2-485d-8ff7-ae413665c683_generated_video.mp4",
    "axeman": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_fc11f013-bcbe-4401-ba85-8863a22a075c_generated_video.mp4",
    "amazon": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_fabf11a7-9ac6-4b45-9a71-38a0c0734f51_generated_video.mp4",
    "dark_fighter": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_b85537c0-5564-4dfd-93a5-cba01fe610e8_generated_video.mp4",
    "assassin": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_73b0aded-4b98-4a1b-befd-ddfd5008ce37_generated_video.mp4",
    "archmage": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_daef7dde-9ad2-4f38-a4b4-1bebd1901cb6_generated_video.mp4",
    "dark_mage": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_79a2459a-e5cd-4db9-845c-d5bdd4d74ab4_generated_video.mp4",
    "dark_elf": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_ac594548-7f76-4d89-8bc6-8af711cc2faa_generated_video.mp4",
    "monk": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_1f9496b7-b798-4bfa-b748-cc6392dd9dac_generated_video.mp4",
    "princess": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_62e2a9ae-1700-402c-b464-8482ad556d15_generated_video.mp4",
}

VICTORY = {
    "knight": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_082db04e-96e8-4479-a16f-950ea5429e7e_generated_video.MP4",
    "paladin": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_4816c572-1963-4eb0-a8c3-fb8c0919481b_generated_video.MP4",
    "ranger": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_8777d01b-0433-4ba8-8660-e6faa886f5c5_generated_video.mp4",
    "orc_archer": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_38a9eef7-3dde-4406-bac0-85abe2d1b65b_generated_video.mp4",
    "axeman": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_01ace485-0d8f-455b-b49f-6b4f5cc2b1c5_generated_video.MP4",
    "amazon": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_d5bcb535-db77-40fb-a746-a5608a441b10_generated_video.MP4",
    "dark_fighter": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_87e4e7ae-5ed8-4c71-b8b7-390e98c1e4a8_generated_video.mp4",
    "assassin": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_8cae900e-0826-4304-9f54-c0109f922509_generated_video.MP4",
    "archmage": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_7af7adc1-b657-4eeb-a615-07701541040a_generated_video.MP4",
    "dark_mage": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_92ff40c1-3981-4ff5-9159-1c4dcb6bd91d_generated_video.mp4",
    "dark_elf": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_a35d2e9c-0174-4b25-a556-a36bc9001a94_generated_video.mp4",
    "monk": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_ba783ecd-eea1-4aed-bc79-edf4fde962b1_generated_video.mp4",
    "princess": "_users_53143e72-7374-4621-a602-314dea6b47d3_generated_02cdf1ec-05e0-4a5d-ba8b-1ffcb6b9eb4b_generated_video.mp4",
}


def extract(source: Path, target: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source), "-map", "0:a:0", "-vn",
            "-af", "atempo=1.3,loudnorm=I=-18:LRA=7:TP=-1.5",
            "-codec:a", "libmp3lame", "-b:a", "96k", "-ar", "32000",
            str(target),
        ],
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "assets" / "audio" / "heroes",
    )
    args = parser.parse_args()
    groups = (
        ("attack", DRIVE_ROOT / "攻擊魔王動畫", ATTACK),
        ("victory", DRIVE_ROOT / "角色勝利動畫", VICTORY),
    )
    for category, folder, mapping in groups:
        for hero_id, filename in mapping.items():
            extract(folder / filename, args.output / category / f"{hero_id}.mp3")
            print(f"extracted {category}/{hero_id}.mp3")


if __name__ == "__main__":
    main()
