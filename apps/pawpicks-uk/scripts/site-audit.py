#!/usr/bin/env python3
"""
pawpicks site audit — run AFTER `npx @11ty/eleventy` against the built _site/.

Checks (OBSERVE/HARDEN rung):
  1. Internal links: every href="/..." resolves to a built page/asset.
  2. Orphan pages: every built page has >=1 internal inbound link.
  3. JSON-LD: every <script type="application/ld+json"> parses as valid JSON,
     and every page carries at least one ld+json block.
  3b. JSON-LD schema shape: known @types carry their Google-required fields
     (FAQPage.mainEntity[].acceptedAnswer.text, ItemList.itemListElement[],
     BreadcrumbList.itemListElement[].item, Product.name, Review fields, etc.).
     Catches structurally-valid JSON that would still fail Rich Results.
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


def validate_ld_node(node, page_rel, schema_issues):
    """Recursively validate known schema.org @types for Google-required fields.

    Only flags types we deliberately emit on this site. Unknown types are skipped
    (we don't want to police every nested object). Walks @graph, arrays, and
    nested objects so a single ld+json block with multiple types is fully checked.
    """
    if isinstance(node, list):
        for item in node:
            validate_ld_node(item, page_rel, schema_issues)
        return
    if not isinstance(node, dict):
        return

    # Descend into @graph containers first.
    if "@graph" in node:
        validate_ld_node(node["@graph"], page_rel, schema_issues)

    types = node.get("@type")
    type_set = set(types if isinstance(types, list) else [types]) if types else set()

    def miss(field):
        schema_issues.append((page_rel, f"{'/'.join(sorted(type_set))} missing/empty '{field}'"))

    if "FAQPage" in type_set:
        me = node.get("mainEntity")
        if not isinstance(me, list) or not me:
            miss("mainEntity[]")
        else:
            for q in me:
                if not isinstance(q, dict) or q.get("@type") != "Question":
                    schema_issues.append((page_rel, "FAQPage.mainEntity[] item not a Question"))
                    continue
                if not q.get("name"):
                    miss("Question.name")
                ans = q.get("acceptedAnswer")
                if not isinstance(ans, dict) or not (ans.get("text") or "").strip():
                    miss("Question.acceptedAnswer.text")

    if "ItemList" in type_set:
        il = node.get("itemListElement")
        if not isinstance(il, list) or not il:
            miss("itemListElement[]")
        else:
            for li in il:
                if not isinstance(li, dict) or li.get("@type") != "ListItem":
                    schema_issues.append((page_rel, "ItemList.itemListElement[] item not a ListItem"))
                    continue
                if li.get("position") is None:
                    miss("ListItem.position")
                if not (li.get("name") or li.get("item") or li.get("url")):
                    miss("ListItem.name/item/url")

    if "BreadcrumbList" in type_set:
        bl = node.get("itemListElement")
        if not isinstance(bl, list) or not bl:
            miss("itemListElement[]")
        else:
            last = len(bl) - 1
            for idx, li in enumerate(bl):
                if not isinstance(li, dict):
                    continue
                if li.get("position") is None:
                    miss("Breadcrumb.ListItem.position")
                if not li.get("name"):
                    miss("Breadcrumb.ListItem.name")
                # Google allows ONLY the final crumb (current page) to omit `item`.
                if idx != last and not li.get("item"):
                    miss("Breadcrumb.ListItem.item (non-final crumb)")

    if "Product" in type_set:
        if not node.get("name"):
            miss("Product.name")
        rev = node.get("review")
        agg = node.get("aggregateRating")
        if rev is None and agg is None:
            miss("Product.review|aggregateRating")
        if isinstance(rev, dict):
            validate_ld_node(rev, page_rel, schema_issues)

    if "Review" in type_set:
        rr = node.get("reviewRating")
        if not isinstance(rr, dict):
            miss("Review.reviewRating")
        elif rr.get("ratingValue") is None:
            miss("Review.reviewRating.ratingValue")
        if not node.get("author"):
            miss("Review.author")

    # Recurse into any nested dict values to catch deeply-embedded typed objects.
    for k, v in node.items():
        if k in ("mainEntity", "itemListElement", "@graph", "review"):
            continue  # already handled
        if isinstance(v, (dict, list)):
            validate_ld_node(v, page_rel, schema_issues)


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
    schema_issues = []   # (page, reason) — required-field shape problems
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
                parsed = json.loads(body)
            except json.JSONDecodeError as e:
                ld_invalid.append((page_rel, str(e)))
            else:
                validate_ld_node(parsed, page_rel, schema_issues)

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
    report("JSON-LD missing required @type fields", schema_issues,
           lambda x: f"{x[0]}: {x[1]}")
    report("Commercial links missing rel/target hygiene", rel_issues,
           lambda x: f"{x[0]} -> {x[1]} ({x[2]})")

    print("\n" + ("ALL CLEAN ✓" if ok else "PROBLEMS FOUND ✗"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
