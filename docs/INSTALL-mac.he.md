# התקנה על Mac — צעד אחר צעד

כל הפקודות מריצים ב-**Terminal**: ‏Cmd+רווח ← כותבים `Terminal` ← Enter.
מדביקים שורה אחת בכל פעם (Cmd+V) ולוחצים Enter.

## 1. Claude Code

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

סוגרים את חלון הטרמינל ופותחים חדש (Cmd+N). בודקים:

```bash
claude --version
```

אם מופיע `command not found`:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

## 2. Node.js (אם חסר)

```bash
node --version
```

צריך 18 ומעלה. אם חסר: מורידים את גרסת **LTS** מ-https://nodejs.org (קובץ ‎.pkg), מתקינים בלחיצה כפולה, ופותחים טרמינל חדש.

## 3. הסוכן

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/veredlipimi/web-qa-agent ~/.claude/skills/web-qa-agent
node ~/.claude/skills/web-qa-agent/scripts/setup.mjs
```

בפעם הראשונה ש-`git` רץ, ה-Mac עשוי להציע להתקין **Command Line Tools**. מאשרים Install, ואחרי שההתקנה מסתיימת מריצים שוב את השורה.

## 4. בדיקה שהכול עובד

```bash
node ~/.claude/skills/web-qa-agent/evals/regression-check.mjs
```

בסוף צריך להופיע `43/43 passed`.

## 5. להריץ QA

```bash
claude
```

ובתוך Claude:

```
QA https://האתר-שלך
```

### לבדוק אתר שנמצא אצלך במחשב (קובצי HTML)

1. ב-Finder, פותחים את תיקיית האתר. אם הורדת zip, לחיצה כפולה פותחת אותו.
2. בטרמינל כותבים `cd ` (עם רווח), גוררים את התיקייה מה-Finder לחלון הטרמינל, ולוחצים Enter.
3. מפעילים שרת מקומי ומשאירים את החלון הזה פתוח:

   ```bash
   python3 -m http.server 8090
   ```

4. פותחים חלון טרמינל חדש (Cmd+N), מריצים `claude`, ובתוכו כותבים:

   ```
   QA http://localhost:8090
   ```

5. כשמסיימים, חוזרים לחלון של השרת ולוחצים Ctrl+C.

## עדכון לגרסה חדשה

```bash
cd ~/.claude/skills/web-qa-agent && git pull && node scripts/setup.mjs
```

## איפה הדוח?

בסוף ההרצה הסוכן כותב את הנתיב. כדי לפתוח את הדוח בדפדפן:

```bash
open qa-runs/*/report.html
```
