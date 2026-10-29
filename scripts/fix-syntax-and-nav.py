import re

with open('src/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Fix the commented out code at the end of the script
broken_str = "// service worker registration disabled})();checkSession();"
if broken_str in html:
    fixed_str = """
})();
checkSession();"""
    html = html.replace(broken_str, fixed_str)
    print("Fixed broken comment at end of script!")
else:
    # Look for any comment before })();checkSession()
    html = re.sub(r'//[^\n]*\n?(\}\)\(\);checkSession\(\);)', r'\1', html)
    print("Checked via regex")

# Check if script_1 parses cleanly now
m = re.findall(r'<script[^>]*>([\s\S]*?)</script>', html)
assert len(m) >= 2, "Expected at least 2 scripts"
with open('/tmp/test_eval.js', 'w', encoding='utf-8') as out:
    out.write(m[1])

with open('src/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Saved to src/index.html and index.html")
