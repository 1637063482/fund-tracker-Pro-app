
import re
import sys
sys.stdout = open(1, 'w', encoding='utf-8', closefd=False)

decorative = [
    (r'hover:\S+', ''),
    (r'shadow-\S+', ''),
    (r'active:\S+', ''),
    (r'focus:\S+', ''),
    (r'group-hover:\S+', ''),
    (r'group-focus:\S+', ''),
    (r'backdrop-blur-\S+', ''),
    (r'tracking-\S+', ''),
    (r'custom-scrollbar', ''),
    (r'animate-pulse', ''),
    (r'animate-spin', ''),
]

def clean_classname(match):
    cls = match.group(1)
    for pat, repl in decorative:
        cls = re.sub(pat, repl, cls)
    cls = re.sub(r'\s{2,}', ' ', cls).strip()
    if cls:
        return 'className="' + cls + '"'
    return ''

for filepath in ["src/App.jsx", "src/components/Chat/PortfolioChat.jsx"]:
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    original_len = len(content)
    content = re.sub(r'className="([^"]*)"', clean_classname, content)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"{filepath}: {original_len} -> {len(content)} bytes")
