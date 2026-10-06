#!/usr/bin/env python3
"""Build README.md from the generic guide.

Usage: scripts/build-readme.py <path-to-iphone-style-ha-dashboard-guide.md>

The guide is written and regenerated elsewhere; this script only reshapes it for the repo:
the title block gains the screenshots and an install pointer, Step 2 installs from HACS instead
of pasting Appendix A, Appendix A (the inline JavaScript) is dropped in favour of an Installing
section, and credits + license go at the end.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
REPO = "https://github.com/digitalmud/phone-pager-card"

guide = open(sys.argv[1]).read()
head, rest = guide.split("\n## Appendix A:", 1)
appendix_b = "## Appendix:" + rest.split("\n## Appendix B:", 1)[1]

# Screenshots that exist in docs/ go under the title.
SHOTS = [
    ("home.png", "Home page"),
    ("rooms.png", "Rooms page"),
    ("swipe.png", "Mid-swipe between pages"),
    ("settings.png", "Settings sheet with wallpaper presets"),
]
SHOTS = [s for s in SHOTS if os.path.exists(os.path.join(ROOT, "docs", s[0]))]
shots_html = ("<p align=\"center\">\n" + "\n".join(f'  <img src="docs/{f}" width="200" alt="{alt}">' for f, alt in SHOTS)
              + "\n</p>\n\n") if SHOTS else ""

# Title block: everything before the first rule.
intro_old = head.split("\n---\n", 1)[0]
what_you_get = intro_old.split("\n\n", 2)[2]  # "**What you end up with:**" + bullets
intro_new = (
    "# Phone Pager Card\n\n"
    "An iPhone-style, one-screen phone dashboard for Home Assistant: pages side by side that snap as you swipe, "
    "a frosted nav pill, a wallpaper that follows the time of day, and a build guide written for Claude.\n\n"
    + shots_html
    + "This README is the guide. Hand it to Claude with a Home Assistant MCP server connected, and work through the "
    "steps together. The card itself is [`phone-pager-card.js`](phone-pager-card.js) — see [Installing](#installing).\n\n"
    + what_you_get
)
head = head.replace(intro_old, intro_new, 1)

# Step 2 used to paste Appendix A as an inline resource; now it installs the card.
head, n = re.subn(
    r"### Step 2: Install the pager card\n(?:> .*\n)+",
    "### Step 2: Install the pager card\n"
    "Install **Phone Pager Card** from HACS (see [Installing](#installing)) and check that the resource is listed under "
    "Settings → Dashboards → ⋮ → Resources. It defines `custom:phone-pager-card` (the one-screen pager), "
    "`custom:phone-now-playing-card` and `custom:phone-wallpaper-card`.\n",
    head,
)
assert n == 1, "Step 2 not found"
head = head.replace("| **HACS** | To install the cards below. |", "| **HACS** | To install this card and the ones below. |")

install = f"""## Installing

**With HACS (recommended).** In HACS, open the ⋮ menu → *Custom repositories*, add
`{REPO}` with type **Dashboard**, then search for *Phone Pager Card* and download it.
HACS registers the resource (`/hacsfiles/phone-pager-card/phone-pager-card.js`) for you. Reload the browser or the app
afterwards.

**By hand.** Copy [`phone-pager-card.js`](phone-pager-card.js) to `/config/www/phone-pager-card.js` on your Home Assistant,
then add a dashboard resource (Settings → Dashboards → ⋮ → Resources) with URL `/local/phone-pager-card.js` and type
**JavaScript module**. With a Home Assistant MCP server connected, Claude can add the resource for you.

Both routes give you `custom:phone-pager-card`, `custom:phone-now-playing-card` and `custom:phone-wallpaper-card`.
A minimal dashboard is one panel view holding one card:

```yaml
kiosk_mode:
  hide_header: true          # needs Kiosk Mode; leave it out to keep the header
views:
  - title: Home
    path: home
    type: panel
    cards:
      - type: custom:phone-pager-card
        start: 0
        pages:
          - name: Home
            icon: mdi:home
            sections:
              - type: grid
                cards:
                  - type: heading
                    heading: Living room
                  - type: tile
                    entity: light.living_room
          - name: Rooms
            icon: mdi:sofa
            sections: []
```

Every option the card takes is listed in [Step 3](#step-3-make-the-dashboard-one-screen). The look — glass tiles, white
headings, frosted pop-ups — comes from the card-mod recipes in the [appendix](#appendix-style-recipes-card-mod--bubble).

---
"""
head = head.replace("\n---\n\n## 1. What you need", "\n---\n\n" + install + "\n## 1. What you need", 1)
assert "## Installing" in head

credits = """
---

## Credits

This card stands on other people's work:

- [Bubble Card](https://github.com/Clooos/Bubble-Card) — the pop-ups.
- [card-mod](https://github.com/thomasloven/lovelace-card-mod) — per-tile styling.
- [Kiosk Mode](https://github.com/NemesisRE/kiosk-mode) — hides the header bar.
- [auto-entities](https://github.com/thomasloven/lovelace-auto-entities) — lists built from templates.
- [ha-mcp](https://github.com/homeassistant-ai/ha-mcp) — the Home Assistant MCP server Claude works through.
- [Puppet](https://github.com/balloob/home-assistant-addons) — dashboard screenshots, so Claude can check its own work.
- The r/homeassistant post that started it: [iOS inspired Home Assistant theme](https://www.reddit.com/r/homeassistant/comments/1wy5agd/ios_inspired_home_assistant_theme/).

iPhone and iOS are trademarks of Apple Inc. This project is not affiliated with or endorsed by Apple; "iPhone-style"
describes the look and nothing more.

## License

[MIT](LICENSE)
"""

readme = head.rstrip() + "\n\n---\n\n" + appendix_b.strip() + "\n" + credits
assert "Appendix A" not in readme, "Appendix A still referenced"
open(os.path.join(ROOT, "README.md"), "w").write(readme)
print("README.md:", len(readme.splitlines()), "lines;", len(SHOTS), "screenshots")
