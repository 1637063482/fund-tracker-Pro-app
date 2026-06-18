import re
import sys
sys.stdout = open(1, 'w', encoding='utf-8', closefd=False)

decorative = [
    r'transition-colors',
    r'transition-all',
    r'transition-transform',
    r'transition-opacity',
    r'duration-\d+',
    r'animate-in',
    r'fade-in',
    r'zoom-in',
    r'fade-in-zoom-in',
    r'active:scale-\[\d+\.\d+\]',
    r'active:scale-\d+',
    r'hover:scale-\d+',
    r'hover:-translate-y-\d+\.\d+',
    r'transform-gpu',
    r'backdrop-blur-glass',
    r'safe-top',
    r'safe-bottom',
    r'outline-none',
    r'group',
    r'cursor-pointer',
]

for filepath in ['src/App.jsx', 'src/components/Chat/PortfolioChat.jsx']:
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    original_len = len(content)
    def clean_classname(match):
        cls = match.group(1)
        for pat in decorative:
            cls = re.sub(pat, '', cls)
        cls = re.sub(r'\s{2,}', ' ', cls).strip()
        if cls:
            return f'className="{cls}"'
        else:
            return ''
    content = re.sub(r'className="([^"]*)"', clean_classname, content)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'{filepath}: {original_len} -> {len(content)} bytes')

print('Done')
