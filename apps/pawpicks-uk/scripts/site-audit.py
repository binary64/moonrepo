#!/usr/bin/env python3
"""
pawpicks site audit — run AFTER `npx @11ty/eleventy` against the built _site/.

Checks (OBSERVE/HARDEN rung):
  1. Internal links: every href="/..." resolves to a built page/asset.
  2. Orphan pages: every built page has >=1 internal inbound link.
  3. JSON-LD: every <script type="application/ld+json"> parses as valid JSON,
     and every page carries at least one ld+json block.
  4. Affiliate/commercial hygiene: every outbound CTA to a known commercial
     domain (amazon, forthglade, canagan, lilyskitchen, naturesmenu, petsathome)
     carries rel="nofollow sponsored" and target="_blank".

Exit code 0 = clean, 1 = problems found. Pure stdlib, no deps.
"""
import json
import os
import re
import sys
from html.parser import HTMLParser

SITE = os.path.join(os.path.dirname(__file__), "..", "_site")
SITE = os.path.abspath(SITE)

COMMERCIAL_DOMAINS = (
    "amazon.co.uk", "amazon.com", "forthglade.com", "canagan.com",
    "lilyskitchen.co.uk", "naturesmenu.co.uk", "petsathome.com",
    "butternutbox.com", "poochandmutt.co.uk", "purepetfood.com",
)
# Outbound URLs that are informational/legal, not affiliate CTAs — exempt from rel rule.
NON_AFFILIATE_PATHS = ("/privacy", "/privacypolicy")


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.anchors = []  # list of (attrs dict)
        self.ldjson = []   # list of script bodies
        self._in_ld = False
        self._ld_buf = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a":
            self.anchors.append(a)
        if tag == "script" and a.get("type") == "application/ld+json":
            self._in_ld = True
            self._ld_buf = []

    def handle_endtag(self, tag):
        if tag == "script" and self._in_ld:
            self.ldjson.append("".join(self._ld_buf))
            self._in_ld = False

    def handle_data(self, data):
        if self._in_ld:
            self._ld_buf.append(data)


def built_targets():
    """Set of valid internal href targets (dir routes + on-disk files)."""
    targets = set()
    for root, _dirs, files in os.walk(SITE):
        rel = os.path.relpath(root, SITE)
        for f in files:
            if f == "index.html":
                route = "/" if rel == "." else "/" + rel.replace(os.sep, "/") + "/"
                targets.add(route)
                targets.add(route.rstrip("/"))  # tolerate missing trailing slash
            fp = "/" + os.path.relpath(os.path.join(root, f), SITE).replace(os.sep, "/")
            targets.add(fp)
    return targets


def main():
    if not os.path.isdir(SITE):
        print(f"ERROR: {SITE} not found — run `npx @11ty/eleventy` first.")
        return 1

    targets = built_targets()
    pages = []
    for root, _dirs, files in os.walk(SITE):
        for f in files:
            if f.endswith(".html"):
                pages.append(os.path.join(root, f))

    broken = []          # (page, href)
    inbound = {}         # route -> count
    ld_missing = []      # pages with no ld+json
    ld_invalid = []      # (page, error)
    rel_issues = []      # (page, href, reason)

    for page in pages:
        with open(page, encoding="utf-8") as fh:
            html = fh.read()
        p = LinkParser()
        p.feed(html)
        page_rel = "/" + os.path.relpath(page, SITE).replace(os.sep, "/")

        for a in p.anchors:
            href = a.get("href", "")
            if not href:
                continue
            if href.startswith("/"):
                base = href.split("#")[0].split("?")[0]
                if base == "":
                    continue
                if base not in targets and base.rstrip("/") not in targets:
                    broken.append((page_rel, href))
                else:
                    norm = base if base.endswith("/") or "." in base.split("/")[-1] else base + "/"
                    inbound[norm] = inbound.get(norm, 0) + 1
            elif href.startswith("http"):
                low = href.lower()
                if any(d in low for d in COMMERCIAL_DOMAINS) and not any(
                    x in low for x in NON_AFFILIATE_PATHS
                ):
                    rel = (a.get("rel") or "").lower()
                    if "nofollow" not in rel or "sponsored" not in rel:
                        rel_issues.append((page_rel, href, f'rel="{a.get("rel")}"'))
                    elif a.get("target") != "_blank":
                        rel_issues.append((page_rel, href, "missing target=_blank"))

        # JSON-LD validation
        if not p.ldjson:
            ld_missing.append(page_rel)
        for body in p.ldjson:
            try:
                json.loads(body)
            except json.JSONDecodeError as e:
                ld_invalid.append((page_rel, str(e)))

    # Orphan detection (only routes, not assets)
    orphans = []
    for t in targets:
        if t.endswith("/") and t != "/":
            if inbound.get(t, 0) == 0:
                orphans.append(t)

    ok = True
    print(f"Audited {len(pages)} HTML pages in {SITE}\n")

    def report(title, items, fmt):
        nonlocal ok
        if items:
            ok = False
            print(f"✗ {title}: {len(items)}")
            for it in items[:30]:
                print("   " + fmt(it))
        else:
            print(f"✓ {title}: none")

    report("Broken internal links", broken, lambda x: f"{x[0]} -> {x[1]}")
    report("Orphaned pages (0 inbound internal links)", orphans, lambda x: x)
    report("Pages missing JSON-LD", ld_missing, lambda x: x)
    report("Invalid JSON-LD blocks", ld_invalid, lambda x: f"{x[0]}: {x[1]}")
    report("Commercial links missing rel/target hygiene", rel_issues,
           lambda x: f"{x[0]} -> {x[1]} ({x[2]})")

    print("\n" + ("ALL CLEAN ✓" if ok else "PROBLEMS FOUND ✗"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
