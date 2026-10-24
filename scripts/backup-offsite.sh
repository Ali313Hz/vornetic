#!/usr/bin/env bash
# scripts/backup-offsite.sh — an encrypted copy of the newest backup, off this server.
#
#   scripts/backup-offsite.sh            the newest database snapshot + product photos (data/uploads)
#   scripts/backup-offsite.sh --db-only  only the database snapshot (small: fine every hour)
#
# Run by cron on the server (README → Yedek). Free tools: age (encryption) and rclone (copy to
# the cloud storage you choose). Settings: scripts/backup.env (copy backup.env.example).
# - Encrypted with your age PUBLIC key only: the server can't decrypt its own backups, so someone
#   who breaks into the server can't read the old ones either. Keep the private key off the server.
# - Nothing is ever uploaded unencrypted: without a valid AGE_RECIPIENT it stops.
# - The snapshot must pass scripts/restore-check.js before it leaves the server.
# - On success it writes data/backups/offsite-last-ok, and after a FULL backup (photos included) also
#   offsite-full-last-ok: the admin panel warns if either gets old, so hourly database-only copies
#   can't hide a nightly full backup that keeps failing.
# - Any problem: non-zero exit and a message on stderr (cron mails it, if mail is set up there).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="${BACKUP_CONF:-$APP_DIR/scripts/backup.env}"
# shellcheck disable=SC1090
if [ -f "$CONF" ]; then . "$CONF"; fi
AGE_BIN="${AGE_BIN:-age}"
RCLONE_BIN="${RCLONE_BIN:-rclone}"
NODE_BIN="${NODE_BIN:-node}"
# The shop's data folder, decided exactly as the shop decides it: npm start runs
# "node --env-file-if-exists=.env" in the app folder, so DATA_DIR comes from the environment, else
# from the app's .env, else it is data/; a relative one is taken from the app folder. Cron passes
# none of the shop's environment, so the same Node command reads it here: .env is parsed by Node's
# own .env reader, never run as shell code. (Set DATA_DIR in .env only, not in backup.env.)
if [ -n "${DATA_DIR:-}" ]; then export DATA_DIR; fi
DATA_DIR="$(cd "$APP_DIR" && "$NODE_BIN" --env-file-if-exists=.env -e \
  'process.stdout.write(require("path").resolve(process.env.DATA_DIR || "data"))')" \
  || { echo "OFF-SITE BACKUP FAILED: could not read the data folder setting ($APP_DIR/.env)" >&2; exit 1; }
[ -d "$DATA_DIR" ] || { echo "OFF-SITE BACKUP FAILED: data folder not found: $DATA_DIR" >&2; exit 1; }
DATA_DIR="$(cd "$DATA_DIR" && pwd)"   # (absolute: tar -C below changes directory twice)
BACKUPS="$DATA_DIR/backups"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
MODE=full
case "${1:-}" in
  '') ;;
  --db-only) MODE=db ;;
  *) echo "Usage: $0 [--db-only]" >&2; exit 2 ;;
esac

fail() { echo "OFF-SITE BACKUP FAILED: $*" >&2; exit 1; }

[ -n "${AGE_RECIPIENT:-}" ] || fail "AGE_RECIPIENT (your age public key, age1...) is not set in $CONF — nothing is uploaded unencrypted"
[[ "$AGE_RECIPIENT" =~ ^age1[0-9a-z]{20,}$ ]] || fail "AGE_RECIPIENT must be an age public key (age1...), not a private key or a file"
[ -n "${RCLONE_REMOTE:-}" ] || fail "RCLONE_REMOTE (e.g. gdrive:vornetic-backups) is not set in $CONF"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] && [ "$KEEP_DAYS" -ge 7 ] || fail "BACKUP_KEEP_DAYS must be a whole number of days, at least 7"
command -v "$AGE_BIN" >/dev/null || fail "age is not installed ($AGE_BIN)"
command -v "$RCLONE_BIN" >/dev/null || fail "rclone is not installed ($RCLONE_BIN)"

# The newest snapshot (store-YYYY-MM-DDTHH.db sorts after store-YYYY-MM-DD.db of the same day)
NEWEST="$(find "$BACKUPS" -maxdepth 1 -type f -name 'store-*.db' 2>/dev/null | sort | tail -n 1)"
[ -n "$NEWEST" ] || fail "no snapshot in $BACKUPS (is the shop running?)"
[ -n "$(find "$NEWEST" -mmin -180)" ] || fail "the newest snapshot is more than 3 hours old: $NEWEST (is the shop running?)"
"$NODE_BIN" "$APP_DIR/scripts/restore-check.js" "$NEWEST" >/dev/null || fail "the newest snapshot failed the restore check: $NEWEST"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="vornetic-$MODE-$STAMP.tar.gz.age"
WORK="$(mktemp -d)"
[ -n "$WORK" ] && [ -d "$WORK" ] || fail "could not make a temporary folder"
trap 'rm -rf -- "$WORK"' EXIT

# Pack (snapshot + photos) and encrypt in one stream: nothing unencrypted is written to disk
if [ "$MODE" = full ] && [ -d "$DATA_DIR/uploads" ]; then
  tar -czf - -C "$BACKUPS" "$(basename "$NEWEST")" -C "$DATA_DIR" uploads | "$AGE_BIN" -r "$AGE_RECIPIENT" -o "$WORK/$NAME" \
    || fail "packing or encrypting failed"
else
  tar -czf - -C "$BACKUPS" "$(basename "$NEWEST")" | "$AGE_BIN" -r "$AGE_RECIPIENT" -o "$WORK/$NAME" \
    || fail "packing or encrypting failed"
fi
[ -s "$WORK/$NAME" ] || fail "the encrypted file is empty"

"$RCLONE_BIN" copy "$WORK/$NAME" "$RCLONE_REMOTE" || fail "upload to $RCLONE_REMOTE failed"
# Old copies there: only this script's files, older than BACKUP_KEEP_DAYS
"$RCLONE_BIN" delete --min-age "${KEEP_DAYS}d" --include 'vornetic-*.tar.gz.age' "$RCLONE_REMOTE" \
  || echo "warning: could not delete old copies from $RCLONE_REMOTE (the new one was uploaded)" >&2

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mark() { echo "$NOW" > "$BACKUPS/$1.tmp" && mv -f "$BACKUPS/$1.tmp" "$BACKUPS/$1"; }
mark offsite-last-ok
if [ "$MODE" = full ]; then mark offsite-full-last-ok; fi
echo "Off-site backup OK: $NAME ($(basename "$NEWEST")) → $RCLONE_REMOTE"
