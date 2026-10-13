# Parts Bin

**Use it: [parts-bin.junkdrawer.works](https://parts-bin.junkdrawer.works/)**

**A parts inventory for a maker's workroom, with the NFC tags written and read right in the page.** Bins, moving boxes and numbered bags, a search over everything, and a BOM check that says what you have, what you're short of and where it is. Log a bag and tag it in one go: save the part, hold the sticker to the top of the phone, next bag. Or skip the typing: send Claude a photo and open the link it replies with.

<p align="center">
  <img src="docs/phone-pack.png" width="205" alt="Pack: packing into the ENV bin, next bag #003, a field to type what's in the bag.">
  <img src="docs/phone-inbox.png" width="205" alt="Inbox: three parts Claude read off a bench photo. The first is matched to the SCD41 already in the inventory, with its interface, address and voltages filled in and a note to check it on a tester.">
  <img src="docs/phone-bom.png" width="205" alt="BOM check: a three-line parts list against the inventory, two parts on hand in the ENV bin and one missing.">
  <img src="docs/phone-bins.png" width="205" alt="Bins: the Environmental bin with its ENV label and a count of its parts.">
</p>

## How it works

- **Pack.** Pick the bin or box you're filling, type what's in the bag and pick the match (or a new part), check the count, save. The tag screen opens already listening: hold a blank sticker to the phone and it gets that bag's link. The next bag number is waiting.
- **Tap a tag to find a bag.** While Parts Bin is open it listens for tags, so holding any bag or bin sticker to the phone opens it right here. (The first time, tap the tag button by the search box to allow NFC; after that it starts by itself.) Tags written by the old Stockroom artifact open here too, with an offer to rewrite them so they open Parts Bin even when the page is closed.
- **BOM check.** Paste a parts list, or pick a saved one, and get have / short / missing with where each part lives, plus a shopping list.
- **Boxes for a move.** A box is a container like a bin; each part remembers which bin it came out of, and a box page prints its packing list.
- **Same on every device.** Turn on Google Drive in Settings and the inventory is saved to a "Parts Bin" folder in your Drive and merged part by part with your other devices. Without it, everything stays in this browser.
- **Inbox: parts from a photo, a receipt or a link.** Send Claude a photo of the bags, an order email or a product page; it replies with a link that opens the Inbox (under Pack) with each part filled in. Tap a card, check it, **Save & tag**. A part you already have is offered first, so it's bagged under its own record and no double is made. The Claude skill that does the reading is in [`skill/parts-bin-cataloger/`](skill/parts-bin-cataloger/SKILL.md).
- **Details, filled in for you.** The same inbox takes suggestions for parts you already have: category, interface, I2C address, supply and logic voltage, part number, a link and a reference photo of a typical one. Each suggestion is a card with a tick per field; nothing changes until you apply it. Anything that can't be settled by looking is flagged "check before trusting it" with the test that settles it, and Parts has a "To check" filter for working through them.
- **Photo identification in the page, optional.** With your own Anthropic API key (Settings), Pack can identify a part from a photo and BOM check can match loose wording. The key stays in that browser.

NFC needs Chrome on Android. Everything else works in any browser.

### What's saved where

- **In this browser:** the inventory (localStorage), the API key if you add one, and your sign-in for Drive.
- **In your Google Drive, if you turn it on:** one file, `Parts Bin/Parts Bin.json`, with bins, parts and saved BOMs. junkdrawer.works can only see files it made. To take the permission back, remove junkdrawer.works under Third-party apps & services in your Google Account.
- **A batch from Claude waits in this browser** (the Inbox) until you save or dismiss what's in it. It isn't synced.
- **Reference photos load from the site they're on.** A part's reference photo is a link to a picture on a maker's or shop's site, so that site sees a request for the image (with no referrer). If the picture goes away, the part shows its icon again.
- **Nothing else leaves the page,** except photos and lists sent to Anthropic when you use identification, and a parts list you choose to share with Claude.

## Running it

It's a static site: plain HTML, CSS and JavaScript, with no build step.

```sh
npx http-server -p 8080 -c-1 .   # then open http://localhost:8080
npm test                         # merge rules, then the page in Chromium with a pretend NFC reader and Drive
node tools/screenshots.mjs       # og.png (the README phone shots come from npm test)
node tools/make-icons.mjs        # PNG icons from icon.svg
```

GitHub Pages serves it from `main`, `/ (root)`.

### Files

- `index.html`, `css/app.css`: the page.
- `js/app.js`: the screens (bins, parts, BOM check, pack, settings) and the NFC tag writer and reader.
- `js/model.js`: the inventory document and the item-by-item merge; unit-tested in `test/model.test.mjs`.
- `js/store.js`: keeps it in localStorage and imports Stockroom exports and backups.
- `js/bom.js`: BOM check's reading of a parts list and matching each line against the inventory; unit-tested in `test/bom.test.mjs`.
- `js/inbox.js`: reads a batch from a link, a pasted code or a file, keeps only the fields it knows, and works out what a suggestion would change; unit-tested in `test/inbox.test.mjs`.
- `skill/parts-bin-cataloger/SKILL.md`: the Claude skill that turns photos, receipts and links into a batch. The script that builds the link is at the end of it, and the tests check that its links open here.
- `js/sync.js`: optional Google Drive saving, the junkdrawer.works way.
- `js/ai.js`: optional photo identification with your own API key.
- `test/e2e.mjs`, `test/fake-google.mjs`: drive the page with a pretend NFC reader and a stand-in Google Drive.
- `fonts/`: Barlow, Barlow Condensed and JetBrains Mono, served from here so nothing loads from elsewhere (SIL Open Font License).
- `sw.js`, `manifest.webmanifest`, `icon*.png`, `icon.svg`: works offline and installs to the home screen.
- `CNAME`, `carry.js`: Parts Bin has its own address, parts-bin.junkdrawer.works, so it installs as its own app. It used to be at junkdrawer.works/parts-bin/, which forwards here (tags and links written there still work). A browser keeps each address's saves apart, so the first time it opens here `carry.js` brings the inventory over from the old address.
