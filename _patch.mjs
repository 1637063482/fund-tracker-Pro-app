import fs from 'fs';
import path from 'path';
const file = path.join(process.cwd(), 'src', 'components', 'Chat', 'PortfolioChat.jsx');
let code = fs.readFileSync(file, 'utf-8');
const origSize = code.length;

const hookImports = "\nimport { useConversations } from '../../hooks/useConversations';\nimport { useChatMessages } from '../../hooks/useChatMessages';\nimport { useFileUpload } from '../../hooks/useFileUpload';\nimport { useMemoManager } from '../../hooks/useMemoManager';\n";
code = code.replace("import { db, appId } from '../../config/firebase';", "import { db, appId } from '../../config/firebase';" + hookImports);

const hfReplace = "  const { attachment, previewUrl, ocrEngine, fileInputRef, handleFileChange, removeAttachment } = useFileUpload();\n  const sendBtnRef = useRef(null); \n";
code = code.replace("  const [memos, setMemos] = useState([]);\n  const sendBtnRef = useRef(null); \n", hfReplace);

const memoEffect = "  useEffect(() => {\n    if (!user || !db) return;\n    const memosRef = collection(db, 'artifacts', appId, 'users', user.uid, 'ai_memos');\n    const unsubMemos = onSnapshot(query(memosRef), (snapshot) => {\n      const data = [];\n      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));\n      setMemos(data);\n    });\n    return () => unsubMemos();\n  }, [user]);\n\n  const [chatTriggerRect, setChatTriggerRect] = useState(null);\n  const [memoTriggerRect, setMemoTriggerRect] = useState(null);\n  const [showButton, setShowButton] = useState(true);\n";
code = code.replace(memoEffect, "  const [chatTriggerRect, setChatTriggerRect] = useState(null);\n  const [memoTriggerRect, setMemoTriggerRect] = useState(null);\n  const [showButton, setShowButton] = useState(true);\n");

fs.writeFileSync(file, code, 'utf-8');
console.log('Original:', origSize, 'New:', code.length, 'Saved:', origSize - code.length);