import fs from 'fs';
import path from 'path';
const file = path.join(process.cwd(), 'src', 'components', 'Chat', 'PortfolioChat.jsx');
let code = fs.readFileSync(file, 'utf-8');
const origSize = code.length;

// Remove the scoring onSnapshot effect (now handled by useMemoManager)
// Find it by looking for 'scoring_snapshots' and removing the surrounding effect
const scoreIdx = code.indexOf('scoring_snapshots');
if (scoreIdx !== -1) {
  // Go back to find the start of this effect
  const effectStart = code.lastIndexOf('useEffect', scoreIdx);
  // Go forward to find the end - look for the ]); pattern that ends this effect
  const afterEffect = code.indexOf('}, [user]);', scoreIdx);
  if (effectStart !== -1 && afterEffect !== -1) {
    const beforeEffect = code.lastIndexOf('\n', effectStart - 2);
    const afterEnd = afterEffect + '}, [user]);'.length;
    code = code.substring(0, beforeEffect) + code.substring(afterEnd);
    console.log('Removed scoring effect');
  }
}

// Remove the persistConversation function (now in useConversations hook)
const pcIdx = code.indexOf('const persistConversation');
if (pcIdx !== -1) {
  const pcEnd = code.indexOf('};', pcIdx);
  if (pcEnd !== -1) {
    const beforePC = code.lastIndexOf('\n', pcIdx - 2);
    const afterPCEnd = pcEnd + 2;
    code = code.substring(0, beforePC) + code.substring(afterPCEnd);
    console.log('Removed persistConversation');
  }
}

// Remove the handleFileChange function
const hfcIdx = code.indexOf('const handleFileChange =');
if (hfcIdx !== -1) {
  const hfcEnd = code.indexOf('};', hfcIdx);
  if (hfcEnd !== -1) {
    const before = code.lastIndexOf('\n', hfcIdx - 2);
    const after = code.indexOf('\n', hfcEnd + 2);
    code = code.substring(0, before) + code.substring(after !== -1 ? after : hfcEnd + 2);
    console.log('Removed handleFileChange');
  }
}

// Remove the removeAttachment function
const raIdx = code.indexOf('const removeAttachment = ()');
if (raIdx !== -1) {
  const raEnd = code.indexOf('};', raIdx);
  if (raEnd !== -1) {
    const before = code.lastIndexOf('\n', raIdx - 2);
    const after = code.indexOf('\n', raEnd + 2);
    code = code.substring(0, before) + code.substring(after !== -1 ? after : raEnd + 2);
    console.log('Removed removeAttachment');
  }
}

// Remove the memos onSnapshot effect if still present (by looking for ai_memos reference)
const aiMemoIdx = code.indexOf('ai_memos');
if (aiMemoIdx !== -1) {
  // Find the surrounding useEffect
  const effectStart = code.lastIndexOf('useEffect', aiMemoIdx);
  const effectEnd = code.indexOf('}, [user]);', aiMemoIdx);
  if (effectStart !== -1 && effectEnd !== -1) {
    const beforeEffect = code.lastIndexOf('\n', effectStart - 2);
    const afterEnd = effectEnd + '}, [user]);'.length;
    code = code.substring(0, beforeEffect) + code.substring(afterEnd);
    console.log('Removed memos effect');
  }
}

fs.writeFileSync(file, code, 'utf-8');
console.log('Size:', origSize, '->', code.length, 'Saved:', origSize - code.length);