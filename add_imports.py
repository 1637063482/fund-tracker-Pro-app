import sys
sys.stdout = open(1, 'w', encoding='utf-8', closefd=False)

with open('C:/Users/王豪6207.KEYLIGHTS/fund-tracker-pro/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

old = "import { useModalAnimation } from './hooks/useModalAnimation';"
new_lines = [
    old,
    "import { useFirestoreFunds } from './hooks/useFirestoreFunds';",
    "import { useTodoManager } from './hooks/useTodoManager';",
    "import { useThemeSettings } from './hooks/useThemeSettings';",
    "import { useMarketPolling } from './hooks/useMarketPolling';",
]
new = '\n'.join(new_lines)

content = content.replace(old, new)

with open('C:/Users/王豪6207.KEYLIGHTS/fund-tracker-pro/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('App.jsx: imports added')
