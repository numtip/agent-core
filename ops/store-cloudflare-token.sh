#!/usr/bin/env bash
# เก็บ Cloudflare API token เข้าไฟล์ที่ปลอดภัย (mode 600) โดยไม่ให้ค่าลง shell history
# ใช้:  bash ~/agent-workspace/agent-core/ops/store-cloudflare-token.sh
set -euo pipefail

DIR="$HOME/.config/agent-core"
FILE="$DIR/cloudflare.token"

mkdir -p "$DIR"
chmod 700 "$DIR"

if [ -s "$FILE" ]; then
  read -r -p "มีไฟล์เดิมอยู่แล้วและมีข้อมูล ($FILE) — เขียนทับ? [y/N] " ans
  case "$ans" in y|Y|yes|YES) ;; *) echo "ยกเลิก ไม่แก้อะไร"; exit 0;; esac
fi

printf 'วาง Cloudflare API token แล้วกด Enter (ค่าจะไม่แสดงบนจอ): '
IFS= read -rs TOKEN
echo
if [ -z "${TOKEN//[[:space:]]/}" ]; then echo "FAIL: ไม่มีค่า token"; exit 1; fi

umask 077  # เขียนแบบ owner-only
printf '%s' "$TOKEN" > "$FILE"
unset TOKEN
chmod 600 "$FILE"

LEN=$(wc -c < "$FILE")
echo "บันทึกแล้ว: $FILE"
echo "  perms=$(stat -c '%a %U:%G' "$FILE")  length=${LEN} chars"
echo "  fingerprint=sha256:$(sha256sum "$FILE" | cut -c1-8)  (เก็บไว้เทียบ ไม่ใช่ตัว token)"
echo
echo "ขั้นต่อไป:"
echo "  python3 ~/agent-workspace/agent-core/ops/cloudflare-edge.py --verify"
