export const USER_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAHY-z7vomHW6AUVV-a4laSGogcC1BMGM0",
  authDomain: "fund-tracker-66e68.firebaseapp.com",
  projectId: "fund-tracker-66e68",
  storageBucket: "fund-tracker-66e68.firebasestorage.app",
  messagingSenderId: "199762393112",
  appId: "1:199762393112:web:ffa3efa00339108c0ceb6d",
  measurementId: "G-VM99BJCJSZ"
};

export const ASSET_NAMES = {
  'sh000001': '上证指数',
  'sz399001': '深证成指',
  'sz399006': '创业板指',
  'sh511260': '10年期国债ETF',
  'sh511090': '30年期国债ETF'
};

export const PROXY_NODES =[
  { name: '节点 1 (AllOrigins-Raw)', fetcher: async (url) => { const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`); return await r.text(); } },
  { name: '节点 2 (ThingProxy)', fetcher: async (url) => { const r = await fetch(`https://thingproxy.freeboard.io/fetch/${url}`); return await r.text(); } },
  { name: '节点 3 (CorsProxy.io)', fetcher: async (url) => { const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`); return await r.text(); } },
  { name: '节点 4 (CodeTabs)', fetcher: async (url) => { const r = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`); return await r.text(); } },
  { name: '节点 5 (AllOrigins-JSON)', fetcher: async (url) => { const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`); const d = await r.json(); return d.contents; } }
];