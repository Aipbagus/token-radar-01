"""Render the built dashboard in headless Chromium and capture 3 screenshots (board, detail, filtered)."""
import json, subprocess, sys, os
from playwright.sync_api import sync_playwright

out_dir = sys.argv[1] if len(sys.argv) > 1 else '/tmp/tro6'
shot_dir = '/home/agentuser/token-radar/screenshots'
url = 'file://' + os.path.join(out_dir, 'dashboard', 'index.html')

# which slug to open for the detail view: pick rank 2 (interesting, not just #1)
rows = json.load(open(os.path.join(out_dir, 'board.json')))['rows']
detail_slug = rows[2]['slug']
filter_cat = rows[0]['category'] or 'Other'

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
    page.goto(url)
    page.wait_for_timeout(600)
    page.screenshot(path=f'{shot_dir}/1-board.jpg', full_page=False, type='jpeg', quality=72)
    # detail view
    page.evaluate(f"window.location.hash = '#p={detail_slug}'")
    page.evaluate("window.dispatchEvent(new HashChangeEvent('hashchange'))")
    page.wait_for_timeout(500)
    page.screenshot(path=f'{shot_dir}/2-detail.jpg', full_page=False, type='jpeg', quality=72)
    page.evaluate("window.location.hash = ''")
    page.evaluate("window.dispatchEvent(new HashChangeEvent('hashchange'))")
    page.evaluate("if (document.getElementById('detail') && document.getElementById('detail').open) document.getElementById('detail').close()")
    page.wait_for_timeout(300)
    # filtered view: set category filter via the select
    page.select_option('#category', filter_cat)
    page.wait_for_timeout(400)
    page.screenshot(path=f'{shot_dir}/3-filtered.jpg', full_page=False, type='jpeg', quality=72)
    b.close()
print('done', detail_slug, filter_cat)
