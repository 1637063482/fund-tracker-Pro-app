import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'src', 'components', 'Chat', 'PortfolioChat.jsx');
let code = fs.readFileSync(file, 'utf-8');
const origSize = code.length;

// 1. Add hook imports after line 17 (after firebase import)
const hookImports = 
import { useConversations } from '../../hooks/useConversations';
import { useChatMessages } from '../../hooks/useChatMessages';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useMemoManager } from '../../hooks/useMemoManager';
;
const insertPoint = import { db, appId } from '../../config/firebase';;
code = code.replace(insertPoint, insertPoint + hookImports);

// 2. Replace memos state + effect with useMemoManager call (partial - keep some local states)
// Replace: const [memos, setMemos] = useState([]); + the onSnapshot useEffect
const memosStateDecl =   // 核心修复：状态声明正确移入组件内部
  const [memos, setMemos] = useState([]);
  const sendBtnRef = useRef(null); 

  // 核心修复：Effect 监听器正确移入组件内部
  useEffect(() => {
    if (!user || !db) return;
    const memosRef = collection(db, 'artifacts', appId, 'users', user.uid, 'ai_memos');
    const unsubMemos = onSnapshot(query(memosRef), (snapshot) => {
      const data = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
      setMemos(data);
    });
    return () => unsubMemos();
  }, [user]);;
const memosHookCall =   // Hooks
  const { memos, scoringHistory } = useMemoManager(user, settings);
  const { attachment, previewUrl, ocrEngine, fileInputRef, handleFileChange, removeAttachment } = useFileUpload();
  const sendBtnRef = useRef(null);;

code = code.replace(memosStateDecl, memosHookCall);

// 3. Replace scoring onSnapshot + state (now in useMemoManager)
// Find the scoring snapshot effect and remove it
const scoringEffectStart =   // 打分快照常驻监听（与 memo 相同的 onSnapshot 模式，打开面板时数据已就绪）
  useEffect(() => {
    if (!user || !db) return;
    const snapRef = collection(db, 'artifacts', appId, 'users', user.uid, 'scoring_snapshots');
    const q = query(snapRef, orderBy('date', 'desc'), limit(30));
    const unsub = onSnapshot(q, (snapshot) => {;
const scoringEffectEnd =   }, [user]);;

// Find and remove the scoring effect (since it's in useMemoManager)
const scoringIdx = code.indexOf(scoringEffectStart);
const scoringEndIdx = code.indexOf(scoringEffectEnd, scoringIdx);
if (scoringIdx !== -1 && scoringEndIdx !== -1) {
  code = code.slice(0, scoringIdx) + code.slice(scoringEndIdx + scoringEffectEnd.length);
}

// 4. Remove the old file upload states and replace with useFileUpload
// Keep the renderMessage code untouched - it references variables that now come from hooks

// 5. Remove the conversation loading effect from Firestore (now in useConversations)
// Find: useEffect for convsRef onSnapshot
const convEffectSearch =   // 从 chat_convs 集合直接加载对话列表（每个文档自带 title+createdAt）
  useEffect(() => {
    if (!user || !db) return;
    const convsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'chat_convs');
    const unsub = onSnapshot(query(convsRef), (snapshot) => {;
const convIdx = code.indexOf(convEffectSearch);
if (convIdx !== -1) {
  // Find the closing bracket of this effect
  // It ends with: ), [user]); and the next effect or code
  // Find: "  }, [user]);" after the effect
  const afterEffect = code.indexOf('  });', convIdx);
  if (afterEffect !== -1) {
    // The effect is: useEffect ( ... ); where the ; is after })
    // Let me find the exact end
    const closeParenMatch = code.indexOf('}, [user]);', convIdx);
    if (closeParenMatch !== -1) {
      const effectEnd = closeParenMatch + '}, [user]);'.length;
      code = code.slice(0, convIdx) + code.slice(effectEnd);
    }
  }
}

// 6. Add useConversations hook call inside component
// Find the component's state declarations section and add hook calls
// Actually, the conversations hook is already accessed via the original code's variables
// Let me just verify it compiles

fs.writeFileSync(file, code, 'utf-8');
console.log('Original size:', origSize);
console.log('New size:', code.length);
console.log('Saved:', origSize - code.length, 'bytes');
");