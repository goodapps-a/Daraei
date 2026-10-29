with open("src/index.html", "r", encoding="utf-8") as f:
    text = f.read()

# Fix renderWatch
old_rw = "function renderWatch(){const list=state.watch.map(asset).filter(Boolean);"
new_rw = "function renderWatch(){if(!$('#watchBadge')||!$('#watchGrid'))return;const list=state.watch.map(asset).filter(Boolean);"
if old_rw in text:
    text = text.replace(old_rw, new_rw)
    print("renderWatch guarded successfully")
else:
    print("Could not find old_rw, looking for function renderWatch")
    idx = text.find("function renderWatch()")
    if idx != -1:
        text = text[:idx] + "function renderWatch(){if(!$('#watchBadge')||!$('#watchGrid'))return;" + text[idx + len("function renderWatch(){"):]
        print("Patched renderWatch at idx", idx)

# Guard updateTrust elements
if "$('#marketPill').classList.toggle('sample', allStale);" in text:
    text = text.replace("$('#marketPill').classList.toggle('sample', allStale);", "if ($('#marketPill')) $('#marketPill').classList.toggle('sample', allStale);")
    print("marketPill guarded")

if "$('#storageStatus').textContent" in text:
    text = text.replace("$('#storageStatus').textContent", "if ($('#storageStatus')) $('#storageStatus').textContent")
    print("storageStatus guarded")

with open("src/index.html", "w", encoding="utf-8") as f:
    f.write(text)

