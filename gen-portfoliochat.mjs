import fs from 'fs';
import path from 'path';

// Read original file for rendering portions
const orig = fs.readFileSync('src/components/Chat/PortfolioChat.jsx', 'utf-8');

// We'll keep the original as reference but build a new compact version
// that uses the extracted hooks
console.log('Original size:', orig.length);