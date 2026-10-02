#!/usr/bin/env bash
set -euo pipefail

BROWSER="cobalt/modules/app/src/main/kotlin/app/auriel/cobalt/browser/BrowserScreen.kt"
HOME="cobalt/modules/app/src/main/kotlin/app/auriel/cobalt/browser/HomeScreen.kt"

python3 - "$BROWSER" <<'PY'
from pathlib import Path
p = Path(__import__("sys").argv[1])
s = p.read_text()

old = '''            .fillMaxWidth()
            .background(colors.surfaceContainerLow)
            .padding(start = 10.dp, end = 2.dp, top = 8.dp, bottom = 8.dp),'''
new = '''            .fillMaxWidth()
            .background(colors.surface)
            .padding(start = 10.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),'''
assert old in s
s = s.replace(old, new, 1)

old = '''                .weight(1f)
                .height(44.dp)
                .background(colors.surfaceVariant, MaterialTheme.shapes.medium)
                .border(1.dp, colors.outlineVariant, MaterialTheme.shapes.medium)
                .padding(start = 4.dp),'''
new = '''                .weight(1f)
                .height(48.dp)
                .background(colors.surfaceContainerHigh, MaterialTheme.shapes.large)
                .border(1.dp, colors.outlineVariant, MaterialTheme.shapes.large)
                .padding(start = 5.dp),'''
assert old in s
s = s.replace(old, new, 1)

p.write_text(s)
PY

python3 - "$HOME" <<'PY'
from pathlib import Path
p = Path(__import__("sys").argv[1])
s = p.read_text()

old = '''        style = MaterialTheme.typography.displaySmall.copy(
            fontSize = 40.sp,
            fontWeight = FontWeight.Light,
            letterSpacing = 6.sp,
        ),
        color = MaterialTheme.colorScheme.primary,'''
new = '''        style = MaterialTheme.typography.displaySmall.copy(
            fontSize = 42.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.sp,
        ),
        color = MaterialTheme.colorScheme.onSurface,'''

assert old in s
s = s.replace(old, new, 1)
p.write_text(s)
PY

echo "Applied Sandfox Build 1 Mises-style UI skin"
git -C cobalt diff --check
git -C cobalt diff -- modules/app/src/main/kotlin/app/auriel/cobalt/browser/BrowserScreen.kt modules/app/src/main/kotlin/app/auriel/cobalt/browser/HomeScreen.kt
