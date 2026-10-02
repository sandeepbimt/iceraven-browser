#!/usr/bin/env bash
set -eu

echo "=== Sandfox launch diagnostic ==="
echo "Package: $PACKAGE_NAME"
echo "Device: $ADB_DEVICE_SERIAL"

adb -s "$ADB_DEVICE_SERIAL" logcat -c
adb -s "$ADB_DEVICE_SERIAL" shell monkey -p "$PACKAGE_NAME" 1
sleep 15

echo "=== PROCESS AFTER 15s ==="
adb -s "$ADB_DEVICE_SERIAL" shell pidof "$PACKAGE_NAME" || true

adb -s "$ADB_DEVICE_SERIAL" logcat -d > launch-log.txt

echo "=== FATAL / RUNTIME ERRORS ==="
grep -n -A50 -B10 "FATAL EXCEPTION\|AndroidRuntime\|Fatal signal\|Process: $PACKAGE_NAME" launch-log.txt || true

echo "=== LAST PACKAGE LOGS ==="
grep -n "$PACKAGE_NAME" launch-log.txt | tail -100 || true

echo "=== PROCESS AFTER LOG ==="
adb -s "$ADB_DEVICE_SERIAL" shell pidof "$PACKAGE_NAME" || true
