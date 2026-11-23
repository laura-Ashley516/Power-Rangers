"""Photo of a paper schedule -> text -> planner activities (Python version, for the team and the report).

The planner does the same thing on the iPad (app/js/photo.js + app/js/photo-parse.js) so the client never
needs a computer. This script is the same algorithm in Python: to test photos quickly, measure accuracy on
a folder of photos, and explain the method in the deliverables. Its text output can be pasted into the
planner ("Add from a photo" -> "The text that was read").

Steps (same as the app):
  1. Prepare the image: make it at most 2000 px, grey, then black and white with Otsu's threshold
     (the grey level that best separates ink from paper).
  2. Read the text with Tesseract OCR (English + French).
  3. Understand it line by line: a line that is only a day ("Monday", "LUNDI") starts that day; a line that is
     only a time of day ("Morning", "Matin") starts that time of day; any other line is an activity, with its
     own day, clock time ("10:30", "10h30", "2 pm") and time of day if it has them.

Usage:
  python3 tools/photo_to_schedule.py photo.jpg            # OCR a photo, print the activities found
  python3 tools/photo_to_schedule.py --text notes.txt     # skip OCR: understand a text file
  python3 tools/photo_to_schedule.py photo.jpg --json     # machine-readable output
Needs (OCR only): pip install pillow pytesseract, and Tesseract with the "eng" and "fra" languages
(macOS: brew install tesseract tesseract-lang).
"""
import argparse
import json
import re
import sys
import unicodedata

DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
EN = [d.lower() for d in DAYS]
FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
SHORT_EN = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
SHORT_FR = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim']
PERIOD_WORDS = {
    'Morning': {'morning', 'matin', 'matinee', 'am'},
    'Afternoon': {'afternoon', 'apresmidi', 'pm', 'midi', 'noon'},
    'Evening': {'evening', 'soir', 'soiree', 'night', 'nuit', 'tonight'},
}
FILLER = {'at', 'a', 'on', 'le', 'la', 'les', 'from', 'to', 'de', 'du', 'au', 'vers', 'h', 'and', 'et', 'the', 'in', 'en', 'pour', 'for'}


# ---------- 1. image ----------

def otsu(hist, total):
    """Otsu's threshold: maximise the variance between the dark and the light pixels."""
    total_sum = sum(i * h for i, h in enumerate(hist))
    sum_b = w_b = 0
    best, level = 0.0, 127
    for i, h in enumerate(hist):
        w_b += h
        if not w_b:
            continue
        w_f = total - w_b
        if not w_f:
            break
        sum_b += i * h
        m_b, m_f = sum_b / w_b, (total_sum - sum_b) / w_f
        between = w_b * w_f * (m_b - m_f) ** 2
        if between > best:
            best, level = between, i
    return level


def prepare(path):
    from PIL import Image  # only needed for photos
    img = Image.open(path)
    scale = min(1.0, 2000 / max(img.size))
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)))
    grey = img.convert('L')
    level = otsu(grey.histogram(), grey.width * grey.height)
    return grey.point(lambda v: 255 if v > level else 0)


def read_text(path):
    import pytesseract
    return pytesseract.image_to_string(prepare(path), lang='eng+fra')


# ---------- 2. text ----------

def normalize(text):
    s = unicodedata.normalize('NFD', text.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')       # é -> e
    s = re.sub(r'\b(\d{1,2})\s*h\s*(\d{2})\b', r'\1:\2', s)              # 10h30 -> 10:30
    s = re.sub(r'\b(\d{1,2})\s*h\b', r'\1:00', s)                         # 14h -> 14:00
    s = re.sub(r'\bapres[\s-]?midi\b', 'apresmidi', s)
    s = re.sub(r'(\d)\s*([ap])\.?\s*m\b\.?', r'\1 \2m', s)               # 2pm -> 2 pm
    s = re.sub(r'([^\d\s]):', r'\1 ', s)                                  # "Afternoon:" -> "Afternoon"
    s = re.sub(r'[^a-z0-9:\s]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def day_of(word, alone):
    for names in (EN, FR) + ((SHORT_EN, SHORT_FR) if alone else ()):
        if word in names:
            return DAYS[names.index(word)]
        if word.endswith('s') and word[:-1] in names:
            return DAYS[names.index(word[:-1])]
    return None


def period_of_word(word):
    return next((p for p, words in PERIOD_WORDS.items() if word in words), None)


def period_of_time(hhmm):
    h, m = map(int, hhmm.split(':'))
    t = h + m / 60
    return 'Morning' if t < 13 else 'Afternoon' if t < 18 else 'Evening'


def clock_of(tokens, i):
    m = re.fullmatch(r'(\d{1,2})(?::(\d{2}))?', tokens[i])
    if not m:
        return None
    h, minutes = int(m.group(1)), m.group(2)
    nxt = tokens[i + 1] if i + 1 < len(tokens) else ''
    if not minutes and nxt not in ('am', 'pm'):
        return None                                  # a lone number is not a time
    if nxt == 'pm' and h < 12:
        h += 12
    if nxt == 'am' and h == 12:
        h = 0
    if h > 23 or int(minutes or 0) > 59:
        return None
    return f'{h:02d}:{minutes or "00"}'


def understand(text):
    """Returns [{line, day, period, time, name}] (day None when no day was found)."""
    out, day, period = [], None, None
    for raw in text.splitlines():
        line = re.sub(r'[|_~•·►▪●○■□\t]+', ' ', raw).strip()
        if not re.search(r'[A-Za-zÀ-ÿ]{2}', line):
            continue
        tokens = normalize(line).split()
        words = [w for w in tokens if w not in FILLER]
        alone = len(words) <= 2
        line_day = next((d for d in (day_of(w, alone) for w in words) if d), None)
        line_period = next((p for p in (period_of_word(w) for w in words) if p), None)
        rest, time, i = [], None, 0
        while i < len(tokens):
            w, c = tokens[i], clock_of(tokens, i)
            if c:
                time = time or c
                i += 2 if i + 1 < len(tokens) and tokens[i + 1] in ('am', 'pm') else 1
                continue
            if not (day_of(w, alone) or period_of_word(w) or w in FILLER or w.isdigit()):
                rest.append(w)
            i += 1
        if not rest:                                     # a header line
            if line_day:
                day, period = line_day, line_period
            elif line_period:
                period = line_period
            continue
        d = line_day or day
        p = (period_of_time(time) if time else None) or line_period or period or 'Morning'
        out.append({'line': line, 'day': d, 'period': p, 'time': time, 'name': ' '.join(rest).capitalize()})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('photo', nargs='?', help='photo of a schedule (jpg, png, heic converted to jpg)')
    ap.add_argument('--text', help='a text file to understand instead of a photo')
    ap.add_argument('--json', action='store_true', help='print JSON')
    args = ap.parse_args()
    if args.text:
        text = open(args.text, encoding='utf-8').read()
    elif args.photo:
        try:
            text = read_text(args.photo)
        except ImportError:
            sys.exit('OCR needs: pip install pillow pytesseract (and Tesseract itself, with eng + fra).')
    else:
        ap.error('give a photo, or --text file')
    found = understand(text)
    if args.json:
        print(json.dumps({'text': text, 'activities': found}, ensure_ascii=False, indent=1))
        return
    print('--- text read (paste it into the planner: Add from a photo) ---')
    print(text.strip())
    print('--- activities found ---')
    for a in found:
        when = f"{a['day'] or '(no day)'} {a['period'].lower()}" + (f" {a['time']}" if a['time'] else '')
        print(f"{when:28} {a['name']}")


if __name__ == '__main__':
    main()
