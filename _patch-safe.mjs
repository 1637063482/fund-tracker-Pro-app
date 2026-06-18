import fs from 'fs';
import path from 'path';
const file = path.join(process.cwd(), 'src', 'components', 'Chat', 'PortfolioChat.jsx');
let code = fs.readFileSync(file, 'utf-8');

// Only add hook imports - safe, non-breaking
const hookImports = '\nimport { useConversations } from "../../hooks/useConversations";\nimport { useChatMessages } from "../../hooks/useChatMessages";\nimport { useFileUpload } from "../../hooks/useFileUpload";\nimport { useMemoManager } from "../../hooks/useMemoManager";\n';
code = code.replace("import { db, appId } from '../../config/firebase';", "import { db, appId } from '../../config/firebase';" + hookImports);

// Add hook call at start of component - safe (unused variables, but valid)
const componentStart = "export const PortfolioChat = ({ portfolioStats, settings, marketData, user, onAddTodo, onUpdateTodo, onDeleteTodo, onSaveSettings, todos }) => {";
const hookCalls = "\n  const { memos: hookMemos } = useMemoManager(user, settings);\n  const { attachment: hookAttachment, handleFileChange: hookFileChange, removeAttachment: hookRemoveAttachment } = useFileUpload();\n";
code = code.replace(componentStart, componentStart + hookCalls);

fs.writeFileSync(file, code, 'utf-8');
console.log('Done. Size:', code.length);