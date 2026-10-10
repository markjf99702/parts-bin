---
name: parts-bin-cataloger
description: Catalog Mark's electronics parts into Parts Bin (parts-bin.junkdrawer.works) from photos of bagged parts, modules or boards, receipts and order emails, product links or a typed list, and fill in details (category, interface, I2C address, voltages, part number, reference photo) for parts already in it, handing either over as a one-tap Inbox link. Use whenever he sends photos of parts to log or bag, mentions an electronics order or receipt, pastes a product link to add, shares a message starting "Parts Bin:", asks to fill in, enrich or categorize his parts, mentions Parts Bin, or asks what parts he has.
---

# Parts Bin cataloger

Parts Bin (https://parts-bin.junkdrawer.works/) is Mark's parts inventory: bins, numbered bags with NFC tags, and a BOM check. Its data lives in his browser and in one file in his Google Drive. Your job is to turn what he sends into an accurate batch and hand it over as a **link**. The link opens Parts Bin's **Inbox**, where each part is a card: he taps it, the part sheet opens filled in, he taps **Save & tag** and holds the bag's sticker to the phone. Suggested details for parts he already has arrive the same way, as cards to apply or skip. Nothing reaches the inventory without his tap.

Protect three things:
- **Accuracy over completeness.** A wrong part number on a bag is worse than a blank. Never invent a marking, a count, an address, a voltage or a web address. Blank beats wrong.
- **One flow.** He is usually at the bench with a bag in one hand and the phone in the other. Lead the reply with the link and keep the rest short.
- **His inventory, his call.** Flag doubts in `check`; don't settle them silently. Only ever read his inventory file.

## 1. Read his inventory first

Knowing what he has lets you point a photographed part at its existing record (so he bags that one and no double is made), reuse his categories and bin codes, and name things the way he does.

- **Google Drive connector:** search for the title `Parts Bin.json`, then download its content with the tool that returns base64 (`download_file_content`). Don't use the "read as text" tool: it escapes brackets and the result isn't valid JSON. Save the tool's result as a file; the script reads it as it comes, wrapper and all.
- **Or** a backup file he attached (Settings › Save a backup file), **or** the list in a message starting "Parts Bin:" (that is the app's own share: `{"partsbin":1,"ask":"details","parts":[…]}`; save the whole message as a file).
- **None of these:** carry on without. The Inbox still offers near matches by name.

```
python3 make_partsbin.py --inventory inventory.json --list
```

prints his categories, bin codes and every part as `id | name | category | bin | bag | qty | part number | has`. (Save the script from the appendix as `make_partsbin.py` if it isn't on disk.)

**Read the Drive file; never write, move or rename it.** Parts Bin rewrites the whole file when it syncs.

## 2. Read what he sent

**Photos of parts.** Count the bags or items in the frame; each one ends up in the batch or in your "couldn't read" note. For each, read in this order of trust: the seller's label on the bag, the silkscreen name on the board ("GY-BME280", "HW-611", "XL6019"), the marking on the main chip, then the layout. Count the pieces if they're all visible; if they're stacked or hidden, leave `qty` out and say so.

**Receipts, invoices, order emails.** One part per line item. `qty` is packs × pieces per pack ("5pcs" in the title means 5). Leave out shipping, tax and things that aren't parts, and say what you left out. Prices aren't stored. If Gmail is connected, search it yourself (the shop's name, "order", the date he gave); Amazon and AliExpress emails often hide the item names, so ask for a screenshot of the order page instead. Use `"source": "receipt"`: for a part he already has, the count is then added to his stock.

**Product links.** Fetch the page for the name, the pack size, the specs and the main product image. If the site refuses (Amazon often does), work from the title he pasted or ask for a screenshot. `"source": "link"`. If he didn't say how many he has, use the pack size and say that's what you assumed.

**A typed list.** `"source": "list"`.

Naming, so records match his: the part, then the brand in brackets when there is one. "BME280 (Adafruit)", "XL6019 5A step-up (ACEIRMC)", "HW611 (BMP280)", "KY040 rotary encoder". No-name clones get the tag `generic`.

**Is it one he already has?** If it's the same physical part as an inventory record, set `"match": "<that id>"`. He then bags the existing record: its blanks are filled, nothing it says is overwritten, a photo's count replaces the old count and a receipt's adds to it (`"add": true/false` overrides either). Same chip on a different maker's board is a different part unless he keeps them together. If the inventory has two records for one thing ("Bh1750" and "BH1750 / BY1750"), match the one that already has a bag number and mention the double in your reply; never merge records yourself.

## 3. The details, and only these

He asked for no data overload. These are all the fields; there are no pinouts, library lists or datasheet summaries.

| Field | What goes in it |
|---|---|
| `name` | As above. Required unless the part has an `id`. |
| `category` | One of his: Sensors, Power, Input, Audio, Displays, LEDs & AV, Motors, MCU boards, Boards & big items (run `--list` for the current set; tools go in Tools, spools in Filament, half-built things in Projects). A new one only when nothing fits. |
| `qty`, `unit` | Count seen or bought; `unit` only when it isn't pieces ("m", "g"). |
| `mpn` | The main chip or the maker's part number, from the marking or the page: "BME280", "TP4056", "Adafruit 2652". |
| `iface` | How you talk to it: I2C, SPI, UART, 1-Wire, I2S, Analog, Digital, PWM, USB, CAN, RS-485. A list. Leave out for things with no signal (regulators, connectors). |
| `addr` | I2C address, default first: `0x76, 0x77`, or a range `0x48–0x4B`. |
| `volts` | Supply range of the board as sold: "3.3–5 V". For power modules, the input: "4–40 V in". Just the value; the app adds the word "supply". |
| `logic` | Signal level: "3.3 V", "5 V", "3.3 V or 5 V" (shifted on board), "5 V tolerant". Just the value. |
| `link` | The maker's or shop's product page, https. |
| `img` | A reference photo, https. See section 5. |
| `tags` | Lowercase, few. Added to his, never replacing them. |
| `notes` | One short line of facts that fit nowhere above ("8-channel I2C mux", "active-low inputs, 10 A contacts"). On a part he already has it is added after his own notes, so write only what's new and never restate his. |
| `check` | What to verify before trusting the record. See section 4. |

Specs for well-known chips can come from what you know (a BME280's addresses, an SCD41's supply range). Anything you'd have to guess, look up on the maker's page or leave blank. A clone board's regulator and level shifting vary: if the photo doesn't show them, give the chip's own range and say so in `check`.

## 4. What looking can't settle: `check`, and Bench Identifier

Mark built **Bench Identifier**, a handheld tester (LilyGO T-Display-S3). Use it as the second opinion: when a photo can't settle what a part is, say exactly which test settles it and what it should show. `check` appears on the Inbox card and stays on the part as a "Check before trusting it" note until he taps **Checked, it's right**. Parts Bin has a "To check" filter, so he can run them all through the tester in one sitting.

Set `check` when:
- it's a known lookalike: BME280 / BMP280 (HW-611 and "GY-BME280" boards are often BMP280), SHT30 / SHT40, VL53L0X / VL6180X, MPU-6050 / 6500 / 9250, NeoPixel RGB / RGBW, MAX98357 clones, TP4056 with or without the protection chips, buck or boost modules that share a board outline;
- the marking is hidden, sanded off or out of focus and you went by layout;
- a count is a guess;
- a wrong assumption would damage something: 5 V-only logic into a 3.3 V board, relay boards, an adjustable regulator whose output hasn't been set.

Write it as the test and its result, in under about 140 characters: "Bench Identifier Port A: ID 0x60 at 0xD0 is a BME280, 0x58 a BMP280." "Port B, NeoPixel RGBW test: a white step after blue means RGBW." "Meter: set the output before connecting a load."

What Bench Identifier (firmware v0.6, October 2026) can confirm:

| Where | It names or tests |
|---|---|
| **Port A**, I2C, named by chip ID | BMP280, BME280, BME680/688, BMP388/390, SHT30/31/35, SHT40/41/45, Si7021, HTU21D, SCD40/41, SGP30, MAX30102/30105, DRV2605L, MPU6050, APDS-9960, VL6180X, VL53L0X, ADS1115, AS3935, STEMMA soil sensor, MAX17048/17043, PN532 |
| Port A, by address only | BH1750 (0x23, 0x5C), SSD1306-class OLED (0x3C, 0x3D), 1602 LCD backpack (0x27, 0x3F). Anything else shows as unknown with its address. |
| **SPI ID** | SPI flash (W25Qxx), RC522, PN532, nRF24L01+, SX127x LoRa (RFM95, Ra-02), W5500, ENC28J60, MCP2515, BMP/BME280, BME680, BMP388/390, MPU-6000/6500/9250 and ICM IMUs |
| **1-Wire** | DS18B20 and its family, MAX31850, DS2401 / iButton |
| **Port B**, you pick the test | Pin watch (PIR, TP223 touch, LM393 modules, knock sensor, IR receiver, switches), Analog (soil sensor, potentiometer, MAX4466), Encoder (KY-040), DHT11/22, HX711 with a load cell, Serial sniff (LD2410C, Plantower PM2.5), Ultrasonic (HC-SR04, AJ-SR04M), NeoPixel RGB / RGBW, Servo sweep, I2S mic (INMP441, SPH0645), I2S amp tone (MAX98357) |
| Not covered | Regulators, chargers, level shifters: those are a meter job. |

If he tells you what the tester showed ("Bench ID says BMP280 at 0x76"), that is the answer: use it, and don't set `check` for it. If he says the tester now does something this table doesn't list, believe him.

## 5. Reference photos

He wants a ballpark picture of a typical module to compare against the thing in his hand. `img` is the direct https address of an image file, which the page loads from that site.

- **Only an address you actually saw** in a page you fetched or a search result: the product page's main image. Never build one from a pattern or from memory; a dead address just shows an icon, but a wrong board is worse than none.
- Prefer the maker's or a hobby shop's own image (Adafruit, SparkFun, Seeed, Pololu, DFRobot, Waveshare, Raspberry Pi, LilyGO) or Wikimedia Commons. Avoid Amazon, AliExpress and eBay image addresses; they expire or refuse to load elsewhere, and the script warns about them.
- For a generic module, a photo of the same board layout from any shop is right. A different layout with the same chip is not: skip it.
- Skip loose passives, wire, hardware and anything where a photo wouldn't help him tell it apart.
- If one doesn't turn up quickly, leave it out. On a big batch, do the modules and boards and leave the rest.

## 6. Build the batch

Write the batch as JSON and run the script:

```
python3 make_partsbin.py batch.json --inventory inventory.json --out /mnt/user-data/outputs
```

```json
{"name": "Bench photo, 9 Oct", "source": "photo", "bin": "ENV",
 "parts": [
  {"name": "BME280 (Adafruit)", "match": "p-bme280-adafruit", "qty": 5,
   "mpn": "BME280", "iface": ["I2C", "SPI"], "addr": "0x77, 0x76", "volts": "3–5 V", "logic": "3.3 V or 5 V"},
  {"name": "HW-611 pressure sensor", "qty": 6, "category": "Sensors", "iface": ["I2C", "SPI"], "addr": "0x76", "volts": "3.3 V", "logic": "3.3 V", "tags": ["generic"],
   "check": "Bench Identifier Port A: ID 0x58 at 0xD0 is a BMP280, 0x60 a BME280."},
  {"name": "TCA9548A I2C multiplexer (Adafruit)", "qty": 2, "category": "Sensors", "mpn": "TCA9548A", "iface": ["I2C"], "addr": "0x70–0x77",
   "volts": "1.65–5.5 V", "logic": "3.3 V or 5 V", "notes": "8-channel I2C mux", "link": "https://www.adafruit.com/product/2717"}
 ]}
```

- `name` is shown at the top of the batch. `source` is `photo`, `receipt`, `link`, `list` or `details`.
- `bin` is the bin or box **code** new parts go into, when he said ("these live in ENV", "I'm packing BOX 03"). Leave it out otherwise and Parts Bin uses wherever he's currently packing.
- Any folder works for `--out`; `/mnt/user-data/outputs` is where claude.ai offers files for download.

The script cleans every field, checks each `id` and `match` against the inventory, drops suggestions that change nothing, merges a part listed twice (and asks whether that's two bags or one photographed twice), points out parts that may already be in the inventory, and prints a summary, any warnings, a `.partsbin.json` file and a **link**. Read the warnings before sending: most mean one more look at the photo or the inventory. More than 40 parts are split into several links so each stays short enough to tap.

Without code tools, write the JSON by hand as `{"partsbin": 1, "batch": {"name": …, "source": …, "items": [ … ]}}` and have him paste it into **Pack › Inbox › paste box**. The link needs the script.

## 7. Hand it over

1. **The link, first,** as a link. Copy it character for character from the script's output: it's encoded data, and one changed character breaks it.
2. One line: how many parts, from what.
3. The list, short: *name ×count*, with "→ existing" for matches. Mark flagged ones and say what to check and how.
4. What you couldn't read and where it is in the photo, and anything you left out on purpose.
5. The file as the fallback (**Pack › Inbox › Load a file**).

Never say the parts are in his inventory. They're in the Inbox until he saves each one. Opening the same link twice is safe: Parts Bin says it's been through that batch already. If he sends more photos of the same lot, make a new batch with only the new parts.

## Filling in details for parts he already has

When he asks to fill in, enrich or categorize his parts, or shares a "Parts Bin:" list (from one part's page or from the Inbox):

1. Read the inventory (section 1), or use the shared list as the inventory.
2. For each part, work out only what's missing or clearly wrong, from the fields in section 3. Give each item the part's `id` and just the fields you're proposing: `{"id": "p-scd41", "mpn": "SCD41", "iface": ["I2C"], "addr": "0x62", "volts": "2.4–5.5 V", "logic": "3.3 V"}`. No `qty`. No `name` unless he asked for renames.
3. Use `"source": "details"` and run the script with `--inventory`, so anything the part already says is dropped. A part with nothing to add simply isn't in the batch.
4. In Parts Bin each part is a card listing its changes, with a tick per field, **Apply**, and **Apply all** for the batch.

Categories: fill in the blank ones, and move a part only when its category is plainly wrong. If you think his whole scheme should change (say, splitting "Boards & big items"), describe it in the reply and ask before sending a batch that does it. Doubles and near-doubles you notice go in the reply too, with both ids; he merges them in the app.

For a full pass over a large inventory, work bin by bin, and say in the reply which parts you had nothing for.

## Questions about his parts

"Do I have a level shifter?", "what's in bag 14?", "which I2C addresses would clash?": read the inventory and answer from it. Live counts and the BOM check are in Parts Bin itself; what you read is the copy from his last sync.

## Appendix: make_partsbin.py

```python
#!/usr/bin/env python3
"""Turn a list of parts into a Parts Bin batch: a link that opens in the Inbox, and a file.

    python3 make_partsbin.py batch.json [--inventory FILE] [--out DIR] [--base URL] [--split N]
    python3 make_partsbin.py --inventory FILE --list        # print the inventory, one part per line

batch.json:  {"name": "...", "source": "photo|receipt|link|list|details", "bin": "ENV", "parts": [ {...} ]}
A part with "id" suggests changes to that part; any other part is one to bag (new, or "match": an existing id).

--inventory takes the Parts Bin file from Drive (as downloaded, base64 wrapper and all), a backup file, or the
"Parts Bin:" list shared from the app. With it, ids and matches are checked, suggestions that change nothing are
dropped, and likely doubles are pointed out. It exits 1 (printing why) if the input can't be used.
"""
import argparse, base64, datetime, hashlib, json, re, sys, zlib
from pathlib import Path
from urllib.parse import urlparse

BASE = 'https://parts-bin.junkdrawer.works/'
SOURCES = ('photo', 'receipt', 'link', 'list', 'details')
IFACE = {
    'i2c': 'I2C', 'iic': 'I2C', 'twi': 'I2C', 'qwiic': 'I2C', 'stemma qt': 'I2C', 'spi': 'SPI', 'uart': 'UART', 'serial': 'UART', 'ttl': 'UART',
    '1-wire': '1-Wire', 'onewire': '1-Wire', '1wire': '1-Wire', 'i2s': 'I2S', 'analog': 'Analog', 'adc': 'Analog', 'digital': 'Digital',
    'gpio': 'Digital', 'pwm': 'PWM', 'usb': 'USB', 'can': 'CAN', 'rs-485': 'RS-485', 'rs485': 'RS-485', 'rs-232': 'RS-232', 'rs232': 'RS-232', 'pdm': 'PDM',
}
TEXT = {'name': 120, 'category': 40, 'mpn': 60, 'addr': 40, 'volts': 28, 'logic': 28, 'notes': 400, 'check': 300, 'unit': 12}
ID = re.compile(r'^[\w.:@+~-]{1,80}$')
HOTLINK_TROUBLE = ('amazon.', 'media-amazon.', 'ssl-images-amazon.', 'alicdn.', 'aliexpress.', 'ebayimg.')


def s(v, n):
    if isinstance(v, (bool, dict, list)) or v is None:
        return ''
    return re.sub(r'\s+', ' ', str(v)).strip()[:n]


def many(v):
    if isinstance(v, str):
        v = re.split(r'[,;/]', v)
    return [x for x in (v if isinstance(v, list) else []) if isinstance(x, (str, int, float)) and not isinstance(x, bool)]


def https(v, what, label, warn):
    v = s(v, 800)
    if not v:
        return ''
    u = urlparse(v)
    if u.scheme != 'https' or not re.search(r'\.[a-z]{2,}$', u.hostname or '', re.I):
        warn.append(f'“{label}”: {what} {v[:60]} isn’t an https address; left off')
        return ''
    return v


def toks(t, brackets):
    t = re.sub(r'([a-z])-(?=\d)', r'\1', str(t or '').lower())  # "HW-611" and "HW611" are one word
    t = re.sub(r'\([^)]*\)', (lambda m: ' ' + m[0] + ' ') if brackets else ' ', t)  # brackets hold the chip, or just the brand
    return [w for w in re.sub(r'[^a-z0-9.+]+', ' ', t).split() if len(w) > 1]


def near(a, b):
    """Same idea as the Inbox's own near-match: a shared part number, or nearly the same words."""
    best = 0
    for brackets in (False, True):
        ta, tb = toks(a, brackets), toks(b, brackets)
        la, lb = len(''.join(ta)), len(''.join(tb))
        if not la or not lb:
            continue
        shared = [w for w in ta if w in tb]
        score = len(''.join(shared)) / min(la, lb)
        if any(len(w) >= 6 and re.search(r'\d', w) and re.search(r'[a-z]', w) for w in shared):
            score = max(score, 0.6)
        elif not ((score >= 0.6 and any(re.search(r'\d', w) for w in shared)) or score >= 0.85):
            score = 0
        best = max(best, score)
    return best


def read_inventory(path):
    """→ {id: part} of live parts, and the bins as {id: bin}. Accepts the file in any form it reaches Claude."""
    text = Path(path).read_text(encoding='utf-8', errors='replace')
    text = text[text.index('{'):] if '{' in text else text
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as e:
        raise SystemExit(f'error: can’t read {path}: {e}. If it came from Drive’s read_file_content, use download_file_content instead.')
    if isinstance(doc.get('content'), str) and 'items' not in doc:  # the Drive connector's download: base64 inside JSON
        raw = doc['content']
        doc = json.loads(base64.b64decode(raw + '=' * (-len(raw) % 4)).decode('utf-8'))
    if isinstance(doc.get('parts'), list):  # the list shared from the app
        return {p['id']: p for p in doc['parts'] if isinstance(p, dict) and ID.match(str(p.get('id', '')))}, {}
    items = doc.get('items') if isinstance(doc.get('items'), dict) else None
    if not items or not isinstance(items.get('parts'), dict):
        raise SystemExit(f'error: {path} isn’t a Parts Bin file (no items.parts)')
    live = lambda d: {k: v for k, v in (d or {}).items() if isinstance(v, dict) and not (v.get('del') and v['del'] >= v.get('t', 0))}
    return live(items['parts']), live(items.get('bins'))


def clean(x, i, warn, inv):
    if not isinstance(x, dict):
        warn.append(f'#{i + 1}: not a part object, left out')
        return None
    out = {k: s(x.get(k), n) for k, n in TEXT.items()}
    if not out['check']:
        out['check'] = s(x.get('unsure'), 300)
    pid, match = s(x.get('id'), 80), s(x.get('match'), 80)
    label = out['name'] or pid or f'#{i + 1}'
    if pid and not ID.match(pid):
        warn.append(f'“{label}”: id {pid} isn’t a Parts Bin id; left off'); pid = ''
    if pid and inv is not None and pid not in inv:
        warn.append(f'“{label}”: id {pid} isn’t in the inventory; ' + ('treated as a new part' if out['name'] else 'left out')); pid = ''
    if match and (not ID.match(match) or (inv is not None and match not in inv)):
        warn.append(f'“{label}”: match {match} isn’t in the inventory; left off'); match = ''
    if not pid and not out['name']:
        warn.append(f'#{i + 1}: no name and no id, left out')
        return None
    ifs = []
    for v in many(x.get('iface')):
        v = s(v, 14)
        k = IFACE.get(v.lower())
        if v and not k:
            warn.append(f'“{label}”: interface “{v}” isn’t one of the usual names; kept as written')
        if v and (k or v) not in ifs:
            ifs.append(k or v)
    out['iface'] = ifs[:6]
    if out['addr'] and not re.search(r'0x[0-9A-Fa-f]{2}', out['addr']):
        warn.append(f'“{label}”: address “{out["addr"]}” has no 0x.. value in it; check it')
    out['link'] = https(x.get('link'), 'link', label, warn)
    out['img'] = https(x.get('img'), 'photo', label, warn)
    if out['img'] and any(h in (urlparse(out['img']).hostname or '') for h in HOTLINK_TROUBLE):
        warn.append(f'“{label}”: photos on {urlparse(out["img"]).hostname} often stop loading; a maker’s or shop’s own image is safer')
    out['tags'] = list(dict.fromkeys(s(t, 30).lower() for t in many(x.get('tags')) if s(t, 30)))[:8]
    q = x.get('qty')
    if isinstance(q, str) and re.fullmatch(r'\s*\d+(\.\d+)?\s*', q):
        q = float(q)
    if isinstance(q, (int, float)) and not isinstance(q, bool) and 0 <= q < 1e6:
        out['qty'] = int(q) if float(q).is_integer() else q
    elif q is not None:
        warn.append(f'“{label}”: count “{q}” isn’t a number; left off')
    if isinstance(x.get('add'), bool):
        out['add'] = x['add']
    if pid:
        out['id'] = pid
    if match and not pid:
        out['match'] = match
    return {k: v for k, v in out.items() if v not in ('', [], None)}


def unchanged(part, item):
    """Drop what the part already says, the way the Inbox would."""
    out = {'id': item['id']}
    for k, v in item.items():
        if k in ('id', 'qty', 'unit', 'add'):
            continue
        old = part.get(k)
        if k == 'notes' and v.lower() in str(old or '').lower():
            continue
        if k == 'tags':
            v = [t for t in v if t not in (old or [])]
            if not v:
                continue
        elif (old or ([] if isinstance(v, list) else '')) == v:
            continue
        out[k] = v
    return out if len(out) > 1 else None


def build(doc, warn, inv):
    if isinstance(doc, list):
        doc = {'parts': doc}
    if isinstance(doc, dict) and isinstance(doc.get('batch'), dict):
        doc = doc['batch']
    rows = doc.get('parts', doc.get('items')) if isinstance(doc, dict) else None
    if not isinstance(rows, list):
        raise SystemExit('error: the input needs a "parts" list')
    items, by_name, by_id, same = [], {}, {}, 0
    for i, x in enumerate(rows):
        c = clean(x, i, warn, inv)
        if not c:
            continue
        if 'id' in c:
            if c['id'] in by_id:  # one card per part: the first suggestion wins, later ones fill in
                first = by_id[c['id']]
                for k, v in c.items():
                    first.setdefault(k, v)
                warn.append(f'{c["id"]} has two sets of suggestions; merged into one')
                continue
            if inv is not None:
                c = unchanged(inv[c['id']], c)
                if not c:
                    same += 1
                    continue
            by_id[c['id']] = c
            items.append(c)
            continue
        k = re.sub(r'[^a-z0-9.+]+', ' ', c['name'].lower()).strip()  # the whole name: "M3 x 8" and "M3 x 6" are different parts
        if k in by_name:
            first = by_name[k]
            if 'qty' in c:
                first['qty'] = first.get('qty', 0) + c['qty']
            warn.append(f'“{c["name"]}” is listed twice; merged' + (f' to ×{first["qty"]}' if 'qty' in first else '') + '. Two bags, or one seen in overlapping photos?')
            continue
        by_name[k] = c
        if inv is not None and 'match' not in c:
            hits = sorted(((near(c['name'], p.get('name')), pid) for pid, p in inv.items()), reverse=True)[:1]
            if hits and hits[0][0]:
                warn.append(f'“{c["name"]}” may be “{inv[hits[0][1]].get("name")}” ({hits[0][1]}), which is already in the inventory. Add "match" if it’s the same part.')
        items.append(c)
    if same:
        warn.append(f'{same} suggestion{"s" if same != 1 else ""} matched what the part already says; left out')
    if not items:
        raise SystemExit('error: nothing to send (every part needs a name or an id, and something that isn’t already there)')
    source = doc.get('source') if doc.get('source') in SOURCES else ('details' if all('id' in x for x in items) else 'list')
    return {'name': s(doc.get('name'), 120), 'source': source, 'bin': s(doc.get('bin'), 24), 'items': items}


def wrap(b, items, name, made):
    body = json.dumps(items, ensure_ascii=False, sort_keys=True)
    bid = 'p' + made.replace('-', '') + '-' + hashlib.sha1((name + body).encode()).hexdigest()[:10]
    batch = {'id': bid, 'name': name, 'made': made, 'source': b['source'], 'bin': b['bin'], 'items': items}
    return {'partsbin': 1, 'batch': {k: v for k, v in batch.items() if v != ''}}


def link(out, base):
    raw = json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode()
    z = zlib.compressobj(9, zlib.DEFLATED, -15)
    return base + '#p1z' + base64.urlsafe_b64encode(z.compress(raw) + z.flush()).decode('ascii').rstrip('=')


def slug(t):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', t.lower())).strip('-')[:48] or 'parts'


def show_inventory(parts, bins):
    cats = {}
    for p in parts.values():
        cats[p.get('category') or '(none)'] = cats.get(p.get('category') or '(none)', 0) + 1
    print(f'{len(parts)} parts, {len(bins)} bins')
    print('categories: ' + ', '.join(f'{c} ×{n}' for c, n in sorted(cats.items(), key=lambda kv: -kv[1])))
    if bins:
        print('bins: ' + ', '.join(f'{b.get("code")} ({b.get("name", "")})' + (' [box]' if b.get('kind') == 'box' else '') for b in sorted(bins.values(), key=lambda b: str(b.get('code')))))
    print('id | name | category | bin | bag | qty | part number | has')
    for pid, p in sorted(parts.items(), key=lambda kv: str(kv[1].get('name', '')).lower()):
        has = ' '.join(k for k in ('iface', 'addr', 'volts', 'logic', 'link', 'img', 'check') if p.get(k))
        code = (bins.get(p.get('binId')) or {}).get('code', p.get('bin', ''))
        print(' | '.join(str(v) for v in (pid, p.get('name', ''), p.get('category', ''), code, p.get('bag') or '', p.get('qty', ''), p.get('mpn', ''), has)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('batch', nargs='?')
    ap.add_argument('--inventory', help='the Parts Bin file (Drive download, backup, or the list shared from the app)')
    ap.add_argument('--list', action='store_true', help='print the inventory and stop')
    ap.add_argument('--out', default='.', help='folder for the .partsbin.json file')
    ap.add_argument('--base', default=BASE, help='where Parts Bin lives')
    ap.add_argument('--split', type=int, default=40, help='most parts in one link (default 40)')
    a = ap.parse_args()
    inv = bins = None
    if a.inventory:
        inv, bins = read_inventory(a.inventory)
    if a.list:
        if inv is None:
            raise SystemExit('error: --list needs --inventory')
        return show_inventory(inv, bins)
    if not a.batch:
        raise SystemExit('error: give the batch file')
    try:
        doc = json.loads(Path(a.batch).read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as e:
        raise SystemExit(f'error: can’t read {a.batch}: {e}')
    warn = []
    b = build(doc, warn, inv)
    if b['bin'] and bins and not any(str(x.get('code', '')).lower() == b['bin'].lower() for x in bins.values()):
        warn.append(f'bin “{b["bin"]}” isn’t one of his bin codes; new parts will go wherever he last packed')
    made = datetime.date.today().isoformat()
    n = max(1, a.split)
    chunks = [b['items'][i:i + n] for i in range(0, len(b['items']), n)]
    new = sum(1 for x in b['items'] if 'id' not in x)
    print(f'{b["name"] or "Parts"}: {new} to bag, {len(b["items"]) - new} with suggested details' + (f', in {len(chunks)} links' if len(chunks) > 1 else ''))
    for x in b['items']:
        name = x.get('name') or (inv or {}).get(x.get('id'), {}).get('name') or x.get('id')
        what = ('details: ' + ', '.join(k for k in x if k not in ('id', 'check'))) if 'id' in x else ('×' + str(x['qty']) if 'qty' in x else 'count not given') + (f' → {x["match"]}' if 'match' in x else ', new')
        print(f'  {"?" if x.get("check") else "-"} {name} ({what})')
        if x.get('check'):
            print(f'      check: {x["check"]}')
    for w in warn:
        print(f'warning: {w}')
    Path(a.out).mkdir(parents=True, exist_ok=True)
    base = a.base if a.base.endswith('/') else a.base + '/'
    for i, items in enumerate(chunks):
        name = b['name'] + (f' ({i + 1} of {len(chunks)})' if len(chunks) > 1 else '')
        out = wrap(b, items, name, made)
        f = Path(a.out) / (slug(b['name'] or 'parts') + (f'-{i + 1}of{len(chunks)}' if len(chunks) > 1 else '') + f'-{made}.partsbin.json')
        f.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        url = link(out, base)
        print(f'\nFile: {f}')
        print(f'Link ({len(items)} part{"s" if len(items) != 1 else ""}, {len(url):,} characters): {url}' if len(url) <= 30000 else f'That link would be {len(url):,} characters, too long to pass around safely. Hand over the file, or use a smaller --split.')


if __name__ == '__main__':
    main()
```
