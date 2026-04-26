import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { USER_FIREBASE_CONFIG } from './constants';

const firebaseConfig = (typeof __firebase_config !== 'undefined' && __firebase_config) 
  ? JSON.parse(__firebase_config) 
  : USER_FIREBASE_CONFIG;

export const appId = typeof __app_id !== 'undefined' ? String(__app_id).replace(/\//g, '-') : 'my-fund-tracker';

let app, auth, db;
try {
  if (firebaseConfig.apiKey) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  }
} catch (error) {
  console.error("Firebase 初始化失败 (当前 WebView 环境可能限制了 IndexedDB 等存储权限):", error);
}

export { app, auth, db };